import os
import json
from pathlib import Path
from backend.core.config import get_models_dir
from backend.core.logger import logger
from backend.database.db import get_setting, update_project

def get_whisper_model_path(model_size):
    whisper_dir = get_models_dir() / "whisper" / model_size
    if (whisper_dir / "model.bin").exists() and (whisper_dir / "config.json").exists():
        return str(whisper_dir)
        
    for root, dirs, files in os.walk(str(whisper_dir)):
        if "model.bin" in files and "config.json" in files:
            return root
            
    return None

def check_whisper_assets(model_size):
    return get_whisper_model_path(model_size) is not None

def download_whisper_model_files(model_size, progress_callback=None):
    import huggingface_hub
    import tqdm.std
    
    whisper_dir = get_models_dir() / "whisper" / model_size
    whisper_dir.mkdir(parents=True, exist_ok=True)
    
    repo_id = f"Systran/faster-whisper-{model_size}"
    
    # Save original tqdm methods
    original_init = tqdm.std.tqdm.__init__
    original_update = tqdm.std.tqdm.update
    original_close = tqdm.std.tqdm.close
    original_reset = tqdm.std.tqdm.reset
    
    progress_state = {
        "total_bytes": 0,
        "downloaded_bytes": 0,
        "last_percent": -1
    }
    
    def custom_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.desc_name = kwargs.get('desc', '') or getattr(self, 'desc', '') or ''
        if self.total and self.total > 1_000_000:
            progress_state["total_bytes"] = self.total
            progress_state["downloaded_bytes"] = self.n

    def custom_reset(self, total=None):
        original_reset(self, total)
        if self.total and self.total > 1_000_000:
            progress_state["total_bytes"] = self.total
            progress_state["downloaded_bytes"] = self.n

    def custom_update(self, n=1):
        res = original_update(self, n)
        if self.total and self.total > 1_000_000:
            progress_state["total_bytes"] = self.total
            progress_state["downloaded_bytes"] = self.n
            
            if progress_callback:
                pct = (progress_state["downloaded_bytes"] / progress_state["total_bytes"]) * 100
                pct = min(100.0, max(0.0, pct))
                if int(pct) != progress_state["last_percent"]:
                    progress_state["last_percent"] = int(pct)
                    try:
                        progress_callback(pct)
                    except Exception:
                        pass
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

def transcribe_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Whisper alignment transcription step of pipeline."""
    audio_path = project_dict['audio_path']
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Voiceover audio file not found: {audio_path}")

    model_size = get_setting("whisper_model") or "base"
    device = get_setting("whisper_device") or "cpu"
    language = project_dict.get("language", "hi")

    # 1. Download model files if not exist
    if not check_whisper_assets(model_size):
        logger.info(f"Local Whisper model '{model_size}' missing. Fetching now...")
        def dl_cb(pct):
            progress_cb(pct * 0.4, f"Downloading Whisper model... {pct:.0f}%") # first 40% of step is model download
        download_whisper_model_files(model_size, dl_cb)

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
    progress_cb(100.0, "Transcription completed!")
    logger.info(f"Transcription completed. Output JSON: {json_path}")
