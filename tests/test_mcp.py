"""Tests for backend.mcp.payloads (validation + file/DB save paths).

DB and storage are stubbed/redirected — no real database, network, or LLM.
"""
import json
import threading
from pathlib import Path

import pytest

from backend.mcp import payloads


def _proj(pid="proj_mcp"):
    return {"id": pid, "name": "Test Topic", "prompt": "",
            "language": "hi", "style": "nitish_rajput",
            "duration_mode": "medium", "video_format": "landscape"}


def _script(title="Test Title"):
    return {
        "title": title,
        "introduction": {"hook": "A hook that draws the viewer in."},
        "scenes": [
            {"title": "Scene one", "narration": "First narration."},
            {"title": "Scene two", "narration": "Second narration."},
        ],
        "conclusion": {"summary": "A closing summary.", "cta": "Subscribe."},
    }


def _patch_storage(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.core.config.get_exports_dir", lambda: tmp_path / "exports")


@pytest.fixture(autouse=True)
def _guard_real_db(monkeypatch):
    """Safety guard: prevent any unmocked database connection from touching production narrato.db."""
    from backend.core.config import DB_PATH as PROD_DB_PATH
    from backend.database import db as db_mod
    orig_get_conn = db_mod.get_db_connection

    def guarded_get_conn():
        if getattr(db_mod, "DB_PATH", None) == PROD_DB_PATH:
            raise RuntimeError(
                f"Test attempted to connect to production database at {PROD_DB_PATH}! "
                "Tests must mock db calls or redirect DB_PATH to tmp_path."
            )
        return orig_get_conn()

    monkeypatch.setattr(db_mod, "get_db_connection", guarded_get_conn)


@pytest.fixture(autouse=True)
def _cleanup_stage_state():
    yield
    from backend.mcp import server
    with server._STAGE_LOCK:
        server._STAGE_FUTURES.clear()
        server._STAGE_CANCEL.clear()


def _patch_db(monkeypatch, proj):
    calls = {}
    records = {
        "projects": {proj["id"]: dict(proj)} if proj else {},
        "tasks": {},
    }

    def fake_get_project(pid):
        p = records["projects"].get(pid)
        return dict(p) if p is not None else None

    def fake_get_all_projects():
        return [dict(p) for p in records["projects"].values()]

    def fake_update_project(pid, **kw):
        calls.setdefault("update", []).append((pid, kw))
        if pid in records["projects"]:
            records["projects"][pid].update(kw)

    def fake_create_project(name, video_type="", export_folder="", **kw):
        pid = kw.get("id") or f"proj_{len(records['projects']) + 1}"
        p = {
            "id": pid, "name": name, "prompt": video_type, "export_folder": export_folder,
            "status": "created", "language": kw.get("language", "hi"),
            "style": kw.get("style", "nitish_rajput"),
            "duration_mode": kw.get("duration_mode", "medium"),
            "video_format": kw.get("video_format", "landscape"),
            **kw,
        }
        records["projects"][pid] = p
        calls.setdefault("create_project", []).append((pid, p))
        return pid

    def fake_delete_project(pid):
        calls.setdefault("delete_project", []).append(pid)
        records["projects"].pop(pid, None)

    def fake_create_task(pid, step):
        calls.setdefault(f"task:{step}", []).append("created")
        tid = f"{pid}_{step}"
        records["tasks"][tid] = {
            "id": tid, "project_id": pid, "step": step,
            "status": "pending", "progress": 0.0, "message": "",
            "error_message": None,
        }

    def fake_update_task(tid, **kw):
        calls.setdefault(f"upd:{tid}", []).append(kw)
        if tid in records["tasks"]:
            records["tasks"][tid].update(kw)
        else:
            records["tasks"][tid] = {"id": tid, **kw}

    def fake_get_project_tasks(pid):
        return [dict(t) for t in records["tasks"].values() if t.get("project_id") == pid]

    def fake_get_task(tid):
        t = records["tasks"].get(tid)
        return dict(t) if t is not None else None

    monkeypatch.setattr("backend.database.db.get_project", fake_get_project)
    monkeypatch.setattr("backend.database.db.get_all_projects", fake_get_all_projects)
    monkeypatch.setattr("backend.database.db.update_project", fake_update_project)
    monkeypatch.setattr("backend.database.db.create_project", fake_create_project)
    monkeypatch.setattr("backend.database.db.delete_project", fake_delete_project)
    monkeypatch.setattr("backend.database.db.create_task", fake_create_task)
    monkeypatch.setattr("backend.database.db.update_task", fake_update_task)
    monkeypatch.setattr("backend.database.db.get_task", fake_get_task)
    monkeypatch.setattr("backend.database.db.get_project_tasks", fake_get_project_tasks)
    calls["records"] = records
    return calls


# ── script validation ───────────────────────────────────────────────

def test_validate_script_accepts_good_payload():
    assert payloads.validate_script_payload(_script()) == []


def test_validate_script_rejects_bad_payloads():
    bad = _script()
    bad["introduction"] = {"hook": "   "}
    assert any("hook" in e for e in payloads.validate_script_payload(bad))
    bad = _script()
    bad["scenes"][1] = {"title": "x", "narration": ""}
    assert any("scenes[1]" in e for e in payloads.validate_script_payload(bad))
    bad = _script()
    bad["conclusion"] = {"summary": ""}
    assert any("summary" in e for e in payloads.validate_script_payload(bad))
    assert payloads.validate_script_payload("nope") != []


def test_build_script_document_numbers_scenes_and_clears_visuals():
    doc = payloads.build_script_document(_script(), _proj())
    assert [s["scene_number"] for s in doc["scenes"]] == [1, 2]
    assert doc["introduction"]["sub_visuals"] == []
    assert all(s["sub_visuals"] == [] for s in doc["scenes"])
    assert doc["conclusion"]["sub_visuals"] == []
    assert doc["_project_hash"] == payloads.compute_project_script_hash(_proj())


# ── save_script ─────────────────────────────────────────────────────

def test_save_script_writes_and_purges(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    calls = _patch_db(monkeypatch, _proj())
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    (proj_dir / "voiceover" / "segment_000.wav").write_bytes(b"x")
    (proj_dir / "voiceover.wav").write_bytes(b"y")
    (proj_dir / "design.json").write_text("{}")
    (proj_dir / "assets").mkdir()
    (proj_dir / "assets" / "asset_001_00_00.mp4").write_bytes(b"z")
    (proj_dir / "assets" / "assets_manifest.json").write_text("[]")

    # Pacing guardrail: 2 scenes is under-scened for medium/landscape, so
    # purge-path tests use force=True (override) explicitly.
    result = payloads.save_script_payload("proj_mcp", _script(), force=True)
    assert result["ok"] is True
    assert result["scene_count"] == 2
    assert "pacing_stats" in result
    assert not (proj_dir / "voiceover.wav").exists()
    assert not (proj_dir / "design.json").exists()
    assert not (proj_dir / "assets" / "asset_001_00_00.mp4").exists()

    doc = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    assert doc["title"] == "Test Title"
    (pid, kw), = calls["update"]
    assert pid == "proj_mcp" and kw["name"] == "Test Title"
    assert kw["audio_path"] is None and kw["status"] == "created"
    # Gap fix: the generate_script task row must exist or the GUI shows
    # WAITING forever (update_task on a missing row is a silent no-op).
    assert calls.get("task:generate_script") == ["created"]
    assert calls["upd:proj_mcp_generate_script"][-1]["status"] == "completed"


def test_save_script_rejects_invalid_without_touching_disk(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    bad = _script()
    bad["scenes"] = []
    result = payloads.save_script_payload("proj_mcp", bad)
    assert result["ok"] is False
    assert not (tmp_path / "proj_mcp" / "script.json").exists()


def _script_n(n, words_per_scene=35):
    filler = " ".join(["word"] * words_per_scene)
    return {
        "title": "Pacing Test",
        "introduction": {"hook": "Hook here for pacing test."},
        "scenes": [
            {"title": f"Scene {i + 1}", "narration": f"{filler} {i}."}
            for i in range(n)
        ],
        "conclusion": {"summary": "Closing summary.", "cta": "Subscribe."},
    }


def test_pacing_matrix_all_formats():
    from backend.mcp.pacing import get_pacing
    cases = [
        # dm, vf, secs, min, max, per_scene_time, per_scene_words(en)
        ("medium", "landscape", 300, 20, 30, 9, 27),
        ("long", "landscape", 600, 40, 55, 10, 30),
        ("extra_long", "landscape", 900, 60, 75, 11, 33),
        ("short", "portrait", 60, 4, 6, 7, 21),
        ("medium", "portrait", 90, 6, 8, 9, 27),
        ("long", "portrait", 120, 8, 12, 8, 24),
    ]
    for dm, vf, secs, mn, mx, pst, psw in cases:
        p = get_pacing(dm, vf, "en")
        assert p["target_duration_seconds"] == secs, (dm, vf)
        assert (p["min_scenes"], p["max_scenes"]) == (mn, mx), (dm, vf)
        assert p["per_scene_time"] == pst, (dm, vf, p["per_scene_time"])
        assert p["per_scene_words"] == psw, (dm, vf, p["per_scene_words"])
        assert "{min_scenes}" not in str(p)


def test_save_script_rejects_under_scened_5min(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())  # medium/landscape -> 20-30 scenes
    result = payloads.save_script_payload("proj_mcp", _script_n(5))
    assert result["ok"] is False
    assert result.get("error_code") == "SCRIPT_PACING_ERROR"
    assert result["expected_scenes"]["min"] == 20
    assert result["expected_scenes"]["max"] == 30
    assert result["expected_scenes"]["floor"] == 14  # ceil(20*0.7)
    assert result["provided_scenes"] == 5
    assert not (tmp_path / "proj_mcp" / "script.json").exists()


def test_save_script_boundary_floor_ceiling(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())  # floor 14, ceiling 39
    assert payloads.save_script_payload("proj_mcp", _script_n(13))["ok"] is False
    import shutil
    shutil.rmtree(tmp_path / "proj_mcp", ignore_errors=True)
    assert payloads.save_script_payload("proj_mcp", _script_n(14))["ok"] is True
    shutil.rmtree(tmp_path / "proj_mcp", ignore_errors=True)
    assert payloads.save_script_payload("proj_mcp", _script_n(39))["ok"] is True
    shutil.rmtree(tmp_path / "proj_mcp", ignore_errors=True)
    assert payloads.save_script_payload("proj_mcp", _script_n(40))["ok"] is False


def test_save_script_rejects_thin_narration(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    # Right count (20) but 2 words/scene -> ~45 words vs ~900 expected.
    result = payloads.save_script_payload("proj_mcp", _script_n(20, words_per_scene=2))
    assert result["ok"] is False
    assert result.get("error_code") == "SCRIPT_PACING_ERROR"
    assert "Thin narration" in result["error"]


def test_save_script_accepts_proper_5min(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    result = payloads.save_script_payload("proj_mcp", _script_n(20))
    assert result["ok"] is True
    assert result["scene_count"] == 20
    assert result["pacing_stats"]["scene_count"] == 20
    assert result["pacing_stats"]["estimated_duration_seconds"] > 0


def test_save_script_pacing_all_formats(tmp_path, monkeypatch):
    cases = [
        ({"duration_mode": "long", "video_format": "landscape"}, 8, False),
        ({"duration_mode": "long", "video_format": "landscape"}, 40, True),
        ({"duration_mode": "extra_long", "video_format": "landscape"}, 10, False),
        ({"duration_mode": "extra_long", "video_format": "landscape"}, 60, True),
        ({"duration_mode": "short", "video_format": "portrait"}, 2, False),
        ({"duration_mode": "short", "video_format": "portrait"}, 5, True),
        ({"duration_mode": "medium", "video_format": "portrait"}, 3, False),
        ({"duration_mode": "medium", "video_format": "portrait"}, 7, True),
        ({"duration_mode": "long", "video_format": "portrait"}, 4, False),
        ({"duration_mode": "long", "video_format": "portrait"}, 9, True),
    ]
    for overrides, n, should_pass in cases:
        proj = _proj()
        proj.update(overrides)
        _patch_storage(monkeypatch, tmp_path)
        _patch_db(monkeypatch, proj)
        # wipe previous script.json between sub-cases
        import shutil
        shutil.rmtree(tmp_path / "proj_mcp", ignore_errors=True)
        result = payloads.save_script_payload("proj_mcp", _script_n(n))
        assert (result["ok"] is True) == should_pass, (overrides, n, result)


def test_save_script_force_bypasses_pacing(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    result = payloads.save_script_payload("proj_mcp", _script_n(5), force=True)
    assert result["ok"] is True and result["scene_count"] == 5
    assert "warning" in result and "force" in result["warning"].lower()


def test_create_project_rejects_invalid_combo(monkeypatch, tmp_path):
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, None)
    res = server.create_project("Bad Combo", language="en",
                                video_format="landscape", duration_mode="short")
    assert res["ok"] is False and "not valid for" in res["error"]
    res2 = server.create_project("Bad Combo 2", language="en",
                                 video_format="portrait", duration_mode="extra_long")
    assert res2["ok"] is False and "not valid for" in res2["error"]


def test_get_stage_skills_no_project_returns_defaults(monkeypatch):
    from backend.mcp import server
    bundle = server.get_stage_skills("script", "")
    assert bundle["ok"] is True
    assert bundle["outline_targets"]["target_duration_seconds"] == 300
    assert bundle["outline_targets"]["recommended_scenes"] == {"min": 20, "max": 30}


def test_create_project_returns_pacing_targets(monkeypatch, tmp_path):
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, None)
    import uuid
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.core.config.get_exports_dir", lambda: tmp_path / "exports")
    res = server.create_project("Pacing Topic", language="en",
                                video_format="landscape", duration_mode="medium")
    assert res["ok"] is True
    assert res["target_duration_seconds"] == 300
    assert res["target_scene_count"] == {"min": 20, "max": 30}
    assert "get_stage_skills" in res["next_step"]


def test_get_stage_skills_script_returns_outline_targets(monkeypatch):
    from backend.mcp import server
    proj = _proj()
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: dict(proj))
    # satisfy gate irrelevant here; get_stage_skills always returns bundle
    bundle = server.get_stage_skills("script", "proj_mcp")
    assert bundle["ok"] is True
    assert bundle["outline_targets"]["target_duration_seconds"] == 300
    assert bundle["outline_targets"]["recommended_scenes"] == {"min": 20, "max": 30}
    assert "20-30" in bundle["must_follow"][0] or "20" in bundle["must_follow"][0]
    assert "{min_scenes}" not in bundle.get("outline_director", "")
    # portrait short variant
    proj2 = dict(proj, duration_mode="short", video_format="portrait")
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: dict(proj2))
    bundle2 = server.get_stage_skills("script", "proj_mcp")
    assert bundle2["outline_targets"]["recommended_scenes"] == {"min": 4, "max": 6}


def test_project_dir_rejects_escape(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    with pytest.raises(ValueError):
        payloads._project_dir("../evil")


# ── design ──────────────────────────────────────────────────────────

def test_validate_design_requires_keys():
    assert payloads.validate_design_payload({"theme_name": "x"}) != []
    good = {"theme_name": "T", "color_palette": {"primary": "#fff"},
            "typography": {"heading_font": "Inter"}, "css_guidelines": "…",
            "fonts": ["Inter"]}
    assert payloads.validate_design_payload(good) == []


def test_save_design_writes_metadata(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    design = {"theme_name": "T", "color_palette": {"primary": "#fff"},
              "typography": {"heading_font": "Inter"}, "css_guidelines": "…"}
    result = payloads.save_design_payload("proj_mcp", design)
    assert result["ok"] is True and len(result["design_hash"]) == 12
    doc = json.loads((tmp_path / "proj_mcp" / "design.json").read_text(encoding="utf-8"))
    assert doc["_language"] == "hi" and doc["_video_format"] == "landscape"
    assert "_genre" not in doc


# ── visuals ─────────────────────────────────────────────────────────

def _write_manifest(proj_dir: Path):
    manifest = [
        {"index": 0, "section_type": "introduction", "title": "Intro",
         "text": "A hook that draws the viewer in.", "duration": 6.0,
         "sub_visuals": []},
        {"index": 1, "section_type": "scene", "title": "Scene one",
         "text": "First narration.", "duration": 8.0, "sub_visuals": []},
        {"index": 2, "section_type": "scene", "title": "Scene two",
         "text": "Second narration.", "duration": 10.0, "sub_visuals": []},
        {"index": 3, "section_type": "conclusion", "title": "Out",
         "text": "A closing summary. Subscribe.", "duration": 5.0,
         "sub_visuals": []},
    ]
    voice_dir = proj_dir / "voiceover"
    voice_dir.mkdir(parents=True, exist_ok=True)
    (voice_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _text_cut(text="HELLO", duration=99.0):
    return {"composition": {"type": "Sequence", "children": [
        {"type": "Layer",
         "content": {"type": "Text", "text": text},
         "style": {}}]},
        "duration": duration, "transition": "cut"}


def _setup_visuals_proj(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    proj_dir = tmp_path / "proj_mcp"
    proj_dir.mkdir(parents=True, exist_ok=True)
    _write_manifest(proj_dir)
    (proj_dir / "design.json").write_text(json.dumps({
        "theme_name": "T", "color_palette": {}, "typography": {},
        "css_guidelines": "…"}), encoding="utf-8")
    (proj_dir / "script.json").write_text(json.dumps({
        "title": "Test Title",
        "introduction": {"hook": "A hook that draws the viewer in.", "sub_visuals": []},
        "scenes": [
            {"scene_number": 1, "title": "Scene one",
             "narration": "First narration.", "sub_visuals": []},
            {"scene_number": 2, "title": "Scene two",
             "narration": "Second narration.", "sub_visuals": []},
        ],
        "conclusion": {"summary": "A closing summary.", "cta": "Subscribe.",
                       "sub_visuals": []}}), encoding="utf-8")
    return proj_dir


def test_save_visuals_normalizes_durations(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    result = payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=0)
    assert result["ok"] is True
    assert result["total_duration"] == 8.0
    manifest = json.loads((proj_dir / "voiceover" / "manifest.json").read_text(encoding="utf-8"))
    scene_entry = [m for m in manifest if m.get("section_type") == "scene"][0]
    assert len(scene_entry["sub_visuals"]) == 1
    assert scene_entry["_narr_hash"] and scene_entry["_design_hash"]
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    assert len(script["scenes"][0]["sub_visuals"]) == 1


def test_save_visuals_auto_repairs_z_index(tmp_path, monkeypatch):
    # Behavior change (internal-loop parity): stray z_index is stripped
    # server-side instead of rejecting the whole section. The strict
    # validator contract is unchanged (see test_visual_validation.py).
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut()
    cut["composition"]["children"][0]["z_index"] = 5
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert any("z_index" in f for f in result["auto_fixed"])
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    layer = script["introduction"]["sub_visuals"][0]["composition"]["children"][0]
    assert "z_index" not in layer
    # Caller's object untouched (deepcopy before repair).
    assert cut["composition"]["children"][0]["z_index"] == 5


def test_save_visuals_auto_migrates_legacy_by_default(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    legacy = {"layers": [
        {"type": "Text", "text": "HELLO", "layout": "center"}],
        "duration": 6.0}
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [legacy])
    assert result["ok"] is True
    assert any("best-effort conversion" in f for f in result["auto_fixed"])
    assert "review" in result.get("warning", "").lower()
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    kids = script["introduction"]["sub_visuals"][0]["composition"]["children"]
    assert isinstance(kids, list) and len(kids) >= 1


def test_save_visuals_requires_design(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    (proj_dir / "design.json").unlink()
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [_text_cut()])
    assert result["ok"] is False and "design" in result["error"].lower()


def test_save_visuals_scene_index_out_of_range(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    result = payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=9)
    assert result["ok"] is False and "out of range" in result["error"]


def test_save_visuals_sets_assets_manifest_path(tmp_path, monkeypatch):
    # Regression: MCP-authored visuals left assets_manifest_path=None, so the
    # editor loaded an empty manifest (timeline clicks resolved to null).
    _setup_visuals_proj(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    assert calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path") is None
    result = payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=0)
    assert result["ok"] is True
    pointer = calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path")
    assert pointer is not None and pointer.endswith("manifest.json")


def test_clear_then_save_restores_manifest_path(tmp_path, monkeypatch):
    # clear_visuals legitimately clears the pointer; the next persist must
    # restore it, otherwise the editor stays dead after re-authoring.
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    assert payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=0)["ok"] is True
    assert calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path") is not None
    cleared = payloads.clear_visuals_payload("proj_mcp", clear_assets=True)
    assert cleared["ok"] is True
    assert calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path") is None
    assert payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=0)["ok"] is True
    pointer = calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path")
    assert pointer is not None and Path(pointer).exists()
    # files the editor needs are coherent again
    manifest = json.loads((proj_dir / "voiceover" / "manifest.json").read_text(encoding="utf-8"))
    assert len([m for m in manifest if m.get("section_type") == "scene"][0]["sub_visuals"]) == 1


def test_repair_manifest_pointers_backfills(tmp_path, monkeypatch):
    from backend.pipeline import assets as assets_mod
    _patch_storage(monkeypatch, tmp_path)
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    (proj_dir / "voiceover" / "manifest.json").write_text(
        json.dumps([{"section_type": "scene", "duration": 8.0}]), encoding="utf-8")
    proj = dict(_proj(), assets_manifest_path=None)
    monkeypatch.setattr("backend.database.db.get_all_projects", lambda: [dict(proj)])
    updated = {}
    monkeypatch.setattr("backend.database.db.update_project",
                        lambda pid, **kw: updated.setdefault(pid, {}).update(kw))
    assert assets_mod.repair_manifest_pointers() == 1
    assert updated["proj_mcp"]["assets_manifest_path"].endswith("manifest.json")


def test_repair_manifest_pointers_skips_empty_and_corrupt(tmp_path, monkeypatch):
    # Empty/corrupt manifests are useless to the editor — pinning them would
    # only fake health while every load still falls through to fallback.
    from backend.pipeline import assets as assets_mod
    _patch_storage(monkeypatch, tmp_path)
    empty_dir = tmp_path / "empty"
    (empty_dir / "voiceover").mkdir(parents=True)
    (empty_dir / "voiceover" / "manifest.json").write_text("[]", encoding="utf-8")
    corrupt_dir = tmp_path / "corrupt"
    (corrupt_dir / "voiceover").mkdir(parents=True)
    (corrupt_dir / "voiceover" / "manifest.json").write_text("{not json", encoding="utf-8")
    projects = [dict(_proj("empty"), assets_manifest_path=None),
                dict(_proj("corrupt"), assets_manifest_path=None)]
    monkeypatch.setattr("backend.database.db.get_all_projects",
                        lambda: [dict(p) for p in projects])
    updated = {}
    monkeypatch.setattr("backend.database.db.update_project",
                        lambda pid, **kw: updated.setdefault(pid, {}).update(kw))
    assert assets_mod.repair_manifest_pointers() == 0
    assert updated == {}


def test_repair_manifest_pointers_skips_healthy_and_missing(tmp_path, monkeypatch):
    from backend.pipeline import assets as assets_mod
    _patch_storage(monkeypatch, tmp_path)
    healthy_dir = tmp_path / "healthy"
    (healthy_dir / "voiceover").mkdir(parents=True)
    good = healthy_dir / "voiceover" / "manifest.json"
    good.write_text(json.dumps([{"section_type": "scene"}]), encoding="utf-8")
    projects = [dict(_proj("healthy"), assets_manifest_path=str(good)),
                dict(_proj("ghost"), assets_manifest_path=None)]
    monkeypatch.setattr("backend.database.db.get_all_projects",
                        lambda: [dict(p) for p in projects])
    updated = {}
    monkeypatch.setattr("backend.database.db.update_project",
                        lambda pid, **kw: updated.setdefault(pid, {}).update(kw))
    assert assets_mod.repair_manifest_pointers() == 0
    assert updated == {}


def test_save_visuals_dry_run_does_not_set_pointer(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    result = payloads.save_visuals_payload(
        "proj_mcp", "scene", [_text_cut()], scene_index=0, dry_run=True)
    assert result["ok"] is True
    assert calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path") is None


def test_failed_save_leaves_pointer_untouched(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    (tmp_path / "proj_mcp" / "design.json").unlink()
    result = payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=0)
    assert result["ok"] is False
    assert calls["records"]["projects"]["proj_mcp"].get("assets_manifest_path") is None


def test_get_section_timings(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    result = payloads.get_section_timings("proj_mcp", include_words=False)
    assert result["ok"] is True
    assert result["total_duration"] == 29.0
    assert [s["section_type"] for s in result["sections"]] == [
        "introduction", "scene", "scene", "conclusion"]
    assert result["sections"][1]["scene_index"] == 0
    assert result["sections"][1]["duration"] == 8.0


def test_get_section_timings_no_manifest(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    (tmp_path / "proj_mcp").mkdir(parents=True)
    result = payloads.get_section_timings("proj_mcp")
    assert result["ok"] is False and "voiceover" in result["error"].lower()


# ── server-level guards ─────────────────────────────────────────────

# ── http_host (autostart port resolution) ───────────────────────────

def test_resolve_mcp_port_prefers_free_preferred():
    from backend.mcp import http_host
    port = http_host._free_port()
    assert http_host.resolve_mcp_port(port) == port


def test_resolve_mcp_port_falls_back_when_busy():
    import socket
    from backend.mcp import http_host
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.bind(("127.0.0.1", 0))
    busy = holder.getsockname()[1]
    try:
        picked = http_host.resolve_mcp_port(busy)
        assert picked != busy
        assert http_host._port_available(picked)
    finally:
        holder.close()


def test_resolve_mcp_port_env_override(monkeypatch):
    from backend.mcp import http_host
    port = http_host._free_port()
    monkeypatch.setenv("NARRATO_MCP_PORT", str(port))
    assert http_host.resolve_mcp_port() == port
    monkeypatch.setenv("NARRATO_MCP_PORT", "not-a-port")
    fallback = http_host.resolve_mcp_port()
    assert isinstance(fallback, int) and http_host._port_available(fallback)


def test_start_mcp_http_server_respects_disable(monkeypatch):
    from backend.mcp import http_host
    monkeypatch.setenv("NARRATO_MCP_DISABLE", "1")
    assert http_host.start_mcp_http_server() == (None, None)


# ── P0: voice settings, deletion, inspection ────────────────────────

def test_validate_voice_settings():
    from backend.mcp import payloads as p
    errors, cols = p.validate_voice_settings({"tts_engine": "edge",
                                              "tts_voice": "hi-IN-SwaraNeural",
                                              "tts_speed": 1.2,
                                              "bg_music_volume": 0.1})
    assert errors == [] and cols["tts_speed"] == 1.2
    errors, _ = p.validate_voice_settings({"tts_engine": "azure"})
    assert any("tts_engine" in e for e in errors)
    errors, _ = p.validate_voice_settings({"tts_engine": "edge", "tts_voice": "Bob"})
    assert any("Neural" in e for e in errors)
    errors, _ = p.validate_voice_settings({"tts_speed": 5})
    assert any("tts_speed" in e for e in errors)
    errors, _ = p.validate_voice_settings({"openai_api_key": "x"})
    assert any("unknown setting" in e for e in errors)
    errors, _ = p.validate_voice_settings({})
    assert errors != []


def test_update_voice_settings_resets_voice_stages(monkeypatch):
    calls = _patch_db(monkeypatch, _proj())
    result = payloads.update_voice_settings(
        "proj_mcp", {"tts_voice": "en-US-AndrewNeural", "tts_engine": "edge"})
    assert result["ok"] is True
    (pid, kw), = calls["update"]
    assert pid == "proj_mcp" and kw["tts_voice"] == "en-US-AndrewNeural"
    assert "upd:proj_mcp_generate_voiceover" in calls
    assert "upd:proj_mcp_transcribe" in calls
    assert "upd:proj_mcp_render" in calls
    # Visuals/assets must NOT be invalidated by a voice change.
    assert "upd:proj_mcp_generate_visuals" not in calls
    assert "upd:proj_mcp_fetch_assets" not in calls


def test_delete_project_payload(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    calls = _patch_db(monkeypatch, _proj())
    proj_dir = tmp_path / "proj_mcp"
    proj_dir.mkdir(parents=True)
    (proj_dir / "script.json").write_text("{}")
    result = payloads.delete_project_payload("proj_mcp")
    assert result == {"ok": True, "project_id": "proj_mcp"}
    assert "proj_mcp" in calls["delete_project"]
    assert not proj_dir.exists()


def test_list_and_read_project_files(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    (proj_dir / "script.json").write_text('{"title": "T"}', encoding="utf-8")
    (proj_dir / "voiceover" / "segment_000.wav").write_bytes(b"\x00" * 10)

    listing = payloads.list_project_files_payload("proj_mcp")
    assert listing["ok"] is True and listing["count"] == 2
    assert {f["path"] for f in listing["files"]} == {
        "script.json", "voiceover/segment_000.wav"}

    text = payloads.read_project_file_payload("proj_mcp", "script.json")
    assert text["ok"] is True and '"title": "T"' in text["content"]
    assert text["offset"] == 0
    assert text["truncated"] is False

    # Test reading with offset
    paged = payloads.read_project_file_payload("proj_mcp", "script.json", offset=2, max_chars=5)
    assert paged["ok"] is True and paged["content"] == 'title'
    assert paged["offset"] == 2
    assert paged["truncated"] is True
    assert "note" in paged

    binary = payloads.read_project_file_payload("proj_mcp", "voiceover/segment_000.wav")
    assert binary["ok"] is True and binary["binary"] is True and binary["size"] == 10

    assert payloads.read_project_file_payload("proj_mcp", "../evil.json")["ok"] is False
    assert payloads.read_project_file_payload("proj_mcp", "missing.json")["ok"] is False


def test_server_search_media_validates(monkeypatch):
    from backend.mcp import server
    assert server.search_media("google", "cats").get("ok") is False
    assert server.search_media("pexels_photo", "   ").get("ok") is False
    # No network: stub the internal tool to prove delegation wiring.
    monkeypatch.setattr("backend.agent.tools.execute_tool",
                        lambda name, args: f"URL({name},{args['query']})")
    result = server.search_media("pexels_photo", "monsoon clouds")
    assert result["ok"] is True and "pexels_photo" in result["result"]
    result_arc_p = server.search_media("archive_photo", "apollo 11")
    assert result_arc_p["ok"] is True and "search_archive_photo" in result_arc_p["result"]
    result_arc_v = server.search_media("archive_video", "apollo 11 launch")
    assert result_arc_v["ok"] is True and "search_archive_video" in result_arc_v["result"]
    result = server.web_search("   ")
    assert result["ok"] is False


def test_server_search_media_propagates_tool_errors(monkeypatch):
    from backend.mcp import server
    monkeypatch.setattr("backend.agent.tools.execute_tool",
                        lambda name, args: "Error: Pexels API key not configured.")
    result = server.search_media("pexels_photo", "cats")
    assert result["ok"] is False and "Pexels" in result["error"]


def test_cancel_stage_no_worker():
    from backend.mcp import server
    assert server.cancel_stage("proj_mcp", "generate_script").get("ok") is False
    result = server.cancel_stage("proj_mcp", "transcribe")
    assert result["ok"] is False and "No running" in result["error"]


def test_cancel_stage_signals_event(monkeypatch):
    import threading
    from backend.mcp import server
    monkeypatch.setattr("backend.database.db.update_task", lambda tid, **kw: None)
    event = threading.Event()
    task_id = "proj_mcp_transcribe"
    with server._STAGE_LOCK:
        server._STAGE_CANCEL[task_id] = event
    try:
        result = server.cancel_stage("proj_mcp", "transcribe")
        assert result["ok"] is True and result["cancel_requested"] is True
        assert event.is_set()
    finally:
        with server._STAGE_LOCK:
            server._STAGE_CANCEL.pop(task_id, None)


# Review fixes: serialization, failure mapping, validation ──────────

def test_run_stage_serializes_per_project(tmp_path, monkeypatch):
    import threading
    import time
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    started = threading.Event()
    done = threading.Event()

    def slow_runner(proj_dict, proj_dir, progress_cb, cancel_event):
        started.set()
        assert done.wait(timeout=10)

    import types
    import sys
    fake_mod = types.ModuleType("fake_mcp_serial_mod")
    fake_mod.slow_runner = slow_runner
    monkeypatch.setitem(sys.modules, "fake_mcp_serial_mod", fake_mod)
    monkeypatch.setitem(server._STAGE_RUNNERS, "transcribe",
                        ("fake_mcp_serial_mod", "slow_runner", False))
    t = threading.Thread(target=server.run_stage,
                         args=("proj_mcp", "transcribe"), kwargs={"wait": False})
    t.start()
    assert started.wait(timeout=10)
    try:
        # Same project, any (non-gated) stage/mode -> rejected while busy.
        busy = server.run_stage("proj_mcp", "fetch_assets", wait=False)
        assert busy["ok"] is False and "already has a running" in busy["error"]
        busy_sync = server.run_stage("proj_mcp", "transcribe", wait=True)
        assert busy_sync["ok"] is False and "already has a running" in busy_sync["error"]
        # The render gate fires before the busy check by design.
        gated = server.run_stage("proj_mcp", "render", wait=False)
        assert gated["ok"] is False and gated.get("needs_confirmation") is True
        # Registry is per-project: other projects report no active stage.
        with server._STAGE_LOCK:
            assert server._project_active_stage("other_proj") is None
            assert server._project_active_stage("proj_mcp") == "proj_mcp_transcribe"
    finally:
        done.set()
        t.join(timeout=10)
        with server._STAGE_LOCK:
            server._STAGE_FUTURES.pop("proj_mcp_transcribe", None)
            server._STAGE_CANCEL.pop("proj_mcp_transcribe", None)


def test_worker_prefailure_marks_task_failed(monkeypatch):
    from backend.mcp import server
    calls = _patch_db(monkeypatch, None)
    result = server._execute_stage_blocking("ghost", "transcribe")
    assert result["ok"] is False and "not found" in result["error"]
    assert calls["records"]["tasks"]["ghost_transcribe"]["status"] == "failed"


def test_project_not_completed_by_single_stage(monkeypatch):
    from backend.mcp import server
    proj = _proj()
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: dict(proj))
    monkeypatch.setattr("backend.database.db.get_project_tasks", lambda pid: [
        {"step": "generate_voiceover", "status": "completed"},
        {"step": "transcribe", "status": "pending"},
    ])
    statuses = {}
    monkeypatch.setattr("backend.database.db.update_project",
                        lambda pid, **kw: statuses.update(kw))
    monkeypatch.setattr("backend.database.db.create_task", lambda pid, step: None)
    monkeypatch.setattr("backend.database.db.update_task", lambda tid, **kw: None)
    server._maybe_complete_project("proj_mcp")
    assert "status" not in statuses  # pending remains -> no completion claim
    monkeypatch.setattr("backend.database.db.get_project_tasks", lambda pid: [
        {"step": "generate_voiceover", "status": "completed"},
        {"step": "transcribe", "status": "completed"},
    ])
    server._maybe_complete_project("proj_mcp")
    assert statuses.get("status") == "completed"


def test_create_project_validates_all_fields(monkeypatch):
    from backend.mcp import server
    base = dict(language="hi",
                video_format="landscape", duration_mode="medium")
    assert server.create_project("x", **{**base, "duration_mode": "huge"}).get("ok") is False
    assert server.create_project("x", **{**base, "language": "hindi"}).get("ok") is False
    assert server.create_project("x", **{**base, "language": "fr"}).get("ok") is False
    assert server.create_project("x", **{**base, "export_folder": "../evil"}).get("ok") is False
    # Missing required intake fields must fail fast, not silently default.
    assert server.create_project("x").get("ok") is False


def test_create_project_schema_and_instructions():
    from backend.mcp import server
    assert server.mcp.instructions is not None
    assert "MANDATORY PROJECT INTAKE PROTOCOL" in server.mcp.instructions
    assert "preset genre" in server.mcp.instructions.lower() or "no preset" in server.mcp.instructions.lower()
    tools = [t for t in server.mcp._tool_manager.list_tools()]
    cp = next(t for t in tools if t.name == "create_project")
    params = cp.parameters
    assert "name" in params["required"]
    assert "genre" not in params["required"]
    assert "genre" not in params["properties"]
    assert "language" in params["required"]
    assert "video_format" in params["required"]
    assert "duration_mode" in params["required"]
    assert set(params["properties"]["language"]["enum"]) == {"hi", "en"}
    assert set(params["properties"]["video_format"]["enum"]) == {"landscape", "portrait"}
    assert set(params["properties"]["duration_mode"]["enum"]) == {"short", "medium", "long", "extra_long"}


def test_manifest_resolver_matches_pipeline(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    (proj_dir / "assets").mkdir(parents=True)
    (proj_dir / "voiceover" / "manifest.json").write_text("[]", encoding="utf-8")
    (proj_dir / "assets" / "assets_manifest.json").write_text("[]", encoding="utf-8")
    from backend.pipeline.assets import _resolve_manifest_path as pipe_resolve
    got = payloads._active_manifest_path({}, proj_dir)
    assert got == pipe_resolve({}, proj_dir)
    assert got.name == "manifest.json"  # voiceover wins per pipeline order


def test_host_double_start_returns_existing(monkeypatch):
    import threading
    from backend.mcp import http_host
    marker = threading.Thread()
    monkeypatch.setattr(http_host, "_mcp_thread", marker)
    monkeypatch.setattr(http_host, "_mcp_url", "http://127.0.0.1:1/mcp")
    # A dead thread is not "already running" -> would proceed; fake alive.
    monkeypatch.setattr(marker, "is_alive", lambda: True)
    thread, url = http_host.start_mcp_http_server()
    assert (thread, url) == (marker, "http://127.0.0.1:1/mcp")


def test_build_review_pairs_cells_on_partial_failure(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    from PIL import Image as _Img
    calls = {"n": 0}

    def flaky(video_path, timestamp, width=640):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return _Img.new("RGB", (width, 360), (calls["n"] * 40, 100, 150))

    monkeypatch.setattr(frames, "grab_render_frame", flaky)
    meta, jpeg = frames.build_review("proj_mcp", "scene", scene_index=0,
                                     cut_index=1, scope="cut", mode="render")
    # middle cell failed -> surviving cells keep THEIR OWN timestamps
    assert [c["timestamp"] for c in meta["cells"]] == [7.9, 12.1]
    assert jpeg[:2] == b"\xff\xd8"


def test_server_create_project_validates(monkeypatch):
    from backend.mcp import server
    assert server.create_project("").get("ok") is False
    base = dict(language="hi",
                duration_mode="medium")
    assert server.create_project("", **base, video_format="landscape").get("ok") is False
    assert server.create_project("x", **{**base, "video_format": "imax"}).get("ok") is False
    assert server.create_project("x", **{**base, "video_format": "square"}).get("ok") is False


# update_transcribe_settings ──────────────────────────────────────────

def test_best_model_picker_knows_turbo(monkeypatch):
    from backend.pipeline.transcribe import get_best_downloaded_whisper_model
    monkeypatch.setattr("backend.pipeline.transcribe.list_downloaded_whisper_models",
                        lambda: [{"id": "turbo", "size_mb": 1500.0}])
    assert get_best_downloaded_whisper_model() == "turbo"
    monkeypatch.setattr("backend.pipeline.transcribe.list_downloaded_whisper_models",
                        lambda: [])
    assert get_best_downloaded_whisper_model() == "small"


def test_validate_transcribe_settings(monkeypatch):
    from backend.mcp import payloads as p
    monkeypatch.setattr("backend.pipeline.transcribe.list_downloaded_whisper_models",
                        lambda: [{"id": "turbo", "size_mb": 1.0}])
    errors, cols = p.validate_transcribe_settings(
        {"whisper_model": "turbo", "whisper_device": "cuda"})
    assert errors == [] and cols == {"whisper_model": "turbo",
                                     "whisper_device": "cuda"}
    errors, _ = p.validate_transcribe_settings({"whisper_model": "huge-v9"})
    assert any("Unknown whisper_model" in e for e in errors)
    errors, _ = p.validate_transcribe_settings({"whisper_device": "tpu"})
    assert any("whisper_device" in e for e in errors)
    errors, _ = p.validate_transcribe_settings({"tts_voice": "x"})
    assert any("unknown setting" in e for e in errors)
    # repo ids and custom downloaded ids are accepted
    errors, cols = p.validate_transcribe_settings(
        {"whisper_model": "deepdml/faster-whisper-large-v3-turbo-ct2"})
    assert errors == []


def test_update_transcribe_settings_resets_downstream(monkeypatch):
    calls = _patch_db(monkeypatch, _proj())
    monkeypatch.setattr("backend.pipeline.transcribe.list_downloaded_whisper_models",
                        lambda: [{"id": "turbo", "size_mb": 1.0}])
    monkeypatch.setattr("backend.pipeline.transcribe.check_whisper_assets",
                        lambda m: True)
    result = payloads.update_transcribe_settings(
        "proj_mcp", {"whisper_model": "turbo"})
    assert result["ok"] is True and result["downloaded"] is True
    (pid, kw), = calls["update"]
    assert pid == "proj_mcp"
    import json as _json
    assert _json.loads(kw["project_settings"])["whisper_model"] == "turbo"
    assert "upd:proj_mcp_transcribe" in calls
    assert "upd:proj_mcp_render" in calls
    # voiceover/assets must NOT be invalidated by a model change
    assert "upd:proj_mcp_generate_voiceover" not in calls
    assert "upd:proj_mcp_fetch_assets" not in calls


def test_update_transcribe_settings_warns_when_missing(monkeypatch):
    _patch_db(monkeypatch, _proj())
    monkeypatch.setattr("backend.pipeline.transcribe.list_downloaded_whisper_models",
                        lambda: [])
    monkeypatch.setattr("backend.pipeline.transcribe.check_whisper_assets",
                        lambda m: False)
    result = payloads.update_transcribe_settings(
        "proj_mcp", {"whisper_model": "medium"})
    assert result["ok"] is True and result["downloaded"] is False
    assert "warning" in result


def test_server_run_stage_rejects_llm_stages():
    from backend.mcp import server
    assert server.run_stage("whatever", "generate_script").get("ok") is False
    assert server.run_stage("whatever", "generate_visuals").get("ok") is False


# render review gate ──────────────────────────────────────────────────

def test_render_refused_without_confirmation(monkeypatch):
    from backend.mcp import server
    created = []
    monkeypatch.setattr("backend.database.db.create_task",
                        lambda pid, step: created.append((pid, step)))
    for wait in (True, False):
        result = server.run_stage("proj_mcp", "render", wait=wait)
        assert result["ok"] is False
        assert result.get("needs_confirmation") is True
        assert "confirm_render=true" in result["error"]
    assert created == []  # gate refuses before touching task rows


def test_render_proceeds_with_confirmation(tmp_path, monkeypatch):
    import sys
    import types
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())

    def fake_render(proj_dict, proj_dir, progress_cb, cancel_event, force=False):
        progress_cb(100.0, "done")

    fake_mod = types.ModuleType("fake_mcp_render_mod")
    fake_mod.fake_render = fake_render
    monkeypatch.setitem(sys.modules, "fake_mcp_render_mod", fake_mod)
    monkeypatch.setitem(server._STAGE_RUNNERS, "render",
                        ("fake_mcp_render_mod", "fake_render", True))
    result = server.run_stage("proj_mcp", "render", wait=True, confirm_render=True)
    assert result["ok"] is True and result["stage"] == "render"


def test_stage_status_unknown_task(monkeypatch):
    from backend.mcp import server
    _patch_db(monkeypatch, None)
    result = server.stage_status("proj_mcp", "transcribe")
    assert result["ok"] is False and "run_stage" in result["error"]
    assert server.stage_status("proj_mcp", "generate_script").get("ok") is False


def test_run_stage_no_wait_accepts_and_completes(monkeypatch, tmp_path):
    import sys
    import types
    from backend.mcp import server

    _patch_storage(monkeypatch, tmp_path)
    calls = _patch_db(monkeypatch, _proj())

    done = threading.Event()
    finish_runner = threading.Event()

    def fake_runner(proj_dict, proj_dir, progress_cb, cancel_event):
        progress_cb(50.0, "halfway")
        done.set()
        assert finish_runner.wait(timeout=10)

    fake_mod = types.ModuleType("fake_mcp_stage_mod")
    fake_mod.fake_runner = fake_runner
    monkeypatch.setitem(sys.modules, "fake_mcp_stage_mod", fake_mod)
    monkeypatch.setitem(server._STAGE_RUNNERS, "transcribe",
                        ("fake_mcp_stage_mod", "fake_runner", False))

    try:
        accepted = server.run_stage("proj_mcp", "transcribe", wait=False)
        assert accepted.get("accepted") is True
        assert done.wait(timeout=10)
        future = server._STAGE_FUTURES.get("proj_mcp_transcribe")
        assert future is not None
        finish_runner.set()
        future.result(timeout=10)
        assert future.done()

        calls["records"]["tasks"]["proj_mcp_transcribe"] = {
            "id": "proj_mcp_transcribe", "project_id": "proj_mcp",
            "step": "transcribe", "status": "completed",
            "progress": 100.0, "message": "Step completed (MCP).",
            "error_message": None,
        }
        status = server.stage_status("proj_mcp", "transcribe")
        assert status["ok"] is True and status["status"] == "completed"
        assert status["worker_running"] is False
    finally:
        finish_runner.set()
        with server._STAGE_LOCK:
            server._STAGE_FUTURES.pop("proj_mcp_transcribe", None)
            server._STAGE_CANCEL.pop("proj_mcp_transcribe", None)


# review_frame: contact-sheet snapshots ───────────────────────────────

def _review_fixtures(tmp_path, monkeypatch, with_video=True, with_media=True):
    _patch_storage(monkeypatch, tmp_path)
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    if with_video:
        (proj_dir / "render.mp4").write_bytes(b"fake")
    media = []
    if with_media:
        from PIL import Image as _Img
        _Img.new("RGB", (64, 36), (200, 30, 30)).save(proj_dir / "bg.jpg")
        media = [{"type": "Layer",
                  "content": {"type": "Image", "query": "red wall",
                              "local_path": str(proj_dir / "bg.jpg")}}]
    script = {
        "title": "T",
        "introduction": {"hook": "H", "sub_visuals": []},
        "scenes": [
            {"scene_number": 1, "title": "S1", "narration": "N1",
             "sub_visuals": [
                 {"composition": {"type": "Sequence", "children": media},
                  "duration": 4.0, "transition": "cut"},
                 {"composition": {"type": "Sequence", "children": media},
                  "duration": 6.0, "transition": "cut"},
             ]},
            {"scene_number": 2, "title": "S2", "narration": "N2",
             "sub_visuals": [
                 {"composition": {"type": "Sequence", "children": media},
                  "duration": 5.0, "transition": "cut"},
             ]},
        ],
        "conclusion": {"summary": "C", "cta": "", "sub_visuals": []},
    }
    (proj_dir / "script.json").write_text(json.dumps(script), encoding="utf-8")
    manifest = [
        {"index": 0, "section_type": "introduction", "title": "I",
         "text": "H", "duration": 3.0, "sub_visuals": []},
        {"index": 1, "section_type": "scene", "title": "S1",
         "text": "N1", "duration": 10.0, "sub_visuals": []},
        {"index": 2, "section_type": "scene", "title": "S2",
         "text": "N2", "duration": 5.0, "sub_visuals": []},
        {"index": 3, "section_type": "conclusion", "title": "C",
         "text": "C", "duration": 2.0, "sub_visuals": []},
    ]
    (proj_dir / "voiceover" / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8")
    proj = _proj()
    proj["video_path"] = str(proj_dir / "render.mp4") if with_video else None
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: dict(proj))
    return proj_dir


def test_resolve_render_cut_timestamps(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    plan = frames.resolve_targets("proj_mcp", "scene", scene_index=0,
                                  cut_index=1, scope="cut", mode="render")
    assert plan["mode"] == "render" and plan["layout"] == "strip"
    assert plan["section_start"] == 3.0
    # cut 1 starts at 3.0 + 4.0 = 7.0; fractions of 6.0s
    assert [c["timestamp"] for c in plan["cells"]] == [7.9, 10.0, 12.1]
    assert all(c["cut_index"] == 1 for c in plan["cells"])


def test_resolve_section_scope_single_cut(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    plan = frames.resolve_targets("proj_mcp", "scene", scene_index=1,
                                  scope="section", mode="render", max_cells=5)
    # single-cut section falls back to cut-scope sampling across the cut
    assert len(plan["cells"]) == 5
    assert plan["cells"][0]["timestamp"] == 13.75  # 13.0 + 15% of 5.0
    assert plan["cells"][-1]["timestamp"] == 17.25  # 13.0 + 85% of 5.0


def test_resolve_asset_lineup(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch, with_video=False)
    plan = frames.resolve_targets("proj_mcp", "scene", scene_index=0,
                                  cut_index=0, mode="asset")
    assert plan["mode"] == "asset" and plan["layout"] == "grid"
    assert plan["cells"][0]["kind"] == "Image"
    assert plan["cells"][0]["local_path"].endswith("bg.jpg")


def test_resolve_guards(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch, with_video=False, with_media=False)
    with pytest.raises(ValueError):
        frames.resolve_targets("proj_mcp", "scene", scene_index=9)
    with pytest.raises(ValueError):
        frames.resolve_targets("proj_mcp", "scene", scene_index=0,
                               cut_index=9, mode="render")
    # no video + no media -> actionable error
    with pytest.raises(ValueError, match="Nothing to snapshot"):
        frames.resolve_targets("proj_mcp", "scene", scene_index=0, mode="auto")
    # procedural cut in asset mode
    with pytest.raises(ValueError, match="procedural"):
        frames.resolve_targets("proj_mcp", "scene", scene_index=0, mode="asset")
    # section without visuals
    with pytest.raises(ValueError, match="no authored sub_visuals"):
        frames.resolve_targets("proj_mcp", "introduction", mode="render")


def test_merge_contact_sheet_layouts():
    import io
    from PIL import Image as _Img
    from backend.mcp import frames
    imgs = [_Img.new("RGB", (640, 360), (i * 40, 100, 150)) for i in range(3)]
    jpeg = frames.merge_contact_sheet(imgs, "strip")
    assert jpeg[:2] == b"\xff\xd8"
    out = _Img.open(io.BytesIO(jpeg))
    assert out.width <= frames.MAX_LONG_SIDE
    grid = frames.merge_contact_sheet(imgs[:2], "grid")
    out = _Img.open(io.BytesIO(grid))
    assert out.width == frames.GRID_CELL_WIDTH * 2 + frames.CELL_PAD * 3


def test_even_pick_and_fractions():
    from backend.mcp import frames
    assert frames._even_pick(2, 5) == [0, 1]
    assert frames._even_pick(4, 2) == [0, 3]
    assert frames._even_pick(9, 3) == [0, 4, 8]
    assert frames._even_fractions(3) == [0.15, 0.5, 0.85]


def test_build_review_render_end_to_end(tmp_path, monkeypatch):
    import shutil
    import subprocess
    from pathlib import Path as _Path
    from backend.mcp import frames
    ffmpeg = shutil.which("ffmpeg") or str((_Path("bin/ffmpeg.exe")).absolute())
    if not _Path(ffmpeg).exists():
        pytest.skip("ffmpeg binary not available")
    _patch_storage(monkeypatch, tmp_path)
    proj_dir = tmp_path / "proj_mcp"
    (proj_dir / "voiceover").mkdir(parents=True)
    clip = proj_dir / "render.mp4"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x180:rate=10",
                    "-pix_fmt", "yuv420p", str(clip)],
                   check=True, timeout=60)
    (proj_dir / "script.json").write_text(json.dumps({
        "title": "T", "introduction": {"hook": "H", "sub_visuals": []},
        "scenes": [{"scene_number": 1, "title": "S", "narration": "N",
                    "sub_visuals": [
                        {"composition": {"type": "Sequence", "children": []},
                         "duration": 2.0, "transition": "cut"},
                        {"composition": {"type": "Sequence", "children": []},
                         "duration": 2.0, "transition": "cut"}]}],
        "conclusion": {"summary": "C", "cta": "", "sub_visuals": []}}),
        encoding="utf-8")
    (proj_dir / "voiceover" / "manifest.json").write_text(json.dumps([
        {"index": 0, "section_type": "scene", "title": "S",
         "text": "N", "duration": 4.0, "sub_visuals": []}]),
        encoding="utf-8")
    proj = _proj()
    proj["video_path"] = str(clip)
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: dict(proj))
    meta, jpeg = frames.build_review("proj_mcp", "scene", scope="section")
    assert meta["ok"] is True and meta["mode"] == "render"
    assert len(meta["cells"]) == 2
    assert jpeg[:2] == b"\xff\xd8"


def test_timings_include_start_time(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    result = payloads.get_section_timings("proj_mcp", include_words=False)
    assert [s["start_time"] for s in result["sections"]] == [0.0, 6.0, 14.0, 24.0]


# save_visuals: single-cut patch + dry_run ────────────────────────────

def _seed_section_cuts(tmp_path, monkeypatch):
    """Two-cut scene saved normally; returns (proj_dir, original cuts)."""
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    cuts = [
        {"composition": {"type": "Sequence", "children": [
            {"type": "Layer", "content": {"type": "Text", "text": "AAA"},
             "style": {}}]}, "duration": 4.0, "transition": "cut"},
        {"composition": {"type": "Sequence", "children": [
            {"type": "Layer", "content": {"type": "Text", "text": "BBB"},
             "style": {}}]}, "duration": 4.0, "transition": "cut"},
    ]
    result = payloads.save_visuals_payload("proj_mcp", "scene", cuts, scene_index=0)
    assert result["ok"] is True
    assert result["total_duration"] == 8.0
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    return proj_dir, script["scenes"][0]["sub_visuals"]


def test_patch_single_cut_preserves_others(tmp_path, monkeypatch):
    proj_dir, before = _seed_section_cuts(tmp_path, monkeypatch)
    patched_cut = {"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "ZZZ"},
         "style": {}}]}, "duration": 99.0, "transition": "fade"}
    result = payloads.save_visuals_payload("proj_mcp", "scene", patched_cut,
                                           scene_index=0, cut_index=1)
    assert result["ok"] is True and result["persisted"] is True
    assert result["patched_cut_index"] == 1
    assert result["total_duration"] == 8.0  # renormalized to audio length
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    after = script["scenes"][0]["sub_visuals"]
    assert len(after) == 2
    # cut 0 untouched content, cut 1 replaced (duration rescaled by validator)
    assert after[0]["composition"]["children"][0]["content"]["text"] == "AAA"
    assert after[1]["composition"]["children"][0]["content"]["text"] == "ZZZ"
    assert after[1]["transition"] == "fade"


def test_patch_accepts_single_element_list(tmp_path, monkeypatch):
    _seed_section_cuts(tmp_path, monkeypatch)
    cut = {"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "Q"},
         "style": {}}]}, "duration": 1.0}
    result = payloads.save_visuals_payload("proj_mcp", "scene", [cut],
                                           scene_index=0, cut_index=0)
    assert result["ok"] is True and result["patched_cut_index"] == 0


def test_patch_guards(tmp_path, monkeypatch):
    _seed_section_cuts(tmp_path, monkeypatch)
    cut = {"composition": {"type": "Sequence", "children": []}, "duration": 1.0}
    bad = payloads.save_visuals_payload("proj_mcp", "scene", cut,
                                        scene_index=0, cut_index=7)
    assert bad["ok"] is False and "out of range" in bad["error"]
    multi = payloads.save_visuals_payload(
        "proj_mcp", "scene", [cut, cut], scene_index=0, cut_index=0)
    assert multi["ok"] is False and "exactly one cut" in multi["error"]


def test_dry_run_writes_nothing(tmp_path, monkeypatch):
    proj_dir, before = _seed_section_cuts(tmp_path, monkeypatch)
    manifest_before = (proj_dir / "voiceover" / "manifest.json").read_bytes()
    script_before = (proj_dir / "script.json").read_bytes()
    new_cut = {"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "DRY"},
         "style": {}}]}, "duration": 2.0}
    result = payloads.save_visuals_payload("proj_mcp", "scene", new_cut,
                                           scene_index=0, cut_index=0,
                                           dry_run=True)
    assert result["ok"] is True and result["dry_run"] is True
    assert result["persisted"] is False
    assert result["patched_cut"]["composition"]["children"][0][
        "content"]["text"] == "DRY"
    assert (proj_dir / "voiceover" / "manifest.json").read_bytes() == manifest_before
    assert (proj_dir / "script.json").read_bytes() == script_before


