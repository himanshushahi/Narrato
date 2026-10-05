import logging
from typing import List, Dict, Any, Tuple
from backend.agent.schemas import SubVisualAST, sanitize_layer_style

logger = logging.getLogger(__name__)

# The same enums the pipeline enforces (ai.py SUB_VISUAL_SCHEMA /
# get_shared_visual_rules). Keep in sync with backend/pipeline/ai.py.
VALID_TRANSITIONS = {
    "none", "cut", "fade", "crossfade", "slide_left", "slide_right", 
    "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "dissolve",
    "blur_focus", "flash", "wipe_right", "iris_open", "rise", "flip",
}


# Mirrors frontend spatialMotion.ts: only spatial keyframes produce shutter motion.
# Opacity/blur/brightness fades are spatially identical subframes (no-op for blur).
SPATIAL_ANIMATION_PROPS = frozenset({
    "scale", "translateX", "translateY", "translateZ", "rotate", "rotateX", "rotateY",
})


def hoist_layer_sibling_style(children: List[Any], cut_label: str = "") -> int:
    """Hoist misplaced Layer-level `style` into `content.style` (repair, not reject).

    Renderer truth is `layer.content.style` — a `style` sibling of `content`
    on the Layer node is ignored by every frontend reader (layer_box,
    CanvasOverlay, ASTRenderer). Old skill docs taught the sibling shape, so
    agents still emit it: merge sibling keys into content.style (sibling fills
    missing keys; existing content.style wins on conflict), drop the sibling,
    and count repairs so save_visuals can surface an auto_fixed warning.
    Empty-dict and non-dict siblings are removed as stray keys (counted as
    cleanup, not a hoist). Idempotent.
    """
    if not isinstance(children, list):
        return 0
    fixed = 0
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            continue
        sib = layer.get("style")
        if not isinstance(sib, dict) or not sib:
            if "style" in layer:
                layer.pop("style", None)
                fixed += 1
            continue
        content = layer.get("content")
        if not isinstance(content, dict):
            continue
        cur = content.get("style")
        if not isinstance(cur, dict):
            content["style"] = dict(sib)
        else:
            for k, v in sib.items():
                if k not in cur:
                    cur[k] = v
        layer.pop("style", None)
        fixed += 1
        logger.warning(
            f"hoist_layer_sibling_style: {cut_label or 'cut'} layer#{idx}: "
            f"hoisted Layer-level style into content.style (renderer ignores "
            f"sibling style — author content.style directly)."
        )
    return fixed


def _is_spatial_animation(anim: Any) -> bool:
    import math as _math
    if not isinstance(anim, dict):
        return False
    if anim.get("property") not in SPATIAL_ANIMATION_PROPS:
        return False
    # Renderer skips keyframes missing finite numeric from/to/duration>0 —
    # motion_blur on such a layer is bypassed. Accept numeric strings
    # ("1.0") the way the renderer coerces them; reject bools/NaN/inf.
    for _k in ("from", "to", "duration"):
        _v = anim.get(_k)
        if isinstance(_v, bool) or _v is None:
            return False
    try:
        duration = float(anim.get("duration"))
        float(anim.get("from"))
        float(anim.get("to"))
    except (ValueError, TypeError):
        return False
    if not (_math.isfinite(duration) and _math.isfinite(float(anim.get("from")))
            and _math.isfinite(float(anim.get("to")))):
        return False
    return duration > 0


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
    # Removed enum value: old projects/AI outputs still carrying whip_pan
    # render as slide_left (closest surviving motion).
    if "whip" in t:
        return "slide_left"
    for key in ("slide_left", "slide_right", "slide_up",
                "slide_down", "zoom_in", "zoom_out", "glitch", "crossfade", "dissolve",
                "blur_focus", "flash", "wipe_right", "iris_open", "rise", "flip",
                "cut", "none"):
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


