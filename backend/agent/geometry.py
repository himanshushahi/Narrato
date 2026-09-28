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

# Canvas reference grids — MUST match schemas._PX_REF_BY_FORMAT (the save
# authority). Used to echo normalized pixel boxes to agents.
_PX_REF = {
    "landscape": (1920.0, 1080.0),
    "portrait": (1080.0, 1920.0),
    "square": (1080.0, 1080.0),
}

# Complex-script blocks (Devanagari + other Indic/Arabic/Thai). Text in
# these scripts needs a taller line box — must match the renderer's
# isComplexScript() in frontend complexScriptFonts.ts.
_COMPLEX_SCRIPT_RE = re.compile(
    "[؀-ۿݐ-ݿऀ-ॿঀ-৿਀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ඀-ෟก-๿]")


def _container(video_format: str) -> Dict[str, float]:
    w, h = _PX_REF.get(str(video_format or "landscape").lower(),
                       _PX_REF["landscape"])
    return {"width": w, "height": h}


def _rect_to_px(rect: Any, container: Dict[str, float]) -> Dict[str, int] | None:
    """Resolve a %-rect to integer canvas pixels. The pixel-perfect echo:
    agents read box_px instead of doing %→px math themselves."""
    try:
        x0, y0, x1, y1 = rect
    except (TypeError, ValueError):
        return None
    w, h = container["width"], container["height"]
    return {"x": int(round(x0 / 100.0 * w)), "y": int(round(y0 / 100.0 * h)),
            "w": int(round((x1 - x0) / 100.0 * w)),
            "h": int(round((y1 - y0) / 100.0 * h))}


def _parse_line_height(value: Any) -> float | None:
    """Best-effort lineHeight → multiplier. px/em/unknown → None (can't
    judge against font size here, so don't warn)."""
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str):
        return None
    t = value.strip().lower()
    if t == "normal":
        return 1.2  # CSS normal ≈ tight — warns, correctly
    m = re.fullmatch(r"(-?[\d.]+)%", t)
    if m:
        try:
            return float(m.group(1)) / 100.0
        except ValueError:
            return None
    try:
        return float(t)
    except ValueError:
        return None  # "24px", "1.6em", ... — unknown ratio, stay silent


def _is_fullscreen_rect(rect: Any) -> bool:
    try:
        x0, y0, x1, y1 = rect
    except (TypeError, ValueError):
        return False
    return (abs(x0) < 0.01 and abs(y0) < 0.01
            and abs(x1 - 100.0) < 0.01 and abs(y1 - 100.0) < 0.01)


def _layer_time_window(layer: Dict[str, Any]) -> Tuple[float, float]:
    """Estimate (start_sec, end_sec) for a layer based on animations and exit property."""
    anims = [a for a in (layer.get("animations") or []) if isinstance(a, dict)]
    start = 0.0
    for a in anims:
        # If opacity starts at 0, layer is invisible until its delay
        if a.get("property") == "opacity" and (a.get("from") == 0 or a.get("from_") == 0):
            try:
                start = max(start, float(a.get("delay") or 0.0))
            except (ValueError, TypeError):
                pass
            break

    exit_val = layer.get("exit")
    end = float("inf")
    if isinstance(exit_val, (int, float)) and not isinstance(exit_val, bool):
        end = float(exit_val)
    elif exit_val is True and anims:
        ends = []
        for a in anims:
            try:
                ends.append(float(a.get("delay") or 0.0) + float(a.get("duration") or 0.0))
            except (ValueError, TypeError):
                pass
        if ends:
            end = max(ends)
    else:
        # Check if any animation track has exit: True
        exit_anims = [a for a in anims if a.get("exit") is True]
        if exit_anims:
            ends = []
            for a in exit_anims:
                try:
                    ends.append(float(a.get("delay") or 0.0) + float(a.get("duration") or 0.0))
                except (ValueError, TypeError):
                    pass
            if ends:
                end = max(ends)

    return start, end


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
    # Mirror the saver's anchor resolution (schemas.normalize_layer_box):
    # left wins horizontally; vertically Text keeps bottom (lower-thirds),
    # everything else keeps top. Otherwise the pixel echo describes a box
    # the save will not produce.
    x0 = left if left is not None else (
        100.0 - right - width if right is not None and width is not None else None)
    if double_v and ctype == "Text":
        y0 = (100.0 - bottom - height
              if bottom is not None and height is not None else None)
    else:
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


