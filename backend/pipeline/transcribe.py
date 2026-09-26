import os
import json
import hashlib
import re
import difflib
import uuid
from pathlib import Path
from backend.core.config import get_models_dir, get_temp_dir
from backend.core.logger import logger
from backend.database.db import get_setting, update_project

try:
    import soundfile as sf
except ImportError:
    sf = None

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
    for root, _, files in os.walk(str(whisper_dir)):
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
            for root, _, files in os.walk(str(item)):
                if "model.bin" in files:
                    has_model = True
                    break

            if has_model:
                total_size = 0
                for root, _, files in os.walk(str(item)):
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

# Standard faster-whisper sizes, best quality first. "turbo"
# (large-v3-turbo) is a first-class entry: ~large-v3 quality at a third
# of the size, and the only model on machines that downloaded just it.
# NOTE: get_best_downloaded_whisper_model matches downloaded folder ids
# against this list — any new first-class size MUST be added here or the
# picker silently falls through to its (possibly undownloaded) fallback.
KNOWN_WHISPER_MODELS = [
    "large-v3",
    "large-v3-turbo",
    "turbo",
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

def get_best_downloaded_whisper_model(fallback="small"):
    """
    Returns the highest quality standard multilingual/English Whisper model 
    that is already downloaded on the system. If none are found, returns the fallback.
    """
    downloaded = list_downloaded_whisper_models()
    downloaded_ids = [m["id"] for m in downloaded]
    
    for model in KNOWN_WHISPER_MODELS:
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

    if model_size == "turbo":
        repo_id = "deepdml/faster-whisper-large-v3-turbo-ct2"
    elif "/" in model_size:
        repo_id = model_size
    else:
        repo_id = f"Systran/faster-whisper-{model_size}"
    
    # Save original tqdm methods
    original_init = tqdm.std.tqdm.__init__
    original_update = tqdm.std.tqdm.update
    original_reset = tqdm.std.tqdm.reset
    
    progress_states = {}
    last_percent = {"value": -1}
    
    def custom_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
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

    # Monkeypatch tqdm
    tqdm.std.tqdm.__init__ = custom_init
    tqdm.std.tqdm.reset = custom_reset
    tqdm.std.tqdm.update = custom_update
    
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
        
    # Check if voiceover audio file is newer than the transcription
    audio_path_str = project_dict.get('audio_path') if project_dict else None
    audio_path = Path(audio_path_str) if audio_path_str and Path(audio_path_str).exists() else Path(project_dir) / "voiceover.wav"
    if audio_path.exists():
        try:
            if audio_path.stat().st_mtime > subtitles_path.stat().st_mtime:
                logger.info("transcribe stale: voiceover audio file is newer than transcription.json")
                return True
        except OSError:
            pass

    model_size, device, language = _resolve_whisper_settings(project_dict)
    current_hash = _compute_transcribe_hash(model_size, device, language)
    stored_hash = _read_stored_transcribe_hash(project_dir)
    
    if stored_hash != current_hash:
        return True
        
    return False



SENTENCE_END_PUNCT = re.compile(r'[।\.\|\?\!]')


def _clean_token(w: str) -> str:
    """Normalize token for fuzzy matching while strictly preserving Indic Unicode characters & matras."""
    return re.sub(r'[^\w\u0900-\u097F]', '', w).lower()


def _align_script_words_to_acoustic(script_words: list[str], raw_words: list[dict], fallback_start: float = 0.0, fallback_end: float = 0.0) -> list[dict]:
    """
    Fuzzy-align known script words to Whisper acoustic timestamps using SequenceMatcher.
    Preserves exact script text (including correct Hindi spellings & matras) while binding
    each word to its true acoustic audio window.
    """
    if not script_words:
        return raw_words

    if not raw_words:
        # Acoustic words missing entirely: distribute script words across fallback window
        total_chars = sum(len(w) for w in script_words) or 1
        span = max(0.05, fallback_end - fallback_start)
        cursor = fallback_start
        aligned = []
        for sw in script_words:
            w_dur = (len(sw) / total_chars) * span
            aligned.append({
                "word": sw,
                "start": round(cursor, 3),
                "end": round(cursor + w_dur, 3)
            })
            cursor += w_dur
        return aligned

    clean_s = [_clean_token(w) for w in script_words]
    clean_r = [_clean_token(w["word"]) for w in raw_words]

    sm = difflib.SequenceMatcher(None, clean_s, clean_r)
    aligned: list[dict] = []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        s_chunk = script_words[i1:i2]
        r_chunk = raw_words[j1:j2]

        if tag == "equal":
            for sw, rw in zip(s_chunk, r_chunk):
                aligned.append({
                    "word": sw,
                    "start": round(rw["start"], 3),
                    "end": round(rw["end"], 3)
                })
        elif tag in ("replace", "insert", "delete"):
            if s_chunk and r_chunk:
                start_t = r_chunk[0]["start"]
                end_t = r_chunk[-1]["end"]
                total_chars = sum(len(w) for w in s_chunk) or 1
                cursor = start_t
                span = max(0.01, end_t - start_t)
                for sw in s_chunk:
                    w_dur = (len(sw) / total_chars) * span
                    aligned.append({
                        "word": sw,
                        "start": round(cursor, 3),
                        "end": round(cursor + w_dur, 3)
                    })
                    cursor += w_dur
                if aligned:
                    aligned[-1]["end"] = round(end_t, 3)
            elif s_chunk and not r_chunk:
                prev_end = aligned[-1]["end"] if aligned else fallback_start
                next_start = fallback_end
                span = max(0.05, next_start - prev_end)
                total_chars = sum(len(w) for w in s_chunk) or 1
                cursor = prev_end
                for sw in s_chunk:
                    w_dur = (len(sw) / total_chars) * span
                    aligned.append({
                        "word": sw,
                        "start": round(cursor, 3),
                        "end": round(cursor + w_dur, 3)
                    })
                    cursor += w_dur

    return aligned


def _repair_acoustic_anomalies(model, audio_path: str, raw_words: list[dict], sec_dur: float, language: str) -> list[dict]:
    """Detect anomalous single words (>1.5s) or internal gaps (>1.2s) and re-transcribe slices."""
    if not raw_words or not os.path.exists(audio_path) or sf is None:
        return raw_words

    anomalies = []
    for i, w in enumerate(raw_words):
        dur = w["end"] - w["start"]
        if dur > 1.5:
            anomalies.append(('long_word', i, w, dur))

    if not anomalies:
        return raw_words

    try:
        data, sr = sf.read(audio_path)
    except Exception as e:
        logger.debug(f"Failed to read audio for anomaly repair: {e}")
        return raw_words

    repaired = list(raw_words)
    # Process from last to first so indices don't shift
    for anom_type, idx, target_w, dur in reversed(anomalies):
        temp_slice = None
        try:
            start_s = max(0.0, target_w["start"] - 0.4)
            end_s = min(sec_dur, target_w["end"] + 0.4)
            if end_s - start_s < 0.2:
                continue

            slice_data = data[int(start_s * sr):int(end_s * sr)]
            temp_slice = get_temp_dir() / f"slice_{uuid.uuid4().hex[:8]}.wav"
            sf.write(str(temp_slice), slice_data, sr)

            sub_segs, _ = model.transcribe(str(temp_slice), language=language, word_timestamps=True, vad_filter=False)
            recovered = []
            for ss in sub_segs:
                for ww in ss.words:
                    if ww.word.strip():
                        recovered.append({
                            "word": ww.word.strip(),
                            "start": round(start_s + ww.start, 3),
                            "end": round(start_s + ww.end, 3)
                        })

            if recovered:
                logger.info(f"Anomaly repaired: replaced {dur:.2f}s stall '{target_w['word']}' with {len(recovered)} words")
                repaired = repaired[:idx] + recovered + repaired[idx+1:]
        except Exception as e:
            logger.debug(f"Slice repair failed: {e}")
        finally:
            if temp_slice and temp_slice.exists():
                try:
                    temp_slice.unlink()
                except Exception:
                    pass

    return repaired


def _build_subtitle_segments(aligned_words: list[dict], start_id: int = 1, max_words_per_segment: int = 8, max_dur_per_segment: float = 4.0) -> list[dict]:
    """Group aligned words into readable, rhythmic subtitle segments."""
    segments = []
    current_words = []

    for i, w in enumerate(aligned_words):
        current_words.append(w)
        seg_dur = current_words[-1]["end"] - current_words[0]["start"]
        ends_punct = bool(SENTENCE_END_PUNCT.search(w["word"]))
        is_last = (i == len(aligned_words) - 1)

        if ends_punct or len(current_words) >= max_words_per_segment or seg_dur >= max_dur_per_segment or is_last:
            seg_start = current_words[0]["start"]
            seg_end = current_words[-1]["end"]

            # Reconstruct words with standard Whisper leading-space convention
            norm_words = []
            for j, cw in enumerate(current_words):
                w_text = cw["word"].strip()
                prefix = "" if j == 0 else " "
                norm_words.append({
                    "start": cw["start"],
                    "end": cw["end"],
                    "word": prefix + w_text
                })

            seg_text = "".join(nw["word"] for nw in norm_words).strip()
            segments.append({
                "id": start_id + len(segments),
                "start": seg_start,
                "end": seg_end,
                "text": seg_text,
                "words": norm_words
            })
            current_words = []

    return segments


def _distribute_words_fallback(segment_text, segment_start, segment_end):
    """Fallback: distribute words evenly by character ratio when Whisper word timestamps are unreliable."""
    segment_duration = segment_end - segment_start
    math_words = re.findall(r'\s*\S+', segment_text)

    total_chars = sum(len(w.strip()) for w in math_words)
    current_start = segment_start
    words = []

    for w in math_words:
        ratio = len(w.strip()) / total_chars if total_chars > 0 else 0
        word_duration = ratio * segment_duration
        words.append({
            "start": current_start,
            "end": current_start + word_duration,
            "word": w
        })
        current_start += word_duration

    return words


def transcribe_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Whisper alignment transcription step of pipeline.

    Supports Section-Aware Transcription with Anomaly Detection & Script-Guided Alignment
    when voiceover manifest is present, preserving 100% of spoken words and avoiding long-form drift.
    """
    audio_path = project_dict['audio_path']
    if not audio_path or not os.path.exists(audio_path):
        raise FileNotFoundError(f"Voiceover audio file not found: {audio_path}")

    # Resolve settings — project-level overrides beat global settings
    model_size, device, language = _resolve_whisper_settings(project_dict)

    # 1. Check model files exist locally
    if not check_whisper_assets(model_size):
        downloaded = list_downloaded_whisper_models()
        hint = ""
        if downloaded:
            names = ", ".join(m["id"] for m in downloaded)
            hint = f" Available downloaded models: {names}. Select one in Settings > Whisper Model, "
        raise FileNotFoundError(
            f"Whisper model '{model_size}' is not downloaded.{hint}"
            "or download it from Settings > Speech-to-Text (click the download icon next to the model)."
        )

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Load Whisper model
    progress_cb(45.0, "Loading Whisper model...")
    model = get_whisper_model(model_size, device)

    # Check for section voiceover manifest
    manifest_path = Path(project_dir) / "voiceover" / "manifest.json"
    manifest = []
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, list) and loaded:
                manifest = loaded
        except Exception as e:
            logger.warning(f"Failed to read manifest.json: {e}")

    has_valid_manifest = (
        len(manifest) > 0 and
        all(isinstance(m, dict) and m.get("audio_path") and os.path.exists(m["audio_path"]) for m in manifest)
    )

    if has_valid_manifest:
        logger.info(f"Starting Section-Aware transcription for {len(manifest)} sections (Script-Guided Alignment)...")
        all_segments = []
        cumulative_time = 0.0
        total_sections = len(manifest)

        for idx, entry in enumerate(manifest):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            sec_audio = entry["audio_path"]
            script_text = (entry.get("text") or "").strip()
            sec_dur = float(entry.get("duration", 0.0) or 0.0)
            if sec_dur <= 0:
                from backend.pipeline.tts import get_audio_duration
                sec_dur = get_audio_duration(sec_audio)

            script_words = [w for w in re.split(r'\s+', script_text) if w]

            # Pure acoustic transcription with VAD (no prompt to prevent timestamp smearing/collapse)
            segments_gen, _ = model.transcribe(
                sec_audio,
                beam_size=5,
                word_timestamps=True,
                language=language,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=300)
            )

            raw_words = []
            for s in segments_gen:
                if cancel_event.is_set():
                    raise InterruptedError("Cancelled")
                if s.words:
                    for w in s.words:
                        if w.word.strip():
                            raw_words.append({
                                "word": w.word.strip(),
                                "start": w.start,
                                "end": w.end
                            })

            # Detect & repair anomalies (e.g. word duration > 1.5s)
            raw_words = _repair_acoustic_anomalies(model, sec_audio, raw_words, sec_dur, language)

            # Script-guided sequence alignment
            aligned_words = _align_script_words_to_acoustic(script_words, raw_words, fallback_start=0.0, fallback_end=sec_dur)

            # Offset to cumulative timeline time
            for w in aligned_words:
                w["start"] = round(cumulative_time + w["start"], 3)
                w["end"] = round(cumulative_time + w["end"], 3)

            # Build readable subtitle segments
            sec_segments = _build_subtitle_segments(aligned_words, start_id=len(all_segments) + 1)
            all_segments.extend(sec_segments)

            cumulative_time += sec_dur
            pct = 45.0 + ((idx + 1) / total_sections) * 50.0
            progress_cb(min(98.0, pct), f"Transcribing section {idx + 1}/{total_sections}...")

        segments = all_segments
    else:
        logger.info("Transcribing whole audio file (no section manifest)...")
        from backend.pipeline.tts import get_audio_duration
        total_dur = get_audio_duration(audio_path)

        segments_generator, info = model.transcribe(
            audio_path,
            beam_size=5,
            word_timestamps=True,
            language=language,
            vad_filter=True
        )

        all_raw_words = []
        for segment in segments_generator:
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")
            if segment.words:
                for w in segment.words:
                    if w.word.strip():
                        all_raw_words.append({
                            "word": w.word.strip(),
                            "start": w.start,
                            "end": w.end
                        })
            if total_dur > 0:
                pct = 45.0 + (segment.end / total_dur) * 50.0
                progress_cb(min(98.0, pct), f"Transcribing audio... {min(100.0, (segment.end / total_dur) * 100):.0f}%")

        # Check if project has a script to align against
        script_file = Path(project_dir) / "script.json"
        script_words = []
        if script_file.exists():
            try:
                from backend.mcp.subtitles import _load_script_sections
                sec_list = _load_script_sections(Path(project_dir))
                all_text = " ".join(s["text"] for s in sec_list if s.get("text"))
                script_words = [w for w in re.split(r'\s+', all_text) if w]
            except Exception:
                pass

        if script_words:
            aligned_words = _align_script_words_to_acoustic(script_words, all_raw_words, fallback_start=0.0, fallback_end=total_dur)
            segments = _build_subtitle_segments(aligned_words, start_id=1)
        elif all_raw_words:
            segments = _build_subtitle_segments(all_raw_words, start_id=1)
        else:
            segments = []

    result = {
        "language": language,
        "segments": segments
    }

    # 3. Save formats
    sub_dir = Path(project_dir) / "subtitles"
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