def test_dry_run_whole_section(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    manifest_before = (proj_dir / "voiceover" / "manifest.json").read_bytes()
    cuts = [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "W"},
         "style": {}}]}, "duration": 99.0}]
    result = payloads.save_visuals_payload("proj_mcp", "scene", cuts,
                                           scene_index=0, dry_run=True)
    assert result["ok"] is True and result["persisted"] is False
    assert result["durations"] == [8.0]  # normalized preview
    assert (proj_dir / "voiceover" / "manifest.json").read_bytes() == manifest_before


def test_dry_run_failure_writes_nothing(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    script_before = (proj_dir / "script.json").read_bytes()
    # Non-dict cuts can never validate (z_index no longer fails — it is
    # auto-repaired — so force failure with a garbage cut instead).
    result = payloads.save_visuals_payload("proj_mcp", "scene", ["not-a-cut"],
                                           scene_index=0, dry_run=True)
    assert result["ok"] is False
    assert (proj_dir / "script.json").read_bytes() == script_before


def test_get_visuals_section_and_single_cut(tmp_path, monkeypatch):
    proj_dir, before = _seed_section_cuts(tmp_path, monkeypatch)
    # Get all cuts for section
    all_res = payloads.get_visuals_payload("proj_mcp", "scene", scene_index=0)
    assert all_res["ok"] is True
    assert all_res["count"] == 2
    assert len(all_res["sub_visuals"]) == 2
    assert all_res["sub_visuals"][0]["composition"]["children"][0]["content"]["text"] == "AAA"

    # Get single cut
    cut1_res = payloads.get_visuals_payload("proj_mcp", "scene", scene_index=0, cut_index=1)
    assert cut1_res["ok"] is True
    assert cut1_res["cut_index"] == 1
    assert cut1_res["total_cuts"] == 2
    assert cut1_res["sub_visual"]["composition"]["children"][0]["content"]["text"] == "BBB"

    # Bounds check
    bad_res = payloads.get_visuals_payload("proj_mcp", "scene", scene_index=0, cut_index=5)
    assert bad_res["ok"] is False and "out of range" in bad_res["error"]

    # Invalid section
    bad_sec = payloads.get_visuals_payload("proj_mcp", "invalid_sec")
    assert bad_sec["ok"] is False and "section_type must be one of" in bad_sec["error"]


# review_frame: composition stills ────────────────────────────────────

def test_still_cache_key_busts_on_content_change():
    from backend.mcp import stills
    kw = {"visuals_hash": "vis1"}
    a = stills.still_cache_key("hash1", "design1", 30, **kw)
    assert a == stills.still_cache_key("hash1", "design1", 30, **kw)
    assert a != stills.still_cache_key("hash2", "design1", 30, **kw)
    assert a != stills.still_cache_key("hash1", "design2", 30, **kw)
    assert a != stills.still_cache_key("hash1", "design1", 31, **kw)
    assert a != stills.still_cache_key("hash1", "design1", 30,
                                       visuals_hash="vis2")
    assert a.endswith(".jpg")


def test_resolve_composition_matches_render_math(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    comp = frames.resolve_targets("proj_mcp", "scene", scene_index=0,
                                  cut_index=1, scope="cut", mode="composition")
    rend = frames.resolve_targets("proj_mcp", "scene", scene_index=0,
                                  cut_index=1, scope="cut", mode="render")
    assert comp["mode"] == "composition" and comp["layout"] == "strip"
    assert [c["timestamp"] for c in comp["cells"]] == [
        c["timestamp"] for c in rend["cells"]]
    assert comp["video_path"] is None


def test_build_review_composition_uses_stills_backend(tmp_path, monkeypatch):
    from PIL import Image as _Img
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    grabbed = {}

    def fake_grab(project_id, timestamps):
        grabbed["args"] = (project_id, list(timestamps))
        return [_Img.new("RGB", (640, 360), (10, 20, 30)) for _ in timestamps]

    monkeypatch.setattr("backend.mcp.stills.grab_composition_stills", fake_grab)
    meta, jpeg = frames.build_review("proj_mcp", "scene", cut_index=1,
                                     mode="composition")
    assert meta["ok"] is True and meta["mode"] == "composition"
    assert grabbed["args"] == ("proj_mcp", [7.9, 10.0, 12.1])
    assert jpeg[:2] == b"\xff\xd8"

# Gap fix: startup cleanup must fail running tasks but leave pending intact
def test_init_db_cleanup_preserves_pending(tmp_path, monkeypatch):
    import sqlite3
    from backend.database import db as db_mod
    cleanup_db = tmp_path / "cleanup_test.db"
    monkeypatch.setattr(db_mod, "DB_PATH", cleanup_db)
    monkeypatch.setattr("backend.core.config.DB_PATH", cleanup_db)
    db_mod.init_db()
    conn = sqlite3.connect(tmp_path / "cleanup_test.db")
    now = "2026-01-01T00:00:00"
    conn.execute("INSERT INTO projects (id, name, created_at, updated_at, status) VALUES (?,?,?,?,?)",
                 ("p1", "P", now, now, "processing"))
    conn.execute("INSERT INTO tasks (id, project_id, step, status, updated_at) VALUES (?,?,?,?,?)",
                 ("p1_generate_voiceover", "p1", "generate_voiceover", "running", now))
    conn.execute("INSERT INTO tasks (id, project_id, step, status, updated_at) VALUES (?,?,?,?,?)",
                 ("p1_generate_visuals", "p1", "generate_visuals", "pending", now))
    conn.commit()
    conn.close()
    db_mod.init_db()
    conn = sqlite3.connect(tmp_path / "cleanup_test.db")
    conn.row_factory = sqlite3.Row
    rows = {r["step"]: r["status"] for r in
            conn.execute("SELECT step, status FROM tasks WHERE project_id='p1'")}
    conn.close()
    assert rows["generate_voiceover"] == "failed"
    assert rows["generate_visuals"] == "pending"


def test_list_voice_options(monkeypatch):
    monkeypatch.setattr("backend.database.db.get_setting",
                        lambda k: {"tts_engine": "edge", "tts_voice": "en-US-AvaNeural",
                                   "xtts_profiles": [{"id": "xtts_prof_1", "name": "Clone",
                                                      "reference_voice": "C:/secret.wav"}]}.get(k))
    result = payloads.list_voice_options()
    assert result["ok"] is True
    assert {e["id"] for e in result["engines"]} == {"edge", "xtts", "omnivoice"}
    assert result["edge_suggestions"]["en"][0] == "en-US-AndrewNeural"
    assert result["clone_profiles"] == [{"id": "xtts_prof_1", "name": "Clone"}]
    assert result["global_defaults"]["tts_voice"] == "en-US-AvaNeural"


def test_pipeline_guide_and_prompt():
    from backend.mcp import server
    guide = server.pipeline_guide()
    assert "Stage order" in guide and "ASK" in guide
    assert "generate_visuals is NOT an MCP stage" in guide
    assert "CAPABILITY NOTES" in guide
    assert "declarative-ast" in guide and "review_frame" in guide
    prompt = server.make_video_prompt("black holes")
    assert "black holes" in prompt and "narrato://pipeline-guide" in prompt


def test_list_skills_has_no_alias_duplicates():
    from backend.mcp import server
    result = server.list_skills()
    assert result["ok"] is True
    names = [s["name"] for s in result["skills"]]
    assert len(names) == len(set(names))
    assert "visual-director-core" in names


def test_get_skill_brief_maps_big_skill():
    from backend.mcp import server
    result = server.get_skill("declarative-ast", brief=True)
    assert result["ok"] is True and result["brief"] is True
    assert result["full_chars"] > 8000 and "content" not in result
    titles = [s["title"] for s in result["sections"]]
    assert len(titles) >= 7
    types_sec = next(s for s in result["sections"] if "Content Types" in s["title"])
    assert any("Particles" in h for h in types_sec["subheads"])
    assert all(s["preview"] and s["chars"] > 0 for s in result["sections"])


def test_get_skill_brief_small_skill_returns_full():
    from backend.mcp import server
    result = server.get_skill("scriptwriter", brief=True)
    assert result["ok"] is True and "content" in result


def test_get_skill_section_fuzzy():
    from backend.mcp import server
    by_title = server.get_skill("declarative-ast", section="content types")
    assert by_title["ok"] is True
    assert "Content Types" in by_title["section"]
    assert "Particles" in by_title["content"]
    assert len(by_title["remaining_sections"]) >= 6
    by_subhead = server.get_skill("declarative-ast", section="particles")
    assert by_subhead["ok"] is True
    assert by_subhead["matched_subhead"].startswith("9.")
    by_number = server.get_skill("declarative-ast", section="5")
    assert by_number["ok"] is True and by_number["section"] == "5. Compose Freely (no prescribed looks)"
    miss = server.get_skill("declarative-ast", section="zzz-no-such-part")
    assert miss["ok"] is False and len(miss["available_sections"]) >= 7


def test_get_skill_full_lists_sections():
    from backend.mcp import server
    result = server.get_skill("declarative-ast")
    assert result["ok"] is True and "content" in result
    assert len(result["sections"]) >= 7 and "brief_hint" in result


def test_save_design_warns_palette_only(tmp_path, monkeypatch):
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    bare = {"theme_name": "T", "color_palette": {"primary": "#fff"},
            "typography": {"heading_font": "Inter"}, "css_guidelines": "…"}
    result = payloads.save_design_payload("proj_mcp", bare)
    assert result["ok"] is True and "warning" in result
    rich = dict(bare, motion_language={"transitions": "slide_left for shock beats"})
    result = payloads.save_design_payload("proj_mcp", rich)
    assert result["ok"] is True and "warning" not in result


def test_save_visuals_reports_variety(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cuts = [_text_cut(text=f"BEAT {i}", duration=2.0) for i in range(3)]
    result = payloads.save_visuals_payload("proj_mcp", "scene", cuts,
                                           scene_index=0)
    assert result["ok"] is True
    variety = result["variety"]
    assert variety["kinds_used"] == {"Text": 3}
    assert set(variety["unused_kinds"]) >= {"Map", "Lottie", "Particles",
                                            "Chart"}
    assert variety["max_template_run"]["length"] == 3
    assert any("repetition" in n for n in variety["normalizations"])


def test_save_visuals_flags_transition_remap(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut(duration=8.0)
    cut["transition"] = "subtle_slide"
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert any("subtle_slide" in n and "slide_left" in n
               for n in result["variety"]["normalizations"])


def test_save_visuals_counts_energy_moments(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut(duration=8.0)
    cut["transition"] = "glitch"
    cut["emphasis"] = [{"at": 1.0, "scale": 1.2, "duration": 0.5}]
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert result["variety"]["energy_cuts"] == 1


def test_save_visuals_accepts_new_transitions_and_exit(tmp_path, monkeypatch):
    from backend.agent.validators import VALID_TRANSITIONS
    for t in ("blur_focus", "flash", "wipe_right", "iris_open", "rise", "flip"):
        assert t in VALID_TRANSITIONS
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut(duration=8.0)
    cut["transition"] = "iris_open"
    cut["exit_transition"] = "rise"
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert result["variety"]["transitions_used"] == ["iris_open"]
    assert result["variety"]["exits_used"] == ["rise"]
    assert not any("remapped" in n for n in result["variety"]["normalizations"])
    # Mid-energy effects are motion, not energy moments.
    assert result["variety"]["energy_cuts"] == 0


def test_save_visuals_flash_flip_count_as_energy(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut(duration=8.0)
    cut["transition"] = "flash"
    cut["exit_transition"] = "flip"
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert result["variety"]["energy_cuts"] == 1


def test_save_visuals_remaps_whip_pan_legacy(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut(duration=8.0)
    cut["transition"] = "whip_pan"
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert any("whip_pan" in n and "slide_left" in n
               for n in result["variety"]["normalizations"])


def test_create_and_list_projects_via_server(tmp_path, monkeypatch):
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    calls = _patch_db(monkeypatch, None)
    res = server.create_project("My Cool Doc", language="hi",
                                style="nitish_rajput", duration_mode="medium",
                                video_format="landscape")
    assert res["ok"] is True
    pid = res["project_id"]
    assert pid in calls["records"]["projects"]
    assert (tmp_path / pid).exists()

    listing = server.list_projects()
    assert listing["ok"] is True
    assert any(p["id"] == pid for p in listing["projects"])

    detail = server.project_status(pid)
    assert detail["ok"] is True
    assert detail["project"]["name"] == "My Cool Doc"
    assert "tasks" in detail


def test_transcription_tools_lifecycle(tmp_path, monkeypatch):
    from backend.mcp import server
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())

    proj_dir = tmp_path / "proj_mcp"
    sub_dir = proj_dir / "subtitles"
    sub_dir.mkdir(parents=True)
    vo_dir = proj_dir / "voiceover"
    vo_dir.mkdir(parents=True)

    # Write script.json
    script_data = {
        "title": "Test Doc",
        "introduction": {"hook": "सन उन्नीस सौ पचहत्तर। तेईस साल का एक भारतीय युवक पाकिस्तान में दाखिल हुआ।"},
        "scenes": [
            {"title": "Scene 1", "narration": "उसने वहां कानून पढ़ा और सेना में नौकरी की।"}
        ],
        "conclusion": {"summary": "यह कहानी है एक देशभक्त की।", "cta": "जय हिंद।"}
    }
    (proj_dir / "script.json").write_text(json.dumps(script_data, ensure_ascii=False), encoding="utf-8")

    # Write manifest.json
    manifest_data = [
        {"section_type": "introduction", "duration": 10.0, "text": "सन उन्नीस सौ पचहत्तर। तेईस साल का एक भारतीय युवक पाकिस्तान में दाखिल हुआ।"},
        {"section_type": "scene", "duration": 10.0, "text": "उसने वहां कानून पढ़ा और सेना में नौकरी की।"},
        {"section_type": "conclusion", "duration": 10.0, "text": "यह कहानी है एक देशभक्त की। जय हिंद।"}
    ]
    (vo_dir / "manifest.json").write_text(json.dumps(manifest_data, ensure_ascii=False), encoding="utf-8")

    # Write transcription.json with Whisper variations (digits, spelling errors, truncation)
    trans_data = {
        "language": "hi",
        "segments": [
            {
                "id": 1,
                "start": 0.0,
                "end": 8.5,
                "text": "सन 1975, 23 साल का एक भारतिय युवक पाकि",
                "words": [
                    {"start": 0.0, "end": 0.5, "word": "सन"},
                    {"start": 0.5, "end": 1.2, "word": " 1975,"},
                    {"start": 1.5, "end": 2.0, "word": " 23"},
                    {"start": 2.0, "end": 2.5, "word": " साल"},
                    {"start": 2.5, "end": 2.8, "word": " का"},
                    {"start": 2.8, "end": 3.1, "word": " एक"},
                    {"start": 3.1, "end": 3.8, "word": " भारतिय"},
                    {"start": 3.8, "end": 4.5, "word": " युवक"},
                    {"start": 4.5, "end": 5.0, "word": " पाकि"},
                ]
            },
            {
                "id": 2,
                "start": 10.0,
                "end": 16.0,
                "text": "उसने वहां कानून पड़ा और सेना में नौकरी की",
                "words": [
                    {"start": 10.0, "end": 10.5, "word": "उसने"},
                    {"start": 10.5, "end": 11.0, "word": " वहां"},
                    {"start": 11.0, "end": 11.5, "word": " कानून"},
                    {"start": 11.5, "end": 12.0, "word": " पड़ा"},
                    {"start": 12.0, "end": 12.5, "word": " और"},
                    {"start": 12.5, "end": 13.0, "word": " सेना"},
                    {"start": 13.0, "end": 13.5, "word": " में"},
                    {"start": 13.5, "end": 14.0, "word": " नौकरी"},
                    {"start": 14.0, "end": 14.5, "word": " की"},
                ]
            }
        ]
    }
    (sub_dir / "transcription.json").write_text(json.dumps(trans_data, ensure_ascii=False), encoding="utf-8")

    # 1. Test get_transcription
    got_all = server.get_transcription("proj_mcp")
    assert got_all["ok"] is True
    assert got_all["total_segments"] == 2
    assert got_all["total_words"] == 18

    got_intro = server.get_transcription("proj_mcp", section_type="introduction")
    assert got_intro["ok"] is True
    assert got_intro["total_section_segments"] == 1
    assert got_intro["total_section_words"] == 9




def test_mcp_inventory_shape_and_counts():
    """Lock the MCP discovery surface agents see.

    Agents call resources/list + resources/templates/list during
    discovery: 0 templates is valid and expected (reads are tools by
    design — skill-gate side effects + structured args don't fit URI
    templates). If this test fails after adding a tool/resource, update
    docs/mcp_agent_control.md §3 + McpAgentCard TOOL_GROUPS in the same PR.
    """
    import asyncio
    from backend.mcp import server
    tools = asyncio.run(server.mcp.list_tools())
    resources = asyncio.run(server.mcp.list_resources())
    templates = asyncio.run(server.mcp.list_resource_templates())
    prompts = asyncio.run(server.mcp.list_prompts())
    tool_names = sorted(t.name for t in tools)
    assert len(tool_names) == 33
    assert set(tool_names) == {
        "create_project", "list_projects", "project_status", "delete_project",
        "save_script", "get_script", "save_design",
        "list_voice_options", "update_voice_settings", "update_transcribe_settings",
        "get_transcription",
        "list_skills", "get_skill", "get_stage_skills", "append_skill_learning",
        "run_stage", "stage_status", "cancel_stage", "sleep",
        "get_section_timings", "get_visuals", "save_visuals",
        "save_visuals_batch",
        "clear_visuals", "clear_assets",
        "probe_cut", "probe_scene", "probe_asset", "review_frame",
        "search_media", "web_search", "list_project_files", "read_project_file",
    }
    assert len(resources) == 1
    assert len(templates) == 0  # by design, see docstring
    assert len(prompts) == 1


def test_mcp_inventory_helper_reports_all_lists(monkeypatch):
    from backend.mcp import http_host
    monkeypatch.setattr(http_host, "_mcp_inventory_cache", None)
    inv = http_host.get_mcp_inventory()
    assert set(inv) == {"tools", "resources", "resource_templates", "prompts"}
    assert len(inv["tools"]) == 33
    assert len(inv["resources"]) == 1
    assert inv["resource_templates"] == []
    assert len(inv["prompts"]) == 1
    # cached second call returns same object
    assert http_host.get_mcp_inventory() is inv


# ── clear_visuals / clear_assets ────────────────────────────────────

def _seed_cuts_with_assets(tmp_path, monkeypatch):
    """Visuals project + 1 saved cut carrying a local_path + asset files."""
    from backend.mcp import payloads as p
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    dl = assets_dir / "asset_00001.jpg"
    dl.write_bytes(b"\x00" * 16)
    (assets_dir / "assets_manifest.json").write_text("[]", encoding="utf-8")
    keep = assets_dir / "upload_keep.png"
    keep.write_bytes(b"\x00" * 8)
    cut = {"composition": {"type": "Sequence", "children": [
        {"type": "Layer",
         "content": {"type": "Image", "query": "red wall",
                     "local_path": str(dl), "asset_url": "https://x/y.jpg"},
         "style": {}},
        {"type": "Layer", "content": {"type": "Text", "text": "HELLO"},
         "style": {}}]},
        "duration": 8.0, "transition": "cut"}
    # Bypass save_visuals validation (local_path unknown to validator):
    # write the cut straight into script.json + voiceover manifest.
    script_path = proj_dir / "script.json"
    script = json.loads(script_path.read_text(encoding="utf-8"))
    script["scenes"][0]["sub_visuals"] = [cut]
    script_path.write_text(json.dumps(script), encoding="utf-8")
    manifest_path = proj_dir / "voiceover" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scene_entry = next(m for m in manifest if m.get("section_type") == "scene")
    import copy as _copy
    scene_entry["sub_visuals"] = _copy.deepcopy([cut])
    scene_entry["_narr_hash"] = "abc123"
    scene_entry["_design_hash"] = "def456"
    # Twin assets manifest holding the same cut (post-fetch state).
    (assets_dir / "assets_manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return proj_dir


def _read_subs(proj_dir):
    script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    manifest = json.loads(
        (proj_dir / "voiceover" / "manifest.json").read_text(encoding="utf-8"))
    scene_entry = next(m for m in manifest if m.get("section_type") == "scene")
    return script, manifest, scene_entry


def test_clear_visuals_wipes_asts_and_assets_by_default(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    proj_dir = _seed_cuts_with_assets(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    result = p.clear_visuals_payload("proj_mcp")
    assert result["ok"] is True
    # Canonical counts from script.json: 1 logical cut in 1 section
    # (manifest twins are synced silently, never double-counted).
    assert result["cuts_cleared"] == 1
    assert result["sections_cleared"] == 1
    assert result["clear_assets"] is True
    script, manifest, scene_entry = _read_subs(proj_dir)
    assert script["scenes"][0]["sub_visuals"] == []
    assert scene_entry["sub_visuals"] == []
    assert "_narr_hash" not in scene_entry and "_design_hash" not in scene_entry
    # assets_manifest.json is itself a managed download artifact → deleted.
    assert not (proj_dir / "assets" / "assets_manifest.json").exists()
    # Downloads gone, user upload kept.
    assert not (proj_dir / "assets" / "asset_00001.jpg").exists()
    assert (proj_dir / "assets" / "upload_keep.png").exists()
    assert result["assets"]["deleted_count"] >= 1
    # Downstream stages reset.
    assert "upd:proj_mcp_fetch_assets" in calls
    assert "upd:proj_mcp_render" in calls
    (pid, kw), = calls["update"]
    assert pid == "proj_mcp" and kw["video_path"] is None


def test_clear_visuals_keep_assets(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    proj_dir = _seed_cuts_with_assets(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())
    result = p.clear_visuals_payload("proj_mcp", clear_assets=False)
    assert result["ok"] is True and result["clear_assets"] is False
    assert "assets" not in result
    script, _, scene_entry = _read_subs(proj_dir)
    assert script["scenes"][0]["sub_visuals"] == []
    assert scene_entry["sub_visuals"] == []
    # Downloads untouched.
    assert (proj_dir / "assets" / "asset_00001.jpg").exists()


def test_clear_assets_keeps_cuts_strips_pointers(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    proj_dir = _seed_cuts_with_assets(tmp_path, monkeypatch)
    calls = _patch_db(monkeypatch, _proj())
    result = p.clear_assets_payload("proj_mcp")
    assert result["ok"] is True
    assert result["deleted_count"] >= 1
    assert any("asset_00001" in f for f in result["deleted_files"])
    assert (proj_dir / "assets" / "upload_keep.png").exists()
    script, _, scene_entry = _read_subs(proj_dir)
    # Cuts survive, pointers gone.
    assert len(script["scenes"][0]["sub_visuals"]) == 1
    content = script["scenes"][0]["sub_visuals"][0]["composition"]["children"][0]["content"]
    assert "local_path" not in content and "asset_url" not in content
    assert content["query"] == "red wall"  # query kept for re-fetch
    # Exact count locks the fix: script.json (2) + voiceover manifest (2).
    # The assets-manifest twin is deleted as a file before stripping.
    assert result["pointers_stripped"] == 4
    assert "upd:proj_mcp_fetch_assets" in calls
    assert "upd:proj_mcp_render" in calls


def test_strip_asset_pointers_removes_falsy_keys():
    from backend.mcp import payloads as p
    node = {"content": {"type": "Image", "query": "x", "local_path": "",
                        "asset_url": None, "visual_path": ""}}
    assert p._strip_asset_pointers(node) == 3
    assert node["content"] == {"type": "Image", "query": "x"}


def test_clear_visuals_keep_assets_prunes_stills(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    proj_dir = _seed_cuts_with_assets(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())
    stills_dir = proj_dir / "assets" / "previews" / "stills"
    stills_dir.mkdir(parents=True)
    (stills_dir / "abc123.jpg").write_bytes(b"\x00" * 8)
    result = p.clear_visuals_payload("proj_mcp", clear_assets=False)
    assert result["ok"] is True and result.get("stills_pruned") is True
    assert not stills_dir.exists()
    # Downloads kept on the False path.
    assert (proj_dir / "assets" / "asset_00001.jpg").exists()


def test_clear_visuals_needs_script(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    _patch_storage(monkeypatch, tmp_path)
    _patch_db(monkeypatch, _proj())
    (tmp_path / "proj_mcp").mkdir(parents=True)
    assert p.clear_visuals_payload("proj_mcp")["ok"] is False
    # Unknown project raises (server wrapper converts to ok:false).
    with pytest.raises(ValueError):
        p.clear_assets_payload("ghost")
    with pytest.raises(ValueError):
        p.clear_visuals_payload("ghost")


def test_server_clear_guards_running_stage(monkeypatch):
    from backend.mcp import server
    monkeypatch.setattr(server, "_project_active_stage",
                        lambda pid: "proj_mcp_transcribe")
    denied = server.clear_visuals("proj_mcp")
    assert denied["ok"] is False and "running MCP stage" in denied["error"]
    assert server.clear_assets("proj_mcp")["ok"] is False


def test_server_clear_holds_marker_during_writes(monkeypatch):
    from backend.mcp import server
    seen = {}

    def spy(pid, **kw):
        seen["active"] = server._project_active_stage(pid)
        return {"ok": True, "project_id": pid}

    monkeypatch.setattr(server.payloads, "clear_visuals_payload", spy)
    monkeypatch.setattr(server.payloads, "clear_assets_payload",
                        lambda pid: {"ok": True, "project_id": pid})
    assert server.clear_visuals("p1")["ok"] is True
    assert seen["active"] == "p1_clear_visuals"
    assert server.clear_assets("p1")["ok"] is True
    # Markers released afterwards.
    with server._STAGE_LOCK:
        assert server._project_active_stage("p1") is None


def test_coerce_bool_strings():
    from backend.mcp.server import _coerce_bool
    assert _coerce_bool("false") is False
    assert _coerce_bool("False") is False
    assert _coerce_bool("0") is False
    assert _coerce_bool(True) is True
    assert _coerce_bool("true") is True
    assert _coerce_bool(None, True) is True


# ── save_visuals_batch ────────────────────────────────────────────

def test_batch_dry_run_then_persist(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    _setup_visuals_proj(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())
    sections = [
        {"section_type": "introduction", "sub_visuals": [_text_cut("A")]},
        {"section_type": "scene", "scene_index": 0,
         "sub_visuals": [_text_cut("B"), _text_cut("C")]},
    ]
    dry = p.save_visuals_batch_payload("proj_mcp", sections, dry_run=True)
    assert dry["ok"] is True and dry["dry_run"] is True
    assert dry["summary"] == {"sections_total": 2, "sections_ok": 2,
                              "sections_failed": 0, "cuts_total": 3}
    assert all("auto_fixed" in r for r in dry["results"])
    # Whole-video rollup catches the flat shape: all-Text sections share
    # one identical signature with zero energy cuts.
    assert dry["video_variety"]["uniform_signature"] is True
    assert dry["video_variety"]["kinds_total"] == {"Text": 3}
    assert "variety_warning" in dry
    live = p.save_visuals_batch_payload("proj_mcp", sections, dry_run=False)
    assert live["ok"] is True and live["persisted"] is True
    assert "fetch_assets" in live["next_step"]
    # Same content was dry-run validated → no cold-persist nudge.
    assert all("nudge" not in r for r in live["results"])
    got = p.get_visuals_payload("proj_mcp", "scene", scene_index=0)
    assert got["count"] == 2


def test_batch_partial_failure_keeps_good_sections(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    _setup_visuals_proj(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())
    sections = [
        {"section_type": "introduction", "sub_visuals": [_text_cut("A")]},
        {"section_type": "scene", "scene_index": 0,
         "sub_visuals": ["garbage-cut"]},
        {"section_type": "bogus", "sub_visuals": [_text_cut("D")]},
    ]
    result = p.save_visuals_batch_payload("proj_mcp", sections, dry_run=False)
    assert result["ok"] is False
    # Partial persist must never claim the whole video is saved.
    assert result["persisted"] is False
    assert "re-dry-run" in result["error"]
    assert result["summary"]["sections_ok"] == 1
    assert result["summary"]["sections_failed"] == 2
    assert result["results"][0]["ok"] is True
    assert result["results"][1]["ok"] is False
    assert result["results"][1]["fix"]["retry_with"]["composition"]["type"] == "Sequence"
    assert result["results"][2]["ok"] is False
    # Good section persisted despite neighbors failing.
    got = p.get_visuals_payload("proj_mcp", "introduction")
    assert got["count"] == 1


def test_batch_guards(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    _patch_db(monkeypatch, _proj())
    assert p.save_visuals_batch_payload("proj_mcp", [])["ok"] is False
    assert p.save_visuals_batch_payload(
        "proj_mcp", [{"x": 1}] * 101)["ok"] is False
    with pytest.raises(ValueError):
        p.save_visuals_batch_payload("ghost", [{"section_type": "scene",
                                                "sub_visuals": []}])
    # Duplicate targets: second entry fails instead of silently clobbering.
    _setup_visuals_proj(tmp_path, monkeypatch)
    dup = p.save_visuals_batch_payload("proj_mcp", [
        {"section_type": "introduction", "sub_visuals": [_text_cut("A")]},
        {"section_type": "introduction", "sub_visuals": [_text_cut("B")]},
    ], dry_run=True)
    assert dup["ok"] is False
    assert dup["results"][0]["ok"] is True
    assert "duplicates" in dup["results"][1]["error"]
    # Explicit negative cut_index is rejected (it means "all" in reads;
    # here it would wipe a whole section by accident).
    neg = p.save_visuals_batch_payload("proj_mcp", [
        {"section_type": "introduction", "sub_visuals": [_text_cut("A")],
         "cut_index": -1},
    ], dry_run=True)
    assert neg["ok"] is False and "cut_index" in neg["results"][0]["error"]
    # Non-integer scene_index is rejected (no silent float truncation).
    sloppy = p.save_visuals_batch_payload("proj_mcp", [
        {"section_type": "scene", "scene_index": 1.5,
         "sub_visuals": [_text_cut("A")]},
    ], dry_run=True)
    assert sloppy["ok"] is False and "scene_index" in sloppy["results"][0]["error"]


def test_nudge_is_content_hashed(tmp_path, monkeypatch):
    from backend.mcp import payloads as p
    _setup_visuals_proj(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())
    dry = p.save_visuals_payload("proj_mcp", "introduction",
                                 [_text_cut("SAME")], dry_run=True)
    assert dry["ok"] is True
    # Identical content persists nudge-free.
    same = p.save_visuals_payload("proj_mcp", "introduction",
                                  [_text_cut("SAME")])
    assert same["ok"] is True and "nudge" not in same
    # Edited content was never validated → nudge fires.
    p.save_visuals_payload("proj_mcp", "introduction",
                           [_text_cut("SAME2")], dry_run=True)
    changed = p.save_visuals_payload("proj_mcp", "introduction",
                                     [_text_cut("SAME3")])
    assert changed["ok"] is True and "nudge" in changed


def test_server_batch_holds_marker_and_coerces_flag(monkeypatch):
    from backend.mcp import server
    seen = {}

    def spy(pid, sections, dry_run=False):
        seen["active"] = server._project_active_stage(pid)
        seen["dry_run"] = dry_run
        return {"ok": True, "project_id": pid}

    monkeypatch.setattr(server.payloads, "save_visuals_batch_payload", spy)
    monkeypatch.setattr(server, "_missing_stage_skills", lambda s, p: [])
    monkeypatch.setattr(server, "_missing_deep_reads", lambda s, p: None)
    # String "false" must not flip into dry-run mode.
    assert server.save_visuals_batch("p1", [], dry_run="false")["ok"] is True
    assert seen["dry_run"] is False
    assert seen["active"] == "p1_save_visuals_batch"
    with server._STAGE_LOCK:
        assert server._project_active_stage("p1") is None


def test_scene_cut_numbering_1based_and_aliases(tmp_path, monkeypatch):
    """Verify 1-based scene_number, cut_number, section normalization, conflict checks, and zero rejection."""
    from backend.mcp import payloads as p
    from backend.mcp import probe
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)

    # 1. Save visuals using 1-based scene_number=1, whole section
    res1 = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("Cut 1"), _text_cut("Cut 2")], scene_number=1)
    assert res1["ok"] is True
    assert res1["scene_index"] == 0
    assert res1["scene_number"] == 1
    assert res1["display_label"] == "Scene 1"
    assert res1["cut_count"] == 2

    # 2. Get visuals using 1-based scene_number=1
    gv1 = p.get_visuals_payload("proj_mcp", "scene", scene_number=1)
    assert gv1["ok"] is True
    assert gv1["scene_index"] == 0
    assert gv1["scene_number"] == 1
    assert gv1["count"] == 2
    assert gv1["display_label"] == "Scene 1"

    # 3. Patch single cut using 1-based cut_number=2
    patch_res = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("Patched Cut 2")], scene_number=1, cut_number=2)
    assert patch_res["ok"] is True
    assert patch_res["scene_index"] == 0
    assert patch_res["scene_number"] == 1
    assert patch_res["cut_index"] == 1
    assert patch_res["cut_number"] == 2
    assert patch_res["display_label"] == "Scene 1 : Cut #2"

    # 4. Get single cut using 1-based cut_number=2
    gv_single = p.get_visuals_payload("proj_mcp", "scene", scene_number=1, cut_number=2)
    assert gv_single["ok"] is True
    assert gv_single["scene_index"] == 0
    assert gv_single["scene_number"] == 1
    assert gv_single["cut_index"] == 1
    assert gv_single["cut_number"] == 2
    assert gv_single["display_label"] == "Scene 1 : Cut #2"
    assert "Patched Cut 2" in json.dumps(gv_single["sub_visual"])

    # 5. Section alias normalization: "intro" -> "introduction", "outro" -> "conclusion"
    intro_res = p.save_visuals_payload("proj_mcp", "intro", [_text_cut("Intro Cut 1"), _text_cut("Intro Cut 2")])
    assert intro_res["ok"] is True
    assert intro_res["section_type"] == "introduction"
    assert intro_res["display_label"] == "Introduction"

    # Single cut patch on intro with cut_number=2
    intro_patch = p.save_visuals_payload("proj_mcp", "hook", [_text_cut("Intro Patched 2")], cut_number=2)
    assert intro_patch["ok"] is True
    assert intro_patch["section_type"] == "introduction"
    assert intro_patch["cut_index"] == 1
    assert intro_patch["cut_number"] == 2
    assert intro_patch["display_label"] == "Introduction : Cut #2"

    # 6. Conflict checks: scene_index=1, scene_number=1 must return error
    conflict1 = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("X")], scene_index=1, scene_number=1)
    assert conflict1["ok"] is False
    assert "Index/Number conflict" in conflict1["error"]

    conflict2 = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("X")], scene_number=1, cut_index=1, cut_number=1)
    assert conflict2["ok"] is False
    assert "Index/Number conflict" in conflict2["error"]

    # 7. Non-positive numbers rejected
    zero_scene = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("X")], scene_number=0)
    assert zero_scene["ok"] is False
    assert "numbers are 1-based" in zero_scene["error"]

    zero_cut = p.save_visuals_payload("proj_mcp", "scene", [_text_cut("X")], scene_number=1, cut_number=0)
    assert zero_cut["ok"] is False
    assert "numbers are 1-based" in zero_cut["error"]

    # 8. Probe tools with 1-based coordinates
    cut_probe = probe.probe_cut_payload("proj_mcp", "scene", scene_number=1, cut_number=2)
    assert cut_probe["ok"] is True
    assert cut_probe["scene_number"] == 1
    assert cut_probe["cut_number"] == 2
    assert cut_probe["display_label"] == "Scene 1 : Cut #2"

    scene_probe = probe.probe_scene_payload("proj_mcp", "scene", scene_number=1)
    assert scene_probe["ok"] is True
    assert scene_probe["scene_number"] == 1
    assert scene_probe["display_label"] == "Scene 1"

    # 9. Out-of-range error shows both 0-based and 1-based coordinates
    oor = probe.probe_cut_payload("proj_mcp", "scene", scene_number=1, cut_number=99)
    assert oor["ok"] is False
    assert "cut_index 98 (UI Cut #99) out of range" in oor["error"]

    # 10. get_section_timings includes scene_number, cut_number, display_label
    timings = p.get_section_timings("proj_mcp", include_words=False)
    assert timings["ok"] is True
    intro_sec = timings["sections"][0]
    assert intro_sec["display_label"] == "Introduction"
    scene1_sec = timings["sections"][1]
    assert scene1_sec["scene_number"] == 1
    assert scene1_sec["display_label"] == "Scene 1"
    assert scene1_sec["cuts"][0]["cut_number"] == 1
    assert scene1_sec["cuts"][0]["display_label"] == "Scene 1 : Cut #1"

    # 11. Batch with 1-based items
    batch_res = p.save_visuals_batch_payload("proj_mcp", [
        {"section_type": "scene", "scene_number": 2, "sub_visuals": [_text_cut("Batch Scene 2")]},
        {"section_type": "scene", "scene_number": 1, "cut_number": 2, "sub_visuals": [_text_cut("Batch Scene 1 Cut 2")]},
        {"section_type": "outro", "sub_visuals": [_text_cut("Batch Outro")]},
    ], dry_run=True)
    assert batch_res["ok"] is True
    assert batch_res["results"][0]["scene_number"] == 2
    assert batch_res["results"][0]["display_label"] == "Scene 2"
    assert batch_res["results"][1]["scene_number"] == 1
    assert batch_res["results"][1]["cut_number"] == 2
    assert batch_res["results"][1]["display_label"] == "Scene 1 : Cut #2"
    assert batch_res["results"][2]["section_type"] == "conclusion"
    assert batch_res["results"][2]["display_label"] == "Conclusion"


def test_frames_review_1based_targeting(tmp_path, monkeypatch):
    from backend.mcp import frames
    _review_fixtures(tmp_path, monkeypatch)
    # resolve_targets with scene_number=1, cut_number=2
    plan = frames.resolve_targets("proj_mcp", "scene", scene_number=1, cut_number=2, scope="cut", mode="composition")
    assert plan["scene_number"] == 1
    assert plan["scene_index"] == 0
    assert plan["cut_number"] == 2
    assert plan["cut_index"] == 1
    assert plan["display_label"] == "Scene 1 : Cut #2"
    assert "Cut #2 (idx 1)" in plan["cells"][0]["label"]

    # resolve_targets with section scope
    sec_plan = frames.resolve_targets("proj_mcp", "scene", scene_number=1, scope="section", mode="composition")
    assert sec_plan["scene_number"] == 1
    assert sec_plan["scene_index"] == 0
    assert sec_plan["display_label"] == "Scene 1"
    assert any("Cut #" in c["label"] for c in sec_plan["cells"])


# ── variety rewards depth, forgives design systems ───────────────────

def _layered_cut(left, kind_stack=("Video", "HTML", "Text")):
    boxes = {"Video": {"left": "0%", "top": "0%", "width": "100%", "height": "100%"},
             "HTML": {"left": "8%", "top": "16%", "width": "42%", "height": "66%"},
             "Text": {"left": "54%", "top": "30%", "width": "40%", "height": "20%", "fontSize": "56px"},
             "Shape": {"left": "46%", "top": "24%", "width": "8%", "height": "8%"},
             "Particles": {"width": "100%", "height": "100%"}}
    children = []
    for k in kind_stack:
        content = {"type": k, "style": dict(boxes[k])}
        if k in ("Video",):
            content.update({"query": "city timelapse", "source": "pexels"})
        if k == "Text":
            content["text"] = "headline"
        children.append({"type": "Layer", "content": content,
                         "animations": [], "filters": []})
    # shift the card band per cut so layouts differ
    for c in children:
        st = c["content"]["style"]
        if "top" in st and st.get("width") != "100%":
            st["top"] = f"{left}%"
    return {"composition": {"type": "Sequence", "children": children},
            "duration": 3.0, "transition": "fade"}


def test_variety_same_kinds_different_layouts_not_repetition():
    from backend.mcp.payloads import _visual_variety_report
    cuts = [_layered_cut(t) for t in (16, 30, 44, 58)]
    rep = _visual_variety_report(cuts, cuts, 12.0)
    assert rep["max_template_run"]["length"] < 3
    assert not any("Template repetition" in n for n in rep["normalizations"])
    assert rep["deep_cuts"] == 4
    assert rep["avg_layers_per_cut"] == 3.0


def test_variety_identical_layouts_still_flagged():
    from backend.mcp.payloads import _visual_variety_report
    cuts = [_layered_cut(16) for _ in range(3)]
    rep = _visual_variety_report(cuts, cuts, 9.0)
    assert rep["max_template_run"]["length"] == 3
    assert any("Template repetition" in n for n in rep["normalizations"])


def test_rollup_deep_system_not_uniform():
    from backend.mcp.payloads import _video_variety_rollup
    entries = [{"index": i, "section_type": "scene",
                "variety": {"kinds_used": {"Video": 1, "HTML": 1, "Text": 1},
                            "transitions_used": ["fade"], "energy_cuts": 0,
                            "avg_layers_per_cut": 3.0, "deep_cuts": 1}}
               for i in range(3)]
    roll = _video_variety_rollup(entries)
    assert roll["uniform_signature"] is False
    assert roll["deep_cuts_total"] == 3
    assert roll["avg_layers_per_cut"] == 3.0


def test_rollup_shallow_uniform_still_flagged():
    from backend.mcp.payloads import _video_variety_rollup
    entries = [{"index": i, "section_type": "scene",
                "variety": {"kinds_used": {"Text": 1},
                            "transitions_used": ["cut"], "energy_cuts": 0,
                            "avg_layers_per_cut": 1.0, "deep_cuts": 0}}
               for i in range(2)]
    roll = _video_variety_rollup(entries)
    assert roll["uniform_signature"] is True


# ── Visual Task Sync & Design Safety Fixes ─────────────────────────────

def test_sync_visuals_task_status_lifecycle(tmp_path, monkeypatch):
    """Manifest visual completion syncs generate_visuals task state in SQLite."""
    from backend.mcp import payloads as p
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    db_calls = _patch_db(monkeypatch, _proj())

    # 1. Zero sections authored -> pending
    sync1 = p._sync_visuals_task_status("proj_mcp", proj_dir)
    assert sync1["total"] == 4
    assert sync1["completed"] == 0
    assert sync1["is_complete"] is False
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["status"] == "pending"
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["progress"] == 0.0

    # 2. 1 section authored -> running, 25%
    p.save_visuals_payload("proj_mcp", "introduction", [_text_cut("Intro")])
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["status"] == "running"
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["progress"] == 25.0

    # 3. All 4 sections authored -> completed, 100%
    p.save_visuals_payload("proj_mcp", "scene", [_text_cut("S1")], scene_index=0)
    p.save_visuals_payload("proj_mcp", "scene", [_text_cut("S2")], scene_index=1)
    res_final = p.save_visuals_payload("proj_mcp", "conclusion", [_text_cut("Outro")])
    assert res_final["visuals_completed"] is True
    assert res_final["sections_with_visuals"] == "4/4"
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["status"] == "completed"
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["progress"] == 100.0


def test_clear_visuals_resets_tasks_to_pending(tmp_path, monkeypatch):
    """clear_visuals resets generate_visuals, fetch_assets, and render to pending."""
    from backend.mcp import payloads as p
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    db_calls = _patch_db(monkeypatch, _proj())

    # Set task as completed
    p.save_visuals_payload("proj_mcp", "introduction", [_text_cut("Intro")])
    p.save_visuals_payload("proj_mcp", "scene", [_text_cut("S1")], scene_index=0)
    p.save_visuals_payload("proj_mcp", "scene", [_text_cut("S2")], scene_index=1)
    p.save_visuals_payload("proj_mcp", "conclusion", [_text_cut("Outro")])
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["status"] == "completed"

    # Clear visuals
    res = p.clear_visuals_payload("proj_mcp")
    assert res["ok"] is True
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["status"] == "pending"
    assert db_calls["records"]["tasks"]["proj_mcp_generate_visuals"]["progress"] == 0.0


def test_save_design_overwrite_protection_with_bound_visuals(tmp_path, monkeypatch):
    """save_design rejects overwriting an existing design when visuals are already bound, unless force=True."""
    from backend.mcp import payloads as p
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    _patch_db(monkeypatch, _proj())

    # Save visual bound to current design hash
    p.save_visuals_payload("proj_mcp", "introduction", [_text_cut("Intro")])

    # Attempt to overwrite with a different design (different theme/colors) without force
    different_design = {
        "theme_name": "Totally New Theme",
        "color_palette": {"primary": "#ff0000"},
        "typography": {"font_family": "Inter"},
        "css_guidelines": "Bold and red",
    }
    blocked = p.save_design_payload("proj_mcp", different_design, force=False)
    assert blocked["ok"] is False
    assert blocked["error_code"] == "DESIGN_ALREADY_EXISTS"
    assert blocked["sections_with_visuals"] >= 1
    assert "force=True" in blocked["error"]

    # Identical re-save without force must succeed
    current_design = json.loads((proj_dir / "design.json").read_text(encoding="utf-8"))
    res_same = p.save_design_payload("proj_mcp", current_design, force=False)
    assert res_same["ok"] is True

    # Overwrite WITH force=True must succeed
    forced = p.save_design_payload("proj_mcp", different_design, force=True)
    assert forced["ok"] is True
    saved_design = json.loads((proj_dir / "design.json").read_text(encoding="utf-8"))
    assert saved_design["theme_name"] == "Totally New Theme"


def test_project_status_and_get_stage_skills_integration(tmp_path, monkeypatch):
    """project_status reconciles tasks; get_stage_skills respects stage aliases and design existence."""
    from backend.mcp import server, payloads as p
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    db_calls = _patch_db(monkeypatch, _proj())

    # 1. Alias handling in get_stage_skills
    skills_vis = server.get_stage_skills("generate_visuals", "proj_mcp")
    assert skills_vis["ok"] is True
    assert skills_vis["stage"] == "visuals"

    skills_scr = server.get_stage_skills("generate_script", "proj_mcp")
    assert skills_scr["ok"] is True
    assert skills_scr["stage"] == "script"

    skills_des = server.get_stage_skills("art_director", "proj_mcp")
    assert skills_des["ok"] is True
    assert skills_des["stage"] == "design"
    assert skills_des["design_already_exists"] is True
    assert "DO NOT re-author design" in skills_des["next"]

    # 2. Visuals skills when design is already saved and visuals incomplete
    assert skills_vis["design_already_exists"] is True
    assert skills_vis["existing_theme"] == "T"
    assert "Design system is ALREADY saved" in skills_vis["next"]

    # 3. Save all visuals
    p.save_visuals_batch_payload("proj_mcp", [
        {"section_type": "introduction", "sub_visuals": [_text_cut("A")]},
        {"section_type": "scene", "scene_index": 0, "sub_visuals": [_text_cut("B")]},
        {"section_type": "scene", "scene_index": 1, "sub_visuals": [_text_cut("C")]},
        {"section_type": "conclusion", "sub_visuals": [_text_cut("D")]},
    ], dry_run=False)

    # 4. project_status reports visuals completed and task status completed
    status = server.project_status("proj_mcp")
    assert status["design_status"]["saved"] is True
    assert status["visuals_status"]["is_complete"] is True
    assert status["visuals_status"]["completed"] == 4
    assert status["visuals_status"]["total"] == 4
    task_vis = next(t for t in status["tasks"] if t["step"] == "generate_visuals")
    assert task_vis["status"] == "completed"

    # 5. When visuals are complete, get_stage_skills('visuals') guides to fetch_assets
    skills_after = server.get_stage_skills("visuals", "proj_mcp")
    assert "run_stage('fetch_assets'" in skills_after["next"]


def test_generate_project_design_system_safe_against_missing_metadata(tmp_path, monkeypatch):
    """generate_project_design_system does not invalidate designs lacking _language/_video_format."""
    from backend.pipeline.ai import generate_project_design_system
    import threading

    design_file = tmp_path / "design.json"
    design_file.write_text(json.dumps({
        "theme_name": "Minimalist Studio",
        "color_palette": {"primary": "#111111", "accent": "#ffffff"},
        "typography": {"font_family": "Inter"},
        "css_guidelines": "Clean borders and spacing.",
    }), encoding="utf-8")

    proj_dict = {"name": "Test", "language": "hi", "video_format": "landscape"}
    design_data, is_new = generate_project_design_system(
        proj_dict, {}, tmp_path, lambda p, m: None, threading.Event()
    )
    assert is_new is False
    assert design_data["theme_name"] == "Minimalist Studio"
    assert design_data["_language"] == "hi"
    assert design_data["_video_format"] == "landscape"

    # When stored language explicitly conflicts, invalidate and regenerate
    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", lambda *a, **k: {
        "theme_name": "Fallback Regened",
        "color_palette": {},
        "typography": {},
        "css_guidelines": "",
    })
    design_file.write_text(json.dumps({
        "theme_name": "Minimalist Studio",
        "_language": "en",
        "_video_format": "landscape",
        "color_palette": {"primary": "#111111"},
        "typography": {},
        "css_guidelines": ".",
    }), encoding="utf-8")

    design_data_conflict, is_new_conflict = generate_project_design_system(
        proj_dict, {}, tmp_path, lambda p, m: None, threading.Event()
    )
    assert is_new_conflict is True



