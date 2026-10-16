"""
DhVaani — Voice Cloning TTS Module (replaces OmniVoice).

Upstream: https://huggingface.co/ARTPARK-IISc/DhVaani-0.5 (Apache-2.0, gated).
Fast zero-shot voice cloning for 27 Indian languages, fine-tuned from
k2-fsa/ZipVoice (flow-matching, 123M params, 24 kHz output).

API shape (upstream demo):
- Download: `snapshot_download("ARTPARK-IISc/DhVaani-0.5", token=HF_TOKEN)`
- Load: `sys.path += [model_path, model_path/_backend]`,
  `from dhvaani import DhVaani; model = DhVaani(model_path)`
- Clone: `model.synthesize(text, prompt_wav, prompt_text, out_path,
  num_step=16, guidance_scale=1.0, speed=1.0, seed=666)`

Unlike OmniVoice, sampling is seed-controlled, so a bad draw can be
retried deterministically with a different seed.

This module exposes the same role the OmniVoice module had; the pipeline
(`backend/pipeline/tts.py`) and bridge (`backend/core/bridge.py`) use:
  check_dhvaani_model / download_dhvaani_model / delete_dhvaani_model /
  generate_dhvaani_tts / get_dhvaani_dir / get_default_reference_voice
  + get_legacy_omnivoice_size (Settings reclaim UI).
"""

import hashlib
import json
import os
import re
import shutil
import sys
import threading
from pathlib import Path

from backend.core.config import get_assets_dir, get_models_dir
from backend.core.logger import logger

# Small-GPU fragmentation guard: must be set before the first CUDA allocation.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

DHVAANI_HF_REPO = "ARTPARK-IISc/DhVaani-0.5"
DHVAANI_LICENSE_URL = "https://huggingface.co/ARTPARK-IISc/DhVaani-0.5"
DHVAANI_SAMPLE_RATE = 24000
# Prompt clips are normalized to the model output rate so cloning never
# resamples across mismatched rates at inference time.
PROMPT_SAMPLE_RATE = 24000
DHVAANI_NUM_STEP_DEFAULT = 16  # upstream default (CLI: 16=quality, 8=faster); 32 doubles CPU/GPU cost
DHVAANI_SEED_DEFAULT = 666
DHVAANI_GUIDANCE_DEFAULT = 1.0
# User-facing quality presets (Settings > Voice Synthesis, per-project
# override in the Voice tab) mapped to sampling steps. Stored as the preset
# string everywhere; resolved to steps at the single use site.
DHVAANI_QUALITY_STEPS = {"fast": 8, "balanced": 16, "best": 32}
DHVAANI_QUALITY_DEFAULT = "balanced"


def dhvaani_steps_for_quality(quality: str | None) -> int:
    """Maps a quality preset to sampling steps (unknown -> balanced default)."""
    q = (quality or "").strip().lower()
    return DHVAANI_QUALITY_STEPS.get(q, DHVAANI_QUALITY_STEPS[DHVAANI_QUALITY_DEFAULT])
# Chunk join crossfade to avoid clicks at concatenation boundaries.
_CHUNK_CROSSFADE_MS = 8.0

# Module-level model cache (singleton) to avoid reloading on every call.
_dhvaani_model = None
_dhvaani_paths_added = False
_dhvaani_model_lock = threading.Lock()
# Serializes actual inference: the cached DhVaani object is shared between
# the voiceover pipeline thread and ad-hoc preview calls. Concurrent
# model.synthesize() on the same object is not safe (CUDA OOM / garbled
# output), so the whole synthesize loop holds this separately from the
# short-lived cache lock above.
_dhvaani_synth_lock = threading.Lock()
_unload_timer = None
_active_requests = 0
# faster-whisper model used for prompt-clip transcription ("turbo" is
# multilingual, covers en + hi).
REF_TRANSCRIBE_MODEL = "turbo"

_num2words_missing_logged = False
_indic_missing_logged = False


def _unload_dhvaani_model():
    global _dhvaani_model, _unload_timer
    with _dhvaani_model_lock:
        if _dhvaani_model is not None:
            logger.info("Unloading DhVaani model due to 30s inactivity to free memory...")
            del _dhvaani_model
            _dhvaani_model = None
            import gc

            gc.collect()
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        if _unload_timer is not None:
            _unload_timer.cancel()
            _unload_timer = None


def _reset_unload_timer():
    global _unload_timer
    if _unload_timer is not None:
        _unload_timer.cancel()
    _unload_timer = threading.Timer(30.0, _unload_dhvaani_model)
    _unload_timer.daemon = True
    _unload_timer.start()


def _maybe_auto_disable_gpu():
    """GPU runtime was enabled but CUDA can't start here: flip the pref off."""
    from backend.core.prefs import load_prefs, save_prefs

    if not load_prefs().get("gpu_enabled"):
        return
    logger.warning("GPU runtime enabled but CUDA unavailable — falling back to CPU and disabling GPU pref")
    try:
        save_prefs({"gpu_enabled": False})
    except Exception:
        pass
    try:
        from backend.core.bridge import ui_queue

        ui_queue.put(("gpu_disabled", ("CUDA could not start; switched back to CPU",)))
    except Exception:
        pass


def get_dhvaani_dir() -> Path:
    """Returns the local directory for DhVaani model files."""
    d = get_models_dir() / "dhvaani"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _hf_token():
    """HF token for gated downloads: HF_TOKEN env (or hf-login cache) first,
    saved Settings field second. Never logged."""
    if os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN"):
        return os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    try:
        from backend.database.db import get_setting

        return (get_setting("hf_token") or "").strip() or None
    except Exception:
        return None


def check_dhvaani_model() -> bool:
    """Strict marker check: only a completed download counts.

    Partial snapshots (interrupted HF fetch) must NOT pass — they fail later
    with obscure load errors. The marker is written atomically after the
    last file lands (see download_dhvaani_model).
    """
    d = get_dhvaani_dir()
    try:
        marker = d / ".dhvaani_complete"
        weights = d / "model.safetensors"
        if not marker.is_file() or not weights.is_file():
            return False
        if weights.stat().st_size == 0:
            return False
        # Marker content pins the repo so a foreign snapshot can't masquerade.
        try:
            if marker.read_text(encoding="utf-8").strip() not in ("", DHVAANI_HF_REPO):
                return False
        except OSError:
            return False
        return True
    except OSError:
        return False


