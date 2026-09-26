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

    monkeypatch.setattr("backend.database.db.get_project", fake_get_project)
    monkeypatch.setattr("backend.database.db.get_all_projects", fake_get_all_projects)
    monkeypatch.setattr("backend.database.db.update_project", fake_update_project)
    monkeypatch.setattr("backend.database.db.create_project", fake_create_project)
    monkeypatch.setattr("backend.database.db.delete_project", fake_delete_project)
    monkeypatch.setattr("backend.database.db.create_task", fake_create_task)
    monkeypatch.setattr("backend.database.db.update_task", fake_update_task)
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


def test_save_visuals_rejects_z_index(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    cut = _text_cut()
    cut["composition"]["children"][0]["z_index"] = 5
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is False


def test_save_visuals_requires_design(tmp_path, monkeypatch):
    proj_dir = _setup_visuals_proj(tmp_path, monkeypatch)
    (proj_dir / "design.json").unlink()
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [_text_cut()])
    assert result["ok"] is False and "design" in result["error"].lower()


def test_save_visuals_scene_index_out_of_range(tmp_path, monkeypatch):
    _setup_visuals_proj(tmp_path, monkeypatch)
    result = payloads.save_visuals_payload("proj_mcp", "scene", [_text_cut()], scene_index=9)
    assert result["ok"] is False and "out of range" in result["error"]


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
        {"whisper_model": "collabora/faster-whisper-small-hindi"})
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
    bad_cut = {"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Text", "text": "X"},
         "style": {}}]}, "duration": 1.0}
    bad_cut["composition"]["children"][0]["z_index"] = 3
    result = payloads.save_visuals_payload("proj_mcp", "scene", bad_cut,
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
    assert "VARIETY GUIDE" in guide
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
    assert result["full_chars"] > 40000 and "content" not in result
    titles = [s["title"] for s in result["sections"]]
    assert len(titles) >= 7
    arch = next(s for s in result["sections"] if "Archetype" in s["title"])
    assert any("Dossier" in h for h in arch["subheads"])
    assert all(s["preview"] and s["chars"] > 0 for s in result["sections"])


def test_get_skill_brief_small_skill_returns_full():
    from backend.mcp import server
    result = server.get_skill("scriptwriter", brief=True)
    assert result["ok"] is True and "content" in result


def test_get_skill_section_fuzzy():
    from backend.mcp import server
    by_title = server.get_skill("declarative-ast", section="archetype")
    assert by_title["ok"] is True
    assert "Archetype" in by_title["section"]
    assert "Dossier" in by_title["content"]
    assert len(by_title["remaining_sections"]) >= 6
    by_subhead = server.get_skill("declarative-ast", section="particles")
    assert by_subhead["ok"] is True
    assert by_subhead["matched_subhead"].startswith("9.")
    by_number = server.get_skill("declarative-ast", section="5")
    assert by_number["ok"] is True and by_number["section"] == by_title["section"]
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
    rich = dict(bare, motion_language={"transitions": "whip_pan for shock beats"})
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
    cut["transition"] = "whip_pan"
    cut["emphasis"] = [{"at": 1.0, "scale": 1.2, "duration": 0.5}]
    result = payloads.save_visuals_payload("proj_mcp", "introduction", [cut])
    assert result["ok"] is True
    assert result["variety"]["energy_cuts"] == 1


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

    # 2. Test compare_transcription
    cmp_res = server.compare_transcription("proj_mcp")
    assert cmp_res["ok"] is True
    assert cmp_res["summary"]["spelling_variants_count"] >= 1
    variants = {v["transcript"]: v["script"] for v in cmp_res["spelling_variants"]}
    assert "भारतिय" in variants and variants["भारतिय"] == "भारतीय"

    # 3. Test update_transcription with dry_run
    dry = server.update_transcription("proj_mcp", replacements=[{"find": "भारतिय", "replace": "भारतीय"}], dry_run=True)
    assert dry["ok"] is True
    assert dry["dry_run"] is True
    assert dry["replacements_applied"] >= 1
    assert not (sub_dir / "subtitles.srt").exists()

    # 4. Test update_transcription with auto_align=True (writes files)
    live = server.update_transcription("proj_mcp", auto_align=True)
    assert live["ok"] is True
    assert live["dry_run"] is False
    assert (sub_dir / "subtitles.srt").exists()
    assert (sub_dir / "subtitles.vtt").exists()

    # Check updated transcription.json
    updated_trans = json.loads((sub_dir / "transcription.json").read_text(encoding="utf-8"))
    seg1_words = [w["word"].strip() for w in updated_trans["segments"][0]["words"]]
    assert "भारतीय" in seg1_words

    srt_content = (sub_dir / "subtitles.srt").read_text(encoding="utf-8")
    assert "भारतीय" in srt_content

