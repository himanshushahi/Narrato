"""Strict media validation: query-less Image/Video layers must fail validation
and be sanitized before they can reach the renderer."""
import hashlib
import json
import pytest
from pydantic import ValidationError

from backend.agent.schemas import LayerContent, VisualsArrayResponse
from backend.agent.validators import validate_sub_visuals, sanitize_media_layers


def _media_layer(ctype="Image", query="city skyline", z=0):
    layer = {"type": "Layer", "z_index": z,
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


# ── Response-level gate (Union[Dict] bypass proof) ─────────────────────

def test_response_rejects_raw_dict_queryless_media():
    # Raw dicts bypass LayerContent via the Union[..., Dict] fallback —
    # the response validator must still catch them.
    bad = {"sub_visuals": [
        _cut(_media_layer("Image", None), _media_layer("Video", "ocean waves")),
        _cut({"type": "Layer", "z_index": 30,
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
            {"type": "Layer", "z_index": 30, "content": {"type": "Text", "text": "hi"}}]
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
    svs = [_cut(_media_layer("Image", None, z=0), duration=5.0),
           _cut(_media_layer("Image", "city", z=0), duration=5.0)]
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
