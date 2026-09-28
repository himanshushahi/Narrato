import json
import pytest
from pathlib import Path
from backend.agent.tools import execute_tool, get_tools_schema, TOOL_ARGUMENT_MODELS
from backend.agent.agent_engine import PIPELINE_VISUAL_TOOLS, BRIDGE_VISUAL_TOOLS


def test_tool_schemas_and_models_registered():
    schema_names = {t["function"]["name"] for t in get_tools_schema()}
    assert "search_icons" in schema_names
    assert "lint_visuals" in schema_names
    assert "get_word_timings" in schema_names
    assert "probe_cut" in schema_names
    assert "probe_scene" in schema_names
    assert "probe_asset" in schema_names

    # All new tools must have pydantic argument validation models
    assert "search_icons" in TOOL_ARGUMENT_MODELS
    assert "lint_visuals" in TOOL_ARGUMENT_MODELS
    assert "get_word_timings" in TOOL_ARGUMENT_MODELS
    assert "probe_cut" in TOOL_ARGUMENT_MODELS
    assert "probe_scene" in TOOL_ARGUMENT_MODELS
    assert "probe_asset" in TOOL_ARGUMENT_MODELS


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


def test_lint_visuals_tool():
    sub_visuals = [
        {
            "duration": 4.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {
                            "type": "Text",
                            "text": "Header",
                            "style": {"left": "10%", "top": "15%", "width": "80%", "height": "25%", "fontSize": "56px"},
                        },
                        "animations": [
                            {"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.5}
                        ]
                    }
                ]
            }
        }
    ]
    raw = execute_tool("lint_visuals", {
        "sub_visuals": sub_visuals,
        "video_format": "landscape",
        "expected_duration": 4.0
    })
    report = json.loads(raw)
    assert isinstance(report, dict)
    assert "warnings" in report
    assert "boxes" in report
    assert "duration_check" in report
    assert report["duration_check"]["duration_match"] is True


def test_lint_visuals_invalid_type():
    res = execute_tool("lint_visuals", {"sub_visuals": "not-a-list"})
    assert "Error" in res


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
    for tool in ("search_icons", "lint_visuals"):
        assert tool in PIPELINE_VISUAL_TOOLS
        assert tool in BRIDGE_VISUAL_TOOLS

    # Post-generation / disk inspection tools must NOT be in pipeline
    # (scenes are written in batch at the end, assets not downloaded yet)
    for tool in ("probe_cut", "probe_scene", "probe_asset", "get_word_timings"):
        assert tool not in PIPELINE_VISUAL_TOOLS
        assert tool in BRIDGE_VISUAL_TOOLS

