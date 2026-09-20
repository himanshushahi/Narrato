"""Narrato MCP server (stdio).

Exposes the LLM-free half of the video pipeline as MCP tools. Run:

    python -m backend.mcp.server

and point any MCP client (Claude Code, Claude Desktop, opencode, …) at
that command. No LLM is ever called here and no API key is required —
the connected agent supplies all creative content.

Concurrency note: this process executes mechanical stages directly
(bypassing the desktop app's queue thread) and shares SQLite/storage
with the app via WAL. Do NOT run a stage here for a project that the
desktop app is simultaneously processing.
"""

import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# This module is imported once per MCP worker process (stdio servers spawn
# one process per agent connection). Set the opt-out BEFORE any backend
# import so the import-time logger setup skips the per-PID log file —
# otherwise every agent connection leaves an app_<pid>.log behind.
# (--http standalone mode re-enables file logging in main().)
# Guarded to direct execution: library imports (in-app host, tests) must
# not pollute the parent process environment.
if __name__ == "__main__":
    os.environ.setdefault("NARRATO_NO_FILE_LOG", "1")

sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

from backend.core import config as _config
from backend.database import db as _db
from backend.core.logger import logger
from backend.mcp import payloads

mcp = MCPServer("narrato")


# ── Projects ──────────────────────────────────────────────────────────

def _db_short_id_suffix() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


@mcp.tool()
def create_project(
    name: str,
    genre: str = "documentary",
    language: str = "hi",
    style: str = "nitish_rajput",
    duration_mode: str = "medium",
    video_format: str = "landscape",
    export_folder: str = "",
) -> dict:
    """Create a new video project. Returns the project_id used by every
    other tool. genre is the video type (e.g. documentary).

    IMPORTANT: do NOT guess when the user was vague. If the request does
    not pin down video_format (landscape/portrait/square), duration
    (short/medium/long), language, or voice, ASK the user first —
    list_voice_options gives you concrete voices to offer. Read the
    narrato://pipeline-guide resource before starting a full build."""
    if not (name or "").strip():
        return {"ok": False, "error": "name must be a non-empty string."}
    if video_format not in ("landscape", "portrait", "square"):
        return {"ok": False, "error": "video_format must be landscape, portrait or square."}
    if duration_mode not in ("short", "medium", "long", "extra_long"):
        return {"ok": False,
                "error": "duration_mode must be short, medium, long or extra_long."}
    import re
    if not re.match(r"^[a-z]{2}$", (language or "")):
        return {"ok": False, "error": "language must be a 2-letter code (hi, en, …)."}
    if not (genre or "").strip():
        return {"ok": False, "error": "genre must be a non-empty string."}
    if not (style or "").strip():
        return {"ok": False, "error": "style must be a non-empty string."}
    if export_folder:
        # Reject traversal/relative games; fail fast on unusable paths.
        normalized = str(export_folder).strip()
        if ".." in normalized.replace("\\", "/").split("/"):
            return {"ok": False, "error": "export_folder must not contain '..'."}
        try:
            Path(normalized).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return {"ok": False, "error": f"export_folder is not usable: {e}"}
        export_folder = normalized
    else:
        safe = "".join(c for c in name.strip()[:60] if c not in '<>:"/\\|?*').strip() or "untitled"
        export_folder = str(_config.get_exports_dir() / safe)
        # Same-name projects must not share an export folder.
        if Path(export_folder).exists():
            export_folder = str(_config.get_exports_dir() / f"{safe}_{_db_short_id_suffix()}")
    try:
        project_id = _db.create_project(
            name.strip(), genre or "documentary", export_folder,
            language=language or "hi", style=style or "nitish_rajput",
            duration_mode=duration_mode or "medium",
            video_format=video_format,
        )
    except Exception as e:
        logger.error(f"MCP create_project failed: {e}")
        return {"ok": False, "error": str(e)}
    (_config.get_storage_dir() / project_id).mkdir(parents=True, exist_ok=True)
    return {"ok": True, "project_id": project_id, "name": name.strip()}


@mcp.tool()
def list_projects() -> dict:
    """List all projects (id, name, status, language, updated_at)."""
    try:
        rows = _db.get_all_projects()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "projects": [
        {k: r.get(k) for k in ("id", "name", "status", "language", "duration_mode",
                               "video_format", "created_at", "updated_at")}
        for r in rows
    ]}