def lint_html_content(html: Any, label: str = "html") -> Dict[str, List[str]]:
    """Lint an HTML layer's inner markup against the COORDINATE_SPEC §9
    contract. Read-only; stdlib only. Returns {warnings[], fixes[]}."""
    warnings: List[str] = []
    fixes: List[str] = []
    if not isinstance(html, str) or not html.strip():
        return {"warnings": warnings, "fixes": fixes}
    low = html.lower()

    def _hit(w: str, f: str) -> None:
        warnings.append(f"{label}: {w}")
        fixes.append(f"{label}: {f}")

    if "<script" in low:
        _hit("contains <script> — never executes in preview/export; remove it",
             "delete the <script> block")
    if "<iframe" in low:
        _hit("contains <iframe> — blocked, renders blank; inline the markup instead",
             "replace <iframe> with inline HTML/SVG")
    if re.search(r"position\s*:\s*fixed", low):
        _hit("position:fixed escapes the AST layer box and paints canvas-wide",
             "use default (static) positioning inside the filler root")
    _nospace = re.sub(r"\s+", "", low)
    if (re.search(r"position\s*:\s*absolute", low)
            and re.search(r"(left|top|right|bottom)\s*:", low)
            and "width:100%" not in _nospace):
        _hit("inner absolute positioning without a 100% filler root drifts from the box",
             "wrap in a single root with width:100%;height:100%;box-sizing:border-box")
    if re.search(r"\d[\d.]*\s*(?:[sld]?v[wh]|vmin|vmax)\b", low):
        _hit("viewport units (vw/vh/vmin/vmax/svw/...) resolve against the canvas, not the layer box",
             "use % (of the box) or cqw units instead")
    if re.search(r"<(img|video|audio)\b[^>]*\bsrc\s*=", low):
        _hit("remote <img>/<video>/<audio src=> renders blank (pipeline never downloads it)",
             "use an Image/Video layer with a verified query instead")
    if "url(" in low:
        # Inline-SVG fragment refs (fill="url(#grad)", FX url(#fx-*)) are
        # safe and must NOT be flagged — strip them before checking.
        _sans_frag = re.sub(r"url\(\s*#[^)]*\)", "", low)
        if "url(" in _sans_frag:
            _hit("url(...) background/asset references never resolve headless and render blank",
                 "inline SVG or use an Image/Video layer instead")
    if re.search(r"\bsrc\s*=\s*[\"']https?://", low):
        _hit("remote http(s) src never loads in headless export",
             "remove remote refs; everything must be inline")
    if "data:" in low and "base64" in low:
        _hit("base64 data: URIs bloat the manifest and are banned",
             "use an Image/Video layer with a verified query instead")
    for m in re.finditer(r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*px", low):
        try:
            if float(m.group(1)) > 24:
                _hit(f"fixed-px font-size {m.group(1)}px does not scale with the % box "
                      f"(breaks on portrait/4K)", "use clamp() or %/cqw fluid type")
                break
        except ValueError:
            pass
    if "<style" in low:
        _hit("unscoped <style> leaks document-wide across layers and cuts",
             "scope selectors per-layer (unique class) or use inline styles")
    if re.search(r"transform\s*:", low):
        _hit("inner CSS transform rotates inside the container and can leak past the box",
             "use style.rotate/scale on the layer instead")
    # Root-shape check: first element should be the 100% filler root.
    m = re.search(r"<\s*(div|section|article|main|figure)\b([^>]*)>", html, re.IGNORECASE)
    if m and "100%" not in re.sub(r"\s+", "", m.group(2)):
        _hit("root element is not the 100% filler root — inner % resolves unpredictably",
             "make the first tag <div style=\"width:100%;height:100%;box-sizing:border-box;overflow:hidden;...\">")
    return {"warnings": warnings[:12], "fixes": fixes[:12]}


def lint_cut(cut: Dict[str, Any], cut_index: int = 0,
           video_format: str = "landscape") -> Dict[str, Any]:
    """Lint one cut. Returns {warnings[], fixes[], boxes[], overlaps[],
    html_warnings[]}. boxes[] carry box_px (canvas pixels) alongside %."""
    warnings: List[str] = []
    fixes: List[str] = []
    boxes: List[Dict[str, Any]] = []
    overlaps: List[Dict[str, Any]] = []
    html_warnings: List[str] = []
    container = _container(video_format)
    comp = cut.get("composition") if isinstance(cut, dict) else None
    # Misplaced cut-level keys inside composition are stripped at save.
    if isinstance(comp, dict):
        for _mk in ("emphasis", "subtitle_position"):
            if _mk in comp:
                warnings.append(
                    f"cut#{cut_index}: {_mk} inside composition is dropped at save — "
                    f"move it to the cut level (sibling of transition)")
                fixes.append(f"cut#{cut_index}: move {_mk} out of composition")
    children = comp.get("children") if isinstance(comp, dict) else None
    if not isinstance(children, list):
        return {"warnings": [f"cut#{cut_index}: no composition.children[]"],
                "fixes": [], "boxes": [], "overlaps": [],
                "html_warnings": [], "container": container}
    _full_rects: Dict[int, tuple] = {}
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            warnings.append(f"cut#{cut_index} layer#{idx}: non-dict child (dropped at save)")
            continue
        content = layer.get("content") or {}
        ctype = content.get("type") if isinstance(content, dict) else None
        box = layer_box(layer)
        box["layer_index"] = idx
        box_px = _rect_to_px(box.get("rect"), container)
        boxes.append({k: box.get(k) for k in (
            "layer_index", "type", "has_box", "left", "top", "width",
            "height", "double_anchor_h", "double_anchor_v")})
        boxes[-1]["box_px"] = box_px
        label = f"cut#{cut_index} layer#{idx} ({ctype})"
        # Forced-fullscreen types silently discard positioned boxes.
        if ctype in _FULLSCREEN_TYPES:
            raw = box.get("raw_style") or {}
            if any(raw.get(k) is not None
                   for k in ("left", "top", "right", "bottom")):
                warnings.append(
                    f"{label}: {ctype} is forced fullscreen — positioned box is dropped at save AND render")
                fixes.append(f"{label}: remove position keys, keep width/height 100%")
        # HTML inner markup is invisible to box math — lint it directly.
        if ctype == "HTML" and isinstance(content, dict):
            _hl = lint_html_content(content.get("html_content"), label)
            warnings.extend(_hl["warnings"])
            fixes.extend(_hl["fixes"])
            html_warnings.extend(_hl["warnings"])
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
            if ctype == "Text":
                warnings.append(f"{label}: free Text (no box) renders at 100px — usually too big")
                fixes.append(f"{label}: add a box (boxed text defaults to 64px) or set style.fontSize")
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
            if ctype == "Text":
                warnings.append(f"{label}: top+bottom both set — saver keeps bottom (lower-third), drops top")
                fixes.append(f"{label}: remove top, keep bottom")
            else:
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
        # Fixed-height text + complex script: matras stack outside a tight
        # line box and the layer's overflow:hidden clips them (top/bottom
        # cut). Renderer defaults complex scripts to lineHeight 1.6.
        # Advisory: roomy boxes (height >= 35%) cannot clip a line or two.
        if ctype == "Text" and isinstance(content, dict):
            _raw_h = box["raw_style"].get("height")
            _txt = content.get("text") if isinstance(content.get("text"), str) else ""
            _h_f = parse_pct(_raw_h)
            if (_raw_h is not None and _h_f is not None and _h_f < 35.0
                    and _txt and _COMPLEX_SCRIPT_RE.search(_txt)):
                _lh_f = _parse_line_height(box["raw_style"].get("lineHeight"))
                if _lh_f is None or _lh_f < 1.5:
                    warnings.append(
                        f"{label}: fixed height ({_raw_h}) + complex-script text with "
                        f"lineHeight {box['raw_style'].get('lineHeight')!r} — matras clip; "
                        f"omit height or use lineHeight ≥1.6")
                    fixes.append(f"{label}: omit style.height (auto-height) or set lineHeight 1.6")
        # Center-math helpers (horizontal + vertical). x0/y0 already resolve
        # right/bottom anchors, so this works for any anchor system. Advisory
        # only: fire when the box sits near center (looks like a centering
        # attempt) but misses exact center — far-off-center layouts are
        # deliberate.
        if (isinstance(w, float) and isinstance(box.get("x0"), float) and 5 <= w <= 95):
            ideal = center_left_for_width(w)
            if 1.0 < abs(box["x0"] - ideal) <= _CENTER_INTENT_PP:
                fixes.append(f"{label}: centered left for width {w:g}% is {ideal:g}% (50-width/2)")
        if (isinstance(h, float) and isinstance(box.get("y0"), float) and 5 <= h <= 95):
            ideal_top = center_top_for_height(h)
            if 1.0 < abs(box["y0"] - ideal_top) <= _CENTER_INTENT_PP:
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
                # Check if layers are temporally disjoint (one exits before the other enters)
                layer_a = children[ia] if isinstance(children[ia], dict) else {}
                layer_b = children[ib] if isinstance(children[ib], dict) else {}
                start_a, end_a = _layer_time_window(layer_a)
                start_b, end_b = _layer_time_window(layer_b)

                # Staggered sequential replacement: if layer A exits before layer B enters, no collision occurs
                if end_a <= start_b or end_b <= start_a:
                    continue

                overlaps.append({"layers": [ia, ib], "iou": score})
                warnings.append(
                    f"cut#{cut_index} layers {ia}+{ib}: overlap IoU {score} — "
                    f"intentional (label-over-media), shift left/top apart, or set 'exit' to stagger sequentially")
    return {"warnings": warnings, "fixes": fixes,
            "boxes": boxes, "overlaps": overlaps,
            "html_warnings": html_warnings, "container": container}


def lint_sub_visuals(sub_visuals: List[Dict[str, Any]],
                     video_format: str = "landscape") -> Dict[str, Any]:
    """Lint a whole section. Non-blocking: never raises on bad shapes.
    boxes[] carry box_px (canvas pixels for video_format); container echoes
    the grid so agents never do %→px math themselves."""
    container = _container(video_format)
    all_warnings: List[str] = []
    all_fixes: List[str] = []
    all_overlaps: List[Dict[str, Any]] = []
    all_boxes: List[Dict[str, Any]] = []
    all_html: List[str] = []
    try:
        cuts = sub_visuals if isinstance(sub_visuals, list) else []
        for idx, cut in enumerate(cuts):
            if not isinstance(cut, dict):
                continue
            rep = lint_cut(cut, cut_index=idx, video_format=video_format)
            all_warnings.extend(rep.get("warnings", []))
            all_fixes.extend(rep.get("fixes", []))
            for ov in rep.get("overlaps", []):
                all_overlaps.append({"cut_index": idx, **ov})
            for b in rep.get("boxes", []):
                all_boxes.append({"cut_index": idx, **b})
            all_html.extend(rep.get("html_warnings", []))
    except Exception:
        pass
    return {"warnings": all_warnings[:20], "fixes": all_fixes[:20],
            "overlaps": all_overlaps[:10],
            "boxes": all_boxes[:60], "boxes_px_note":
            "each box carries box_px {x,y,w,h} in canvas pixels",
            "html_warnings": all_html[:12],
            "container": container,
            "warning_count": len(all_warnings), "fix_count": len(all_fixes)}
