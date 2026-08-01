"""Unit tests for backend.core.gpu_runtime (Tasks 4-8)."""
import json
import shutil
import subprocess
import sys
import types
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.core import gpu_runtime as gr
from backend.pipeline import tts as tts_module


# ---------------------------------------------------------------------------
# Task 4: constants / wheel source
# ---------------------------------------------------------------------------

def test_wheel_constants():
    assert gr.TORCH_GPU_WHEEL.startswith("torch-2.12.0+cu126")
    assert "cp314" in gr.TORCH_GPU_WHEEL
    assert gr.TORCH_GPU_SIZE > 2_000_000_000
    # The pytorch CDN 403s on a raw '+' in the path — the URL must be
    # percent-encoded (%2B) exactly like the index hrefs.
    from urllib.parse import quote
    assert gr.TORCH_GPU_URL == f"https://download.pytorch.org/whl/cu126/{quote(gr.TORCH_GPU_WHEEL, safe='')}"
    assert "%2Bcu126" in gr.TORCH_GPU_URL
    assert "+cu126" not in gr.TORCH_GPU_URL


# ---------------------------------------------------------------------------
# Task 5: detection
# ---------------------------------------------------------------------------

def test_parse_driver_version():
    assert gr._parse_driver_version("560.94") == (560, 94)
    assert gr._parse_driver_version("555.42\n") == (555, 42)
    assert gr._parse_driver_version("610") == (610, 0)
    assert gr._parse_driver_version("garbage") is None


class FakeRunner:
    """Returns queued (returncode, stdout) results per subprocess.run call."""

    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        rc, out = self.results.pop(0)
        return SimpleNamespace(returncode=rc, stdout=out)


def _assert_hidden_window(fake):
    """Every subprocess call from a windowed app must pass hidden-window startupinfo
    (otherwise a console window flashes on screen)."""
    for _, kwargs in fake.calls:
        assert kwargs.get("startupinfo") is not None


def test_detect_via_nvidia_smi(monkeypatch):
    fake = FakeRunner([(0, "560.94\n")])
    monkeypatch.setattr(shutil, "which", lambda name: "C:/nvidia-smi.exe" if name == "nvidia-smi" else None)
    monkeypatch.setattr(subprocess, "run", fake)
    det = gr.detect_nvidia_driver()
    _assert_hidden_window(fake)
    assert det["source"] == "nvidia-smi"
    assert det["version_tuple"] == (560, 94)
    assert det["driver_version"] == "560.94"


def test_detect_wmi_fallback(monkeypatch):
    fake = FakeRunner([(0, "NVIDIA GeForce RTX 2050\n")])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setattr(subprocess, "run", fake)
    det = gr.detect_nvidia_driver()
    _assert_hidden_window(fake)
    assert det["source"] == "wmi"
    assert det["version_tuple"] is None


def test_detect_nothing(monkeypatch):
    fake = FakeRunner([(0, "Intel(R) UHD Graphics\n")])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setattr(subprocess, "run", fake)
    assert gr.detect_nvidia_driver() is None


def test_gpu_status_driver_ok(monkeypatch):
    monkeypatch.setattr(gr, "manifest_read", lambda: None)
    monkeypatch.setattr(gr, "manifest_valid", lambda: False)
    monkeypatch.setattr(gr, "detect_nvidia_driver", lambda: {
        "driver_version": "555.42", "version_tuple": (555, 42), "source": "nvidia-smi"})
    monkeypatch.setattr(gr, "load_prefs", lambda: {"gpu_enabled": False})
    status = gr.gpu_status()
    assert status["nvidia_driver"] is True
    assert status["driver_ok"] is False  # below CUDA 12.6 minimum
    assert status["active_engine"] == "cpu"


