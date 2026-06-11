# pyrefly: ignore [missing-import]
import eel
import json
import os
import threading
from pathlib import Path
from backend.core.logger import logger, register_log_callback
from backend.database.db import (
    get_all_projects, get_project, delete_project, create_project, update_project,
    get_project_tasks, get_all_settings, update_settings, get_setting
)
from backend.pipeline.queue import global_queue_manager
from backend.pipeline.tts import (
    check_kokoro_assets, download_file_with_progress, KOKORO_MODEL_URL, KOKORO_MODEL_PATH,
    KOKORO_VOICES_URL, KOKORO_VOICES_PATH
)

_kokoro_download_active = False
_whisper_download_active = False
_ytdlp_update_active = False

@eel.expose
def browse_export_directory():
    """Opens folder explorer for selecting an export directory."""
    logger.info("Bridge API: browse_export_directory called")
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        dir_path = filedialog.askdirectory(title="Select Export Folder")
        root.destroy()
        return dir_path
    except Exception as e:
        logger.error(f"Folder explorer error: {e}")
        return ""


@eel.expose
def browse_bg_music_file():
    """Opens file explorer to select background soundtrack.

    Immediately copies the selected file to {BASE_DIR}/assets/bg_music.{ext}
    so the file is stable and won't break if the original is moved or deleted.
    Returns the stable path, or empty string if cancelled or on error.
    """
    logger.info("Bridge API: browse_bg_music_file called")
    try:
        import tkinter as tk
        from tkinter import filedialog
        import shutil
        from pathlib import Path
        from backend.core.config import get_assets_dir

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        file_path = filedialog.askopenfilename(
            title="Select Soundtrack File",
            filetypes=[("Audio Files", "*.mp3 *.wav *.ogg *.flac *.m4a"), ("All Files", "*.*")]
        )
        root.destroy()

        if not file_path:
            return ""

        src = Path(file_path).resolve()
        ext = src.suffix.lower() or ".mp3"
        assets_dir = get_assets_dir()
        dest = (assets_dir / f"bg_music{ext}").resolve()

        # No-op if the file is already in the assets directory
        if src == dest:
            logger.info(f"Background music already in assets dir: {dest}")
            return str(dest)

        logger.info(f"Copying background music: {src} -> {dest}")

        # Clean up stale bg_music files with a different extension
        # (e.g. old .wav when new selection is .mp3).
        for old in assets_dir.glob("bg_music.*"):
            if old.resolve() != dest:
                try:
                    old.unlink()
                    logger.info(f"Removed stale background music: {old}")
                except Exception as e:
                    logger.warning(f"Could not remove stale bg_music {old}: {e}")

        shutil.copy(str(src), str(dest))
        logger.info(f"Background music copied successfully to {dest}")
        return str(dest)

    except Exception as e:
        logger.error(f"browse_bg_music_file error: {e}")
        return ""

@eel.expose
def clear_bg_music():
    """Deletes the stored background music file from assets dir and clears the setting."""
    logger.info("Bridge API: clear_bg_music called")
    try:
        from backend.core.config import get_assets_dir
        from backend.database.db import update_settings

        assets_dir = get_assets_dir()
        deleted = False
        for old in assets_dir.glob("bg_music.*"):
            try:
                old.unlink()
                logger.info(f"Deleted background music file: {old}")
                deleted = True
            except Exception as e:
                logger.warning(f"Could not delete bg_music file {old}: {e}")

        # Also try to clean old path from settings regardless of file deletion
        update_settings({"bg_music_path": ""})
        logger.info("Cleared bg_music_path setting.")

        return {"success": True, "deleted_file": deleted}
    except Exception as e:
        logger.error(f"clear_bg_music error: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def upload_project_bg_music(project_id):
    """Open file dialog, copy selected audio to project dir, update DB.

    Returns:
        dict with {success, path, filename, size_bytes, extension}
        or {success: false, error} on failure / cancel.
    """
    logger.info(f"Bridge API: upload_project_bg_music called for {project_id}")
    try:
        import tkinter as tk
        from tkinter import filedialog
        import shutil
        from pathlib import Path
        from backend.core.config import get_storage_dir
        from backend.database.db import update_project

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        file_path = filedialog.askopenfilename(
            title="Select Background Music",
            filetypes=[("Audio Files", "*.mp3 *.wav *.ogg *.flac *.m4a"), ("All Files", "*.*")]
        )
        root.destroy()

        if not file_path:
            return {"success": False, "path": None, "error": "No file selected"}

        # Copy to project directory
        proj_dir = get_storage_dir() / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)

        src = Path(file_path)
        ext = src.suffix.lower()
        dest = proj_dir / f"bg_music{ext}"

        shutil.copy(str(src), str(dest))

        # Update project DB
        update_project(project_id, bg_music_path=str(dest))

        stat = dest.stat()
        return {
            "success": True,
            "path": str(dest),
            "filename": dest.name,
            "size_bytes": stat.st_size,
            "extension": ext,
        }
    except Exception as e:
        logger.error(f"upload_project_bg_music error: {e}")
        return {"success": False, "path": None, "error": str(e)}

@eel.expose
def db_get_projects():
    return get_all_projects()

