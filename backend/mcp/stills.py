"""Headless Remotion stills for pre-render truth checks.

Renders exact composition pixels (text, charts, animation state) for a
handful of timestamps via the existing ``render.mjs`` frames mode — no
full-video render. Seconds per call (Chromium boot + N frames), so this
is the deliberate middle ground between the instant asset lineup and
the finished mp4:

  asset lineup (ms) → composition stills (s) → rendered video (min)

Stills are cached under ``assets/previews/stills/`` keyed by narration
+ design + visuals + frame + scale, so repeat asks are free. The visuals
hash covers every section's sub_visuals (local_path/asset_url stripped),
so any save_visuals edit busts the cache — a patched cut can never return
the pre-patch pixels at the same timestamp. Read-only apart from its own
cache dir and a ``render_props.still.json`` sidecar.
"""

import hashlib
import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from backend.core import config as _config
from backend.database import db as _db
from backend.core.logger import logger

STILL_SCALE = "0.3333"  # ~640x360 out of a 1080p composition
STILL_TIMEOUT_MS = 180_000
STILL_CONCURRENCY = "1"
_STILL_LOCKS: dict = {}
_STILL_LOCKS_GUARD = threading.Lock()


def _project_lock(project_id: str) -> threading.Lock:
    """Per-project Chromium gate: stills for different projects run in
    parallel; two runs for one project serialize on its cache dir."""
    with _STILL_LOCKS_GUARD:
        lock = _STILL_LOCKS.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _STILL_LOCKS[project_id] = lock
        return lock


def _stills_dir(project_dir: Path) -> Path:
    d = project_dir / "assets" / "previews" / "stills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _canon(value: Any) -> str:
    """Canonical JSON for hashing (missing sub_visuals == [] by design)."""
    from backend.pipeline.assets import strip_local_paths
    canon = strip_local_paths(value if isinstance(value, list) else [])
    return json.dumps(canon, sort_keys=True, ensure_ascii=False, default=str)


def compute_visuals_hash(script: dict) -> str:
    """Hash of every section's sub_visuals + global overlays (paths stripped).

    local_path/asset_url are download provenance, not visual structure —
    reuse assets.strip_local_paths so a fetch_assets run alone never busts
    stills, while any save_visuals edit (queries, boxes, animations, text,
    overlays) produces a new key. Returns "novisuals" only when there is
    genuinely nothing visual; "hash_error" when hashing itself fails (never
    collide the two).
    """
    try:
        parts = []
        intro = (script or {}).get("introduction") or {}
        parts.append(_canon(intro.get("sub_visuals")))
        for sc in ((script or {}).get("scenes") or []):
            parts.append(_canon(sc.get("sub_visuals") if isinstance(sc, dict)
                                else []))
        concl = (script or {}).get("conclusion") or {}
        parts.append(_canon(concl.get("sub_visuals")))
        overlays = (script or {}).get("overlays") or []
        parts.append(_canon(overlays))
        if all(p == _canon([]) for p in parts):
            return "novisuals"
        return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()[:16]
    except Exception as e:
        logger.warning(f"compute_visuals_hash failed: {e}")
        return "hash_error"


def still_cache_key(script_hash: str, design_hash: str, frame: int,
                    scale: str = STILL_SCALE, fps: int = 30,
                    *, visuals_hash: str) -> str:
    """Deterministic cache name: narration/design/visuals change busts it.

    visuals_hash is REQUIRED keyword — a default would silently fork a
    pre-visuals key family that can never hit new files (or worse, hit
    stale ones). All callers compute it via compute_visuals_hash.
    """
    raw = f"{script_hash}|{design_hash}|{visuals_hash}|{frame}|{scale}|{fps}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16] + ".jpg"


def _fps_for_project(proj, proj_dir: Path) -> int:
    """Render fps with a lightweight fallback (describe must work even when
    the full render-props pipeline cannot run yet)."""
    try:
        from backend.pipeline.render import prepare_render_props_and_settings
        _, render_settings, *_ = prepare_render_props_and_settings(
            proj, proj_dir)
        return int(render_settings.get("fps") or 30)
    except Exception:
        try:
            raw = (proj or {}).get("project_settings")
            settings = json.loads(raw) if isinstance(raw, str) and raw.strip() \
                else (raw if isinstance(raw, dict) else {})
            return int(settings.get("render_fps", 30) or 30)
        except (TypeError, ValueError):
            return 30


