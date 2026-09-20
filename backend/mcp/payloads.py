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
        raise ValueError(f"Project {project_id!r} not found in database.")
    return proj


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


def save_script_payload(project_id: str, data: dict) -> dict:
    """Validate + persist an agent-authored script and reset the project to
    the post-script stage. Returns a summary dict (raises on DB miss)."""
    errors = validate_script_payload(data)
    if errors:
        return {"ok": False, "error": "Script validation failed: " + "; ".join(errors)}
    proj = _get_project_or_raise(project_id)
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
        status="completed",
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
    return {
        "ok": True,
        "project_id": project_id,
        "title": title,
        "scene_count": len(document["scenes"]),
        "purged": removed,
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


def save_design_payload(project_id: str, data: dict) -> dict:
    """Validate + persist an agent-authored design system.

    A valid design.json on disk is picked up as-is by the internal
    generate_project_design_system (no LLM call), and its hash anchors
    manifest _design_hash entries written by save_visuals.
    """
    errors = validate_design_payload(data)
    if errors:
        return {"ok": False, "error": "Design validation failed: " + "; ".join(errors)}
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)

    from backend.pipeline.genres import normalize_genre_key
    document = dict(data)
    document["_language"] = proj.get("language", "hi")
    document["_video_format"] = proj.get("video_format", "landscape")
    document["_genre"] = normalize_genre_key(proj.get("prompt") or "documentary")
    document.pop("_failed", None)

    design_path = proj_dir / "design.json"
    tmp_path = design_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(document, f, indent=2, ensure_ascii=False)
    tmp_path.replace(design_path)
    design_hash = hashlib.md5(
        json.dumps(document, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    logger.info(f"MCP save_design: project {project_id} theme={document.get('theme_name')!r}.")
    result = {"ok": True, "project_id": project_id,
              "theme_name": document.get("theme_name"),
              "design_hash": design_hash}
    # Richness floor: a design with nothing beyond the required keys (or
    # only typography-adjacent extras like extra fonts) carries no motion
    # language — flat design in, flat video out.
    MOTION_KEYS = ("motion", "transition", "animation", "effect", "fx",
                   "treatment", "kinetic", "overlay", "texture", "particles")
    doc_keys = {k.lower() for k in document if not k.startswith("_")}
    css_text = str(document.get("css_guidelines") or "").lower()
    has_motion = (any(any(m in k for m in MOTION_KEYS) for k in doc_keys)
                  or any(m in css_text for m in MOTION_KEYS))
    if not has_motion:
        result["warning"] = (
            "Design carries no motion language (no transition/animation/FX "
            "direction in keys or css_guidelines). Flat designs produce flat "
            "videos: add signature transitions, text treatments, and "
            "overlay/texture direction (see the art-director + "
            "motion-graphics-designer skills) and re-save before authoring visuals.")
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

# Writable project columns only — never settings-table secrets (API keys).
VOICE_SETTING_KEYS = ("tts_engine", "tts_voice", "tts_speed", "tts_pitch",
                      "bg_music_volume")
VALID_TTS_ENGINES = ("edge", "xtts", "omnivoice")
_EDGE_VOICE_RE = r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$"


def validate_voice_settings(settings: dict) -> tuple[list, dict]:
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
        if engine not in VALID_TTS_ENGINES:
            errors.append(f"tts_engine must be one of {list(VALID_TTS_ENGINES)}.")
        else:
            columns["tts_engine"] = engine
    if "tts_voice" in settings:
        voice = settings["tts_voice"]
        if not isinstance(voice, str) or not voice.strip():
            errors.append("tts_voice must be a non-empty string.")
        else:
            engine = settings.get("tts_engine")
            if (engine or "edge") == "edge" and not re.match(_EDGE_VOICE_RE, voice.strip()):
                errors.append(
                    "tts_voice for engine 'edge' must look like 'hi-IN-SwaraNeural'. "
                    "For voice cloning use tts_engine 'xtts'/'omnivoice' with a profile id.")
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
    errors, columns = validate_voice_settings(settings)
    if errors:
        return {"ok": False, "error": " ".join(errors)}
    _get_project_or_raise(project_id)
    _db.update_project(project_id, **columns)
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
        return {"ok": False, "error": " ".join(errors)}
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

# ── Project deletion ────────────────────────────────────────────────

def delete_project_payload(project_id: str) -> dict:
    """Delete the project row + tasks and wipe its storage directory."""
    import shutil
    _get_project_or_raise(project_id)
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
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
    engine = _db.get_setting("tts_engine") or "edge"
    default_voice = _db.get_setting("tts_voice")
    profiles = _db.get_setting("xtts_profiles") or []
    clone_profiles = [
        {"id": p.get("id"), "name": p.get("name")}
        for p in profiles
        if isinstance(p, dict) and p.get("id")
    ]
    return {
        "ok": True,
        "engines": [
            {"id": "edge",
             "label": "Edge TTS (single Neural voice, fast, no training)",
             "voice_format": "Neural name like 'hi-IN-SwaraNeural'"},
            {"id": "xtts",
             "label": "Voice cloning via OmniVoice profile (needs a configured profile)",
             "voice_format": "profile id like 'xtts_prof_...' (see clone_profiles)"},
            {"id": "omnivoice",
             "label": "Alias of xtts (forward name for the same cloning engine)",
             "voice_format": "profile id like 'xtts_prof_...' (see clone_profiles)"},
        ],
        "edge_suggestions": EDGE_VOICE_SUGGESTIONS,
        "clone_profiles": clone_profiles,
        "global_defaults": {"tts_engine": engine, "tts_voice": default_voice},
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
        return {"ok": False, "error": str(e)}
    if not proj_dir.exists():
        return {"ok": False, "error": "Project directory does not exist."}
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
                              max_chars: int = _MAX_READ_CHARS) -> dict:
    """Read a text artifact (script, manifest, transcription, logs).

    Binary media returns size info only — use the app's file server or
    previews to view those. Database files outside the project dir are
    unreachable by construction.
    """
    try:
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    candidate = (proj_dir / (path or "").replace("\\", "/"))
    try:
        resolved = candidate.resolve()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if proj_dir.resolve() != resolved and proj_dir.resolve() not in resolved.parents:
        return {"ok": False, "error": f"Unsafe path: {path!r}."}
    if not resolved.is_file():
        return {"ok": False, "error": f"File not found: {path!r}."}
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
        return {"ok": False, "error": f"Could not read file: {e}"}
    truncated = len(text) > max_chars
    return {"ok": True, "project_id": project_id, "path": path,
            "binary": False, "truncated": truncated,
            "content": text[:max_chars]}

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


def get_section_timings(project_id: str, include_words: bool = True) -> dict:
    """Report per-section narration + audio durations so the agent can
    author sub_visuals whose durations sum to the TRUE section length."""
    _get_project_or_raise(project_id)
    proj = _db.get_project(project_id)
    proj_dir = _project_dir(project_id)
    manifest_path = _active_manifest_path(proj, proj_dir)
    if not manifest_path:
        return {"ok": False,
                "error": "No voiceover manifest found. Run the generate_voiceover stage first."}
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    words = _load_transcription_words(proj_dir) if include_words else []
    sections = []
    cursor = 0.0
    scene_counter = 0
    for entry in manifest:
        if not isinstance(entry, dict):
            continue
        sec_type = entry.get("section_type")
        duration = float(entry.get("duration", 0) or 0)
        section_words = []
        if words:
            section_words = [
                {**w, "at": round(w["start"] - cursor, 2)}
                for w in words
                if cursor <= w["start"] < cursor + duration
            ]
        info = {
            "section_type": sec_type,
            "title": entry.get("title", ""),
            "text": entry.get("text", ""),
            "duration": round(duration, 2),
            "start_time": round(cursor, 2),
            "has_visuals": bool(entry.get("sub_visuals")),
        }
        if sec_type == "scene":
            info["scene_index"] = scene_counter
            scene_counter += 1
        if include_words:
            info["words"] = section_words
        sections.append(info)
        cursor += duration
    return {"ok": True, "project_id": project_id,
            "total_duration": round(cursor, 2), "sections": sections}


def save_visuals_payload(project_id: str, section_type: str,
                         sub_visuals, scene_index: int = 0,
                         cut_index: int | None = None,
                         dry_run: bool = False) -> dict:
    """Validate agent-authored sub_visuals for one section and persist them
    to both the active manifest and script.json (mirrors the manifest-sync
    tail of ai.generate_visuals_pipeline).

    Two modes:
    - whole-section (cut_index=None): sub_visuals is the full cuts array.
    - single-cut patch (cut_index=N): sub_visuals is a 1-element array
      holding just that cut (a bare cut object is also accepted by direct
      Python callers); only that cut is replaced, the rest are preserved.
      Durations are still renormalized across the whole section so the sum
      matches the audio length — the returned durations list shows the
      resulting per-cut split.
    dry_run=True validates and returns the normalized result WITHOUT
    writing anything (works in both modes).
    """
    if section_type not in SECTION_TYPES:
        return {"ok": False,
                "error": f"section_type must be one of {list(SECTION_TYPES)}."}
    if cut_index is not None:
        try:
            cut_index = int(cut_index)
        except (TypeError, ValueError):
            return {"ok": False, "error": "cut_index must be an integer."}
        patch = sub_visuals[0] if isinstance(sub_visuals, list) else sub_visuals
        if not isinstance(patch, dict):
            return {"ok": False, "error": (
                "Single-cut patch: sub_visuals must be one cut object "
                "(or a 1-element array).")}
        if isinstance(sub_visuals, list) and len(sub_visuals) != 1:
            return {"ok": False, "error": (
                "Single-cut patch takes exactly one cut; omit cut_index to "
                "replace the whole section.")}
    elif not isinstance(sub_visuals, list) or not sub_visuals:
        return {"ok": False, "error": "sub_visuals must be a non-empty array."}
    proj = _get_project_or_raise(project_id)
    proj_dir = _project_dir(project_id)
    video_format = proj.get("video_format", "landscape")

    design_hash = current_design_hash(proj_dir)
    if not design_hash:
        return {"ok": False, "error": (
            "No valid design.json found. Save a design system first "
            "(save_design tool) so visuals bind to a design hash.")}

    manifest_path = _active_manifest_path(proj, proj_dir)
    if not manifest_path:
        return {"ok": False,
                "error": "No voiceover manifest found. Run the generate_voiceover stage first."}
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    if not isinstance(manifest, list) or not manifest:
        return {"ok": False, "error": "Active manifest is empty or invalid."}

    if section_type == "scene":
        candidates = [m for m in manifest if isinstance(m, dict) and m.get("section_type") == "scene"]
        if not (0 <= scene_index < len(candidates)):
            return {"ok": False, "error": (
                f"scene_index {scene_index} out of range (0..{len(candidates) - 1}).")}
        entry = candidates[scene_index]
    else:
        entry = next((m for m in manifest
                      if isinstance(m, dict) and m.get("section_type") == section_type), None)
        if entry is None:
            return {"ok": False, "error": f"No manifest entry for {section_type}."}

    target_duration = float(entry.get("duration", 0) or 0)
    if target_duration <= 0:
        return {"ok": False, "error": "Manifest entry has no usable duration."}

    if cut_index is not None:
        current = _current_section_cuts(proj_dir, section_type, scene_index,
                                        fallback=entry.get("sub_visuals"))
        if not current:
            return {"ok": False, "error": (
                "Section has no saved cuts to patch — save the whole section "
                "first (omit cut_index), then patch individual cuts.")}
        if not 0 <= cut_index < len(current):
            return {"ok": False, "error": (
                f"cut_index {cut_index} out of range (0..{len(current) - 1}).")}
        import copy
        candidate = copy.deepcopy(current)
        candidate[cut_index] = patch
    else:
        candidate = sub_visuals

    from backend.agent.validators import validate_sub_visuals
    is_valid, normalized, error_msg = validate_sub_visuals(
        candidate, target_duration, video_format=video_format)
    if not is_valid:
        return {"ok": False, "error": f"Visual validation failed: {error_msg}",
                "dry_run": bool(dry_run), "persisted": False}

    durations = [round(float(v.get("duration", 0)), 2) for v in normalized]
    total = round(sum(durations), 2)
    variety = _visual_variety_report(candidate, normalized, target_duration)
    if dry_run:
        result = {"ok": True, "project_id": project_id, "section_type": section_type,
                  "scene_index": scene_index if section_type == "scene" else None,
                  "dry_run": True, "persisted": False,
                  "cut_count": len(normalized), "total_duration": total,
                  "durations": durations, "variety": variety}
        if cut_index is not None:
            result["patched_cut_index"] = cut_index
            result["patched_cut"] = normalized[cut_index]
        return result

    narration_hash = hashlib.md5(
        (entry.get("text") or "").encode("utf-8")).hexdigest()[:12]
    entry["sub_visuals"] = normalized
    entry["_narr_hash"] = narration_hash
    entry["_design_hash"] = design_hash
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Mirror into script.json (agent payload is authoritative here).
    # The manifest is authoritative for WHICH section was written; guard the
    # script index against manifest/script divergence (filtered manifest
    # scenes vs raw script scenes) so a skew can never cross-write a cut.
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
                    f"script.json has {len(script['scenes'])} — manifest kept, "
                    f"script.json sync skipped to avoid cross-writing cuts.")
            elif 0 <= scene_index < len(script["scenes"]):
                script["scenes"][scene_index]["sub_visuals"] = normalized
        with open(script_path, "w", encoding="utf-8") as f:
            json.dump(script, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"MCP save_visuals: manifest updated but script.json sync failed: {e}")

    logger.info(f"MCP save_visuals: project {project_id} {section_type}[{scene_index}] "
                f"{len(normalized)} cuts, {total}s"
                f"{f' (patched cut {cut_index})' if cut_index is not None else ''}.")
    result = {"ok": True, "project_id": project_id, "section_type": section_type,
              "scene_index": scene_index if section_type == "scene" else None,
              "persisted": True,
              "cut_count": len(normalized), "total_duration": total,
              "durations": durations, "variety": variety}
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
                    "transitions_used": [], "energy_cuts": 0,
                    "max_template_run": {"length": 0, "from_cut": None},
                    "unused_kinds": []}
    try:
        kinds = ("Image", "Video", "Text", "Chart", "Shape", "Map",
                 "HTML", "Lottie", "Particles")

        def _cut_parts(cut: dict):
            comp = cut.get("composition") or {}
            children = comp.get("children") or []
            layer_kinds, fx = [], False
            for layer in children:
                if not isinstance(layer, dict):
                    continue
                content = layer.get("content") or {}
                k = content.get("type")
                if isinstance(k, str):
                    layer_kinds.append(k)
                if layer.get("filters"):
                    fx = True
                for mod in ("motion_blur", "floating"):
                    if layer.get(mod):
                        fx = True
                shake = layer.get("camera_shake")
                if shake and shake != "none":
                    fx = True
            if (cut.get("emphasis")
                    or (cut.get("transition") or "") in ("whip_pan", "glitch")):
                fx = True
            return layer_kinds, fx

        cand_list = candidate if isinstance(candidate, list) else []
        for i, cut in enumerate(cand_list):
            if not isinstance(cut, dict) or i >= len(normalized):
                continue
            norm = normalized[i]
            if not isinstance(norm, dict):
                continue
            raw_t = cut.get("transition")
            norm_t = norm.get("transition")
            if (isinstance(raw_t, str) and raw_t.strip()
                    and isinstance(norm_t, str)
                    and raw_t.strip().lower() != norm_t.strip().lower()):
                report["normalizations"].append(
                    f"cut#{i}: transition {raw_t.strip()!r} is not a valid "
                    f"enum value, remapped to {norm_t.strip()!r} — use a valid "
                    f"value from the visual-director skill next time.")

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
        prev_sig = None
        run_len, run_start = 0, 0
        for i, cut in enumerate(normalized):
            if not isinstance(cut, dict):
                continue
            layer_kinds, fx = _cut_parts(cut)
            for k in layer_kinds:
                kind_counts[k] = kind_counts.get(k, 0) + 1
            t = cut.get("transition")
            if isinstance(t, str):
                transitions[t] = transitions.get(t, 0) + 1
            if fx:
                report["energy_cuts"] += 1
            sig = tuple(layer_kinds)
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
        report["unused_kinds"] = [k for k in kinds if k not in kind_counts]
        longest = report["max_template_run"]
        if longest["length"] >= 3:
            report["normalizations"].append(
                f"Template repetition: cuts {longest['from_cut']}-"
                f"{longest['from_cut'] + longest['length'] - 1} share one "
                f"layer template — vary geometry, text treatment, or FX per "
                f"the pipeline-guide variety contract.")
    except Exception as e:
        logger.warning(f"MCP variety report skipped: {e}")
    return report


def _current_section_cuts(proj_dir: Path, section_type: str, scene_index: int,
                          fallback=None) -> list:
    """Saved cuts for a section: script.json first, manifest entry fallback."""
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
    if isinstance(fallback, list):
        return [c for c in fallback if isinstance(c, dict)]
    return []
