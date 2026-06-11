import os
import json
import re
import subprocess
import shutil
import hashlib
from pathlib import Path
from backend.database.db import get_setting, update_project
from backend.core.config import get_temp_dir, get_node_path, get_remotion_cache_dir
from backend.core.logger import logger

def clean_media_path(path_str):
    """Formats an absolute Windows path into a local file:/// URL."""
    if not path_str:
        return ""
    normalized = str(Path(path_str).resolve()).replace('\\', '/')
    return f"file:///{normalized}"

def requests_quote(string):
    import requests
    return requests.utils.quote(string)

def compute_frame_hash(props_dict, render_settings):
    """Hash of frame-relevant properties only (scenes, transcription, resolution, fps).
    Audio/encode settings don't affect pixel output, so they're excluded."""
    frame_props = {
        "scenes": props_dict["scenes"],
        "transcription": props_dict["transcription"],
        "subtitleSettings": props_dict.get("subtitleSettings", {}),
        "style": props_dict.get("style"),
        "language": props_dict.get("language"),
        "videoFormat": props_dict.get("videoFormat"),
        "fps": props_dict.get("fps"),
        "resolution": render_settings.get("resolution"),
    }
    data_str = json.dumps(frame_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def compute_audio_hash(props_dict, render_settings):
    """Hash of audio-relevant properties only (bg_music, volumes, narration path).
    Scene visuals and encode settings don't affect the audio mix."""
    scene_durations = [sc.get("duration") for sc in props_dict.get("scenes", [])]
    audio_props = {
        "audioUrl": props_dict.get("audioUrl"),
        "bgMusicUrl": props_dict.get("bgMusicUrl"),
        "bgMusicVolume": props_dict.get("bgMusicVolume"),
        "voiceoverVolume": props_dict.get("voiceoverVolume"),
        "scene_durations": scene_durations,
    }
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

def get_missing_frame_ranges(frames_dir, total_frames):
    """Finds all missing frame ranges from 0 to total_frames - 1."""
    if not frames_dir.exists():
        return f"0-{total_frames - 1}"
    
    existing_frames = set()
    for f in frames_dir.glob("element-*.webp"):
        match = re.search(r"element-(\d+)\.webp", f.name)
        if match:
            existing_frames.add(int(match.group(1)))
            
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

    # Strip internal pipeline metadata (_content_hash, _voiceover_*) that doesn't affect
    # rendering output. This prevents metadata changes (e.g. first save after hash system
    # was introduced, or TTS engine/voice changes) from invalidating the render cache.
    for sc in scenes:
        sc.pop("_content_hash", None)
        sc.pop("_voiceover_engine", None)
        sc.pop("_voiceover_voice", None)
        sc.pop("_voiceover_speed", None)
        sc.pop("_voiceover_pitch", None)

    # Convert local absolute paths in scenes/audios into Bottle media serving URLs
    for sc in scenes:
        sc["audio_url"] = clean_media_path(sc["audio_path"])
        
        sub_visuals = sc.get("sub_visuals", [])
        scene_duration = float(sc.get("duration") or 0.0)
        num_subs = len(sub_visuals) if sub_visuals else 1
        sub_duration = scene_duration / num_subs if num_subs > 0 else scene_duration
        
        for sv in sub_visuals:
            if sv.get("visual_path"):
                sv["visual_url"] = clean_media_path(sv["visual_path"])
            else:
                sv["visual_url"] = ""
            sv["duration"] = sub_duration
        
        sc["sub_visuals"] = sub_visuals

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

    # Fetch rendering settings — project_settings override global defaults
    render_resolution = project_settings.get("render_resolution") or get_setting("render_resolution") or "1080p"
    render_concurrency = project_settings.get("render_concurrency") or get_setting("render_concurrency") or "logical"
    render_fps = project_settings.get("render_fps") or get_setting("render_fps") or "30"
    render_crf = project_settings.get("render_crf") or get_setting("render_crf") or "18"
    render_codec = project_settings.get("render_codec") or get_setting("render_codec") or "h264"
    render_hardware = project_settings.get("render_hardware") or get_setting("render_hardware") or "cpu"

    fps = int(render_fps)

    props = {
        "audioUrl": clean_media_path(str(audio_path)),
        "bgMusicUrl": bg_music_url,
        "bgMusicVolume": float(project_dict.get("bg_music_volume") or 0.15),
        "voiceoverVolume": float(project_settings.get("voiceover_volume") or 1.0),
        "scenes": scenes,
        "transcription": transcript,
        "style": project_dict.get("style", "nitish_rajput"),
        "language": project_dict.get("language", "hi"),
        "videoFormat": project_dict.get("video_format", "landscape"),
        "fps": fps,
        "subtitleSettings": project_settings
    }

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

    # ── Frame cache check ─────────────────────────────────────────────────
    frame_cache_valid = False
    if frame_hash_file.exists():
        existing = frame_hash_file.read_text().strip()
        if existing == frame_hash:
            if frames_dir.exists():
                frame_cache_valid = True
                logger.info("Frame hash matches. Will resume if frames exist.")
            else:
                logger.info("Frame hash matches but frames/ missing. Re-creating.")
                frames_dir.mkdir(parents=True, exist_ok=True)
        else:
            logger.info("Frame hash changed. Invalidating frame cache.")
            if frames_dir.exists():
                shutil.rmtree(frames_dir, ignore_errors=True)
            frames_dir.mkdir(parents=True, exist_ok=True)
            frame_hash_file.write_text(frame_hash)
    else:
        logger.info("No frame cache found. Creating new frame cache.")
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
    
    if render_concurrency == "logical":
        concurrency_arg = "100%"
    elif render_concurrency == "physical":
        concurrency_arg = "50%"
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
        env = os.environ.copy()
        env["NODE_OPTIONS"] = "--max-old-space-size=8192"
        remotion_cache_dir = get_remotion_cache_dir()
        env["REMOTION_FOLDER"] = str(remotion_cache_dir)
        
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        process = subprocess.Popen(
            cmd,
            cwd=str(frontend_dir),
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
            buffer = ""
            last_output_lines = []
            while True:
                if cancel_event.is_set():
                    logger.warning("Render cancelled by user. Terminating process.")
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise InterruptedError("Cancelled")

                char = process.stdout.read(1)
                if not char and process.poll() is not None:
                    break
                    
                if char in ('\r', '\n'):
                    line = buffer
                    buffer = ""
                    if not line.strip():
                        continue

                    stripped = line.strip()
                    if stripped:
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
                            
                        last_output_lines.append(stripped)
                        if len(last_output_lines) > 20:
                            last_output_lines.pop(0)
                            
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
                else:
                    buffer += char

            process.wait()

            if hasattr(run_node_process, '_last_logged_pct'):
                del run_node_process._last_logged_pct

            if process.returncode != 0:
                error_details = "\n".join(last_output_lines)
                raise RuntimeError(f"{label} process failed with exit code {process.returncode}.\nLast output:\n{error_details}")

        except Exception as e:
            raise e

    def run_ffmpeg(cmd, base_progress, progress_weight):
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
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
        last_logged_pct = -1
        last_output_lines = []
        buffer = ""
        
        while True:
            if cancel_event.is_set():
                process.terminate()
                try: process.wait(timeout=3)
                except: process.kill()
                raise InterruptedError("Cancelled")
                
            char = process.stdout.read(1)
            if not char and process.poll() is not None:
                break
                
            if char in ('\r', '\n'):
                line = buffer
                buffer = ""
                if not line.strip(): continue
                stripped = line.strip()
                
                last_output_lines.append(stripped)
                if len(last_output_lines) > 20: last_output_lines.pop(0)
                
                match = frame_regex.search(stripped)
                if match and total_frames > 0:
                    f = int(match.group(1))
                    pct_val = min(100.0, (f / total_frames) * 100.0)
                    if pct_val - last_logged_pct >= 5.0 or pct_val >= 100:
                        last_logged_pct = pct_val
                        logger.info(f"[FFmpeg]: {stripped}")
                        
                    pct = base_progress + (pct_val / 100.0) * progress_weight
                    progress_cb(min(99.0, pct), f"Muxing video... {pct_val:.1f}%")
            else:
                buffer += char
                
        process.wait()
        if process.returncode != 0:
            error_details = "\n".join(last_output_lines)
            raise RuntimeError(f"FFmpeg failed with exit code {process.returncode}.\nLast output:\n{error_details}")

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
    ]
    if ffmpeg_exe.exists(): base_node_cmd.extend(["--ffmpeg", str(ffmpeg_exe.resolve())])
    if ffprobe_exe.exists(): base_node_cmd.extend(["--ffprobe", str(ffprobe_exe.resolve())])
    if render_hardware == "cuda": base_node_cmd.extend(["--hw-accel", "if-possible"])
    else: base_node_cmd.extend(["--hw-accel", "disable"])

    # Phase 1: Render Frames
    missing_ranges_str = get_missing_frame_ranges(frames_dir, total_frames)
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

    # Reset the frame progress offset — the Audio phase has no cached sub-range to offset.
    first_missing_frame_pct = 0.0

    # Phase 2: Render Audio (only if cache invalid)
    if not audio_cache_valid:
        progress_cb(80.0, "Extracting audio track...")
        cmd_audio = list(base_node_cmd)
        cmd_audio.extend([
            "--mode", "audio",
            "--output", str(cached_audio_path.resolve()).replace('\\', '/')
        ])
        logger.info(f"Executing audio render: {' '.join(cmd_audio)}")
        run_node_process(cmd_audio, progress_weight=10.0, base_progress=80.0, label="Audio")
        # Write audio hash AFTER successful render (atomic — avoids accepting partial render)
        audio_hash_file.write_text(audio_hash)
    else:
        logger.info("Audio cache valid. Skipping audio render phase.")

    # Phase 3: FFmpeg Muxing
    progress_cb(90.0, "Muxing final video...")
    ffmpeg_bin = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
    
    # Normalize frame filenames to consistent padding.
    # Remotion's renderFrames may produce unpadded names for single-frame ranges
    # (e.g. element-474.webp) mixed with padded names for multi-frame ranges.
    # Without normalization, FFmpeg's %0Nd pattern misses unpadded files and
    # produces a truncated video — only N frames are encoded instead of all.
    frame_files_list = list(frames_dir.glob("element-*.webp"))
    if not frame_files_list:
        raise RuntimeError(f"No frames found in {frames_dir}")

    max_frame = 0
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.webp", f.name)
        if m:
            max_frame = max(max_frame, int(m.group(1)))

    normalized_padding = max(len(str(max_frame)), 4)
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.webp", f.name)
        if m:
            frame_num = int(m.group(1))
            expected_name = f"element-{frame_num:0{normalized_padding}d}.webp"
            if f.name != expected_name:
                dest = f.parent / expected_name
                if not dest.exists():
                    f.rename(dest)
                else:
                    f.unlink()

    frame_input_pattern = f"element-%0{normalized_padding}d.webp"

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
