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


def _has_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return True
        return any(_has_key(v, key) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_key(v, key) for v in obj)
    return False


def test_canonical_sample_is_composition_shape():
    for fmt in ("landscape", "portrait"):
        cut = build_sample_cut(fmt)
        assert "layers" not in cut
        assert not _has_key(cut.get("composition"), "layout")
        assert not _has_key(cut.get("composition"), "props")
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
    p = _sample_cut_template("portrait")
    p.pop("note", None)
    q = _canonical_sample_cut("portrait")
    q.pop("note", None)
    assert p == q


def test_stale_empty_layers_key_ignored():
    cut = build_sample_cut()
    cut.pop("note", None)
    cut["layers"] = []
    assert detect_legacy_cut_shape(cut) is None
    ok, _, err = validate_sub_visuals([cut], 4.0)
    assert ok, err


def test_hybrid_cut_flagged_and_merged():
    cut = build_sample_cut()
    cut.pop("note", None)
    cut["layers"] = [{"type": "Text", "text": "stale",
                      "layout": {"x": 6, "y": 60, "w": 88, "h": 20},
                      "animations": []}]
    hit = detect_legacy_cut_shape(cut)
    assert hit is not None
    assert any("BOTH" in s for s in hit["signals"])
    ok, _, err = validate_sub_visuals([copy.deepcopy(cut)], 4.0)
    assert not ok and err.startswith("SCHEMA_MISMATCH")
    merged = migrate_legacy_cut_to_composition(cut)
    n_orig = len(cut["composition"]["children"])
    assert len(merged["composition"]["children"]) == n_orig + 1
    ok2, _, err2 = validate_sub_visuals([merged], 4.0)
    assert ok2, err2


def test_content_preset_and_numeric_fontsize_flagged():
    cut = build_sample_cut()
    cut.pop("note", None)
    cut["composition"]["children"][-1]["content"].pop("particle_preset")
    cut["composition"]["children"][-1]["content"]["preset"] = "dust"
    cut["composition"]["children"][2]["content"]["style"]["fontSize"] = 7
    hit = detect_legacy_cut_shape(cut)
    assert hit is not None
    assert any("preset" in s for s in hit["signals"])
    assert any("fontSize" in s for s in hit["signals"])


def test_scalar_filters_not_exploded():
    cut = {"duration": 4.0, "transition": "cut",
           "layers": [{"type": "Text", "text": "hi",
                       "layout": {"x": 6, "y": 60, "w": 88, "h": 20},
                       "filters": "blur(4px)", "animations": []}]}
    migrated = migrate_legacy_cut_to_composition(cut)
    assert migrated["composition"]["children"][0]["filters"] == ["blur(4px)"]


def test_cut_index_matches_source_order_with_skips():
    ok, _, err = validate_sub_visuals(["garbage", _legacy_cut()], 4.0)
    assert not ok
    assert "cut#1" in err


def _setup_payloads_proj(tmp_path, monkeypatch):
    import json
    from backend.mcp import payloads
    pid = "proj_p0"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.core.config.get_exports_dir",
                        lambda: tmp_path / "exports")
    proj = {"id": pid, "name": "T", "prompt": "", "language": "hi",
            "style": "nitish_rajput", "duration_mode": "medium",
            "video_format": "landscape"}
    monkeypatch.setattr("backend.database.db.get_project",
                        lambda _pid: dict(proj))
    monkeypatch.setattr(payloads._db, "get_project",
                        lambda _pid: dict(proj), raising=False)
    proj_dir = tmp_path / pid
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "voiceover").mkdir(parents=True, exist_ok=True)
    (proj_dir / "voiceover" / "manifest.json").write_text(json.dumps(
        [{"index": 0, "section_type": "scene", "title": "S",
          "text": "n", "duration": 8.0, "sub_visuals": []}]), encoding="utf-8")
    (proj_dir / "design.json").write_text(json.dumps(
        {"theme_name": "T", "color_palette": {}, "typography": {},
         "css_guidelines": "motion"}), encoding="utf-8")
    (proj_dir / "script.json").write_text(json.dumps(
        {"title": "T", "introduction": {"hook": "hi", "sub_visuals": []},
         "scenes": [{"scene_number": 1, "title": "S",
                     "narration": "n", "sub_visuals": []}],
         "conclusion": {"summary": "out", "cta": "", "sub_visuals": []}}),
        encoding="utf-8")
    return pid


def test_save_rejects_legacy_with_error_code_and_no_mutation(tmp_path, monkeypatch):
    import copy as _copy
    from backend.mcp import payloads
    pid = _setup_payloads_proj(tmp_path, monkeypatch)
    legacy = [_legacy_cut()]
    snapshot = _copy.deepcopy(legacy)
    res = payloads.save_visuals_payload(pid, "scene", legacy, scene_index=0,
                                        dry_run=True)
    assert res["ok"] is False
    assert res.get("error_code") == "SCHEMA_MISMATCH"
    assert "fix" in res and "auto_migrate_preview" in res["fix"]
    assert legacy == snapshot  # caller payload untouched


def test_save_auto_migrate_persists(tmp_path, monkeypatch):
    from backend.mcp import payloads
    pid = _setup_payloads_proj(tmp_path, monkeypatch)
    res = payloads.save_visuals_payload(pid, "scene", [_legacy_cut()],
                                        scene_index=0, auto_migrate=True)
    assert res["ok"] is True, res
    assert res["persisted"] is True