def test_gpu_status_active_engine_cuda(monkeypatch):
    fake_torch = types.ModuleType("torch")
    fake_torch.cuda = SimpleNamespace(is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(gr, "manifest_read", lambda: None)
    monkeypatch.setattr(gr, "manifest_valid", lambda: False)
    monkeypatch.setattr(gr, "detect_nvidia_driver", lambda: {
        "driver_version": "610.62", "version_tuple": (610, 62), "source": "nvidia-smi"})
    monkeypatch.setattr(gr, "load_prefs", lambda: {"gpu_enabled": True})
    assert gr.gpu_status()["active_engine"] == "cuda"


# ---------------------------------------------------------------------------
# Task 6: manifest + safe extract
# ---------------------------------------------------------------------------

def test_manifest_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    assert gr.manifest_read() is None
    gr.manifest_write({"torch_version": gr.TORCH_GPU_VERSION, "wheel": gr.TORCH_GPU_WHEEL})
    assert gr.manifest_read()["torch_version"] == gr.TORCH_GPU_VERSION


def test_manifest_valid_requires_torch_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    gr.manifest_write({"torch_version": gr.TORCH_GPU_VERSION, "wheel": gr.TORCH_GPU_WHEEL})
    assert gr.manifest_valid() is False  # torch/ missing
    (tmp_path / "torch").mkdir(parents=True)
    (tmp_path / "torch" / "__init__.py").write_text("")
    assert gr.manifest_valid() is True


def test_manifest_valid_wrong_version(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    gr.manifest_write({"torch_version": "9.9.9", "wheel": gr.TORCH_GPU_WHEEL})
    (tmp_path / "torch").mkdir(parents=True)
    (tmp_path / "torch" / "__init__.py").write_text("")
    assert gr.manifest_valid() is False


def test_extract_wheel_clean(tmp_path):
    whl = tmp_path / "fake.whl"
    with zipfile.ZipFile(whl, "w") as zf:
        zf.writestr("torch/__init__.py", "MARKER = 1\n")
        zf.writestr("torch/sub/mod.py", "x = 2\n")
        zf.writestr("torch-2.12.0.dist-info/METADATA", "skip me")
    dest = tmp_path / "out"
    gr.extract_wheel(whl, dest)
    assert (dest / "torch" / "__init__.py").read_text() == "MARKER = 1\n"
    assert (dest / "torch" / "sub" / "mod.py").read_text() == "x = 2\n"
    assert not (dest / "torch-2.12.0.dist-info").exists()


@pytest.mark.parametrize("bad_name", ["../evil.txt", "/abs.txt", "torch/../escape.py", "torch/.."])
def test_extract_wheel_rejects_unsafe(tmp_path, bad_name):
    whl = tmp_path / "bad.whl"
    with zipfile.ZipFile(whl, "w") as zf:
        zf.writestr(bad_name, "x")
    with pytest.raises(ValueError):
        gr.extract_wheel(whl, tmp_path / "out")


def test_sha256_file(tmp_path):
    p = tmp_path / "data.bin"
    p.write_bytes(b"hello")
    import hashlib
    assert gr.sha256_file(p) == hashlib.sha256(b"hello").hexdigest()


def test_gpu_status_has_runtime_files(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "manifest_read", lambda: None)
    monkeypatch.setattr(gr, "manifest_valid", lambda: False)
    monkeypatch.setattr(gr, "detect_nvidia_driver", lambda: None)
    monkeypatch.setattr(gr, "load_prefs", lambda: {})
    assert gr.gpu_status()["has_runtime_files"] is False
    (tmp_path / "downloads").mkdir(parents=True)
    (tmp_path / "downloads" / "partial.bin").write_bytes(b"x")
    assert gr.gpu_status()["has_runtime_files"] is True


# ---------------------------------------------------------------------------
# Task 7: download orchestrator
# ---------------------------------------------------------------------------

def _make_mini_wheel(path: Path) -> int:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("torch/__init__.py", "MARKER = 'GPU'\n")
    return path.stat().st_size


def test_download_runtime_success(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "MIN_WHEEL_BYTES", 1)
    mini = tmp_path / "mini.whl"
    size = _make_mini_wheel(mini)

    def fake_download(url, dest, progress_cb=None, cancel_event=None):
        shutil.copyfile(mini, dest)
        if progress_cb:
            progress_cb(100.0)

    monkeypatch.setattr(tts_module, "download_file_with_progress", fake_download)
    monkeypatch.setattr(gr, "TORCH_GPU_SIZE", size)

    result = gr.download_runtime()
    assert result == {"success": True}
    assert (tmp_path / "torch" / "__init__.py").exists()
    meta = gr.manifest_read()
    assert meta["wheel"] == gr.TORCH_GPU_WHEEL
    assert meta["size"] == size
    assert not (tmp_path / gr.DOWNLOADS_SUBDIR / gr.TORCH_GPU_WHEEL).exists()  # wheel cleaned up


def test_download_runtime_size_tolerant(tmp_path, monkeypatch):
    """Size must pass a sanity floor, not an exact match — the wheel size differs
    between builds/mirrors (Content-Length is authoritative, and extraction + CRC
    are the real integrity gates)."""
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "MIN_WHEEL_BYTES", 1)
    mini = tmp_path / "mini.whl"
    _make_mini_wheel(mini)

    def fake_download(url, dest, progress_cb=None, cancel_event=None):
        shutil.copyfile(mini, dest)

    monkeypatch.setattr(tts_module, "download_file_with_progress", fake_download)
    monkeypatch.setattr(gr, "TORCH_GPU_SIZE", 999_999)  # deliberately "wrong"

    assert gr.download_runtime() == {"success": True}


def test_download_runtime_cancelled(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)

    def cancel_download(url, dest, progress_cb=None, cancel_event=None):
        raise InterruptedError("Cancelled")

    monkeypatch.setattr(tts_module, "download_file_with_progress", cancel_download)
    assert gr.download_runtime() == {"success": False, "error": "cancelled"}
    assert gr.manifest_read() is None


def test_download_runtime_size_mismatch(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)

    def short_download(url, dest, progress_cb=None, cancel_event=None):
        dest.write_bytes(b"too small")

    monkeypatch.setattr(tts_module, "download_file_with_progress", short_download)
    monkeypatch.setattr(gr, "TORCH_GPU_SIZE", 999_999)
    assert gr.download_runtime() == {"success": False, "error": "size_mismatch"}
    assert not (tmp_path / gr.DOWNLOADS_SUBDIR).exists() or not list((tmp_path / gr.DOWNLOADS_SUBDIR).glob("*"))


def test_download_runtime_already_running(tmp_path, monkeypatch):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    gr._download_active = True
    try:
        assert gr.download_runtime() == {"success": False, "error": "already_running"}
    finally:
        gr._download_active = False


# ---------------------------------------------------------------------------
# Task 8: activation
# ---------------------------------------------------------------------------

def test_apply_runtime_redirects(monkeypatch, tmp_path):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "load_prefs", lambda: {"gpu_enabled": True})
    monkeypatch.setattr(gr, "manifest_valid", lambda: True)
    saved = list(sys.path)
    try:
        assert gr.apply_runtime() is True
        assert sys.path[0] == str(tmp_path)
    finally:
        sys.path[:] = saved


def test_apply_runtime_disabled(monkeypatch, tmp_path):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "load_prefs", lambda: {"gpu_enabled": False})
    monkeypatch.setattr(gr, "manifest_valid", lambda: True)
    saved = list(sys.path)
    try:
        assert gr.apply_runtime() is False
        assert str(tmp_path) not in sys.path
    finally:
        sys.path[:] = saved


def test_apply_runtime_invalid_manifest(monkeypatch, tmp_path):
    monkeypatch.setattr(gr, "runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(gr, "load_prefs", lambda: {"gpu_enabled": True})
    monkeypatch.setattr(gr, "manifest_valid", lambda: False)
    saved = list(sys.path)
    try:
        assert gr.apply_runtime() is False
        assert str(tmp_path) not in sys.path
    finally:
        sys.path[:] = saved