# Marker identifying the fallback layer below. Sections whose cuts hold
# ONLY this placeholder are treated as visually blank (see
# assets._has_meaningful_sub_visuals) so Smart Resume regenerates them
# instead of sticking on a gradient forever.
_HTML_PLACEHOLDER_MARKER = "linear-gradient(135deg,#0f172a"


def is_html_gradient_placeholder(layer: Any) -> bool:
    """True when a layer node is the fallback gradient placeholder."""
    if not isinstance(layer, dict):
        return False
    content = layer.get("content")
    if not isinstance(content, dict) or content.get("type") != "HTML":
        return False
    return _HTML_PLACEHOLDER_MARKER in str(content.get("html_content") or "")


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
    query-less drops. A cut with zero layers — whether it arrived empty from
    the LLM or was emptied by sanitization — gets a single HTML gradient
    placeholder so it still paints deterministically instead of black.

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
    if not clean:
        clean = [_html_gradient_placeholder()]
        logger.warning(
            f"sanitize_media_layers: {cut_label or 'cut'} layer-less "
            f"(arrived empty or emptied by sanitization) — "
            f"inserted HTML gradient placeholder."
        )
    return clean, total_dropped


def sanitize_style_keys(children: List[Any], cut_label: str = "",
                        video_format: str = "landscape") -> int:
    """Repair (never punish) style keys on raw-dict layers.

    Mirrors the LayerContent model validator for pipeline paths that never
    run model validation. Mutates layer content dicts in place: folds a
    translateX/Y(-50%) centering hack into explicit coordinates, removes
    the `transform` key itself (the overlay and Layout tab cannot represent
    it, so the layer would render outside its box) and non-absolute
    `position` values, relocates Text style aliases (fontFamily/fontWeight/
    color) into canonical content fields when empty, and folds the Lottie
    `src` alias into `lottie_url`. LayerBox SOT v1 (stage 2, needs the layer
    index the model validator cannot see): hoists `style.filter` into
    `layer.filters`, drops legacy Shape `content.width/height` when a style
    box exists (box = stage, content fields = glyph), and fills a missing
    box on non-background layers (Center Card; Lower Third for Text).
    Everything else passes through — GUI-less keys are flagged in the
    editor UI, not stripped here. Returns the number of keys stripped,
    folded, moved, hoisted, or filled.
    """
    from backend.agent.schemas import (
        CENTER_CARD_FILL, LOWER_THIRD_FILL, FULLSCREEN_FILL,
        FULLSCREEN_BOX_TYPES,
    )
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
            before_box = dict(content["style"]) if isinstance(content.get("style"), dict) else None
            cleaned, stripped, moves = sanitize_layer_style(
                ctype, content.get("style"), video_format)
            if cleaned is None:
                content.pop("style", None)
            else:
                content["style"] = cleaned
            # LayerBox value rewrites (px→%, anchor resolve, clamp, position
            # coerce, fullscreen force) change values without stripping keys —
            # count them so migrate_cut_geometry() (and telemetry) sees them.
            # Alias moves / transform strips are counted by their own
            # branches, so they are excluded from the diff (no double count).
            if before_box is not None and isinstance(cleaned, dict):
                from backend.agent.schemas import TEXT_STYLE_ALIASES as _ALIASES
                # Normalize stripped tokens to key names: "position(non-absolute)"
                # repairs to position:absolute, so "position" must be ignored in
                # the value-rewrite diff (otherwise one repair counts twice).
                ignored = {str(t).split("(")[0].split(":")[0] for t in stripped}
                ignored |= {"transform"} | set(_ALIASES)
                before_flat = {k: str(v) for k, v in before_box.items()
                               if k not in ignored}
                after_flat = {k: str(v) for k, v in cleaned.items()
                              if k not in ignored}
                if before_flat != after_flat:
                    fixed += 1
                    logger.warning(
                        f"sanitize_style_keys: {cut_label or 'cut'} layer#{idx} "
                        f"({ctype}): normalized LayerBox "
                        f"{sorted(set(after_flat) ^ set(before_flat) | {k for k in after_flat if after_flat.get(k) != before_flat.get(k)})}."
                    )
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
        # LayerBox: hoist style.filter (second filter control) into
        # layer.filters so the Filters tab stays the single filter authority.
        style = content.get("style")
        if isinstance(style, dict) and "filter" in style:
            raw = style.pop("filter", None)
            hoisted: List[str] = []
            if isinstance(raw, str) and raw.strip():
                hoisted = [raw.strip()]
            elif isinstance(raw, list):
                hoisted = [str(x).strip() for x in raw if str(x).strip()]
            if hoisted:
                existing = layer.get("filters")
                if not isinstance(existing, list):
                    existing = []
                    layer["filters"] = existing
                for token in hoisted:
                    if token not in existing:
                        existing.append(token)
                fixed += len(hoisted)
                logger.warning(
                    f"sanitize_style_keys: {cut_label or 'cut'} layer#{idx} "
                    f"({ctype}): hoisted style.filter into layer.filters {hoisted}."
                )
            else:
                fixed += 1
            if not style:
                content.pop("style", None)
                style = None
        # LayerBox: Shape box = stage. Legacy numeric content.width/height
        # (fixed-px Rect) would ignore the stage — drop it when a box exists.
        if ctype == "Shape" and isinstance(style, dict):
            if any(k in style for k in ("left", "top", "right", "bottom", "width", "height")):
                dropped = False
                for legacy in ("width", "height"):
                    if content.pop(legacy, None) is not None:
                        dropped = True
                if dropped:
                    fixed += 1
                    logger.warning(
                        f"sanitize_style_keys: {cut_label or 'cut'} layer#{idx} "
                        f"(Shape): dropped legacy content width/height — style box is the stage."
                    )
        # LayerBox: fill a missing box on non-background layers so AI cuts
        # never depend on the fullscreen fallback for foreground content.
        # Background children[0] with no box = fullscreen (valid, no fill),
        # even for single-layer cuts.
        # Map/Particles are always fullscreen.
        if ctype in FULLSCREEN_BOX_TYPES:
            if not isinstance(content.get("style"), dict):
                content["style"] = dict(FULLSCREEN_FILL)
                fixed += 1
        elif idx > 0:
            cur = content.get("style")
            has_box = isinstance(cur, dict) and any(
                k in cur for k in ("left", "top", "right", "bottom", "width", "height")
            )
            if not has_box:
                fill = dict(LOWER_THIRD_FILL) if ctype == "Text" else dict(CENTER_CARD_FILL)
                if isinstance(cur, dict):
                    fill.update({k: v for k, v in cur.items() if k not in fill})
                    content["style"] = fill
                else:
                    content["style"] = fill
                fixed += 1
                logger.warning(
                    f"sanitize_style_keys: {cut_label or 'cut'} layer#{idx} "
                    f"({ctype}): filled missing LayerBox with "
                    f"{'lower-third' if ctype == 'Text' else 'center-card'} default."
                )
        if ctype == "Lottie" and "src" in content:
            src = content.pop("src")
            if src not in (None, "") and content.get("lottie_url") in (None, ""):
                content["lottie_url"] = src
                fixed += 1
    return fixed


