import os
import json
import re
import asyncio
import subprocess
import urllib.request
from pathlib import Path
from backend.core.config import get_models_dir, get_temp_dir, get_ffmpeg_path
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

def download_file_with_progress(url, dest_path, progress_callback=None, cancel_event=None):
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading {url} to {dest_path}")
    
    try:
        import gevent
    except ImportError:
        gevent = None
        
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
                    
                    if gevent:
                        gevent.sleep(0.002)
                        
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
    
    # Clean text of special punctuation that crashes edge-tts
    cleaned_text = text
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
        raise FileNotFoundError("Kokoro model files are missing. Please download them first.")
    from kokoro_onnx import Kokoro
    import soundfile as sf
    logger.info(f"Generating Kokoro-TTS. Voice: {voice}, Speed: {speed}")
    kokoro = Kokoro(str(KOKORO_MODEL_PATH), str(KOKORO_VOICES_PATH))
    samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    sf.write(output_path, samples, sample_rate)

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
    
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        
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
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, startupinfo=startupinfo)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            return float(data.get("format", {}).get("duration", 0))
    except Exception as e:
        logger.warning(f"Failed to probe duration for {audio_path}: {e}")
    return 0.0

def generate_voiceover_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Voiceover generation step in background worker queue."""
    script_path = Path(project_dict['script_path'])
    if not script_path.exists():
        raise FileNotFoundError(f"Script file not found: {script_path}")
        
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

    engine = get_setting("tts_engine") or "edge"
    speed = float(get_setting("tts_speed") or 1.0)
    pitch = get_setting("tts_pitch") or "0"
    language = project_dict.get("language", "hi")

    if engine == "edge":
        voice = get_setting("tts_voice")
        if not voice:
            voice = "hi-IN-SwaraNeural" if language == "hi" else "en-US-AndrewNeural"
    else:
        voice = get_setting("kokoro_voice") or "af_bella"

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
    
    # Save manifest
    manifest_path = voice_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_entries, f, indent=2, ensure_ascii=False)

    update_project(
        project_dict['id'],
        audio_path=str(merged_audio_path),
        assets_manifest_path=str(manifest_path) # Stores the video timeline details
    )
    
    progress_cb(100.0, "Voiceover generation complete!")
    logger.info(f"Voiceover generation completed. Merged track: {merged_audio_path}")
