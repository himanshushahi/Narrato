import json
import os
import threading
import queue
import time
import requests
from pathlib import Path
from typing import Any

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
from backend.pipeline.ai import (
    SCRIPT_INTRO_JSON_SCHEMA, SCRIPT_CONCLUSION_JSON_SCHEMA, SCRIPT_SCENE_JSON_SCHEMA,
    SUB_VISUAL_SCHEMA, VISUALS_ARRAY_SCHEMA, clean_json_response, _get_web_context, _generate_search_query
)
from backend.core.power import power_manager, auto_instrument_bridge

ui_queue = queue.Queue()
_kokoro_download_active = False
_whisper_download_active = False
_ytdlp_update_active = False


def ui_update_loop():
    while True:
        try:
            while not ui_queue.empty():
                func_name, args = ui_queue.get_nowait()
                try:
                    power_manager.ping()
                    _call_js_func(func_name, *args)
                except Exception as e:
                    print(f"UI queue dispatch error: {e}")
        except queue.Empty:
            pass
        time.sleep(0.1)


def _call_js_func(func_name: str, *args):
    import webview
    js_args = ', '.join(json.dumps(a, default=str) for a in args)
    js_code = f"window.{func_name}({js_args})"
    for w in webview.windows:
        try:
            w.evaluate_js(js_code)
        except Exception:
            pass


def _call_llm_api_direct(system_prompt, user_prompt, schema, llm_provider, api_key, base_url, model):
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7
    }
    if llm_provider == "nvidia":
        data["guided_json"] = schema
    else:
        data["response_format"] = {"type": "json_object"}
    try:
        response = requests.post(url, headers=headers, json=data, timeout=60)
        response.raise_for_status()
        res = response.json()["choices"][0]["message"]["content"]
        rewritten_data = clean_json_response(res)
        return {"success": True, "data": rewritten_data}
    except Exception as e:
        logger.error(f"Failed direct LLM call: {e}")
        return {"success": False, "error": str(e)}


