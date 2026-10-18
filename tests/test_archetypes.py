"""Tests for Macro-Archetype Compiler Engine (backend/pipeline/archetypes.py)
and its integrations into validators, payloads, and MCP server.
"""

import json
import pytest
from backend.pipeline.archetypes import (
    ARCHETYPE_REGISTRY,
    compile_archetype,
    compile_cut,
    get_archetype_catalog,
)
from backend.agent.validators import validate_sub_visuals
from backend.mcp.payloads import save_visuals_payload
from backend.mcp.server import get_archetypes
from tests.test_mcp import _setup_visuals_proj


ALL_25_ARCHETYPES = [
    # 1. Typography & Hooks
    "kinetic_punch",
    "word_matrix",
    "editorial_quote",
    # 2. Data & Metrics
    "data_surge",
    "trend_trajectory",
    "split_metric_card",
    "financial_breakdown",
    "comparative_bars",
    # 3. Forensics & Tech
    "evidence_document",
    "forensic_dossier",
    "system_architecture",
    "code_terminal",
    "timeline_milestones",
    "network_graph",
    # 4. Comparison & Geography
    "versus_battle",
    "map_flight_path",
    "before_after_split",
    "quadrant_matrix",
    # 5. Cinematic Media & Mockups
    "split_screen_dialogue",
    "device_mockup_phone",
    "device_mockup_browser",
    "archival_filmstrip",
    # 6. Drama & Conclusion
    "philosophical_dilemma",
    "scorecard_verdict",
    "cinematic_outro_cta",
]


class TestArchetypeCatalog:
    """Verify registry size, categories, and query capabilities."""

    def test_all_25_archetypes_registered(self):
        for name in ALL_25_ARCHETYPES:
            assert name in ARCHETYPE_REGISTRY, f"Missing archetype in registry: {name}"

    def test_catalog_query_all(self):
        catalog = get_archetype_catalog()
        assert len(catalog) == 25
        for item in catalog:
            assert "name" in item
            assert "category" in item
            assert "description" in item
            assert "slots" in item
            assert isinstance(item["slots"], list)

    def test_catalog_query_by_category(self):
        typo = get_archetype_catalog(category="typography")
        assert len(typo) == 3
        assert {item["name"] for item in typo} == {"kinetic_punch", "word_matrix", "editorial_quote"}

        data = get_archetype_catalog(category="data_finance")
        assert len(data) == 5

        forensics = get_archetype_catalog(category="forensics_tech")
        assert len(forensics) == 6

        comparison = get_archetype_catalog(category="comparison_geo")
        assert len(comparison) == 4

        cinematic = get_archetype_catalog(category="cinematic_mockups")
        assert len(cinematic) == 4

        drama = get_archetype_catalog(category="drama_conclusion")
        assert len(drama) == 3

    def test_catalog_unknown_category(self):
        empty = get_archetype_catalog(category="nonexistent_category_xyz")
        assert empty == []


class TestArchetypeBuilders:
    """Verify each of the 25 builders compiles a valid multi-layer AST."""

    @pytest.mark.parametrize("archetype_name", ALL_25_ARCHETYPES)
    def test_each_archetype_compiles_with_defaults(self, archetype_name):
        cut = compile_archetype(archetype_name, params={}, design_tokens=None)
        assert isinstance(cut, dict)
        assert "composition" in cut
        children = cut["composition"].get("children", [])
        assert len(children) >= 3, f"{archetype_name} should produce a multi-layer stack (>=3 layers)"
        for layer in children:
            assert "content" in layer
            assert "type" in layer["content"]
            assert "animations" in layer

    def test_design_tokens_injection(self):
        tokens = {
            "color_palette": {
                "background": "#000000",
                "primary": "#ff0055",
                "secondary": "#00ffcc",
                "accent": "#ffea00",
                "text": "#f8fafc",
            },
            "typography": {
                "heading_font": "Space Grotesk",
                "body_font": "Inter",
            },
        }
        cut = compile_archetype(
            "data_surge",
            params={
                "target_number": 500,
                "prefix": "$",
                "unit": "M",
                "label": "REVENUE",
            },
            design_tokens=tokens,
        )
        children = cut["composition"]["children"]
        assert len(children) >= 4
        counter_layer = next((l for l in children if l["content"]["type"] == "Counter"), None)
        assert counter_layer is not None
        assert counter_layer["content"]["value"] == 500
        assert counter_layer["content"]["prefix"] == "$"
        assert counter_layer["content"]["suffix"] == " M"
        assert counter_layer["content"]["color"] == "#ffea00"  # accent

    def test_custom_params_kinetic_punch(self):
        cut = compile_archetype(
            "kinetic_punch",
            params={
                "headline": "TOTAL MARKET MELTDOWN",
                "accent_word": "MELTDOWN",
                "accent_box": True,
            },
        )
        children = cut["composition"]["children"]
        assert any(l["content"].get("text") == "TOTAL MARKET MELTDOWN" for l in children if l["content"]["type"] == "Text")
        # Check accent box layer
        box_layer = next((l for l in children if l["name"] == "Accent highlight box"), None)
        assert box_layer is not None
        assert box_layer["content"]["type"] == "Shape"

    def test_custom_params_evidence_document(self):
        cut = compile_archetype(
            "evidence_document",
            params={
                "doc_title": "CONFIDENTIAL REPORT",
                "stamp": "LEAKED",
                "highlight_text": "ACCOUNT BALANCE 0",
            },
        )
        children = cut["composition"]["children"]
        assert any("LEAKED" in l["content"].get("text", "") for l in children if l["content"]["type"] == "Text")

    def test_unknown_archetype_raises_error(self):
        with pytest.raises(ValueError, match="Unknown archetype 'not_a_real_archetype'"):
            compile_archetype("not_a_real_archetype")