@mcp.tool()
def project_status(project_id: str) -> dict:
    """Full project row (no secrets — API keys live in the settings table
    and are never exposed) plus per-stage task states."""
    try:
        proj = _db.get_project(project_id)
        if not proj:
            return {"ok": False, "error": f"Project {project_id!r} not found."}
        tasks = _db.get_project_tasks(project_id)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "project": proj,
            "tasks": [{k: t.get(k) for k in ("step", "status", "progress", "message")}
                      for t in tasks]}


# ── Skills (how-to-write documentation for the agent) ─────────────────

@mcp.tool()
def list_skills() -> dict:
    """List available writing/visual guide skills (name, version,
    description). Read the relevant ones with get_skill before authoring."""
    from backend.agent.skill_loader import skill_loader
    seen: set = set()
    skills = []
    for s in skill_loader.get_all_skills().values():
        if s.name in seen:  # folder-alias duplicates (e.g. visual-director)
            continue
        seen.add(s.name)
        skills.append({"name": s.name, "version": s.version,
                       "description": s.description,
                       "when_to_use": s.when_to_use})
    return {"ok": True, "skills": skills}


@mcp.tool()
def get_skill(skill_name: str, language: str = "hi", video_format: str = "landscape",
              section: str = "", brief: bool = False) -> dict:
    """Get the full markdown guide for one skill (e.g. scriptwriter,
    visual-director-core, motion-graphics-designer, declarative-ast).
    Template variables are rendered for the given language/format.
    Big skills are ~50KB: pass brief=true for a section map first, then
    section="..." (fuzzy: title, subhead like "particles", or number)
    to pull ONE part instead of the whole file."""
    from backend.agent.skill_loader import skill_loader
    skill = skill_loader.get_skill(skill_name, context="tool")
    if not skill:
        return {"ok": False, "error": f"Skill {skill_name!r} not found. Use list_skills."}
    ctx = {"language": language, "video_format": video_format}
    if brief:
        out = skill.brief(**ctx)
        out.update({"ok": True, "brief": True,
                    "hint": "Pull one part with get_skill(section=\"...\")."})
        return out
    if section:
        found = skill.render_section(section, **ctx)
        if not found:
            titles = [s["title"] for s in
                      skill.brief(**ctx)["sections"]]
            return {"ok": False,
                    "error": f"No section matching {section!r} in {skill.name}.",
                    "available_sections": titles}
        return {"ok": True, "name": skill.name, "version": skill.version,
                "section": found["title"],
                **({"matched_subhead": found["matched_subhead"]}
                   if "matched_subhead" in found else {}),
                "content": f"## {found['title']}\n\n{found['body']}",
                "remaining_sections": found["remaining"]}
    content = skill.render(**ctx)
    return {"ok": True, "name": skill.name, "version": skill.version,
            "content": content,
            "sections": [s["title"] for s in skill.brief(**ctx)["sections"]],
            "brief_hint": "This skill is large — next time pass brief=true "
                          "for a section map, or section=\"...\" for one part."}


# ── Script (agent-authored, server-validated) ─────────────────────────

