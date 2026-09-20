"""Strict media validation: query-less Image/Video layers must fail validation
and be sanitized before they can reach the renderer."""
import hashlib
import json
import pytest
from pydantic import ValidationError

from backend.agent.schemas import LayerContent, VisualsArrayResponse
from backend.agent.validators import validate_sub_visuals, sanitize_media_layers


def _media_layer(ctype="Image", query="city skyline"):
    layer = {"type": "Layer",
             "content": {"type": ctype, "query": query, "source": "pexels"},
             "animations": [], "filters": []}
    if query is None:
        del layer["content"]["query"]
    return layer


def _cut(*layers, duration=5.0):
    return {"composition": {"type": "Sequence", "children": list(layers)},
            "duration": duration}


# ── LayerContent strictness ────────────────────────────────────────────

def test_image_without_query_fails():
    with pytest.raises(ValidationError):
        LayerContent.model_validate({"type": "Image", "source": "pexels"})


def test_image_with_blank_query_fails():
    with pytest.raises(ValidationError):
        LayerContent.model_validate({"type": "Image", "query": "   "})


def test_video_without_query_fails():
    with pytest.raises(ValidationError):
        LayerContent.model_validate({"type": "Video"})


def test_image_with_query_passes_and_strips():
    c = LayerContent.model_validate({"type": "Image", "query": "  city skyline  "})
    assert c.query == "city skyline"


def test_text_without_query_passes():
    c = LayerContent.model_validate({"type": "Text", "text": "hello"})
    assert c.query is None


def test_counter_layer_content():
    c = LayerContent.model_validate({
        "type": "Counter",
        "value": 1500,
        "prefix": "$",
        "suffix": "M+",
        "format": "compact",
        "decimals": 1,
    })
    assert c.type == "Counter"
    assert c.value == 1500
    assert c.prefix == "$"
    assert c.format == "compact"


def test_background_layer_content():
    b = LayerContent.model_validate({
        "type": "Background",
        "background_preset": "grid_flow",
        "colors": ["#000", "#fff"],
        "speed": 1.5,
    })
    assert b.type == "Background"
    assert b.background_preset == "grid_flow"
    assert b.speed == 1.5


def test_counter_format_normalization_and_defaults():
    # 'full' format is normalized to canonical 'standard'
    c1 = LayerContent.model_validate({
        "type": "Counter",
        "value": 1400000,
        "format": "full",
        "font_size": "96px",
    })
    assert c1.format == "standard"
    assert c1.start_value == 0.0
    assert c1.font_size == 96.0

    # Missing value defaults to 100.0, negative decimals clamped to 0, non-positive duration defaulted to 2.0, non-positive font_size defaulted to 72.0
    c2 = LayerContent.model_validate({
        "type": "Counter",
        "decimals": -3,
        "duration": -1.0,
        "font_size": -20,
    })
    assert c2.value == 100.0
    assert c2.decimals == 0
    assert c2.duration == 2.0
    assert c2.font_size == 72.0

    # fontSize camelCase alias accepted
    c3 = LayerContent.model_validate({
        "type": "Counter",
        "fontSize": 84,
    })
    assert c3.font_size == 84.0

    # Style extras allow fontSize and textAlign on Counter without stripping
    from backend.agent.schemas import sanitize_layer_style
    cleaned, stripped, moves = sanitize_layer_style("Counter", {
        "fontSize": "110px",
        "textAlign": "center",
        "width": "60%",
        "height": "30%",
        "left": "20%",
        "top": "35%",
    })
    assert "fontSize" in cleaned
    assert "textAlign" in cleaned
    assert "fontSize" not in stripped


def test_background_sanitization_and_aliases():
    # Comma-separated string colors are parsed into a list
    b1 = LayerContent.model_validate({
        "type": "Background",
        "colors": "#0a0a0f, #1a1a2e, #4f46e5",
        "speed": -0.5,
        "background_preset": "grid",
    })
    assert b1.colors == ["#0a0a0f", "#1a1a2e", "#4f46e5"]
    assert b1.speed == 1.0
    assert b1.background_preset == "grid_flow"

    # Presets with aliases and case/hyphen normalization
    aliases = {
        "mesh": "gradient_mesh",
        "gradient": "gradient_mesh",
        "cyber-grid": "grid_flow",
        "wave": "waves",
        "matrix": "dots",
        "cad": "blueprint",
        "spotlight": "vignette_loop",
        "paper": "paper_grain",
    }
    for alias, expected in aliases.items():
        b = LayerContent.model_validate({
            "type": "Background",
            "background_preset": alias,
        })
        assert b.background_preset == expected, f"Expected {alias} -> {expected}, got {b.background_preset}"

    # Missing preset defaults to gradient_mesh
    b_default = LayerContent.model_validate({"type": "Background"})
    assert b_default.background_preset == "gradient_mesh"



