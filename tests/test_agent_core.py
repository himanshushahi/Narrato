import pytest
from backend.agent.validators import validate_sub_visuals, normalize_transition
from backend.agent.cache import build_cache_key
from backend.agent.skill_loader import skill_loader

def test_cache_key():
    key = build_cache_key("openai", "gpt-4", 0.7, 1000, 1.0, "syshash", "userhash")
    assert key == "v2:openai:gpt-4:0.7:1000:1.0:S:syshash:userhash"

def test_cache_key_schema_flag():
    strict = build_cache_key("openai", "gpt-4", 0.7, 1000, 1.0, "s", "u", schema_flag="S")
    loose = build_cache_key("openai", "gpt-4", 0.7, 1000, 1.0, "s", "u", schema_flag="L")
    assert strict != loose

def test_validate_sub_visuals():
    svs = [
        {"duration": 10.0, "composition": {"type": "Sequence", "children": []}},
        {"duration": 5.0}
    ]
    is_valid, normalized, err = validate_sub_visuals(svs, 15.0)
    assert is_valid is True
    assert err == ""
    assert normalized[0]["composition"] == {"type": "Sequence", "children": []}
    assert normalized[0]["duration"] == 10.0
    assert normalized[1]["duration"] == 5.0

def test_validate_sub_visuals_normalization():
    svs = [
        {"duration": 10.0},
        {"duration": 10.0}
    ]
    is_valid, normalized, err = validate_sub_visuals(svs, 15.0)
    # Auto-normalized durations are treated as valid (no correction call needed)
    assert is_valid is True
    assert sum(v["duration"] for v in normalized) == 15.0
    assert normalized[0]["duration"] == 7.5
    assert normalized[1]["duration"] == 7.5

def test_validate_sub_visuals_empty_gets_dummy():
    is_valid, normalized, err = validate_sub_visuals([], 15.0)
    assert is_valid is False
    assert len(normalized) == 1
    assert normalized[0]["duration"] == 15.0
    assert "composition" in normalized[0]

def test_normalize_transition_fuzzy():
    assert normalize_transition("slide-up") == "slide_up"
    assert normalize_transition("zoom in") == "zoom_in"
    assert normalize_transition("dissolve") == "dissolve"
    assert normalize_transition("cut") == "cut"
    assert normalize_transition("made up") == "fade"

def test_skill_loader():
    skills = skill_loader.get_all_skills()
    assert "declarative-ast" in skills
    skill = skill_loader.get_skill("declarative-ast")
    assert skill is not None
    assert skill.version in ("1.0", "2.0")

def test_skill_loader_all_registered_skills():
    expected_skills = (
        "scriptwriter", "subtitle-designer", "declarative-ast",
        "stock-asset-searcher", "editor-qa", "visual-director-core",
        "storyboard-planner", "motion-graphics-designer", "art-director-design-system",
        "script-outline-director", "script-base-writer", "script-scene-writer",
        "script-rewriter", "script-scene-adder", "visual-rewriter", "sub-visual-rewriter",
        "search-query-optimizer"
    )
    for name in expected_skills:
        skill = skill_loader.get_skill(name)
        assert skill is not None, f"Skill {name} missing from skill_loader"
        assert len(skill.content.strip()) > 20, f"Skill {name} has empty content"

def test_skill_render_template_substitution():
    rendered = skill_loader.render_skill(
        "art-director-design-system",
        video_format="portrait",
        language="hi"
    )
    assert "portrait" in rendered
    assert "hi" in rendered
    # Ensure JSON braces and formatting were not corrupted
    assert "color_palette" in rendered
    assert "Noto Sans Devanagari" in rendered

def test_skill_render_all_prompt_skills():
    """Verify all pipeline prompt skills correctly substitute dynamic variables without leftover braces."""
    # 1. script-outline-director
    outline = skill_loader.render_skill(
        "script-outline-director",
        script_rules_block="=== CUSTOM RULES ===\n",
        target_duration=90,
        min_scenes=6,
        max_scenes=8,
        per_scene_time=12,
        per_scene_words=54,
        language="hi",
    )
    assert "CUSTOM RULES" in outline
    assert "90 seconds" in outline
    assert "6 to 8 chapters" in outline
    assert "code: 'hi'" in outline
    assert "{target_duration}" not in outline

    # 2. script-base-writer
    base = skill_loader.render_skill(
        "script-base-writer",
        script_rules_block="=== BASE RULES ===\n",
        language="hi",
        sentence_rule="Write tight sentences.",
    )
    assert "BASE RULES" in base
    assert "code: 'hi'" in base
    assert "Write tight sentences." in base
    assert "{language}" not in base

    # 3. script-scene-writer
    scene = skill_loader.render_skill(
        "script-scene-writer",
        script_rules_block="=== SCENE RULES ===\n",
        scene_num=3,
        chapter_title="The Breakthrough",
        per_scene_duration=15,
        per_scene_word_target=65,
        prev_context="Previous Scene (2): Discovery",
        language="en",
        sentence_rule="No filler words.",
    )
    assert "Scene 3: The Breakthrough" in scene
    assert "15 seconds" in scene
    assert "Previous Scene (2): Discovery" in scene
    assert "code: 'en'" in scene
    assert "No filler words." in scene
    assert "{scene_num}" not in scene

    # 4. script-rewriter
    rewriter = skill_loader.render_skill(
        "script-rewriter",
        language="hi",
        doc_title="Quantum Physics",
        intro_hook="What if time was an illusion?",
        scenes_summary="Scene 1: Entanglement",
        conclusion_summary="Final insights",
        language_instructions="Use Hindi.",
        length_constraint="Aim for 80 words.",
    )
    assert "Quantum Physics" in rewriter
    assert "What if time was an illusion?" in rewriter
    assert "Use Hindi." in rewriter
    assert "{doc_title}" not in rewriter

    # 5. script-scene-adder
    adder = skill_loader.render_skill(
        "script-scene-adder",
        language="hi",
        doc_title="AI Revolution",
        intro_hook="The machine age begins.",
        scenes_summary="Scene 1: Neural Nets",
        conclusion_summary="The future ahead",
        language_instructions="Use Devanagari.",
        length_constraint="Aim for 100 words.",
    )
    assert "AI Revolution" in adder
    assert "The machine age begins." in adder
    assert "Aim for 100 words." in adder
    assert "{doc_title}" not in adder

    # 6. visual-rewriter
    vis_rewriter = skill_loader.render_skill(
        "visual-rewriter",
        design_system_text="Design: Dark Theme",
        visual_rules="Rules: Use Charts",
    )
    assert "Design: Dark Theme" in vis_rewriter
    assert "Rules: Use Charts" in vis_rewriter
    assert "{design_system_text}" not in vis_rewriter

    # 7. sub-visual-rewriter
    sub_vis = skill_loader.render_skill(
        "sub-visual-rewriter",
        design_system_text="Design: Cyberpunk",
        visual_rules="Rules: Subtitle safe area",
    )
    assert "Design: Cyberpunk" in sub_vis
    assert "Rules: Subtitle safe area" in sub_vis
    assert "{visual_rules}" not in sub_vis

def test_skill_render_clears_none_values():
    """Verify that None values in context are cleanly replaced with empty strings."""
    rendered = skill_loader.render_skill(
        "script-scene-writer",
        script_rules_block=None,
        scene_num=1,
        chapter_title="Intro Beat",
        per_scene_duration=10,
        per_scene_word_target=30,
        prev_context=None,
        language="hi",
        sentence_rule=None,
    )
    assert "{script_rules_block}" not in rendered
    assert "{prev_context}" not in rendered
    assert "{sentence_rule}" not in rendered
    assert "Scene 1: Intro Beat" in rendered