class TestCompileCut:
    """Verify compile_cut helper handles raw AST, archetypes, and fallbacks."""

    def test_cut_already_has_composition(self):
        cut = {
            "duration": 4.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {"type": "Background", "background_preset": "gradient_mesh"},
                        "animations": [],
                    }
                ],
            },
        }
        res = compile_cut(cut)
        assert res["duration"] == 4.0
        assert len(res["composition"]["children"]) == 1

    def test_cut_with_archetype(self):
        cut = {
            "duration": 6.5,
            "transition": "slide_left",
            "archetype": "versus_battle",
            "params": {
                "entity_left": "NVIDIA",
                "entity_right": "INTEL",
                "vs_tag": "GPU WARS",
            },
        }
        compiled = compile_cut(cut)
        assert compiled["duration"] == 6.5
        assert compiled["transition"] == "slide_left"
        assert "composition" in compiled
        assert len(compiled["composition"]["children"]) >= 4
        assert compiled["archetype"] == "versus_battle"

    def test_cut_missing_both_composition_and_archetype(self):
        raw = {"duration": 3.0}
        compiled = compile_cut(raw)
        # Should create fallback foundation background
        assert "composition" in compiled
        assert len(compiled["composition"]["children"]) >= 1


class TestValidatorIntegration:
    """Verify validate_sub_visuals compiles and validates archetype cuts."""

    def test_validate_sub_visuals_with_archetypes(self):
        cuts = [
            {
                "duration": 4.0,
                "archetype": "kinetic_punch",
                "params": {"headline": "AI WILL REPLACE CODE"},
            },
            {
                "duration": 5.0,
                "archetype": "data_surge",
                "params": {"target_number": 99, "unit": "%", "label": "AUTOMATION RATE"},
            },
        ]
        is_valid, valid_cuts, error_msg = validate_sub_visuals(cuts, target_duration=9.0, auto_enrich=True)
        assert is_valid is True, f"Validator error: {error_msg}"
        assert error_msg == ""
        assert len(valid_cuts) == 2
        for cut in valid_cuts:
            assert "composition" in cut
            assert len(cut["composition"]["children"]) >= 3


class TestPayloadIntegration:
    """Verify save_visuals_payload compiles archetypes and applies enricher."""

    def test_save_visuals_with_archetype(self, tmp_path, monkeypatch):
        _setup_visuals_proj(tmp_path, monkeypatch)
        cuts = [
            {
                "duration": 10.0,
                "archetype": "philosophical_dilemma",
                "params": {"question_text": "WHO OWNS THE CODE?"},
            }
        ]
        result = save_visuals_payload(
            project_id="proj_mcp",
            section_type="introduction",
            sub_visuals=cuts,
        )
        assert result.get("ok") is True, f"save_visuals_payload failed: {result}"
        assert "auto_fixed" in result
        assert any("compiled macro-archetype 'philosophical_dilemma'" in fix for fix in result["auto_fixed"])


class TestMcpServerIntegration:
    """Verify MCP server tool get_archetypes."""

    def test_mcp_get_archetypes_all(self):
        res = get_archetypes()
        assert res.get("ok") is True
        assert res["count"] == 25
        assert len(res["archetypes"]) == 25

    def test_mcp_get_archetypes_filtered(self):
        res = get_archetypes(category="forensics_tech")
        assert res.get("ok") is True
        assert res["count"] == 6
        for arch in res["archetypes"]:
            assert arch["category"] == "forensics_tech"