# ── Response-level gate (Union[Dict] bypass proof) ─────────────────────

def test_response_rejects_raw_dict_queryless_media():
    # Raw dicts bypass LayerContent via the Union[..., Dict] fallback —
    # the response validator must still catch them.
    bad = {"sub_visuals": [
        _cut(_media_layer("Image", None), _media_layer("Video", "ocean waves")),
        _cut({"type": "Layer",
              "content": {"type": "Text", "text": "hi"}}),
    ]}
    with pytest.raises(ValidationError) as exc:
        VisualsArrayResponse.model_validate(bad)
    assert "cut#0" in str(exc.value) and "Image" in str(exc.value)


def test_response_accepts_valid_media():
    ok = {"sub_visuals": [
        _cut(_media_layer("Image", "city"), _media_layer("Video", "waves")),
    ]}
    r = VisualsArrayResponse.model_validate(ok)
    assert len(r.sub_visuals) == 1


# ── Pipeline sanitizer ─────────────────────────────────────────────────

def test_sanitize_drops_queryless_media_keeps_rest():
    kids = [_media_layer("Image", None), _media_layer("Video", "waves"),
            {"type": "Layer", "content": {"type": "Text", "text": "hi"}}]
    clean, dropped = sanitize_media_layers(kids, cut_label="cut#0")
    assert dropped == 1
    assert [c["content"]["type"] for c in clean] == ["Video", "Text"]


def test_sanitize_empty_cut_gets_html_placeholder():
    clean, dropped = sanitize_media_layers([_media_layer("Video", None)], cut_label="cut#0")
    assert dropped == 1
    assert len(clean) == 1
    assert clean[0]["content"]["type"] == "HTML"
    assert "linear-gradient" in clean[0]["content"]["html_content"]


def test_validate_sub_visuals_repairs_without_new_llm_call():
    svs = [_cut(_media_layer("Image", None), duration=5.0),
           _cut(_media_layer("Image", "city"), duration=5.0)]
    is_valid, normalized, err = validate_sub_visuals(svs, 10.0)
    assert err == ""
    # First cut: query-less media dropped, HTML placeholder inserted.
    kids0 = normalized[0]["composition"]["children"]
    assert all(not (c.get("content", {}).get("type") in ("Image", "Video")
                    and not (c.get("content", {}).get("query") or "").strip())
               for c in kids0)
    assert len(kids0) == 1 and kids0[0]["content"]["type"] == "HTML"
    # Second cut untouched; durations still sum to target.
    assert normalized[1]["composition"]["children"][0]["content"]["query"] == "city"
    assert abs(sum(v["duration"] for v in normalized) - 10.0) < 0.01


# ── is_visuals_stale un-sticks blank defaults ──────────────────────────

def _write_design(tmp_path):
    design = {"theme_name": "t", "color_palette": {}, "typography": {}, "css_guidelines": "x"}
    (tmp_path / "design.json").write_text(json.dumps(design), encoding="utf-8")
    return hashlib.md5(json.dumps(design, sort_keys=True).encode()).hexdigest()[:12]


def test_blank_default_visuals_are_stale(tmp_path):
    from backend.pipeline.assets import is_visuals_stale
    blank = {"composition": {"type": "Sequence", "children": []}, "duration": 5.0}
    script = {"introduction": {"hook": "hi", "sub_visuals": [blank]},
              "scenes": [{"title": "s", "narration": "n", "sub_visuals": [blank]}],
              "conclusion": {"summary": "s", "cta": "c", "sub_visuals": [blank]}}
    (tmp_path / "script.json").write_text(json.dumps(script), encoding="utf-8")
    assert is_visuals_stale({"assets_manifest_path": ""}, tmp_path) is True