def describe_stills_cache(project_id: str, timestamps: list) -> dict:
    """Cache truth for a timestamp set WITHOUT rendering.

    Side-effect free apart from reading (never creates the stills dir).
    Returns {visuals_hash, design_hash, script_hash, fps, frames, keys,
    hits, misses} so review_frame can tell the agent fresh vs cached pixels.
    """
    from backend.pipeline.assets import compute_script_content_hash
    from backend.mcp.payloads import current_design_hash
    proj, proj_dir, *_ = _render_context(project_id)
    with open(proj_dir / "script.json", "r", encoding="utf-8") as f:
        script = json.load(f)
    script_hash = compute_script_content_hash(script)
    visuals_hash = compute_visuals_hash(script)
    design_hash = current_design_hash(proj_dir) or "nodesign"
    fps = _fps_for_project(proj, proj_dir)
    stills_dir = proj_dir / "assets" / "previews" / "stills"
    keys, hits, misses, frames = [], [], [], []
    for t in timestamps or []:
        frame = max(0, int(float(t) * fps))
        frames.append(frame)
        key = still_cache_key(script_hash, design_hash, frame,
                              STILL_SCALE, fps, visuals_hash=visuals_hash)
        keys.append(key)
        if (stills_dir / key).is_file():
            hits.append(frame)
        else:
            misses.append(frame)
    return {"visuals_hash": visuals_hash, "design_hash": design_hash,
            "script_hash": script_hash, "fps": fps,
            "frames": frames, "keys": keys,
            "hits": hits, "misses": misses}


def _render_context(project_id: str):
    """Shared node/bundle/ffmpeg resolution (mirrors render.render_pipeline)."""
    proj = _db.get_project(project_id)
    if not proj:
        raise ValueError(f"Project {project_id!r} not found in database.")
    from backend.mcp import payloads
    proj_dir = payloads._project_dir(project_id)

    frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
    render_script = frontend_dir / "dist-render" / "render.mjs"
    if not render_script.exists():
        render_script = frontend_dir / "src" / "render.mjs"
    if not render_script.exists():
        raise RuntimeError(f"Render script not found: {render_script}")
    bundle_dir = frontend_dir / "dist-remotion"
    if not bundle_dir.exists():
        raise RuntimeError(
            "Remotion bundle missing (frontend/dist-remotion). "
            "Run a full render once from the app to build it.")
    node_exe = _config.get_node_path()
    bin_dir = frontend_dir.parent / "bin"
    return proj, proj_dir, frontend_dir, render_script, bundle_dir, node_exe, bin_dir


def grab_composition_stills(project_id: str, timestamps: list) -> list:
    """Render exact composition frames for absolute timestamps (seconds).

    Returns PIL images in request order. Raises RuntimeError with the
    node tail output when headless rendering fails.
    """
    from PIL import Image as _Image
    from backend.pipeline.assets import compute_script_content_hash
    from backend.mcp.payloads import current_design_hash
    from backend.pipeline.render import prepare_render_props_and_settings

    if not timestamps:
        raise ValueError("No timestamps requested.")
    proj, proj_dir, frontend_dir, render_script, bundle_dir, node_exe, bin_dir = \
        _render_context(project_id)

    with _project_lock(project_id):
        script_path = proj_dir / "script.json"
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
        script_hash = compute_script_content_hash(script)
        visuals_hash = compute_visuals_hash(script)
        design_hash = current_design_hash(proj_dir) or "nodesign"

        props, render_settings, *_ = prepare_render_props_and_settings(proj, proj_dir)
        fps = int(render_settings.get("fps") or 30)
        frames = [max(0, int(t * fps)) for t in timestamps]

        stills_dir = _stills_dir(proj_dir)
        cache_keys = {  # hoisted: one hash set for the whole batch (no
            frame: still_cache_key(script_hash, design_hash, frame,  # TOCTOU
                                   STILL_SCALE, fps, visuals_hash=visuals_hash)
            for frame in frames}
        needed = {}  # frame -> cache path (missing only)
        ordered_paths = []
        for frame in frames:
            cache_path = stills_dir / cache_keys[frame]
            ordered_paths.append(cache_path)
            if not cache_path.is_file():
                needed[frame] = cache_path
        if needed:
            _render_missing_frames(proj, proj_dir, frontend_dir, render_script,
                                   bundle_dir, node_exe, bin_dir, props, fps,
                                   sorted(needed), stills_dir, cache_keys)
        images = []
        for cache_path in ordered_paths:
            with _Image.open(cache_path) as img:
                images.append(img.convert("RGB").copy())
        return images


