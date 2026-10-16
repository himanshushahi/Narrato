"""Tests for the 50-style visual library (code + skill wiring).

DB/storage/network/LLM are never touched — pure resolver + skill-loader checks.
"""
from backend.pipeline.style_library import (
    STYLE_SPECS,
    resolve_style,
    resolve_style_with_override,
    style_block,
    style_block_for,
    style_index_lines,
    list_styles,
)


def test_exactly_50_styles():
    assert len(STYLE_SPECS) == 50, f"expected 50 styles, got {len(STYLE_SPECS)}"


def test_every_style_has_ast_mapping():
    for slug, spec in STYLE_SPECS.items():
        assert spec.get("name"), slug
        assert spec.get("look") and spec.get("motion"), slug
        assert spec.get("base") and spec.get("hero") and spec.get("text"), slug
        assert isinstance(spec.get("transitions"), list) and spec["transitions"], slug


def test_resolve_canonical_and_aliases():
    assert resolve_style("investigative-noir") == "investigative-noir"
    assert resolve_style("Investigative Noir") == "investigative-noir"
    assert resolve_style("noir") == "investigative-noir"
    assert resolve_style("make it look like liquid glass please") == "liquid-glass"
    assert resolve_style("Y2K chrome vibes") == "y2k-chrome"
    assert resolve_style("style 19") == "archival-film"
    assert resolve_style("19") == "archival-film"
    assert resolve_style("") is None
    assert resolve_style("some totally unknown mood xyz") is None


def test_rewrite_override_wins():
    assert resolve_style_with_override("liquid-glass", "make it noir") == "investigative-noir"
    assert resolve_style_with_override("", "vhs glitch") == "analog-glitch-vhs"
    assert resolve_style_with_override("unknown mood", "") is None


def test_style_block_binds_tokens_not_hex():
    block, slug = style_block_for("neon contour lines")
    assert slug == "neon-contour-line"
    assert "design.json" in block
    assert "wave_pulse" in block
    assert style_block(None) == ""
    assert style_block("not-a-style") == ""


def test_index_has_50_lines():
    lines = style_index_lines().splitlines()
    assert len(lines) == 50
    assert lines[0].startswith("01.")
    assert "unreal-engine-cinematic" in lines[-1]


def test_list_styles_ordered():
    rows = list_styles()
    assert len(rows) == 50
    assert rows[0]["slug"] == "editorial-paper-collage"
    assert rows[-1]["slug"] == "unreal-engine-cinematic"


def test_resolve_whole_word_no_false_positives():
    # "topo" must not fire inside "topology"; "think" must not fire "ink".
    assert resolve_style("topology of networks") is None
    assert resolve_style("think about history") is None
    assert resolve_style("minimal effort explainer") == "minimalist-existential"
    # longest alias wins over its own prefix
    assert resolve_style("wireframe hologram") == "holographic-wireframe"
    assert resolve_style("wireframe") == "wireframe-3d-animation"


def test_filters_are_valid_harness_tokens():
    import re
    valid_presets = {
        "noir_hard", "cyberpunk", "golden_hour", "neon_glow_pop",
        "bleach_bypass", "night_vision", "thermal_false_color", "dream_blur",
        "cinematic_dark_base", "archival_monochrome", "vintage_sepia",
        "vibrant_tech_glow",
    }
    for slug, spec in STYLE_SPECS.items():
        for f in spec.get("filters", []):
            assert " on " not in f, f"{slug}: prose in filter {f!r}"
            assert " via " not in f, f"{slug}: prose in filter {f!r}"
            assert " or " not in f, f"{slug}: choice prose in filter {f!r}"
            assert "when " not in f.lower(), f"{slug}: conditional prose in filter {f!r}"
            if f.startswith("url(") or f.startswith("mix-blend-mode:") or f.startswith("backdrop-filter:"):
                continue
            if re.fullmatch(r"[a-z_]+\(.*\)", f):
                continue  # raw CSS fn: blur(12px), contrast(1.4), brightness(1.05)
            assert f in valid_presets, f"{slug}: unknown filter {f!r}"


def test_skill_code_sync():
    from pathlib import Path
    text = Path("backend/skills/shared/visual-style-library/SKILL.md").read_text(encoding="utf-8")
    for slug in STYLE_SPECS:
        assert slug in text, f"slug {slug} missing from SKILL.md"
    assert text.count("(`") >= 50, "SKILL.md index looks truncated"


def test_skill_loads_and_sections_split():
    from backend.agent.skill_loader import skill_loader
    skill_loader.reload_skills()
    skill = skill_loader.get_skill("visual-style-library")
    assert skill is not None, "visual-style-library SKILL.md not loaded"
    assert getattr(skill, "exposure", "agent") == "agent"
    assert "visual-style-library" in skill_loader.get_agent_skills()
    brief = skill.brief()
    titles = [s["title"] for s in brief["sections"]]
    assert any("index" in t.lower() for t in titles)
    # family section pull (progressive disclosure path agents use)
    found = skill.render_section("cinematic", **{"language": "en", "video_format": "landscape"})
    assert found is not None
    found2 = skill.render_section("neon contour")
    assert found2 is not None and "neon" in found2["body"].lower()
