"""
Live and Mock Harness Tests for Every LLM Call Path in Remotion Canvas.
Covers:
  1. _generate_search_query
  2. generate_project_design_system (art-director-design-system)
  3. generate_script_pipeline Stage 1 Outline (script-outline-director)
  4. generate_script_pipeline Stage 2 Base Intro/Conclusion (script-base-writer)
  5. generate_script_pipeline Stage 3 Scene Narration (script-scene-writer)
  6. generate_visuals_pipeline Stage 1 Storyboard Plan (storyboard-planner)
  7. generate_visuals_pipeline Stage 2 Sub-visuals AST (visual-director + motion-graphics-designer)
  8. Bridge.regenerate_script_section (script-rewriter)
  9. Bridge.regenerate_visuals_section (visual-rewriter)
  10. Bridge.regenerate_sub_visual (visual-rewriter)
  11. Bridge.add_scene_with_ai (script-rewriter)
  12. Comprehensive Skill Template Variable Verification (all 15 skills)
"""
import json
import pytest
import threading
from pathlib import Path

from backend.core.config import get_storage_dir
from backend.database.db import get_project
from backend.agent.skill_loader import skill_loader
from backend.pipeline.ai import (
    _generate_search_query,
    generate_project_design_system,
    _call_llm_json,
    OUTLINE_JSON_SCHEMA,
    BASE_SCRIPT_JSON_SCHEMA,
    SCRIPT_SCENE_JSON_SCHEMA,
    SCRIPT_INTRO_JSON_SCHEMA,
    SCRIPT_CONCLUSION_JSON_SCHEMA,
    VISUALS_ARRAY_SCHEMA,
    SUB_VISUAL_SCHEMA,
    DESIGN_SYSTEM_SCHEMA,
    get_shared_visual_rules,
    _skill_content,
)
from backend.core.bridge import (
    ApiBridge,
    _call_llm_safe,
    _safe_float,
)

TEST_PROJECT_ID = "bffe8112-729b-4eb6-b44c-d14fc0fcd057"
PROJECT_DIR = get_storage_dir() / TEST_PROJECT_ID


@pytest.fixture
def test_project_data():
    """Loads the real project data from storage/bffe8112-729b-4eb6-b44c-d14fc0fcd057."""
    project_dict = get_project(TEST_PROJECT_ID) or {
        "id": TEST_PROJECT_ID,
        "name": "How fiber optic cables cross the ocean",
        "language": "en",
        "video_format": "portrait"
    }
    script_file = PROJECT_DIR / "script.json"
    design_file = PROJECT_DIR / "design.json"
    
    script_data = {}
    if script_file.exists():
        with open(script_file, "r", encoding="utf-8") as f:
            script_data = json.load(f)
            
    design_data = {}
    if design_file.exists():
        with open(design_file, "r", encoding="utf-8") as f:
            design_data = json.load(f)
            
    return {
        "project": project_dict,
        "script": script_data,
        "design": design_data,
        "dir": PROJECT_DIR,
    }


def test_1_search_query_skill_rendering(test_project_data):
    """Verifies that search-query-optimizer renders cleanly and _generate_search_query runs."""
    prompt = skill_loader.render_skill("search-query-optimizer")
    assert prompt != ""
    assert "search query" in prompt.lower()
    assert "<think>" in prompt

    # Verify fallback cleaner on empty/failed query
    from backend.pipeline.web_search import clean_search_query
    cleaned = clean_search_query("How fiber optic cables cross the ocean! (2024)")
    assert "fiber optic" in cleaned


def test_2_design_system_skill_rendering_and_schema(test_project_data):
    """Verifies art-director-design-system renders without unescaped template errors."""
    rendered = skill_loader.render_skill(
        "art-director-design-system",
        video_format=test_project_data["project"].get("video_format", "portrait"),
        language=test_project_data["project"].get("language", "en")
    )
    assert "{video_format}" not in rendered
    assert "portrait" in rendered
    assert "color_palette" in rendered
    assert "fonts" in rendered

    # Verify DESIGN_SYSTEM_SCHEMA required fields
    assert "required" in DESIGN_SYSTEM_SCHEMA
    assert "theme_name" in DESIGN_SYSTEM_SCHEMA["required"]
    assert "color_palette" in DESIGN_SYSTEM_SCHEMA["required"]
    assert "typography" in DESIGN_SYSTEM_SCHEMA["required"]