def _render_missing_frames(proj, proj_dir, frontend_dir, render_script, bundle_dir,
                           node_exe, bin_dir, props, fps, frames, stills_dir,
                           cache_keys=None):
    """One node invocation in frames mode for the missing frame set.

    cache_keys maps frame -> precomputed stills cache name (hoisted by the
    caller so a concurrent save_visuals between render and promotion cannot
    split the key family — promotion always lands where ordered_paths look).
    """
    from backend.core.config import is_production, get_remotion_cache_dir
    still_props_path = proj_dir / "render_props.still.json"
    with open(still_props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, ensure_ascii=False)

    tmp_frames_dir = stills_dir / "_tmp"
    tmp_frames_dir.mkdir(parents=True, exist_ok=True)
    # Clear stale outputs: render.mjs names files by ABSOLUTE frame number,
    # so leftovers from an earlier call could otherwise masquerade as fresh.
    for stale in tmp_frames_dir.iterdir():
        try:
            if stale.is_file():
                stale.unlink()
        except OSError:
            pass
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"
    # NOTE: render.mjs only understands "a-b" ranges — a dashless "150" is
    # ignored and silently falls back to rendering the WHOLE video.
    frame_ranges = ",".join(f"{f}-{f}" for f in frames)
    cmd = [
        node_exe, str(render_script),
        "--props", str(still_props_path.resolve()).replace("\\", "/"),
        "--mode", "frames",
        "--bundle-dir", str(bundle_dir.resolve()).replace("\\", "/"),
        "--fps", str(fps),
        "--scale", STILL_SCALE,
        "--frames-dir", str(tmp_frames_dir.resolve()).replace("\\", "/"),
        "--frames", frame_ranges,
        "--concurrency", STILL_CONCURRENCY,
        "--timeout", str(STILL_TIMEOUT_MS),
    ]
    if ffmpeg_exe.exists():
        cmd += ["--ffmpeg", str(ffmpeg_exe.resolve()).replace("\\", "/")]
    if ffprobe_exe.exists():
        cmd += ["--ffprobe", str(ffprobe_exe.resolve()).replace("\\", "/")]

    env = os.environ.copy()
    env["NODE_OPTIONS"] = "--max-old-space-size=2048"
    if is_production():
        node_cwd = str(get_remotion_cache_dir())
    else:
        node_cwd = str(frontend_dir)

    logger.info(f"Composition stills: rendering frames {frames} for {proj['id']}.")
    try:
        proc = subprocess.run(
            cmd, cwd=node_cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            startupinfo=_config.get_startupinfo(), env=env,
            timeout=STILL_TIMEOUT_MS / 1000 + 60)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"Composition stills timed out: {e}")
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout or "").splitlines()[-15:])
        raise RuntimeError(f"Composition stills failed (exit {proc.returncode}):\n{tail}")

    # Promote element-<frame>.jpeg outputs (absolute frame numbers) into
    # hash cache names (precomputed by the caller — never re-read here).
    for frame in frames:
        src = tmp_frames_dir / f"element-{frame}.jpeg"
        if not src.is_file():
            leftovers = sorted(p.name for p in tmp_frames_dir.iterdir())
            raise RuntimeError(
                f"Composition stills: node exited 0 but frame {frame} missing "
                f"(frames dir holds: {leftovers[:8]}).")
        key = (cache_keys or {}).get(frame)
        if key is None:
            raise RuntimeError(
                f"Composition stills: no cache key for frame {frame} "
                f"(caller must pass precomputed cache_keys).")
        try:
            src.replace(stills_dir / key)
        except OSError:
            import shutil
            shutil.copyfile(src, stills_dir / key)
    # Best-effort tmp cleanup; cache files live in stills_dir proper.
    for leftover in tmp_frames_dir.iterdir():
        try:
            leftover.unlink()
        except OSError:
            pass
