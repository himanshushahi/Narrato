"""Internal chat agent tool adapter — same tools, same logic as the MCP server.

The MCP server (``backend.mcp.server``) is the source of truth for tool
semantics: validation, skill gates, file writes and DB updates live in
``backend.mcp.payloads`` / ``backend.mcp.probe``. This module does NOT
re-implement any of that — it calls the same Python functions in-process
so the Export-tab chat agent behaves identically to an external MCP agent.

Differences from the MCP transport (intentional, documented):
- No MCP wire protocol: tools are called as plain functions.
- ``run_stage`` / ``stage_status`` / ``cancel_stage`` are remapped onto the
  desktop app's ``global_queue_manager`` (one driver at a time) instead of
  the MCP ``_STAGE_POOL``, so Export-tab progress bars keep working.
- ``review_frame`` JPEG bytes are persisted under the project folder and the
  tool returns a path the frontend file-server can display.
"""

import base64
import json
import time
from pathlib import Path
from typing import Any, Dict, List

from backend.core.logger import logger


def _func_def(name: str, desc: str, props: dict, required: list = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": props,
                "required": required or [],
            },
        },
    }


_STR = {"type": "string"}
_INT = {"type": "integer"}
_BOOL = {"type": "boolean"}
_OBJ = {"type": "object"}
_ARR = {"type": "array"}
_PID = {"type": "string", "description": "Project id (auto-filled with the current project when omitted)."}


