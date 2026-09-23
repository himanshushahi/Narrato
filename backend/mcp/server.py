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

from typing import Annotated, Literal
from pydantic import Field

from backend.core import config as _config
from backend.database import db as _db
from backend.core.logger import logger
from backend.mcp import payloads

NARRATO_SERVER_INSTRUCTIONS = """You are connected to Narrato, an automated documentary and video production system.

MANDATORY PROJECT INTAKE PROTOCOL:
When the user asks to create or make a video, you MUST NOT immediately invoke `create_project` with assumed, guessed, or default values.
Instead, you MUST conduct the "New Narrative Build" intake interview and ask the user every project question matching the app's creation modal (unless already explicitly provided by the user):

1. Narrative Topic / Name: Confirm the exact title or subject.
2. Video Style / Genre: Present the 8 available styles and ask which one they prefer:
   - Documentary & Geopolitics (Ken Burns, Maps, Cinematic) [`documentary`]
   - Tech & SaaS Explainer (Vector Graphics, Fast, Neon) [`explainer`]
   - Finance & Market Analysis (Charts, Metrics, Tickers) [`finance`]
   - Vox-Style Editorial (Typography, Yellow/Black, Collage) [`vox`]
   - News/Journalism (Split Screens, Lower Thirds) [`news`]
   - True Crime / Mystery (Redacted Memos, Shockwave) [`true_crime`]
   - Personal Story (Portraits, Warm, Soft) [`storytime`]
   - Viral Short-Form (Fast Cuts, Kinetic Words, Punchy) [`viral_short`]
3. Language:
   - Hindi (हिंदी) [`hi`] (narration written in Devanagari Hindi prose)
   - English (EN) [`en`]
4. Video Format:
   - Landscape (YouTube 16:9) [`landscape`]
   - Portrait (Reels/Shorts 9:16) [`portrait`]
5. Duration Mode (recommend based on format):
   - For Landscape: Medium (~5m), Long (~10m), or Extra Long (~15m)
   - For Portrait: Short (~60s), Medium (~90s), or Long (~2m)
6. Export Destination Folder: Confirm if the user wants a specific directory or default project exports folder.
7. Voice: Call `list_voice_options` to offer concrete voice choices (set with `update_voice_settings`).

ONLY after the user confirms these preferences (or if already explicitly specified), invoke `create_project`.
"""

mcp = MCPServer("narrato", instructions=NARRATO_SERVER_INSTRUCTIONS)


# ── Projects ──────────────────────────────────────────────────────────

def _db_short_id_suffix() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


GenreType = Literal[
    "documentary",
    "explainer",
    "finance",
    "vox",
    "news",
    "true_crime",
    "storytime",
    "viral_short",
]
LanguageType = Literal["hi", "en"]
VideoFormatType = Literal["landscape", "portrait"]
DurationModeType = Literal["short", "medium", "long", "extra_long"]


