import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List

from backend.pipeline.web_search import search_and_format
from backend.core.logger import logger

logger = logging.getLogger(__name__)


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


def _to_int(value, default=None):
    """Coerce JSON numbers (LLMs sometimes send string indices like "0")."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _deep_merge(target, source):
    for k, v in source.items():
        if isinstance(v, dict) and k in target and isinstance(target[k], dict):
            _deep_merge(target[k], v)
        else:
            target[k] = v


# ---------------------------------------------------------------------------
# Visual settings validation (subtitle / numbering / timeline / branding)
#
# Mirrors the exact keys the frontend writes into project_settings
# (SettingsTab.tsx, SubtitleSettings.tsx, BrandingSettings.tsx) so the AI can
# update the SAME settings the user sees in the inspector, with the same
# constraints (hex colors, numeric ranges, enums).
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


def _apply_visual_settings(project_id: str, updates: dict, allowed_keys=None):
    """Validates updates against the visual-settings spec and deep-merges the
    valid keys into the project's project_settings JSON.

    allowed_keys: optional frozenset restricting which keys are accepted
    (e.g. the subtitle tool only accepts SUBTITLE_SETTING_KEYS).

    Returns (applied, rejected) dicts. applied is None when the project is
    missing (rejected then carries the error under "_project").
    """
    from backend.database.db import get_project, update_project
    project = get_project(project_id)
    if not project:
        return None, {"_project": f"Project {project_id} not found."}
    try:
        settings = json.loads(project.get("project_settings") or "{}")
    except Exception:
        settings = {}

    applied, rejected = {}, {}
    for key, value in updates.items():
        if allowed_keys is not None and key not in allowed_keys:
            rejected[key] = "not a valid key for this tool"
            continue
        validator = VISUAL_SETTINGS_SPEC.get(key)
        if validator is None:
            rejected[key] = "unknown setting"
            continue
        err = validator(value)
        if err:
            rejected[key] = err
            continue
        applied[key] = value

    if applied:
        settings.update(applied)
        update_project(project_id, project_settings=json.dumps(settings, ensure_ascii=False))
    return applied, rejected


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
                "description": "Searches the web for up-to-date facts, statistics, or news using the LangSearch API. Useful for finding data that is recent or specific.",
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
                "description": "Loads a specialized skill definition: 'scriptwriter' (narration/TTS rules), 'subtitle-designer' (subtitle styling), 'stock-asset-searcher' (stock keyword rules), 'editor-qa' (guardrails for editing projects), 'visual-director-core' (visual selection rules), 'declarative-ast' (AST structure & style).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Skill name: scriptwriter, subtitle-designer, stock-asset-searcher, editor-qa, visual-director-core, declarative-ast"
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
                "description": "Searches Pexels for a stock photo. Returns a URL if found, or None. Useful to verify if a stock photo exists before using it in a visual cue.",
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
                "description": "Searches Pexels for stock video footage. Returns a URL if found. Useful to verify footage exists.",
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
                "description": "Searches Wikipedia for an entity/person and returns their primary image URL. Excellent for 'portrait' visual types.",
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
                               "Useful to verify a Pixabay asset exists before setting source:'pixabay' in an AST layer.",
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
                               "Pixabay video catalog is smaller than Pexels — prefer Pexels for B-roll, use Pixabay for animation loops or abstract footage.",
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
                "name": "update_design_settings",
                "description": "Updates the project's design.json to enforce visual consistency (colors, fonts, css_guidelines). Updates are validated: palette colors must be hex ('#RRGGBB') and are repaired to safe defaults if invalid; typography and css_guidelines are kept or defaulted.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "updates": {"type": "object", "description": "Key-value pairs to deep-merge into design.json. Example: {'color_palette': {'primary': '#4F46E5'}, 'typography': {'heading_font': 'Noto Sans Devanagari'}, 'css_guidelines': '...'}. CRITICAL: For complex-script languages (Hindi, Tamil, Bengali, Arabic, etc.) always use Noto fonts (e.g. 'Noto Sans Devanagari') — never Latin-only fonts like Oswald or Outfit."}
                    },
                    "required": ["project_id", "updates"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_subtitles",
                "description": "Updates transcription.json to fix broken whisper transcriptions for specific segments.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "segment_index": {"type": "integer", "description": "The index of the segment to modify"},
                        "new_text": {"type": "string", "description": "The corrected subtitle text"}
                    },
                    "required": ["project_id", "segment_index", "new_text"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_subtitle_style",
                "description": "Updates the project's subtitle style settings (font family, size, colors, animation, positioning). Valid keys: fontFamily, fontSize (20-150), wordSpacing (0-50), activeColor, pastColor, futureColor (all hex), textTransform (uppercase/lowercase/capitalize/none), activeAnimation (bounce/pop/jump/none), bottomOffset (0-1500), wordsPerScreen (1-20), backgroundStyle (none/highlight/full_block), highlightBgColor, fullBgColor (hex), fontWeight, hide_subtitles (true/false). Invalid keys or values are rejected.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "updates": {"type": "object", "description": "Subtitle style keys to merge into project settings. Colors must be hex like '#facc15'."}
                    },
                    "required": ["project_id", "updates"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_visual_settings",
                "description": "Updates the project's visual style settings shown in the Settings tab: subtitle styling (fontFamily, fontSize, activeColor, etc.), numbering style (numbering_*), and chapter branding (hide_chapter_name, chapter_text_color, chapter_border_color). Colors must be hex like '#facc15'; sizes/offsets must be within their documented ranges. Call project_status_report first to see current values. Invalid keys or values are rejected without touching anything else.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "updates": {"type": "object", "description": "Visual style keys to merge into project settings (see tool description for valid keys)."}
                    },
                    "required": ["project_id", "updates"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_scene_properties",
                "description": "Edits a specific sub-visual's properties in the project's script.json (e.g. modifying composition, animations, filters, style, or transition).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_index": {"type": "integer", "description": "0-indexed scene number"},
                        "sub_visual_index": {"type": "integer", "description": "0-indexed sub_visual within the scene"},
                        "updates": {"type": "object", "description": "Deep-merged properties to apply to the sub-visual object"}
                    },
                    "required": ["project_id", "scene_index", "sub_visual_index", "updates"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_scene_duration",
                "description": "Changes a scene's total duration (seconds) in the assets manifest. Existing sub-visual durations are NOT scaled automatically; the pipeline re-times them.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_index": {"type": "integer", "description": "0-indexed scene number (introduction/conclusion entries are not counted)"},
                        "new_duration_seconds": {"type": "number", "description": "New duration, at least 1.0 seconds"}
                    },
                    "required": ["project_id", "scene_index", "new_duration_seconds"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "reorder_scenes",
                "description": "Reorders the scenes of a project's script. Pass the new order as an array of scene indices, e.g. [0, 2, 1, 3].",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "new_scene_order": {"type": "array", "items": {"type": "integer"}, "description": "Permutation of all scene indices"}
                    },
                    "required": ["project_id", "new_scene_order"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_scene",
                "description": "Deletes a scene from the project (script.json and manifests). Use with care — the scene is gone.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_index": {"type": "integer", "description": "0-indexed scene number"}
                    },
                    "required": ["project_id", "scene_index"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "add_scene_with_ai",
                "description": "Adds a brand new scene (narration) to the project using the AI, matching the existing narrative tone and language. The scene is appended at the end.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "user_prompt": {"type": "string", "description": "Description of the new scene's content"},
                        "language": {"type": "string", "description": "Language code (default 'hi')"}
                    },
                    "required": ["project_id", "user_prompt"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "regenerate_script_section",
                "description": "Rewrites the text narration for a script section (introduction/conclusion/scene) based on a rewrite instruction. Do NOT use this if the user only wants to change the visuals.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_idx": {"type": "integer", "description": "Scene index (0-based); ignored for introduction/conclusion"},
                        "section_type": {"type": "string", "enum": ["introduction", "conclusion", "scenes"], "description": "Which section to rewrite"},
                        "rewrite_prompt": {"type": "string", "description": "What to change and why"},
                        "language": {"type": "string", "description": "Language code (default 'hi')"}
                    },
                    "required": ["project_id", "scene_idx", "section_type", "rewrite_prompt"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "regenerate_scene_visuals",
                "description": "Rewrites or regenerates the full sub_visuals array for one script section based on a user instruction. Use this when the user wants to change, replace, or rewrite the visuals of a scene without changing the text narration.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_idx": {"type": "integer", "description": "Scene index (0-based); ignored for introduction/conclusion"},
                        "section_type": {"type": "string", "enum": ["introduction", "conclusion", "scenes"], "description": "Which section's visuals to regenerate"},
                        "rewrite_prompt": {"type": "string", "description": "How to change the visuals (e.g. 'more portraits, less text')"}
                    },
                    "required": ["project_id", "scene_idx", "section_type", "rewrite_prompt"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_tts_settings",
                "description": "Updates the project's voiceover settings (engine, voice, speed, pitch) and marks the voiceover stale so it regenerates on the next run. Edge voices look like 'hi-IN-SwaraNeural'; XTTS uses engine 'xtts' with a reference voice path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "tts_engine": {"type": "string", "enum": ["edge", "xtts"], "description": "TTS engine"},
                        "tts_voice": {"type": "string", "description": "Edge voice name or XTTS reference wav path"},
                        "tts_speed": {"type": "number", "description": "Speed multiplier (e.g. 1.0)"},
                        "tts_pitch": {"type": "string", "description": "Pitch (e.g. '0', '+10Hz')"}
                    },
                    "required": ["project_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "invalidate_scene",
                "description": "Clears the cached change-detection hashes for a scene so the next pipeline run regenerates its visuals (and downstream steps). Use after manually editing a scene's narration or visuals.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "scene_index": {"type": "integer", "description": "0-indexed scene number"},
                        "scope": {"type": "string", "enum": ["visuals", "all"], "description": "'visuals' clears visual hashes; 'all' also invalidates voiceover/manifest content hashes"}
                    },
                    "required": ["project_id", "scene_index"]
                }
            }
        }
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
            from backend.agent.skill_loader import skill_loader
            skill = skill_loader.get_skill(name, context="tool")
            if skill:
                return f"--- SKILL: {name} (v{skill.version}) ---\n{skill.content}"
            return f"Error: Skill '{name}' not found. Available: scriptwriter, subtitle-designer, stock-asset-searcher, editor-qa, visual-director-core, declarative-ast."

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

        if tool_name == "update_design_settings":
            project_id = arguments.get("project_id")
            updates = arguments.get("updates")
            if not project_id or not isinstance(updates, dict):
                return "Error: project_id and updates (object) are required."
            if not updates:
                return "Error: updates must contain at least one key."
            file_path = _project_dir(project_id) / "design.json"
            if file_path.exists():
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    _deep_merge(data, updates)
                    # Validate + repair: hex colors, fonts, css_guidelines.
                    from backend.pipeline.ai import _repair_design_data
                    data = _repair_design_data(data)
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                    return f"Successfully updated design.json (validated): {json.dumps(updates, ensure_ascii=False)}"
                except Exception as e:
                    return f"Failed to update design.json: {e}"
            return f"Error: design.json does not exist for project {project_id}."

        if tool_name == "update_subtitles":
            project_id = arguments.get("project_id")
            segment_idx = _to_int(arguments.get("segment_index"))
            new_text = arguments.get("new_text")
            if segment_idx is None or new_text is None:
                return "Error: segment_index and new_text are required."
            data = _load_json(project_id, "subtitles/transcription.json")
            if data is None:
                return "Error: transcription.json does not exist."
            if isinstance(data, dict) and "segments" in data and 0 <= segment_idx < len(data["segments"]):
                data["segments"][segment_idx]["text"] = str(new_text)
                _save_json(project_id, "subtitles/transcription.json", data)
                return f"Successfully updated segment {segment_idx} in transcription.json"
            return f"Error: Invalid segment index {segment_idx}"

        if tool_name == "update_subtitle_style":
            project_id = arguments.get("project_id")
            updates = arguments.get("updates")
            if not project_id or not isinstance(updates, dict):
                return "Error: project_id and updates (object) are required."
            applied, rejected = _apply_visual_settings(project_id, updates, allowed_keys=SUBTITLE_SETTING_KEYS)
            if applied is None:
                return f"Error: {rejected.get('_project')}"
            msg = f"Applied {len(applied)} subtitle style settings: {json.dumps(applied, ensure_ascii=False)}"
            if rejected:
                msg += f"\nRejected {len(rejected)} invalid settings: {json.dumps(rejected, ensure_ascii=False)}"
            return msg

        if tool_name == "update_visual_settings":
            project_id = arguments.get("project_id")
            updates = arguments.get("updates")
            if not project_id or not isinstance(updates, dict):
                return "Error: project_id and updates (object) are required."
            applied, rejected = _apply_visual_settings(project_id, updates)
            if applied is None:
                return f"Error: {rejected.get('_project')}"
            msg = f"Applied {len(applied)} visual settings: {json.dumps(applied, ensure_ascii=False)}"
            if rejected:
                msg += f"\nRejected {len(rejected)} invalid settings: {json.dumps(rejected, ensure_ascii=False)}"
            return msg

        if tool_name == "update_scene_properties":
            project_id = arguments.get("project_id")
            scene_idx = _to_int(arguments.get("scene_index"))
            sub_idx = _to_int(arguments.get("sub_visual_index"))
            updates = arguments.get("updates")
            if scene_idx is None or sub_idx is None or not isinstance(updates, dict):
                return "Error: scene_index, sub_visual_index, and updates (object) are required."
            data = _load_json(project_id, "script.json")
            if data is None:
                return "Error: script.json does not exist."

            scenes = data.get("scenes", [])
            if not (0 <= scene_idx < len(scenes)):
                return f"Error: Invalid scene index {scene_idx}"
            scene = scenes[scene_idx]
            if "sub_visuals" not in scene or not (0 <= sub_idx < len(scene["sub_visuals"])):
                return f"Error: Invalid sub_visual index {sub_idx}"

            _deep_merge(scene["sub_visuals"][sub_idx], updates)
            if _save_json(project_id, "script.json", data):
                _sync_sub_visual_to_manifests(project_id, scene_idx, sub_idx, scene["sub_visuals"][sub_idx])
                return f"Successfully updated scene {scene_idx} sub_visual {sub_idx}"
            return "Error: Failed to save script.json"

        if tool_name == "update_scene_duration":
            project_id = arguments.get("project_id")
            scene_idx = _to_int(arguments.get("scene_index"))
            new_duration = arguments.get("new_duration_seconds")
            if scene_idx is None or new_duration is None:
                return "Error: scene_index and new_duration_seconds are required."
            from backend.core.bridge import api_bridge
            result = api_bridge.update_scene_duration(project_id, scene_idx, float(new_duration))
            if result.get("success"):
                return f"Successfully updated scene {scene_idx} duration to {new_duration}s"
            return f"Error: {result.get('error')}"

        if tool_name == "reorder_scenes":
            project_id = arguments.get("project_id")
            new_order = arguments.get("new_scene_order")
            if not project_id or not isinstance(new_order, list):
                return "Error: project_id and new_scene_order (array) are required."
            from backend.core.bridge import api_bridge
            result = api_bridge.reorder_scenes(project_id, [int(i) for i in new_order])
            if result.get("success"):
                return f"Successfully reordered scenes: {new_order}"
            return f"Error: {result.get('error')}"

        if tool_name == "delete_scene":
            project_id = arguments.get("project_id")
            scene_idx = _to_int(arguments.get("scene_index"))
            if scene_idx is None:
                return "Error: scene_index is required."
            from backend.core.bridge import api_bridge
            result = api_bridge.delete_scene(project_id, scene_idx)
            if result.get("success"):
                return f"Successfully deleted scene {scene_idx}"
            return f"Error: {result.get('error')}"

        if tool_name == "add_scene_with_ai":
            project_id = arguments.get("project_id")
            user_prompt = arguments.get("user_prompt")
            language = arguments.get("language") or "hi"
            if not project_id or not user_prompt:
                return "Error: project_id and user_prompt are required."
            script = _load_json(project_id, "script.json")
            if not isinstance(script, dict) or "scenes" not in script:
                return "Error: script.json is missing or invalid."
            from backend.core.bridge import api_bridge
            result = api_bridge.add_scene_with_ai(script, user_prompt, language)
            if result.get("success") and "data" in result:
                new_scene = result["data"]
                new_scene["scene_number"] = len(script.get("scenes", [])) + 1
                new_scene["sub_visuals"] = []
                script["scenes"].append(new_scene)
                _save_json(project_id, "script.json", script)
                return f"Successfully added scene: {new_scene.get('title', 'Untitled')}"
            return f"AI call failed: {result.get('error', 'unknown error')}"

        if tool_name == "regenerate_script_section":
            project_id = arguments.get("project_id")
            scene_idx = arguments.get("scene_idx")
            section_type = arguments.get("section_type")
            rewrite_prompt = arguments.get("rewrite_prompt")
            language = arguments.get("language") or "hi"
            if not rewrite_prompt or not section_type:
                return "Error: section_type and rewrite_prompt are required."
            script = _load_json(project_id, "script.json")
            if not isinstance(script, dict):
                return "Error: script.json is missing or invalid."
            from backend.core.bridge import api_bridge
            result = api_bridge.regenerate_script_section(scene_idx or 0, section_type, script, rewrite_prompt, language)
            if not result.get("success") or "data" not in result:
                return f"AI rewrite failed: {result.get('error', 'unknown error')}"
            new_data = result["data"]
            if section_type == "introduction":
                script["introduction"] = {**script.get("introduction", {}), **new_data}
            elif section_type == "conclusion":
                script["conclusion"] = {**script.get("conclusion", {}), **new_data}
            else:
                scenes = script.get("scenes", [])
                idx = scene_idx or 0
                if not (0 <= idx < len(scenes)):
                    return f"Error: Invalid scene index {scene_idx}"
                # Merge new script data while preserving existing sub_visuals
                existing_sub_visuals = scenes[idx].get("sub_visuals", [])
                merged = {**scenes[idx], **new_data}
                merged["sub_visuals"] = existing_sub_visuals
                scenes[idx] = merged
                script["scenes"] = scenes
            if _save_json(project_id, "script.json", script):
                return "Successfully rewrote the script section."
            return "Error: Failed to save script.json"

        if tool_name == "regenerate_scene_visuals":
            project_id = arguments.get("project_id")
            scene_idx = arguments.get("scene_idx") or 0
            section_type = arguments.get("section_type")
            rewrite_prompt = arguments.get("rewrite_prompt")
            if not rewrite_prompt or not section_type:
                return "Error: section_type and rewrite_prompt are required."
            script = _load_json(project_id, "script.json")
            if not isinstance(script, dict):
                return "Error: script.json is missing or invalid."
            from backend.core.bridge import api_bridge
            result = api_bridge.regenerate_visuals_section(project_id, scene_idx, section_type, script, rewrite_prompt)
            if not result.get("success") or "data" not in result:
                return f"AI visuals rewrite failed: {result.get('error', 'unknown error')}"
            new_svs = result["data"].get("sub_visuals", [])
            _set_section_sub_visuals(project_id, scene_idx, section_type, script, new_svs)
            _save_json(project_id, "script.json", script)
            return f"Successfully regenerated {len(new_svs)} sub-visuals for the {section_type} section."

        if tool_name == "set_tts_settings":
            project_id = arguments.get("project_id")
            if not project_id:
                return "Error: project_id required."
            from backend.database.db import get_project, update_project
            project = get_project(project_id)
            if not project:
                return f"Error: Project {project_id} not found."
            kwargs = {}
            if arguments.get("tts_engine") is not None:
                kwargs["tts_engine"] = arguments.get("tts_engine")
            if arguments.get("tts_voice") is not None:
                kwargs["tts_voice"] = arguments.get("tts_voice")
            if arguments.get("tts_speed") is not None:
                kwargs["tts_speed"] = float(arguments.get("tts_speed"))
            if arguments.get("tts_pitch") is not None:
                kwargs["tts_pitch"] = str(arguments.get("tts_pitch"))
            if not kwargs:
                return "Error: Provide at least one of tts_engine/tts_voice/tts_speed/tts_pitch."
            update_project(project_id, **kwargs)
            # Invalidate voiceover so it regenerates with the new settings.
            _invalidate_voiceover(project_id)
            return f"Successfully updated TTS settings: {json.dumps(kwargs)} (voiceover marked stale)"

        if tool_name == "invalidate_scene":
            project_id = arguments.get("project_id")
            scene_idx = _to_int(arguments.get("scene_index"))
            scope = arguments.get("scope") or "visuals"
            if scene_idx is None:
                return "Error: scene_index required."
            # Manifests are laid out as [introduction, scene..., conclusion], so
            # scene indices must be resolved by counting section_type == "scene"
            # entries rather than indexing the list directly.
            updated = []
            for rel_path in ("assets/assets_manifest.json", "voiceover/manifest.json"):
                data = _load_json(project_id, rel_path)
                if not isinstance(data, list):
                    continue
                counter = 0
                target = None
                for entry in data:
                    if entry.get("section_type") == "scene":
                        if counter == scene_idx:
                            target = entry
                            break
                        counter += 1
                if target is None:
                    continue
                target.pop("_narr_hash", None)
                target.pop("_design_hash", None)
                target.pop("_content_hash", None)
                if _save_json(project_id, rel_path, data):
                    updated.append(rel_path)
            if not updated:
                return f"Error: Manifest not found or invalid scene index {scene_idx}"
            if scope == "all":
                _invalidate_voiceover(project_id)
            return f"Invalidated scene {scene_idx} (scope={scope}). Downstream steps will regenerate."

        return f"Error: Unknown tool {tool_name}"

    except InterruptedError:
        raise
    except Exception as e:
        logger.error(f"Error executing tool {tool_name}: {e}", exc_info=True)
        return f"Tool execution failed: {str(e)}"


def _sync_sub_visual_to_manifests(project_id: str, scene_idx: int, sub_idx: int, sub_visual: dict) -> None:
    """Mirror an in-place edited sub_visual into the voiceover and assets
    manifests. Without this, the next visuals run copies the (stale) manifest
    sub_visuals back over script.json and silently reverts the agent's edit."""
    for rel_path in ("assets/assets_manifest.json", "voiceover/manifest.json"):
        manifest = _load_json(project_id, rel_path)
        if not isinstance(manifest, list):
            continue
        counter = 0
        for entry in manifest:
            if entry.get("section_type") != "scene":
                continue
            if counter == scene_idx:
                svs = entry.get("sub_visuals")
                if isinstance(svs, list) and 0 <= sub_idx < len(svs):
                    svs[sub_idx] = dict(sub_visual)
                    _save_json(project_id, rel_path, manifest)
                return
            counter += 1


