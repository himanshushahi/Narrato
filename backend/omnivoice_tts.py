"""
OmniVoice — Voice Cloning TTS Module (replaces XTTS v2).

Upstream: https://github.com/k2-fsa/OmniVoice (`k2-fsa/OmniVoice` on HF).
Covers English + Hindi voice cloning in one unified model.

API shape (upstream README):
- Load: `OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=..., dtype=...)`
- Clone: `generate(text=..., ref_audio=..., ref_text=...)` -> list[np.ndarray] @ 24kHz
- Reuse: `create_voice_clone_prompt(...)` -> `save("my_voice.pt")` -> `VoiceClonePrompt.load(...)`
- Perf knobs: `num_step` (32 quality / 16 fast), `speed`, `duration`

This module is the single voice-cloning backend. The pipeline
(`backend/pipeline/tts.py`) and bridge (`backend/core/bridge.py`) use:
  check_omnivoice_model / download_omnivoice_model / delete_omnivoice_model /
  generate_omnivoice_tts / get_omnivoice_dir / get_default_reference_voice
"""

import hashlib
import os
import re
import shutil
import threading
from pathlib import Path

from backend.core.config import get_assets_dir, get_models_dir
from backend.core.logger import logger

# Small-GPU fragmentation guard: must be set before the first CUDA allocation
# (torch is imported lazily below, so module import time is early enough).
# Reduces "out of memory ... but unallocated memory is large" failures on
# 4-6GB cards. Respects a user-provided value if already set.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

OMNIVOICE_HF_REPO = "k2-fsa/OmniVoice"
OMNIVOICE_SAMPLE_RATE = 24000
# Sweet spot per upstream tips: 3-10s reference. Longer slows inference.
OMNIVOICE_NUM_STEP_DEFAULT = 16  # fast; use 32 for max quality
OMNIVOICE_NUM_STEP_QUALITY = 32

# Module-level model cache (singleton) to avoid reloading on every call
_omnivoice_model = None
_omnivoice_model_lock = threading.Lock()
_unload_timer = None
_active_requests = 0
# Whisper ASR (auto-transcription fallback) is loaded lazily — it is a
# separate ~1.6GB download (openai/whisper-large-v3-turbo) that is only
# needed when ref_text is unknown. Never load it at startup.
_asr_loaded = False
_asr_lock = threading.Lock()
# Serializes the one-time faster-whisper bootstrap download so concurrent
# previews don't download it twice.
_whisper_bootstrap_lock = threading.Lock()
# faster-whisper model used for reference-clip transcription. "turbo" is
# multilingual (covers en + hi) — same model the Settings UI downloads.
REF_TRANSCRIBE_MODEL = "turbo"


def _unload_omnivoice_model():
    global _omnivoice_model, _unload_timer, _asr_loaded
    with _omnivoice_model_lock:
        if _omnivoice_model is not None:
            logger.info("Unloading OmniVoice model due to 30s inactivity to free memory...")
            del _omnivoice_model
            _omnivoice_model = None
            _asr_loaded = False
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
    _unload_timer = threading.Timer(30.0, _unload_omnivoice_model)
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


def get_omnivoice_dir() -> Path:
    """Returns the local directory for OmniVoice model files."""
    d = get_models_dir() / "omnivoice"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_voice_prompt_cache_dir() -> Path:
    d = get_omnivoice_dir() / "voice_prompts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def check_omnivoice_model() -> bool:
    """Checks if the OmniVoice model snapshot exists locally.

    `from_pretrained` uses the HF hub cache / snapshot under our models dir.
    We consider the model present when the dir holds a model weight file or a
    completed snapshot marker.
    """
    d = get_omnivoice_dir()
    # Direct snapshot layout (snapshot_download with local_dir)
    for name in ("model.safetensors", "model.safetensors.index.json", "config.json", ".omnivoice_complete"):
        if (d / name).exists():
            # config alone is not enough; require weights unless complete marker
            if name in ("model.safetensors", ".omnivoice_complete"):
                return True
    # HF hub cache layout may nest under models--k2-fsa--OmniVoice
    for sub in d.glob("models--*"):
        if sub.is_dir() and list(sub.rglob("*.safetensors")):
            return True
    # Recursive fallback: any safetensors / pytorch bin under the dir
    for pat in ("*.safetensors", "*.bin", "*.pt"):
        try:
            if next(d.rglob(pat), None) is not None:
                return True
        except StopIteration:
            pass
    return False


