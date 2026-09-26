"""Frame review for the Narrato MCP server: contact-sheet snapshots.

Two modes:
- ``render`` — exact final pixels from the rendered mp4 (ffmpeg seeks).
- ``composition`` — exact pre-render composition pixels via headless
  Remotion stills (seconds per call, cached; see backend.mcp.stills).
- ``asset``  — pre-render lineup: the media layers behind a cut (images
  direct, video poster frames). Text/HTML/Chart-only cuts have nothing
  to snapshot and report that explicitly instead of a blank.

Cells are merged with Pillow into ONE JPEG (temporal strip for render
mode, grid lineup for asset mode) and returned as a single MCP image
block with per-cell metadata as text. Caps: <=6 cells, <=1600px long
side. Read-only: never mutates pipeline state.
"""

import io
import subprocess
from pathlib import Path

from backend.core import config as _config
from backend.database import db as _db
from backend.core.logger import logger
from backend.mcp.payloads import SECTION_TYPES

MAX_CELLS = 6
STRIP_CELL_HEIGHT = 360
GRID_CELL_WIDTH = 480
GRID_CELL_HEIGHT = 270
MAX_LONG_SIDE = 1600
SHEET_BG = (10, 14, 23)
CELL_PAD = 8
JPEG_QUALITY = 72

# Section vocabulary is canonical in payloads (imported above).


def _ffmpeg():
    return _config.get_ffmpeg_path()


def _ffprobe():
    return _config.get_ffprobe_path()


def _startupinfo():
    try:
        return _config.get_startupinfo()
    except Exception:
        return None


def _manifest_entries(project_dict, project_dir: Path) -> list:
    """Active manifest entries in order (same resolution as payloads)."""
    from backend.mcp import payloads
    manifest_path = payloads._active_manifest_path(project_dict, project_dir)
    if not manifest_path:
        raise ValueError("No voiceover manifest found. Run generate_voiceover first.")
    import json
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    if not isinstance(manifest, list) or not manifest:
        raise ValueError("Active manifest is empty or invalid.")
    return [m for m in manifest if isinstance(m, dict)]


def _script_section(project_dir: Path, section_type: str, scene_index: int) -> dict:
    """Script.json section dict for the selector (authoritative visuals)."""
    import json
    script_path = project_dir / "script.json"
    if not script_path.exists():
        raise ValueError("script.json not found. Use save_script first.")
    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)
    if section_type in ("introduction", "conclusion"):
        section = script.get(section_type)
        if not isinstance(section, dict):
            raise ValueError(f"script.json has no {section_type} section.")
        return section
    scenes = script.get("scenes") or []
    if not 0 <= scene_index < len(scenes):
        raise ValueError(f"scene_index {scene_index} out of range (0..{len(scenes) - 1}).")
    return scenes[scene_index]


def _section_start(entries: list, entry) -> float:
    cursor = 0.0
    for other in entries:
        if other is entry:
            return round(cursor, 2)
        try:
            cursor += float(other.get("duration", 0) or 0)
        except (TypeError, ValueError):
            pass
    return round(cursor, 2)


def _find_entry(entries: list, section_type: str, scene_index: int) -> dict:
    if section_type == "scene":
        candidates = [m for m in entries if m.get("section_type") == "scene"]
        if not 0 <= scene_index < len(candidates):
            raise ValueError(
                f"scene_index {scene_index} out of range (0..{len(candidates) - 1}).")
        return candidates[scene_index]
    entry = next((m for m in entries if m.get("section_type") == section_type), None)
    if entry is None:
        raise ValueError(f"No manifest entry for {section_type}.")
    return entry


def _cut_durations(section: dict) -> list:
    subs = section.get("sub_visuals") or []
    durations = []
    for sv in subs:
        if not isinstance(sv, dict):
            continue
        try:
            dur = float(sv.get("duration", 0) or 0)
        except (TypeError, ValueError):
            dur = 0
        if dur > 0:
            durations.append(dur)
    return durations