def _gated_access_error(from_exc: Exception) -> RuntimeError:
    return RuntimeError(
        "DhVaani download needs access approval: 1) open "
        f"{DHVAANI_LICENSE_URL} and accept the license, 2) paste a token "
        "(create at https://huggingface.co/settings/tokens) in Settings > "
        "Voice Synthesis > HuggingFace Token (or set HF_TOKEN / run "
        "`hf auth login`), 3) retry the download."
    )


def download_dhvaani_model(progress_callback=None, cancel_event=None) -> bool:
    """Downloads the DhVaani model snapshot file-by-file with real progress.

    File-by-file (instead of one opaque snapshot_download) gives the Settings
    UI per-file progress and allows cancellation between files. The
    completion marker is written only after every file lands.
    """
    from huggingface_hub import HfApi, hf_hub_download

    dest = get_dhvaani_dir()
    token = _hf_token()
    logger.info(f"Downloading DhVaani model snapshot: {DHVAANI_HF_REPO} -> {dest} (~0.5GB first run)")
    if progress_callback:
        try:
            progress_callback({"file": DHVAANI_HF_REPO, "progress": 2})
        except Exception:
            pass

    def _check_cancel():
        if cancel_event is not None and getattr(cancel_event, "is_set", lambda: False)():
            raise InterruptedError("Cancelled")

    try:
        api = HfApi(token=token)
        try:
            repo_files = api.list_repo_files(repo_id=DHVAANI_HF_REPO)
        except Exception as e:
            msg = str(e)
            if "401" in msg or "403" in msg or "Unauthorized" in msg or "gated" in msg.lower() or "access" in msg.lower():
                raise _gated_access_error(e) from e
            raise
        # Skip HF bookkeeping files that must never land in the snapshot dir.
        repo_files = [f for f in (repo_files or []) if not f.endswith(".dhvaani_complete")]
        if not repo_files:
            raise RuntimeError(f"HF repo {DHVAANI_HF_REPO} listed no files.")
        total = len(repo_files)
        for idx, fname in enumerate(repo_files):
            _check_cancel()
            if progress_callback:
                try:
                    progress_callback({
                        "file": fname,
                        "progress": 2 + int(idx / max(total, 1) * 93),
                        "total_files": total,
                        "index": idx,
                    })
                except Exception:
                    pass
            try:
                hf_hub_download(
                    repo_id=DHVAANI_HF_REPO,
                    filename=fname,
                    local_dir=str(dest),
                    local_dir_use_symlinks=False,
                    token=token,
                )
            except Exception as e:
                msg = str(e)
                if "401" in msg or "403" in msg or "Unauthorized" in msg or "gated" in msg.lower():
                    raise _gated_access_error(e) from e
                raise
        _check_cancel()
    except InterruptedError:
        logger.info("DhVaani download cancelled by user; partial files kept for resume.")
        raise
    except Exception as e:
        msg = str(e)
        # Preserve the curated gated message; anything else bubbles raw so
        # network/DNS/timeout text reaches the Settings error box verbatim.
        raise

    weights = dest / "model.safetensors"
    if not weights.is_file() or weights.stat().st_size == 0:
        raise RuntimeError(
            f"DhVaani download incomplete: {weights.name} missing after fetch. "
            "Retry the download."
        )
    (dest / ".dhvaani_complete").write_text(DHVAANI_HF_REPO, encoding="utf-8")
    _remove_legacy_omnivoice_files()
    # Pre-warm the Vocos vocoder checkpoint (public HF repo, fetched lazily
    # at first load otherwise) so cloning works fully offline after setup.
    try:
        _ensure_snapshot_on_path()
        _ensure_optional_inference_deps()
        _ensure_torchaudio_soundfile_fallback()
        try:
            from zipvoice.bin.infer_zipvoice import get_vocoder
        except ImportError:
            # Vendored layout fallback: snapshot _backend on sys.path may
            # expose the module under a different top-level name.
            from infer_zipvoice import get_vocoder  # type: ignore
        get_vocoder()
        logger.info("DhVaani vocoder checkpoint cached.")
    except Exception as e:
        logger.warning(f"DhVaani vocoder pre-warm failed (will retry at first use): {e}")
    if progress_callback:
        try:
            progress_callback({"file": DHVAANI_HF_REPO, "progress": 100})
        except Exception:
            pass
    logger.info("DhVaani model snapshot downloaded successfully.")
    return True


def _reset_dhvaani_import_state() -> None:
    """Forgets snapshot modules/paths so a re-download loads fresh code."""
    global _dhvaani_paths_added
    _dhvaani_paths_added = False
    for mod_name in [m for m in list(sys.modules) if m == "dhvaani" or m.startswith("dhvaani.")]:
        try:
            del sys.modules[mod_name]
        except KeyError:
            pass
    # Only drop vendored zipvoice if it resolves inside the snapshot dir —
    # never touch a site-packages install.
    try:
        model_dir = str(get_models_dir() / "dhvaani")
        for mod_name in [m for m in list(sys.modules) if m == "zipvoice" or m.startswith("zipvoice.")]:
            mod = sys.modules.get(mod_name)
            mod_file = getattr(mod, "__file__", "") or ""
            if mod_file and model_dir in str(mod_file):
                try:
                    del sys.modules[mod_name]
                except KeyError:
                    pass
    except Exception:
        pass
    # Drop stale sys.path entries pointing at the deleted snapshot.
    try:
        model_dir = str(get_models_dir() / "dhvaani")
        sys.path = [p for p in sys.path if p not in (model_dir, model_dir + "/_backend", model_dir + "\\_backend")]
    except Exception:
        pass


def delete_dhvaani_model() -> bool:
    """Deletes local DhVaani model files and resets import state."""
    global _dhvaani_model, _unload_timer
    d = get_dhvaani_dir()
    try:
        with _dhvaani_model_lock:
            _dhvaani_model = None
            if _unload_timer is not None:
                _unload_timer.cancel()
                _unload_timer = None
        _reset_dhvaani_import_state()
        # NOTE: the Vocos vocoder checkpoint lives in the HF cache (public
        # repo, shared), not under models/dhvaani — intentionally kept so a
        # re-download stays small. Only the gated snapshot is deleted here.
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
            d.mkdir(parents=True, exist_ok=True)
            logger.info("Deleted DhVaani model files.")
        return True
    except Exception as e:
        logger.error(f"Failed to delete DhVaani model: {e}")
        return False