def test_meaningful_matching_visuals_stay_fresh(tmp_path):
    import copy
    from backend.pipeline.assets import is_visuals_stale
    design_hash = _write_design(tmp_path)
    asset = tmp_path / "a.jpg"
    asset.write_bytes(b"x")

    def sv(q, d):
        return {"composition": {"type": "Sequence", "children": [
            {"type": "Layer", "content": {"type": "Image", "query": q,
                                          "local_path": str(asset)}}]},
                "duration": d}

    def h(s):
        return hashlib.md5(s.encode()).hexdigest()[:12]

    script = {"introduction": {"hook": "hi", "sub_visuals": [sv("intro img", 4.0)]},
              "scenes": [{"title": "s", "narration": "narr",
                          "sub_visuals": [sv("city", 5.0)]}],
              "conclusion": {"summary": "s", "cta": "c", "sub_visuals": [sv("out", 3.0)]}}
    (tmp_path / "script.json").write_text(json.dumps(script), encoding="utf-8")
    manifest = [
        {"section_type": "introduction", "text": "hi", "duration": 4.0,
         "sub_visuals": copy.deepcopy(script["introduction"]["sub_visuals"]),
         "_narr_hash": h("hi"), "_design_hash": design_hash},
        {"section_type": "scene", "text": "narr", "duration": 5.0,
         "sub_visuals": copy.deepcopy(script["scenes"][0]["sub_visuals"]),
         "_narr_hash": h("narr"), "_design_hash": design_hash},
        {"section_type": "conclusion", "text": "s c", "duration": 3.0,
         "sub_visuals": copy.deepcopy(script["conclusion"]["sub_visuals"]),
         "_narr_hash": h("s c"), "_design_hash": design_hash},
    ]
    (tmp_path / "voiceover").mkdir(exist_ok=True)
    (tmp_path / "voiceover" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    proj = {"assets_manifest_path": str(tmp_path / "voiceover" / "manifest.json")}
    assert is_visuals_stale(proj, tmp_path) is False


# ── Hallucinated sources normalization & rewrite preview tests ────────

def test_normalize_hallucinated_sources_hoists_query_and_strips_urls():
    from backend.agent.validators import normalize_hallucinated_sources
    children = [
        {
            "type": "Layer",
            "content": {
                "type": "Image",
                "sources": [{"query": "golden gate bridge", "url": "https://example.com/gate.jpg", "source": "PEXELS"}],
                "url": "https://example.com/gate.jpg",
                "asset_url": "https://example.com/gate.jpg",
                "local_path": "/assets/asset_001.jpg",  # copied from prompt, not a preview
            }
        }
    ]
    repaired = normalize_hallucinated_sources(children)
    assert repaired == 1
    content = children[0]["content"]
    assert content["query"] == "golden gate bridge"
    assert content["source"] == "pexels"
    assert "sources" not in content
    assert "url" not in content
    assert "asset_url" not in content
    assert "local_path" not in content


def test_normalize_sub_visuals_sources_handles_shapes_and_cleans_root():
    from backend.agent.validators import normalize_sub_visuals_sources
    # Test wrapper dict shape
    wrapped = {
        "sub_visuals": [
            {
                "visual_url": "https://old-link.com",
                "visual_path": "/assets/asset_old.mp4",
                "composition": {
                    "type": "Sequence",
                    "children": [
                        {
                            "type": "Layer",
                            "content": {
                                "type": "Video",
                                "sources": [{"query": "timelapse traffic", "url": "https://vid.com"}]
                            }
                        }
                    ]
                }
            }
        ]
    }
    repaired = normalize_sub_visuals_sources(wrapped)
    assert repaired == 1
    cut = wrapped["sub_visuals"][0]
    assert "visual_url" not in cut
    assert "visual_path" not in cut
    content = cut["composition"]["children"][0]["content"]
    assert content["query"] == "timelapse traffic"
    assert "sources" not in content


def test_layer_content_hoists_sources_and_rejects_queryless():
    from backend.agent.schemas import LayerContent, VisualsArrayResponse
    import pytest

    # Queryless Image raises ValueError
    with pytest.raises(ValueError):
        LayerContent.model_validate({"type": "Image"})

    # Sources with query hoists query and passes
    c = LayerContent.model_validate({
        "type": "Image",
        "sources": [{"query": "neon city", "source": "pexels"}]
    })
    assert c.query == "neon city"
    assert c.source == "pexels"

    # VisualsArrayResponse accepts cuts with sources-only queries
    res = VisualsArrayResponse.model_validate({
        "sub_visuals": [{
            "duration": 3.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {
                            "type": "Image",
                            "sources": [{"query": "neon city"}]
                        }
                    }
                ]
            }
        }]
    })
    assert len(res.sub_visuals) == 1


