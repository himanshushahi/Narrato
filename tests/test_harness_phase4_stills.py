"""Phase 4: stills cache busts on any visuals edit, never stale."""
import copy
import json

from backend.agent.validators import build_sample_cut
from backend.mcp import probe
from backend.mcp.stills import (
    compute_visuals_hash, describe_stills_cache, still_cache_key,
)


def _script_with(cuts):
    return {"title": "T",
            "introduction": {"hook": "hi", "sub_visuals": []},
            "scenes": [{"scene_number": 1, "title": "S",
                        "narration": "n", "sub_visuals": list(cuts)}],
            "conclusion": {"summary": "out", "cta": "",
                           "sub_visuals": []}}


def _cut():
    c = copy.deepcopy(build_sample_cut())
    c.pop("note", None)
    return c


def test_visuals_hash_changes_on_edit():
    h1 = compute_visuals_hash(_script_with([_cut()]))
    edited = _cut()
    edited["composition"]["children"][2]["content"]["text"] = "CHANGED"
    h2 = compute_visuals_hash(_script_with([edited]))
    assert h1 != h2
    assert h1 != "novisuals"


def test_visuals_hash_ignores_local_path_and_asset_url():
    a = _script_with([_cut()])
    b = copy.deepcopy(a)
    b["scenes"][0]["sub_visuals"][0]["composition"]["children"][1][
        "content"]["local_path"] = "C:/x/asset_1.jpg"
    b["scenes"][0]["sub_visuals"][0]["composition"]["children"][1][
        "content"]["asset_url"] = "https://example.com/x.jpg"
    assert compute_visuals_hash(a) == compute_visuals_hash(b)


def test_visuals_hash_busts_on_overlay_edit():
    a = _script_with([_cut()])
    b = copy.deepcopy(a)
    b["overlays"] = [{"type": "watermark", "text": "NEW"}]
    assert compute_visuals_hash(a) != compute_visuals_hash(b)


def test_missing_vs_empty_sub_visuals_hash_same():
    a = {"title": "T", "scenes": []}
    b = {"title": "T", "introduction": {"sub_visuals": []},
         "scenes": [], "conclusion": {}}
    assert compute_visuals_hash(a) == compute_visuals_hash(b)


def test_cache_key_busts_on_visuals_change():
    import pytest
    k1 = still_cache_key("s", "d", 90, visuals_hash="aaa")
    k2 = still_cache_key("s", "d", 90, visuals_hash="bbb")
    assert k1 != k2
    # visuals_hash is required — no silent pre-visuals key family.
    with pytest.raises(TypeError):
        still_cache_key("s", "d", 90)


def test_probe_visuals_hash_tracks_save(tmp_path, monkeypatch):
    from backend.mcp import payloads
    pid = "proj_stills"
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
    (proj_dir / "script.json").write_text(json.dumps(_script_with([])),
                                          encoding="utf-8")
    saved = payloads.save_visuals_payload(pid, "scene", [_cut()], scene_index=0)
    assert saved["ok"] is True, saved
    before = probe.probe_scene_payload(pid, "scene", 0)["visuals_hash"]
    edited = _cut()
    edited["composition"]["children"][2]["content"]["text"] = "EDITED"
    saved2 = payloads.save_visuals_payload(pid, "scene", [edited],
                                           scene_index=0)
    assert saved2["ok"] is True, saved2
    after = probe.probe_scene_payload(pid, "scene", 0)["visuals_hash"]
    assert before != after


def test_describe_cache_reports_miss_without_render(tmp_path, monkeypatch):
    pid = "proj_describe"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.database.db.get_project",
                        lambda _pid: {"id": pid, "name": "T"})
    proj_dir = tmp_path / pid
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "script.json").write_text(json.dumps(_script_with([_cut()])),
                                          encoding="utf-8")
    (proj_dir / "design.json").write_text(json.dumps(
        {"theme_name": "T", "color_palette": {}, "typography": {},
         "css_guidelines": "x"}), encoding="utf-8")
    monkeypatch.setattr(
        "backend.pipeline.render.prepare_render_props_and_settings",
        lambda proj, _dir: ({}, {"fps": 30}))
    info = describe_stills_cache(pid, [1.0])
    assert info["visuals_hash"] != "novisuals"
    assert info["frames"] == [30]
    assert info["misses"] == [30] and info["hits"] == []
    assert len(info["script_hash"]) > 16  # full hash, not truncated


def test_describe_has_no_side_effects_and_fps_fallback(tmp_path, monkeypatch):
    pid = "proj_nodesc"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.database.db.get_project",
                        lambda _pid: {"id": pid, "name": "T"})
    proj_dir = tmp_path / pid
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "script.json").write_text(json.dumps(_script_with([_cut()])),
                                          encoding="utf-8")
    (proj_dir / "design.json").write_text(json.dumps(
        {"theme_name": "T", "color_palette": {}, "typography": {},
         "css_guidelines": "x"}), encoding="utf-8")

    def _boom(proj, _dir):
        raise RuntimeError("no manifest yet")
    monkeypatch.setattr(
        "backend.pipeline.render.prepare_render_props_and_settings", _boom)
    info = describe_stills_cache(pid, [2.0])
    assert info["fps"] == 30  # lightweight fallback, not a crash
    assert not (proj_dir / "assets" / "previews" / "stills").exists()