# ── Default reference voice (engine-agnostic) ──
# DhVaani needs the EXACT transcript of the prompt clip. Default clips are
# synthesized by us via Edge-TTS, so their transcripts are known exactly.
# One clip per language: cloning English from the Hindi prompt audibly
# carries over accent, so English projects get an English prompt.

DEFAULT_REFERENCE_EDGE_VOICE = "hi-IN-SwaraNeural"
DEFAULT_REFERENCE_TEXT = (
    "नमस्ते! यह आपकी डिफ़ॉल्ट आवाज़ है, जिसका उपयोग वीडियो निर्माण के लिए किया जाता है। "
    "आप चाहें तो सेटिंग्स में जाकर अपनी खुद की आवाज़ अपलोड कर सकते हैं। "
    "यह एक सरल और स्पष्ट उदाहरण है, ताकि आवाज़ की पहचान सही तरीके से हो सके।"
)
DEFAULT_REFERENCE_EDGE_VOICE_EN = "en-US-AndrewNeural"
DEFAULT_REFERENCE_TEXT_EN = (
    "Hello! This is your default voice, used for creating videos. "
    "You can go to Settings and upload your own voice if you prefer. "
    "This short and clear sample helps the cloning lock onto the right sound."
)

# Uploads longer than this are trimmed to the first PROMPT_TRIM_SECONDS:
# the model conditions on ~3-10s; extra minutes only cost memory/time and
# dilute similarity.
PROMPT_TRIM_THRESHOLD_SECONDS = 12.0
PROMPT_TRIM_SECONDS = 10.0


def _is_valid_reference_wav(path) -> bool:
    try:
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return False
        with open(path, "rb") as f:
            return f.read(4) == b"RIFF"
    except OSError:
        return False


def _default_reference_path(language: str = "hi") -> Path:
    """Expected default-clip path WITHOUT side effects (no synthesis).

    Used for path comparisons so custom-voice runs never trigger a network
    Edge-TTS synthesis just to compare filenames (offline penalty).
    Hindi keeps the legacy filename for existing installs.
    """
    if (language or "hi") == "en":
        return get_assets_dir() / "default_reference_en.wav"
    return get_assets_dir() / "default_reference.wav"


def _default_reference_text(language: str = "hi") -> str:
    return DEFAULT_REFERENCE_TEXT_EN if (language or "hi") == "en" else DEFAULT_REFERENCE_TEXT


def _default_reference_edge_voice(language: str = "hi") -> str:
    return DEFAULT_REFERENCE_EDGE_VOICE_EN if (language or "hi") == "en" else DEFAULT_REFERENCE_EDGE_VOICE


def get_default_reference_voice(language: str = "hi") -> Path:
    language = "en" if (language or "hi") == "en" else "hi"
    assets_dir = get_assets_dir()
    if language == "hi":
        for candidate in (
            assets_dir / "default_reference.wav",
            assets_dir / "default_reference_voice.wav",
        ):
            if _is_valid_reference_wav(candidate):
                return candidate
            if candidate.exists():
                logger.warning(f"Default reference clip {candidate} is invalid; removing and regenerating.")
                try:
                    candidate.unlink()
                except OSError:
                    pass
        default_path = assets_dir / "default_reference.wav"
    else:
        default_path = assets_dir / "default_reference_en.wav"
        if _is_valid_reference_wav(default_path):
            return default_path
        if default_path.exists():
            logger.warning(f"Default reference clip {default_path} is invalid; removing and regenerating.")
            try:
                default_path.unlink()
            except OSError:
                pass
    try:
        _synthesize_default_reference_voice(default_path, language)
    except Exception as e:
        logger.error(f"Failed to create default reference voice: {e}")
        raise FileNotFoundError(
            "No default reference voice is available and it could not be generated "
            "automatically (network required for the one-time Edge-TTS setup clip). "
            "Please upload a reference voice clip in Settings > Voice Synthesis."
        ) from e
    return default_path


def _synthesize_default_reference_voice(dest: Path, language: str = "hi") -> None:
    """Synthesizes a default reference clip via Edge-TTS, 24 kHz mono WAV."""
    import subprocess

    from backend.core.config import get_ffmpeg_path, get_startupinfo, get_temp_dir

    ref_text = _default_reference_text(language)
    ref_voice = _default_reference_edge_voice(language)

    tmp_mp3 = get_temp_dir() / "dhvaani_default_reference_tmp.mp3"
    tmp_wav = get_temp_dir() / "dhvaani_default_reference_tmp.wav"
    tmp_mp3.unlink(missing_ok=True)
    tmp_wav.unlink(missing_ok=True)

    def _run_generate() -> None:
        import asyncio

        async def _generate() -> None:
            import edge_tts

            communicate = edge_tts.Communicate(ref_text, ref_voice)
            await communicate.save(str(tmp_mp3))

        try:
            asyncio.run(_generate())
        except RuntimeError as e:
            # Called from a thread with a running loop (e.g. MCP async host):
            # run the coroutine on a fresh loop in a helper thread instead.
            if "already running" not in str(e).lower() and "cannot be called" not in str(e).lower():
                raise
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                ex.submit(lambda: asyncio.run(_generate())).result()

    try:
        _run_generate()

        if not tmp_mp3.exists() or tmp_mp3.stat().st_size == 0:
            raise RuntimeError("Edge-TTS produced no audio for the default reference clip.")

        cmd = [get_ffmpeg_path(), "-y", "-i", str(tmp_mp3), "-ar", str(PROMPT_SAMPLE_RATE), "-ac", "1", str(tmp_wav)]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, startupinfo=get_startupinfo())
        if result.returncode != 0:
            err_msg = result.stderr.decode("utf-8", errors="ignore")
            raise RuntimeError(f"ffmpeg conversion of default reference clip failed: {err_msg[-300:]}")

        if not tmp_wav.exists() or tmp_wav.stat().st_size == 0:
            raise RuntimeError("Converted default reference clip is empty.")
        with open(tmp_wav, "rb") as f:
            if f.read(4) != b"RIFF":
                raise RuntimeError("Converted default reference clip is not a valid WAV file.")

        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_wav, dest)
        logger.info(f"Default reference voice created at {dest}")
    finally:
        tmp_mp3.unlink(missing_ok=True)
        tmp_wav.unlink(missing_ok=True)


def get_legacy_omnivoice_size() -> float:
    """Size of retired OmniVoice weights in MB (0 when already cleaned)."""
    d = get_models_dir() / "omnivoice"
    if not d.exists():
        return 0.0
    try:
        total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
        return total / (1024 * 1024)
    except OSError:
        return 0.0


