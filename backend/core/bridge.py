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
def browse_workspace_directory():
    """Opens folder explorer for workspace directory."""
    logger.info("Bridge API: browse_workspace_directory called")
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        dir_path = filedialog.askdirectory(title="Select Workspace Folder")
        root.destroy()
        return dir_path
    except Exception as e:
        logger.error(f"Folder explorer error: {e}")
        return ""

@eel.expose
def browse_bg_music_file():
    """Opens file explorer to select background soundtrack."""
    logger.info("Bridge API: browse_bg_music_file called")
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        file_path = filedialog.askopenfilename(
            title="Select Soundtrack File",
            filetypes=[("Audio Files", "*.mp3 *.wav *.ogg *.flac *.m4a"), ("All Files", "*.*")]
        )
        root.destroy()
        return file_path
    except Exception as e:
        logger.error(f"File explorer error: {e}")
        return ""

@eel.expose
def db_get_projects():
    return get_all_projects()

@eel.expose
def db_get_project(project_id):
    return get_project(project_id)

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
def create_new_project(name, prompt, language="hi", style="nitish_rajput", duration_mode="medium"):
    try:
        project_id = create_project(name, prompt, language, style, duration_mode)
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
def get_active_queue():
    return global_queue_manager.get_queue_status()

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
        "Choose visual_type from: 'chart', 'map', 'document', 'portrait', 'scene', 'youtube'.\n"
        "- Use 'youtube' only when the scene needs actual real footage, interviews, or historical news clips (e.g., visual_cue = '1992 Harshad Mehta news footage').\n"
        "- Optimize visual_cue as a simple stock media keyword (nouns and adjectives in English, e.g., 'vintage typewriter writing') when visual_type is 'scene' or 'image'.\n"
        "- If visual_type is 'document', visual_meta must contain: { \"headline\": \"Exact news headline\", \"doc_text\": \"Detailed newspaper excerpt matching the narration\", \"source\": \"Name of Publisher\", \"date\": \"Month DD, YYYY\" }\n"
    )
    
    if language != "en":
        system_prompt += f"The rewritten narration text MUST be written in the requested language (code: '{language}'). Visual suggestions MUST remain in English.\n\n"
    else:
        system_prompt += "The rewritten narration text MUST be written in English.\n\n"
        
    from backend.pipeline.ai import INTRO_JSON_SCHEMA, CONCLUSION_JSON_SCHEMA, SCENE_JSON_SCHEMA
    if section_type == "introduction":
        target_content = full_script.get("introduction", {})
        prompt_struct = "Expected: { \"hook\": \"text\", \"visual_cue\": \"text\", \"visual_type\": \"text\", \"visual_meta\": {} }"
        schema = INTRO_JSON_SCHEMA
    elif section_type == "conclusion":
        target_content = full_script.get("conclusion", {})
        prompt_struct = "Expected: { \"summary\": \"text\", \"cta\": \"text\", \"visual_cue\": \"text\", \"visual_type\": \"text\", \"visual_meta\": {} }"
        schema = CONCLUSION_JSON_SCHEMA
    else:
        scenes = full_script.get("scenes", [])
        target_content = scenes[scene_idx] if scene_idx < len(scenes) else {}
        prompt_struct = "Expected: { \"scene_number\": N, \"title\": \"text\", \"narration\": \"text\", \"visual_cue\": \"text\", \"visual_type\": \"text\", \"visual_meta\": {} }"
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

@eel.expose
def get_audio_base64(file_path):
    import base64
    if not file_path or not os.path.exists(file_path):
        return ""
    try:
        with open(file_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
            return f"data:audio/wav;base64,{encoded}"
    except Exception as e:
        logger.error(f"Failed to encode audio file to base64: {e}")
        return ""

@eel.expose
def open_exports_folder():
    import subprocess
    import platform
    from backend.core.config import get_exports_dir
    exports_dir = get_exports_dir()
    try:
        if platform.system() == "Windows":
            os.startfile(str(exports_dir))
        elif platform.system() == "Darwin":
            subprocess.run(["open", str(exports_dir)])
        else:
            subprocess.run(["xdg-open", str(exports_dir)])
        return True
    except Exception as e:
        logger.error(f"Failed to open exports directory: {e}")
        return False

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
        res = subprocess.run(
            [ytdlp_path, "--version"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=10
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
                res = subprocess.run(
                    [ytdlp_path, "--version"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, timeout=10
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
                res = subprocess.run(
                    [str(target_path), "--version"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, timeout=10
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
def fetch_single_scene_asset(project_id, manifest_scene_index, visual_type, visual_cue):
    logger.info(f"Bridge API: fetch_single_scene_asset index {manifest_scene_index} for project {project_id} (type: {visual_type})")
    from backend.pipeline.assets import fetch_single_scene_asset as fetch_single
    try:
        return fetch_single(project_id, manifest_scene_index, visual_type, visual_cue)
    except Exception as e:
        logger.error(f"Failed to fetch single scene asset: {e}")
        return {"success": False, "error": str(e)}

@eel.expose
def generate_chart_data_api(prompt):
    """Exposes the AI data generator to the frontend."""
    from backend.pipeline.ai import generate_chart_data
    return generate_chart_data(prompt)

