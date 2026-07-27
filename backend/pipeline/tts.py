import os
import json
import re
import asyncio
import subprocess
import urllib.request
from pathlib import Path
from backend.core.config import get_models_dir, get_temp_dir, get_ffmpeg_path, get_startupinfo
from backend.core.logger import logger
from backend.database.db import get_setting, update_project

# Local Kokoro settings
KOKORO_DIR = get_models_dir() / "kokoro"
KOKORO_MODEL_PATH = KOKORO_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES_PATH = KOKORO_DIR / "voices-v1.0.bin"

KOKORO_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
KOKORO_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

def check_kokoro_assets():
    return KOKORO_MODEL_PATH.exists() and KOKORO_VOICES_PATH.exists()

def delete_kokoro_assets():
    deleted = False
    try:
        if KOKORO_MODEL_PATH.exists():
            KOKORO_MODEL_PATH.unlink()
            deleted = True
        if KOKORO_VOICES_PATH.exists():
            KOKORO_VOICES_PATH.unlink()
            deleted = True
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete Kokoro assets: {e}")
        return False

def download_file_with_progress(url, dest_path, progress_callback=None, cancel_event=None):
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading {url} to {dest_path}")
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            total_size = int(response.info().get('Content-Length', 0))
            block_size = 1024 * 64
            downloaded = 0
            
            with open(dest_path, "wb") as f:
                while True:
                    if cancel_event and cancel_event.is_set():
                        raise InterruptedError("Cancelled")
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    downloaded += len(buffer)
                    f.write(buffer)
                    
                    if progress_callback and total_size > 0:
                        progress = min(100.0, (downloaded / total_size) * 100.0)
                        progress_callback(progress)
        return True
    except Exception as e:
        logger.error(f"Download failed: {e}")
        if dest_path.exists():
            dest_path.unlink()
        raise e

def generate_edge_tts(text, output_path, voice="hi-IN-SwaraNeural", speed="1.0", pitch="0"):
    import edge_tts
    import time
    
    # Clean text of special punctuation that crashes edge-tts or causes pacing issues
    cleaned_text = text
    
    # Strip markdown symbols
    cleaned_text = re.sub(r'[*#_`~>]', '', cleaned_text)
    
    # Normalize ellipses to commas for better pacing
    cleaned_text = re.sub(r'\.{2,}', ',', cleaned_text)
    
    replacements = {
        "\u202f": " ", "\u00a0": " ", "\u2011": "-", "\u2013": "-",
        "\u2014": " - ", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'
    }
    for orig, repl in replacements.items():
        cleaned_text = cleaned_text.replace(orig, repl)
        
    try:
        speed_val = float(speed)
        rate_percent = int((speed_val - 1.0) * 100)
        rate_str = f"{rate_percent:+d}%" if rate_percent != 0 else "+0%"
    except ValueError:
        rate_str = "+0%"
        
    try:
        pitch_val = int(pitch)
        pitch_str = f"{pitch_val:+d}Hz" if pitch_val != 0 else "+0Hz"
    except ValueError:
        pitch_str = "+0Hz"

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"Generating Edge-TTS (Attempt {attempt}). Voice: {voice}, Rate: {rate_str}")
            async def _async_gen():
                communicate = edge_tts.Communicate(cleaned_text, voice, rate=rate_str, pitch=pitch_str)
                await communicate.save(output_path)
            asyncio.run(_async_gen())
            return
        except Exception as e:
            logger.warning(f"Edge-TTS attempt {attempt} failed: {e}")
            if attempt == max_retries:
                raise e
            time.sleep(1.0 * attempt)

