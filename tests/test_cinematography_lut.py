"""Unit and integration tests for Phase 3: Asset Cinematography & Color LUT Shaders."""
import pytest
from backend.pipeline.assets import (
    CINEMATOGRAPHY_STYLE_MODIFIERS,
    resolve_style_modifier,
    inject_cinematography_query,
)
from backend.pipeline.enricher import (
    resolve_lut_for_style,
    inject_auto_lut,
    enrich_cut,
    enrich_sub_visuals,
)
from backend.agent.validators import (
    FILTER_PRESETS,
    sanitize_layer_filters,
    validate_sub_visuals,
)


# ── Step 3.1: Cinematography Query Injection Tests ─────────────────────────────

def test_resolve_style_modifier_categories():
    assert resolve_style_modifier("cyberpunk neon hacker") == CINEMATOGRAPHY_STYLE_MODIFIERS["dark_cyber"]
    assert resolve_style_modifier("historical archival documentary") == CINEMATOGRAPHY_STYLE_MODIFIERS["documentary"]
    assert resolve_style_modifier("corporate finance banking") == CINEMATOGRAPHY_STYLE_MODIFIERS["finance"]
    assert resolve_style_modifier("epic cinematic narrative") == CINEMATOGRAPHY_STYLE_MODIFIERS["cinematic"]
    assert resolve_style_modifier("") == ""
    assert resolve_style_modifier(None) == ""


def test_inject_cinematography_query_stock_sources():
    # Pexels and Pixabay receive cinematography modifiers
    q = "server rack"
    injected = inject_cinematography_query(q, style_hint="cyberpunk", source="pexels")
    assert "server rack" in injected
    assert "dark background" in injected or "cinematic" in injected

    injected_pix = inject_cinematography_query(q, style_hint="vintage documentary", source="pixabay")
    assert "server rack" in injected_pix
    assert "historical" in injected_pix or "archival" in injected_pix


def test_inject_cinematography_query_bypasses_exact_entities():
    # Wikipedia and YouTube must NOT be modified (would break exact title/entity match)
    wiki_q = "Satoshi Nakamoto"
    assert inject_cinematography_query(wiki_q, style_hint="dark_cyber", source="wikipedia") == wiki_q

    yt_q = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert inject_cinematography_query(yt_q, style_hint="dark_cyber", source="youtube") == yt_q

    # Direct URLs are untouched
    http_url = "https://example.com/footage.mp4"
    assert inject_cinematography_query(http_url, style_hint="dark_cyber", source="pexels") == http_url


def test_inject_cinematography_query_deduplicates_tokens():
    # If query already includes 'cinematic 4k', those words should not be repeated
    q = "cinematic 4k city skyline"
    res = inject_cinematography_query(q, style_hint="cinematic", source="pexels")
    # Count occurrences of 'cinematic'
    tokens = res.lower().split()
    assert tokens.count("cinematic") == 1
    assert tokens.count("4k") == 1


# ── Step 3.2 & 3.3: In-Engine LUT Color Grading Tests ─────────────────────────

def test_resolve_lut_for_style():
    assert resolve_lut_for_style("cyberpunk neon") == "url(#fx-lut-cyberpunk)"
    assert resolve_lut_for_style("hacker dark matrix") == "url(#fx-lut-cyberpunk)"
    assert resolve_lut_for_style("vintage archival documentary") == "url(#fx-lut-vox-editorial)"
    assert resolve_lut_for_style("vox editorial news") == "url(#fx-lut-vox-editorial)"
    assert resolve_lut_for_style("dramatic high contrast") == "url(#fx-lut-dark-cinematic)"
    assert resolve_lut_for_style("") == "url(#fx-lut-dark-cinematic)"

    # From design_tokens theme_name
    assert resolve_lut_for_style(design_tokens={"theme_name": "Cyber Tech Glow"}) == "url(#fx-lut-cyberpunk)"
    assert resolve_lut_for_style(design_tokens={"theme_name": "Vox Historical"}) == "url(#fx-lut-vox-editorial)"
    assert resolve_lut_for_style(design_tokens={"theme_name": "Dark Cinematic Base"}) == "url(#fx-lut-dark-cinematic)"


