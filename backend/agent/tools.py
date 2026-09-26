import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List

from backend.pipeline.web_search import search_and_format
from backend.agent.skill_loader import skill_loader
from backend.core.logger import logger
from backend.agent.schemas import (
    WebSearchToolArgs, GetSkillToolArgs, SearchMediaToolArgs,
    SearchWikipediaImageToolArgs, SearchPixabayPhotoToolArgs, SearchYouTubeVideoToolArgs,
    ReadProjectFileToolArgs, ProjectStatusReportToolArgs, ListProjectFilesToolArgs,
)

logger = logging.getLogger(__name__)

TOOL_ARGUMENT_MODELS = {
    "web_search": WebSearchToolArgs,
    "get_skill": GetSkillToolArgs,
    "search_pexels_photo": SearchMediaToolArgs,
    "search_pexels_video": SearchMediaToolArgs,
    "search_wikipedia_image": SearchWikipediaImageToolArgs,
    "search_pixabay_photo": SearchPixabayPhotoToolArgs,
    "search_pixabay_video": SearchMediaToolArgs,
    "search_youtube_video": SearchYouTubeVideoToolArgs,
    "read_project_file": ReadProjectFileToolArgs,
    "project_status_report": ProjectStatusReportToolArgs,
    "list_project_files": ListProjectFilesToolArgs,
}


def _project_dir(project_id: str) -> Path:
    """Resolve a project's storage directory (survives production CWD changes).

    Rejects ids that would escape the storage dir (defense against LLM-supplied
    values like '..' or absolute paths).
    """
    from backend.core.config import get_storage_dir
    base = get_storage_dir().resolve()
    proj = (base / project_id).resolve()
    if base != proj and base not in proj.parents:
        raise ValueError(f"Unsafe project id: {project_id!r}")
    return proj


def _safe_project_file(project_id: str, relative_path: str) -> Path:
    """Resolve a project-relative path, rejecting any path that escapes the
    project directory (e.g. '..\\narrato.db' or absolute paths)."""
    proj = _project_dir(project_id)
    p = (proj / relative_path).resolve()
    if proj != p and proj not in p.parents:
        raise ValueError(f"Unsafe project file path: {relative_path!r}")
    return p


def _load_json(project_id: str, relative_path: str):
    """Load a JSON file from the project dir, returning None when missing/broken."""
    from backend.agent.telemetry import emit_activity
    try:
        file_path = _safe_project_file(project_id, relative_path)
    except Exception as e:
        return {"_error": str(e)}
    if not file_path.exists():
        return None
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        emit_activity("file", "read", f"{project_id}/{relative_path}")
        return data
    except Exception as e:
        return {"_error": str(e)}


def _save_json(project_id: str, relative_path: str, data) -> bool:
    from backend.agent.telemetry import emit_activity
    try:
        file_path = _safe_project_file(project_id, relative_path)
    except Exception:
        logger.error(f"Unsafe save path: {project_id}/{relative_path}")
        return False
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        emit_activity("file", "write", f"{project_id}/{relative_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to save {relative_path}: {e}")
        return False


# ---------------------------------------------------------------------------
# Visual settings reference (subtitle / numbering / timeline / branding)
#
# Mirrors the exact keys the frontend writes into project_settings
# (SettingsTab.tsx, SubtitleSettings.tsx, BrandingSettings.tsx) so the
# project_status_report overview shows the SAME settings the user sees
# in the inspector. Read-only reference — the write path
# (_apply_visual_settings) was removed with the heuristically-dead
# update_subtitle_style / update_visual_settings tools.
# ---------------------------------------------------------------------------
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _hex(v):
    if isinstance(v, str) and _HEX_COLOR_RE.match(v):
        return None
    return "must be a hex color like '#facc15'"


def _rng(lo, hi):
    def check(v):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (lo <= v <= hi):
            return f"must be a number between {lo} and {hi}"
        return None
    return check


def _enum(choices):
    def check(v):
        if isinstance(v, str) and v in choices:
            return None
        return f"must be one of: {', '.join(choices)}"
    return check


