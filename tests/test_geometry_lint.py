"""Geometry linter: boxes_px echo, HTML contract, anchor-aware messages.

Covers backend/agent/geometry.py lint_cut / lint_sub_visuals /
lint_html_content — the read-only reports both agents (internal LLM +
MCP) rely on for pixel-perfect placement.
"""
from backend.agent.geometry import (
    lint_cut,
    lint_sub_visuals,
    lint_html_content,
)


def _cut(*layers, **kw):
    children = list(layers)
    cut = {"duration": 3.0,
           "composition": {"type": "Sequence", "children": children}}
    cut.update(kw)
    return cut


def _layer(ctype, style=None, extra_content=None):
    content = {"type": ctype}
    if style is not None:
        content["style"] = style
    if extra_content:
        content.update(extra_content)
    return {"type": "Layer", "content": content,
            "animations": [], "filters": []}


# ── boxes_px echo ────────────────────────────────────────────────────

def test_boxes_carry_pixel_echo_landscape():
    cut = _cut(_layer("Text", {"left": "25%", "top": "10%",
                               "width": "50%", "height": "20%",
                               "fontSize": "56px"},
                      {"text": "hello"}))
    rep = lint_cut(cut, video_format="landscape")
    assert rep["container"] == {"width": 1920.0, "height": 1080.0}
    px = rep["boxes"][0]["box_px"]
    assert px == {"x": 480, "y": 108, "w": 960, "h": 216}


def test_boxes_px_follows_portrait_grid():
    cut = _cut(_layer("Text", {"left": "25%", "top": "10%",
                               "width": "50%", "height": "20%",
                               "fontSize": "56px"},
                      {"text": "hello"}))
    rep = lint_cut(cut, video_format="portrait")
    assert rep["container"] == {"width": 1080.0, "height": 1920.0}
    px = rep["boxes"][0]["box_px"]
    assert px == {"x": 270, "y": 192, "w": 540, "h": 384}


def test_section_report_aggregates_boxes_and_container():
    svs = [_cut(_layer("Text", {"left": "10%", "top": "10%",
                                "width": "40%", "height": "20%",
                                "fontSize": "56px"},
                       {"text": "one"})),
           _cut(_layer("Image", {"left": "55%", "top": "10%",
                                 "width": "40%", "height": "40%"},
                       {"query": "city skyline", "source": "pexels"}))]
    rep = lint_sub_visuals(svs, "landscape")
    assert rep["container"]["width"] == 1920.0
    assert len(rep["boxes"]) == 2
    assert all(b["box_px"] is not None for b in rep["boxes"])
    assert {b["cut_index"] for b in rep["boxes"]} == {0, 1}


# ── linter gaps ──────────────────────────────────────────────────────

def test_forced_fullscreen_positioned_box_warns():
    cut = _cut(_layer("Map", {"left": "10%", "top": "10%",
                              "width": "50%", "height": "50%"}))
    rep = lint_cut(cut)
    assert any("forced fullscreen" in w for w in rep["warnings"])


def test_misplaced_cut_keys_warn():
    cut = _cut(_layer("Text", {"left": "10%", "top": "10%",
                               "width": "40%", "height": "20%",
                               "fontSize": "56px"},
                      {"text": "hi"}),
               composition={"type": "Sequence", "children": [
                   {"type": "Layer",
                    "content": {"type": "Text", "text": "hi",
                                "style": {"left": "10%", "top": "10%",
                                          "width": "40%", "height": "20%",
                                          "fontSize": "56px"}},
                    "animations": [], "filters": []}],
                   "emphasis": [{"at": 1.0, "scale": 1.1,
                                 "duration": 0.5}]})
    rep = lint_cut(cut)
    assert any("emphasis inside composition" in w for w in rep["warnings"])


def test_free_text_100px_note():
    cut = _cut({"type": "Layer",
                "content": {"type": "Text", "text": "headline"},
                "animations": [], "filters": []})
    rep = lint_cut(cut)
    assert any("100px" in w for w in rep["warnings"])


def test_center_math_works_for_right_anchor():
    # right:29% + width:42% → x0 = 29% = exact center → no fix;
    # shift it 5pp off and the fix must still fire via x0.
    cut = _cut(_layer("Text", {"right": "24%", "top": "16%",
                               "width": "42%", "height": "66%",
                               "fontSize": "56px"},
                      {"text": "card"}))
    rep = lint_cut(cut)
    assert any("centered left" in f for f in rep["fixes"])


