"""Deterministic Polish & Auto-Enrichment Middleware.

Part of Narrato's broadcast-grade compiler pipeline. Automatically enriches
minimal or raw AST cuts before validation and database persistence:
1. Auto-Vignette & Contrast Scrim: Injects dark radial scrim over background
   media (Video/Image) behind foreground text to guarantee 100% legibility.
2. Anti-Void Frame 0 Anchor: Clamps initial delays when all layers delay entrance,
   ensuring scene foundations establish at 0.0s with zero dead air.
3. Continuous Ambient Micro-Drift: Injects Ken Burns drift (scale 1.0 -> 1.05)
   on static Image or Background layers so frames are never frozen.
4. Safe-Zone Geometry Enforcement: Clamps coordinate percentages to portrait/landscape
   safe zones to prevent collisions with mobile UI overlays and subtitles.
5. In-Engine LUT Color Grading: Auto-applies project's SVG color LUT shader
   (lut-cyberpunk, lut-vox-editorial, lut-dark-cinematic) to background media
   for broadcast-grade color consistency.
"""
from __future__ import annotations

import copy
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_PCT_RE = re.compile(r"^\s*(-?[\d.]+)%\s*$")


def _parse_pct(value: Any) -> float | None:
    """Extract float percentage from numeric or '%' string."""
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


def _format_pct(val: float) -> str:
    """Format float to clean % string."""
    return f"{round(val, 2):g}%"


def inject_auto_vignette(cut: Dict[str, Any], design_tokens: Optional[Dict[str, Any]] = None) -> int:
    """Inject a dark radial gradient scrim over background media (Video/Image).

    Ensures foreground text and kinetic subtitles remain 100% legible over raw footage.
    Idempotent: skips if a scrim layer is already present.
    Returns: 1 if scrim was injected, 0 otherwise.
    """
    if not isinstance(cut, dict):
        return 0
    comp = cut.get("composition")
    if not isinstance(comp, dict):
        return 0
    children = comp.get("children")
    if not isinstance(children, list) or not children:
        return 0

    # 1. Check idempotency: does a scrim layer already exist?
    for layer in children:
        if not isinstance(layer, dict):
            continue
        if layer.get("name") == "auto_vignette_scrim":
            return 0
        content = layer.get("content")
        if isinstance(content, dict) and content.get("type") == "HTML":
            html = str(content.get("html_content") or "")
            if "radial-gradient" in html and ("transparent" in html or "rgba(0,0,0" in html):
                return 0

    # 2. Check if there is an Image or Video serving as media/background
    media_idx = -1
    has_foreground = False

    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        ctype = content.get("type")
        if ctype in ("Image", "Video"):
            # The media layer can be at index 0 or after a background layer
            media_idx = max(media_idx, idx)
        elif ctype in ("Text", "Counter", "Chart", "HTML", "Shape", "Lottie"):
            has_foreground = True

    if media_idx == -1:
        return 0  # No raw media footage to scrim

    # 3. Build broadcast-grade contrast scrim layer
    scrim_layer: Dict[str, Any] = {
        "type": "Layer",
        "name": "auto_vignette_scrim",
        "content": {
            "type": "HTML",
            "html_content": (
                '<div style="width: 100%; height: 100%; box-sizing: border-box; '
                'background: radial-gradient(circle at 50% 50%, transparent 20%, rgba(0, 0, 0, 0.85) 100%);"></div>'
            ),
            "style": {
                "position": "absolute",
                "left": "0%",
                "top": "0%",
                "width": "100%",
                "height": "100%",
            },
        },
        "animations": [],
        "filters": [],
    }

    # Insert immediately after the media layer so it sits behind all foreground layers
    insert_pos = media_idx + 1
    children.insert(insert_pos, scrim_layer)
    return 1


def clamp_frame_zero_anchors(cut: Dict[str, Any]) -> int:
    """Prevent the '5-Second Black Void' by enforcing immediate scene establishment.

    Scans all layer entrance delays. If no visual element enters at 0.0s – 0.3s,
    it automatically clamps the background and primary anchor element to delay: 0.0s.
    Returns: Number of layers whose initial delays were clamped.
    """
    if not isinstance(cut, dict):
        return 0
    comp = cut.get("composition")
    if not isinstance(comp, dict):
        return 0
    children = comp.get("children")
    if not isinstance(children, list) or not children:
        return 0

    has_early_element = False

    for layer in children:
        if not isinstance(layer, dict):
            continue
        anims = layer.get("animations")
        if not isinstance(anims, list) or not anims:
            # A layer with no animations is visible from frame 0
            has_early_element = True
            break

        # Check if any entrance animation starts <= 0.3s
        layer_early = False
        has_entrance = False
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            delay = a.get("delay", 0.0)
            try:
                delay_f = float(delay or 0.0)
            except (ValueError, TypeError):
                delay_f = 0.0

            # Exit animations (exit: true or to: 0 opacity at the end) are not entrances
            if a.get("exit") is True or a.get("is_exit") is True:
                continue

            if prop in ("opacity", "scale", "translateY", "translateX"):
                has_entrance = True
                if delay_f <= 0.3:
                    layer_early = True
                    break

        if not has_entrance or layer_early:
            has_early_element = True
            break

    if has_early_element:
        return 0  # Scene already has a visible anchor on Frame 0

    # Void detected: clamp the background (layer 0) and primary anchor (first foreground layer)
    clamped_count = 0
    target_indices = [0]
    if len(children) > 1:
        target_indices.append(1)

    for idx in target_indices:
        if idx >= len(children):
            continue
        layer = children[idx]
        if not isinstance(layer, dict):
            continue
        anims = layer.get("animations")
        if not isinstance(anims, list) or not anims:
            continue

        # Find minimum entrance delay and clamp to 0.0s
        entrance_anims = [
            a for a in anims
            if isinstance(a, dict)
            and not (a.get("exit") is True or a.get("is_exit") is True)
        ]
        if not entrance_anims:
            continue

        min_delay = min(float(a.get("delay", 0.0) or 0.0) for a in entrance_anims)
        if min_delay > 0.3:
            for a in entrance_anims:
                a_delay = float(a.get("delay", 0.0) or 0.0)
                # If this animation shared the delayed entrance, clamp it to 0.0
                if abs(a_delay - min_delay) < 0.1:
                    a["delay"] = 0.0
            clamped_count += 1

    return clamped_count