def download_omnivoice_model(progress_callback=None) -> bool:
    """Downloads the OmniVoice model snapshot from HuggingFace Hub."""
    from huggingface_hub import snapshot_download

    dest = get_omnivoice_dir()
    logger.info(f"Downloading OmniVoice model snapshot: {OMNIVOICE_HF_REPO} -> {dest} (~3.3GB first run)")
    if progress_callback:
        progress_callback({"file": OMNIVOICE_HF_REPO, "progress": 5})
    snapshot_download(
        repo_id=OMNIVOICE_HF_REPO,
        local_dir=str(dest),
        local_dir_use_symlinks=False,
    )
    (dest / ".omnivoice_complete").write_text(OMNIVOICE_HF_REPO, encoding="utf-8")
    if progress_callback:
        progress_callback({"file": OMNIVOICE_HF_REPO, "progress": 100})
    logger.info("OmniVoice model snapshot downloaded successfully.")
    return True


def delete_omnivoice_model() -> bool:
    """Deletes local OmniVoice model files + cached voice prompts."""
    global _omnivoice_model, _unload_timer, _asr_loaded
    d = get_omnivoice_dir()
    deleted = False
    try:
        with _omnivoice_model_lock:
            _omnivoice_model = None
            _asr_loaded = False
            if _unload_timer is not None:
                _unload_timer.cancel()
                _unload_timer = None
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
            deleted = True
            d.mkdir(parents=True, exist_ok=True)
            logger.info("Deleted OmniVoice model files.")
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete OmniVoice model: {e}")
        return False


# ── Default reference voice (engine-agnostic) ──

DEFAULT_REFERENCE_EDGE_VOICE = "hi-IN-SwaraNeural"
DEFAULT_REFERENCE_TEXT = (
    "नमस्ते! यह आपकी डिफ़ॉल्ट आवाज़ है, जिसका उपयोग वीडियो निर्माण के लिए किया जाता है। "
    "आप चाहें तो सेटिंग्स में जाकर अपनी खुद की आवाज़ अपलोड कर सकते हैं। "
    "यह एक सरल और स्पष्ट उदाहरण है, ताकि आवाज़ की पहचान सही तरीके से हो सके।"
)


def _is_valid_reference_wav(path) -> bool:
    try:
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            return False
        with open(path, "rb") as f:
            return f.read(4) == b"RIFF"
    except OSError:
        return False


def get_default_reference_voice() -> Path:
    assets_dir = get_assets_dir()
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
    try:
        _synthesize_default_reference_voice(default_path)
    except Exception as e:
        logger.error(f"Failed to create default reference voice: {e}")
        raise FileNotFoundError(
            "No default reference voice is available and it could not be generated "
            "automatically (network required). Please upload a reference voice clip "
            "in Settings > Voice Synthesis."
        ) from e
    return default_path


def _synthesize_default_reference_voice(dest: Path) -> None:
    """Synthesizes a default reference clip via Edge-TTS, 22050 Hz mono WAV.

    OmniVoice accepts wav/mp3/flac at any sample rate, but we keep the same
    22050 Hz mono convention as before so existing clips keep working.
    """
    import asyncio
    import subprocess

    from backend.core.config import get_ffmpeg_path, get_startupinfo, get_temp_dir

    tmp_mp3 = get_temp_dir() / "omnivoice_default_reference_tmp.mp3"
    tmp_wav = get_temp_dir() / "omnivoice_default_reference_tmp.wav"
    tmp_mp3.unlink(missing_ok=True)
    tmp_wav.unlink(missing_ok=True)

    try:
        async def _generate() -> None:
            import edge_tts
            communicate = edge_tts.Communicate(DEFAULT_REFERENCE_TEXT, DEFAULT_REFERENCE_EDGE_VOICE)
            await communicate.save(str(tmp_mp3))
        asyncio.run(_generate())

        if not tmp_mp3.exists() or tmp_mp3.stat().st_size == 0:
            raise RuntimeError("Edge-TTS produced no audio for the default reference clip.")

        cmd = [get_ffmpeg_path(), "-y", "-i", str(tmp_mp3), "-ar", "22050", "-ac", "1", str(tmp_wav)]
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