def remove_legacy_omnivoice_files() -> float:
    """One-time migration: delete the retired OmniVoice weights (~3GB).

    Called after a successful DhVaani download — the old engine is gone, so
    its snapshot is dead weight. Also exposed via bridge for a manual
    Settings reclaim button so Edge-only users are not stuck. Returns
    reclaimed MB.
    """
    return _remove_legacy_omnivoice_files()


def _remove_legacy_omnivoice_files() -> float:
    reclaimed_mb = 0.0
    d = get_models_dir() / "omnivoice"
    if d.exists():
        try:
            total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            shutil.rmtree(d, ignore_errors=True)
            reclaimed_mb = total / (1024 * 1024)
            logger.info(f"Removed retired OmniVoice model files ({reclaimed_mb:.0f} MB reclaimed).")
        except Exception as e:
            logger.warning(f"Could not remove retired OmniVoice files: {e}")
    return reclaimed_mb


# ── Model loading ──

def _ensure_snapshot_on_path():
    """Puts the snapshot (dhvaani.py + vendored _backend) on sys.path once."""
    global _dhvaani_paths_added
    if _dhvaani_paths_added:
        return
    model_dir = get_dhvaani_dir()
    for p in (str(model_dir), str(model_dir / "_backend")):
        if p not in sys.path:
            sys.path.insert(0, p)
    _dhvaani_paths_added = True


def _ensure_optional_inference_deps():
    """Stub training-only imports the vendored snapshot needs at import time.

    Upstream `_backend/zipvoice/utils/common.py` does
    `from torch.utils.tensorboard import SummaryWriter` unconditionally.
    `SummaryWriter` is never used during inference, but `torch`'s shim does
    `import tensorboard` internally, so a slim install (tensorboard excluded
    from the frozen build on purpose) fails the whole `from dhvaani import
    DhVaani` with `ModuleNotFoundError: No module named 'tensorboard'`.
    Pre-installing light stubs keeps the installer slim and lets inference
    import succeed. Real tensorboard, when present, is left untouched.
    """
    import sys as _sys

    try:
        import torch.utils.tensorboard  # noqa: F401
        return
    except Exception:
        pass
    try:
        import types as _types

        class _DummySummaryWriter:
            def __init__(self, *args, **kwargs):
                pass

            def __getattr__(self, _name):
                def _noop(*args, **kwargs):
                    return None

                return _noop

        _tb_shim = _types.ModuleType("torch.utils.tensorboard")
        _tb_shim.SummaryWriter = _DummySummaryWriter
        _sys.modules.setdefault("torch.utils.tensorboard", _tb_shim)
        # torch's shim also does `import tensorboard` internally on some
        # versions — stub the top-level name too so that path can't fail.
        if "tensorboard" not in _sys.modules:
            try:
                import tensorboard  # noqa: F401
            except Exception:
                _sys.modules["tensorboard"] = _types.ModuleType("tensorboard")
        logger.info("tensorboard not installed — using dummy SummaryWriter for DhVaani inference (training-only, unused).")
    except Exception as e:
        logger.warning(f"Could not stub tensorboard for DhVaani import: {e}")


def _ensure_torchaudio_soundfile_fallback():
    """Route snapshot audio I/O through soundfile when torchcodec is broken.

    The vendored snapshot uses `torchaudio.load` (prompt clip) and
    `torchaudio.save` (synthesized chunk). torchaudio 2.11 defaults both to
    the torchcodec backend, which needs `libtorchcodec*.dll` + matching
    FFmpeg shared DLLs. Those fail inside the frozen build (see
    app_30240.log: FileNotFound for core8/5/4, WinError 1114 for custom
    ops6), while dev works because system FFmpeg/DLLs are present.

    Our clips are plain WAV (uploads normalized to 24k mono via ffmpeg,
    default reference likewise), so soundfile covers 100% of actual I/O
    with no native DLLs. This wrapper tries native torchaudio first (dev
    keeps original behavior) and falls back to soundfile per call.

    The broken-backend decision is cached per operation: production logs show
    the torchcodec failure itself is slow (tens of seconds of DLL probing per
    call), and the snapshot does load(prompt)+save(chunk) per chunk — without
    caching, a multi-chunk section pays that stall 2N times.
    """
    try:
        import torchaudio
    except Exception as e:
        logger.warning(f"torchaudio unavailable for soundfile fallback: {e}")
        return
    if getattr(torchaudio, "_narrato_sf_patched", False):
        return
    _orig_load = getattr(torchaudio, "load", None)
    _orig_save = getattr(torchaudio, "save", None)
    # Set after the first torchcodec failure: skip the slow native attempt
    # and go straight to soundfile on subsequent calls.
    _torchcodec_broken = {"load": False, "save": False}

    def _sf_load(uri, *args, **kwargs):
        if not _torchcodec_broken["load"] and callable(_orig_load):
            try:
                return _orig_load(uri, *args, **kwargs)
            except FileNotFoundError:
                raise
            except Exception:
                # NOTE: the exception string itself embeds torchcodec's full
                # 100-line DLL traceback — never interpolate it at INFO (it
                # spammed MBs into the log + UI stream per chunk). Detail goes
                # to DEBUG (file-only when NARRATO_FILE_LOG_LEVEL=DEBUG).
                _torchcodec_broken["load"] = True
                logger.info(
                    f"torchaudio.load via torchcodec failed; falling back to soundfile for {Path(uri).name} "
                    "(native backend disabled for the rest of this session)"
                )
                logger.debug("torchaudio.load torchcodec detail", exc_info=True)
        import soundfile as sf
        import torch

        data, sr = sf.read(str(uri), dtype="float32", always_2d=True)
        wav = torch.from_numpy(data.T).contiguous()
        return wav, sr

    def _sf_save(uri, src, sample_rate, *args, **kwargs):
        if not _torchcodec_broken["save"] and callable(_orig_save):
            try:
                return _orig_save(uri, src, sample_rate, *args, **kwargs)
            except Exception:
                _torchcodec_broken["save"] = True
                logger.info(
                    f"torchaudio.save via torchcodec failed; falling back to soundfile for {Path(uri).name} "
                    "(native backend disabled for the rest of this session)"
                )
                logger.debug("torchaudio.save torchcodec detail", exc_info=True)
        import soundfile as sf
        import torch

        if isinstance(src, torch.Tensor):
            arr = src.detach().cpu()
            if arr.dim() == 1:
                arr = arr.unsqueeze(0)
            np_arr = arr.transpose(0, 1).numpy() if arr.dim() == 2 else arr.numpy()
        else:
            np_arr = src
        sf.write(str(uri), np_arr, int(sample_rate))

    try:
        torchaudio.load = _sf_load  # type: ignore
        torchaudio.save = _sf_save  # type: ignore
        torchaudio._narrato_sf_patched = True  # type: ignore
    except Exception as e:
        logger.warning(f"Could not install torchaudio soundfile fallback: {e}")