_VALID_MASK_SHAPES = frozenset({"none", "circle", "ellipse", "inset", "polygon"})
_VALID_MASK_REVEALS = frozenset({
    "none", "circle_iris", "wipe_right", "wipe_down",
    "split_vertical", "wipe_diagonal",
})
_VALID_REVEAL_EASINGS = frozenset(
    {"linear", "ease-in", "ease-out", "ease-in-out", "bounce"})
_VALID_POLYGON_PRESETS = frozenset({
    "hexagon", "diamond", "triangle", "star",
    "slant_left", "slant_right", "custom",
})


def sanitize_layer_masks(children: List[Any], cut_label: str = "") -> int:
    """Repair (never punish) mask configs on raw-dict layers.

    Mirrors the ASTMaskConfig contract for pipeline paths that never run
    model validation (raw dicts bypass pydantic via the Union fallback).
    Mutates layer dicts in place:
    - non-dict or empty masks, and masks with neither shape nor reveal,
      are dropped (no clip either way — the key only bloats LLM JSON);
    - unknown shape/reveal/polygon_preset/easing strings are dropped to the
      documented default path (shape/reveal → key dropped; preset → dropped
      so the hexagon default applies; easing incl. legacy 'spring' →
      'ease-out', since overshoot past fully-revealed is invisible);
    - non-positive reveal_duration and negative reveal_delay are dropped
      (the renderer defaults apply);
    - blank `points` are dropped; a `custom` preset without points degrades
      to no clip client-side with a console warning (never a substituted
      hexagon).
    Returns the number of keys repaired/dropped. Idempotent.
    """
    if not isinstance(children, list):
        return 0
    fixed = 0
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict) or "mask" not in layer:
            continue
        mask = layer.get("mask")
        if not isinstance(mask, dict) or not mask:
            layer.pop("mask", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped empty/non-dict mask."
            )
            continue
        shape = mask.get("shape")
        reveal = mask.get("reveal")
        shape_on = isinstance(shape, str) and shape not in (None, "", "none")
        reveal_on = isinstance(reveal, str) and reveal not in (None, "", "none")
        if not shape_on and not reveal_on:
            layer.pop("mask", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped no-op mask (neither shape nor reveal)."
            )
            continue
        if shape_on and shape not in _VALID_MASK_SHAPES:
            mask.pop("shape", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped unknown mask shape {shape!r}."
            )
        if reveal_on and reveal not in _VALID_MASK_REVEALS:
            mask.pop("reveal", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped unknown mask reveal {reveal!r}."
            )
        easing = mask.get("reveal_easing")
        if easing is not None and easing not in _VALID_REVEAL_EASINGS:
            mask["reveal_easing"] = "ease-out"
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"coerced reveal_easing {easing!r} → 'ease-out'."
            )
        dur = mask.get("reveal_duration")
        if dur is not None and not (isinstance(dur, (int, float)) and not isinstance(dur, bool) and dur > 0):
            mask.pop("reveal_duration", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped invalid reveal_duration {dur!r} (renderer default 0.8s applies)."
            )
        delay = mask.get("reveal_delay")
        if delay is not None and not (isinstance(delay, (int, float)) and not isinstance(delay, bool) and delay >= 0):
            mask.pop("reveal_delay", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped invalid reveal_delay {delay!r} (renderer default 0s applies)."
            )
        preset = mask.get("polygon_preset")
        if preset is not None and preset not in _VALID_POLYGON_PRESETS:
            mask.pop("polygon_preset", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped unknown polygon_preset {preset!r} (hexagon default applies)."
            )
        points = mask.get("points")
        if points is not None and not (isinstance(points, str) and points.strip()):
            mask.pop("points", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"dropped blank polygon points (custom preset without points renders unmasked)."
            )
        # Re-check: repairs above may have emptied the mask entirely.
        shape = mask.get("shape")
        reveal = mask.get("reveal")
        if not ((isinstance(shape, str) and shape not in ("", "none"))
                or (isinstance(reveal, str) and reveal not in ("", "none"))):
            layer.pop("mask", None)
            fixed += 1
            logger.warning(
                f"sanitize_layer_masks: {cut_label or 'cut'} layer#{idx}: "
                f"mask emptied by repairs — dropped the key."
            )
    return fixed


