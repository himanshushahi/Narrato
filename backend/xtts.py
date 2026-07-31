"""
XTTS v2 Hindi Finetuned — Voice Cloning TTS Module

Uses the Abhinay45/XTTS-Hindi-finetuned model from HuggingFace for
high-quality Hindi/English TTS with voice cloning from a reference audio clip.
"""

import os
import re
import uuid
import torch
import torchaudio

def _patched_torchaudio_load(filepath, *args, **kwargs):
    import soundfile as sf
    audio, sr = sf.read(filepath, dtype='float32')
    tensor = torch.FloatTensor(audio)
    if len(tensor.shape) == 1:
        tensor = tensor.unsqueeze(0)
    else:
        tensor = tensor.transpose(0, 1)
    return tensor, sr

def _patched_torchaudio_info(filepath, *args, **kwargs):
    import soundfile as sf
    info = sf.info(filepath)
    class AudioMetaData:
        sample_rate = info.samplerate
        num_frames = info.frames
        num_channels = info.channels
    return AudioMetaData()

torchaudio.load = _patched_torchaudio_load
torchaudio.info = _patched_torchaudio_info

import soundfile as sf
import num2words
original_num2words = num2words.num2words
def patched_num2words(number, lang='en', **kwargs):
    try:
        return original_num2words(number, lang=lang, **kwargs)
    except NotImplementedError:
        return original_num2words(number, lang='en', **kwargs)
num2words.num2words = patched_num2words

import shutil
import threading
from pathlib import Path

from backend.core.config import get_models_dir, get_temp_dir
from backend.core.logger import logger

# Accept Coqui TOS automatically so it doesn't block in headless/automated contexts
os.environ["COQUI_TOS_AGREED"] = "1"

XTTS_HF_REPO = "Abhinay45/XTTS-Hindi-finetuned"
XTTS_MODEL_FILES = ["model.pth", "config.json", "vocab.json"]

# Module-level model cache (singleton) to avoid reloading on every call
_xtts_model = None
_xtts_model_lock = threading.Lock()


def get_xtts_dir() -> Path:
    """Returns the local directory for XTTS model files."""
    xtts_dir = get_models_dir() / "xtts"
    xtts_dir.mkdir(parents=True, exist_ok=True)
    return xtts_dir


DEFAULT_REFERENCE_EDGE_VOICE = "hi-IN-SwaraNeural"
DEFAULT_REFERENCE_TEXT = (
    "नमस्ते! यह आपकी डिफ़ॉल्ट आवाज़ है, जिसका उपयोग वीडियो निर्माण के लिए किया जाता है। "
    "आप चाहें तो सेटिंग्स में जाकर अपनी खुद की आवाज़ अपलोड कर सकते हैं। "
    "यह एक सरल और स्पष्ट उदाहरण है, ताकि आवाज़ की पहचान सही तरीके से हो सके।"
)


def get_default_reference_voice() -> Path:
    """Returns path to the bundled default reference voice clip.

    If no default clip exists on disk yet, it is synthesized once via Edge-TTS
    and cached in the assets directory, so XTTS voice cloning works out of the
    box without an upload. Raises FileNotFoundError if it cannot be created
    (e.g. no network) — the caller should then ask the user to upload a clip.
    """
    project_root = Path(__file__).resolve().parent.parent
    for candidate in (
        project_root / "assets" / "default_reference.wav",
        project_root / "assets" / "default_reference_voice.wav",
    ):
        if candidate.exists():
            return candidate

    default_path = project_root / "assets" / "default_reference.wav"
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
    """Synthesizes a default reference clip via Edge-TTS, converted to 22050 Hz mono WAV."""
    import asyncio
    import subprocess

    from backend.core.config import get_ffmpeg_path, get_startupinfo, get_temp_dir

    tmp_mp3 = get_temp_dir() / "xtts_default_reference_tmp.mp3"
    tmp_wav = get_temp_dir() / "xtts_default_reference_tmp.wav"
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
        # Guard against a truncated/odd ffmpeg output (e.g. raw mp3 bytes written
        # under a .wav name) — a valid WAV always starts with the RIFF header.
        with open(tmp_wav, "rb") as f:
            if f.read(4) != b"RIFF":
                raise RuntimeError("Converted default reference clip is not a valid WAV file.")

        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_wav, dest)
        logger.info(f"Default reference voice created at {dest}")
    finally:
        tmp_mp3.unlink(missing_ok=True)
        tmp_wav.unlink(missing_ok=True)


def check_xtts_model() -> bool:
    """Checks if all required XTTS model files exist locally."""
    xtts_dir = get_xtts_dir()
    return all((xtts_dir / f).exists() for f in XTTS_MODEL_FILES)


