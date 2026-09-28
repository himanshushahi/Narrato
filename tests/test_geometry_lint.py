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