def _text(v):
    if isinstance(v, str) and v.strip():
        return None
    return "must be a non-empty string"


def _flag(v):
    if isinstance(v, bool):
        return None
    return "must be true or false"


VISUAL_SETTINGS_SPEC = {
    # --- Subtitle styling ---
    "fontFamily": _text,
    "fontSize": _rng(20, 150),
    "wordSpacing": _rng(0, 50),
    "activeColor": _hex,
    "pastColor": _hex,
    "futureColor": _hex,
    "textTransform": _enum(["uppercase", "lowercase", "capitalize", "none"]),
    "activeAnimation": _enum(["bounce", "pop", "jump", "none"]),
    "bottomOffset": _rng(0, 1500),
    "wordsPerScreen": _rng(1, 20),
    "backgroundStyle": _enum(["none", "highlight", "full_block"]),
    "highlightBgColor": _hex,
    "fullBgColor": _hex,
    "fontWeight": _text,
    "hide_subtitles": _flag,
    # --- Numbering style ---
    "numbering_number_style": _enum(["plain", "circle", "square", "badge"]),
    "numbering_font_family": _text,
    "numbering_title_color": _hex,
    "numbering_description_color": _hex,
    "numbering_number_color": _hex,
    "numbering_number_bg_color": _hex,
    "numbering_number_border_color": _hex,
    "numbering_accent_color": _hex,
    # --- Chapter branding ---
    "hide_chapter_name": _flag,
    "chapter_text_color": _hex,
    "chapter_border_color": _hex,
}

SUBTITLE_SETTING_KEYS = frozenset({
    "fontFamily", "fontSize", "wordSpacing", "activeColor", "pastColor",
    "futureColor", "textTransform", "activeAnimation", "bottomOffset",
    "wordsPerScreen", "backgroundStyle", "highlightBgColor", "fullBgColor",
    "fontWeight", "hide_subtitles",
})


_SETTINGS_OVERVIEW_GROUPS = [
    ("Subtitle style", list(SUBTITLE_SETTING_KEYS)),
    ("Numbering", [k for k in VISUAL_SETTINGS_SPEC if k.startswith("numbering_")]),
    ("Chapter branding", ["hide_chapter_name", "chapter_text_color", "chapter_border_color"]),
    ("Whisper", ["whisper_model", "whisper_device"]),
    ("Render", ["render_resolution", "render_fps", "render_codec", "render_crf",
                "render_concurrency", "render_hardware", "render_timeout"]),
    ("Voiceover", ["voiceover_volume"]),
]


def _format_settings_overview(settings: dict) -> str:
    """Summarizes the project_settings blob for the agent's status report."""
    if not settings:
        return "  (none stored)"
    lines = []
    for title, keys in _SETTINGS_OVERVIEW_GROUPS:
        present = {k: settings[k] for k in keys if k in settings}
        if present:
            lines.append(f"- {title}: {json.dumps(present, ensure_ascii=False)}")
    return "\n".join(lines) if lines else "  (none stored)"