@eel.expose
def db_get_project(project_id):
    return get_project(project_id)

@eel.expose
def db_update_project(project_id, updates_dict):
    try:
        update_project(project_id, **updates_dict)
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to update project: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def db_delete_project(project_id):
    proj = get_project(project_id)
    if proj:
        from backend.core.config import get_storage_dir
        proj_dir = get_storage_dir() / project_id
            
        if proj_dir.exists():
            import shutil
            try:
                shutil.rmtree(proj_dir)
                logger.info(f"Deleted project disk folder: {proj_dir}")
            except Exception as e:
                logger.warning(f"Could not remove project folder from disk: {e}")
    delete_project(project_id)
    return True

@eel.expose
def db_get_project_tasks(project_id):
    return get_project_tasks(project_id)

@eel.expose
def db_get_settings():
    return get_all_settings()

@eel.expose
def db_update_settings(settings_dict):
    update_settings(settings_dict)
    return True

@eel.expose
def create_new_project(name, prompt, export_folder, language="hi", style="nitish_rajput", duration_mode="medium", video_format="landscape"):
    try:
        project_id = create_project(name, prompt, export_folder, language, style, duration_mode, video_format)
        return {"project_id": project_id, "success": True}
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        return {"error": str(e), "success": False}

@eel.expose
def start_processing_pipeline(project_id, steps):
    logger.info(f"Bridge API: start_processing_pipeline for {project_id} (steps: {steps})")
    success = global_queue_manager.queue_project(project_id, steps)
    return {"success": success}

@eel.expose
def resume_processing_pipeline(project_id):
    success = global_queue_manager.queue_project(project_id, [], is_resume=True)
    return {"success": success}

@eel.expose
def cancel_processing_pipeline(project_id):
    global_queue_manager.cancel_project(project_id)
    return True

@eel.expose
def read_json_file(file_path):
    if not file_path or not os.path.exists(file_path):
        return None
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read JSON file: {e}")
        return None

@eel.expose
def save_json_file(file_path, data):
    try:
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Failed to save JSON file: {e}")
        return False

@eel.expose
def scan_assets_directory(project_id):
    """Scan the project's assets directory and return file details.

    Provides disk-level truth about downloaded files, useful for real-time
    updates during the fetch_assets pipeline step (files appear on disk as
    they're written, even though the manifest JSON is only updated at the end).

    Args:
        project_id: Project identifier

    Returns:
        dict: {files: [{filename, path, size_bytes, last_modified, extension}],
               total_size: int, total_files: int}
    """
    from backend.database.db import get_project
    from backend.core.config import get_storage_dir

    project = get_project(project_id)
    if not project:
        return {"files": [], "total_size": 0, "total_files": 0}

    assets_dir = get_storage_dir() / project_id / "assets"
    if not assets_dir.exists():
        return {"files": [], "total_size": 0, "total_files": 0}

    files = []
    total_size = 0
    try:
        for entry in sorted(assets_dir.iterdir()):
            if entry.is_file():
                stat = entry.stat()
                ext = entry.suffix.lower()
                files.append({
                    "filename": entry.name,
                    "path": str(entry),
                    "size_bytes": stat.st_size,
                    "last_modified": stat.st_mtime,
                    "extension": ext,
                })
                total_size += stat.st_size
    except Exception as e:
        logger.error(f"Failed to scan assets directory: {e}")

    return {"files": files, "total_size": total_size, "total_files": len(files)}