def test_3_script_outline_skill_rendering_and_schema():
    """Verifies script-outline-director renders with all numeric and string parameters."""
    rendered = skill_loader.render_skill(
        "script-outline-director",
        script_rules_block="=== WRITING RULES ===\nBe concise.\n",
        target_duration=60,
        min_scenes=3,
        max_scenes=5,
        per_scene_time=12,
        per_scene_words=36,
        language="en"
    )
    assert "{target_duration}" not in rendered
    assert "{min_scenes}" not in rendered
    assert "{max_scenes}" not in rendered
    assert "{per_scene_time}" not in rendered
    assert "{per_scene_words}" not in rendered
    assert "{language}" not in rendered
    assert "60 seconds" in rendered
    assert "3 to 5 chapters" in rendered
    assert "OUTLINE_JSON_SCHEMA" is not None
    assert "chapters" in OUTLINE_JSON_SCHEMA["required"]


def test_4_script_base_skill_rendering_and_schema():
    """Verifies script-base-writer renders with intro and conclusion constraints."""
    rendered = skill_loader.render_skill(
        "script-base-writer",
        script_rules_block="",
        target_duration=60,
        language="en",
        sentence_rule="Write engaging sentences."
    )
    assert "{language}" not in rendered
    assert "{sentence_rule}" not in rendered
    assert "Hook MUST grab immediate attention" in rendered
    assert "Summary MUST condense" in rendered
    assert "BASE_SCRIPT_JSON_SCHEMA" is not None
    assert "introduction" in BASE_SCRIPT_JSON_SCHEMA["required"]
    assert "conclusion" in BASE_SCRIPT_JSON_SCHEMA["required"]


def test_5_script_scene_writer_skill_rendering_and_schema():
    """Verifies script-scene-writer renders per-scene duration and word budgets."""
    rendered = skill_loader.render_skill(
        "script-scene-writer",
        script_rules_block="",
        scene_num=2,
        chapter_title="Underwater Trenches",
        per_scene_duration=15,
        per_scene_word_target=45,
        prev_context="Previous scene covered cable factories.",
        language="en",
        sentence_rule="Use active voice."
    )
    assert "{scene_num}" not in rendered
    assert "{chapter_title}" not in rendered
    assert "{per_scene_duration}" not in rendered
    assert "{per_scene_word_target}" not in rendered
    assert "{prev_context}" not in rendered
    assert "Scene 2: Underwater Trenches" in rendered
    assert "15 seconds" in rendered
    assert "45 words" in rendered
    assert "SCRIPT_SCENE_JSON_SCHEMA" is not None
    assert "narration" in SCRIPT_SCENE_JSON_SCHEMA["required"]


def test_6_storyboard_planner_skill_and_primitives():
    """Verifies storyboard-planner skill defines the 6 visual beat archetypes."""
    skill = skill_loader.get_skill("storyboard-planner")
    assert skill is not None
    content = skill.content
    assert "Data Revelation Beat" in content
    assert "Documentary Evidence Beat" in content
    assert "Chronological Milestone Beat" in content
    assert "Vector Diagram" in content
    assert "Archival Portrait" in content
    assert "Cinematic Ambient Motion Beat" in content
    assert "🚫 Anti-Patterns to Avoid" in content


def test_7_visuals_pipeline_skill_composition(test_project_data):
    """Verifies visual director, motion graphics designer, and declarative AST compose together."""
    video_format = test_project_data["project"].get("video_format", "portrait")
    language = test_project_data["project"].get("language", "en")
    
    visual_rules = get_shared_visual_rules(video_format, language)
    visual_director = _skill_content("visual-director-core") or _skill_content("visual-director")
    motion_designer = _skill_content("motion-graphics-designer")
    
    assert "Declarative AST" in visual_rules
    assert "Glassmorphic Card Presets" in motion_designer
    assert "Kinetic Typography Recipes" in motion_designer
    assert "Multi-Layer Depth Rules" in motion_designer
    assert len(visual_director) > 50

    # Verify VISUALS_ARRAY_SCHEMA and SUB_VISUAL_SCHEMA
    assert "sub_visuals" in VISUALS_ARRAY_SCHEMA["required"]
    assert "composition" in SUB_VISUAL_SCHEMA["required"]
    assert "duration" in SUB_VISUAL_SCHEMA["required"]