@auto_instrument_bridge
class ApiBridge:
    def __init__(self, window_id: int = 0):
        self.window_id = window_id
        self._window = None

    def _get_window(self):
        import webview
        return self._window or (webview.windows[0] if webview.windows else None)

    def get_prefs(self):
        from backend.core.prefs import load_prefs
        return load_prefs()

    def save_prefs(self, data):
        from backend.core.prefs import save_prefs
        save_prefs(data)
        return {"success": True}

    def get_file_server_port(self) -> int:
        from backend.core.file_server import get_file_server_port
        return get_file_server_port() or 0

    def browse_export_directory(self) -> str:
        logger.info("Bridge API: browse_export_directory called")
        import webview
        window = self._get_window()
        if not window:
            return ""
        try:
            result = window.create_file_dialog(
                dialog_type=webview.FOLDER_DIALOG,
                allow_multiple=False
            )
            return result[0] if result else ""
        except Exception as e:
            logger.error(f"Folder explorer error: {e}")
            return ""

    def browse_bg_music_file(self) -> str:
        logger.info("Bridge API: browse_bg_music_file called")
        import webview
        window = self._get_window()
        if not window:
            return ""
        try:
            result = window.create_file_dialog(
                dialog_type=webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=('Audio Files (*.mp3;*.wav;*.ogg;*.flac;*.m4a)', 'All Files (*.*)')
            )
            if not result:
                return ""
            file_path = result[0]
        except Exception as e:
            logger.error(f"browse_bg_music_file error: {e}")
            return ""

        import shutil
        from backend.core.config import get_assets_dir

        src = Path(file_path).resolve()
        ext = src.suffix.lower() or ".mp3"
        assets_dir = get_assets_dir()
        dest = (assets_dir / f"bg_music{ext}").resolve()

        if src == dest:
            logger.info(f"Background music already in assets dir: {dest}")
            return str(dest)

        logger.info(f"Copying background music: {src} -> {dest}")
        for old in assets_dir.glob("bg_music.*"):
            if old.resolve() != dest:
                try:
                    old.unlink()
                    logger.info(f"Removed stale background music: {old}")
                except Exception as e:
                    logger.warning(f"Could not remove stale bg_music {old}: {e}")
        try:
            shutil.copy(str(src), str(dest))
            logger.info(f"Background music copied successfully to {dest}")
            return str(dest)
        except Exception as e:
            logger.error(f"browse_bg_music_file copy error: {e}")
            return ""

    def clear_bg_music(self) -> dict:
        logger.info("Bridge API: clear_bg_music called")
        try:
            from backend.core.config import get_assets_dir
            assets_dir = get_assets_dir()
            deleted = False
            for old in assets_dir.glob("bg_music.*"):
                try:
                    old.unlink()
                    logger.info(f"Deleted background music file: {old}")
                    deleted = True
                except Exception as e:
                    logger.warning(f"Could not delete bg_music file {old}: {e}")
            update_settings({"bg_music_path": ""})
            logger.info("Cleared bg_music_path setting.")
            return {"success": True, "deleted_file": deleted}
        except Exception as e:
            logger.error(f"clear_bg_music error: {e}")
            return {"success": False, "error": str(e)}

    def upload_project_bg_music(self, project_id: str) -> dict:
        logger.info(f"Bridge API: upload_project_bg_music called for {project_id}")
        import webview
        window = self._get_window()
        if not window:
            return {"success": False, "path": None, "error": "No window"}
        try:
            result = window.create_file_dialog(
                dialog_type=webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=('Audio Files (*.mp3;*.wav;*.ogg;*.flac;*.m4a)', 'All Files (*.*)')
            )
            if not result:
                return {"success": False, "path": None, "error": "No file selected"}
            file_path = result[0]
        except Exception as e:
            logger.error(f"upload_project_bg_music error: {e}")
            return {"success": False, "path": None, "error": str(e)}

        import shutil
        from backend.core.config import get_storage_dir

        proj_dir = get_storage_dir() / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)
        src = Path(file_path)
        ext = src.suffix.lower()
        dest = proj_dir / f"bg_music{ext}"
        try:
            shutil.copy(str(src), str(dest))
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
            logger.error(f"upload_project_bg_music copy error: {e}")
            return {"success": False, "path": None, "error": str(e)}

    def db_get_projects(self) -> list:
        return get_all_projects()

    def db_get_project(self, project_id: str) -> dict:
        return get_project(project_id)

    def db_update_project(self, project_id: str, updates_dict: dict) -> dict:
        try:
            update_project(project_id, **updates_dict)
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to update project: {e}")
            return {"success": False, "error": str(e)}

    def db_delete_project(self, project_id: str) -> bool:
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

    def db_get_project_tasks(self, project_id: str) -> list:
        return get_project_tasks(project_id)

    def db_get_settings(self) -> dict:
        return get_all_settings()

    def db_update_settings(self, settings_dict: dict) -> bool:
        update_settings(settings_dict)
        return True

    def create_new_project(self, name: str, prompt: str, export_folder: str, language: str = "hi", style: str = "nitish_rajput", duration_mode: str = "medium", video_format: str = "landscape") -> dict:
        try:
            project_id = create_project(name, prompt, export_folder, language, style, duration_mode, video_format)
            return {"project_id": project_id, "success": True}
        except Exception as e:
            logger.error(f"Error creating project: {e}")
            return {"error": str(e), "success": False}

    def start_processing_pipeline(self, project_id: str, steps: list) -> dict:
        logger.info(f"Bridge API: start_processing_pipeline for {project_id} (steps: {steps})")
        success = global_queue_manager.queue_project(project_id, steps)
        return {"success": success}

    def resume_processing_pipeline(self, project_id: str, steps: list) -> dict:
        success = global_queue_manager.queue_project(project_id, steps, is_resume=True)
        return {"success": success}

    def cancel_processing_pipeline(self, project_id: str) -> bool:
        global_queue_manager.cancel_project(project_id)
        return True

    def read_json_file(self, file_path: str) -> Any:
        if not file_path or not os.path.exists(file_path):
            return None
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read JSON file: {e}")
            return None

    def save_json_file(self, file_path: str, data: Any) -> bool:
        try:
            Path(file_path).parent.mkdir(parents=True, exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error(f"Failed to save JSON file: {e}")
            return False

    def scan_assets_directory(self, project_id: str) -> dict:
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
                    files.append({
                        "filename": entry.name,
                        "path": str(entry),
                        "size_bytes": stat.st_size,
                        "last_modified": stat.st_mtime,
                        "extension": entry.suffix.lower(),
                    })
                    total_size += stat.st_size
        except Exception as e:
            logger.error(f"Failed to scan assets directory: {e}")

        return {"files": files, "total_size": total_size, "total_files": len(files)}

    def download_google_font(self, font_family: str) -> dict:
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
            css_url = f"https://fonts.googleapis.com/css2?family={url_family}:wght@400;700;800;900&display=swap"
            req = urllib.request.Request(css_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
            with urllib.request.urlopen(req, timeout=10) as response:
                css_content = response.read().decode('utf-8')
            urls = re.findall(r"url\((https://[^)]+)\)", css_content)
            if not urls:
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
                import urllib.parse
                file_server_port = self.get_file_server_port()
                if file_server_port:
                    local_url = f"http://localhost:{file_server_port}/api/media?path={urllib.parse.quote(str(local_font_path))}"
                else:
                    local_url = f"/api/media?path={urllib.parse.quote(str(local_font_path))}"
                css_content = css_content.replace(font_url, local_url)
            with open(css_file, "w", encoding="utf-8") as f:
                f.write(css_content)
            return {"success": True, "css_path": str(css_file)}
        except Exception as e:
            logger.error(f"Failed to download font {font_family}: {e}")
            return {"success": False, "error": str(e)}

    def check_kokoro_downloaded(self) -> bool:
        return check_kokoro_assets()

    def delete_kokoro_models(self) -> dict:
        try:
            from backend.pipeline.tts import delete_kokoro_assets
            success = delete_kokoro_assets()
            if success:
                return {"success": True, "message": "Kokoro models deleted successfully."}
            else:
                return {"success": False, "error": "Models not found or could not be deleted."}
        except Exception as e:
            logger.error(f"Kokoro model delete failed: {e}")
            return {"success": False, "error": str(e)}

    def start_kokoro_download(self) -> dict:
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
                        ui_queue.put(("onKokoroDownloadProgress", (data,)))
                    except Exception:
                        pass
                safe_progress({"file": "model", "progress": 0})
                download_file_with_progress(KOKORO_MODEL_URL, KOKORO_MODEL_PATH, lambda p: safe_progress({"file": "model", "progress": p}))
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

    def check_whisper_downloaded(self, model_size: str) -> bool:
        from backend.pipeline.transcribe import check_whisper_assets
        return check_whisper_assets(model_size)

    def start_whisper_download(self, model_size: str) -> dict:
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
                        ui_queue.put(("onWhisperDownloadProgress", (data,)))
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

    def get_downloaded_whisper_models(self) -> list:
        from backend.pipeline.transcribe import list_downloaded_whisper_models
        return list_downloaded_whisper_models()

    def delete_whisper_model(self, safe_dir_name: str) -> dict:
        from backend.pipeline.transcribe import delete_whisper_model as _delete_model
        return {"success": _delete_model(safe_dir_name)}

    def check_nvidia_gpu_available(self) -> bool:
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

    def regenerate_script_section(self, scene_idx: int, section_type: str, full_script: dict, rewrite_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: regenerate_script_section index {scene_idx} ({section_type})")
        llm_provider = get_setting("llm_provider") or "openai"
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"
        if not api_key:
            return {"success": False, "error": "Please configure an OpenAI API Key first."}
        existing_scenes = full_script.get("scenes", [])
        scenes_summary = "\n".join(
            f"  Scene {s.get('scene_number', i + 1)}: \"{s.get('title', 'Untitled')}\" — {s.get('narration', '')[:120]}..."
            for i, s in enumerate(existing_scenes)
        )
        intro_hook = full_script.get("introduction", {}).get("hook", "")[:200]
        conclusion_summary = full_script.get("conclusion", {}).get("summary", "")[:200]
        system_prompt = (
            "You are an expert AI scriptwriter. You will receive a script segment, "
            "and a prompt request explaining how to modify or rewrite this segment. "
            "Your task is to rewrite ONLY the narration text (hook/narration/summary) and title. "
            "Return ONLY valid JSON matching the provided structure. No markdown backticks.\n\n"
            "CRITICAL — NARRATION RULES:\n"
            "- The `narration`/`hook`/`summary`/`cta` field is the spoken voiceover. It MUST be a non-empty string.\n"
            "- Do NOT skip narration. Do NOT leave it blank or null.\n"
            "- Never repeat the video title verbatim in spoken text. The title is an internal label — write original spoken content instead.\n"
            "- Keep the rewrite concise and match the original segment's length.\n\n"
            "HERE IS THE FULL SCRIPT CONTEXT (For maintaining narrative flow and consistency):\n"
            f"Video Title: \"{full_script.get('title', 'Untitled')}\"\n"
            f"Introduction Hook: \"{intro_hook}\"\n"
            f"Existing Scenes:\n{scenes_summary if scenes_summary else '  (none yet)'}\n"
            f"Conclusion: \"{conclusion_summary}\"\n\n"
        )
        if language != "en":
            system_prompt += (
                f"LANGUAGE: The rewritten narration MUST be written in language code '{language}'.\n"
                f"For example, if the language is Hindi ('hi'), you MUST use the Devanagari script (हिंदी). "
                f"Do NOT use English alphabet transliterations.\n\n"
            )
        else:
            system_prompt += "LANGUAGE: The rewritten narration MUST be written in English.\n\n"
        if section_type == "introduction":
            target_content = full_script.get("introduction", {})
            prompt_struct = "Expected: { \"hook\": \"text\" }"
            schema = SCRIPT_INTRO_JSON_SCHEMA
        elif section_type == "conclusion":
            target_content = full_script.get("conclusion", {})
            prompt_struct = "Expected: { \"summary\": \"text\", \"cta\": \"text\" }"
            schema = SCRIPT_CONCLUSION_JSON_SCHEMA
        else:
            scenes = full_script.get("scenes", [])
            target_content = scenes[scene_idx] if scene_idx < len(scenes) else {}
            prompt_struct = "Expected: { \"scene_number\": N, \"title\": \"text\", \"narration\": \"text\" }"
            schema = SCRIPT_SCENE_JSON_SCHEMA
        if section_type not in ("introduction", "conclusion"):
            lengths = [len(s.get('narration', '').split()) for s in existing_scenes if s.get('narration')]
            avg_len = max(20, sum(lengths) // len(lengths)) if lengths else 80
            system_prompt += f"LENGTH: Aim for approximately {avg_len} words in the rewritten narration — match the pacing of surrounding scenes.\n\n"
        content_is_empty = False
        if section_type == "introduction":
            content_is_empty = not target_content.get("hook", "").strip()
        elif section_type == "conclusion":
            content_is_empty = not target_content.get("summary", "").strip()
        else:
            content_is_empty = not target_content.get("narration", "").strip()
        if content_is_empty:
            section_label = section_type.replace("_", " ").title()
            user_prompt = (
                f"Create a brand new {section_label} section for this video based on the user's request below.\n"
                f"Use the full script context above to ensure narrative consistency.\n\n"
                f"User Request: {rewrite_prompt}\n\n"
                f"Generate the JSON segment now. Structure matches: {prompt_struct}."
            )
        else:
            user_prompt = (
                f"Original Segment:\n{json.dumps(target_content, indent=2)}\n\n"
                f"Rewrite Instruction: {rewrite_prompt}\n\n"
                f"Generate the rewritten JSON segment now. Structure matches: {prompt_struct}."
            )
        doc_title = full_script.get("title", "Untitled")
        _search_q = _generate_search_query(f"{doc_title} - {rewrite_prompt[:100]}", "script rewrite")
        _web_ctx = _get_web_context(_search_q)
        if _web_ctx:
            user_prompt += f"\n\n---\nIncorporate relevant facts from this web search into your rewrite:\n{_web_ctx}"
        return _call_llm_api_direct(system_prompt, user_prompt, schema, llm_provider, api_key, base_url, model)

    def regenerate_visuals_section(self, scene_idx: int, section_type: str, full_script: dict, rewrite_prompt: str) -> dict:
        logger.info(f"Bridge API: regenerate_visuals_section index {scene_idx} ({section_type})")
        llm_provider = get_setting("llm_provider") or "openai"
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"
        if not api_key:
            return {"success": False, "error": "Please configure an OpenAI API Key first."}
        system_prompt = (
            "You are an expert AI Visual Director. You will receive a script segment (narration) "
            "and a prompt explaining how to modify or rewrite its visuals. "
            "Your task is to generate ONLY the 'sub_visuals' array for this segment.\n"
            "Return ONLY valid JSON matching the provided schema. No markdown backticks.\n\n"
            "IMPORTANT: Every sub_visual must have 'visual_type', 'visual_cue' (ALWAYS in English), 'transition', 'duration' (in seconds), and 'visual_meta'.\n"
            "Choose visual_type from: 'chart', 'map', 'document', 'portrait', 'scene', 'image', 'youtube', 'parallax', 'network', 'list', 'custom_html'.\n\n"
            "QUANTITY: Let the narration length and pacing dictate how many sub-visuals to generate. Break the narration into logical visual beats — one sub-visual per beat. Each sub-visual should have a meaningful duration (2-15 seconds). The sum of all durations MUST equal the provided Total Duration. For 'list' type: create 1 sub-visual PER LIST ITEM.\n\n"
            "TYPE SELECTION GUIDE — match the visual to the narration content:\n"
            "- list: For ranked items, countdowns, top-N lists, or step-by-step rankings.\n"
            "- chart: For statistics, percentages, comparisons, or data trends.\n"
            "- map: For geography, routes, locations, or movement between places.\n"
            "- document: For historical claims, news events, or archival evidence.\n"
            "- network: For connections between people, organizations, or relationships.\n"
            "- portrait: For introducing real specific people or places.\n"
            "- parallax: For dramatic layered depth reveals.\n"
            "- custom_html: For highly customized typography layouts, raw HTML/CSS art, or custom animations.\n"
            "- scene/image: Default visual support for general narration.\n"
            "- youtube: For real-world footage other than portraits.\n\n"
            "VISUAL META SCHEMAS — fill these creatively to match the narration:\n"
            "- scene/image/parallax: visual_meta {} (portrait may add {\"person_name\": str})\n"
            "- PORTRAIT CRITICAL: visual_cue must be ONLY the entity's exact name (e.g. \"Harshad Mehta\"). Used as a Wikipedia search query.\n"
            "- youtube: visual_meta {\"start_offset\": 15, \"duration\": 15, \"skip_intro\": true}\n"
            "- chart: visual_meta {\"chart_type\": \"bar\"|\"line\"|\"pie\", \"title\": str, \"data\": [{\"label\": str, \"value\": number}]}\n"
            "- map: visual_meta {\"map_style\": \"vintage\", \"locations\": [{\"name\": str, \"coord\": [lat, lon]}]} (2 locations)\n"
            "- document: visual_meta {\"title\": str, \"headline\": str, \"subtitle\": str, \"doc_text\": str, \"highlight_text\": str, \"source\": str, \"date\": str, \"section\": str, \"pull_quote\": str, \"show_image\": bool, \"image_url\": str, \"image_caption\": str}\n"
            "- network: visual_meta {\"theme\": \"conspiracy_board\"|\"cyberpunk\"|\"corporate\", \"nodes\": [{\"id\": str, \"label\": str, \"type\": \"person\"|\"entity\"}], \"edges\": [{\"source\": str, \"target\": str}]}\n"
            "- list: visual_meta {\"number\": int, \"title\": str, \"description\": str}\n"
            "- custom_html: visual_meta {\"html\": str, \"css\": str} (Note: HTML is injected into a 100% width/height relative wrapper. Write raw CSS.)\n"
            "- CRITICAL ON LOWER THIRDS: ONLY use {\"lower_third\": {\"title\": str, \"subtitle\": str}} for media types like 'scene', 'image', 'portrait', 'parallax', or 'youtube'. NEVER use lower_third for data types like 'custom_html', 'chart', 'list', 'map', 'document', or 'network'. For those, bake any titles directly into their specific visual_meta fields (e.g., HTML/CSS).\n\n"
            "Transitions ('transition' field): choose from 'subtle_slide', 'fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'zoom_in', 'zoom_out', 'glitch', 'none'. Do NOT use the same transition repeatedly! Vary the transitions to make the video dynamic.\n"
        )
        if section_type == "introduction":
            target_content = full_script.get("introduction", {})
        elif section_type == "conclusion":
            target_content = full_script.get("conclusion", {})
        else:
            scenes = full_script.get("scenes", [])
            target_content = scenes[scene_idx] if scene_idx < len(scenes) else {}
        current_visuals = target_content.get("sub_visuals", [])
        total_duration = sum(sv.get("duration", 0) for sv in current_visuals)
        if total_duration <= 0:
            total_duration = 15.0
        prompt_struct = "Expected: { \"sub_visuals\": [{ \"visual_type\": \"...\", \"visual_cue\": \"...\", \"transition\": \"...\", \"visual_meta\": {}, \"duration\": 15.0 }] }"
        user_prompt = (
            f"Video Title: \"{full_script.get('title', 'Untitled')}\"\n"
            f"Narration for this segment:\n\"{target_content.get('narration', target_content.get('hook', target_content.get('summary', '')))}\"\n\n"
            f"Current Sub-Visuals:\n{json.dumps(current_visuals, indent=2)}\n\n"
            f"Rewrite Instruction: {rewrite_prompt}\n\n"
            f"Total Duration to fill: {total_duration} seconds.\n"
            f"Generate the rewritten JSON sub_visuals array now. The sum of sub-visual durations MUST equal {total_duration}. Structure matches: {prompt_struct}."
        )
        return _call_llm_api_direct(system_prompt, user_prompt, VISUALS_ARRAY_SCHEMA, llm_provider, api_key, base_url, model)

    def regenerate_sub_visual(self, scene_idx: int, section_type: str, sub_idx: int, full_script: dict, rewrite_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: regenerate_sub_visual index {scene_idx} ({section_type}) sub {sub_idx}")
        llm_provider = get_setting("llm_provider") or "openai"
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"
        if not api_key:
            return {"success": False, "error": "Please configure an OpenAI API Key first."}
        system_prompt = (
            "You are an expert AI visual designer. You will receive a single 'sub_visual' object from a video script, "
            "along with the surrounding narration context, and a prompt request explaining how to modify or rewrite this specific visual. "
            "Your task is to rewrite this single sub-visual based strictly on the user's request. "
            "You may change any field including 'visual_type' if the user's request warrants it. "
            "Do NOT change the narration.\n"
            "Return ONLY valid JSON matching the sub_visual schema. No markdown backticks.\n\n"
            "The sub_visual has: { \"visual_type\": \"...\", \"visual_cue\": \"...\", \"transition\": \"...\", \"visual_meta\": {}, \"duration\": float }\n\n"
            "TYPE-SPECIFIC META SCHEMAS (fill creatively based on the visual_type):\n"
            "- list: visual_meta { \"number\": int, \"title\": str, \"description\": str }\n"
            "- chart: visual_meta { \"chart_type\": \"bar\"|\"line\"|\"pie\", \"title\": str, \"data\": [{ \"label\": str, \"value\": number }] }\n"
            "- map: visual_meta { \"map_style\": \"vintage\", \"locations\": [{ \"name\": str, \"coord\": [lat, lon] }] }\n"
            "- document: visual_meta { \"headline\": str, \"doc_text\": str, \"source\": str, \"date\": str }\n"
            "- network: visual_meta { \"theme\": \"conspiracy_board\"|\"corporate\"|\"cyberpunk\", \"nodes\": [...], \"edges\": [...] }\n"
            "- custom_html: visual_meta { \"html\": str, \"css\": str }\n"
            "- portrait: visual_cue must be ONLY the person's full name (used as Wikipedia search query).\n"
            "- scene/image/parallax/youtube: visual_meta {} unless adding lower_third.\n"
            "- CRITICAL ON LOWER THIRDS: ONLY use {\"lower_third\": {\"title\": str, \"subtitle\": str}} for media types like 'scene', 'image', 'portrait', 'parallax', or 'youtube'. NEVER use lower_third for data types like 'custom_html', 'chart', 'list', 'map', 'document', or 'network'. For those, bake any titles directly into their specific visual_meta fields (e.g., HTML/CSS).\n\n"
            "Transitions: choose from 'subtle_slide', 'fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'zoom_in', 'zoom_out', 'glitch', 'none'. "
            "Do NOT use the same transition as before — vary it.\n"
            f"LANGUAGE: The 'visual_cue' field MUST be in English. All 'visual_meta' text content MUST be in English. "
            f"Lower third titles/subtitles should be in language code '{language}'.\n"
        )
        if section_type == "introduction":
            section = full_script.get("introduction", {})
        elif section_type == "conclusion":
            section = full_script.get("conclusion", {})
        else:
            scenes = full_script.get("scenes", [])
            if scene_idx >= len(scenes):
                return {"success": False, "error": "Invalid scene index"}
            section = scenes[scene_idx]
        sub_visuals = section.get("sub_visuals", [])
        if sub_idx >= len(sub_visuals):
            return {"success": False, "error": "Invalid sub visual index"}
        target_sub_visual = sub_visuals[sub_idx]
        prompt_struct = "Expected: { \"visual_type\": \"...\", \"visual_cue\": \"...\", \"transition\": \"...\", \"visual_meta\": {}, \"duration\": 4.5 }"
        scene_title = section.get('title', 'Introduction/Conclusion')
        doc_title = full_script.get('title', 'Untitled')
        user_prompt = (
            f"Video Title: \"{doc_title}\"\n"
            f"Scene Title: \"{scene_title}\"\n"
            f"Context (Narration of this scene):\n\"{section.get('narration', section.get('hook', section.get('summary', '')))}\"\n\n"
            f"Original Sub-Visual:\n{json.dumps(target_sub_visual, indent=2)}\n\n"
            f"Rewrite Instruction: {rewrite_prompt}\n\n"
            f"Generate the rewritten JSON sub-visual now. Structure matches: {prompt_struct}."
        )
        return _call_llm_api_direct(system_prompt, user_prompt, SUB_VISUAL_SCHEMA, llm_provider, api_key, base_url, model)

    def add_scene_with_ai(self, full_script: dict, user_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: add_scene_with_ai — user_prompt: '{user_prompt[:80]}...'")
        llm_provider = get_setting("llm_provider") or "openai"
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"
        if not api_key:
            return {"success": False, "error": "Please configure an OpenAI API Key first."}
        existing_scenes = full_script.get("scenes", [])
        scenes_summary = "\n".join(
            f"  Scene {s.get('scene_number', i + 1)}: \"{s.get('title', 'Untitled')}\" — {s.get('narration', '')[:120]}..."
            for i, s in enumerate(existing_scenes)
        )
        intro_hook = full_script.get("introduction", {}).get("hook", "")[:200]
        conclusion_summary = full_script.get("conclusion", {}).get("summary", "")[:200]
        scene_lengths = [len(s.get('narration', '').split()) for s in existing_scenes if s.get('narration')]
        avg_scene_words = max(20, sum(scene_lengths) // len(scene_lengths)) if scene_lengths else 80
        system_prompt = (
            "You are an expert video scriptwriter. Your task is to create a BRAND NEW scene "
            "to insert into an existing video script. The new scene must fit naturally into the "
            "narrative flow, maintaining consistent tone, style, and pacing with the surrounding content.\n\n"
            "HERE IS THE FULL SCRIPT CONTEXT:\n"
            f"Video Title: \"{full_script.get('title', 'Untitled')}\"\n"
            f"Introduction Hook: \"{intro_hook}\"\n"
            f"Existing Scenes:\n{scenes_summary if scenes_summary else '  (none yet)'}\n"
            f"Conclusion: \"{conclusion_summary}\"\n\n"
            "IMPORTANT: You are generating ONLY the script/narration for this scene. "
            "Do NOT generate visual cues or a sub_visuals array. The visual team will add visuals later based on your narration.\n\n"
            "CRITICAL — NARRATION RULES:\n"
            "- The `narration` field is the spoken voiceover. It MUST be a non-empty string.\n"
            "- Do NOT skip narration. Do NOT leave it blank or null.\n"
            "- Never repeat the video title verbatim in spoken text. The title is an internal label — write original spoken content instead.\n"
            f"- LENGTH: Aim for approximately {avg_scene_words} words — match the pacing of the surrounding scenes.\n\n"
            "Return ONLY valid JSON matching the scene schema. No markdown backticks.\n"
            "Expected: { \"scene_number\": N, \"title\": \"text\", \"narration\": \"text\" }\n"
        )
        if language != "en":
            system_prompt += (
                f"LANGUAGE: The narration MUST be written in language code '{language}'.\n"
                f"For example, if the language is Hindi ('hi'), you MUST use the Devanagari script (हिंदी). "
                f"Do NOT use English alphabet transliterations.\n\n"
            )
        else:
            system_prompt += "LANGUAGE: The narration text MUST be written in English.\n\n"
        user_content = (
            f"Generate a new scene for this video based on the following description:\n\n"
            f"{user_prompt}\n\n"
            f"Make the scene fit naturally with the existing narrative. "
            f"The scene_number will be assigned by the system, so just put 1 as a placeholder."
        )
        doc_title = full_script.get("title", "Untitled")
        _scene_q = _generate_search_query(f"{doc_title} - add scene: {user_prompt[:100]}", "add new scene")
        _web_ctx = _get_web_context(_scene_q)
        if _web_ctx:
            user_content += f"\n\n---\nIncorporate relevant facts from this web search into your new scene:\n{_web_ctx}"
        result = _call_llm_api_direct(system_prompt, user_content, SCRIPT_SCENE_JSON_SCHEMA, llm_provider, api_key, base_url, model)
        if result.get("success") and "data" in result:
            result["data"]["sub_visuals"] = []
        return result

    def generate_voice_preview(self, text: str, engine: str, voice: str, speed: str, pitch: str, language: str) -> dict:
        logger.info(f"Bridge API: generate_voice_preview engine={engine} voice={voice}")
        try:
            from backend.core.config import get_temp_dir
            from backend.pipeline.tts import generate_edge_tts, generate_kokoro_tts
            import uuid
            temp_dir = get_temp_dir()
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
            elif engine == "piper":
                from backend.tts import generate_tts as piper_tts
                try:
                    out_path = piper_tts(text, voice, speed=speed_float)
                    import shutil
                    shutil.move(out_path, str(preview_file))
                except Exception as e:
                    logger.error(f"Piper preview failed: {e}")
                    return {"success": False, "error": str(e)}
            else:
                generate_edge_tts(text, str(preview_file), voice=voice, speed=str(speed), pitch=str(pitch))
            if preview_file.exists():
                return {"success": True, "audio_path": str(preview_file)}
        except Exception as e:
            logger.error(f"Preview generation failed: {e}")
            return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unknown error generating audio."}

    def download_piper_model(self, voice_id: str) -> dict:
        """Trigger Piper model and config download in the background"""
        try:
            logger.info(f"Bridge API: download_piper_model voice={voice_id}")
            from backend.tts import download_piper_voice
            res = download_piper_voice(voice_id)
            return res
        except Exception as e:
            logger.error(f"Piper model download failed: {e}")
            return {"status": "error", "message": str(e)}

    def check_piper_model(self, voice_id: str) -> bool:
        """Check if a Piper model is already downloaded."""
        try:
            from backend.tts import check_piper_voice
            return check_piper_voice(voice_id)
        except Exception as e:
            logger.error(f"Piper model check failed: {e}")
            return False

    def delete_piper_model(self, voice_id: str) -> dict:
        """Delete a downloaded Piper model."""
        try:
            logger.info(f"Bridge API: delete_piper_model voice={voice_id}")
            from backend.tts import delete_piper_voice
            success = delete_piper_voice(voice_id)
            if success:
                return {"success": True, "message": "Model deleted successfully."}
            else:
                return {"success": False, "error": "Model not found or could not be deleted."}
        except Exception as e:
            logger.error(f"Piper model delete failed: {e}")
            return {"success": False, "error": str(e)}

    def generate_piper_tts(self, text: str, voice_id: str, quality: str = "medium", speed: float = 1.0) -> dict:
        logger.info(f"Bridge API: generate_piper_tts voice={voice_id}")
        from backend.tts import generate_tts
        try:
            audio_path = generate_tts(text, voice_id, speed=speed)
            return {"success": True, "audio_path": audio_path}
        except Exception as e:
            logger.error(f"Piper TTS generation failed: {e}")
            return {"success": False, "error": str(e)}


    def get_ytdlp_version(self) -> dict:
        from backend.core.config import get_ytdlp_path
        import subprocess
        ytdlp_path = get_ytdlp_path()
        try:
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

    def update_ytdlp(self) -> dict:
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
                        ui_queue.put(("onYtdlpUpdateProgress", (data,)))
                    except Exception:
                        pass

                safe_progress({"status": "checking"})
                current_version = None
                ytdlp_path = get_ytdlp_path()
                try:
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

                latest_version = None
                try:
                    context = ssl._create_unverified_context()
                    req = urllib.request.Request(
                        "https://github.com/yt-dlp/yt-dlp/releases/latest",
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                    )
                    with urllib.request.urlopen(req, context=context, timeout=10) as resp:
                        latest_url = resp.geturl()
                        latest_version = latest_url.split("/")[-1]
                except Exception as e:
                    logger.warning(f"Could not check latest yt-dlp version online: {e}")

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
                    block_size = 1024 * 256
                    while True:
                        buffer = response.read(block_size)
                        if not buffer:
                            break
                        downloaded += len(buffer)
                        out_file.write(buffer)
                        if total_size > 0:
                            percent = int(downloaded * 100 / total_size)
                            safe_progress({"status": "downloading", "progress": percent})
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
                new_version = "unknown"
                try:
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
                try:
                    if temp_path.exists():
                        temp_path.unlink()
                except Exception:
                    pass
                try:
                    ui_queue.put(("onYtdlpUpdateProgress", ({"status": "failed", "error": str(e)},)))
                except Exception:
                    pass
            finally:
                _ytdlp_update_active = False

        threading.Thread(target=_update_task, daemon=True).start()
        return {"status": "started"}

    def fetch_single_scene_asset(self, project_id: str, manifest_scene_index: int, sub_visual_index: int, visual_type: str, visual_cue: str) -> dict:
        logger.info(f"Bridge API: fetch_single_scene_asset index {manifest_scene_index}:{sub_visual_index} for project {project_id} (type: {visual_type})")
        from backend.pipeline.assets import fetch_single_scene_asset as fetch_single
        try:
            return fetch_single(project_id, manifest_scene_index, sub_visual_index, visual_type, visual_cue)
        except Exception as e:
            logger.error(f"Failed to fetch single scene asset: {e}")
            return {"success": False, "error": str(e)}

    def preview_asset_download(self, project_id: str, visual_type: str, visual_cue: str) -> dict:
        logger.info(f"Bridge API: preview_asset_download for project {project_id} (type: {visual_type}, cue: {visual_cue})")
        from backend.pipeline.assets import preview_asset_download as preview_fn
        try:
            return preview_fn(project_id, visual_type, visual_cue)
        except Exception as e:
            logger.error(f"Failed to preview asset: {e}")
            return {"success": False, "error": str(e)}

    def cleanup_preview_assets(self, project_id: str, preview_paths: list) -> dict:
        logger.info(f"Bridge API: cleanup_preview_assets for project {project_id} ({len(preview_paths)} files)")
        from backend.pipeline.assets import cleanup_preview_assets as cleanup_fn
        try:
            return cleanup_fn(project_id, preview_paths)
        except Exception as e:
            logger.error(f"Failed to cleanup preview assets: {e}")
            return {"success": False, "error": str(e)}

    def generate_chart_data_api(self, prompt: str) -> dict:
        from backend.pipeline.ai import generate_chart_data
        return generate_chart_data(prompt)

    def save_project_with_cleanup(self, project_id: str, script_data: dict, manifest_data: dict) -> dict:
        from backend.database.db import get_project
        from backend.pipeline.assets import cleanup_removed_assets, compute_script_content_hash

        result = {"success": True, "script_saved": False, "cleanup_result": None}
        try:
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found", "script_saved": False}
            if project.get('script_path'):
                script_success = self.save_json_file(project['script_path'], script_data)
                result["script_saved"] = script_success
                if not script_success:
                    logger.warning("Script file save failed, but continuing with cleanup")
            content_hash = compute_script_content_hash(script_data)
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

    def update_scene_duration(self, project_id: str, scene_index: int, new_duration_seconds: float) -> dict:
        from backend.database.db import get_project
        try:
            if new_duration_seconds < 1.0:
                return {"success": False, "error": "Duration must be at least 1.0 seconds"}
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found"}
            manifest_path = project.get("assets_manifest_path")
            if not manifest_path or not os.path.exists(manifest_path):
                return {"success": False, "error": "Manifest not found"}
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if scene_index < 0 or scene_index >= len(manifest):
                return {"success": False, "error": f"Scene index {scene_index} out of range"}
            manifest_entry = manifest[scene_index]
            if not manifest_entry.get("section_type") == "scene":
                return {"success": False, "error": f"Entry at index {scene_index} is not a scene"}
            manifest_entry["duration"] = new_duration_seconds
            logger.info(f"Updated scene {scene_index} duration: -> {new_duration_seconds}s")
            for entry in manifest:
                if "_content_hash" in entry:
                    del entry["_content_hash"]
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            return {"success": True}
        except Exception as e:
            logger.error(f"update_scene_duration failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def reorder_scenes(self, project_id: str, new_scene_order: list) -> dict:
        from backend.database.db import get_project
        from backend.pipeline.assets import cleanup_removed_assets
        try:
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found"}
            script_path = project.get("script_path")
            manifest_path = project.get("assets_manifest_path")
            if not script_path or not os.path.exists(script_path):
                return {"success": False, "error": "Script not found"}
            has_manifest = bool(manifest_path and os.path.exists(manifest_path))
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
            manifest = []
            if has_manifest:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            script_scenes = script.get("scenes", [])
            if len(new_scene_order) != len(script_scenes):
                return {"success": False, "error": f"Scene count mismatch: {len(new_scene_order)} vs {len(script_scenes)}"}
            expected_set = set(range(len(script_scenes)))
            if set(new_scene_order) != expected_set:
                return {"success": False, "error": "Invalid scene order indices"}
            reordered_script_scenes = [script_scenes[i] for i in new_scene_order]
            for idx, scene in enumerate(reordered_script_scenes):
                scene["scene_number"] = idx + 1
            script["scenes"] = reordered_script_scenes
            if has_manifest:
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
                    logger.warning(f"Manifest scene count ({len(manifest_scenes)}) doesn't match script ({len(script_scenes)}), skipping manifest reorder.")
                    has_manifest = False
                else:
                    reordered_manifest_scenes = [manifest_scenes[i] for i in new_scene_order]
                    new_manifest = []
                    if manifest_intro:
                        new_manifest.append(manifest_intro)
                    new_manifest.extend(reordered_manifest_scenes)
                    if manifest_conclusion:
                        new_manifest.append(manifest_conclusion)
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)
            if has_manifest:
                cleanup_result = cleanup_removed_assets(project_id, new_manifest)
                if not cleanup_result.get("success"):
                    return {"success": False, "error": cleanup_result.get("error", "Cleanup failed")}
            return {"success": True}
        except Exception as e:
            logger.error(f"reorder_scenes failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def delete_scene(self, project_id: str, scene_index: int) -> dict:
        from backend.database.db import get_project
        from backend.pipeline.assets import cleanup_removed_assets
        try:
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found"}
            script_path = project.get("script_path")
            manifest_path = project.get("assets_manifest_path")
            if not script_path or not os.path.exists(script_path):
                return {"success": False, "error": "Script not found"}
            has_manifest = bool(manifest_path and os.path.exists(manifest_path))
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
            manifest = []
            if has_manifest:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            script_scenes = script.get("scenes", [])
            if scene_index < 0 or scene_index >= len(script_scenes):
                return {"success": False, "error": f"Scene index {scene_index} out of range (0-{len(script_scenes)-1})"}
            removed_scene = script_scenes.pop(scene_index)
            logger.info(f"Deleted scene {scene_index}: '{removed_scene.get('title', '')}'")
            for idx, scene in enumerate(script_scenes):
                scene["scene_number"] = idx + 1
            if has_manifest:
                manifest_scene_count = 0
                manifest_remove_idx = -1
                for i, entry in enumerate(manifest):
                    if entry.get("section_type") == "scene":
                        if manifest_scene_count == scene_index:
                            manifest_remove_idx = i
                            break
                        manifest_scene_count += 1
                if manifest_remove_idx >= 0:
                    manifest.pop(manifest_remove_idx)
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)
            if has_manifest:
                cleanup_result = cleanup_removed_assets(project_id, manifest)
                if not cleanup_result.get("success"):
                    return {"success": False, "error": cleanup_result.get("error", "Cleanup failed")}
            return {"success": True}
        except Exception as e:
            logger.error(f"delete_scene failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}


api_bridge = ApiBridge()


def setup_bridge_callbacks():
    def safe_log_stream(msg):
        try:
            ui_queue.put(("onLogStream", (msg,)))
        except Exception:
            pass
    register_log_callback(safe_log_stream)

    def safe_progress_update(data):
        try:
            ui_queue.put(("onProgressUpdate", (data,)))
        except Exception:
            pass
    global_queue_manager.register_progress_callback(safe_progress_update)
