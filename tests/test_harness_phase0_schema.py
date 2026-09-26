"""Phase 0: single schema SOT — legacy layers/layout must fail fast, never ok:true + black."""
import copy

from backend.agent.validators import (
    build_sample_cut,
    detect_legacy_cut_shape,
    migrate_legacy_cut_to_composition,
    validate_sub_visuals,
)


def _legacy_cut():
    return {
        "duration": 4.0,
        "transition": "whip_pan",
        "layers": [
            {"type": "Background", "props": {"color": "#0B0F1A"}, "animations": []},
            {"type": "Image", "query": "parliament building new delhi wide",
             "layout": {"x": 4, "y": 6, "w": 92, "h": 52},
             "animations": [{"property": "opacity", "from": 0, "to": 1,
                              "start": 0, "duration": 0.6}]},
            {"type": "Text", "text": "Sample beat callout",
             "layout": {"x": 6, "y": 62, "w": 88, "h": 20},
             "style": {"fontSize": 7, "fontWeight": 800},
             "animations": [{"property": "translateY", "from": 8, "to": 0,
                              "start": 0.1, "duration": 0.5}]},
            {"type": "Particles", "preset": "dust",
             "layout": {"x": 0, "y": 0, "w": 100, "h": 100}, "animations": []},
        ],
    }


def test_canonical_sample_is_composition_shape():
    for fmt in ("landscape", "portrait"):
        cut = build_sample_cut(fmt)
        assert "layers" not in cut
        assert "layout" not in str(cut)
        children = cut["composition"]["children"]
        assert all(c.get("type") == "Layer" for c in children)
        # %-strings, Text fontSize px-string, Particles last.
        img_style = children[1]["content"]["style"]
        assert img_style["left"] == "4%"
        assert children[2]["content"]["style"]["fontSize"].endswith("px")
        assert children[-1]["content"]["type"] == "Particles"
        assert children[-1]["content"]["particle_preset"] == "dust"


def test_detect_legacy_shape():
    hit = detect_legacy_cut_shape(_legacy_cut())
    assert hit is not None
    assert any("layers" in s for s in hit["signals"])
    assert detect_legacy_cut_shape(build_sample_cut()) is None


def test_validate_rejects_legacy_with_schema_mismatch():
    ok, _, err = validate_sub_visuals([_legacy_cut()], 4.0)
    assert not ok
    assert err.startswith("SCHEMA_MISMATCH")


def test_validate_accepts_canonical():
    cut = build_sample_cut()
    cut.pop("note", None)
    ok, normalized, err = validate_sub_visuals([copy.deepcopy(cut)], 4.0)
    assert ok, err
    kids = normalized[0]["composition"]["children"]
    assert len(kids) == 4


def test_migrate_legacy_then_validate():
    migrated = migrate_legacy_cut_to_composition(_legacy_cut())
    assert "layers" not in migrated
    ok, normalized, err = validate_sub_visuals([migrated], 4.0)
    assert ok, err
    children = normalized[0]["composition"]["children"]
    assert children[1]["content"]["query"].strip()
    assert children[1]["content"]["style"]["left"] == "4%"
    # start → delay mapping.
    assert children[1]["animations"][0]["delay"] == 0


def test_server_and_blueprint_share_builder():
    from backend.mcp.server import _sample_cut_template
    from backend.mcp.payloads import _canonical_sample_cut
    assert _sample_cut_template("landscape")["composition"]["children"]
    assert _canonical_sample_cut("landscape")["composition"]["children"]
    a = _sample_cut_template("landscape")
    a.pop("note", None)
    b = _canonical_sample_cut("landscape")
    b.pop("note", None)
    assert a == b