@mcp.tool()
def create_project(
    name: Annotated[
        str,
        Field(description="Narrative Topic / Name (e.g. 'The Rise and Fall of Rome', 'How Bitcoin Works')"),
    ],
    genre: Annotated[
        GenreType,
        Field(
            ...,
            description=(
                "Video Style / Genre. MANDATORY: Ask user first! Options: "
                "documentary (Documentary & Geopolitics: Ken Burns, Maps, Cinematic), "
                "explainer (Tech & SaaS Explainer: Vector Graphics, Fast, Neon), "
                "finance (Finance & Market Analysis: Charts, Metrics, Tickers), "
                "vox (Vox-Style Editorial: Typography, Yellow/Black, Collage), "
                "news (News/Journalism: Split Screens, Lower Thirds), "
                "true_crime (True Crime / Mystery: Redacted Memos, Shockwave), "
                "storytime (Personal Story: Portraits, Warm, Soft), "
                "viral_short (Viral Short-Form: Fast Cuts, Kinetic Words, Punchy)."
            ),
        ),
    ] = ...,
    language: Annotated[
        LanguageType,
        Field(
            ...,
            description="Language code: 'hi' (Hindi / हिंदी) or 'en' (English). MANDATORY: Ask user first!",
        ),
    ] = ...,
    video_format: Annotated[
        VideoFormatType,
        Field(
            ...,
            description="Video Format: 'landscape' (YouTube 16:9) or 'portrait' (Reels/Shorts 9:16). MANDATORY: Ask user first!",
        ),
    ] = ...,
    duration_mode: Annotated[
        DurationModeType,
        Field(
            ...,
            description=(
                "Duration Mode. MANDATORY: Ask user first! "
                "For landscape: 'medium' (~5m), 'long' (~10m), 'extra_long' (~15m). "
                "For portrait: 'short' (~60s), 'medium' (~90s), 'long' (~2m)."
            ),
        ),
    ] = ...,
    export_folder: Annotated[
        str,
        Field(
            default="",
            description="Export destination folder path. Leave empty to use default exports folder.",
        ),
    ] = "",
    style: Annotated[
        str,
        Field(
            default="nitish_rajput",
            description="Visual design style preset (default: 'nitish_rajput').",
        ),
    ] = "nitish_rajput",
) -> dict:
    """Create a new video project. Returns the project_id used by every
    other tool.

    MANDATORY INTAKE RULE - ASK BEFORE CALLING:
    Do NOT call this tool with guessed or silent default values.
    Before invoking create_project, you MUST ask the user all questions
    matching the app's 'New Narrative Build' modal (unless already specified):
    1. Topic / Name: Confirm the narrative topic or title.
    2. Video Style / Genre: Offer the 8 styles (documentary, explainer,
       finance, vox, news, true_crime, storytime, viral_short).
    3. Language: 'hi' (Hindi) or 'en' (English).
    4. Video Format: 'landscape' (YouTube 16:9) or 'portrait' (Reels/Shorts 9:16).
    5. Duration Mode: 'short', 'medium', 'long', 'extra_long' (matched to format).
    6. Export Destination Folder: Confirm custom path or default exports dir.
    7. Voice: Offer choices via list_voice_options.

    Read the narrato://pipeline-guide resource before starting a full build."""
    # Required intake fields: Ellipsis/None means the agent skipped the
    # mandatory interview — fail fast instead of silently defaulting.
    # (MCP schema already marks these required; this covers direct callers.)
    if genre is ... or genre is None:
        return {"ok": False, "error": "genre is required — ask the user (documentary, explainer, finance, vox, news, true_crime, storytime, viral_short)."}
    if language is ... or language is None:
        return {"ok": False, "error": "language is required — ask the user (hi, en)."}
    if video_format is ... or video_format is None:
        return {"ok": False, "error": "video_format is required — ask the user (landscape, portrait)."}
    if duration_mode is ... or duration_mode is None:
        return {"ok": False, "error": "duration_mode is required — ask the user (short, medium, long, extra_long)."}
    if export_folder is ... or export_folder is None:
        export_folder = ""
    if style is ... or style is None:
        style = "nitish_rajput"

    _ALLOWED_GENRES = ("documentary", "explainer", "finance", "vox",
                       "news", "true_crime", "storytime", "viral_short")

    if not (name or "").strip():
        return {"ok": False, "error": "name must be a non-empty string."}
    if video_format not in ("landscape", "portrait"):
        return {"ok": False, "error": "video_format must be landscape or portrait."}
    if duration_mode not in ("short", "medium", "long", "extra_long"):
        return {"ok": False,
                "error": "duration_mode must be short, medium, long or extra_long."}
    if language not in ("hi", "en"):
        return {"ok": False, "error": "language must be 'hi' or 'en'."}
    if genre not in _ALLOWED_GENRES:
        return {"ok": False,
                "error": f"genre must be one of {list(_ALLOWED_GENRES)}."}
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
    """**FOR MCP EXTERNAL AGENT ONLY.** Get the full markdown guide for one skill (e.g. scriptwriter,
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
    get_section_timings + save_design + save_visuals between transcribe and
    fetch_assets, and review_frame(mode=composition) AFTER fetch_assets).

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
                    "(2) run review_frame(mode=composition) per section and fix bad cuts "
                    "(re-fetch if a fix adds a new query), "
                    "(3) summarize the build for the user (title, scenes, "
                    "voice, design, review_frame highlights), "
                    "(4) ask them to review/edit in the app, and "
                    "(5) only re-call run_stage(render) with confirm_render=true "
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
    """**FOR MCP EXTERNAL AGENT ONLY — INTERNAL APP LLM IGNORE.** Check stock media availability BEFORE writing a query into a cut.
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
    """**FOR MCP EXTERNAL AGENT ONLY — INTERNAL APP LLM IGNORE.** Research facts for script writing (needs the web-search API key
    configured in app Settings; otherwise returns an explanatory error).

    If you already have your own native web search tool, please use your own search first as it is generally more capable.
    Only use this MCP web_search tool as a fallback if your native search
    is unavailable or fails."""
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
def read_project_file(project_id: str, path: str, offset: int = 0) -> dict:
    """Read a text artifact (script/manifest/transcription/log, capped).
    Pass offset to paginate through large files. Binary media returns size
    info only. Paths cannot escape the project folder."""
    try:
        return payloads.read_project_file_payload(project_id, path, offset=offset)
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
You MUST interview the user and ASK every question corresponding to the
app's 'New Narrative Build' form before calling `create_project` (unless
already explicitly specified in the user's request):
1. Narrative Topic / Name: Confirm the core video topic or title.
2. Video Style / Genre: Offer the 8 specific genre presets:
   - documentary: Documentary & Geopolitics (Ken Burns, Maps, Cinematic)
   - explainer: Tech & SaaS Explainer (Vector Graphics, Fast, Neon)
   - finance: Finance & Market Analysis (Charts, Metrics, Tickers)
   - vox: Vox-Style Editorial (Typography, Yellow/Black, Collage)
   - news: News/Journalism (Split Screens, Lower Thirds)
   - true_crime: True Crime / Mystery (Redacted Memos, Shockwave)
   - storytime: Personal Story (Portraits, Warm, Soft)
   - viral_short: Viral Short-Form (Fast Cuts, Kinetic Words, Punchy)
