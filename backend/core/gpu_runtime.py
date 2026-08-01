"""GPU runtime management for the CPU edition.

The CPU edition bundles CPU-only torch. Users with an NVIDIA GPU can download
the CUDA torch wheel from Settings; this module handles detection, download,
extraction, manifest tracking, and the sys.path redirect that makes the
external GPU torch shadow the bundled CPU one.

IMPORTANT: this module must stay torch-free and cheap to import — apply_runtime()
is loaded from main.py BEFORE any backend import so the redirect happens before
torch can be imported anywhere.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from backend.core.config import get_gpu_runtime_dir, get_startupinfo
from backend.core.logger import logger
from backend.core.prefs import load_prefs

# --- Wheel source (keep in sync with requirements.txt / the build venv) ---
TORCH_GPU_VERSION = "2.12.0+cu126"
TORCH_GPU_WHEEL = f"torch-{TORCH_GPU_VERSION}-cp314-cp314-win_amd64.whl"
# The pytorch CDN returns 403 for a raw '+' in the path — the index hrefs are
# percent-encoded (%2B). quote(..., safe='') encodes '+' -> %2B.
TORCH_GPU_URL = f"https://download.pytorch.org/whl/cu126/{quote(TORCH_GPU_WHEEL, safe='')}"
TORCH_GPU_SIZE = 2_641_230_877  # bytes — verified against the CDN's Content-Length (2026-08-01)
MIN_WHEEL_BYTES = 2_500_000_000  # sanity floor; a complete read is guaranteed by the downloader
                                 # (truncation raises), zip CRC + extraction are the real integrity gates
MIN_NVIDIA_DRIVER = (560, 28)   # CUDA 12.6 min NVIDIA driver on Windows (advisory; final gate is torch.cuda.is_available())
MIN_FREE_BYTES = 7 * 2**30      # ~7 GB headroom for wheel (2.6GB) + extracted runtime

MANIFEST_NAME = "manifest.json"
DOWNLOADS_SUBDIR = "downloads"

_download_lock = threading.Lock()
_download_active = False


# ---------------------------------------------------------------------------
# Paths / manifest
# ---------------------------------------------------------------------------

def runtime_dir() -> Path:
    return get_gpu_runtime_dir()


def manifest_path() -> Path:
    return runtime_dir() / MANIFEST_NAME


def manifest_read() -> dict | None:
    p = manifest_path()
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def manifest_write(meta: dict) -> None:
    p = manifest_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    os.replace(tmp, p)


def manifest_valid() -> bool:
    """True when the installed runtime matches this build's expected wheel."""
    meta = manifest_read()
    if not meta:
        return False
    if meta.get("torch_version") != TORCH_GPU_VERSION:
        return False
    if meta.get("wheel") != TORCH_GPU_WHEEL:
        return False
    return (runtime_dir() / "torch" / "__init__.py").exists()


# ---------------------------------------------------------------------------
# NVIDIA / CUDA detection
#
# Must NOT use torch: a CPU build's torch always reports cuda unavailable,
# even on capable hardware. nvidia-smi (installed with the NVIDIA driver) is
# authoritative for the CUDA driver version; WMI only confirms presence.
# ---------------------------------------------------------------------------

def _parse_driver_version(raw: str) -> tuple[int, int] | None:
    """Parse '560.94' -> (560, 94); None when unparseable."""
    try:
        parts = raw.strip().split(".")
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return (major, minor)
    except (ValueError, IndexError):
        return None


def _query_nvidia_smi() -> dict | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
            startupinfo=get_startupinfo(),  # windowed app: no console flash
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    return {
        "driver_version": out.stdout.strip(),
        "version_tuple": _parse_driver_version(out.stdout),
        "source": "nvidia-smi",
    }


