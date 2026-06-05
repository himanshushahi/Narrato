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
    """Formats an absolute Windows path into a local Bottle server API route."""
    if not path_str:
        return ""
    normalized = str(Path(path_str).resolve()).replace('\\', '/')
    return f"http://localhost:8888/api/media?path={requests_quote(normalized)}"

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

    props = {
        "audioUrl": clean_media_path(str(audio_path)),
        "bgMusicUrl": bg_music_url,
        "bgMusicVolume": float(project_dict.get("bg_music_volume") or 0.15),
        "scenes": scenes,
        "transcription": transcript,
        "style": project_dict.get("style", "nitish_rajput"),
        "language": project_dict.get("language", "hi"),
        "fps": int(get_setting("render_fps") or 30)
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

    # 2. Run npx remotion render
    # Execute inside 'frontend' directory since it contains node_modules and root.ts
    frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
    
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
    frames_arg = f"--frames=0-{total_frames - 1}"

    # Command: run specific node with remotion-cli.js if available, otherwise fallback to npx
    node_exe = get_node_path()
    remotion_cli = frontend_dir / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
    
    if node_exe != "node" and remotion_cli.exists():
        cmd = [
            node_exe,
            str(remotion_cli),
            "render",
            "src/components/video/root.ts",
            "NitishRajputVideo",
            abs_output_path,
            f"--props={abs_props_path}",
            frames_arg,
            f"--concurrency={concurrency_arg}",
            f"--scale={scale_arg}",
            f"--codec={render_codec}",
            f"--crf={render_crf}",
            "--log=info"
        ]
        
        if render_hardware == "cuda":
            cmd.append("--gl=angle")
            
        logger.info(f"Executing Remotion command using bundled Node.js: {node_exe}")
    else:
        cmd = [
            "npx",
            "remotion",
            "render",
            "src/components/video/root.ts",
            "NitishRajputVideo",
            abs_output_path,
            f"--props={abs_props_path}",
            frames_arg,
            f"--concurrency={concurrency_arg}",
            f"--scale={scale_arg}",
            f"--codec={render_codec}",
            f"--crf={render_crf}",
            "--log=info",
            "--timeout=120000"
        ]
        
        if render_hardware == "cuda":
            cmd.append("--gl=angle")
            
        logger.info("Executing Remotion command using system npx")

    logger.info(f"Executing command in {frontend_dir}: {' '.join(cmd)}")
    
    env = os.environ.copy()
    env["NODE_OPTIONS"] = "--max-old-space-size=8192"
    # Note: GPU acceleration is handled by --gl=angle for frame rendering.
    # Video encoding uses software libx264/libx265 (Remotion's bundled FFmpeg
    # does not include hardware encoders like h264_nvenc).
    
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
        bufsize=1,
        universal_newlines=True,
        shell=(cmd[0] == "npx"), # Need shell=True to execute npx successfully on Windows, but not node.exe
        startupinfo=startupinfo,
        env=env
    )

    bundle_regex = re.compile(r"Bundling (\d+)%")
    render_regex = re.compile(r"Rendered\s+(\d+)/(\d+)")
    encode_regex = re.compile(r"Encoded\s+(\d+)/(\d+)")

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
                    # Extract precise progress phases
                    bundle_match = bundle_regex.search(line)
                    render_match = render_regex.search(line)
                    encode_match = encode_regex.search(line)
                    
                    # Throttle spammy logs (only log every 100th frame or the final frame)
                    skip_log = False
                    if render_match:
                        current = int(render_match.group(1))
                        if current % 100 != 0 and current != int(render_match.group(2)):
                            skip_log = True
                    elif encode_match:
                        current = int(encode_match.group(1))
                        if current % 100 != 0 and current != int(encode_match.group(2)):
                            skip_log = True

                    if not skip_log:
                        logger.info(f"[Remotion CLI]: {stripped}")
                        
                    # Always append to error output buffer in case it fails
                    last_output_lines.append(stripped)
                    if len(last_output_lines) > 20:
                        last_output_lines.pop(0)
                        
                if bundle_match:
                    pct_val = int(bundle_match.group(1))
                    pct = 2.0 + (pct_val / 100.0) * 3.0  # 2% to 5%
                    progress_cb(min(99.0, pct), f"Bundling App... {pct_val}%")
                elif render_match:
                    current = int(render_match.group(1))
                    total = int(render_match.group(2))
                    if total > 0:
                        pct = 5.0 + (current / total) * 60.0 # 5% to 65%
                        progress_cb(min(99.0, pct), f"Rendering Frame {current}/{total}")
                elif encode_match:
                    current = int(encode_match.group(1))
                    total = int(encode_match.group(2))
                    if total > 0:
                        pct = 65.0 + (current / total) * 34.0 # 65% to 99%
                        progress_cb(min(99.0, pct), f"Encoding Frame {current}/{total}")
            else:
                buffer += char

        process.wait()

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
