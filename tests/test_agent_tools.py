import json
import pytest
from pathlib import Path
from backend.agent.tools import execute_tool, get_tools_schema, TOOL_ARGUMENT_MODELS
from backend.agent.agent_engine import PIPELINE_VISUAL_TOOLS, BRIDGE_VISUAL_TOOLS


def test_tool_schemas_and_models_registered():
    schema_names = {t["function"]["name"] for t in get_tools_schema()}
    assert "search_icons" in schema_names
    assert "get_word_timings" in schema_names
    assert "probe_cut" in schema_names
    assert "probe_scene" in schema_names
    assert "probe_asset" in schema_names
    assert "search_archive_photo" in schema_names
    assert "search_archive_video" in schema_names

    # All new tools must have pydantic argument validation models
    assert "search_icons" in TOOL_ARGUMENT_MODELS
    assert "get_word_timings" in TOOL_ARGUMENT_MODELS
    assert "probe_cut" in TOOL_ARGUMENT_MODELS
    assert "probe_scene" in TOOL_ARGUMENT_MODELS
    assert "probe_asset" in TOOL_ARGUMENT_MODELS
    assert "search_archive_photo" in TOOL_ARGUMENT_MODELS
    assert "search_archive_video" in TOOL_ARGUMENT_MODELS


def test_search_icons_tool():
    raw = execute_tool("search_icons", {"query": "profit", "limit": 4})
    data = json.loads(raw)
    assert isinstance(data, list)
    assert len(data) > 0
    names = [item["name"] for item in data]
    assert any(n in names for n in ("trending-up", "dollar-sign", "coins", "wallet"))


def test_search_icons_empty_and_fallback():
    raw = execute_tool("search_icons", {"query": "unknowntermxyz999", "limit": 3})
    data = json.loads(raw)
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_word_timings_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.agent.tools._project_dir", lambda pid: tmp_path)
    res = execute_tool("get_word_timings", {"project_id": "test_proj", "query": "hello"})
    assert "No transcription found" in res


def test_get_word_timings_success(tmp_path, monkeypatch):
    subtitles_dir = tmp_path / "subtitles"
    subtitles_dir.mkdir(parents=True)
    trans_file = subtitles_dir / "transcription.json"
    trans_file.write_text(json.dumps({
        "segments": [
            {
                "id": 0,
                "words": [
                    {"word": "Market", "start": 1.2, "end": 1.6},
                    {"word": "crash", "start": 1.7, "end": 2.1},
                    {"word": "today", "start": 2.2, "end": 2.5}
                ]
            }
        ]
    }), encoding="utf-8")

    monkeypatch.setattr("backend.agent.tools._project_dir", lambda pid: tmp_path)
    res = execute_tool("get_word_timings", {"project_id": "test_proj", "query": "crash"})
    data = json.loads(res)
    assert "matched_words" in data
    assert len(data["matched_words"]) == 1
    assert data["matched_words"][0]["word"] == "crash"
    assert data["matched_words"][0]["start"] == 1.7


def test_get_word_timings_with_scene_index(tmp_path, monkeypatch):
    subtitles_dir = tmp_path / "subtitles"
    subtitles_dir.mkdir(parents=True)
    trans_file = subtitles_dir / "transcription.json"
    trans_file.write_text(json.dumps({
        "segments": [
            {
                "id": 0,
                "words": [
                    {"word": "Intro", "start": 0.5, "end": 1.0},
                    {"word": "SceneOne", "start": 4.5, "end": 5.2},
                    {"word": "SceneTwo", "start": 12.0, "end": 12.8},
                ]
            }
        ]
    }), encoding="utf-8")

    voiceover_dir = tmp_path / "voiceover"
    voiceover_dir.mkdir(parents=True)
    manifest_file = voiceover_dir / "manifest.json"
    manifest_file.write_text(json.dumps([
        {"section_type": "scene", "duration": 4.0},
        {"section_type": "scene", "duration": 6.0},
        {"section_type": "scene", "duration": 5.0},
    ]), encoding="utf-8")

    monkeypatch.setattr("backend.agent.tools._project_dir", lambda pid: tmp_path)
    # Scene 1 starts at 4.0s (duration 6.0s)
    res = execute_tool("get_word_timings", {"project_id": "test_proj", "query": "SceneOne", "scene_index": 1})
    data = json.loads(res)
    assert "matched_words" in data
    assert len(data["matched_words"]) == 1
    assert data["matched_words"][0]["word"] == "SceneOne"
    assert data["matched_words"][0]["start"] == 4.5
    assert data["matched_words"][0]["scene_relative_start"] == 0.5
    assert "scene" in data
    assert data["scene"]["scene_index"] == 1
    assert data["scene"]["start"] == 4.0