def get_chat_tools_schema() -> List[Dict[str, Any]]:
    """OpenAI function schemas for every MCP tool, same names + same args."""
    return [
        _func_def("create_project", "Create a new video project. Ask topic/language/format/duration/voice first — do not guess.",
                  {"name": _STR, "language": {"type": "string", "enum": ["hi", "en"]},
                   "video_format": {"type": "string", "enum": ["landscape", "portrait"]},
                   "duration_mode": {"type": "string", "enum": ["short", "medium", "long", "extra_long"]},
                   "export_folder": _STR, "style": _STR, "style_hint": _STR},
                  ["name", "language", "video_format", "duration_mode"]),
        _func_def("list_projects", "List all projects (id, name, status, language).", {}, []),
        _func_def("project_status", "Full project row + per-stage task states.", {"project_id": _PID}, []),
        _func_def("delete_project", "Permanently delete a project + files. Cannot be undone.", {"project_id": _PID}, ["project_id"]),
        _func_def("list_skills", "List writing/visual guide skills.", {}, []),
        _func_def("get_skill", "Full markdown guide for one skill; brief=true for section map, section='...' for one part, section='learnings' for past session observations.",
                  {"skill_name": _STR, "language": _STR, "video_format": _STR, "section": _STR,
                   "brief": _BOOL, "project_id": _PID}, ["skill_name"]),
        _func_def("get_stage_skills", "One-call starter pack for script|design|visuals. Satisfies the skill gate.",
                  {"stage": {"type": "string", "enum": ["script", "design", "visuals"]},
                   "project_id": _PID, "language": _STR, "video_format": _STR}, ["stage"]),
        _func_def("append_skill_learning", "Append a learning observation to a skill LEARNINGS.md. Read past ones via get_skill section='learnings' before authoring.",
                  {"skill_name": _STR, "title": _STR, "context": _STR, "observation": _STR,
                   "fix_or_pattern": _STR, "status": _STR}, ["skill_name", "title", "context", "observation", "fix_or_pattern"]),
        _func_def("save_script", "Validate + persist complete script {title, introduction:{hook}, scenes:[{title,narration}], conclusion:{summary,cta?}}.",
                  {"project_id": _PID, "script": _OBJ, "force": _BOOL}, ["script"]),
        _func_def("patch_script", "Surgical single-section script fix (keeps design/audio/assets/visuals). "
                   "introduction {hook}; scene {narration,title?} + scene_number (1-based) or scene_index; conclusion {summary,cta?}. "
                   "Use for typos/single beats; save_script only for structural rewrites.",
                  {"project_id": _PID, "section_type": _STR, "patch": _OBJ,
                   "scene_index": _INT, "scene_number": _INT}, ["section_type", "patch"]),
        _func_def("get_script", "Read back script.json (ASTs stripped unless include_visuals).",
                  {"project_id": _PID, "include_visuals": _BOOL}, []),
        _func_def("save_design", "Validate + persist design system {theme_name,color_palette,typography,css_guidelines}.",
                  {"project_id": _PID, "design": _OBJ}, ["design"]),
        _func_def("get_section_timings", "Per-section TRUE audio durations + word timestamps. Run after transcribe. Long videos: include_words=false for summary; scene_number=N or section_type for one section.",
                  {"project_id": _PID, "include_words": _BOOL, "scene_number": _INT, "section_type": _STR}, []),
        _func_def("get_transcription", "Word-level transcription, section-scoped or paginated.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "scene_number": _INT,
                   "segment_id": _INT, "offset": _INT, "limit": _INT}, []),
        _func_def("get_visuals", "Read sub_visuals for one section or single cut.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "cut_index": _INT,
                   "scene_number": _INT, "cut_number": _INT}, ["section_type"]),
        _func_def("probe_cut", "Inspect one cut: JSON + timing + asset files. Read-only.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "cut_index": _INT,
                   "scene_number": _INT, "cut_number": _INT}, ["section_type"]),
        _func_def("probe_scene", "Inspect one section: per-cut summaries + variety. Read-only.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "scene_number": _INT}, ["section_type"]),
        _func_def("probe_asset", "File truth for one media layer. Read-only.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "cut_index": _INT,
                   "layer_index": _INT, "scene_number": _INT, "cut_number": _INT}, ["section_type"]),
        _func_def("save_visuals", "Validate + persist sub_visuals for ONE section. dry_run=true validates without writing.",
                  {"project_id": _PID, "section_type": _STR, "sub_visuals": _ARR, "scene_index": _INT,
                   "cut_index": _INT, "scene_number": _INT, "cut_number": _INT,
                   "dry_run": _BOOL, "auto_migrate": _BOOL}, ["section_type", "sub_visuals"]),
        _func_def("save_visuals_batch", "Validate/persist MANY sections in one call [{section_type,sub_visuals,scene_index?}]. dry_run first.",
                  {"project_id": _PID, "sections": _ARR, "dry_run": _BOOL}, ["sections"]),
        _func_def("clear_visuals", "Delete ALL visual ASTs (keeps narration/audio/design). Cannot be undone.",
                  {"project_id": _PID, "clear_assets": _BOOL}, []),
        _func_def("clear_assets", "Delete ALL downloaded assets (keeps cuts for re-fetch). Cannot be undone.",
                  {"project_id": _PID}, []),
        _func_def("review_frame", "Contact-sheet snapshot: rendered/composition/asset lineup for a cut or section.",
                  {"project_id": _PID, "section_type": _STR, "scene_index": _INT, "cut_index": _INT,
                   "scene_number": _INT, "cut_number": _INT, "scope": _STR, "mode": _STR, "max_cells": _INT}, []),
        _func_def("run_stage", "Execute mechanical stage: generate_voiceover|transcribe|fetch_assets|render. Render needs confirm_render=true. "
                   "Slow stages (generate_voiceover, transcribe, render) take minutes: use wait=true and await the result. "
                   "Only use wait=false when the user wants to keep chatting meanwhile — then loop sleep→stage_status until completed. "
                   "Pass idempotency_key to guard repeat submits (same key+stage+content replays instead of re-running).",
                  {"project_id": _PID, "stage": {"type": "string", "enum": ["generate_voiceover", "transcribe", "fetch_assets", "render"]},
                   "wait": _BOOL, "confirm_render": _BOOL, "idempotency_key": _STR}, ["stage"]),
        _func_def("stage_status", "Poll a queued/background stage (task row).",
                  {"project_id": _PID, "stage": _STR}, ["stage"]),
        _func_def("cancel_stage", "Cancel a running queued stage.",
                  {"project_id": _PID, "stage": _STR}, ["stage"]),
        _func_def("sleep", "Pause this turn for a bounded time (max 120s per call), then continue. "
                   "Use while a wait=false stage finishes: sleep, then stage_status, repeat until "
                   "completed/failed. Honors the chat Stop button.",
                  {"seconds": {"type": "integer", "description": "Seconds to pause (1-120)."}}, []),
        _func_def("update_voice_settings", "Change voice/audio columns (tts_engine,tts_voice,tts_speed,tts_pitch,bg_music_volume).",
                  {"project_id": _PID, "settings": _OBJ}, ["settings"]),
        _func_def("update_transcribe_settings", "Change whisper model/device.",
                  {"project_id": _PID, "settings": _OBJ}, ["settings"]),
        _func_def("update_subtitle_settings", "Change kinetic subtitle styling (fonts, colors, stroke, layouts). Render-only reset.",
                  {"project_id": _PID, "settings": _OBJ}, ["settings"]),
        _func_def("estimate_cost", "Dry-run time preview for remaining stages (no spend, no side effects).",
                  {"project_id": _PID}, []),
        _func_def("qa_gate", "Fail-closed publish gate — call BEFORE render. ok only when pacing/design/voiceover/captions/visuals/assets all pass. Do NOT render when ok is false.",
                  {"project_id": _PID}, []),
        _func_def("verify_stock", "File-truth stock check per Image/Video layer + source/license attribution. NOT a relevance check.",
                  {"project_id": _PID}, []),
        _func_def("get_receipt", "Video Receipt: input/output hashes + resume cursor + per-cut assets (deterministic receipt_id).",
                  {"project_id": _PID}, []),
        _func_def("search_tools", "Keyword-search the tool catalog. Empty query returns the core build-path tools; then get_tool_details(name) before calling.",
                  {"query": _STR, "limit": _INT}, []),
        _func_def("get_tool_details", "Blurb + group + usage hint for ONE tool (inspect before calling).",
                  {"name": _STR}, ["name"]),
        _func_def("list_voice_options", "Voices/engines to offer the user before voiceover.", {}, []),
        _func_def("search_media", "Verify stock query resolves (pexels_photo|pexels_video|wikipedia_image|pixabay_photo|pixabay_video|youtube_video|archive_photo|archive_video). English queries only.",
                  {"source": _STR, "query": _STR, "orientation": _STR}, ["source", "query"]),
        _func_def("web_search", "Fact research for scripts (needs web-search key in Settings).",
                  {"query": _STR, "count": _INT}, ["query"]),
        _func_def("list_project_files", "List files inside a project folder.",
                  {"project_id": _PID}, []),
        _func_def("read_project_file", "Read a text artifact (capped, paginated).",
                  {"project_id": _PID, "path": _STR, "offset": _INT}, ["path"]),
    ]