def test_skill_render_missing_skill():
    rendered = skill_loader.render_skill("non-existent-skill-xyz", var="test")
    assert rendered == ""

def test_skill_hot_reload(tmp_path, monkeypatch):
    """Test that modifying a skill on disk reloads upon get_skill."""
    import time
    from backend.agent.skill_loader import SkillLoader
    
    skill_dir = tmp_path / "backend" / "skills" / "test-skill"
    skill_dir.mkdir(parents=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text("---\nname: test-skill\nversion: '1.0'\n---\nInitial Content", encoding="utf-8")
    
    loader = SkillLoader()
    loader.skills_dirs = [tmp_path / "backend" / "skills"]
    loader.reload_skills()
    
    skill = loader.get_skill("test-skill")
    assert skill is not None
    assert "Initial Content" in skill.content
    
    # Simulate editing the file on disk
    time.sleep(0.05)
    skill_file.write_text("---\nname: test-skill\nversion: '2.0'\n---\nUpdated Dynamic Content", encoding="utf-8")
    
    reloaded_skill = loader.get_skill("test-skill")
    assert reloaded_skill is not None
    assert "Updated Dynamic Content" in reloaded_skill.content
    assert reloaded_skill.version == "2.0"

def test_declarative_ast_skill_structure():
    skill = skill_loader.get_skill("declarative-ast")
    assert skill is not None
    assert "Sequence" in skill.content
    assert "Layer" in skill.content
    assert "content" in skill.content

def test_visual_rules_built_from_skills():
    from backend.pipeline.ai import get_shared_visual_rules
    rules = get_shared_visual_rules("landscape", "hi")
    # Skill-driven composition: AST architecture rules + safety net
    assert "Declarative AST" in rules
    assert "Sequence" in rules
    assert "Layer" in rules
    assert "SHARED RULES" in rules
    assert "ANIMATION TIMING" in rules



def test_run_with_tools_rejects_disallowed_tools(monkeypatch):
    """Tools not on the allowlist must be rejected and never executed."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        assert "update_subtitles" not in system  # disallowed tool not documented
        if calls["n"] == 1:
            return '```tool\n{"name": "update_subtitles", "arguments": {}}\n```\n'
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append(name)
        return "results"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"},
                                          allowed_tools={"web_search"})
    assert result == {"final": True}
    assert executed == []
    assert calls["n"] == 2


def test_visual_settings_spec_validators():
    """The visual-settings validation spec must accept valid values and
    reject bad colors/ranges/enums."""
    from backend.agent.tools import VISUAL_SETTINGS_SPEC

    assert VISUAL_SETTINGS_SPEC["activeColor"]("#facc15") is None
    assert VISUAL_SETTINGS_SPEC["activeColor"]("red") is not None
    assert VISUAL_SETTINGS_SPEC["activeColor"]("#fff") is not None
    assert VISUAL_SETTINGS_SPEC["fontSize"](20) is None
    assert VISUAL_SETTINGS_SPEC["fontSize"](151) is not None
    assert VISUAL_SETTINGS_SPEC["fontSize"](15.5) is not None
    assert VISUAL_SETTINGS_SPEC["backgroundStyle"]("full_block") is None
    assert VISUAL_SETTINGS_SPEC["backgroundStyle"]("solid") is not None



def test_visual_settings_cover_all_setting_tab_keys():
    """Every category the Settings tab exposes must have a validated key."""
    from backend.agent.tools import VISUAL_SETTINGS_SPEC
    keys = set(VISUAL_SETTINGS_SPEC)
    for needed in ("fontSize", "activeColor", "backgroundStyle", "fontFamily",
                   "numbering_title_color", "numbering_number_style",
                   "hide_chapter_name", "chapter_text_color"):
        assert needed in keys, f"Missing validated setting key {needed}"


def test_subtitle_settings_overview_groups():
    """The status-report overview must summarize settings by category."""
    from backend.agent.tools import _format_settings_overview
    out = _format_settings_overview({
        "fontFamily": "Oswald",
        "fontSize": 64,
        "activeColor": "#facc15",
        "numbering_title_color": "#ffffff",
        "chapter_text_color": "#38bdf8",
        "whisper_model": "large-v3",
        "render_resolution": "1080p",
    })
    assert "Subtitle style" in out
    assert '"fontSize": 64' in out
    assert "Numbering" in out
    assert "Chapter branding" in out
    assert "Whisper" in out and '"whisper_model": "large-v3"' in out
    assert "Render" in out and '"render_resolution": "1080p"' in out


def test_visual_settings_tool_schema_present():
    from backend.agent.tools import get_tools_schema
    names = {t["function"]["name"] for t in get_tools_schema()}
    assert "update_visual_settings" in names
    assert "update_subtitle_style" in names
    assert "update_design_settings" in names

def test_tools_schema_has_new_tools():
    from backend.agent.tools import get_tools_schema
    names = {t["function"]["name"] for t in get_tools_schema()}
    for tool in ("web_search", "get_skill",
                 "project_status_report", "update_scene_duration", "reorder_scenes",
                 "delete_scene", "add_scene_with_ai", "regenerate_script_section",
                 "regenerate_scene_visuals", "set_tts_settings"):
        assert tool in names, f"Tool {tool} missing from schema"
    assert "table" not in names

def test_agent_runner_no_api_key_returns_safe_error(monkeypatch):
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    def raise_no_key(system, user, schema, cancel_event, **kwargs):
        raise ValueError("Openai API key is missing. Please configure it in the settings panel.")

    monkeypatch.setattr(ae, "_call_llm_json", raise_no_key)

    result = AgentRunner().run_with_tools_safe("system", "prompt", {"type": "object"})
    assert result.get("success") is False
    assert "API key" in result.get("error", "")


def test_call_llm_safe_tools_mode_passes_cancel_event(monkeypatch):
    """Regression: the bridge's use_tools path must pass a real cancel event to
    AgentRunner — a None event used to crash _call_llm_json on every call."""
    import backend.core.bridge as bridge
    import backend.agent.agent_engine as ae

    seen = {}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        seen["cancel_event"] = cancel_event
        return '{"ok": true}'

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)

    result = bridge._call_llm_safe("system", "prompt", None, use_tools=True)

    assert result.get("success") is True
    assert seen["cancel_event"] is not None
    assert seen["cancel_event"].is_set() is False


def test_invalidate_scene_resolves_by_section_type(monkeypatch):
    """Manifests are laid out [introduction, scene..., conclusion]; scene
    indices must not be used to index the manifest list directly."""
    import json
    import backend.agent.tools as t

    manifest = [
        {"section_type": "introduction", "title": "Intro", "_narr_hash": "x"},
        {"section_type": "scene", "title": "A", "_narr_hash": "x", "_design_hash": "y"},
        {"section_type": "scene", "title": "B", "_narr_hash": "x", "_design_hash": "y"},
        {"section_type": "conclusion", "title": "End", "_narr_hash": "x"},
    ]
    saved = {}

    def fake_load(project_id, rel_path):
        if rel_path in ("assets/assets_manifest.json", "voiceover/manifest.json"):
            return json.loads(json.dumps(manifest))
        return None

    def fake_save(project_id, rel_path, data):
        saved[rel_path] = data
        return True

    monkeypatch.setattr(t, "_load_json", fake_load)
    monkeypatch.setattr(t, "_save_json", fake_save)
    monkeypatch.setattr(t, "_invalidate_voiceover", lambda pid: None)

    result = t.execute_tool("invalidate_scene", {"project_id": "p1", "scene_index": 0})

    assert "Invalidated scene 0" in result
    assert saved  # both manifests were written
    for data in saved.values():
        intro = next(e for e in data if e.get("section_type") == "introduction")
        scenes = [e for e in data if e.get("section_type") == "scene"]
        conclusion = next(e for e in data if e.get("section_type") == "conclusion")
        assert "_narr_hash" in intro       # scene 0's hashes popped, intro untouched
        assert "_narr_hash" not in scenes[0]
        assert "_narr_hash" in scenes[1]   # scene 1 untouched
        assert "_narr_hash" in conclusion

    # String indices from the LLM must be coerced to ints, not crash comparisons.
    saved.clear()
    result = t.execute_tool("invalidate_scene", {"project_id": "p1", "scene_index": "1"})
    assert "Invalidated scene 1" in result
    for data in saved.values():
        scenes = [e for e in data if e.get("section_type") == "scene"]
        assert "_narr_hash" not in scenes[1]
        assert "_narr_hash" in scenes[0]


def test_run_with_tools_restricts_allowed_tools(monkeypatch):
    """Disallowed tools (e.g. delete_scene) must never be executed."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner, BRIDGE_VISUAL_TOOLS

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return '```tool\n{"name": "delete_scene", "arguments": {"project_id": "p", "scene_index": 0}}\n```\n'
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append(name)
        return "ok"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools(
        "system", "prompt", {"type": "object"}, allowed_tools=BRIDGE_VISUAL_TOOLS)
    assert result == {"final": True}
    assert executed == []  # delete_scene was rejected, never executed


def test_telemetry_activity_resolves_in_place():
    """A running entry must be updated by id, not duplicated."""
    from backend.agent.telemetry import emit_activity, update_activity, get_agent_activity, clear_agent_activity
    clear_agent_activity()
    entry_id = emit_activity("llm", "test", "running detail", "running")
    update_activity(entry_id, "ok", "done detail")
    feed = get_agent_activity()
    llm_entries = [e for e in feed if e["id"] == entry_id]
    assert len(llm_entries) == 1
    assert llm_entries[0]["status"] == "ok"
    assert llm_entries[0]["detail"] == "done detail"


def test_telemetry_ids_are_unique():
    """Concurrent emitters must not produce duplicate ids."""
    import threading
    from backend.agent.telemetry import emit_activity
    results = []

    def worker():
        for _ in range(50):
            entry_id = emit_activity("tool", "test", "", "ok")
            with threading.Lock():
                results.append(entry_id)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == len(set(results))


def test_project_file_tools_reject_path_escape(monkeypatch):
    import backend.agent.tools as t
    from pathlib import Path

    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: Path("C:/fake/storage"))

    result = t.execute_tool("read_project_file", {"project_id": "proj1", "filename": "..\\narrato.db"})
    assert "Unsafe" in result

    escaped = t._load_json("proj1", "../../narrato.db")
    assert isinstance(escaped, dict) and "_error" in escaped

    assert t._save_json("proj1", "..\\secret.txt", {"x": 1}) is False


