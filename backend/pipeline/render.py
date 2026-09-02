import os
import sys
import json
import re
import subprocess
import shutil
import hashlib
import math
import threading
from pathlib import Path
from backend.database.db import get_setting, update_project
from backend.core.config import get_temp_dir, get_node_path, get_remotion_cache_dir, get_startupinfo, is_production
from backend.core.logger import logger
from backend.pipeline.assets import normalize_video_asset

def clean_media_path(path_str):
    """Formats an absolute Windows path into a local file:/// URL."""
    if not path_str:
        return ""
    normalized = str(Path(path_str).resolve()).replace('\\', '/')
    return f"file:///{normalized}"


def _round_half_up(x):
    """Match JavaScript's Math.round (round half up), not Python's banker's rounding."""
    return int(math.floor(x + 0.5))


def compute_sub_visual_timings_frames(sub_visuals, scene_frames):
    """Replicate the frontend's calculateSubVisualTimings (utils/duration.ts)
    in frames so audio cut ranges and video-audio placement match the preview.
    Priority: duration_ratio (Adjust Durations) > per-sub duration > equal split.
    Returns a list of (start_frame, end_frame) per sub-visual."""
    num_subs = len(sub_visuals)
    if num_subs == 0:
        return []

    def is_valid_number(v):
        return (isinstance(v, (int, float))
                and not isinstance(v, bool)
                and not (isinstance(v, float) and math.isnan(v)))

    durations = [sv.get("duration") for sv in sub_visuals]
    all_durations_valid = all(is_valid_number(d) and d > 0 for d in durations)

    ratios = [sv.get("duration_ratio") for sv in sub_visuals]
    has_valid_ratios = (
        all(is_valid_number(r) for r in ratios)
        and abs(sum(ratios) - 1.0) < 0.01
    )

    current_offset = 0
    subs = []
    for idx in range(num_subs):
        if has_valid_ratios:
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
            else:
                sub_duration = max(1, _round_half_up(scene_frames * ratios[idx]))
        elif all_durations_valid:
            sub_duration = max(1, _round_half_up(durations[idx] * 30))
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
        else:
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
            else:
                sub_duration = max(1, math.floor(scene_frames / num_subs))
        sub_from = current_offset
        sub_end = sub_from + max(1, sub_duration)
        current_offset = sub_end
        subs.append((sub_from, sub_end))
    return subs


def scene_frame_offsets(scenes):
    """Yield (scene, scene_start_frame, scene_frames) per scene, replicating the
    composition's frame math: max(30, ceil(duration * 30)) per scene. The 30-frame
    minimum is applied per scene in the composition, so it must be replicated here
    or every later mute range drifts by the deficit."""
    offset = 0
    for sc in scenes:
        scene_frames = max(30, int(math.ceil(float(sc.get("duration") or 0.0) * 30)))
        yield sc, offset, scene_frames
        offset += scene_frames


def compute_granular_frame_hashes(props_dict, render_settings):
    """
    Computes global frame environment hash and per-scene frame hashes for granular cache invalidation.
    Returns:
      global_env_hash: str
      scene_records: list of dicts with {
        'index': i,
        'start_frame': start_frame,
        'end_frame': end_frame,
        'duration_frames': scene_frames,
        'scene_hash': hash_str
      }
    """
    global_env = {
        "subtitleSettings": props_dict.get("subtitleSettings", {}),
        "style": props_dict.get("style"),
        "language": props_dict.get("language"),
        "videoFormat": props_dict.get("videoFormat"),
        "fps": props_dict.get("fps"),
        "imageFormat": "jpeg",
        "resolution": render_settings.get("resolution"),
        "overlays": props_dict.get("overlays", []),
    }
    for k, ov in enumerate(global_env.get("overlays", [])):
        logo = ov.get("logo_url") if isinstance(ov, dict) else None
        if logo and isinstance(logo, str):
            clean_p = logo.replace("file:///", "").replace("file://", "")
            if os.path.exists(clean_p):
                stat = os.stat(clean_p)
                global_env[f"overlay_{k}_mtime"] = stat.st_mtime
                global_env[f"overlay_{k}_size"] = stat.st_size

    global_env_hash = hashlib.sha256(json.dumps(global_env, sort_keys=True).encode('utf-8')).hexdigest()

    scenes = props_dict.get("scenes", [])
    transcription = props_dict.get("transcription", {})
    segments = transcription.get("segments", []) if isinstance(transcription, dict) else []

    fps = props_dict.get("fps") or 30
    scene_records = []

    for sc, scene_start_frame, scene_frames in scene_frame_offsets(scenes):
        idx = len(scene_records)
        scene_start_sec = scene_start_frame / float(fps)
        scene_end_sec = (scene_start_frame + scene_frames) / float(fps)

        # Collect subtitle segments falling into this scene
        scene_segments = []
        for seg in segments:
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            if seg_start < scene_end_sec and seg_end > scene_start_sec:
                scene_segments.append(seg)

        scene_props = {
            "scene": sc,
            "segments": scene_segments,
            "scene_frames": scene_frames,
        }

        # Include mtimes of referenced sub-visuals
        for j, sv in enumerate(sc.get("sub_visuals", [])):
            path_str = sv.get("visual_path")
            if path_str and isinstance(path_str, str):
                clean_p = path_str.replace("file:///", "").replace("file://", "")
                if os.path.exists(clean_p):
                    stat = os.stat(clean_p)
                    scene_props[f"sv_{j}_mtime"] = stat.st_mtime
                    scene_props[f"sv_{j}_size"] = stat.st_size

        scene_hash = hashlib.sha256(json.dumps(scene_props, sort_keys=True).encode('utf-8')).hexdigest()
        scene_records.append({
            "index": idx,
            "start_frame": scene_start_frame,
            "end_frame": scene_start_frame + scene_frames - 1,
            "duration_frames": scene_frames,
            "scene_hash": scene_hash,
        })

    return global_env_hash, scene_records