CHAT_TOOL_NAMES = [t["function"]["name"] for t in get_chat_tools_schema()]

# Stages the chat may run through the desktop queue (same vocabulary as MCP).
CHAT_RUNNABLE_STAGES = ("generate_voiceover", "transcribe", "fetch_assets", "render")

# One bounded pause per sleep call: long enough to skip poll spam, short
# enough to stay responsive (and safe under MCP HTTP client timeouts).
SLEEP_MAX_SECONDS = 120

# Suggested first sleep per stage for a wait=false loop (slow three first).
# In-app values: no HTTP tool timeout applies here, unlike the smaller
# HTTP-safe table in mcp/server.py (same stages, same intent).
STAGE_SLEEP_SUGGESTIONS = {
    "generate_voiceover": 90,
    "transcribe": 90,
    "render": 90,
    "fetch_assets": 45,
}

# Mutating chat tools locked while a pipeline stage runs on the project.
# Must mirror the MCP _refuse_if_stage_running coverage: every tool the MCP
# server guards here must be guarded here too (different transports, same rule).
_CHAT_GUARDED_TOOLS = frozenset({
    "save_script", "patch_script", "save_design", "save_visuals", "save_visuals_batch",
    "clear_visuals", "clear_assets", "delete_project",
    "update_voice_settings", "update_transcribe_settings",
    "update_subtitle_settings",
})


def _queue_ids(queued) -> list:
    """Project ids in the desktop queue. Entries are
    (project_id, steps, is_resume) tuples — never compare a bare id
    against the raw list (always False)."""
    ids = []
    for q in queued or []:
        if isinstance(q, (list, tuple)) and q:
            ids.append(q[0])
        elif isinstance(q, str):
            ids.append(q)
    return ids