def test_run_with_tools_executes_tool_blocks(monkeypatch):
    """The ReAct loop must act on the model's raw text and execute ```tool``` blocks."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        assert kwargs.get("return_raw") is True
        if calls["n"] == 1:
            return 'Some reasoning.\n```tool\n{"name": "web_search", "arguments": {"query": "test"}}\n```\n'
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append((name, args))
        return "results"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})

    assert result == {"final": True}
    assert executed == [("web_search", {"query": "test"})]
    assert calls["n"] == 2


def test_run_with_tools_parses_bare_json_without_tool(monkeypatch):
    """A plain JSON answer (no tool blocks) must be parsed and returned."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        return '{"success": true}'

    def fake_execute(name, args):
        raise AssertionError("execute_tool must not run when no tool block is emitted")

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})

    assert result == {"success": True}
    assert calls["n"] == 1


def test_run_with_tools_strict_fallback_on_invalid_json(monkeypatch):
    """Invalid JSON with no tool blocks must eventually hit the strict schema call."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if schema is None:
            return "this is not json"
        return {"schema": "enforced"}

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})

    assert result == {"schema": "enforced"}
    assert calls["n"] > 1


def test_validate_and_correct_visuals_skips_correction_when_fixed(monkeypatch):
    """Auto-normalizable durations must NOT trigger a second LLM call."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        return {"sub_visuals": [{"duration": 10.0}, {"duration": 10.0}]}

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)

    result = AgentRunner().validate_and_correct_visuals("system", "prompt", {"type": "object"}, 15.0)

    assert calls["n"] == 1
    assert sum(v["duration"] for v in result["sub_visuals"]) == 15.0


def test_validate_and_correct_visuals_corrects_broken_output(monkeypatch):
    """Truly broken output (empty array) must trigger the correction turn."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"sub_visuals": []}
        return {"sub_visuals": [{"duration": 15.0}]}

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)

    result = AgentRunner().validate_and_correct_visuals("system", "prompt", {"type": "object"}, 15.0)

    assert calls["n"] == 2
    assert sum(v["duration"] for v in result["sub_visuals"]) == 15.0


# ---------------------------------------------------------------------------
# Multi-format tool block extraction
# ---------------------------------------------------------------------------

def test_extract_tool_blocks_multiformats():
    """Tool calls must be detected in ```tool```, ```json```, plain ``` and
    bare-JSON formats, with nested 'arguments' objects captured whole."""
    from backend.agent.agent_engine import _extract_tool_blocks

    cases = [
        # ```tool fence (legacy format)
        ('Some reasoning.\n```tool\n{"name": "web_search", "arguments": {"query": "x"}}\n```\n',
         [("web_search", {"query": "x"})]),
        # ```json fence (the format models most often pick)
        ('```json\n{"name": "web_search", "arguments": {"query": "x"}}\n```',
         [("web_search", {"query": "x"})]),
        # plain ``` fence
        ('```\n{"name": "get_skill", "arguments": {"name": "editor-qa"}}\n```',
         [("get_skill", {"name": "editor-qa"})]),
        # bare JSON object in prose
        ('Use this: {"name": "list_project_files", "arguments": {"project_id": "p"}} now.',
         [("list_project_files", {"project_id": "p"})]),
        # nested arguments must not be cut at the first '}'
        ('{"name": "update_subtitle_style", "arguments": {"updates": {"activeColor": "#facc15", "fontSize": 64}}}',
         [("update_subtitle_style", {"updates": {"activeColor": "#facc15", "fontSize": 64}})]),
        # multiple blocks in one response
        ('```tool\n{"name": "web_search", "arguments": {"query": "x"}}\n``` then ```json\n{"name": "get_skill", "arguments": {"name": "scriptwriter"}}\n```',
         [("web_search", {"query": "x"}), ("get_skill", {"name": "scriptwriter"})]),
        # final answers with name/arguments-free JSON must NOT be tool calls
        ('{"success": true, "name": "not-a-call"}', []),
        ('{"type": "document", "visual_meta": {"name": "title", "text": "x"}}', []),
        ('this is not json', []),
    ]
    for raw, expected in cases:
        blocks = _extract_tool_blocks(raw)
        got = [(b["name"], b.get("arguments")) for b in blocks]
        assert got == expected, f"{raw!r}: got {got}"


