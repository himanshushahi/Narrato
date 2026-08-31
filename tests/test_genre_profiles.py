import pytest
from backend.pipeline.genres import (
    GENRE_PROFILES,
    normalize_genre_key,
    get_genre_profile,
    format_genre_design_prompt,
    format_genre_script_prompt,
    format_genre_storyboard_prompt,
)


def test_all_expected_genres_present():
    expected = [
        "documentary", "explainer", "finance", "vox",
        "news", "true_crime", "storytime", "viral_short"
    ]
    for g in expected:
        assert g in GENRE_PROFILES
        profile = GENRE_PROFILES[g]
        assert "name" in profile
        assert "tagline" in profile
        assert "pacing_wps" in profile
        assert profile["pacing_wps"] > 0
        assert "design_system" in profile
        assert "visual_archetypes" in profile
        assert len(profile["visual_archetypes"]) >= 3
        assert "primitive_weights" in profile
        assert "motion_defaults" in profile


def test_genre_normalization_and_aliases():
    assert normalize_genre_key("DOCUMENTARY") == "documentary"
    assert normalize_genre_key("tech-explainer") == "explainer"
    assert normalize_genre_key("crypto") == "finance"
    assert normalize_genre_key("breaking_news") == "news"
    assert normalize_genre_key("mystery") == "true_crime"
    assert normalize_genre_key("vlog") == "storytime"
    assert normalize_genre_key("reels") == "viral_short"
    assert normalize_genre_key("unknown_custom_genre_123") == "documentary"


def test_genre_prompt_formatters():
    design_prompt = format_genre_design_prompt("explainer")
    assert "GENRE CONTEXT (TECH & SAAS EXPLAINER)" in design_prompt
    assert "Cyan" in design_prompt or "00d4ff" in design_prompt

    script_prompt = format_genre_script_prompt("finance")
    assert "GENRE NARRATIVE DIRECTIVE (FINANCE & MARKET DEEP-DIVE)" in script_prompt
    assert "words per second" in script_prompt

    storyboard_prompt = format_genre_storyboard_prompt("true_crime")
    assert "GENRE VISUAL STORYBOARD DIRECTIVE (TRUE CRIME & INVESTIGATIVE MYSTERY)" in storyboard_prompt
    assert "camera_shake=\"shockwave\"" in storyboard_prompt


def test_design_system_caching_and_genre_backfill(tmp_path, monkeypatch):
    import json
    import threading
    from backend.pipeline.ai import generate_project_design_system

    project_dict = {
        "id": "test-proj-123",
        "name": "How Bitcoin Works",
        "language": "en",
        "video_format": "landscape",
        "prompt": "explainer",
    }
    script_data = {"title": "How Bitcoin Works"}
    cancel_event = threading.Event()

    # Mock LLM call to return a valid design system
    def mock_call_llm(system_prompt, user_prompt, schema, cancel_event=None, return_raw=False, activity_label=None):
        return {
            "theme_name": "Cyberpunk Neon HUD",
            "color_palette": {
                "background": "#080c14",
                "primary": "#00d4ff",
                "secondary": "#8b5cf6",
                "accent": "#10b981",
                "text": "#ffffff",
            },
            "typography": {
                "heading_font": "Outfit",
                "body_font": "Inter",
            },
            "css_guidelines": "High-tech terminal cards with 6px border-radius",
        }

    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", mock_call_llm)

    # 1. First run generates new design
    design_data, is_new = generate_project_design_system(
        project_dict, script_data, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new is True
    assert design_data.get("_genre") == "explainer"
    assert design_data.get("_language") == "en"

    # Save to disk as generate_visuals_pipeline does
    with open(tmp_path / "design.json", "w", encoding="utf-8") as f:
        json.dump(design_data, f, indent=2)

    # 2. Second run (e.g. after changing voiceover voice) MUST NOT invalidate design.json
    design_data_2, is_new_2 = generate_project_design_system(
        project_dict, script_data, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new_2 is False
    assert design_data_2.get("theme_name") == "Cyberpunk Neon HUD"

    # 3. Existing design.json from older version without _genre key should backfill without invalidating
    del design_data["_genre"]
    with open(tmp_path / "design.json", "w", encoding="utf-8") as f:
        json.dump(design_data, f, indent=2)

    design_data_3, is_new_3 = generate_project_design_system(
        project_dict, script_data, tmp_path, lambda p, m: None, cancel_event
    )
    assert is_new_3 is False
    assert design_data_3.get("_genre") == "explainer"