# ── Model loading ──

def _resolve_device_map() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass
    return "cpu"


def _load_omnivoice_model():
    """Loads and caches the OmniVoice model. Thread-safe singleton."""
    global _omnivoice_model, _unload_timer

    with _omnivoice_model_lock:
        if _unload_timer is not None:
            _unload_timer.cancel()
            _unload_timer = None

        if _omnivoice_model is not None:
            return _omnivoice_model

        import torch
        from omnivoice import OmniVoice

        device_map = _resolve_device_map()
        if device_map == "cpu":
            _maybe_auto_disable_gpu()
            dtype = torch.float32
        else:
            dtype = torch.float16

        logger.info(f"Loading OmniVoice model ({OMNIVOICE_HF_REPO}) on {device_map} ...")
        # Prefer the in-app snapshot (models/omnivoice, downloaded via the
        # Settings UI) over the HF hub cache: upstream `_resolve_model_path`
        # returns local dirs as-is, so this avoids a duplicate ~3.3GB download
        # into the HF cache on first inference.
        snapshot = get_omnivoice_dir() / "model.safetensors"
        model_source = str(get_omnivoice_dir()) if snapshot.exists() else OMNIVOICE_HF_REPO
        # NOTE: load_asr=False here on purpose. The Whisper ASR model
        # (~1.6GB one-time download) is only needed for the auto-transcribe
        # fallback (ref_text unknown) and is loaded lazily via
        # _ensure_asr_model(). Loading it at startup stalls first use.
        try:
            model = OmniVoice.from_pretrained(
                model_source, device_map=device_map, dtype=dtype
            )
        except TypeError:
            # Older/newer signature drift: retry with minimal kwargs.
            model = OmniVoice.from_pretrained(model_source)
        logger.info(f"OmniVoice model loaded on {device_map}")
        _omnivoice_model = model
        return _omnivoice_model


# ── Voice prompt cache (avoids re-encoding + Whisper each call) ──

# ── Reference transcription via local faster-whisper ──
# NOTE: models/whisper/* (e.g. models/whisper/turbo) holds ctranslate2
# faster-whisper weights (model.bin), which OmniVoice's transformers-based
# ASR loader cannot read. Instead of downloading its ~1.6GB transformers
# Whisper, we transcribe short reference clips with faster-whisper and pass
# the result as explicit ref_text. Model lookup prefers an already-downloaded
# model and otherwise bootstrap-downloads faster-whisper "turbo" once via the
# existing whisper download machinery. All paths resolve via get_models_dir()
# (dev: project root/models, prod: %LOCALAPPDATA%/Narrato/models).