def get_tools_schema() -> List[Dict[str, Any]]:
    """Returns the JSON schema definitions for all available agent tools."""
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "**FOR INTERNAL APP LLM ONLY.** Searches the web for up-to-date facts, statistics, or news using the LangSearch API. Useful for finding data that is recent or specific.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query to execute (e.g., 'Apple market cap 2026'). Keep it concise."
                        },
                        "count": {
                            "type": "integer",
                            "description": "Number of results to return (max 5).",
                            "default": 3
                        }
                    },
                    "required": ["query"]
                }
            }
        },

        {
            "type": "function",
            "function": {
                "name": "get_skill",
                "description": (
                    "**FOR INTERNAL APP LLM ONLY — MCP EXTERNAL AGENTS use MCP get_skill instead.** "
                    "Loads a specialized skill definition for project rules and best practices. "
                    f"Available skills: {', '.join(sorted(skill_loader.get_all_skills().keys())) if 'skill_loader' in globals() or 'skill_loader' in locals() else 'declarative-ast, visual-director-core, scriptwriter, editor-qa, subtitle-designer, stock-asset-searcher'}."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Skill name to load"
                        }
                    },
                    "required": ["name"]
                }
            }
        },

        {
            "type": "function",
            "function": {
                "name": "search_pexels_photo",
                "description": "Searches Pexels for a stock photo. Returns a URL if found, or None. VERIFICATION ONLY — never copy the URL into AST JSON; output only query+source and the pipeline downloads the asset.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "orientation": {"type": "string", "enum": ["landscape", "portrait"], "description": "Preferred orientation (default landscape)"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_pexels_video",
                "description": "Searches Pexels for stock video footage. Returns a URL if found. VERIFICATION ONLY — never copy the URL into AST JSON; output only query+source and the pipeline downloads the asset.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "orientation": {"type": "string", "enum": ["landscape", "portrait"], "description": "Preferred orientation (default landscape)"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_wikipedia_image",
                "description": "Searches Wikipedia for an entity/person and returns their primary image URL. VERIFICATION ONLY — never copy the URL into AST JSON; output only query+source. Excellent for 'portrait' visual types.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Name of person or entity"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_pixabay_photo",
                "description": "Searches Pixabay for a stock photo. Returns a URL if found, or a not-found message. "
                               "Pixabay has a large catalog of illustrations, vectors, and photos — many available as transparent PNG (use image_type='png' for cutouts). "
                               "VERIFICATION ONLY — never copy the URL into AST JSON; output only query+source.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query (in English)"},
                        "orientation": {"type": "string", "enum": ["landscape", "portrait"], "description": "Preferred orientation (default landscape)"},
                        "image_type": {"type": "string", "enum": ["all", "photo", "illustration", "vector"], "description": "Filter by image type. Use 'illustration' or 'vector' for transparent-bg cutout assets."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_pixabay_video",
                "description": "Searches Pixabay for stock video footage. Returns a URL if found. "
                               "Pixabay video catalog is smaller than Pexels — prefer Pexels for B-roll, use Pixabay for animation loops or abstract footage. "
                               "VERIFICATION ONLY — never copy the URL into AST JSON.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query (in English)"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_youtube_video",
                "description": "Checks whether a YouTube video matching the query can be downloaded via yt-dlp. "
                               "Returns the video title and duration if found, or an error. "
                               "Use this to verify source='youtube' will work before adding it to an AST layer. "
                               "Best for: animation loops, timelapse footage, cinematic B-roll, specific footage not on Pexels/Pixabay. "
                               "Requires yt-dlp to be installed.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query (in English, e.g. 'city timelapse night', 'ocean waves')"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_project_file",
                "description": "Reads a JSON file from the current project's storage directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "filename": {"type": "string", "description": "e.g., 'design.json', 'script.json', or 'subtitles/transcription.json'"}
                    },
                    "required": ["project_id", "filename"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "project_status_report",
                "description": "Returns a summary of the project: language/format, TTS, script structure (intro, scenes with titles/durations/sub-visual counts, conclusion), design system (colors/fonts/css), current visual settings (subtitle/numbering/chapter branding/render/whisper), and asset readiness. Call this first to understand what you are working on.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"}
                    },
                    "required": ["project_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_project_files",
                "description": "Lists files inside a project's storage directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"}
                    },
                    "required": ["project_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "probe_cut",
                "description": "Inspects ONE cut: full JSON + geometry + timing + per-layer asset files. Read-only. Use before/after editing a cut instead of reading script.json by hand.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "section_type": {"type": "string", "enum": ["introduction", "scene", "conclusion"]},
                        "scene_index": {"type": "integer", "default": 0},
                        "cut_index": {"type": "integer", "default": 0}
                    },
                    "required": ["project_id", "section_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "probe_scene",
                "description": "Inspects ONE section: per-cut summaries + geometry/timing rollups + variety. Read-only. Use to find which cut to fix, then probe_cut it.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "section_type": {"type": "string", "enum": ["introduction", "scene", "conclusion"]},
                        "scene_index": {"type": "integer", "default": 0}
                    },
                    "required": ["project_id", "section_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "probe_asset",
                "description": "File truth for ONE media layer: query/source to downloaded file (exists/size/dimensions/duration). Read-only.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "section_type": {"type": "string", "enum": ["introduction", "scene", "conclusion"]},
                        "scene_index": {"type": "integer", "default": 0},
                        "cut_index": {"type": "integer", "default": 0},
                        "layer_index": {"type": "integer", "default": 0}
                    },
                    "required": ["project_id", "section_type"]
                }
            }
        },
    ]


