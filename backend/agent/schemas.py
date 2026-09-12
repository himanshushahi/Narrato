from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
EasingType = Literal["linear", "spring", "ease-in", "ease-out", "ease-in-out"]

class AnimationNode(AppBaseModel):
    """Keyframe animation instruction for an AST Layer."""
    property: Literal["scale", "opacity", "translateX", "translateY", "rotate", "rotateX", "rotateY", "blur", "brightness"] = Field(..., description="Animatable property (spatial: scale/translate/rotate for shutter motion; blur px rack-focus; brightness multiplier flash)")
    from_: float = Field(..., alias="from", description="Initial value")
    to: float = Field(..., description="Target value")
    duration: float = Field(..., gt=0, description="Duration of the animation in seconds")
    delay: Optional[float] = Field(default=0.0, ge=0, description="Delay in seconds before animation begins (optional, default 0)")
    easing: Literal["linear", "spring", "ease-in", "ease-out", "ease-in-out"] = Field(default="ease-out", description="Animation easing curve")


class ChartDataPoint(AppBaseModel):
    """Data item for AST Chart components."""
    label: str = Field(..., description="Data point label")
    value: float = Field(..., description="Numeric value")
    color: Optional[str] = Field(default=None, description="Slice/bar hex color")


class MapLocation(AppBaseModel):
    """Location coordinate for AST Map components."""
    name: str = Field(..., description="City or landmark name")
    coord: List[float] = Field(..., description="[Latitude, Longitude]")


class LayerContent(AppBaseModel):
    """Rich polymorphic content payload for an AST Layer."""
    type: Literal["Image", "Video", "Text", "Chart", "Shape", "Map", "HTML", "Lottie", "Particles"] = Field(..., description="Content type: Image, Video, Text, Chart, Shape, Map, HTML, Lottie, Particles")
    query: Optional[str] = Field(default=None, min_length=2, description="REQUIRED when type is Image/Video: 1-3 broad English stock keywords (e.g. 'city skyline night'). Search query for Pexels, Wikipedia, Pixabay, or YouTube. A media layer without a query can never download an asset and breaks the cut — always provide one.")
    source: Optional[str] = Field(default=None, description="Source of media (if Image/Video). Use 'youtube' for animation loops, cinematic B-roll, or specific footage not available on Pexels/Pixabay — yt-dlp must be installed.", json_schema_extra={"enum": ["pexels", "wikipedia", "pixabay", "youtube"]})
    text: Optional[str] = Field(default=None, description="Text content (if Text)")
    animation_mode: Optional[str] = Field(default=None, description="Kinetic typography animation mode (if Text)", json_schema_extra={"enum": ["static", "words_stagger", "typewriter", "marker_highlight"]})
    highlight_words: Optional[List[str]] = Field(default=None, description="Words to highlight with marker/color (if Text)")
    highlight_color: Optional[str] = Field(default=None, description="Color for marker highlight (e.g. #facc15)")
    font: Optional[str] = Field(default=None, description="Font family (if Text)")
    weight: Optional[str] = Field(default=None, description="Font weight (if Text)")
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
    title: Optional[str] = Field(default=None, description="Title or headline for Chart")
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
    volume: Optional[float] = Field(default=None, description="Audio volume from 0 to 1 (default 0 for Video)")
    locations: Optional[List[Union[MapLocation, Dict[str, Any]]]] = Field(default=None, description="Locations to map (if Map)")
    map_style: Optional[str] = Field(default=None, description="Style of map (if Map)", json_schema_extra={"enum": ["vintage", "modern_dark", "minimal_light", "nautical_blue"]})
    # Particles properties (canvas confetti / embers / dust / money / snow / stars)
    particle_preset: Optional[str] = Field(default=None, description="Particle preset (if Particles)", json_schema_extra={"enum": ["confetti", "embers", "dust", "money_rain", "snow", "stars"]})
    particle_count: Optional[int] = Field(default=None, description="Particle count 10-300 (if Particles)")
    particle_colors: Optional[List[str]] = Field(default=None, description="Override palette hex colors (if Particles)")
    particle_size: Optional[List[float]] = Field(default=None, description="[min_px, max_px] particle size at 1080p (if Particles)")
    particle_speed: Optional[float] = Field(default=None, description="Global speed multiplier (if Particles)")
    particle_direction: Optional[str] = Field(default=None, description="Motion direction (if Particles)", json_schema_extra={"enum": ["up", "down", "left", "right", "outward", "twinkle"]})
    particle_opacity: Optional[float] = Field(default=None, description="Master opacity 0-1 (if Particles)")
    image_type: Optional[str] = Field(default=None, description="Pixabay image type filter (only for source='pixabay'). Use 'illustration' or 'vector' to get transparent-background PNG cutouts/icons.", json_schema_extra={"enum": ["all", "photo", "illustration", "vector"]})
    yt_start_offset: Optional[float] = Field(default=None, description="Seconds to skip from the start of the YouTube video before capturing the clip (source='youtube' only). Default 15.")
    yt_duration: Optional[float] = Field(default=None, description="Duration in seconds of the YouTube clip to download (source='youtube' only). Default 15, max 30.")
    style: Optional[Dict[str, Any]] = Field(default=None, description="CSS layout box: position/left/top/bottom/width/height (% strings), objectFit, borderRadius, aspectRatio, rotate (deg), scale/scaleX/scaleY (multiplier, negative mirrors), fontSize/textAlign/textShadow/fontStyle, mixBlendMode (needs layer beneath). Prefer base boxes; static scale/rotate for emphasis only.")

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

    @model_validator(mode="after")
    def sanitize_shape_and_content(self) -> LayerContent:
        """Auto-corrects and sanitizes vector shape and content properties to prevent rendering crashes."""
        if self.type == "Shape":
            if self.radius is not None and self.radius <= 0:
                self.radius = 50.0
            if self.inner_radius is not None and self.inner_radius <= 0:
                self.inner_radius = 25.0
            if self.stroke_width is not None and self.stroke_width < 0:
                self.stroke_width = 2.0
            if self.corner_radius is not None and self.corner_radius < 0:
                self.corner_radius = 0.0
        if self.type in ("Image", "Video") and not self.query:
            raise ValueError(
                f"Media layer of type '{self.type}' requires a non-empty search "
                f"'query' (1-3 English stock keywords) — without it no asset can "
                f"be downloaded and the cut renders broken."
            )
        return self


