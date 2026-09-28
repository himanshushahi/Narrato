"""Topic-driven design system: no genre presets.

Covers the replacement for the removed genre profiles:
- _pick_design_direction rotates lanes from topic/title/seed
- generate_project_design_system caches on language/format only
  (no _genre stamp) and injects topic-driven guidance.
- _get_style_hint passes free-text hints through but maps legacy
  genre tokens to "" so removed presets can't leak back in.
- compute_project_script_hash ignores the visual-only prompt/style_hint
  so hint edits never invalidate narration.
"""
import json
import threading


def test_pick_design_direction_is_deterministic_and_varied():
    from backend.pipeline.ai import _pick_design_direction

    a = _pick_design_direction(topic="Deep ocean trenches", title="Abyss", seed_hint="1")
    b = _pick_design_direction(topic="Deep ocean trenches", title="Abyss", seed_hint="1")
    assert a == b  # same inputs -> same lane

    lanes = {
        _pick_design_direction(topic="Deep ocean trenches", title="Abyss", seed_hint=str(i))
        for i in range(30)
    }
    assert len(lanes) > 1  # seeds rotate, no single predictable palette


def test_design_guidance_is_topic_driven():
    from backend.pipeline.ai import _format_design_guidance

    guidance = _format_design_guidance(topic="Mars rovers", title="Red Dust", seed_hint="abc")
    assert "Mars rovers" in guidance
    assert "ASSIGNED VARIETY DIRECTION" in guidance
    assert "documentary" not in guidance.lower()
    assert "GENRE" not in guidance


def test_design_system_caching_without_genre(tmp_path, monkeypatch):
    from backend.pipeline.ai import generate_project_design_system

    project_dict = {
        "id": "test-proj-123",
        "name": "How Bitcoin Works",
        "language": "en",
        "video_format": "landscape",
        "prompt": "",
    }
    script_data = {"title": "How Bitcoin Works"}
    cancel_event = threading.Event()

    def mock_call_llm(system_prompt, user_prompt, schema, cancel_event=None, return_raw=False, activity_label=None):
        assert "documentary" not in system_prompt.lower()
        return {
            "theme_name": "Copper Ledger Pulse",
            "color_palette": {
                "background": "#17352a",
                "primary": "#e07a2c",
                "secondary": "#7fb069",
                "accent": "#d6495b",
                "text": "#f4f1e8",
            },
            "typography": {"heading_font": "Outfit", "body_font": "Inter"},
            "css_guidelines": "Warm moss canvas with copper accents and rounded 16px cards.",
        }

    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", mock_call_llm)

    design_data, is_new = generate_project_design_system(
        project_dict, script_data, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new is True
    assert "_genre" not in design_data
    assert design_data.get("_language") == "en"

    with open(tmp_path / "design.json", "w", encoding="utf-8") as f:
        json.dump(design_data, f, indent=2)

    design_data_2, is_new_2 = generate_project_design_system(
        project_dict, script_data, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new_2 is False
    assert design_data_2.get("theme_name") == "Copper Ledger Pulse"


def test_get_style_hint_blocks_legacy_genre_tokens():
    from backend.pipeline.ai import _get_style_hint

    for token in ("documentary", "explainer", "finance", "vox",
                  "news", "true_crime", "storytime", "viral_short",
                  "Documentary"):
        assert _get_style_hint({"prompt": token}) == ""
    assert _get_style_hint({"prompt": ""}) == ""
    assert _get_style_hint({"prompt": None}) == ""
    assert _get_style_hint(None) == ""
    assert _get_style_hint({"prompt": "warm editorial"}) == "warm editorial"


def test_script_hash_ignores_visual_style_hint():
    from backend.pipeline.ai import compute_project_script_hash

    base = {"name": "T", "language": "hi", "duration_mode": "medium",
            "video_format": "landscape", "style": "nitish_rajput"}
    assert (compute_project_script_hash({**base, "prompt": ""})
            == compute_project_script_hash({**base, "prompt": "warm editorial"})
            == compute_project_script_hash({**base, "prompt": "documentary"}))


def test_design_guidance_carries_style_hint(tmp_path, monkeypatch):
    from backend.pipeline.ai import generate_project_design_system

    seen = {}
    project_dict = {
        "id": "test-proj-hint",
        "name": "Ocean Depths",
        "language": "en",
        "video_format": "landscape",
        "prompt": "warm editorial",
    }
    cancel_event = threading.Event()

    def mock_call_llm(system_prompt, user_prompt, schema, cancel_event=None, return_raw=False, activity_label=None):
        seen["system"] = system_prompt
        seen["user"] = user_prompt
        return {
            "theme_name": "Amber Tide Journal",
            "color_palette": {
                "background": "#faf7f0",
                "primary": "#b45309",
                "secondary": "#0f766e",
                "accent": "#dc2626",
                "text": "#1c1917",
            },
            "typography": {"heading_font": "Outfit", "body_font": "Inter"},
            "css_guidelines": "Paper editorial cards with warm amber accents.",
        }

    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", mock_call_llm)
    design_data, is_new = generate_project_design_system(
        project_dict, {"title": "Ocean Depths"}, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new is True
    assert "warm editorial" in seen["system"]
    assert "warm editorial" in seen["user"]
    assert design_data.get("theme_name") == "Amber Tide Journal"


def test_creative_blueprint_hides_legacy_genre_token():
    from backend.mcp.payloads import _creative_blueprint_for_project

    legacy = _creative_blueprint_for_project(
        {"prompt": "documentary", "video_format": "landscape"})
    assert legacy["style_hint"] == ""
    assert legacy["layer_types"]

    hinted = _creative_blueprint_for_project(
        {"prompt": "warm editorial", "video_format": "landscape"})
    assert hinted["style_hint"] == "warm editorial"


def test_mcp_design_bundle_renders_guidance_placeholder(monkeypatch):
    from backend.mcp import server

    monkeypatch.setattr(
        "backend.database.db.get_project",
        lambda pid: {"id": pid, "name": "T", "prompt": "warm editorial",
                     "language": "hi", "video_format": "landscape"},
    )
    bundle = server.get_stage_skills("design", project_id="proj_x")
    assert bundle["ok"] is True
    assert "{design_guidance}" not in bundle["art_director"]
    assert "warm editorial" in bundle["art_director"]

    # Legacy genre rows must not leak the token into the agent bundle.
    monkeypatch.setattr(
        "backend.database.db.get_project",
        lambda pid: {"id": pid, "name": "T", "prompt": "documentary",
                     "language": "hi", "video_format": "landscape"},
    )
    legacy_bundle = server.get_stage_skills("design", project_id="proj_x")
    assert legacy_bundle["ok"] is True
    assert "{design_guidance}" not in legacy_bundle["art_director"]
    assert "documentary" not in legacy_bundle["art_director"].lower()