def resolve_targets(project_id: str, section_type: str = "scene", scene_index: int = 0,
                    cut_index: int = 0, scope: str = "cut",
                    mode: str = "auto", max_cells: int = 3) -> dict:
    """Resolve WHAT to snapshot into an ordered cell plan (no I/O beyond
    reads). Returns {mode, video_path, section_start, cells:[...]} where
    each cell is {cut_index, offset, timestamp, label} (render) or
    {cut_index, local_path, kind, label} (asset)."""
    if section_type not in SECTION_TYPES:
        raise ValueError(f"section_type must be one of {list(SECTION_TYPES)}.")
    if scope not in ("cut", "section"):
        raise ValueError("scope must be 'cut' or 'section'.")
    if mode not in ("auto", "render", "composition", "asset"):
        raise ValueError("mode must be 'auto', 'render', 'composition' or 'asset'.")
    max_cells = max(1, min(int(max_cells or 3), MAX_CELLS))

    proj = _db.get_project(project_id)
    if not proj:
        raise ValueError(f"Project {project_id!r} not found in database.")
    from backend.mcp import payloads
    proj_dir = payloads._project_dir(project_id)
    entries = _manifest_entries(proj, proj_dir)
    entry = _find_entry(entries, section_type, scene_index)
    section = _script_section(proj_dir, section_type, scene_index)
    durations = _cut_durations(section)
    if not durations:
        raise ValueError(
            "Section has no authored sub_visuals yet — run save_visuals first, "
            "then review.")
    if not 0 <= cut_index < len(durations):
        raise ValueError(f"cut_index {cut_index} out of range (0..{len(durations) - 1}).")

    section_start = _section_start(entries, entry)
    video_path = proj.get("video_path")
    has_video = bool(video_path) and Path(video_path).is_file()
    if mode == "auto":
        # Prefer exact rendered pixels; fall back to the asset lineup.
        # NOTE: composition is never auto-picked — the pipeline-guide
        # mandates an explicit mode=composition pass AFTER fetch_assets,
        # because only that shows exact pre-render pixels with downloads.
        if has_video:
            mode = "render"
        elif _cut_media(section, cut_index):
            mode = "asset"
        else:
            raise ValueError(
                "Nothing to snapshot: no rendered video yet and cut "
                f"{cut_index} has no downloaded media layers. Run "
                "run_stage(fetch_assets) first, then review_frame(mode=composition) "
                "for proper final visuals (or pick a cut with Image/Video layers "
                "that fetch_assets resolved).")
    elif mode == "render" and not has_video:
        raise ValueError("No rendered video yet (video_path missing). Run render first, "
                         "or use mode='composition' AFTER fetch_assets "
                         "(mode='asset' for the instant lineup).")
    elif mode == "composition":
        # Composition renders downloaded local_path files — reviewing before
        # fetch_assets yields placeholders, not final visuals. Fail fast.
        # Guard ALL cuts (not just the sampled contact-sheet cells) so a
        # broken cut outside the sample can't slip through to render.
        _require_fetched_assets(section, list(range(len(durations))))
    plan = {"mode": mode, "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "section_start": section_start,
            "video_path": video_path if mode == "render" else None,
            "cells": []}
    # Composition stills share the render timestamp math (absolute video
    # time); only the grab backend differs.
    temporal = mode in ("render", "composition")
    if temporal:
        if scope == "section" and len(durations) > 1:
            picked = _even_pick(len(durations), max_cells)
            cursor = 0.0
            for ci, dur in enumerate(durations):
                if ci in picked:
                    plan["cells"].append({
                        "cut_index": ci,
                        "offset": round(dur / 2, 2),
                        "timestamp": round(section_start + cursor + dur / 2, 2),
                        "label": f"cut {ci} @ {round(section_start + cursor + dur / 2, 2)}s",
                    })
                cursor += dur
        else:
            dur = durations[cut_index]
            cut_start = section_start + sum(durations[:cut_index])
            fractions = _even_fractions(max_cells)
            for frac in fractions:
                offset = round(dur * frac, 2)
                plan["cells"].append({
                    "cut_index": cut_index,
                    "offset": offset,
                    "timestamp": round(cut_start + offset, 2),
                    "label": f"cut {cut_index} @ {round(cut_start + offset, 2)}s "
                             f"({int(frac * 100)}% through cut)",
                })
    else:
        if scope == "section" and len(durations) > 1:
            picked = _even_pick(len(durations), max_cells)
            for ci in picked:
                media = _cut_media(section, ci)
                if not media:
                    continue
                # Scene board: first media layer per sampled cut.
                kind, local_path = media[0]
                plan["cells"].append({
                    "cut_index": ci,
                    "kind": kind,
                    "local_path": local_path,
                    "label": f"cut {ci} background ({kind})",
                })
        else:
            media = _cut_media(section, cut_index)
            if not media:
                missing = _unresolved_media(section, cut_index)
                if missing:
                    raise ValueError(
                        f"Cut {cut_index} has {len(missing)} Image/Video layer(s) "
                        f"with no downloaded file (e.g. {missing[0]!r}). Run "
                        "run_stage(fetch_assets) first, then review — "
                        "mode=composition for proper final visuals.")
                raise ValueError(
                    f"Cut {cut_index} is procedural (Text/HTML/Chart only) — "
                    "no media frame to snapshot. Use mode='composition' AFTER "
                    "fetch_assets for exact pre-render pixels.")
            for kind, local_path in media[:max_cells]:
                plan["cells"].append({
                    "cut_index": cut_index,
                    "kind": kind,
                    "local_path": local_path,
                    "label": f"cut {cut_index} layer ({kind})",
                })
    if not plan["cells"]:
        raise ValueError("No snapshot cells resolved for this selector.")
    plan["layout"] = "strip" if temporal else (
        "strip" if (scope == "section" and len(plan["cells"]) > 1) else "grid")
    return plan


