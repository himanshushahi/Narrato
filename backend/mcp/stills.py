"""Headless Remotion stills for pre-render truth checks.

Renders exact composition pixels (text, charts, animation state) for a
handful of timestamps via the existing ``render.mjs`` frames mode — no
full-video render. Seconds per call (Chromium boot + N frames), so this
is the deliberate middle ground between the instant asset lineup and
the finished mp4:

  asset lineup (ms) → composition stills (s) → rendered video (min)

Stills are cached under ``assets/previews/stills/`` keyed by narration
+ design + frame + scale, so repeat asks are free. Read-only apart
from its own cache dir and a ``render_props.still.json`` sidecar.
"""

import hashlib
import json
import os
import subprocess
import threading
from pathlib import Path

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


def still_cache_key(script_hash: str, design_hash: str, frame: int,
                    scale: str = STILL_SCALE, fps: int = 30) -> str:
    """Deterministic cache name: any narration/design change busts it."""
    raw = f"{script_hash}|{design_hash}|{frame}|{scale}|{fps}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16] + ".jpg"


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
        design_hash = current_design_hash(proj_dir) or "nodesign"

        props, render_settings, *_ = prepare_render_props_and_settings(proj, proj_dir)
        fps = int(render_settings.get("fps") or 30)
        frames = [max(0, int(t * fps)) for t in timestamps]

        stills_dir = _stills_dir(proj_dir)
        needed = {}  # frame -> cache path (missing only)
        ordered_paths = []
        for frame in frames:
            name = still_cache_key(script_hash, design_hash, frame,
                                   STILL_SCALE, fps)
            cache_path = stills_dir / name
            ordered_paths.append(cache_path)
            if not cache_path.is_file():
                needed[frame] = cache_path
        if needed:
            _render_missing_frames(proj, proj_dir, frontend_dir, render_script,
                                   bundle_dir, node_exe, bin_dir, props, fps,
                                   sorted(needed), stills_dir)
        images = []
        for cache_path in ordered_paths:
            with _Image.open(cache_path) as img:
                images.append(img.convert("RGB").copy())
        return images


def _render_missing_frames(proj, proj_dir, frontend_dir, render_script, bundle_dir,
                           node_exe, bin_dir, props, fps, frames, stills_dir):
    """One node invocation in frames mode for the missing frame set."""
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
    # hash cache names.
    for frame in frames:
        src = tmp_frames_dir / f"element-{frame}.jpeg"
        if not src.is_file():
            leftovers = sorted(p.name for p in tmp_frames_dir.iterdir())
            raise RuntimeError(
                f"Composition stills: node exited 0 but frame {frame} missing "
                f"(frames dir holds: {leftovers[:8]}).")
        from backend.pipeline.assets import compute_script_content_hash
        from backend.mcp.payloads import current_design_hash
        with open(proj_dir / "script.json", "r", encoding="utf-8") as f:
            script_hash = compute_script_content_hash(json.load(f))
        design_hash = current_design_hash(proj_dir) or "nodesign"
        key = still_cache_key(script_hash, design_hash, frame,
                              STILL_SCALE, fps)
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