@eel.expose
def download_google_font(font_family):
    import urllib.request
    import re
    from backend.core.config import get_fonts_dir
    fonts_dir = get_fonts_dir()
    
    safe_name = font_family.replace(" ", "")
    font_specific_dir = fonts_dir / safe_name
    font_specific_dir.mkdir(parents=True, exist_ok=True)
    
    css_file = font_specific_dir / f"{safe_name}.css"
    
    if css_file.exists():
        return {"success": True, "css_path": str(css_file)}
        
    try:
        url_family = font_family.replace(" ", "+")
        # Ask for standard weights for subtitles
        css_url = f"https://fonts.googleapis.com/css2?family={url_family}:wght@400;700;800;900&display=swap"
        req = urllib.request.Request(css_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
        
        with urllib.request.urlopen(req, timeout=10) as response:
            css_content = response.read().decode('utf-8')
            
        urls = re.findall(r"url\((https://[^)]+)\)", css_content)
        if not urls:
            # Fallback for some fonts that might not have those weights
            css_url = f"https://fonts.googleapis.com/css2?family={url_family}&display=swap"
            req = urllib.request.Request(css_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
            with urllib.request.urlopen(req, timeout=10) as response:
                css_content = response.read().decode('utf-8')
            urls = re.findall(r"url\((https://[^)]+)\)", css_content)
            
        for font_url in set(urls):
            font_filename = font_url.split("/")[-1]
            local_font_path = font_specific_dir / font_filename
            if not local_font_path.exists():
                logger.info(f"Downloading font file: {font_filename} to {font_specific_dir}")
                urllib.request.urlretrieve(font_url, local_font_path)
            
            # Replace remote URL with local API endpoint URL
            # Note: The UI will load the CSS via media server, so it should request fonts via media server too.
            import urllib.parse
            local_url = f"/api/media?path={urllib.parse.quote(str(local_font_path))}"
            css_content = css_content.replace(font_url, local_url)
            
        with open(css_file, "w", encoding="utf-8") as f:
            f.write(css_content)
            
        return {"success": True, "css_path": str(css_file)}
    except Exception as e:
        logger.error(f"Failed to download font {font_family}: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def check_kokoro_downloaded():
    return check_kokoro_assets()

@eel.expose
def start_kokoro_download():
    global _kokoro_download_active
    if _kokoro_download_active:
        return {"status": "already_running"}
    if check_kokoro_assets():
        return {"status": "already_downloaded"}
        
    _kokoro_download_active = True
    
    def _download_task():
        global _kokoro_download_active
        try:
            def safe_progress(data):
                try:
                    eel.on_kokoro_download_progress(data)()
                except Exception:
                    pass

            # Download ONNX Model
            safe_progress({"file": "model", "progress": 0})
            download_file_with_progress(KOKORO_MODEL_URL, KOKORO_MODEL_PATH, lambda p: safe_progress({"file": "model", "progress": p}))
            
            # Download Voice Pack
            safe_progress({"file": "voices", "progress": 0})
            download_file_with_progress(KOKORO_VOICES_URL, KOKORO_VOICES_PATH, lambda p: safe_progress({"file": "voices", "progress": p}))
            
            safe_progress({"status": "completed"})
            logger.info("Kokoro models downloaded successfully.")
        except Exception as e:
            logger.error(f"Kokoro model download failed: {e}")
            safe_progress({"status": "failed", "error": str(e)})
        finally:
            _kokoro_download_active = False

    threading.Thread(target=_download_task, daemon=True).start()
    return {"status": "started"}

@eel.expose
def check_whisper_downloaded(model_size):
    from backend.pipeline.transcribe import check_whisper_assets
    return check_whisper_assets(model_size)

@eel.expose
def start_whisper_download(model_size):
    global _whisper_download_active
    if _whisper_download_active:
        return {"status": "already_running"}
        
    from backend.pipeline.transcribe import check_whisper_assets
    if check_whisper_assets(model_size):
        return {"status": "already_downloaded"}
        
    _whisper_download_active = True
    
    def _download_task():
        global _whisper_download_active
        try:
            def safe_progress(data):
                try:
                    eel.on_whisper_download_progress(data)()
                except Exception:
                    pass

            from backend.pipeline.transcribe import download_whisper_model_files
            download_whisper_model_files(model_size, lambda p: safe_progress({"status": "downloading", "progress": p}))
            safe_progress({"status": "completed"})
            logger.info(f"Whisper model '{model_size}' downloaded successfully.")
        except Exception as e:
            logger.error(f"Whisper download failed: {e}")
            safe_progress({"status": "failed", "error": str(e)})
        finally:
            _whisper_download_active = False

    threading.Thread(target=_download_task, daemon=True).start()
    return {"status": "started"}

@eel.expose
def get_downloaded_whisper_models():
    from backend.pipeline.transcribe import list_downloaded_whisper_models
    return list_downloaded_whisper_models()

@eel.expose
def delete_whisper_model(safe_dir_name):
    from backend.pipeline.transcribe import delete_whisper_model as _delete_model
    return {"success": _delete_model(safe_dir_name)}

@eel.expose
def check_nvidia_gpu_available():
    import shutil
    if shutil.which("nvidia-smi") is not None:
        return True
    try:
        import torch
        if torch.cuda.is_available():
            return True
    except Exception:
        pass
    return False

@eel.expose
def regenerate_script_section(scene_idx, section_type, full_script, rewrite_prompt, language="hi"):
    """Regenerates a single scene or intro/outro narration section using LLM."""
    logger.info(f"Bridge API: regenerate_script_section index {scene_idx} ({section_type})")
    
    llm_provider = get_setting("llm_provider") or "openai"
    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"
    
    if not api_key:
        raise ValueError("Please configure an OpenAI API Key first.")
        
    system_prompt = (
        "You are an expert AI scriptwriter. You will receive a script segment, "
        "and a prompt request explaining how to modify or rewrite this segment. "
        "Your task is to rewrite the narration and visual details. Preserve the scene numbers/schema format. "
        "Format your output strictly as a JSON object containing the modified segment.\n\n"
        "IMPORTANT: Every segment MUST include a 'sub_visuals' array with 2-4 sub-visual entries for fast-paced visual cuts.\n"
        "Each sub_visual has: { \"visual_type\": \"...\", \"visual_cue\": \"...\", \"visual_meta\": {} }\n"
        "Choose visual_type from: 'chart', 'map', 'document', 'portrait', 'scene', 'image', 'youtube', 'parallax', 'network', 'list'.\n"
        "TYPE SELECTION GUIDE — match the visual to the narration content:\n"
        "- list: USE THIS when the narration enumerates ranked items, countdowns, top-N lists, factual lists, or step-by-step rankings (e.g. \"Top 5 rivers\", \"3 reasons why\"). Each item = its own sub-visual.\n"
        "- chart: USE THIS for statistics, percentages, comparisons, or data trends.\n"
        "- map: USE THIS for geography, routes, locations, or movement between places.\n"
        "- document: USE THIS for historical claims, news events, or archival evidence.\n"
        "- network: USE THIS for connections between people, organizations, or relationships.\n"
        "- portrait: USE THIS when introducing a specific person/historical figure.\n"
        "- parallax: USE THIS for dramatic layered depth reveals.\n"
        "- scene/image: Default visual support for general narration.\n"
        "- youtube: ONLY for specific video footage or interview clips.\n"
        "- For media types (scene, image, portrait, youtube, parallax): provide 2-4 sub_visuals with DIFFERENT keywords.\n"
        "- For programmatic types (chart, map, document, network): use exactly 1 sub_visual.\n"
        "- For 'list': generate 1 sub-visual PER ITEM in the ranking (e.g. 5 items → 5 list sub-visuals). Each shows a single number full screen.\n"
        "- Use 'youtube' only when the scene needs actual real footage, interviews, or historical news clips.\n"
        "- Optimize visual_cue as a simple stock media keyword (nouns and adjectives in English) when visual_type is 'scene' or 'image'.\n"
        "- If visual_type is 'document', visual_meta must contain: { \"headline\": \"Exact news headline\", \"doc_text\": \"Detailed newspaper excerpt matching the narration\", \"source\": \"Name of Publisher\", \"date\": \"Month DD, YYYY\" }\n"
    )
    
    if language != "en":
        system_prompt += f"The rewritten narration text MUST be written in the requested language (code: '{language}'). Visual suggestions MUST remain in English.\n\n"
    else:
        system_prompt += "The rewritten narration text MUST be written in English.\n\n"
        
    from backend.pipeline.ai import INTRO_JSON_SCHEMA, CONCLUSION_JSON_SCHEMA, SCENE_JSON_SCHEMA
    if section_type == "introduction":
        target_content = full_script.get("introduction", {})
        prompt_struct = "Expected: { \"hook\": \"text\", \"sub_visuals\": [{ \"visual_type\": \"...\", \"visual_cue\": \"...\", \"visual_meta\": {} }] }"
        schema = INTRO_JSON_SCHEMA
    elif section_type == "conclusion":
        target_content = full_script.get("conclusion", {})
        prompt_struct = "Expected: { \"summary\": \"text\", \"cta\": \"text\", \"sub_visuals\": [{ \"visual_type\": \"...\", \"visual_cue\": \"...\", \"visual_meta\": {} }] }"
        schema = CONCLUSION_JSON_SCHEMA
    else:
        scenes = full_script.get("scenes", [])
        target_content = scenes[scene_idx] if scene_idx < len(scenes) else {}
        prompt_struct = "Expected: { \"scene_number\": N, \"title\": \"text\", \"narration\": \"text\", \"sub_visuals\": [{ \"visual_type\": \"...\", \"visual_cue\": \"...\", \"visual_meta\": {} }] }"
        schema = SCENE_JSON_SCHEMA
        
    user_prompt = (
        f"Original Segment:\n{json.dumps(target_content, indent=2)}\n\n"
        f"Rewrite Instruction: {rewrite_prompt}\n\n"
        f"Generate the rewritten JSON segment now. Structure matches: {prompt_struct}."
    )
    
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    if llm_provider == "nvidia":
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "guided_json": schema
        }
    else:
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "response_format": {"type": "json_object"}
        }
    
    try:
        res = requests_post(url, headers, data)
        rewritten_data = clean_json_response_bridge(res)
        return {"success": True, "data": rewritten_data}
    except Exception as e:
        logger.error(f"Failed to regenerate section: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def add_scene_with_ai(full_script, user_prompt, language="hi"):
    """Generates a single new scene using AI, with full script context for narrative coherence."""
    logger.info(f"Bridge API: add_scene_with_ai — user_prompt: '{user_prompt[:80]}...'")

    llm_provider = get_setting("llm_provider") or "openai"
    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"

    if not api_key:
        return {"success": False, "error": "Please configure an OpenAI API Key first."}

    # Build script context summary for LLM
    existing_scenes = full_script.get("scenes", [])
    scenes_summary = "\n".join(
        f"  Scene {s.get('scene_number', i + 1)}: \"{s.get('title', 'Untitled')}\" — {s.get('narration', '')[:120]}..."
        for i, s in enumerate(existing_scenes)
    )
    intro_hook = full_script.get("introduction", {}).get("hook", "")[:200]
    conclusion_summary = full_script.get("conclusion", {}).get("summary", "")[:200]

    system_prompt = (
        "You are an expert documentary scriptwriter. Your task is to create a BRAND NEW scene "
        "to insert into an existing documentary script. The new scene must fit naturally into the "
        "narrative flow, maintaining consistent tone, style, and pacing with the surrounding content.\n\n"
        "HERE IS THE FULL SCRIPT CONTEXT:\n"
        f"Documentary Title: \"{full_script.get('title', 'Untitled')}\"\n"
        f"Introduction Hook: \"{intro_hook}\"\n"
        f"Existing Scenes:\n{scenes_summary if scenes_summary else '  (none yet)'}\n"
        f"Conclusion: \"{conclusion_summary}\"\n\n"
        "IMPORTANT: Every scene MUST include a 'sub_visuals' array with 2-4 sub-visual entries for fast-paced visual cuts.\n"
        "Each sub_visual has: { \"visual_type\": \"...\", \"visual_cue\": \"...\", \"transition\": \"...\", \"visual_meta\": {} }\n"
        "Choose visual_type from: 'chart', 'map', 'document', 'portrait', 'scene', 'image', 'youtube', 'parallax', 'network', 'list'.\n"
        "TYPE SELECTION GUIDE — match the visual to the narration content:\n"
        "- list: USE THIS when the narration enumerates ranked items, countdowns, top-N lists, factual lists, or step-by-step rankings (e.g. \"Top 5 rivers\", \"3 reasons why\"). Each item = its own sub-visual.\n"
        "- chart: USE THIS for statistics, percentages, comparisons, or data trends.\n"
        "- map: USE THIS for geography, routes, locations, or movement between places.\n"
        "- document: USE THIS for historical claims, news events, or archival evidence.\n"
        "- network: USE THIS for connections between people, organizations, or relationships.\n"
        "- portrait: USE THIS when introducing a specific person/historical figure.\n"
        "- parallax: USE THIS for dramatic layered depth reveals.\n"
        "- scene/image: Default visual support for general narration.\n"
        "- youtube: ONLY for specific video footage or interview clips.\n"
        "Transitions ('transition' field): choose from 'fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'zoom_in', 'zoom_out', 'glitch', 'none'.\n"
        "- For media types (scene, image, portrait, youtube, parallax): provide 2-4 sub_visuals with DIFFERENT keywords.\n"
        "- For programmatic types (chart, map, document, network): use exactly 1 sub_visual.\n"
        "- For 'list': generate 1 sub-visual PER ITEM in the ranking (e.g. 5 items → 5 list sub-visuals). Each shows a single number full screen.\n"
        "- Use 'youtube' only when the scene needs actual real footage, interviews, or historical news clips.\n"
        "- Optimize visual_cue as a simple stock media keyword (nouns and adjectives in English) when visual_type is 'scene' or 'image'.\n"
        "- If visual_type is 'document', visual_meta must contain: { \"headline\": \"...\", \"doc_text\": \"...\", \"source\": \"...\", \"date\": \"...\" }\n"
        "- If visual_type is 'map', visual_meta must contain: { \"map_style\": \"vintage\", \"locations\": [{ \"name\": \"City\", \"coord\": [lat, lon] }] }\n"
        "- If visual_type is 'chart', visual_meta must contain: { \"chart_type\": \"bar\"|\"line\", \"data\": [{ \"label\": \"X\", \"value\": Y }] }\n"
        "- If visual_type is 'network', visual_meta must contain: { \"nodes\": [...], \"edges\": [...] }\n"
        "- If visual_type is 'list', visual_meta must contain: { \"number\": int (the rank, starting from 1), \"title\": str (the item name), \"description\": str (optional ~10-20 word fact), \"icon\": str (optional single emoji) }\n\n"
        "Return ONLY valid JSON matching the scene schema. No markdown backticks.\n"
        "Expected: { \"scene_number\": N, \"title\": \"text\", \"narration\": \"text\", \"sub_visuals\": [...] }\n"
    )

    if language != "en":
        system_prompt += f"The narration text MUST be written in the requested language (code: '{language}'). Visual suggestions (visual_cue, visual_meta) MUST remain in English.\n\n"
    else:
        system_prompt += "The narration text MUST be written in English.\n\n"

    from backend.pipeline.ai import SCENE_JSON_SCHEMA

    user_prompt = (
        f"Generate a new scene for this documentary based on the following description:\n\n"
        f"{user_prompt}\n\n"
        f"Make the scene fit naturally with the existing narrative. "
        f"The scene_number will be assigned by the system, so just put 1 as a placeholder."
    )

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    if llm_provider == "nvidia":
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "guided_json": SCENE_JSON_SCHEMA
        }
    else:
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "response_format": {"type": "json_object"}
        }

    try:
        res = requests_post(url, headers, data)
        scene_data = clean_json_response_bridge(res)
        return {"success": True, "data": scene_data}
    except Exception as e:
        logger.error(f"Failed to generate new scene: {e}")
        return {"success": False, "error": str(e)}


