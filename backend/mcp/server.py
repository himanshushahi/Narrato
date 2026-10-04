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

import functools
import inspect
import json
import os
import sys
import threading
import time
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

NARRATO_SERVER_INSTRUCTIONS = """You are connected to Narrato, an automated video production system.

MANDATORY PROJECT INTAKE PROTOCOL:
When the user asks to create or make a video, you MUST NOT immediately invoke `create_project` with assumed, guessed, or default values.
Instead, you MUST conduct the "New Narrative Build" intake interview and ask the user every project question matching the app's creation modal (unless already explicitly provided by the user):

1. Narrative Topic / Name: Confirm the exact title or subject.
2. Language:
   - Hindi (\u0939\u093f\u0928\u094d\u0926\u0940) [`hi`] (narration written in Devanagari Hindi prose)
   - English (EN) [`en`]
3. Video Format:
   - Landscape (YouTube 16:9) [`landscape`]
   - Portrait (Reels/Shorts 9:16) [`portrait`]
4. Duration Mode (recommend based on format):
   - For Landscape: Medium (~5m), Long (~10m), or Extra Long (~15m)
   - For Portrait: Short (~60s), Medium (~90s), or Long (~2m)
5. Export Destination Folder: Confirm if the user wants a specific directory or default project exports folder.
6. Voice: Call `list_voice_options` to offer concrete voice choices (set with `update_voice_settings`).
7. Visual Style (optional free text): Ask what look/mood they want (e.g. "warm editorial", "dark cinematic"). There are NO preset genres — invent palettes, typography, and compositions from the topic + this hint.

ONLY after the user confirms these preferences (or if already explicitly specified), invoke `create_project`.

UI vs API NUMBERING & SECTION TARGETING:
- The Narrato UI displays 1-based Scene numbers ("Scene 1", "Scene 2", ...) and 1-based Cut numbers ("Cut #1", "Cut #2", ...).
- When the user asks to inspect or modify a scene or cut (e.g. "fix scene 1 cut 2" or "probe scene 3"):
  * Pass 1-based parameters `scene_number` and `cut_number` (e.g. `scene_number=1, cut_number=2`). This directly matches what the user sees in the UI!
  * OR pass 0-based parameters `scene_index = scene_number - 1` and `cut_index = cut_number - 1` (e.g. `scene_index=0, cut_index=1`).
  * Never pass `scene_index=1` for "Scene 1" -- in 0-based indexing that targets Scene 2!
  * Introduction and Conclusion: use `section_type="introduction"` (or `"intro"`) and `section_type="conclusion"` (or `"outro"`). Cuts within them are referenced with `cut_number` (1-based) or `cut_index` (0-based). Do not specify a `scene_index` for intro/conclusion.

MANDATORY SKILL GROUNDING (hard gate, not guidance):
- save_script REQUIRES scriptwriter first.
- save_design REQUIRES art-director-design-system first.
- save_visuals REQUIRES declarative-ast + visual-director-core + motion-graphics-designer first (brief=true counts).
- EASIEST: one call get_stage_skills(stage, project_id) per stage -- it returns the starter pack AND satisfies the gate.
  script -> get_stage_skills('script', project_id); design -> get_stage_skills('design', project_id); visuals -> get_stage_skills('visuals', project_id).
- The server REJECTS save_* with SKILL_REQUIRED if you skip this. get_section_timings also pushes a creative_blueprint (layer reference + sample cut) -- use it.

PROBE TOOLS -- WHAT THEY RETURN:
- `probe_cut(project_id, section_type, scene_index, cut_index)`: Returns the full AST JSON for one sub-visual cut (duration, transition, composition children). Use before rewriting a cut to see its current state.
- `probe_scene(project_id, section_type, scene_index)`: Returns ALL cuts in a scene: count, durations, transitions, layer type breakdown. Use before planning a scene rewrite.
- `probe_asset(project_id, section_type, scene_index, cut_index, layer_index)`: Returns resolved asset info for one media layer (local path, URL, content type). Asset paths are only valid AFTER run_stage('fetch_assets') completes -- before that, paths are empty.

SAVE VISUALS -- BATCH vs SINGLE:
- `save_visuals(...)`: Saves sub_visuals for ONE scene. Use for targeted rewrites.
- `save_visuals_batch(project_id, visuals_map)`: Saves multiple scenes in one call. Use when generating ALL scenes. visuals_map = {scene_index: sub_visuals_list}. NEVER call save_visuals in parallel loops for multiple scenes -- use batch to avoid race conditions and silent data loss.

ASSET PIPELINE TIMING:
- Image/Video layers need only `query` + `source` during generation -- NOT a URL or path. Pipeline downloads assets via fetch_assets AFTER all visuals are saved.
- query_verification status resets on app restart -- do not rely on it across sessions.

VISUAL GENERATION CRITICAL GOTCHAS:
- `content.type` is MANDATORY on every Layer's content -- missing it silently renders the scene null (no error, just blank).
- Map and Particles are ALWAYS fullscreen -- position/size ignored. Overlay Shape/Text layers on top for framing.
- Image sources: pexels / pixabay / wikipedia / archive ONLY. NEVER youtube for Image.
- Video sources: pexels / pixabay / youtube / archive ONLY. NEVER wikipedia for Video.
- YouTube clips: yt_duration max 30s; yt_start_offset default 15s (skips intros).
- Portrait safe area: keep text above bottom: 28%. Landscape: above bottom: 18%.
- Every entrance animation with delay > 0 MUST pair with opacity: 0->1 at same delay.
- style box goes on the Layer node (sibling of content), NOT inside content.
- Layer count, no quota: use as many layers as the beat needs (usually a rich stack: base + framing/atmosphere + hero + kinetic text). Every layer must earn its place with a clear job + motion; never stack blindly, never ship a single bare layer.

CONTINUOUS LEARNING -- SKILL SELF-IMPROVEMENT:
When you discover a new edge case, rendering failure, useful pattern, or source selection insight during a session, call `append_skill_learning` to log it:
- skill_name: which skill the learning belongs to (e.g. 'declarative-ast', 'visual-director-core', 'editor-qa')
- title: short description (e.g. 'Map layer position silently ignored')
- context: what triggered it (project type, scene type, prompt)
- observation: what happened (the failure or new pattern)
- fix_or_pattern: the concrete fix or rule to add
- status: 'pending' for new; 'confirmed' if you've seen it before

This is APPEND-ONLY to LEARNINGS.md -- it never modifies SKILL.md. A human reviews and folds confirmed learnings into SKILL.md. Use this proactively at session end or when you catch a bug.
"""

mcp = MCPServer("narrato", instructions=NARRATO_SERVER_INSTRUCTIONS)


# ── UI live-update push (desktop app, same process) ───────────────────
# The desktop UI pulls project state (dashboard list, open-project detail).
# Agent mutations would otherwise stay invisible until the user manually
# revisits the page. Both agents funnel through the S.* functions below for
# content mutations (the MCP HTTP server runs as an app thread; the in-app
# chat agent calls the same functions in-process), so wrapping each mutating
# tool with @_emit_project_event refreshes the UI live via
# window.onProjectEvent. Stage execution differs by agent — chat run_stage
# goes through global_queue_manager (whose queue_update events already drive
# the UI), MCP run_stage uses _run_stage_inner below, which notifies on
# start / terminal states (+ throttled mid-run progress) for the same reason.
def _notify_ui_project_event(event_type: str, project_id: str | None = None,
                             action: str | None = None,
                             files_changed: bool = True,
                             progress_tick: bool = False) -> None:
    """Best-effort push of a project event to the desktop UI.

    files_changed=False marks status-only ticks (stage start/progress):
    the UI refetches row + task status but skips re-reading script/design/
    manifest files, which don't change mid-stage. progress_tick=True marks
    the throttled mid-run ticks specifically: the UI further downgrades
    those to a 10s-throttled detail pull with no list refetch (stage start
    and completion carry the transitions that matter). Never raises.
    Same-process only: in a detached stdio MCP process there is no webview
    loop draining the queue (the dashboard refetches on window focus as a
    catch-all there).
    """
    try:
        evt: dict = {"type": event_type, "files_changed": files_changed}
        if project_id:
            evt["project_id"] = project_id
        if action:
            evt["action"] = action
        if progress_tick:
            evt["progress_tick"] = True
        from backend.core.bridge import ui_queue
        ui_queue.put(("onProjectEvent", (evt,)))
        # Production diagnosis: content-mutation pushes are infrequent, so
        # log them — when a save "doesn't show in the UI", the app log now
        # proves whether the push was emitted (frontend dropped it) or never
        # sent. Throttled mid-run ticks stay at debug to avoid 5s log spam.
        if progress_tick:
            logger.debug(f"UI event {event_type} project={project_id} (progress tick)")
        else:
            logger.info(f"UI event {event_type} project={project_id}"
                        + (f" action={action}" if action else "")
                        + f" files_changed={files_changed}")
    except Exception:
        pass