def _load_dhvaani_model(cancel_event=None):
    """Loads and caches the DhVaani model. Thread-safe singleton.

    Cancel is honored at each step boundary (before the heavy import and
    before weights load). The blocking DhVaani(...) constructor itself can't
    be interrupted, so a cancel landing mid-construct still waits that one
    call out — but a cancel that arrives while queued or between steps no
    longer pays for a model load nobody will use.
    """
    global _dhvaani_model, _unload_timer, _dhvaani_paths_added

    def _check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")

    with _dhvaani_model_lock:
        if _unload_timer is not None:
            _unload_timer.cancel()
            _unload_timer = None

        if _dhvaani_model is not None:
            return _dhvaani_model

        _check_cancel()

        model_dir = get_dhvaani_dir()
        if not (model_dir / "model.safetensors").is_file():
            raise FileNotFoundError(
                "DhVaani model is not downloaded. Download it from "
                "Settings > Voice Synthesis before cloning."
            )
        _ensure_snapshot_on_path()

        # Device selection. Production (frozen) bundles CPU-only torch and
        # activates the Settings-downloaded CUDA runtime via sys.path — so CUDA
        # is valid only when that runtime manifest is valid AND torch reports
        # it active. Dev runs whatever torch pip installed, so there is no
        # manifest: trust torch.cuda.is_available() directly. (The old code
        # required manifest_valid() in both cases, which forced CPU in dev
        # even with a CUDA torch installed.)
        # Never force cuda: on small-VRAM machines that starves the display
        # compositor sharing the GPU and freezes the whole computer.
        device = "cpu"
        try:
            import torch

            from backend.core.config import is_production

            cuda_ok = torch.cuda.is_available()
            if cuda_ok:
                use_cuda = True
                if is_production():
                    from backend.core.gpu_runtime import manifest_valid

                    use_cuda = manifest_valid()
                if use_cuda:
                    device = None  # snapshot auto-pick -> cuda:0
            else:
                _maybe_auto_disable_gpu()
            if device == "cpu":
                try:
                    from backend.core.gpu_runtime import manifest_valid as _mv

                    logger.info(
                        "DhVaani device pick: cpu "
                        f"(torch={torch.__version__} cuda_available={cuda_ok} "
                        f"manifest_valid={_mv()} production={is_production()}). "
                        + (
                            "Dev install has CPU-only torch despite an NVIDIA GPU — "
                            "install the CUDA build (requirements.txt: torch+cu126) to use it."
                            if not cuda_ok
                            else "CUDA torch present but production runtime manifest invalid."
                        )
                    )
                except Exception:
                    pass
        except Exception:
            pass

        if device == "cpu":
            # Leave cores for the OS/UI: uncapped torch saturates every core
            # for minutes per chunk on CPU and the machine feels frozen.
            try:
                import torch as _torch_cap

                n = os.cpu_count() or 4
                _torch_cap.set_num_threads(max(1, min(4, n - 2 if n > 4 else n)))
                _torch_cap.set_num_interop_threads(1)
            except Exception:
                pass

        logger.info(
            f"Loading DhVaani model ({DHVAANI_HF_REPO}) on "
            f"{'cuda:0 (GPU runtime active)' if device is None else 'cpu'} ..."
        )
        _check_cancel()
        _ensure_optional_inference_deps()
        _ensure_torchaudio_soundfile_fallback()
        _check_cancel()
        try:
            from dhvaani import DhVaani
        except ImportError as e:
            # Distinguish a truly incomplete snapshot from a broken
            # dependency chain inside it (e.g. missing tensorboard). The old
            # message blamed dhvaani.py for every ImportError, which hid the
            # real cause in production logs.
            if not (model_dir / "dhvaani.py").is_file():
                raise RuntimeError(
                    "DhVaani snapshot is incomplete (dhvaani.py missing). "
                    "Delete and re-download the model from Settings > Voice Synthesis."
                ) from e
            raise RuntimeError(
                f"DhVaani import failed ({e}). The snapshot files are present, "
                f"so this is a missing dependency, not a bad download. See the "
                f"chained ModuleNotFoundError above."
            ) from e

        _check_cancel()
        _dhvaani_model = DhVaani(str(model_dir), device=device)
        try:
            logger.info(f"DhVaani model loaded (device={_dhvaani_model.device})")
        except Exception:
            logger.info("DhVaani model loaded")
        return _dhvaani_model


# ── Prompt transcription (exact prompt_text is required) ──