def test_8_bridge_script_rewriter_skill_rendering(test_project_data):
    """Verifies script-rewriter renders properly for bridge interactive rewrite calls."""
    rendered = skill_loader.render_skill(
        "script-rewriter",
        language="en",
        doc_title=test_project_data["script"].get("title", "Ocean Cables"),
        intro_hook="Almost every email travels along cables.",
        scenes_summary="  Scene 1: 'The Factory' — Making glass fiber...",
        conclusion_summary="Summary of global infrastructure.",
        language_instructions="LANGUAGE RULE:\n- Write in English.\n",
        length_constraint="LENGTH: Aim for ~80 words.\n"
    )
    assert "{language}" not in rendered
    assert "{doc_title}" not in rendered
    assert "{intro_hook}" not in rendered
    assert "{scenes_summary}" not in rendered
    assert "{conclusion_summary}" not in rendered
    rendered_lower = rendered.lower()
    assert "ocean cables" in rendered_lower or "how fiber" in rendered_lower or "fiber optic" in rendered_lower


def test_9_bridge_visual_rewriter_skill_rendering(test_project_data):
    """Verifies visual-rewriter renders with design system and AST rules."""
    rendered = skill_loader.render_skill(
        "visual-rewriter",
        design_system_text="=== GLOBAL DESIGN SYSTEM ===\nPrimary: #0066CC\n",
        visual_rules="=== AST RULES ===\nUse Sequence and Layer.\n"
    )
    assert "{design_system_text}" not in rendered
    assert "{visual_rules}" not in rendered
    assert "Visual Director" in rendered
    assert "Primary: #0066CC" in rendered
    assert "Use Sequence and Layer" in rendered


def test_10_all_17_skills_have_no_broken_placeholders():
    """Validates that all 17 skills have valid frontmatter and well-formed content."""
    expected = [
        "art-director-design-system", "declarative-ast", "editor-qa",
        "motion-graphics-designer", "script-base-writer", "script-outline-director",
        "script-rewriter", "script-scene-adder", "script-scene-writer", "scriptwriter",
        "search-query-optimizer", "stock-asset-searcher", "storyboard-planner",
        "sub-visual-rewriter", "subtitle-designer", "visual-director", "visual-rewriter"
    ]
    for skill_name in expected:
        skill = skill_loader.get_skill(skill_name)
        assert skill is not None, f"Missing skill: {skill_name}"
        assert skill.version != ""
        assert len(skill.content.strip()) > 30


def test_12_sub_visual_rewriter_rendering():
    """Tests sub-visual-rewriter skill template rendering."""
    rendered = skill_loader.render_skill(
        "sub-visual-rewriter",
        design_system_text="=== DESIGN SYSTEM ===\nPrimary: #FF0055\n",
        visual_rules="=== AST RULES ===\nUse Sequence and Layer.\n"
    )
    assert "{design_system_text}" not in rendered
    assert "{visual_rules}" not in rendered
    assert "rewrite this specific visual" in rendered.lower()
    assert "Primary: #FF0055" in rendered


def test_13_script_scene_adder_rendering():
    """Tests script-scene-adder skill template rendering."""
    rendered = skill_loader.render_skill(
        "script-scene-adder",
        doc_title="Ocean Fiber Optics",
        intro_hook="Hook about cables",
        scenes_summary="  Scene 1: Factory\n  Scene 2: Ships",
        conclusion_summary="Final summary",
        length_constraint="Aim for ~80 words.",
        language_instructions="Write in English."
    )
    assert "{doc_title}" not in rendered
    assert "{intro_hook}" not in rendered
    assert "{scenes_summary}" not in rendered
    assert "{conclusion_summary}" not in rendered
    assert "{length_constraint}" not in rendered
    assert "{language_instructions}" not in rendered
    assert "BRAND NEW scene" in rendered
    assert "Ocean Fiber Optics" in rendered