def execute_tool(tool_name: str, arguments: Dict[str, Any]) -> str:
    """Executes a requested tool and returns the string result to be fed back to the LLM.

    Wraps the implementation with telemetry so the UI can show live which
    tools the agent calls and whether they succeed. The telemetry entry keeps
    BOTH the input arguments (emitted at start) and the execution result
    (added on completion) as structured fields, with a combined human-readable
    detail line.
    """
    from backend.agent.telemetry import emit_activity, update_activity
    args_summary = json.dumps(arguments, ensure_ascii=False, default=str)
    entry_id = emit_activity("tool", tool_name, args_summary[:300], "running", args=arguments)
    try:
        result = _execute_tool(tool_name, arguments)
    except InterruptedError:
        update_activity(entry_id, "error", "interrupted by user", result=None)
        raise
    except Exception as e:
        update_activity(entry_id, "error", f"exception: {e}", result=None)
        raise
    status = "ok" if not (isinstance(result, str) and result.startswith("Error")) else "error"
    update_activity(
        entry_id, status,
        f"Args: {args_summary[:300]} ➔ Result: {str(result)[:300]}",
        result=result,
    )
    return result


def _execute_tool(tool_name: str, arguments: Dict[str, Any]) -> str:
    """Tool dispatcher. Kept private — public entry point is execute_tool."""
    try:
        # Validate and coerce arguments through Pydantic model if registered
        arg_model = TOOL_ARGUMENT_MODELS.get(tool_name)
        if arg_model is not None and isinstance(arguments, dict):
            try:
                validated_model = arg_model.model_validate(arguments)
                arguments = validated_model.model_dump(exclude_none=True)
            except Exception as val_err:
                logger.warning(f"Pydantic argument validation for {tool_name}: {val_err}")

        # --- Research / lookup tools ---
        if tool_name == "web_search":
            query = arguments.get("query")
            count = arguments.get("count", 3)
            if not query:
                return "Error: Missing query parameter."

            from backend.database.db import get_setting
            api_key = get_setting("web_search_api_key")
            if not api_key:
                return "Error: Web search API key is not configured in settings. Do not try to search the web."

            logger.info(f"Executing tool: web_search for '{query}'")
            from backend.agent.telemetry import emit_activity, update_activity
            entry_id = emit_activity("web", "web_search", f"'{query}'", "running",
                                     args={"query": query, "count": count})
            res = search_and_format(query, api_key, count=count)
            update_activity(entry_id, "ok" if res else "skipped", f"'{query}' → {len(res or '')} chars",
                            result=res if res else None)
            return res if res else "No results found."



        if tool_name == "get_skill":
            name = arguments.get("name")
            if not name:
                return "Error: Missing skill name."
            skill = skill_loader.get_skill(name, context="tool")
            if skill:
                return f"--- SKILL: {name} (v{skill.version}) ---\n{skill.content}"
            available = ", ".join(sorted(skill_loader.get_all_skills().keys()))
            return f"Error: Skill '{name}' not found. Available skills: {available}."

        if tool_name == "search_pexels_photo":
            query = arguments.get("query")
            orientation = arguments.get("orientation")
            from backend.database.db import get_setting
            from backend.pipeline.assets import search_pexels_photo
            api_key = get_setting("pexels_api_key")
            if not api_key:
                return "Error: Pexels API key not configured."
            url = search_pexels_photo(query, api_key, orientation)
            return url if url else f"No photo found for '{query}'"

        if tool_name == "search_pexels_video":
            query = arguments.get("query")
            orientation = arguments.get("orientation")
            from backend.database.db import get_setting
            from backend.pipeline.assets import search_pexels_video
            api_key = get_setting("pexels_api_key")
            if not api_key:
                return "Error: Pexels API key not configured."
            url = search_pexels_video(query, api_key, orientation)
            return url if url else f"No video found for '{query}'"

        if tool_name == "search_wikipedia_image":
            query = arguments.get("query")
            from backend.pipeline.assets import search_wikipedia_image
            url = search_wikipedia_image(query)
            return url if url else f"No Wikipedia image found for '{query}'"

        if tool_name == "search_pixabay_photo":
            query = arguments.get("query")
            orientation = arguments.get("orientation")
            image_type = arguments.get("image_type", "all")
            from backend.database.db import get_setting
            from backend.pipeline.assets import search_pixabay_photo
            api_key = get_setting("pixabay_api_key")
            if not api_key:
                return "Error: Pixabay API key not configured in settings."
            url = search_pixabay_photo(query, api_key, orientation, image_type=image_type)
            return url if url else f"No Pixabay photo found for '{query}'"

        if tool_name == "search_pixabay_video":
            query = arguments.get("query")
            from backend.database.db import get_setting
            from backend.pipeline.assets import search_pixabay_video
            api_key = get_setting("pixabay_api_key")
            if not api_key:
                return "Error: Pixabay API key not configured in settings."
            url = search_pixabay_video(query, api_key)
            return url if url else f"No Pixabay video found for '{query}'"

        if tool_name == "search_youtube_video":
            query = arguments.get("query")
            if not query:
                return "Error: query is required."
            from backend.core.config import get_ytdlp_path, get_startupinfo
            import subprocess, json as _json
            ytdlp_path = get_ytdlp_path()
            try:
                startupinfo = get_startupinfo()
                res = subprocess.run(
                    [
                        ytdlp_path,
                        f"ytsearch1:{query}",
                        "--dump-json",
                        "--no-download",
                        "--no-warnings",
                        "--quiet",
                    ],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, timeout=20, startupinfo=startupinfo
                )
                if res.returncode == 0 and res.stdout.strip():
                    try:
                        info = _json.loads(res.stdout.strip().splitlines()[0])
                        title = info.get("title", "Unknown")
                        duration = info.get("duration", "?")
                        uploader = info.get("uploader", "")
                        return (
                            f"YouTube match found: '{title}' by {uploader} "
                            f"({duration}s). Use source='youtube', query='{query}'."
                        )
                    except Exception:
                        return f"YouTube match found for '{query}' but metadata parse failed. Still usable."
                return f"No YouTube result found for '{query}'."
            except FileNotFoundError:
                return "Error: yt-dlp binary not found. Install it from Settings → Binaries."
            except subprocess.TimeoutExpired:
                return f"Error: YouTube search timed out for '{query}'."
            except Exception as e:
                return f"Error during YouTube search: {e}"

        # --- Project file / state tools ---
        if tool_name == "read_project_file":
            project_id = arguments.get("project_id")
            filename = arguments.get("filename")
            if not project_id or not filename:
                return "Error: project_id and filename are required."
            try:
                file_path = _safe_project_file(project_id, filename)
            except Exception as e:
                return f"Error: {e}"
            if file_path.exists():
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception as e:
                    return f"Failed to read file: {e}"
            return f"Error: File {file_path} does not exist."

        if tool_name == "list_project_files":
            project_id = arguments.get("project_id")
            if not project_id:
                return "Error: project_id required."
            project_dir = _project_dir(project_id)
            if not project_dir.exists():
                return f"Error: Project directory {project_dir} does not exist."
            from backend.agent.telemetry import emit_activity
            files = []
            for p in sorted(project_dir.rglob("*")):
                if p.is_file() and "__pycache__" not in str(p):
                    files.append(str(p.relative_to(project_dir)))
            emit_activity("file", project_id, f"listed {len(files)} files in project folder", "ok")
            return "\n".join(files) if files else "Project directory is empty."

        if tool_name == "project_status_report":
            project_id = arguments.get("project_id")
            if not project_id:
                return "Error: project_id required."
            return _project_status_report(project_id)

        if tool_name in ("probe_cut", "probe_scene", "probe_asset"):
            try:
                from backend.mcp import probe as _probe
            except Exception as e:
                return f"Error: probe backend unavailable: {e}"
            project_id = arguments.get("project_id")
            section_type = arguments.get("section_type", "scene")
            scene_index = arguments.get("scene_index", 0)
            if not project_id or not section_type:
                return "Error: project_id and section_type are required."
            try:
                if tool_name == "probe_cut":
                    res = _probe.probe_cut_payload(
                        project_id, section_type, scene_index,
                        arguments.get("cut_index", 0))
                elif tool_name == "probe_scene":
                    res = _probe.probe_scene_payload(
                        project_id, section_type, scene_index)
                else:
                    res = _probe.probe_asset_payload(
                        project_id, section_type, scene_index,
                        arguments.get("cut_index", 0),
                        arguments.get("layer_index", 0))
            except Exception as e:
                return f"Error: probe failed: {e}"
            try:
                return json.dumps(res, ensure_ascii=False, default=str)[:8000]
            except Exception:
                return str(res)[:8000]

        return f"Error: Unknown tool {tool_name}"

    except InterruptedError:
        raise
    except Exception as e:
        logger.error(f"Error executing tool {tool_name}: {e}", exc_info=True)
        return f"Tool execution failed: {str(e)}"


