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

def generate_edge_tts(text, output_path, voice="hi-IN-SwaraNeural", speed="1.0", pitch="0", cancel_event=None):
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
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")
        try:
            logger.info(f"Generating Edge-TTS (Attempt {attempt}). Voice: {voice}, Rate: {rate_str}")
            async def _async_gen():
                communicate = edge_tts.Communicate(cleaned_text, voice, rate=rate_str, pitch=pitch_str)
                if cancel_event is None:
                    await communicate.save(output_path)
                    return
                # Stream manually so cancellation can stop the download mid-flight
                # instead of waiting for the full response.
                with open(output_path, "wb") as f:
                    async for chunk in communicate.stream():
                        if cancel_event.is_set():
                            raise InterruptedError("Cancelled")
                        if chunk["type"] == "audio":
                            f.write(chunk["data"])
            try:
                asyncio.run(_async_gen())
            except InterruptedError:
                # Drop the partial audio so downstream duration checks don't
                # treat a truncated clip as valid.
                if os.path.exists(output_path):
                    os.unlink(output_path)
                raise
            return
        except InterruptedError:
            raise
        except Exception as e:
            logger.warning(f"Edge-TTS attempt {attempt} failed: {e}")
            if attempt == max_retries:
                raise e
            time.sleep(1.0 * attempt)



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
        # Guard against a tts_voice column polluted with an XTTS reference path
        # (older versions persisted it there); edge-tts would fail on that name.
        if not voice or not re.match(r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$", voice or ""):
            voice = "hi-IN-SwaraNeural" if language == "hi" else "en-US-AndrewNeural"
    elif engine == "xtts":
        # For XTTS, check if tts_voice points to an XTTS profile ID
        tts_voice_id = project_settings.get("tts_voice") or project_dict.get("tts_voice") or get_setting("tts_voice")
        xtts_profiles = get_setting("xtts_profiles") or []
        
        voice = None
        if xtts_profiles and tts_voice_id:
            for p in xtts_profiles:
                if p.get("id") == tts_voice_id:
                    voice = p.get("reference_voice")
                    break
        
        # Fallback to old global reference voice if profile not found or not set
        if not voice:
            voice = project_settings.get("xtts_reference_voice") or get_setting("xtts_reference_voice") or ""
    else:
        # Fallback to edge
        voice = project_settings.get("tts_voice") or project_dict.get("tts_voice") or get_setting("tts_voice") or "hi-IN-SwaraNeural"

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

        # A reference clip replaced in place keeps the same path; compare mtime so
        # re-recording over the same file also invalidates the voiceover.
        if engine == "xtts" and voice and Path(voice).exists():
            try:
                stored_mtime = first_entry.get("_voiceover_voice_mtime")
                if stored_mtime is not None and float(stored_mtime) != os.path.getmtime(voice):
                    logger.info(f"voiceover stale: reference voice mtime changed stored={stored_mtime} current={os.path.getmtime(voice)}")
                    return True
            except (OSError, ValueError, TypeError):
                pass
            
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
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            if engine == "xtts":
                from backend.xtts import generate_xtts_tts
                future = executor.submit(
                    generate_xtts_tts, sec['text'], str(seg_file),
                    speaker_wav=voice, language=language, speed=speed,
                    cancel_event=cancel_event,
                )
            else:
                future = executor.submit(
                    generate_edge_tts, sec['text'], str(seg_file),
                    voice=voice, speed=str(speed), pitch=pitch,
                    cancel_event=cancel_event,
                )

            while not future.done():
                if cancel_event.is_set():
                    # Do NOT call shutdown(wait=True) here — it would block
                    # until the running synthesis finishes. Cancel the queued
                    # future and let the worker thread abort at its next chunk
                    # boundary (both engines check cancel_event per chunk).
                    executor.shutdown(wait=False, cancel_futures=True)
                    raise InterruptedError("Cancelled")
                import time
                time.sleep(0.5)
            future.result()
        finally:
            # Safe: after a cancel the worker has already seen the event and is
            # exiting (chunk-granular), so this wait is short.
            executor.shutdown(wait=True)

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

        if not isinstance(sub_visuals, list) or len(sub_visuals) == 0:
            sub_visuals = [{"composition": {"type": "Sequence", "children": []}}]

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
    # (e.g. edge→xtts) or tts_voice triggers voiceover re-generation.
    # Stored as raw resolved values (not a hash) so the frontend can compare directly.
    for entry in manifest_entries:
        if isinstance(entry, dict):
            entry["_voiceover_engine"] = engine
            entry["_voiceover_voice"] = voice
            entry["_voiceover_speed"] = speed
            entry["_voiceover_pitch"] = pitch
            if engine == "xtts" and voice and Path(voice).exists():
                try:
                    entry["_voiceover_voice_mtime"] = os.path.getmtime(voice)
                except OSError:
                    pass

    # Preserve visual_path/visual_url from existing manifest for unchanged AST sub-visuals.
    # This prevents re-downloading assets when only voiceover is regenerated.
    old_manifest_path = voice_dir / "manifest.json"
    if old_manifest_path.exists():
        try:
            with open(old_manifest_path, "r", encoding="utf-8") as f:
                old_manifest = json.load(f)

            old_by_key = {}
            if isinstance(old_manifest, list):
                for old_entry in old_manifest:
                    if isinstance(old_entry, dict):
                        k = (old_entry.get("section_type"), (old_entry.get("text") or "").strip())
                        old_by_key[k] = old_entry

            for new_entry in manifest_entries:
                k = (new_entry.get("section_type"), (new_entry.get("text") or "").strip())
                old_entry = old_by_key.get(k)
                if old_entry and isinstance(old_entry, dict):
                    new_sub_visuals = new_entry.get("sub_visuals", [])
                    old_sub_visuals = old_entry.get("sub_visuals", [])
                    for j, nsv in enumerate(new_sub_visuals):
                        if j < len(old_sub_visuals):
                            osv = old_sub_visuals[j]
                            if osv.get("visual_path"):
                                nsv["visual_path"] = osv["visual_path"]
                            if osv.get("visual_url"):
                                nsv["visual_url"] = osv["visual_url"]
                            # Also copy local_path into AST composition layers if matching
                            n_comp = nsv.get("composition", {})
                            o_comp = osv.get("composition", {})
                            if n_comp.get("type") == "Sequence" and o_comp.get("type") == "Sequence":
                                n_children = n_comp.get("children", [])
                                o_children = o_comp.get("children", [])
                                for l_idx, n_layer in enumerate(n_children):
                                    if l_idx < len(o_children):
                                        o_layer = o_children[l_idx]
                                        o_content = o_layer.get("content", {})
                                        n_content = n_layer.get("content", {})
                                        if o_content.get("local_path") and not n_content.get("local_path"):
                                            n_content["local_path"] = o_content["local_path"]
        except Exception as e:
            logger.warning(f"Could not preserve visual_path from old manifest: {e}")

    # Verify preserved visual_path and AST layer local_path files still exist on disk.
    # Scene insertion/deletion shifts array positions, and cleanup_removed_assets
    # deletes files at old positions. The content-matched preservation above may
    # have copied dangling references. Check each preserved path and update to
    # the new position filename if the old file was cleaned up.
    from backend.pipeline.assets import KNOWN_MEDIA_EXTENSIONS
    assets_dir = project_dir / "assets"
    for entry in manifest_entries:
        scene_idx = entry.get("index", 0)
        for sub_idx, sv in enumerate(entry.get("sub_visuals", [])):
            vp = sv.get("visual_path", "")
            if vp and not Path(vp).exists():
                # Try the new position filename
                found = False
                for ext in KNOWN_MEDIA_EXTENSIONS:
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

            # Also verify AST composition layer local_paths
            comp = sv.get("composition", {})
            if isinstance(comp, dict) and comp.get("type") == "Sequence":
                for l_idx, layer in enumerate(comp.get("children", [])):
                    if isinstance(layer, dict):
                        content = layer.get("content", {})
                        if isinstance(content, dict):
                            lp = content.get("local_path", "")
                            if lp and not Path(lp).exists():
                                found = False
                                for ext in KNOWN_MEDIA_EXTENSIONS:
                                    candidate = assets_dir / f"asset_{scene_idx:03d}_{sub_idx:02d}_{l_idx:02d}{ext}"
                                    if candidate.exists():
                                        content["local_path"] = str(candidate)
                                        logger.info(f"Updated stale AST layer local_path for [{scene_idx}:{sub_idx}:{l_idx}] to {candidate}")
                                        found = True
                                        break
                                if not found:
                                    content.pop("local_path", None)
                                    logger.info(f"Cleared stale AST layer local_path for [{scene_idx}:{sub_idx}:{l_idx}] - will re-download")

    manifest_path = voice_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_entries, f, indent=2, ensure_ascii=False)

    # Post-completion cleanup:
    # 1. Purge excess segment audio files beyond total_sections from previous longer runs
    if voice_dir.exists():
        for f in voice_dir.iterdir():
            if f.is_file() and f.name.startswith("segment_") and (f.suffix.lower() in [".wav", ".mp3"]):
                m = re.match(r"segment_(\d+)", f.name)
                if m:
                    seg_num = int(m.group(1))
                    if seg_num >= total_sections:
                        try:
                            f.unlink()
                            logger.info(f"Purged excess voiceover audio file: {f.name}")
                        except Exception as e:
                            logger.warning(f"Could not delete excess segment {f.name}: {e}")

    # 2. Invalidate old transcription so downstream transcription stage generates fresh word timings
    transcription_file = project_dir / "subtitles" / "transcription.json"
    if transcription_file.exists():
        try:
            transcription_file.unlink()
            logger.info("Invalidated stale transcription.json on voiceover completion.")
        except Exception as e:
            logger.warning(f"Could not delete stale transcription.json: {e}")

    # Sync resolved settings back to the project so downstream staleness checks
    # and the UI read the same values that were actually used.
    if engine == "xtts":
        # Never persist the raw reference path into tts_voice: that column must
        # only ever hold an Edge voice name, otherwise switching the project back
        # to Edge would feed the path to edge-tts and break generation. Persist
        # the reference path in project_settings.xtts_reference_voice instead,
        # which is exactly where _resolve_tts_settings already looks for it.
        proj_settings = project_dict.get("project_settings")
        if isinstance(proj_settings, str):
            try:
                proj_settings = json.loads(proj_settings) or {}
            except Exception:
                proj_settings = {}
        proj_settings = dict(proj_settings or {})
        proj_settings["xtts_reference_voice"] = voice
        update_project(
            project_dict['id'],
            audio_path=str(merged_audio_path),
            assets_manifest_path=str(manifest_path),  # Stores the video timeline details
            tts_engine=engine,                        # Stores the resolved engine so DB column matches
            project_settings=json.dumps(proj_settings, ensure_ascii=False),
        )
    else:
        update_project(
            project_dict['id'],
            audio_path=str(merged_audio_path),
            assets_manifest_path=str(manifest_path),  # Stores the video timeline details
            tts_engine=engine,  # Stores the resolved engine so DB column matches
            tts_voice=voice,    # Stores the resolved voice so DB column matches
        )
    
    progress_cb(100.0, "Voiceover generation complete!")
    logger.info(f"Voiceover generation completed. Merged track: {merged_audio_path}")
