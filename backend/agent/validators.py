import logging
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)

# The same enums the pipeline enforces (ai.py SUB_VISUAL_SCHEMA /
# get_shared_visual_rules). Keep in sync with backend/pipeline/ai.py.
VALID_TRANSITIONS = {
    "none", "fade", "crossfade", "slide_left", "slide_right", 
    "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "dissolve"
}


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
    t = str(transition or "fade").lower().strip().replace("-", "_").replace(" ", "_")
    if t in VALID_TRANSITIONS:
        return t
    for key in ("subtle_slide", "slide_left", "slide_right", "slide_up",
                "slide_down", "zoom_in", "zoom_out", "glitch", "crossfade", "dissolve"):
        if key in t:
            return key
    if "fade" in t:
        return "fade"
    return "fade"


def _dummy_visual(target_duration: float) -> List[Dict[str, Any]]:
    return [{
        "transition": "fade",
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
            "transition": normalize_transition(v.get("transition", "fade")),
            "duration": dur,
        }
        if "subtitle_position" in v and v["subtitle_position"] in ("bottom", "top", "hidden"):
            entry["subtitle_position"] = v["subtitle_position"]
        if "visual_path" in v:
            entry["visual_path"] = v["visual_path"]
        if "visual_url" in v:
            entry["visual_url"] = v["visual_url"]
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


def validate_script(script_json: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Validates that a generated script meets the basic structural requirements.
    """
    if not isinstance(script_json, dict):
        return False, "Script must be a JSON object."

    if not script_json.get("title"):
        return False, "Script is missing a title."

    if not isinstance(script_json.get("scenes"), list):
        return False, "Scenes must be a list."

    if not script_json.get("introduction", {}).get("hook"):
        return False, "Introduction hook is missing."

    if not script_json.get("conclusion", {}).get("summary"):
        return False, "Conclusion summary is missing."

    return True, ""
