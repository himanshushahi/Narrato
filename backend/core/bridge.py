import json
import os
import re
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
    download_file_with_progress
)
from backend.pipeline.ai import (
    SCRIPT_INTRO_JSON_SCHEMA, SCRIPT_CONCLUSION_JSON_SCHEMA, SCRIPT_SCENE_JSON_SCHEMA,
    SUB_VISUAL_SCHEMA, VISUALS_ARRAY_SCHEMA, _call_llm_json, _get_web_context_for_topic,
    get_shared_visual_rules
)
from backend.core.power import power_manager, auto_instrument_bridge

ui_queue = queue.Queue()
_xtts_download_active = False
_whisper_download_active = False
_ytdlp_update_active = False
_gpu_download_active = False
_gpu_download_cancel = None


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


def _safe_float(val, default: float = 0.0) -> float:
    """Safely convert a value to float, returning default on failure."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _probe_video_codec(path_str: str):
    """Return (ok, codec_name) for the first video stream via the bundled ffprobe.

    Chrome/Chromium (both the WebView2 preview and Remotion's headless-Chrome
    export) can only decode H.264/AVC, VP8, VP9 and AV1. HEVC/H.265 files
    (iPhone/GoPro/DJI default) pass a container-extension check and play in the
    preview, but produce a black clip in the export — so the codec is validated
    at upload time instead. Returns ok=False with codec 'none' when the file has
    no video stream, and 'unknown' when ffprobe itself failed.
    """
    import subprocess
    from backend.core.config import get_ffprobe_path, get_startupinfo
    try:
        cmd = [
            get_ffprobe_path(), "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name",
            "-of", "csv=p=0",
            str(path_str),
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=30, startupinfo=get_startupinfo())
        codec = result.stdout.decode("utf-8", errors="ignore").strip().lower()
        if not codec:
            return False, "none"
        return codec in ("h264", "vp8", "vp9", "av1"), codec
    except Exception as e:
        logger.warning(f"FFprobe failed for {path_str}: {e}")
        return False, "unknown"


def _sweep_stale_uploads(project_id: str, max_age_seconds: int = 3600):
    """Delete abandoned preview uploads for a project.

    Every upload copies a fresh previews/upload_<uuid>.<ext> file. Files orphaned
    by an app close without save, or by an upload that was cancelled before the
    edit was committed, would otherwise linger forever — with multi-hundred-MB
    video uploads that is real disk churn. Anything older than max_age_seconds
    is presumed abandoned (an active session finalizes within minutes)."""
    import time
    from backend.core.config import get_storage_dir
    preview_dir = get_storage_dir() / project_id / "assets" / "previews"
    if not preview_dir.exists():
        return
    now = time.time()
    for f in preview_dir.iterdir():
        try:
            if not f.name.startswith("upload_"):
                continue
            if now - f.stat().st_mtime > max_age_seconds:
                f.unlink()
                logger.info(f"Swept stale preview upload: {f}")
        except OSError:
            pass


def _get_design_system_prompt(project_id: str) -> str:
    from backend.core.config import get_storage_dir
    from backend.pipeline.ai import format_design_system_prompt
    from backend.database.db import get_project
    project_dir = get_storage_dir() / project_id
    design_path = project_dir / "design.json"
    if design_path.exists():
        try:
            with open(design_path, "r", encoding="utf-8") as f:
                design_data = json.load(f)
            # Validate design matches current project language/format
            project = get_project(project_id)
            if project:
                if design_data.get('_language') != project.get('language', 'hi'):
                    logger.warning(f"design.json language mismatch for {project_id}, ignoring stale design")
                    return ""
                if design_data.get('_video_format') != project.get('video_format', 'landscape'):
                    logger.warning(f"design.json format mismatch for {project_id}, ignoring stale design")
                    return ""
            return format_design_system_prompt(design_data)
        except Exception as e:
            logger.warning(f"Failed to load design.json for project {project_id}: {e}")
    return ""



def _get_section_narration(section_type: str, section_data: dict) -> str:
    """Extract narration text from a script section, handling field-name differences.

    Introduction uses 'hook', scenes use 'narration', conclusion uses
    'summary' + 'cta'.  Centralised here to prevent field-name divergence
    across callers.
    """
    if section_type == "conclusion":
        return f"{section_data.get('summary', '')} {section_data.get('cta', '')}".strip()
    # Introduction stores narration in 'hook'; scenes in 'narration'.
    # Fall back to whichever exists.
    return section_data.get('narration', section_data.get('hook', ''))


def _get_scene_word_timings(project_id: str, scene_idx: int, section_type: str, full_script: dict) -> str:
    """Load word-level Whisper transcription and extract timestamps for a specific scene.

    Computes the cumulative audio offset by summing manifest durations for all
    preceding scenes, then filters transcription words falling within this scene's
    time window.  Returns a formatted string suitable for injection into an LLM
    prompt, or an empty string when transcription data is unavailable.

    It also compares the current script hash against the manifest's stored hash
    to detect if the user has edited the script or reordered scenes since the
    last voiceover generation. If so, timestamps are labelled as approximate.
    """
    try:
        from backend.core.config import get_storage_dir
        project = get_project(project_id)
        if not project:
            return ""

        # Load transcription data
        transcription_path = project.get("transcription_path", "")
        if not transcription_path or not os.path.exists(transcription_path):
            return ""

        with open(transcription_path, "r", encoding="utf-8") as f:
            transcription_data = json.load(f)

        if not transcription_data or "segments" not in transcription_data:
            return ""

        # Load manifest for reliable scene-level durations
        manifest_path = project.get("assets_manifest_path", "")
        if not manifest_path or not os.path.exists(manifest_path):
            # Fallback to voiceover manifest
            manifest_path = str(get_storage_dir() / project_id / "voiceover" / "manifest.json")
        if not os.path.exists(manifest_path):
            return ""

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        # Compute the manifest index for this scene
        # Manifest order: [introduction?, scene_0, scene_1, ..., conclusion?]
        target_manifest_idx = None
        for m_idx, entry in enumerate(manifest):
            m_section = entry.get("section_type", "")
            if section_type == "introduction" and m_section == "introduction":
                target_manifest_idx = m_idx
                break
            elif section_type == "conclusion" and m_section == "conclusion":
                target_manifest_idx = m_idx
                break
            elif section_type == "scenes" and m_section == "scene":
                # Count scene entries to match scene_idx
                scene_count = sum(1 for e in manifest[:m_idx] if e.get("section_type") == "scene")
                if scene_count == scene_idx:
                    target_manifest_idx = m_idx
                    break

        if target_manifest_idx is None:
            return ""

        # Out-of-bounds check for scenes
        if section_type == "scenes":
            scenes = full_script.get("scenes", [])
            if scene_idx >= len(scenes):
                return ""

        target_entry = manifest[target_manifest_idx]

        # Detect stale timestamps by comparing THIS scene's current narration
        # against the manifest text that was used when voiceover was generated.
        # Using per-scene text comparison (not whole-script hash) so that editing
        # an unrelated scene doesn't mark this scene's timestamps as approximate.
        is_stale = False
        if section_type == "introduction":
            current_section = full_script.get("introduction", {})
        elif section_type == "conclusion":
            current_section = full_script.get("conclusion", {})
        elif section_type == "scenes":
            scenes = full_script.get("scenes", [])
            current_section = scenes[scene_idx] if scene_idx < len(scenes) else {}
        else:
            current_section = {}

        current_narration = _get_section_narration(section_type, current_section)
        manifest_narration = target_entry.get("text", "")
        if manifest_narration and manifest_narration.strip() != current_narration.strip():
            is_stale = True

        # Compute cumulative audio offset up to target scene
        cumulative_time = 0.0
        for m_idx, entry in enumerate(manifest):
            if m_idx == target_manifest_idx:
                break
            cumulative_time += _safe_float(entry.get("duration", 0))

        scene_duration = _safe_float(target_entry.get("duration", 15.0), 15.0)

        # Extract words within this scene's time window
        words_in_scene = []
        for seg in transcription_data["segments"]:
            for w in seg.get("words", []):
                w_start = w.get("start", 0)
                if w_start >= cumulative_time and w_start < cumulative_time + scene_duration:
                    words_in_scene.append(
                        f"{(w.get('word') or '').strip()} [{w_start - cumulative_time:.1f}s]"
                    )

        if not words_in_scene:
            return ""

        if is_stale:
            header = (
                "\nAPPROXIMATE Spoken Word Timestamps (narration has been edited since last voiceover — "
                "timestamps are from the PREVIOUS audio and may not align precisely with current text):\n"
            )
        else:
            header = "\nExact Spoken Words with Timestamps (Seconds from Scene Start):\n"

        return header + " ".join(words_in_scene) + "\n"

    except Exception as e:
        logger.warning(f"Failed to load word timings for scene {scene_idx} ({section_type}): {e}")
        return ""


def _format_sub_visual_durations(sub_visuals: list, highlight_idx: int = -1) -> str:
    """Format a compact duration breakdown table for all sub-visuals in a scene.

    When highlight_idx >= 0, marks that specific sub-visual as the one being
    edited.  Returns a string like:

        Sub-Visual Durations (this scene):
        [0] document "GDP growth report" — 3.5s (starts at 0.0s)
        [1] portrait "Harshad Mehta" — 4.5s (starts at 3.5s)  ← EDITING THIS
        [2] scene "stock exchange" — 7.0s (starts at 8.0s)
    """
    if not sub_visuals:
        return ""

    lines = ["Sub-Visual Durations (this scene's TARGET timeline):"]
    cumulative = 0.0
    for i, sv in enumerate(sub_visuals):
        if not isinstance(sv, dict):
            continue
        dur = _safe_float(sv.get("duration", 0))
        marker = "  ← EDITING THIS" if i == highlight_idx else ""
        lines.append(f'  [{i}] AST node — {dur}s (starts at {cumulative:.1f}s){marker}')
        cumulative += dur

    return "\n".join(lines) + "\n"


def _call_llm_safe(system_prompt, user_prompt, schema, cancel_event=None, use_tools=False, allowed_tools=None):
    """Wrapper around ai._call_llm_json that catches exceptions and returns dict.

    Provides retry, streaming, and automatic provider resolution via the
    pipeline's _call_llm_json. Bridge endpoints should use this instead of
    making raw HTTP calls.

    Args:
        cancel_event: Optional threading.Event for cancellation. Bridge
            endpoints currently don't expose a cancel mechanism, so this
            defaults to a never-set event (no-op). Pipeline callers pass
            a real event wired to the QueueManager's cancel machinery.
        use_tools: When True, the call runs through AgentRunner.run_with_tools_safe,
            letting the model emit ```tool``` blocks (web search, skill lookup,
            project file reads) before producing the final JSON.
    """
    import threading
    if cancel_event is None:
        cancel_event = threading.Event()  # never set for bridge calls
    try:
        if use_tools:
            from backend.agent.agent_engine import AgentRunner
            from backend.agent.tools import get_tools_schema
            
            if allowed_tools is None:
                allowed_tools = [t["function"]["name"] for t in get_tools_schema()]
                
            return AgentRunner(cancel_event=cancel_event).run_with_tools_safe(
                system_prompt, user_prompt, schema, allowed_tools=allowed_tools)
        data = _call_llm_json(system_prompt, user_prompt, schema, cancel_event)
        return {"success": True, "data": data}
    except InterruptedError:
        return {"success": False, "error": "Operation cancelled."}
    except Exception as e:
        logger.error(f"LLM call failed: {type(e).__name__}: {e}")
        return {"success": False, "error": str(e)}


@auto_instrument_bridge
class ApiBridge:
    def __init__(self, window_id: int = 0):
        self.window_id = window_id
        self._window = None

    def _get_window(self):
        import webview
        return self._window or (webview.windows[0] if webview.windows else None)

    def get_agent_activity(self) -> list:
        """Return the live agent-activity feed (tool/skill/file/llm/web), newest first."""
        from backend.agent.telemetry import get_agent_activity
        return get_agent_activity()

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

    def create_new_project(self, name: str, video_type: str, export_folder: str, language: str = "hi", style: str = "nitish_rajput", duration_mode: str = "medium", video_format: str = "landscape") -> dict:
        try:
            project_id = create_project(name, video_type, export_folder, language, style, duration_mode, video_format)
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

    def check_xtts_downloaded(self) -> bool:
        from backend.xtts import check_xtts_model
        return check_xtts_model()

    def delete_xtts_model(self) -> dict:
        try:
            from backend.xtts import delete_xtts_model
            success = delete_xtts_model()
            if success:
                return {"success": True, "message": "XTTS model deleted successfully."}
            else:
                return {"success": False, "error": "Model not found or could not be deleted."}
        except Exception as e:
            logger.error(f"XTTS model delete failed: {e}")
            return {"success": False, "error": str(e)}

    def start_xtts_download(self) -> dict:
        global _xtts_download_active
        if _xtts_download_active:
            return {"status": "already_running"}
        from backend.xtts import check_xtts_model
        if check_xtts_model():
            return {"status": "already_downloaded"}
        _xtts_download_active = True

        def _download_task():
            global _xtts_download_active
            try:
                def safe_progress(data):
                    try:
                        ui_queue.put(("onXttsDownloadProgress", (data,)))
                    except Exception:
                        pass
                safe_progress({"file": "model", "progress": 0})
                from backend.xtts import download_xtts_model
                download_xtts_model(progress_callback=safe_progress)
                safe_progress({"status": "completed"})
                logger.info("XTTS model downloaded successfully.")
            except Exception as e:
                logger.error(f"XTTS model download failed: {e}")
                safe_progress({"status": "failed", "error": str(e)})
            finally:
                _xtts_download_active = False

        threading.Thread(target=_download_task, daemon=True).start()
        return {"status": "started"}

    def upload_reference_voice(self) -> dict:
        """Opens a file dialog to select a reference voice .wav file for XTTS voice cloning.

        The clip is converted to a 22050 Hz mono WAV and stored under a
        content-addressed filename (xtts_reference_voice_<hash>.wav) so that
        re-uploading a different clip yields a different path. Downstream
        voiceover staleness checks compare the reference path, so a new upload
        correctly triggers voiceover regeneration.
        """
        try:
            import webview
            window = webview.windows[0] if webview.windows else None
            if not window:
                return {"success": False, "error": "No window available."}

            result = window.create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=('Audio Files (*.wav;*.mp3;*.flac)', 'All Files (*.*)'),
                allow_multiple=False
            )

            if not result or len(result) == 0:
                return {"success": False, "error": "No file selected."}

            selected_path = result[0]
            if not Path(selected_path).exists():
                return {"success": False, "error": "Selected file does not exist."}

            # Convert to 22050 Hz mono wav if needed, staged in the temp dir so a
            # failed conversion never leaves a half-written file in assets/.
            import hashlib
            import shutil
            from backend.core.config import get_assets_dir, get_ffmpeg_path, get_startupinfo, get_temp_dir

            tmp_wav = get_temp_dir() / "xtts_reference_upload_tmp.wav"
            tmp_wav.unlink(missing_ok=True)

            ext = Path(selected_path).suffix.lower()
            if ext != '.wav':
                import subprocess
                cmd = [get_ffmpeg_path(), "-y", "-i", selected_path, "-ar", "22050", "-ac", "1", str(tmp_wav)]
                result_proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, startupinfo=get_startupinfo())
                if result_proc.returncode != 0:
                    err_msg = result_proc.stderr.decode("utf-8", errors="ignore")
                    logger.error(f"Reference voice conversion failed: {err_msg}")
                    return {"success": False, "error": f"Audio conversion failed: {err_msg[-300:]}"}
            else:
                shutil.copy2(selected_path, tmp_wav)

            if not tmp_wav.exists() or tmp_wav.stat().st_size == 0:
                return {"success": False, "error": "Converted reference voice is empty."}

            # Content-addressed filename: re-uploading a different clip changes the
            # path, which is exactly what downstream staleness checks compare.
            file_hash = hashlib.sha256()
            with open(tmp_wav, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    file_hash.update(chunk)

            assets_dir = get_assets_dir()
            assets_dir.mkdir(parents=True, exist_ok=True)
            dest = assets_dir / f"xtts_reference_voice_{file_hash.hexdigest()[:12]}.wav"

            if dest.exists():
                tmp_wav.unlink(missing_ok=True)
            else:
                shutil.move(str(tmp_wav), str(dest))

            # Gather all currently active reference voice paths from prefs
            from backend.core.prefs import load_prefs
            prefs = load_prefs()
            active_paths = set()
            global_ref = prefs.get("xtts_reference_voice")
            if global_ref:
                active_paths.add(Path(global_ref).resolve())
            for p in prefs.get("xtts_profiles", []):
                prof_ref = p.get("reference_voice")
                if prof_ref:
                    active_paths.add(Path(prof_ref).resolve())

            # Remove stale reference voice files so only the current clip remains.
            for old in assets_dir.glob("xtts_reference_voice*.wav"):
                if old.resolve() != dest.resolve() and old.resolve() not in active_paths:
                    try:
                        old.unlink()
                        logger.info(f"Removed stale reference voice: {old}")
                    except Exception as e:
                        logger.warning(f"Could not remove stale reference voice {old}: {e}")

            logger.info(f"Reference voice saved to {dest}")
            return {"success": True, "path": str(dest), "filename": Path(selected_path).name}
        except Exception as e:
            logger.error(f"Reference voice upload failed: {e}")
            return {"success": False, "error": str(e)}

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
        from backend.core.gpu_runtime import gpu_status
        if gpu_status()["nvidia_driver"]:
            return True
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:
            return False

    def gpu_status(self) -> dict:
        from backend.core.gpu_runtime import gpu_status as _runtime_status
        return _runtime_status()

    def gpu_download_start(self) -> dict:
        global _gpu_download_active, _gpu_download_cancel
        if _gpu_download_active:
            return {"status": "already_running"}
        from backend.core.gpu_runtime import gpu_status as _status, download_runtime
        st = _status()
        if st.get("runtime_installed") and st.get("manifest_valid"):
            return {"status": "already_downloaded"}
        _gpu_download_active = True
        _gpu_download_cancel = threading.Event()

        def _task():
            global _gpu_download_active, _gpu_download_cancel
            try:
                def safe_progress(data):
                    try:
                        ui_queue.put(("onGpuDownloadProgress", (data,)))
                    except Exception:
                        pass
                result = download_runtime(
                    progress_cb=lambda p: safe_progress({"status": "downloading", "progress": p}),
                    cancel_event=_gpu_download_cancel,
                )
                if result["success"]:
                    safe_progress({"status": "completed"})
                    logger.info("GPU runtime downloaded. Restart the app to activate it.")
                else:
                    safe_progress({"status": "failed", "error": result["error"]})
            except Exception as e:
                logger.error(f"GPU runtime download failed: {e}")
                safe_progress({"status": "failed", "error": str(e)})
            finally:
                _gpu_download_active = False
                _gpu_download_cancel = None

        threading.Thread(target=_task, daemon=True).start()
        return {"status": "started"}

    def gpu_download_cancel(self) -> dict:
        global _gpu_download_cancel
        if _gpu_download_cancel is not None:
            _gpu_download_cancel.set()
            return {"status": "cancelling"}
        return {"status": "not_running"}

    def gpu_set_enabled(self, enabled: bool) -> dict:
        from backend.core.prefs import save_prefs
        save_prefs({"gpu_enabled": bool(enabled)})
        return {"restart_required": True, "gpu_enabled": bool(enabled)}

    def gpu_remove_runtime(self) -> dict:
        from backend.core.gpu_runtime import remove_runtime
        from backend.core.prefs import save_prefs
        ok = remove_runtime()
        save_prefs({"gpu_enabled": False})
        return {"success": ok}

    # Tool sets for each bridge endpoint are imported from agent_engine.py
    # (BRIDGE_SCRIPT_TOOLS, BRIDGE_VISUAL_TOOLS, BRIDGE_ADD_SCENE_TOOLS)
    # and passed via _call_llm_safe(allowed_tools=...) to scope each call.

    def regenerate_script_section(self, scene_idx: int, section_type: str, full_script: dict, rewrite_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: regenerate_script_section index {scene_idx} ({section_type})")
        existing_scenes = full_script.get("scenes", [])
        scenes_summary = "\n".join(
            f"  Scene {s.get('scene_number', i + 1)}: \"{s.get('title', 'Untitled')}\" — {s.get('narration', '')[:120]}..."
            for i, s in enumerate(existing_scenes)
        )
        intro_hook = full_script.get("introduction", {}).get("hook", "")[:200]
        conclusion_summary = full_script.get("conclusion", {}).get("summary", "")[:200]
        doc_title = full_script.get('title', 'Untitled')
        lang_instr = ""
        if language != "en":
            lang_instr = (
                f"LANGUAGE SPELLING RULE:\n"
                f"- The rewritten narration MUST be written in language code '{language}'.\n"
                f"- This means for '{language}', you MUST use the {'Devanagari script' if language == 'hi' else 'standard'} script.\n"
                f"- NEVER use English alphabet transliterations (for example, DO NOT write 'namaste' for 'नमस्ते').\n"
                f"- This rule applies to ALL text in your output: hook, narration, summary, cta, and title.\n\n"
                "SPELLING AND VOCABULARY:\n"
                "- Use only standard spelling and established terminology\n"
                "- Include proper diacritics for non-English languages\n"
                "- Match the linguistic style and complexity expected by native speakers\n\n"
            )
        else:
            lang_instr = "LANGUAGE RULE:\n- The rewritten narration MUST be written in English.\n\n"

        length_constraint = ""
        if section_type not in ("introduction", "conclusion"):
            lengths = [len(s.get('narration', '').split()) for s in existing_scenes if s.get('narration')]
            avg_len = max(20, sum(lengths) // len(lengths)) if lengths else 80
            length_constraint = (
                f"LENGTH CONSTRAINT:\n"
                f"- Aim for approximately {avg_len} words in the rewritten narration.\n"
                f"- This equals {avg_len * 60 / 180:.1f} to {avg_len * 60 / 150:.1f} seconds of spoken audio (150-180 WPM).\n"
                f"- Match the pacing and content density of surrounding scenes.\n\n"
            )

        from backend.agent.skill_loader import skill_loader
        system_prompt = skill_loader.render_skill(
            "script-rewriter",
            language=language,
            doc_title=doc_title,
            intro_hook=intro_hook,
            scenes_summary=scenes_summary if scenes_summary else '  (none yet)',
            conclusion_summary=conclusion_summary,
            language_instructions=lang_instr,
            length_constraint=length_constraint,
        )
        if not system_prompt:
            system_prompt = (
                "You are an expert AI scriptwriter with deep knowledge of video production and narrative structure. You will receive a script segment and a rewrite prompt explaining exactly how to modify it.\n\n"
                "CRITICAL CORE REQUIREMENTS:\n"
                "1. MAINTAIN NARRATIVE CONSISTENCY: You MUST preserve the video's core message and tone while making specific changes requested.\n"
                f"2. LANGUAGE PRECISION: NEVER use English transliterations. Write in the target language ({language}) - for Hindi use Devanagari script (हिंदी), for English use English. NO English words in Hindi sections.\n"
                "3. STRUCTURE CONSISTENCY: Return ONLY valid JSON matching the provided schema exactly.\n"
                "4. ANTI-HALLUCINATION: Do NOT invent facts, dates, names, or data you don't have evidence for. Only use verifiable information.\n"
                "5. LENGTH AWARENESS: Match the speaking duration (roughly 180-220 words per minute).\n"
                "6. TTS-FRIENDLY WRITING: Write numbers as words (\"forty-two\" NOT \"42\"), avoid abbreviations (\"for example\" NOT \"e.g.\"), use short clear sentences, avoid special characters (& @ ©), write dates in full, use commas/periods for pauses.\n\n"
                "HERE IS THE COMPLETE SCRIPT CONTEXT:\n"
                f"Video Title: {doc_title}\n"
                f"Introduction Hook: {intro_hook}\n"
                f"Existing Scenes:\n{scenes_summary if scenes_summary else '  (none yet)'}\n"
                f"Conclusion: {conclusion_summary}\n\n"
                "CONTEXTUAL CONSTRAINTS:\n"
                "- This is part of a multi-scene YouTube video with specific duration targets.\n"
                "- Narration should sound natural when spoken aloud, with proper rhythm and pacing.\n"
                "- Every sentence must be factual, specific, and verifiable.\n"
                "- Avoid generic phrases, clichés, and vague statements.\n"
                "- Each scene should have a unique, memorable angle on the topic.\n\n"
                f"{lang_instr}"
                f"{length_constraint}"
            )

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
                f"CREATE NEW SECTION: Generate a brand new {section_label} section for this video.\n"
                f"Use the full script context above to ensure narrative consistency and coherence.\n\n"
                f"USER REQUEST: {rewrite_prompt}\n\n"
                f"CRITICAL CREATION REQUIREMENTS:\n"
                f"- The section must fit seamlessly into the existing narrative flow.\n"
                f"- Include specific, factual information that supports the video's core message.\n"
                f"- Match the speaking style and complexity appropriate for the target audience.\n"
                f"- Ensure proper {('Devanagari script' if language == 'hi' else 'English')} spelling and grammar.\n"
                f"- Generate the JSON segment now. Structure matches: {prompt_struct}.\n"
            )
        else:
            user_prompt = (
                f"ORIGINAL SEGMENT:\n{json.dumps(target_content, indent=2)}\n\n"
                f"REWRITE INSTRUCTION: {rewrite_prompt}\n\n"
                f"CRITICAL REWRITE REQUIREMENTS:\n"
                f"- MODIFY SPECIFICALLY: Make only the changes explicitly requested by the user.\n"
                f"- preserve ALL other content exactly as is.\n"
                f"- MAINTAIN NARRATIVE FLOW: Ensure the rewrite connects smoothly with surrounding content.\n"
                f"- LANGUAGE CONSISTENCY: Use {('Devanagari script' if language == 'hi' else 'English')} script consistently.\n"
                f"- SPEAKING CLARITY: Make sure it sounds natural when spoken aloud.\n"
                f"- ACCURACY: Include only verifiable, factual information.\n"
                f"- Generate the rewritten JSON segment now. Structure matches: {prompt_struct}.\n"
            )

        doc_title = full_script.get("title", "Untitled")

        # Try to get relevant web search context
        _web_ctx = _get_web_context_for_topic(f"{doc_title} - script rewrite: {rewrite_prompt[:100]}", "script rewrite")
        if _web_ctx:
            user_prompt += f"\n\nRELEVANT WEB SEARCH CONTEXT:\n"
            user_prompt += f"The AI has found relevant web search results that may help with this rewrite. Incorporate specific facts and details from these sources to enhance the rewritten section.\n\n"
            user_prompt += f"Web Search Results:\n{_web_ctx}\n\n"
            user_prompt += f"Use ONLY verified information from these sources. DO NOT use information from general knowledge or invented facts.\n"

        from backend.agent.agent_engine import BRIDGE_SCRIPT_TOOLS
        return _call_llm_safe(system_prompt, user_prompt, schema, use_tools=True, allowed_tools=BRIDGE_SCRIPT_TOOLS)

    def regenerate_visuals_section(self, project_id: str, scene_idx: int, section_type: str, full_script: dict, rewrite_prompt: str) -> dict:
        logger.info(f"Bridge API: regenerate_visuals_section index {scene_idx} ({section_type})")
        video_format = full_script.get("video_format", "landscape")
        language = full_script.get("language", "hi")
        visual_rules = get_shared_visual_rules(video_format, language)
        design_system_text = _get_design_system_prompt(project_id)

        from backend.agent.skill_loader import skill_loader
        system_prompt = skill_loader.render_skill(
            "visual-rewriter",
            design_system_text=design_system_text,
            visual_rules=visual_rules,
        )
        if not system_prompt:
            system_prompt = (
                "You are an expert AI Visual Director. You will receive a script segment (narration) "
                "and a prompt explaining how to modify or rewrite its visuals. "
                "Your task is to generate ONLY the 'sub_visuals' array for this segment.\n"
                "Return ONLY valid JSON matching the provided schema. No markdown backticks.\n\n"
                f"{design_system_text}\n"
                "CRITICAL RULES:\n"
                "- COUNT: Generate as many sub-visuals as needed (usually one per visual beat, each lasting 2-15 seconds).\n"
                "- DURATION: The sum of 'duration' for all sub-visuals MUST exactly equal the target duration.\n"
                "- IMPORTANT: Every sub_visual must have a 'composition' object (AST format) and a 'duration' (in seconds).\n"
                "- 🚫 NO CHAPTER TITLE BADGES: Do NOT create static chapter title cards or header badges inside sub-visual cuts. Chapter indicators are rendered continuously by the root composition overlay engine.\n\n"
                f"{visual_rules}\n"
            )
        if section_type == "introduction":
            target_content = full_script.get("introduction", {})
        elif section_type == "conclusion":
            target_content = full_script.get("conclusion", {})
        else:
            scenes = full_script.get("scenes", [])
            target_content = scenes[scene_idx] if scene_idx < len(scenes) else {}
        current_visuals = target_content.get("sub_visuals", [])
        total_duration = sum(_safe_float(sv.get("duration", 0)) for sv in current_visuals if isinstance(sv, dict))
        if total_duration <= 0:
            total_duration = 15.0
        prompt_struct = "Expected: { \"sub_visuals\": [{ \"composition\": { \"type\": \"Sequence\", \"children\": [...] }, \"duration\": 5.0 }] } (generate as many items as needed)"

        # Gather word-level transcript and duration breakdown for precise AI timing
        narration_text = _get_section_narration(section_type, target_content)
        word_timings = _get_scene_word_timings(project_id, scene_idx, section_type, full_script)
        duration_table = _format_sub_visual_durations(current_visuals)

        prev_scene_context = ""
        if section_type == "scenes" and scene_idx > 0:
            scenes = full_script.get("scenes", [])
            if scene_idx < len(scenes):
                prev_scene = scenes[scene_idx - 1]
                prev_svs = prev_scene.get("sub_visuals", [])
                if prev_svs:
                    last_sv = prev_svs[-1].get("composition", {})
                    prev_scene_context = f"IMPORTANT CONTEXT - Previous Scene's Last Visual Layout:\n{json.dumps(last_sv, indent=2)}\n(Ensure your FIRST sub-visual does NOT use the exact same layout as this to maintain variety).\n\n"

        user_prompt = (
            f"Video Title: \"{full_script.get('title', 'Untitled')}\"\n"
            f"Narration for this segment:\n\"{narration_text}\"\n"
            + (f"{word_timings}\n" if word_timings else "")
            + (f"{duration_table}\n" if duration_table else "")
            + prev_scene_context
            + f"Current Sub-Visuals:\n{json.dumps(current_visuals, indent=2)}\n\n"
            f"Rewrite Instruction: {rewrite_prompt}\n\n"
            f"Total Duration to fill: {total_duration} seconds.\n"
            f"Generate the rewritten JSON sub_visuals array now. The sum of sub-visual durations MUST equal {total_duration}. Structure matches: {prompt_struct}."
        )
        from backend.agent.agent_engine import BRIDGE_VISUAL_TOOLS
        result = _call_llm_safe(system_prompt, user_prompt, VISUALS_ARRAY_SCHEMA, use_tools=True, allowed_tools=BRIDGE_VISUAL_TOOLS)
        if result.get("success") and "data" in result:
            data = result["data"]
            if isinstance(data, list):
                svs = data
            elif isinstance(data, dict):
                # If the dict is a single sub_visual, wrap it in a list
                if "composition" in data and "sub_visuals" not in data:
                    svs = [data]
                else:
                    svs = data.get("sub_visuals", [])
            else:
                svs = []
                
            _norm = sum(_safe_float(v.get("duration", 0)) for v in svs if isinstance(v, dict))
            if _norm > 0 and abs(_norm - total_duration) > 0.1:
                for v in svs:
                    if isinstance(v, dict):
                        v["duration"] = round(_safe_float(v.get("duration", 1.0), 1.0) / _norm * total_duration, 2)
            
            # Ensure the structure matches what the caller expects
            if isinstance(data, list) or (isinstance(data, dict) and "composition" in data and "sub_visuals" not in data):
                result["data"] = {"sub_visuals": svs}
        return result

    def regenerate_sub_visual(self, project_id: str, scene_idx: int, section_type: str, sub_idx: int, full_script: dict, rewrite_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: regenerate_sub_visual index {scene_idx} ({section_type}) sub {sub_idx}")
        video_format = full_script.get("video_format", "landscape")
        visual_rules = get_shared_visual_rules(video_format, language)
        design_system_text = _get_design_system_prompt(project_id)

        from backend.agent.skill_loader import skill_loader
        system_prompt = skill_loader.render_skill(
            "sub-visual-rewriter",
            design_system_text=design_system_text,
            visual_rules=visual_rules,
        )
        if not system_prompt:
            system_prompt = (
                "You are an expert AI visual designer. You will receive a single 'sub_visual' object from a video script, "
                "along with the surrounding narration context, and a prompt request explaining how to modify or rewrite this specific visual. "
                "Your task is to rewrite this single sub-visual based strictly on the user's request. "
                "You may change any field including 'composition' if the user's request warrants it. "
                "Do NOT change the narration.\n"
                "Return ONLY valid JSON matching the sub_visual schema. No markdown backticks.\n\n"
                f"{design_system_text}\n"
                "The sub_visual has: { \"composition\": { \"type\": \"Sequence\", \"children\": [...] }, \"duration\": float }\n"
                "- 🚫 NO CHAPTER TITLE BADGES: Do NOT place static chapter title badges or temporary header pills inside sub_visual cuts. Root overlays manage continuous chapter branding.\n\n"
                f"{visual_rules}\n"
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
        if not isinstance(target_sub_visual, dict):
            target_sub_visual = {}
        prompt_struct = "Expected: { \"composition\": { \"type\": \"Sequence\", \"children\": [...] }, \"duration\": 4.5 }"
        scene_title = section.get('title', 'Introduction/Conclusion')
        doc_title = full_script.get('title', 'Untitled')

        # Gather word-level transcript and duration breakdown for precise AI timing
        narration_text = _get_section_narration(section_type, section)
        word_timings = _get_scene_word_timings(project_id, scene_idx, section_type, full_script)
        duration_table = _format_sub_visual_durations(sub_visuals, highlight_idx=sub_idx)

        # Compute cumulative start offset for the target sub-visual within the scene
        sub_start_offset = sum(_safe_float(sv.get("duration", 0)) for sv in sub_visuals[:sub_idx] if isinstance(sv, dict))

        prev_context = ""
        if sub_idx > 0:
            prev_context = f"Previous Sub-Visual Layout:\n{json.dumps(sub_visuals[sub_idx - 1].get('composition', {}), indent=2)}\n\n"
        
        next_context = ""
        if sub_idx < len(sub_visuals) - 1:
            next_context = f"Next Sub-Visual Layout:\n{json.dumps(sub_visuals[sub_idx + 1].get('composition', {}), indent=2)}\n\n"

        user_prompt = (
            f"Video Title: \"{doc_title}\"\n"
            f"Scene Title: \"{scene_title}\"\n"
            f"Context (Narration of this scene):\n\"{narration_text}\"\n"
            + (f"{word_timings}\n" if word_timings else "")
            + (f"{duration_table}\n" if duration_table else "")
            + f"This sub-visual's target start offset is {sub_start_offset:.1f}s into the scene and lasts {_safe_float(target_sub_visual.get('duration', 0)):.1f}s.\n\n"
            + prev_context
            + f"Original Sub-Visual:\n{json.dumps(target_sub_visual, indent=2)}\n\n"
            + next_context
            + f"Rewrite Instruction: {rewrite_prompt}\n\n"
            f"CRITICAL: Ensure your new sub-visual layout is distinctly different from the Previous and Next Sub-Visual Layouts to avoid visual repetition.\n"
            f"Generate the rewritten JSON sub-visual now. Structure matches: {prompt_struct}."
        )
        from backend.agent.agent_engine import BRIDGE_VISUAL_TOOLS
        return _call_llm_safe(system_prompt, user_prompt, SUB_VISUAL_SCHEMA, use_tools=True, allowed_tools=BRIDGE_VISUAL_TOOLS)

    def add_scene_with_ai(self, full_script: dict, user_prompt: str, language: str = "hi") -> dict:
        logger.info(f"Bridge API: add_scene_with_ai — user_prompt: '{user_prompt[:80]}...'")
        existing_scenes = full_script.get("scenes", [])
        scenes_summary = "\n".join(
            f"  Scene {s.get('scene_number', i + 1)}: \"{s.get('title', 'Untitled')}\" — {s.get('narration', '')[:120]}..."
            for i, s in enumerate(existing_scenes)
        )
        intro_hook = full_script.get("introduction", {}).get("hook", "")[:200]
        conclusion_summary = full_script.get("conclusion", {}).get("summary", "")[:200]
        scene_lengths = [len(s.get('narration', '').split()) for s in existing_scenes if s.get('narration')]
        avg_scene_words = max(20, sum(scene_lengths) // len(scene_lengths)) if scene_lengths else 80
        doc_title = full_script.get("title", "Untitled")

        lang_instr = ""
        if language != "en":
            lang_instr = (
                f"LANGUAGE: The narration MUST be written in language code '{language}'.\n"
                f"For example, if the language is Hindi ('hi'), you MUST use the Devanagari script (हिंदी). "
                f"Do NOT use English alphabet transliterations.\n\n"
            )
        else:
            lang_instr = "LANGUAGE: The narration text MUST be written in English.\n\n"

        length_constraint = f"LENGTH: Aim for approximately {avg_scene_words} words — match the pacing of the surrounding scenes.\n\n"

        from backend.agent.skill_loader import skill_loader
        system_prompt = skill_loader.render_skill(
            "script-scene-adder",
            language=language,
            doc_title=doc_title,
            intro_hook=intro_hook,
            scenes_summary=scenes_summary if scenes_summary else '  (none yet)',
            conclusion_summary=conclusion_summary,
            language_instructions=lang_instr,
            length_constraint=length_constraint,
        )
        if not system_prompt:
            system_prompt = (
                "You are an expert video scriptwriter. Your task is to create a BRAND NEW scene "
                "to insert into an existing video script. The new scene must fit naturally into the "
                "narrative flow, maintaining consistent tone, style, and pacing with the surrounding content.\n\n"
                "HERE IS THE FULL SCRIPT CONTEXT:\n"
                f"Video Title: \"{doc_title}\"\n"
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
                f"{lang_instr}"
            )
        user_content = (
            f"Generate a new scene for this video based on the following description:\n\n"
            f"{user_prompt}\n\n"
            f"Make the scene fit naturally with the existing narrative. "
            f"The scene_number will be assigned by the system, so just put 1 as a placeholder."
        )
        _web_ctx = _get_web_context_for_topic(f"{doc_title} - add scene: {user_prompt[:100]}", "add new scene")
        if _web_ctx:
            user_content += f"\n\n---\nIncorporate relevant facts from this web search into your new scene:\n{_web_ctx}"
        from backend.agent.agent_engine import BRIDGE_ADD_SCENE_TOOLS
        result = _call_llm_safe(system_prompt, user_content, SCRIPT_SCENE_JSON_SCHEMA, use_tools=True, allowed_tools=BRIDGE_ADD_SCENE_TOOLS)
        if result.get("success") and "data" in result:
            result["data"]["sub_visuals"] = []
        return result

    def generate_voice_preview(self, text: str, engine: str, voice: str, speed: str, pitch: str, language: str) -> dict:
        logger.info(f"Bridge API: generate_voice_preview engine={engine} voice={voice}")
        try:
            from backend.core.config import get_temp_dir
            from backend.pipeline.tts import generate_edge_tts
            import uuid
            temp_dir = get_temp_dir()
            for f in temp_dir.glob("preview_*.wav"):
                try:
                    f.unlink()
                except Exception:
                    pass
            preview_file = temp_dir / f"preview_{uuid.uuid4().hex}.wav"
            speed_float = float(speed) if speed else 1.0
            if engine == "xtts":
                from backend.xtts import check_xtts_model, generate_xtts_tts
                if not check_xtts_model():
                    return {"success": False, "error": "XTTS model is not downloaded. Please download it from Settings."}
                # 'voice' parameter here holds the reference speaker_wav path
                speaker_wav = voice if voice and Path(voice).exists() else ""
                generate_xtts_tts(
                    text, str(preview_file),
                    speaker_wav=speaker_wav, language=language, speed=speed_float
                )
            else:
                # Sanitize the edge voice: a project whose tts_voice column was
                # polluted with an XTTS reference path (older versions) must not
                # be passed to edge-tts, which would fail on the invalid name.
                if not re.match(r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$", voice or ""):
                    voice = "hi-IN-SwaraNeural" if language == "hi" else "en-US-AndrewNeural"
                generate_edge_tts(text, str(preview_file), voice=voice, speed=str(speed), pitch=str(pitch))
            if preview_file.exists():
                return {"success": True, "audio_path": str(preview_file)}
        except Exception as e:
            # Log the full traceback: the transformers lazy-module wrapper can swallow the
            # real root cause (e.g. "Could not import module 'GPT2PreTrainedModel'...").
            logger.error(f"Preview generation failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unknown error generating audio."}




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
                    req = urllib.request.Request(
                        "https://github.com/yt-dlp/yt-dlp/releases/latest",
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
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
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                )
                with urllib.request.urlopen(req) as response, open(temp_path, "wb") as out_file:
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

                # Verify the downloaded binary against the SHA-256 published in
                # the SAME release before swapping it in — download_binaries.py
                # and the installer do this for the pinned path; the updater
                # must not be the weaker link.
                import hashlib
                expected_hash = None
                try:
                    sums_url = (
                        "https://github.com/yt-dlp/yt-dlp/releases/download/"
                        f"{latest_version}/SHA2-256SUMS"
                    )
                    with urllib.request.urlopen(sums_url, timeout=15) as sums_resp:
                        for line in sums_resp:
                            parts = line.decode("utf-8", errors="ignore").split()
                            if len(parts) == 2 and parts[1] == f"yt-dlp{ytdlp_ext}":
                                expected_hash = parts[0].lower()
                                break
                except Exception as e:
                    logger.warning(f"Could not fetch yt-dlp checksum for verification: {e}")

                if expected_hash:
                    sha = hashlib.sha256()
                    with open(temp_path, "rb") as f:
                        for chunk in iter(lambda: f.read(1024 * 1024), b""):
                            sha.update(chunk)
                    actual_hash = sha.hexdigest()
                    if actual_hash != expected_hash:
                        temp_path.unlink(missing_ok=True)
                        raise RuntimeError(
                            f"yt-dlp download hash mismatch: expected {expected_hash}, "
                            f"got {actual_hash}. Update aborted."
                        )
                    logger.info("yt-dlp download verified (SHA-256 match).")
                else:
                    logger.warning("yt-dlp downloaded without checksum verification (SUMS unreachable).")

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

    def fetch_single_scene_asset(self, project_id: str, manifest_scene_index: int, sub_visual_index: int) -> dict:
        logger.info(f"Bridge API: fetch_single_scene_asset index {manifest_scene_index}:{sub_visual_index} for project {project_id}")
        from backend.pipeline.assets import fetch_single_scene_asset as fetch_single
        try:
            return fetch_single(project_id, manifest_scene_index, sub_visual_index)
        except Exception as e:
            logger.error(f"Failed to fetch single scene asset: {e}")
            return {"success": False, "error": str(e)}

    def preview_asset_download(self, project_id: str, query: str) -> dict:
        logger.info(f"Bridge API: preview_asset_download for project {project_id} (query: {query})")
        from backend.pipeline.assets import preview_asset_download as preview_fn
        try:
            return preview_fn(project_id, query)
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

    def upload_sub_visual_media(self, project_id: str, manifest_scene_index: int, sub_visual_index: int, visual_type: str = "ast") -> dict:
        logger.info(f"Bridge API: upload_sub_visual_media for project {project_id} [{manifest_scene_index}:{sub_visual_index}] visual_type={visual_type}")
        import webview
        window = self._get_window()
        if not window:
            return {"success": False, "error": "No window available for file dialog"}

        if visual_type == "video":
            file_types = ('Video Files (*.mp4;*.webm)',)
            allowed_exts = (".mp4", ".webm")
        elif visual_type == "image":
            file_types = ('Image Files (*.jpg;*.jpeg;*.png;*.webp;*.gif)',)
            allowed_exts = (".jpg", ".jpeg", ".png", ".webp", ".gif")
        else:
            file_types = ('Media Files (*.mp4;*.webm;*.jpg;*.jpeg;*.png;*.webp;*.gif)',)
            allowed_exts = (".mp4", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".gif")

        try:
            result = window.create_file_dialog(
                dialog_type=webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=file_types
            )
            if not result:
                return {"success": False, "error": "No file selected"}
            src_path = Path(result[0])
        except Exception as e:
            logger.error(f"upload_sub_visual_media file dialog error: {e}")
            return {"success": False, "error": str(e)}

        _sweep_stale_uploads(project_id)

        ext = src_path.suffix.lower()
        if ext not in allowed_exts:
            return {"success": False, "error": f"Unsupported file extension '{ext}'. Please upload a valid media file ({'; '.join(allowed_exts)})."}

        is_video = ext in (".mp4", ".webm")

        # Container extensions lie: a .mp4 can hold HEVC/H.265 (iPhone/GoPro/DJI
        # default), which WebView2 previews fine but the headless-Chrome export
        # cannot decode — that is a black clip discovered at export time. Verify
        # the actual codec before copying anything.
        if is_video:
            codec_ok, codec_name = _probe_video_codec(str(src_path))
            if not codec_ok:
                if codec_name in ("none", "unknown"):
                    return {"success": False, "error": f"Video rejected: no decodable video stream could be verified ({codec_name}). Please upload an H.264/AVC, VP9, or AV1 encoded video."}
                return {"success": False, "error": f"Video codec '{codec_name}' is not supported for rendering (Chrome can only decode H.264/AVC, VP8, VP9, AV1). Please re-encode or upload a compatible file."}

        # Cap upload sizes: videos run 50-500 MB, images (incl. archival scans
        # for document/portrait layers) are smaller. Reject oversize files before
        # copying so disk usage stays bounded.
        max_size_bytes = (500 * 1024 * 1024) if is_video else (50 * 1024 * 1024)
        max_size_mb = 500 if is_video else 50
        media_type = "video" if is_video else "image"
        try:
            src_size = src_path.stat().st_size
        except OSError:
            return {"success": False, "error": "Could not read the selected file."}
        if src_size > max_size_bytes:
            return {"success": False, "error": f"File is {src_size / (1024 * 1024):.0f} MB, exceeding the {max_size_mb} MB limit for {media_type} uploads."}

        from backend.core.config import get_storage_dir
        import uuid
        import shutil
        assets_dir = get_storage_dir() / project_id / "assets"
        preview_dir = assets_dir / "previews"
        preview_dir.mkdir(parents=True, exist_ok=True)

        preview_id = uuid.uuid4().hex[:8]
        dest_file = preview_dir / f"upload_{preview_id}{ext}"

        try:
            shutil.copy2(str(src_path), str(dest_file))
            logger.info(f"Uploaded media preview to {dest_file}")
        except Exception as e:
            logger.error(f"Failed to copy uploaded file: {e}")
            return {"success": False, "error": f"Failed to copy file: {e}"}

        stat = dest_file.stat()
        return {
            "success": True,
            "visual_path": str(dest_file),
            "filename": dest_file.name,
            "size_bytes": stat.st_size,
            "extension": ext,
        }

    def upload_overlay_asset(self, project_id: str) -> dict:
        logger.info(f"Bridge API: upload_overlay_asset for project {project_id}")
        import webview
        window = self._get_window()
        if not window:
            return {"success": False, "error": "No window available for file dialog"}

        file_types = ('Image Files (*.png;*.jpg;*.jpeg;*.webp;*.svg;*.gif)',)
        allowed_exts = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif")

        try:
            result = window.create_file_dialog(
                dialog_type=webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=file_types
            )
            if not result:
                return {"success": False, "error": "No file selected"}
            src_path = Path(result[0])
        except Exception as e:
            logger.error(f"upload_overlay_asset file dialog error: {e}")
            return {"success": False, "error": str(e)}

        ext = src_path.suffix.lower()
        if ext not in allowed_exts:
            return {"success": False, "error": f"Unsupported file extension '{ext}'."}

        from backend.core.config import get_storage_dir
        import shutil
        import time
        assets_dir = get_storage_dir() / project_id / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        filename = f"overlay_{int(time.time() * 1000)}{ext}"
        dest_file = assets_dir / filename

        try:
            shutil.copy2(str(src_path), str(dest_file))
            logger.info(f"Uploaded overlay asset to {dest_file}")
        except Exception as e:
            logger.error(f"Failed to copy overlay file: {e}")
            return {"success": False, "error": f"Failed to copy file: {e}"}

        stat = dest_file.stat()
        return {
            "success": True,
            "asset_path": str(dest_file),
            "filename": filename,
            "size_bytes": stat.st_size,
            "extension": ext,
        }

    def finalize_upload_asset(self, project_id: str, preview_path: str, manifest_scene_index: int, sub_visual_index: int) -> dict:
        logger.info(f"Bridge API: finalize_upload_asset for project {project_id} [{manifest_scene_index}:{sub_visual_index}]")
        src = Path(preview_path)
        if not src.exists():
            return {"success": False, "error": "Preview file not found"}

        ext = src.suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"):
            return {"success": False, "error": f"Unsupported extension: {ext}"}

        from backend.core.config import get_storage_dir
        import shutil
        assets_dir = get_storage_dir() / project_id / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        dest_file = assets_dir / f"asset_{manifest_scene_index:03d}_{sub_visual_index:02d}{ext}"

        # Clean up old asset with a different extension at this position —
        # cover every extension that was ever uploadable, including legacy
        # .mov/.avi files uploaded before they were restricted.
        for old_ext in (".mp4", ".webm", ".mov", ".avi", ".jpg", ".jpeg", ".png", ".webp", ".gif"):
            if old_ext == ext:
                continue
            old_file = assets_dir / f"asset_{manifest_scene_index:03d}_{sub_visual_index:02d}{old_ext}"
            if old_file.exists():
                try:
                    old_file.unlink()
                    logger.info(f"Removed old asset: {old_file}")
                except Exception as e:
                    logger.warning(f"Could not delete old asset {old_file}: {e}")

        try:
            shutil.copy2(str(src), str(dest_file))
            logger.info(f"Finalized upload asset to {dest_file}")
        except Exception as e:
            logger.error(f"Failed to finalize upload asset: {e}")
            return {"success": False, "error": str(e)}

        stat = dest_file.stat()
        return {
            "success": True,
            "visual_path": str(dest_file),
            "filename": dest_file.name,
            "size_bytes": stat.st_size,
            "extension": ext,
        }


    def save_project_with_cleanup(self, project_id: str, script_data: dict, manifest_data: dict) -> dict:
        from backend.database.db import get_project, update_project
        from backend.pipeline.assets import cleanup_removed_assets, compute_script_content_hash
        from backend.core.config import get_storage_dir

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

            # Write visual manifest to separate file (assets/assets_manifest.json) to avoid
            # corrupting the voiceover manifest (voiceover/manifest.json) which stores
            # _voiceover_engine, _voiceover_voice, _voiceover_speed, _voiceover_pitch
            # needed for is_voiceover_stale checks.
            project_dir = get_storage_dir() / project_id
            assets_dir = project_dir / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            visual_manifest_path = assets_dir / "assets_manifest.json"

            # Run cleanup with the visual manifest path
            cleanup_result = cleanup_removed_assets(project_id, manifest_data, content_hash=content_hash, output_manifest_path=str(visual_manifest_path))
            result["cleanup_result"] = cleanup_result

            # Also update the voiceover manifest's sub_visuals to match the new visual structure.
            # This ensures is_visuals_stale (which compares script.json with voiceover manifest)
            # correctly detects only narration changes, not manual visual edits.
            voiceover_manifest_path = project_dir / "voiceover" / "manifest.json"
            if voiceover_manifest_path.exists():
                try:
                    with open(voiceover_manifest_path, "r", encoding="utf-8") as f:
                        voiceover_manifest = json.load(f)
                    # Update sub_visuals in voiceover manifest to match new visual structure
                    # while preserving _voiceover_* fields
                    scene_counter = 0
                    for v_entry in voiceover_manifest:
                        v_type = v_entry.get("section_type")
                        new_sub_visuals = []
                        if v_type == "introduction" and script_data.get("introduction"):
                            new_sub_visuals = script_data["introduction"].get("sub_visuals", [])
                        elif v_type == "conclusion" and script_data.get("conclusion"):
                            new_sub_visuals = script_data["conclusion"].get("sub_visuals", [])
                        elif v_type == "scene" and script_data.get("scenes"):
                            if scene_counter < len(script_data["scenes"]):
                                new_sub_visuals = script_data["scenes"][scene_counter].get("sub_visuals", [])
                            scene_counter += 1
                        if new_sub_visuals:
                            # Preserve _voiceover_* fields, update sub_visuals
                            v_entry["sub_visuals"] = new_sub_visuals
                    with open(voiceover_manifest_path, "w", encoding="utf-8") as f:
                        json.dump(voiceover_manifest, f, indent=2, ensure_ascii=False)
                    logger.info(f"Updated voiceover manifest sub_visuals: {voiceover_manifest_path}")
                except Exception as e:
                    logger.error(f"Failed to update voiceover manifest sub_visuals: {e}", exc_info=True)
                    result["success"] = False
                    result["error"] = f"Failed to update voiceover manifest sub_visuals: {e}"
                    # Continue so update_project is still called below

            # Update project to point to the visual manifest for future operations
            if cleanup_result.get("success"):
                update_project(project_id, assets_manifest_path=str(visual_manifest_path))

            if not cleanup_result.get("success"):
                logger.warning("Asset cleanup failed, but script was saved")
                result["success"] = False
                result["error"] = cleanup_result.get("error", "Cleanup failed")
        except Exception as e:
            logger.error(f"save_project_with_cleanup failed: {e}", exc_info=True)
            result["success"] = False
            result["error"] = str(e)
        return result

    def _reorder_manifest_list(self, manifest: list, new_scene_order: list, script_scenes: list) -> list:
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
            logger.warning(f"Manifest scene count ({len(manifest_scenes)}) doesn't match script ({len(script_scenes)}), skipping manifest list reorder.")
            return None

        reordered_manifest_scenes = [manifest_scenes[i] for i in new_scene_order]
        new_manifest = []
        if manifest_intro:
            new_manifest.append(manifest_intro)
        new_manifest.extend(reordered_manifest_scenes)
        if manifest_conclusion:
            new_manifest.append(manifest_conclusion)
        return new_manifest

    def _delete_scene_from_manifest_list(self, manifest: list, scene_index: int) -> list:
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
        return manifest

    def reorder_scenes(self, project_id: str, new_scene_order: list) -> dict:
        from backend.database.db import get_project
        from backend.pipeline.assets import cleanup_removed_assets
        from backend.core.config import get_storage_dir
        try:
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found"}
            script_path = project.get("script_path")
            if not script_path or not os.path.exists(script_path):
                return {"success": False, "error": "Script not found"}
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
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
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)

            project_dir = get_storage_dir() / project_id

            # 1. Update Voiceover Manifest if it exists
            voiceover_manifest_path = project_dir / "voiceover" / "manifest.json"
            if voiceover_manifest_path.exists():
                try:
                    with open(voiceover_manifest_path, "r", encoding="utf-8") as f:
                        voiceover_manifest = json.load(f)
                    new_vo_manifest = self._reorder_manifest_list(voiceover_manifest, new_scene_order, script_scenes)
                    if new_vo_manifest:
                        with open(voiceover_manifest_path, "w", encoding="utf-8") as f:
                            json.dump(new_vo_manifest, f, indent=2, ensure_ascii=False)
                        logger.info(f"Reordered voiceover manifest: {voiceover_manifest_path}")
                except Exception as e:
                    logger.error(f"Failed to reorder voiceover manifest: {e}", exc_info=True)

            # 2. Update Visual Manifest if it exists
            visual_manifest_path = project_dir / "assets" / "assets_manifest.json"
            current_manifest_path = Path(project.get("assets_manifest_path") or visual_manifest_path)

            if current_manifest_path.exists() and current_manifest_path != voiceover_manifest_path:
                try:
                    with open(current_manifest_path, "r", encoding="utf-8") as f:
                        visual_manifest = json.load(f)
                    new_vis_manifest = self._reorder_manifest_list(visual_manifest, new_scene_order, script_scenes)
                    if new_vis_manifest:
                        cleanup_result = cleanup_removed_assets(
                            project_id,
                            new_vis_manifest,
                            output_manifest_path=str(current_manifest_path),
                            old_manifest_path=str(current_manifest_path)
                        )
                        if not cleanup_result.get("success"):
                            return {"success": False, "error": cleanup_result.get("error", "Visual manifest cleanup failed")}
                        logger.info(f"Reordered and cleaned visual manifest: {current_manifest_path}")
                except Exception as e:
                    logger.error(f"Failed to reorder visual manifest: {e}", exc_info=True)
                    return {"success": False, "error": f"Visual manifest reorder failed: {e}"}
            elif current_manifest_path == voiceover_manifest_path and voiceover_manifest_path.exists():
                try:
                    with open(voiceover_manifest_path, "r", encoding="utf-8") as f:
                        vo_manifest = json.load(f)
                    cleanup_result = cleanup_removed_assets(
                        project_id,
                        vo_manifest,
                        output_manifest_path=str(voiceover_manifest_path),
                        old_manifest_path=str(voiceover_manifest_path)
                    )
                    if not cleanup_result.get("success"):
                        return {"success": False, "error": cleanup_result.get("error", "Manifest cleanup failed")}
                except Exception as e:
                    logger.error(f"Failed to cleanup voiceover manifest: {e}", exc_info=True)

            return {"success": True}
        except Exception as e:
            logger.error(f"reorder_scenes failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def delete_scene(self, project_id: str, scene_index: int) -> dict:
        from backend.database.db import get_project
        from backend.pipeline.assets import cleanup_removed_assets
        from backend.core.config import get_storage_dir
        try:
            project = get_project(project_id)
            if not project:
                return {"success": False, "error": "Project not found"}
            script_path = project.get("script_path")
            if not script_path or not os.path.exists(script_path):
                return {"success": False, "error": "Script not found"}
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
            script_scenes = script.get("scenes", [])
            if scene_index < 0 or scene_index >= len(script_scenes):
                return {"success": False, "error": f"Scene index {scene_index} out of range (0-{len(script_scenes)-1})"}
            removed_scene = script_scenes.pop(scene_index)
            logger.info(f"Deleted scene {scene_index}: '{removed_scene.get('title', '')}'")
            for idx, scene in enumerate(script_scenes):
                scene["scene_number"] = idx + 1
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)

            project_dir = get_storage_dir() / project_id

            # 1. Update Voiceover Manifest if it exists
            voiceover_manifest_path = project_dir / "voiceover" / "manifest.json"
            if voiceover_manifest_path.exists():
                try:
                    with open(voiceover_manifest_path, "r", encoding="utf-8") as f:
                        voiceover_manifest = json.load(f)
                    new_vo_manifest = self._delete_scene_from_manifest_list(voiceover_manifest, scene_index)
                    with open(voiceover_manifest_path, "w", encoding="utf-8") as f:
                        json.dump(new_vo_manifest, f, indent=2, ensure_ascii=False)
                    logger.info(f"Deleted scene {scene_index} from voiceover manifest: {voiceover_manifest_path}")
                except Exception as e:
                    logger.error(f"Failed to delete scene from voiceover manifest: {e}", exc_info=True)

            # 2. Update Visual Manifest if it exists
            visual_manifest_path = project_dir / "assets" / "assets_manifest.json"
            current_manifest_path = Path(project.get("assets_manifest_path") or visual_manifest_path)

            if current_manifest_path.exists() and current_manifest_path != voiceover_manifest_path:
                try:
                    with open(current_manifest_path, "r", encoding="utf-8") as f:
                        visual_manifest = json.load(f)
                    new_vis_manifest = self._delete_scene_from_manifest_list(visual_manifest, scene_index)
                    cleanup_result = cleanup_removed_assets(
                        project_id,
                        new_vis_manifest,
                        output_manifest_path=str(current_manifest_path),
                        old_manifest_path=str(current_manifest_path)
                    )
                    if not cleanup_result.get("success"):
                        return {"success": False, "error": cleanup_result.get("error", "Visual manifest cleanup failed")}
                    logger.info(f"Deleted scene {scene_index} and cleaned visual manifest: {current_manifest_path}")
                except Exception as e:
                    logger.error(f"Failed to delete scene from visual manifest: {e}", exc_info=True)
                    return {"success": False, "error": f"Visual manifest delete failed: {e}"}
            elif current_manifest_path == voiceover_manifest_path and voiceover_manifest_path.exists():
                try:
                    with open(voiceover_manifest_path, "r", encoding="utf-8") as f:
                        vo_manifest = json.load(f)
                    cleanup_result = cleanup_removed_assets(
                        project_id,
                        vo_manifest,
                        output_manifest_path=str(voiceover_manifest_path),
                        old_manifest_path=str(voiceover_manifest_path)
                    )
                    if not cleanup_result.get("success"):
                        return {"success": False, "error": cleanup_result.get("error", "Manifest cleanup failed")}
                except Exception as e:
                    logger.error(f"Failed to cleanup voiceover manifest: {e}", exc_info=True)

            return {"success": True}
        except Exception as e:
            logger.error(f"delete_scene failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

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
            # Manifest layout is [introduction, scene..., conclusion]; scene
            # indices must be resolved by counting section_type == "scene"
            # entries rather than indexing the list directly.
            scene_counter = 0
            manifest_entry = None
            for entry in manifest:
                if entry.get("section_type") == "scene":
                    if scene_counter == scene_index:
                        manifest_entry = entry
                        break
                    scene_counter += 1
            if manifest_entry is None:
                return {"success": False, "error": f"Scene index {scene_index} not found"}
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

    def safe_agent_activity(entry):
        try:
            ui_queue.put(("onAgentActivity", (entry,)))
        except Exception:
            pass
    from backend.agent.telemetry import register_activity_callback
    register_activity_callback(safe_agent_activity)