def _chat_busy_stage(project_id: str):
    """Step name of the in-flight desktop-queue stage for a project, or None.

    Returns the DB step name when identifiable, else "unknown" (busy, unnamed
    — always a string so agents can parse awaiting_stage reliably).
    Mirrors the one-driver check run_stage itself performs.
    """
    if not project_id:
        return None
    try:
        from backend.pipeline.queue import global_queue_manager
        active = getattr(global_queue_manager, "_active_project_id", None)
        queued = list(getattr(global_queue_manager, "_queue", []) or [])
        if not (active == project_id or project_id in _queue_ids(queued)):
            return None
    except Exception:
        return None
    try:
        from backend.database import db as _db
        for t in (_db.get_project_tasks(project_id) or []):
            if t.get("status") in ("running", "pending") and t.get("step"):
                return t.get("step")
    except Exception:
        pass
    return "unknown"


def _sleep_tool(args: dict, cancel_event=None) -> dict:
    """Bounded, interruptible pause. Never raises except on user cancel."""
    try:
        # OverflowError covers inf/1e999 (int(inf) raises); ValueError covers NaN.
        secs = int(float(str(args.get("seconds", 60)).strip() or 60))
    except (ValueError, TypeError, AttributeError, OverflowError):
        secs = 60
    secs = max(1, min(SLEEP_MAX_SECONDS, secs))
    end = time.time() + secs
    while time.time() < end:
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")
        time.sleep(min(3.0, max(0.1, end - time.time())))
    return {"ok": True, "slept_seconds": secs,
            "hint": "Time is up — now call stage_status for the running stage. "
                    "Do not start other work while its status is queued/running."}


def _results_json(result) -> str:
    try:
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        return str(result)


def _to_bool(value, default: bool = False) -> bool:
    """Lenient bool: XML-ish providers send 'false'/'0' strings and Python's
    bool('false') is True, so map falsy strings explicitly."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "off", "")
    return bool(value)


def _to_int(value, default: int = 0) -> int:
    try:
        return int(str(value).strip()) if str(value).strip() else default
    except (ValueError, TypeError):
        return default


def _to_int_or_none(value):
    """Lenient optional int for index/number args (LLMs send '1' strings)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    s = str(value).strip()
    if not s:
        return None
    try:
        f = float(s)
    except (ValueError, TypeError):
        return None
    return int(f) if f.is_integer() else None


def execute_chat_tool(tool_name: str, arguments: Dict[str, Any], default_project_id: str = "",
                      cancel_event=None) -> str:
    """Execute one chat tool via the same implementation the MCP server uses.

    Returns a JSON string (or image-path-augmented JSON for review_frame) to
    feed back to the LLM. Never raises — errors are returned as JSON.
    cancel_event aborts long waits (e.g. run_stage(wait=true) polling).
    """
    from backend.agent.telemetry import emit_activity, update_activity
    args = dict(arguments or {})
    if default_project_id and not args.get("project_id"):
        # Most tools are project-scoped; default to the open project so the
        # model does not have to repeat it every call.
        if tool_name not in ("create_project", "list_projects", "list_skills", "get_skill",
                              "list_voice_options", "web_search", "append_skill_learning",
                              "sleep", "search_tools", "get_tool_details"):
            args["project_id"] = default_project_id

    entry_id = emit_activity("tool", tool_name, json.dumps(args, ensure_ascii=False, default=str)[:300],
                             "running", args=args)
    try:
        result = _dispatch(tool_name, args, default_project_id, cancel_event)
        status = "ok" if not (isinstance(result, dict) and result.get("ok") is False) else "error"
        text = _results_json(result)
        # Cap tool-result size for LLM context (probe/review payloads are big).
        if len(text) > 12000:
            text = text[:12000] + '... [truncated for context]'
        update_activity(entry_id, status,
                        f"Args: {json.dumps(args, ensure_ascii=False, default=str)[:200]} -> {text[:200]}",
                        result=text[:4000])
        return text
    except InterruptedError:
        update_activity(entry_id, "error", "interrupted by user", result=None)
        raise
    except Exception as e:
        logger.error(f"chat tool {tool_name} failed: {e}", exc_info=True)
        update_activity(entry_id, "error", f"exception: {e}", result=None)
        return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)