def _is_dry_run_flag(value) -> bool:
    """Lenient dry_run check for the notify gate (mirrors _coerce_bool).

    The payload layer coerces string flags, so the gate must too: a raw
    truthiness test treats dry_run="false" as a dry run and skips the UI
    push — while the payload persists the save. That persist-without-notify
    combination is exactly "agent saved, UI never updated".
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes")
    return bool(value)


def _emit_project_event(event_type: str, action: str | None = None,
                        pid_from_result: bool = False,
                        files_changed: bool = True):
    """Wrap a mutating MCP tool: on {"ok": truthy} results push a UI event.

    - pid_from_result: create_project returns the new id in the result dict.
    - dry_run calls validate only — never notify (bound via signature, so
      positional dry_run=True is honoured too).
    - Rejections/failures (ok falsy) never notify.
    Notification is best-effort and never breaks the tool result.
    Applied UNDER @mcp.tool() so FastMCP still sees the original signature
    (functools.wraps preserves __wrapped__; see tests/test_project_events.py,
    which pins this). Sync tools only — an async tool would return an
    un-awaited coroutine instead of a dict, so fail fast at import.
    """
    def decorator(fn):
        assert not inspect.iscoroutinefunction(fn), \
            f"_emit_project_event wraps sync tools only: {fn.__name__}"
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            result = fn(*args, **kwargs)
            try:
                if not (isinstance(result, dict) and result.get("ok")):
                    return result
                try:
                    bound = sig.bind_partial(*args, **kwargs)
                except TypeError:
                    bound = None
                if bound is not None and _is_dry_run_flag(bound.arguments.get("dry_run")):
                    return result
                pid = None
                if pid_from_result:
                    pid = result.get("project_id")
                else:
                    pid = kwargs.get("project_id")
                    if pid is None and args and isinstance(args[0], str):
                        pid = args[0]
                    if pid is None and isinstance(result, dict) and result.get("project_id"):
                        pid = result.get("project_id")
                if isinstance(pid, str) and pid:
                    _notify_ui_project_event(event_type, pid, action,
                                             files_changed=files_changed)
                elif event_type == "projects_changed":
                    _notify_ui_project_event(event_type, None, action,
                                             files_changed=files_changed)
            except Exception:
                pass
            return result
        return wrapper
    return decorator


def _refuse_if_stage_running(fn):
    """Refuse mutating MCP tools while one of the project's stages runs.

    A wait=false polling loop must not wander into side quests: saves,
    clears and settings changes are locked until the stage settles, while
    read-only tools, sleep, stage_status and cancel_stage pass through.
    dry_run validations write nothing and also pass. Defined up here (before
    first use) because decorators apply at import time; _STAGE_LOCK and
    _project_active_stage resolve at call time. Applied UNDER @mcp.tool()
    (beside @_emit_project_event, which skips notification for falsy-ok
    refusals automatically).
    """
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            bound = sig.bind_partial(*args, **kwargs)
            pid = bound.arguments.get("project_id", "")
            dry = bound.arguments.get("dry_run", False)
        except Exception:
            return fn(*args, **kwargs)
        # Lenient truthy: LLMs send true/"true"/1/"1" interchangeably, and a
        # validation-only dry_run writes nothing, so it must never be refused.
        if dry is True or dry == 1 or (isinstance(dry, str) and dry.strip().lower() in ("true", "1", "yes")):
            return fn(*args, **kwargs)
        if pid:
            with _STAGE_LOCK:
                active = _project_active_stage(pid)
            if active is not None:
                # Task ids are f"{project_id}_{stage}" — strip the known
                # prefix instead of splitting on "_" (project ids may
                # contain underscores themselves).
                if pid and active.startswith(pid + "_"):
                    stage = active[len(pid) + 1:]
                else:
                    stage = active.rsplit("_", 1)[-1] if "_" in active else active
                return {"ok": False, "awaiting_stage": stage,
                        "error": (f"Project {pid!r} has a running MCP stage ({stage}); "
                                  "sleep, then stage_status until it completes. "
                                  "Mutating tools are locked meanwhile; read-only probes are fine.")}
        return fn(*args, **kwargs)

    return wrapper


# ── Skill-read gate (mandatory grounding + easy bundle) ──────────────
# Agents skip advisory "read the skill first" docs and go straight for
# save_script/save_visuals because the server used to accept flat output
# with ok:true. This gate makes grounding a hard precondition per stage,
# while get_stage_skills() makes it a single cheap call.
import threading as _gate_threading

_SKILL_GATE_LOCK = _gate_threading.Lock()
# project_id -> set(normalized skill names read via get_skill/get_stage_skills)
_SKILL_READS: dict = {}
# Reads without a project_id (older clients) fall back here.
_GLOBAL_SKILL_READS: set = set()
# Deep reads: (normalized skill, section title returned) pairs. The visuals
# starter pack is deliberately broad but shallow — save_visuals additionally
# requires ≥1 section-level pull from declarative-ast so the agent has seen
# real capability text (layer fields, contracts), not just briefs.
# project_id -> set((skill, section)); no-project reads fall back globally.
_SECTION_READS: dict = {}
_GLOBAL_SECTION_READS: set = set()

_SKILL_ALIASES = {
    "visual-director": "visual-director-core",
    "visual_director": "visual-director-core",
    "declarative_ast": "declarative-ast",
    "motion_graphics": "motion-graphics-designer",
    "art_director": "art-director-design-system",
    "script_writer": "scriptwriter",
}

# stage -> skills that MUST have been read first (brief=true counts).
# visuals needs all three: AST (layers/contracts), director (fields),
# motion (geometry + text + FX).
STAGE_SKILL_REQUIREMENTS: dict = {
    "script": ["scriptwriter"],
    "design": ["art-director-design-system"],
    "visuals": ["declarative-ast", "visual-director-core",
                "motion-graphics-designer"],
}
# Acceptable alternates (any-of) per stage requirement entry.
STAGE_SKILL_ALTERNATES: dict = {
    "scriptwriter": ["scriptwriter", "script-base-writer"],
}
# stage -> (skill, min_sections): section-level deep reads required beyond
# the skill-level gate. Visuals capability lives in the full layer/contract
# text — a brief-only agent underuses the harness.
STAGE_DEEP_READ_REQUIREMENTS: dict = {
    "visuals": ("declarative-ast", 1),
}


def _norm_skill(name: str) -> str:
    n = (name or "").strip().lower()
    return _SKILL_ALIASES.get(n, n)


def _record_skill_read(project_id: str, skill_name: str,
                       section: str = "") -> None:
    norm = _norm_skill(skill_name)
    if not norm:
        return
    with _SKILL_GATE_LOCK:
        _GLOBAL_SKILL_READS.add(norm)
        pid = (project_id or "").strip()
        if pid:
            _SKILL_READS.setdefault(pid, set()).add(norm)
        # Section reads only count when a real section came back (brief=true
        # ignores section, and the starter pack records skills, not sections).
        if (section or "").strip():
            pair = (norm, (section or "").strip()[:80])
            _GLOBAL_SECTION_READS.add(pair)
            if pid:
                _SECTION_READS.setdefault(pid, set()).add(pair)


def _skills_read_for(project_id: str) -> set:
    pid = (project_id or "").strip()
    with _SKILL_GATE_LOCK:
        own = set(_SKILL_READS.get(pid, set())) if pid else set()
        return own | set(_GLOBAL_SKILL_READS)


def _sections_read_for(project_id: str, skill_name: str) -> set:
    """Section titles pulled for one skill (project + global fallback)."""
    norm = _norm_skill(skill_name)
    pid = (project_id or "").strip()
    with _SKILL_GATE_LOCK:
        own = {sec for (sk, sec) in _SECTION_READS.get(pid, set())
               if sk == norm} if pid else set()
        glob = {sec for (sk, sec) in _GLOBAL_SECTION_READS if sk == norm}
        return own | glob


def _missing_stage_skills(stage: str, project_id: str) -> list:
    required = STAGE_SKILL_REQUIREMENTS.get(stage, [])
    have = {_norm_skill(s) for s in _skills_read_for(project_id)}
    missing = []
    for req in required:
        alts = STAGE_SKILL_ALTERNATES.get(req, [req])
        if not any(_norm_skill(a) in have for a in alts):
            missing.append(req)
    return missing


def _missing_deep_reads(stage: str, project_id: str) -> dict | None:
    """Deep-read requirement for a stage, or None when satisfied/absent.

    Returns {skill, need, have} when the agent must pull ≥need full sections
    from skill before authoring (briefs and the starter pack don't count).
    """
    req = STAGE_DEEP_READ_REQUIREMENTS.get(stage)
    if not req:
        return None
    skill, need = req
    have = _sections_read_for(project_id, skill)
    if len(have) >= need:
        return None
    return {"skill": skill, "need": need, "have": sorted(have)}


def _deep_read_required_error(stage: str, project_id: str,
                              deep: dict) -> dict:
    skill = deep["skill"]
    example = (f"get_skill(skill_name='{skill}', "
               f"section='content types', project_id='{project_id}')")
    return {
        "ok": False,
        "error": (
            f"DEEP_READ_REQUIRED: stage '{stage}' needs ≥{deep['need']} full "
            f"section pull(s) from '{skill}' — briefs and the starter pack "
            f"don't count (brief-only agents underuse the harness). "
            f"EASY FIX (1 call): {example} — then pull any other "
            f"sections you need. Sections read so far: {deep['have'] or 'none'}."
        ),
        "error_code": "DEEP_READ_REQUIRED",
        "stage": stage,
        "project_id": project_id,
        "required_skill": skill,
        "sections_read": deep["have"],
        "fix": {
            "one_call": {
                "tool": "get_skill",
                "arguments": {"skill_name": skill, "section": "content types",
                              "project_id": project_id},
            },
        },
    }


def _skill_required_error(stage: str, project_id: str, missing: list) -> dict:
    bundle_call = (f"get_stage_skills(stage='{stage}', "
                   f"project_id='{project_id}')")
    granular = " + ".join(f"get_skill('{m}', brief=true)" for m in missing)
    return {
        "ok": False,
        "error": (
            f"SKILL_REQUIRED: stage '{stage}' needs grounding first. "
            f"Missing: {missing}. "
            f"EASY FIX (1 call): {bundle_call} — returns the starter pack "
            f"and satisfies the gate. "
            f"Or granular: {granular}, then pull sections you need via "
            f"get_skill(NAME, section='...'). "
            f"Authoring without the skill produces flat/broken output."
        ),
        "error_code": "SKILL_REQUIRED",
        "stage": stage,
        "project_id": project_id,
        "required_skills": list(STAGE_SKILL_REQUIREMENTS.get(stage, [])),
        "missing": missing,
        "fix": {
            "easy_one_call": {
                "tool": "get_stage_skills",
                "arguments": {"stage": stage, "project_id": project_id},
            },
            "granular_calls": [
                {"tool": "get_skill",
                 "arguments": {"skill_name": m, "brief": True,
                               "project_id": project_id}}
                for m in missing
            ],
        },
    }


# ── Projects ──────────────────────────────────────────────────────────

def _db_short_id_suffix() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


LanguageType = Literal["hi", "en"]
VideoFormatType = Literal["landscape", "portrait"]
DurationModeType = Literal["short", "medium", "long", "extra_long"]


@mcp.tool()
@_emit_project_event("projects_changed", action="created", pid_from_result=True)
def create_project(
    name: Annotated[
        str,
        Field(description="Narrative Topic / Name (e.g. 'The Rise and Fall of Rome', 'How Bitcoin Works')"),
    ],
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
    style_hint: Annotated[
        str,
        Field(
            default="",
            description="Optional free-text visual style/mood hint (e.g. 'warm editorial', 'dark cinematic'). No presets — invent from topic + hint.",
        ),
    ] = "",
    **legacy_kwargs,
) -> dict:
    """Create a new video project. Returns the project_id used by every
    other tool.

    MANDATORY INTAKE RULE - ASK BEFORE CALLING:
    Do NOT call this tool with guessed or silent default values.
    Before invoking create_project, you MUST ask the user all questions
    matching the app's 'New Narrative Build' modal (unless already specified):
    1. Topic / Name: Confirm the narrative topic or title.
    2. Language: 'hi' (Hindi) or 'en' (English).
    3. Video Format: 'landscape' (YouTube 16:9) or 'portrait' (Reels/Shorts 9:16).
    4. Duration Mode: 'short', 'medium', 'long', 'extra_long' (matched to format).
    5. Export Destination Folder: Confirm custom path or default exports dir.
    6. Voice: Offer choices via list_voice_options.
    7. Visual Style (optional): free-text mood hint — there are no preset genres.

    Read the narrato://pipeline-guide resource before starting a full build."""
    # Required intake fields: Ellipsis/None means the agent skipped the
    # mandatory interview — fail fast instead of silently defaulting.
    # (MCP schema already marks these required; this covers direct callers.)
    # Legacy `genre=...` kwarg (removed preset) is swallowed by
    # **legacy_kwargs and ignored so old callers fail soft, not with TypeError.
    if legacy_kwargs:
        logger.warning(f"create_project ignoring removed legacy args: {sorted(legacy_kwargs)}")
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
    if style_hint is ... or style_hint is None:
        style_hint = ""

    if not (name or "").strip():
        return {"ok": False, "error": "name must be a non-empty string."}
    if video_format not in ("landscape", "portrait"):
        return {"ok": False, "error": "video_format must be landscape or portrait."}
    if duration_mode not in ("short", "medium", "long", "extra_long"):
        return {"ok": False,
                "error": "duration_mode must be short, medium, long or extra_long."}
    # Mode must match format — otherwise pacing would silently remap
    # (e.g. landscape/short stored as short but enforced as medium/300s).
    try:
        from backend.mcp.pacing import VALID_COMBOS
        if duration_mode not in VALID_COMBOS.get(video_format, set()):
            return {"ok": False,
                    "error": (
                        f"duration_mode {duration_mode!r} is not valid for "
                        f"video_format {video_format!r}. Valid: "
                        f"landscape={sorted(VALID_COMBOS['landscape'])}, "
                        f"portrait={sorted(VALID_COMBOS['portrait'])}.")}
    except Exception as e:
        err = str(e)
        if "not valid for" in err:
            return {"ok": False, "error": err}
    if language not in ("hi", "en"):
        return {"ok": False, "error": "language must be 'hi' or 'en'."}
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
            name.strip(), (style_hint or "").strip(), export_folder,
            language=language or "hi", style=style or "nitish_rajput",
            duration_mode=duration_mode or "medium",
            video_format=video_format,
        )
    except Exception as e:
        logger.error(f"MCP create_project failed: {e}")
        return {"ok": False, "error": str(e)}
    (_config.get_storage_dir() / project_id).mkdir(parents=True, exist_ok=True)
    try:
        from backend.mcp.pacing import get_pacing
        _pacing = get_pacing(duration_mode, video_format, language)
    except Exception:
        _pacing = None
    result: dict = {"ok": True, "project_id": project_id, "name": name.strip()}
    if _pacing:
        result.update({
            "duration_mode": _pacing["duration_mode"],
            "video_format": _pacing["video_format"],
            "target_duration_seconds": _pacing["target_duration_seconds"],
            "target_scene_count": {"min": _pacing["min_scenes"],
                                   "max": _pacing["max_scenes"]},
            "target_per_scene_seconds": _pacing["per_scene_duration_label"],
            "target_per_scene_words": _pacing["per_scene_words_label"],
            "next_step": "Call get_stage_skills('script', project_id) before authoring the script.",
        })
    return result


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
              section: str = "", brief: bool = False, project_id: str = "") -> dict:
    """**FOR MCP EXTERNAL AGENT ONLY.** Get the full markdown guide for one skill (e.g. scriptwriter,
    visual-director-core, motion-graphics-designer, declarative-ast).
    Template variables are rendered for the given language/format.
    Big skills are ~50KB: pass brief=true for a section map first, then
    section="..." (fuzzy: title, subhead like "particles", or number)
    to pull ONE part instead of the whole file.
    MANDATORY GATE: save_script requires scriptwriter; save_design requires
    art-director-design-system; save_visuals requires declarative-ast +
    visual-director-core + motion-graphics-designer (brief=true counts) PLUS
    ≥1 full section pull from declarative-ast (briefs alone produce flat
    output — the starter pack is broad but shallow by design).
    EASIEST: one call get_stage_skills(stage, project_id) instead."""
    from backend.agent.skill_loader import skill_loader
    skill = skill_loader.get_skill(skill_name, context="tool")
    if not skill:
        return {"ok": False, "error": f"Skill {skill_name!r} not found. Use list_skills."}
    _record_skill_read(project_id, skill.name)
    ctx = {"language": language, "video_format": video_format}
    # Project-aware template rendering: fill pacing placeholders
    # ({target_duration}, {min_scenes}, ...) from the stored project (or defaults)
    # so outline-director / scene-writer never leak raw {tags} to the agent.
    _dm = "medium"
    _vf = video_format or "landscape"
    _lang = language or "en"
    if (project_id or "").strip():
        try:
            proj = _db.get_project((project_id or "").strip()) or {}
            if proj:
                _dm = proj.get("duration_mode", _dm)
                _vf = proj.get("video_format", _vf)
                _lang = proj.get("language", _lang)
        except Exception as e:
            logger.warning(f"MCP get_skill project lookup failed: {e}")
    try:
        from backend.mcp.pacing import get_pacing
        _p = get_pacing(_dm, _vf, _lang)
        ctx.update({
            "target_duration": _p["target_duration_seconds"],
            "min_scenes": _p["min_scenes"],
            "max_scenes": _p["max_scenes"],
            "per_scene_time": _p["per_scene_time"],
            "per_scene_words": _p["per_scene_words"],
            "per_scene_duration": _p["per_scene_time"],
            "per_scene_word_target": _p["per_scene_words"],
            "language": _lang,
            "video_format": _vf,
        })
    except Exception as e:
        logger.warning(f"MCP get_skill pacing injection failed: {e}")
    ctx.setdefault("script_rules_block", "")
    ctx.setdefault("design_guidance", "")
    ctx.setdefault("sentence_rule", "")
    ctx.setdefault("genre_script_guidance", "")
    if brief:
        out = skill.brief(**ctx)
        out.update({"ok": True, "brief": True,
                    "hint": "Pull one part with get_skill(section=\"...\")."})
        return out
    if section:
        sec_lower = section.strip().lower()
        if sec_lower in ("learnings", "learning", "learnings.md"):
            learnings_parts = []
            try:
                sk_dir = Path(skill.file_path).parent.resolve()
                p = sk_dir / "LEARNINGS.md"
                if p.exists():
                    t = p.read_text(encoding="utf-8").strip()
                    if t:
                        learnings_parts.append(t)
            except Exception:
                pass
            try:
                from backend.core.config import get_storage_dir
                fallback_p = get_storage_dir() / "learnings" / f"{skill.name}_LEARNINGS.md"
                if fallback_p.exists():
                    fb_t = fallback_p.read_text(encoding="utf-8").strip()
                    if fb_t and fb_t not in learnings_parts:
                        learnings_parts.append(fb_t)
            except Exception:
                pass
            if learnings_parts:
                _record_skill_read(project_id, skill.name, section="Learnings")
                return {
                    "ok": True,
                    "name": skill.name,
                    "version": skill.version,
                    "section": "Learnings",
                    "content": "\n\n---\n\n".join(learnings_parts),
                }

        found = skill.render_section(section, **ctx)
        if not found:
            titles = [s["title"] for s in
                      skill.brief(**ctx)["sections"]]
            return {"ok": False,
                    "error": f"No section matching {section!r} in {skill.name}.",
                    "available_sections": titles}
        _record_skill_read(project_id, skill.name,
                           section=found["title"])
        return {"ok": True, "name": skill.name, "version": skill.version,
                "section": found["title"],
                **({"matched_subhead": found["matched_subhead"]}
                   if "matched_subhead" in found else {}),
                "content": f"## {found['title']}\n\n{found['body']}",
                "remaining_sections": found["remaining"]}
    content = skill.render(**ctx)
    _record_skill_read(project_id, skill.name, section="*full skill*")
    return {"ok": True, "name": skill.name, "version": skill.version,
            "content": content,
            "sections": [s["title"] for s in skill.brief(**ctx)["sections"]],
            "brief_hint": "This skill is large — next time pass brief=true "
                          "for a section map, or section=\"...\" for one part."}