def _transcribe_reference_clip(
    speaker_wav: str, language: str | None = None, cancel_event=None
) -> str | None:
    """Transcribes a reference clip using a local faster-whisper model.

    Model resolution (all paths via get_models_dir(), dynamic per dev/prod):
    1. Use an already-downloaded model (turbo preferred, else best downloaded).
    2. Otherwise download faster-whisper "turbo" once via the existing
       whisper download machinery (multilingual, covers en + hi).
    3. If that fails, return None — the caller falls back to OmniVoice's
       own ASR download.
    """
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
        # Case 1: no whisper model on disk yet — bootstrap-download turbo once.
        # Serialized + double-checked so concurrent previews share one download.
        with _whisper_bootstrap_lock:
            chosen = _find_local()
            if chosen is None:
                logger.info(
                    f"No local faster-whisper model found — downloading '{REF_TRANSCRIBE_MODEL}' "
                    "once for reference-voice transcription..."
                )
                try:
                    download_whisper_model_files(
                        REF_TRANSCRIBE_MODEL,
                        progress_callback=lambda p: logger.info(
                            f"Whisper '{REF_TRANSCRIBE_MODEL}' download: {p:.0f}%"
                        ),
                        cancel_event=cancel_event,
                    )
                except InterruptedError:
                    raise
                except Exception as e:
                    logger.warning(f"Whisper '{REF_TRANSCRIBE_MODEL}' download failed: {e}")
                    return None
                chosen = _find_local()
                if chosen is None:
                    logger.warning(f"Whisper '{REF_TRANSCRIBE_MODEL}' download finished but model not found.")
                    return None
    try:
        fw_model = get_whisper_model(chosen, device="cpu")
    except Exception as e:
        logger.warning(f"Could not load faster-whisper model '{chosen}': {e}")
        return None
    try:
        lang_hint = language if language in ("hi", "en") else None
        segments, _info = fw_model.transcribe(str(speaker_wav), language=lang_hint, beam_size=5)
        text = " ".join((seg.text or "").strip() for seg in segments).strip()
        if text:
            logger.info(f"Reference clip transcribed with faster-whisper '{chosen}': {text[:80]}")
            return text
        logger.warning("faster-whisper returned an empty transcript for the reference clip.")
        return None
    except Exception as e:
        logger.warning(f"faster-whisper transcription of reference clip failed: {e}")
        return None
    finally:
        try:
            del fw_model
        except Exception:
            pass


def _resolve_ref_text(
    speaker_wav: str, ref_text: str | None, language: str | None = None, cancel_event=None
) -> str | None:
    """Returns an explicit transcript for the reference clip when possible.

    Explicit ref_text skips OmniVoice's Whisper auto-transcription (and its
    one-time ~1.6GB download) entirely.
    """
    if ref_text:
        return ref_text
    # Transcript cache: each unique clip is transcribed once ever — repeat
    # previews/pipeline runs reuse the stored text with zero ASR work.
    cached = _read_cached_transcript(speaker_wav)
    if cached:
        return cached
    text = _transcribe_reference_clip(speaker_wav, language, cancel_event)
    if text:
        _save_cached_transcript(speaker_wav, text)
    return text


def _ensure_asr_model(model) -> None:
    """Loads the Whisper ASR model once, only for auto-transcription.

    One-time ~1.6GB download (openai/whisper-large-v3-turbo). Called solely
    on the ref_text-unknown path so normal synthesis never pays for it.
    """
    global _asr_loaded
    with _asr_lock:
        if _asr_loaded:
            return
        try:
            already = getattr(model, "_asr_pipe", None) is not None
        except Exception:
            already = False
        if already:
            _asr_loaded = True
            return
        logger.info("Loading Whisper ASR for reference auto-transcription (one-time ~1.6GB download)...")
        model.load_asr_model()
        _asr_loaded = True

def _clip_hash(speaker_wav: str) -> str:
    """Stable identity of a reference clip: path + size + mtime + first MB."""
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
                break  # first MB is enough to disambiguate + cheap
    except OSError:
        pass
    return h.hexdigest()[:16]


def _read_cached_transcript(speaker_wav: str) -> str | None:
    """Returns the stored transcript for this clip, or None on cache miss."""
    p = get_voice_prompt_cache_dir() / f"transcript_{_clip_hash(speaker_wav)}.txt"
    try:
        if p.exists():
            text = p.read_text(encoding="utf-8").strip()
            if text:
                return text
    except OSError:
        pass
    return None


def _save_cached_transcript(speaker_wav: str, text: str) -> None:
    try:
        p = get_voice_prompt_cache_dir() / f"transcript_{_clip_hash(speaker_wav)}.txt"
        p.write_text(text.strip(), encoding="utf-8")
    except OSError as e:
        logger.warning(f"Could not cache reference transcript: {e}")


def _prompt_cache_key(speaker_wav: str, ref_text: str | None) -> str:
    h = hashlib.sha256()
    h.update(_clip_hash(speaker_wav).encode())
    h.update((ref_text or "").encode("utf-8"))
    return h.hexdigest()[:16]