def _dispatch(tool_name: str, args: dict, default_project_id: str, cancel_event=None):
    from backend.mcp import server as S

    # Waiting discipline: while a pipeline stage runs on this project, refuse
    # state-mutating tools so a wait=false polling turn cannot wander into
    # side quests. Read-only tools, sleep, stage_status and cancel_stage pass;
    # dry_run validations write nothing and also pass.
    if tool_name in _CHAT_GUARDED_TOOLS:
        if tool_name in ("save_visuals", "save_visuals_batch") and _to_bool(args.get("dry_run", False)):
            pass
        else:
            pid = args.get("project_id", "") or default_project_id
            busy = _chat_busy_stage(pid)
            if busy:
                name = busy if isinstance(busy, str) else "unknown"
                return {"ok": False, "awaiting_stage": name,
                        "error": (f"Stage {name!r} is running on this project — wait for it first: "
                                  "sleep, then stage_status, repeat until completed/failed. "
                                  "Mutating tools are locked until it settles; read-only probes are fine.")}

    # --- thin wrappers: same functions MCP calls (incl. skill-gate checks) ---
    if tool_name == "create_project":
        return S.create_project(
            args.get("name", ""), language=args.get("language"), video_format=args.get("video_format"),
            duration_mode=args.get("duration_mode"), export_folder=args.get("export_folder", ""),
            style=args.get("style", "nitish_rajput"), style_hint=args.get("style_hint", ""))
    if tool_name == "list_projects":
        return S.list_projects()
    if tool_name == "project_status":
        return S.project_status(args.get("project_id", "") or default_project_id)
    if tool_name == "delete_project":
        return S.delete_project(args.get("project_id", "") or default_project_id)
    if tool_name == "list_skills":
        return S.list_skills()
    if tool_name == "get_skill":
        return S.get_skill(args.get("skill_name", ""), language=args.get("language", "hi"),
                           video_format=args.get("video_format", "landscape"),
                           section=args.get("section", ""), brief=_to_bool(args.get("brief", False)),
                           project_id=args.get("project_id", "") or default_project_id)
    if tool_name == "get_stage_skills":
        return S.get_stage_skills(args.get("stage", "visuals"),
                                  project_id=args.get("project_id", "") or default_project_id,
                                  language=args.get("language", "hi"),
                                  video_format=args.get("video_format", "landscape"))
    if tool_name == "append_skill_learning":
        return S.append_skill_learning(args.get("skill_name", ""), args.get("title", ""),
                                       args.get("context", ""), args.get("observation", ""),
                                       args.get("fix_or_pattern", ""), args.get("status", "pending"))
    if tool_name == "save_script":
        return S.save_script(args.get("project_id", "") or default_project_id,
                             args.get("script", {}), force=_to_bool(args.get("force", False)))
    if tool_name == "patch_script":
        return S.patch_script(args.get("project_id", "") or default_project_id,
                              args.get("section_type", ""), args.get("patch", {}),
                              scene_index=_to_int_or_none(args.get("scene_index")),
                              scene_number=_to_int_or_none(args.get("scene_number")))
    if tool_name == "get_script":
        return S.get_script(args.get("project_id", "") or default_project_id,
                            include_visuals=_to_bool(args.get("include_visuals", False)))
    if tool_name == "save_design":
        return S.save_design(args.get("project_id", "") or default_project_id, args.get("design", {}))
    if tool_name == "get_section_timings":
        return S.get_section_timings(args.get("project_id", "") or default_project_id,
                                     include_words=_to_bool(args.get("include_words", True)),
                                     scene_number=_to_int_or_none(args.get("scene_number")),
                                     section_type=args.get("section_type", "") or "")
    if tool_name == "get_transcription":
        return S.get_transcription(
            args.get("project_id", "") or default_project_id, section_type=args.get("section_type", ""),
            scene_index=_to_int_or_none(args.get("scene_index")),
            segment_id=_to_int_or_none(args.get("segment_id")),
            offset=_to_int(args.get("offset", 0), 0), limit=_to_int(args.get("limit", 50), 50),
            scene_number=_to_int_or_none(args.get("scene_number")))
    if tool_name == "get_visuals":
        return S.get_visuals(args.get("project_id", "") or default_project_id,
                             args.get("section_type", ""),
                             scene_index=_to_int_or_none(args.get("scene_index")),
                             cut_index=_to_int_or_none(args.get("cut_index")),
                             scene_number=_to_int_or_none(args.get("scene_number")),
                             cut_number=_to_int_or_none(args.get("cut_number")))
    if tool_name == "probe_cut":
        return S.probe_cut(args.get("project_id", "") or default_project_id,
                           args.get("section_type", ""),
                           scene_index=_to_int_or_none(args.get("scene_index")),
                           cut_index=_to_int_or_none(args.get("cut_index")),
                           scene_number=_to_int_or_none(args.get("scene_number")),
                           cut_number=_to_int_or_none(args.get("cut_number")))
    if tool_name == "probe_scene":
        return S.probe_scene(args.get("project_id", "") or default_project_id,
                             args.get("section_type", ""),
                             scene_index=_to_int_or_none(args.get("scene_index")),
                             scene_number=_to_int_or_none(args.get("scene_number")))
    if tool_name == "probe_asset":
        return S.probe_asset(args.get("project_id", "") or default_project_id,
                             args.get("section_type", ""),
                             scene_index=_to_int_or_none(args.get("scene_index")),
                             cut_index=_to_int_or_none(args.get("cut_index")),
                             layer_index=_to_int(args.get("layer_index", 0), 0),
                             scene_number=_to_int_or_none(args.get("scene_number")),
                             cut_number=_to_int_or_none(args.get("cut_number")))
    if tool_name == "save_visuals":
        return S.save_visuals(args.get("project_id", "") or default_project_id,
                              args.get("section_type", ""), args.get("sub_visuals", []),
                              scene_index=_to_int_or_none(args.get("scene_index")),
                              cut_index=_to_int_or_none(args.get("cut_index")),
                              dry_run=_to_bool(args.get("dry_run", False)),
                              auto_migrate=_to_bool(args.get("auto_migrate", False)),
                              scene_number=_to_int_or_none(args.get("scene_number")),
                              cut_number=_to_int_or_none(args.get("cut_number")))
    if tool_name == "save_visuals_batch":
        return S.save_visuals_batch(args.get("project_id", "") or default_project_id,
                                    args.get("sections", []),
                                    dry_run=_to_bool(args.get("dry_run", False)))
    if tool_name == "clear_visuals":
        return S.clear_visuals(args.get("project_id", "") or default_project_id,
                               clear_assets=_to_bool(args.get("clear_assets", True)))
    if tool_name == "clear_assets":
        return S.clear_assets(args.get("project_id", "") or default_project_id)
    if tool_name == "review_frame":
        return _review_frame_chat(args, default_project_id)
    if tool_name in ("run_stage", "stage_status", "cancel_stage"):
        return _stage_via_queue(tool_name, args, default_project_id, cancel_event)
    if tool_name == "sleep":
        return _sleep_tool(args, cancel_event)
    if tool_name == "update_voice_settings":
        return S.update_voice_settings(args.get("project_id", "") or default_project_id,
                                       args.get("settings", {}))
    if tool_name == "update_transcribe_settings":
        return S.update_transcribe_settings(args.get("project_id", "") or default_project_id,
                                            args.get("settings", {}))
    if tool_name == "update_subtitle_settings":
        return S.update_subtitle_settings(args.get("project_id", "") or default_project_id,
                                          args.get("settings", {}))
    if tool_name == "estimate_cost":
        return S.estimate_cost(args.get("project_id", "") or default_project_id)
    if tool_name == "qa_gate":
        return S.qa_gate(args.get("project_id", "") or default_project_id)
    if tool_name == "verify_stock":
        return S.verify_stock(args.get("project_id", "") or default_project_id)
    if tool_name == "get_receipt":
        return S.get_receipt(args.get("project_id", "") or default_project_id)
    if tool_name == "search_tools":
        return S.search_tools(query=args.get("query", "") or "",
                              limit=_to_int(args.get("limit", 10), 10))
    if tool_name == "get_tool_details":
        return S.get_tool_details(args.get("name", ""))
    if tool_name == "list_voice_options":
        return S.list_voice_options()
    if tool_name == "search_media":
        return S.search_media(args.get("source", ""), args.get("query", ""),
                              orientation=args.get("orientation", "landscape"))
    if tool_name == "web_search":
        return S.web_search(args.get("query", ""), count=_to_int(args.get("count", 3), 3))
    if tool_name == "list_project_files":
        return S.list_project_files(args.get("project_id", "") or default_project_id)
    if tool_name == "read_project_file":
        return S.read_project_file(args.get("project_id", "") or default_project_id,
                                   args.get("path", ""), offset=_to_int(args.get("offset", 0), 0))
    return {"ok": False, "error": f"Unknown chat tool {tool_name!r}."}