def migrate_cut_geometry(sub_visuals: Any, video_format: str = "landscape",
                         cut_label_prefix: str = "migrate") -> int:
    """Opt-in LayerBox SOT v1 migration for stored projects.

    Runs geometry-only repair (query-less media drops + layer-less cuts get
    the gradient placeholder + style normalize + filter hoist + Shape legacy
    drop + missing-box fill + fullscreen force) on every cut WITHOUT
    touching durations, transitions, or stacking — unlike
    validate_sub_visuals, which renormalizes durations to a target.
    Mutates in place. Returns total layers/keys repaired. Idempotent: a
    second run repairs nothing.
    """
    if isinstance(sub_visuals, dict):
        if isinstance(sub_visuals.get("sub_visuals"), list):
            cuts = sub_visuals["sub_visuals"]
        else:
            cuts = [sub_visuals]
    elif isinstance(sub_visuals, list):
        cuts = sub_visuals
    else:
        return 0
    total = 0
    for cut_idx, sv in enumerate(cuts):
        if not isinstance(sv, dict):
            continue
        comp = sv.get("composition")
        if not isinstance(comp, dict) or not isinstance(comp.get("children"), list):
            continue
        label = f"{cut_label_prefix} cut#{cut_idx}"
        before = len(comp["children"])
        clean, dropped = sanitize_media_layers(comp["children"], cut_label=label)
        comp["children"] = clean
        total += dropped
        if len(clean) > before:
            total += 1  # gradient placeholder inserted into a layer-less cut
        total += hoist_layer_sibling_style(comp["children"], cut_label=label)
        total += sanitize_style_keys(comp["children"], cut_label=label,
                                     video_format=video_format)
        total += sanitize_layer_masks(comp["children"], cut_label=label)
    return total


