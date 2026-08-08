import pytest
from backend.agent.validators import validate_sub_visuals, normalize_visual_type, normalize_transition
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
        {"duration": 10.0},
        {"duration": 5.0}
    ]
    is_valid, normalized, err = validate_sub_visuals(svs, 15.0)
    assert is_valid is True
    assert err == ""
    # Types are normalized onto the enums even when validation passes
    assert normalized[0]["visual_type"] == "scene"

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

def test_normalize_visual_type_fuzzy():
    assert normalize_visual_type("Custom HTML") == "custom_html"
    assert normalize_visual_type("ai image") == "ai_image"
    assert normalize_visual_type("device mockup") == "device_mockup"
    assert normalize_visual_type("chat") == "thread"
    assert normalize_visual_type("garbage") == "scene"

def test_normalize_transition_fuzzy():
    assert normalize_transition("slide-up") == "slide_up"
    assert normalize_transition("zoom in") == "zoom_in"
    assert normalize_transition("dissolve") == "fade"
    assert normalize_transition("made up") == "fade"

def test_skill_loader():
    skills = skill_loader.get_all_skills()
    assert "visual-type-custom-html" in skills
    skill = skill_loader.get_skill("visual-type-custom-html")
    assert skill is not None
    assert skill.version == "1.0"

def test_skill_loader_new_skills():
    for name in ("scriptwriter", "subtitle-designer", "custom-html-designer",
                 "stock-asset-searcher", "editor-qa",
                 "visual-director-core", "visual-type-image", "visual-type-ai-image"):
        skill = skill_loader.get_skill(name)
        assert skill is not None, f"Skill {name} missing"
        assert skill.version == "1.0"
        assert len(skill.content.strip()) > 50

def test_visual_type_rules_cover_all_types():
    for vtype in ("map", "document", "network", "list",
                  "thread", "device_mockup", "custom_html", "scene", "portrait",
                  "parallax", "youtube", "image", "ai_image"):
        skill = skill_loader.get_skill(f"visual-type-{vtype.replace('_', '-')}")
        assert skill is not None, f"visual-type-{vtype} skill missing"

def test_visual_rules_built_from_skills():
    from backend.pipeline.ai import get_shared_visual_rules
    rules = get_shared_visual_rules("landscape", "hi")
    # Skill-driven composition: director rules + schemas + safety net.
    assert "MAXIMIZE CREATIVITY" in rules
    assert "AI_IMAGE SCHEMA" in rules
    assert "IMAGE SCHEMA" in rules
    assert "ANTI-HALLUCINATION" in rules
    assert "ANIMATION TIMING" in rules

def test_get_visual_type_rules_tool_ai_image(monkeypatch):
    """The get_visual_type_rules tool must resolve image/ai_image skill names."""
    from backend.agent.tools import execute_tool
    result = execute_tool("get_visual_type_rules", {"visual_type": "ai_image"})
    assert "Error" not in result
    assert "AI_IMAGE" in result.upper()

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
    for tool in ("web_search", "get_skill", "preview_asset",
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
    from backend.agent.agent_engine import AgentRunner, INTERACTIVE_AGENT_TOOLS

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
        "system", "prompt", {"type": "object"}, allowed_tools=INTERACTIVE_AGENT_TOOLS)
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
