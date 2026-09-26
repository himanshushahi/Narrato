"""Phase 1: geometry linter — blind placement becomes visible warnings."""
import copy

from backend.agent.geometry import (
    center_left_for_width, lint_cut, lint_sub_visuals, parse_pct,
)
from backend.agent.validators import build_sample_cut


def _layer(ctype, style, **kw):
    content = {"type": ctype, "style": dict(style)}
    if ctype == "Text":
        content["text"] = kw.get("text", "hello")
    if ctype == "Image":
        content["query"] = kw.get("query", "city skyline night")
    layer = {"type": "Layer", "content": content,
             "animations": kw.get("animations", []), "filters": []}
    for k in ("transform_origin", "floating", "motion_blur"):
        if k in kw:
            layer[k] = kw[k]
    return layer


def _cut(children):
    return {"duration": 4.0, "transition": "cut",
            "composition": {"type": "Sequence", "children": children}}


def test_parse_and_center_math():
    assert parse_pct("6%") == 6.0
    assert parse_pct("bad") is None
    assert center_left_for_width(42.0) == 29.0
    assert center_left_for_width(70.0) == 15.0


def test_canonical_sample_is_clean():
    cut = copy.deepcopy(build_sample_cut())
    cut.pop("note", None)
    rep = lint_cut(cut)
    assert rep["overlaps"] == []
    assert rep["warnings"] == [], rep["warnings"]
    assert rep["fixes"] == [], rep["fixes"]


def test_missing_fontsize_warns():
    cut = _cut([_layer("Text", {"left": "6%", "top": "60%", "width": "88%"})])
    rep = lint_cut(cut)
    assert any("missing style.fontSize" in w for w in rep["warnings"])
    assert any("fontSize" in f for f in rep["fixes"])


def test_double_anchor_warns():
    cut = _cut([_layer("Text", {"left": "6%", "right": "6%", "top": "60%",
                                "bottom": "10%", "width": "88%",
                                "fontSize": "56px"})])
    rep = lint_cut(cut)
    assert any("left+right" in w for w in rep["warnings"])
    assert any("top+bottom" in w for w in rep["warnings"])


def test_overlap_detected():
    box = {"left": "10%", "top": "20%", "width": "70%", "height": "60%",
           "fontSize": "56px"}
    cut = _cut([_layer("Text", dict(box)), _layer("Chart", dict(box))])
    rep = lint_cut(cut)
    assert len(rep["overlaps"]) == 1
    assert rep["overlaps"][0]["iou"] > 0.6
    assert any("overlap" in w for w in rep["warnings"])


def test_offcanvas_and_rotate_warn():
    cut = _cut([_layer("Image", {"left": "-80%", "top": "10%",
                                 "width": "10%", "height": "20%"}),
                _layer("Shape", {"left": "10%", "top": "10%",
                                 "width": "20%", "height": "20%",
                                 "rotate": 25})])
    rep = lint_cut(cut)
    assert any("off-canvas horizontally" in w for w in rep["warnings"])
    assert any("transform_origin" in w for w in rep["warnings"])


def test_section_rollup_caps():
    cuts = [copy.deepcopy(build_sample_cut()) for _ in range(3)]
    for c in cuts:
        c.pop("note", None)
    rep = lint_sub_visuals(cuts)
    assert rep["warning_count"] == len(rep["warnings"])
    assert len(rep["warnings"]) <= 20


def test_layer_zero_text_without_box_warns():
    cut = _cut([_layer("Text", {})])
    rep = lint_cut(cut)
    assert any("no LayerBox" in w for w in rep["warnings"])


def test_background_zero_without_box_silent():
    cut = _cut([_layer("Background", {})])
    rep = lint_cut(cut)
    assert rep["warnings"] == []


def test_fullscreen_images_do_not_overlap_warn():
    full = {"left": "0%", "top": "0%", "width": "100%", "height": "100%"}
    cut = _cut([_layer("Image", dict(full)), _layer("Image", dict(full))])
    rep = lint_cut(cut)
    assert rep["overlaps"] == []
    assert not any("overlap" in w for w in rep["warnings"])


def test_numeric_geometry_and_fontsize_warn():
    cut = _cut([_layer("Text", {"left": 6, "top": "60%", "width": 88,
                                "fontSize": 7})])
    rep = lint_cut(cut)
    assert any("numeric" in w for w in rep["warnings"])
    assert any("not a px string" in w for w in rep["warnings"])


def test_vertical_center_math_suggested():
    cut = _cut([_layer("Chart", {"left": "15%", "top": "10%",
                                 "width": "70%", "height": "66%",
                                 "fontSize": "56px"})])
    rep = lint_cut(cut)
    assert any("centered top" in f for f in rep["fixes"])


def test_center_math_only_near_center():
    # Near miss (2pp off) → helpful typo correction.
    near = _cut([_layer("Chart", {"left": "27%", "top": "20%",
                                  "width": "42%", "height": "60%",
                                  "fontSize": "56px"})])
    assert any("centered left" in f for f in lint_cut(near)["fixes"])
    # Deliberate split layout (23pp off) → no centering noise.
    far = _cut([_layer("Chart", {"left": "6%", "top": "16%",
                                 "width": "42%", "height": "66%",
                                 "fontSize": "56px"})])
    assert not any("centered left" in f for f in lint_cut(far)["fixes"])