def test_text_anchor_message_matches_saver():
    cut = _cut(_layer("Text", {"left": "6%", "top": "60%",
                               "bottom": "18%", "width": "88%",
                               "fontSize": "56px"},
                      {"text": "lower third"}))
    rep = lint_cut(cut)
    assert any("keeps bottom" in w for w in rep["warnings"])


def test_fixed_height_complex_script_text_warns():
    cut = _cut(_layer("Text", {"left": "10%", "top": "60%",
                               "width": "80%", "height": "20%",
                               "fontSize": "56px"},
                      {"text": "मजबूत ऊंची दीवार"}))
    rep = lint_cut(cut)
    assert any("matras clip" in w for w in rep["warnings"])


# ── HTML contract ────────────────────────────────────────────────────

def test_html_fixed_and_viewport_units_flagged():
    html = ("<div style='width:1200px;position:fixed'>"
            "<p style='width:100vw;font-size:72px'>hi</p></div>")
    rep = lint_html_content(html, "cut#0 layer#1 (HTML)")
    joined = " ".join(rep["warnings"])
    assert "position:fixed" in joined
    assert "vw" in joined
    assert "fixed-px font-size" in joined


def test_html_remote_media_and_script_flagged():
    html = "<div><script>alert(1)</script><img src='https://x/y.png'></div>"
    rep = lint_html_content(html)
    joined = " ".join(rep["warnings"])
    assert "<script>" in joined
    assert "src=" in joined


def test_html_unscoped_style_and_transform_flagged():
    html = ("<style>.title{color:red}</style>"
            "<div style='width:100%;transform:rotate(-2deg)'>x</div>")
    rep = lint_html_content(html)
    joined = " ".join(rep["warnings"])
    assert "unscoped <style>" in joined
    assert "transform" in joined


def test_html_clean_filler_root_passes():
    html = ("<div style='width:100%;height:100%;box-sizing:border-box;"
            "overflow:hidden'><p style='font-size:clamp(20px,4cqw,44px)'>ok</p></div>")
    rep = lint_html_content(html)
    assert rep["warnings"] == []


def test_html_warnings_surface_in_cut_report():
    cut = _cut(_layer("HTML", {"left": "10%", "top": "10%",
                               "width": "42%", "height": "66%"},
                      {"html_content": "<div style='position:fixed'>x</div>"}))
    rep = lint_cut(cut)
    assert len(rep["html_warnings"]) > 0
    sec = lint_sub_visuals([cut])
    assert len(sec["html_warnings"]) > 0


# ── grid sync: pixel echo must match the save authority ──────────────

def test_px_grid_matches_save_authority():
    from backend.agent import geometry as _g
    from backend.agent import schemas as _s
    for fmt, (w, h) in _g._PX_REF.items():
        ref = _s._PX_REF_BY_FORMAT[fmt]
        assert (w, h) == (ref["x"], ref["y"])


def test_text_double_anchor_resolves_to_bottom_rect():
    from backend.agent.geometry import layer_box
    layer2 = {"type": "Layer",
              "content": {"type": "Text",
                          "style": {"left": "6%", "top": "50%",
                                    "bottom": "18%", "width": "88%",
                                    "height": "22%"}}}
    box2 = layer_box(layer2)
    # Saver keeps bottom for Text: y0 = 100-18-22 = 60 (NOT the stale
    # top-based 50) — the echo must describe the post-save box.
    assert box2["rect"] == (6.0, 60.0, 94.0, 82.0), box2["rect"]


def test_html_fragment_urls_not_flagged():
    from backend.agent.geometry import lint_html_content
    html = ("<div style='width:100%;height:100%'>"
            "<svg><defs><linearGradient id='g'></linearGradient></defs>"
            "<rect fill='url(#g)' width='100' height='100'/></svg></div>")
    rep = lint_html_content(html)
    assert rep["warnings"] == [], rep["warnings"]


def test_viewport_unit_variants_flagged():
    from backend.agent.geometry import lint_html_content
    for css in ("width:100svw", "height:50dvh", "width:90vmax",
                "margin:5lvw", "width:100vw"):
        rep = lint_html_content(f"<div style='{css}'>x</div>")
        assert rep["warnings"], css