# ── Phase 0: single schema SOT ──────────────────────────────────────
# Canonical cut shape is composition.children Layer nodes ONLY.
# Legacy `layers[]/layout/props` shape (emitted by old sample_cut templates)
# must fail fast with SCHEMA_MISMATCH instead of rendering black via the
# empty-children fallback. One canonical builder serves MCP + internal LLM.

CANONICAL_CUT_HINT = (
    "composition:{type:Sequence, children:["
    "{type:Layer, content:{type, query/source/text/... , style:{left/top/width/height % strings}}, "
    "animations:[{property, from, to, duration, delay}], filters:[]}"
    "]}"
)

_KNOWN_CONTENT_TYPES = frozenset({
    "Image", "Video", "Text", "Chart", "Shape", "Map", "HTML",
    "Lottie", "Particles", "Counter", "Background",
})


def build_sample_cut(video_format: str = "landscape") -> Dict[str, Any]:
    """Canonical sample cut — the ONLY shape the renderer accepts.

    Single builder used by MCP get_stage_skills + get_section_timings so the
    two entry points can never disagree again. Geometry is %-strings,
    Text size is style.fontSize px-string. Neutral placeholder content —
    replace query/text per beat; the shape (not the look) is the contract.
    """
    portrait = (video_format or "").strip().lower() == "portrait"
    return {
        "duration": 4.0,
        "transition": "fade",
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {
                        "type": "Background",
                        "background_preset": "gradient_mesh",
                        "colors": ["#0B0F1A", "#1e3a8a"],
                        "style": {
                            "position": "absolute",
                            "width": "100%",
                            "height": "100%",
                        },
                    },
                    "animations": [
                        {"property": "scale", "from": 1.0, "to": 1.06,
                         "duration": 4.0, "delay": 0, "easing": "linear"}
                    ],
                    "filters": [],
                },
                {
                    "type": "Layer",
                    "name": "Subject photo",
                    "content": {
                        "type": "Image",
                        "query": "parliament building new delhi wide",
                        "source": "pexels",
                        "style": {
                            "position": "absolute",
                            "left": "4%", "top": "6%",
                            "width": "92%", "height": "52%",
                            "objectFit": "cover",
                        },
                    },
                    "animations": [
                        {"property": "opacity", "from": 0, "to": 1,
                         "duration": 0.6, "delay": 0, "easing": "ease-out"}
                    ],
                    "mask": {
                        "reveal": "wipe_right",
                        "reveal_duration": 0.6,
                        "reveal_easing": "ease-out",
                    },
                    "filters": [],
                },
                {
                    "type": "Layer",
                    "content": {
                        "type": "Text",
                        "text": "Sample beat callout",
                        "font": "Inter",
                        "weight": "800",
                        "color": "#ffffff",
                        "style": {
                            "position": "absolute",
                            "left": "6%",
                            "top": "62%" if not portrait else "58%",
                            "width": "88%",
                            "fontSize": "56px",
                            "fontWeight": 800,
                            "textAlign": "center",
                            "textShadow": "0 4px 20px rgba(0,0,0,0.8)",
                        },
                    },
                    "animations": [
                        {"property": "translateY", "from": 8, "to": 0,
                          "duration": 0.5, "delay": 0.1, "easing": "spring"},
                        {"property": "opacity", "from": 0, "to": 1,
                          "duration": 0.5, "delay": 0.1, "easing": "ease-out"},
                    ],
                    "filters": [],
                },
                {
                    "type": "Layer",
                    "content": {
                        "type": "Particles",
                        "particle_preset": "dust",
                        "particle_count": 60,
                        "style": {
                            "position": "absolute",
                            "width": "100%",
                            "height": "100%",
                        },
                    },
                    "animations": [],
                    "filters": [],
                },
            ],
        },
        "note": "Shape contract (not the look): Background + Subject + "
                "Kinetic Text. Replace query/text per beat. For production "
                "takes, choreograph a LIVING canvas — full-duration drift, "
                "word-synced reveals, exit/stagger, no frozen tail "
                "(see declarative-ast §6.5 single-take reference).",
    }