def test_materialize_rewrite_previews_downloads_and_sets_preview_path(tmp_path, monkeypatch):
    from pathlib import Path
    from backend.pipeline.assets import materialize_rewrite_previews
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.pipeline.assets.get_setting", lambda k: "dummy_key")

    proj_id = "test_proj_preview"
    (tmp_path / proj_id / "assets" / "previews").mkdir(parents=True, exist_ok=True)

    # Mock _fetch_ast_layer_asset to simulate writing a temporary file
    def mock_fetch(layer, preview_dir, seg_idx, sub_idx, layer_idx, *args, **kwargs):
        content = layer.get("content", {})
        temp_file = preview_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}_{layer_idx:02d}.jpg"
        temp_file.write_text("mock image data", encoding="utf-8")
        content["local_path"] = str(temp_file)
        return layer

    monkeypatch.setattr("backend.pipeline.assets._fetch_ast_layer_asset", mock_fetch)

    cut = {
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {
                        "type": "Image",
                        "query": "ocean sunset"
                    }
                }
            ]
        }
    }

    res = materialize_rewrite_previews(proj_id, cut)
    assert res["downloaded"] == 1
    assert res["failed"] == 0

    lp = cut["composition"]["children"][0]["content"].get("local_path")
    assert lp is not None
    assert Path(lp).exists()
    assert "preview_" in Path(lp).name
    assert Path(lp).name.startswith("preview_")


# ── Order-based stacking (no legacy support) ──────────────────────────

def test_layer_order_is_children_array_order():
    kids = [
        {"type": "Layer", "content": {"type": "HTML", "html_content": "<div/>"}},
        {"type": "Layer", "content": {"type": "Chart"}},
        {"type": "Layer", "content": {"type": "Text", "text": "top"}},
    ]
    clean, dropped = sanitize_media_layers(kids, cut_label="cut#0")
    assert dropped == 0
    assert [c["content"]["type"] for c in clean] == ["HTML", "Chart", "Text"]


def test_validate_rejects_z_index_field():
    from backend.agent.schemas import ASTLayerNode
    with pytest.raises(Exception):
        ASTLayerNode.model_validate(
            {"type": "Layer", "z_index": 10, "content": {"type": "Text", "text": "hi"}}
        )
    with pytest.raises(Exception):
        ASTLayerNode.model_validate(
            {"type": "Layer", "zIndex": 10, "content": {"type": "Text", "text": "hi"}}
        )


def test_validate_sub_visuals_rejects_z_index():
    from backend.agent.validators import validate_sub_visuals
    svs = [{
        "duration": 5.0,
        "composition": {"type": "Sequence", "children": [
            {"type": "Layer", "z_index": 0, "content": {"type": "Image", "query": "city", "source": "pexels"}},
            {"type": "Layer", "z_index": 30, "content": {"type": "Text", "text": "hi"}},
        ]},
    }]
    is_valid, _, err = validate_sub_visuals(svs, 5.0)
    assert is_valid is False
    assert "z_index" in err

    svs_camel = [{
        "duration": 5.0,
        "composition": {"type": "Sequence", "children": [
            {"type": "Layer", "zIndex": 10, "content": {"type": "Text", "text": "hi"}},
        ]},
    }]
    is_valid_c, _, err_c = validate_sub_visuals(svs_camel, 5.0)
    assert is_valid_c is False
    assert "zIndex" in err_c


# ── Style key allowlist (transform et al. must never persist) ──────────

def _styled_layer(ctype, style, **extra):
    content = {"type": ctype, "style": style}
    content.update(extra)
    return {"type": "Layer", "content": content,
            "animations": [], "filters": []}