3. Language:
   - hi: Hindi (Devanagari prose for voiceover)
   - en: English
4. Video Format:
   - landscape: 16:9 YouTube video
   - portrait: 9:16 Shorts/Reels/TikTok
5. Duration Mode (recommend based on format):
   - For landscape: medium (~5m) | long (~10m) | extra_long (~15m)
   - For portrait: short (~60s) | medium (~90s) | long (~2m)
6. Export Destination Folder: Confirm if user wants a specific path or the default exports directory.
7. Voice: Call list_voice_options and offer engines + voices. NEVER silently
   default — the voice defines the video.

## Stage order (strict)
1. create_project → project_id
2. Research & script writing:
    - ⚠️ **FOR MCP EXTERNAL AGENT ONLY — INTERNAL APP LLM IGNORE:** If you have your own native web search tool, USE THAT FIRST to research
      facts, dates, and background for the topic. Only fall back to this MCP
      web_search tool if your native search is unavailable or fails.
    - get_skill(scriptwriter) → save_script (intro hook, scenes with narration,
      conclusion summary+cta; sub_visuals reset automatically)
3. update_voice_settings (only if user chose non-default voice)
4. run_stage(generate_voiceover, wait=false) → stage_status until completed
5. run_stage(transcribe, wait=true is fine) → word timings ready.
   If it fails with "model ... is not downloaded", use
   update_transcribe_settings (whisper_model must be downloaded) and retry.
   Never edit the DB by hand.
   SUBTITLE QUALITY AUDIT & REPAIR:
   Whisper (especially for Hindi or complex scripts) often misrecognizes matras
   ('भारतिय' vs 'भारतीय', 'भाशा' vs 'भाषा'), turns Hindi number words into
   digits ('1975', '23'), or truncates words at segment boundaries.
   Run `compare_transcription` to get an exact word-level discrepancy report
   against script.json. Use `update_transcription(auto_align=true)` to heal
   spelling/matra variants in one pass, or pass targeted `replacements` to fix
   specific words. This keeps transcription.json, subtitles.srt, and
   subtitles.vtt synchronized before authoring visuals and rendering.
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
 9. search_media to verify each English query resolves BEFORE writing the cut (skip verification only if the same query already verified this session)