def _project_status_report(project_id: str) -> str:
    """Builds a compact markdown summary of the project for the agent."""
    from backend.database.db import get_project
    project = get_project(project_id)
    if not project:
        return f"Error: Project {project_id} not found."

    lines = [
        f"# Project: {project.get('name')}",
        f"- Language: {project.get('language')} | Format: {project.get('video_format')} | Duration mode: {project.get('duration_mode')} | Status: {project.get('status')}",
        f"- TTS: {project.get('tts_engine')} / {project.get('tts_voice')} @ {project.get('tts_speed')}x (pitch: {project.get('tts_pitch') or 'default'})",
    ]

    script = _load_json(project_id, "script.json")
    if isinstance(script, dict):
        intro = script.get("introduction") or {}
        conclusion = script.get("conclusion") or {}
        lines.append("")
        lines.append(f"## Script: \"{script.get('title', 'Untitled')}\"")
        hook = (intro.get("hook") or "")
        lines.append(f"- Introduction hook ({len(hook.split())} words, {len(intro.get('sub_visuals', []))} sub-visuals)")
        scenes = script.get("scenes", [])
        lines.append(f"- Scenes: {len(scenes)}")
        for i, sc in enumerate(scenes):
            lines.append(f"  [{i}] {sc.get('title', 'Untitled')} — {len((sc.get('narration') or '').split())} words, {len(sc.get('sub_visuals', []))} sub-visuals")
        summary = (conclusion.get("summary") or "")
        lines.append(f"- Conclusion summary ({len(summary.split())} words, {len(conclusion.get('sub_visuals', []))} sub-visuals)")
    else:
        lines.append("- script.json: missing or unreadable")

    design = _load_json(project_id, "design.json")
    if isinstance(design, dict) and design.get("theme_name"):
        css = design.get("css_guidelines") or ""
        if len(css) > 120:
            css = css[:120] + "..."
        lines.append(f"- Design system: {design.get('theme_name')} | colors: {json.dumps(design.get('color_palette', {}))} | fonts: {json.dumps(design.get('typography', {}))}")
        if css:
            lines.append(f"- Design css_guidelines: {css}")

    lines.append("")
    lines.append("## Visual settings (project_settings — current values)")
    try:
        project_settings = json.loads(project.get("project_settings") or "{}")
    except Exception:
        project_settings = {}
    lines.append(_format_settings_overview(project_settings))

    manifest = _load_json(project_id, "assets/assets_manifest.json")
    if isinstance(manifest, list):
        total = sum(len(e.get("sub_visuals", [])) for e in manifest)
        fetched = sum(1 for e in manifest for sv in e.get("sub_visuals", []) if sv.get("visual_path"))
        lines.append(f"- Assets: {fetched}/{total} sub-visuals have downloaded media")
    return "\n".join(lines)