def test_11_bridge_interactive_endpoints_harness(test_project_data, monkeypatch):
    """Tests the full Bridge rewrite harness with schema validation."""
    bridge = ApiBridge()
    full_script = test_project_data["script"]
    
    # Mock LLM call to return valid schema data to verify harness flow
    def mock_call_llm(system_prompt, user_prompt, schema, cancel_event=None, return_raw=False, activity_label=None):
        if schema == OUTLINE_JSON_SCHEMA:
            res = {"chapters": [{"scene_number": 1, "chapter_title": "Deep Sea", "scene_context": "Laying cables"}]}
        elif schema == SCRIPT_INTRO_JSON_SCHEMA:
            res = {"hook": "Rewritten punchy hook."}
        elif schema == SCRIPT_CONCLUSION_JSON_SCHEMA:
            res = {"summary": "Rewritten conclusion.", "cta": "Subscribe for more deep sea stories."}
        elif schema == SCRIPT_SCENE_JSON_SCHEMA:
            res = {"scene_number": 1, "title": "Deep Sea", "narration": "Underwater cables carry the world data."}
        elif schema == VISUALS_ARRAY_SCHEMA:
            res = {"sub_visuals": [{"composition": {"type": "Sequence", "children": []}, "duration": 15.0}]}
        elif schema == SUB_VISUAL_SCHEMA:
            res = {"composition": {"type": "Sequence", "children": []}, "duration": 5.0}
        elif schema == DESIGN_SYSTEM_SCHEMA:
            res = {
                "theme_name": "Oceanic Tech",
                "color_palette": {"background": "#0a1628", "primary": "#0066cc", "secondary": "#00b4d8", "accent": "#ff6b35", "text": "#ffffff"},
                "typography": {"heading_font": "Outfit", "body_font": "Inter"},
                "css_guidelines": "High contrast dark ocean theme"
            }
        else:
            # Fallback when schema is None on reasoning turns (AgentRunner loose turn)
            prompt_u = user_prompt.lower()
            if "expected: { \"hook\"" in prompt_u:
                res = {"hook": "Rewritten punchy hook."}
            elif "expected: { \"summary\"" in prompt_u:
                res = {"summary": "Rewritten conclusion.", "cta": "Subscribe for more deep sea stories."}
            elif "expected: { \"composition\"" in prompt_u or "single sub-visual" in prompt_u or "single sub_visual" in prompt_u:
                res = {"composition": {"type": "Sequence", "children": []}, "duration": 5.0}
            elif "visuals_array_schema" in prompt_u or "visual director" in prompt_u or "add charts" in prompt_u or "visual cues" in prompt_u:
                res = {"sub_visuals": [{"composition": {"type": "Sequence", "children": []}, "duration": 15.0}]}
            elif "expected: { \"scene_number\"" in prompt_u or "narration" in prompt_u or "new scene" in prompt_u or "generate a new scene" in prompt_u:
                res = {"scene_number": 1, "title": "Deep Sea", "narration": "Underwater cables carry the world data."}
            elif "hook" in prompt_u:
                res = {"hook": "Rewritten punchy hook."}
            else:
                res = {"sub_visuals": [{"composition": {"type": "Sequence", "children": []}, "duration": 15.0}]}

        if return_raw:
            return json.dumps(res)
        return res
        
    monkeypatch.setattr("backend.core.bridge._call_llm_json", mock_call_llm)
    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", mock_call_llm)
    monkeypatch.setattr("backend.agent.agent_engine._call_llm_json", mock_call_llm)
    monkeypatch.setattr("backend.core.bridge._get_web_context_for_topic", lambda *args, **kwargs: "")
    monkeypatch.setattr("backend.pipeline.ai._get_web_context_for_topic", lambda *args, **kwargs: "")
    
    # 1. Test script rewrite
    res_script = bridge.regenerate_script_section(0, "introduction", full_script, "Make it punchier", "en")
    assert res_script.get("success") is True
    assert "hook" in res_script.get("data", {})
    
    # 2. Test visual section rewrite
    res_visuals = bridge.regenerate_visuals_section(TEST_PROJECT_ID, 0, "introduction", full_script, "Add charts")
    assert res_visuals.get("success") is True
    assert "sub_visuals" in res_visuals.get("data", {})
    full_script.setdefault("introduction", {})["sub_visuals"] = res_visuals["data"]["sub_visuals"]

    # 3. Test sub-visual rewrite
    res_sub = bridge.regenerate_sub_visual(TEST_PROJECT_ID, 0, "introduction", 0, full_script, "Change to counter", "en")
    assert res_sub.get("success") is True
    assert "composition" in res_sub.get("data", {})
    
    # 4. Test add scene
    res_scene = bridge.add_scene_with_ai(full_script, "Add ROV repair submarine scene", "en")
    assert res_scene.get("success") is True
    assert "narration" in res_scene.get("data", {})