def _set_section_sub_visuals(project_id: str, scene_idx: int, section_type: str, script: dict, sub_visuals: list) -> None:
    """Writes regenerated sub_visuals into the script section, the voiceover manifest,
    and the assets manifest (best-effort, preserving metadata)."""
    if section_type == "introduction":
        script.setdefault("introduction", {})["sub_visuals"] = sub_visuals
    elif section_type == "conclusion":
        script.setdefault("conclusion", {})["sub_visuals"] = sub_visuals
    else:
        scenes = script.get("scenes", [])
        if 0 <= scene_idx < len(scenes):
            scenes[scene_idx]["sub_visuals"] = sub_visuals

    for rel_path in ("assets/assets_manifest.json", "voiceover/manifest.json"):
        manifest = _load_json(project_id, rel_path)
        if not isinstance(manifest, list):
            continue
        scene_counter = 0
        for entry in manifest:
            st = entry.get("section_type")
            if section_type == "introduction" and st == "introduction":
                entry["sub_visuals"] = sub_visuals
            elif section_type == "conclusion" and st == "conclusion":
                entry["sub_visuals"] = sub_visuals
            elif section_type == "scenes" and st == "scene":
                if scene_counter == scene_idx:
                    entry["sub_visuals"] = sub_visuals
                scene_counter += 1
        _save_json(project_id, rel_path, manifest)


def _invalidate_voiceover(project_id: str) -> None:
    """Clears cached voiceover markers so is_voiceover_stale() triggers regeneration."""
    manifest = _load_json(project_id, "voiceover/manifest.json")
    if isinstance(manifest, list):
        for entry in manifest:
            if isinstance(entry, dict):
                for k in ("_voiceover_engine", "_voiceover_voice", "_voiceover_speed", "_voiceover_pitch", "_content_hash"):
                    entry.pop(k, None)
        _save_json(project_id, "voiceover/manifest.json", manifest)


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
