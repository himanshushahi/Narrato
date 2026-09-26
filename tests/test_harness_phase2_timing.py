"""Phase 2: timing linter — guessed delays become explicit warnings."""
import copy

from backend.agent.timing import lint_cut_timing, lint_section_timing
from backend.agent.validators import build_sample_cut


def _layer(anims, **kw):
    content = {"type": kw.get("ctype", "Text"), "text": "hello",
               "style": {"left": "6%", "top": "60%", "width": "88%",
                         "fontSize": "56px"}}
    if content["type"] == "Image":
        content["query"] = "city skyline night"
    layer = {"type": "Layer", "content": content,
             "animations": list(anims), "filters": []}
    if kw.get("motion_blur"):
        layer["motion_blur"] = True
    return layer


def _cut(duration, children, **kw):
    cut = {"duration": duration, "transition": "cut",
           "composition": {"type": "Sequence", "children": children}}
    if "emphasis" in kw:
        cut["emphasis"] = kw["emphasis"]
    return cut


def test_canonical_sample_timing_clean():
    cut = copy.deepcopy(build_sample_cut())
    cut.pop("note", None)
    rep = lint_cut_timing(cut)
    assert rep["warnings"] == [], rep["warnings"]
    assert rep["cut_duration"] == 4.0


def test_overflow_warns_with_clamp_fix():
    cut = _cut(2.0, [_layer([{"property": "translateY", "from": 8, "to": 0,
                               "duration": 0.5, "delay": 1.8,
                               "easing": "ease-out"},
                              {"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": 1.8,
                               "easing": "ease-out"}])])
    rep = lint_cut_timing(cut)
    assert any("overflows cut" in w for w in rep["warnings"])
    assert any("clamp" in f for f in rep["fixes"])


def test_unpaired_entrance_warns():
    cut = _cut(4.0, [_layer([{"property": "translateY", "from": 50, "to": 0,
                               "duration": 0.6, "delay": 0.5,
                               "easing": "spring"}])])
    rep = lint_cut_timing(cut)
    assert any("without opacity fade" in w for w in rep["warnings"])
    assert any("opacity" in f for f in rep["fixes"])


def test_motion_blur_static_warns():
    cut = _cut(4.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": 0,
                               "easing": "ease-out"}],
                             motion_blur=True)])
    rep = lint_cut_timing(cut)
    assert any("motion_blur" in w for w in rep["warnings"])


def test_emphasis_overflow_warns():
    cut = _cut(2.0, [_layer([])],
               emphasis=[{"at": 1.8, "scale": 1.15, "duration": 0.5}])
    rep = lint_cut_timing(cut)
    assert any("emphasis" in w for w in rep["warnings"])


def test_bad_easing_warns():
    cut = _cut(4.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": 0,
                               "easing": "bounce"}])])
    rep = lint_cut_timing(cut)
    assert any("easing" in w for w in rep["warnings"])


def test_section_rollup_has_semantics():
    cuts = [copy.deepcopy(build_sample_cut()) for _ in range(2)]
    for c in cuts:
        c.pop("note", None)
    rep = lint_section_timing(cuts)
    assert "absolute seconds" in rep["semantics"]
    assert rep["cut_durations_final"] == [4.0, 4.0]
    assert rep["animations_checked"] == 2
