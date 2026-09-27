"""LayerBox SOT v1: single source of truth for layer geometry.

Covers backend/agent/schemas.py normalize_layer_box + sanitize_layer_style
and backend/agent/validators.py sanitize_style_keys (filter hoist, Shape
legacy drop, missing-box fill, fullscreen force).
"""
from backend.agent.schemas import sanitize_layer_style, normalize_layer_box
from backend.agent.validators import sanitize_style_keys


def _layer(ctype, style=None, extra_content=None, extra_layer=None):
    content = {"type": ctype}
    if style is not None:
        content["style"] = style
    if extra_content:
        content.update(extra_content)
    layer = {"type": "Layer", "content": content,
             "animations": [], "filters": []}
    if extra_layer:
        layer.update(extra_layer)
    return layer


# ── units: px / unitless → % ──────────────────────────────────────────

def test_px_box_converts_to_percent():
    cleaned, _, _ = sanitize_layer_style(
        "Shape", {"position": "absolute", "left": "18%", "top": "42%",
                  "width": "200px", "height": "108px"})
    assert cleaned["width"].endswith("%")
    assert cleaned["height"].endswith("%")
    # px on 1920x1080 grid: 200/1920*100, 108/1080*100
    assert abs(float(cleaned["width"].rstrip("%")) - 200 / 1920 * 100) < 0.01
    assert abs(float(cleaned["height"].rstrip("%")) - 108 / 1080 * 100) < 0.01
    # Tiny px dots clamp to the 2% minimum for Shapes (selectable but compact);
    # other types keep the 5% floor.
    tiny, _, _ = sanitize_layer_style(
        "Shape", {"position": "absolute", "left": "18%", "top": "42%",
                  "width": "16px", "height": "16px"})
    assert tiny["width"] == "2%" and tiny["height"] == "2%"


def test_percent_strings_pass_through_unchanged():
    style = {"position": "absolute", "left": "6%", "top": "16%",
             "width": "42%", "height": "66%"}
    cleaned, _, _ = sanitize_layer_style("Chart", dict(style))
    assert cleaned == style


def test_normalize_is_idempotent():
    style = {"position": "absolute", "left": "18%", "top": "42%",
             "width": "16px", "height": "16px"}
    first, _, _ = sanitize_layer_style("Shape", dict(style))
    second, _, _ = sanitize_layer_style("Shape", dict(first))
    assert first == second


# ── anchors: top/left win ─────────────────────────────────────────────

def test_double_anchors_resolve_to_top_left():
    cleaned, _, _ = sanitize_layer_style(
        "HTML", {"position": "absolute", "left": "10%", "right": "10%",
                 "top": "10%", "bottom": "10%",
                 "width": "80%", "height": "66%"})
    assert "bottom" not in cleaned and "right" not in cleaned
    assert cleaned["top"] == "10%" and cleaned["left"] == "10%"


def test_single_bottom_anchor_preserved_for_text():
    cleaned, _, _ = sanitize_layer_style(
        "Text", {"position": "absolute", "bottom": "18%", "left": "6%",
                 "width": "88%"})
    assert cleaned["bottom"] == "18%"
    assert "top" not in cleaned


def test_position_coerced_to_absolute():
    style = {"left": "6%", "top": "16%", "width": "42%", "height": "66%"}
    cleaned, stripped, _ = sanitize_layer_style("HTML", dict(style))
    assert cleaned["position"] == "absolute"


# ── fullscreen types ──────────────────────────────────────────────────

def test_map_box_forced_fullscreen():
    cleaned, _, _ = sanitize_layer_style(
        "Map", {"position": "absolute", "left": "8%", "top": "10%",
                "width": "50%", "height": "50%"})
    assert cleaned["width"] == "100%" and cleaned["height"] == "100%"
    assert "left" not in cleaned and "top" not in cleaned


def test_particles_box_forced_fullscreen():
    cleaned, _, _ = sanitize_layer_style(
        "Particles", {"position": "absolute", "left": "5%", "top": "5%",
                      "width": "90%", "height": "90%"})
    assert cleaned["width"] == "100%" and cleaned["height"] == "100%"


