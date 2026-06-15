import os
import json
import hashlib
from pathlib import Path
from backend.core.config import get_models_dir
from backend.core.logger import logger
from backend.database.db import get_setting, update_project

def get_whisper_model_path(model_size):
    if not model_size:
        return None

    whisper_dir = get_models_dir() / "whisper"

    # Handle both naming conventions:
    # 1. "collabora/faster-whisper-small-hindi" (nested in collabora folder)
    # 2. "collabora_faster-whisper-small-hindi" (flat folder name)
    safe_dir_name = model_size.replace("/", "_") if "/" in model_size else model_size

    # First check the flat folder name (e.g., "collabora_faster-whisper-small-hindi")
    flat_dir = whisper_dir / safe_dir_name
    if (flat_dir / "model.bin").exists() and (flat_dir / "config.json").exists():
        return str(flat_dir)

    # Then check the nested path (e.g., "collabora/faster-whisper-small-hindi")
    nested_dir = whisper_dir / model_size  # Use original with "/"
    if (nested_dir / "model.bin").exists() and (nested_dir / "config.json").exists():
        return str(nested_dir)

    # Fallback: recursively search for the model
    for root, dirs, files in os.walk(str(whisper_dir)):
        if "model.bin" in files and "config.json" in files:
            # Check if this folder matches our model
            folder_name = os.path.basename(root)
            if folder_name == safe_dir_name or folder_name == model_size.split("/")[-1]:
                return root

    return None

def check_whisper_assets(model_size):
    return get_whisper_model_path(model_size) is not None

def list_downloaded_whisper_models():
    models = []
    whisper_base_dir = get_models_dir() / "whisper"
    if not whisper_base_dir.exists():
        return models

    for item in whisper_base_dir.iterdir():
        if item.is_dir():
            # Skip folders that only contain other model folders (like "collabora" containing "faster-whisper-small-hindi")
            # A real model folder should have model.bin at its top level or one level deep
            has_model_at_root = (item / "model.bin").exists()

            if not has_model_at_root:
                # Check if this folder only contains subdirectories that are actual models
                subdirs = [d for d in item.iterdir() if d.is_dir()]
                if subdirs and not any((item / "config.json").exists() for item in item.iterdir() if item.is_file()):
                    # This is a parent folder, skip it - the actual models will be listed separately
                    continue

            has_model = False
            for root, dirs, files in os.walk(str(item)):
                if "model.bin" in files:
                    has_model = True
                    break

            if has_model:
                total_size = 0
                for root, dirs, files in os.walk(str(item)):
                    for f in files:
                        fp = os.path.join(root, f)
                        if not os.path.islink(fp):
                            total_size += os.path.getsize(fp)

                size_mb = total_size / (1024 * 1024)
                models.append({
                    "id": item.name,
                    "size_mb": round(size_mb, 1)
                })
    return models

def get_best_downloaded_whisper_model(fallback="small"):
    """
    Returns the highest quality standard multilingual/English Whisper model 
    that is already downloaded on the system. If none are found, returns the fallback.
    """
    STANDARD_MODELS = [
        "large-v3",
        "large-v2",
        "large",
        "medium",
        "small.en",
        "small",
        "base.en",
        "base",
        "tiny.en",
        "tiny"
    ]
    
    downloaded = list_downloaded_whisper_models()
    downloaded_ids = [m["id"] for m in downloaded]
    
    for model in STANDARD_MODELS:
        if model in downloaded_ids:
            return model
            
    return fallback

def delete_whisper_model(safe_dir_name):
    whisper_dir = get_models_dir() / "whisper" / safe_dir_name
    if whisper_dir.exists() and whisper_dir.is_dir():
        import shutil
        try:
            shutil.rmtree(str(whisper_dir))
            return True
        except Exception as e:
            logger.error(f"Failed to delete model {safe_dir_name}: {e}")
            return False
    return False

