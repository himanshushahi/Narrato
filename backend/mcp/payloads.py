"""Shared, LLM-free payload logic for the Narrato MCP server.

This module is the "hands" half of the pipeline: validation, hashing,
file writes, downstream invalidation and DB updates. It mirrors the save
semantics of ``backend.pipeline.ai`` (script assembly + visuals manifest
sync) WITHOUT making any LLM call — the calling agent supplies all
creative content (narration, design, sub-visual ASTs).

Accesses ``backend.database.db`` via the module attribute (``_db``) so
tests can monkeypatch ``backend.database.db.*`` following the existing
tests/ convention. Project-dir resolution and the script hash delegate
to their canonical implementations (agent tools / pipeline ai).
"""

import hashlib
import json
from pathlib import Path

from backend.database import db as _db
from backend.core.logger import logger

# Sections the agent may target with save_visuals.
SECTION_TYPES = ("introduction", "scene", "conclusion")


def _normalize_section_type(raw: str) -> str:
    """Normalize section_type aliases to canonical names ('introduction', 'scene', 'conclusion')."""
    s = str(raw or "").strip().lower()
    if s in ("introduction", "intro", "hook", "intro_scene", "opening"):
        return "introduction"
    if s in ("conclusion", "outro", "cta", "summary", "ending", "end", "end card", "conclusion_scene"):
        return "conclusion"
    if s in ("scene", "scenes", "chapter"):
        return "scene"
    return s


def format_display_label(section_type: str, scene_index: int = 0, cut_index: int | None = None) -> str:
    """Format a consistent 1-based display label matching the UI (e.g. 'Scene 1 : Cut #2')."""
    norm_sec = _normalize_section_type(section_type)
    if norm_sec == "introduction":
        base = "Introduction"
    elif norm_sec == "conclusion":
        base = "Conclusion"
    elif norm_sec == "scene":
        base = f"Scene {scene_index + 1}"
    else:
        # Unknown/corrupt section_type: preserve raw value, never mislabel as Scene.
        base = str(section_type)
    if cut_index is not None and cut_index >= 0:
        return f"{base} : Cut #{cut_index + 1}"
    return base


def _coerce_int_param(name: str, value) -> tuple[int | None, str | None]:
    """Lenient int coercion preserving back-compat (int, integral float, numeric string).

    Accepts 1, 1.0, "1", " 2 ". Rejects bool, 1.5, "abc", None (None = absent).
    Returns (coerced_int_or_None_when_absent, error_message_or_None).
    """
    if value is None:
        return None, None
    if isinstance(value, bool):
        return None, f"{name} must be an integer (got {value!r})."
    if isinstance(value, int):
        return value, None
    if isinstance(value, float):
        if value.is_integer():
            return int(value), None
        return None, f"{name} must be an integer (got {value!r})."
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None, f"{name} must be an integer (got {value!r})."
        try:
            # Accept "3" and "3.0", reject "3.5" and "abc".
            f = float(s)
            if f.is_integer():
                return int(f), None
        except (TypeError, ValueError):
            pass
        return None, f"{name} must be an integer (got {value!r})."
    return None, f"{name} must be an integer (got {value!r})."


def resolve_scene_and_cut(
    section_type: str,
    scene_index: int | None = None,
    scene_number: int | None = None,
    cut_index: int | None = None,
    cut_number: int | None = None,
    default_scene: int = 0,
    default_cut: int | None = None,
    allow_negative_cut: bool = True,
) -> tuple[str, int, int | None, str | None]:
    """Resolve section_type, scene_index, cut_index from dual 0-based and 1-based params.

    Returns: (normalized_section_type, final_scene_index, final_cut_index, error_message)
    error_message is None on success.

    Rules:
    - Normalizes section_type aliases ('intro', 'outro', 'hook', 'cta', 'chapter', etc.).
    - scene_number is 1-based: scene_number=1 maps to scene_index=0.
    - cut_number is 1-based: cut_number=1 maps to cut_index=0.
    - If both index and number are given, they must agree (index == number - 1),
      otherwise returns an error with an actionable hint.
    - Non-positive numbers (e.g. 0) are rejected with a hint explaining numbers are 1-based.
    - For 'introduction' and 'conclusion', scene_index is coerced to 0 (never errors on scene_index).
    """
    norm_sec = _normalize_section_type(section_type)
    if norm_sec not in SECTION_TYPES:
        return norm_sec, 0, None, f"section_type must be one of {list(SECTION_TYPES)} (got {section_type!r})."

    # Validate scene_number if passed
    parsed_scene_number = None
    if scene_number is not None:
        coerced, num_err = _coerce_int_param("scene_number", scene_number)
        if num_err:
            return norm_sec, 0, None, num_err
        parsed_scene_number = coerced
        if parsed_scene_number <= 0:
            return norm_sec, 0, None, (
                f"scene_number {parsed_scene_number} is invalid: numbers are 1-based "
                f"(e.g. Scene 1 = scene_number=1). Use scene_index for 0-based indexing."
            )

    # Validate scene_index if passed (negatives rejected early — no nonsense UI Scene 0 hints)
    parsed_scene_index = None
    if scene_index is not None:
        coerced, idx_err = _coerce_int_param("scene_index", scene_index)
        if idx_err:
            return norm_sec, 0, None, idx_err
        parsed_scene_index = coerced
        if parsed_scene_index is not None and parsed_scene_index < 0:
            return norm_sec, 0, None, (
                f"scene_index must be >= 0 (got {parsed_scene_index}). "
                f"UI Scene 1 = scene_index 0; use scene_number for 1-based numbering."
            )

    # Conflict check
    if parsed_scene_number is not None and parsed_scene_index is not None and norm_sec == "scene":
        if parsed_scene_index != parsed_scene_number - 1:
            return norm_sec, 0, None, (
                f"Index/Number conflict: scene_index={parsed_scene_index} (0-based, UI Scene {parsed_scene_index + 1}) "
                f"does not match scene_number={parsed_scene_number} (1-based, index {parsed_scene_number - 1}). "
                f"Pass either scene_number={parsed_scene_number} (1-based) OR scene_index={parsed_scene_number - 1} (0-based)."
            )

    if norm_sec in ("introduction", "conclusion"):
        final_scene_index = 0
    elif parsed_scene_number is not None:
        final_scene_index = parsed_scene_number - 1
    elif parsed_scene_index is not None:
        final_scene_index = parsed_scene_index
    else:
        final_scene_index = default_scene

    # Validate cut_number if passed
    parsed_cut_number = None
    if cut_number is not None:
        coerced, num_err = _coerce_int_param("cut_number", cut_number)
        if num_err:
            return norm_sec, final_scene_index, None, num_err
        parsed_cut_number = coerced
        if parsed_cut_number <= 0:
            return norm_sec, final_scene_index, None, (
                f"cut_number {parsed_cut_number} is invalid: numbers are 1-based "
                f"(e.g. Cut 1 = cut_number=1). Use cut_index for 0-based indexing."
            )

    # Validate cut_index if passed
    parsed_cut_index = None
    if cut_index is not None:
        coerced, idx_err = _coerce_int_param("cut_index", cut_index)
        if idx_err:
            return norm_sec, final_scene_index, None, idx_err
        parsed_cut_index = coerced
        if not allow_negative_cut and parsed_cut_index < 0:
            return norm_sec, final_scene_index, None, f"cut_index must be a non-negative integer or omitted (got {parsed_cut_index})."

    # Conflict check (fires even for negative cut_index: cut_index=-1 + cut_number=2 must error)
    if parsed_cut_number is not None and parsed_cut_index is not None:
        if parsed_cut_index != parsed_cut_number - 1:
            return norm_sec, final_scene_index, None, (
                f"Index/Number conflict: cut_index={parsed_cut_index} (0-based, UI Cut #{parsed_cut_index + 1}) "
                f"does not match cut_number={parsed_cut_number} (1-based, index {parsed_cut_number - 1}). "
                f"Pass either cut_number={parsed_cut_number} (1-based) OR cut_index={parsed_cut_number - 1} (0-based)."
            )

    if parsed_cut_number is not None:
        final_cut_index = parsed_cut_number - 1
    elif parsed_cut_index is not None and parsed_cut_index >= 0:
        final_cut_index = parsed_cut_index
    elif parsed_cut_index is not None and parsed_cut_index < 0:
        final_cut_index = None
    else:
        final_cut_index = default_cut

    return norm_sec, final_scene_index, final_cut_index, None


def format_target_error(err: str, project_id: str | None = None) -> dict:
    """Format structured, actionable error for resolve_scene_and_cut failures."""
    err_dict = {"ok": False, "error": err}
    if "Index/Number conflict" in err:
        err_dict["error_code"] = "INDEX_NUMBER_CONFLICT"
        err_dict["fix"] = {"hint": "Pass either 1-based number (scene_number/cut_number) OR 0-based index (scene_index/cut_index), not conflicting values."}
    elif "numbers are 1-based" in err:
        err_dict["error_code"] = "INVALID_1BASED_NUMBER"
        err_dict["fix"] = {"hint": "Scene and cut numbers in Narrato UI are 1-based (Scene 1, Cut #1). For 0-based indexing use scene_index or cut_index."}
    elif "must be >= 0" in err or "non-negative integer" in err:
        err_dict["error_code"] = "NEGATIVE_INDEX"
        err_dict["fix"] = {"hint": "Indices must be non-negative integers (0, 1, 2, ...)."}
    elif "section_type must be one of" in err:
        err_dict["error_code"] = "INVALID_SECTION_TYPE"
        err_dict["allowed_section_types"] = list(SECTION_TYPES)
        err_dict["fix"] = {"hint": f"section_type must be one of: {list(SECTION_TYPES)}"}
    elif "must be an integer" in err:
        err_dict["error_code"] = "INVALID_INTEGER"
        err_dict["fix"] = {"hint": "Provide index and number parameters as integers."}
    else:
        err_dict["error_code"] = "INVALID_SECTION_TARGET"
        err_dict["fix"] = {"hint": "Verify section_type, scene_number/scene_index, and cut_number/cut_index."}
    if project_id:
        err_dict["project_id"] = project_id
    return err_dict

# Session-wide verified media queries (recorded by search_media on success).
# save_visuals reports any Image/Video query absent here as unverified —
# verification used to be prose-only ("verify BEFORE writing") that agents
# stopped following after the first beats. Matching is case/space-insensitive.
import threading as _payloads_threading
_VERIFIED_QUERIES: set = set()
_VERIFIED_LOCK = _payloads_threading.Lock()
# Sections dry-run before persist, per (project_id, section, scene_index).
# Persisting cold earns a nudge toward the dry_run-first workflow.
# Coverage is content-hashed: a dry-run covers the exact normalized cuts it
# validated, so fixed-then-persisted content still earns the nudge (it was
# never validated) — re-dry-run fixed sections instead.
_DRY_RUN_SECTIONS: set = set()
_DRY_RUN_HASHES: dict = {}