def detect_legacy_cut_shape(cut: Any) -> Dict[str, Any] | None:
    """Return legacy-shape evidence for one cut, else None.

    Signals: non-empty top-level `layers[]`, any legacy child with
    `layout`/`props`, a child whose `type` is a content type directly
    (Image/Text/...) instead of Layer, `animations[].start` (expected
    `delay`), or content-level legacy keys (`preset` without
    `particle_preset` on Particles, numeric `style.fontSize` on Text).
    A stale empty `layers` key on an otherwise canonical cut is ignored.
    """
    if not isinstance(cut, dict):
        return None
    signals: List[str] = []
    raw_layers = cut.get("layers")
    has_legacy_layers = isinstance(raw_layers, list) and len(raw_layers) > 0
    if has_legacy_layers:
        signals.append("cut.layers[] (expected cut.composition.children[])")
    comp = cut.get("composition")
    comp_children: List[Any] = []
    if isinstance(comp, dict) and isinstance(comp.get("children"), list):
        comp_children = comp["children"]
    if has_legacy_layers and len(comp_children) > 0:
        signals.append(
            "cut has BOTH layers[] and composition.children[] (ambiguous — "
            "keep one shape; auto-repair concatenates)")
    candidates: List[Any] = list(raw_layers) if has_legacy_layers else comp_children
    prefix = "layers" if has_legacy_layers else "children"
    for idx, layer in enumerate(candidates):
        if not isinstance(layer, dict):
            signals.append(f"{prefix}[{idx}]: non-dict child")
            continue
        if "layout" in layer:
            signals.append(f"{prefix}[{idx}].layout (expected content.style %-strings)")
        if "props" in layer:
            signals.append(f"{prefix}[{idx}].props (expected content.*)")
        ltype = layer.get("type")
        if ltype in _KNOWN_CONTENT_TYPES and ltype != "Layer":
            signals.append(
                f"{prefix}[{idx}].type={ltype!r} at layer level "
                f"(expected type=Layer + content.type={ltype!r})")
        if isinstance(layer.get("animations"), list):
            for a in layer["animations"]:
                if isinstance(a, dict) and "start" in a and "delay" not in a:
                    signals.append(
                        f"{prefix}[{idx}].animations[].start (expected delay)")
                    break
        content = layer.get("content")
        if isinstance(content, dict):
            if (content.get("type") == "Particles"
                    and "preset" in content
                    and "particle_preset" not in content):
                signals.append(
                    f"{prefix}[{idx}].content.preset (expected particle_preset)")
            if content.get("type") == "Text":
                style = content.get("style")
                if isinstance(style, dict) and "fontSize" in style:
                    fs = style["fontSize"]
                    if isinstance(fs, (int, float)) and not isinstance(fs, bool):
                        signals.append(
                            f"{prefix}[{idx}].content.style.fontSize numeric "
                            f"(expected px string e.g. \"56px\")")
    if not signals:
        return None
    return {"signals": signals[:8], "hint": CANONICAL_CUT_HINT}