10. save_visuals per section (durations auto-normalize to the audio
    length; prefer ONE Particles layer per cut as LAST child; no chapter
    title cards inside cuts; Text in project language except queries stay English).
    VARIETY GUIDE (enforced by review, not by validation — the server
    accepts valid output, but aim high):
    - Prefer fresh layer-templates per cut; vary card
      geometry, background treatment, and text animation_mode per beat. Reuse is fine for continuity.
    - Use as many of the 11 content kinds per video as the story supports (Image, Video, Text,
      Chart, Shape, Map, HTML, Lottie, Particles, Counter, Background). Any Lucide icon, particle overrides, chart tuning, Lottie URLs, yt offsets, loop/volume are allowed.
    - Prefer at least one energy moment per section: emphasis punch-in,
      camera_shake, motion_blur, an FX filter (emboss/sharpen/posterize/
      duotone/thermal), rack-focus blur/brightness keyframes, floating, or a
      Particles overlay matched to the beat's emotion.
    - Cycle transitions deliberately (whip_pan/glitch for shock beats,
      dissolve for time jumps). Reuse is fine when the beat needs it.
    - Pair entrance animations (translateY, translateX, scale, rotate)
      with a simultaneous opacity fade ({property: "opacity", from: 0, to: 1, ...})
      whenever delay > 0 so elements stay hidden until they move; spatial-only
      without fade is allowed ONLY for instant punch/whip beats at delay: 0.
    The save_visuals response reports variety stats + normalizations:
    read them and enrich flat spots BEFORE moving on.
11. run_stage(fetch_assets, wait=false) → stage_status until completed.
    Fetch AFTER all sections are saved so every query resolves to a
    downloaded local_path. Composition review without this step shows
    placeholders, not final visuals.
12. review_frame per section (mode=composition) to verify exact pre-render
    pixels — MANDATORY, not optional, and ONLY AFTER fetch_assets.
    After each contact sheet, state what you changed (or what you
    verified as good); inspect cuts via
    get_visuals(section_type, scene_index, cut_index=N) and fix bad cuts via
    save_visuals(cut_index=N), or trial first with
    save_visuals(dry_run=true) which validates without writing. If a fix
    adds a NEW Image/Video query, re-run fetch_assets then re-review that
    cut (composition renders the downloaded files). A section is done only
    after a post-fetch review pass with named fixes — never first-pass,
    never pre-fetch.
13. STOP. Do not render. Summarize the build (title, scene count, voice,
    design, review_frame highlights) and ask the user to review/edit in
    the app. Only after explicit approval: run_stage(render,
    confirm_render=true) → stage_status → video_path.
    (review_frame on the mp4 for the final check)

## Gotchas
- Durations: sub_visuals durations MUST sum to the section audio duration
  (the server normalizes, but gross mismatches mean mistimed visuals).