def test_visual_allowlists_segregation():
    # In-memory and pre-flight tools allowed in both pipeline and bridge
    for tool in ("search_icons", "search_archive_photo", "search_archive_video"):
        assert tool in PIPELINE_VISUAL_TOOLS
        assert tool in BRIDGE_VISUAL_TOOLS

    # Post-generation / disk inspection tools must NOT be in pipeline
    # (scenes are written in batch at the end, assets not downloaded yet)
    for tool in ("probe_cut", "probe_scene", "probe_asset", "get_word_timings"):
        assert tool not in PIPELINE_VISUAL_TOOLS
        assert tool in BRIDGE_VISUAL_TOOLS


def test_search_archive_execution(monkeypatch):
    monkeypatch.setattr(
        "backend.pipeline.assets.search_archive_photo",
        lambda q, video_format=None: "https://archive.org/download/test/photo.jpg"
    )
    monkeypatch.setattr(
        "backend.pipeline.assets.search_archive_video",
        lambda q, video_format=None: "https://archive.org/download/test/video.mp4"
    )

    photo_url = execute_tool("search_archive_photo", {"query": "apollo 11 moon landing"})
    assert photo_url == "https://archive.org/download/test/photo.jpg"

    video_url = execute_tool("search_archive_video", {"query": "apollo 11 launch"})
    assert video_url == "https://archive.org/download/test/video.mp4"


def test_preview_asset_download_sources(tmp_path, monkeypatch):
    from backend.pipeline.assets import preview_asset_download

    # Mock project and storage
    storage = tmp_path / "storage"
    storage.mkdir(parents=True, exist_ok=True)
    proj_dir = storage / "proj_test"
    proj_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: storage)
    monkeypatch.setattr("backend.pipeline.assets.get_project", lambda pid: {"id": pid, "video_format": "landscape"})

    # Setting mocks: no API keys configured
    settings = {"pexels_api_key": "", "pixabay_api_key": ""}
    monkeypatch.setattr("backend.pipeline.assets.get_setting", lambda k: settings.get(k, ""))

    # 1. Pexels without API key should return error
    res_pexels = preview_asset_download("proj_test", "ocean waves", visual_type="image", source="pexels")
    assert res_pexels["success"] is False
    assert "Pexels API key not configured" in res_pexels["error"]

    # 2. Archive without API key should NOT error about API key; it calls search_archive_*
    def fake_fetch(layer, preview_dir, *args, **kwargs):
        # Emulate download
        fake_file = preview_dir / "asset_000_00_99.jpg"
        fake_file.write_bytes(b"archive-image-data")
        layer["content"]["local_path"] = str(fake_file)

    monkeypatch.setattr("backend.pipeline.assets._fetch_ast_layer_asset", fake_fetch)

    res_archive = preview_asset_download("proj_test", "apollo 11 moon", visual_type="image", source="archive")
    assert res_archive["success"] is True
    assert "visual_path" in res_archive
    assert res_archive["visual_path"].endswith(".jpg")


def test_archive_search_logic_mocked(monkeypatch):
    from backend.pipeline.assets import search_archive_photo, search_archive_video

    class MockResponse:
        def __init__(self, data, status_code=200):
            self._data = data
            self.status_code = status_code
        def json(self):
            return self._data
        def raise_for_status(self):
            pass

    def mock_get(url, **kwargs):
        if "advancedsearch.php" in url:
            if "mediatype%3A%28image%29" in url or "mediatype:(image)" in url:
                return MockResponse({"response": {"docs": [{"identifier": "item_photo_1"}]}})
            elif "mediatype%3A%28movies%29" in url or "mediatype:(movies)" in url:
                return MockResponse({"response": {"docs": [{"identifier": "item_video_1"}]}})
        elif "/metadata/item_photo_1/files" in url:
            return MockResponse({"result": [
                {"name": "thumb_thumb.jpg", "size": "100"},
                {"name": "photo_hi_res.jpg", "size": "2048000"}
            ]})
        elif "/metadata/item_video_1/files" in url:
            return MockResponse({"result": [
                {"name": "clip_thumb.mp4", "size": "100"},
                {"name": "clip_main.mp4", "format": "h.264", "size": "15000000", "height": 720}
            ]})
        return MockResponse({}, status_code=404)

    monkeypatch.setattr("requests.get", mock_get)

    photo_url = search_archive_photo("apollo 11 astronaut")
    assert photo_url == "https://archive.org/download/item_photo_1/photo_hi_res.jpg"

    video_url = search_archive_video("apollo 11 launch")
    assert video_url == "https://archive.org/download/item_video_1/clip_main.mp4"