def inject_ambient_drift(cut: Dict[str, Any]) -> int:
    """Inject subtle Ken Burns ambient scale drift (1.0 -> 1.05) on static images or backgrounds.

    Prevents frozen frames and adds broadcast life.
    Returns: Number of layers enriched with ambient drift.
    """
    if not isinstance(cut, dict):
        return 0
    comp = cut.get("composition")
    if not isinstance(comp, dict):
        return 0
    children = comp.get("children")
    if not isinstance(children, list) or not children:
        return 0

    try:
        duration = float(cut.get("duration", 5.0) or 5.0)
    except (ValueError, TypeError):
        duration = 5.0
    duration = max(1.0, duration)

    enriched_count = 0
    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        ctype = content.get("type")

        # Static Images and Backgrounds benefit from ambient camera drift
        if ctype in ("Image", "Background"):
            anims = layer.setdefault("animations", [])
            if not isinstance(anims, list):
                anims = []
                layer["animations"] = anims

            # Check if layer already has a scale animation or floating/shake motion
            has_scale = any(isinstance(a, dict) and a.get("property") == "scale" for a in anims)
            if not has_scale and not layer.get("floating"):
                anims.append({
                    "property": "scale",
                    "from": 1.0,
                    "to": 1.05,
                    "duration": round(duration, 2),
                    "delay": 0.0,
                    "easing": "linear",
                })
                enriched_count += 1

    return enriched_count


def enforce_safe_areas(cut: Dict[str, Any], video_format: str = "landscape") -> int:
    """Enforce safe-zone geometry to prevent mobile UI overlay and subtitle collisions.

    - Portrait (9:16): Clamps text coordinates to top: 10%–72% and bottom >= 28%.
    - Landscape (16:9): Clamps text coordinates to top >= 5% and bottom >= 18%.
    Returns: Number of layers adjusted.
    """
    if not isinstance(cut, dict):
        return 0
    comp = cut.get("composition")
    if not isinstance(comp, dict):
        return 0
    children = comp.get("children")
    if not isinstance(children, list) or not children:
        return 0

    norm_format = str(video_format or "landscape").lower()
    is_portrait = norm_format in ("portrait", "9:16", "vertical")

    adjusted_count = 0
    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        ctype = content.get("type")

        if ctype in ("Text", "Counter"):
            style = content.get("style")
            if not isinstance(style, dict):
                continue

            changed = False
            top_val = _parse_pct(style.get("top"))
            bot_val = _parse_pct(style.get("bottom"))
            w_val = _parse_pct(style.get("width"))

            if is_portrait:
                # In portrait, mobile UI headers occupy top 8% and footer/subtitles occupy bottom 28%
                if top_val is not None:
                    if top_val < 10.0:
                        style["top"] = "10%"
                        changed = True
                    elif top_val > 72.0:
                        style["top"] = "72%"
                        changed = True

                if bot_val is not None:
                    if bot_val < 28.0:
                        style["bottom"] = "28%"
                        changed = True
                    elif bot_val > 80.0:
                        style["bottom"] = "80%"
                        changed = True

                if w_val is not None and w_val > 88.0:
                    style["width"] = "84%"
                    style["left"] = "8%"
                    style.pop("right", None)
                    changed = True
            else:
                # In landscape, subtitle safe area is bottom 18%, top 5%
                if top_val is not None and top_val < 5.0:
                    style["top"] = "5%"
                    changed = True
                if bot_val is not None and bot_val < 18.0:
                    style["bottom"] = "18%"
                    changed = True

            if changed:
                adjusted_count += 1

    return adjusted_count