def download_whisper_model_files(model_size, progress_callback=None, cancel_event=None):
    import huggingface_hub
    import tqdm.std

    if not model_size:
        logger.error("No Whisper model size provided for download.")
        return False

    safe_dir_name = model_size.replace("/", "_") if "/" in model_size else model_size
    whisper_dir = get_models_dir() / "whisper" / safe_dir_name
    whisper_dir.mkdir(parents=True, exist_ok=True)

    repo_id = model_size if "/" in model_size else f"Systran/faster-whisper-{model_size}"
    
    # Save original tqdm methods
    original_init = tqdm.std.tqdm.__init__
    original_update = tqdm.std.tqdm.update
    original_close = tqdm.std.tqdm.close
    original_reset = tqdm.std.tqdm.reset
    
    progress_states = {}
    last_percent = {"value": -1}
    
    def custom_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.desc_name = kwargs.get('desc', '') or getattr(self, 'desc', '') or ''
        if self.total and self.total > 1_000_000:
            progress_states[id(self)] = {"total": self.total, "downloaded": self.n}

    def custom_reset(self, total=None):
        original_reset(self, total)
        if self.total and self.total > 1_000_000:
            progress_states[id(self)] = {"total": self.total, "downloaded": self.n}

    def custom_update(self, n=1):
        res = original_update(self, n)
        if self.total and self.total > 1_000_000:
            progress_states[id(self)] = {"total": self.total, "downloaded": self.n}
            
            if progress_callback:
                total_bytes = sum(state["total"] for state in progress_states.values())
                downloaded_bytes = sum(state["downloaded"] for state in progress_states.values())
                if total_bytes > 0:
                    pct = (downloaded_bytes / total_bytes) * 100
                    pct = min(100.0, max(0.0, pct))
                    if int(pct) != last_percent["value"]:
                        last_percent["value"] = int(pct)
                        try:
                            progress_callback(pct)
                        except Exception:
                            pass
                            
            if cancel_event and cancel_event.is_set():
                raise InterruptedError("Cancelled")
                
        return res

    def custom_close(self):
        return original_close(self)

    # Monkeypatch tqdm
    tqdm.std.tqdm.__init__ = custom_init
    tqdm.std.tqdm.reset = custom_reset
    tqdm.std.tqdm.update = custom_update
    tqdm.std.tqdm.close = custom_close
    
    try:
        allow_patterns = [
            "config.json", "preprocessor_config.json", "model.bin",
            "tokenizer.json", "vocabulary.*"
        ]
        logger.info(f"Downloading Whisper '{model_size}' model from {repo_id}")
        huggingface_hub.snapshot_download(
            repo_id=repo_id,
            allow_patterns=allow_patterns,
            local_dir=str(whisper_dir),
            tqdm_class=tqdm.std.tqdm
        )
    finally:
        # Restore original tqdm
        tqdm.std.tqdm.__init__ = original_init
        tqdm.std.tqdm.reset = original_reset
        tqdm.std.tqdm.update = original_update
        tqdm.std.tqdm.close = original_close

def get_whisper_model(model_size, device="cpu"):
    from faster_whisper import WhisperModel
    import ctranslate2
    
    if device == "cuda" and ctranslate2.get_cuda_device_count() == 0:
        logger.warning("CUDA requested but not available. Using CPU.")
        device = "cpu"
        
    compute_type = "float16" if device == "cuda" else "int8"
    logger.info(f"Loading Whisper model '{model_size}' on '{device}'")
    
    model_path = get_models_dir() / "whisper" / model_size
    model_path.mkdir(parents=True, exist_ok=True)
    
    local_path = get_whisper_model_path(model_size)
    model_size_or_path = local_path if local_path else model_size
        
    return WhisperModel(
        model_size_or_path,
        device=device,
        compute_type=compute_type,
        download_root=str(model_path)
    )

def format_timestamp(seconds, is_srt=False):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds - int(seconds)) * 1000)
    separator = "," if is_srt else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{milliseconds:03d}"

def export_srt(segments, file_path):
    with open(file_path, "w", encoding="utf-8") as f:
        for idx, seg in enumerate(segments, 1):
            start = format_timestamp(seg["start"], is_srt=True)
            end = format_timestamp(seg["end"], is_srt=True)
            text = seg["text"].strip()
            f.write(f"{idx}\n{start} --> {end}\n{text}\n\n")

def export_vtt(segments, file_path):
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for idx, seg in enumerate(segments, 1):
            start = format_timestamp(seg["start"], is_srt=False)
            end = format_timestamp(seg["end"], is_srt=False)
            text = seg["text"].strip()
            f.write(f"{idx}\n{start} --> {end}\n{text}\n\n")