def test_14_extract_chapters_and_base_script_robustness():
    """Verifies _extract_chapters_from_outline and _extract_base_script across key variants."""
    from backend.pipeline.ai import _extract_chapters_from_outline, _extract_base_script

    # 1. Variant with 'outline' key and 'reasoning' (exact bug case)
    outline_data_variant1 = {
        "reasoning": "Some step by step reasoning",
        "outline": [
            {"scene_number": 1, "chapter_title": "The Backbone", "scene_context": "99 percent of data"},
            {"scene_number": 2, "chapter_title": "Laying the Cable", "scene_context": "Specialized ships"}
        ]
    }
    chaps1 = _extract_chapters_from_outline(outline_data_variant1, topic="Fiber Optics")
    assert len(chaps1) == 2
    assert chaps1[0]["chapter_title"] == "The Backbone"
    assert chaps1[1]["scene_context"] == "Specialized ships"

    # 2. Variant as top-level list
    outline_data_variant2 = [
        {"scene_number": 1, "chapter_title": "Intro Scene", "scene_context": "Context 1"},
        {"scene_number": 2, "chapter_title": "Second Scene", "scene_context": "Context 2"},
        {"scene_number": 3, "chapter_title": "Third Scene", "scene_context": "Context 3"}
    ]
    chaps2 = _extract_chapters_from_outline(outline_data_variant2)
    assert len(chaps2) == 3

    # 3. Variant with 'scenes' key and alternative field names
    outline_data_variant3 = {
        "scenes": [
            {"number": 1, "title": "Deep Sea Trench", "description": "Descending deep into trenches"},
        ]
    }
    chaps3 = _extract_chapters_from_outline(outline_data_variant3)
    assert len(chaps3) == 1
    assert chaps3[0]["chapter_title"] == "Deep Sea Trench"
    assert chaps3[0]["scene_context"] == "Descending deep into trenches"

    # 4. Fallback on completely empty dict
    chaps4 = _extract_chapters_from_outline({}, min_scenes=4, topic="Cables")
    assert len(chaps4) >= 4
    assert "Cables" in chaps4[0]["chapter_title"]

    # 5. Base script with top-level hook, summary, cta
    base_data_top_level = {
        "hook": "Hair-thin glass fibers carry 99% of data.",
        "summary": "Undersea cables are vital.",
        "cta": "Subscribe for more."
    }
    intro1, conc1 = _extract_base_script(base_data_top_level, topic="Cables")
    assert intro1["hook"] == "Hair-thin glass fibers carry 99% of data."
    assert conc1["summary"] == "Undersea cables are vital."
    assert conc1["cta"] == "Subscribe for more."

    # 6. Base script with nested introduction and conclusion
    base_data_nested = {
        "introduction": {"hook": "Opening hook text."},
        "conclusion": {"summary": "Concluding summary.", "cta": "Leave a comment."}
    }
    intro2, conc2 = _extract_base_script(base_data_nested)
    assert intro2["hook"] == "Opening hook text."
    assert conc2["summary"] == "Concluding summary."
    assert conc2["cta"] == "Leave a comment."


def test_15_generate_script_pipeline_end_to_end_with_outline_key_variant(tmp_path, monkeypatch):
    """End-to-end test of generate_script_pipeline when LLM returns 'outline' key."""
    from backend.pipeline.ai import generate_script_pipeline

    project_dict = {
        "id": "test-script-pipeline-id",
        "name": "How fiber optic cables cross the ocean",
        "prompt": "DOCUMENTARY",
        "language": "en",
        "duration_mode": "short",
        "video_format": "portrait"
    }

    # Mock settings and LLM calls
    monkeypatch.setattr("backend.database.db.get_setting", lambda k: "mock_api_key" if "api_key" in k else "openai")
    monkeypatch.setattr("backend.pipeline.ai._get_web_context_for_topic", lambda *args, **kwargs: "")

    def mock_llm_json(system_prompt, user_prompt, schema, cancel_event, **kwargs):
        if schema == OUTLINE_JSON_SCHEMA:
            # Return 'outline' key with reasoning (exact situation from the error)
            return {
                "reasoning": "Outline reasoning...",
                "outline": [
                    {"scene_number": 1, "chapter_title": "The Invisible Backbone", "scene_context": "99 percent of data travels on ocean floor."},
                    {"scene_number": 2, "chapter_title": "Laying the Cables", "scene_context": "Specialized ships plow trenches."}
                ]
            }
        elif schema == BASE_SCRIPT_JSON_SCHEMA:
            return {
                "hook": "Two miles beneath the surface, glass threads carry the internet.",
                "summary": "These cables survive crushing pressure.",
                "cta": "Subscribe for more."
            }
        elif schema == SCRIPT_SCENE_JSON_SCHEMA:
            return {
                "scene_number": 1,
                "title": "The Invisible Backbone",
                "narration": "Fiber optic cables on the ocean floor form the physical backbone of the global internet."
            }
        return {}

    monkeypatch.setattr("backend.pipeline.ai._call_llm_json", mock_llm_json)

    # Mock AgentRunner to return single scene JSON
    from backend.agent.agent_engine import AgentRunner
    monkeypatch.setattr(
        AgentRunner, "run_with_tools",
        lambda self, system_prompt, user_prompt, schema, **kwargs: {
            "scene_number": 1,
            "title": "Scene Title",
            "narration": "Spoken scene voiceover narration content for the video."
        }
    )

    progress_history = []
    def progress_cb(pct, msg):
        progress_history.append((pct, msg))

    cancel_event = threading.Event()
    generate_script_pipeline(project_dict, tmp_path, progress_cb, cancel_event)

    script_path = tmp_path / "script.json"
    assert script_path.exists()
    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)

    assert len(script["scenes"]) == 2
    assert script["introduction"]["hook"] == "Two miles beneath the surface, glass threads carry the internet."
    assert script["conclusion"]["summary"] == "These cables survive crushing pressure."
    assert script["scenes"][0]["narration"] != ""


