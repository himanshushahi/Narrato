"""Tests for backend/pipeline/enricher.py deterministic middleware."""
import pytest
from backend.pipeline.enricher import (
    inject_auto_vignette,
    clamp_frame_zero_anchors,
    inject_ambient_drift,
    enforce_safe_areas,
    enrich_cut,
    enrich_sub_visuals,
)


def test_inject_auto_vignette_adds_scrim_for_video_or_image():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Video", "query": "cyberpunk city"},
                    "animations": [],
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "text": "HACKED"},
                    "animations": [],
                },
            ],
        },
    }
    added = inject_auto_vignette(cut)
    assert added == 1
    children = cut["composition"]["children"]
    assert len(children) == 3
    scrim = children[1]
    assert scrim["name"] == "auto_vignette_scrim"
    assert scrim["content"]["type"] == "HTML"
    assert "radial-gradient" in scrim["content"]["html_content"]


def test_inject_auto_vignette_is_idempotent():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Image", "query": "server rack"},
                    "animations": [],
                },
            ],
        },
    }
    assert inject_auto_vignette(cut) == 1
    assert len(cut["composition"]["children"]) == 2
    # Calling again does not duplicate
    assert inject_auto_vignette(cut) == 0
    assert len(cut["composition"]["children"]) == 2


def test_inject_auto_vignette_skips_when_no_media():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Background", "background_preset": "gradient_mesh"},
                    "animations": [],
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "text": "Hello World"},
                    "animations": [],
                },
            ],
        },
    }
    assert inject_auto_vignette(cut) == 0
    assert len(cut["composition"]["children"]) == 2


def test_clamp_frame_zero_anchors_prevents_black_void():
    cut = {
        "duration": 10.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Background", "background_preset": "grid_flow"},
                    "animations": [
                        {"property": "opacity", "from": 0, "to": 1, "delay": 4.8, "duration": 0.5}
                    ],
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "text": "AI HACK"},
                    "animations": [
                        {"property": "opacity", "from": 0, "to": 1, "delay": 4.8, "duration": 0.5}
                    ],
                },
            ],
        },
    }
    clamped = clamp_frame_zero_anchors(cut)
    assert clamped == 2
    # Delay was clamped to 0.0s
    assert cut["composition"]["children"][0]["animations"][0]["delay"] == 0.0
    assert cut["composition"]["children"][1]["animations"][0]["delay"] == 0.0


def test_clamp_frame_zero_anchors_preserves_valid_frame_zero():
    cut = {
        "duration": 10.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Background", "background_preset": "grid_flow"},
                    "animations": [],  # visible at 0.0s
                },
                {
                    "type": "Layer",
                    "content": {"type": "Text", "text": "AI HACK"},
                    "animations": [
                        {"property": "opacity", "from": 0, "to": 1, "delay": 4.8, "duration": 0.5}
                    ],
                },
            ],
        },
    }
    clamped = clamp_frame_zero_anchors(cut)
    assert clamped == 0
    # Text delay at 4.8s is preserved because background established frame 0
    assert cut["composition"]["children"][1]["animations"][0]["delay"] == 4.8


def test_inject_ambient_drift_on_static_image():
    cut = {
        "duration": 6.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Image", "query": "bitcoin ledger"},
                    "animations": [],
                },
            ],
        },
    }
    drifted = inject_ambient_drift(cut)
    assert drifted == 1
    anims = cut["composition"]["children"][0]["animations"]
    assert len(anims) == 1
    assert anims[0]["property"] == "scale"
    assert anims[0]["from"] == 1.0
    assert anims[0]["to"] == 1.05
    assert anims[0]["duration"] == 6.0
    assert anims[0]["easing"] == "linear"


def test_inject_ambient_drift_does_not_override_existing_scale():
    cut = {
        "duration": 6.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {"type": "Image", "query": "bitcoin ledger"},
                    "animations": [
                        {"property": "scale", "from": 0.8, "to": 1.2, "duration": 3.0}
                    ],
                },
            ],
        },
    }
    drifted = inject_ambient_drift(cut)
    assert drifted == 0
    assert len(cut["composition"]["children"][0]["animations"]) == 1


def test_enforce_safe_areas_portrait():
    cut = {
        "duration": 5.0,
        "composition": {
            "type": "Sequence",
            "children": [
                {
                    "type": "Layer",
                    "content": {
                        "type": "Text",
                        "text": "Out of bounds",
                        "style": {"top": "3%", "bottom": "10%", "width": "95%"},
                    },
                },
            ],
        },
    }
    adjusted = enforce_safe_areas(cut, video_format="portrait")
    assert adjusted == 1
    style = cut["composition"]["children"][0]["content"]["style"]
    assert style["top"] == "10%"
    assert style["bottom"] == "28%"
    assert style["width"] == "84%"
    assert style["left"] == "8%"


def test_enrich_sub_visuals_end_to_end():
    cuts = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {"type": "Video", "query": "crypto graph"},
                        "animations": [
                            {"property": "opacity", "from": 0, "to": 1, "delay": 2.0}
                        ],
                    },
                    {
                        "type": "Layer",
                        "content": {
                            "type": "Text",
                            "text": "Breaking News",
                            "style": {"top": "2%", "width": "92%"},
                        },
                        "animations": [
                            {"property": "opacity", "from": 0, "to": 1, "delay": 2.0}
                        ],
                    },
                ],
            },
        }
    ]
    enriched, notes = enrich_sub_visuals(cuts, video_format="portrait")
    assert len(enriched) == 1
    assert len(notes) >= 3  # clamped void + injected scrim + safe area + ambient drift
    children = enriched[0]["composition"]["children"]
    # Verify scrim was injected
    assert any(c.get("name") == "auto_vignette_scrim" for c in children)
    # Verify delay was clamped to 0.0s
    assert children[0]["animations"][0]["delay"] == 0.0
