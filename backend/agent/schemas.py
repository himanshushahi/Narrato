from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


logger = logging.getLogger(__name__)


# ============================================================================
# BASE SCHEMA CONFIGURATION
# ============================================================================

class AppBaseModel(BaseModel):
    """Base model that allows extra properties and supports field aliasing."""
    model_config = ConfigDict(
        extra="allow",
        populate_by_name=True,
        validate_assignment=True,
        arbitrary_types_allowed=True,
    )


# ============================================================================
# SCRIPT GENERATION SCHEMAS
# ============================================================================

class ScriptIntroResponse(AppBaseModel):
    """Schema for video introduction hook."""
    hook: str = Field(..., description="High-energy hook that grabs attention within 5-8 seconds")

    @field_validator("hook")
    @classmethod
    def validate_hook(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Introduction hook must be a non-empty string.")
        return v.strip()


class ScriptConclusionResponse(AppBaseModel):
    """Schema for video conclusion summary and call-to-action."""
    summary: str = Field(..., description="Condenses key takeaways in 5-8 seconds")
    cta: str = Field(..., description="Call to action or closing reflection")

    @field_validator("summary", "cta")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Summary and CTA must be non-empty strings.")
        return v.strip()


class ScriptSceneResponse(AppBaseModel):
    """Schema for individual scene narration."""
    scene_number: int = Field(..., description="Scene chapter index")
    title: str = Field(..., description="Scene or chapter title")
    narration: str = Field(..., description="Spoken voiceover text in target language/script")
    sub_visuals: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Visual AST cuts for this scene")

    @field_validator("narration")
    @classmethod
    def validate_narration(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Scene narration must be a non-empty string.")
        return v.strip()


class BaseScriptResponse(AppBaseModel):
    """Schema for initial script scaffolding (Intro + Conclusion)."""
    introduction: ScriptIntroResponse = Field(..., description="Introduction hook")
    conclusion: ScriptConclusionResponse = Field(..., description="Conclusion summary and call to action")


class OutlineChapter(AppBaseModel):
    """Schema for a single chapter in the video outline."""
    scene_number: int = Field(..., description="Sequential chapter number (1-based)")
    chapter_title: str = Field(..., description="Descriptive chapter title")
    scene_context: str = Field(..., description="Detailed factual context and storyline for this chapter")


class OutlineResponse(AppBaseModel):
    """Schema for the full video outline."""
    title: str = Field(..., description="Video title")
    chapters: List[OutlineChapter] = Field(..., description="List of outline chapters")


class StoryboardPlanResponse(AppBaseModel):
    """Schema for stage 1 visual planning."""
    storyboard_plan: str = Field(..., description="Detailed visual plan and shot breakdown for the scene")


class SearchQueryResponse(AppBaseModel):
    """Schema for search query optimization."""
    query: str = Field(..., description="Clean search query")


# ============================================================================
# DESIGN SYSTEM SCHEMAS
# ============================================================================

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

class ColorPalette(AppBaseModel):
    """Hex color palette for consistent brand styling."""
    background: str = Field(..., description="Canvas background hex color")
    primary: str = Field(..., description="Primary brand accent color")
    secondary: str = Field(..., description="Secondary color")
    accent: str = Field(..., description="Highlight/accent color")
    text: str = Field(..., description="Primary text foreground color")

    @field_validator("background", "primary", "secondary", "accent", "text", mode="before")
    @classmethod
    def sanitize_hex(cls, v: Any) -> str:
        s = str(v or "").strip()
        if _HEX_COLOR_RE.match(s):
            return s
        return "#facc15"


class Typography(AppBaseModel):
    """Typography settings for headings and body text."""
    heading_font: str = Field(..., description="Heading font family")
    body_font: str = Field(..., description="Body font family")


class DesignSystemResponse(AppBaseModel):
    """Schema for the global video design system."""
    theme_name: str = Field(..., description="Theme name")
    color_palette: ColorPalette = Field(..., description="Color palette")
    typography: Typography = Field(..., description="Typography settings")
    css_guidelines: str = Field(
        ...,
        description="Global styling guidelines for AST text and layer elements"
    )


# ============================================================================
# DECLARATIVE AST VISUAL SCHEMAS
# ============================================================================

AnimationProperty = Literal[
    "scale", "opacity", "translateX", "translateY", "rotate", "rotateX", "rotateY",
    "blur", "brightness",
]
EasingType = Literal[
    "linear", "spring", "ease-in", "ease-out", "ease-in-out",
    "bounce", "elastic", "back", "steps", "bezier",
]
LoopModeType = Literal["none", "loop", "pingpong"]

class AnimationNode(AppBaseModel):
    """Keyframe animation instruction for an AST Layer."""
    property: AnimationProperty = Field(..., description="Animatable property (spatial: scale/translate/rotate for shutter motion; blur px rack-focus; brightness multiplier flash)")
    from_: float = Field(..., alias="from", description="Initial value")
    to: float = Field(..., description="Target value")
    duration: float = Field(..., gt=0, description="Duration of the animation in seconds")
    delay: Optional[float] = Field(default=0.0, ge=0, description="Delay in seconds before animation begins (optional, default 0)")
    easing: EasingType = Field(default="ease-out", description="Animation easing curve: spring, ease-out, ease-in-out, ease-in, linear, bounce, elastic, back, steps, bezier")
    exit: Optional[bool] = Field(default=None, description="If true, marks an exit transition: skips evaluating until delay begins, and layer unmounts when complete")

    # Remotion spring physics parameters (when easing="spring")
    damping: Optional[float] = Field(default=None, gt=0, description="Spring damping / friction resistance (default 14, lower is bouncier)")
    stiffness: Optional[float] = Field(default=None, gt=0, description="Spring stiffness / tension snap (default 100, higher is snappier)")
    mass: Optional[float] = Field(default=None, gt=0, description="Spring mass / weight inertia (default 0.9, higher is heavier)")
    overshoot_clamping: Optional[bool] = Field(default=None, description="Spring overshoot clamping (if true, prevents bouncing beyond target value)")

    # Curve-specific parameters
    elastic_bounciness: Optional[float] = Field(default=None, gt=0, description="Elastic curve bounciness factor (default 1.0)")
    back_overshoot: Optional[float] = Field(default=None, ge=0, description="Back curve anticipation overshoot factor (default 1.7)")
    steps_count: Optional[int] = Field(default=None, gt=0, description="Steps curve discrete step count (default 5)")
    bezier_points: Optional[List[float]] = Field(default=None, description="Cubic bezier [x1, y1, x2, y2] control points (e.g. [0.16, 1.0, 0.3, 1.0])")

    # Continuous motion loop mode
    loop_mode: Optional[LoopModeType] = Field(default=None, description="Continuous motion cycle: 'none' (one-shot), 'loop' (repeats from start), 'pingpong' (oscillates forward and reverse; one direction per duration, full round trip = 2x duration)")

    @field_validator("bezier_points", mode="before")
    @classmethod
    def sanitize_bezier_points(cls, v: Any) -> Any:
        """Repair (never punish) cubic-bezier control points.

        The Remotion renderer throws when x1/x2 fall outside [0, 1],
        which would break the whole layer at export — so clamp x into
        range (y stays unbounded) and drop malformed shapes (wrong
        length / non-finite) so the renderer falls back to its default
        curve instead of crashing.
        """
        import math
        if v is None:
            return None
        if not isinstance(v, (list, tuple)) or len(v) != 4:
            logger.warning("AnimationNode: bezier_points must be [x1, y1, x2, y2] — dropping malformed %r", v)
            return None
        try:
            nums = [float(x) for x in v]
        except (TypeError, ValueError):
            logger.warning("AnimationNode: bezier_points has non-numeric values — dropping %r", v)
            return None
        if any(not math.isfinite(n) for n in nums):
            logger.warning("AnimationNode: bezier_points has non-finite values — dropping %r", v)
            return None
        nums[0] = min(1.0, max(0.0, nums[0]))
        nums[2] = min(1.0, max(0.0, nums[2]))
        return nums


class ChartDataPoint(AppBaseModel):
    """Data item for AST Chart components."""
    label: str = Field(..., description="Data point label")
    value: float = Field(..., description="Numeric value")
    color: Optional[str] = Field(default=None, description="Slice/bar hex color")


class MapLocation(AppBaseModel):
    """Location coordinate for AST Map components."""
    name: str = Field(..., description="City or landmark name")
    coord: List[float] = Field(..., description="[Latitude, Longitude]")


# ============================================================================
# LAYER STYLE KEY ALLOWLISTS
# ============================================================================
# Single source of truth for which `content.style` keys the Remotion renderer
# honors. Mirrors frontend ASTRenderer splitStyles LAYOUT_PROPS plus the
# per-type readers (KineticText, ChartRenderer, MediaNode). Anything else
# either breaks the editor overlay geometry (a raw `transform` bypasses the
# rotate/scale pipeline the overlay mirrors, so text renders outside its
# box) or silently does nothing — both are stripped by sanitize_layer_style().
UNIVERSAL_STYLE_KEYS = frozenset({
    "position", "left", "top", "right", "bottom", "width", "height",
    "borderRadius", "boxShadow", "overflow",
    "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
    "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
    "border", "borderTop", "borderBottom", "borderLeft", "borderRight",
    "borderWidth", "borderStyle", "borderColor",
    "backgroundColor", "background", "backdropFilter", "WebkitBackdropFilter",
    "rotate", "scale", "scaleX", "scaleY", "aspectRatio",
})
# Per-type extras the renderer reads from the inner (non-layout) style.
TEXT_STYLE_KEYS = frozenset({
    "fontSize", "textAlign", "lineHeight", "letterSpacing",
    "textShadow", "fontStyle", "justifyContent",
})
CHART_STYLE_KEYS = frozenset({"color"})
MEDIA_STYLE_KEYS = frozenset({"objectFit"})
_STYLE_EXTRAS_BY_TYPE = {
    "Text": TEXT_STYLE_KEYS,
    "Chart": CHART_STYLE_KEYS,
    "Image": MEDIA_STYLE_KEYS,
    "Video": MEDIA_STYLE_KEYS,
    "Counter": frozenset({"fontSize", "textAlign", "letterSpacing", "lineHeight", "fontStyle"}),
}
# Text style aliases the renderer tolerates: canonical home is the top-level
# content field — moved there when empty, dropped when already set.
TEXT_STYLE_ALIASES = {"fontFamily": "font", "fontWeight": "weight", "color": "color"}

# ============================================================================
# LAYERBOX SOT v1 — single source of truth for layer geometry.
# ============================================================================
# Authority = `content.style` box keys ONLY. Anchor rule: `top` XOR `bottom`
# (never both), `left` XOR `right` (never both). Units are `%` strings —
# `px`/unitless values are normalized to `%` at ingest (1920x1080 ref).
# Per-type stage rules: the style box is the stage for EVERY type; content
# fields are glyph/data detail, never a second size system. `Map`/`Particles`
# are full-frame canvases — their box is forced to fullscreen (it crops,
# never refits). `Shape` legacy `content.width/height` (fixed-px rect) is
# dropped when a style box is present (see validators.sanitize_style_keys).
# Background `children[0]` with no box = fullscreen (valid, no fill).
LAYER_BOX_KEYS = frozenset({
    "position", "left", "top", "right", "bottom", "width", "height",
    "borderRadius", "aspectRatio", "rotate", "scale", "scaleX", "scaleY",
})
# Full-frame canvas types: box is forced to fullscreen, never a positioned card.
FULLSCREEN_BOX_TYPES = frozenset({"Map", "Particles", "Background"})
# Foreground fill when a non-background layer carries no box at all.
CENTER_CARD_FILL = {
    "position": "absolute", "left": "15%", "top": "16%",
    "width": "70%", "height": "66%",
}
LOWER_THIRD_FILL = {
    "position": "absolute", "bottom": "18%", "left": "6%", "width": "88%",
}
FULLSCREEN_FILL = {"position": "absolute", "width": "100%", "height": "100%"}
# px→% reference grid per orientation. Landscape 1920x1080, portrait
# 1080x1920, square 1080x1080. Horizontal keys resolve against the canvas
# width, vertical keys against the canvas height.
_PX_REF_BY_FORMAT = {
    "landscape": {"x": 1920.0, "y": 1080.0},
    "portrait": {"x": 1080.0, "y": 1920.0},
    "square": {"x": 1080.0, "y": 1080.0},
}
_X_KEYS = frozenset({"left", "right", "width"})
_Y_KEYS = frozenset({"top", "bottom", "height"})
_GEOM_KEYS = _X_KEYS | _Y_KEYS


def _px_ref(video_format: Any) -> dict:
    return _PX_REF_BY_FORMAT.get(str(video_format or "landscape").lower(),
                                 _PX_REF_BY_FORMAT["landscape"])


def _to_percent(key: str, value: Any, video_format: str = "landscape") -> Any:
    """Normalize one geometry value to a `%` string. Non-geometry values
    (borderRadius px, rotate deg, scale multipliers) pass through untouched."""
    if key not in _GEOM_KEYS:
        return value
    grid = _px_ref(video_format)
    ref = grid["x"] if key in _X_KEYS else grid["y"]
    num: float | None = None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        num = float(value)
        # Bare numbers <=100 are already %; larger ones are px on the
        # format grid (e.g. 200 → 200/1920*100 on landscape).
        if abs(num) <= 100:
            logger.debug("_to_percent(%s): bare number %s treated as %%", key, value)
            return f"{round(num, 2):g}%"
        logger.debug("_to_percent(%s): bare number %s >100 treated as px→%%", key, value)
        num = num / ref * 100.0
    elif isinstance(value, str):
        t = value.strip()
        m = re.fullmatch(r"(-?[\d.]+)%", t)
        if m:
            try:
                return f"{round(float(m.group(1)), 2):g}%"
            except ValueError:
                return value
        m = re.fullmatch(r"(-?[\d.]+)px", t)
        if m:
            try:
                num = float(m.group(1)) / ref * 100.0
            except ValueError:
                return value
        elif re.fullmatch(r"-?[\d.]+", t):
            try:
                num = float(t)
            except ValueError:
                return value
            if abs(num) <= 100:
                logger.debug("_to_percent(%s): bare str '%s' treated as %%", key, t)
                return f"{round(num, 2):g}%"
            logger.debug("_to_percent(%s): bare str '%s' >100 treated as px→%%", key, t)
            num = num / ref * 100.0
        else:
            return value
    else:
        return value
    if num is None or num != num:  # None or NaN
        return value
    return f"{round(num, 2):g}%"


def _clamp_percent(key: str, value: Any, content_type: Any = None) -> Any:
    """Clamp `%` geometry to sane canvas ranges. Non-`%` strings pass through."""
    if key not in _GEOM_KEYS or not isinstance(value, str):
        return value
    m = re.fullmatch(r"\s*(-?[\d.]+)%\s*", value)
    if not m:
        return value
    try:
        num = float(m.group(1))
    except ValueError:
        return value
    if key in ("width", "height"):
        # Shape accent dots stay renderable at small sizes; everything else
        # keeps the 5% floor so layers stay selectable in the editor.
        floor = 2.0 if content_type == "Shape" else 5.0
        num = min(100.0, max(floor, num))
    else:
        num = min(100.0, max(-20.0, num))
    return f"{round(num, 2):g}%"


def normalize_layer_box(content_type: Any, style: Dict[str, Any],
                        video_format: str = "landscape") -> list:
    """Enforce the LayerBox contract on one layer's style dict IN PLACE.

    - coerces `position` to `absolute` when a box is present;
    - converts `px`/unitless geometry to `%` strings;
    - resolves double anchors (`top`+`bottom` → keep `bottom` for Text
      (lower-thirds), `top` for everything else; `left`+`right` → keep `left`);
    - clamps geometry to canvas ranges;
    - forces `Map`/`Particles` boxes to fullscreen.
    Returns human-readable notes for logging. Idempotent.
    """
    notes: List[str] = []
    if not isinstance(style, dict):
        return notes
    has_geom = any(k in style for k in _GEOM_KEYS)
    if has_geom and style.get("position") != "absolute":
        style["position"] = "absolute"
        notes.append("position→absolute")
    for key in ("left", "top", "right", "bottom", "width", "height"):
        if key in style:
            new_val = _to_percent(key, style[key], video_format)
            if new_val != style[key]:
                notes.append(f"{key}:px→%")
                style[key] = new_val
            clamped = _clamp_percent(key, style[key], content_type)
            if clamped != style[key]:
                notes.append(f"{key}:clamped")
                style[key] = clamped
    if "top" in style and "bottom" in style:
        # Lower-thirds are bottom-anchored by convention (LOWER_THIRD_FILL):
        # a Text layer carrying both anchors almost always gained a stray
        # top from the author — keep bottom so it stays glued to the safe
        # area. Every other type keeps top (historical behavior).
        if content_type == "Text":
            style.pop("top", None)
            notes.append("anchor:kept-bottom")
        else:
            style.pop("bottom", None)
            notes.append("anchor:kept-top")
    if "left" in style and "right" in style:
        style.pop("right", None)
        notes.append("anchor:kept-left")
    # Compound off-canvas check: warn when a positioned layer is entirely
    # outside the visible 0–100% canvas (e.g. left: -20% + width: 5%).
    def _pct_val(v: Any) -> float | None:
        if not isinstance(v, str):
            return None
        m2 = re.fullmatch(r"\s*(-?[\d.]+)%\s*", v)
        return float(m2.group(1)) if m2 else None
    l_v, t_v = _pct_val(style.get("left")), _pct_val(style.get("top"))
    w_v, h_v = _pct_val(style.get("width")), _pct_val(style.get("height"))
    if l_v is not None and w_v is not None and (l_v + w_v <= 0 or l_v >= 100):
        notes.append("off-canvas:horizontal")
        logger.warning("normalize_layer_box: layer entirely off-canvas horizontally "
                       "(left=%s, width=%s)", style.get('left'), style.get('width'))
    if t_v is not None and h_v is not None and (t_v + h_v <= 0 or t_v >= 100):
        notes.append("off-canvas:vertical")
        logger.warning("normalize_layer_box: layer entirely off-canvas vertically "
                       "(top=%s, height=%s)", style.get('top'), style.get('height'))
    if content_type in FULLSCREEN_BOX_TYPES and isinstance(style, dict):
        # Full-frame canvases ignore any box: a style with only
        # objectFit/opacity/borderRadius must still become fullscreen.
        changed = False
        for drop in ("left", "top", "right", "bottom"):
            if style.pop(drop, None) is not None:
                changed = True
        if style.get("width") != "100%" or style.get("height") != "100%":
            style["width"], style["height"] = "100%", "100%"
            changed = True
        if style.get("position") != "absolute":
            style["position"] = "absolute"
            changed = True
        if changed:
            notes.append(f"{content_type}:forced-fullscreen")
    return notes


def _centering_axes(transform_value: Any) -> tuple:
    """Detect the exact -50% centering hack: translateX/Y(-50%) or translate(-50%, -50%).

    Returns (fold_x, fold_y). Anything else (other percentages, rotate(),
    compound transforms) is NOT folded — it is stripped like any other
    unsupported transform.
    """
    if not isinstance(transform_value, str):
        return False, False
    t = transform_value.strip().lower()
    if re.fullmatch(r"translate\(\s*-50%\s*,\s*-50%\s*\)", t):
        return True, True
    if re.fullmatch(r"translatex\(\s*-50%\s*\)", t):
        return True, False
    if re.fullmatch(r"translatey\(\s*-50%\s*\)", t):
        return False, True
    return False, False


def _same_unit_pair(first: Any, second: Any) -> Any:
    """Return (unit, a, b) when both values are % or both are px numbers."""
    for pattern, unit in ((r"^\s*(-?[\d.]+)%\s*$", "%"), (r"^\s*(-?[\d.]+)px\s*$", "px")):
        ma = re.match(pattern, str(first))
        mb = re.match(pattern, str(second))
        if ma and mb:
            try:
                return unit, float(ma.group(1)), float(mb.group(1))
            except ValueError:
                return None
    return None


def sanitize_layer_style(content_type: Any, style: Any,
                         video_format: str = "landscape") -> tuple:
    """Repair (never punish) one layer's `content.style`.

    The renderer already honors any CSS it receives and the editor flags
    GUI-less keys in the UI — so the validator only removes what actively
    breaks the overlay geometry, and repairs intent where it can:
    - a translateX/Y(-50%) centering hack is folded into explicit
      left/top (same-unit pairs only);
    - the (folded or not) `transform` key is always removed: the overlay
      and Layout tab cannot represent it, so the layer would render
      outside its box with no control to fix it;
    - non-`absolute` `position` values are dropped (the renderer forces
      absolute containers; anything else breaks box geometry);
    - Text fontFamily/fontWeight/color aliases move to canonical content
      fields when those are empty;
    - the LayerBox contract is enforced via normalize_layer_box():
      `px`/unitless geometry → `%`, double anchors resolved
      (`left` wins; `top`+`bottom` → `bottom` wins for Text lower-thirds,
      `top` wins otherwise), values clamped, `Map`/`Particles` forced
      fullscreen, `position` coerced to `absolute`;
    - everything else passes through untouched, even GUI-less keys (the
      layer-card warning surface covers visibility, not the validator).
    Returns (cleaned_style_or_None, stripped_keys, alias_moves). Idempotent:
    running twice strips nothing the second time.
    """
    if style is None:
        return None, [], {}
    if not isinstance(style, dict):
        return None, [f"style:{type(style).__name__}"], {}
    working = style
    if "transform" in style:
        fold_x, fold_y = _centering_axes(style.get("transform"))
        if fold_x or fold_y:
            working = dict(style)
            if fold_x:
                pair = _same_unit_pair(working.get("left"), working.get("width"))
                if pair is not None:
                    unit, left, width = pair
                    working["left"] = f"{round(left - width / 2, 2):g}{unit}"
            if fold_y:
                pair = _same_unit_pair(working.get("top"), working.get("height"))
                if pair is not None:
                    unit, top, height = pair
                    working["top"] = f"{round(top - height / 2, 2):g}{unit}"
    cleaned: Dict[str, Any] = {}
    stripped: List[str] = []
    moves: Dict[str, Any] = {}
    for key, value in working.items():
        if key == "transform":
            stripped.append("transform")
        elif key == "position" and value not in (None, "absolute"):
            stripped.append("position(non-absolute)")
        elif (
            content_type == "Text"
            and key in TEXT_STYLE_ALIASES
            and value not in (None, "")
        ):
            # Relocated to the canonical content field by the caller —
            # not stripped, so it stays out of the stripped list.
            moves[TEXT_STYLE_ALIASES[key]] = value
        else:
            cleaned[key] = value
    # LayerBox SOT: normalize units/anchors/clamps + fullscreen types.
    # Runs on the cleaned dict (never on `self`, so no re-validation loop).
    box_notes = normalize_layer_box(content_type, cleaned, video_format)
    if box_notes:
        logger.debug(
            "sanitize_layer_style(%s): layerbox %s",
            content_type, box_notes,
        )
    # GUI-less but renderable keys pass through; note them once for the
    # promote-by-data loop (frequent ones earn allowlist/GUI status).
    allowed = UNIVERSAL_STYLE_KEYS | _STYLE_EXTRAS_BY_TYPE.get(content_type, frozenset())
    unusual = sorted({str(k) for k in working if k not in allowed and k != "transform"})
    if unusual:
        logger.debug(
            "sanitize_layer_style(%s): passing through GUI-less keys %s",
            content_type, unusual,
        )
    return (cleaned or None), stripped, moves


class LayerContent(AppBaseModel):
    """Rich polymorphic content payload for an AST Layer."""
    type: Literal["Image", "Video", "Text", "Chart", "Shape", "Map", "HTML", "Lottie", "Particles", "Counter", "Background"] = Field(..., description="Content type: Image, Video, Text, Chart, Shape, Map, HTML, Lottie, Particles, Counter, Background")
    query: Optional[str] = Field(default=None, min_length=2, description="REQUIRED when type is Image/Video: 1-3 broad English stock keywords (e.g. 'city skyline night'). Search query for Pexels, Wikipedia, Pixabay, YouTube, or Internet Archive. A media layer without a query can never download an asset and breaks the cut — always provide one.")
    source: Optional[str] = Field(default=None, description="Source of media (if Image/Video). MATRIX: Image accepts pexels|pixabay|wikipedia|archive (never youtube); Video accepts pexels|pixabay|youtube|archive (never wikipedia). Use 'archive' for authentic historical, space/NASA, documentary, newsreel footage or photos; use 'youtube' for animation loops, cinematic B-roll, or specific footage not available on Pexels/Pixabay — yt-dlp must be installed.", json_schema_extra={"enum": ["pexels", "wikipedia", "pixabay", "youtube", "archive"]})
    text: Optional[str] = Field(default=None, description="Text content (if Text)")
    animation_mode: Optional[str] = Field(default=None, description="Kinetic typography animation mode (if Text)", json_schema_extra={"enum": ["static", "words_stagger", "typewriter", "marker_highlight"]})
    highlight_words: Optional[List[str]] = Field(default=None, description="Words to highlight with marker/color (if Text)")
    highlight_color: Optional[str] = Field(default=None, description="Color for marker highlight (e.g. #facc15)")
    font: Optional[str] = Field(default=None, description="Font family (if Text or Counter)")
    weight: Optional[str] = Field(default=None, description="Font weight (if Text or Counter)")
    color: Optional[str] = Field(default=None, description="Text/accent color in hex")
    
    # Shape properties
    shape_type: Optional[str] = Field(default=None, description="Type of vector shape (if Shape)", json_schema_extra={"enum": ["rectangle", "circle", "star", "triangle", "arrow", "polygon", "path", "icon"]})
    icon_name: Optional[str] = Field(default=None, description="Lucide icon name in kebab-case (e.g. 'trending-up', 'trending-down', 'dollar-sign', 'coins', 'shield-alert', 'shield-check', 'lock', 'database', 'globe', 'zap', 'flame', 'gavel', 'target') (if Shape and shape_type='icon')")
    fill: Optional[str] = Field(default=None, description="Fill color hex or 'transparent' (if Shape)")
    stroke: Optional[str] = Field(default=None, description="Stroke border color hex (if Shape)")
    stroke_width: Optional[float] = Field(default=None, description="Stroke width in pixels (if Shape)")
    radius: Optional[float] = Field(default=None, description="Radius / size in pixels (if Shape)")
    width: Optional[float] = Field(default=None, description="Width in pixels for rectangle (if Shape)")
    height: Optional[float] = Field(default=None, description="Height in pixels for rectangle (if Shape)")
    corner_radius: Optional[float] = Field(default=None, description="Corner rounding radius in pixels (if Shape)")
    points: Optional[int] = Field(default=None, description="Number of points for star/polygon (if Shape)")
    inner_radius: Optional[float] = Field(default=None, description="Inner radius for star (if Shape)")
    direction: Optional[str] = Field(default=None, description="Direction for arrow/triangle (if Shape: up/down/left/right) or playback direction (if Lottie: forward/backward)", json_schema_extra={"enum": ["up", "down", "left", "right", "forward", "backward"]})
    angle: Optional[float] = Field(default=None, description="Rotation angle in degrees (if Shape)")
    preset_path: Optional[str] = Field(default=None, description="High-level SVG path preset (if Shape and shape_type='path')", json_schema_extra={"enum": ["route_arch", "horizontal_line", "pointer_curve", "corner_brackets", "wave_pulse", "circle_reticle"]})
    path_d: Optional[str] = Field(default=None, description="Custom SVG path d string in 1920x1080 canvas (if Shape and shape_type='path')")
    view_box: Optional[str] = Field(default=None, description="SVG viewBox string (default '0 0 1920 1080')")
    draw_animation: Optional[bool] = Field(default=None, description="Whether to animate stroke path drawing (if Shape, default true)")
    glow: Optional[bool] = Field(default=None, description="Whether to add subtle neon glow (if Shape, default true)")
    
    # Chart properties
    chart_type: Optional[str] = Field(default=None, description="Type of infographic chart (if Chart)", json_schema_extra={"enum": ["bar", "line", "pie", "donut", "progress"]})
    data: Optional[List[Union[ChartDataPoint, Dict[str, Any]]]] = Field(default=None, description="Array of data points (if Chart)")
    title: Optional[str] = Field(default=None, description="Title or headline (if Chart or Counter)")
    title_size: Optional[float] = Field(default=None, description="Title font size px (if Chart, default 28)")
    bar_radius: Optional[float] = Field(default=None, description="Bar corner radius px (if Chart bar, default 10)")
    bar_gap: Optional[float] = Field(default=None, description="Gap between bars px (if Chart bar, default 16)")
    bar_max_width: Optional[float] = Field(default=None, description="Bar max width px (if Chart bar, default 90)")
    bar_glow: Optional[bool] = Field(default=None, description="Neon glow on bars/fills (if Chart, default true)")
    
    # Lottie / Video playback properties
    lottie_url: Optional[str] = Field(default=None, description="Remote CDN URL (e.g. LottieFiles) or local path for vector motion graphics (if Lottie)")
    animation_data: Optional[Dict[str, Any]] = Field(default=None, description="Inline Lottie JSON override (if Lottie). Takes precedence over lottie_url fetch; use for bespoke micro-animations.")
    loop: Optional[bool] = Field(default=None, description="Playback loop behavior (for Video: default false, freezes on last frame if video ends before cut duration; set true to loop. For Lottie: default true)")
    playback_rate: Optional[float] = Field(default=None, description="Speed multiplier for Lottie animation (default 1.0)")
    lottie_direction: Optional[str] = Field(default=None, description="Playback direction for Lottie (default 'forward')", json_schema_extra={"enum": ["forward", "backward"]})
    
    # HTML / Map / Media properties
    html_content: Optional[str] = Field(default=None, description="Raw HTML/SVG markup (if HTML), e.g. custom tables, dossiers, badges, or SVG diagrams")
    volume: Optional[float] = Field(default=None, description="Audio volume 0-1 slider (Video only, default 0; ambient 0.1-0.25 unless mute_voiceover)")
    locations: Optional[List[Union[MapLocation, Dict[str, Any]]]] = Field(default=None, description="Locations to map (if Map). ALWAYS set map_style explicitly (editor modern_dark vs renderer vintage fallback).")
    map_style: Optional[str] = Field(default=None, description="Style of map (if Map)", json_schema_extra={"enum": ["vintage", "modern_dark", "minimal_light", "nautical_blue"]})
    # Particles properties (canvas confetti / embers / dust / money / snow / stars)
    particle_preset: Optional[str] = Field(default=None, description="Particle preset (if Particles)", json_schema_extra={"enum": ["confetti", "embers", "dust", "money_rain", "snow", "stars"]})
    particle_count: Optional[int] = Field(default=None, description="Particle count 10-300 (if Particles)")
    particle_colors: Optional[List[str]] = Field(default=None, description="Override palette hex colors (if Particles)")
    particle_size: Optional[List[float]] = Field(default=None, description="[min_px, max_px] particle size at 1080p (if Particles)")
    particle_speed: Optional[float] = Field(default=None, description="Global speed multiplier (if Particles)")
    particle_direction: Optional[str] = Field(default=None, description="Motion direction (if Particles)", json_schema_extra={"enum": ["up", "down", "left", "right", "outward", "twinkle"]})
    particle_opacity: Optional[float] = Field(default=None, description="Master opacity 0-1 (if Particles)")

    # Counter properties (animated count-up with tabular numerals & suffix/prefix)
    value: Optional[float] = Field(default=None, description="Target numerical value to count up to (if Counter)")
    start_value: Optional[float] = Field(default=None, description="Starting numerical value (if Counter, default 0)")
    prefix: Optional[str] = Field(default=None, description="Prefix string before the number, e.g. '$' (if Counter)")
    suffix: Optional[str] = Field(default=None, description="Suffix string after the number, e.g. 'M+', '%' (if Counter)")
    decimals: Optional[int] = Field(default=None, description="Decimal places to display (if Counter, default 0)")
    duration: Optional[float] = Field(default=None, description="Duration in seconds of count-up animation (if Counter, default 2.0)")
    format: Optional[str] = Field(default=None, description="Display number format (if Counter): 'standard', 'compact', 'currency', 'percent', 'full' (=standard, editor hides it), 'none'", json_schema_extra={"enum": ["standard", "compact", "currency", "percent", "full", "none"]})
    font_size: Optional[float] = Field(default=None, description="Font size px (Counter ONLY: default 72, range 16-300; content.font_size/fontSize/style.fontSize all work). Text size is style.fontSize instead — content.font_size on Text is ignored by the renderer.")

    # Background properties (procedural kinetic canvas backgrounds)
    background_preset: Optional[str] = Field(default=None, description="Procedural background preset: 'gradient_mesh', 'grid_flow', 'waves', 'dots', 'blueprint', 'vignette_loop', 'paper_grain' (if Background)", json_schema_extra={"enum": ["gradient_mesh", "grid_flow", "waves", "dots", "blueprint", "vignette_loop", "paper_grain"]})
    colors: Optional[List[str]] = Field(default=None, description="Color palette hex array for procedural background (if Background)")
    speed: Optional[float] = Field(default=None, description="Motion speed multiplier (if Background, editor slider 0.2-3.0, default 1.0)")

    image_type: Optional[str] = Field(default=None, description="Pixabay image type filter (only for source='pixabay'). Use 'illustration' or 'vector' to get transparent-background PNG cutouts/icons.", json_schema_extra={"enum": ["all", "photo", "illustration", "vector"]})
    yt_start_offset: Optional[float] = Field(default=None, description="Seconds to skip from the start of the YouTube video before capturing the clip (source='youtube' only). Default 15.")
    yt_duration: Optional[float] = Field(default=None, description="Duration in seconds of the YouTube clip to download (source='youtube' only). Default 15, max 30.")
    style: Optional[Dict[str, Any]] = Field(default=None, description="LayerBox SOT v1 — the ONLY geometry authority. Box keys: position/left/top/right/bottom/width/height (% strings ONLY, never px — px/unitless are normalized to % at ingest), borderRadius, aspectRatio, rotate (deg), scale/scaleX/scaleY (multiplier, negative mirrors). Anchor rule: top XOR bottom, left XOR right (never both; left wins; top+bottom conflict: Text keeps bottom, others keep top). Background children[0] with no box = fullscreen (valid). Map/Particles/Background MUST be fullscreen 100%x100% (their canvas ignores sizing — a positioned box only crops). Shape box = stage, content width/height/radius = glyph detail (legacy content width/height dropped when a box exists). Text lower-thirds use the bottom anchor. Center math: width 42% -> left 29% (50-width/2). NEVER transform/opacity/filter/display/mixBlendMode in style (transform stripped + overlay loses sync; style.filter hoisted to layer filters; opacity belongs in animations). Text font/weight/color are top-level content fields, plus objectFit (Image/Video), Text extras, Chart accent color.")

    @model_validator(mode="before")
    @classmethod
    def hoist_sources_query(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("query"):
                sources = data.get("sources")
                if isinstance(sources, list):
                    for entry in sources:
                        if isinstance(entry, dict) and entry.get("query"):
                            data["query"] = str(entry["query"]).strip()
                            if not data.get("source") and entry.get("source"):
                                data["source"] = str(entry["source"]).strip()
                            break
        return data

    @field_validator("query", mode="before")
    @classmethod
    def strip_query(cls, v: Any) -> Any:
        if isinstance(v, str):
            stripped = v.strip()
            return stripped or None
        return v

    @field_validator("font_size", mode="before")
    @classmethod
    def parse_font_size(cls, v: Any) -> Optional[float]:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            v_clean = v.strip().lower().replace("px", "").replace("pt", "")
            try:
                return float(v_clean)
            except ValueError:
                return None
        return None

    @model_validator(mode="before")
    @classmethod
    def sanitize_style_keys(cls, data: Any) -> Any:
        """Repair (never punish) the layer style (before-validation).

        Runs on the raw input dict (never on `self`, so assignment
        re-validation cannot recurse). A translateX/Y(-50%) centering hack
        is folded into explicit coordinates; the `transform` key itself is
        always removed (the overlay and Layout tab cannot represent it, so
        the layer would render outside its box); non-absolute `position`
        values are dropped; Text aliases move to canonical content fields.
        Everything else passes through — GUI-less keys are flagged in the
        editor UI, not stripped here.
        """
        if not isinstance(data, dict):
            return data
        if "style" in data:
            cleaned, stripped, moves = sanitize_layer_style(data.get("type"), data.get("style"))
            if stripped or moves:
                logger.warning(
                    "LayerContent(%s): stripped unsupported style keys %s; "
                    "relocated aliases %s",
                    data.get("type"), sorted(set(stripped)), sorted(moves),
                )
            if cleaned is None:
                data.pop("style", None)
            else:
                data["style"] = cleaned
            for target, value in moves.items():
                if data.get(target) in (None, ""):
                    data[target] = value
        if data.get("type") == "Background":
            if isinstance(data.get("colors"), str):
                data["colors"] = [c.strip() for c in data["colors"].split(",") if c.strip()]
            bp = data.get("background_preset")
            if bp:
                p = str(bp).strip().lower().replace("-", "_")
                preset_aliases = {
                    "mesh": "gradient_mesh",
                    "gradient": "gradient_mesh",
                    "grid": "grid_flow",
                    "cyber_grid": "grid_flow",
                    "wave": "waves",
                    "dot": "dots",
                    "matrix": "dots",
                    "cad": "blueprint",
                    "vignette": "vignette_loop",
                    "spotlight": "vignette_loop",
                    "paper": "paper_grain",
                    "grain": "paper_grain",
                }
                data["background_preset"] = preset_aliases.get(p, p)
            elif bp is None:
                data["background_preset"] = "gradient_mesh"
        if data.get("type") == "Counter":
            if "fontSize" in data and "font_size" not in data:
                data["font_size"] = data["fontSize"]
            if data.get("format") == "full":
                data["format"] = "standard"
        if data.get("type") == "Lottie" and "src" in data:
            src = data.pop("src")
            if src not in (None, "") and data.get("lottie_url") in (None, ""):
                data["lottie_url"] = src
        return data

    @model_validator(mode="after")
    def sanitize_shape_and_content(self) -> "LayerContent":
        """Auto-corrects and sanitizes vector shape and content properties to prevent rendering crashes."""
        def _safe_set(field: str, val: Any) -> None:
            if getattr(self, field) != val:
                object.__setattr__(self, field, val)

        if self.type == "Shape":
            if self.radius is not None and self.radius <= 0:
                _safe_set("radius", 50.0)
            if self.inner_radius is not None and self.inner_radius <= 0:
                _safe_set("inner_radius", 25.0)
            if self.stroke_width is not None and self.stroke_width < 0:
                _safe_set("stroke_width", 2.0)
            if self.corner_radius is not None and self.corner_radius < 0:
                _safe_set("corner_radius", 0.0)
        if self.type == "Counter":
            if self.value is None:
                _safe_set("value", 100.0)
            if self.start_value is None:
                _safe_set("start_value", 0.0)
            if self.decimals is not None and self.decimals < 0:
                _safe_set("decimals", 0)
            if self.duration is not None and self.duration <= 0:
                _safe_set("duration", 2.0)
            if self.format == "full":
                _safe_set("format", "standard")
            if self.font_size is not None and self.font_size <= 0:
                _safe_set("font_size", 72.0)
        if self.type == "Background":
            if not self.background_preset:
                _safe_set("background_preset", "gradient_mesh")
            else:
                p = self.background_preset.strip().lower().replace("-", "_")
                preset_aliases = {
                    "mesh": "gradient_mesh",
                    "gradient": "gradient_mesh",
                    "grid": "grid_flow",
                    "cyber_grid": "grid_flow",
                    "wave": "waves",
                    "dot": "dots",
                    "matrix": "dots",
                    "cad": "blueprint",
                    "vignette": "vignette_loop",
                    "spotlight": "vignette_loop",
                    "paper": "paper_grain",
                    "grain": "paper_grain",
                }
                _safe_set("background_preset", preset_aliases.get(p, p))
            if self.speed is not None and self.speed <= 0:
                _safe_set("speed", 1.0)
        if self.type in ("Image", "Video") and not self.query:
            raise ValueError(
                f"Media layer of type '{self.type}' requires a non-empty search "
                f"'query' (1-3 English stock keywords) — without it no asset can "
                f"be downloaded and the cut renders broken."
            )
        return self


MaskShapeType = Literal["none", "circle", "ellipse", "inset", "polygon"]
MaskRevealType = Literal[
    "none", "circle_iris", "wipe_right", "wipe_down", "split_vertical", "wipe_diagonal"
]
PolygonPresetType = Literal[
    "hexagon", "diamond", "triangle", "star", "slant_left", "slant_right", "custom"
]


class ASTMaskConfig(AppBaseModel):
    """Shape mask and animated reveal configuration for an AST layer."""
    shape: Optional[MaskShapeType] = Field(default=None, description="Mask shape: none, circle, ellipse, inset, polygon")
    size: Optional[Union[float, str]] = Field(default=None, description="Circle radius/size (percentage e.g. 50 or '50%')")
    rx: Optional[Union[float, str]] = Field(default=None, description="Ellipse horizontal radius")
    ry: Optional[Union[float, str]] = Field(default=None, description="Ellipse vertical radius")
    x: Optional[Union[float, str]] = Field(default=None, description="Center X coordinate (default '50%')")
    y: Optional[Union[float, str]] = Field(default=None, description="Center Y coordinate (default '50%')")
    top: Optional[Union[float, str]] = Field(default=None, description="Inset top crop")
    right: Optional[Union[float, str]] = Field(default=None, description="Inset right crop")
    bottom: Optional[Union[float, str]] = Field(default=None, description="Inset bottom crop")
    left: Optional[Union[float, str]] = Field(default=None, description="Inset left crop")
    corner_radius: Optional[Union[float, str]] = Field(default=None, description="Inset corner radius (px or %)")
    polygon_preset: Optional[PolygonPresetType] = Field(default=None, description="Polygon preset: hexagon, diamond, triangle, star, slant_left, slant_right, custom")
    points: Optional[str] = Field(default=None, description="Custom polygon points e.g. '50% 0%, 100% 50%, 50% 100%, 0% 50%'")
    reveal: Optional[MaskRevealType] = Field(default=None, description="Animated reveal transition: none, circle_iris, wipe_right, wipe_down, split_vertical, wipe_diagonal")
    reveal_duration: Optional[float] = Field(default=None, gt=0, description="Duration of the reveal animation in seconds")
    reveal_delay: Optional[float] = Field(default=None, ge=0, description="Delay before the reveal animation starts in seconds")
    reveal_easing: Optional[Literal["linear", "ease-in", "ease-out", "ease-in-out", "bounce"]] = Field(default=None, description="Reveal animation easing: linear, ease-in, ease-out, ease-in-out, bounce (no spring — overshoot past fully-revealed is invisible)")
    inverted: Optional[bool] = Field(default=None, description="Invert wipe direction or iris close")


class ASTLayerNode(AppBaseModel):
    """A single renderable layer in an AST Sequence composition.

    Stacking is children array order: children[0] is the bottom background,
    children[N-1] is the top foreground. No ordering fields exist.
    """
    type: Literal["Layer"] = Field(default="Layer", description="Layer node identifier", json_schema_extra={"const": "Layer"})
    name: Optional[str] = Field(default=None, description="Human-readable layer name/label for timeline ergonomics")
    visible: Optional[bool] = Field(default=None, description="Whether the layer is visible (false hides the layer from render and canvas)")
    locked: Optional[bool] = Field(default=None, description="Whether the layer is locked against accidental canvas drag/resize")
    color_tag: Optional[str] = Field(default=None, description="Color tag for visual grouping in editor")
    content: Union[LayerContent, Dict[str, Any]] = Field(..., description="Layer content specification")
    animations: Optional[List[Union[AnimationNode, Dict[str, Any]]]] = Field(default_factory=list, description="Keyframe animation list (spatial props drive shutter blur; blur/brightness are non-spatial fades)")
    exit: Optional[Union[bool, float]] = Field(default=None, description="Exit behavior: if true, layer unmounts when its animations complete; if number, seconds from cut start when layer unmounts. If omitted/false, layer persists for the full cut.")
    floating: Optional[bool] = Field(default=None, description="Harmonic floating drift (slow organic bob). Counts as spatial motion for shutter blur.")
    motion_blur: Optional[bool] = Field(default=None, description="Whether to apply physical camera shutter motion blur to moving elements (needs spatial motion: keyframe/floating/shake, else no-op)")
    shutter_angle: Optional[float] = Field(default=None, description="Camera shutter angle in degrees for motion blur (45-360, default 180; 90 crisp, 180 cinematic, 360 dreamy)")
    camera_shake: Optional[str] = Field(default=None, description="Procedural noise camera motion effect", json_schema_extra={"enum": ["none", "handheld", "shockwave", "glitch"]})
    transform_origin: Optional[str] = Field(default=None, description="CSS transform-origin pivot for scale/rotate (e.g. 'center center', 'top left'); only visible with motion")
    filters: Optional[List[str]] = Field(default_factory=list, description="CSS/SVG filter strings (brightness/contrast/saturate/hue-rotate/blur/drop-shadow/url(#fx-*) or 'mix-blend-mode: X' — blend needs a layer beneath)")
    mask: Optional[Union[ASTMaskConfig, Dict[str, Any]]] = Field(default=None, description="Shape masking & animated reveal configuration")

    @model_validator(mode="before")
    @classmethod
    def reject_legacy_ordering_keys(cls, data: Any) -> Any:
        if isinstance(data, dict) and ("z_index" in data or "zIndex" in data):
            raise ValueError("Invalid layer field 'z_index'/'zIndex': stacking is children array order (children[0]=bottom). Remove the field instead of ordering layers.")
        return data


class SequenceComposition(AppBaseModel):
    """Root composition container node for an AST sub-visual."""
    type: Literal["Sequence"] = Field(default="Sequence", description="Root composition container", json_schema_extra={"const": "Sequence"})
    children: List[Union[ASTLayerNode, Dict[str, Any]]] = Field(..., description="Ordered layer nodes")


class SubVisualAST(AppBaseModel):
    """A single sub-visual beat/cut in a scene."""
    duration: float = Field(..., gt=0, description="Precise duration in seconds")
    composition: Union[SequenceComposition, Dict[str, Any]] = Field(..., description="Declarative AST composition")
    transition: Optional[str] = Field(default="cut", description="Transition into this cut (cut, fade, crossfade, dissolve, slide_left, slide_right, slide_up, slide_down, zoom_in, zoom_out, whip_pan, glitch, none)")
    emphasis: Optional[List[Dict[str, Any]]] = Field(default=None, description="Mid-cut punch-in zooms: [{at: seconds sub-relative, scale: peak zoom 1.02-1.6, duration: seconds 0.2-2}]")
    subtitle_position: Optional[str] = Field(default=None, description="Subtitle placement override (bottom/top/hidden)")
    visual_path: Optional[str] = Field(default=None, description="Resolved local media file path")
    visual_url: Optional[str] = Field(default=None, description="Stock media URL")


class VisualsArrayResponse(AppBaseModel):
    """Schema for the array of sub-visuals in a scene."""
    sub_visuals: List[SubVisualAST] = Field(..., description="Array of AST sub-visual cuts")

    @field_validator("sub_visuals", mode="before")
    @classmethod
    def coerce_sub_visuals(cls, v: Any) -> List[Any]:
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            if "sub_visuals" in v and isinstance(v["sub_visuals"], list):
                return v["sub_visuals"]
            if "visuals" in v and isinstance(v["visuals"], list):
                return v["visuals"]
            if "subvisuals" in v and isinstance(v["subvisuals"], list):
                return v["subvisuals"]
            if "composition" in v:
                return [v]
            if "data" in v:
                if isinstance(v["data"], list):
                    return v["data"]
                if isinstance(v["data"], dict) and "sub_visuals" in v["data"]:
                    return v["data"]["sub_visuals"]
        return []

    @model_validator(mode="after")
    def reject_queryless_media(self) -> VisualsArrayResponse:
        """Strict gate: Image/Video layers MUST carry a search query.

        This runs at the response level (not per-content) deliberately:
        content fields accept raw dicts as a forward-compat fallback, which
        would otherwise let a query-less media layer slip past LayerContent
        validation. Inspect the raw output shape instead so the failure
        always surfaces to the agent correction loop.
        """
        offenders = []

        def _as_dict(node: Any) -> Dict[str, Any]:
            if isinstance(node, dict):
                return node
            if isinstance(node, BaseModel):
                try:
                    return node.model_dump()
                except Exception:
                    return {}
            return {}

        for cut_idx, sv in enumerate(self.sub_visuals or []):
            comp = _as_dict(getattr(sv, "composition", None) if not isinstance(sv, dict) else sv.get("composition"))
            children = comp.get("children", [])
            if not isinstance(children, list):
                continue
            for layer_idx, layer in enumerate(children):
                content = _as_dict(layer.get("content") if isinstance(layer, dict) else getattr(layer, "content", None))
                ctype = content.get("type")
                if ctype in ("Image", "Video"):
                    q = content.get("query")
                    if not isinstance(q, str) or not q.strip():
                        # Accept the hallucinated sources[] shape if it carries
                        # a usable nested query — validators.normalize_* will
                        # hoist it to content.query and drop the hardcoded URL.
                        nested_q = None
                        sources = content.get("sources")
                        if isinstance(sources, list):
                            for entry in sources:
                                entry_d = _as_dict(entry)
                                eq = entry_d.get("query")
                                if isinstance(eq, str) and eq.strip():
                                    nested_q = eq
                                    break
                        if not nested_q:
                            offenders.append(f"cut#{cut_idx} layer#{layer_idx} ({ctype})")
        if offenders:
            raise ValueError(
                "Media layers missing required search 'query' at "
                + ", ".join(offenders)
                + ". Every Image/Video layer needs 1-3 English stock keywords "
                "so its asset can be downloaded."
            )
        return self


# ============================================================================
# SCHEMA CONVERSION & VALIDATION HELPERS
# ============================================================================

def get_model_json_schema(target: Union[type[BaseModel], Dict[str, Any], None]) -> Optional[Dict[str, Any]]:
    """Converts a Pydantic model class or raw schema dict into an OpenAI-compatible JSON Schema dict."""
    if target is None:
        return None
    if isinstance(target, type) and issubclass(target, BaseModel):
        return target.model_json_schema()
    if isinstance(target, dict):
        return target
    return None


def parse_and_validate_model(target_schema: Any, raw_data: Any) -> Any:
    """Validates raw dict or JSON object against a Pydantic model if provided, returning dict or model."""
    if target_schema is None:
        return raw_data
    if isinstance(target_schema, type) and issubclass(target_schema, BaseModel):
        if isinstance(raw_data, target_schema):
            return raw_data.model_dump(by_alias=True, exclude_none=True)
        if isinstance(raw_data, (dict, list)):
            # If the model expects an object but raw_data is a list of sub_visuals
            if issubclass(target_schema, VisualsArrayResponse) and isinstance(raw_data, list):
                raw_data = {"sub_visuals": raw_data}
            validated = target_schema.model_validate(raw_data)
            return validated.model_dump(by_alias=True, exclude_none=True)
    return raw_data


# ============================================================================
# SKILL & TELEMETRY SCHEMAS
# ============================================================================

class SkillMetadata(AppBaseModel):
    """YAML frontmatter metadata of a SKILL.md file."""
    name: str = Field(..., description="Unique skill identifier name")
    version: str = Field(default="1.0", description="Semantic skill version")
    description: Optional[str] = Field(default="", description="Skill purpose and guidelines")
    when_to_use: Optional[str] = Field(default="", description="Condition or pipeline stage for loading this skill")


class ActivityTelemetryEntry(AppBaseModel):
    """A single real-time telemetry event for the UI activity feed."""
    id: str = Field(..., description="Unique atomic activity ID")
    ts: float = Field(..., description="Unix timestamp")
    kind: Literal["tool", "skill", "file", "llm", "web", "general"] = Field(..., description="Event category")
    name: str = Field(..., description="Action name or label")
    detail: str = Field(default="", description="Human-readable event detail")
    status: Literal["running", "ok", "error", "skipped"] = Field(default="ok", description="Status code")


# ============================================================================
# AGENT TOOL ARGUMENT SCHEMAS
# ============================================================================

class WebSearchToolArgs(AppBaseModel):
    query: str = Field(..., description="The search query to execute (keep concise)")
    count: int = Field(default=3, ge=1, le=5, description="Number of results to return")


class GetSkillToolArgs(AppBaseModel):
    name: str = Field(..., description="Skill name to load from the skills registry")


class SearchMediaToolArgs(AppBaseModel):
    query: str = Field(..., description="Search query")
    orientation: Optional[Literal["landscape", "portrait"]] = Field(default="landscape", description="Preferred orientation")


class SearchWikipediaImageToolArgs(AppBaseModel):
    query: str = Field(..., description="Name of person or entity")


class SearchPixabayPhotoToolArgs(AppBaseModel):
    query: str = Field(..., description="Search query in English")
    orientation: Optional[Literal["landscape", "portrait"]] = Field(default="landscape", description="Preferred orientation")
    image_type: Optional[Literal["all", "photo", "illustration", "vector"]] = Field(default="all", description="Image type filter")


class SearchYouTubeVideoToolArgs(AppBaseModel):
    query: str = Field(..., description="Search query in English")


class ReadProjectFileToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    filename: str = Field(..., description="Relative file path within project")


class ProjectStatusReportToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")


class ListProjectFilesToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")


class SearchIconsToolArgs(AppBaseModel):
    query: str = Field(..., description="Semantic search term or concept (e.g. 'growth', 'danger', 'security', 'law', 'data')")
    limit: int = Field(default=5, ge=1, le=20, description="Max icon candidates to return")


class GetWordTimingsToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    query: Optional[str] = Field(default=None, description="Specific keyword or phrase to find in the spoken narration")
    scene_index: Optional[int] = Field(default=None, description="Optional scene index to restrict word lookup")


class ProbeCutToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    section_type: Literal["introduction", "scene", "conclusion"] = Field(..., description="Section type")
    scene_index: int = Field(default=0, ge=0, description="Scene index")
    cut_index: int = Field(default=0, ge=0, description="Cut index")


class ProbeSceneToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    section_type: Literal["introduction", "scene", "conclusion"] = Field(..., description="Section type")
    scene_index: int = Field(default=0, ge=0, description="Scene index")


class ProbeAssetToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    section_type: Literal["introduction", "scene", "conclusion"] = Field(..., description="Section type")
    scene_index: int = Field(default=0, ge=0, description="Scene index")
    cut_index: int = Field(default=0, ge=0, description="Cut index")
    layer_index: int = Field(default=0, ge=0, description="Layer index")