def get_cached_voice_prompt(speaker_wav: str, ref_text: str | None = None, language: str | None = None, cancel_event=None):
    """Returns a cached VoiceClonePrompt for this speaker, creating it on miss.

    Returns None when the installed `omnivoice` version has no prompt API —
    callers then fall back to plain ref_audio/ref_text synthesis.
    """
    try:
        from omnivoice import VoiceClonePrompt
    except Exception:
        return None
    # Prefer an explicit transcript (local faster-whisper) so OmniVoice never
    # needs its own ~1.6GB Whisper download; transformers ASR is last resort.
    ref_text = _resolve_ref_text(speaker_wav, ref_text, language, cancel_event)
    key = _prompt_cache_key(speaker_wav, ref_text)
    cached = get_voice_prompt_cache_dir() / f"voice_{key}.pt"
    if cached.exists():
        try:
            return VoiceClonePrompt.load(str(cached))
        except Exception as e:
            logger.warning(f"Voice prompt cache unreadable, re-encoding: {e}")
    try:
        model = _load_omnivoice_model()
        kwargs = {"ref_audio": speaker_wav}
        if ref_text:
            kwargs["ref_text"] = ref_text
        else:
            _ensure_asr_model(model)
        # Drop cached-but-unallocated GPU blocks before encoding: on 4GB cards
        # fragmentation alone can OOM the prompt encoding spike.
        _empty_cuda_cache()
        try:
            prompt = model.create_voice_clone_prompt(**kwargs)
        except RuntimeError as e:
            if "out of memory" not in str(e).lower():
                raise
            logger.warning(f"Voice prompt encoding OOM, clearing cache and retrying once: {e}")
            _empty_cuda_cache()
            try:
                prompt = model.create_voice_clone_prompt(**kwargs)
            except RuntimeError as e2:
                raise RuntimeError(
                    "GPU out of memory while encoding the reference voice. "
                    "Your GPU has limited VRAM — close other GPU apps and retry. "
                    f"({e2})"
                ) from e2
        try:
            prompt.save(str(cached))
        except Exception as e:
            logger.warning(f"Could not save voice prompt cache: {e}")
        return prompt
    except Exception as e:
        logger.warning(f"Voice prompt pre-encoding failed, will use ref_audio directly: {e}")
        return None


def _empty_cuda_cache() -> None:
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


# ── Text prep ──

def _chunk_text_for_omnivoice(text: str) -> list[str]:
    """Splits text into sentence-level chunks.

    OmniVoice (non-autoregressive diffusion) handles larger chunks,
    but very long scripts still benefit from sentence splitting.
    """
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


def _normalize_numbers(text: str, language: str) -> str:
    """Normalizes Arabic numerals to words (OmniVoice reads digits poorly).

    Prefers upstream `normalize_text=True` in `generate()` when the optional
    `omnivoice[tn]` extra is installed; this lightweight fallback covers the
    common integer case via num2words (Hindi via indic-numtowords).
    """
    def _repl(m):
        num_str = m.group(0)
        try:
            import num2words as _n2w_mod
            num = int(num_str)
            try:
                return str(_n2w_mod.num2words(num, lang=language if language in ("en", "hi") else "en"))
            except Exception:
                if language == "hi":
                    try:
                        from indic_numtowords import num2words as indic_n2w
                        return str(indic_n2w(num, lang="hi"))
                    except Exception:
                        pass
                return str(_n2w_mod.num2words(num, lang="en"))
        except Exception:
            return num_str
    try:
        return re.sub(r"\d+", _repl, text)
    except Exception:
        return text