def _coerce_filters(value: Any) -> List[str]:
    """Coerce a legacy filters value to a list without exploding strings."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, str) and item.strip():
                out.append(item)
            elif item not in (None, ""):
                out.append(str(item))
        return out
    return [str(value)]


def migrate_legacy_cut_to_composition(cut: Dict[str, Any]) -> Dict[str, Any]:
    """One-way legacy `layers[]` → canonical `composition.children[]`.

    Best-effort for old projects / old agent output: layout{x,y,w,h} numbers
    → style % strings, props → content fields, preset → particle_preset,
    start → delay, scalar filters → [filters]. Only props.* plus an explicit
    content-key allowlist are carried into content; other unknown legacy keys
    are dropped (see allowlist below). Hybrid cuts (both layers[] and
    non-empty composition.children[]) concatenate existing children first,
    then migrated ones, so nothing is silently lost.
    """
    import copy as _copy
    migrated = _copy.deepcopy(cut) if isinstance(cut, dict) else {}
    raw_layers = migrated.pop("layers", [])
    if not isinstance(raw_layers, list):
        raw_layers = []
    children: List[Dict[str, Any]] = []
    for legacy in raw_layers:
        if not isinstance(legacy, dict):
            continue
        ctype = str(legacy.get("type") or "HTML")
        content: Dict[str, Any] = {"type": ctype}
        # props.* → content.*
        props = legacy.get("props")
        if isinstance(props, dict):
            if "color" in props and ctype == "Background":
                content["background_preset"] = "gradient_mesh"
                content["colors"] = [str(props["color"])]
            for k, v in props.items():
                if k not in content and k != "color":
                    content[k] = v
        # Direct content keys passthrough.
        for k in ("query", "source", "text", "html_content", "font",
                  "weight", "color", "particle_preset", "background_preset",
                  "colors", "chart_type", "data", "shape_type", "icon_name",
                  "lottie_url", "map_style", "locations", "objectFit",
                  "image_type", "volume", "loop"):
            if k in legacy and k not in content:
                content[k] = legacy[k]
        # preset → particle_preset (legacy Particles shape).
        if ctype == "Particles" and "preset" in legacy:
            content.setdefault("particle_preset", str(legacy["preset"]))
        # layout{x,y,w,h} → style % strings.
        style: Dict[str, Any] = {}
        layout = legacy.get("layout")
        if isinstance(layout, dict):
            for lk, sk in (("x", "left"), ("y", "top"),
                           ("w", "width"), ("h", "height")):
                if lk in layout:
                    try:
                        style[sk] = f"{round(float(layout[lk]), 2):g}%"
                    except (TypeError, ValueError):
                        pass
        raw_style = legacy.get("style")
        if isinstance(raw_style, dict):
            style.update(raw_style)
        # Legacy template used numeric style.fontSize (e.g. 7 → ~56px);
        # canonical shape needs a px string.
        _fs = style.get("fontSize")
        if isinstance(_fs, (int, float)) and not isinstance(_fs, bool):
            _px = float(_fs) * 8.0 if float(_fs) <= 20 else float(_fs)
            style["fontSize"] = f"{round(_px):g}px"
        if style:
            style.setdefault("position", "absolute")
            content["style"] = style
        elif ctype in ("Background", "Particles", "Map"):
            content["style"] = {"position": "absolute",
                                "width": "100%", "height": "100%"}
        # animations: start → delay.
        anims = []
        for a in (legacy.get("animations") or []):
            if not isinstance(a, dict):
                continue
            na = dict(a)
            if "start" in na and "delay" not in na:
                try:
                    na["delay"] = float(na.pop("start"))
                except (TypeError, ValueError):
                    na.pop("start", None)
                    na["delay"] = 0
            na.setdefault("delay", 0)
            na.setdefault("easing", "ease-out")
            anims.append(na)
        children.append({"type": "Layer", "content": content,
                         "animations": anims,
                         "filters": _coerce_filters(legacy.get("filters"))})
    comp = migrated.get("composition")
    if not isinstance(comp, dict):
        migrated["composition"] = {"type": "Sequence", "children": children}
    else:
        existing = comp.get("children")
        if not isinstance(existing, list) or not existing:
            comp["type"] = "Sequence"
            comp["children"] = children
        elif children:
            logger.warning(
                "migrate_legacy_cut_to_composition: hybrid cut has both "
                "composition.children[] (%d) and layers[] (%d) — "
                "concatenating (existing first).",
                len(existing), len(children))
            comp["type"] = "Sequence"
            comp["children"] = list(existing) + children
    return migrated


def validate_sub_visuals(sub_visuals: List[Dict[str, Any]], target_duration: float, tolerance: float = 0.1,
                         video_format: str = "landscape") -> Tuple[bool, List[Dict[str, Any]], str]:
    """
    Validates a list of AST sub-visuals, ensuring their durations sum up to the
    target_duration, and normalizes transitions onto valid enums.

    video_format selects the LayerBox px→% reference grid
    (landscape 1920x1080, portrait 1080x1920, square 1080x1080).

    Returns: (is_valid, normalized_sub_visuals, error_message)
    """
    if not isinstance(sub_visuals, list):
        return False, _dummy_visual(target_duration), "sub_visuals must be a list."

    if not sub_visuals:
        return False, _dummy_visual(target_duration), "Empty sub_visuals array provided."

    normalized = []
    total_duration = 0.0

    # Validation pass (source-indexed so reported cut# matches input order
    # even when earlier entries are skipped as non-dict).
    for src_idx, v in enumerate(sub_visuals):
        if not isinstance(v, dict):
            continue

        # Phase 0 fail-fast: legacy layers/layout shape is never silently
        # accepted (it used to fall through to empty children → black render
        # with ok:true). Reject with SCHEMA_MISMATCH so the agent fixes the
        # shape in one turn instead of rebuilding whole sections.
        _legacy = detect_legacy_cut_shape(v)
        if _legacy is not None:
            return False, _dummy_visual(target_duration), (
                f"SCHEMA_MISMATCH cut#{src_idx}: legacy layers/layout shape. "
                f"Found: {'; '.join(_legacy['signals'])}. "
                f"Use {CANONICAL_CUT_HINT}. "
                f"Fix: re-emit this cut as composition.children Layer nodes."
            )

        # Order-based stacking only: reject any ordering field outright.
        # No migration — old projects are unsupported.
        try:
            _comp = v.get("composition") if isinstance(v, dict) else None
            _kids = _comp.get("children") if isinstance(_comp, dict) else None
            if isinstance(_kids, list) and any(isinstance(l, dict) and ("z_index" in l or "zIndex" in l) for l in _kids):
                return False, _dummy_visual(target_duration), (
                    f"cut#{src_idx}: invalid layer field 'z_index'/'zIndex' — "
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
            "exit_transition": normalize_transition(v.get("exit_transition") or "none"),
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
                for _stray in ("duration", "transition", "exit_transition", "composition", "emphasis", "subtitle_position", "visual_path", "visual_url"):
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
                hoist_layer_sibling_style(
                    comp["children"], cut_label=f"cut#{len(normalized)}")
                sanitize_style_keys(
                    comp["children"], cut_label=f"cut#{len(normalized)}",
                    video_format=video_format,
                )
                sanitize_layer_masks(
                    comp["children"], cut_label=f"cut#{len(normalized)}")
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