def test_overlap_suppressed_when_temporally_staggered_with_exit():
    from backend.agent.geometry import lint_cut
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "exit": 2.0,
                    "content": {"type": "Text", "style": {"left": "10%", "top": "20%", "width": "80%", "height": "30%", "fontSize": "48px"}},
                },
                {
                    "type": "Layer",
                    "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 2.0}],
                    "content": {"type": "Text", "style": {"left": "10%", "top": "20%", "width": "80%", "height": "30%", "fontSize": "48px"}},
                },
            ],
        },
    }
    rep = lint_cut(cut, cut_index=0)
    assert len(rep["overlaps"]) == 0, rep["overlaps"]


def test_overlap_flagged_when_temporally_overlapping():
    from backend.agent.geometry import lint_cut
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Text", "style": {"left": "10%", "top": "20%", "width": "80%", "height": "30%", "fontSize": "48px"}},
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "style": {"left": "10%", "top": "20%", "width": "80%", "height": "30%", "fontSize": "48px"}},
                },
            ],
        },
    }
    rep = lint_cut(cut, cut_index=0)
    assert len(rep["overlaps"]) == 1, rep["overlaps"]
    assert any("set 'exit' to stagger sequentially" in w for w in rep["warnings"])


def test_ast_schemas_support_exit():
    from backend.agent.schemas import ASTLayerNode, AnimationNode
    # AnimationNode exit
    anim = AnimationNode(
        property="opacity",
        **{"from": 1.0},
        to=0.0,
        duration=0.5,
        delay=2.0,
        exit=True,
    )
    assert anim.exit is True

    # ASTLayerNode exit with boolean
    layer_bool = ASTLayerNode(
        content={"type": "Text", "text": "Hello"},
        exit=True,
    )
    assert layer_bool.exit is True

    # ASTLayerNode exit with float seconds
    layer_sec = ASTLayerNode(
        content={"type": "Text", "text": "World"},
        exit=2.5,
    )
    assert layer_sec.exit == 2.5


def test_ast_schemas_support_physics_and_advanced_curves():
    from backend.agent.schemas import AnimationNode

    # 1. Custom spring physics
    spring_anim = AnimationNode(
        property="scale",
        **{"from": 0.8},
        to=1.0,
        duration=0.6,
        delay=0.2,
        easing="spring",
        damping=22.0,
        stiffness=180.0,
        mass=0.75,
        overshoot_clamping=True,
    )
    assert spring_anim.easing == "spring"
    assert spring_anim.damping == 22.0
    assert spring_anim.stiffness == 180.0
    assert spring_anim.mass == 0.75
    assert spring_anim.overshoot_clamping is True

    # 2. Advanced curves: elastic, back, steps, bezier
    elastic_anim = AnimationNode(
        property="translateY",
        **{"from": 60.0},
        to=0.0,
        duration=0.8,
        easing="elastic",
        elastic_bounciness=1.4,
    )
    assert elastic_anim.easing == "elastic"
    assert elastic_anim.elastic_bounciness == 1.4

    bezier_anim = AnimationNode(
        property="translateX",
        **{"from": -50.0},
        to=0.0,
        duration=0.5,
        easing="bezier",
        bezier_points=[0.16, 1.0, 0.3, 1.0],
    )
    assert bezier_anim.easing == "bezier"
    assert bezier_anim.bezier_points == [0.16, 1.0, 0.3, 1.0]

    # 3. Continuous motion loop modes
    loop_anim = AnimationNode(
        property="rotate",
        **{"from": 0.0},
        to=360.0,
        duration=4.0,
        easing="linear",
        loop_mode="loop",
    )
    assert loop_anim.loop_mode == "loop"

    pingpong_anim = AnimationNode(
        property="scale",
        **{"from": 1.0},
        to=1.08,
        duration=1.2,
        easing="ease-in-out",
        loop_mode="pingpong",
    )
    assert pingpong_anim.loop_mode == "pingpong"