def _even_pick(count: int, limit: int) -> list:
    """Evenly subsample `limit` indices out of `count` (keeps first/last)."""
    if count <= limit:
        return list(range(count))
    if limit == 1:
        return [count // 2]
    return sorted({round(i * (count - 1) / (limit - 1)) for i in range(limit)})


def _even_fractions(count: int) -> list:
    """Sample points across one cut: start/mid/end biased (15/50/85%)."""
    presets = [0.15, 0.5, 0.85, 0.3, 0.7, 0.05]
    return sorted(presets[:count])


def _cut_media(section: dict, cut_index: int) -> list:
    """(kind, local_path) media layers with files on disk, bottom-up."""
    subs = [sv for sv in (section.get("sub_visuals") or []) if isinstance(sv, dict)]
    if not 0 <= cut_index < len(subs):
        return []
    comp = subs[cut_index].get("composition") or {}
    children = comp.get("children") or []
    found = []
    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content") or {}
        if not isinstance(content, dict) or content.get("type") not in ("Image", "Video"):
            continue
        local_path = content.get("local_path")
        if isinstance(local_path, str) and local_path and Path(local_path).is_file():
            found.append((content["type"], local_path))
    return found


def _unresolved_media(section: dict, cut_index: int) -> list:
    """Image/Video queries with no downloaded file yet (need fetch_assets).

    Returns the list of query strings missing a local_path file. Empty means
    the cut is either procedural (no media layers) or fully fetched.
    """
    subs = [sv for sv in (section.get("sub_visuals") or []) if isinstance(sv, dict)]
    if not 0 <= cut_index < len(subs):
        return []
    comp = subs[cut_index].get("composition") or {}
    children = comp.get("children") or []
    missing = []
    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content") or {}
        if not isinstance(content, dict) or content.get("type") not in ("Image", "Video"):
            continue
        local_path = content.get("local_path")
        if not (isinstance(local_path, str) and local_path and Path(local_path).is_file()):
            query = content.get("query")
            missing.append(str(query) if query else content.get("type", "media"))
    return missing


def _require_fetched_assets(section: dict, cut_indices: list) -> None:
    """Guard for composition review: fail fast with an actionable message
    when targeted cuts still have unfetched Image/Video queries.

    Composition stills render the downloaded local_path files — reviewing
    before fetch_assets shows placeholders, not final visuals.
    """
    lacking = {}
    for ci in cut_indices:
        missing = _unresolved_media(section, ci)
        if missing:
            lacking[ci] = missing
    if lacking:
        bits = "; ".join(
            f"cut {ci} ({len(qs)} missing, e.g. {qs[0]!r})"
            for ci, qs in sorted(lacking.items())
        )
        raise ValueError(
            f"Assets not fetched yet: {bits}. Run run_stage(fetch_assets) "
            "first, then review_frame(mode=composition) for proper final visuals.")


def grab_render_frame(video_path: str, timestamp: float, width: int = 640):
    """Single decoded frame as a PIL image (fast seek, downscaled)."""
    from PIL import Image
    cmd = [_ffmpeg(), "-hide_banner", "-loglevel", "error",
           "-ss", str(max(0.0, timestamp)), "-i", video_path,
           "-frames:v", "1", "-vf", f"scale={width}:-1",
           "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          startupinfo=_startupinfo(), timeout=60)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg frame grab failed at {timestamp}s: "
                           f"{proc.stderr.decode(errors='ignore')[:200]}")
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


def grab_asset_cell(local_path: str, kind: str, width: int = 640):
    """Image direct, or a video poster frame (~10% in)."""
    from PIL import Image
    if kind == "Image":
        with Image.open(local_path) as img:
            img = img.convert("RGB")
            if img.width > width:
                img = img.resize((width, round(img.height * width / img.width)))
            return img.copy()
    # Video poster: probe duration, grab at 10%.
    duration = _probe_duration(local_path)
    at = max(0.5, (duration or 5.0) * 0.1)
    return grab_render_frame(local_path, at, width)


def _probe_duration(path: str) -> float | None:
    try:
        ffprobe = _ffprobe()
        proc = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            startupinfo=_startupinfo(), timeout=30)
        return float(proc.stdout.decode().strip())
    except Exception:
        return None


