"""
XTTS v2 — Voice Cloning TTS Module (compat shim).

XTTS v2 (coqui-TTS) has been replaced by OmniVoice
(https://github.com/k2-fsa/OmniVoice, `k2-fsa/OmniVoice` on HF) for
English + Hindi voice cloning quality, speed, and language coverage.

This module is kept so existing imports (`from backend.xtts import
generate_xtts_tts, check_xtts_model, ...`) keep working: every symbol
delegates to `backend.omnivoice_tts`. The `tts_engine` value stored in
settings/DB stays `"xtts"` (displayed as "OmniVoice" in the UI), so no
data migration is needed.

For new code, import from `backend.omnivoice_tts` directly.
"""

from backend.omnivoice_tts import (  # noqa: F401
    DEFAULT_REFERENCE_EDGE_VOICE,
    DEFAULT_REFERENCE_TEXT,
    OMNIVOICE_HF_REPO as XTTS_HF_REPO,
    OMNIVOICE_NUM_STEP_DEFAULT,
    OMNIVOICE_SAMPLE_RATE,
    check_omnivoice_model as check_xtts_model,
    delete_omnivoice_model as delete_xtts_model,
    download_omnivoice_model as download_xtts_model,
    generate_omnivoice_tts as generate_xtts_tts,
    get_default_reference_voice,
    get_omnivoice_dir as get_xtts_dir,
)

# Legacy constant (old per-file list no longer used; kept for import compat).
XTTS_MODEL_FILES = ["model.safetensors", "config.json", ".omnivoice_complete"]


def _chunk_text_for_xtts(text: str) -> list[str]:
    from backend.omnivoice_tts import _chunk_text_for_omnivoice
    return _chunk_text_for_omnivoice(text)


def _load_xtts_model():
    from backend.omnivoice_tts import _load_omnivoice_model
    return _load_omnivoice_model()


def _is_valid_reference_wav(path) -> bool:
    from backend.omnivoice_tts import _is_valid_reference_wav as _impl
    return _impl(path)