def _resolve_whisper_settings(project_dict):
    """Resolve whisper settings from project_settings (per-project) or global settings.

    Returns (model_size, device) tuple.
    """
    project_settings = {}
    raw = project_dict.get("project_settings")
    if raw:
        if isinstance(raw, str):
            try:
                project_settings = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                pass
        elif isinstance(raw, dict):
            project_settings = raw

    model_size = project_settings.get("whisper_model") or get_setting("whisper_model") or "base"
    device = project_settings.get("whisper_device") or get_setting("whisper_device") or "cpu"
    language = project_dict.get("language", "hi")

    # Safety check for older projects: If it's not a Hindi project but a Hindi-specific model is set, fallback to best downloaded
    if language != "hi" and "hindi" in model_size.lower():
        model_size = get_best_downloaded_whisper_model(fallback="small")

    return model_size, device, language


def _compute_transcribe_hash(model_size, device, language):
    """Compute a hash of the transcription settings for cache invalidation."""
    raw = f"{model_size}|{device}|{language}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _read_stored_transcribe_hash(project_dir):
    """Read the stored transcribe hash from the project directory."""
    hash_file = Path(project_dir) / "transcribe.hash.txt"
    if hash_file.exists():
        return hash_file.read_text().strip()
    return None


def _write_transcribe_hash(project_dir, hash_value):
    """Write the transcribe hash to the project directory."""
    hash_file = Path(project_dir) / "transcribe.hash.txt"
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    hash_file.write_text(hash_value)

def is_transcribe_stale(project_dict, project_dir):
    """Check if the transcribe step needs to run."""
    subtitles_path = Path(project_dir) / "subtitles" / "transcription.json"
    if not subtitles_path.exists():
        return True
        
    model_size, device, language = _resolve_whisper_settings(project_dict)
    current_hash = _compute_transcribe_hash(model_size, device, language)
    stored_hash = _read_stored_transcribe_hash(project_dir)
    
    if stored_hash != current_hash:
        return True
        
    return False



def transcribe_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Whisper alignment transcription step of pipeline."""
    audio_path = project_dict['audio_path']
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Voiceover audio file not found: {audio_path}")

    # Resolve settings — project-level overrides beat global settings
    model_size, device, language = _resolve_whisper_settings(project_dict)

    # 1. Download model files if not exist
    if not check_whisper_assets(model_size):
        logger.info(f"Local Whisper model '{model_size}' missing. Fetching now...")
        def dl_cb(pct):
            progress_cb(pct * 0.4, f"Downloading Whisper model... {pct:.0f}%") # first 40% of step is model download
        download_whisper_model_files(model_size, dl_cb, cancel_event)

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Transcribe
    progress_cb(45.0, "Loading Whisper model...")
    model = get_whisper_model(model_size, device)
    
    logger.info("Starting audio transcription...")
    segments_generator, info = model.transcribe(
        audio_path,
        beam_size=5,
        word_timestamps=True,
        language=language
    )

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    segments = []
    # Total duration approximation for progress report
    from backend.pipeline.tts import get_audio_duration
    total_dur = get_audio_duration(audio_path)

    for segment in segments_generator:
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        words = []
        if segment.words:
            for w in segment.words:
                words.append({
                    "start": w.start,
                    "end": w.end,
                    "word": w.word
                })
        
        segments.append({
            "id": segment.id,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "words": words
        })

        if total_dur > 0:
            pct = 45.0 + (segment.end / total_dur) * 50.0
            progress_cb(min(98.0, pct), f"Transcribing audio... {min(100.0, (segment.end / total_dur) * 100):.0f}%")

    result = {
        "language": info.language,
        "segments": segments
    }

    # 3. Save formats
    sub_dir = project_dir / "subtitles"
    sub_dir.mkdir(parents=True, exist_ok=True)

    json_path = sub_dir / "transcription.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    export_srt(segments, str(sub_dir / "subtitles.srt"))
    export_vtt(segments, str(sub_dir / "subtitles.vtt"))

    update_project(project_dict['id'], transcription_path=str(json_path))

    # Store content hash for cache invalidation on resume
    transcribe_hash = _compute_transcribe_hash(model_size, device, language)
    _write_transcribe_hash(project_dir, transcribe_hash)

    progress_cb(100.0, "Transcription completed!")
    logger.info(f"Transcription completed. Output JSON: {json_path}")