class ASTLayerNode(AppBaseModel):
    """A single renderable layer in an AST Sequence composition.

    Stacking is children array order: children[0] is the bottom background,
    children[N-1] is the top foreground. No ordering fields exist.
    """
    type: Literal["Layer"] = Field(default="Layer", description="Layer node identifier", json_schema_extra={"const": "Layer"})
    content: Union[LayerContent, Dict[str, Any]] = Field(..., description="Layer content specification")
    animations: Optional[List[Union[AnimationNode, Dict[str, Any]]]] = Field(default_factory=list, description="Keyframe animation list (spatial props drive shutter blur; blur/brightness are non-spatial fades)")
    floating: Optional[bool] = Field(default=None, description="Harmonic floating drift (slow organic bob). Counts as spatial motion for shutter blur.")
    motion_blur: Optional[bool] = Field(default=None, description="Whether to apply physical camera shutter motion blur to moving elements (needs spatial motion: keyframe/floating/shake, else no-op)")
    shutter_angle: Optional[float] = Field(default=None, description="Camera shutter angle in degrees for motion blur (45-360, default 180; 90 crisp, 180 cinematic, 360 dreamy)")
    camera_shake: Optional[str] = Field(default=None, description="Procedural noise camera motion effect", json_schema_extra={"enum": ["none", "handheld", "shockwave", "glitch"]})
    transform_origin: Optional[str] = Field(default=None, description="CSS transform-origin pivot for scale/rotate (e.g. 'center center', 'top left'); only visible with motion")
    filters: Optional[List[str]] = Field(default_factory=list, description="CSS/SVG filter strings (brightness/contrast/saturate/hue-rotate/blur/drop-shadow/url(#fx-*) or 'mix-blend-mode: X' — blend needs a layer beneath)")

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


class UpdateDesignSettingsToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    updates: Dict[str, Any] = Field(..., description="Key-value pairs to deep-merge into design.json")


class UpdateSubtitlesToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    segment_index: int = Field(..., ge=0, description="Segment index to modify")
    updates: Dict[str, Any] = Field(..., description="Fields to update on the subtitle segment")


class UpdateVisualSettingsToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    updates: Dict[str, Any] = Field(..., description="Visual settings dictionary to validate and apply")


class UpdateSceneDurationToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_index: int = Field(..., ge=0, description="Scene index")
    new_duration_seconds: float = Field(..., gt=0, description="New scene duration in seconds")


class ReorderScenesToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    new_scene_order: List[int] = Field(..., description="Array of scene indices in desired order")


class DeleteSceneToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_index: int = Field(..., ge=0, description="Scene index to delete")


class AddSceneWithAiToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    user_prompt: str = Field(..., description="Prompt describing the new scene to create")
    language: str = Field(default="hi", description="Language code")


class RegenerateScriptSectionToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_idx: Optional[int] = Field(default=0, ge=0, description="Scene index (if section_type is scenes)")
    section_type: str = Field(..., description="Section type: introduction, scenes, or conclusion")
    rewrite_prompt: str = Field(..., description="Rewrite instructions")
    language: str = Field(default="hi", description="Language code")


class RegenerateSceneVisualsToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_idx: Optional[int] = Field(default=0, ge=0, description="Scene index (if section_type is scenes)")
    section_type: str = Field(..., description="Section type: introduction, scenes, or conclusion")
    rewrite_prompt: str = Field(..., description="Rewrite instructions")


class SetTtsSettingsToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    tts_engine: Optional[str] = Field(default=None, description="TTS engine")
    tts_voice: Optional[str] = Field(default=None, description="TTS voice")
    tts_speed: Optional[Union[float, str]] = Field(default=None, description="Speaking speed rate")
    tts_pitch: Optional[str] = Field(default=None, description="Voice pitch")


class InvalidateSceneToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_index: int = Field(..., ge=0, description="Scene index")
    scope: Optional[Literal["visuals", "all"]] = Field(default="visuals", description="Invalidation scope")


class UpdateSubVisualToolArgs(AppBaseModel):
    project_id: str = Field(..., description="Project identifier")
    scene_index: int = Field(..., ge=0, description="Scene index")
    sub_visual_index: int = Field(..., ge=0, description="Sub-visual index")
    updates: Dict[str, Any] = Field(..., description="Fields to update on the sub-visual cut")