def test_run_with_tools_executes_json_fenced_tool_blocks(monkeypatch):
    """A ```json```-fenced tool call must execute, not be treated as the final answer."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return '```json\n{"name": "web_search", "arguments": {"query": "test"}}\n```\n'
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append((name, args))
        return "results"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})

    assert result == {"final": True}
    assert executed == [("web_search", {"query": "test"})]
    assert calls["n"] == 2


def test_run_with_tools_executes_bare_json_tool_block(monkeypatch):
    """A bare JSON tool-call object must execute, not be treated as the final answer."""
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return '{"name": "get_skill", "arguments": {"name": "editor-qa"}}'
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append((name, args))
        return "results"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})

    assert result == {"final": True}
    assert executed == [("get_skill", {"name": "editor-qa"})]
    assert calls["n"] == 2


def test_extract_tool_blocks_json_array():
    from backend.agent.agent_engine import _extract_tool_blocks
    text = """
    Thinking process: <think>we need both assets</think>
    ```tool
    [
        {"name": "search_pexels_photo", "arguments": {"query": "mountains"}},
        {"name": "search_pixabay_photo", "arguments": {"query": "icon", "image_type": "illustration"}}
    ]
    ```
    """
    blocks = _extract_tool_blocks(text)
    assert len(blocks) == 2
    assert blocks[0] == {"name": "search_pexels_photo", "arguments": {"query": "mountains"}}
    assert blocks[1] == {"name": "search_pixabay_photo", "arguments": {"query": "icon", "image_type": "illustration"}}


def test_extract_tool_blocks_multiple_fenced_blocks():
    from backend.agent.agent_engine import _extract_tool_blocks
    text = """
    ```tool
    {"name": "web_search", "arguments": {"query": "Apple revenue"}}
    ```
    Some text between
    ```json
    {"name": "get_skill", "arguments": {"name": "declarative-ast"}}
    ```
    """
    blocks = _extract_tool_blocks(text)
    assert len(blocks) == 2
    assert blocks[0] == {"name": "web_search", "arguments": {"query": "Apple revenue"}}
    assert blocks[1] == {"name": "get_skill", "arguments": {"name": "declarative-ast"}}


def test_run_with_tools_executes_multiple_tools_concurrently(monkeypatch):
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return (
                '```tool\n'
                '[\n'
                '  {"name": "search_pexels_photo", "arguments": {"query": "sky"}},\n'
                '  {"name": "search_pixabay_photo", "arguments": {"query": "coin"}}\n'
                ']\n'
                '```\n'
            )
        assert "Tool 'search_pexels_photo' result:\npexels_url" in user
        assert "Tool 'search_pixabay_photo' result:\npixabay_url" in user
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append((name, args))
        if name == "search_pexels_photo":
            return "pexels_url"
        return "pixabay_url"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})
    assert result == {"final": True}
    assert len(executed) == 2
    assert calls["n"] == 2


def test_run_with_tools_multi_tool_partial_disallowed(monkeypatch):
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return (
                '```tool\n'
                '[\n'
                '  {"name": "allowed_tool", "arguments": {"q": "1"}},\n'
                '  {"name": "disallowed_tool", "arguments": {"q": "2"}}\n'
                ']\n'
                '```\n'
            )
        assert "is not available in this context" in user
        assert "Tool 'allowed_tool' result:\nok" in user
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append(name)
        return "ok"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools(
        "system", "prompt", {"type": "object"},
        allowed_tools=["allowed_tool"]
    )
    assert result == {"final": True}
    assert executed == ["allowed_tool"]


def test_extract_tool_blocks_container_expansion():
    from backend.agent.agent_engine import _extract_tool_blocks
    text = """
    ```tool
    {"tools": [
        {"name": "search_pexels_photo", "arguments": {"query": "sea"}},
        {"name": "search_pixabay_photo", "arguments": {"query": "wave"}}
    ]}
    ```
    """
    blocks = _extract_tool_blocks(text)
    assert len(blocks) == 2
    assert blocks[0]["name"] == "search_pexels_photo"
    assert blocks[1]["name"] == "search_pixabay_photo"


def test_run_with_tools_caps_max_tools_per_turn(monkeypatch):
    import json
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner, MAX_TOOLS_PER_TURN

    calls = {"n": 0}
    executed = []

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            tools_list = [{"name": f"tool_{i}", "arguments": {}} for i in range(MAX_TOOLS_PER_TURN + 3)]
            return f"```tool\n{json.dumps(tools_list)}\n```"
        assert f"3 tool call(s) were dropped (max {MAX_TOOLS_PER_TURN} per turn)." in user
        return '{"final": true}'

    def fake_execute(name, args):
        executed.append(name)
        return "ok"

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})
    assert result == {"final": True}
    assert len(executed) == MAX_TOOLS_PER_TURN


def test_run_with_tools_all_disallowed_tools(monkeypatch):
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return '```tool\n[{"name": "bad1", "arguments": {}}, {"name": "bad2", "arguments": {}}]\n```'
        assert "tool 'bad1' is not available" in user
        assert "tool 'bad2' is not available" in user
        assert "Tool 'bad1' result" not in user
        return '{"final": true}'

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", lambda name, args: "unreachable")

    result = AgentRunner().run_with_tools(
        "system", "prompt", {"type": "object"},
        allowed_tools=["only_good_tool"]
    )
    assert result == {"final": True}
    assert calls["n"] == 2


def test_run_with_tools_single_and_multi_error_handling_consistency(monkeypatch):
    import backend.agent.agent_engine as ae
    from backend.agent.agent_engine import AgentRunner

    calls = {"n": 0}

    def fake_call(system, user, schema, cancel_event, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return '```tool\n{"name": "crash_tool", "arguments": {}}\n```'
        assert "Tool 'crash_tool' result:\nError executing tool: simulated tool error" in user
        return '{"final": true}'

    def fake_execute(name, args):
        raise ValueError("simulated tool error")

    monkeypatch.setattr(ae, "_call_llm_json", fake_call)
    monkeypatch.setattr(ae, "execute_tool", fake_execute)

    result = AgentRunner().run_with_tools("system", "prompt", {"type": "object"})
    assert result == {"final": True}
    assert calls["n"] == 2


# ---------------------------------------------------------------------------
# Telemetry: args + result preservation, skill read context labels
# ---------------------------------------------------------------------------

def test_execute_tool_telemetry_preserves_args_and_result(monkeypatch):
    """Tool telemetry must keep BOTH the input arguments and the execution
    result as structured fields, with a combined detail line."""
    import backend.agent.tools as t
    from backend.agent.telemetry import get_agent_activity, clear_agent_activity

    clear_agent_activity()
    monkeypatch.setattr(t, "_execute_tool", lambda name, args: "fake result")

    result = t.execute_tool("web_search", {"query": "hello", "count": 2})

    assert result == "fake result"
    entry = next(e for e in get_agent_activity() if e["kind"] == "tool" and e["name"] == "web_search")
    assert entry["args"] == {"query": "hello", "count": 2}
    assert entry["result"] == "fake result"
    assert entry["detail"].startswith("Args: ")
    assert "➔ Result: fake result" in entry["detail"]
    assert entry["status"] == "ok"


def test_execute_tool_telemetry_marks_error_status(monkeypatch):
    """Tools returning an error string must be flagged as 'error' while still
    preserving the arguments."""
    import backend.agent.tools as t
    from backend.agent.telemetry import get_agent_activity, clear_agent_activity

    clear_agent_activity()
    monkeypatch.setattr(t, "_execute_tool", lambda name, args: "Error: missing query parameter.")

    t.execute_tool("web_search", {})

    entry = next(e for e in get_agent_activity() if e["kind"] == "tool" and e["name"] == "web_search")
    assert entry["status"] == "error"
    assert entry["args"] == {}
    assert "Result: Error: missing query parameter." in entry["detail"]


def test_skill_telemetry_labels_preload_vs_tool():
    """Skill reads must distinguish system-prompt preloads from explicit agent
    tool calls, and carry the version + scope as structured fields."""
    from backend.agent.skill_loader import skill_loader
    from backend.agent.telemetry import get_agent_activity, clear_agent_activity

    clear_agent_activity()
    skill_loader.get_skill("scriptwriter")  # preload (default)
    skill_loader.get_skill("scriptwriter", context="tool")

    feed = get_agent_activity()
    skills = [e for e in feed if e["kind"] == "skill" and e["name"] == "scriptwriter"]
    assert len(skills) == 2
    # feed is newest-first: the tool call is the most recent entry
    assert "Agent Tool Call (v1.0)" in skills[0]["detail"]
    assert skills[0]["args"] == {"version": "1.0", "scope": "tool"}
    assert "System Prompt Preload (v1.0)" in skills[1]["detail"]
    assert skills[1]["args"] == {"version": "1.0", "scope": "preload"}


# ---------------------------------------------------------------------------
# AST Subtitle Positioning, Safe Areas & Chapter Badges
# ---------------------------------------------------------------------------


def test_visual_rules_format_aware_safe_areas():
    """Visual rules must configure format-aware safe areas (15% landscape, 25% portrait)."""
    from backend.pipeline.ai import _visual_rules_safety_net
    landscape_rules = _visual_rules_safety_net("landscape", "hi")
    assert "15%" in landscape_rules
    assert "18%" in landscape_rules
    assert "CHAPTER TITLE" in landscape_rules
    assert "STANDARDIZED Z-INDEX HIERARCHY" in landscape_rules

    portrait_rules = _visual_rules_safety_net("portrait", "hi")
    assert "25%" in portrait_rules
    assert "28%" in portrait_rules


def test_validate_sub_visuals_preserves_subtitle_position():
    """validate_sub_visuals must preserve subtitle_position across normalization."""
    from backend.agent.validators import validate_sub_visuals
    raw = [
        {"duration": 2.0, "subtitle_position": "top", "composition": {"type": "Sequence", "children": []}},
        {"duration": 3.0, "subtitle_position": "hidden", "composition": {"type": "Sequence", "children": []}},
        {"duration": 5.0, "composition": {"type": "Sequence", "children": []}}
    ]
    valid, normalized, err = validate_sub_visuals(raw, 10.0)
    assert valid is True
    assert normalized[0].get("subtitle_position") == "top"
    assert normalized[1].get("subtitle_position") == "hidden"
    assert "subtitle_position" not in normalized[2]


def test_declarative_ast_skill_has_z_index_and_chapter_guidelines():
    """declarative-ast skill must document standardized Z-indexes and Chapter guidelines."""
    from backend.agent.skill_loader import skill_loader
    skill = skill_loader.get_skill("declarative-ast")
    assert skill is not None
    assert "Standardized Z-Index Hierarchy" in skill.content
    assert "Chapter Guidelines" in skill.content


# ---------------------------------------------------------------------------
# Robust JSON Parsing & Reasoning Extraction Tests
# ---------------------------------------------------------------------------


def test_clean_json_response_with_timestamps_and_reasoning():
    """clean_json_response must ignore timestamp brackets in reasoning text."""
    from backend.pipeline.ai import clean_json_response

    sample = """We are given a narration with timestamps: hair-thin [0.5s] optical [1.2s] fibers [1.8s] carry [2.2s] data.