def generate_kokoro_tts(text, output_path, voice="af_bella", speed=1.0, lang="en-us"):
    if not check_kokoro_assets():
        raise FileNotFoundError(
            "Kokoro model files not found. Please download them from Settings > TTS Engine (click the download icon next to Kokoro), "
            "or switch to a different TTS engine (Edge / Piper)."
        )
    from kokoro_onnx import Kokoro
    import soundfile as sf
    import re
    import numpy as np
    
    logger.info(f"Generating Kokoro-TTS. Voice: {voice}, Speed: {speed}")
    kokoro = Kokoro(str(KOKORO_MODEL_PATH), str(KOKORO_VOICES_PATH))
    
    # Strip markdown symbols
    text = re.sub(r'[*#_`~>]', '', text)
    
    # Normalize ellipses to commas for better pacing
    text = re.sub(r'\.{2,}', ',', text)
    
    # The kokoro-onnx model crashes if phonemes exceed 510 (approx 3-5 sentences)
    # Split text by sentence-ending punctuation (English and Hindi)
    chunks = re.split(r'(?<=[.!?|।\n])\s+', text.strip())
    
    all_samples = []
    final_sr = 24000
    
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
            
        try:
            samples, sr = kokoro.create(chunk, voice=voice, speed=speed, lang=lang)
            all_samples.append(samples)
            final_sr = sr
        except Exception as e:
            logger.warning(f"Kokoro failed on chunk '{chunk[:30]}...': {e}")
            
    if all_samples:
        final_samples = np.concatenate(all_samples)
        sf.write(output_path, final_samples, final_sr)
    else:
        sf.write(output_path, np.array([], dtype=np.float32), final_sr)

def concat_audio_files_ffmpeg(audio_files, output_path):
    if not audio_files:
        raise ValueError("No audio files provided to concat.")
    ffmpeg_bin = get_ffmpeg_path()
    concat_list_path = get_temp_dir() / "concat_list.txt"
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for file in audio_files:
            normalized_path = str(Path(file).resolve()).replace('\\', '/')
            f.write(f"file '{normalized_path}'\n")
            
    cmd = [
        ffmpeg_bin, "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list_path), "-c", "copy", str(output_path)
    ]
    
    startupinfo = get_startupinfo()
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, startupinfo=startupinfo)
    if concat_list_path.exists():
        concat_list_path.unlink()
        
    if result.returncode != 0:
        err_msg = result.stderr.decode("utf-8", errors="ignore")
        logger.error(f"FFmpeg audio concat failed: {err_msg}")
        raise subprocess.CalledProcessError(result.returncode, cmd)

def get_audio_duration(audio_path):
    from backend.core.config import get_ffprobe_path
    ffprobe_bin = get_ffprobe_path()
    cmd = [ffprobe_bin, "-v", "error", "-show_entries", "format=duration", "-of", "json", audio_path]
    try:
        startupinfo = get_startupinfo()
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, startupinfo=startupinfo)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            return float(data.get("format", {}).get("duration", 0))
    except Exception as e:
        logger.warning(f"Failed to probe duration for {audio_path}: {e}")
    return 0.0

def _resolve_tts_settings(project_dict):
    """Resolve TTS settings from project overrides or global settings."""
    project_settings_raw = project_dict.get("project_settings")
    project_settings = {}
    if project_settings_raw:
        try:
            if isinstance(project_settings_raw, str):
                project_settings = json.loads(project_settings_raw)
            else:
                project_settings = project_settings_raw
        except Exception:
            pass

    from backend.database.db import get_setting
    engine = project_settings.get("tts_engine") or project_dict.get("tts_engine") or get_setting("tts_engine") or "edge"
    speed = float(project_settings.get("tts_speed") or project_dict.get("tts_speed") or get_setting("tts_speed") or 1.0)
    pitch = project_settings.get("tts_pitch") or get_setting("tts_pitch") or "0"
    language = project_dict.get("language", "hi")

    if engine == "edge":
        voice = project_settings.get("tts_voice") or project_dict.get("tts_voice") or get_setting("tts_voice")
        if not voice:
            voice = "hi-IN-SwaraNeural" if language == "hi" else "en-US-AndrewNeural"
    elif engine == "piper":
        voice = project_settings.get("piper_voice") or project_dict.get("piper_voice") or get_setting("piper_voice") or "hi_IN-rohan"
    else:
        voice = project_settings.get("kokoro_voice") or project_dict.get("tts_voice") or get_setting("kokoro_voice") or "af_bella"

    return engine, speed, pitch, voice