def requests_post(url, headers, json_data):
    import requests
    response = requests.post(url, headers=headers, json=json_data, timeout=60)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]

def clean_json_response_bridge(raw_text):
    from backend.pipeline.ai import clean_json_response
    return clean_json_response(raw_text)

@eel.expose
def generate_voice_preview(text, engine, voice, speed, pitch, language):
    """Generates preview voice sample for UI configurations."""
    logger.info(f"Bridge API: generate_voice_preview voice={voice}")
    try:
        from backend.core.config import get_temp_dir
        from backend.pipeline.tts import generate_edge_tts, generate_kokoro_tts
        import uuid
        
        temp_dir = get_temp_dir()
        
        # Clean old files
        for f in temp_dir.glob("preview_*.wav"):
            try:
                f.unlink()
            except Exception:
                pass
                
        preview_file = temp_dir / f"preview_{uuid.uuid4().hex}.wav"
        
        speed_float = float(speed) if speed else 1.0
        
        if engine == "kokoro":
            if not check_kokoro_assets():
                return {"success": False, "error": "Kokoro models are not downloaded."}
            kokoro_lang = "hi" if language == "hi" else "en-us"
            generate_kokoro_tts(text, str(preview_file), voice=voice, speed=speed_float, lang=kokoro_lang)
        else:
            generate_edge_tts(text, str(preview_file), voice=voice, speed=str(speed), pitch=str(pitch))
            
        if preview_file.exists():
            return {"success": True, "audio_path": str(preview_file)}
    except Exception as e:
        logger.error(f"Preview generation failed: {e}")
        return {"success": False, "error": str(e)}
    return {"success": False, "error": "Unknown error generating audio."}