def test_style_transform_folded_from_text_layer():
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Text", {
        "position": "absolute", "left": "29.25%", "width": "20%",
        "fontSize": "180px", "textAlign": "right",
        "transform": "translateX(-50%)",
    }, text="LIKE A SPINNING COIN")]
    fixed = sanitize_style_keys(kids, cut_label="cut#0")
    # 1 transform strip (+fold into left) + 1 LayerBox value normalization.
    assert fixed == 2
    style = kids[0]["content"]["style"]
    assert "transform" not in style
    # Centering hack folded: 29.25 − 20/2 = 19.25.
    assert style["left"] == "19.25%"
    assert style["fontSize"] == "180px"
    assert style["textAlign"] == "right"


def test_renderable_keys_pass_through_untouched():
    # LayerBox SOT v1: opacity/display/mixBlendMode still pass through and
    # are flagged in the UI — but style.filter is hoisted into layer.filters
    # so the Filters tab stays the single filter authority.
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Image", {
        "width": "100%", "opacity": 0.5, "filter": "blur(2px)",
        "display": "flex", "mixBlendMode": "overlay", "objectFit": "cover",
        "boxShadow": "0 0 10px #000",
    }, query="city skyline")]
    fixed = sanitize_style_keys(kids, cut_label="cut#0")
    # 1 position coerce + 1 style.filter hoist.
    assert fixed == 2
    assert kids[0]["content"]["style"] == {
        "width": "100%", "opacity": 0.5,
        "display": "flex", "mixBlendMode": "overlay", "objectFit": "cover",
        "boxShadow": "0 0 10px #000", "position": "absolute",
    }
    assert kids[0]["filters"] == ["blur(2px)"]


def test_text_style_aliases_coerced_to_content():
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Text", {
        "fontFamily": "Montserrat", "fontWeight": "900", "color": "#f8fafc",
        "left": "10%",
    }, text="hi")]
    fixed = sanitize_style_keys(kids, cut_label="cut#0")
    content = kids[0]["content"]
    assert content["font"] == "Montserrat"
    assert content["weight"] == "900"
    assert content["color"] == "#f8fafc"
    # LayerBox SOT: position coerced to absolute alongside the alias moves.
    assert content["style"] == {"left": "10%", "position": "absolute"}
    # 3 alias moves + 1 LayerBox position coerce.
    assert fixed == 4


def test_text_alias_dropped_when_canonical_set():
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Text", {"fontFamily": "Oswald", "left": "10%"},
                            text="hi", font="Montserrat")]
    sanitize_style_keys(kids, cut_label="cut#0")
    content = kids[0]["content"]
    assert content["font"] == "Montserrat"
    assert content["style"] == {"left": "10%", "position": "absolute"}


def test_chart_accent_kept_objectfit_kept_on_text():
    from backend.agent.validators import sanitize_style_keys
    kids = [
        _styled_layer("Chart", {"left": "6%", "color": "#00d4ff", "transform": "scale(1.1)"}),
        _styled_layer("Text", {"left": "10%", "objectFit": "cover"}, text="hi"),
    ]
    sanitize_style_keys(kids, cut_label="cut#0")
    assert kids[0]["content"]["style"] == {"left": "6%", "color": "#00d4ff",
                                           "position": "absolute"}
    assert kids[1]["content"]["style"] == {"left": "10%", "objectFit": "cover",
                                           "position": "absolute"}


def test_non_dict_style_dropped():
    # LayerBox SOT: garbage style is dropped. A single background layer
    # (idx 0) with no box stays fullscreen — no foreground fill.
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Text", "width:100%", text="hi")]
    fixed = sanitize_style_keys(kids, cut_label="cut#0")
    assert fixed == 1
    assert "style" not in kids[0]["content"]


def test_lottie_src_alias_folded():
    from backend.agent.validators import sanitize_style_keys
    kids = [_styled_layer("Lottie", {"left": "10%"})]
    kids[0]["content"]["src"] = "https://example.com/a.json"
    sanitize_style_keys(kids, cut_label="cut#0")
    content = kids[0]["content"]
    assert content["lottie_url"] == "https://example.com/a.json"
    assert "src" not in content


def test_layer_content_model_sanitizes_style():
    c = LayerContent.model_validate({
        "type": "Text", "text": "hi",
        "style": {"left": "10%", "transform": "translateX(-50%)",
                  "fontFamily": "Montserrat"},
    })
    assert "transform" not in (c.style or {})
    assert (c.style or {}).get("left") == "10%"
    assert c.font == "Montserrat"