def _query_wmi() -> dict | None:
    """WMI fallback: confirms an NVIDIA adapter exists. Its DriverVersion uses
    Windows package numbering (not the CUDA driver number), so no version
    comparison is attempted — the final gate is torch.cuda.is_available()."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
            capture_output=True, text=True, timeout=10,
            startupinfo=get_startupinfo(),  # windowed app: no console flash
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    if any("NVIDIA" in ln.upper() for ln in out.stdout.splitlines() if ln.strip()):
        return {"driver_version": None, "version_tuple": None, "source": "wmi"}
    return None


def detect_nvidia_driver() -> dict | None:
    return _query_nvidia_smi() or _query_wmi()


def gpu_status() -> dict:
    meta = manifest_read()
    det = detect_nvidia_driver()
    ver = det["version_tuple"] if det else None
    torch_mod = sys.modules.get("torch")
    active = bool(
        torch_mod is not None
        and getattr(torch_mod, "cuda", None) is not None
        and torch_mod.cuda.is_available()
    )
    return {
        "nvidia_driver": det is not None,
        "driver_version": det["driver_version"] if det else None,
        "driver_ok": ver is not None and ver >= MIN_NVIDIA_DRIVER if ver is not None else None,
        "runtime_installed": manifest_valid() or (runtime_dir() / "torch" / "__init__.py").exists(),
        "runtime_version": meta.get("torch_version") if meta else None,
        "manifest_valid": manifest_valid(),
        "has_runtime_files": (runtime_dir() / "torch" / "__init__.py").exists()
                             or any((runtime_dir() / DOWNLOADS_SUBDIR).glob("*")),
        "gpu_enabled": bool(load_prefs().get("gpu_enabled")),
        "active_engine": "cuda" if active else "cpu",
    }


# ---------------------------------------------------------------------------
# Download / extract / verify
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_wheel(whl_path: Path, dest: Path) -> None:
    """Extract only the torch/ prefix from a wheel, zip-slip-safe.

    Integrity is validated by zipfile's read-time CRC check (a corrupt entry
    raises BadZipFile) and by the pre-extract sha256 check in download_runtime().
    """
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(whl_path) as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                raise ValueError(f"unsafe entry in wheel: {info.filename}")
            if not name.startswith("torch/"):
                continue  # skip dist-info and other top-level entries
            target = dest / name
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def download_runtime(progress_cb=None, cancel_event=None) -> dict:
    """Download, verify and extract the GPU torch runtime.

    Returns {"success": True} or {"success": False, "error": <code>} where
    <code> is one of: already_running, disk_space, cancelled, download_failed,
    size_mismatch, extract_failed.
    """
    global _download_active
    with _download_lock:
        if _download_active:
            return {"success": False, "error": "already_running"}
        _download_active = True
    try:
        rdir = runtime_dir()
        ddir = rdir / DOWNLOADS_SUBDIR
        ddir.mkdir(parents=True, exist_ok=True)

        if shutil.disk_usage(str(rdir)).free < MIN_FREE_BYTES:
            logger.error(f"GPU runtime: not enough free disk (need ~{MIN_FREE_BYTES // 2**30} GB)")
            return {"success": False, "error": "disk_space"}

        whl = ddir / TORCH_GPU_WHEEL
        try:
            # Lazy import: pulls backend.pipeline.tts (and db) which must NOT
            # load at main.py startup — only Settings actions reach here.
            from backend.pipeline.tts import download_file_with_progress
            download_file_with_progress(TORCH_GPU_URL, whl, progress_cb, cancel_event)
        except InterruptedError:
            logger.warning("GPU runtime download cancelled by user")
            return {"success": False, "error": "cancelled"}
        except Exception as e:
            logger.error(f"GPU runtime download failed: {e}")
            return {"success": False, "error": "download_failed"}

        actual = whl.stat().st_size
        if actual < MIN_WHEEL_BYTES:
            logger.error(f"GPU runtime wheel too small: {actual} bytes (expected ~{TORCH_GPU_SIZE})")
            whl.unlink(missing_ok=True)
            return {"success": False, "error": "size_mismatch"}
        logger.info(f"GPU runtime wheel downloaded: {actual} bytes")

        try:
            extract_wheel(whl, rdir)
        except Exception as e:
            logger.error(f"GPU runtime extraction failed: {e}")
            whl.unlink(missing_ok=True)
            return {"success": False, "error": "extract_failed"}

        manifest_write({
            "wheel": TORCH_GPU_WHEEL,
            "torch_version": TORCH_GPU_VERSION,
            "size": whl.stat().st_size,
            "sha256": sha256_file(whl),
            "extracted_at": datetime.now().isoformat(timespec="seconds"),
        })
        whl.unlink(missing_ok=True)
        return {"success": True}
    finally:
        with _download_lock:
            _download_active = False


def remove_runtime() -> bool:
    """Delete the downloaded runtime entirely (manifest included)."""
    rdir = runtime_dir()
    try:
        if rdir.exists():
            shutil.rmtree(rdir)
        rdir.mkdir(parents=True, exist_ok=True)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Activation (called from main.py before any backend import)
# ---------------------------------------------------------------------------

def apply_runtime() -> bool:
    """Insert the downloaded GPU runtime at the FRONT of sys.path so its torch
    shadows the bundled CPU torch. Never imports torch. Returns True when the
    redirect was applied."""
    if not load_prefs().get("gpu_enabled"):
        return False
    if not manifest_valid():
        return False
    d = str(runtime_dir())
    if d in sys.path:
        return True
    sys.path.insert(0, d)
    return True