def test_background_box_forced_fullscreen():
    cleaned, _, _ = sanitize_layer_style(
        "Background", {"position": "absolute", "left": "5%", "top": "5%",
                        "width": "90%", "height": "90%"})
    assert cleaned["width"] == "100%" and cleaned["height"] == "100%"
    assert "left" not in cleaned and "top" not in cleaned


# ── validator stage 2 ─────────────────────────────────────────────────

def test_style_filter_hoisted_to_layer_filters():
    layer = _layer("Image", {"position": "absolute", "left": "6%",
                             "top": "16%", "width": "42%", "height": "66%",
                             "filter": "drop-shadow(0 0 22px rgba(255,0,200,0.75))"})
    n = sanitize_style_keys([layer], cut_label="test")
    assert n >= 1
    assert "filter" not in layer["content"]["style"]
    assert "drop-shadow(0 0 22px rgba(255,0,200,0.75))" in layer["filters"]


def test_shape_legacy_content_size_dropped_when_box_exists():
    layer = _layer("Shape",
                   {"position": "absolute", "left": "10%", "top": "18%",
                    "width": "45%", "height": "62%"},
                   extra_content={"shape_type": "rectangle",
                                  "width": 400, "height": 300})
    sanitize_style_keys([layer], cut_label="test")
    assert "width" not in layer["content"] and "height" not in layer["content"]
    assert layer["content"]["style"]["width"] == "45%"


def test_missing_foreground_box_filled_center_card():
    bg = _layer("Video", {"width": "100%", "height": "100%",
                          "objectFit": "cover"},
                extra_content={"query": "ocean waves", "source": "pexels"})
    fg = _layer("HTML", None,
                extra_content={"html_content": "<div>hi</div>"})
    sanitize_style_keys([bg, fg], cut_label="test")
    assert fg["content"]["style"]["width"] == "70%"
    assert fg["content"]["style"]["left"] == "15%"


def test_missing_foreground_text_filled_lower_third():
    bg = _layer("Video", {"width": "100%", "height": "100%"})
    fg = _layer("Text", None, extra_content={"text": "hello"})
    sanitize_style_keys([bg, fg], cut_label="test")
    assert fg["content"]["style"]["bottom"] == "18%"
    assert fg["content"]["style"]["width"] == "88%"


def test_missing_foreground_counter_filled_center_card():
    bg = _layer("Background", None, extra_content={"background_preset": "gradient_mesh"})
    fg = _layer("Counter", None, extra_content={"value": 500, "prefix": "$"})
    sanitize_style_keys([bg, fg], cut_label="test")
    assert bg["content"]["style"]["width"] == "100%" and bg["content"]["style"]["height"] == "100%"
    assert fg["content"]["style"]["width"] == "70%"
    assert fg["content"]["style"]["left"] == "15%"


def test_background_without_box_left_alone():
    bg = _layer("Video", {"width": "100%", "height": "100%"})
    sanitize_style_keys([bg], cut_label="test")
    # Fullscreen bg keeps its box; LayerBox only coerces position:absolute.
    assert bg["content"]["style"] == {"width": "100%", "height": "100%",
                                      "position": "absolute"}


def test_portrait_px_grid():
    # Portrait canvas is 1080 wide / 1920 tall: 108px wide = 10%.
    cleaned, _, _ = sanitize_layer_style(
        "HTML", {"position": "absolute", "left": "108px", "top": "192px",
                 "width": "540px", "height": "960px"},
        video_format="portrait")
    assert cleaned["left"] == "10%"
    assert cleaned["top"] == "10%"
    assert cleaned["width"] == "50%"
    assert cleaned["height"] == "50%"
    # Same px on landscape grid resolves differently (1920x1080).
    land, _, _ = sanitize_layer_style(
        "HTML", {"position": "absolute", "left": "108px", "top": "192px",
                 "width": "540px", "height": "960px"},
        video_format="landscape")
    assert land != cleaned