We need to fill this with visuals.
{
  "sub_visuals": [
    {"duration": 13.79, "composition": {"type": "Sequence", "children": []}}
  ]
}"""
    result = clean_json_response(sample)
    assert isinstance(result, dict)
    assert "sub_visuals" in result
    assert result["sub_visuals"][0]["duration"] == 13.79


def test_clean_json_response_strips_think_tags():
    """clean_json_response must strip <think>...</think> blocks."""
    from backend.pipeline.ai import clean_json_response

    sample = """<think>
Let's analyze [0.5s] to [2.0s].
Inner dict: {"dummy": true}
</think>
{
  "sub_visuals": [{"duration": 10.0}]
}"""
    result = clean_json_response(sample)
    assert result["sub_visuals"][0]["duration"] == 10.0


def test_clean_json_response_recovers_truncated():
    """clean_json_response must repair truncated JSON."""
    from backend.pipeline.ai import clean_json_response

    sample = """Here is the JSON:
{
  "sub_visuals": [
    {"duration": 5.0, "composition": {"type": "Sequence"
"""
    result = clean_json_response(sample)
    assert result["sub_visuals"][0]["duration"] == 5.0


def test_asset_conflict_cleanup(tmp_path):
    """_cleanup_conflicting_asset_files deletes old extension variants and legacy names."""
    from backend.pipeline.assets import _cleanup_conflicting_asset_files

    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()

    # Create conflicting files
    old_vid = assets_dir / "asset_001_02_00.mp4"
    old_vid.write_text("old video")
    legacy_vid = assets_dir / "asset_001_02.mp4"
    legacy_vid.write_text("legacy video")
    new_img = assets_dir / "asset_001_02_00.png"
    new_img.write_text("new image")

    _cleanup_conflicting_asset_files(assets_dir, seg_idx=1, sub_idx=2, layer_idx=0, keep_file=new_img)

    assert not old_vid.exists()
    assert not legacy_vid.exists()
    assert new_img.exists()


def test_cleanup_removed_assets_disk_reconciliation(tmp_path, monkeypatch):
    """cleanup_removed_assets purges all orphaned media files across all media extensions."""
    from backend.pipeline.assets import cleanup_removed_assets
    import backend.database.db as db

    proj_id = "test-proj-cleanup"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: {"id": pid, "assets_manifest_path": str(tmp_path / pid / "assets_manifest.json")})

    proj_dir = tmp_path / proj_id
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True)

    kept_file = assets_dir / "asset_000_00_00.mp4"
    kept_file.write_text("kept")
    orphaned_jpg = assets_dir / "asset_001_00_00.jpg"
    orphaned_jpg.write_text("orphaned jpg")
    orphaned_webp = assets_dir / "asset_002_00_00.webp"
    orphaned_webp.write_text("orphaned webp")

    manifest_data = [
        {
            "index": 0,
            "section_type": "scene",
            "sub_visuals": [
                {
                    "composition": {
                        "type": "Sequence",
                        "children": [
                            {"type": "Layer", "content": {"type": "Video", "local_path": str(kept_file)}}
                        ]
                    }
                }
            ]
        }
    ]

    res = cleanup_removed_assets(proj_id, manifest_data)
    assert res["success"] is True
    assert kept_file.exists()
    assert not orphaned_jpg.exists()
    assert not orphaned_webp.exists()


def test_cleanup_removed_assets_case_insensitive(tmp_path, monkeypatch):
    """cleanup_removed_assets correctly preserves files when path casing differs on Windows."""
    from backend.pipeline.assets import cleanup_removed_assets
    import os

    proj_id = "test-proj-case"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: {"id": pid, "assets_manifest_path": str(tmp_path / pid / "assets_manifest.json")})

    proj_dir = tmp_path / proj_id
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True)

    kept_file = assets_dir / "asset_000_00_00.mp4"
    kept_file.write_text("kept")

    # Pass the kept path with altered case
    altered_case_path = str(kept_file).lower()

    manifest_data = [
        {
            "index": 0,
            "section_type": "scene",
            "sub_visuals": [
                {
                    "composition": {
                        "type": "Sequence",
                        "children": [
                            {"type": "Layer", "content": {"type": "Video", "local_path": altered_case_path}}
                        ]
                    }
                }
            ]
        }
    ]

    res = cleanup_removed_assets(proj_id, manifest_data)
    assert res["success"] is True
    assert kept_file.exists()


def test_is_assets_stale_fallback(tmp_path):
    """is_assets_stale correctly resolves manifest in voiceover/manifest.json when assets/assets_manifest.json does not exist."""
    from backend.pipeline.assets import is_assets_stale
    import json

    proj_dir = tmp_path / "test-stale-proj"
    proj_dir.mkdir(parents=True)
    voice_dir = proj_dir / "voiceover"
    voice_dir.mkdir(parents=True)
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True)

    img_file = assets_dir / "asset_000_00_00.jpg"
    img_file.write_text("img")

    script = {
        "introduction": {"sub_visuals": []},
        "scenes": [
            {
                "sub_visuals": [
                    {
                        "composition": {
                            "type": "Sequence",
                            "children": [{"type": "Layer", "content": {"type": "Image", "local_path": str(img_file)}}]
                        }
                    }
                ]
            }
        ],
        "conclusion": {"sub_visuals": []}
    }
    (proj_dir / "script.json").write_text(json.dumps(script), encoding="utf-8")

    manifest = [
        {
            "index": 0,
            "section_type": "scene",
            "sub_visuals": [
                {
                    "composition": {
                        "type": "Sequence",
                        "children": [{"type": "Layer", "content": {"type": "Image", "local_path": str(img_file)}}]
                    }
                }
            ]
        }
    ]
    (voice_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    project_dict = {"id": "test-stale-proj"}
    # Should not be stale because voiceover/manifest.json exists and all files exist
    assert is_assets_stale(project_dict, proj_dir) is False


def test_lottie_and_motion_modifiers_validation():
    from backend.pipeline.ai import LAYER_CONTENT_SCHEMA, AST_LAYER_SCHEMA
    assert "Lottie" in LAYER_CONTENT_SCHEMA["properties"]["type"]["enum"]
    assert "lottie_url" in LAYER_CONTENT_SCHEMA["properties"]
    assert "motion_blur" in AST_LAYER_SCHEMA["properties"]
    assert "camera_shake" in AST_LAYER_SCHEMA["properties"]
    assert "up" in LAYER_CONTENT_SCHEMA["properties"]["direction"]["enum"]
    assert "forward" in LAYER_CONTENT_SCHEMA["properties"]["direction"]["enum"]

    svs = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "z_index": 10,
                        "motion_blur": True,
                        "shutter_angle": 180,
                        "camera_shake": "handheld",
                        "content": {
                            "type": "Lottie",
                            "lottie_url": "https://assets.lottiefiles.com/demo.json",
                            "loop": True,
                            "playback_rate": 1.2
                        }
                    }
                ]
            }
        }
    ]
    is_valid, normalized, err = validate_sub_visuals(svs, 5.0)
    assert is_valid is True
    assert normalized[0]["composition"]["children"][0]["content"]["type"] == "Lottie"
    assert normalized[0]["composition"]["children"][0]["motion_blur"] is True


def test_is_assets_stale_scene_count_mismatch(tmp_path):
    """is_assets_stale correctly returns True when script scene count exceeds manifest scene count."""
    from backend.pipeline.assets import is_assets_stale
    import json

    proj_dir = tmp_path / "test-count-mismatch"
    proj_dir.mkdir(parents=True)
    voice_dir = proj_dir / "voiceover"
    voice_dir.mkdir(parents=True)
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True)

    img_file = assets_dir / "asset_0.jpg"
    img_file.write_text("img")

    # Script has 2 scenes, but manifest only has 1 scene
    script = {
        "scenes": [
            {"sub_visuals": [{"composition": {"children": [{"content": {"type": "Image", "local_path": str(img_file)}}]}}]},
            {"sub_visuals": [{"composition": {"children": [{"content": {"type": "Image", "local_path": str(img_file)}}]}}]}
        ]
    }
    (proj_dir / "script.json").write_text(json.dumps(script), encoding="utf-8")

    manifest = [
        {"section_type": "scene", "sub_visuals": [{"composition": {"children": [{"content": {"type": "Image", "local_path": str(img_file)}}]}}]}
    ]
    (voice_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    project_dict = {"id": "test-count-mismatch"}
    assert is_assets_stale(project_dict, proj_dir) is True


def test_is_transcribe_stale_audio_mtime(tmp_path):
    """is_transcribe_stale correctly returns True when audio file is newer than transcription."""
    from backend.pipeline.transcribe import is_transcribe_stale, _compute_transcribe_hash, _write_transcribe_hash
    import time
    from pathlib import Path

    proj_dir = tmp_path / "test-transcribe-stale"
    proj_dir.mkdir(parents=True)
    sub_dir = proj_dir / "subtitles"
    sub_dir.mkdir(parents=True)

    json_path = sub_dir / "transcription.json"
    json_path.write_text("{}", encoding="utf-8")

    # Set transcription file mtime to 100 seconds ago
    old_time = time.time() - 100
    import os
    os.utime(json_path, (old_time, old_time))

    # Write matching transcribe hash
    hash_val = _compute_transcribe_hash("small", "cpu", "en")
    _write_transcribe_hash(proj_dir, hash_val)

    # Audio file created now (newer than transcription)
    audio_file = proj_dir / "voiceover.wav"
    audio_file.write_text("audio")

    project_dict = {"id": "test-transcribe-stale", "language": "en", "audio_path": str(audio_file)}
    assert is_transcribe_stale(project_dict, proj_dir) is True


def test_fetch_assets_preserves_script_sub_visuals(tmp_path):
    """fetch_assets_pipeline preserves rich sub-visuals in script.json and does not overwrite with empty manifest."""
    from backend.pipeline.assets import fetch_assets_pipeline
    import threading
    import json

    proj_dir = tmp_path / "test-sub-preservation"
    proj_dir.mkdir(parents=True)
    voice_dir = proj_dir / "voiceover"
    voice_dir.mkdir(parents=True)

    # Script has rich sub-visuals
    rich_subs = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": [{"type": "Layer", "content": {"type": "Text", "text": "Hello World"}}]
            }
        }
    ]
    script = {
        "scenes": [
            {"title": "Scene 1", "sub_visuals": rich_subs}
        ]
    }
    (proj_dir / "script.json").write_text(json.dumps(script), encoding="utf-8")

    # Manifest has empty placeholder sub-visuals (e.g. from TTS)
    empty_subs = [
        {
            "duration": 5.0,
            "composition": {
                "type": "Sequence",
                "children": []
            }
        }
    ]
    manifest = [
        {"section_type": "scene", "title": "Scene 1", "duration": 5.0, "sub_visuals": empty_subs}
    ]
    manifest_file = voice_dir / "manifest.json"
    manifest_file.write_text(json.dumps(manifest), encoding="utf-8")

    project_dict = {
        "id": "test-sub-preservation",
        "name": "Test Preservation",
        "assets_manifest_path": str(manifest_file),
        "video_format": "landscape"
    }

    cancel_event = threading.Event()
    fetch_assets_pipeline(project_dict, proj_dir, lambda p, m: None, cancel_event)

    # Verify script.json retained its rich sub-visuals
    updated_script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
    assert len(updated_script["scenes"][0]["sub_visuals"]) == 1
    assert len(updated_script["scenes"][0]["sub_visuals"][0]["composition"]["children"]) == 1
    assert updated_script["scenes"][0]["sub_visuals"][0]["composition"]["children"][0]["content"]["text"] == "Hello World"


def test_save_uploaded_overlay_data(tmp_path, monkeypatch):
    """save_uploaded_overlay_data saves base64 data to project assets directory."""
    import base64
    from backend.core.bridge import ApiBridge
    import backend.core.config

    monkeypatch.setattr(backend.core.config, "get_storage_dir", lambda: tmp_path)

    bridge = ApiBridge()
    img_data = b"fake_png_data_12345"
    data_url = f"data:image/png;base64,{base64.b64encode(img_data).decode('utf-8')}"

    result = bridge.save_uploaded_overlay_data("proj_1", data_url, "my_logo.png")
    assert result["success"] is True
    assert result["extension"] == ".png"
    assert (tmp_path / "proj_1" / "assets" / result["filename"]).exists()
    assert (tmp_path / "proj_1" / "assets" / result["filename"]).read_bytes() == img_data


def test_update_scene_duration_syncs_vo_manifest(tmp_path, monkeypatch):
    """update_scene_duration correctly synchronizes and scales duration in voiceover/manifest.json."""
    from backend.core.bridge import ApiBridge
    import backend.core.bridge as bridge_mod
    import backend.core.config
    import json

    monkeypatch.setattr(backend.core.config, "get_storage_dir", lambda: tmp_path)

    proj_dir = tmp_path / "proj_vo_sync"
    proj_dir.mkdir(parents=True)
    assets_dir = proj_dir / "assets"
    assets_dir.mkdir(parents=True)
    vo_dir = proj_dir / "voiceover"
    vo_dir.mkdir(parents=True)

    manifest_file = assets_dir / "manifest.json"
    manifest_data = [
        {"section_type": "scene", "duration": 4.0, "sub_visuals": [{"duration": 2.0}, {"duration": 2.0}]}
    ]
    manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

    vo_manifest_file = vo_dir / "manifest.json"
    vo_data = [
        {"section_type": "scene", "duration": 4.0, "sub_visuals": [{"duration": 2.0}, {"duration": 2.0}]}
    ]
    vo_manifest_file.write_text(json.dumps(vo_data), encoding="utf-8")

    import backend.database.db as db_mod
    monkeypatch.setattr(db_mod, "get_project", lambda pid: {"id": pid, "assets_manifest_path": str(manifest_file)})

    bridge = ApiBridge()
    res = bridge.update_scene_duration("proj_vo_sync", 0, 10.0)
    assert res["success"] is True

    # Check assets manifest
    updated_assets = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert updated_assets[0]["duration"] == 10.0
    assert updated_assets[0]["sub_visuals"][0]["duration"] == 5.0

    # Check voiceover manifest
    updated_vo = json.loads(vo_manifest_file.read_text(encoding="utf-8"))
    assert updated_vo[0]["duration"] == 10.0
    assert updated_vo[0]["sub_visuals"][0]["duration"] == 5.0


def test_ast_layer_transform_origin_and_sub_visual_defaults():
    from backend.agent.schemas import ASTLayerNode, SubVisualAST

    layer = ASTLayerNode(
        type="Layer",
        z_index=15,
        content={"type": "HTML", "html_content": "<div>test</div>"},
        transform_origin="top left",
        animations=[{"property": "scale", "from": 1.0, "to": 1.05, "duration": 3.0, "easing": "linear"}]
    )
    assert layer.transform_origin == "top left"
    dumped = layer.model_dump()
    assert dumped["transform_origin"] == "top left"

    sv = SubVisualAST(
        duration=4.0,
        composition={"type": "Sequence", "children": [dumped]}
    )
    assert sv.transition == "cut"


def test_finalize_upload_asset_layer_aware(tmp_path, monkeypatch):
    """Verifies that finalize_upload_asset supports layer_index:
    1. layer_index >= 0 produces asset_XXX_YY_ZZ.ext.
    2. Multiple layers in the same cut do not overwrite or delete each other.
    3. Overwriting a layer cleans up conflicting extensions for that layer only.
    4. Layer 0 cleans up legacy asset_XXX_YY.ext naming as well.
    5. Legacy layer_index = -1 retains asset_XXX_YY.ext naming.
    """
    from backend.core.bridge import ApiBridge
    from pathlib import Path

    fake_storage = tmp_path / "storage"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: fake_storage)

    bridge = ApiBridge()
    project_id = "proj-test-finalize"
    proj_assets = fake_storage / project_id / "assets"
    previews_dir = proj_assets / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    # 1. Finalize Layer 0 (Image)
    p0 = previews_dir / "upload_000.jpg"
    p0.write_bytes(b"image_layer_0")
    res0 = bridge.finalize_upload_asset(project_id, str(p0), 1, 2, layer_index=0)
    assert res0["success"] is True
    dest0 = Path(res0["visual_path"])
    assert dest0.name == "asset_001_02_00.jpg"
    assert dest0.exists()
    assert dest0.read_bytes() == b"image_layer_0"

    # 2. Finalize Layer 1 (Video) in the same cut - must not touch Layer 0
    p1 = previews_dir / "upload_111.mp4"
    p1.write_bytes(b"video_layer_1")
    res1 = bridge.finalize_upload_asset(project_id, str(p1), 1, 2, layer_index=1)
    assert res1["success"] is True
    dest1 = Path(res1["visual_path"])
    assert dest1.name == "asset_001_02_01.mp4"
    assert dest1.exists()
    assert dest0.exists(), "Layer 0 asset must NOT be deleted when Layer 1 is finalized!"
    assert dest1.read_bytes() == b"video_layer_1"

    # 3. Replace Layer 1 with a PNG - should remove .mp4 on Layer 1 only, keep Layer 0 intact
    p1_new = previews_dir / "upload_222.png"
    p1_new.write_bytes(b"image_layer_1_new")
    res1_new = bridge.finalize_upload_asset(project_id, str(p1_new), 1, 2, layer_index=1)
    assert res1_new["success"] is True
    dest1_new = Path(res1_new["visual_path"])
    assert dest1_new.name == "asset_001_02_01.png"
    assert dest1_new.exists()
    assert not dest1.exists(), "Old .mp4 on Layer 1 must be deleted when replaced with .png"
    assert dest0.exists(), "Layer 0 must remain completely intact"

    # 4. Layer 0 cleans up legacy asset_001_02.png if it existed
    legacy_file = proj_assets / "asset_001_02.mp4"
    legacy_file.write_bytes(b"legacy")
    assert legacy_file.exists()
    p0_new = previews_dir / "upload_333.png"
    p0_new.write_bytes(b"image_layer_0_new")
    res0_new = bridge.finalize_upload_asset(project_id, str(p0_new), 1, 2, layer_index=0)
    assert res0_new["success"] is True
    assert not legacy_file.exists(), "Legacy file must be removed when layer 0 is finalized"
    assert not dest0.exists(), "Old .jpg on layer 0 must be removed when replaced with .png"
    assert dest1_new.exists(), "Layer 1 must still exist"

    # 5. Legacy call (layer_index = -1)
    p_legacy = previews_dir / "upload_legacy.jpg"
    p_legacy.write_bytes(b"legacy_call")
    res_legacy = bridge.finalize_upload_asset(project_id, str(p_legacy), 2, 0, layer_index=-1)
    assert res_legacy["success"] is True
    assert Path(res_legacy["visual_path"]).name == "asset_002_00.jpg"


def test_promote_preview_paths_to_assets(tmp_path, monkeypatch):
    """Saving a cut whose AST layers point at previews/upload_* must promote
    the files into assets/ and rewrite local_path (the reported data-loss bug:
    image visible while editing, gone on revisit after the temp file is swept).
    """
    from pathlib import Path
    from backend.pipeline.assets import promote_preview_paths_to_assets

    proj_id = "proj-test-promote"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)

    proj_assets = tmp_path / proj_id / "assets"
    previews_dir = proj_assets / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    up = previews_dir / "upload_d87ff738.png"
    up.write_bytes(b"png-bytes")
    pv = previews_dir / "preview_ab12cd34.jpg"
    pv.write_bytes(b"jpg-bytes")
    main = proj_assets / "asset_005_02_00.mp4"
    main.write_bytes(b"mp4-bytes")

    script_data = {
        "scenes": [
            {
                "narration": "x",
                "sub_visuals": [
                    {
                        "composition": {
                            "type": "Sequence",
                            "children": [
                                {"type": "Layer", "content": {"type": "Video", "local_path": str(main)}},
                                {"type": "Layer", "content": {"type": "Image", "query": "GitHub", "source": "upload", "local_path": str(up)}},
                                {"type": "Layer", "content": {"type": "Image", "query": "Twitter", "source": "upload", "local_path": str(pv)}},
                            ],
                        }
                    }
                ],
            }
        ]
    }
    manifest_data = [
        {"section_type": "scene", "sub_visuals": [{"visual_path": str(up), "composition": script_data["scenes"][0]["sub_visuals"][0]["composition"]}]}
    ]

    res = promote_preview_paths_to_assets(proj_id, script_data, manifest_data)
    assert res["count"] == 2

    layers = script_data["scenes"][0]["sub_visuals"][0]["composition"]["children"]
    assert layers[0]["content"]["local_path"] == str(main)  # non-preview untouched
    for layer in layers[1:]:
        new_path = layer["content"]["local_path"]
        assert "previews" not in new_path.replace("\\", "/")
        assert Path(new_path).exists()
    assert manifest_data[0]["sub_visuals"][0]["visual_path"] == layers[1]["content"]["local_path"]
    assert Path(layers[1]["content"]["local_path"]).read_bytes() == b"png-bytes"
    assert Path(layers[2]["content"]["local_path"]).read_bytes() == b"jpg-bytes"

    # Idempotent: second pass finds nothing to promote
    res2 = promote_preview_paths_to_assets(proj_id, script_data, manifest_data)
    assert res2["count"] == 0


def test_sweep_stale_uploads_skips_referenced(tmp_path, monkeypatch):
    """_sweep_stale_uploads must never delete a preview still referenced by the
    saved script, even when older than the abandonment window."""
    import json
    import os
    import time
    from backend.core import bridge as bridge_mod

    proj_id = "proj-test-sweep"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)

    proj_dir = tmp_path / proj_id
    previews_dir = proj_dir / "assets" / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    ref = previews_dir / "upload_referenced.png"
    ref.write_bytes(b"referenced")
    orphan = previews_dir / "upload_orphan.png"
    orphan.write_bytes(b"orphan")
    old = time.time() - 7200
    os.utime(ref, (old, old))
    os.utime(orphan, (old, old))

    (proj_dir / "script.json").write_text(json.dumps({
        "scenes": [{
            "sub_visuals": [{
                "composition": {
                    "type": "Sequence",
                    "children": [
                        {"type": "Layer", "content": {"type": "Image", "local_path": str(ref)}},
                    ],
                },
            }],
        }],
    }))

    # Sleep briefly to ensure clock advances past NTFS creation timer tick resolution (~15.6ms)
    time.sleep(0.02)
    bridge_mod._sweep_stale_uploads(proj_id, max_age_seconds=0)
    assert ref.exists(), "Referenced preview must NOT be swept!"
    assert not orphan.exists(), "Unreferenced stale preview should be swept"


def test_cleanup_preserves_inflight_previews(tmp_path, monkeypatch):
    """cleanup_removed_assets must not delete fresh, unsaved previews/ files
    (mid-edit state invisible to the on-disk kept-paths set)."""
    from backend.pipeline.assets import cleanup_removed_assets

    proj_id = "test-proj-inflight"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    monkeypatch.setattr("backend.database.db.get_project", lambda pid: {"id": pid, "assets_manifest_path": str(tmp_path / pid / "assets_manifest.json")})

    proj_dir = tmp_path / proj_id
    assets_dir = proj_dir / "assets"
    previews_dir = assets_dir / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    inflight = previews_dir / "upload_inflight.png"
    inflight.write_bytes(b"mid-edit preview")

    res = cleanup_removed_assets(proj_id, [{"section_type": "scene", "sub_visuals": []}])
    assert res["success"] is True
    assert inflight.exists(), "Fresh in-flight preview must survive reconciliation!"


def test_sweep_aborts_on_unreadable_manifest(tmp_path, monkeypatch):
    """A corrupt-but-present manifest must abort the sweep, never fall back to
    age-only deletion of possibly-referenced files."""
    import os
    import time
    from pathlib import Path
    from backend.core import bridge as bridge_mod

    proj_id = "proj-test-sweep-abort"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)

    proj_dir = tmp_path / proj_id
    previews_dir = proj_dir / "assets" / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    orphan = previews_dir / "upload_orphan2.png"
    orphan.write_bytes(b"orphan")
    old = time.time() - 7200
    os.utime(orphan, (old, old))
    (proj_dir / "script.json").write_text("{ not valid json")

    bridge_mod._sweep_stale_uploads(proj_id)
    assert orphan.exists(), "Sweep must abort when a manifest is unreadable!"
    assert Path(proj_dir / "script.json").exists()


def test_promote_rejects_foreign_preview_path(tmp_path, monkeypatch):
    """A stored path that merely contains a previews/ segment but lives outside
    this project's previews/ dir must not be copied into assets/."""
    from pathlib import Path
    from backend.pipeline.assets import promote_preview_paths_to_assets

    proj_id = "proj-test-foreign"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)
    (tmp_path / proj_id / "assets").mkdir(parents=True, exist_ok=True)

    foreign_dir = tmp_path / "elsewhere" / "previews"
    foreign_dir.mkdir(parents=True, exist_ok=True)
    foreign = foreign_dir / "upload_evil.png"
    foreign.write_bytes(b"foreign-bytes")

    script_data = {"scenes": [{"sub_visuals": [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Image", "local_path": str(foreign)}},
    ]}}]}]}

    res = promote_preview_paths_to_assets(proj_id, script_data, None)
    assert res["count"] == 0
    layer = script_data["scenes"][0]["sub_visuals"][0]["composition"]["children"][0]
    assert layer["content"]["local_path"] == str(foreign)
    assert not (tmp_path / proj_id / "assets" / "asset_upload_evil.png").exists()


