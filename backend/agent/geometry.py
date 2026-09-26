"""Phase 1: geometry linter — visibility for blind LayerBox authoring.

Read-only. Never mutates cuts. Used by MCP save_visuals (geometry report)
and the internal LLM path (agent_engine). Surfaces what the validator
silently repairs today: double anchors, missing/non-px fontSize, numeric
geometry, off-canvas boxes, tiny/unselectable layers, overlaps, rotation
pivots, static-vs-animated compose notes, plus center-math suggestions.

All boxes are %-of-canvas. right/bottom anchors resolve to left/top via
x0 = 100 - right - width (same for y).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

_PCT_RE = re.compile(r"^\s*(-?[\d.]+)%\s*$")

_FULLSCREEN_TYPES = frozenset({"Background", "Map", "Particles"})
# Overlap is only meaningful between positioned foreground boxes; fullscreen
# canvases (by type or by 0/0/100/100 rect) overlap everything by design and
# are skipped pairwise.


def _is_fullscreen_rect(rect: Any) -> bool:
    try:
        x0, y0, x1, y1 = rect
    except (TypeError, ValueError):
        return False
    return (abs(x0) < 0.01 and abs(y0) < 0.01
            and abs(x1 - 100.0) < 0.01 and abs(y1 - 100.0) < 0.01)


def parse_pct(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str):
        return None
    m = _PCT_RE.match(value)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def center_left_for_width(width_pct: float) -> float:
    return round(50.0 - width_pct / 2.0, 2)


def center_top_for_height(height_pct: float) -> float:
    return round(50.0 - height_pct / 2.0, 2)


# Center-math fixes are advisory and only fire when the box looks
# intentionally centered (within this many pp of exact center) but is off by
# more than 1pp — e.g. a typo'd left. Far-off-center boxes (splits, thirds,
# top-anchored media) are deliberate layouts, not centering attempts, so
# suggesting centering there is noise.
_CENTER_INTENT_PP = 12.0


def layer_box(layer: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve one Layer's style box to absolute % rect + diagnostics."""
    content = layer.get("content") if isinstance(layer, dict) else None
    ctype = content.get("type") if isinstance(content, dict) else None
    style = content.get("style") if isinstance(content, dict) else None
    if not isinstance(style, dict):
        return {"type": ctype, "has_box": False, "style": None}
    left, right = parse_pct(style.get("left")), parse_pct(style.get("right"))
    top, bottom = parse_pct(style.get("top")), parse_pct(style.get("bottom"))
    width, height = parse_pct(style.get("width")), parse_pct(style.get("height"))
    double_h = left is not None and right is not None
    double_v = top is not None and bottom is not None
    # Normalizer keeps left/top — mirror that resolution here.
    x0 = left if left is not None else (
        100.0 - right - width if right is not None and width is not None else None)
    y0 = top if top is not None else (
        100.0 - bottom - height if bottom is not None and height is not None else None)
    rect = None
    if x0 is not None and y0 is not None and width is not None and height is not None:
        rect = (x0, y0, x0 + width, y0 + height)
    return {
        "type": ctype, "has_box": True,
        "left": left, "right": right, "top": top, "bottom": bottom,
        "width": width, "height": height,
        "x0": x0, "y0": y0, "rect": rect,
        "double_anchor_h": double_h, "double_anchor_v": double_v,
        "rotate": style.get("rotate"), "scale": style.get("scale"),
        "fontSize": style.get("fontSize"),
        "raw_style": dict(style),
    }