def test_timing_lint_accepts_all_renderer_easings():
    from backend.agent.timing import lint_cut_timing

    for easing in ("linear", "spring", "ease-in", "ease-out", "ease-in-out",
                   "bounce", "elastic", "back", "steps", "bezier"):
        cut = {
            "duration": 3.0,
            "composition": {"type": "Sequence", "children": [
                {"type": "Layer",
                 "content": {"type": "Text", "text": "hi"},
                 "animations": [{"property": "scale", "from": 0.8, "to": 1.0,
                                 "duration": 0.6, "delay": 0,
                                 "easing": easing}]},
            ]},
        }
        rep = lint_cut_timing(cut)
        assert not any("unknown" in w and easing in w
                       for w in rep["warnings"]), easing

    cut["composition"]["children"][0]["animations"][0]["easing"] = "wiggle"
    rep = lint_cut_timing(cut)
    assert any("unknown" in w for w in rep["warnings"])


def test_bezier_points_validator_repairs_instead_of_crashing():
    from backend.agent.schemas import AnimationNode

    # x values clamp into [0, 1]; y stays unbounded.
    anim = AnimationNode(
        property="translateX",
        **{"from": -50.0},
        to=0.0,
        duration=0.5,
        easing="bezier",
        bezier_points=[1.5, 3.0, -0.4, 0.5],
    )
    assert anim.bezier_points == [1.0, 3.0, 0.0, 0.5]

    # Wrong length / non-numeric / non-finite shapes drop to None so the
    # renderer falls back to its default curve instead of throwing.
    for bad in ([0.5, 1.0], [0.5, 1.0, 0.3, 1.0, 0.0],
                ["a", 1.0, 0.3, 1.0], [float("nan"), 1, 0.3, 1]):
        anim = AnimationNode(
            property="translateX",
            **{"from": -50.0},
            to=0.0,
            duration=0.5,
            easing="bezier",
            bezier_points=bad,
        )
        assert anim.bezier_points is None

    # Valid curve passes through untouched.
    anim = AnimationNode(
        property="translateX",
        **{"from": -50.0},
        to=0.0,
        duration=0.5,
        easing="bezier",
        bezier_points=[0.16, 1.0, 0.3, 1.0],
    )
    assert anim.bezier_points == [0.16, 1.0, 0.3, 1.0]


def test_ast_schemas_support_mask_configurations():
    from backend.agent.schemas import ASTLayerNode, ASTMaskConfig

    # Circle mask with reveal
    layer_circle = ASTLayerNode(
        content={"type": "Image", "query": "modern skyline"},
        mask=ASTMaskConfig(
            shape="circle",
            size=45,
            x=50,
            y=50,
            reveal="circle_iris",
            reveal_duration=0.9,
            reveal_delay=0.2,
            reveal_easing="ease-out",
        ),
    )
    assert layer_circle.mask.shape == "circle"
    assert layer_circle.mask.size == 45
    assert layer_circle.mask.reveal == "circle_iris"
    assert layer_circle.mask.reveal_duration == 0.9

    # Polygon mask with star preset
    layer_star = ASTLayerNode(
        content={"type": "Image", "query": "space nebula"},
        mask=ASTMaskConfig(
            shape="polygon",
            polygon_preset="star",
            reveal="wipe_diagonal",
            inverted=True,
        ),
    )
    assert layer_star.mask.shape == "polygon"
    assert layer_star.mask.polygon_preset == "star"
    assert layer_star.mask.reveal == "wipe_diagonal"
    assert layer_star.mask.inverted is True

    # Inset mask with rounded corners
    layer_inset = ASTLayerNode(
        content={"type": "Image", "query": "document report"},
        mask={
            "shape": "inset",
            "top": "10%",
            "right": "10%",
            "bottom": "10%",
            "left": "10%",
            "corner_radius": "24px",
            "reveal": "split_vertical",
        },
    )
    assert layer_inset.mask.shape == "inset"
    assert layer_inset.mask.corner_radius == "24px"


def test_ast_layer_supports_ergonomics_attributes():
    from backend.agent.schemas import ASTLayerNode

    layer = ASTLayerNode(
        name="Keynote Speaker Cutout",
        visible=False,
        locked=True,
        color_tag="#38bdf8",
        content={"type": "Image", "query": "speaker portrait"},
    )
    assert layer.name == "Keynote Speaker Cutout"
    assert layer.visible is False
    assert layer.locked is True
    assert layer.color_tag == "#38bdf8"