def is_voiceover_stale(project_dict, project_dir):
    """Check if script hash or TTS settings changed, or voiceover.wav is missing."""
    voiceover_path = project_dir / "voiceover.wav"
    if not voiceover_path.exists():
        logger.info(f"voiceover stale: voiceover.wav missing at {voiceover_path}")
        return True
        
    manifest_path = project_dir / "voiceover" / "manifest.json"
    if not manifest_path.exists():
        logger.info(f"voiceover stale: manifest.json missing at {manifest_path}")
        return True
    
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        if not manifest:
            logger.info(f"voiceover stale: manifest is empty")
            return True
        
        first_entry = manifest[0]
        stored_hash = first_entry.get("_content_hash")
        
        script_path = project_dir / "script.json"
        if not script_path.exists():
            logger.info(f"voiceover stale: script.json missing at {script_path}")
            return True
            
        with open(script_path, "r", encoding="utf-8") as f:
            script_data = json.load(f)
            
        from backend.pipeline.assets import compute_script_content_hash
        current_hash = compute_script_content_hash(script_data)
        
        if stored_hash != current_hash:
            logger.info(f"voiceover stale: content hash mismatch stored={stored_hash} current={current_hash}")
            return True
            
        engine, speed, pitch, voice = _resolve_tts_settings(project_dict)
        
        stored_engine = first_entry.get("_voiceover_engine")
        stored_voice = first_entry.get("_voiceover_voice")
        
        if stored_engine != engine:
            logger.info(f"voiceover stale: engine mismatch stored={stored_engine} current={engine}")
            return True
        if stored_voice != voice:
            logger.info(f"voiceover stale: voice mismatch stored={stored_voice} current={voice}")
            return True
            
        try:
            stored_speed_val = float(first_entry.get("_voiceover_speed", 1.0))
            current_speed_val = float(speed)
            if stored_speed_val != current_speed_val:
                logger.info(f"voiceover stale: speed mismatch stored={stored_speed_val} current={current_speed_val}")
                return True
        except (ValueError, TypeError):
            if str(first_entry.get("_voiceover_speed", "1.0")) != str(speed):
                logger.info(f"voiceover stale: speed mismatch (str) stored={first_entry.get('_voiceover_speed')} current={speed}")
                return True

        try:
            stored_pitch_raw = str(first_entry.get("_voiceover_pitch", "0"))
            current_pitch_raw = str(pitch)
            # Normalize pitch values that may have "Hz" suffix (e.g. "0Hz", "-5Hz", "+5Hz")
            # or be plain numeric strings (e.g. "0", "-5")
            def _normalize_pitch(val: str) -> int:
                v = val.replace("Hz", "").replace("+", "").strip()
                return int(float(v))
            if _normalize_pitch(stored_pitch_raw) != _normalize_pitch(current_pitch_raw):
                logger.info(f"voiceover stale: pitch mismatch stored={stored_pitch_raw} current={current_pitch_raw}")
                return True
        except (ValueError, TypeError):
            if stored_pitch_raw != current_pitch_raw:
                logger.info(f"voiceover stale: pitch mismatch (str) stored={stored_pitch_raw} current={current_pitch_raw}")
                return True
            
    except Exception as e:
        logger.warning(f"Failed to verify voiceover staleness: {e}", exc_info=True)
        return True
        
    return False