def test_migrate_cut_geometry_repairs_without_touching_durations():
    from backend.agent.validators import migrate_cut_geometry
    svs = [
        {"duration": 3.1, "transition": "crossfade",
         "composition": {"type": "Sequence", "children": [
             {"type": "Layer",
              "content": {"type": "Video", "query": "ocean waves",
                          "source": "pexels",
                          "style": {"width": "100%", "height": "100%"}},
              "animations": [], "filters": []},
             {"type": "Layer",
              "content": {"type": "Shape", "shape_type": "circle",
                          "style": {"position": "absolute", "left": "18%",
                                    "top": "42%", "width": "16px",
                                    "height": "16px"}},
              "animations": [], "filters": []},
         ]}},
    ]
    first = migrate_cut_geometry(svs)
    assert first >= 1
    dot_style = svs[0]["composition"]["children"][1]["content"]["style"]
    assert dot_style["width"].endswith("%")
    assert svs[0]["duration"] == 3.1
    assert svs[0]["transition"] == "crossfade"
    # Idempotent: second run repairs nothing.
    assert migrate_cut_geometry(svs) == 0


def test_arrived_empty_cut_gets_placeholder():
    from backend.agent.validators import sanitize_media_layers
    clean, _ = sanitize_media_layers([], cut_label="test")
    assert len(clean) == 1
    assert clean[0]["content"]["type"] == "HTML"
    assert "linear-gradient" in clean[0]["content"]["html_content"]


def test_validate_empty_cut_paints_placeholder_keeps_duration():
    from backend.agent.validators import validate_sub_visuals
    svs = [{"composition": {"type": "Sequence", "children": []},
            "duration": 15.672}]
    ok, normalized, err = validate_sub_visuals(svs, 15.672)
    assert err == ""
    kids = normalized[0]["composition"]["children"]
    assert len(kids) == 1 and kids[0]["content"]["type"] == "HTML"
    assert normalized[0]["duration"] == 15.672


def test_placeholder_only_section_is_not_meaningful():
    from backend.agent.validators import _html_gradient_placeholder
    from backend.pipeline.assets import _has_meaningful_sub_visuals
    blank = [{"composition": {"type": "Sequence", "children": []},
              "duration": 5.0}]
    assert _has_meaningful_sub_visuals(blank) is False
    filled = [{"composition": {"type": "Sequence",
                               "children": [_html_gradient_placeholder()]},
               "duration": 5.0}]
    assert _has_meaningful_sub_visuals(filled) is False
    mixed = filled + [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "hi"}}]},
        "duration": 5.0}]
    assert _has_meaningful_sub_visuals(mixed) is True


def test_clamping_keeps_boxes_on_canvas():
    cleaned, _, _ = sanitize_layer_style(
        "HTML", {"position": "absolute", "left": "6%", "top": "16%",
                 "width": "500%", "height": "2%"})
    assert cleaned["width"] == "100%"
    assert cleaned["height"] == "5%"

# ── anchors: Text keeps bottom (lower-thirds) ──────────────────────────

def test_text_double_vertical_anchor_keeps_bottom():
    cleaned, _, _ = sanitize_layer_style(
        'Text', {'position': 'absolute', 'left': '6%',
                 'top': '60%', 'bottom': '18%', 'width': '88%'})
    assert 'top' not in cleaned and cleaned['bottom'] == '18%'


def test_non_text_double_vertical_anchor_still_keeps_top():
    cleaned, _, _ = sanitize_layer_style(
        'HTML', {'position': 'absolute', 'left': '10%',
                 'top': '10%', 'bottom': '10%',
                 'width': '80%', 'height': '66%'})
    assert 'bottom' not in cleaned and cleaned['top'] == '10%'


def test_text_anchor_rule_is_idempotent():
    style = {'position': 'absolute', 'left': '6%',
             'top': '60%', 'bottom': '18%', 'width': '88%'}
    first, _, _ = sanitize_layer_style('Text', dict(style))
    second, _, _ = sanitize_layer_style('Text', dict(first))
    assert first == second