def test_inject_auto_lut_on_video_and_image():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Video", "query": "crypto ledger"},
                    "filters": [],
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "text": "HACK CONFIRMED"},
                    "filters": [],
                },
            ],
        },
    }
    graded = inject_auto_lut(cut, style_hint="cyberpunk")
    assert graded == 1
    video_layer = cut["composition"]["children"][0]
    assert video_layer["filters"] == ["url(#fx-lut-cyberpunk)"]
    # Text layer must not receive the video LUT
    text_layer = cut["composition"]["children"][1]
    assert text_layer["filters"] == []


def test_inject_auto_lut_is_idempotent_and_respects_existing_grades():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Video", "query": "server rack"},
                    # Already has an explicit duotone filter
                    "filters": ["url(#fx-duotone-midnight)"],
                },
            ],
        },
    }
    graded = inject_auto_lut(cut, style_hint="cyberpunk")
    assert graded == 0
    # Must preserve the authored filter
    assert cut["composition"]["children"][0]["filters"] == ["url(#fx-duotone-midnight)"]


def test_inject_auto_lut_skips_illustration_cutouts():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {
                        "type": "Image",
                        "query": "trojan virus icon",
                        "image_type": "illustration",
                    },
                    "filters": [],
                },
            ],
        },
    }
    graded = inject_auto_lut(cut, style_hint="cyberpunk")
    assert graded == 0
    assert cut["composition"]["children"][0]["filters"] == []


def test_validator_filter_presets_includes_luts():
    assert "lut_cyberpunk" in FILTER_PRESETS
    assert "lut-cyberpunk" in FILTER_PRESETS
    assert "lut_vox_editorial" in FILTER_PRESETS
    assert "lut-vox-editorial" in FILTER_PRESETS
    assert "lut_dark_cinematic" in FILTER_PRESETS
    assert "lut-dark-cinematic" in FILTER_PRESETS

    layers = [
        {"type": "Layer", "filters": ["lut_cyberpunk"]},
        {"type": "Layer", "filters": ["lut-vox-editorial"]},
        {"type": "Layer", "filters": ["lut-dark-cinematic"]},
    ]
    sanitize_layer_filters(layers)
    assert layers[0]["filters"] == ["url(#fx-lut-cyberpunk)"]
    assert layers[1]["filters"] == ["url(#fx-lut-vox-editorial)"]
    assert layers[2]["filters"] == ["url(#fx-lut-dark-cinematic)"]


def test_enrich_sub_visuals_end_to_end_with_lut():
    cuts = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {"type": "Video", "query": "bitcoin ledger"},
                        "animations": [],
                    },
                    {
                        "type": "Layer",
                        "content": {"type": "Text", "text": "THE CRASH"},
                        "animations": [],
                    },
                ],
            },
        }
    ]
    enriched, notes = enrich_sub_visuals(
        cuts,
        design_tokens={"theme_name": "Tech Matrix Cyber"},
        video_format="landscape",
    )
    assert len(enriched) == 1
    children = enriched[0]["composition"]["children"]
    # Media layer should have received LUT
    media_layer = next(c for c in children if c.get("content", {}).get("type") == "Video")
    assert "url(#fx-lut-cyberpunk)" in media_layer["filters"]
    # Notes should mention the LUT
    assert any("applied broadcast LUT shader" in n for n in notes)


def test_resolve_style_modifier_dark_cinematic():
    """Verify 'dark cinematic' resolves to cinematic modifier rather than cyber."""
    assert resolve_style_modifier("dark cinematic drama") == CINEMATOGRAPHY_STYLE_MODIFIERS["cinematic"]
    assert resolve_style_modifier("cyberpunk neon hacker") == CINEMATOGRAPHY_STYLE_MODIFIERS["dark_cyber"]


def test_enrich_sub_visuals_with_style_hint_parameter():
    """Verify enrich_sub_visuals accepts and respects the style_hint parameter directly."""
    cuts = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {"type": "Image", "query": "old newspaper"},
                        "animations": [],
                    },
                ],
            },
        }
    ]
    enriched, notes = enrich_sub_visuals(cuts, style_hint="vox documentary")
    children = enriched[0]["composition"]["children"]
    image_layer = next(c for c in children if c.get("content", {}).get("type") == "Image")
    assert "url(#fx-lut-vox-editorial)" in image_layer["filters"]

