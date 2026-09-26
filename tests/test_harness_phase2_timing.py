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
    assert rep["cuts_checked"] == 2
    # 4 animations per canonical cut (bg drift + image fade + 2 text).
    assert rep["animations_checked"] == 8


def test_blur_needs_from_and_to():
    # Spatial prop with duration but no from/to is skipped by the renderer,
    # so blur is bypassed — linter must say so.
    cut = _cut(4.0, [_layer([{"property": "scale", "duration": 0.5,
                               "delay": 0, "easing": "ease-out"}],
                             motion_blur=True)])
    assert any("motion_blur" in w for w in lint_cut_timing(cut)["warnings"])
    # Complete keyframe counts as motion — no warning.
    cut2 = _cut(4.0, [_layer([{"property": "scale", "from": 1.0, "to": 1.1,
                                "duration": 0.5, "delay": 0,
                                "easing": "ease-out"}],
                              motion_blur=True)])
    assert not any("motion_blur" in w
                   for w in lint_cut_timing(cut2)["warnings"])


def test_legacy_start_uses_delay_semantics():
    cut = _cut(4.0, [_layer([{"property": "translateY", "from": 50, "to": 0,
                               "duration": 0.6, "start": 0.5,
                               "easing": "spring"}])])
    rep = lint_cut_timing(cut)
    assert any("without opacity fade" in w for w in rep["warnings"])
    assert any("start" in w for w in rep["warnings"])


def test_unknown_easing_falls_back_to_linear():
    cut = _cut(4.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": 0,
                               "easing": "bounce"}])])
    assert any("linear" in w for w in lint_cut_timing(cut)["warnings"])


def test_bad_emphasis_values_warn():
    neg = _cut(4.0, [_layer([])], emphasis=[{"at": -1, "scale": 1.1,
                                              "duration": 0.5}])
    assert any("bad at" in w for w in lint_cut_timing(neg)["warnings"])
    zero = _cut(4.0, [_layer([])], emphasis=[{"at": 1, "scale": 1.1,
                                               "duration": 0}])
    assert any("bad duration" in w for w in lint_cut_timing(zero)["warnings"])
    notalist = _cut(4.0, [_layer([])])
    notalist["emphasis"] = {"at": 1}
    assert any("must be a list" in w
               for w in lint_cut_timing(notalist)["warnings"])


def test_oversized_animation_suggests_duration_only():
    cut = _cut(2.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 5, "delay": 0,
                               "easing": "ease-out"}])])
    rep = lint_cut_timing(cut)
    assert any("shorten duration" in f for f in rep["fixes"])
    assert not any("clamp to delay" in f for f in rep["fixes"])


def test_never_plays_deduped_from_overflow():
    cut = _cut(2.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": 2.5,
                               "easing": "ease-out"}])])
    rep = lint_cut_timing(cut)
    assert sum("never plays" in w for w in rep["warnings"]) == 1
    assert not any("overflows cut" in w for w in rep["warnings"])


def test_nonfinite_delay_warns():
    cut = _cut(4.0, [_layer([{"property": "opacity", "from": 0, "to": 1,
                               "duration": 0.5, "delay": float("inf"),
                               "easing": "ease-out"}])])
    assert any("non-finite" in w for w in lint_cut_timing(cut)["warnings"])


def test_scale_linear_entrance_flagged_drift_ignored():
    entrance = _cut(4.0, [_layer(
        [{"property": "scale", "from": 0.8, "to": 1.0, "duration": 0.6,
          "delay": 0.5, "easing": "linear"},
         {"property": "opacity", "from": 0, "to": 1, "duration": 0.5,
          "delay": 0.5, "easing": "ease-out"}])])
    assert any("prefer spring" in w
               for w in lint_cut_timing(entrance)["warnings"])
    drift = _cut(4.0, [_layer(
        [{"property": "scale", "from": 1.0, "to": 1.06, "duration": 4.0,
          "delay": 0, "easing": "linear"}])])
    assert not any("prefer spring" in w
                   for w in lint_cut_timing(drift)["warnings"])


def test_empty_report_shape():
    from backend.agent.timing import empty_timing_report
    rep = empty_timing_report()
    assert rep["warning_count"] == 0
    assert rep["cuts_checked"] == 0
    assert rep["animations_checked"] == 0
    assert "absolute seconds" in rep["semantics"]