def test_validate_sub_visuals_preserves_mask_and_ergonomics():
    from backend.agent.validators import validate_sub_visuals

    svs = [
        {
            "duration": 4.0,
            "transition": "fade",
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "name": "Subject photo",
                        "visible": True,
                        "locked": True,
                        "color_tag": "#38bdf8",
                        "content": {
                            "type": "Image",
                            "query": "modern skyline",
                            "source": "pexels",
                            "style": {
                                "position": "absolute",
                                "left": "4%", "top": "6%",
                                "width": "92%", "height": "52%",
                            },
                        },
                        "animations": [],
                        "mask": {
                            "shape": "polygon",
                            "polygon_preset": "hexagon",
                            "reveal": "wipe_right",
                            "reveal_duration": 0.6,
                            "reveal_easing": "ease-out",
                        },
                        "filters": [],
                    },
                ],
            },
        }
    ]
    ok, normalized, err = validate_sub_visuals(svs, 4.0)
    assert ok, err
    layer = normalized[0]["composition"]["children"][0]
    assert layer["name"] == "Subject photo"
    assert layer["visible"] is True
    assert layer["locked"] is True
    assert layer["color_tag"] == "#38bdf8"
    assert layer["mask"]["shape"] == "polygon"
    assert layer["mask"]["reveal"] == "wipe_right"


def test_sanitize_layer_masks_repairs_instead_of_punishing():
    from backend.agent.validators import sanitize_layer_masks

    # Empty / no-op / non-dict masks are dropped.
    layers = [
        {"type": "Layer", "content": {}, "mask": {}},
        {"type": "Layer", "content": {}, "mask": {"shape": "none", "reveal": "none"}},
        {"type": "Layer", "content": {}, "mask": "circle"},
    ]
    assert sanitize_layer_masks(layers, cut_label="cut#0") == 3
    assert all("mask" not in l for l in layers)

    # Unknown shape/reveal/preset keys dropped; legacy spring easing
    # coerced to ease-out; bad durations/delays and blank points dropped.
    layers = [
        {"type": "Layer", "content": {}, "mask": {
            "shape": "octagon", "reveal": "spiral",
            "reveal_easing": "spring", "reveal_duration": -1,
            "reveal_delay": -0.5, "polygon_preset": "octagon",
            "points": "   ",
        }},
    ]
    n = sanitize_layer_masks(layers, cut_label="cut#0")
    assert n >= 6
    assert "mask" not in layers[0]  # emptied by repairs → key dropped

    # Valid masks pass through untouched (idempotent second run repairs 0).
    layers = [
        {"type": "Layer", "content": {}, "mask": {
            "shape": "polygon", "polygon_preset": "hexagon",
            "reveal": "wipe_diagonal", "reveal_duration": 0.6,
            "reveal_easing": "bounce",
        }},
    ]
    assert sanitize_layer_masks(layers, cut_label="cut#0") == 0
    assert layers[0]["mask"]["reveal"] == "wipe_diagonal"


def test_canonical_sample_cut_demonstrates_mask():
    from backend.agent.validators import build_sample_cut, validate_sub_visuals

    sample = build_sample_cut("landscape")
    masks = [l.get("mask") for l in sample["composition"]["children"]
             if isinstance(l, dict) and l.get("mask")]
    assert masks, "canonical sample must include a masked layer for agent grounding"
    ok, normalized, err = validate_sub_visuals([sample], 4.0)
    assert ok, err
    assert normalized[0]["composition"]["children"][1]["mask"]["reveal"] == "wipe_right"