def _stage_via_queue(tool_name: str, args: dict, default_project_id: str, cancel_event=None) -> dict:
    """Chat stages run through the desktop queue (single driver with ExportTab)."""
    from backend.database import db as _db
    from backend.pipeline.queue import global_queue_manager

    project_id = args.get("project_id", "") or default_project_id
    stage = (args.get("stage", "") or "").strip().lower()
    if stage not in CHAT_RUNNABLE_STAGES:
        return {"ok": False, "error": f"stage must be one of {list(CHAT_RUNNABLE_STAGES)}."}
    if not project_id:
        return {"ok": False, "error": "project_id is required."}

    # Idempotency mirrors MCP run_stage: same key+stage+script-content replays
    # instead of re-running. wait=false completions land in the background
    # worker (no hook there), so only wait=true completions are recorded here.
    from backend.mcp import payloads as _payloads
    idem_key = str(args.get("idempotency_key", "") or "").strip()[:128]
    content_hash = ""
    if idem_key:
        try:
            content_hash = _payloads._script_content_hash(
                _payloads._project_dir(project_id))
        except Exception:
            content_hash = ""
        prior = _payloads.check_idempotency(project_id, stage, idem_key,
                                            content_hash)
        if prior is not None and prior.get("status") == "completed":
            return {"ok": True, "project_id": project_id, "stage": stage,
                    "replayed": True, "idempotency_key": idem_key,
                    "hint": "Identical key+stage+content already completed — "
                            "replaying stored result instead of re-running."}

    if tool_name == "run_stage":
        wait = _to_bool(args.get("wait", True))
        confirm_render = _to_bool(args.get("confirm_render", False))
        if stage == "render" and not confirm_render:
            return {"ok": False, "stage": stage, "needs_confirmation": True,
                    "error": ("Render is gated by human review. Summarize the build, ask the user "
                              "to review/edit in the app, and only re-call run_stage(render) with "
                              "confirm_render=true after explicit approval.")}
        # One driver at a time: refuse when the desktop queue is busy on this project.
        try:
            active = getattr(global_queue_manager, "_active_project_id", None)
            queued = list(getattr(global_queue_manager, "_queue", []) or [])
            if active == project_id or project_id in _queue_ids(queued):
                return {"ok": False, "stage": stage,
                        "error": f"Project {project_id!r} already has a queued/running pipeline stage; wait or cancel it first."}
        except Exception:
            pass
        ok = global_queue_manager.queue_project(project_id, [stage])
        if not ok:
            return {"ok": False, "stage": stage, "error": "Queue rejected the stage (already queued?)."}
        try:
            from backend.mcp.server import _notify_ui_project_event
            _notify_ui_project_event("project_updated", project_id, files_changed=False)
        except Exception:
            pass
        if not wait:
            nap = STAGE_SLEEP_SUGGESTIONS.get(stage, 60)
            return {"ok": True, "accepted": True, "project_id": project_id, "stage": stage,
                    "status": "submitted",
                    "hint": (f"Poll stage_status until completed/failed. This stage takes a while — "
                             f"call sleep({nap}) first, then stage_status, and repeat. "
                             "Run no other mutating tool while it is queued/running.")}
        # wait=true: block until the task row settles, but stay responsive
        # to the chat Stop button (cancel_event wakes the wait immediately).
        deadline = time.time() + 60 * 60  # 1h hard cap per stage
        while time.time() < deadline:
            if cancel_event is not None:
                if cancel_event.wait(3):
                    try:
                        from backend.mcp.server import _notify_ui_project_event
                        _notify_ui_project_event("project_updated", project_id)
                    except Exception:
                        pass
                    return {"ok": False, "project_id": project_id, "stage": stage,
                            "error": "Cancelled.", "cancelled": True}
            else:
                time.sleep(3)
            try:
                rows = {t.get("step"): t for t in (_db.get_project_tasks(project_id) or [])}
            except Exception:
                rows = {}
            row = rows.get(stage)
            if row and row.get("status") in ("completed", "failed"):
                try:
                    from backend.mcp.server import _notify_ui_project_event
                    _notify_ui_project_event("project_updated", project_id)
                except Exception:
                    pass
                if row.get("status") == "completed":
                    out: dict = {"ok": True, "project_id": project_id, "stage": stage}
                    if stage == "render":
                        try:
                            out["video_path"] = (_db.get_project(project_id) or {}).get("video_path")
                        except Exception:
                            pass
                    if idem_key:
                        try:
                            _payloads.record_idempotency(project_id, stage, idem_key,
                                                        content_hash, "completed")
                        except Exception:
                            pass
                    return out
                return {"ok": False, "project_id": project_id, "stage": stage,
                        "error": row.get("error_message") or row.get("message") or "Stage failed."}
        return {"ok": False, "project_id": project_id, "stage": stage,
                "error": "Timed out waiting for stage (still running in background — poll stage_status)."}

    task_id = f"{project_id}_{stage}"
    if tool_name == "stage_status":
        try:
            rows = {t.get("step"): t for t in (_db.get_project_tasks(project_id) or [])}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        row = rows.get(stage)
        if row is None:
            return {"ok": False, "error": f"No task {task_id!r} yet. Submit with run_stage first."}
        try:
            active = getattr(global_queue_manager, "_active_project_id", None)
            queued = list(getattr(global_queue_manager, "_queue", []) or [])
            running = active == project_id or project_id in _queue_ids(queued)
        except Exception:
            running = False
        return {"ok": True, "task_id": task_id, "status": row.get("status"),
                "progress": row.get("progress"), "message": row.get("message"),
                "error_message": row.get("error_message"), "worker_running": running}
    # cancel_stage
    try:
        global_queue_manager.cancel_project(project_id)
        try:
            from backend.mcp.server import _notify_ui_project_event
            _notify_ui_project_event("project_updated", project_id, files_changed=False)
        except Exception:
            pass
        return {"ok": True, "task_id": task_id, "cancel_requested": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _review_frame_chat(args: dict, default_project_id: str) -> dict:
    """Same review pixels as MCP; JPEG bytes are saved to disk for the UI."""
    from backend.mcp import frames as _frames

    project_id = args.get("project_id", "") or default_project_id
    try:
        meta, jpeg = _frames.build_review(
            project_id, args.get("section_type", "scene"),
            _to_int_or_none(args.get("scene_index")),
            _to_int_or_none(args.get("cut_index")),
            args.get("scope", "cut"), args.get("mode", "auto"),
            _to_int(args.get("max_cells", 3), 3),
            scene_number=_to_int_or_none(args.get("scene_number")),
            cut_number=_to_int_or_none(args.get("cut_number")))
    except (ValueError, RuntimeError) as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"chat review_frame failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    if isinstance(meta, dict) and meta.get("ok") is False:
        return meta
    try:
        from backend.core.config import get_storage_dir
        out_dir = get_storage_dir() / project_id / "chat" / "reviews"
        out_dir.mkdir(parents=True, exist_ok=True)
        # jpeg may be bytes or an MCP Image wrapper.
        data = jpeg
        for attr in ("data", "content", "bytes"):
            if not isinstance(data, (bytes, bytearray)) and hasattr(jpeg, attr):
                try:
                    data = getattr(jpeg, attr)
                except Exception:
                    pass
        if isinstance(data, str):
            try:
                data = base64.b64decode(data)
            except Exception:
                data = data.encode("utf-8", "ignore")
        fname = f"review_{int(time.time())}.jpg"
        (out_dir / fname).write_bytes(bytes(data))
        if isinstance(meta, dict):
            meta = dict(meta)
            meta["image_path"] = str(out_dir / fname)
            meta["image_file"] = f"chat/reviews/{fname}"
        return meta if isinstance(meta, dict) else {"ok": True, "image_file": f"chat/reviews/{fname}"}
    except Exception as e:
        logger.warning(f"review_frame image persist failed: {e}")
        return meta if isinstance(meta, dict) else {"ok": True}