def _normalized_cuts_hash(normalized) -> str:
    """Content hash of normalized cuts for dry-run coverage matching."""
    try:
        return hashlib.md5(
            json.dumps(normalized, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    except Exception:
        return ""


def _format_json_syntax_snippet(raw: str, err: Exception) -> dict | None:
    """Extract a visual error window with pointer for JSON decode errors."""
    if not isinstance(err, json.JSONDecodeError):
        return None
    pos = getattr(err, "pos", None)
    if pos is None:
        return None
    start = max(0, pos - 50)
    end = min(len(raw), pos + 50)
    snippet_text = raw[start:end]
    offset = pos - start
    pointer = " " * offset + "^--- [Syntax error here]"
    return {
        "line": getattr(err, "lineno", None),
        "column": getattr(err, "colno", None),
        "char_index": pos,
        "context": f"{snippet_text}\n{pointer}",
    }


def _coerce_json_array(value, field_name: str, array_label: str | None = None):
    """Accept a JSON-encoded string for an array field (defense in depth).

    Some MCP clients double-encode large nested args (e.g. Counter+style or
    Map payloads) so the tool entry point receives a str instead of a list.
    FastMCP's strict `list` annotation then rejects the whole call with
    "Input should be a valid list (input_type=str)" before validation runs.
    Parsing here lets the payload validate normally; unparseable strings
    still fail with a field-level error naming the fix (send an array).
    Returns (parsed_or_original, was_coerced, error_dict_or_None).
    """
    if isinstance(value, list):
        return value, False, None
    label = array_label or ("sections" if "section" in field_name.lower() else "cuts")
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return value, False, {
                "ok": False,
                "error_code": "EMPTY_JSON_ARRAY",
                "error": (f"{field_name} must be a non-empty array (got empty string). "
                          f"Send the {label} array directly, not a JSON-encoded string."),
                "field": field_name,
                "fix": {
                    "hint": f"Send the {label} array directly as a list, e.g. {field_name}: [{{...}}], not an empty string."
                },
            }
        parsed = None
        parse_err = None
        try:
            parsed = json.loads(raw)
        except Exception as e:
            parse_err = e
            try:
                from backend.pipeline.ai import clean_json_response
                repaired = clean_json_response(raw)
                if isinstance(repaired, list):
                    parsed = repaired
                    parse_err = None
                    logger.info("_coerce_json_array: auto-repaired %s JSON string (%s items)",
                                field_name, len(parsed))
            except Exception:
                pass

        if parse_err is not None:
            logger.warning("save_visuals: %s arrived as an unparseable string (%s chars): %s",
                           field_name, len(raw), parse_err)
            snippet_info = _format_json_syntax_snippet(raw, parse_err)
            example_val = (
                f'"{field_name}": [{{"section_type": "scene", "sub_visuals": [...]}}]'
                if label == "sections"
                else f'"{field_name}": [{{"duration": 3.0, "composition": {{...}}}}]'
            )
            err_dict = {
                "ok": False,
                "error_code": "INVALID_JSON_SYNTAX",
                "error": (f"{field_name} arrived as a string that is not valid JSON ({parse_err}). "
                          f"Send the {label} array directly, not a JSON-encoded string."),
                "field": field_name,
                "fix": {
                    "hint": f"Send {field_name} directly as a JSON/Python array of objects, not a JSON-encoded string.",
                    "example": example_val,
                },
            }
            if snippet_info:
                err_dict["syntax_error"] = snippet_info
            return value, False, err_dict

        if not isinstance(parsed, list):
            return value, False, {
                "ok": False,
                "error_code": "NOT_AN_ARRAY",
                "error": (f"{field_name} arrived as a JSON string holding "
                          f"{type(parsed).__name__}, not an array. "
                          f"Send the {label} array directly."),
                "field": field_name,
                "got_type": type(parsed).__name__,
                "fix": {
                    "hint": f"Wrap the items inside an array: [ ... ], not a bare {type(parsed).__name__}."
                },
            }
        logger.warning("save_visuals: %s arrived as a JSON string (%s chars) — parsed "
                       "to a %s-element array instead of rejecting.",
                       field_name, len(raw), len(parsed))
        return parsed, True, None
    return value, False, None


def _normalize_query(query) -> str:
    return " ".join(str(query or "").lower().split())


def record_verified_query(query: str) -> None:
    norm = _normalize_query(query)
    if not norm:
        return
    with _VERIFIED_LOCK:
        _VERIFIED_QUERIES.add(norm)


def unverified_media_queries(sub_visuals) -> list:
    """Image/Video queries with no successful search_media hit this session."""
    found: list = []
    seen: set = set()
    cuts = sub_visuals if isinstance(sub_visuals, list) else []
    for cut in cuts:
        if not isinstance(cut, dict):
            continue
        comp = cut.get("composition") or {}
        children = comp.get("children") or []
        if not isinstance(children, list):
            continue
        for layer in children:
            if not isinstance(layer, dict):
                continue
            content = layer.get("content")
            if not isinstance(content, dict):
                continue
            if content.get("type") not in ("Image", "Video"):
                continue
            q = _safe_str(content.get("query")).strip()
            if not q:
                continue
            with _VERIFIED_LOCK:
                verified = _normalize_query(q) in _VERIFIED_QUERIES
            if not verified and q not in seen:
                seen.add(q)
                found.append(q)
    return found

# Mirrors the required-keys check in ai.generate_project_design_system.
REQUIRED_DESIGN_KEYS = {"theme_name", "color_palette", "typography", "css_guidelines"}


def _safe_str(value, default=""):
    return value if isinstance(value, str) else default


def _project_dir(project_id: str) -> Path:
    """Resolve a project's storage dir. Single implementation lives in
    backend.agent.tools; this alias keeps MCP imports local."""
    from backend.agent.tools import _project_dir as _guarded_dir
    return _guarded_dir(project_id)


def _get_project_or_raise(project_id: str) -> dict:
    proj = _db.get_project(project_id)
    if not proj:
        raise ValueError(
            f"Project {project_id!r} not found in database. "
            f"Call list_projects for valid ids, or create_project to make one.")
    return proj


# Valid cut transition enum (mirrors SubVisualAST's schema docstring in
# backend.agent.schemas — single source of truth). Surfaced inline in the
# variety "not a valid enum value" normalization notices so agents can pick
# a valid value without an extra skill read.
_VALID_TRANSITIONS: tuple = (
    "cut", "fade", "crossfade", "dissolve", "slide_left", "slide_right",
    "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "blur_focus",
    "flash", "wipe_right", "iris_open", "rise", "flip", "none",
)


def compute_project_script_hash(project_dict: dict) -> str:
    """Project-properties hash stored on script.json as _project_hash.

    Single implementation lives in backend.pipeline.ai; this wrapper keeps
    MCP imports local while guaranteeing is_script_stale() can never
    disagree with us.
    """
    from backend.pipeline.ai import compute_project_script_hash as _ai_hash
    return _ai_hash(project_dict)


def purge_downstream_artifacts(project_dir: Path) -> list:
    """Delete everything downstream of the script (mirrors the cleanup in
    ai.generate_script_pipeline + design.json invalidation). Returns the
    list of removed relative paths for reporting."""
    removed = []

    def _rm(path: Path, label: str):
        try:
            if path.is_file() or path.is_symlink():
                path.unlink()
                removed.append(label)
            elif path.is_dir():
                for child in path.iterdir():
                    _rm(child, f"{label}/{child.name}")
        except Exception as e:
            logger.warning(f"purge_downstream_artifacts: could not delete {path}: {e}")

    # Design system belongs to the visuals stage — a new script invalidates it.
    _rm(project_dir / "design.json", "design.json")
    # Voiceover artifacts.
    voice_dir = project_dir / "voiceover"
    if voice_dir.is_dir():
        for child in voice_dir.iterdir():
            if child.is_file():
                _rm(child, f"voiceover/{child.name}")
    _rm(project_dir / "voiceover.wav", "voiceover.wav")
    # Transcription artifacts.
    _rm(project_dir / "subtitles" / "transcription.json", "subtitles/transcription.json")
    _rm(project_dir / "subtitles" / "transcription.srt", "subtitles/transcription.srt")
    _rm(project_dir / "subtitles" / "transcription.vtt", "subtitles/transcription.vtt")
    _rm(project_dir / "transcribe.hash.txt", "transcribe.hash.txt")
    # Downloaded / generated visual assets + manifests + previews.
    assets_dir = project_dir / "assets"
    if assets_dir.is_dir():
        for child in assets_dir.iterdir():
            name = child.name
            if child.is_dir() and name == "previews":
                _rm(child, "assets/previews")
            elif child.is_file() and (
                name.startswith("asset_") or name.startswith("preview_") or name == "assets_manifest.json"
            ):
                _rm(child, f"assets/{name}")
    # Staged background music / clips (re-created by later stages).
    _rm(project_dir / "bg_music.mp3", "bg_music.mp3")
    audio_dir = project_dir / "audio"
    if audio_dir.is_dir():
        for child in audio_dir.iterdir():
            if child.is_file():
                _rm(child, f"audio/{child.name}")
    # Render cache & props
    _rm(project_dir / "render.hash.txt", "render.hash.txt")
    _rm(project_dir / "render_props.json", "render_props.json")
    _rm(project_dir / "render_props.still.json", "render_props.still.json")
    _rm(project_dir / "render_loudness.json", "render_loudness.json")
    return removed


# ── Script ────────────────────────────────────────────────────────────

def validate_script_payload(data: dict) -> list:
    """Check agent-supplied script content. Returns a list of error strings
    (empty = valid). Mirrors the validation in ai.generate_script_pipeline."""
    errors = []
    if not isinstance(data, dict):
        return ["script payload must be an object."]
    if not _safe_str(data.get("title")).strip():
        errors.append("title must be a non-empty string.")
    intro = data.get("introduction")
    if not isinstance(intro, dict) or not _safe_str(intro.get("hook")).strip():
        errors.append("introduction.hook must be a non-empty string.")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        errors.append("scenes must be a non-empty array.")
    else:
        for i, scene in enumerate(scenes):
            if not isinstance(scene, dict):
                errors.append(f"scenes[{i}] must be an object.")
                continue
            if not _safe_str(scene.get("narration")).strip():
                errors.append(f"scenes[{i}] has empty narration.")
    conclusion = data.get("conclusion")
    if not isinstance(conclusion, dict) or not _safe_str(conclusion.get("summary")).strip():
        errors.append("conclusion.summary must be a non-empty string.")
    return errors


def _script_pacing_for_project(project_dict: dict | None) -> dict:
    """Pacing targets for a project row. Local import keeps payloads light."""
    proj = project_dict or {}
    try:
        from backend.mcp.pacing import get_pacing
        return get_pacing(proj.get("duration_mode", "medium"),
                          proj.get("video_format", "landscape"),
                          proj.get("language", "en"))
    except Exception as e:
        logger.warning(f"_script_pacing_for_project fallback: {e}")
        dm = str(proj.get("duration_mode") or "medium")
        vf = str(proj.get("video_format") or "landscape")
        return {"target_duration_seconds": 300, "min_scenes": 20,
                "max_scenes": 30, "per_scene_time": 9,
                "per_scene_words": 27, "speaking_rate": 3.0,
                "duration_mode": dm, "video_format": vf}


def compute_script_pacing_stats(data: dict, pacing: dict) -> dict:
    scenes = data.get("scenes") if isinstance(data, dict) else []
    count = len(scenes) if isinstance(scenes, list) else 0
    words = 0
    if isinstance(scenes, list):
        for s in scenes:
            if isinstance(s, dict):
                words += len(_safe_str(s.get("narration")).split())
    intro_words = 0
    concl_words = 0
    try:
        intro_words = len(_safe_str(data.get("introduction", {}).get("hook")).split())
        concl = data.get("conclusion", {}) or {}
        concl_words = len(_safe_str(concl.get("summary")).split()) + len(
            _safe_str(concl.get("cta")).split())
    except Exception:
        pass
    total = words + intro_words + concl_words
    avg = round(words / count, 1) if count else 0.0
    rate = float(pacing.get("speaking_rate") or 3.0)
    estimated = round(total / rate, 1) if rate else 0.0
    return {"scene_count": count, "scene_words": words,
            "total_words": total, "average_words_per_scene": avg,
            "estimated_duration_seconds": estimated,
            "target_duration_seconds": pacing.get("target_duration_seconds")}


def validate_script_pacing(data: dict, project_dict: dict) -> dict | None:
    """Anti-gross-mispacing guard (not a full duration prover).

    Hard rejects:
    - count < floor(min*0.70) (e.g. <14 for 5m/20-30) -> under-scened.
    - count > ceil(max*1.30) -> over-scened (cost blowup, 3s micro-scenes).
    - total words < 40% of target words -> thin narration (right count,
      minute-long video missing). Estimated duration uses words/rate.
    Returns a SCRIPT_PACING_ERROR dict, else None.
    """
    pacing = _script_pacing_for_project(project_dict or {})
    scenes = data.get("scenes") if isinstance(data, dict) else []
    count = len(scenes) if isinstance(scenes, list) else 0
    min_scenes = int(pacing.get("min_scenes") or 1)
    max_scenes = int(pacing.get("max_scenes") or min_scenes)
    import math
    floor = max(1, math.ceil(min_scenes * 0.70))
    ceiling = max(max_scenes, math.ceil(max_scenes * 1.30))
    stats = compute_script_pacing_stats(data, pacing)
    reason = ""
    if count < floor:
        reason = (f"Under-scened: got {count} scene(s), minimum accepted is "
                  f"{floor} (target range {min_scenes}-{max_scenes}). ")
    elif count > ceiling:
        reason = (f"Over-scened: got {count} scene(s), maximum accepted is "
                  f"{ceiling} (target range {min_scenes}-{max_scenes}). "
                  f"Merge beats instead of micro-scenes. ")
    else:
        target_words = float(pacing.get("total_script_words") or 0)
        if target_words and stats.get("total_words", 0) < target_words * 0.40:
            reason = (f"Thin narration: {stats.get('total_words')} words total "
                      f"vs ~{int(target_words)} expected for "
                      f"{pacing.get('target_duration_seconds')}s "
                      f"(estimated {stats.get('estimated_duration_seconds')}s). "
                      f"Fill each scene to ~{pacing.get('per_scene_words')} words. ")
    if not reason:
        return None
    return {
        "ok": False,
        "error_code": "SCRIPT_PACING_ERROR",
        "error": (
            f"{reason}"
            f"{pacing.get('duration_mode')}/{pacing.get('video_format')} "
            f"(~{pacing.get('target_duration_seconds')}s) requires "
            f"{pacing.get('min_scenes')}-{pacing.get('max_scenes')} scenes "
            f"at ~{pacing.get('per_scene_time')}s each. "
            f"A scene is a short visual beat (~7-12s), not a 60s chapter. "
            f"Split/merge the narration into {pacing.get('min_scenes')}-"
            f"{pacing.get('max_scenes')} beats (~{pacing.get('per_scene_words')} "
            f"words each) or re-call with force=true to override."),
        "expected_scenes": {"min": pacing.get("min_scenes"),
                            "max": pacing.get("max_scenes"),
                            "floor": floor, "ceiling": ceiling},
        "provided_scenes": count,
        "pacing_stats": stats,
        "fix": {"hint": "Call get_stage_skills('script', project_id) for outline_targets, "
                        "then re-author with the required scene count."},
    }


def build_script_document(data: dict, project_dict: dict) -> dict:
    """Normalize agent content into the on-disk script.json shape.

    Sub-visuals are always initialized empty — visuals are authored later
    via save_visuals once voiceover durations exist.
    """
    scenes = []
    for i, scene in enumerate(data["scenes"]):
        scenes.append({
            "scene_number": i + 1,
            "title": _safe_str(scene.get("title")) or f"Scene {i + 1}",
            "narration": _safe_str(scene.get("narration")).strip(),
            "sub_visuals": [],
        })
    conclusion = data["conclusion"]
    return {
        "title": _safe_str(data.get("title")).strip(),
        "introduction": {
            "hook": _safe_str(data["introduction"].get("hook")).strip(),
            "sub_visuals": [],
        },
        "scenes": scenes,
        "conclusion": {
            "summary": _safe_str(conclusion.get("summary")).strip(),
            "cta": _safe_str(conclusion.get("cta")).strip(),
            "sub_visuals": [],
        },
        "video_format": project_dict.get("video_format", "landscape"),
        "_project_hash": compute_project_script_hash(project_dict),
    }


def save_script_payload(project_id: str, data: dict, force: bool = False) -> dict:
    """Validate + persist an agent-authored script and reset the project to
    the post-script stage. Returns a summary dict (raises on DB miss)."""
    errors = validate_script_payload(data)
    if errors:
        return {
            "ok": False,
            "error_code": "SCRIPT_VALIDATION_ERROR",
            "error": "Script validation failed: " + "; ".join(errors),
            "errors": errors,
            "expected_schema": {
                "title": "string (non-empty)",
                "introduction": {"hook": "string (non-empty narration hook)"},
                "scenes": [{"title": "string", "narration": "string (non-empty)"}],
                "conclusion": {"summary": "string (non-empty)", "cta": "string (optional)"},
            },
            "fix": {
                "hint": "Correct the script validation errors listed above and resubmit.",
                "example": {
                    "title": "Video Title",
                    "introduction": {"hook": "Opening hook narration..."},
                    "scenes": [{"title": "Scene 1", "narration": "First scene narration..."}],
                    "conclusion": {"summary": "Summary narration...", "cta": "Optional CTA"},
                },
            },
        }
    proj = _get_project_or_raise(project_id)
    bypass_warning = None
    if not force:
        pacing_error = validate_script_pacing(data, proj)
        if pacing_error:
            return pacing_error
    else:
        # force=true is an audited escape hatch, not a silent bypass.
        pacing_error = validate_script_pacing(data, proj)
        if pacing_error:
            bypass_warning = (
                f"force=true bypassed pacing guard "
                f"(expected {pacing_error.get('expected_scenes')}, "
                f"got {pacing_error.get('provided_scenes')}).")
            logger.warning(f"MCP save_script force-bypass: project {project_id} "
                           f"{pacing_error.get('provided_scenes')} scenes vs "
                           f"expected {pacing_error.get('expected_scenes')}.")
    pacing = _script_pacing_for_project(proj)
    pacing_stats = compute_script_pacing_stats(data, pacing)
    proj_dir = _project_dir(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)

    # The script title becomes the project topic (same as the internal
    # pipeline, which derives the title from the topic). The hash must be
    # computed against the STORED project row, so update the name first in
    # the in-memory copy used for hashing.
    title = _safe_str(data.get("title")).strip()
    hashed_proj = dict(proj)
    hashed_proj["name"] = title
    document = build_script_document(data, hashed_proj)

    script_path = proj_dir / "script.json"
    tmp_path = script_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
    tmp_path.replace(script_path)

    removed = purge_downstream_artifacts(proj_dir)

    _db.update_project(
        project_id,
        name=title,
        script_path=str(script_path),
        audio_path=None,
        transcription_path=None,
        assets_manifest_path=None,
        video_path=None,
        bg_music_path=None,
        music_clips=None,
        sfx_clips=None,
        status="created",
    )
    # create_task FIRST: update_task on a missing row is a silent no-op,
    # which left the GUI stuck on WAITING for generate_script.
    _db.create_task(project_id, "generate_script")
    _db.update_task(
        f"{project_id}_generate_script",
        status="completed", progress=100.0,
        message="Step completed (script authored via MCP).", error_message=None,
    )
    for step in ("generate_voiceover", "transcribe", "generate_visuals", "fetch_assets", "render"):
        _db.create_task(project_id, step)
        _db.update_task(
            f"{project_id}_{step}",
            status="pending", progress=0.0,
            message="Pending upstream changes (script rewritten via MCP).",
            error_message=None,
        )
    logger.info(f"MCP save_script: project {project_id} now has {len(document['scenes'])} scenes.")
    result = {
        "ok": True,
        "project_id": project_id,
        "title": title,
        "scene_count": len(document["scenes"]),
        "pacing_stats": pacing_stats,
        "purged": removed,
    }
    if bypass_warning:
        result["warning"] = bypass_warning
    return result


_PATCH_SECTION_ALIASES = {
    "introduction": "introduction", "intro": "introduction",
    "scene": "scene",
    "conclusion": "conclusion", "outro": "conclusion",
}


def patch_script_payload(project_id: str, section_type: str, patch: dict,
                         scene_index: int | None = None,
                         scene_number: int | None = None) -> dict:
    """Surgical single-section script edit — the incremental alternative to
    save_script (which rewrites the whole document and purges voiceover,
    transcription, assets, design, and music).

    Only the targeted section's prose is replaced; scene count, sub_visuals
    ASTs, design.json, voiceover segments, and downloaded assets are kept.
    The voiceover pipeline's per-section Smart Resume
    (tts.find_reusable_voice_segment) then re-synthesizes ONLY the edited
    section on the next generate_voiceover run.

    patch keys per section:
    - introduction: {hook}
    - scene: {narration, title?} (target via scene_number 1-based or scene_index 0-based)
    - conclusion: {summary, cta?}
    Only transcription + render outputs are deleted (word timings and pixels
    are stale); voiceover/transcribe/render tasks reset to pending while
    generate_visuals/fetch_assets keep their status.
    """
    section = (_safe_str(section_type) or "").strip().lower()
    section = _PATCH_SECTION_ALIASES.get(section, section)
    if section not in ("introduction", "scene", "conclusion"):
        return {
            "ok": False,
            "error_code": "INVALID_SECTION_TYPE",
            "error": "section_type must be introduction|scene|conclusion.",
            "allowed_section_types": ["introduction", "scene", "conclusion"],
            "fix": {"hint": "Set section_type to 'introduction', 'scene', or 'conclusion'."},
        }
    if not isinstance(patch, dict) or not patch:
        return {
            "ok": False,
            "error_code": "EMPTY_PATCH",
            "error": "patch must be a non-empty object.",
            "fix": {"hint": "Provide a dictionary with fields to update (e.g. {'hook': '...'} or {'narration': '...'})."},
        }
    _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {
            "ok": False,
            "error_code": "SCRIPT_NOT_FOUND",
            "error": "script.json not found. Use save_script first.",
            "fix": {
                "tool": "save_script",
                "arguments": {"project_id": project_id},
                "hint": "Save a complete script using save_script before patching individual sections.",
            },
        }
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            document = json.load(f)
    except Exception as e:
        return {
            "ok": False,
            "error_code": "SCRIPT_READ_ERROR",
            "error": f"Could not read script.json ({script_path}): {e}",
            "fix": {"hint": "The script file could not be parsed as JSON. Consider re-saving with save_script."},
        }

    changed: dict = {}
    if section == "introduction":
        if "hook" not in patch:
            return {
                "ok": False,
                "error_code": "MISSING_PATCH_FIELD",
                "error": "patch for introduction requires 'hook'.",
                "expected_fields": ["hook"],
                "fix": {"example": {"hook": "Updated hook narration..."}},
            }
        hook = _safe_str(patch.get("hook")).strip()
        if not hook:
            return {
                "ok": False,
                "error_code": "EMPTY_FIELD_VALUE",
                "error": "introduction.hook must be a non-empty string.",
                "field": "hook",
                "fix": {"hint": "Provide non-empty narration text for the hook."},
            }
        if not isinstance(document.get("introduction"), dict):
            document["introduction"] = {}
        document["introduction"]["hook"] = hook
        changed = {"section_type": "introduction", "hook_words": len(hook.split())}
    elif section == "conclusion":
        if "summary" not in patch:
            return {
                "ok": False,
                "error_code": "MISSING_PATCH_FIELD",
                "error": "patch for conclusion requires 'summary'.",
                "expected_fields": ["summary"],
                "fix": {"example": {"summary": "Updated conclusion summary...", "cta": "Optional CTA"}},
            }
        summary = _safe_str(patch.get("summary")).strip()
        if not summary:
            return {
                "ok": False,
                "error_code": "EMPTY_FIELD_VALUE",
                "error": "conclusion.summary must be a non-empty string.",
                "field": "summary",
                "fix": {"hint": "Provide non-empty narration text for the summary."},
            }
        if not isinstance(document.get("conclusion"), dict):
            document["conclusion"] = {}
        document["conclusion"]["summary"] = summary
        if "cta" in patch:
            document["conclusion"]["cta"] = _safe_str(patch.get("cta")).strip()
        changed = {"section_type": "conclusion",
                   "summary_words": len(summary.split())}
    else:
        scenes = document.get("scenes")
        if not isinstance(scenes, list) or not scenes:
            return {
                "ok": False,
                "error_code": "NO_SCENES_IN_SCRIPT",
                "error": "script has no scenes to patch.",
                "fix": {"tool": "save_script", "hint": "Save a script with scenes before patching."},
            }
        idx: int | None = None
        if scene_number is not None:
            try:
                idx = int(scene_number) - 1
            except (TypeError, ValueError):
                return {
                    "ok": False,
                    "error_code": "INVALID_SCENE_NUMBER",
                    "error": "scene_number must be 1-based integer.",
                    "fix": {"hint": "Pass scene_number as a 1-based integer (e.g. scene_number=1 for Scene 1)."},
                }
        elif scene_index is not None:
            try:
                idx = int(scene_index)
            except (TypeError, ValueError):
                return {
                    "ok": False,
                    "error_code": "INVALID_SCENE_INDEX",
                    "error": "scene_index must be 0-based integer.",
                    "fix": {"hint": "Pass scene_index as a 0-based integer (e.g. scene_index=0 for Scene 1)."},
                }
        else:
            return {
                "ok": False,
                "error_code": "MISSING_SCENE_TARGET",
                "error": "scene patch requires scene_number (1-based) or scene_index (0-based).",
                "fix": {"hint": "Specify which scene to patch using scene_number=1 (recommended, 1-based) or scene_index=0."},
            }
        if idx < 0 or idx >= len(scenes):
            return {
                "ok": False,
                "error_code": "SCENE_OUT_OF_RANGE",
                "error": f"scene index out of range (1-{len(scenes)}).",
                "valid_scene_numbers": f"1-{len(scenes)}",
                "total_scenes": len(scenes),
                "fix": {"hint": f"Choose a scene_number between 1 and {len(scenes)}."},
            }
        target = scenes[idx]
        if not isinstance(target, dict):
            return {
                "ok": False,
                "error_code": "CORRUPT_SCENE_DATA",
                "error": f"scenes[{idx}] is not an object.",
                "fix": {"hint": "Re-save the script to clean up malformed scene data."},
            }
        if "narration" not in patch and "title" not in patch:
            return {
                "ok": False,
                "error_code": "MISSING_PATCH_FIELD",
                "error": "scene patch requires 'narration' and/or 'title'.",
                "expected_fields": ["narration", "title"],
                "fix": {"example": {"narration": "Updated scene narration text", "title": "Optional new title"}},
            }
        if "narration" in patch:
            narration = _safe_str(patch.get("narration")).strip()
            if not narration:
                return {
                    "ok": False,
                    "error_code": "EMPTY_FIELD_VALUE",
                    "error": f"scenes[{idx}] narration must be non-empty.",
                    "field": "narration",
                    "fix": {"hint": "Scene narration must be a non-empty string."},
                }
            target["narration"] = narration
        if "title" in patch:
            title = _safe_str(patch.get("title")).strip()
            if title:
                target["title"] = title
        # sub_visuals intentionally untouched — durations renormalize downstream.
        changed = {"section_type": "scene", "scene_number": idx + 1,
                   "narration_words": len(_safe_str(target.get("narration")).split())}

    tmp_path = script_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
    tmp_path.replace(script_path)

    # Surgical invalidation: transcription words + rendered pixels are stale.
    # Voiceover segments, design, assets, and music are KEPT for Smart Resume.
    removed = []
    for rel in ("subtitles/transcription.json", "subtitles/transcription.srt",
                "subtitles/transcription.vtt", "transcribe.hash.txt",
                "render.hash.txt", "render_props.json", "render_props.still.json",
                "render_loudness.json"):
        p = proj_dir / rel
        try:
            if p.is_file() or p.is_symlink():
                p.unlink()
                removed.append(rel)
        except Exception as e:
            logger.warning(f"patch_script: could not delete {p}: {e}")
    _db.create_task(project_id, "generate_script")
    _db.update_task(
        f"{project_id}_generate_script",
        status="completed", progress=100.0,
        message="Step completed (script section patched via MCP).", error_message=None,
    )
    for step in ("generate_voiceover", "transcribe", "render"):
        _db.create_task(project_id, step)
        _db.update_task(
            f"{project_id}_{step}",
            status="pending", progress=0.0,
            message="Pending upstream changes (script section patched via MCP).",
            error_message=None,
        )
    logger.info(f"MCP patch_script: project {project_id} {changed}.")
    return {
        "ok": True,
        "project_id": project_id,
        "patched": changed,
        "purged": removed,
        "kept": ["design.json", "voiceover/", "assets/", "bg_music.mp3", "sub_visuals"],
        "next_step": ("run_stage(generate_voiceover) re-synthesizes ONLY the edited "
                      "section (Smart Resume reuses the rest), then transcribe."),
    }


def strip_script_for_agent(script: dict, include_visuals: bool = False) -> dict:
    """Return a token-lean copy of script.json (drops sub_visuals ASTs
    unless explicitly requested)."""
    import copy
    doc = copy.deepcopy(script)
    if not include_visuals:
        if isinstance(doc.get("introduction"), dict):
            doc["introduction"].pop("sub_visuals", None)
        for scene in doc.get("scenes", []) or []:
            if isinstance(scene, dict):
                scene.pop("sub_visuals", None)
        if isinstance(doc.get("conclusion"), dict):
            doc["conclusion"].pop("sub_visuals", None)
    return doc


# ── Design system ─────────────────────────────────────────────────────

def validate_design_payload(data: dict) -> list:
    errors = []
    if not isinstance(data, dict):
        return ["design payload must be an object."]
    missing = REQUIRED_DESIGN_KEYS - set(data.keys())
    if missing:
        errors.append(f"design is missing required keys: {sorted(missing)}.")
    if data.get("theme_name") is not None and not _safe_str(data.get("theme_name")).strip():
        errors.append("theme_name must be a non-empty string.")
    palette = data.get("color_palette")
    if palette is not None and not isinstance(palette, dict):
        errors.append("color_palette must be an object of hex color strings.")
    typography = data.get("typography")
    if typography is not None and not isinstance(typography, dict):
        errors.append("typography must be an object.")
    return errors


def save_design_payload(project_id: str, data: dict, force: bool = False) -> dict:
    """Validate + persist an agent-authored design system.

    A valid design.json on disk is picked up as-is by the internal
    generate_project_design_system (no LLM call), and its hash anchors
    manifest _design_hash entries written by save_visuals.
    """
    errors = validate_design_payload(data)
    if errors:
        return {
            "ok": False,
            "error_code": "DESIGN_VALIDATION_ERROR",
            "error": "Design validation failed: " + "; ".join(errors),
            "errors": errors,
            "expected_schema": {
                "theme_name": "string (e.g. 'cinematic_dark', 'tech_minimal')",
                "color_palette": {
                    "primary": "hex color string (e.g. '#FF5722')",
                    "secondary": "hex color string",
                    "accent": "hex color string",
                    "background": "hex color string",
                    "text": "hex color string",
                },
                "typography": {
                    "heading_font": "string (e.g. 'Montserrat')",
                    "body_font": "string (e.g. 'Inter')",
                },
                "css_guidelines": "string (optional design guidelines)",
            },
            "fix": {
                "hint": "Provide a complete design system matching the required schema above. Call get_stage_skills(stage='design') for guidance.",
                "tool": "get_stage_skills",
                "arguments": {"stage": "design", "project_id": project_id},
            },
        }
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)

    document = dict(data)
    document["_language"] = proj.get("language", "hi")
    document["_video_format"] = proj.get("video_format", "landscape")
    document.pop("_failed", None)
    document.pop("_genre", None)

    design_hash = hashlib.md5(
        json.dumps(document, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]

    # Guard against accidental overwrite: if visuals are already bound to the existing design,
    # overwriting it with a DIFFERENT hash invalidates all visuals and forces LLM regeneration on resume.
    old_hash = current_design_hash(proj_dir)
    old_doc_hash = ""
    try:
        with open(proj_dir / "design.json", "r", encoding="utf-8") as f:
            old_doc = json.load(f)
        if isinstance(old_doc, dict):
            od = dict(old_doc)
            od.setdefault("_language", proj.get("language", "hi"))
            od.setdefault("_video_format", proj.get("video_format", "landscape"))
            od.pop("_failed", None)
            od.pop("_genre", None)
            old_doc_hash = hashlib.md5(json.dumps(od, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    except Exception:
        pass

    is_same_design = (design_hash == old_hash or (old_doc_hash and design_hash == old_doc_hash))
    if old_hash and not is_same_design and not force:
        try:
            manifest_path = _active_manifest_path(proj, proj_dir)
            if manifest_path and manifest_path.exists():
                with open(manifest_path, "r", encoding="utf-8") as f:
                    entries = json.load(f)
                bound_sections = [
                    e for e in (entries or [])
                    if isinstance(e, dict) and e.get("sub_visuals") and len(e.get("sub_visuals", [])) > 0
                ]
                if bound_sections:
                    existing_theme = ""
                    try:
                        with open(proj_dir / "design.json", "r", encoding="utf-8") as f:
                            existing_theme = json.load(f).get("theme_name", "")
                    except Exception:
                        pass
                    return {
                        "ok": False,
                        "error_code": "DESIGN_ALREADY_EXISTS",
                        "error": (
                            f"Design system already exists (theme: {existing_theme!r}, hash: {old_hash}) "
                            f"and {len(bound_sections)} section(s) have visuals bound to it. "
                            f"Overwriting it with a new design will change the design hash and invalidate "
                            f"those visuals, causing them to be regenerated during pipeline resume. "
                            f"If you intentionally want to redesign and replace all visuals, pass force=True."
                        ),
                        "existing_theme": existing_theme,
                        "existing_design_hash": old_hash,
                        "sections_with_visuals": len(bound_sections),
                        "fix": {
                            "keep_design": "Keep existing design.json and proceed directly to authoring visuals or fetch_assets.",
                            "force_redesign": {
                                "tool": "save_design",
                                "arguments": {"project_id": project_id, "design": data, "force": True},
                            },
                        },
                    }
        except Exception as e:
            logger.warning(f"MCP save_design overwrite guard check failed: {e}")

    design_path = proj_dir / "design.json"
    tmp_path = design_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
    tmp_path.replace(design_path)
    logger.info(f"MCP save_design: project {project_id} theme={document.get('theme_name')!r}.")
    result = {"ok": True, "project_id": project_id,
              "theme_name": document.get("theme_name"),
              "design_hash": design_hash}
    # Richness floor: a design with nothing beyond the required keys (or
    # only typography-adjacent extras like extra fonts) carries no motion
    # language. Advisory only — the motion toolset (transitions, emphasis,
    # FX, Particles) is documented in the skills either way.
    MOTION_KEYS = ("motion", "transition", "animation", "effect", "fx",
                   "treatment", "kinetic", "overlay", "texture", "particles")
    doc_keys = {k.lower() for k in document if not k.startswith("_")}
    css_text = str(document.get("css_guidelines") or "").lower()
    has_motion = (any(any(m in k for m in MOTION_KEYS) for k in doc_keys)
                  or any(m in css_text for m in MOTION_KEYS))
    if not has_motion:
        result["warning"] = (
            "Design carries no motion language (no transition/animation/FX "
            "direction in keys or css_guidelines). The motion toolset is "
            "documented in the motion-graphics-designer skill.")
    # Staleness: existing manifests bound to an older design keep rendering
    # the old look until visuals are re-saved against the new hash.
    try:
        manifest_path = _active_manifest_path(
            _get_project_or_raise(project_id), proj_dir)
        if manifest_path and manifest_path.exists():
            entries = json.loads(manifest_path.read_text(encoding="utf-8"))
            stale = [e for e in (entries or [])
                     if isinstance(e, dict) and e.get("sub_visuals")
                     and e.get("_design_hash") not in (None, design_hash)]
            if stale:
                suffix = (f" {len(stale)} section(s) are still bound to an "
                          f"older design — re-run save_visuals for them.")
                result["warning"] = (result.get("warning", "") + suffix).strip()
    except Exception:
        pass
    return result


def current_design_hash(project_dir: Path) -> str:
    """Same 12-char design hash the visuals pipeline stamps on manifest
    entries (ai.generate_visuals_pipeline). Empty when no valid design."""
    design_path = project_dir / "design.json"
    try:
        with open(design_path, "r", encoding="utf-8") as f:
            design = json.load(f)
        if not isinstance(design, dict) or not design.get("theme_name") or design.get("_failed"):
            return ""
        return hashlib.md5(json.dumps(design, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    except Exception:
        return ""


# ── Voice / audio settings ──────────────────────────────────────────

# Writable voice/audio settings. tts_engine/tts_voice/tts_speed/tts_pitch/
# bg_music_volume are real project columns; dhvaani_quality lives in
# project_settings JSON (update_voice_settings routes it there).
VOICE_SETTING_KEYS = ("tts_engine", "tts_voice", "tts_speed", "tts_pitch",
                      "bg_music_volume", "dhvaani_quality")
VALID_TTS_ENGINES = ("edge", "dhvaani")
VALID_DHVAANI_QUALITIES = ("fast", "balanced", "best")
# Legacy clone ids from the XTTS/OmniVoice era. The pipeline maps them to
# 'dhvaani'; MCP accepts them too (normalized) so old projects echoed back
# by agents don't fail validation.
LEGACY_CLONE_ENGINES = ("xtts", "omnivoice")
_EDGE_VOICE_RE = r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$"


def _normalize_tts_engine(engine) -> str | None:
    if not isinstance(engine, str):
        return None
    e = engine.strip().lower()
    if e in LEGACY_CLONE_ENGINES:
        return "dhvaani"
    if e in VALID_TTS_ENGINES:
        return e
    return None


def validate_voice_settings(settings: dict, current_engine: str | None = None) -> tuple[list, dict]:
    """Returns (errors, sanitized columns). Unknown keys are rejected so a
    typo can never silently do nothing."""
    import re
    errors = []
    columns = {}
    if not isinstance(settings, dict) or not settings:
        return ["settings must be a non-empty object."], {}
    for key in settings:
        if key not in VOICE_SETTING_KEYS:
            errors.append(f"unknown setting {key!r} (allowed: {list(VOICE_SETTING_KEYS)}).")
    if errors:
        return errors, {}
    if "tts_engine" in settings:
        engine = settings["tts_engine"]
        norm = _normalize_tts_engine(engine)
        if norm is None:
            errors.append(f"tts_engine must be one of {list(VALID_TTS_ENGINES)}.")
        else:
            columns["tts_engine"] = norm
    if "tts_voice" in settings:
        voice = settings["tts_voice"]
        if not isinstance(voice, str) or not voice.strip():
            errors.append("tts_voice must be a non-empty string.")
        else:
            # When the payload omits tts_engine (voice-only update), validate
            # against the project's current engine instead of assuming edge —
            # otherwise a dhvaani profile id is wrongly rejected.
            raw_engine = settings.get("tts_engine", current_engine or "edge")
            eff_engine = _normalize_tts_engine(raw_engine) or "edge"
            if eff_engine == "edge" and not re.match(_EDGE_VOICE_RE, voice.strip()):
                errors.append(
                    "tts_voice for engine 'edge' must look like 'hi-IN-SwaraNeural'. "
                    "For voice cloning use tts_engine 'dhvaani' with a profile id.")
            else:
                columns["tts_voice"] = voice.strip()
    if "tts_speed" in settings:
        try:
            speed = float(settings["tts_speed"])
            if not 0.5 <= speed <= 2.0:
                errors.append("tts_speed must be between 0.5 and 2.0.")
            else:
                columns["tts_speed"] = speed
        except (TypeError, ValueError):
            errors.append("tts_speed must be a number between 0.5 and 2.0.")
    if "tts_pitch" in settings:
        columns["tts_pitch"] = str(settings["tts_pitch"])
    if "dhvaani_quality" in settings:
        quality = settings["dhvaani_quality"]
        if not isinstance(quality, str) or quality.strip().lower() not in VALID_DHVAANI_QUALITIES:
            errors.append(f"dhvaani_quality must be one of {list(VALID_DHVAANI_QUALITIES)}.")
        else:
            columns["dhvaani_quality"] = quality.strip().lower()
    if "bg_music_volume" in settings:
        try:
            vol = float(settings["bg_music_volume"])
            if not 0.0 <= vol <= 1.0:
                errors.append("bg_music_volume must be between 0.0 and 1.0.")
            else:
                columns["bg_music_volume"] = vol
        except (TypeError, ValueError):
            errors.append("bg_music_volume must be a number between 0.0 and 1.0.")
    return errors, columns


def update_voice_settings(project_id: str, settings: dict) -> dict:
    """Persist voice/audio columns and reset the stages they invalidate.

    Mirrors queue._PROPAGATE for voiceover: new audio invalidates
    transcribe + render, but NOT visuals/assets (narration unchanged, so
    ASTs are rescaled in place by the voiceover pipeline).
    """
    proj = _get_project_or_raise(project_id)
    # Resolve the effective current engine so voice-only updates validate
    # correctly (a dhvaani profile id without an explicit engine must pass).
    current_engine = None
    try:
        current_engine = (
            (proj.get("tts_engine") if isinstance(proj, dict) else None)
            or _db.get_setting("tts_engine")
            or "edge"
        )
        current_engine = _normalize_tts_engine(current_engine) or "edge"
    except Exception:
        current_engine = "edge"
    errors, columns = validate_voice_settings(settings, current_engine=current_engine)
    if errors:
        return {
            "ok": False,
            "error_code": "INVALID_VOICE_SETTINGS",
            "error": " ".join(errors),
            "errors": errors,
            "fix": {
                "tool": "list_voice_options",
                "hint": "Check list_voice_options() to see valid voices and engines for this language.",
            },
        }
    # dhvaani_quality is not a projects-table column — merge it into
    # project_settings JSON (same pattern as update_transcribe_settings).
    quality = columns.pop("dhvaani_quality", None)
    if columns:
        _db.update_project(project_id, **columns)
    if quality is not None:
        raw = proj.get("project_settings")
        try:
            current = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
            if not isinstance(current, dict):
                current = {}
        except Exception:
            current = {}
        current["dhvaani_quality"] = quality
        _db.update_project(project_id, project_settings=json.dumps(current))
    # Remember the last explicitly chosen voice so list_voice_options can
    # surface it (disambiguates duplicate clone-profile names like KIKI).
    try:
        if isinstance(settings, dict) and settings.get("tts_voice"):
            _db.update_settings({"tts_voice_last_used": settings.get("tts_voice")})
    except Exception:
        pass
    for step in ("generate_voiceover", "transcribe", "render"):
        _db.create_task(project_id, step)
        _db.update_task(
            f"{project_id}_{step}",
            status="pending", progress=0.0,
            message="Pending upstream changes (voice settings updated via MCP).",
            error_message=None,
        )
    logger.info(f"MCP update_voice_settings: project {project_id} {sorted(columns)}.")
    return {"ok": True, "project_id": project_id, "updated": columns}


# ── Transcribe settings ─────────────────────────────────────────────

VALID_WHISPER_DEVICES = ("cpu", "cuda")


def validate_transcribe_settings(settings: dict) -> tuple[list, dict]:
    """Returns (errors, sanitized columns). Model must be a known size, a
    HF repo id, or an already-downloaded id — never a typo that fails
    minutes into the stage."""
    errors = []
    columns = {}
    if not isinstance(settings, dict) or not settings:
        return ["settings must be a non-empty object."], {}
    allowed = {"whisper_model", "whisper_device"}
    for key in settings:
        if key not in allowed:
            errors.append(f"unknown setting {key!r} (allowed: {sorted(allowed)}).")
    if errors:
        return errors, {}
    if "whisper_device" in settings:
        device = settings["whisper_device"]
        if device not in VALID_WHISPER_DEVICES:
            errors.append(f"whisper_device must be one of {list(VALID_WHISPER_DEVICES)}.")
        else:
            columns["whisper_device"] = device
    if "whisper_model" in settings:
        model = settings["whisper_model"]
        if not isinstance(model, str) or not model.strip():
            errors.append("whisper_model must be a non-empty string.")
        else:
            from backend.pipeline.transcribe import (
                KNOWN_WHISPER_MODELS, list_downloaded_whisper_models)
            model = model.strip()
            downloaded = {m["id"] for m in list_downloaded_whisper_models()
                          if isinstance(m, dict)}
            if (model not in KNOWN_WHISPER_MODELS and "/" not in model
                    and model not in downloaded):
                errors.append(
                    f"Unknown whisper_model {model!r}. Known sizes: "
                    f"{KNOWN_WHISPER_MODELS}; downloaded now: {sorted(downloaded) or 'none'}.")
            else:
                columns["whisper_model"] = model
    return errors, columns


def update_transcribe_settings(project_id: str, settings: dict) -> dict:
    """Persist whisper columns (project_settings JSON) and reset the stages
    they invalidate. Mirrors queue._PROPAGATE for transcribe: new word
    timings invalidate render, but NOT voiceover/assets (audio unchanged).

    Returns downloaded=true/false for the chosen model so the agent knows
    whether transcribe can run or the model must first be downloaded from
    Settings > Speech-to-Text.
    """
    errors, columns = validate_transcribe_settings(settings)
    if errors:
        return {
            "ok": False,
            "error_code": "INVALID_TRANSCRIBE_SETTINGS",
            "error": " ".join(errors),
            "errors": errors,
            "allowed_models": ["tiny", "base", "small", "medium", "large-v3"],
            "allowed_devices": ["cuda", "cpu"],
            "fix": {
                "hint": "Pass whisper_model (e.g. 'base', 'small', 'medium') and whisper_device ('cpu' or 'cuda').",
            },
        }
    proj = _get_project_or_raise(project_id)
    raw = proj.get("project_settings")
    try:
        current = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        if not isinstance(current, dict):
            current = {}
    except Exception:
        current = {}
    current.update(columns)
    _db.update_project(project_id, project_settings=json.dumps(current))
    for step in ("transcribe", "render"):
        _db.create_task(project_id, step)
        _db.update_task(
            f"{project_id}_{step}",
            status="pending", progress=0.0,
            message="Pending upstream changes (transcribe settings updated via MCP).",
            error_message=None,
        )
    downloaded = True
    if "whisper_model" in columns:
        from backend.pipeline.transcribe import check_whisper_assets
        downloaded = bool(check_whisper_assets(columns["whisper_model"]))
    logger.info(f"MCP update_transcribe_settings: project {project_id} {sorted(columns)}.")
    result = {"ok": True, "project_id": project_id, "updated": columns,
              "downloaded": downloaded}
    if not downloaded:
        result["warning"] = (
            f"Model '{columns['whisper_model']}' is not downloaded — transcribe will fail "
            "until it is downloaded from Settings > Speech-to-Text.")
    return result

# ── Subtitle styling ─────────────────────────────────────────────

def validate_subtitle_settings(settings: dict) -> tuple[list, dict]:
    """Returns (errors, sanitized columns). Keys must exist in the agent
    subtitle registry (backend/agent/tools.py SUBTITLE_SETTING_KEYS) and
    pass that registry's per-key validators — the same keys/constraints
    the frontend subtitleSchema.ts documents, so agent writes can never
    produce a blob the renderer ignores or the UI can't display."""
    from backend.agent import tools as _agent_tools
    errors = []
    columns = {}
    if not isinstance(settings, dict) or not settings:
        return ["settings must be a non-empty object."], {}
    allowed = set(_agent_tools.SUBTITLE_SETTING_KEYS)
    spec = _agent_tools.VISUAL_SETTINGS_SPEC
    for key in settings:
        if key not in allowed:
            errors.append(f"unknown subtitle setting {key!r} (allowed: {sorted(allowed)}).")
    if errors:
        return errors, {}
    for key, value in settings.items():
        check = spec.get(key)
        if check is None:
            errors.append(f"no validator registered for {key!r}.")
            continue
        problem = check(value)
        if problem:
            errors.append(f"{key}: {problem}.")
        else:
            columns[key] = value
    return errors, columns


def update_subtitle_settings(project_id: str, settings: dict) -> dict:
    """Persist subtitle styling keys (project_settings JSON) and reset the
    stages they invalidate. Subtitle styling only changes frame pixels, so
    render resets to pending while voiceover/transcribe/assets are untouched
    (narration and word timings unchanged). The frame-hash covers the whole
    settings dict, so any styling edit correctly busts the render cache."""
    errors, columns = validate_subtitle_settings(settings)
    if errors:
        return {
            "ok": False,
            "error_code": "INVALID_SUBTITLE_SETTINGS",
            "error": " ".join(errors),
            "errors": errors,
            "fix": {
                "hint": "Check subtitle setting parameters. Ensure valid font names, hex colors, and dimensions.",
            },
        }
    proj = _get_project_or_raise(project_id)
    raw = proj.get("project_settings")
    try:
        current = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        if not isinstance(current, dict):
            current = {}
    except Exception:
        current = {}
    current.update(columns)
    _db.update_project(project_id, project_settings=json.dumps(current))
    _db.create_task(project_id, "render")
    _db.update_task(
        f"{project_id}_render",
        status="pending", progress=0.0,
        message="Pending upstream changes (subtitle styling updated via MCP).",
        error_message=None,
    )
    logger.info(f"MCP update_subtitle_settings: project {project_id} {sorted(columns)}.")
    return {"ok": True, "project_id": project_id, "updated": columns}


# ── Project deletion ────────────────────────────────────────────────

def delete_project_payload(project_id: str) -> dict:
    """Delete the project row + tasks and wipe its storage directory."""
    import shutil
    _get_project_or_raise(project_id)
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "UNSAFE_PROJECT_ID",
            "error": f"Could not resolve a safe project directory for {project_id!r}: {e}.",
            "fix": {"tool": "list_projects",
                    "hint": "The project id failed the storage-path safety check — "
                            "confirm the exact id with list_projects."},
        }
    _db.delete_project(project_id)
    try:
        if proj_dir.exists():
            shutil.rmtree(proj_dir)
    except Exception as e:
        logger.warning(f"MCP delete_project: row deleted but dir wipe failed: {e}")
        return {"ok": True, "project_id": project_id,
                "warning": f"Database row deleted but folder wipe failed: {e}"}
    logger.info(f"MCP delete_project: {project_id} removed.")
    return {"ok": True, "project_id": project_id}


# ── Voice options (so the agent can ASK instead of guess) ──────────

# App-known Edge defaults (mirrors tts._resolve_tts_settings fallbacks).
EDGE_VOICE_SUGGESTIONS = {
    "hi": ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"],
    "en": ["en-US-AndrewNeural", "en-US-AvaNeural"],
}


def list_voice_options() -> dict:
    """Voices/engines the agent can offer the user. Returns engine
    descriptions, per-language Edge suggestions, configured clone
    profiles (id + name only, no paths), and current global defaults."""
    engine = _normalize_tts_engine(_db.get_setting("tts_engine") or "edge") or "edge"
    default_voice = _db.get_setting("tts_voice")
    profiles = _db.get_setting("xtts_profiles") or []
    # Dedup by id (pass-through used to surface duplicate names like two
    # "KIKI" rows with no way to tell them apart). Duplicate display names
    # get a "(2)", "(3)" suffix so the agent can offer distinct choices.
    seen_ids: set = set()
    name_counts: dict = {}
    clone_profiles = []
    for p in profiles:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        pid = p.get("id")
        if pid in seen_ids:
            continue
        seen_ids.add(pid)
        raw_name = str(p.get("name") or pid)
        n = name_counts.get(raw_name, 0) + 1
        name_counts[raw_name] = n
        label = raw_name if n == 1 else f"{raw_name} ({n})"
        clone_profiles.append({"id": pid, "name": label})
    last_used = _db.get_setting("tts_voice_last_used") or default_voice
    return {
        "ok": True,
        "engines": [
            {"id": "edge",
             "label": "Edge TTS (single Neural voice, fast, no training)",
             "voice_format": "Neural name like 'hi-IN-SwaraNeural'"},
            {"id": "dhvaani",
             "label": "Voice cloning via DhVaani profile (fast Indic cloning, needs a configured profile)",
             "voice_format": "profile id like 'xtts_prof_...' (see clone_profiles)"},
        ],
        "edge_suggestions": EDGE_VOICE_SUGGESTIONS,
        "clone_profiles": clone_profiles,
        "global_defaults": {"tts_engine": engine, "tts_voice": default_voice},
        "last_used_voice": last_used,
        "hint": "Offer clone_profiles by name AND id (names may repeat — ids are unique). No audio preview available yet; ask the user to pick by name.",
    }


# ── Disk inspection ─────────────────────────────────────────────────

_READABLE_SUFFIXES = (".json", ".srt", ".vtt", ".txt", ".md", ".log", ".xml")
_MAX_READ_CHARS = 20000
_MAX_LIST_FILES = 500


def list_project_files_payload(project_id: str) -> dict:
    """Relative file listing with sizes (mirrors the internal
    list_project_files tool, but structured)."""
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "UNSAFE_PROJECT_ID",
            "error": f"Could not resolve a safe project directory for {project_id!r}: {e}.",
            "fix": {"tool": "list_projects",
                    "hint": "The project id failed the storage-path safety check — "
                            "confirm the exact id with list_projects."},
        }
    if not proj_dir.exists():
        return {"ok": False,
                "error_code": "PROJECT_DIR_MISSING",
                "error": f"Project directory does not exist for {project_id!r}.",
                "fix": {"hint": "The project row exists but its storage folder "
                                "was never created (or was deleted outside the "
                                "app). Only delete_project removes it — re-create "
                                "the project if the folder is really gone."}}
    files = []
    truncated = False
    try:
        candidate_paths = sorted(proj_dir.rglob("*", recurse_symlinks=False))
    except TypeError:
        candidate_paths = sorted(proj_dir.rglob("*"))
    for path in candidate_paths:
        if path.is_symlink():
            continue
        if path.is_file() and "__pycache__" not in str(path):
            try:
                size = path.stat().st_size
            except OSError:
                size = -1
            files.append({"path": str(path.relative_to(proj_dir)).replace("\\", "/"),
                          "size": size})
            if len(files) >= _MAX_LIST_FILES:
                truncated = True
                break
    return {"ok": True, "project_id": project_id, "count": len(files),
            "truncated": truncated, "files": files}


def read_project_file_payload(project_id: str, path: str,
                              max_chars: int = _MAX_READ_CHARS,
                              offset: int = 0) -> dict:
    """Read a text artifact (script, manifest, transcription, logs).

    Binary media returns size info only — use the app's file server or
    previews to view those. Database files outside the project dir are
    unreachable by construction.
    """
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "UNSAFE_PROJECT_ID",
            "error": f"Could not resolve a safe project directory for {project_id!r}: {e}.",
            "fix": {"tool": "list_projects",
                    "hint": "The project id failed the storage-path safety check — "
                            "confirm the exact id with list_projects."},
        }
    candidate = (proj_dir / (path or "").replace("\\", "/"))
    try:
        resolved = candidate.resolve()
    except Exception as e:
        return {
            "ok": False,
            "error_code": "PATH_RESOLVE_FAILED",
            "error": f"Could not resolve project path {path!r}: {e}.",
            "fix": {"hint": "Use a relative path inside the project folder "
                            "(e.g. 'script.json' or 'voiceover/manifest.json'); "
                            "list candidates with list_project_files."},
        }
    if proj_dir.resolve() != resolved and proj_dir.resolve() not in resolved.parents:
        return {
            "ok": False,
            "error_code": "UNSAFE_PATH",
            "error": f"Unsafe path: {path!r}.",
            "fix": {"hint": "Provide a relative path within the project storage directory."},
        }
    if not resolved.is_file():
        return {
            "ok": False,
            "error_code": "FILE_NOT_FOUND",
            "error": f"File not found: {path!r}.",
            "fix": {
                "tool": "list_project_files",
                "arguments": {"project_id": project_id},
                "hint": "Call list_project_files() to see existing files in this project directory.",
            },
        }
    if resolved.suffix.lower() not in _READABLE_SUFFIXES:
        try:
            size = resolved.stat().st_size
        except OSError:
            size = -1
        return {"ok": True, "project_id": project_id, "path": path,
                "binary": True, "size": size,
                "note": "Binary media is not inlined. Inspect it through the app."}
    try:
        text = resolved.read_text(encoding="utf-8")
    except Exception as e:
        return {
            "ok": False,
            "error_code": "FILE_READ_ERROR",
            "error": f"Could not read file {resolved}: {e}",
            "fix": {"hint": "The file could not be read as UTF-8 text. Call list_project_files to confirm the exact relative path."},
        }
    total_chars = len(text)
    try:
        offset = max(0, int(offset or 0))
    except (TypeError, ValueError):
        offset = 0
    slice_end = offset + max_chars
    truncated = total_chars > slice_end
    chunk = text[offset:slice_end]
    res = {"ok": True, "project_id": project_id, "path": path,
           "binary": False, "total_chars": total_chars, "offset": offset,
           "truncated": truncated, "content": chunk}
    if truncated:
        res["note"] = (
            f"File truncated ({len(chunk)}/{total_chars} chars). Pass offset={slice_end} "
            "to read further, or use structured tools like get_script / get_visuals."
        )
    return res

# ── Visuals ───────────────────────────────────────────────────────────

def _active_manifest_path(project_dict: dict, project_dir: Path) -> Path | None:
    """Single resolver shared with the pipeline: delegate to
    assets._resolve_manifest_path so MCP and pipeline can never disagree
    about which manifest is live (DB path → voiceover → assets)."""
    from backend.pipeline.assets import _resolve_manifest_path
    return _resolve_manifest_path(project_dict, project_dir)


def _load_transcription_words(project_dir: Path) -> list:
    """Flat word list [{word, start}] from transcription.json (best effort)."""
    for candidate in (
        project_dir / "subtitles" / "transcription.json",
    ):
        try:
            with open(candidate, "r", encoding="utf-8") as f:
                data = json.load(f)
            words = []
            for seg in (data.get("segments") or []):
                for w in (seg.get("words") or []):
                    if isinstance(w, dict) and w.get("word"):
                        words.append({"word": str(w.get("word")).strip(),
                                      "start": float(w.get("start", 0))})
            if words:
                return words
        except Exception:
            continue
    return []


def get_section_timings(project_id: str, include_words: bool = True,
                        scene_number: int | None = None,
                        section_type: str = "") -> dict:
    """Report per-section narration + audio durations so the agent can
    author sub_visuals whose durations sum to the TRUE section length.

    For long videos (40+ sections) the full word-timestamp dump is ~5000
    lines and gets truncated: pass include_words=False for a compact summary,
    and/or scene_number=N (1-based UI Scene N) or section_type=introduction|
    scene|conclusion to fetch ONE section (with words) instead of all."""
    _get_project_or_raise(project_id)
    proj = _db.get_project(project_id)
    proj_dir = _project_dir(project_id)
    manifest_path = _active_manifest_path(proj, proj_dir)
    if not manifest_path:
        return {
            "ok": False,
            "error_code": "VOICEOVER_REQUIRED",
            "error": "No voiceover manifest found. Run the generate_voiceover stage first.",
            "fix": {
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                "hint": "Voiceover audio must be generated before true section timings exist.",
            },
        }
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    words = _load_transcription_words(proj_dir) if include_words else []
    sections = []
    cursor = 0.0
    scene_counter = 0
    manifest_idx = 0
    for entry in manifest:
        if not isinstance(entry, dict):
            continue
        sec_type = _normalize_section_type(entry.get("section_type"))
        duration = float(entry.get("duration", 0) or 0)
        section_words = []
        if words:
            section_words = [
                {**w, "at": round(w["start"] - cursor, 2)}
                for w in words
                if cursor <= w["start"] < cursor + duration
            ]
        display_label = format_display_label(sec_type, scene_counter)
        subs = entry.get("sub_visuals") or []
        cuts_info = [
            {
                "cut_number": ci + 1,
                "cut_index": ci,
                "display_label": f"{display_label} : Cut #{ci + 1}",
                "duration": round(float(sv.get("duration", 0) or 0), 2) if isinstance(sv, dict) else 0.0,
            }
            for ci, sv in enumerate(subs)
            if isinstance(sv, dict)
        ]
        info = {
            "manifest_index": manifest_idx,
            "section_type": sec_type,
            "display_label": display_label,
            "title": entry.get("title", ""),
            "text": entry.get("text", ""),
            "duration": round(duration, 2),
            "start_time": round(cursor, 2),
            "has_visuals": bool(subs),
            "cut_count": len(cuts_info),
            "cuts": cuts_info,
        }
        if sec_type == "scene":
            info["scene_index"] = scene_counter
            info["scene_number"] = scene_counter + 1
            scene_counter += 1
        else:
            info["scene_index"] = None
            info["scene_number"] = None
        if include_words:
            info["words"] = section_words
        sections.append(info)
        cursor += duration
        manifest_idx += 1
    # Filtered mode: one section only (keeps long-video responses small).
    total_sections = len(sections)
    filt = (section_type or "").strip().lower()
    if scene_number is not None:
        try:
            _sn = int(scene_number)
        except (TypeError, ValueError):
            return {
                "ok": False,
                "error_code": "INVALID_SCENE_NUMBER",
                "error": "scene_number must be a 1-based integer (UI Scene N).",
                "fix": {"hint": "Provide scene_number as a 1-based integer (e.g. scene_number=1)."},
            }
        match = next((s for s in sections
                      if s.get("section_type") == "scene"
                      and s.get("scene_number") == _sn), None)
        if match is None:
            total_scenes = sum(1 for s in sections if s.get('section_type') == 'scene')
            return {
                "ok": False,
                "error_code": "SCENE_NOT_FOUND",
                "error": (
                    f"scene_number {_sn} not found (video has "
                    f"{total_scenes} scenes)."),
                "valid_scene_numbers": f"1..{total_scenes}",
                "fix": {"hint": f"Choose scene_number between 1 and {total_scenes}."},
            }
        sections = [match]
    elif filt in ("introduction", "intro"):
        sections = [s for s in sections if s.get("section_type") == "introduction"]
    elif filt in ("conclusion", "outro", "cta"):
        sections = [s for s in sections if s.get("section_type") == "conclusion"]
    elif filt in ("scene", "scenes"):
        pass  # all scenes already; combine with include_words=False for summary
    elif filt:
        return {
            "ok": False,
            "error_code": "INVALID_SECTION_TYPE",
            "error": (
                f"section_type must be introduction|scene|conclusion (got {section_type!r})."),
            "allowed_section_types": ["introduction", "scene", "conclusion"],
            "fix": {"hint": "Filter by 'introduction', 'scene', or 'conclusion'."},
        }
    filtered = len(sections) != total_sections
    return {"ok": True, "project_id": project_id,
            "total_duration": round(cursor, 2), "sections": sections,
            "section_count": len(sections),
            "total_sections": total_sections,
            "filtered": filtered,
            "summary_hint": ("Full dump truncated? Re-call with include_words=false "
                             "for a compact summary, or scene_number=N / "
                             "section_type=introduction|conclusion for one section.")
            if not filtered and total_sections > 15 and include_words else "",
            "creative_blueprint": _creative_blueprint_for_project(proj),
            "required_reading": {
                "message": ("MANDATORY before save_visuals: "
                            "get_stage_skills('visuals', project_id) or all three "
                            "get_skill(declarative-ast + visual-director-core + "
                            "motion-graphics-designer, brief=true)."),
                "easy_one_call": {"tool": "get_stage_skills",
                                  "arguments": {"stage": "visuals",
                                                "project_id": project_id}},
            }}


def _creative_blueprint_for_project(proj: dict) -> dict:
    """Pushed cheat-sheet: capability pointers + sample cut + hard rules.

    Lives on get_section_timings (the mandatory step right before visual
    authoring) so the agent gets the harness capabilities without digging
    through the declarative-ast file first. Composition is the agent's
    creative decision — this lists what exists, not what to pick.
    """
    video_format = str((proj or {}).get("video_format") or "landscape")
    _raw_hint = str((proj or {}).get("prompt") or "").strip()
    # Legacy rows store a removed genre token in `prompt` — never surface it
    # as a style hint.
    if _raw_hint.lower() in {
        "documentary", "explainer", "finance", "vox",
        "news", "true_crime", "storytime", "viral_short",
    }:
        _raw_hint = ""
    style_hint = _raw_hint
    out = {
        "style_hint": style_hint,
        "layer_types": [
            "Image", "Video", "Text", "Chart", "Shape", "Map",
            "HTML", "Lottie", "Particles", "Counter", "Background",
        ],
        "hard_rules": [
            "LayerBox geometry %-only.",
            "No chapter title cards inside cuts.",
            "Image/Video need English search `query` (verify via search_media).",
            "Entrances with delay>0 need opacity fade 0->1; spatial-only at delay 0.",
        ],
        "sample_cut": _canonical_sample_cut(video_format),
    }
    # Resolve the 50-style hint so the agent sees the canonical look even if
    # it skipped get_stage_skills('visuals'). Pointer only — never fails.
    try:
        from backend.pipeline.style_library import (
            style_block_for as _sbf, resolve_style as _rs, STYLE_SPECS as _ss,
        )
        _block, _slug = _sbf(style_hint)
        out["resolved_style"] = _slug
        if _slug:
            out["style_name"] = _ss.get(_slug, {}).get("name", _slug)
            out["active_style_block"] = _block
            out["style_note"] = (
                f"Active look: {_slug}. ONE style per scene, max 2-3 per video; "
                "bind colors/fonts to design.json tokens. Full AST mapping: "
                "get_skill('visual-style-library', section='<family>', project_id=...) "
                "or get_stage_skills('visuals', project_id).")
        elif style_hint:
            out["style_note"] = (
                f"Hint {style_hint!r} is free text (no library match) — invent "
                "a topic-driven look. To pin a curated look, use a 50-style "
                "slug from get_skill('visual-style-library', section='style index').")
    except Exception as e:
        logger.warning(f"creative_blueprint style resolution skipped: {e}")
    return out


def _canonical_sample_cut(video_format: str = "landscape") -> dict:
    """Single canonical sample — delegates to validators.build_sample_cut so
    get_section_timings can never disagree with get_stage_skills again."""
    from backend.agent.validators import build_sample_cut
    return build_sample_cut(video_format)


def _sync_visuals_task_status(project_id: str, proj_dir: Path, manifest: list | None = None) -> dict:
    """Inspect all manifest sections and reconcile the generate_visuals task in SQLite.

    When all sections have meaningful sub_visuals (not just blank placeholders),
    generate_visuals is marked 'completed' (progress 100.0).
    Partially-authored states stay 'pending' with progress 0.0 — AI-authored
    stages (script/visuals) deliberately emit NO realtime progress. Only the
    mechanical stages (generate_voiceover, transcribe, fetch_assets, render)
    animate ExportTab bars via onProgressUpdate. The completed/total counts
    are still returned so save_visuals tool responses can report "3/28 saved".
    When none are authored, it is left or set to 'pending'.
    """
    if manifest is None:
        try:
            proj = _get_project_or_raise(project_id)
            manifest_path = _active_manifest_path(proj, proj_dir)
            if manifest_path and manifest_path.exists():
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
        except Exception as e:
            logger.warning(f"MCP _sync_visuals_task_status: could not load manifest: {e}")
            manifest = None

    if not isinstance(manifest, list) or not manifest:
        return {"total": 0, "completed": 0, "is_complete": False}

    try:
        from backend.pipeline.assets import _has_meaningful_sub_visuals
    except Exception:
        def _has_meaningful_sub_visuals(subs):
            return bool(isinstance(subs, list) and len(subs) > 0)

    # Filter to real video sections (introduction, scene, conclusion)
    sections = [
        m for m in manifest
        if isinstance(m, dict) and _normalize_section_type(m.get("section_type", "")) in ("introduction", "scene", "conclusion")
    ]
    if not sections:
        return {"total": 0, "completed": 0, "is_complete": False}

    total = len(sections)
    completed = sum(1 for m in sections if _has_meaningful_sub_visuals(m.get("sub_visuals")))
    is_complete = (completed == total and total > 0)

    task_id = f"{project_id}_generate_visuals"
    try:
        existing = _db.get_task(task_id) if hasattr(_db, "get_task") else None
        if not existing:
            _db.create_task(project_id, "generate_visuals")
        if is_complete:
            _db.update_task(
                task_id,
                status="completed",
                progress=100.0,
                message=f"Step completed ({total}/{total} sections authored via MCP).",
                error_message=None,
            )
        elif completed > 0:
            # No live progress for AI authoring: keep the row pending (0%)
            # so ExportTab shows Waiting until Done. Counts still flow back
            # via the save_visuals tool result + TopBar "AUTHORING ... x/y".
            _db.update_task(
                task_id,
                status="pending",
                progress=0.0,
                message=f"Authored {completed}/{total} sections via MCP.",
                error_message=None,
            )
        else:
            _db.update_task(
                task_id,
                status="pending",
                progress=0.0,
                message="Pending visuals authoring.",
                error_message=None,
            )
    except Exception as e:
        logger.warning(f"MCP _sync_visuals_task_status: DB task update failed: {e}")

    return {"total": total, "completed": completed, "is_complete": is_complete}


def save_visuals_payload(project_id: str, section_type: str,
                         sub_visuals, scene_index: int | None = None,
                         cut_index: int | None = None,
                         scene_number: int | None = None,
                         cut_number: int | None = None,
                         dry_run: bool = False,
                         auto_migrate: bool = False) -> dict:
    """Validate agent-authored sub_visuals for one section and persist them
    to both the active manifest and script.json (mirrors the manifest-sync
    tail of ai.generate_visuals_pipeline).

    Supports both 0-based indexes (scene_index, cut_index) and 1-based UI
    numbers (scene_number, cut_number).

    Two modes:
    - whole-section (cut_index/cut_number=None): sub_visuals is the full cuts array.
    - single-cut patch (cut_index/cut_number=N): sub_visuals is a 1-element array
      holding just that cut (a bare cut object is also accepted by direct
      Python callers); only that cut is replaced, the rest are preserved.
      Durations are still renormalized across the whole section so the sum
      matches the audio length — the returned durations list shows the
      resulting per-cut split.
    dry_run=True validates and returns the normalized result WITHOUT
    writing anything (works in both modes).
    """
    norm_sec, scene_index, cut_index, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number,
        cut_index=cut_index, cut_number=cut_number, default_scene=0, default_cut=None,
        allow_negative_cut=False
    )
    if err:
        return format_target_error(err, project_id=project_id)
    section_type = norm_sec

    logger.debug("save_visuals entry: sub_visuals type=%s (project=%s section=%s scene=%s cut=%s)",
                 type(sub_visuals).__name__, project_id, section_type, scene_index, cut_index)
    sub_visuals, _coerced, _coerce_err = _coerce_json_array(sub_visuals, "sub_visuals")
    if _coerce_err is not None:
        return _coerce_err

    if cut_index is not None:
        if isinstance(sub_visuals, list) and len(sub_visuals) != 1:
            return {
                "ok": False,
                "error_code": "SINGLE_CUT_PATCH_LENGTH",
                "error": (
                    f"Single-cut patch takes exactly one cut (got {len(sub_visuals)}); "
                    "omit cut_index/cut_number to replace the whole section."),
                "got_count": len(sub_visuals),
                "fix": {
                    "hint": "Pass a 1-element array [{...}] when patching a single cut, or omit cut_index/cut_number to replace the entire section.",
                },
            }
        patch = sub_visuals[0] if isinstance(sub_visuals, list) else sub_visuals
        if not isinstance(patch, dict):
            _got = type(sub_visuals).__name__
            if isinstance(sub_visuals, list):
                _got = f"list[{len(sub_visuals)}] of {type(sub_visuals[0]).__name__ if sub_visuals else 'empty'}"
            return {
                "ok": False,
                "error_code": "INVALID_CUT_OBJECT",
                "error": (
                    "Single-cut patch: sub_visuals must be one cut object "
                    f"(or a 1-element array). Got {_got}. "
                    "Valid cut keys: duration, transition, exit_transition, "
                    "composition, emphasis, subtitle_position, visual_path, visual_url. "
                    "exit_transition IS valid here — this error means the cut itself "
                    "is not a dict (e.g. you passed bare layers). "
                    "Fix: pass [{duration, transition, composition:{type:Sequence, children:[...]}}]."),
                "fix": {
                    "hint": "Wrap layers inside cut.composition.children, not directly as the cut object.",
                    "example": "[{\"duration\": 3.0, \"composition\": {\"type\": \"Sequence\", \"children\": [...]}}]",
                },
            }
    elif not isinstance(sub_visuals, list):
        return {
            "ok": False,
            "error_code": "INVALID_SUB_VISUALS_TYPE",
            "error": (
                f"sub_visuals must be an array of cut objects (got {type(sub_visuals).__name__}). "
                "Send sub_visuals=[{duration: 3.0, composition: {type: 'Sequence', children: [...]}}]."),
            "got_type": type(sub_visuals).__name__,
            "fix": {
                "hint": "Pass an array of cut objects, e.g. sub_visuals=[{duration: 3.0, composition: {type: 'Sequence', children: [...]}}].",
            },
        }
    elif not sub_visuals:
        return {
            "ok": False,
            "error_code": "EMPTY_SUB_VISUALS",
            "error": (
                "sub_visuals must be a non-empty array (got 0 cuts). "
                "Every section needs at least one cut object whose duration matches the section audio."),
            "fix": {
                "hint": "Provide a non-empty array of cuts for this section.",
            },
        }
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    video_format = proj.get("video_format", "landscape")

    design_hash = current_design_hash(proj_dir)
    if not design_hash:
        return {
            "ok": False,
            "error_code": "DESIGN_REQUIRED",
            "error": (
                "No valid design.json found. Save a design system first "
                "(save_design tool) so visuals bind to a design hash."),
            "fix": {
                "tool": "save_design",
                "arguments": {"project_id": project_id},
                "hint": "Save a design system with save_design first before creating visuals.",
            },
        }

    manifest_path = _active_manifest_path(proj, proj_dir)
    if not manifest_path:
        return {
            "ok": False,
            "error_code": "VOICEOVER_REQUIRED",
            "error": "No voiceover manifest found. Run the generate_voiceover stage first.",
            "fix": {
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                "hint": "Generate voiceover audio first so section timings and audio durations are established.",
            },
        }
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    if not isinstance(manifest, list) or not manifest:
        return {
            "ok": False,
            "error_code": "MANIFEST_INVALID",
            "error": "Active manifest is empty or invalid.",
            "fix": {
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                "hint": "Re-run generate_voiceover stage to regenerate the manifest.",
            },
        }

    if section_type == "scene":
        candidates = [m for m in manifest if isinstance(m, dict) and m.get("section_type") == "scene"]
        if not (0 <= scene_index < len(candidates)):
            total_scenes = len(candidates)
            return {
                "ok": False,
                "error_code": "SCENE_INDEX_OUT_OF_RANGE",
                "error": (
                    f"scene_index {scene_index} (UI Scene {scene_index + 1}) out of range "
                    f"(0..{total_scenes - 1} — UI Scenes 1..{total_scenes}). "
                    f"Did you pass a 1-based scene number? In Narrato UI, Scene {scene_index} is scene_index={scene_index - 1}. "
                    f"Use scene_number={scene_index} or scene_index={scene_index - 1}."
                ),
                "valid_scene_indices": f"0..{total_scenes - 1}",
                "valid_scene_numbers": f"1..{total_scenes}",
                "fix": {
                    "hint": f"Pass scene_number={scene_index} or scene_index={scene_index - 1}.",
                },
            }
        entry = candidates[scene_index]
    else:
        entry = next((m for m in manifest
                      if isinstance(m, dict) and m.get("section_type") == section_type), None)
        if entry is None:
            return {
                "ok": False,
                "error_code": "SECTION_NOT_IN_MANIFEST",
                "error": f"No manifest entry for {section_type}.",
                "fix": {
                    "hint": f"Section {section_type} was not found in the voiceover manifest. Verify section_type is 'introduction', 'scene', or 'conclusion'.",
                },
            }

    target_duration = float(entry.get("duration", 0) or 0)
    if target_duration <= 0:
        return {
            "ok": False,
            "error_code": "ZERO_DURATION",
            "error": "Manifest entry has no usable duration.",
            "fix": {
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                "hint": "Voiceover audio for this section has 0s duration. Re-generate voiceover.",
            },
        }

    if cut_index is not None:
        current = _current_section_cuts(proj_dir, section_type, scene_index,
                                        fallback=entry.get("sub_visuals"))
        if not current:
            return {
                "ok": False,
                "error_code": "SECTION_NOT_PERSISTED",
                "error": (
                    "Section has no saved cuts to patch — save the whole section "
                    "first (omit cut_index/cut_number), then patch individual cuts."),
                "fix": {
                    "tool": "save_visuals",
                    "arguments": {
                        "project_id": project_id,
                        "section_type": section_type,
                        "scene_index": scene_index,
                        "sub_visuals": "[array of all cuts for this section]",
                    },
                    "hint": "Save the entire section first without cut_index/cut_number.",
                },
            }
        if not 0 <= cut_index < len(current):
            total_cuts = len(current)
            return {
                "ok": False,
                "error_code": "CUT_INDEX_OUT_OF_RANGE",
                "error": (
                    f"cut_index {cut_index} (UI Cut #{cut_index + 1}) out of range "
                    f"(0..{total_cuts - 1} — UI Cuts #1..#{total_cuts}). "
                    f"Did you pass a 1-based cut number? In Narrato UI, Cut #{cut_index} is cut_index={cut_index - 1}. "
                    f"Use cut_number={cut_index} or cut_index={cut_index - 1}."
                ),
                "valid_cut_indices": f"0..{total_cuts - 1}",
                "valid_cut_numbers": f"1..{total_cuts}",
                "fix": {
                    "hint": f"Pass cut_number={cut_index} or cut_index={cut_index - 1}.",
                },
            }
        import copy
        candidate = copy.deepcopy(current)
        candidate[cut_index] = patch
    else:
        candidate = sub_visuals

    from backend.agent.validators import (
        validate_sub_visuals, detect_legacy_cut_shape,
        migrate_legacy_cut_to_composition, build_sample_cut,
        sanitize_layer_masks,
        CANONICAL_CUT_HINT,
    )
    # Phase 0 AUTO-REPAIR (mirrors the internal loop's correction turn):
    # deterministic, information-preserving fixes are applied server-side
    # instead of rejecting the whole section. The validator contract itself
    # stays strict for both paths — this layer is the forgiving assistant.
    # Deepcopy first: repairs rewrite in place and dry_run promises the
    # caller's payload is never mutated.
    import copy as _copy
    # Unconditional deepcopy: repairs below rewrite in place and dry_run
    # promises the caller's payload is never mutated. (candidate is always
    # a list here — non-lists are rejected above.)
    _cuts = _copy.deepcopy(candidate)
    candidate = _cuts
    auto_fixed: list = []
    for _idx, _cut in enumerate(_cuts):
        if not isinstance(_cut, dict):
            continue
        # (a) z_index/zIndex strip: stacking IS children array order, so
        # dropping the key loses nothing. Previously one stray key rejected
        # the entire section (the failure mode that made agents avoid
        # otherwise-good cuts instead of deleting one key). One entry per
        # cut no matter how many layers carried the key.
        try:
            _comp = _cut.get("composition")
            _kids = _comp.get("children") if isinstance(_comp, dict) else None
            _stripped = 0
            if isinstance(_kids, list):
                for _layer in _kids:
                    if isinstance(_layer, dict) and (
                            "z_index" in _layer or "zIndex" in _layer):
                        _layer.pop("z_index", None)
                        _layer.pop("zIndex", None)
                        _stripped += 1
            if _stripped:
                auto_fixed.append(
                    f"cut#{_idx}: removed z_index/zIndex from "
                    f"{_stripped} layer(s) (stacking is children array "
                    f"order) — resubmit-safe.")
        except Exception:
            pass
        # (b2) mask repair: drop no-op/unknown mask keys, coerce bad
        # reveal easings (incl. legacy 'spring') to ease-out, drop invalid
        # durations/delays and blank polygon points. Idempotent — the
        # validator re-runs the same pass, so this only surfaces notes.
        try:
            _comp2 = _cut.get("composition")
            _kids2 = _comp2.get("children") if isinstance(_comp2, dict) else None
            if isinstance(_kids2, list):
                from backend.agent.validators import hoist_layer_sibling_style as _hoist
                _h = _hoist(_kids2, cut_label=f"cut#{_idx}")
                if _h:
                    auto_fixed.append(
                        f"cut#{_idx}: hoisted/cleaned Layer-level style into content.style "
                        f"on {_h} layer(s) (renderer ignores sibling style — "
                        f"author content.style directly; verify in review_frame).")
                _n = sanitize_layer_masks(_kids2, cut_label=f"cut#{_idx}")
                if _n:
                    auto_fixed.append(
                        f"cut#{_idx}: repaired {_n} mask field(s) "
                        f"(dropped no-op/unknown keys, coerced easing → "
                        f"ease-out — verify this cut in review_frame).")
        except Exception:
            pass
        # (b) legacy layers/layout migration: best-effort conversion, always
        # attempted — the auto_migrate flag is kept for back-compat but no
        # longer changes behavior. On success the cut proceeds with an
        # auto_fixed note to verify in review; on failure the
        # SCHEMA_MISMATCH rejection below fires with a fix patch.
        _legacy = detect_legacy_cut_shape(_cut)
        if _legacy is not None:
            try:
                _cuts[_idx] = migrate_legacy_cut_to_composition(_cut)
                auto_fixed.append(
                    f"cut#{_idx}: legacy layers/layout→composition "
                    f"(best-effort conversion — verify this cut in review_frame).")
                logger.warning(
                    "save_visuals auto-repair: cut#%s legacy layers→composition", _idx)
            except Exception as e:
                logger.warning("save_visuals auto-repair migration failed: %s", e)
                _preview = _copy.deepcopy(build_sample_cut(video_format))
                _preview.pop("note", None)
                _sig_text = "; ".join(_legacy["signals"])
                if "BOTH layers[]" in _sig_text:
                    _got = "cut with both layers[] and composition.children[] (ambiguous)"
                elif "composition.children" in _sig_text or "children[" in _sig_text:
                    _got = "cut.composition.children[] with legacy layer keys"
                else:
                    _got = "cut.layers[] with layout/props"
                return {"ok": False, "error_code": "SCHEMA_MISMATCH",
                        "error": (
                            f"SCHEMA_MISMATCH cut#{_idx}: legacy layers/layout shape. "
                            f"Found: {_sig_text}. "
                            f"Use {CANONICAL_CUT_HINT}."),
                        "cut_index": _idx,
                        "signals": _legacy["signals"],
                        "expected_shape": "cut.composition.children[] of {type:Layer}",
                        "got_shape": _got,
                        "fix": {"hint": "Re-emit as composition.children Layer nodes.",
                                "retry_with": _preview,
                                "note": "retry_with is a valid minimal cut — "
                                        "adapt its shape to your beat and resubmit."},
                        "auto_fixed": auto_fixed,
                        "dry_run": bool(dry_run), "persisted": False}
    # Phase 0.5 AUTO-ENRICHER (Deterministic Polish Middleware):
    # Injects auto-vignettes over footage, Ken Burns ambient drift, clamps frame-0 delays,
    # and enforces safe areas deterministically before validation and persistence.
    try:
        from backend.pipeline.enricher import enrich_sub_visuals
        design_data = None
        design_path = proj_dir / "design.json"
        if design_path.is_file():
            try:
                with open(design_path, "r", encoding="utf-8") as _df:
                    design_data = json.load(_df)
            except Exception:
                design_data = None
        candidate, enrich_notes = enrich_sub_visuals(
            candidate, design_tokens=design_data, video_format=video_format
        )
        if enrich_notes:
            auto_fixed.extend(enrich_notes)
    except Exception as e:
        logger.warning(f"save_visuals: enrich_sub_visuals failed: {e}")

    is_valid, normalized, error_msg = validate_sub_visuals(
        candidate, target_duration, video_format=video_format)
    if not is_valid:
        _res = {"ok": False, "error": f"Visual validation failed: {error_msg}",
                "dry_run": bool(dry_run), "persisted": False,
                "auto_fixed": auto_fixed}
        # One fix key everywhere (retry_with): agents handling one failure
        # shape must not miss the other.
        _preview = _copy.deepcopy(build_sample_cut(video_format))
        _preview.pop("note", None)
        if isinstance(error_msg, str) and error_msg.startswith("SCHEMA_MISMATCH"):
            _res["error_code"] = "SCHEMA_MISMATCH"
            _res["fix"] = {"hint": "Re-emit as composition.children Layer nodes.",
                           "retry_with": _preview}
        elif isinstance(error_msg, str) and error_msg.startswith("MISSING_CONTENT_TYPE"):
            _res["error_code"] = "MISSING_CONTENT_TYPE"
            _res["fix"] = {"hint": ("Every Layer needs content.type — set it "
                                    "(e.g. Text/Image/Video/Shape/Background) and resubmit; "
                                    "do NOT drop the layer."),
                           "reason": str(error_msg),
                           "retry_with": _preview}
        else:
            _res["fix"] = {
                "hint": ("A field has the wrong JSON type or value — the "
                         "validator reason above names it (often a string where "
                         "the schema wants an array, e.g. emphasis must be "
                         "[{at, scale, duration}]). Fix that field's type and "
                         "resubmit the section — do NOT drop the layer."),
                "reason": str(error_msg),
                "retry_with": _preview,
            }
        return _res

    durations = [round(float(v.get("duration", 0)), 2) for v in normalized]
    total = round(sum(durations), 2)
    variety = _visual_variety_report(candidate, normalized, target_duration)
    try:
        from backend.agent.timing import lint_section_timing as _lint_timing
        timing = _lint_timing(normalized)
    except Exception as e:
        logger.warning(f"save_visuals: timing lint failed: {e}")
        from backend.agent.timing import empty_timing_report
        timing = empty_timing_report()
    unverified = unverified_media_queries(normalized)
    total_scenes_count = len([m for m in manifest if isinstance(m, dict) and _normalize_section_type(m.get("section_type")) == "scene"])
    display_label = format_display_label(section_type, scene_index, cut_index)
    scene_num = (scene_index + 1) if section_type == "scene" else None
    cut_num = (cut_index + 1) if cut_index is not None else None
    section_key = (project_id, section_type,
                   scene_index if section_type == "scene" else 0)
    if dry_run:
        with _VERIFIED_LOCK:
            _DRY_RUN_SECTIONS.add(section_key)
            _DRY_RUN_HASHES[section_key] = _normalized_cuts_hash(normalized)
        result = {"ok": True, "project_id": project_id, "section_type": section_type,
                  "scene_index": scene_index if section_type == "scene" else None,
                  "scene_number": scene_num,
                  "display_label": display_label,
                  "total_scenes": total_scenes_count,
                  "total_cuts": len(normalized),
                  "dry_run": True, "persisted": False,
                  "cut_count": len(normalized), "total_duration": total,
                  "durations": durations, "variety": variety,
                  "timing": timing,
                  "unverified_queries": unverified,
                  "auto_fixed": auto_fixed}
        if unverified:
            result["warning"] = (
                f"{len(unverified)} quer{'y' if len(unverified) == 1 else 'ies'} "
                f"not verified via search_media this session "
                f"(e.g. {unverified[0]!r}) — they fail at fetch_assets. "
                f"Verify, then re-dry-run before persisting.")
        if auto_fixed:
            _af = " | ".join(auto_fixed[:4])
            if len(auto_fixed) > 4:
                _af += f" (+{len(auto_fixed) - 4} more)"
            _note = f"auto_fixed: {_af} — verify in review_frame."
            result["warning"] = ((result.get("warning", "") + " " + _note).strip())
        if cut_index is not None:
            result["cut_index"] = cut_index
            result["cut_number"] = cut_num
            result["patched_cut_index"] = cut_index
            result["patched_cut_number"] = cut_num
            result["patched_cut"] = normalized[cut_index]
        return result

    narration_hash = hashlib.md5(
        (entry.get("text") or "").encode("utf-8")).hexdigest()[:12]
    entry["sub_visuals"] = normalized
    entry["_narr_hash"] = narration_hash
    entry["_design_hash"] = design_hash
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Keep the editor working: the frontend (useEditorData) only loads a
    # manifest when project.assets_manifest_path is set, while MCP resolves
    # via fallback (DB -> voiceover -> assets). Persisting visuals without
    # setting the pointer left MCP-authored projects with an empty manifest
    # in the editor (timeline clicks resolve to null, Visuals tab dead).
    # Never fail the save on a DB hiccup — files are the source of truth.
    try:
        _db.update_project(project_id, assets_manifest_path=str(manifest_path))
    except Exception as e:
        logger.warning(f"MCP save_visuals: visuals persisted but assets_manifest_path update failed: {e}")

    # Mirror into script.json (agent payload is authoritative here).
    # The manifest is authoritative for WHICH section was written. When
    # manifest/script scene counts diverge (filtered manifest scenes vs raw
    # script scenes), the index can still be valid — write it and warn
    # loudly instead of silently skipping. A silent skip used to leave
    # script.json stale while the save reported persisted:true, so probe_cut
    # and review_frame (both script-readers) showed old content/hashes.
    script_sync = "ok"
    script_path = proj_dir / "script.json"
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
        if section_type == "introduction" and isinstance(script.get("introduction"), dict):
            script["introduction"]["sub_visuals"] = normalized
        elif section_type == "conclusion" and isinstance(script.get("conclusion"), dict):
            script["conclusion"]["sub_visuals"] = normalized
        elif section_type == "scene" and isinstance(script.get("scenes"), list):
            manifest_scenes = [m for m in manifest
                               if isinstance(m, dict) and m.get("section_type") == "scene"]
            if len(manifest_scenes) != len(script["scenes"]):
                logger.warning(
                    f"MCP save_visuals: manifest has {len(manifest_scenes)} scenes but "
                    f"script.json has {len(script['scenes'])} — writing by index "
                    f"{scene_index} anyway (counts diverge, verify in review_frame).")
                script_sync = (
                    f"diverged: manifest has {len(manifest_scenes)} scenes, "
                    f"script.json has {len(script['scenes'])} — wrote by index "
                    f"{scene_index}; verify this section in review_frame.")
            if 0 <= scene_index < len(script["scenes"]):
                script["scenes"][scene_index]["sub_visuals"] = normalized
            else:
                script_sync = f"skipped: scene_index {scene_index} out of script.json range"
        with open(script_path, "w", encoding="utf-8") as f:
            json.dump(script, f, indent=2, ensure_ascii=False)
    except Exception as e:
        script_sync = f"failed: {e}"
        logger.warning(f"MCP save_visuals: manifest updated but script.json sync failed: {e}")

    # Post-write verification: re-read the stored manifest row and confirm
    # the write actually landed. A success response for a write that didn't
    # happen is a contract violation (agents trust persisted:true) — if the
    # stored hash differs, fail loudly instead of claiming success.
    expected_hash = _normalized_cuts_hash(normalized)
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            _stored_manifest = json.load(f)
        _stored_entry = None
        if section_type == "scene":
            _cands = [m for m in _stored_manifest
                      if isinstance(m, dict) and m.get("section_type") == "scene"]
            if 0 <= scene_index < len(_cands):
                _stored_entry = _cands[scene_index]
        else:
            _stored_entry = next((m for m in _stored_manifest
                                  if isinstance(m, dict) and m.get("section_type") == section_type), None)
        _stored_cuts = (_stored_entry or {}).get("sub_visuals") or []
        _stored_hash = _normalized_cuts_hash(_stored_cuts)
    except Exception as e:
        logger.error("MCP save_visuals: post-write re-read failed: %s", e)
        return {"ok": False, "persisted": False, "verified": False,
                "error": (f"Write could not be verified (re-read failed: {e}). "
                          "Retry the save, then confirm with probe before reviewing.")}
    if _stored_hash != expected_hash:
        logger.error("MCP save_visuals: post-write hash mismatch (expected %s, stored %s)",
                     expected_hash, _stored_hash)
        return {"ok": False, "persisted": False, "verified": False,
                "error": ("Write verification failed: stored content does not match "
                          f"what was sent (expected hash {expected_hash}, stored {_stored_hash}). "
                          "Retry the save, then confirm with probe before reviewing."),
                "expected_hash": expected_hash, "stored_hash": _stored_hash}
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            _script_doc = json.load(f)
        from backend.mcp.stills import compute_visuals_hash as _cvh
        _visuals_hash = _cvh(_script_doc)
    except Exception:
        _visuals_hash = ""

    logger.info(f"MCP save_visuals: project {project_id} {section_type}[{scene_index}] "
                f"{len(normalized)} cuts, {total}s"
                f"{f' (patched cut {cut_index})' if cut_index is not None else ''}.")
    sync_res = _sync_visuals_task_status(project_id, proj_dir, manifest)
    result = {"ok": True, "project_id": project_id, "section_type": section_type,
              "scene_index": scene_index if section_type == "scene" else None,
              "scene_number": scene_num,
              "display_label": display_label,
              "total_scenes": total_scenes_count,
              "total_cuts": len(normalized),
              "persisted": True,
              "verified": True,
              "visuals_hash": _visuals_hash,
              "cut_count": len(normalized), "total_duration": total,
              "durations": durations, "variety": variety,
              "timing": timing,
              "unverified_queries": unverified,
              "auto_fixed": auto_fixed,
              "visuals_completed": sync_res["is_complete"],
              "sections_with_visuals": f"{sync_res['completed']}/{sync_res['total']}"}
    if sync_res["is_complete"]:
        result["next_step"] = (
            "All sections have saved visuals and the 'generate_visuals' stage is marked complete! "
            "Next step: run_stage('fetch_assets', wait=false), then review_frame(mode=composition)."
        )
    else:
        result["next_step"] = (
            f"Section persisted ({sync_res['completed']}/{sync_res['total']} sections saved). "
            "Continue saving remaining sections via save_visuals or save_visuals_batch."
        )
    if cut_index is not None:
        result["cut_index"] = cut_index
        result["cut_number"] = cut_num
        result["patched_cut_index"] = cut_index
        result["patched_cut_number"] = cut_num
        result["patched_cut"] = normalized[cut_index]
    if script_sync != "ok":
        result["warning"] = (f"script.json sync: {script_sync}.").strip()
        result["script_sync"] = script_sync
    else:
        result["script_sync"] = "ok"
    if unverified:
        result["warning"] = (
            (result.get("warning", "") + " " +
             f"{len(unverified)} quer{'y' if len(unverified) == 1 else 'ies'} "
             f"were never verified via search_media (e.g. {unverified[0]!r}) — "
             f"expect fetch_assets misses.").strip())
    if any("best-effort conversion" in f for f in auto_fixed):
        _review_note = ("Server auto-converted legacy cut shape(s) — verify "
                        "those cuts in review_frame before rendering.")
        result["warning"] = ((result.get("warning", "") + " " + _review_note)
                             .strip())
    elif auto_fixed:
        _af = " | ".join(auto_fixed[:4])
        if len(auto_fixed) > 4:
            _af += f" (+{len(auto_fixed) - 4} more)"
        result["warning"] = (
            (result.get("warning", "") + f" auto_fixed: {_af} — verify in review_frame.")
            .strip())
    # Content-hashed coverage: only the exact validated cuts suppress the
    # nudge. Fixed-after-dry-run content was never validated — it still
    # earns the nudge (re-dry-run the fixed section instead of persisting
    # cold). Stale keys are consumed either way.
    with _VERIFIED_LOCK:
        _covered = (_DRY_RUN_HASHES.get(section_key) ==
                    _normalized_cuts_hash(normalized)
                    if section_key in _DRY_RUN_SECTIONS else False)
        _DRY_RUN_SECTIONS.discard(section_key)
        _DRY_RUN_HASHES.pop(section_key, None)
    if not _covered:
        result["nudge"] = (
            "This exact content was persisted without a matching dry_run hash "
            "(never dry-run, or edited after dry_run without re-validating). "
            "Next time: dry_run=true → read reports → fix → re-dry-run ONLY "
            "this section → persist. Unchanged sections stay covered.")
    if cut_index is not None:
        result["patched_cut_index"] = cut_index
    return result


def _visual_variety_report(candidate, normalized, target_duration: float) -> dict:
    """Non-blocking richness feedback for save_visuals responses.

    Compares agent input vs validator output (transition remaps, duration
    renormalization) and profiles the section (kinds used, template runs,
    energy-moment usage). Never raises — on any structural surprise it
    returns what it could compute.
    """
    report: dict = {"normalizations": [], "kinds_used": {},
                    "transitions_used": [], "exits_used": [], "energy_cuts": 0,
                    "max_template_run": {"length": 0, "from_cut": None},
                    "unused_kinds": [], "avg_layers_per_cut": 0.0,
                    "deep_cuts": 0}
    try:
        kinds = ("Image", "Video", "Text", "Chart", "Shape", "Map",
                 "HTML", "Lottie", "Particles", "Counter", "Background")

        def _cut_parts(cut: dict):
            comp = cut.get("composition") or {}
            children = comp.get("children") or []
            layer_kinds, fx = [], False
            geom_buckets = []
            for layer in children:
                if not isinstance(layer, dict):
                    continue
                content = layer.get("content") or {}
                k = content.get("type")
                if isinstance(k, str):
                    layer_kinds.append(k)
                # Coarse geometry bucket (20pp cells of the resolved rect):
                # same kinds + same layout = repetition; same kinds in a
                # different layout = intentional design system, not a rerun.
                try:
                    from backend.agent.geometry import layer_box as _lb
                    _rect = _lb(layer).get("rect")
                    geom_buckets.append(
                        tuple(int(v // 20) for v in _rect)
                        if _rect else None)
                except Exception:
                    geom_buckets.append(None)
                if layer.get("filters"):
                    fx = True
                for mod in ("motion_blur", "floating"):
                    if layer.get(mod):
                        fx = True
                shake = layer.get("camera_shake")
                if shake and shake != "none":
                    fx = True
            # High-energy transitions (mirror the storyboard-planner energy
            # groups): glitch/flash/flip. Mid-energy effects (slides, zooms,
            # blur_focus, wipe_right, iris_open, rise) are motion, not energy.
            if (cut.get("emphasis")
                    or (cut.get("transition") or "") in ("glitch", "flash", "flip")
                    or (cut.get("exit_transition") or "") in ("glitch", "flash", "flip")):
                fx = True
            return layer_kinds, fx, tuple(geom_buckets)

        cand_list = candidate if isinstance(candidate, list) else []
        _valid_cut_keys = frozenset({
            "duration", "transition", "exit_transition", "composition",
            "emphasis", "subtitle_position", "visual_path", "visual_url", "note",
        })
        for i, cut in enumerate(cand_list):
            if not isinstance(cut, dict) or i >= len(normalized):
                continue
            norm = normalized[i]
            if not isinstance(norm, dict):
                continue
            _unknown = sorted(k for k in cut.keys() if k not in _valid_cut_keys)
            if _unknown:
                report["normalizations"].append(
                    f"cut#{i}: ignored unknown cut keys {_unknown} — "
                    f"valid keys: {sorted(_valid_cut_keys - {'note'})}. "
                    f"(exit_transition IS valid as a cut sibling; "
                    f"layer geometry belongs in content.style.)")
            try:
                _raw_kids = (cut.get("composition") or {}).get("children") or []
                _norm_kids = (norm.get("composition") or {}).get("children") or []
                if isinstance(_raw_kids, list) and isinstance(_norm_kids, list):
                    _dropped = len(_raw_kids) - len(_norm_kids)
                    if _dropped > 0:
                        report["normalizations"].append(
                            f"cut#{i}: dropped {_dropped} layer(s) during validation "
                            f"(non-Layer nodes or query-less Image/Video are removed; "
                            f"missing content.type now hard-fails instead). "
                            f"Kept {len(_norm_kids)}/{len(_raw_kids)} — re-emit dropped layers "
                            f"as {{type:Layer, content:{{type, ...}}}} with query where needed.")
            except Exception:
                pass
            raw_t = cut.get("transition")
            norm_t = norm.get("transition")
            if (isinstance(raw_t, str) and raw_t.strip()
                    and isinstance(norm_t, str)
                    and raw_t.strip().lower() != norm_t.strip().lower()):
                report["normalizations"].append(
                    f"cut#{i}: transition {raw_t.strip()!r} is not a valid "
                    f"enum value, remapped to {norm_t.strip()!r} — valid "
                    f"values next time: {list(_VALID_TRANSITIONS)}.")
            raw_e = cut.get("exit_transition")
            norm_e = norm.get("exit_transition")
            if (isinstance(raw_e, str) and raw_e.strip()
                    and isinstance(norm_e, str)
                    and raw_e.strip().lower() != norm_e.strip().lower()):
                report["normalizations"].append(
                    f"cut#{i}: exit_transition {raw_e.strip()!r} is not a valid "
                    f"enum value, remapped to {norm_e.strip()!r} — valid "
                    f"values next time: {list(_VALID_TRANSITIONS)}.")

        try:
            in_total = sum(float(c.get("duration", 0) or 0)
                           for c in cand_list if isinstance(c, dict))
        except (TypeError, ValueError):
            in_total = 0.0
        if in_total and abs(in_total - target_duration) > 0.5:
            report["normalizations"].append(
                f"Durations renormalized: input summed to {round(in_total, 2)}s "
                f"vs audio {round(target_duration, 2)}s. Author per-cut "
                f"durations from get_section_timings so beats land on words.")

        kind_counts: dict = {}
        transitions: dict = {}
        exits: dict = {}
        prev_sig = None
        run_len, run_start = 0, 0
        layer_total, cut_total, deep_cuts = 0, 0, 0
        for i, cut in enumerate(normalized):
            if not isinstance(cut, dict):
                continue
            layer_kinds, fx, geom = _cut_parts(cut)
            cut_total += 1
            layer_total += len(layer_kinds)
            if len(layer_kinds) >= 3:
                deep_cuts += 1
            for k in layer_kinds:
                kind_counts[k] = kind_counts.get(k, 0) + 1
            t = cut.get("transition")
            if isinstance(t, str):
                transitions[t] = transitions.get(t, 0) + 1
            e = cut.get("exit_transition")
            if isinstance(e, str) and e not in ("none", "cut"):
                exits[e] = exits.get(e, 0) + 1
            if fx:
                report["energy_cuts"] += 1
            sig = (tuple(layer_kinds), geom)
            if sig and sig == prev_sig:
                run_len += 1
            else:
                if run_len > report["max_template_run"]["length"]:
                    report["max_template_run"] = {"length": run_len,
                                                  "from_cut": run_start}
                prev_sig, run_len, run_start = sig, 1, i
        if run_len > report["max_template_run"]["length"]:
            report["max_template_run"] = {"length": run_len,
                                          "from_cut": run_start}
        report["kinds_used"] = kind_counts
        report["transitions_used"] = sorted(transitions)
        report["exits_used"] = sorted(exits)
        report["unused_kinds"] = [k for k in kinds if k not in kind_counts]
        report["avg_layers_per_cut"] = round(layer_total / cut_total, 2) if cut_total else 0.0
        report["deep_cuts"] = deep_cuts
        longest = report["max_template_run"]
        if longest["length"] >= 3:
            report["normalizations"].append(
                f"Template repetition: cuts {longest['from_cut']}-"
                f"{longest['from_cut'] + longest['length'] - 1} share one "
                f"layer template (same kinds AND same layout) — vary geometry, "
                f"text treatment, or FX. "
                f"Same kinds in different layouts are a design system, not repetition.")
        if cut_total and deep_cuts == cut_total and cut_total >= 2:
            report["normalizations"].append(
                f"Layered depth: all {cut_total} cuts carry rich stacks "
                f"(avg {report['avg_layers_per_cut']} layers/cut) — keep every "
                f"layer earning its place: a clear job plus motion, no blind stacking.")
        # Source-matrix check (non-blocking): crossed sources are ignored
        # with a wrong-type Pexels fallback — flag so the agent fixes intent.
        for i, cut in enumerate(normalized):
            if not isinstance(cut, dict):
                continue
            comp = cut.get("composition") or {}
            children = comp.get("children") or []
            if not isinstance(children, list):
                continue
            for layer in children:
                if not isinstance(layer, dict):
                    continue
                content = layer.get("content") or {}
                if not isinstance(content, dict):
                    continue
                ctype = content.get("type")
                src = str(content.get("source") or "").strip().lower()
                if ctype == "Image" and src == "youtube":
                    report["normalizations"].append(
                        f"cut#{i}: source 'youtube' on Image is ignored "
                        f"(falls back to Pexels photo) — use "
                        f"pexels|pixabay|wikipedia|archive for Image, youtube is Video-only.")
                elif ctype == "Video" and src == "wikipedia":
                    report["normalizations"].append(
                        f"cut#{i}: source 'wikipedia' on Video is ignored "
                        f"(falls back to Pexels video) — use "
                        f"pexels|pixabay|youtube|archive for Video, wikipedia is Image-only.")
    except Exception as e:
        logger.warning(f"MCP variety report skipped: {e}")
    return report


def _current_section_cuts(proj_dir: Path, section_type: str, scene_index: int,
                          fallback=None) -> list:
    """Saved cuts for a section: live manifest first, script.json fallback.

    The manifest is the write-once source of truth (save_visuals always
    writes it; script.json sync can lag when manifest/script scene counts
    diverge). Reading script-first returned STALE cuts after a successful
    whole-section save — probe_cut showed old content with old hashes while
    the save reported persisted:true. Manifest-first keeps every reader
    (probe, patch base, review durations) on the freshly written data.
    """
    if isinstance(fallback, list) and [c for c in fallback if isinstance(c, dict)]:
        return [c for c in fallback if isinstance(c, dict)]
    try:
        with open(proj_dir / "script.json", "r", encoding="utf-8") as f:
            script = json.load(f)
        if section_type == "introduction" and isinstance(script.get("introduction"), dict):
            cuts = script["introduction"].get("sub_visuals") or []
        elif section_type == "conclusion" and isinstance(script.get("conclusion"), dict):
            cuts = script["conclusion"].get("sub_visuals") or []
        elif section_type == "scene" and isinstance(script.get("scenes"), list):
            if 0 <= scene_index < len(script["scenes"]):
                cuts = script["scenes"][scene_index].get("sub_visuals") or []
            else:
                cuts = []
        else:
            cuts = []
        if [c for c in cuts if isinstance(c, dict)]:
            return cuts
    except Exception:
        pass
    return []


def get_visuals_payload(project_id: str, section_type: str,
                        scene_index: int | None = None,
                        cut_index: int | None = None,
                        scene_number: int | None = None,
                        cut_number: int | None = None) -> dict:
    """Retrieve saved sub_visuals for ONE section (or a SINGLE cut).

    Symmetrical reader for save_visuals. Supports both 0-based indexes
    (scene_index, cut_index) and 1-based UI numbers (scene_number, cut_number).
    """
    norm_sec, scene_index, cut_index, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number,
        cut_index=cut_index, cut_number=cut_number, default_scene=0, default_cut=None
    )
    if err:
        return format_target_error(err, project_id=project_id)
    section_type = norm_sec

    try:
        proj_dir = _project_dir(project_id)
        proj = _get_project_or_raise(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "PROJECT_NOT_FOUND",
            "error": str(e) if str(e).endswith(".")
                     else f"{str(e)} Call list_projects for valid ids.",
            "fix": {"tool": "list_projects",
                    "hint": "Confirm the exact project id with list_projects; "
                            "create_project makes a new one."},
        }

    fallback_cuts = None
    manifest_path = _active_manifest_path(proj, proj_dir)
    total_scenes_count = 0
    if manifest_path and manifest_path.is_file():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if isinstance(manifest, list):
                total_scenes_count = len([m for m in manifest if isinstance(m, dict) and _normalize_section_type(m.get("section_type")) == "scene"])
                if section_type == "scene":
                    scenes = [m for m in manifest if isinstance(m, dict) and _normalize_section_type(m.get("section_type")) == "scene"]
                    if 0 <= scene_index < len(scenes):
                        fallback_cuts = scenes[scene_index].get("sub_visuals")
                    else:
                        return {
                            "ok": False,
                            "error_code": "SCENE_INDEX_OUT_OF_RANGE",
                            "error": (
                                f"scene_index {scene_index} (UI Scene {scene_index + 1}) out of range "
                                f"(0..{total_scenes_count - 1} — UI Scenes 1..{total_scenes_count}). "
                                f"Did you pass a 1-based scene number? In Narrato UI, Scene {scene_index} is scene_index={scene_index - 1}. "
                                f"Use scene_number={scene_index} or scene_index={scene_index - 1}."
                            ),
                            "valid_scene_indices": f"0..{total_scenes_count - 1}",
                            "valid_scene_numbers": f"1..{total_scenes_count}",
                            "fix": {
                                "hint": f"Pass scene_number={scene_index} or scene_index={scene_index - 1}.",
                            },
                        }
                else:
                    entry = next((m for m in manifest if isinstance(m, dict) and _normalize_section_type(m.get("section_type")) == section_type), None)
                    if entry:
                        fallback_cuts = entry.get("sub_visuals")
        except Exception:
            pass

    cuts = _current_section_cuts(proj_dir, section_type, scene_index, fallback=fallback_cuts)
    display_label = format_display_label(section_type, scene_index, cut_index)
    scene_num = (scene_index + 1) if section_type == "scene" else None

    if not cuts:
        return {
            "ok": False,
            "error_code": "NO_VISUALS_FOUND",
            "error": f"No visuals found for {display_label}. Author visuals with save_visuals first.",
            "display_label": display_label,
            "fix": {
                "tool": "save_visuals",
                "arguments": {"project_id": project_id, "section_type": section_type},
                "hint": f"Author visuals for {display_label} using save_visuals.",
            },
        }

    if cut_index is not None and cut_index >= 0:
        if not (0 <= cut_index < len(cuts)):
            total_cuts = len(cuts)
            return {
                "ok": False,
                "error_code": "CUT_INDEX_OUT_OF_RANGE",
                "error": (
                    f"cut_index {cut_index} (UI Cut #{cut_index + 1}) out of range "
                    f"(0..{total_cuts - 1} — UI Cuts #1..#{total_cuts}). "
                    f"Did you pass a 1-based cut number? In Narrato UI, Cut #{cut_index} is cut_index={cut_index - 1}. "
                    f"Use cut_number={cut_index} or cut_index={cut_index - 1}."
                ),
                "valid_cut_indices": f"0..{total_cuts - 1}",
                "valid_cut_numbers": f"1..{total_cuts}",
                "fix": {
                    "hint": f"Pass cut_number={cut_index} or cut_index={cut_index - 1}.",
                },
            }
        return {
            "ok": True,
            "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "scene_number": scene_num,
            "cut_index": cut_index,
            "cut_number": cut_index + 1,
            "display_label": display_label,
            "total_scenes": total_scenes_count,
            "total_cuts": len(cuts),
            "sub_visual": cuts[cut_index],
        }

    return {
        "ok": True,
        "project_id": project_id,
        "section_type": section_type,
        "scene_index": scene_index if section_type == "scene" else None,
        "scene_number": scene_num,
        "display_label": display_label,
        "total_scenes": total_scenes_count,
        "total_cuts": len(cuts),
        "count": len(cuts),
        "sub_visuals": cuts,
    }


# ── Visuals / assets clearing ───────────────────────────────────────

# Downloaded asset filename prefixes managed by fetch_assets (mirrors
# purge_downstream_artifacts + assets._reconcile orphan logic). User
# uploads (upload_*) are never touched.
_MANAGED_ASSET_PREFIXES = ("asset_", "preview_")

# Volatile per-download pointers stripped from ASTs when asset files go
# away (mirrors assets.strip_local_paths + manifest visual_path).
_ASSET_POINTER_KEYS = ("local_path", "asset_url", "visual_path")


def _strip_asset_pointers(node) -> int:
    """Recursively drop download pointers from an AST/manifest node.

    Pops keys unconditionally (even falsy ones — validators may check key
    presence, not truthiness). Returns the number of keys removed.
    Never raises."""
    removed = 0
    try:
        if isinstance(node, dict):
            for key in _ASSET_POINTER_KEYS:
                if key in node:
                    node.pop(key, None)
                    removed += 1
            for value in node.values():
                removed += _strip_asset_pointers(value)
        elif isinstance(node, list):
            for item in node:
                removed += _strip_asset_pointers(item)
    except Exception:
        pass
    return removed


def _atomic_write_json(path: Path, obj) -> None:
    """Write JSON atomically (tmp file + replace) so a crash mid-write can
    never leave a corrupted half-written file behind."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def _reset_mcp_tasks(project_id: str, steps: tuple, message: str) -> None:
    """Reset task rows to pending after an MCP-side invalidation.

    create_task first: update_task on a missing row is a silent no-op."""
    for step in steps:
        try:
            _db.create_task(project_id, step)
        except Exception:
            pass
        try:
            _db.update_task(
                f"{project_id}_{step}",
                status="pending", progress=0.0,
                message=message, error_message=None,
            )
        except Exception:
            pass


def _manifest_paths_for_clear(proj: dict, proj_dir: Path) -> list:
    """Every manifest file that may hold sub_visuals (voiceover + assets).

    _active_manifest_path resolves only the live one, but a stale twin can
    linger after fetch_assets — clear both so they can never disagree."""
    paths = []
    try:
        active = _active_manifest_path(proj, proj_dir)
        if active is not None:
            paths.append(active)
    except Exception:
        pass
    for candidate in (proj_dir / "voiceover" / "manifest.json",
                      proj_dir / "assets" / "assets_manifest.json"):
        if candidate not in paths:
            paths.append(candidate)
    return paths


def _wipe_holder_sections(holder: dict) -> tuple:
    """Set every section's sub_visuals to [] in a script-shaped dict.

    Returns (sections_with_cuts, cuts) counted BEFORE wiping — the logical
    numbers reported to the agent."""
    sections = 0
    cuts = 0
    intro = holder.get("introduction")
    if isinstance(intro, dict) and isinstance(intro.get("sub_visuals"), list):
        if intro["sub_visuals"]:
            sections += 1
            cuts += len([c for c in intro["sub_visuals"] if isinstance(c, dict)])
        intro["sub_visuals"] = []
    for scene in (holder.get("scenes") or []):
        if isinstance(scene, dict) and isinstance(scene.get("sub_visuals"), list):
            if scene["sub_visuals"]:
                sections += 1
                cuts += len([c for c in scene["sub_visuals"] if isinstance(c, dict)])
            scene["sub_visuals"] = []
    concl = holder.get("conclusion")
    if isinstance(concl, dict) and isinstance(concl.get("sub_visuals"), list):
        if concl["sub_visuals"]:
            sections += 1
            cuts += len([c for c in concl["sub_visuals"] if isinstance(c, dict)])
        concl["sub_visuals"] = []
    return sections, cuts


def _clear_sub_visuals_everywhere(proj_dir: Path, manifest_paths: list) -> dict:
    """Set every section's sub_visuals to [] in script.json + manifests.

    Counts are canonical (from script.json — the authoritative copy), NOT
    summed across the manifest twins, so one logical cut reports as 1.
    Manifests are synced silently and listed in manifests_written.
    Returns {sections_cleared, cuts_cleared, manifests_written}."""
    sections_cleared = 0
    cuts_cleared = 0

    script_path = proj_dir / "script.json"
    if script_path.is_file():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
            if isinstance(script, dict):
                sections_cleared, cuts_cleared = _wipe_holder_sections(script)
                _atomic_write_json(script_path, script)
        except Exception as e:
            logger.warning(f"MCP clear_visuals: script.json wipe failed: {e}")

    manifests_written = []
    for manifest_path in manifest_paths:
        try:
            if not manifest_path.is_file():
                continue
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if not isinstance(manifest, list):
                continue
            for entry in manifest:
                if not isinstance(entry, dict):
                    continue
                entry["sub_visuals"] = []
                entry.pop("_narr_hash", None)
                entry.pop("_design_hash", None)
            # Always rewrite: hash bindings are dropped even when no cuts existed.
            _atomic_write_json(manifest_path, manifest)
            manifests_written.append(str(manifest_path))
        except Exception as e:
            logger.warning(f"MCP clear_visuals: manifest wipe failed ({manifest_path}): {e}")
    return {"sections_cleared": sections_cleared, "cuts_cleared": cuts_cleared,
            "manifests_written": manifests_written}


def _delete_asset_files(proj_dir: Path) -> list:
    """Delete managed download artifacts. Returns relative paths removed.

    Covers assets/asset_*, assets/preview_*, assets_manifest.json and the
    previews/ dir (incl. the per-project stills cache — content-addressed
    files that can never hit again once visuals change). User uploads
    (upload_*) are never touched."""
    import shutil
    deleted: list = []
    assets_dir = proj_dir / "assets"
    if not assets_dir.is_dir():
        return deleted
    for child in sorted(assets_dir.iterdir()):
        try:
            name = child.name
            if child.is_dir() and name == "previews":
                shutil.rmtree(child, ignore_errors=True)
                deleted.append("assets/previews/")
            elif child.is_file() and (
                name == "assets_manifest.json"
                or any(name.startswith(p) for p in _MANAGED_ASSET_PREFIXES)
            ):
                child.unlink()
                deleted.append(f"assets/{name}")
        except Exception as e:
            logger.warning(f"MCP clear assets: could not delete {child}: {e}")
    return deleted


def _prune_stills_cache(proj_dir: Path) -> bool:
    """Drop the per-project composition-stills cache (derived pixels, always
    re-renderable). Returns True when anything was removed."""
    import shutil
    stills_dir = proj_dir / "assets" / "previews" / "stills"
    try:
        if stills_dir.is_dir():
            shutil.rmtree(stills_dir, ignore_errors=True)
            return True
    except Exception as e:
        logger.warning(f"MCP clear visuals: stills prune failed: {e}")
    return False


def clear_assets_payload(project_id: str) -> dict:
    """Delete downloaded asset files + strip their pointers from ASTs.

    Removes assets/asset_*, assets/preview_*, assets_manifest.json and the
    previews dir; strips local_path/asset_url/visual_path from script.json
    and both manifests (stale pointers would make render fail on missing
    files). Queries/AST structure are kept so fetch_assets can re-run
    without re-authoring. Resets fetch_assets + render to pending and
    clears video_path/assets_manifest_path. Never touches voiceover,
    transcription, design, upload_* files, or narration."""
    _get_project_or_raise(project_id)
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "UNSAFE_PROJECT_ID",
            "error": f"Could not resolve a safe project directory for {project_id!r}: {e}.",
            "fix": {"tool": "list_projects",
                    "hint": "The project id failed the storage-path safety check — "
                            "confirm the exact id with list_projects."},
        }
    proj = _get_project_or_raise(project_id)

    deleted_files = _delete_asset_files(proj_dir)

    pointers_stripped = 0
    manifests_written: list = []
    script_path = proj_dir / "script.json"
    if script_path.is_file():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
            if isinstance(script, dict):
                pointers_stripped += _strip_asset_pointers(script)
                _atomic_write_json(script_path, script)
        except Exception as e:
            logger.warning(f"MCP clear_assets: script.json strip failed: {e}")
    for manifest_path in _manifest_paths_for_clear(proj, proj_dir):
        try:
            if not manifest_path.is_file():
                continue
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            removed = _strip_asset_pointers(manifest)
            if removed:
                pointers_stripped += removed
                _atomic_write_json(manifest_path, manifest)
                manifests_written.append(str(manifest_path))
        except Exception as e:
            logger.warning(f"MCP clear_assets: manifest strip failed ({manifest_path}): {e}")

    _reset_mcp_tasks(
        project_id, ("fetch_assets", "render"),
        "Pending upstream changes (assets cleared via MCP).")
    try:
        _db.update_project(project_id, video_path=None,
                           assets_manifest_path=None)
    except Exception:
        pass
    with _VERIFIED_LOCK:
        _VERIFIED_QUERIES.clear()
    logger.info(f"MCP clear_assets: project {project_id} "
                f"{len(deleted_files)} files, {pointers_stripped} pointers.")
    return {"ok": True, "project_id": project_id,
            "deleted_files": deleted_files,
            "deleted_count": len(deleted_files),
            "pointers_stripped": pointers_stripped,
            "next_step": "Re-run save_visuals (if visuals were also cleared) then "
                         "run_stage(fetch_assets) to re-download."}


def clear_visuals_payload(project_id: str, clear_assets: bool = True) -> dict:
    """Delete all generated visual ASTs (every section's sub_visuals → []).

    Wipes script.json plus the voiceover and assets manifests (both, so the
    twins can never disagree) and drops their _narr_hash/_design_hash
    bindings. Narration, voiceover audio, transcription, and design.json
    are untouched.

    clear_assets=True (default) also deletes downloaded asset files —
    orphaned asset_* files would otherwise linger with no referencing cut
    (their pointers die with the cuts, so no strip pass is needed). Pass
    False to keep downloads (e.g. you only want to re-author cuts against
    the same media); the stills cache is still pruned since its
    visuals_hash can never hit again.
    fetch_assets + render reset to pending either way."""
    _get_project_or_raise(project_id)
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {
            "ok": False,
            "error_code": "UNSAFE_PROJECT_ID",
            "error": f"Could not resolve a safe project directory for {project_id!r}: {e}.",
            "fix": {"tool": "list_projects",
                    "hint": "The project id failed the storage-path safety check — "
                            "confirm the exact id with list_projects."},
        }
    if not (proj_dir / "script.json").is_file():
        return {"ok": False,
                "error_code": "SCRIPT_NOT_FOUND",
                "error": "script.json not found. Use save_script first.",
                "fix": {"tool": "save_script",
                        "hint": "clear_visuals needs an existing script.json (it wipes sub_visuals from it). Save a complete script with save_script first."}}
    proj = _get_project_or_raise(project_id)

    wipe = _clear_sub_visuals_everywhere(
        proj_dir, _manifest_paths_for_clear(proj, proj_dir))
    with _VERIFIED_LOCK:
        _VERIFIED_QUERIES.clear()
    # Dry-run history keys are (project_id, section, scene_index) tuples —
    # drop this project's so re-authored sections get the dry_run nudge again.
    with _VERIFIED_LOCK:
        for key in [k for k in _DRY_RUN_SECTIONS
                    if isinstance(k, tuple) and k and k[0] == project_id]:
            _DRY_RUN_SECTIONS.discard(key)
            _DRY_RUN_HASHES.pop(key, None)

    deleted_files: list = []
    stills_pruned = False
    if clear_assets:
        deleted_files = _delete_asset_files(proj_dir)
    else:
        stills_pruned = _prune_stills_cache(proj_dir)
    _reset_mcp_tasks(
        project_id, ("generate_visuals", "fetch_assets", "render"),
        "Pending upstream changes (visuals cleared via MCP).")
    try:
        _db.update_project(
            project_id, video_path=None,
            **({"assets_manifest_path": None} if clear_assets else {}))
    except Exception:
        pass
    logger.info(f"MCP clear_visuals: project {project_id} "
                f"{wipe['cuts_cleared']} cuts in {wipe['sections_cleared']} "
                f"sections (clear_assets={bool(clear_assets)}).")
    result = {"ok": True, "project_id": project_id,
              "sections_cleared": wipe["sections_cleared"],
              "cuts_cleared": wipe["cuts_cleared"],
              "clear_assets": bool(clear_assets),
              "next_step": ("Re-author with save_visuals_batch "
                            "(dry_run first), then run_stage(fetch_assets).")}
    if clear_assets:
        result["assets"] = {"deleted_count": len(deleted_files),
                            "deleted_files": deleted_files}
    elif stills_pruned:
        result["stills_pruned"] = True
    return result


# ── Visuals batch (one call for a whole video) ──────────────────────

_MAX_BATCH_SECTIONS = 100


def _strict_int(value, default: int = 0) -> int | None:
    """Integer for section addressing: bools, floats, and numeric strings
    are rejected (int(1.9)==1 would silently retarget a different scene).
    None/absent → default. Returns None when invalid."""
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _video_variety_rollup(ok_entries: list) -> dict:
    """Whole-video variety across batch sections (the flat-video guard).

    Per-section variety can all be green while 30 sections share one
    identical signature — the exact failure this rollup catches. Returns
    merged kind/transition histograms, total energy cuts, a uniform-
    signature flag, and single-kind section indexes."""
    kinds_total: dict = {}
    transitions_total: dict = {}
    exits_total: dict = {}
    energy_total = 0
    sig_sets = []
    single_kind_sections = []
    deep_cuts_total = 0
    layers_weighted = 0.0
    sections_with_avg = 0
    for entry in ok_entries:
        variety = entry.get("variety") or {}
        kinds = variety.get("kinds_used") or {}
        for kind, count in kinds.items():
            try:
                kinds_total[kind] = kinds_total.get(kind, 0) + int(count)
            except (TypeError, ValueError):
                pass
        for trans in (variety.get("transitions_used") or []):
            transitions_total[trans] = transitions_total.get(trans, 0) + 1
        for ext in (variety.get("exits_used") or []):
            exits_total[ext] = exits_total.get(ext, 0) + 1
        try:
            energy_total += int(variety.get("energy_cuts", 0) or 0)
        except (TypeError, ValueError):
            pass
        try:
            deep_cuts_total += int(variety.get("deep_cuts", 0) or 0)
        except (TypeError, ValueError):
            pass
        try:
            _avg = float(variety.get("avg_layers_per_cut", 0) or 0)
            if _avg > 0:
                layers_weighted += _avg
                sections_with_avg += 1
        except (TypeError, ValueError):
            pass
        key_set = frozenset(k for k in kinds if isinstance(k, str))
        sig_sets.append(key_set)
        if len(key_set) <= 1:
            idx = entry.get("index")
            sec = entry.get("section_type")
            single_kind_sections.append(
                f"sections[{idx}] ({sec})" if sec else f"sections[{idx}]")
    uniform_signature = (len(ok_entries) >= 2 and len(set(sig_sets)) == 1)
    avg_layers = round(layers_weighted / sections_with_avg, 2) if sections_with_avg else 0.0
    # A deep, consistent kind system (same palette, avg 3+ layers) is a
    # design system, not flat video — only flag uniform kinds when shallow.
    if uniform_signature and avg_layers >= 3.0:
        uniform_signature = False
    return {"sections_analyzed": len(ok_entries),
            "kinds_total": kinds_total,
            "kinds_used_count": len(kinds_total),
            "transitions_total": transitions_total,
            "exits_total": exits_total,
            "energy_cuts_total": energy_total,
            "uniform_signature": uniform_signature,
            "single_kind_sections": single_kind_sections,
            "deep_cuts_total": deep_cuts_total,
            "avg_layers_per_cut": avg_layers}


def _format_batch_item_error(label: str, exc: Exception | str,
                             default_code: str = "SECTION_ERROR") -> dict:
    """Shaped, retellable error for one save_visuals_batch section item.

    Batch rollup tells agents to apply results[].fix.retry_with — bare
    str(e) items without a fix left that instruction dangling and caused
    identical-payload retry loops.
    """
    msg = str(exc)
    low = msg.lower()
    if ("not valid json" in low or "jsondecode" in low or isinstance(exc, json.JSONDecodeError)):
        code = "INVALID_JSON_SYNTAX"
    elif ("out of range" in low or "not a valid integer" in low):
        code = "INVALID_INDEX"
    elif "no valid design" in low:
        code = "DESIGN_REQUIRED"
    elif "manifest" in low:
        code = "VOICEOVER_REQUIRED"
    else:
        code = default_code
    return {"ok": False, "error": f"{label}: {msg}", "error_code": code,
            "fix": {"hint": "Fix only this section and re-dry-run it "
                            "(save_visuals_batch with dry_run=true and just "
                            "this one section) — leave OK sections untouched."}}


def save_visuals_batch_payload(project_id: str, sections: list,
                               dry_run: bool = False) -> dict:
    """Validate/persist sub_visuals for MANY sections in ONE call.

    Each item: {section_type, sub_visuals, scene_index?, cut_index?}.
    This is the MCP answer to the internal loop's per-scene fan-out: a
    30-section video costs 3 calls (batch dry_run → re-dry-run fixed
    sections → batch persist) instead of 60-90, so agents stop rationing
    cuts and dry-runs under tool-call pressure. Sections are processed
    independently — one bad section never blocks the rest; fix only the
    failed ones (by index) and re-run the batch or patch single cuts.
    Returns per-section results + summary + whole-video variety rollup;
    ok is True only when every section succeeded. persisted is True only
    when dry_run=false AND every section persisted (a partial persist
    never claims the whole video is saved)."""
    logger.debug("save_visuals_batch entry: sections type=%s (project=%s n=%s)",
                 type(sections).__name__, project_id,
                 len(sections) if isinstance(sections, list) else "?")
    sections, _bcoerced, _bcoerce_err = _coerce_json_array(sections, "sections")
    if _bcoerce_err is not None:
        return _bcoerce_err
    if not isinstance(sections, list) or not sections:
        _got = type(sections).__name__
        if isinstance(sections, list):
            _got = "empty list"
        elif isinstance(sections, dict):
            _got = f"dict with keys {sorted(sections.keys())[:6]}"
        return {
            "ok": False,
            "error_code": "INVALID_BATCH_SECTIONS",
            "error": f"sections must be a non-empty array of "
                     f"{{section_type, sub_visuals, scene_index?, cut_index?}} (got {_got}). "
                     f"For intro/conclusion omit scene_index (or pass null/0) — "
                     f"scene_index is only for section_type='scene'.",
            "fix": {
                "hint": "Pass an array of section objects, e.g. sections: [{section_type: 'introduction', sub_visuals: [...]}, {section_type: 'scene', scene_number: 1, sub_visuals: [...]}]",
            },
        }
    if len(sections) > _MAX_BATCH_SECTIONS:
        return {
            "ok": False,
            "error_code": "BATCH_SIZE_EXCEEDED",
            "error": f"Batch capped at {_MAX_BATCH_SECTIONS} sections "
                     f"(got {len(sections)}); split into smaller batches.",
            "max_batch_size": _MAX_BATCH_SECTIONS,
            "provided_count": len(sections),
            "fix": {
                "hint": f"Split sections into batches of at most {_MAX_BATCH_SECTIONS} sections each and call save_visuals_batch sequentially.",
            },
        }
    _get_project_or_raise(project_id)  # fail fast before any writes
    proj_dir = _project_dir(project_id)
    results: list = []
    ok_count = 0
    cuts_total = 0
    seen_targets: dict = {}
    for pos, item in enumerate(sections):
        label = f"sections[{pos}]"
        if not isinstance(item, dict):
            results.append({
                "ok": False,
                "index": pos,
                "error_code": "INVALID_BATCH_ITEM",
                "error": f"{label} must be an object.",
                "fix": {"hint": f"Ensure {label} is a dictionary/object with section_type and sub_visuals."},
            })
            continue
        section_type = item.get("section_type")
        sub_visuals = item.get("sub_visuals")
        if isinstance(sub_visuals, str):
            sub_visuals, _, _sv_err = _coerce_json_array(sub_visuals, f"sections[{pos}].sub_visuals")
            if _sv_err is not None:
                results.append({"ok": False, "index": pos,
                                "section_type": section_type,
                                "error": f"{label}.{_sv_err['error']}"})
                continue
        scene_index = item.get("scene_index")
        scene_number = item.get("scene_number")
        cut_index = item.get("cut_index")
        cut_number = item.get("cut_number")

        norm_sec, scene_index, cut_index, err = resolve_scene_and_cut(
            section_type, scene_index=scene_index, scene_number=scene_number,
            cut_index=cut_index, cut_number=cut_number, default_scene=0, default_cut=None,
            allow_negative_cut=False
        )
        if err:
            results.append({"ok": False, "index": pos,
                            "section_type": section_type,
                            "error": f"{label}.{err}" if any(k in err for k in ("cut_index", "cut_number", "scene_index", "scene_number")) else f"{label}: {err}"})
            continue
        section_type = norm_sec

        # Duplicate targets: second write would silently clobber the first
        # while both report ok:true (common when an agent repeats
        # introduction/scene[0] across a 30-section batch).
        target = (section_type, scene_index if section_type == "scene" else 0,
                  cut_index)
        if target in seen_targets:
            results.append({"ok": False, "index": pos,
                            "section_type": section_type,
                            "error_code": "DUPLICATE_BATCH_TARGET",
                            "error": f"{label} duplicates sections[{seen_targets[target]}] "
                                     f"(same section target) — keep one entry; "
                                     f"the first was processed, this one was skipped.",
                            "fix": {"hint": f"Remove duplicate entry for {section_type} from the batch."}})
            continue
        seen_targets[target] = pos
        try:
            res = save_visuals_payload(
                project_id, section_type, sub_visuals, scene_index=scene_index,
                cut_index=cut_index, dry_run=bool(dry_run))
        except ValueError as e:
            res = _format_batch_item_error(label, exc=e,
                                           default_code="SECTION_VALIDATION_ERROR")
        except Exception as e:
            logger.error(f"MCP save_visuals_batch {label} failed: {e}",
                         exc_info=True)
            res = _format_batch_item_error(label, exc=e,
                                           default_code="SECTION_SAVE_FAILED")
        entry = {"ok": bool(res.get("ok")), "index": pos,
                 "section_type": section_type,
                 "display_label": format_display_label(section_type, scene_index, cut_index)}
        if section_type == "scene":
            entry["scene_index"] = scene_index
            entry["scene_number"] = scene_index + 1
        if cut_index is not None:
            entry["cut_index"] = cut_index
            entry["cut_number"] = cut_index + 1
        if res.get("ok"):
            ok_count += 1
            cuts_total += int(res.get("cut_count", 0) or 0)
            for key in ("cut_count", "total_duration", "durations", "variety",
                        "timing", "unverified_queries",
                        "auto_fixed", "warning", "nudge", "patched_cut_index",
                        "patched_cut"):
                if key in res:
                    entry[key] = res[key]
        else:
            for key in ("error", "error_code", "fix", "signals",
                        "expected_shape", "got_shape", "cut_index",
                        "auto_fixed"):
                if key in res:
                    entry[key] = res[key]
        entry["dry_run"] = bool(dry_run)
        entry["persisted"] = bool(res.get("persisted", False))
        results.append(entry)
    failed = len(results) - ok_count
    summary = {"sections_total": len(results), "sections_ok": ok_count,
               "sections_failed": failed, "cuts_total": cuts_total}
    video_variety = _video_variety_rollup([r for r in results if r.get("ok")])
    sync_res = _sync_visuals_task_status(project_id, proj_dir) if not dry_run else {"is_complete": False, "completed": 0, "total": 0}
    out = {"project_id": project_id, "dry_run": bool(dry_run),
           "persisted": bool(not dry_run and failed == 0),
           "visuals_completed": sync_res["is_complete"] if not dry_run else False,
           "sections_with_visuals": f"{sync_res['completed']}/{sync_res['total']}" if not dry_run else "0/0",
           "summary": summary, "video_variety": video_variety,
           "results": results}
    flat_notes = []
    if video_variety["uniform_signature"]:
        flat_notes.append(
            "Every successful section shares one identical layer-kind "
            "signature at shallow depth — individually valid but video-flat "
            "as a set. Compose sections from different types/layouts before "
            "rendering.")
    if video_variety["single_kind_sections"]:
        flat_notes.append(
            f"Single-kind sections: "
            f"{', '.join(video_variety['single_kind_sections'][:8])}"
            f"{' …' if len(video_variety['single_kind_sections']) > 8 else ''}.")
    if not dry_run and failed == 0 and video_variety["energy_cuts_total"] == 0 \
            and ok_count > 0:
        flat_notes.append(
            "Zero energy cuts across the whole video (no emphasis, shake, "
            "motion_blur, FX filter, rack-focus, floating, or Particles used) "
            "— the motion toolset is untouched.")
    if flat_notes:
        out["variety_warning"] = " ".join(flat_notes)
    if failed:
        out["ok"] = False
        out["error"] = (
            f"{failed}/{len(results)} section(s) failed — fix the failed "
            f"indexes (see results[].fix.retry_with), re-dry-run the fixed "
            "ones, then persist; successful sections are already "
            f"{'validated' if dry_run else 'persisted'}.")
    else:
        out["ok"] = True
        if dry_run:
            out["next_step"] = (
                "All sections validated — re-dry-run any section you edit, then "
                "persist with dry_run=false."
            )
        elif sync_res["is_complete"]:
            out["next_step"] = (
                "All sections persisted and visuals stage marked complete! "
                "Next step: run_stage('fetch_assets', wait=false), then "
                "review_frame(mode=composition) per section."
            )
        else:
            out["next_step"] = (
                f"Batch persisted ({sync_res['completed']}/{sync_res['total']} sections have visuals). "
                "Save the remaining sections to complete the visual stage, then run_stage('fetch_assets')."
            )
    # Dry-run coverage summary: persisting edited-but-unvalidated content is
    # the expected path after fixing flagged overflows — name exactly which
    # sections changed so the agent re-dry-runs ONLY those next time.
    if not dry_run and not failed:
        _nudged = [r.get("index") for r in results
                   if isinstance(r, dict) and r.get("nudge")]
        _covered = [r.get("index") for r in results
                    if isinstance(r, dict) and r.get("ok") and not r.get("nudge")]
        if _nudged:
            out["dry_run_coverage"] = {
                "covered": _covered,
                "changed_after_dry_run": _nudged,
                "hint": (f"{len(_covered)}/{len(results)} sections matched their dry_run hash; "
                         f"{len(_nudged)} changed afterwards (sections { _nudged }) and were "
                         f"persisted without re-validation. Next time re-dry-run ONLY the "
                         f"fixed indexes before persisting — no need to re-validate the whole batch."),
            }
    return out

# ── Transcription Payload ──────────────────────────────────────────

def _load_script_sections(proj_dir: Path) -> list[dict]:
    """Load canonical script sections in manifest order with tokenized words."""
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return []
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
    except Exception:
        return []
    sections: list[dict] = []
    if script.get("introduction"):
        intro = script["introduction"]
        text_val = intro.get("hook", "") or intro.get("narration", "")
        sections.append({
            "section_type": "introduction",
            "scene_index": None,
            "title": intro.get("title", "Introduction"),
            "text": text_val,
            "words": text_val.split(),
        })
    for idx, sc in enumerate(script.get("scenes", []) or []):
        if not isinstance(sc, dict):
            continue
        text_val = sc.get("narration", "") or ""
        sections.append({
            "section_type": "scene",
            "scene_index": idx,
            "title": sc.get("title", f"Scene {idx + 1}"),
            "text": text_val,
            "words": text_val.split(),
        })
    if script.get("conclusion"):
        conc = script["conclusion"]
        text_val = (conc.get("summary", "") or "")
        if conc.get("cta"):
            text_val = (text_val + " " + conc.get("cta")).strip()
        sections.append({
            "section_type": "conclusion",
            "scene_index": None,
            "title": conc.get("title", "Conclusion"),
            "text": text_val,
            "words": text_val.split(),
        })
    return sections


def get_transcription_payload(
    project_id: str,
    section_type: str = "",
    scene_index: int | None = 0,
    segment_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
    scene_number: int | None = None,
) -> dict:
    """Read transcription data with optional section or segment filtering."""
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    json_path = proj_dir / "subtitles" / "transcription.json"

    if not json_path.exists():
        return {
            "ok": False,
            "error_code": "TRANSCRIPTION_NOT_FOUND",
            "error": "transcription.json not found. Run run_stage(transcribe) first.",
            "fix": {
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "transcribe", "wait": True},
                "hint": "Run the transcribe stage to generate word-level timings.",
            },
        }

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments") or []
    language = data.get("language", (proj or {}).get("language", "hi") if isinstance(proj, dict) else "hi")

    def _safe_float(v, default=0.0):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    # Single segment request (coerce LLM string ids like "1").
    if segment_id is not None:
        try:
            want = int(segment_id)
        except (TypeError, ValueError):
            return {
                "ok": False,
                "error_code": "INVALID_SEGMENT_ID",
                "error": f"Segment id {segment_id!r} is not a valid integer.",
                "fix": {"hint": "Provide segment_id as an integer."},
            }
        seg = None
        for s in segments:
            if not isinstance(s, dict):
                continue
            try:
                if int(s.get("id")) == want:
                    seg = s
                    break
            except (TypeError, ValueError):
                if s.get("id") == segment_id:
                    seg = s
                    break
        if seg is None:
            return {
                "ok": False,
                "error_code": "SEGMENT_NOT_FOUND",
                "error": f"Segment id {segment_id} not found.",
                "fix": {"hint": "Check transcription segments without segment_id filter to find valid IDs."},
            }
        return {"ok": True, "project_id": project_id, "segment": seg}

    # Section-scoped request
    if section_type:
        norm_sec, scene_index, _, err = resolve_scene_and_cut(
            section_type, scene_index=scene_index, scene_number=scene_number, default_scene=0
        )
        if err:
            return {"ok": False, "error_code": "INVALID_SECTION_TARGET", "error": err}
        section_type = norm_sec

        manifest_path = _active_manifest_path(proj, proj_dir)
        if not manifest_path:
            return {
                "ok": False,
                "error_code": "MANIFEST_NOT_FOUND",
                "error": "Manifest not found to resolve section boundaries.",
                "fix": {
                    "tool": "run_stage",
                    "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                    "hint": "Generate voiceover to establish section boundaries.",
                },
            }
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if not isinstance(manifest, list):
                raise ValueError("manifest is not a list")
        except Exception as e:
            return {
                "ok": False,
                "error_code": "MANIFEST_READ_ERROR",
                "error": (f"Could not read voiceover manifest {manifest_path}: "
                          f"{type(e).__name__}: {e}. It is missing, corrupted, or "
                          f"not a JSON list (interrupted generate_voiceover run)."),
                "fix": {"tool": "run_stage",
                        "arguments": {"project_id": project_id, "stage": "generate_voiceover"},
                        "hint": "Re-run run_stage('generate_voiceover') to regenerate the manifest, then retry this tool."},
            }

        cursor = 0.0
        sec_start = None
        sec_dur = None
        scene_count = 0
        for entry in manifest:
            if not isinstance(entry, dict):
                continue
            try:
                dur = float(entry.get("duration", 0) or 0)
            except (TypeError, ValueError):
                dur = 0.0
            m_sec = _normalize_section_type(entry.get("section_type"))
            if section_type == "scene" and m_sec == "scene":
                if scene_count == scene_index:
                    sec_start = cursor
                    sec_dur = dur
                    break
                scene_count += 1
            elif section_type == m_sec:
                sec_start = cursor
                sec_dur = dur
                break
            cursor += dur

        if sec_start is None:
            return {
                "ok": False,
                "error_code": "SECTION_NOT_IN_MANIFEST",
                "error": f"Section {format_display_label(section_type, scene_index)} not found in manifest.",
                "fix": {"hint": "Check the section_type and scene_number against the project script."},
            }

        sec_end = sec_start + sec_dur
        matched_segments = []
        for s in segments:
            if not isinstance(s, dict):
                continue
            s_start = _safe_float(s.get("start", 0))
            s_end = _safe_float(s.get("end", 0))
            # Overlap condition
            if s_start < sec_end and s_end > sec_start:
                matched_segments.append(s)

        matched_words = []
        for s in matched_segments:
            for w in s.get("words", []) or []:
                if not isinstance(w, dict):
                    continue
                if sec_start <= _safe_float(w.get("start", 0)) < sec_end:
                    matched_words.append(w)

        return {
            "ok": True,
            "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "scene_number": (scene_index + 1) if section_type == "scene" else None,
            "display_label": format_display_label(section_type, scene_index),
            "section_start": round(sec_start, 2),
            "section_end": round(sec_end, 2),
            "section_duration": round(sec_dur, 2),
            "total_section_segments": len(matched_segments),
            "total_section_words": len(matched_words),
            "segments": matched_segments,
            "words": matched_words,
        }

    # Paginated overview (clamp negatives: offset/limit < 0 would slice from end).
    try:
        offset = max(0, int(offset))
    except (TypeError, ValueError):
        offset = 0
    try:
        limit = max(0, int(limit))
    except (TypeError, ValueError):
        limit = 50
    total_segments = len(segments)
    total_words = sum(len(s.get("words", []) or []) for s in segments if isinstance(s, dict))
    paginated = segments[offset : offset + limit]

    return {
        "ok": True,
        "project_id": project_id,
        "language": language,
        "total_segments": total_segments,
        "total_words": total_words,
        "offset": offset,
        "limit": limit,
        "segments": paginated,
    }


# ── QA gate / stock verification / video receipts ───────────────────

def _sha256_file(path) -> str:
    """Hex sha256 of a file, or '' when missing/unreadable."""
    import hashlib
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""


def _walk_media_layers(document: dict) -> list:
    """Flat list of every Image/Video layer across intro/scenes/conclusion."""
    out = []
    sections = []
    if isinstance(document.get("introduction"), dict):
        sections.append(("introduction", None, document["introduction"]))
    for i, scene in enumerate(document.get("scenes", []) or []):
        if isinstance(scene, dict):
            sections.append(("scene", i + 1, scene))
    if isinstance(document.get("conclusion"), dict):
        sections.append(("conclusion", None, document["conclusion"]))
    for section_type, scene_number, sec in sections:
        for ci, cut in enumerate(sec.get("sub_visuals", []) or []):
            if not isinstance(cut, dict):
                continue
            comp = cut.get("composition") or {}
            for li, layer in enumerate(comp.get("children", []) or []):
                if not isinstance(layer, dict):
                    continue
                content = layer.get("content") or {}
                ctype = str(content.get("type") or "")
                if ctype not in ("Image", "Video"):
                    continue
                out.append({
                    "section_type": section_type,
                    "scene_number": scene_number,
                    "cut_number": ci + 1,
                    "layer_index": li,
                    "layer_name": layer.get("name", ""),
                    "media_type": ctype,
                    "query": str(content.get("query") or ""),
                    "source": str(content.get("source") or "pexels").lower(),
                    "local_path": str(content.get("local_path") or ""),
                    "asset_url": str(content.get("asset_url") or ""),
                })
    return out


_LICENSE_NOTE = {
    "pexels": "Pexels license (free use, app key BYOK)",
    "pixabay": "Pixabay license (free use, app key BYOK)",
    "wikipedia": "Wikimedia Commons (check per-file license on attribution page)",
    "youtube": "YouTube (verify reuse rights for the clip before publishing)",
    "archive": "archive.org (public domain / item license — verify per item)",
}


def verify_stock_payload(project_id: str) -> dict:
    """File-truth stock check for every Image/Video layer (pre-VLM).

    Reports existence + size + dimensions/duration per layer plus a
    source/attribution rollup. Explicitly NOT a VLM relevance check — there
    is no vision model in this pipeline, so `vision_verified` is always
    False and relevance review stays with review_frame + the human gate.
    """
    from backend.mcp import probe as _probe
    _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {"ok": False, "error_code": "SCRIPT_NOT_FOUND",
                "error": "script.json not found. Use save_script first.",
                "fix": {"tool": "save_script",
                        "hint": "Save a complete script with save_script first (call get_stage_skills('script') to satisfy its skill gate)."}}
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            document = json.load(f)
    except Exception as e:
        return {
            "ok": False,
            "error_code": "SCRIPT_READ_ERROR",
            "error": f"Could not read script.json ({e}).",
            "fix": {"hint": "The file exists but is not valid JSON. Check "
                            "state via list_project_files/project_status; "
                            "if the file is corrupted, re-save with "
                            "save_script (or clear_visuals) before continuing."},
        }
    layers = _walk_media_layers(document)
    items = []
    missing = 0
    for entry in layers:
        info = _probe._file_info(entry["local_path"], proj_dir)
        item = dict(entry)
        item.update({
            "exists": bool(info.get("exists")),
            "size": info.get("size", -1),
            "attribution": f"{entry['source']}: {entry['query']}".strip(": "),
            "license_note": _LICENSE_NOTE.get(entry["source"],
                                              "verify provider license before publishing"),
        })
        if "dimensions" in info:
            item["dimensions"] = info["dimensions"]
        if "duration" in info:
            item["duration"] = info["duration"]
        if not item["exists"]:
            missing += 1
        items.append(item)
    return {
        "ok": True,
        "project_id": project_id,
        "vision_verified": False,
        "vision_note": ("No VLM in this pipeline — relevance is reviewed via "
                        "review_frame(mode=composition) + human gate, not here."),
        "total_layers": len(items),
        "missing": missing,
        "layers": items,
        "next_step": ("missing > 0 → run_stage(fetch_assets), then re-verify. "
                      "All present → review_frame per section."),
    }


def qa_gate_payload(project_id: str) -> dict:
    """Fail-closed publish gate. ok=True ONLY when every critical check passes.

    Loudness is measured LUFS from render_loudness.json (written by render
    via ebur128) when a render exists; pre-first-render it falls back to a
    mix-defaults warning. Resolution is the pipeline canvas (1920x1080
    landscape / 1080x1920 portrait), not probed pixels. Do NOT render when
    ok=False (re-renders refresh the sidecar; script patches purge it).
    """
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {"ok": False, "error_code": "SCRIPT_NOT_FOUND",
                "error": "script.json not found. Use save_script first.",
                "fix": {"tool": "save_script",
                        "hint": "Save a complete script with save_script first (call get_stage_skills('script') to satisfy its skill gate)."}}
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            document = json.load(f)
    except Exception as e:
        return {
            "ok": False,
            "error_code": "SCRIPT_READ_ERROR",
            "error": f"Could not read script.json ({e}).",
            "fix": {"hint": "The file exists but is not valid JSON. Check "
                            "state via list_project_files/project_status; "
                            "if the file is corrupted, re-save with "
                            "save_script (or clear_visuals) before continuing."},
        }
    checks = []

    def _check(name, severity, passed, detail):
        checks.append({"name": name, "severity": severity,
                       "passed": bool(passed), "detail": detail})

    # 1. pacing: scene count within the 0.7x/1.3x guardrail band.
    try:
        from backend.mcp.pacing import get_pacing
        pacing = get_pacing(proj.get("duration_mode", "medium"),
                            proj.get("video_format", "landscape"),
                            proj.get("language", "en"))
        n = len(document.get("scenes", []) or [])
        import math
        floor = math.ceil(pacing["min_scenes"] * 0.7)
        ceiling = math.ceil(pacing["max_scenes"] * 1.3)
        _check("script_pacing", "critical", floor <= n <= ceiling,
               f"{n} scenes vs guardrail {floor}-{ceiling} "
               f"(target {pacing['min_scenes']}-{pacing['max_scenes']})")
    except Exception as e:
        _check("script_pacing", "critical", False,
               f"INTERNAL: pacing lookup failed ({e}) — this check could not "
               f"run, not that pacing is wrong. Re-run qa_gate once; if it "
               f"repeats, verify the project's duration_mode/video_format "
               f"via project_status.")
    # 2. design saved.
    design_path = proj_dir / "design.json"
    _check("design_saved", "critical", design_path.is_file(),
           "design.json present" if design_path.is_file()
           else "design.json missing — save_design first")
    # 3. voiceover: manifest + every segment has duration + file.
    voice_manifest = proj_dir / "voiceover" / "manifest.json"
    try:
        entries = (json.loads(voice_manifest.read_text(encoding="utf-8"))
                   if voice_manifest.is_file() else None)
    except Exception:
        entries = None
    if not isinstance(entries, list) or not entries:
        _check("voiceover_ready", "critical", False,
               "voiceover/manifest.json missing/empty — run generate_voiceover")
        audio_total = 0.0
    else:
        bad = [e.get("title", f"#{e.get('index')}") for e in entries
               if not isinstance(e, dict) or not (e.get("duration") or 0) > 0
               or not Path(str(e.get("audio_path") or "")).exists()]
        audio_total = sum(float((e.get("duration") or 0)) for e in entries
                          if isinstance(e, dict))
        _check("voiceover_ready", "critical", not bad,
               (f"{len(entries)} segments, {audio_total:.1f}s audio" if not bad
                else f"bad segments: {bad[:5]}"))
    # 4. transcription synced: segments exist and cover the timeline.
    trans_path = proj_dir / "subtitles" / "transcription.json"
    try:
        tdoc = (json.loads(trans_path.read_text(encoding="utf-8"))
                if trans_path.is_file() else None)
        tsegs = (tdoc.get("segments", []) if isinstance(tdoc, dict) else []) or []
    except Exception:
        tsegs = []
    if not tsegs:
        _check("captions_synced", "critical", False,
               "transcription.json missing/empty — run transcribe")
    else:
        try:
            last_end = max(float(s.get("end", 0) or 0) for s in tsegs
                           if isinstance(s, dict))
        except ValueError:
            last_end = 0.0
        coverage = (last_end / audio_total) if audio_total > 0 else 0.0
        _check("captions_synced", "critical", coverage >= 0.9,
               f"{len(tsegs)} segments, last end {last_end:.1f}s "
               f"vs {audio_total:.1f}s audio ({coverage:.0%} coverage)")
    # 5. visuals: every section authored ≥1 cut.
    empty_sections = []
    sections = ([("introduction", None)] +
                [("scene", i + 1) for i in
                 range(len(document.get("scenes", []) or []))] +
                [("conclusion", None)])
    for st, sn in sections:
        if st == "scene":
            sec = (document.get("scenes", []) or [])[sn - 1]
        else:
            sec = document.get(st) or {}
        if not (isinstance(sec, dict) and (sec.get("sub_visuals") or [])):
            empty_sections.append(f"{st}{(' #' + str(sn)) if sn else ''}")
    _check("visuals_complete", "critical", not empty_sections,
           ("all sections have cuts" if not empty_sections
            else f"sections without cuts: {empty_sections}"))
    # 6. assets fetched: every media layer resolves to an existing file.
    layers = _walk_media_layers(document)

    def _layer_missing(layer: dict) -> bool:
        raw = (layer.get("local_path") or "").strip()
        if not raw:
            return True
        p = Path(raw)
        return not (p.is_file() if p.is_absolute()
                    else (proj_dir / raw).is_file())

    missing_assets = [f"S{l.get('scene_number') or '-'}C{l['cut_number']}L{l['layer_index']}:{l['query'][:40]}"
                      for l in layers if _layer_missing(l)]
    _check("assets_fetched", "critical", not missing_assets,
           (f"{len(layers)} media layers, all downloaded" if not missing_assets
            else f"{len(missing_assets)} missing: {missing_assets[:5]}"))
    # 7. hook ≤15 words (warning, not blocking).
    hook = _safe_str((document.get("introduction", {}) or {}).get("hook"))
    hw = len(hook.split())
    _check("hook_in_3s", "warning", hw <= 15,
           f"intro hook {hw} words ({'ok' if hw <= 15 else 'trim to <=15'})")
    # 8. loudness: measured LUFS from the last render sidecar (critical when
    # present). Pre-first-render there is nothing measured — warning only,
    # since mix defaults are the only signal available.
    loud_path = proj_dir / "render_loudness.json"
    try:
        loud_doc = (json.loads(loud_path.read_text(encoding="utf-8"))
                    if loud_path.is_file() else None)
    except Exception:
        loud_doc = None
    if not isinstance(loud_doc, dict) or loud_doc.get("integrated_lufs") is None:
        _check("loudness_lufs", "warning", True,
               ("Not measured yet (no render_loudness.json — render first). "
                "Mix defaults voice 1.0 / music ~0.15 until then."))
    else:
        try:
            from backend.pipeline.render import LOUDNESS_TARGET_I, LOUDNESS_TOLERANCE
        except Exception:
            LOUDNESS_TARGET_I, LOUDNESS_TOLERANCE = -14.0, 2.0
        try:
            measured_lufs = float(loud_doc["integrated_lufs"])
        except (TypeError, ValueError):
            measured_lufs = None
        if measured_lufs is None:
            _check("loudness_lufs", "warning", True,
                   "Sidecar unreadable — re-render to re-measure.")
        else:
            drift = abs(measured_lufs - LOUDNESS_TARGET_I)
            _check("loudness_lufs", "critical", drift <= LOUDNESS_TOLERANCE,
                   (f"{measured_lufs:.1f} LUFS vs target {LOUDNESS_TARGET_I} "
                    f"(drift {drift:.1f}, tolerance {LOUDNESS_TOLERANCE}). "
                    f"normalized={loud_doc.get('normalized', False)}"))
    critical_ok = all(c["passed"] for c in checks if c["severity"] == "critical")
    failing_critical = [c for c in checks if c["severity"] == "critical" and not c["passed"]]
    failing_warnings = [c for c in checks if c["severity"] == "warning" and not c["passed"]]

    actionable_fixes = []
    for fc in failing_critical:
        name = fc["name"]
        detail = fc["detail"]
        if name == "pacing":
            actionable_fixes.append({
                "check": name,
                "tool": "patch_script",
                "hint": f"Pacing check failed ({detail}). Adjust scenes via patch_script or re-author with save_script.",
            })
        elif name == "design_bound":
            actionable_fixes.append({
                "check": name,
                "tool": "save_design",
                "arguments": {"project_id": project_id},
                "hint": f"Design check failed ({detail}). Run save_design to author and bind a design system.",
            })
        elif name == "voiceover_ready":
            actionable_fixes.append({
                "check": name,
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "generate_voiceover", "wait": True},
                "hint": f"Voiceover check failed ({detail}). Run generate_voiceover stage.",
            })
        elif name == "captions_synced":
            actionable_fixes.append({
                "check": name,
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "transcribe", "wait": True},
                "hint": f"Captions check failed ({detail}). Run transcribe stage to sync word timestamps.",
            })
        elif name == "visuals_complete":
            actionable_fixes.append({
                "check": name,
                "tool": "save_visuals",
                "arguments": {"project_id": project_id},
                "hint": f"Visuals check failed ({detail}). Author cuts for the empty sections using save_visuals.",
            })
        elif name == "assets_fetched":
            actionable_fixes.append({
                "check": name,
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "fetch_assets", "wait": True},
                "hint": f"Assets check failed ({detail}). Run fetch_assets stage to download media files.",
            })
        elif name == "loudness_lufs":
            actionable_fixes.append({
                "check": name,
                "tool": "run_stage",
                "arguments": {"project_id": project_id, "stage": "render", "confirm_render": True},
                "hint": f"Loudness check failed ({detail}). Re-render to normalize loudness.",
            })
        else:
            actionable_fixes.append({
                "check": name,
                "hint": f"Check failed: {detail}",
            })

    gate_result = {
        "ok": bool(critical_ok),
        "project_id": project_id,
        "passed": bool(critical_ok),
        "block_render": not critical_ok,
        "checks": checks,
        "next_step": ("render is clear — confirm with the user, then "
                      "run_stage(render, confirm_render=true)"
                      if critical_ok else
                      "Fix failing critical checks above, then re-run qa_gate."),
    }
    if not critical_ok:
        gate_result["error_code"] = "QA_GATE_FAILED"
        gate_result["error"] = f"QA Gate failed: {len(failing_critical)} critical check(s) did not pass ({', '.join(c['name'] for c in failing_critical)}). See actionable_fixes."
        gate_result["failing_critical_checks"] = [c["name"] for c in failing_critical]
        gate_result["actionable_fixes"] = actionable_fixes
    if failing_warnings:
        gate_result["warnings"] = [c["detail"] for c in failing_warnings]
    return gate_result


def build_receipt_payload(project_id: str) -> dict:
    """Video Receipt: input/output hashes + resume cursor + per-cut assets.

    receipt_id is deterministic (sha256 of the content hashes) so identical
    content yields an identical id — dedup-by-content without a key store.
    Pair with run_stage(idempotency_key=...) to also guard repeat submits.
    """
    import hashlib
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    files = {
        "script.json": proj_dir / "script.json",
        "design.json": proj_dir / "design.json",
        "voiceover/manifest.json": proj_dir / "voiceover" / "manifest.json",
        "assets/assets_manifest.json": proj_dir / "assets" / "assets_manifest.json",
        "subtitles/transcription.json": proj_dir / "subtitles" / "transcription.json",
    }
    hashes = {k: _sha256_file(p) for k, p in files.items()}
    digest = hashlib.sha256(
        "|".join(hashes[k] for k in sorted(hashes)).encode()).hexdigest()
    receipt_id = digest[:16]
    layers = []
    scene_count = 0
    script_path = proj_dir / "script.json"
    if script_path.is_file():
        try:
            document = json.loads(script_path.read_text(encoding="utf-8"))
            scene_count = len(document.get("scenes", []) or [])
            for l in _walk_media_layers(document):
                p = l.get("local_path") or ""
                ap = Path(p)
                exists = (ap.is_file() if ap.is_absolute()
                          else (proj_dir / p).is_file()) if p else False
                layers.append({
                    "scene_number": l["scene_number"],
                    "cut_number": l["cut_number"],
                    "layer_index": l["layer_index"],
                    "media_type": l["media_type"],
                    "query": l["query"], "source": l["source"],
                    "asset_file": Path(p).name if p else "",
                    "exists": exists,
                    "attribution": f"{l['source']}: {l['query']}".strip(": "),
                })
        except Exception:
            pass
    try:
        tasks = _db.get_project_tasks(project_id)
        cursor = {t.get("step"): {"status": t.get("status"),
                                  "progress": t.get("progress")} for t in tasks}
    except Exception:
        cursor = {}
    try:
        video_path = proj.get("video_path") or ""
        output_hash = _sha256_file(Path(video_path)) if video_path else ""
    except Exception:
        output_hash = ""
    try:
        loud_doc = json.loads((proj_dir / "render_loudness.json").read_text(
            encoding="utf-8"))
        loudness_lufs = (loud_doc.get("integrated_lufs")
                         if isinstance(loud_doc, dict) else None)
    except Exception:
        loudness_lufs = None
    return {
        "ok": True,
        "project_id": project_id,
        "receipt_id": receipt_id,
        "inputs": hashes,
        "output": {"video_path": proj.get("video_path") or "",
                   "sha256": output_hash,
                   "integrated_lufs": loudness_lufs},
        "resume_cursor": cursor,
        "scenes": scene_count,
        "assets": layers,
        "assets_ready": all(a["exists"] for a in layers),
        "format": proj.get("video_format"),
        "duration_mode": proj.get("duration_mode"),
        "language": proj.get("language"),
    }


# ── Idempotency store (repeat-submit guard for run_stage) ────────────

def _script_content_hash(proj_dir) -> str:
    return _sha256_file(proj_dir / "script.json")


def check_idempotency(project_id: str, stage: str, key: str,
                      content_hash: str) -> dict | None:
    """Return the stored record when this key+stage+content already ran."""
    if not (key or "").strip():
        return None
    try:
        rec = _db.get_setting(
            f"idempotency:{project_id}:{stage}:{(key or '').strip()[:128]}")
    except Exception:
        return None
    if isinstance(rec, dict) and rec.get("content_hash") == content_hash:
        return rec
    return None


def record_idempotency(project_id: str, stage: str, key: str,
                       content_hash: str, status: str) -> None:
    """Persist a key→result record (settings table survives restarts)."""
    if not (key or "").strip():
        return
    import datetime as _dt
    try:
        _db.update_settings({
            f"idempotency:{project_id}:{stage}:{(key or '').strip()[:128]}": {
                "content_hash": content_hash,
                "status": status,
                "recorded_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            }
        })
    except Exception as e:
        logger.warning(f"idempotency record failed: {e}")


# ── Background-completion promotion (wait=false chat/agent submits) ──
# wait=false returns before the worker finishes, so the tool call site can
# never record completion. Instead the submit stages a *pending* entry and
# the queue worker promotes it on step completion (or drops it on
# failure/cancel). Keyless submits clear the slot so a later keyed
# completion can never promote a stale key.

def _pending_idem_name(project_id: str, stage: str) -> str:
    return f"idempotency_pending:{project_id}:{stage}"


def stage_pending_idempotency(project_id: str, stage: str, key: str,
                              content_hash: str) -> None:
    """Stage a pending key at submit time (wait=false)."""
    if not (key or "").strip():
        return
    import datetime as _dt
    try:
        _db.update_settings({
            _pending_idem_name(project_id, stage): {
                "key": (key or "").strip()[:128],
                "content_hash": content_hash,
                "staged_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            }
        })
    except Exception as e:
        logger.warning(f"idempotency stage failed: {e}")


def clear_pending_idempotency(project_id: str, stage: str) -> None:
    """Drop a stale pending slot (keyless submit, cancel paths)."""
    try:
        _db.update_settings({_pending_idem_name(project_id, stage): None})
    except Exception as e:
        logger.warning(f"idempotency clear failed: {e}")


def consume_pending_idempotency(project_id: str, stage: str,
                                success: bool) -> None:
    """Promote (success) or drop (failure/cancel) the pending key.

    Best-effort queue-worker hook: never raises, never blocks the pipeline.
    On success the script hash is re-verified so a mid-run edit (possible
    via the desktop app path, which shares this worker) invalidates rather
    than mis-records.
    """
    name = _pending_idem_name(project_id, stage)
    try:
        pending = _db.get_setting(name)
    except Exception as e:
        logger.warning(f"idempotency consume read failed: {e}")
        return
    if not isinstance(pending, dict) or not (pending.get("key") or "").strip():
        return
    try:
        if success:
            try:
                current = _script_content_hash(_project_dir(project_id))
            except Exception:
                current = ""
            if current and current == pending.get("content_hash"):
                record_idempotency(project_id, stage, pending["key"],
                                   pending["content_hash"], "completed")
            else:
                logger.info("idempotency pending dropped (content changed mid-run).")
        _db.update_settings({name: None})
    except Exception as e:
        logger.warning(f"idempotency consume failed: {e}")


# ── Cost preview (estimate before billable/long stages) ──────────────

def _count_visual_media(document: dict) -> dict:
    """Count authored cuts + Image/Video queries across all sections."""
    cuts = 0
    queries: set = set()
    media_layers = 0
    sections = []
    if isinstance(document.get("introduction"), dict):
        sections.append(document["introduction"])
    for scene in document.get("scenes", []) or []:
        if isinstance(scene, dict):
            sections.append(scene)
    if isinstance(document.get("conclusion"), dict):
        sections.append(document["conclusion"])
    for sec in sections:
        for cut in sec.get("sub_visuals", []) or []:
            if not isinstance(cut, dict):
                continue
            cuts += 1
            comp = cut.get("composition") or {}
            for layer in comp.get("children", []) or []:
                if not isinstance(layer, dict):
                    continue
                content = layer.get("content") or {}
                ctype = str(content.get("type") or "")
                if ctype in ("Image", "Video"):
                    media_layers += 1
                    q = str(content.get("query") or "").strip().lower()
                    if q:
                        queries.add(q)
    return {"cuts": cuts, "media_layers": media_layers,
            "unique_queries": len(queries)}


def estimate_cost_payload(project_id: str) -> dict:
    """Dry-run cost/time preview for the remaining pipeline (no spend).

    Local pipeline has no metered billing — TTS/stock/search keys are BYOK
    in app Settings, so there is no USD charge to cap. This returns wall-time
    estimates per stage plus what would dominate, so the agent can decide
    whether to run fetch_assets/render now or keep authoring. Honest
    heuristic, not a quote: label it as such.
    """
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {"ok": False, "error_code": "SCRIPT_NOT_FOUND",
                "error": "script.json not found. Use save_script first.",
                "fix": {"tool": "save_script",
                        "hint": "Save a complete script with save_script first (call get_stage_skills('script') to satisfy its skill gate)."}}
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            document = json.load(f)
    except Exception as e:
        return {
            "ok": False,
            "error_code": "SCRIPT_READ_ERROR",
            "error": f"Could not read script.json ({e}).",
            "fix": {"hint": "The file exists but is not valid JSON. Check "
                            "state via list_project_files/project_status; "
                            "if the file is corrupted, re-save with "
                            "save_script (or clear_visuals) before continuing."},
        }
    language = proj.get("language", "en") or "en"
    rate = 2.5 if language == "hi" else 3.0  # words/sec, mirrors scriptwriter pacing
    words = 0
    try:
        words += len(_safe_str(document.get("introduction", {}).get("hook")).split())
        for s in document.get("scenes", []) or []:
            if isinstance(s, dict):
                words += len(_safe_str(s.get("narration")).split())
        concl = document.get("conclusion", {}) or {}
        words += len(_safe_str(concl.get("summary")).split())
        words += len(_safe_str(concl.get("cta")).split())
    except Exception:
        pass
    audio_seconds = round(words / rate, 1) if rate else 0.0
    media = _count_visual_media(document)
    queries = media["unique_queries"]
    # Heuristics (documented as rough): edge TTS ~2x realtime Tup, whisper
    # ~0.25x audio, stock fetch ~5s/query, render ~2x final duration.
    voiceover_s = round(audio_seconds * 0.5, 1)
    transcribe_s = round(audio_seconds * 0.25, 1)
    fetch_s = round(queries * 5.0, 1)
    render_s = round(audio_seconds * 2.0, 1)
    total_s = round(voiceover_s + transcribe_s + fetch_s + render_s, 1)
    stages = [
        {"stage": "generate_voiceover", "est_seconds": voiceover_s,
         "basis": f"{words} words @ ~{rate}/s (~{audio_seconds}s audio)"},
        {"stage": "transcribe", "est_seconds": transcribe_s,
         "basis": f"~0.25x of {audio_seconds}s audio"},
        {"stage": "fetch_assets", "est_seconds": fetch_s,
         "basis": f"{queries} unique queries x ~5s"},
        {"stage": "render", "est_seconds": render_s,
         "basis": f"~2x of {audio_seconds}s timeline"},
    ]
    bottleneck = max(stages, key=lambda s: s["est_seconds"])["stage"] if stages else ""
    return {
        "ok": True,
        "project_id": project_id,
        "billable_usd": 0.0,
        "metered": False,
        "currency_note": ("Local pipeline: no metered billing. External APIs "
                          "(Edge/TTS, stock, web-search) use your own keys in "
                          "app Settings; max_spend_usd is not enforced."),
        "inputs": {"words": words, "audio_seconds": audio_seconds,
                   "cuts": media["cuts"], "media_layers": media["media_layers"],
                   "unique_queries": queries, "language": language},
        "stages": stages,
        "est_total_seconds": total_s,
        "bottleneck": bottleneck,
        "assumptions": ["edge TTS ~0.5x audio (dhvaani cloning is slower, CPU-bound)",
                        "whisper ~0.25x audio", "stock ~5s/query",
                        "render ~2x timeline"],
        "next_step": "run_stage(wait=false) + sleep + stage_status per stage.",
    }