@mcp.tool()
def save_script(project_id: str, script: dict) -> dict:
    """Validate and persist a complete video script.

    script = {title, introduction: {hook}, scenes: [{title, narration}],
              conclusion: {summary, cta?}}. All prose MUST already be in the
    project's language. Sub-visuals are reset to empty; downstream
    artifacts (voiceover, transcription, assets, design) are purged and the
    pipeline stage resets to post-script.
    """
    try:
        return payloads.save_script_payload(project_id, script)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP save_script failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def get_script(project_id: str, include_visuals: bool = False) -> dict:
    """Read back script.json. Sub-visual ASTs are stripped by default to
    save context; pass include_visuals=true to inspect them."""
    try:
        proj_dir = payloads._project_dir(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {"ok": False, "error": "script.json not found. Use save_script first."}
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
    except Exception as e:
        return {"ok": False, "error": f"Could not read script.json: {e}"}
    return {"ok": True, "project_id": project_id,
            "script": payloads.strip_script_for_agent(script, include_visuals)}


# ── Design system (agent-authored, server-validated) ──────────────────

@mcp.tool()
def save_design(project_id: str, design: dict) -> dict:
    """Validate and persist the global design system
    ({theme_name, color_palette, typography, css_guidelines, fonts?}).
    Required before save_visuals so cuts bind to a design hash."""
    try:
        return payloads.save_design_payload(project_id, design)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP save_design failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ── Mechanical stages (executed here, no LLM) ─────────────────────────

_STAGE_RUNNERS = {
    "generate_voiceover": ("backend.pipeline.tts", "generate_voiceover_pipeline", False),
    "transcribe": ("backend.pipeline.transcribe", "transcribe_pipeline", False),
    "fetch_assets": ("backend.pipeline.assets", "fetch_assets_pipeline", False),
    "render": ("backend.pipeline.render", "render_pipeline", True),
}

# Background submissions from run_stage(wait=False), keyed by task_id.
# A small pool so two agents/clients cannot oversubscribe ffmpeg/whisper.
_STAGE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mcp-stage")
_STAGE_FUTURES = {}
_STAGE_CANCEL = {}
_STAGE_LOCK = threading.Lock()


def _project_active_stage(project_id: str) -> str | None:
    """Task id of the project-wide in-flight MCP stage, if any.

    Stages on one project are strictly serialized: concurrent manifest/DB
    writers corrupt each other. Must be called with _STAGE_LOCK held.
    Finished pool futures are purged here so the registry stays bounded
    (covers the submit/callback micro-race too).
    """
    prefix = f"{project_id}_"
    for task_id, future in list(_STAGE_FUTURES.items()):
        if hasattr(future, "done") and future.done():
            _STAGE_FUTURES.pop(task_id, None)
            continue
        # Unfinished futures AND inline wait=true markers (plain objects
        # without .done) both mean the project is busy.
        if task_id == project_id or task_id.startswith(prefix):
            return task_id
    return None


def _future_running(task_id: str) -> bool:
    """True when a tracked worker/marker for task_id is still active."""
    with _STAGE_LOCK:
        future = _STAGE_FUTURES.get(task_id)
    if future is None:
        return False
    return not (hasattr(future, "done") and future.done())


def _fail_task_row(project_id: str, stage: str, error: str) -> None:
    """Best-effort failed marking for pre-execution failures (missing
    project, bad path, unimportable runner). Never raises — the worker
    must always leave a visible task row instead of a stuck 'running'."""
    task_id = f"{project_id}_{stage}"
    try:
        _db.create_task(project_id, stage)
    except Exception:
        pass
    try:
        _db.update_task(task_id, status="failed", error_message=str(error)[:500],
                        message=f"Failed: {str(error)[:80]}")
    except Exception:
        pass
    try:
        _db.update_project(project_id, status="failed")
    except Exception:
        pass


def _maybe_complete_project(project_id: str) -> None:
    """Mark the project completed only when every known stage is completed.
    A single stage finishing must not claim the whole project is done."""
    try:
        tasks = _db.get_project_tasks(project_id) or []
    except Exception:
        return
    if tasks and all(t.get("status") == "completed" for t in tasks):
        try:
            _db.update_project(project_id, status="completed")
        except Exception:
            pass


def _execute_stage_blocking(project_id: str, stage: str) -> dict:
    """Run one mechanical stage to completion, mirroring queue-worker DB
    bookkeeping (running → completed/failed + project status)."""
    task_id = f"{project_id}_{stage}"
    try:
        proj = _db.get_project(project_id)
        if not proj:
            raise ValueError(f"Project {project_id!r} not found in database.")
        proj_dir = payloads._project_dir(project_id)
    except Exception as e:
        _fail_task_row(project_id, stage, e)
        return {"ok": False, "error": str(e), "stage": stage}
    cancel_event = threading.Event()
    with _STAGE_LOCK:
        _STAGE_CANCEL[task_id] = cancel_event
    try:
        return _run_stage_inner(project_id, stage, task_id, proj, proj_dir, cancel_event)
    finally:
        with _STAGE_LOCK:
            _STAGE_CANCEL.pop(task_id, None)


def _run_stage_inner(project_id: str, stage: str, task_id: str,
                     proj: dict, proj_dir, cancel_event: threading.Event) -> dict:
    module_name, func_name, takes_force = _STAGE_RUNNERS[stage]
    try:
        import importlib
        runner = getattr(importlib.import_module(module_name), func_name)
    except Exception as e:
        _fail_task_row(project_id, stage, f"Could not load stage runner: {e}")
        return {"ok": False, "error": f"Could not load stage runner: {e}",
                "stage": stage}

    def _progress(pct, msg=None):
        try:
            _db.update_task(task_id, progress=float(pct))
        except Exception:
            pass

    try:
        _db.create_task(project_id, stage)
        _db.update_task(task_id, status="running", progress=0.0, message="Starting (MCP)...")
        _db.update_project(project_id, status="processing")
    except Exception as e:
        # Bookkeeping itself failed (DB locked/gone): fail loudly instead
        # of running a stage no task row tracks — otherwise wait=false
        # leaves a stuck 'running' ghost with an unobserved exception.
        _fail_task_row(project_id, stage, f"Stage bookkeeping failed: {e}")
        return {"ok": False, "error": f"Stage bookkeeping failed: {e}",
                "stage": stage}
    try:
        kwargs = {"force": False} if takes_force else {}
        runner(proj, proj_dir, _progress, cancel_event, **kwargs)
    except InterruptedError:
        logger.warning(f"MCP run_stage {stage} cancelled for {project_id}.")
        _db.update_task(task_id, status="failed", progress=0.0,
                        error_message="Stage cancelled via MCP.",
                        message="Cancelled")
        _db.update_project(project_id, status="cancelled")
        return {"ok": False, "error": "Stage cancelled.", "stage": stage,
                "cancelled": True}
    except Exception as e:
        logger.error(f"MCP run_stage {stage} failed for {project_id}: {e}", exc_info=True)
        _db.update_task(task_id, status="failed", error_message=str(e),
                        message=f"Failed: {str(e)[:80]}")
        _db.update_project(project_id, status="failed")
        return {"ok": False, "error": str(e), "stage": stage}
    _db.update_task(task_id, status="completed", progress=100.0, message="Step completed (MCP).")
    _maybe_complete_project(project_id)
    result: dict = {"ok": True, "project_id": project_id, "stage": stage}
    if stage == "render":
        fresh = _db.get_project(project_id) or {}
        result["video_path"] = fresh.get("video_path")
    return result


@mcp.tool()
def run_stage(project_id: str, stage: str, wait: bool = True,
              confirm_render: bool = False) -> dict:
    """Execute one mechanical pipeline stage: generate_voiceover →
    transcribe → fetch_assets → render (in that order; run
    get_section_timings + save_visuals between transcribe and
    fetch_assets).

    wait=true (default) blocks until the stage finishes — fine over
    stdio, but HTTP clients should pass wait=false for long stages and
    poll stage_status instead (voiceover/render can take many minutes).

    HUMAN REVIEW GATE: the render stage is refused unless confirm_render
    is true. Default flow is build everything through fetch_assets, then
    STOP and ask the user to review/edit in the app — only re-call with
    confirm_render=true after the user explicitly approves the final
    render. The desktop app's own render path is unaffected.
    """
    stage = (stage or "").strip().lower()
    if stage not in _STAGE_RUNNERS:
        return {"ok": False,
                "error": f"stage must be one of {sorted(_STAGE_RUNNERS)}."}
    if stage == "render" and not confirm_render:
        return {"ok": False, "stage": stage, "needs_confirmation": True,
                "error": (
                    "Render is gated by human review. Do NOT render yet. "
                    "Instead: (1) confirm fetch_assets completed, "
                    "(2) summarize the build for the user (title, scenes, "
                    "voice, design, review_frame highlights), "
                    "(3) ask them to review/edit in the app, and "
                    "(4) only re-call run_stage(render) with confirm_render=true "
                    "after they explicitly approve.")}
    try:
        if not _db.get_project(project_id):
            return {"ok": False, "error": f"Project {project_id!r} not found."}
        payloads._project_dir(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    task_id = f"{project_id}_{stage}"
    with _STAGE_LOCK:
        active = _project_active_stage(project_id)
        if active is not None:
            return {"ok": False, "task_id": task_id,
                    "error": f"Project {project_id!r} already has a running MCP stage "
                             f"({active}); wait for it or cancel_stage it first. "
                             f"Concurrent stages corrupt manifests."}
        if not wait:
            future = _STAGE_POOL.submit(
                _execute_stage_blocking, project_id, stage)

            def _forget_done(fut, _task_id=task_id):
                # Completed pool futures serve no further purpose
                # (stage_status reads the DB task row); drop them so the
                # registry does not grow without bound.
                with _STAGE_LOCK:
                    if _STAGE_FUTURES.get(_task_id) is fut:
                        _STAGE_FUTURES.pop(_task_id, None)
            future.add_done_callback(_forget_done)
            _STAGE_FUTURES[task_id] = future
            return {"ok": True, "accepted": True, "task_id": task_id,
                    "status": "submitted",
                    "hint": "Poll stage_status until status is completed/failed."}
        # wait=true executes inline but still registers, so a concurrent
        # wait=false submission sees it and vice versa.
        _executing_marker = object()
        _STAGE_FUTURES[task_id] = _executing_marker  # type: ignore[assignment]
    try:
        return _execute_stage_blocking(project_id, stage)
    except Exception as e:
        logger.error(f"MCP run_stage {stage} failed for {project_id}: {e}", exc_info=True)
        return {"ok": False, "error": str(e), "stage": stage}
    finally:
        with _STAGE_LOCK:
            _STAGE_FUTURES.pop(task_id, None)


@mcp.tool()
def stage_status(project_id: str, stage: str) -> dict:
    """Poll a stage submitted with run_stage(wait=false). Returns the task
    row (status/progress/message); background-accepted submissions also
    report whether the worker is still running."""
    stage = (stage or "").strip().lower()
    if stage not in _STAGE_RUNNERS:
        return {"ok": False,
                "error": f"stage must be one of {sorted(_STAGE_RUNNERS)}."}
    task_id = f"{project_id}_{stage}"
    try:
        tasks = {t.get("step"): t for t in (_db.get_project_tasks(project_id) or [])}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    row = tasks.get(stage)
    if row is None:
        return {"ok": False, "error": f"No task {task_id!r} yet. Submit with run_stage first."}
    running = _future_running(task_id)
    return {"ok": True, "task_id": task_id,
            "status": row.get("status"), "progress": row.get("progress"),
            "message": row.get("message"),
            "error_message": row.get("error_message"),
            "worker_running": running}


@mcp.tool()
def cancel_stage(project_id: str, stage: str) -> dict:
    """Signal a running MCP-submitted stage to stop at the next safe
    checkpoint. The worker marks the task cancelled; poll stage_status
    to confirm. Stages started by the desktop app are not affected."""
    stage = (stage or "").strip().lower()
    if stage not in _STAGE_RUNNERS:
        return {"ok": False,
                "error": f"stage must be one of {sorted(_STAGE_RUNNERS)}."}
    task_id = f"{project_id}_{stage}"
    with _STAGE_LOCK:
        event = _STAGE_CANCEL.get(task_id)
    worker_running = _future_running(task_id)
    if event is None and not worker_running:
        return {"ok": False, "error": f"No running MCP stage {task_id!r} to cancel."}
    if event is not None:
        event.set()
    try:
        _db.update_task(task_id, message="Cancelling (MCP)...")
    except Exception:
        pass
    return {"ok": True, "task_id": task_id, "cancel_requested": True,
            "worker_running": worker_running}


# ── Project settings, deletion, research & inspection ────────────────

@mcp.tool()
def update_voice_settings(project_id: str, settings: dict) -> dict:
    """Change voice/audio columns (tts_engine, tts_voice, tts_speed,
    tts_pitch, bg_music_volume). Voiceover/transcribe/render reset to
    pending (new audio); visuals/assets are untouched (narration
    unchanged). tts_voice for engine 'edge' must be a Neural name like
    'hi-IN-SwaraNeural'; cloning engines take a profile id."""
    try:
        return payloads.update_voice_settings(project_id, settings)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP update_voice_settings failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def update_transcribe_settings(project_id: str, settings: dict) -> dict:
    """Change transcription columns (whisper_model, whisper_device).
    Transcribe + render reset to pending (new timings); voiceover/assets
    untouched. Unknown model names are rejected — the response also tells
    you whether the model is downloaded yet."""
    try:
        return payloads.update_transcribe_settings(project_id, settings)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP update_transcribe_settings failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool(annotations=ToolAnnotations(destructiveHint=True))
def delete_project(project_id: str) -> dict:
    """Permanently delete a project: DB row + tasks + its storage folder.
    Cannot be undone. Refused while an MCP stage is running on the project
    (wiping storage under a live writer corrupts both)."""
    with _STAGE_LOCK:
        active = _project_active_stage(project_id)
    if active is not None:
        return {"ok": False,
                "error": f"Project {project_id!r} has a running MCP stage ({active}); "
                         f"cancel_stage it first, then delete."}
    try:
        return payloads.delete_project_payload(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP delete_project failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


_SEARCH_SOURCES = ("pexels_photo", "pexels_video", "wikipedia_image",
                   "pixabay_photo", "pixabay_video", "youtube_video")


@mcp.tool()
def search_media(source: str, query: str, orientation: str = "landscape") -> dict:
    """Check stock media availability BEFORE writing a query into a cut.
    Queries MUST be in English. API keys stay server-side; only results
    are returned. youtube_video verifies a match exists for the query."""
    if source not in _SEARCH_SOURCES:
        return {"ok": False, "error": f"source must be one of {list(_SEARCH_SOURCES)}."}
    if not (query or "").strip():
        return {"ok": False, "error": "query must be a non-empty string."}
    try:
        from backend.agent.tools import execute_tool as _run_internal_tool
        result = _run_internal_tool(f"search_{source}",
                                    {"query": query.strip(), "orientation": orientation})
    except Exception as e:
        logger.error(f"MCP search_media failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    if isinstance(result, str) and result.startswith("Error"):
        return {"ok": False, "error": result}
    return {"ok": True, "source": source, "query": query.strip(), "result": result}


@mcp.tool()
def web_search(query: str, count: int = 3) -> dict:
    """Research facts for script writing (needs the web-search API key
    configured in app Settings; otherwise returns an explanatory error)."""
    if not (query or "").strip():
        return {"ok": False, "error": "query must be a non-empty string."}
    try:
        from backend.agent.tools import execute_tool as _run_internal_tool
        result = _run_internal_tool("web_search", {"query": query.strip(), "count": count})
    except Exception as e:
        logger.error(f"MCP web_search failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    if isinstance(result, str) and result.startswith("Error"):
        return {"ok": False, "error": result}
    return {"ok": True, "query": query.strip(), "result": result}


@mcp.tool()
def list_project_files(project_id: str) -> dict:
    """List files inside a project's folder (relative paths + sizes) —
    see what voiceover segments, assets, and manifests actually exist."""
    try:
        return payloads.list_project_files_payload(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP list_project_files failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def read_project_file(project_id: str, path: str) -> dict:
    """Read a text artifact (script/manifest/transcription/log, capped).
    Binary media returns size info only. Paths cannot escape the project
    folder."""
    try:
        return payloads.read_project_file_payload(project_id, path)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP read_project_file failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def list_voice_options() -> dict:
    """Voices/engines to OFFER THE USER before generating voiceover —
    always ask instead of silently using defaults. Returns engine
    descriptions, per-language Edge suggestions, configured clone
    profiles, and current global defaults."""
    try:
        return payloads.list_voice_options()
    except Exception as e:
        logger.error(f"MCP list_voice_options failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ── Guide resource + build prompt (agent context) ────────────────────

@mcp.resource("narrato://pipeline-guide", name="pipeline-guide",
              description="End-to-end Narrato build workflow: stage order, "
                          "clarification rules, and quality gotchas.",
              mime_type="text/markdown")
def pipeline_guide() -> str:
    """Canonical workflow every agent must follow for a full build."""
    return """# Narrato MCP build guide

## Before create_project — clarify, don't guess
If the user did not specify any of these, ASK (offer the listed options):
- video_format: landscape (16:9 YouTube) | portrait (9:16 Shorts/Reels) | square (1:1).
  "Short video" usually means portrait + duration short — confirm.
- duration_mode: short (~60s) | medium (~5min landscape / 90s portrait) | long (~10min).
- language: hi (Hindi, Devanagari prose) | en (English). Spoken text MUST be
  in the project's language; Image/Video search queries MUST be in English.
- voice: call list_voice_options and offer engines + voices. NEVER silently
  default — the voice defines the video.

## Stage order (strict)
1. create_project → project_id
2. get_skill(scriptwriter) → save_script (intro hook, scenes with narration,
   conclusion summary+cta; sub_visuals reset automatically)
3. update_voice_settings (only if user chose non-default voice)
4. run_stage(generate_voiceover, wait=false) → stage_status until completed
5. run_stage(transcribe, wait=true is fine) → word timings ready.
   If it fails with "model ... is not downloaded", use
   update_transcribe_settings (whisper_model must be downloaded) and retry.
   Never edit the DB by hand.
6. Skills brief-first (they are big — declarative-ast is ~50KB, and a
   truncated skill is worse than none): get_skill(NAME, brief=true) for
   visual-director-core + motion-graphics-designer + declarative-ast, then
   pull ONLY the sections you need via get_skill(NAME, section="...").
   Required reading: declarative-ast §5 archetypes (your template library —
   motion-graphics card geometries alone are NOT enough variety for a
   whole video) + the motion/FX sections. Rules you must not skim past:
   LayerBox %-only geometry, one Particles layer per cut max (last child),
   no chapter title cards inside cuts.
7. get_section_timings (TRUE audio durations + word timestamps per section)
8. save_design (required once — cuts bind to its hash). A palette-only
   design (theme + colors + fonts, nothing else) guarantees a flat video:
   include motion language — signature transitions, text treatments,
   overlay/texture direction — or the server will warn you.
9. search_media to verify each English query resolves BEFORE writing the cut
10. save_visuals per section (durations auto-normalize to the audio
    length; exactly ONE Particles layer per cut max, as LAST child; no chapter
    title cards inside cuts; Text in English except subtitles).
    VARIETY CONTRACT (enforced by review, not by validation — the server
    accepts valid-but-boring output, so YOU must not produce it):
    - No identical layer-template more than 2 cuts in a row; vary card
      geometry, background treatment, and text animation_mode per beat.
    - Use at least 5 of the 11 content kinds per video (Image, Video, Text,
      Chart, Shape, Map, HTML, Lottie, Particles, Counter, Background) wherever the story allows.
    - Every section needs at least one energy moment: emphasis punch-in,
      camera_shake, motion_blur, an FX filter (emboss/sharpen/posterize/
      duotone/thermal), rack-focus blur/brightness keyframes, or a
      Particles overlay matched to the beat's emotion.
    - Cycle transitions deliberately (whip_pan/glitch for shock beats,
      dissolve for time jumps) — never the same 2–3 on rotation.
    - Always pair entrance animations (translateY, translateX, scale, rotate)
      with a simultaneous opacity fade ({property: "opacity", from: 0, to: 1, ...})
      so elements fade into view smoothly instead of abruptly popping in while moving.
    The save_visuals response reports variety stats + normalizations:
    read them and fix flat spots BEFORE moving on.
10b. review_frame per section (mode=composition) to verify exact pre-render
    pixels — MANDATORY, not optional. After each contact sheet, state what
    you changed (or what you verified as good); fix bad cuts via
    save_visuals(cut_index=N), or trial first with
    save_visuals(dry_run=true) which validates without writing. A section
    is done only after a review pass with named fixes — never first-pass.
11. run_stage(fetch_assets, wait=false) → stage_status
12. STOP. Do not render. Summarize the build (title, scene count, voice,
    design, review_frame highlights) and ask the user to review/edit in
    the app. Only after explicit approval: run_stage(render,
    confirm_render=true) → stage_status → video_path.
    (review_frame on the mp4 for the final check)

## Gotchas
- Durations: sub_visuals durations MUST sum to the section audio duration
  (the server normalizes, but gross mismatches mean mistimed visuals).
- Opacity fade: ALWAYS pair entrance animations (translateY, translateX, scale, etc.)
  with a simultaneous opacity fade ({property: "opacity", from: 0, to: 1, ...})
  so elements fade into view smoothly instead of abruptly popping in while moving.
- generate_visuals is NOT an MCP stage — YOU author visuals via save_visuals.
- run_stage(wait=true) blocks; over HTTP always use wait=false + stage_status
  for voiceover/fetch_assets/render (minutes long).
- project_status shows DB + per-stage states; list/read_project_files inspects disk.
"""


@mcp.prompt(name="make_video",
            description="Guided full-build workflow: clarify options, then "
                        "drive the Narrato pipeline stage by stage.")
def make_video_prompt(topic: str) -> str:
    """Starter prompt for a full video build on a user-supplied topic."""
    return (
        f"Build a Narrato video about: {topic}\n\n"
        "Follow the narrato://pipeline-guide resource exactly. "
        "First: if video format, duration, language, or voice are not specified, "
        "ASK the user (use list_voice_options for concrete voice choices) — "
        "do not guess landscape or default voices. Drive every stage through "
        "fetch_assets, verifying with project_status — then STOP, present a "
        "review summary, and ask the user to review/edit in the app. "
        "Only render after explicit approval "
        "(run_stage(render, confirm_render=true))."
    )


@mcp.tool()
def review_frame(project_id: str, section_type: str = "scene", scene_index: int = 0,
                 cut_index: int = 0, scope: str = "cut",
                 mode: str = "auto", max_cells: int = 3) -> object:
    """Snapshot WHAT the video looks like as ONE contact-sheet image.

    scope=cut: start/mid/end of one cut (motion in one glance).
    scope=section: mid-frame of each cut (scene progression, subsampled
    to max_cells). mode=auto prefers exact rendered pixels, else the
    pre-render asset lineup; mode=composition renders exact pre-render
    composition pixels headlessly (seconds per call, cached — the truth
    check before render); procedural (text-only) cuts report that
    explicitly. Returns metadata + a single JPEG (strip or grid).
    """
    try:
        from backend.mcp import frames as _frames
        from mcp.server.mcpserver.utilities.types import Image as _Image
        meta, jpeg = _frames.build_review(project_id, section_type, scene_index,
                                          cut_index, scope, mode, max_cells)
        return meta, _Image(data=jpeg, format="jpeg")
    except (ValueError, RuntimeError) as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP review_frame failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


# ── Visuals (agent-authored, server-validated) ────────────────────────

@mcp.tool()
def get_section_timings(project_id: str, include_words: bool = True) -> dict:
    """Per-section narration + TRUE audio durations (+ word timestamps)
    from the voiceover manifest. Author each section's sub_visuals so
    durations sum to the reported duration. Run after transcribe."""
    try:
        return payloads.get_section_timings(project_id, include_words)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP get_section_timings failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def save_visuals(project_id: str, section_type: str, sub_visuals: list,
                 scene_index: int = 0, cut_index: int = -1,
                 dry_run: bool = False) -> dict:
    """Validate and persist sub_visuals for ONE section
    (section_type: introduction | scene | conclusion; scene_index used
    only for scene). Durations are auto-normalized to the section's audio
    length; Image/Video layers MUST carry an English search `query`.
    Repeat per section, then run fetch_assets.

    cut_index >= 0 patches a SINGLE cut (pass sub_visuals as a 1-element
    array holding just that cut) instead of resending the whole section —
    use after review_frame flags one bad cut. dry_run=true validates and
    returns the normalized result WITHOUT writing anything.
    The response ALWAYS includes variety stats + normalizations — read
    them: fix template repetition and flat (effect-free) sections before
    moving on. Richness rules live in the pipeline-guide variety contract
    and the declarative-ast archetypes, not in this description."""
    try:
        return payloads.save_visuals_payload(
            project_id, section_type, sub_visuals, scene_index,
            cut_index=cut_index if cut_index is not None and cut_index >= 0 else None,
            dry_run=bool(dry_run))
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP save_visuals failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


def main(argv=None) -> None:
    """Serve Narrato MCP over stdio (default) or localhost HTTP.

    HTTP mode: ``python -m backend.mcp.server --http [--port 8765]``
    then point any MCP client at ``http://127.0.0.1:8765/mcp``.
    The socket is pinned to loopback on purpose: these tools execute
    ffmpeg/TTS and read project files, so the endpoint must never be
    exposed to a network.
    """
    import argparse
    parser = argparse.ArgumentParser(prog="narrato-mcp",
                                     description="Narrato MCP server (LLM-free pipeline tools).")
    parser.add_argument("--http", action="store_true",
                        help="Serve Streamable HTTP on 127.0.0.1 instead of stdio.")
    parser.add_argument("--port", type=int, default=8765,
                        help="Localhost port for --http (default: 8765).")
    args = parser.parse_args(argv)
    if args.http:
        from backend.core.logger import enable_file_logging
        enable_file_logging()  # single long-lived process: keep its log file
        logger.info(f"Starting Narrato MCP server on http://127.0.0.1:{args.port}/mcp.")
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.port)
    else:
        # stdio: stdout is the JSON-RPC transport — no log files, no stdout
        # logging (one process per agent connection would pile app_<pid>.log).
        from backend.core.logger import configure_stdio_worker
        configure_stdio_worker()
        logger.info("Starting Narrato MCP server (stdio).")
        mcp.run()


if __name__ == "__main__":
    main()
