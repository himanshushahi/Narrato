import os
import json
import re
import subprocess
import shutil
from pathlib import Path
from backend.database.db import get_setting, update_project
from backend.core.config import get_exports_dir, get_temp_dir, get_node_path
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

def render_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Compiles the React Remotion canvas into an MP4 file."""
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

    # Convert local absolute paths in scenes/audios into Bottle media serving URLs
    # Remotion Chrome sandbox cannot fetch directly from local disk absolute paths
    for sc in scenes:
        sc["audio_url"] = clean_media_path(sc["audio_path"])
        
        # Process sub_visuals: convert each sub_visual's visual_path to a URL
        # and compute duration for each sub_visual (equal split of scene duration)
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
    if project_dict.get("bg_music_path"):
        bg_music_url = clean_media_path(project_dict["bg_music_path"])

    subtitle_settings = {}
    if project_dict.get("subtitle_settings"):
        try:
            subtitle_settings = json.loads(project_dict["subtitle_settings"])
        except Exception as e:
            logger.error(f"Failed to parse subtitle_settings: {e}")

    props = {
        "audioUrl": clean_media_path(str(audio_path)),
        "bgMusicUrl": bg_music_url,
        "bgMusicVolume": float(project_dict.get("bg_music_volume") or 0.15),
        "scenes": scenes,
        "transcription": transcript,
        "style": project_dict.get("style", "nitish_rajput"),
        "language": project_dict.get("language", "hi"),
        "fps": int(get_setting("render_fps") or 30),
        "subtitleSettings": subtitle_settings
    }

    # Write props to a JSON file
    props_path = project_dir / "render_props.json"
    with open(props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, indent=2, ensure_ascii=False)

    logger.info(f"Wrote render props to {props_path}")
    progress_cb(2.0, "Wrote render properties. Starting Remotion CLI...")

    # Define output paths
    exports_dir = get_exports_dir()
    exports_dir.mkdir(parents=True, exist_ok=True)
    
    # Safe project filename
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', project_dict['name'])
    output_mp4_path = exports_dir / f"{safe_name}.mp4"

    # 2. Run custom render script (programmatic renderMedia API)
    frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
    render_script = frontend_dir / "dist-render" / "render.mjs"
    
    if not render_script.exists():
        # Fallback to dev script if compiled version not found
        render_script = frontend_dir / "src" / "render.mjs"
        
    if not render_script.exists():
        raise FileNotFoundError(f"Render script not found: {render_script}")
        
    bundle_dir = frontend_dir / "dist-remotion"
    abs_bundle_dir = str(bundle_dir.resolve()).replace('\\', '/')
    
    # Normalize props path relative to frontend folder or pass absolute
    abs_props_path = str(props_path.resolve()).replace('\\', '/')
    abs_output_path = str(output_mp4_path.resolve()).replace('\\', '/')

    # Fetch rendering settings
    render_resolution = get_setting("render_resolution") or "1080p"
    render_concurrency = get_setting("render_concurrency") or "logical"
    render_fps = get_setting("render_fps") or "30"
    render_crf = get_setting("render_crf") or "18"
    render_codec = get_setting("render_codec") or "h264"
    render_hardware = get_setting("render_hardware") or "cpu"
    
    # Map concurrency
    if render_concurrency == "logical":
        concurrency_arg = "100%"
    elif render_concurrency == "physical":
        concurrency_arg = "50%"
    else:
        concurrency_arg = render_concurrency
    
    # Map resolution to scale
    scale_map = {
        "720p": "0.6666666666666666",
        "1080p": "1",
        "1440p": "1.3333333333333333",
        "4k": "2"
    }
    scale_arg = scale_map.get(render_resolution.lower(), "1")

    # Calculate exact duration
    fps = int(render_fps)
    total_duration = sum(float(sc.get("duration") or 0.0) for sc in scenes)
    total_frames = max(150, int(total_duration * fps))
    frames_arg = f"0-{total_frames - 1}"

    # Build command using render.mjs (programmatic API)
    node_exe = get_node_path()
    
    cmd = [
        node_exe,
        str(render_script),
        "--props", abs_props_path,
        "--output", abs_output_path,
        "--fps", str(fps),
        "--codec", render_codec,
        "--crf", str(render_crf),
        "--scale", scale_arg,
        "--concurrency", concurrency_arg,
        "--frames", frames_arg,
        "--bundle-dir", abs_bundle_dir,
    ]
    
    # Pass portable FFmpeg/FFprobe binaries if available
    bin_dir = frontend_dir.parent / "bin"
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"
    if ffmpeg_exe.exists():
        cmd.extend(["--ffmpeg", str(ffmpeg_exe.resolve())])
    if ffprobe_exe.exists():
        cmd.extend(["--ffprobe", str(ffprobe_exe.resolve())])
    
    # Hardware acceleration: use "if-possible" for CUDA (graceful NVENC fallback)
    if render_hardware == "cuda":
        cmd.extend(["--hw-accel", "if-possible"])
    else:
        cmd.extend(["--hw-accel", "disable"])

    logger.info(f"Executing render.mjs in {frontend_dir}: {' '.join(cmd)}")
    
    env = os.environ.copy()
    env["NODE_OPTIONS"] = "--max-old-space-size=8192"
    
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

    # Progress regex patterns for render.mjs output
    progress_regex = re.compile(r"Render progress:\s*([\d.]+)%")
    bundle_regex = re.compile(r"Bundle ready in")

    try:
        buffer = ""
        last_output_lines = []
        while True:
            if cancel_event.is_set():
                logger.warning("Render cancelled by user. Terminating Remotion process.")
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
                    
                    # Throttle progress logs (only log every 5%)
                    skip_log = False
                    if progress_match:
                        pct_val = float(progress_match.group(1))
                        if not hasattr(render_pipeline, '_last_logged_pct'):
                            render_pipeline._last_logged_pct = -1
                        if abs(pct_val - render_pipeline._last_logged_pct) < 5.0 and pct_val < 100:
                            skip_log = True
                        else:
                            render_pipeline._last_logged_pct = pct_val

                    if not skip_log:
                        logger.info(f"[Remotion]: {stripped}")
                        
                    # Always append to error output buffer in case it fails
                    last_output_lines.append(stripped)
                    if len(last_output_lines) > 20:
                        last_output_lines.pop(0)
                        
                    # Parse progress and update callback
                    if progress_match:
                        pct_val = float(progress_match.group(1))
                        # Map render progress (0-100%) to pipeline progress (5-99%)
                        pct = 5.0 + (pct_val / 100.0) * 94.0
                        progress_cb(min(99.0, pct), f"Rendering... {pct_val:.1f}%")
                    elif bundle_regex.search(stripped):
                        progress_cb(5.0, "Bundling complete. Starting render...")
                    elif "Bundling" in stripped:
                        progress_cb(3.0, "Bundling Remotion project...")
                    elif "Selecting composition" in stripped:
                        progress_cb(4.0, "Preparing composition...")
            else:
                buffer += char

        process.wait()

        # Clean up the function-level progress tracker
        if hasattr(render_pipeline, '_last_logged_pct'):
            del render_pipeline._last_logged_pct

        if process.returncode != 0:
            error_details = "\n".join(last_output_lines)
            raise RuntimeError(f"Remotion render failed with exit code {process.returncode}.\nLast output:\n{error_details}")

    except Exception as e:
        if output_mp4_path.exists():
            try:
                output_mp4_path.unlink()
            except Exception:
                pass
        raise e

    if not output_mp4_path.exists():
        error_details = "\n".join(last_output_lines)
        raise FileNotFoundError(f"Remotion compiler completed but output file was not found at: {output_mp4_path}\nLast output before crash:\n{error_details}")

    update_project(project_dict['id'], video_path=str(output_mp4_path))
    progress_cb(100.0, "Video compilation complete!")
    logger.info(f"Video compiled successfully! MP4 exported to: {output_mp4_path}")