def download_xtts_model(progress_callback=None) -> bool:
    """
    Downloads the XTTS Hindi finetuned model from HuggingFace Hub.
    Returns True on success, raises on failure.
    """
    from huggingface_hub import hf_hub_download

    xtts_dir = get_xtts_dir()
    total_files = len(XTTS_MODEL_FILES)

    for i, filename in enumerate(XTTS_MODEL_FILES):
        dest = xtts_dir / filename
        if dest.exists():
            logger.info(f"XTTS model file already exists: {filename}")
            if progress_callback:
                progress_callback({"file": filename, "progress": 100})
            continue

        logger.info(f"Downloading XTTS model file: {filename} ({i+1}/{total_files})")
        try:
            downloaded_path = hf_hub_download(
                repo_id=XTTS_HF_REPO,
                filename=filename,
                local_dir=str(xtts_dir),
            )
            # hf_hub_download with local_dir should put files directly in xtts_dir
            # but verify and copy if needed
            if not dest.exists() and Path(downloaded_path).exists():
                shutil.copy2(downloaded_path, dest)

            logger.info(f"Downloaded XTTS model file: {filename}")
        except Exception as e:
            logger.error(f"Failed to download XTTS file {filename}: {e}")
            raise

        if progress_callback:
            overall_progress = ((i + 1) / total_files) * 100
            progress_callback({"file": filename, "progress": overall_progress})

    logger.info("All XTTS model files downloaded successfully.")
    return True


def delete_xtts_model() -> bool:
    """Deletes all local XTTS model files."""
    global _xtts_model
    xtts_dir = get_xtts_dir()
    deleted = False
    try:
        # Clear cached model first
        with _xtts_model_lock:
            _xtts_model = None

        for filename in XTTS_MODEL_FILES:
            f = xtts_dir / filename
            if f.exists():
                f.unlink()
                deleted = True
                logger.info(f"Deleted XTTS model file: {filename}")

        # Also clean up any .huggingface cache artifacts in the dir
        for item in xtts_dir.iterdir():
            if item.is_file():
                item.unlink()
                deleted = True
            elif item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
                deleted = True

        return deleted
    except Exception as e:
        logger.error(f"Failed to delete XTTS model: {e}")
        return False


_TORCHCODEC_FFMPEG_DLLS = [
    "avcodec-58.dll", "avutil-56.dll", "avformat-58.dll",
    "avfilter-7.dll", "swscale-5.dll", "swresample-3.dll", "postproc-55.dll",
]
# FFmpeg 4.3.1 (win-64) from conda-forge — ships exactly the shared DLLs the
# torchcodec wheel links against. Small (~27 MB), reliable, no build needed.
_TORCHCODEC_FFMPEG_URL = (
    "https://conda.anaconda.org/conda-forge/win-64/ffmpeg-4.3.1-ha925a31_0.tar.bz2"
)


def _provision_torchcodec_ffmpeg(pkg_dir: Path) -> bool:
    """Downloads the FFmpeg 4.3 shared DLLs torchcodec needs and places them
    next to the torchcodec package. Returns True on success."""
    import tarfile
    import tempfile
    import urllib.request

    if all((pkg_dir / d).exists() for d in _TORCHCODEC_FFMPEG_DLLS):
        return True
    try:
        logger.info("Provisioning FFmpeg DLLs for torchcodec (one-time download)...")
        tmp_tarball = Path(tempfile.gettempdir()) / "torchcodec_ffmpeg.tar.bz2"
        urllib.request.urlretrieve(_TORCHCODEC_FFMPEG_URL, tmp_tarball)
        with tarfile.open(tmp_tarball, "r:bz2") as tf:
            for dll in _TORCHCODEC_FFMPEG_DLLS:
                member = tf.extractfile(f"Library/bin/{dll}")
                if member is None:
                    raise RuntimeError(f"{dll} missing from FFmpeg archive")
                (pkg_dir / dll).write_bytes(member.read())
        tmp_tarball.unlink(missing_ok=True)
        logger.info(f"FFmpeg DLLs installed next to torchcodec at {pkg_dir}")
        return True
    except Exception as e:
        logger.warning(f"Could not provision torchcodec FFmpeg DLLs: {e}")
        return False