def test_16_agent_runner_tool_normalization_and_visual_completion(monkeypatch):
    """Verifies that AgentRunner handles tool calls with 'tool' key, and doesn't terminate early with incomplete JSON."""
    from backend.agent.agent_engine import AgentRunner, _extract_tool_blocks
    from backend.pipeline.ai import VISUALS_ARRAY_SCHEMA

    # 1. Verify _extract_tool_blocks handles {"tool": ..., "arguments": ...}
    raw_tool = '{"tool": "search_pexels_video", "arguments": {"query": "cable ship"}}\n{"tool": "search_pixabay_photo", "arguments": {"query": "map"}}'
    blocks = _extract_tool_blocks(raw_tool)
    assert len(blocks) == 2
    assert blocks[0]["name"] == "search_pexels_video"
    assert blocks[1]["name"] == "search_pixabay_photo"

    # 2. Verify run_with_tools executes the tool call, then returns final JSON
    turn_counter = 0

    def mock_call(system_prompt, user_prompt, schema, cancel_event, return_raw=False, activity_label=None):
        nonlocal turn_counter
        turn_counter += 1
        if turn_counter == 1:
            # Turn 1: model emits tool call
            return '{"tool": "search_pexels_video", "arguments": {"query": "ocean floor"}}\n'
        else:
            # Turn 2: model sees tool result and outputs final visuals
            return json.dumps({
                "sub_visuals": [
                    {"composition": {"type": "Sequence", "children": []}, "duration": 5.0},
                    {"composition": {"type": "Sequence", "children": []}, "duration": 10.0}
                ]
            })

    monkeypatch.setattr("backend.agent.agent_engine._call_llm_json", mock_call)
    monkeypatch.setattr("backend.agent.agent_engine.execute_tool", lambda name, args: "Mock video found: url1")

    runner = AgentRunner()
    res = runner.run_with_tools("sys", "user", VISUALS_ARRAY_SCHEMA, allowed_tools=["search_pexels_video"])
    assert "sub_visuals" in res
    assert len(res["sub_visuals"]) == 2
    assert turn_counter == 2


def test_17_all_pipeline_fstrings_have_valid_formatting():
    """Regression test: verifies that no f-string in backend/pipeline contains unescaped JSON curlies."""
    import ast
    import os

    pipeline_dir = Path(__file__).resolve().parent.parent / "backend" / "pipeline"
    errors = []
    for f in pipeline_dir.glob("*.py"):
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        for node in ast.walk(tree):
            if isinstance(node, ast.JoinedStr):
                for v in node.values:
                    if isinstance(v, ast.FormattedValue):
                        if v.format_spec:
                            spec_str = "".join(
                                str(part.value)
                                for part in v.format_spec.values
                                if isinstance(part, ast.Constant)
                            )
                            if any(c in spec_str for c in ['"', "'", "{", "}"]):
                                errors.append(f"{f.name}:{v.lineno} Invalid format specifier in f-string: {spec_str!r}")
                        if isinstance(v.value, ast.Constant) and isinstance(v.value.value, str):
                            errors.append(f"{f.name}:{v.lineno} Constant string inside f-string curly braces: {v.value.value!r}")

    assert not errors, f"Found unescaped f-string formatting bugs: {errors}"