def test_promote_name_collision_keeps_both_contents(tmp_path, monkeypatch):
    """Same-size/different-content collision on the stable dest name must not
    alias the wrong image: the newcomer gets a suffixed file."""
    from pathlib import Path
    from backend.pipeline.assets import promote_preview_paths_to_assets

    proj_id = "proj-test-collision"
    monkeypatch.setattr("backend.core.config.get_storage_dir", lambda: tmp_path)

    assets_dir = tmp_path / proj_id / "assets"
    previews_dir = assets_dir / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)

    existing = assets_dir / "asset_upload_same.png"
    existing.write_bytes(b"0123456789abcdef")  # 16 bytes
    src = previews_dir / "upload_same.png"
    src.write_bytes(b"fedcba9876543210")  # 16 bytes, different content

    script_data = {"scenes": [{"sub_visuals": [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Image", "local_path": str(src)}},
    ]}}]}]}

    res = promote_preview_paths_to_assets(proj_id, script_data, None)
    assert res["count"] == 1
    new_path = script_data["scenes"][0]["sub_visuals"][0]["composition"]["children"][0]["content"]["local_path"]
    assert new_path != str(existing)
    assert Path(new_path).read_bytes() == b"fedcba9876543210"
    assert existing.read_bytes() == b"0123456789abcdef"











