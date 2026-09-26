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
    assert not any("off-canvas" in w for w in rep["warnings"])
    assert not any("missing style.fontSize" in w for w in rep["warnings"])


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