def setup_bridge_callbacks():
    def safe_log_stream(msg):
        try:
            eel.on_log_stream(msg)
        except Exception:
            pass
    register_log_callback(safe_log_stream)
    
    def safe_progress_update(data):
        try:
            eel.on_progress_update(data)
        except Exception:
            pass
    global_queue_manager.register_progress_callback(safe_progress_update)


@eel.expose
def get_ytdlp_version():
    """Returns the currently installed yt-dlp version and path."""
    from backend.core.config import get_ytdlp_path
    import subprocess
    ytdlp_path = get_ytdlp_path()
    try:
        import subprocess
        import os
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        res = subprocess.run(
            [ytdlp_path, "--version"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=10, startupinfo=startupinfo
        )
        if res.returncode == 0 and res.stdout.strip():
            return {"installed": True, "version": res.stdout.strip(), "path": ytdlp_path}
    except Exception as e:
        logger.warning(f"Could not determine yt-dlp version: {e}")
    return {"installed": False, "version": None, "path": None}

@eel.expose
def update_ytdlp():
    """Downloads the latest yt-dlp binary from GitHub releases in a background thread."""
    global _ytdlp_update_active
    if _ytdlp_update_active:
        return {"status": "already_running"}

    _ytdlp_update_active = True

    def _update_task():
        global _ytdlp_update_active
        try:
            import urllib.request
            import ssl
            import subprocess
            from backend.core.config import BIN_DIR, get_ytdlp_path

            def safe_progress(data):
                try:
                    eel.on_ytdlp_update_progress(data)()
                except Exception:
                    pass

            safe_progress({"status": "checking"})

            # Get current installed version
            current_version = None
            ytdlp_path = get_ytdlp_path()
            try:
                import os
                startupinfo = None
                if os.name == 'nt':
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                res = subprocess.run(
                    [ytdlp_path, "--version"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, timeout=10, startupinfo=startupinfo
                )
                if res.returncode == 0 and res.stdout.strip():
                    current_version = res.stdout.strip()
            except Exception:
                pass

            # Fetch latest version tag from GitHub redirect
            latest_version = None
            try:
                context = ssl._create_unverified_context()
                req = urllib.request.Request(
                    "https://github.com/yt-dlp/yt-dlp/releases/latest",
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                )
                with urllib.request.urlopen(req, context=context, timeout=10) as resp:
                    latest_url = resp.geturl()
                    # URL format: https://github.com/yt-dlp/yt-dlp/releases/tag/YYYY.MM.DD
                    latest_version = latest_url.split("/")[-1]
            except Exception as e:
                logger.warning(f"Could not check latest yt-dlp version online: {e}")

            # If version is already up-to-date, notify and exit
            if current_version and latest_version and current_version == latest_version:
                safe_progress({"status": "up_to_date", "version": current_version})
                logger.info(f"yt-dlp is already up-to-date (version: {current_version})")
                _ytdlp_update_active = False
                return

            safe_progress({"status": "downloading", "progress": 0})

            BIN_DIR.mkdir(parents=True, exist_ok=True)
            ytdlp_ext = ".exe" if os.name == "nt" else ""
            target_path = BIN_DIR / f"yt-dlp{ytdlp_ext}"
            temp_path = BIN_DIR / f"yt-dlp_new{ytdlp_ext}"
            backup_path = BIN_DIR / f"yt-dlp_old{ytdlp_ext}"

            url = f"https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp{ytdlp_ext}"
            context = ssl._create_unverified_context()
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            )

            with urllib.request.urlopen(req, context=context) as response, open(temp_path, "wb") as out_file:
                total_size = int(response.info().get("Content-Length", 0))
                downloaded = 0
                block_size = 1024 * 256  # 256KB

                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    downloaded += len(buffer)
                    out_file.write(buffer)

                    if total_size > 0:
                        percent = int(downloaded * 100 / total_size)
                        safe_progress({"status": "downloading", "progress": percent})

            # Atomic swap: backup old → move new → cleanup backup
            if target_path.exists():
                if backup_path.exists():
                    backup_path.unlink()
                target_path.rename(backup_path)

            temp_path.rename(target_path)

            if backup_path.exists():
                try:
                    backup_path.unlink()
                except Exception:
                    pass

            # Get the new version
            import subprocess
            new_version = "unknown"
            try:
                import os
                startupinfo = None
                if os.name == 'nt':
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                res = subprocess.run(
                    [str(target_path), "--version"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, timeout=10, startupinfo=startupinfo
                )
                if res.returncode == 0 and res.stdout.strip():
                    new_version = res.stdout.strip()
            except Exception:
                pass

            safe_progress({"status": "completed", "new_version": new_version})
            logger.info(f"yt-dlp updated successfully to version {new_version}")

        except Exception as e:
            logger.error(f"yt-dlp update failed: {e}")
            # Clean up temp file if it exists
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except Exception:
                pass
            try:
                eel.on_ytdlp_update_progress({"status": "failed", "error": str(e)})()
            except Exception:
                pass
        finally:
            _ytdlp_update_active = False

    threading.Thread(target=_update_task, daemon=True).start()
    return {"status": "started"}


@eel.expose
def fetch_single_scene_asset(project_id, manifest_scene_index, sub_visual_index, visual_type, visual_cue):
    logger.info(f"Bridge API: fetch_single_scene_asset index {manifest_scene_index}:{sub_visual_index} for project {project_id} (type: {visual_type})")
    from backend.pipeline.assets import fetch_single_scene_asset as fetch_single
    try:
        return fetch_single(project_id, manifest_scene_index, sub_visual_index, visual_type, visual_cue)
    except Exception as e:
        logger.error(f"Failed to fetch single scene asset: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def generate_chart_data_api(prompt):
    """Exposes the AI data generator to the frontend."""
    from backend.pipeline.ai import generate_chart_data
    return generate_chart_data(prompt)

@eel.expose
def save_project_with_cleanup(project_id, script_data, manifest_data):
    """
    Saves script and manifest JSON files, cleaning up removed visual assets.

    Args:
        project_id: Project identifier
        script_data: Script JSON data to save
        manifest_data: Updated manifest structure with sub_visuals

    Returns:
        dict: {success: bool, script_saved: bool, cleanup_result: {...}, error?: str}
    """
    from backend.database.db import get_project
    from backend.pipeline.assets import cleanup_removed_assets, compute_script_content_hash

    result = {"success": True, "script_saved": False, "cleanup_result": None}

    try:
        project = get_project(project_id)
        if not project:
            return {"success": False, "error": "Project not found", "script_saved": False}

        # 1. Save script JSON file
        if project.get('script_path'):
            script_success = save_json_file(project['script_path'], script_data)
            result["script_saved"] = script_success
            if not script_success:
                logger.warning("Script file save failed, but continuing with cleanup")

        # Compute a content hash from the script narration for change detection
        content_hash = compute_script_content_hash(script_data)

        # 2. Cleanup removed assets and save manifest (with content hash embedded)
        cleanup_result = cleanup_removed_assets(project_id, manifest_data, content_hash=content_hash)
        result["cleanup_result"] = cleanup_result

        if not cleanup_result.get("success"):
            logger.warning("Asset cleanup failed, but script was saved")
            result["success"] = False
            result["error"] = cleanup_result.get("error", "Cleanup failed")

    except Exception as e:
        logger.error(f"save_project_with_cleanup failed: {e}", exc_info=True)
        result["success"] = False
        result["error"] = str(e)

    return result


@eel.expose
def update_scene_duration(project_id, scene_index, new_duration_seconds):
    """
    Update a single scene's duration in the manifest file.

    Args:
        project_id: Project identifier
        scene_index: 0-based index in the manifest array (scenes-only, after intro)
        new_duration_seconds: New duration in seconds (must be >= 1.0)

    Returns:
        dict: {success: bool, error?: str}
    """
    from backend.database.db import get_project

    try:
        # 1. Validate parameters
        if new_duration_seconds < 1.0:
            return {"success": False, "error": "Duration must be at least 1.0 seconds"}

        # 2. Load project
        project = get_project(project_id)
        if not project:
            return {"success": False, "error": "Project not found"}

        manifest_path = project.get("assets_manifest_path")
        if not manifest_path or not os.path.exists(manifest_path):
            return {"success": False, "error": "Manifest not found"}

        # 3. Load manifest
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        # 4. Validate scene_index
        if scene_index < 0 or scene_index >= len(manifest):
            return {"success": False, "error": f"Scene index {scene_index} out of range"}

        manifest_entry = manifest[scene_index]
        if not manifest_entry.get("section_type") == "scene":
            return {"success": False, "error": f"Entry at index {scene_index} is not a scene"}

        # 5. Update duration
        old_duration = manifest_entry.get("duration", 0)
        manifest_entry["duration"] = new_duration_seconds
        logger.info(f"Updated scene {scene_index} duration: {old_duration}s -> {new_duration_seconds}s")

        # 6. Remove content hash so pipeline knows to re-check
        for entry in manifest:
            if "_content_hash" in entry:
                del entry["_content_hash"]

        # 7. Write manifest back
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

        return {"success": True}

    except Exception as e:
        logger.error(f"update_scene_duration failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@eel.expose
def reorder_scenes(project_id, new_scene_order):
    """
    Reorder scenes in both script and manifest, cleaning up orphaned assets.

    Args:
        project_id: Project identifier
        new_scene_order: list of int — current scene indices in their new desired order.
                         e.g. [2, 0, 1] means move current scene[2] to position 0,
                         scene[0] to position 1, scene[1] to position 2.

    Returns:
        dict: {success: bool, error?: str}
    """
    from backend.database.db import get_project
    from backend.pipeline.assets import cleanup_removed_assets

    try:
        # 1. Load project
        project = get_project(project_id)
        if not project:
            return {"success": False, "error": "Project not found"}

        script_path = project.get("script_path")
        manifest_path = project.get("assets_manifest_path")
        if not script_path or not os.path.exists(script_path):
            return {"success": False, "error": "Script not found"}
        if not manifest_path or not os.path.exists(manifest_path):
            return {"success": False, "error": "Manifest not found"}

        # 2. Load script and manifest
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        # 3. Validate
        script_scenes = script.get("scenes", [])
        if len(new_scene_order) != len(script_scenes):
            return {"success": False, "error": f"Scene count mismatch: {len(new_scene_order)} vs {len(script_scenes)}"}

        # Validate all indices are valid
        expected_set = set(range(len(script_scenes)))
        if set(new_scene_order) != expected_set:
            return {"success": False, "error": "Invalid scene order indices"}

        # 4. Reorder script scenes
        reordered_script_scenes = [script_scenes[i] for i in new_scene_order]
        for idx, scene in enumerate(reordered_script_scenes):
            scene["scene_number"] = idx + 1
        script["scenes"] = reordered_script_scenes

        # 5. Reorder manifest scenes
        # Manifest structure: [intro(0), scene_1, scene_2, ..., scene_N, conclusion(last)]
        manifest_intro = None
        manifest_conclusion = None
        manifest_scenes = []

        for entry in manifest:
            st = entry.get("section_type")
            if st == "introduction":
                manifest_intro = entry
            elif st == "conclusion":
                manifest_conclusion = entry
            elif st == "scene":
                manifest_scenes.append(entry)

        if len(manifest_scenes) != len(script_scenes):
            return {"success": False, "error": f"Manifest scene count ({len(manifest_scenes)}) doesn't match script ({len(script_scenes)})"}

        reordered_manifest_scenes = [manifest_scenes[i] for i in new_scene_order]

        # Rebuild manifest preserving intro and conclusion
        new_manifest = []
        if manifest_intro:
            new_manifest.append(manifest_intro)
        new_manifest.extend(reordered_manifest_scenes)
        if manifest_conclusion:
            new_manifest.append(manifest_conclusion)

        # 6. Save script
        with open(script_path, "w", encoding="utf-8") as f:
            json.dump(script, f, indent=2, ensure_ascii=False)

        # 7. Use cleanup_removed_assets to save manifest (preserves visual_path by content-match)
        cleanup_result = cleanup_removed_assets(project_id, new_manifest)

        if not cleanup_result.get("success"):
            return {"success": False, "error": cleanup_result.get("error", "Cleanup failed")}

        return {"success": True}

    except Exception as e:
        logger.error(f"reorder_scenes failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@eel.expose
def delete_scene(project_id, scene_index):
    """
    Delete a scene from both script and manifest, cleaning up its assets.

    Args:
        project_id: Project identifier
        scene_index: 0-based index in scriptData.scenes[] to remove

    Returns:
        dict: {success: bool, error?: str}
    """
    from backend.database.db import get_project
    from backend.pipeline.assets import cleanup_removed_assets

    try:
        # 1. Load project
        project = get_project(project_id)
        if not project:
            return {"success": False, "error": "Project not found"}

        script_path = project.get("script_path")
        manifest_path = project.get("assets_manifest_path")
        if not script_path or not os.path.exists(script_path):
            return {"success": False, "error": "Script not found"}
        if not manifest_path or not os.path.exists(manifest_path):
            return {"success": False, "error": "Manifest not found"}

        # 2. Load script and manifest
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        # 3. Validate
        script_scenes = script.get("scenes", [])
        if scene_index < 0 or scene_index >= len(script_scenes):
            return {"success": False, "error": f"Scene index {scene_index} out of range (0-{len(script_scenes)-1})"}

        # 4. Remove from script
        removed_scene = script_scenes.pop(scene_index)
        logger.info(f"Deleted scene {scene_index}: '{removed_scene.get('title', '')}'")

        # Re-number remaining scenes
        for idx, scene in enumerate(script_scenes):
            scene["scene_number"] = idx + 1

        # 5. Remove corresponding entry from manifest
        # Find the Nth scene entry in manifest (skip intro)
        manifest_scene_count = 0
        manifest_remove_idx = -1
        for i, entry in enumerate(manifest):
            if entry.get("section_type") == "scene":
                if manifest_scene_count == scene_index:
                    manifest_remove_idx = i
                    break
                manifest_scene_count += 1

        if manifest_remove_idx >= 0:
            removed = manifest.pop(manifest_remove_idx)
            logger.info(f"Removed corresponding manifest entry for scene {scene_index}")

        # 6. Save script
        with open(script_path, "w", encoding="utf-8") as f:
            json.dump(script, f, indent=2, ensure_ascii=False)

        # 7. Save manifest via cleanup (handles orphaned asset cleanup)
        cleanup_result = cleanup_removed_assets(project_id, manifest)

        if not cleanup_result.get("success"):
            return {"success": False, "error": cleanup_result.get("error", "Cleanup failed")}

        return {"success": True}

    except Exception as e:
        logger.error(f"delete_scene failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