def _clip_hash(speaker_wav: str) -> str:
    """Full content hash bound to stat (detects in-place re-recordings)."""
    h = hashlib.sha256()
    try:
        st = os.stat(speaker_wav)
        h.update(f"{st.st_size}:{st.st_mtime_ns}".encode())
    except OSError:
        pass
    h.update(str(speaker_wav).encode())
    try:
        with open(speaker_wav, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
    except OSError:
        pass
    return h.hexdigest()[:16]


def _transcript_sidecar(speaker_wav: str) -> Path:
    return Path(str(speaker_wav) + ".txt")


def _transcript_sidecar_meta(speaker_wav: str) -> Path:
    return Path(str(speaker_wav) + ".txt.meta")


def _read_valid_sidecar(speaker_wav: str) -> str | None:
    """Returns cached transcript only if the clip hasn't changed since caching."""
    sidecar = _transcript_sidecar(speaker_wav)
    try:
        if not sidecar.is_file():
            return None
        text = sidecar.read_text(encoding="utf-8").strip()
        if not text:
            return None
    except OSError:
        return None
    meta_path = _transcript_sidecar_meta(speaker_wav)
    try:
        if meta_path.is_file():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            try:
                st = os.stat(speaker_wav)
            except OSError:
                return None
            if meta.get("size") != st.st_size or meta.get("mtime_ns") != st.st_mtime_ns:
                logger.info(f"Prompt transcript cache stale for {Path(speaker_wav).name} (clip re-recorded); re-transcribing.")
                return None
            if meta.get("hash") and meta.get("hash") != _clip_hash(speaker_wav):
                logger.info(f"Prompt transcript cache hash mismatch for {Path(speaker_wav).name}; re-transcribing.")
                return None
        # Legacy sidecar without meta: accept once, then seal it with meta so
        # future re-recordings invalidate correctly.
        _write_sidecar(speaker_wav, text)
        return text
    except Exception as e:
        logger.warning(f"Could not validate prompt transcript cache: {e}")
        return text


def _write_sidecar(speaker_wav: str, text: str) -> None:
    try:
        _transcript_sidecar(speaker_wav).write_text(text.strip(), encoding="utf-8")
    except OSError as e:
        logger.warning(f"Could not cache prompt transcript: {e}")
        return
    try:
        st = os.stat(speaker_wav)
        _transcript_sidecar_meta(speaker_wav).write_text(
            json.dumps({"size": st.st_size, "mtime_ns": st.st_mtime_ns, "hash": _clip_hash(speaker_wav)}),
            encoding="utf-8",
        )
    except OSError as e:
        logger.warning(f"Could not write prompt transcript meta: {e}")


def _resolve_prompt_text(
    speaker_wav: str, ref_text: str | None, language: str | None = None, cancel_event=None
) -> str | None:
    """Returns the exact transcript of the prompt clip.

    Order: explicit ref_text > <clip>.txt sidecar (mtime-validated) >
    local faster-whisper. Default reference clips always resolve to their
    known Edge-TTS text without touching the network.
    """
    if ref_text and str(ref_text).strip():
        return str(ref_text).strip()
    try:
        # No-synthesis comparison: never generate a default clip just to
        # compare paths for a custom voice (offline penalty).
        resolved = Path(speaker_wav).resolve()
        if resolved == _default_reference_path("en").resolve():
            return DEFAULT_REFERENCE_TEXT_EN
        if resolved == _default_reference_path("hi").resolve():
            return DEFAULT_REFERENCE_TEXT
    except Exception:
        pass
    cached = _read_valid_sidecar(speaker_wav)
    if cached:
        return cached
    text = _transcribe_prompt_clip(speaker_wav, language, cancel_event)
    if text:
        _write_sidecar(speaker_wav, text)
    return text


def _transcribe_prompt_clip(speaker_wav: str, language: str | None = None, cancel_event=None) -> str | None:
    """Transcribes a prompt clip using a local faster-whisper model."""
    try:
        from backend.pipeline.transcribe import (
            download_whisper_model_files,
            get_best_downloaded_whisper_model,
            get_whisper_model,
            get_whisper_model_path,
        )
    except Exception as e:
        logger.warning(f"faster-whisper transcription unavailable: {e}")
        return None

    def _find_local():
        try:
            if get_whisper_model_path(REF_TRANSCRIBE_MODEL):
                return REF_TRANSCRIBE_MODEL
        except Exception:
            pass
        try:
            best = get_best_downloaded_whisper_model(fallback="")
            if best and get_whisper_model_path(best):
                return best
        except Exception:
            pass
        return None

    chosen = _find_local()
    if chosen is None:
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")
        try:
            logger.info(
                f"No local faster-whisper model found — downloading '{REF_TRANSCRIBE_MODEL}' once "
                f"(~1.5GB, one-time; or enter the clip transcript manually to skip this)..."
            )
            download_whisper_model_files(
                REF_TRANSCRIBE_MODEL,
                progress_callback=lambda p: logger.info(f"Whisper '{REF_TRANSCRIBE_MODEL}' download: {p:.0f}%"),
                cancel_event=cancel_event,
            )
        except InterruptedError:
            raise
        except Exception as e:
            logger.warning(
                f"Whisper '{REF_TRANSCRIBE_MODEL}' download failed: {e}. "
                "Enter the prompt transcript manually on the voice profile to skip transcription."
            )
            return None
        chosen = _find_local()
        if chosen is None:
            return None
    try:
        fw_model = get_whisper_model(chosen, device="cpu")
    except Exception as e:
        logger.warning(f"Could not load faster-whisper model '{chosen}': {e}")
        return None
    try:
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")
        lang_hint = language if language in ("hi", "en") else None
        segments, _info = fw_model.transcribe(str(speaker_wav), language=lang_hint, beam_size=5)
        text = " ".join((seg.text or "").strip() for seg in segments).strip()
        if text:
            logger.info(f"Prompt clip transcribed with faster-whisper '{chosen}': {text[:80]}")
            return text
        return None
    except InterruptedError:
        raise
    except Exception as e:
        logger.warning(f"faster-whisper transcription of prompt clip failed: {e}")
        return None
    finally:
        # faster-whisper/CTranslate2 holds sizable native arenas that `del`
        # alone does not promptly return. Drop the ref and force a collection
        # so the ~GB-scale turbo model is actually released before the
        # DhVaani model is loaded (never hold both at once).
        try:
            del fw_model
        except Exception:
            pass
        try:
            import gc as _gc

            _gc.collect()
        except Exception:
            pass


# ── Text prep ──

def _chunk_text_for_dhvaani(text: str) -> list[str]:
    """Splits text into sentence-level chunks (keeps GPU memory bounded)."""
    raw_chunks = re.split(r"(?<=[.!?।\n])\s+", text.strip())
    chunks: list[str] = []
    for c in raw_chunks:
        if len(c.split()) > 80:
            sub_chunks = re.split(r"(?<=[,;])\s+", c)
            for sc in sub_chunks:
                if len(sc.split()) > 80:
                    words = sc.split()
                    for i in range(0, len(words), 80):
                        chunks.append(" ".join(words[i:i + 80]))
                else:
                    chunks.append(sc)
        else:
            chunks.append(c)
    merged: list[str] = []
    current = ""
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        if len(current.split()) + len(chunk.split()) < 80:
            current = (current + " " + chunk).strip() if current else chunk
        else:
            if current:
                merged.append(current)
            current = chunk
    if current:
        merged.append(current)
    return merged if merged else [text]


def _decimal_to_words(int_part: str, frac_part: str, language: str) -> str | None:
    """Words for a decimal like 3.5 (None = leave digits as-is)."""
    try:
        import num2words as _n2w_mod

        if language == "hi":
            try:
                from indic_numtowords import num2words as indic_n2w

                return (
                    f"{indic_n2w(int(int_part), lang='hi')} दशमलव "
                    f"{indic_n2w(int(frac_part), lang='hi')}"
                )
            except Exception:
                pass
        return (
            f"{_n2w_mod.num2words(int(int_part), lang='en')} point "
            f"{_n2w_mod.num2words(int(frac_part), lang='en')}"
        )
    except Exception:
        return None


def _normalize_numbers(text: str, language: str) -> str:
    """Normalizes Arabic numerals to words (Hindi via indic-numtowords)."""
    global _num2words_missing_logged, _indic_missing_logged

    def _decimal_repl(m):
        words = _decimal_to_words(m.group(1), m.group(2), language)
        return words if words is not None else m.group(0)

    def _repl(m):
        global _num2words_missing_logged, _indic_missing_logged
        num_str = m.group(0)
        try:
            try:
                import num2words as _n2w_mod
            except ImportError:
                if not _num2words_missing_logged:
                    _num2words_missing_logged = True
                    logger.warning("num2words missing — numbers left as digits. Install requirements to fix.")
                return num_str
            num = int(num_str)
            if language == "hi":
                try:
                    from indic_numtowords import num2words as indic_n2w

                    return str(indic_n2w(num, lang="hi"))
                except ImportError:
                    if not _indic_missing_logged:
                        _indic_missing_logged = True
                        logger.warning(
                            "indic-numtowords missing — Hindi numbers fall back to English words. "
                            "Install requirements to fix."
                        )
                except Exception:
                    pass
                try:
                    return str(_n2w_mod.num2words(num, lang="en"))
                except Exception:
                    return num_str
            try:
                return str(_n2w_mod.num2words(num, lang="en"))
            except Exception:
                return num_str
        except Exception:
            return num_str

    try:
        text = re.sub(r"(\d+)\.(\d+)", _decimal_repl, text)
        return re.sub(r"\d+", _repl, text)
    except Exception:
        return text


def _concat_with_crossfade(chunks: list, sample_rate: int, fade_ms: float = _CHUNK_CROSSFADE_MS):
    """Concatenates chunk waveforms with a short linear crossfade.

    Single preallocated output (no repeated np.concatenate in a loop, which
    copies the whole prefix per chunk — O(n^2) moves and ~2x peak RAM).
    """
    import numpy as np

    if not chunks:
        raise RuntimeError("DhVaani generated empty audio")
    normed = [np.asarray(c).reshape(-1).astype(np.float32, copy=False) for c in chunks]
    if len(normed) == 1:
        return np.array(normed[0], dtype=np.float32, copy=True)
    fade_n = max(1, int(sample_rate * fade_ms / 1000.0))
    # First pass: decide per-boundary overlap (0 when either side is too short)
    # and compute the exact output length so we allocate once.
    overlaps: list[int] = []
    total = len(normed[0])
    for prev, nxt in zip(normed[:-1], normed[1:]):
        ov = fade_n if (len(prev) >= fade_n and len(nxt) >= fade_n) else 0
        overlaps.append(ov)
        total += len(nxt) - ov
    out = np.empty(total, dtype=np.float32)
    out[:len(normed[0])] = normed[0]
    pos = len(normed[0])
    fade_out: np.ndarray | None = None
    fade_in: np.ndarray | None = None
    for nxt, ov in zip(normed[1:], overlaps):
        if ov:
            if fade_out is None or len(fade_out) != ov:
                fade_out = np.linspace(1.0, 0.0, ov, dtype=np.float32)
                fade_in = np.linspace(0.0, 1.0, ov, dtype=np.float32)
            assert fade_out is not None and fade_in is not None
            out[pos - ov:pos] = out[pos - ov:pos] * fade_out + nxt[:ov] * fade_in
            out[pos:pos + len(nxt) - ov] = nxt[ov:]
            pos += len(nxt) - ov
        else:
            out[pos:pos + len(nxt)] = nxt
            pos += len(nxt)
    return out


def _synthesize_chunk_loud(
    model, chunk: str, speaker_wav: str, prompt_text: str, tmp_path: Path,
    num_step: int, speed: float, seed: int,
) -> None:
    """One chunk with a single deterministic retry on a fresh seed.

    A bad sampling draw must never silently drop a sentence: retry once with
    seed+1000, then raise with the chunk index so the pipeline fails loudly.
    """
    last_err: Exception | None = None
    for attempt, use_seed in enumerate((int(seed), int(seed) + 1000)):
        try:
            model.synthesize(
                text=chunk,
                prompt_wav=str(speaker_wav),
                prompt_text=prompt_text,
                out_path=str(tmp_path),
                num_step=int(num_step),
                guidance_scale=float(DHVAANI_GUIDANCE_DEFAULT),
                speed=float(speed),
                seed=int(use_seed),
            )
            if not tmp_path.is_file() or tmp_path.stat().st_size == 0:
                raise RuntimeError("DhVaani wrote no audio for chunk.")
            return
        except InterruptedError:
            raise
        except Exception as e:
            last_err = e
            logger.warning(f"DhVaani chunk synthesize attempt {attempt + 1} failed (seed={use_seed}): {e}")
    assert last_err is not None
    raise last_err


def generate_dhvaani_tts(
    text: str,
    output_path: str,
    speaker_wav: str = "",
    language: str = "hi",
    speed: float = 1.0,
    cancel_event=None,
    ref_text: str | None = None,
    num_step: int = DHVAANI_NUM_STEP_DEFAULT,
    seed: int = DHVAANI_SEED_DEFAULT,
) -> None:
    """Synthesizes speech using the cached DhVaani model.

    Args:
        text: The text to synthesize (27 Indian languages + English).
        output_path: Path to write the output .wav file (24kHz mono).
        speaker_wav: Prompt voice clip for cloning (3-10s ideal).
        language: Interface compat + number normalization + prompt
            transcription hint. DhVaani detects text language itself.
        speed: Speed factor (>1.0 faster, <1.0 slower).
        cancel_event: Optional threading.Event for chunk-granular abort.
        ref_text: Exact transcript of the prompt clip. When known, passing
            it avoids transcription entirely.
        num_step: Sampling steps (demo default 16, max 32).
        seed: Sampling seed; chunk i uses seed+i, so retries with a new
            seed deterministically re-draw a bad sample.
    """
    import numpy as np
    import soundfile as sf

    global _active_requests, _unload_timer

    def _check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")

    if not (text or "").strip():
        raise RuntimeError("DhVaani received empty text — nothing to synthesize.")

    with _dhvaani_model_lock:
        _active_requests += 1
        if _unload_timer is not None:
            _unload_timer.cancel()
            _unload_timer = None

    # Serialize inference across pipeline + preview threads.
    _dhvaani_synth_lock.acquire()
    try:
        _check_cancel()

        if not speaker_wav or not Path(speaker_wav).exists():
            speaker_wav = str(get_default_reference_voice(language))
            if not Path(speaker_wav).exists():
                raise FileNotFoundError(
                    "No prompt voice file found. Please upload a reference voice clip "
                    "in Settings > Voice Synthesis, or ensure the default reference voice exists."
                )

        # Resolve the prompt transcript BEFORE loading DhVaani: transcription
        # may load a ~GB-scale faster-whisper model. Loading it first, then
        # releasing it (see _transcribe_prompt_clip finally: del + gc), keeps
        # peak RAM to one model at a time instead of whisper + DhVaani + torch
        # simultaneously (which freezes low-RAM machines).
        prompt_text = _resolve_prompt_text(speaker_wav, ref_text, language, cancel_event)
        if not prompt_text:
            raise RuntimeError(
                "Could not determine the transcript of the prompt voice clip "
                f"({speaker_wav}). DhVaani needs the exact words spoken in the clip — "
                "enter them as the profile's transcript or use the default voice."
            )
        try:
            import gc as _gc

            _gc.collect()
        except Exception:
            pass
        _check_cancel()
        model = _load_dhvaani_model(cancel_event)
        _check_cancel()

        logger.info(
            f"Generating DhVaani TTS. Prompt: {Path(speaker_wav).name}, "
            f"speed={speed}, num_step={num_step}, seed={seed}"
        )

        cleaned_text = re.sub(r"[*#_`~>]", "", text)
        cleaned_text = re.sub(r"\.{2,}", ",", cleaned_text)
        cleaned_text = _normalize_numbers(cleaned_text, language)

        chunks = _chunk_text_for_dhvaani(cleaned_text)
        # Drop empties up front; an all-empty result is a caller bug.
        chunks = [c for c in chunks if c and c.strip()]
        if not chunks:
            raise RuntimeError("DhVaani received empty text after cleaning — nothing to synthesize.")
        logger.info(f"Synthesizing {len(chunks)} chunks with DhVaani...")

        import torch
        import uuid as _uuid

        from backend.core.config import get_temp_dir

        # One-time heavy import (librosa pulls numba/sklearn: tens of seconds
        # cold in the frozen build). Log it so the gap before chunk 1 never
        # looks like a hang, and so it can't be mistaken for stuck inference.
        logger.info("DhVaani: preparing audio backend (one-time, may take a few seconds)...")
        try:
            import librosa

            _has_librosa = True
        except Exception:
            _has_librosa = False

        all_samples = []
        failures: list[str] = []
        with torch.no_grad():
            for i, chunk in enumerate(chunks):
                _check_cancel()
                logger.info(f"DhVaani chunk {i + 1}/{len(chunks)} ({len(chunk.split())} words)...")
                import time as _chunk_time

                _chunk_start = _chunk_time.monotonic()
                # Plain path (no mkstemp): mkstemp returns an open OS fd that
                # must be os.close()d — discarding it leaks one fd per chunk
                # and the open handle blocks rewrite/delete on Windows.
                tmp = get_temp_dir() / f"dhvaani_chunk_{_uuid.uuid4().hex}.wav"
                try:
                    try:
                        _synthesize_chunk_loud(
                            model, chunk, speaker_wav, prompt_text, tmp,
                            num_step=int(num_step), speed=float(speed), seed=int(seed) + i,
                        )
                    except InterruptedError:
                        raise
                    except Exception as e:
                        # Fail loudly: a missing sentence must never pass as
                        # a complete voiceover with only a log warning.
                        failures.append(f"chunk {i + 1}/{len(chunks)}: {e}")
                        raise RuntimeError(
                            f"DhVaani failed on chunk {i + 1}/{len(chunks)} "
                            f"'{chunk[:60]}...': {e}"
                        ) from e
                    _check_cancel()
                    wav, sr = sf.read(str(tmp), dtype="float32")
                    wav = np.asarray(wav).reshape(-1)
                    if sr != DHVAANI_SAMPLE_RATE:
                        if _has_librosa:
                            wav = librosa.resample(wav, orig_sr=sr, target_sr=DHVAANI_SAMPLE_RATE)
                        else:
                            raise RuntimeError(
                                f"DhVaani chunk sample rate {sr} != {DHVAANI_SAMPLE_RATE} "
                                "and librosa is unavailable to resample. Install librosa."
                            )
                    all_samples.append(wav)
                    # Drop local refs to the just-read buffer; the list keeps
                    # the only copy. Keeps per-iteration temporaries (resample
                    # output, file buffer) from piling up across chunks.
                    del wav
                    logger.info(
                        f"DhVaani chunk {i + 1}/{len(chunks)} done "
                        f"in {_chunk_time.monotonic() - _chunk_start:.1f}s."
                    )
                finally:
                    try:
                        tmp.unlink(missing_ok=True)
                    except OSError:
                        pass
                # Release per-chunk torch scratch (CUDA fragmentation on small
                # GPUs) and numpy temporaries so a long section's peak stays
                # flat instead of growing per chunk.
                try:
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass
                if (i + 1) % 4 == 0:
                    try:
                        import gc as _gc

                        _gc.collect()
                    except Exception:
                        pass

        _check_cancel()
        if not all_samples:
            raise RuntimeError("DhVaani generated empty audio" + (f" ({failures[0]})" if failures else ""))
        try:
            final = _concat_with_crossfade(all_samples, DHVAANI_SAMPLE_RATE)
        finally:
            # The joined copy is the only thing kept from here on — release
            # the per-chunk buffers immediately (halves peak vs holding both).
            try:
                all_samples.clear()
            except Exception:
                pass
            try:
                import gc as _gc2

                _gc2.collect()
            except Exception:
                pass
        try:
            sf.write(output_path, final, DHVAANI_SAMPLE_RATE)
        finally:
            try:
                del final
            except Exception:
                pass
            try:
                import gc as _gc3

                _gc3.collect()
            except Exception:
                pass
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        logger.info(f"DhVaani TTS output written to {output_path}")

    finally:
        try:
            _dhvaani_synth_lock.release()
        except RuntimeError:
            pass
        with _dhvaani_model_lock:
            _active_requests -= 1
            if _active_requests == 0:
                _reset_unload_timer()