def compute_frame_hash(props_dict, render_settings):
    """Hash of frame-relevant properties only (scenes, transcription, overlays, resolution, fps).
    Audio/encode settings don't affect pixel output, so they're excluded."""
    frame_props = {
        "scenes": props_dict["scenes"],
        "transcription": props_dict["transcription"],
        "subtitleSettings": props_dict.get("subtitleSettings", {}),
        "style": props_dict.get("style"),
        "language": props_dict.get("language"),
        "videoFormat": props_dict.get("videoFormat"),
        "fps": props_dict.get("fps"),
        "imageFormat": "jpeg",
        "resolution": render_settings.get("resolution"),
        "overlays": props_dict.get("overlays", []),
    }

    # Hash file contents/mtime rather than just string paths to detect in-place overwrites
    for i, sc in enumerate(frame_props["scenes"]):
        for j, sv in enumerate(sc.get("sub_visuals", [])):
            path_str = sv.get("visual_path")
            if path_str and isinstance(path_str, str):
                clean_p = path_str.replace("file:///", "").replace("file://", "")
                if os.path.exists(clean_p):
                    stat = os.stat(clean_p)
                    frame_props[f"visual_{i}_{j}_mtime"] = stat.st_mtime
                    frame_props[f"visual_{i}_{j}_size"] = stat.st_size

    for k, ov in enumerate(frame_props.get("overlays", [])):
        logo = ov.get("logo_url") if isinstance(ov, dict) else None
        if logo and isinstance(logo, str):
            clean_p = logo.replace("file:///", "").replace("file://", "")
            if os.path.exists(clean_p):
                stat = os.stat(clean_p)
                frame_props[f"overlay_{k}_mtime"] = stat.st_mtime
                frame_props[f"overlay_{k}_size"] = stat.st_size

    data_str = json.dumps(frame_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def compute_audio_hash(props_dict, render_settings):
    """Hash of audio-relevant properties only (bg_music, volumes, narration path, video audio).
    Scene visuals and encode settings don't affect the audio mix."""
    scene_durations = [sc.get("duration") for sc in props_dict.get("scenes", [])]
    mute_video_audio = props_dict.get("muteVideoAudio", False)
    audio_props = {
        "audioUrl": props_dict.get("audioUrl"),
        "bgMusicUrl": props_dict.get("bgMusicUrl"),
        "bgMusicVolume": props_dict.get("bgMusicVolume"),
        "voiceoverVolume": props_dict.get("voiceoverVolume"),
        "muteVideoAudio": mute_video_audio,
        "scene_durations": scene_durations,
    }

    # Collect video audio sources (only when not muted)
    video_audio_sources = []
    for sc, scene_start, scene_frames in scene_frame_offsets(props_dict.get("scenes", [])):
        sub_visuals = sc.get("sub_visuals", [])
        timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames)
        for sv, (t_start, t_end) in zip(sub_visuals, timings):
            vol = sv.get("videoVolume") or 0
            if not mute_video_audio and vol > 0:
                vpath = sv.get("visual_path") or ""
                video_audio_sources.append({
                    "path": vpath,
                    "volume": vol,
                    "start_time": (scene_start + t_start) / 30.0,
                    "duration": (t_end - t_start) / 30.0,
                })
    audio_props["videoAudioSources"] = video_audio_sources

    # Per-sub-visual audio cut flags (mute_voiceover / mute_bg_music) — toggling
    # them must invalidate the cached audio mix.
    audio_cuts = []
    for sc, scene_start, scene_frames in scene_frame_offsets(props_dict.get("scenes", [])):
        sub_visuals = sc.get("sub_visuals", [])
        timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames)
        for sv, (t_start, t_end) in zip(sub_visuals, timings):
            mv = sv.get("mute_voiceover")
            mb = sv.get("mute_bg_music")
            if mv or mb:
                audio_cuts.append({
                    "start": (scene_start + t_start) / 30.0,
                    "end": (scene_start + t_end) / 30.0,
                    "mute_voiceover": mv or False,
                    "mute_bg_music": mb or False,
                })
    audio_props["audioCuts"] = audio_cuts

    # Hash file contents/mtime rather than just string paths to detect in-place overwrites
    for key in ["audioUrl", "bgMusicUrl"]:
        url = audio_props[key]
        if url and url.startswith("file:///"):
            path_str = url[8:]
            if os.path.exists(path_str):
                stat = os.stat(path_str)
                audio_props[f"{key}_mtime"] = stat.st_mtime
                audio_props[f"{key}_size"] = stat.st_size

    for vas in video_audio_sources:
        path_str = vas["path"]
        if path_str and os.path.exists(path_str):
            stat = os.stat(path_str)
            vas["mtime"] = stat.st_mtime
            vas["size"] = stat.st_size

    data_str = json.dumps(audio_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def compute_mux_hash(frame_hash, audio_hash, render_settings):
    """Hash of final-output encoding parameters (CRF, codec, hardware).
    These don't affect source material (frames/audio), only the compressed output."""
    mux_props = {
        "frame_hash": frame_hash,
        "audio_hash": audio_hash,
        "crf": render_settings.get("crf"),
        "codec": render_settings.get("codec"),
        "hardware": render_settings.get("hardware"),
    }
    data_str = json.dumps(mux_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def get_missing_frame_ranges(frames_dir, total_frames, target_ext="jpeg"):
    """Finds all missing frame ranges from 0 to total_frames - 1."""
    if not frames_dir.exists():
        return f"0-{total_frames - 1}"
    
    existing_frames = set()
    valid_exts = {target_ext, "jpg" if target_ext == "jpeg" else target_ext}

    for f in list(frames_dir.glob("element-*.*")):
        if f.stat().st_size == 0:
            # Clean up corrupted 0-byte frames so FFmpeg doesn't choke on them later
            try:
                f.unlink()
            except OSError:
                pass
            continue

        match = re.search(r"element-(\d+)\.([a-zA-Z0-9]+)$", f.name)
        if not match:
            continue

        frame_num = int(match.group(1))
        ext = match.group(2).lower()

        # If leftover frame beyond total_frames or wrong format, remove it
        if frame_num >= total_frames or ext not in valid_exts:
            try:
                f.unlink()
            except OSError:
                pass
        else:
            existing_frames.add(frame_num)
            
    missing_ranges = []
    start = None
    
    for i in range(total_frames):
        if i not in existing_frames:
            if start is None:
                start = i
        else:
            if start is not None:
                missing_ranges.append(f"{start}-{i - 1}")
                start = None
                
    if start is not None:
        missing_ranges.append(f"{start}-{total_frames - 1}")
        
    if not missing_ranges:
        return ""
        
    return ",".join(missing_ranges)

def _cancel_pipe_read(stdout):
    """Cancel a pending blocking read on a pipe handle (Windows only).

    A reader thread blocked in read(1) cannot be unblocked by closing the
    stream from another thread: on Windows both process.stdout.close() and
    os.close(fd) block until the pending read completes, which just moves
    the hang to the caller. CancelIoEx aborts the pending ReadFile so the
    reader wakes with an error and exits. Returns True on success."""
    try:
        import ctypes
        import msvcrt
        handle = msvcrt.get_osfhandle(stdout.fileno())
        return bool(ctypes.windll.kernel32.CancelIoEx(ctypes.c_void_p(handle), None))
    except Exception:
        return False


def _stream_process_output(process, cancel_event, line_callback, label="Process"):
    """Helper to stream subprocess output line by line, handle cancellation, and collect error context.

    Reading happens on a daemon thread: a blocking pipe read would otherwise hang
    forever when a grandchild (e.g. headless Chromium) keeps stdout open after the
    main process has already exited, leaving the whole pipeline stuck.

    Note: line_callback (and anything it calls, e.g. progress_cb) executes on the
    reader thread, not the caller's thread. It must only touch thread-safe targets
    (ui_queue.put, per-call SQLite connections).
    """
    last_output_lines = []
    lines_lock = threading.Lock()

    def reader():
        buffer = ""
        while True:
            try:
                char = process.stdout.read(1)
            except Exception:
                break
            if not char:
                break
            if char in ('\r', '\n'):
                line = buffer
                buffer = ""
                stripped = line.strip()
                if not stripped:
                    continue
                with lines_lock:
                    last_output_lines.append(stripped)
                    if len(last_output_lines) > 20:
                        last_output_lines.pop(0)
                line_callback(stripped)
            else:
                buffer += char

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    try:
        while not cancel_event.is_set():
            try:
                process.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                continue

        if cancel_event.is_set():
            logger.warning(f"{label} cancelled by user. Terminating process.")
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
            raise InterruptedError("Cancelled")
    finally:
        # The process has exited — give the reader a moment to flush remaining
        # lines, but never block on pipe EOF (see docstring). If a grandchild
        # (e.g. headless Chromium) keeps the write end of the pipe open, the
        # reader never sees EOF and would stay blocked forever: cancel the
        # pending read on Windows so the thread can exit. On other platforms
        # (where this scenario cannot be interrupted) the daemon thread is
        # left to drain when the pipe eventually closes.
        reader_thread.join(timeout=2.0)
        if reader_thread.is_alive():
            _cancel_pipe_read(process.stdout)
            reader_thread.join(timeout=1.0)
        # Snapshot under the lock so the returned list is never touched by the
        # reader afterwards (it may still be draining the pipe).
        with lines_lock:
            tail = list(last_output_lines)

    return process.returncode, tail

def render_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Compiles the React Remotion canvas into an MP4 file using resumable frame rendering."""
    manifest_path = Path(project_dict['assets_manifest_path'])
    transcribe_path = Path(project_dict['transcription_path'])
    audio_path = Path(project_dict['audio_path'])

    if not manifest_path.exists():
        raise FileNotFoundError(f"Segment manifest not found: {manifest_path}")
    if not transcribe_path.exists():
        raise FileNotFoundError(f"Whisper transcript not found: {transcribe_path}")
    if not audio_path.exists():
        raise FileNotFoundError(f"Narration track not found: {audio_path}")

    logger.info(f"Preparing Remotion compilation properties for project: {project_dict['name']}")
    progress_cb(5.0, "Preparing compilation properties...")

    # 1. Load manifests
    with open(manifest_path, "r", encoding="utf-8") as f:
        scenes = json.load(f)
    with open(transcribe_path, "r", encoding="utf-8") as f:
        transcript = json.load(f)

    # Sync live sub_visuals and global overlays from script.json if available
    from backend.pipeline.assets import _has_meaningful_sub_visuals
    script_path = project_dir / "script.json"
    overlays = []
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script_data = json.load(f)
            script_scenes = script_data.get("scenes", []) if isinstance(script_data.get("scenes"), list) else []
            scene_counter = 0
            for sc in scenes:
                sec_type = sc.get("section_type")
                if sec_type == "introduction" and script_data.get("introduction"):
                    subs = script_data["introduction"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                        if subs:
                            sc["sub_visuals"] = subs
                elif sec_type == "conclusion" and script_data.get("conclusion"):
                    subs = script_data["conclusion"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                        if subs:
                            sc["sub_visuals"] = subs
                elif sec_type == "scene":
                    if scene_counter < len(script_scenes):
                        script_scene = script_scenes[scene_counter]
                        subs = script_scene.get("sub_visuals")
                        if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                            if subs:
                                sc["sub_visuals"] = subs
                    scene_counter += 1

            raw_overlays = script_data.get("overlays", [])
            if isinstance(raw_overlays, list):
                overlays = raw_overlays
        except Exception as e:
            logger.warning(f"Could not merge script.json into render scenes/overlays: {e}")

    # Strip internal pipeline metadata (_content_hash, _voiceover_*) that doesn't affect
    # rendering output. This prevents metadata changes (e.g. first save after hash system
    # was introduced, or TTS engine/voice changes) from invalidating the render cache.
    for sc in scenes:
        sc.pop("_content_hash", None)
        sc.pop("_voiceover_engine", None)
        sc.pop("_voiceover_voice", None)
        sc.pop("_voiceover_speed", None)
        sc.pop("_voiceover_pitch", None)

    # Convert local absolute paths in scenes/audios into Bottle media serving URLs & normalize video assets
    for sc in scenes:
        sc["audio_url"] = clean_media_path(sc["audio_path"])
        
        sub_visuals = sc.get("sub_visuals", [])
        
        for sv in sub_visuals:
            if sv.get("visual_path"):
                sv["visual_path"] = normalize_video_asset(sv["visual_path"])
                sv["visual_url"] = clean_media_path(sv["visual_path"])
            else:
                sv["visual_url"] = ""

            # Normalize AST composition layers
            comp = sv.get("composition", {})
            if isinstance(comp, dict) and comp.get("type") == "Sequence":
                for layer in comp.get("children", []):
                    content = layer.get("content", {})
                    if content.get("type") == "Video" and content.get("local_path"):
                        content["local_path"] = normalize_video_asset(content["local_path"])
        
        sc["sub_visuals"] = sub_visuals

    # Clean local media paths in global overlays (e.g. watermark logo_url)
    cleaned_overlays = []
    for item in overlays:
        if isinstance(item, dict):
            item_copy = dict(item)
            if item_copy.get("logo_url"):
                item_copy["logo_url"] = clean_media_path(item_copy["logo_url"])
            cleaned_overlays.append(item_copy)

    bg_music_url = ""
    bg_path_str = project_dict.get("bg_music_path")
    if bg_path_str:
        if Path(bg_path_str).exists():
            bg_music_url = clean_media_path(bg_path_str)
        else:
            logger.warning(f"Background music file not found at {bg_path_str}. Proceeding without background music.")

    project_settings = {}
    if project_dict.get("project_settings"):
        try:
            project_settings = json.loads(project_dict["project_settings"])
        except Exception as e:
            logger.error(f"Failed to parse project_settings: {e}")

    # ── Track visibility overrides ─────────────────────────────────────────
    # When the user hides/mutes tracks in the timeline UI, these overrides
    # make the final rendered video reflect those choices.
    render_track_overrides = {
        "muteVoice": project_settings.get("render_mute_voice", False),
        "muteMusic": project_settings.get("render_mute_music", False),
        "muteVideoAudio": project_settings.get("render_mute_video_audio", False),
        "hideSubtitles": project_settings.get("render_hide_subtitles", False),
        "hideOverlays": project_settings.get("render_hide_overlays", False),
    }

    # Fetch rendering settings — project_settings override global defaults
    render_resolution = project_settings.get("render_resolution") or get_setting("render_resolution") or "1080p"
    render_concurrency = project_settings.get("render_concurrency") or get_setting("render_concurrency") or "logical"
    render_fps = project_settings.get("render_fps") or get_setting("render_fps") or "30"
    render_crf = project_settings.get("render_crf") or get_setting("render_crf") or "18"
    render_codec = project_settings.get("render_codec") or get_setting("render_codec") or "h264"
    render_hardware = project_settings.get("render_hardware") or get_setting("render_hardware") or "cpu"
    render_timeout = project_settings.get("render_timeout") or get_setting("render_timeout") or "600000"

    fps = int(render_fps)
    timeout_ms = int(render_timeout)

    props = {
        "audioUrl": clean_media_path(str(audio_path)),
        "bgMusicUrl": bg_music_url,
        "bgMusicVolume": float(project_dict.get("bg_music_volume") or 0.15),
        "voiceoverVolume": float(project_settings.get("voiceover_volume") or 1.0),
        "muteVideoAudio": False,
        "scenes": scenes,
        "transcription": transcript,
        "style": project_dict.get("style", "nitish_rajput"),
        "language": project_dict.get("language", "hi"),
        "videoFormat": project_dict.get("video_format", "landscape"),
        "fps": fps,
        "subtitleSettings": project_settings,
        "overlays": cleaned_overlays,
    }

    # Apply track visibility overrides to render props
    if render_track_overrides["muteVoice"]:
        props["voiceoverVolume"] = 0.0
        logger.info("Smart Resume: Voiceover muted by track override.")
    if render_track_overrides["muteMusic"]:
        props["bgMusicVolume"] = 0.0
        props["bgMusicUrl"] = ""
        logger.info("Smart Resume: Background music muted by track override.")
    if render_track_overrides["muteVideoAudio"]:
        props["muteVideoAudio"] = True
        logger.info("Smart Resume: Video audio muted by track override.")
    if render_track_overrides["hideSubtitles"]:
        if isinstance(props.get("subtitleSettings"), dict):
            props["subtitleSettings"]["hide_subtitles"] = True
        else:
            props["subtitleSettings"] = {"hide_subtitles": True}
        logger.info("Smart Resume: Subtitles hidden by track override.")
    if render_track_overrides["hideOverlays"]:
        props["overlays"] = []
        logger.info("Smart Resume: Overlays hidden by track override.")

    # Write props to a JSON file
    props_path = project_dir / "render_props.json"
    with open(props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, indent=2, ensure_ascii=False)

    logger.info(f"Wrote render props to {props_path}")

    render_settings = {
        "resolution": render_resolution,
        "concurrency": render_concurrency,
        "fps": fps,
        "crf": render_crf,
        "codec": render_codec,
        "hardware": render_hardware
    }

    # Compute three domain-specific hashes
    frame_hash = compute_frame_hash(props, render_settings)
    audio_hash = compute_audio_hash(props, render_settings)
    mux_hash = compute_mux_hash(frame_hash, audio_hash, render_settings)

    cache_dir = project_dir / "render_cache"
    frames_dir = cache_dir / "frames"
    cached_audio_path = cache_dir / "audio.wav"

    old_hash_file = cache_dir / "hash.txt"
    frame_hash_file = cache_dir / "frame.hash.txt"
    audio_hash_file = cache_dir / "audio.hash.txt"
    mux_hash_file = cache_dir / "mux.hash.txt"

    # ── Migration from old single-hash system ──────────────────────────────
    if old_hash_file.exists() and not frame_hash_file.exists():
        old_hash = old_hash_file.read_text().strip()
        combined_hash = hashlib.sha256(
            json.dumps({"props": props, "settings": render_settings}, sort_keys=True).encode('utf-8')
        ).hexdigest()
        if old_hash == combined_hash:
            logger.info("Migrating old single-hash cache to multi-hash system.")
            frame_hash_file.write_text(frame_hash)
            audio_hash_file.write_text(audio_hash)
            mux_hash_file.write_text(mux_hash)
        else:
            logger.info("Old cache hash mismatch during migration. Invalidating all caches.")
            shutil.rmtree(cache_dir, ignore_errors=True)
        old_hash_file.unlink(missing_ok=True)

    # ── Ensure cache root exists ───────────────────────────────────────────
    cache_dir.mkdir(parents=True, exist_ok=True)

    # ── Granular Scene-Level Frame Cache Check ────────────────────────────
    scene_cache_file = cache_dir / "scene_hashes.json"
    global_env_hash, current_scene_records = compute_granular_frame_hashes(props, render_settings)

    if scene_cache_file.exists() and frames_dir.exists():
        try:
            with open(scene_cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            cached_global_hash = cached_data.get("global_env_hash")
            cached_scenes = cached_data.get("scenes", [])

            if cached_global_hash == global_env_hash:
                # Global environment matches! We can do granular scene-level invalidation
                cached_scene_map = {s["index"]: s for s in cached_scenes if isinstance(s, dict) and "index" in s}
                invalidated_scene_count = 0
                reused_scene_count = 0

                for curr_s in current_scene_records:
                    s_idx = curr_s["index"]
                    prev_s = cached_scene_map.get(s_idx)
                    # If scene hash changed or start/end frame boundary shifted:
                    if (not prev_s or 
                        prev_s.get("scene_hash") != curr_s["scene_hash"] or 
                        prev_s.get("start_frame") != curr_s["start_frame"] or 
                        prev_s.get("end_frame") != curr_s["end_frame"]):
                        
                        invalidated_scene_count += 1
                        ranges_to_delete = []
                        if prev_s:
                            ranges_to_delete.append((prev_s.get("start_frame", 0), prev_s.get("end_frame", 0)))
                        ranges_to_delete.append((curr_s["start_frame"], curr_s["end_frame"]))

                        for r_start, r_end in ranges_to_delete:
                            for f_num in range(r_start, r_end + 1):
                                for p in (f"element-{f_num}.jpeg", f"element-{f_num}.jpg", f"element-{f_num}.webp",
                                          f"element-{f_num:04d}.jpeg", f"element-{f_num:05d}.jpeg", f"element-{f_num:06d}.jpeg",
                                          f"element-{f_num:04d}.webp", f"element-{f_num:05d}.webp"):
                                    f_path = frames_dir / p
                                    if f_path.exists():
                                        try: f_path.unlink()
                                        except OSError: pass
                        logger.info(f"Smart Resume: Invalidated cached frames for modified Scene {s_idx} (frames {curr_s['start_frame']}-{curr_s['end_frame']}).")
                    else:
                        reused_scene_count += 1
                        logger.info(f"Smart Resume: Reusing cached frames for unchanged Scene {s_idx} (frames {curr_s['start_frame']}-{curr_s['end_frame']}).")

                # Remove any leftover frames from scenes that were deleted
                if len(cached_scenes) > len(current_scene_records):
                    for old_s in cached_scenes[len(current_scene_records):]:
                        for f_num in range(old_s.get("start_frame", 0), old_s.get("end_frame", 0) + 1):
                            for p in (f"element-{f_num}.jpeg", f"element-{f_num}.jpg", f"element-{f_num}.webp",
                                      f"element-{f_num:04d}.jpeg", f"element-{f_num:05d}.jpeg", f"element-{f_num:06d}.jpeg"):
                                f_path = frames_dir / p
                                if f_path.exists():
                                    try: f_path.unlink()
                                    except OSError: pass

                existing_count = sum(len(list(frames_dir.glob(p))) for p in ("element-*.jpeg", "element-*.jpg", "element-*.webp"))
                logger.info(f"Smart Resume granular cache: {reused_scene_count} scenes reused, {invalidated_scene_count} scenes marked for re-render. {existing_count} cached frames on disk.")
            else:
                logger.info("Smart Resume: Global render environment changed (overlays/resolution/styles). Invalidating all frame caches.")
                shutil.rmtree(frames_dir, ignore_errors=True)
                frames_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Error evaluating granular scene cache: {e}. Falling back to full frame cache check.")
            shutil.rmtree(frames_dir, ignore_errors=True)
            frames_dir.mkdir(parents=True, exist_ok=True)
    elif frame_hash_file.exists() and frame_hash_file.read_text().strip() == frame_hash:
        existing_count = sum(len(list(frames_dir.glob(p))) for p in ("element-*.jpeg", "element-*.jpg", "element-*.webp"))
        logger.info(f"Frame hash matches. {existing_count} cached frames found. Will resume from missing ranges.")
    else:
        logger.info("No valid granular frame cache found. Creating new frame cache.")
        if frames_dir.exists():
            shutil.rmtree(frames_dir, ignore_errors=True)
        frames_dir.mkdir(parents=True, exist_ok=True)

    frame_hash_file.write_text(frame_hash)

    # ── Audio cache check ─────────────────────────────────────────────────
    audio_cache_valid = False
    if audio_hash_file.exists() and cached_audio_path.exists():
        if audio_hash_file.read_text().strip() == audio_hash:
            audio_cache_valid = True
            logger.info("Audio hash matches. Will reuse cached audio.")

    if not audio_cache_valid:
        logger.info("Audio cache invalid or missing. Will re-render audio.")
        if cached_audio_path.exists():
            cached_audio_path.unlink()

    # ── Mux hash tracking ──────────────────────────────────────────────────
    mux_hash_file.write_text(mux_hash)

    # ── Smart Resume summary ───────────────────────────────────────────────
    overrides_active = [k for k, v in render_track_overrides.items() if v]
    if overrides_active:
        logger.info(f"Smart Resume: Active track overrides: {overrides_active}")

    total_duration = sum(float(sc.get("duration") or 0.0) for sc in scenes)
    import math
    total_frames = max(fps * 5, math.ceil(total_duration * fps))
    # Define output paths
    if project_dict.get('export_folder'):
        exports_dir = Path(project_dict['export_folder'])
    else:
        from backend.core.config import get_exports_dir
        exports_dir = get_exports_dir()
        
    exports_dir.mkdir(parents=True, exist_ok=True)
    
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', project_dict['name'])
    output_mp4_path = exports_dir / f"{safe_name}.mp4"

    frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
    render_script = frontend_dir / "dist-render" / "render.mjs"
    if not render_script.exists():
        render_script = frontend_dir / "src" / "render.mjs"
    if not render_script.exists():
        raise FileNotFoundError(f"Render script not found: {render_script}")
        
    bundle_dir = frontend_dir / "dist-remotion"
    abs_bundle_dir = str(bundle_dir.resolve()).replace('\\', '/')
    abs_props_path = str(props_path.resolve()).replace('\\', '/')
    



    if render_concurrency in ["logical", "100%"]:
        concurrency_arg = "100%"
    elif render_concurrency in ["physical", "50%"]:
        concurrency_arg = "50%"
    elif render_concurrency in ["25%", "75%"]:
        concurrency_arg = render_concurrency
    else:
        concurrency_arg = render_concurrency
    
    scale_map = {"720p": "0.6666666666666666", "1080p": "1", "1440p": "1.3333333333333333", "4k": "2"}
    scale_arg = scale_map.get(render_resolution.lower(), "1")

    node_exe = get_node_path()
    bin_dir = frontend_dir.parent / "bin"
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"

    # Closure variable for mapping Remotion sub-range progress to overall frame progress
    # when resuming from cached frames. Set before the Frames rendering call; stays 0
    # for Audio phase and any non-Frames mode where there's no sub-range to offset.
    first_missing_frame_pct = 0.0

    def run_node_process(cmd, progress_weight, base_progress, label):
        import psutil
        total_ram_mb = psutil.virtual_memory().total / (1024 * 1024)
        node_ram_mb = min(8192, max(2048, int(total_ram_mb * 0.75)))
        
        env = os.environ.copy()
        env["NODE_OPTIONS"] = f"--max-old-space-size={node_ram_mb}"
        remotion_cache_dir = get_remotion_cache_dir()

        # In production, redirect cwd to a writable directory so Remotion's
        # getDownloadsCacheDir() doesn't try to create .remotion inside the
        # read-only Program Files installation directory.
        # Also place an anchor package.json so Remotion's root-finding walk
        # stops here instead of traversing up to a read-only parent.
        if is_production():
            node_cwd = str(remotion_cache_dir)
            anchor_pkg = remotion_cache_dir / "package.json"
            if not anchor_pkg.exists():
                anchor_pkg.write_text('{"name":"remotion-cache","private":true}')
        else:
            node_cwd = str(frontend_dir)
        
        startupinfo = get_startupinfo()

        process = subprocess.Popen(
            cmd,
            cwd=node_cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            universal_newlines=True,
            startupinfo=startupinfo,
            env=env
        )

        progress_regex = re.compile(r"Render progress:\s*([\d.]+)%")
        bundle_regex = re.compile(r"Bundle ready in")

        try:
            def handle_line(stripped):
                progress_match = progress_regex.search(stripped)
                
                skip_log = False
                if progress_match:
                    pct_val = float(progress_match.group(1))
                    if not hasattr(run_node_process, '_last_logged_pct'):
                        run_node_process._last_logged_pct = -1
                    if abs(pct_val - run_node_process._last_logged_pct) < 5.0 and pct_val < 100:
                        skip_log = True
                    else:
                        run_node_process._last_logged_pct = pct_val

                if not skip_log:
                    logger.info(f"[{label}]: {stripped}")
                    
                if progress_match:
                    pct_val = float(progress_match.group(1))
                    # Map Remotion sub-range progress to overall frame progress so the
                    # displayed percentage reflects all frames, not just the missing range.
                    # E.g. when resuming from frame 2250 of 11701, the first progress
                    # shows ~19.2% instead of 0.0%.
                    overall_pct = first_missing_frame_pct + (pct_val / 100.0) * (100.0 - first_missing_frame_pct)
                    pct = base_progress + (overall_pct / 100.0) * progress_weight
                    progress_cb(min(99.0, pct), f"Rendering {label.lower()}... {overall_pct:.1f}%")
                elif bundle_regex.search(stripped):
                    progress_cb(base_progress, f"Bundling complete. Starting {label.lower()} render...")

            returncode, last_output_lines = _stream_process_output(process, cancel_event, handle_line, label)

            if hasattr(run_node_process, '_last_logged_pct'):
                del run_node_process._last_logged_pct

            if returncode != 0:
                error_details = "\n".join(last_output_lines)
                raise RuntimeError(f"{label} process failed with exit code {returncode}.\nLast output:\n{error_details}")

        except Exception as e:
            raise e

    def run_ffmpeg(cmd, base_progress, progress_weight):
        startupinfo = get_startupinfo()
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            universal_newlines=True,
            startupinfo=startupinfo
        )
        
        frame_regex = re.compile(r"frame=\s*(\d+)")
        last_logged_pct = [-1]
        
        def handle_line(stripped):
            match = frame_regex.search(stripped)
            if match and total_frames > 0:
                f = int(match.group(1))
                pct_val = min(100.0, (f / total_frames) * 100.0)
                if pct_val - last_logged_pct[0] >= 5.0 or pct_val >= 100:
                    last_logged_pct[0] = pct_val
                    logger.info(f"[FFmpeg]: {stripped}")
                    
                pct = base_progress + (pct_val / 100.0) * progress_weight
                progress_cb(min(99.0, pct), f"Muxing video... {pct_val:.1f}%")

        returncode, last_output_lines = _stream_process_output(process, cancel_event, handle_line, "FFmpeg")
                
        if returncode != 0:
            error_details = "\n".join(last_output_lines)
            raise RuntimeError(f"FFmpeg failed with exit code {returncode}.\nLast output:\n{error_details}")

    base_node_cmd = [
        node_exe,
        str(render_script),
        "--props", abs_props_path,
        "--fps", str(fps),
        "--codec", render_codec,
        "--crf", str(render_crf),
        "--scale", scale_arg,
        "--concurrency", concurrency_arg,
        "--bundle-dir", abs_bundle_dir,
        "--timeout", str(timeout_ms),
    ]
    if ffmpeg_exe.exists(): base_node_cmd.extend(["--ffmpeg", str(ffmpeg_exe.resolve())])
    if ffprobe_exe.exists(): base_node_cmd.extend(["--ffprobe", str(ffprobe_exe.resolve())])
    if render_hardware == "cuda": base_node_cmd.extend(["--hw-accel", "if-possible"])
    else: base_node_cmd.extend(["--hw-accel", "disable"])

    # Phase 1: Render Frames
    missing_ranges_str = get_missing_frame_ranges(frames_dir, total_frames)
    
    # Broadcast the exact scope to the frontend via progress_cb
    scope_msg = "[Smart Resume] Scope: "
    if missing_ranges_str and not audio_cache_valid:
        scope_msg += "Full re-render"
    elif missing_ranges_str and audio_cache_valid:
        scope_msg += "Frames-only re-render"
    elif not missing_ranges_str and not audio_cache_valid:
        scope_msg += "Audio-only re-render"
    else:
        scope_msg += "Fast mux only"
    
    progress_cb(5.0, scope_msg)

    if missing_ranges_str:
        # Compute the overall frame progress offset so the progress display reflects all
        # frames, not just the sub-range being rendered now.
        try:
            first_missing = int(missing_ranges_str.split(",")[0].split("-")[0])
            first_missing_frame_pct = (first_missing / total_frames) * 100.0 if total_frames > 0 else 0.0
        except (ValueError, IndexError):
            first_missing_frame_pct = 0.0

        progress_cb(10.0, "Starting frame rendering...")
        cmd_frames = list(base_node_cmd)
        cmd_frames.extend([
            "--mode", "frames",
            "--frames-dir", str(frames_dir.resolve()).replace('\\', '/')
        ])
        cmd_frames.extend(["--frames", missing_ranges_str])
        
        logger.info(f"Executing frames render: {' '.join(cmd_frames)}")
        run_node_process(cmd_frames, progress_weight=70.0, base_progress=10.0, label="Frames")
    else:
        logger.info("All frames already rendered. Skipping frame render phase.")
        progress_cb(80.0, "All frames already rendered.")

    # ── Persist Granular Scene Hashes ──────────────────────────────────────
    try:
        with open(scene_cache_file, "w", encoding="utf-8") as f:
            json.dump({
                "global_env_hash": global_env_hash,
                "scenes": current_scene_records
            }, f, indent=2)
    except Exception as e:
        logger.warning(f"Failed to persist scene_hashes.json: {e}")

    # ── Log Smart Resume render scope ──────────────────────────────────────
    frames_actually_rendered = bool(missing_ranges_str)
    summary_parts = []
    if not frames_actually_rendered:
        summary_parts.append("frames cached")
    else:
        summary_parts.append("frames re-rendered")
    if audio_cache_valid:
        summary_parts.append("audio cached")
    else:
        summary_parts.append("audio re-rendering")
    if overrides_active:
        summary_parts.append(f"overrides: {', '.join(overrides_active)}")
    logger.info(f"Smart Resume render scope: {' | '.join(summary_parts)}")

    # Reset the frame progress offset — the Audio phase has no cached sub-range to offset.
    first_missing_frame_pct = 0.0

    # Phase 2: Render Audio (only if cache invalid)
    if not audio_cache_valid:
        progress_cb(80.0, "Extracting audio track (FFmpeg fast mix)...")
        
        voice_path = str(audio_path.resolve())
        bg_path_str = project_dict.get("bg_music_path")
        bg_path = str(Path(bg_path_str).resolve()) if bg_path_str and Path(bg_path_str).exists() else None
        
        voice_vol = float(project_settings.get("voiceover_volume") or 1.0)
        bg_vol = float(project_dict.get("bg_music_volume") or 0.15)
        
        if render_track_overrides.get("muteVoice"):
            voice_vol = 0.0
        if render_track_overrides.get("muteMusic"):
            bg_vol = 0.0
        mute_video_audio = render_track_overrides.get("muteVideoAudio", False)

        # ── Collect video audio sources from sub-visuals ──────────────────
        video_audio_tracks = []
        # Per-sub-visual audio cut ranges (seconds): mute_voiceover / mute_bg_music
        voice_cuts = []  # (start_sec, end_sec)
        bg_cuts = []     # (start_sec, end_sec)
        for sc, scene_start, scene_frames in scene_frame_offsets(scenes):
            sub_visuals = sc.get("sub_visuals", [])
            timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames)
            for sv, (t_start, t_end) in zip(sub_visuals, timings):
                vol = sv.get("videoVolume") or 0
                if not mute_video_audio and vol > 0:
                    vpath = sv.get("visual_path") or ""
                    if vpath and Path(vpath).exists() and vpath.lower().endswith(('.mp4', '.webm')):
                        video_audio_tracks.append({
                            "path": vpath,
                            "volume": float(vol),
                            "start_time": (scene_start + t_start) / 30.0,
                        })
                if sv.get("mute_voiceover"):
                    voice_cuts.append(((scene_start + t_start) / 30.0, (scene_start + t_end) / 30.0))
                if sv.get("mute_bg_music"):
                    bg_cuts.append(((scene_start + t_start) / 30.0, (scene_start + t_end) / 30.0))

        ffmpeg_bin = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
        
        cmd_audio = [ffmpeg_bin, "-y"]
        
        # ── Add inputs ────────────────────────────────────────────────────
        # Input 0: voiceover
        cmd_audio.extend(["-i", voice_path])
        input_count = 1

        # Input 1: bg music (if present)
        has_bg = bg_path and bg_vol > 0
        if has_bg:
            cmd_audio.extend(["-stream_loop", "-1", "-i", bg_path])
            input_count = 2

        # Probe audio streams for each video track using ffprobe
        video_audio_inputs = []
        ffprobe_bin = str(ffprobe_exe) if ffprobe_exe.exists() else "ffprobe"
        for vat in video_audio_tracks:
            try:
                probe_cmd = [ffprobe_bin, "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", vat["path"]]
                probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10, startupinfo=get_startupinfo())
                has_audio_stream = probe_result.returncode == 0 and probe_result.stdout.strip() == "audio"
                if has_audio_stream:
                    cmd_audio.extend(["-i", vat["path"]])
                    video_audio_inputs.append(vat)
                else:
                    logger.info(f"Skipping video audio — no audio stream in {vat['path']}")
            except Exception as e:
                logger.warning(f"Failed to probe audio stream for {vat['path']}: {e}")

        # ── Build filter_complex ──────────────────────────────────────────
        total_inputs = input_count + len(video_audio_inputs)
        filter_parts = []
        mix_inputs = []

        # Chain per-sub-visual cut ranges: volume=0:enable='gte(t,s)*lt(t,e)'.
        # gte/lt replicate the frontend's `frame >= start && frame < end` semantics;
        # `between(t,s,e)` is inclusive at both ends and keeps each cut muted one
        # frame longer than the preview.
        def _apply_cuts(vol: float, cuts: list) -> str:
            if not cuts:
                return f"volume={vol}"
            parts = [f"volume={vol}"]
            for s, e in cuts:
                parts.append(f"volume=0:enable='gte(t,{s:.3f})*lt(t,{e:.3f})'")
            return ",".join(parts)

        # Voiceover
        voice_filter = _apply_cuts(voice_vol, voice_cuts)
        filter_parts.append(f"[0:a]{voice_filter}[voice]")
        mix_inputs.append("[voice]")

        # BG music (input index 1 if present)
        if has_bg:
            bg_filter = _apply_cuts(bg_vol, bg_cuts)
            filter_parts.append(f"[1:a]{bg_filter}[bg]")
            mix_inputs.append("[bg]")

        # Video audio tracks
        for i, vat in enumerate(video_audio_inputs):
            vidx = input_count + i
            delay_ms = int(vat["start_time"] * 1000)
            vol = vat["volume"]
            if delay_ms > 0:
                filter_parts.append(f"[{vidx}:a]volume={vol},adelay={delay_ms}|{delay_ms}[va{i}]")
            else:
                filter_parts.append(f"[{vidx}:a]volume={vol}[va{i}]")
            mix_inputs.append(f"[va{i}]")

        if total_inputs > 1:
            amix_expr = "".join(mix_inputs) + f"amix=inputs={total_inputs}:duration=first:normalize=0[aout]"
            filter_parts.append(amix_expr)
            filter_str = ";".join(filter_parts)
            cmd_audio.extend(["-filter_complex", filter_str, "-map", "[aout]", "-ac", "2", "-ar", "44100"])
        elif voice_vol != 1.0 or voice_cuts:
            # Single voice input with volume adjustment and/or cut ranges
            cmd_audio.extend(["-filter_complex", f"[0:a]{voice_filter}[aout]", "-map", "[aout]", "-ac", "2", "-ar", "44100"])
        else:
            cmd_audio.extend(["-c:a", "copy"])

        cmd_audio.append(str(cached_audio_path.resolve()).replace('\\', '/'))
        
        logger.info(f"Executing audio render (Direct FFmpeg): {' '.join(cmd_audio)}")
        try:
            # Bypass Remotion/Node completely and execute FFmpeg directly
            subprocess.run(cmd_audio, capture_output=True, text=True, check=True, startupinfo=get_startupinfo())
            
            # Write audio hash AFTER successful render
            audio_hash_file.write_text(audio_hash)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg audio mixing failed.\nLast output:\n{e.stderr}")
            raise RuntimeError(f"FFmpeg audio mixing failed.\nLast output:\n{e.stderr}")
    else:
        logger.info("Audio cache valid. Skipping audio render phase.")

    # Phase 3: FFmpeg Muxing
    progress_cb(90.0, "Muxing final video...")
    ffmpeg_bin = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
    
    # Ensure all frames are within total_frames and remove any lingering leftover frames
    for f in list(frames_dir.glob("element-*.*")):
        m = re.search(r"element-(\d+)\.", f.name)
        if m and int(m.group(1)) >= total_frames:
            try:
                f.unlink()
            except OSError:
                pass

    # Normalize frame filenames to consistent padding and auto-detect image extension.
    # Remotion's renderFrames may produce unpadded names for single-frame ranges
    # (e.g. element-474.jpeg) mixed with padded names for multi-frame ranges.
    # Without normalization, FFmpeg's %0Nd pattern misses unpadded files.
    frame_files_list = list(frames_dir.glob("element-*.jpeg")) or list(frames_dir.glob("element-*.jpg")) or list(frames_dir.glob("element-*.webp"))
    if not frame_files_list:
        raise RuntimeError(f"No frames found in {frames_dir}")

    # Determine the file extension of the rendered frames
    frame_ext = frame_files_list[0].suffix.lstrip(".")

    max_frame = 0
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.(?:jpeg|jpg|webp)", f.name)
        if m:
            max_frame = max(max_frame, int(m.group(1)))

    normalized_padding = max(len(str(max_frame)), 4)
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.(?:jpeg|jpg|webp)", f.name)
        if m:
            frame_num = int(m.group(1))
            expected_name = f"element-{frame_num:0{normalized_padding}d}.{frame_ext}"
            if f.name != expected_name:
                dest = f.parent / expected_name
                f.replace(dest)

    frame_input_pattern = f"element-%0{normalized_padding}d.{frame_ext}"

    ffmpeg_cmd = [
        ffmpeg_bin, "-y",
        "-threads", str(max(1, (os.cpu_count() or 4) - 1)),
        "-framerate", str(fps),
        "-i", str(frames_dir / frame_input_pattern),
        "-i", str(cached_audio_path),
        "-c:v", "libx264" if render_codec == "h264" else render_codec,
        "-preset", "fast",
        "-crf", str(render_crf),
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", "256k",
        "-pix_fmt", "yuv420p",
        str(output_mp4_path)
    ]
    
    logger.info(f"Running FFmpeg muxing: {' '.join(ffmpeg_cmd)}")
    run_ffmpeg(ffmpeg_cmd, base_progress=90.0, progress_weight=9.0)

    # Frames cache preserved for future resume

    if not output_mp4_path.exists():
        raise FileNotFoundError(f"Pipeline completed but output file was not found at: {output_mp4_path}")

    update_project(project_dict['id'], video_path=str(output_mp4_path))
    progress_cb(100.0, "Video compilation complete!")
    logger.info(f"Video compiled successfully! MP4 exported to: {output_mp4_path}")
