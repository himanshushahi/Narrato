"""Phase 3: probe tools — read-only visibility per cut/scene/asset."""
import copy
import json

from backend.agent.validators import build_sample_cut
from backend.mcp import payloads, probe


def _proj(pid="proj_probe"):
    return {"id": pid, "name": "Probe Topic", "prompt": "",
            "language": "hi", "style": "nitish_rajput",
            "duration_mode": "medium", "video_format": "landscape"}


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.core.config.get_exports_dir",
                        lambda: tmp_path / "exports")
    monkeypatch.setattr("backend.database.db.get_project",
                        lambda pid: dict(_proj(pid)))
    # payloads reads via backend.database.db module attr.
    monkeypatch.setattr(payloads._db, "get_project",
                        lambda pid: dict(_proj(pid)), raising=False)
    proj_dir = tmp_path / "proj_probe"
    proj_dir.mkdir(parents=True, exist_ok=True)
    manifest = [
        {"index": 0, "section_type": "scene", "title": "Scene one",
         "text": "First narration.", "duration": 8.0, "sub_visuals": []},
    ]
    voice_dir = proj_dir / "voiceover"
    voice_dir.mkdir(parents=True, exist_ok=True)
    (voice_dir / "manifest.json").write_text(json.dumps(manifest),
                                             encoding="utf-8")
    (proj_dir / "design.json").write_text(json.dumps({
        "theme_name": "T", "color_palette": {}, "typography": {},
        "css_guidelines": "motion fade transition"}), encoding="utf-8")
    (proj_dir / "script.json").write_text(json.dumps({
        "title": "Probe", "introduction": {"hook": "hi", "sub_visuals": []},
        "scenes": [{"scene_number": 1, "title": "Scene one",
                    "narration": "First narration.", "sub_visuals": []}],
        "conclusion": {"summary": "out", "cta": "", "sub_visuals": []}}),
        encoding="utf-8")
    cut = copy.deepcopy(build_sample_cut())
    cut.pop("note", None)
    saved = payloads.save_visuals_payload("proj_probe", "scene", [cut],
                                          scene_index=0)
    assert saved["ok"] is True, saved
    assert "geometry" in saved and "timing" in saved
    return proj_dir


def test_probe_cut_reports_layers_geometry_timing(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    res = probe.probe_cut_payload("proj_probe", "scene", 0, 0)
    assert res["ok"] is True
    assert res["cut_duration"] == 8.0  # renormed 4.0 -> 8.0
    assert len(res["layers"]) == 4
    img = [l for l in res["layers"] if l["type"] == "Image"][0]
    assert img["query"].strip()
    assert img["asset_exists"] is False  # no download in tests
    assert res["assets_missing"]
    assert "geometry" in res and "timing" in res


def test_probe_scene_rollup(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    res = probe.probe_scene_payload("proj_probe", "scene", 0)
    assert res["ok"] is True
    assert res["cut_count"] == 1
    assert res["total_duration"] == 8.0
    assert res["cuts"][0]["layer_count"] == 4
    assert "geometry" in res and "timing" in res and "variety" in res


def test_probe_asset_missing_then_procedural(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    media = probe.probe_asset_payload("proj_probe", "scene", 0, 0, 1)
    assert media["ok"] is True
    assert media["layer_type"] == "Image"
    assert media["status"] == "missing"
    assert "fetch_assets" in media["fix"]
    text = probe.probe_asset_payload("proj_probe", "scene", 0, 0, 2)
    assert text["status"] == "procedural"


def test_probe_bad_selector_errors(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    assert probe.probe_cut_payload("proj_probe", "scene", 0, 9)["ok"] is False
    assert probe.probe_cut_payload("proj_probe", "bogus", 0, 0)["ok"] is False


def test_internal_probe_tools_return_json(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    from backend.agent.tools import execute_tool
    out = execute_tool("probe_scene", {"project_id": "proj_probe",
                                       "section_type": "scene",
                                       "scene_index": 0})
    data = json.loads(out)
    assert data["ok"] is True and data["cut_count"] == 1
    out2 = execute_tool("probe_cut", {"project_id": "proj_probe",
                                      "section_type": "scene",
                                      "scene_index": 0, "cut_index": 0})
    assert json.loads(out2)["ok"] is True