def _ensure_torchcodec_dlls() -> None:
    """Windows: torchcodec (pulled in by coqui-tts) links against FFmpeg 4.3
    shared DLLs (avcodec-58.dll, avutil-56.dll, ...) which its wheel does not
    bundle. Auto-provision them next to the torchcodec package (one-time
    download) and register that directory in the process DLL search path so
    `import torchcodec` (via TTS) can resolve them.
    """
    if os.name != "nt":
        return
    try:
        import importlib.util
        spec = importlib.util.find_spec("torchcodec")
        if spec is None or not spec.submodule_search_locations:
            return
        pkg_dir = Path(list(spec.submodule_search_locations)[0])
        if not (pkg_dir / "avcodec-58.dll").exists():
            _provision_torchcodec_ffmpeg(pkg_dir)
        os.add_dll_directory(str(pkg_dir))
    except Exception:
        pass


def _load_xtts_model():
    """Loads and caches the XTTS model. Thread-safe singleton."""
    global _xtts_model

    with _xtts_model_lock:
        if _xtts_model is not None:
            return _xtts_model

        if not check_xtts_model():
            raise FileNotFoundError(
                "XTTS model files not found. Please download them from Settings > TTS Engine "
                "(click the download icon next to XTTS), or switch to Edge-TTS."
            )

        import torch
        _ensure_torchcodec_dlls()
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        xtts_dir = get_xtts_dir()
        config_path = str(xtts_dir / "config.json")

        logger.info(f"Loading XTTS model from {xtts_dir}...")

        config = XttsConfig()
        config.load_json(config_path)

        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=str(xtts_dir), eval=True)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)

        logger.info(f"XTTS model loaded on {device}")
        _xtts_model = model
        return _xtts_model


def _chunk_text_for_xtts(text: str) -> list[str]:
    """
    Splits text into sentence-level chunks to prevent memory issues with long text.
    Handles both English and Hindi sentence delimiters.
    """
    # Split by sentence-ending punctuation (English and Hindi danda)
    chunks = re.split(r'(?<=[.!?।\n])\s+', text.strip())

    # Merge very short chunks
    merged = []
    current = ""
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        if len(current.split()) + len(chunk.split()) < 30:
            current = (current + " " + chunk).strip() if current else chunk
        else:
            if current:
                merged.append(current)
            current = chunk
    if current:
        merged.append(current)

    return merged if merged else [text]


def generate_xtts_tts(
    text: str,
    output_path: str,
    speaker_wav: str = "",
    language: str = "hi",
    speed: float = 1.0,
) -> None:
    """
    Generates TTS audio using the XTTS v2 Hindi finetuned model with voice cloning.

    Args:
        text: The text to synthesize.
        output_path: Path to write the output .wav file.
        speaker_wav: Path to a reference voice .wav file for cloning.
                     Falls back to default reference voice if empty.
        language: Language code ('hi' for Hindi, 'en' for English).
        speed: Speech speed multiplier (not directly supported by XTTS,
               but we can post-process or adjust generation params).
    """
    import numpy as np
    import soundfile as sf

    model = _load_xtts_model()

    # Resolve reference voice
    if not speaker_wav or not Path(speaker_wav).exists():
        speaker_wav = str(get_default_reference_voice())
        if not Path(speaker_wav).exists():
            raise FileNotFoundError(
                "No reference voice file found. Please upload a reference voice clip "
                "in Settings > Voice Synthesis, or ensure the default reference voice exists."
            )

    logger.info(f"Generating XTTS TTS. Language: {language}, Speaker: {Path(speaker_wav).name}")

    # Clean text of markdown symbols
    cleaned_text = re.sub(r'[*#_`~>]', '', text)
    cleaned_text = re.sub(r'\.{2,}', ',', cleaned_text)

    # Chunk text to prevent memory issues
    chunks = _chunk_text_for_xtts(cleaned_text)
    logger.info(f"Synthesizing {len(chunks)} chunks with XTTS...")

    # Compute speaker latents once (reused across chunks)
    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
        audio_path=[speaker_wav]
    )

    all_samples = []
    sample_rate = 24000  # XTTS default

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        try:
            out = model.inference(
                text=chunk,
                language=language,
                gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding,
                speed=speed,
            )
            wav = out.get("wav")
            if wav is not None:
                if hasattr(wav, 'cpu'):
                    wav = wav.cpu().numpy()
                all_samples.append(wav)
        except Exception as e:
            logger.warning(f"XTTS failed on chunk {i+1} '{chunk[:40]}...': {e}")

    if all_samples:
        final = np.concatenate(all_samples)
        sf.write(output_path, final, sample_rate)
        logger.info(f"XTTS TTS output written to {output_path}")
    else:
        # Write empty file so downstream doesn't crash
        sf.write(output_path, np.array([], dtype=np.float32), sample_rate)
        logger.warning("XTTS produced no audio samples.")
