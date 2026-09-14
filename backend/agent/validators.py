import logging
from typing import List, Dict, Any, Tuple, Optional
from backend.agent.schemas import SubVisualAST, sanitize_layer_style

logger = logging.getLogger(__name__)

# The same enums the pipeline enforces (ai.py SUB_VISUAL_SCHEMA /
# get_shared_visual_rules). Keep in sync with backend/pipeline/ai.py.
VALID_TRANSITIONS = {
    "none", "cut", "fade", "crossfade", "slide_left", "slide_right", 
    "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "dissolve",
    "whip_pan",
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
    # Legacy alias: old AI/manual value, maps to slide_left (same motion).
    if "subtle_slide" in t:
        return "slide_left"
    for key in ("slide_left", "slide_right", "slide_up",
                "slide_down", "zoom_in", "zoom_out", "whip_pan", "glitch", "crossfade", "dissolve", "cut", "none"):
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


def _html_gradient_placeholder() -> Dict[str, Any]:
    """Fallback layer guaranteeing a cut always renders *something*.

    Used when sanitization removes every media layer of a cut (e.g. the LLM
    hallucinated Image/Video layers without a search query). A full-canvas
    gradient can never fail to download, decode, or paint.
    Stacking is array order — placeholder is appended/inserted at index 0 (bottom).
    """
    return {
        "type": "Layer",
        "content": {
            "type": "HTML",
            "html_content": (
                '<div style="width:100%;height:100%;'
                'background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 55%,#0ea5e9 100%)">'
                "</div>"
            ),
            "style": {"width": "100%", "height": "100%"},
        },
        "animations": [],
        "filters": [],
    }


def _is_queryless_media(layer: Any) -> bool:
    """True for Image/Video layers with no usable search query."""
    if not isinstance(layer, dict):
        return False
    content = layer.get("content")
    if not isinstance(content, dict):
        return False
    if content.get("type") not in ("Image", "Video"):
        return False
    q = content.get("query")
    if isinstance(q, str) and q.strip():
        return False
    # The model sometimes nests the query inside a hallucinated
    # ``sources: [{query, url, ...}]`` array (see sub-visual rewrites).
    # That still counts as a usable query — it gets hoisted by
    # normalize_hallucinated_sources() before this check matters.
    sources = content.get("sources")
    if isinstance(sources, list):
        for entry in sources:
            if isinstance(entry, dict):
                sq = entry.get("query")
                if isinstance(sq, str) and sq.strip():
                    return False
    return True


def normalize_hallucinated_sources(children: List[Any]) -> int:
    """Hoist query/source out of hallucinated ``sources[{url,query}]`` shapes.

    The AST contract is ``content: {type, query, source}`` — the pipeline
    downloads the asset itself. The model (after seeing search-tool URLs)
    sometimes emits ``content: {type, sources: [{url, query, source}]}``
    with a hardcoded remote URL instead. That URL is never downloaded,
    never expires safely, and the frontend renderer (which only reads
    ``content.local_path``) ignores it — so the cut renders as a blank
    procedural fallback.

    This normalizer, applied before any other check:
    - hoists the first usable ``query``/``source`` from ``sources[]`` up to
      ``content.query``/``content.source`` when the top level lacks them,
    - drops ``sources``, ``url``, ``asset_url`` and ``visual_url`` keys so a
      stale remote link can never persist into preview/save,
    - clears a ``local_path`` that points at nothing on disk (dangling ref
      from a copied cut), letting the preview fetcher re-download.
    Returns the number of layers repaired.
    """
    if not isinstance(children, list):
        return 0
    repaired = 0
    for layer in children:
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        if content.get("type") not in ("Image", "Video"):
            continue
        touched = False
        sources = content.get("sources")
        if isinstance(sources, list) and sources:
            first_query = None
            first_source = None
            for entry in sources:
                if not isinstance(entry, dict):
                    continue
                eq = entry.get("query")
                if isinstance(eq, str) and eq.strip() and not first_query:
                    first_query = eq.strip()
                es = entry.get("source")
                if isinstance(es, str) and es.strip() and not first_source:
                    first_source = es.strip().lower()
            if first_query and (not isinstance(content.get("query"), str) or not content["query"].strip()):
                content["query"] = first_query
                touched = True
            if first_source and (not isinstance(content.get("source"), str) or not content["source"].strip()):
                content["source"] = first_source
                touched = True
            content.pop("sources", None)
            touched = True
        for stale_key in ("url", "asset_url", "visual_url"):
            if stale_key in content:
                content.pop(stale_key, None)
                touched = True
        lp = content.get("local_path")
        if isinstance(lp, str) and lp.strip():
            # A valid local_path in a rewrite can only be an already-downloaded
            # preview file in previews/. Any other path (e.g. copied from the
            # prompt's original cut in assets/) is stripped so the fresh query
            # is downloaded instead of showing the old asset.
            lower_lp = lp.replace("\\", "/").lower()
            if "/previews/" not in lower_lp:
                content.pop("local_path", None)
                touched = True
            else:
                try:
                    from pathlib import Path as _Path
                    if not _Path(lp).exists():
                        content.pop("local_path", None)
                        touched = True
                except Exception:
                    pass
        elif isinstance(lp, str):
            content.pop("local_path", None)
            touched = True
        if touched:
            repaired += 1
    if repaired:
        logger.warning(
            f"normalize_hallucinated_sources: repaired {repaired} media layer(s) "
            f"(stripped hardcoded sources[]/url, kept query-only contract)."
        )
    return repaired


def normalize_sub_visuals_sources(sub_visuals: Any) -> int:
    """Apply normalize_hallucinated_sources to every cut's children.

    Works on single-cut dicts ({composition:{children}}), lists, and dicts
    wrapping a list ({sub_visuals:[...]}). Also strips top-level visual_url
    and non-preview visual_path from cuts. Returns total layers repaired.
    """
    total = 0
    if isinstance(sub_visuals, dict):
        if "sub_visuals" in sub_visuals and isinstance(sub_visuals["sub_visuals"], list):
            cuts = sub_visuals["sub_visuals"]
        else:
            cuts = [sub_visuals]
    elif isinstance(sub_visuals, list):
        cuts = sub_visuals
    else:
        return 0

    for sv in cuts:
        if not isinstance(sv, dict):
            continue
        # Clean any top-level visual_url or non-preview/dangling visual_path on the cut
        for stale_key in ("visual_url", "url"):
            if stale_key in sv:
                sv.pop(stale_key, None)
        vp = sv.get("visual_path")
        if isinstance(vp, str) and vp.strip():
            lower_vp = vp.replace("\\", "/").lower()
            if "/previews/" not in lower_vp:
                sv.pop("visual_path", None)
            else:
                try:
                    from pathlib import Path as _Path
                    if not _Path(vp).exists():
                        sv.pop("visual_path", None)
                except Exception:
                    pass
        elif isinstance(vp, str):
            sv.pop("visual_path", None)

        comp = sv.get("composition")
        if isinstance(comp, dict) and isinstance(comp.get("children"), list):
            total += normalize_hallucinated_sources(comp["children"])
    return total


def _is_layer_node(node: Any) -> bool:
    """True only for valid renderable children: {"type": "Layer", ...} dicts."""
    return isinstance(node, dict) and node.get("type") == "Layer"


def _keep_layers(children: List[Any]) -> List[Dict[str, Any]]:
    """Filter an AST children list down to valid Layer nodes only."""
    return [layer for layer in children if _is_layer_node(layer)]


def sanitize_media_layers(children: List[Any], cut_label: str = "") -> Tuple[List[Any], int]:
    """Drops non-Layer nodes and Image/Video layers that carry no search query.

    Non-Layer nodes are corrupted AST fragments (LLM Python-repr split into
    string fragments, nested sub-visual dicts swallowed into composition,
    style/content dicts orphaned without their Layer wrapper). A non-dict
    child crashes fetch_assets ('str' has no .get), and a non-Layer dict
    renders nothing — neither may persist.

    Such layers can never resolve an asset (the fetcher skips them), so they
    only ever render as broken placeholders. Returns (clean_children,
    dropped_count) where dropped_count covers BOTH corruption drops and
    query-less drops. A cut left with zero layers gets a single HTML gradient
    placeholder so it still paints deterministically.

    Also clears stale empty-string ``local_path`` on surviving media layers
    so the frontend correctly routes to the ProceduralCanvasFallback branch
    instead of attempting to load a blank URL.
    """
    if not isinstance(children, list):
        return [], 0
    normalize_hallucinated_sources(children)
    # Defensive: corrupted cuts must be dropped here — never persisted.
    # Only {"type": "Layer", ...} nodes are valid children (see helper).
    non_layer = sum(1 for layer in children if not _is_layer_node(layer))
    if non_layer:
        logger.warning(
            f"sanitize_media_layers: dropped {non_layer} non-layer node(s) "
            f"in {cut_label or 'cut'} (corrupted AST fragment; cut renders "
            f"remaining valid layers as fallback)."
        )
    dict_children = _keep_layers(children)
    clean = [layer for layer in dict_children if not _is_queryless_media(layer)]
    dropped = len(dict_children) - len(clean)
    total_dropped = non_layer + dropped
    if dropped:
        logger.warning(
            f"sanitize_media_layers: dropped {dropped} query-less media layer(s) "
            f"in {cut_label or 'cut'} (LLM omitted the search query; asset could never download)."
        )
    # Scrub stale empty-string local_path from surviving media layers so the
    # frontend's `content.local_path` truthiness check routes to the
    # ProceduralCanvasFallback instead of an empty-URL MediaNode.
    for layer in clean:
        if isinstance(layer, dict):
            content = layer.get("content")
            if isinstance(content, dict) and content.get("type") in ("Image", "Video"):
                lp = content.get("local_path")
                if isinstance(lp, str) and not lp.strip():
                    content.pop("local_path", None)
    if not clean and children:
        clean = [_html_gradient_placeholder()]
        logger.warning(
            f"sanitize_media_layers: {cut_label or 'cut'} left layer-less after sanitization — "
            f"inserted HTML gradient placeholder."
        )
    return clean, total_dropped


def sanitize_style_keys(children: List[Any], cut_label: str = "") -> int:
    """Repair (never punish) style keys on raw-dict layers.

    Mirrors the LayerContent model validator for pipeline paths that never
    run model validation. Mutates layer content dicts in place: folds a
    translateX/Y(-50%) centering hack into explicit coordinates, removes
    the `transform` key itself (the overlay and Layout tab cannot represent
    it, so the layer would render outside its box) and non-absolute
    `position` values, relocates Text style aliases (fontFamily/fontWeight/
    color) into canonical content fields when empty, and folds the Lottie
    `src` alias into `lottie_url`. Everything else passes through — GUI-less
    keys are flagged in the editor UI, not stripped here. Returns the number
    of keys stripped, folded, or moved.
    """
    if not isinstance(children, list):
        return 0
    fixed = 0
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        ctype = content.get("type")
        if "style" in content:
            cleaned, stripped, moves = sanitize_layer_style(ctype, content.get("style"))
            if cleaned is None:
                content.pop("style", None)
            else:
                content["style"] = cleaned
            moved_here = []
            for target, value in moves.items():
                if content.get(target) in (None, ""):
                    content[target] = value
                    moved_here.append(target)
                    fixed += 1
            if stripped or moved_here:
                fixed += len(stripped)
                logger.warning(
                    f"sanitize_style_keys: {cut_label or 'cut'} layer#{idx} "
                    f"({ctype}): stripped unsupported style keys {sorted(set(stripped))}; "
                    f"relocated aliases {sorted(moved_here)}."
                )
        if ctype == "Lottie" and "src" in content:
            src = content.pop("src")
            if src not in (None, "") and content.get("lottie_url") in (None, ""):
                content["lottie_url"] = src
                fixed += 1
    return fixed


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

        # Order-based stacking only: reject any ordering field outright.
        # No migration — old projects are unsupported.
        try:
            _comp = v.get("composition") if isinstance(v, dict) else None
            _kids = _comp.get("children") if isinstance(_comp, dict) else None
            if isinstance(_kids, list) and any(isinstance(l, dict) and ("z_index" in l or "zIndex" in l) for l in _kids):
                return False, _dummy_visual(target_duration), (
                    f"cut#{len(normalized)}: invalid layer field 'z_index'/'zIndex' — "
                    "stacking is children array order (children[0]=bottom). Remove the field."
                )
        except Exception:
            pass

        dur = _safe_float(v.get("duration", 1.0))
        if dur <= 0:
            dur = 1.0

        total_duration += dur

        entry = {
            "composition": v.get("composition", {"type": "Sequence", "children": []}),
            "transition": normalize_transition(v.get("transition", "cut")),
            "duration": dur,
        }
        # Hard-clean the composition BEFORE validation: the LLM repair path
        # can nest a whole second cut inside composition ({type, children,
        # duration, transition, composition}) or split a Python repr into
        # string fragments. Neither shape may persist — strip stray keys and
        # keep only Layer nodes so fetch_assets ('.get' traversal) and the
        # renderer can never crash on them. Copy (don't mutate the caller's
        # LLM output in place).
        try:
            raw_comp = entry.get("composition")
            if not isinstance(raw_comp, dict):
                entry["composition"] = {"type": "Sequence", "children": []}
            else:
                comp = dict(raw_comp)
                for _stray in ("duration", "transition", "composition", "emphasis", "subtitle_position", "visual_path", "visual_url"):
                    comp.pop(_stray, None)
                if comp.get("type") != "Sequence":
                    comp["type"] = "Sequence"
                if not isinstance(comp.get("children"), list):
                    comp["children"] = []
                else:
                    comp["children"] = _keep_layers(comp["children"])
                entry["composition"] = comp
        except Exception:
            pass
        # Sanitize hallucinated media layers (Image/Video without a search
        # query can never download an asset). Dropped layers are repaired,
        # not retried — burning an LLM correction turn on already-fixed
        # output would waste the costly call this validator exists to save.
        try:
            comp = entry.get("composition") or {}
            if isinstance(comp, dict) and isinstance(comp.get("children"), list):
                comp["children"], _ = sanitize_media_layers(
                    comp["children"], cut_label=f"cut#{len(normalized)}"
                )
        except Exception:
            pass
        # Strip unsupported style keys (raw `transform`, opacity/filter in
        # style, dead per-type extras) and relocate aliases. Repair, don't
        # fail — the model validator re-runs the same contract idempotently.
        try:
            comp = entry.get("composition") or {}
            if isinstance(comp, dict) and isinstance(comp.get("children"), list):
                sanitize_style_keys(
                    comp["children"], cut_label=f"cut#{len(normalized)}"
                )
        except Exception:
            pass
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
        except Exception as ve:
            # Never persist the raw corrupted entry: a model_validate failure
            # means stray shapes slipped through (e.g. non-dict children).
            # Keep the sanitized entry (dict-only children) so the cut still
            # renders via procedural fallback instead of crashing fetch_assets.
            logger.warning(
                f"validate_sub_visuals: cut#{len(normalized)} failed schema "
                f"validation ({ve}); keeping sanitized fallback."
            )
            try:
                _comp = entry.get("composition")
                if isinstance(_comp, dict) and isinstance(_comp.get("children"), list):
                    _comp["children"] = _keep_layers(_comp["children"])
            except Exception:
                pass
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