def resolve_lut_for_style(style_hint: str = "", design_tokens: Optional[Dict[str, Any]] = None) -> str:
    """Resolve canonical SVG LUT shader token for a given style hint or design system.

    Returns one of:
      - 'url(#fx-lut-cyberpunk)'
      - 'url(#fx-lut-vox-editorial)'
      - 'url(#fx-lut-dark-cinematic)'
    """
    hint = str(style_hint or "").lower().strip()
    if not hint and isinstance(design_tokens, dict):
        hint = str(design_tokens.get("theme_name") or design_tokens.get("style_hint") or "").lower().strip()

    if any(k in hint for k in ("cyber", "tech", "hacker", "future", "matrix", "neon", "crypto")):
        return "url(#fx-lut-cyberpunk)"
    if any(k in hint for k in ("doc", "history", "historical", "archive", "archival", "vintage", "retro", "sepia", "vox", "editorial", "paper")):
        return "url(#fx-lut-vox-editorial)"
    return "url(#fx-lut-dark-cinematic)"


def inject_auto_lut(cut: Dict[str, Any], design_tokens: Optional[Dict[str, Any]] = None,
                    style_hint: str = "") -> int:
    """Auto-apply project's LUT color grading shader to unstyled background Video/Image layers.

    Ensures heterogeneous stock assets inherit a unified broadcast color grade.
    If a layer already specifies explicit filters (LUT, duotone, or custom color grade),
    it is preserved (idempotent).
    Returns: Number of layers graded.
    """
    if not isinstance(cut, dict):
        return 0
    comp = cut.get("composition")
    if not isinstance(comp, dict):
        return 0
    children = comp.get("children")
    if not isinstance(children, list) or not children:
        return 0

    lut_token = resolve_lut_for_style(style_hint=style_hint, design_tokens=design_tokens)
    graded_count = 0

    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        ctype = content.get("type")
        if ctype not in ("Image", "Video"):
            continue

        # Skip cutout stickers / illustrations
        if content.get("image_type") == "illustration":
            continue

        raw_filters = layer.get("filters")
        if raw_filters is None:
            filters: List[Any] = []
            layer["filters"] = filters
        elif isinstance(raw_filters, list):
            filters = raw_filters
        else:
            filters = [raw_filters]
            layer["filters"] = filters

        # Check if already has a LUT, duotone, or explicit color grade
        filter_str = " ".join(str(f) for f in filters).lower()
        if any(tok in filter_str for tok in (
            "lut", "duotone", "grayscale", "sepia", "thermal", "noir",
            "url(#fx-lut", "url(#lut-", "brightness", "contrast", "hue-rotate", "saturate",
        )):
            continue

        filters.append(lut_token)
        graded_count += 1

    return graded_count


def enrich_cut(cut: Dict[str, Any], design_tokens: Optional[Dict[str, Any]] = None,
               video_format: str = "landscape", style_hint: str = "") -> List[str]:
    """Apply all deterministic enrichment middleware rules to a single cut in place.

    Returns a list of human-readable diagnostic notes.
    """
    notes: List[str] = []
    if not isinstance(cut, dict):
        return notes

    # 1. Anti-Void Frame 0 Anchor
    clamped = clamp_frame_zero_anchors(cut)
    if clamped:
        notes.append(f"clamped frame-0 entrance delay on {clamped} layer(s) (zero dead air)")

    # 2. Auto-Vignette & Contrast Scrim
    vignetted = inject_auto_vignette(cut, design_tokens=design_tokens)
    if vignetted:
        notes.append("injected auto-vignette contrast scrim behind text")

    # 3. Ambient Ken Burns Micro-Drift
    drifted = inject_ambient_drift(cut)
    if drifted:
        notes.append(f"injected ambient drift (scale 1.0->1.05) on {drifted} static layer(s)")

    # 4. Safe-Area Geometry Enforcement
    safe_zoned = enforce_safe_areas(cut, video_format=video_format)
    if safe_zoned:
        notes.append(f"enforced safe-area geometry ({video_format}) on {safe_zoned} layer(s)")

    # 5. Broadcast In-Engine LUT Color Shader
    graded = inject_auto_lut(cut, design_tokens=design_tokens, style_hint=style_hint)
    if graded:
        lut_token = resolve_lut_for_style(style_hint=style_hint, design_tokens=design_tokens)
        notes.append(f"applied broadcast LUT shader ({lut_token}) on {graded} media layer(s)")

    return notes


def enrich_sub_visuals(sub_visuals: List[Dict[str, Any]],
                       design_tokens: Optional[Dict[str, Any]] = None,
                       video_format: str = "landscape",
                       style_hint: str = "") -> Tuple[List[Dict[str, Any]], List[str]]:
    """Enrich an entire list of AST sub-visual cuts.

    Runs in-place on the provided cuts and returns (cuts, list_of_all_notes).
    """
    if not isinstance(sub_visuals, list):
        return sub_visuals, []

    all_notes: List[str] = []
    for idx, cut in enumerate(sub_visuals):
        if not isinstance(cut, dict):
            continue
        cut_notes = enrich_cut(cut, design_tokens=design_tokens, video_format=video_format, style_hint=style_hint)
        for n in cut_notes:
            all_notes.append(f"cut#{idx}: {n}")

    return sub_visuals, all_notes