def _iou(a: Tuple[float, float, float, float],
         b: Tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = max(0.0, ax1 - ax0) * max(0.0, ay1 - ay0)
    bb = max(0.0, bx1 - bx0) * max(0.0, by1 - by0)
    union = aa + bb - inter
    return round(inter / union, 3) if union > 0 else 0.0


def lint_cut(cut: Dict[str, Any], cut_index: int = 0) -> Dict[str, Any]:
    """Lint one cut. Returns {warnings[], fixes[], boxes[], overlaps[]}."""
    warnings: List[str] = []
    fixes: List[str] = []
    boxes: List[Dict[str, Any]] = []
    overlaps: List[Dict[str, Any]] = []
    comp = cut.get("composition") if isinstance(cut, dict) else None
    children = comp.get("children") if isinstance(comp, dict) else None
    if not isinstance(children, list):
        return {"warnings": [f"cut#{cut_index}: no composition.children[]"],
                "fixes": [], "boxes": [], "overlaps": []}
    _full_rects: Dict[int, tuple] = {}
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            warnings.append(f"cut#{cut_index} layer#{idx}: non-dict child (dropped at save)")
            continue
        content = layer.get("content") or {}
        ctype = content.get("type") if isinstance(content, dict) else None
        box = layer_box(layer)
        box["layer_index"] = idx
        boxes.append({k: box.get(k) for k in (
            "layer_index", "type", "has_box", "left", "top", "width",
            "height", "double_anchor_h", "double_anchor_v")})
        label = f"cut#{cut_index} layer#{idx} ({ctype})"
        _has_geom = box["has_box"] and any(
            box.get(k) is not None
            for k in ("left", "right", "top", "bottom", "width", "height"))
        if not _has_geom:
            # Background children[0] with no box = fullscreen (valid); every
            # other missing box gets the center-card/lower-third default.
            # Covers both absent style and present-but-empty style dicts.
            if ctype not in _FULLSCREEN_TYPES:
                warnings.append(f"{label}: no LayerBox — editor fills center-card default")
                fixes.append(f"{label}: add left/top/width/height %-strings")
            continue
        # Non-string geometry (bare numbers / px) is rewritten at save —
        # surface it so the agent sees the repair instead of guessing.
        raw = box["raw_style"]
        for _gk in ("left", "top", "right", "bottom", "width", "height"):
            _rv = raw.get(_gk)
            if isinstance(_rv, (int, float)) and not isinstance(_rv, bool):
                warnings.append(
                    f"{label}: style.{_gk} numeric ({_rv!r}) — saver normalizes "
                    f"to %-string; prefer writing \"{str(_rv)}%\" explicitly")
                break
        if box["double_anchor_h"]:
            warnings.append(f"{label}: left+right both set — saver keeps left, drops right")
            fixes.append(f"{label}: remove right, keep left")
        if box["double_anchor_v"]:
            warnings.append(f"{label}: top+bottom both set — saver keeps top, drops bottom")
            fixes.append(f"{label}: remove bottom, keep top (lower-thirds keep bottom, drop top)")
        # Missing / non-px fontSize on Text.
        if ctype == "Text":
            _fs = box.get("fontSize")
            if _fs in (None, ""):
                warnings.append(f"{label}: missing style.fontSize — renderer default 64px applies")
                fixes.append(f"{label}: set style.fontSize e.g. \"56px\" (range 8-500)")
            elif not (isinstance(_fs, str) and _fs.strip().endswith("px")):
                warnings.append(
                    f"{label}: style.fontSize {_fs!r} is not a px string — "
                    f"renderer reads style.fontSize only (e.g. \"56px\")")
                fixes.append(f"{label}: set style.fontSize e.g. \"56px\" (range 8-500)")
        # Tiny / unselectable.
        w, h = box.get("width"), box.get("height")
        floor = 2.0 if ctype == "Shape" else 5.0
        if isinstance(w, float) and w < floor:
            warnings.append(f"{label}: width {w:g}% < {floor:g}% floor — clamped at save, stays selectable")
        if isinstance(h, float) and h < floor and not (
                ctype == "Text" and box["raw_style"].get("height") is None):
            warnings.append(f"{label}: height {h:g}% < {floor:g}% floor — clamped at save")
        # Off-canvas entirely.
        x0, y0 = box.get("x0"), box.get("y0")
        if (isinstance(x0, float) and isinstance(w, float)
                and (x0 + w <= 0 or x0 >= 100)):
            warnings.append(f"{label}: entirely off-canvas horizontally (left={x0:g}%, width={w:g}%)")
        if (isinstance(y0, float) and isinstance(h, float)
                and (y0 + h <= 0 or y0 >= 100)):
            warnings.append(f"{label}: entirely off-canvas vertically (top={y0:g}%, height={h:g}%)")
        # Rotation pivot invisible without motion/preview.
        if box.get("rotate") not in (None, 0, "0", "0deg"):
            if not layer.get("transform_origin"):
                warnings.append(f"{label}: static rotate without transform_origin — pivot defaults to center, verify with review_frame")
                fixes.append(f"{label}: set transform_origin e.g. \"center center\"")
        # Static scale/rotate + animated scale/rotate compose note.
        anims = layer.get("animations") or []
        animated = {a.get("property") for a in anims
                    if isinstance(a, dict) and a.get("property")}
        for static_key in ("scale", "scaleX", "scaleY", "rotate"):
            if box["raw_style"].get(static_key) not in (None, "") and static_key in animated:
                warnings.append(
                    f"{label}: static style.{static_key} + animated {static_key} compose "
                    f"(static base × keyframe) — verify with review_frame")
        # Center-math helpers (horizontal + vertical). Advisory only: fire
        # when the box sits near center (looks like a centering attempt)
        # but misses exact center — far-off-center layouts are deliberate.
        if (isinstance(w, float) and isinstance(x0, float) and 5 <= w <= 95
                and box.get("left") is not None):
            ideal = center_left_for_width(w)
            if 1.0 < abs(x0 - ideal) <= _CENTER_INTENT_PP:
                fixes.append(f"{label}: centered left for width {w:g}% is {ideal:g}% (50-width/2)")
        if (isinstance(h, float) and isinstance(y0, float) and 5 <= h <= 95
                and box.get("top") is not None):
            ideal_top = center_top_for_height(h)
            if 1.0 < abs(y0 - ideal_top) <= _CENTER_INTENT_PP:
                fixes.append(f"{label}: centered top for height {h:g}% is {ideal_top:g}% (50-height/2)")
        _full_rects[idx] = (box.get("rect"), box.get("type"))
    # Pairwise overlap on foreground rects (single pass — reuse the boxes
    # resolved above). Fullscreen rects of ANY type are skipped pairwise.
    rects: Dict[int, Tuple] = {}
    for idx, (rect, rtype) in _full_rects.items():
        if rect is not None and rtype not in _FULLSCREEN_TYPES \
                and not _is_fullscreen_rect(rect):
            rects[idx] = rect
    keys = sorted(rects)
    for a_i in range(len(keys)):
        for b_i in range(a_i + 1, len(keys)):
            ia, ib = keys[a_i], keys[b_i]
            score = _iou(rects[ia], rects[ib])
            if score > 0.6:
                overlaps.append({"layers": [ia, ib], "iou": score})
                warnings.append(
                    f"cut#{cut_index} layers {ia}+{ib}: overlap IoU {score} — "
                    f"intentional (label-over-media) or shift left/top apart")
    return {"warnings": warnings, "fixes": fixes,
            "boxes": boxes, "overlaps": overlaps}


def lint_sub_visuals(sub_visuals: List[Dict[str, Any]],
                     video_format: str = "landscape") -> Dict[str, Any]:
    """Lint a whole section. Non-blocking: never raises on bad shapes."""
    _ = video_format  # reserved for format-specific floors.
    all_warnings: List[str] = []
    all_fixes: List[str] = []
    all_overlaps: List[Dict[str, Any]] = []
    try:
        cuts = sub_visuals if isinstance(sub_visuals, list) else []
        for idx, cut in enumerate(cuts):
            if not isinstance(cut, dict):
                continue
            rep = lint_cut(cut, cut_index=idx)
            all_warnings.extend(rep.get("warnings", []))
            all_fixes.extend(rep.get("fixes", []))
            for ov in rep.get("overlaps", []):
                all_overlaps.append({"cut_index": idx, **ov})
    except Exception:
        pass
    return {"warnings": all_warnings[:20], "fixes": all_fixes[:20],
            "overlaps": all_overlaps[:10],
            "warning_count": len(all_warnings), "fix_count": len(all_fixes)}