def generate_voiceover_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Generates voiceover audio for each section (intro, scenes, conclusion)."""
    script_path = project_dir / "script.json"
    
    if not script_path.exists():
        raise FileNotFoundError("script.json not found. Run script generation first.")
        
    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)

    # 1. Flatten sections
    sections = []
    
    # Intro
    if script.get("introduction") and isinstance(script["introduction"], dict) and "hook" in script["introduction"]:
        sections.append({
            "type": "introduction",
            "title": "Introduction",
            "text": script["introduction"]["hook"]
        })
        
    # Scenes
    for scene in script.get("scenes", []) or []:
        scene_num = scene.get("scene_number", 0)
        sections.append({
            "type": "scene",
            "title": scene.get("title", f"Scene {scene_num}"),
            "text": scene.get("narration", "")
        })
        
    # Conclusion
    if script.get("conclusion") and isinstance(script["conclusion"], dict):
        conclusion_text = f"{script['conclusion'].get('summary', '')} {script['conclusion'].get('cta', '')}"
        sections.append({
            "type": "conclusion",
            "title": "Conclusion",
            "text": conclusion_text
        })

    voice_dir = project_dir / "voiceover"
    voice_dir.mkdir(parents=True, exist_ok=True)

    engine, speed, pitch, voice = _resolve_tts_settings(project_dict)
    language = project_dict.get("language", "hi")
    kokoro_lang = "hi" if language == "hi" else "en-us"

    temp_files = []
    manifest_entries = []
    total_sections = len(sections)

    for idx, sec in enumerate(sections):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        logger.info(f"Synthesizing section {idx+1}/{total_sections}: {sec['title']}")
        seg_file = voice_dir / f"segment_{idx:03d}.wav"
        
        # Synthesize audio segment
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            if engine == "kokoro":
                future = executor.submit(generate_kokoro_tts, sec['text'], str(seg_file), voice=voice, speed=speed, lang=kokoro_lang)
            elif engine == "piper":
                from backend.tts import generate_tts as piper_tts
                def _run_piper():
                    out_path = piper_tts(sec['text'], voice, speed=speed)
                    import shutil
                    shutil.move(out_path, str(seg_file))
                future = executor.submit(_run_piper)
            else:
                future = executor.submit(generate_edge_tts, sec['text'], str(seg_file), voice=voice, speed=str(speed), pitch=pitch)
                
            while not future.done():
                if cancel_event.is_set():
                    executor.shutdown(wait=False, cancel_futures=True)
                    raise InterruptedError("Cancelled")
                import time
                time.sleep(0.5)
            future.result()

        duration = get_audio_duration(str(seg_file))
        temp_files.append(str(seg_file))

        # Add manifest details
        # We need this manifest to pass scene parameters to Remotion!
        # In the script generated by LLM, each section contains sub_visuals array.
        # We will merge the narration audio details back into the script structure or task manifests.
        sub_visuals = []
        
        # Match back to the original script section
        if sec["type"] == "introduction":
            sub_visuals = script["introduction"].get("sub_visuals", [])
        elif sec["type"] == "conclusion":
            sub_visuals = script["conclusion"].get("sub_visuals", [])
        else:
            # Match scene list index
            scene_idx = idx - (1 if "introduction" in script else 0)
            if 0 <= scene_idx < len(script.get("scenes", [])):
                orig_scene = script["scenes"][scene_idx]
                sub_visuals = orig_scene.get("sub_visuals", [])

        # Ensure sub_visuals is a valid list
        if not isinstance(sub_visuals, list) or len(sub_visuals) == 0:
            sub_visuals = [{"visual_type": "scene", "visual_cue": sec["title"], "visual_meta": {}}]

        manifest_entries.append({
            "index": idx,
            "section_type": sec["type"],
            "title": sec["title"],
            "text": sec["text"],
            "audio_file": seg_file.name,
            "audio_path": str(seg_file),
            "duration": duration,
            "sub_visuals": sub_visuals
        })

        progress_cb(10.0 + (idx + 1) / total_sections * 70.0, f"Synthesizing voiceover... {idx + 1}/{total_sections}") # progress ranges 10% -> 80%

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # Merge into a single audio track
    merged_audio_path = project_dir / "voiceover.wav"
    concat_audio_files_ffmpeg(temp_files, str(merged_audio_path))
    
    # Save manifest with content hash for change detection on pipeline resume
    from backend.pipeline.assets import compute_script_content_hash
    content_hash = compute_script_content_hash(script)
    for entry in manifest_entries:
        if isinstance(entry, dict):
            entry["_content_hash"] = content_hash

    # Save voiceover settings so the frontend can detect TTS engine/voice changes
    # that aren't captured by the narration text hash. This ensures changing tts_engine
    # (e.g. edge→kokoro) or tts_voice triggers voiceover re-generation.
    # Stored as raw resolved values (not a hash) so the frontend can compare directly.
    for entry in manifest_entries:
        if isinstance(entry, dict):
            entry["_voiceover_engine"] = engine
            entry["_voiceover_voice"] = voice
            entry["_voiceover_speed"] = speed
            entry["_voiceover_pitch"] = pitch

    # Preserve visual_path/visual_url from existing manifest for unchanged sub-visuals.
    # This prevents re-downloading all assets when only voiceover is regenerated.
    # Matches sub-visuals by content (visual_type + visual_cue) rather than by
    # position, so it works correctly even when scenes are inserted or reordered.
    old_manifest_path = voice_dir / "manifest.json"
    if old_manifest_path.exists():
        try:
            with open(old_manifest_path, "r", encoding="utf-8") as f:
                old_manifest = json.load(f)

            for new_entry in manifest_entries:
                new_sub_visuals = new_entry.get("sub_visuals", [])

                # Find the best-matching old entry by counting how many sub-visuals
                # share the same content-determining fields (visual_type, visual_cue).
                best_old_entry = None
                best_match_count = -1
                for old_entry in old_manifest:
                    old_sub_visuals = old_entry.get("sub_visuals", [])
                    count = sum(
                        1 for nsv in new_sub_visuals
                        for osv in old_sub_visuals
                        if (nsv.get("visual_type") == osv.get("visual_type")
                            and nsv.get("visual_cue") == osv.get("visual_cue"))
                    )
                    if count > best_match_count:
                        best_match_count = count
                        best_old_entry = old_entry

                if best_old_entry is None or best_match_count < 1:
                    continue

                old_sub_visuals = best_old_entry.get("sub_visuals", [])
                for nsv in new_sub_visuals:
                    # Find the matching sub-visual by content within the chosen old entry
                    osv = next(
                        (osv for osv in old_sub_visuals
                         if (nsv.get("visual_type") == osv.get("visual_type")
                             and nsv.get("visual_cue") == osv.get("visual_cue")
                             and json.dumps(nsv.get("visual_meta", {}), sort_keys=True, default=str)
                             == json.dumps(osv.get("visual_meta", {}), sort_keys=True, default=str))),
                        None
                    )
                    if osv:
                        if osv.get("visual_path"):
                            nsv["visual_path"] = osv["visual_path"]
                        if osv.get("visual_url"):
                            nsv["visual_url"] = osv["visual_url"]
        except Exception as e:
            logger.warning(f"Could not preserve visual_path from old manifest: {e}")

    # Verify preserved visual_path files still exist on disk.
    # Scene insertion/deletion shifts array positions, and cleanup_removed_assets
    # deletes files at old positions. The content-matched preservation above may
    # have copied dangling references. Check each preserved path and update to
    # the new position filename if the old file was cleaned up.
    for entry in manifest_entries:
        scene_idx = entry.get("index", 0)
        for sub_idx, sv in enumerate(entry.get("sub_visuals", [])):
            vp = sv.get("visual_path", "")
            if vp and not Path(vp).exists():
                # Try the new position filename
                assets_dir = project_dir / "assets"
                found = False
                for ext in (".mp4", ".jpg", ".png", ".jpeg"):
                    candidate = assets_dir / f"asset_{scene_idx:03d}_{sub_idx:02d}{ext}"
                    if candidate.exists():
                        sv["visual_path"] = str(candidate)
                        sv["visual_url"] = ""  # Will be recomputed by render_pipeline
                        logger.info(f"Updated stale visual_path for [{scene_idx}:{sub_idx}] to {candidate}")
                        found = True
                        break
                if not found:
                    sv["visual_path"] = ""
                    sv["visual_url"] = ""
                    logger.info(f"Cleared stale visual_path for [{scene_idx}:{sub_idx}] - will re-download")

    manifest_path = voice_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_entries, f, indent=2, ensure_ascii=False)

    # Sync resolved voice back to the project so the frontend's voiceoverSettingsChanged()
    # comparison uses the same resolved value, not the DB-column default which may differ.
    update_project(
        project_dict['id'],
        audio_path=str(merged_audio_path),
        assets_manifest_path=str(manifest_path),  # Stores the video timeline details
        tts_engine=engine,  # Stores the resolved engine so DB column matches
        tts_voice=voice,    # Stores the resolved voice so DB column matches
    )
    
    progress_cb(100.0, "Voiceover generation complete!")
    logger.info(f"Voiceover generation completed. Merged track: {merged_audio_path}")