def merge_contact_sheet(images: list, layout: str = "strip") -> bytes:
    """Merge cell images into ONE JPEG (strip row or 2-col grid)."""
    from PIL import Image
    if not images:
        raise ValueError("No images to merge.")
    cells = [img.convert("RGB") for img in images]
    if layout == "strip":
        scale = STRIP_CELL_HEIGHT / max(img.height for img in cells)
        cells = [img.resize((max(1, round(img.width * scale)),
                             max(1, round(img.height * scale)))) for img in cells]
        total_w = sum(img.width for img in cells) + CELL_PAD * (len(cells) + 1)
        sheet_h = STRIP_CELL_HEIGHT + CELL_PAD * 2
        if total_w > MAX_LONG_SIDE:
            shrink = MAX_LONG_SIDE / total_w
            cells = [img.resize((max(1, round(img.width * shrink)),
                                 max(1, round(img.height * shrink)))) for img in cells]
            total_w = sum(img.width for img in cells) + CELL_PAD * (len(cells) + 1)
            sheet_h = max(img.height for img in cells) + CELL_PAD * 2
        sheet = Image.new("RGB", (total_w, sheet_h), SHEET_BG)
        x = CELL_PAD
        top = (sheet_h - max(img.height for img in cells)) // 2
        for img in cells:
            sheet.paste(img, (x, top + (max(c.height for c in cells) - img.height) // 2))
            x += img.width + CELL_PAD
    else:
        cols = 2
        fitted = []
        for img in cells:
            scale = min(GRID_CELL_WIDTH / img.width, GRID_CELL_HEIGHT / img.height)
            thumb = img.resize((max(1, round(img.width * scale)),
                                max(1, round(img.height * scale))))
            canvas = Image.new("RGB", (GRID_CELL_WIDTH, GRID_CELL_HEIGHT), SHEET_BG)
            canvas.paste(thumb, ((GRID_CELL_WIDTH - thumb.width) // 2,
                                 (GRID_CELL_HEIGHT - thumb.height) // 2))
            fitted.append(canvas)
        rows = (len(fitted) + cols - 1) // cols
        sheet = Image.new(
            "RGB",
            (GRID_CELL_WIDTH * cols + CELL_PAD * (cols + 1),
             GRID_CELL_HEIGHT * rows + CELL_PAD * (rows + 1)), SHEET_BG)
        for i, thumb in enumerate(fitted):
            sheet.paste(thumb, (CELL_PAD + (i % cols) * (GRID_CELL_WIDTH + CELL_PAD),
                                CELL_PAD + (i // cols) * (GRID_CELL_HEIGHT + CELL_PAD)))
    # Hard invariant: rounding in the per-cell resizes above must never push
    # the sheet past the context budget — final proportional clamp.
    if sheet.width > MAX_LONG_SIDE:
        sheet = sheet.resize((MAX_LONG_SIDE,
                              max(1, round(sheet.height * MAX_LONG_SIDE / sheet.width))))
    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def build_review(project_id: str, section_type: str = "scene", scene_index: int = 0,
                 cut_index: int = 0, scope: str = "cut",
                 mode: str = "auto", max_cells: int = 3) -> tuple[dict, bytes]:
    """Full pipeline: resolve cells → grab → merge. Returns (meta, jpeg)."""
    plan = resolve_targets(project_id, section_type, scene_index, cut_index,
                           scope, mode, max_cells)
    # Paired (cell, image): a failed middle cell must never shift later
    # images onto earlier cells' timestamps/labels.
    paired: list = []
    cache_info: dict | None = None
    if plan["mode"] == "composition":
        from backend.mcp import stills as _stills
        try:
            cache_info = _stills.describe_stills_cache(
                project_id, [c["timestamp"] for c in plan["cells"]])
        except Exception as e:
            logger.warning(f"review_frame: cache describe failed: {e}")
            cache_info = None
        try:
            stills = _stills.grab_composition_stills(
                project_id, [c["timestamp"] for c in plan["cells"]])
        except Exception as e:
            raise RuntimeError(str(e)) from e
        paired = list(zip(plan["cells"], stills))
    else:
        for cell in plan["cells"]:
            try:
                if plan["mode"] == "render":
                    img = grab_render_frame(plan["video_path"], cell["timestamp"])
                else:
                    img = grab_asset_cell(cell["local_path"], cell["kind"])
                paired.append((cell, img))
            except Exception as e:
                logger.warning(f"review_frame: skipped cell {cell.get('label')}: {e}")
    if not paired:
        raise RuntimeError("All snapshot cells failed to grab (see server log).")
    jpeg = merge_contact_sheet([img for _, img in paired], plan["layout"])
    meta = {"ok": True, "project_id": project_id, "mode": plan["mode"],
            "layout": plan["layout"],
            "section_type": plan["section_type"], "scene_index": plan["scene_index"],
            "section_start": plan["section_start"],
            "cells": [{"label": c["label"], "cut_index": c["cut_index"],
                       **({"timestamp": c["timestamp"]} if "timestamp" in c else {}),
                       **({"kind": c["kind"]} if "kind" in c else {})}
                      for c, _ in paired]}
    if cache_info is not None:
        pre_misses = cache_info.get("misses", [])
        meta["cache"] = {
            "visuals_hash": cache_info.get("visuals_hash"),
            "design_hash": cache_info.get("design_hash"),
            "script_hash": cache_info.get("script_hash"),
            "fps": cache_info.get("fps"),
            "frames": cache_info.get("frames", []),
            # hits/misses describe the PRE-render cache state. Returned
            # pixels are always current (missing frames were just rendered
            # under this visuals_hash), so fresh is unconditionally true —
            # was_cached tells whether they came straight from cache.
            "hits": cache_info.get("hits", []),
            "misses": pre_misses,
            "was_cached": not pre_misses,
            "fresh": True,
            "note": ("served from cache" if not pre_misses
                     else "rendered missing frames under current visuals_hash"),
        }
    return meta, jpeg
