import logging
from typing import List, Dict, Any, Tuple
from backend.agent.schemas import SubVisualAST

logger = logging.getLogger(__name__)

# The same enums the pipeline enforces (ai.py SUB_VISUAL_SCHEMA /
# get_shared_visual_rules). Keep in sync with backend/pipeline/ai.py.
VALID_TRANSITIONS = {
    "none", "cut", "fade", "crossfade", "slide_left", "slide_right", 
    "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "dissolve"
}


# Mirrors frontend spatialMotion.ts: only spatial keyframes produce shutter motion.
# Opacity/blur/brightness fades are spatially identical subframes (no-op for blur).
SPATIAL_ANIMATION_PROPS = frozenset({
    "scale", "translateX", "translateY", "rotate", "rotateX", "rotateY",
})


def _is_spatial_animation(anim: Any) -> bool:
    if not isinstance(anim, dict):
        return False
    if anim.get("property") not in SPATIAL_ANIMATION_PROPS:
        return False
    try:
        duration = float(anim.get("duration"))
        float(anim.get("from"))
        float(anim.get("to"))
    except (ValueError, TypeError):
        return False
    return duration == duration  # finite check (NaN fails)


def _has_spatial_motion(layer: Dict[str, Any]) -> bool:
    if layer.get("floating"):
        return True
    shake = layer.get("camera_shake")
    if isinstance(shake, str) and shake != "none":
        return True
    anims = layer.get("animations") or []
    return any(_is_spatial_animation(a) for a in anims) if isinstance(anims, list) else False


def _safe_float(val, default: float = 0.0) -> float:
    """Safely convert a value to float, returning default on failure."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default





def normalize_transition(transition: str) -> str:
    """Fuzzy-map a transition string onto the valid enum."""
    t = str(transition or "cut").lower().strip().replace("-", "_").replace(" ", "_")
    if t in VALID_TRANSITIONS:
        return t
    for key in ("subtle_slide", "slide_left", "slide_right", "slide_up",
                "slide_down", "zoom_in", "zoom_out", "glitch", "crossfade", "dissolve", "cut", "none"):
        if key in t:
            return key
    if "fade" in t:
        return "fade"
    return "fade"


def _dummy_visual(target_duration: float) -> List[Dict[str, Any]]:
    return [{
        "transition": "cut",
        "composition": {"type": "Sequence", "children": []},
        "duration": target_duration,
    }]


def validate_sub_visuals(sub_visuals: List[Dict[str, Any]], target_duration: float, tolerance: float = 0.1) -> Tuple[bool, List[Dict[str, Any]], str]:
    """
    Validates a list of AST sub-visuals, ensuring their durations sum up to the
    target_duration, and normalizes transitions onto valid enums.

    Returns: (is_valid, normalized_sub_visuals, error_message)
    """
    if not isinstance(sub_visuals, list):
        return False, _dummy_visual(target_duration), "sub_visuals must be a list."

    if not sub_visuals:
        return False, _dummy_visual(target_duration), "Empty sub_visuals array provided."

    normalized = []
    total_duration = 0.0

    # Validation pass
    for v in sub_visuals:
        if not isinstance(v, dict):
            continue

        dur = _safe_float(v.get("duration", 1.0))
        if dur <= 0:
            dur = 1.0

        total_duration += dur

        entry = {
            "composition": v.get("composition", {"type": "Sequence", "children": []}),
            "transition": normalize_transition(v.get("transition", "cut")),
            "duration": dur,
        }
        # Mid-cut punch-in zooms: [{at, scale, duration}] — sanitize ranges so
        # a bad mark can never break the renderer (clamped again client-side).
        if isinstance(v.get("emphasis"), list):
            marks = []
            for m in v["emphasis"]:
                if not isinstance(m, dict):
                    continue
                try:
                    at = max(0.0, float(m.get("at", 0)))
                except (ValueError, TypeError):
                    continue
                try:
                    scale = float(m.get("scale", 1.12))
                except (ValueError, TypeError):
                    scale = 1.12
                try:
                    mark_dur = float(m.get("duration", 0.5))
                except (ValueError, TypeError):
                    mark_dur = 0.5
                marks.append({
                    "at": round(min(at, dur), 2),
                    "scale": round(min(1.6, max(1.02, scale)), 3),
                    "duration": round(min(2.0, max(0.2, mark_dur)), 2),
                })
            if marks:
                entry["emphasis"] = marks
        if "subtitle_position" in v and v["subtitle_position"] in ("bottom", "top", "hidden"):
            entry["subtitle_position"] = v["subtitle_position"]
        if "visual_path" in v:
            entry["visual_path"] = v["visual_path"]
        if "visual_url" in v:
            entry["visual_url"] = v["visual_url"]

        # Motion-blur sanity: mirror the editor's Motion FX warning. Blur is a
        # no-op on static layers (renderer bypasses it), so warn instead of
        # failing — values are preserved for when motion is added.
        try:
            comp = entry.get("composition") or {}
            children = comp.get("children") if isinstance(comp, dict) else None
            if isinstance(children, list):
                for layer in children:
                    if isinstance(layer, dict) and layer.get("motion_blur") and not _has_spatial_motion(layer):
                        logger.warning(
                            "validate_sub_visuals: motion_blur armed on static layer "
                            "(no spatial keyframe/floating/shake) — renderer will bypass it."
                        )
                        break
        except Exception:
            pass
        
        try:
            validated = SubVisualAST.model_validate(entry)
            normalized.append(validated.model_dump(exclude_none=True))
        except Exception:
            normalized.append(entry)

    if not normalized:
        return False, _dummy_visual(target_duration), "No valid sub_visuals found."

    # Normalization pass
    if target_duration > 0 and abs(total_duration - target_duration) > tolerance:
        logger.warning(f"validate_sub_visuals: duration mismatch. Expected {target_duration}, got {total_duration}. Normalizing.")
        for v in normalized:
            v["duration"] = round(v["duration"] / total_duration * target_duration, 2)

        # Fix rounding error on the last element to perfectly match target_duration
        current_sum = sum(v["duration"] for v in normalized)
        diff = round(target_duration - current_sum, 2)
        if diff != 0.0:
            normalized[-1]["duration"] = round(normalized[-1]["duration"] + diff, 2)

        # The output is already fixed and valid — report success so callers
        # (e.g. validate_and_correct_visuals) don't burn another LLM call on
        # an error we just repaired.
        return True, normalized, ""

    return True, normalized, ""