def test_validate_sub_visuals_cleans_style_end_to_end():
    svs = [_cut(_styled_layer("Text", {
        "left": "29.25%", "width": "20%",
        "transform": "translateX(-50%)",
    }, text="hi"), duration=5.0)]
    is_valid, normalized, err = validate_sub_visuals(svs, 5.0)
    assert err == ""
    style = normalized[0]["composition"]["children"][0]["content"]["style"]
    assert "transform" not in style
    assert style["width"] == "20%"


# ── Centering-hack fold + position rule ─────────────────────────────

def test_centering_translate_folded_into_left():
    from backend.agent.schemas import sanitize_layer_style
    cleaned, stripped, _ = sanitize_layer_style("Text", {
        "position": "absolute", "top": "17.24%", "left": "29.25%",
        "transform": "translateX(-50%)", "fontSize": "180px",
        "textAlign": "right", "width": "54.7%", "height": "22.28%",
    })
    assert cleaned["left"] == "1.9%"
    assert cleaned["width"] == "54.7%"
    assert cleaned["top"] == "17.24%"
    assert "transform" not in cleaned
    assert "transform" in stripped


def test_translate_xy_folds_both_axes():
    from backend.agent.schemas import sanitize_layer_style
    cleaned, stripped, _ = sanitize_layer_style("Image", {
        "left": "30%", "top": "20%", "width": "40%", "height": "30%",
        "transform": "translate(-50%, -50%)",
    })
    assert cleaned["left"] == "10%"
    assert cleaned["top"] == "5%"
    assert "transform" not in cleaned
    assert "transform" in stripped


def test_translate_y_only_folds_top():
    from backend.agent.schemas import sanitize_layer_style
    cleaned, _, _ = sanitize_layer_style("Text", {
        "left": "10%", "top": "30%", "width": "50%", "height": "20%",
        "transform": "translateY(-50%)",
    })
    assert cleaned["top"] == "20%"
    assert cleaned["left"] == "10%"
    assert "transform" not in cleaned


def test_unmatched_transform_stripped_without_fold():
    from backend.agent.schemas import sanitize_layer_style
    for bad in ("translateX(-30%)", "rotate(5deg)", "translateX(-50%) scale(1.1)"):
        cleaned, stripped, _ = sanitize_layer_style("Text", {
            "left": "29.25%", "width": "54.7%", "transform": bad,
        })
        assert cleaned["left"] == "29.25%"
        assert "transform" not in cleaned
        assert "transform" in stripped


def test_mixed_units_never_fold():
    from backend.agent.schemas import sanitize_layer_style
    cleaned, stripped, _ = sanitize_layer_style("Text", {
        "left": "29.25%", "width": "200px", "transform": "translateX(-50%)",
    })
    assert cleaned["left"] == "29.25%"
    assert "transform" in stripped


def test_non_absolute_position_dropped_absolute_kept():
    # LayerBox SOT: non-absolute position is stripped, then the box contract
    # coerces it back to absolute — repair, never punish.
    from backend.agent.schemas import sanitize_layer_style
    cleaned, stripped, _ = sanitize_layer_style("Text", {
        "left": "10%", "position": "relative",
    })
    assert cleaned["position"] == "absolute"
    assert any("position" in s for s in stripped)
    kept, stripped2, _ = sanitize_layer_style("Text", {
        "left": "10%", "position": "absolute",
    })
    assert kept["position"] == "absolute"
    assert stripped2 == []


def test_fold_is_idempotent():
    from backend.agent.schemas import sanitize_layer_style
    style = {"left": "29.25%", "width": "54.7%",
             "transform": "translateX(-50%)"}
    cleaned, _, _ = sanitize_layer_style("Text", style)
    cleaned2, stripped2, moves2 = sanitize_layer_style("Text", cleaned)
    assert cleaned2 == cleaned
    assert stripped2 == [] and moves2 == {}


def test_model_folds_user_reported_style():
    c = LayerContent.model_validate({
        "type": "Text", "text": "LIKE A SPINNING COIN",
        "style": {"position": "absolute", "top": "17.24%", "left": "29.25%",
                  "transform": "translateX(-50%)", "fontSize": "180px",
                  "textAlign": "right", "width": "54.7%", "height": "22.28%"},
    })
    assert c.style["left"] == "1.9%"
    assert c.style["width"] == "54.7%"
    assert "transform" not in c.style