def test_3d_spatial_transforms_and_perspective_in_ast_layers():
    from backend.agent.validators import validate_sub_visuals, SPATIAL_ANIMATION_PROPS
    from backend.agent.schemas import SubVisualAST, AnimationNode, ASTLayerNode, LayerContent

    # 1. translateZ is recognized as spatial animation
    assert "translateZ" in SPATIAL_ANIMATION_PROPS

    # 2. Pydantic validation of AnimationNode with translateZ
    anim = AnimationNode(
        property="translateZ",
        **{"from": -200.0},
        to=0.0,
        duration=0.8,
        delay=0.2,
        easing="spring",
    )
    assert anim.property == "translateZ"
    assert anim.from_ == -200.0

    # 3. Pydantic validation of ASTLayerNode with perspective & 3D layout styles
    layer_node = ASTLayerNode(
        type="Layer",
        perspective=1200,
        perspective_origin="50% 0%",
        content=LayerContent(
            type="Text",
            text="3D Spatial Perspective",
            style={
                "position": "absolute",
                "left": "10%",
                "top": "20%",
                "width": "80%",
                "rotateX": 25,
                "rotateY": -15,
                "translateZ": 100,
            },
        ),
        animations=[anim],
    )
    assert layer_node.perspective == 1200
    assert layer_node.perspective_origin == "50% 0%"
    assert layer_node.content.style.get("rotateX") == 25
    assert layer_node.content.style.get("rotateY") == -15
    assert layer_node.content.style.get("translateZ") == 100

    # 4. End-to-end validate_sub_visuals passes without stripping 3D properties
    svs = [
        {
            "duration": 5.0,
            "transition": "fade",
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "perspective": "1000px",
                        "perspective_origin": "center center",
                        "content": {
                            "type": "Image",
                            "query": "cinematic neon city",
                            "source": "pexels",
                            "style": {
                                "position": "absolute",
                                "left": "5%",
                                "top": "10%",
                                "width": "90%",
                                "height": "70%",
                                "rotateX": 15,
                                "rotateY": -20,
                                "translateZ": 50,
                            },
                        },
                        "animations": [
                            {
                                "property": "translateZ",
                                "from": -150,
                                "to": 0,
                                "duration": 0.8,
                                "delay": 0.3,
                                "easing": "spring",
                            }
                        ],
                    }
                ],
            },
        }
    ]
    ok, normalized, err = validate_sub_visuals(svs, 5.0)
    assert ok, err
    norm_layer = normalized[0]["composition"]["children"][0]
    assert norm_layer.get("perspective") == "1000px"
    assert norm_layer.get("perspective_origin") == "center center"
    style = norm_layer["content"]["style"]
    assert style.get("rotateX") == 15
    assert style.get("rotateY") == -20
    assert style.get("translateZ") == 50
    assert norm_layer["animations"][0]["property"] == "translateZ"


def test_layer_blur_and_backdrop_blur():
    from backend.agent.schemas import sanitize_layer_style, UNIVERSAL_STYLE_KEYS
    from backend.agent.validators import validate_sub_visuals

    # 1. Check UNIVERSAL_STYLE_KEYS
    assert "blur" in UNIVERSAL_STYLE_KEYS
    assert "backdropFilter" in UNIVERSAL_STYLE_KEYS

    # 2. Check sanitize_layer_style preserves blur and backdropFilter
    raw_style = {
        "position": "absolute",
        "left": "10%",
        "top": "15%",
        "width": "80%",
        "height": "60%",
        "blur": 15,
        "backdropFilter": "blur(20px)",
    }
    cleaned, stripped, moves = sanitize_layer_style("Image", raw_style)
    assert "blur" not in stripped
    assert "backdropFilter" not in stripped
    assert cleaned["blur"] == 15
    assert cleaned["backdropFilter"] == "blur(20px)"

    # 3. Check validate_sub_visuals with blur filters & direct style blur
    svs = [
        {
            "sub_id": "test_blur",
            "section_type": "b_roll",
            "composition": {
                "children": [
                    {
                        "type": "Layer",
                        "filters": [
                            "blur(12px)",
                            "backdrop-filter: blur(16px)",
                            "mix-blend-mode: overlay",
                        ],
                        "content": {
                            "type": "Image",
                            "query": "cinematic moody rain",
                            "source": "pexels",
                            "style": {
                                "position": "absolute",
                                "left": "0%",
                                "top": "0%",
                                "width": "100%",
                                "height": "100%",
                                "blur": 8,
                                "backdropFilter": "blur(12px)",
                            },
                        },
                    }
                ],
            },
        }
    ]
    ok, normalized, err = validate_sub_visuals(svs, 5.0)
    assert ok, err
    norm_layer = normalized[0]["composition"]["children"][0]
    assert "blur(12px)" in norm_layer["filters"]
    assert "backdrop-filter: blur(16px)" in norm_layer["filters"]
    assert norm_layer["content"]["style"]["blur"] == 8
    assert norm_layer["content"]["style"]["backdropFilter"] == "blur(12px)"