- Opacity fade: pair entrances with opacity fade whenever delay > 0 so elements stay hidden until they enter; spatial-only allowed at delay: 0.
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
        "Follow the narrato://pipeline-guide resource exactly.\n"
        "MANDATORY FIRST STEP: Do NOT call create_project yet! "
        "Ask the user every question matching the 'New Narrative Build' form (unless already specified):\n"
        "1. Topic / Name: Confirm topic or title.\n"
        "2. Video Style / Genre: Offer the 8 styles (documentary, explainer, finance, vox, news, true_crime, storytime, viral_short).\n"
        "3. Language: hi (Hindi) or en (English).\n"
        "4. Video Format: landscape (YouTube 16:9) or portrait (Reels/Shorts 9:16).\n"
        "5. Duration Mode: short/medium/long/extra_long based on format.\n"
        "6. Export Destination Folder: custom path or default exports dir.\n"
        "7. Voice: call list_voice_options and offer concrete voice choices.\n\n"
        "Wait for the user's answers, then call create_project and update_voice_settings. "
        "Drive every stage through fetch_assets, then review_frame(mode=composition) per section, "
        "verifying with project_status — then STOP, present a review summary, "
        "and ask the user to review/edit in the app. "
        "Only render after explicit approval (run_stage(render, confirm_render=true))."
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
    check before render, REQUIRES fetch_assets first so Image/Video
    local_path files exist); procedural (text-only) cuts report that
    explicitly. Returns metadata + a single JPEG (strip or grid).

    WORKFLOW: save_visuals (all sections) → fetch_assets → review_frame
    (mode=composition) per section. Reviewing before fetch_assets shows
    placeholders, not final visuals. If a fix adds a new query, re-run
    fetch_assets then re-review.
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
def get_transcription(
    project_id: str,
    section_type: str = "",
    scene_index: int = 0,
    segment_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    """Read word-level transcription data produced by the transcribe stage.

    Can be section-scoped (section_type: introduction | scene | conclusion;
    scene_index used for scenes) to inspect words and timestamps for ONE section,
    or by segment_id, or paginated across the whole video. Use to inspect word
    timings before designing kinetic text or repairing subtitles."""
    try:
        from backend.mcp import subtitles as _subtitles
        return _subtitles.get_transcription_payload(
            project_id, section_type, scene_index, segment_id, offset, limit
        )
    except Exception as e:
        logger.error(f"MCP get_transcription failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def compare_transcription(project_id: str) -> dict:
    """Audit Whisper transcription against ground-truth script.json narration.

    Performs word-level alignment across sections to detect:
    - Spelling / matra discrepancies (e.g. 'भारतिय' vs 'भारतीय', 'भाशा' vs 'भाषा')
    - Number-to-digit conversions (e.g. 'उन्नीस सौ पचहत्तर' vs '1975')
    - Missing / omitted words dropped by Whisper
    - Segment boundary truncations (e.g. words cut off at 30s limits like 'पाकि')
    - Audio/timing gaps between segments.
    Run this after transcribe to see where Whisper hallucinated or missed words."""
    try:
        from backend.mcp import subtitles as _subtitles
        return _subtitles.compare_transcription_payload(project_id)
    except Exception as e:
        logger.error(f"MCP compare_transcription failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def update_transcription(
    project_id: str,
    replacements: list | None = None,
    segments: list | None = None,
    auto_align: bool = False,
    dry_run: bool = False,
    fill_gaps: bool = False,
    expand_numbers: bool = False,
    repair_truncations: bool = False,
) -> dict:
    """Fix and update transcription.json, automatically syncing subtitles.srt and subtitles.vtt.

    Supports:
    - auto_align=true: automatically heals spelling/matra errors and near-misses
      by projecting canonical script.json text onto Whisper timestamps.
      Auto-enables fill_gaps, expand_numbers, and repair_truncations.
    - fill_gaps=true: interpolate missing script words across uncaptioned time
      windows using character-weighted timing (zero subtitle blanking).
    - expand_numbers=true: split numeric tokens (e.g. '1975') into Hindi script
      words with proportional sub-timings.
    - repair_truncations=true: complete truncated segment tails.
    - replacements: list of custom find/replace dicts:
      [{"find": "भारतिय", "replace": "भारतीय"}, {"segment_id": 1, "find": "भाशा", "replace": "भाषा"}]
    - segments: full replacement of segments list if custom timings were constructed.
    - dry_run=true: validates and previews fixes without writing to disk."""
    try:
        from backend.mcp import subtitles as _subtitles
        return _subtitles.update_transcription_payload(
            project_id, replacements, segments, auto_align, dry_run,
            fill_gaps, expand_numbers, repair_truncations,
        )
    except Exception as e:
        logger.error(f"MCP update_transcription failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def get_visuals(project_id: str, section_type: str, scene_index: int = 0,
                cut_index: int = -1) -> dict:
    """Read back sub_visuals for ONE section or a SINGLE cut.
    Symmetrical reader to save_visuals. Use this to inspect existing cuts before
    patching instead of reading the entire script.json or running shell scripts.

    Args:
        project_id: Unique project identifier.
        section_type: introduction | scene | conclusion.
        scene_index: 0-based scene index (used only when section_type='scene').
        cut_index: Optional 0-based cut index (pass -1 or omit to get all cuts in the section).
    """
    try:
        return payloads.get_visuals_payload(
            project_id, section_type, scene_index,
            cut_index=cut_index if cut_index is not None and cut_index >= 0 else None,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP get_visuals failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def save_visuals(project_id: str, section_type: str, sub_visuals: list,
                 scene_index: int = 0, cut_index: int = -1,
                 dry_run: bool = False) -> dict:
    """Validate and persist sub_visuals for ONE section
    (section_type: introduction | scene | conclusion; scene_index used
    only for scene). Durations are auto-normalized to the section's audio
    length; Image/Video layers MUST carry an English search `query`.
    Repeat per section, then run fetch_assets BEFORE review_frame
    (mode=composition needs downloaded local_path files).

    cut_index >= 0 patches a SINGLE cut (pass sub_visuals as a 1-element
    array holding just that cut) instead of resending the whole section —
    use after review_frame flags one bad cut (re-run fetch_assets if the
    patch adds a new query, then re-review). dry_run=true validates and
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