def generate_omnivoice_tts(
    text: str,
    output_path: str,
    speaker_wav: str = "",
    language: str = "hi",
    speed: float = 1.0,
    cancel_event=None,
    ref_text: str | None = None,
    num_step: int = OMNIVOICE_NUM_STEP_DEFAULT,
) -> None:
    """Synthesizes speech using the cached OmniVoice model.

    Args:
        text: The text to synthesize (any of 600+ langs; en+hi covered).
        output_path: Path to write the output .wav file (24kHz mono).
        speaker_wav: Reference voice clip for cloning (3-10s ideal).
        language: Kept for interface compat + number normalization.
            OmniVoice auto-handles language from text (no language_idx).
        speed: Speed factor (>1.0 faster, <1.0 slower).
        cancel_event: Optional threading.Event for chunk-granular abort.
        ref_text: Transcription of the reference clip. When known, passing it
            avoids the Whisper auto-transcription download + latency.
        num_step: Diffusion steps (16 fast / 32 quality).
    """
    import numpy as np
    import soundfile as sf
    global _active_requests, _unload_timer

    def _check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")

    with _omnivoice_model_lock:
        _active_requests += 1
        if _unload_timer is not None:
            _unload_timer.cancel()
            _unload_timer = None

    try:
        _check_cancel()
        model = _load_omnivoice_model()
        _check_cancel()

        if not speaker_wav or not Path(speaker_wav).exists():
            speaker_wav = str(get_default_reference_voice())
            if not Path(speaker_wav).exists():
                raise FileNotFoundError(
                    "No reference voice file found. Please upload a reference voice clip "
                    "in Settings > Voice Synthesis, or ensure the default reference voice exists."
                )

        logger.info(f"Generating OmniVoice TTS. Speaker: {Path(speaker_wav).name}, speed={speed}, num_step={num_step}")

        cleaned_text = re.sub(r"[*#_`~>]", "", text)
        cleaned_text = re.sub(r"\.{2,}", ",", cleaned_text)
        cleaned_text = _normalize_numbers(cleaned_text, language)

        chunks = _chunk_text_for_omnivoice(cleaned_text)
        logger.info(f"Synthesizing {len(chunks)} chunks with OmniVoice...")

        # Resolve an explicit transcript first (local faster-whisper): this
        # lets every path below skip OmniVoice's Whisper auto-transcription
        # download. Transformers ASR remains a last resort when nothing local
        # can transcribe.
        ref_text = _resolve_ref_text(speaker_wav, ref_text, language, cancel_event)

        # Reuse a cached voice prompt when the backend supports it (skips
        # per-call audio re-encoding + Whisper transcription).
        voice_prompt = get_cached_voice_prompt(speaker_wav, ref_text, language, cancel_event)
        if voice_prompt is None and not ref_text:
            # Direct ref_audio path will auto-transcribe inside generate().
            _ensure_asr_model(model)

        import torch
        _empty_cuda_cache()
        all_samples = []
        with torch.no_grad():
            for i, chunk in enumerate(chunks):
                _check_cancel()
                if not chunk.strip():
                    continue
                try:
                    kwargs: dict = {"text": chunk, "speed": float(speed), "num_step": int(num_step)}
                    # Prefer normalize_text when the optional TN extra is present.
                    try:
                        import importlib.util
                        if importlib.util.find_spec("wetext") is not None or importlib.util.find_spec("we_text_processing") is not None:
                            kwargs["normalize_text"] = True
                    except Exception:
                        pass
                    if voice_prompt is not None:
                        kwargs["voice_clone_prompt"] = voice_prompt
                    else:
                        kwargs["ref_audio"] = speaker_wav
                        if ref_text:
                            kwargs["ref_text"] = ref_text
                    try:
                        out = model.generate(**kwargs)
                    except TypeError:
                        # Signature drift / missing normalize_text support: retry minimal.
                        out = model.generate(
                            text=chunk,
                            **({"voice_clone_prompt": voice_prompt} if voice_prompt is not None else {"ref_audio": speaker_wav, **({"ref_text": ref_text} if ref_text else {})}),
                            speed=float(speed),
                        )
                    wav = out[0] if isinstance(out, (list, tuple)) else out
                    if hasattr(wav, "cpu"):
                        wav = wav.cpu().numpy()
                    all_samples.append(np.asarray(wav).reshape(-1))
                except InterruptedError:
                    raise
                except Exception as e:
                    logger.warning(f"OmniVoice failed on chunk {i+1} '{chunk[:40]}...': {e}")

        _check_cancel()
        if all_samples:
            final = np.concatenate(all_samples)
            sf.write(output_path, final, OMNIVOICE_SAMPLE_RATE)
            logger.info(f"OmniVoice TTS output written to {output_path}")
        else:
            raise RuntimeError("OmniVoice generated empty audio")

    finally:
        with _omnivoice_model_lock:
            _active_requests -= 1
            if _active_requests == 0:
                _reset_unload_timer()