# ── Script (agent-authored, server-validated) ─────────────────────────

@mcp.tool()
def get_stage_skills(stage: str = "visuals", project_id: str = "",
                     language: str = "hi",
                     video_format: str = "landscape") -> dict:
    """EASIEST grounding in ONE call: starter pack for a pipeline stage.

    stage: script | design | visuals.
    Returns the minimum must-read content + brief TOCs, and SATISFIES the
    SKILL_REQUIRED gate for save_script / save_design / save_visuals.
    Prefer this over 3 separate get_skill calls when moving fast.
    After this, pull deeper sections only as needed via
    get_skill(NAME, section="...")."""
    from backend.agent.skill_loader import skill_loader
    stage = (stage or "").strip().lower()
    if stage not in STAGE_SKILL_REQUIREMENTS:
        return {"ok": False,
                "error": f"stage must be one of {sorted(STAGE_SKILL_REQUIREMENTS)}."}
    ctx = {"language": language, "video_format": video_format}
    style_hint = ""
    pacing = None
    if project_id:
        try:
            proj = _db.get_project(project_id) or {}
            _raw = str(proj.get("prompt") or "")
            # Legacy rows store a removed genre token in `prompt` — hide it.
            if _raw.strip().lower() in {
                "documentary", "explainer", "finance", "vox",
                "news", "true_crime", "storytime", "viral_short",
            }:
                _raw = ""
            style_hint = _raw
            if proj:
                from backend.mcp.pacing import get_pacing as _get_pacing
                pacing = _get_pacing(proj.get("duration_mode", "medium"),
                                     proj.get("video_format", video_format),
                                     proj.get("language", language))
                ctx.update({"language": proj.get("language", language),
                            "video_format": proj.get("video_format", video_format)})
        except Exception as e:
            logger.warning(f"MCP get_stage_skills project lookup failed: {e}")
            style_hint = ""
    if pacing is None and stage == "script":
        # No project_id (older clients): still give default targets so the
        # agent is not surprised by the save_script guardrail, which enforces
        # medium/landscape by default. Flag them as defaults.
        try:
            from backend.mcp.pacing import get_pacing as _get_pacing_default
            pacing = _get_pacing_default("medium", "landscape", language)
        except Exception as e:
            logger.warning(f"MCP get_stage_skills default pacing failed: {e}")
            pacing = None
    bundle: dict = {"ok": True, "stage": stage, "project_id": project_id,
                    "style_hint": style_hint, "satisfies_gate_for": list(
                        STAGE_SKILL_REQUIREMENTS[stage])}
    if pacing and stage == "script":
        bundle["outline_targets"] = {
            "target_duration_seconds": pacing["target_duration_seconds"],
            # Canonical key + alias matching create_project's target_scene_count.
            "recommended_scenes": {"min": pacing["min_scenes"],
                                   "max": pacing["max_scenes"]},
            "target_scene_count": {"min": pacing["min_scenes"],
                                   "max": pacing["max_scenes"]},
            "per_scene_duration": pacing["per_scene_duration_label"],
            "target_per_scene_seconds": pacing["per_scene_duration_label"],
            "per_scene_words": pacing["per_scene_words_label"],
            "target_per_scene_words": pacing["per_scene_words_label"],
            "total_script_words": pacing["total_script_words_label"],
            "duration_mode": pacing["duration_mode"],
            "video_format": pacing["video_format"],
        }
        if not (project_id or "").strip():
            bundle["outline_targets"]["note"] = (
                "Default targets (no project_id supplied). "
                "Pass project_id for project-specific counts.")
    try:
        if stage == "script":
            sk = skill_loader.get_skill("scriptwriter", context="tool")
            bundle["scriptwriter"] = sk.render(**ctx) if sk else ""
            _record_skill_read(project_id, "scriptwriter")
            if pacing:
                # Render outline-director with real numbers so the agent sees
                # exact chapter counts instead of {min_scenes} placeholders.
                # Reuse the scriptwriter render for rules (no double fetch).
                try:
                    _rules = bundle.get("scriptwriter", "")
                    _od = skill_loader.get_skill("script-outline-director",
                                                 context="tool")
                    if _od:
                        bundle["outline_director"] = _od.render(
                            **{**ctx,
                               "script_rules_block": f"=== WRITING RULES ===\n{_rules}\n" if _rules else "",
                               "target_duration": pacing["target_duration_seconds"],
                               "min_scenes": pacing["min_scenes"],
                               "max_scenes": pacing["max_scenes"],
                               "per_scene_time": pacing["per_scene_time"],
                               "per_scene_words": pacing["per_scene_words"]})
                        _record_skill_read(project_id, "script-outline-director")
                except Exception as e:
                    logger.warning(f"MCP outline-director render failed: {e}")
                bundle["must_follow"] = [
                    f"A {pacing['target_duration_seconds']}s "
                    f"({pacing['duration_mode']}/{pacing['video_format']}) video "
                    f"REQUIRES {pacing['min_scenes']}-{pacing['max_scenes']} scenes "
                    f"at ~{pacing['per_scene_time']}s each "
                    f"({pacing['per_scene_words']} words). Do NOT create 5 long scenes.",
                    "A scene is a short visual beat (~7-12s, see outline_targets for exact), NOT a 60-second essay chapter.",
                ]
                bundle["next"] = (
                    f"Generate {pacing['min_scenes']}-{pacing['max_scenes']} scenes "
                    f"matching outline_targets (~{pacing['per_scene_time']}s / "
                    f"{pacing['per_scene_words']} words each), then call save_script.")
            else:
                bundle["next"] = ("Now call save_script. No further sections needed "
                                  "for most scripts.")
        elif stage == "design":
            sk = skill_loader.get_skill("art-director-design-system",
                                        context="tool")
            # The skill template contains a {design_guidance} placeholder.
            # Rendering without it would leak the raw placeholder to the agent,
            # so substitute a style-hint line (or empty string).
            design_guidance = (
                f"User style hint (honor when present, never a preset): {style_hint}"
                if (style_hint or "").strip() else ""
            )
            bundle["art_director"] = sk.render(**{**ctx, "design_guidance": design_guidance}) if sk else ""
            _record_skill_read(project_id, "art-director-design-system")
            bundle["next"] = ("Include motion language (transitions, text "
                              "treatments, overlays) or the server warns. "
                              "Then call save_design.")
        else:  # visuals: fat capability pack (briefs + full key sections).
            # Brief-only agents underuse the layer system, so the pack
            # inlines the highest-value capability text: the layer type
            # reference, motion grammar, contracts, and the plan structure.
            # This costs context once per project and is the closest MCP
            # gets to the internal LLM's injected prompt. It does NOT
            # satisfy the deep-read gate (see below) — that needs an
            # active section pull.
            briefs = {}
            for name in STAGE_SKILL_REQUIREMENTS["visuals"]:
                sk = skill_loader.get_skill(name, context="tool")
                if sk:
                    briefs[name] = sk.brief(**ctx)
                    _record_skill_read(project_id, name)
            bundle["briefs"] = briefs
            for _k in ("script_rules_block", "design_guidance",
                       "sentence_rule", "genre_script_guidance"):
                ctx.setdefault(_k, "")
            bundle["creative_pack"] = _visuals_creative_pack(ctx)
            # Must-not-break rules inline so the agent gets them even if it
            # never pulls another section. Functional only — no taste.
            bundle["must_follow"] = [
                "LayerBox geometry is %-only (no px).",
                "No chapter title cards inside cuts.",
                "Image/Video layers MUST carry an English search `query`; verify with search_media.",
                "Pair entrance animations (delay>0) with opacity fade 0->1; spatial-only allowed at delay 0.",
                "Full capability reference: declarative-ast Part 1 & Part 2 (11 layer types, universal controls, contracts, cut flags).",
            ]
            bundle["deep_read_required"] = (
                "save_visuals ALSO needs ≥1 full section pull from "
                "declarative-ast (briefs + this pack don't count). E.g. "
                "get_skill(skill_name='declarative-ast', section='layers', "
                "project_id=...).")
            bundle["layer_reference"] = _layer_reference()
            bundle["sample_cut"] = _sample_cut_template(video_format)
            bundle["storyboard"] = _visuals_storyboard_pack(ctx, project_id)
            bundle["next"] = ("Then: get_section_timings -> save_design -> "
                              "write a 1-line-per-cut beat plan (intent + "
                              "transition + query, see storyboard.beat_plan_template) "
                              "-> save_visuals(dry_run=true) per section, read "
                              "timing/variety, fix, then persist. "
                              "Pull deeper detail as needed, "
                              "e.g. get_skill('declarative-ast', section='layers').")
    except Exception as e:
        logger.error(f"MCP get_stage_skills failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    return bundle


@mcp.tool()
def append_skill_learning(
    skill_name: Annotated[
        str,
        Field(description=(
            "Canonical skill name (e.g. 'declarative-ast', 'visual-director-core', "
            "'motion-graphics-designer', 'scriptwriter', 'editor-qa'). "
            "Use list_skills() to get the full list."
        )),
    ],
    title: Annotated[
        str,
        Field(description=(
            "Short title for this learning (e.g. 'Map layer position silently ignored'). "
            "Becomes the ## heading. Keep it ≤ 80 chars."
        )),
    ],
    context: Annotated[
        str,
        Field(description=(
            "What project / scene type / prompt triggered this observation. "
            "E.g. 'Finance video, scene 4, tried to position Map layer at left: 30%'"
        )),
    ],
    observation: Annotated[
        str,
        Field(description=(
            "What actually happened — the failure, unexpected behavior, or new pattern discovered."
        )),
    ],
    fix_or_pattern: Annotated[
        str,
        Field(description=(
            "The concrete fix or pattern that should be added to SKILL.md. "
            "Be specific — e.g. 'Map and Particles are fullscreen; overlay Shape/Text on top instead of positioning them.'"
        )),
    ],
    status: Annotated[
        str,
        Field(description="Status of this learning: 'pending' (new observation) | 'confirmed' (seen multiple times) | 'folded' (already merged into SKILL.md)."),
    ] = "pending",
) -> dict:
    """**Append a learning observation to a skill's LEARNINGS.md file.**

    Use this whenever you discover a new edge case, production failure mode, or
    useful pattern during a video generation session. The LEARNINGS.md is an
    append-only log — it never modifies SKILL.md directly.

    A human reviews LEARNINGS.md periodically and folds confirmed learnings
    into the canonical SKILL.md. This is the safe auto-learning path.

    Rules:
    - ONLY writes to LEARNINGS.md inside a skill folder. Cannot write to SKILL.md
      or any file outside the skills directory.
    - Append-only: never truncates existing content.
    - skill_name must match a known skill (use list_skills() to check).

    When to call this:
    - You discover a rendering failure not documented in SKILL.md
    - You find a source selection mistake that caused a broken asset
    - You find a geometry/layout pattern that reliably works or breaks
    - You discover a new composition recipe worth naming
    """
    from backend.agent.skill_loader import skill_loader
    from pathlib import Path
    import datetime

    # ── Validate skill name ──────────────────────────────────────────────
    norm = _norm_skill(skill_name)
    all_skills = skill_loader.get_all_skills()
    # Accept either normalized or raw name
    matched_skill = all_skills.get(norm) or all_skills.get(skill_name)
    if not matched_skill:
        known = sorted({s.name for s in all_skills.values()})
        return {
            "ok": False,
            "error": (
                f"Skill {skill_name!r} not found. "
                f"Use list_skills() to see valid names. "
                f"Known: {known}"
            ),
        }

    import sys
    from backend.core.config import get_storage_dir

    # ── Resolve LEARNINGS.md path (skill directory) ──────────────────────
    skill_dir = None
    learnings_path = None
    try:
        if matched_skill.file_path:
            candidate_dir = Path(matched_skill.file_path).parent.resolve()
            candidate_path = (candidate_dir / "LEARNINGS.md").resolve()
            # Safety check: must stay inside the skill's directory
            if (candidate_dir in candidate_path.parents or candidate_path.parent == candidate_dir) and candidate_path.name == "LEARNINGS.md":
                skill_dir = candidate_dir
                learnings_path = candidate_path
    except Exception as e:
        logger.warning(f"MCP append_skill_learning: skill directory resolution note: {e}")

    # ── Validate inputs ──────────────────────────────────────────────────
    title = (title or "").strip()[:120]
    context = (context or "").strip()
    observation = (observation or "").strip()
    fix_or_pattern = (fix_or_pattern or "").strip()
    status = (status or "pending").strip().lower()
    if status not in ("pending", "confirmed", "folded"):
        status = "pending"
    if not title or not context or not observation or not fix_or_pattern:
        return {
            "ok": False,
            "error": "All fields (title, context, observation, fix_or_pattern) are required and must be non-empty.",
        }

    # ── Format the entry ─────────────────────────────────────────────────
    date_str = datetime.datetime.now().strftime("%Y-%m-%d")
    entry = (
        f"\n## [{date_str}] {title}\n"
        f"**Context**: {context}\n"
        f"**Observation**: {observation}\n"
        f"**Fix / Pattern**: {fix_or_pattern}\n"
        f"**Status**: {status}\n"
    )

    # ── Multi-Tier Append (Frozen/Read-Only Production Resilient) ─────────
    def _write_to(path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            # Bootstrap the file if it doesn't exist yet
            header = (
                f"# Learnings Log — {matched_skill.name}\n\n"
                "Auto-generated observations from production sessions.\n"
                "Reviewed and folded into SKILL.md periodically.\n\n---\n\n"
                "<!-- New learnings are appended below this line -->\n"
            )
            path.write_text(header, encoding="utf-8")
        with open(path, "a", encoding="utf-8") as f:
            f.write(entry)

    is_frozen = getattr(sys, "frozen", False)
    write_path = None
    write_errors = []

    # Tier 1: Normal editable workspace (only if not frozen in PyInstaller bundle)
    if not is_frozen and learnings_path is not None:
        try:
            _write_to(learnings_path)
            write_path = learnings_path
        except (PermissionError, OSError) as e:
            write_errors.append(f"skill directory write blocked ({e})")

    # Tier 2: Persistent User AppData Storage (%LOCALAPPDATA%/Narrato/storage/learnings)
    # Guaranteed writable even in frozen .exe / read-only program files / docker
    if write_path is None:
        try:
            storage_dir = get_storage_dir() / "learnings"
            fallback_path = (storage_dir / f"{matched_skill.name}_LEARNINGS.md").resolve()
            _write_to(fallback_path)
            write_path = fallback_path
        except Exception as e:
            write_errors.append(f"persistent storage write blocked ({e})")

    # Tier 3: Result delivery
    if write_path is not None:
        is_fallback = (learnings_path is None or write_path != learnings_path)
        logger.info(f"MCP append_skill_learning: appended to {write_path} (fallback={is_fallback})")
        return {
            "ok": True,
            "skill": matched_skill.name,
            "file": str(write_path),
            "entry_title": title,
            "status": status,
            "degraded": is_fallback,
            "storage_mode": "persistent_storage" if is_fallback else "skill_directory",
            "message": (
                f"Learning appended to {write_path.name}. "
                + ("NOTE: Environment is frozen/read-only; saved to persistent user storage fallback. " if is_fallback else "")
                + "A human will review and fold confirmed learnings into SKILL.md."
            ),
        }
    else:
        # Tier 3 fallback: in-memory safe return so agent workflow does NOT crash
        err_msg = "; ".join(write_errors)
        logger.warning(f"MCP append_skill_learning: all write targets failed ({err_msg})")
        return {
            "ok": True,
            "degraded": True,
            "skill": matched_skill.name,
            "entry_title": title,
            "status": status,
            "entry_text": entry.strip(),
            "message": (
                f"Storage environment is read-only ({err_msg}). "
                f"Learning recorded in session output (entry_text) without breaking execution."
            ),
        }


def _layer_reference() -> dict:
    """Capability index for the agent: what exists, not what to pick.

    Composition is the agent's creative decision — this lists the palette
    (11 types, cut flags, transitions) so it can use the full harness.
    """
    return {
        "layer_types": ["Image", "Video", "Text", "Chart", "Shape", "Map",
                        "HTML", "Lottie", "Particles", "Counter",
                        "Background"],
        "cut_flags": ["transition", "exit_transition", "emphasis", "mute_voiceover",
                      "mute_bg_music"],
        "transitions": ["cut", "none", "fade", "crossfade", "dissolve",
                        "slide_left", "slide_right", "slide_up",
                        "slide_down", "zoom_in", "zoom_out",
                        "glitch", "blur_focus", "flash", "wipe_right",
                        "iris_open", "rise", "flip"],
        "tip": "Compose each cut from any types/counts/geometry the schema allows; "
               "field semantics live in declarative-ast Part 1 & Part 2.",
    }


def _sample_cut_template(video_format: str) -> dict:
    """Canonical sample — delegates to validators.build_sample_cut (single SOT)."""
    from backend.agent.validators import build_sample_cut
    return build_sample_cut(video_format)


# Sections inlined into the visuals starter pack: the capability text the
# internal LLM gets injected that brief-only MCP agents never see.
# (skill name, section query, pack key).
_VISUALS_PACK_SECTIONS: tuple = (
    ("declarative-ast", "content types", "content_types"),
    ("declarative-ast", "advanced manipulation", "motion_grammar"),
    ("declarative-ast", "compose freely", "transitions"),
    ("visual-director-core", "choreography", "motion_fx"),
    ("visual-director-core", "compositing", "layer_types"),
    ("motion-graphics-designer", "geometry", "geometry"),
)


def _visuals_creative_pack(ctx: dict) -> dict:
    """Full high-value skill sections for the visuals starter pack.

    Each entry is {title, content} rendered for the project language/format.
    Failures degrade to a pointer (never fail the whole bundle). Recording:
    skills count toward the skill gate, but sections here do NOT count toward
    the deep-read gate — the agent must still pull ≥1 section itself.
    """
    from backend.agent.skill_loader import skill_loader
    pack: dict = {}
    for skill_name, query, key in _VISUALS_PACK_SECTIONS:
        try:
            sk = skill_loader.get_skill(skill_name, context="tool")
            if sk is None:
                continue
            found = sk.render_section(query, **ctx)
            if found:
                pack[key] = {"title": found["title"],
                             "content": f"## {found['title']}\n\n{found['body']}"}
            else:
                pack[key] = {"title": query, "content": "",
                             "note": f"Section {query!r} not found — pull via "
                                     f"get_skill('{skill_name}', section='...')."}
        except Exception as e:
            logger.warning(f"creative_pack {skill_name}/{query} failed: {e}")
            pack[key] = {"title": query, "content": "",
                         "note": "Render failed — pull via get_skill()."}
    return pack


def _visuals_storyboard_pack(ctx: dict, project_id: str) -> dict:
    """Storyboard planning step for MCP (mirrors the internal two-stage flow).

    The internal pipeline plans beats with the storyboard-planner skill before
    generating ASTs; MCP agents jump narration→cuts directly, which kills
    variety. This pack gives the planning content plus a beat-plan template:
    one line per cut written BEFORE save_visuals.
    """
    from backend.agent.skill_loader import skill_loader
    pack: dict = {
        "why": ("Plan beats before authoring cuts: default ONE continuous "
                "take per scene (establish → develop → evolve → resolve, "
                "word-synced); a 2nd cut only on a genuine beat shift, named "
                "in one justification line. Planned takes repeat by design, "
                "not by accident."),
        "beat_plan_template": (
            "Scene 3 (9.0s, 1 take, zoom_in): canvas=archive map + 9s drift | "
            "0-2.5 establish+draw route | 2.5-5 develop+pan | "
            "5(word@5.1)-7.5 evolve+gauge+highlight | 7.5-9 resolve+emphasis@8.0\n"
            "(one take per scene; 2nd cut only with 'because:' justification)"),
    }
    try:
        sk = skill_loader.get_skill("storyboard-planner", context="tool")
        if sk is not None:
            found = sk.render_section("plan structure", **ctx)
            if found:
                pack["plan_structure"] = (
                    f"## {found['title']}\n\n{found['body']}")
    except Exception as e:
        logger.warning(f"storyboard pack failed: {e}")
    return pack


@mcp.tool()
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def save_script(project_id: str, script: dict, force: bool = False) -> dict:
    """Validate and persist a complete video script.

    script = {title, introduction: {hook}, scenes: [{title, narration}],
              conclusion: {summary, cta?}}. All prose MUST already be in the
    project's language. Sub-visuals are reset to empty; downstream
    artifacts (voiceover, transcription, assets, design) are purged and the
    pipeline stage resets to post-script.
    MANDATORY FIRST: get_stage_skills('script', project_id) or
    get_skill('scriptwriter').
    Scene pacing: a 5-min landscape video REQUIRES 20-30 scenes at ~9s
    each (see outline_targets for exact per-format budgets). Under/over-scened
    or thin-narration scripts are rejected with SCRIPT_PACING_ERROR unless
    force=true (audited override — success carries a warning).
    """
    missing = _missing_stage_skills("script", project_id)
    if missing:
        return _skill_required_error("script", project_id, missing)
    try:
        return payloads.save_script_payload(project_id, script, force=force)
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
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def save_design(project_id: str, design: dict) -> dict:
    """Validate and persist the global design system
    ({theme_name, color_palette, typography, css_guidelines, fonts?}).
    Required before save_visuals so cuts bind to a design hash.
    MANDATORY FIRST: get_stage_skills('design', project_id) or
    get_skill('art-director-design-system')."""
    missing = _missing_stage_skills("design", project_id)
    if missing:
        return _skill_required_error("design", project_id, missing)
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

# Suggested first nap per stage for a wait=false → sleep → stage_status loop.
# Conservative on purpose: MCP-over-HTTP clients often time out tools around
# ~60s, and sleep() is uninterruptible server-side (unlike the chat twin,
# which wakes for Stop). chat_tools keeps a larger in-app table for the same
# stages — same intent, different transport constraints.
STAGE_SLEEP_SUGGESTIONS = {
    "generate_voiceover": 60, "transcribe": 60,
    "render": 60, "fetch_assets": 30,
}


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
    must always leave a visible task row instead of a stuck 'running'.

    Pushes a status-only UI tick: the task row + project status changed in
    the DB, so the open UI must refetch them instead of showing stale
    running/pending chips until the next window-focus fallback.
    """
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
    # files_changed=False: only task/status rows changed, no content files.
    _notify_ui_project_event("project_updated", project_id,
                             files_changed=False)


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
            _db.update_task(task_id, progress=float(pct), message=msg or "")
        except Exception:
            pass
        # Live UI: task rows only reach the open project via refetch — push
        # a throttled status-only tick so status/progress bars move without
        # spamming the bridge (each event costs the UI two local DB reads)
        # and without re-reading files, which don't change mid-stage.
        try:
            now = time.monotonic()
            if now - _progress._last_notify >= 5.0:
                _progress._last_notify = now
                _notify_ui_project_event("project_updated", project_id,
                                         files_changed=False,
                                         progress_tick=True)
        except Exception:
            pass

    try:
        _db.create_task(project_id, stage)
        _db.update_task(task_id, status="running", progress=0.0, message="Starting (MCP)...")
        _db.update_project(project_id, status="processing")
        _notify_ui_project_event("project_updated", project_id,
                                 files_changed=False)
        # Seed the throttle from the start tick so the first _progress
        # callback doesn't fire a back-to-back duplicate event.
        _progress._last_notify = time.monotonic()
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
        _notify_ui_project_event("project_updated", project_id)
        return {"ok": False, "error": "Stage cancelled.", "stage": stage,
                "cancelled": True}
    except Exception as e:
        logger.error(f"MCP run_stage {stage} failed for {project_id}: {e}", exc_info=True)
        _db.update_task(task_id, status="failed", error_message=str(e),
                        message=f"Failed: {str(e)[:80]}")
        _db.update_project(project_id, status="failed")
        _notify_ui_project_event("project_updated", project_id)
        return {"ok": False, "error": str(e), "stage": stage}
    _db.update_task(task_id, status="completed", progress=100.0, message="Step completed (MCP).")
    _maybe_complete_project(project_id)
    _notify_ui_project_event("project_updated", project_id)
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
            sleep_nap = STAGE_SLEEP_SUGGESTIONS.get(stage, 60)
            return {"ok": True, "accepted": True, "task_id": task_id,
                    "status": "submitted",
                    "hint": (f"Poll stage_status until status is completed/failed. This stage takes a while — "
                             f"call sleep({sleep_nap}) first, then stage_status, and repeat. "
                             "Run no other mutating tool while it is running.")}
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
def sleep(seconds: int = 60) -> dict:
    """Pause for a bounded time (max 120s per call), then continue.

    Use while a wait=false stage finishes: sleep, then stage_status, repeat
    until completed/failed. The slow three (generate_voiceover, transcribe,
    render) take minutes — sleep ~60s between polls (~30s for fetch_assets),
    staying under HTTP tool timeouts. Run no other mutating tool while the
    stage is running (they are locked until it settles); read-only probes
    are fine.
    """
    try:
        # OverflowError covers inf/1e999 (int(inf) raises); ValueError covers NaN.
        secs = int(float(str(seconds).strip() or 60))
    except (ValueError, TypeError, AttributeError, OverflowError):
        secs = 60
    # Keep in sync with chat_tools.SLEEP_MAX_SECONDS (one bound, two transports).
    secs = max(1, min(120, secs))
    time.sleep(secs)
    return {"ok": True, "slept_seconds": secs,
            "hint": "Time is up — now call stage_status for the running stage. "
                    "Do not start other work while its status is queued/running."}


@mcp.tool()
@_emit_project_event("project_updated")
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
@_emit_project_event("project_updated")
@_refuse_if_stage_running
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
@_emit_project_event("project_updated")
@_refuse_if_stage_running
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
@_emit_project_event("projects_changed", action="deleted")
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
                   "pixabay_photo", "pixabay_video", "youtube_video",
                   "archive_photo", "archive_video")


@mcp.tool()
def search_media(source: str, query: str, orientation: str = "landscape") -> dict:
    """**FOR MCP EXTERNAL AGENT ONLY — INTERNAL APP LLM IGNORE.** Check stock media availability BEFORE writing a query into a cut.
    Queries MUST be in English. API keys stay server-side; only results
    are returned. youtube_video verifies a match exists; archive_photo/archive_video
    search archive.org for public domain/historical media.
    Successful verifications are recorded session-wide: save_visuals reports
    any Image/Video query you did NOT verify here as unverified_queries."""
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
    payloads.record_verified_query(query.strip())
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
2. Visual Style (optional free text): Ask what look/mood they want (e.g. "warm editorial", "dark cinematic"). There are NO preset genres — invent palettes, typography, and compositions from the topic + hint.
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
    - MANDATORY GATE (server rejects without it): get_stage_skills('script', project_id)
      [or get_skill(scriptwriter)] → save_script (intro hook, scenes with narration,
      conclusion summary+cta; sub_visuals reset automatically)
    - SCENE PACING CONTRACT (all formats — a scene is a short visual beat ~7-12s, NOT a 60s chapter):
      landscape medium (~5m/300s): 20-30 scenes (~9s/~27w) | landscape long (~10m/600s): 40-55 scenes (~10s/~30w)
      | landscape extra_long (~15m/900s): 60-75 scenes (~11s/~33w)
      | portrait short (~60s): 4-6 scenes (~7s/~21w) | portrait medium (~90s): 6-8 scenes (~9s/~27w)
      | portrait long (~2m/120s): 8-12 scenes (~8s/~24w).
      create_project returns the exact target_scene_count and get_stage_skills('script', project_id)
      returns outline_targets (authoritative) — match them. save_script rejects under/over-scened
      or thin-narration scripts with SCRIPT_PACING_ERROR.
3. update_voice_settings (only if user chose non-default voice)
4. run_stage(generate_voiceover, wait=false) → sleep(60) → stage_status, repeat
   until completed. While it runs, call NOTHING mutating (server locks
   saves/clears/settings until it settles); read-only probes are fine.
5. run_stage(transcribe, wait=true is fine) → word timings ready.
   If it fails with "model ... is not downloaded", use
   update_transcribe_settings (whisper_model must be downloaded) and retry.
   Never edit the DB by hand.
  6. MANDATORY grounding — EASY 1-call path (server rejects save_visuals without it):
     get_stage_skills('visuals', project_id) returns briefs for
      visual-director-core + motion-graphics-designer + declarative-ast PLUS
      the full capability pack (layer reference, motion grammar,
      contracts), must-follow rules, a sample cut, and a storyboard pack
      — and satisfies the skill gate. It does NOT satisfy the deep-read gate: you must ALSO pull
      ≥1 full section via get_skill (e.g. declarative-ast section='content types'),
      or save_visuals is rejected with DEEP_READ_REQUIRED. Brief-only agents
      underuse the harness — the gate exists because of that.
     Granular alternative: get_skill(NAME, brief=true) for each of the three, then
     pull ONLY the sections you need via get_skill(NAME, section="...").
     Required reading: declarative-ast Part 1 & Part 2 (layer types, contracts,
     cut flags) + the motion/FX sections. Rules you must not skim past:
     LayerBox %-only geometry, no chapter title cards inside cuts.
  7. get_section_timings (TRUE audio durations + word timestamps per section
     + pushed creative_blueprint with layer reference + sample cut — use it)
  8. save_design (required once — cuts bind to its hash; MANDATORY GATE:
     get_stage_skills('design', project_id) first). Motion direction
     (transitions, text treatments, overlay/texture) is documented in the
     art-director + motion-graphics-designer skills.
  9. search_media to verify each English query resolves BEFORE writing the cut. Successful verifications are recorded session-wide — save_visuals reports any query you did NOT verify as unverified_queries (they fail at fetch_assets). No silent skipping.
  9b. BEAT PLAN per section (mirrors the internal storyboard stage — unplanned sections repeat by accident): write 1 line per planned cut (intent + transition + media query + layers) BEFORE authoring, e.g. `cut0: main reveal | slide_left | parliament building wide | <layers>`.
   10. save_visuals_batch for the WHOLE video, DRY-RUN FIRST (MANDATORY WORKFLOW, gates already satisfied in step 6;
      3 calls total: batch dry_run → fix failed indexes → re-dry-run ONLY
      the fixed sections → batch persist. Coverage is content-hashed:
      persisting edited-but-unvalidated content earns a nudge, so the
      re-dry-run is not optional.
      Single-section save_visuals exists for patches, but batch is the default —
      30 sections must NOT cost 60-90 calls).
        Durations auto-normalize to the audio length; no chapter title cards inside cuts; Text in project language except queries stay English.
     Per batch: save_visuals_batch(dry_run=true) → read per-section timing/variety/unverified_queries → fix failed indexes → persist. Persisting cold earns a nudge.
     AUTO-REPAIR (server-side, like the internal loop's correction turn):
      stray z_index keys are stripped and legacy layers[] shapes converted
      automatically — every fix lands in auto_fixed for you to verify.
      Only unmigratable shapes fail, always with a fix/retry_with patch:
      fix the JSON type and resubmit the section, NEVER drop the layer
      (dropping Chart/Map/Lottie/Particles to dodge a type error is how
      videos go flat — the validator accepts all 11 kinds).
    CAPABILITY NOTES (what the harness supports — composition is yours):
    - All 11 content kinds are valid per video (Image, Video, Text,
      Chart, Shape, Map, HTML, Lottie, Particles, Counter, Background). Any Lucide icon, particle overrides, chart tuning, Lottie URLs, yt offsets, loop/volume are allowed.
    - Cut-level tools: transitions (18 + aliases), emphasis punch-ins,
      mute_voiceover/mute_bg_music, motion_blur, camera_shake, FX filters,
      rack-focus blur/brightness keyframes, floating. Field semantics in declarative-ast Part 1 & Part 2.
    - Pair entrance animations (translateY, translateX, translateZ, scale, rotate, rotateX, rotateY)
      with a simultaneous opacity fade ({property: "opacity", from: 0, to: 1, ...})
      whenever delay > 0 so elements stay hidden until they move; spatial-only
      without fade is allowed ONLY for instant punch beats at delay: 0.
    The save_visuals response reports variety stats + normalizations +
    timing + unverified_queries:
     read them and enrich flat spots BEFORE moving on. A dry_run with zero
     warnings is the bar for persisting. The batch video_variety rollup is
     the whole-video verdict: uniform_signature=true with shallow depth
     means individually-valid but collectively flat — read the depth
     metrics (avg_layers_per_cut, deep_cuts_total) and enrich thin spots
     BEFORE persisting, not after review.
    Starting over: clear_visuals wipes ALL cuts (every section → []; narration,
    audio, transcription, design kept; downloads deleted too unless
    clear_assets=false). clear_assets deletes ONLY downloads (cuts/queries kept,
    so fetch_assets re-downloads without re-authoring). Both reset fetch_assets
    + render to pending. Never hand-edit script.json/manifests to clear — use these.
11. run_stage(fetch_assets, wait=false) → sleep(30) → stage_status, repeat
    until completed (same waiting rule as step 4).
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
    confirm_render=true, wait=false) → sleep(60) → stage_status → video_path.
    (review_frame on the mp4 for the final check)

## Gotchas
- Scene pacing: a scene is a short visual beat (~7-12s, exact in outline_targets), NOT a 60-second
  chapter. 5 scenes for a 5-minute video (or 3 scenes for a 90s portrait, 8 scenes for a
  10-minute video) is rejected by the pacing guardrail (SCRIPT_PACING_ERROR, floor 70% of min,
  ceiling 130% of max, min 40% of target words). Always match outline_targets
  scene counts: landscape medium 20-30 / long 40-55 / extra_long 60-75; portrait short
  4-6 / medium 6-8 / long 8-12.
- Durations: sub_visuals durations MUST sum to the section audio duration
  (the server normalizes, but gross mismatches mean mistimed visuals).
- Opacity fade: pair entrances with opacity fade whenever delay > 0 so elements stay hidden until they enter; spatial-only allowed at delay: 0.
- generate_visuals is NOT an MCP stage — YOU author visuals via save_visuals.
- run_stage(wait=true) blocks; over HTTP always use wait=false + sleep +
  stage_status for voiceover/transcribe/render (minutes long: sleep ~60s
  between polls, ~30s for fetch_assets — sleeps must stay comfortably under
  HTTP tool timeouts). Never run another mutating tool
  while a stage is queued/running — the server refuses them with
  awaiting_stage; sleep, then poll, until it completes.
- UI vs API Numbering: The UI is 1-based (Scene 1, Scene 2; Cut #1, Cut #2).
  In MCP tools (`get_visuals`, `save_visuals`, `probe_cut`, `probe_scene`, `probe_asset`, `review_frame`, `get_transcription`),
  you can pass 1-based `scene_number` and `cut_number` directly (e.g. `scene_number=1, cut_number=2`).
  If using 0-based `scene_index` and `cut_index`, remember that UI Scene 1 is `scene_index=0`, and Cut #1 is `cut_index=0`.
  Intro and conclusion sections do not have a scene index: use `section_type="introduction"` or `"conclusion"` with `cut_number` (or `cut_index`).
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
        "2. Visual Style (optional): free-text mood hint — no preset genres.\n"
        "3. Language: hi (Hindi) or en (English).\n"
        "4. Video Format: landscape (YouTube 16:9) or portrait (Reels/Shorts 9:16).\n"
        "5. Duration Mode: short/medium/long/extra_long based on format.\n"
        "6. Export Destination Folder: custom path or default exports dir.\n"
        "7. Voice: call list_voice_options and offer concrete voice choices.\n\n"
        "Wait for the user's answers, then call create_project and update_voice_settings. "
        "After create_project, read target_scene_count; after get_stage_skills('script', project_id), "
        "match outline_targets exactly (landscape medium 20-30 / long 40-55 / extra_long 60-75; "
        "portrait short 4-6 / medium 6-8 / long 8-12; each scene short (~7-12s per outline_targets), never 5 long scenes). "
        "Drive every stage through fetch_assets, then review_frame(mode=composition) per section, "
        "verifying with project_status — then STOP, present a review summary, "
        "and ask the user to review/edit in the app. "
        "Only render after explicit approval (run_stage(render, confirm_render=true))."
    )


@mcp.tool()
def review_frame(project_id: str, section_type: str = "scene", scene_index: int | None = None,
                 cut_index: int | None = None, scope: str = "cut",
                 mode: str = "auto", max_cells: int = 3,
                 scene_number: int | None = None, cut_number: int | None = None) -> object:
    """Snapshot WHAT the video looks like as ONE contact-sheet image.

    Targeting:
    - Pass 1-based `scene_number` and `cut_number` to match UI numbers directly
      (e.g., UI "Scene 1 Cut 2" -> scene_number=1, cut_number=2).
    - Alternatively pass 0-based `scene_index` and `cut_index` (scene_index=0, cut_index=1).
    - section_type: 'scene' | 'introduction' (or 'intro') | 'conclusion' (or 'outro').
      For introduction/conclusion, scene_index/scene_number are not needed.

    scope=cut: start/mid/end of one cut (motion in one glance).
    scope=section: mid-frame of each cut (scene progression, subsampled
    to max_cells). mode=auto prefers exact rendered pixels, else the
    pre-render asset lineup; mode=composition renders exact pre-render
    composition pixels headlessly (seconds per call, cached — the truth
    check before render, REQUIRES fetch_assets first so Image/Video
    local_path files exist); procedural (text-only) cuts report that
    explicitly. Returns metadata + a single JPEG (strip or grid).
    Composition metadata includes cache:{visuals_hash, hits, misses} —
    any save_visuals edit changes visuals_hash, so a post-patch re-review
    never returns pre-patch pixels.

    WORKFLOW: save_visuals (all sections) → fetch_assets → review_frame
    (mode=composition) per section. Reviewing before fetch_assets shows
    placeholders, not final visuals. If a fix adds a new query, re-run
    fetch_assets then re-review.
    """
    try:
        from backend.mcp import frames as _frames
        from mcp.server.mcpserver.utilities.types import Image as _Image
        meta, jpeg = _frames.build_review(
            project_id, section_type, scene_index, cut_index, scope, mode, max_cells,
            scene_number=scene_number, cut_number=cut_number,
        )
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
    durations sum to the reported duration. Includes display_label,
    1-based scene_number and cut_number for every section and cut. Run after transcribe."""
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
    scene_index: int | None = None,
    segment_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
    scene_number: int | None = None,
) -> dict:
    """Read word-level transcription data produced by the transcribe stage.

    Can be section-scoped (section_type: introduction | scene | conclusion;
    scene_index 0-based or scene_number 1-based matching UI) to inspect words
    and timestamps for ONE section, or by segment_id, or paginated across the whole
    video. Use to inspect word timings before designing kinetic text or repairing subtitles."""
    try:
        return payloads.get_transcription_payload(
            project_id, section_type, scene_index, segment_id, offset, limit,
            scene_number=scene_number,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP get_transcription failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def get_visuals(project_id: str, section_type: str, scene_index: int | None = None,
                cut_index: int | None = None,
                scene_number: int | None = None,
                cut_number: int | None = None) -> dict:
    """Read back sub_visuals for ONE section or a SINGLE cut.
    Symmetrical reader to save_visuals. Use this to inspect existing cuts before
    patching instead of reading the entire script.json or running shell scripts.

    Targeting:
    - Pass 1-based `scene_number` and `cut_number` to match UI numbers directly
      (e.g., UI "Scene 1 Cut 2" -> scene_number=1, cut_number=2).
    - Alternatively pass 0-based `scene_index` and `cut_index` (scene_index=0, cut_index=1).
    - section_type: 'scene' | 'introduction' (or 'intro') | 'conclusion' (or 'outro').
      For introduction/conclusion, scene_index/scene_number are not needed.

    Args:
        project_id: Unique project identifier.
        section_type: introduction | scene | conclusion.
        scene_index: Optional 0-based scene index (used only when section_type='scene').
        cut_index: Optional 0-based cut index (pass -1 or omit to get all cuts in the section).
        scene_number: Optional 1-based scene number matching UI (e.g. 1 for Scene 1).
        cut_number: Optional 1-based cut number matching UI (e.g. 1 for Cut #1).
    """
    try:
        return payloads.get_visuals_payload(
            project_id, section_type, scene_index,
            cut_index=cut_index,
            scene_number=scene_number,
            cut_number=cut_number,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP get_visuals failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def probe_cut(project_id: str, section_type: str, scene_index: int | None = None,
              cut_index: int | None = None,
              scene_number: int | None = None,
              cut_number: int | None = None) -> dict:
    """Inspect ONE cut: full JSON + timing + per-layer asset files.
    Read-only. Use before/after save_visuals(cut_index=N) instead of reading
    script.json by hand.

    Targeting:
    - Pass 1-based `scene_number` and `cut_number` to match UI numbers directly
      (e.g., UI "Scene 1 Cut 2" -> scene_number=1, cut_number=2).
    - Alternatively pass 0-based `scene_index` and `cut_index`.
    """
    try:
        from backend.mcp import probe as _probe
        return _probe.probe_cut_payload(
            project_id, section_type, scene_index, cut_index,
            scene_number=scene_number, cut_number=cut_number,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP probe_cut failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def probe_scene(project_id: str, section_type: str,
                scene_index: int | None = None,
                scene_number: int | None = None) -> dict:
    """Inspect ONE section: per-cut summaries + timing rollups +
    variety. Read-only. Use to find which cut to fix, then probe_cut it.

    Targeting:
    - Pass 1-based `scene_number` matching UI (e.g. scene_number=1 for Scene 1).
    - Alternatively pass 0-based `scene_index` (e.g. scene_index=0).
    """
    try:
        from backend.mcp import probe as _probe
        return _probe.probe_scene_payload(
            project_id, section_type, scene_index,
            scene_number=scene_number,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP probe_scene failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
def probe_asset(project_id: str, section_type: str, scene_index: int | None = None,
                cut_index: int | None = None, layer_index: int = 0,
                scene_number: int | None = None,
                cut_number: int | None = None) -> dict:
    """File truth for ONE media layer: query/source → downloaded file?
    Read-only. Reports exists/size/dimensions/duration + fix when missing.

    Targeting:
    - Pass 1-based `scene_number` and `cut_number` matching UI numbers.
    - Alternatively pass 0-based `scene_index` and `cut_index`.
    """
    try:
        from backend.mcp import probe as _probe
        return _probe.probe_asset_payload(
            project_id, section_type, scene_index, cut_index, layer_index,
            scene_number=scene_number, cut_number=cut_number,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP probe_asset failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@mcp.tool()
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def save_visuals(project_id: str, section_type: str, sub_visuals: list,
                 scene_index: int | None = None, cut_index: int | None = None,
                 dry_run: bool = False, auto_migrate: bool = False,
                 scene_number: int | None = None,
                 cut_number: int | None = None) -> dict:
    """Validate and persist sub_visuals for ONE section
    (section_type: introduction | scene | conclusion; scene_index/scene_number used
    only for scene). Durations are auto-normalized to the section's audio
    length; Image/Video layers MUST carry an English search `query`.
    Repeat per section, then run fetch_assets BEFORE review_frame
    (mode=composition needs downloaded local_path files).

    Targeting:
    - Pass 1-based `scene_number` and `cut_number` matching UI numbers directly
      (e.g., UI "Scene 1 Cut 2" -> scene_number=1, cut_number=2).
    - Alternatively pass 0-based `scene_index` and `cut_index` (scene_index=0, cut_index=1).
    - For whole-section updates, omit cut_number and cut_index.
    - For single-cut patches, supply cut_number or cut_index and a 1-element sub_visuals array.
    - Introduction and Conclusion: pass section_type="introduction" (or "intro") /
      section_type="conclusion" (or "outro") and cut_number (or cut_index).
    Canonical cut shape ONLY: {duration, transition?, exit_transition?,
    composition:{type:Sequence, children:[{type:Layer,
    content:{type, query/source/text/...,
    style:{left/top/width/height % strings}}, animations, filters}]}}.
    AUTO-REPAIR (like the internal loop's correction turn): stray
    z_index/zIndex keys are stripped and legacy layers[]/layout shapes get
    a best-effort conversion automatically — every fix is listed in
    auto_fixed for you to verify, and conversions flag a review warning.
    Only unmigratable shapes are rejected with SCHEMA_MISMATCH, always
    with a fix/retry_with patch (fix the type, resubmit — never drop the
    layer). Prefer save_visuals_batch for whole videos (2 calls total).

    MANDATORY FIRST: get_stage_skills('visuals', project_id) or all three
    get_skill(declarative-ast + visual-director-core + motion-graphics-designer),
    PLUS ≥1 full section pull from declarative-ast (e.g. section='layers')
    — briefs alone underuse the harness and are rejected with DEEP_READ_REQUIRED.
    Write a 1-line-per-cut beat plan (intent + transition + query, see the
    starter pack's storyboard template) BEFORE authoring cuts.
    WORKFLOW PER SECTION (mandatory): save_visuals(dry_run=true) first, read
    timing/variety/unverified_queries, fix, then persist. Persisting
    without a dry_run pass earns a nudge; agents that iterate dry_run produce
    visibly better videos.
    cut_index >= 0 (or cut_number >= 1) patches a SINGLE cut (pass sub_visuals as a 1-element
    array holding just that cut) instead of resending the whole section —
    use after review_frame flags one bad cut (re-run fetch_assets if the
    patch adds a new query, then re-review). dry_run=true validates and
    returns the normalized result WITHOUT writing anything.
    Image/Video queries SHOULD be verified via search_media first —
    unverified queries are reported back (unverified_queries) and fail at
    fetch_assets.
    The response ALWAYS includes variety stats + normalizations +
    timing (delay+duration fit, emphasis fit, fade pairing, motion_blur,
    easing) reports — read them: enrich thin (single-layer) sections before
    moving on. Delays are absolute seconds
    within the FINAL cut duration (post-renorm), not scaled. Capability
    reference lives in the pipeline guide and the declarative-ast
    skill, not in this description."""
    dry_run = _coerce_bool(dry_run, False)
    if not dry_run:
        missing = _missing_stage_skills("visuals", project_id)
        if missing:
            return _skill_required_error("visuals", project_id, missing)
        deep = _missing_deep_reads("visuals", project_id)
        if deep:
            return _deep_read_required_error("visuals", project_id, deep)
    try:
        return payloads.save_visuals_payload(
            project_id, section_type, sub_visuals, scene_index,
            cut_index=cut_index,
            scene_number=scene_number,
            cut_number=cut_number,
            dry_run=dry_run, auto_migrate=bool(auto_migrate))
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP save_visuals failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


def _coerce_bool(value, default: bool = True) -> bool:
    """Lenient bool for MCP flags: bool("false") is True, so string
    "false"/"0"/"no"/"off" map to False explicitly instead."""
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "no", "off", "")
    return default if value is None else bool(value)


def _claim_project_marker(project_id: str, op: str) -> tuple:
    """Register an inline marker so run_stage sees this project as busy.

    Closes the check-then-act gap: without it a stage could start between
    the guard check and the file writes and both would touch manifests.
    Returns (task_id, marker) — caller must release the marker in a
    finally. When busy, returns (None, error_dict) instead."""
    task_id = f"{project_id}_{op}"
    with _STAGE_LOCK:
        active = _project_active_stage(project_id)
        if active is not None:
            return None, {"ok": False,
                          "error": f"Project {project_id!r} has a running MCP stage ({active}); "
                                   f"cancel_stage it first, then retry."}
        marker = object()
        _STAGE_FUTURES[task_id] = marker  # type: ignore[assignment]
        return task_id, marker


def _release_project_marker(task_id: str | None, marker) -> None:
    if task_id is None:
        return
    with _STAGE_LOCK:
        if _STAGE_FUTURES.get(task_id) is marker:
            _STAGE_FUTURES.pop(task_id, None)


@mcp.tool()
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def save_visuals_batch(project_id: str, sections: list,
                       dry_run: bool = False) -> dict:
    """Validate/persist sub_visuals for MANY sections in ONE call.

    Each item: {section_type, sub_visuals, scene_index?, cut_index?, scene_number?, cut_number?}.
    Supports 1-based scene_number (matches UI Scene N) and cut_number (matches UI Cut #N),
    as well as 0-based scene_index and cut_index.
    A 30-section video costs 3 calls (batch dry_run → re-dry-run fixed
    sections → batch persist) instead of 60-90 — default ONE continuous
    take per scene (living canvas: camera drift + exit/stagger +
    word-synced reveals, see visual-director-core §2/§5); add a 2nd cut
    only on a genuine beat shift, with a one-line justification in the plan.
    Sections are independent: one bad section never blocks the rest; the
    response tells you exactly which indexes failed with fix/retry_with
    patches. Same canonical cut shape, auto-repair, and variety/timing
    reports as save_visuals, per section, plus a whole-video
    video_variety rollup (uniform-signature and zero-energy detection).
    Duplicate section targets and negative cut_index values are rejected
    (omit cut_index/cut_number for a whole-section replace).
    MANDATORY FIRST (persist only): same visuals grounding as save_visuals
    (get_stage_skills('visuals') + ≥1 declarative-ast section pull).
    WORKFLOW: save_visuals_batch(dry_run=true) → fix failed indexes →
    re-dry-run fixed sections → save_visuals_batch(dry_run=false) →
    fetch_assets → review_frame. Holds a project marker while running, so
    run_stage cannot interleave mid-batch."""
    dry_run = _coerce_bool(dry_run, False)
    if not dry_run:
        missing = _missing_stage_skills("visuals", project_id)
        if missing:
            return _skill_required_error("visuals", project_id, missing)
        deep = _missing_deep_reads("visuals", project_id)
        if deep:
            return _deep_read_required_error("visuals", project_id, deep)
    task_id, marker = _claim_project_marker(project_id, "save_visuals_batch")
    if task_id is None:
        return marker
    try:
        return payloads.save_visuals_batch_payload(
            project_id, sections, dry_run=dry_run)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP save_visuals_batch failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    finally:
        _release_project_marker(task_id, marker)


@mcp.tool(annotations=ToolAnnotations(destructiveHint=True))
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def clear_visuals(project_id: str, clear_assets: bool = True) -> dict:
    """Delete ALL generated visual ASTs (every section's sub_visuals → []).

    Wipes script.json plus the voiceover and assets manifests (both, so the
    twins can never disagree). Narration, voiceover audio, transcription,
    and design.json are untouched. Cannot be undone — re-author with
    save_visuals afterwards.
    clear_assets=True (default) also deletes downloaded asset files
    (orphaned asset_* files would otherwise linger with no referencing
    cut). Pass false to keep downloads and re-author against the same media.
    fetch_assets + render reset to pending either way.
    Refused while an MCP stage is running on the project."""
    task_id, marker = _claim_project_marker(project_id, "clear_visuals")
    if task_id is None:
        return marker
    try:
        return payloads.clear_visuals_payload(
            project_id, clear_assets=_coerce_bool(clear_assets, True))
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP clear_visuals failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    finally:
        _release_project_marker(task_id, marker)


@mcp.tool(annotations=ToolAnnotations(destructiveHint=True))
@_emit_project_event("project_updated")
@_refuse_if_stage_running
def clear_assets(project_id: str) -> dict:
    """Delete ALL downloaded asset files (assets/asset_*, preview_*,
    assets_manifest.json, previews) and strip their local_path/asset_url
    pointers from script.json + manifests. AST queries/structure are kept,
    so run_stage(fetch_assets) re-downloads without re-authoring.
    fetch_assets + render reset to pending. Cannot be undone.
    Refused while an MCP stage is running on the project."""
    task_id, marker = _claim_project_marker(project_id, "clear_assets")
    if task_id is None:
        return marker
    try:
        return payloads.clear_assets_payload(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.error(f"MCP clear_assets failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}
    finally:
        _release_project_marker(task_id, marker)


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
