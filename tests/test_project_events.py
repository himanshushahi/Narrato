"""Live UI update events (window.onProjectEvent).

Pins the review fixes for the agent-driven refresh path:
- @_emit_project_event notifies only on {"ok": truthy}, never on dry_run
  (kwarg AND positional) or rejections, and never breaks the tool result.
- Wrapped tools keep their original name/signature so FastMCP derives an
  unchanged tool schema (functools.wraps + __wrapped__).
"""
import inspect

import pytest

from backend.mcp import server as S


@pytest.fixture()
def captured_events(monkeypatch):
    import backend.core.bridge as bridge
    seen = []

    class _Q:
        def put(self, item):
            seen.append(item)

    monkeypatch.setattr(bridge, "ui_queue", _Q())
    return seen


def _shape(seen):
    assert len(seen) == 1
    name, args = seen[0]
    assert name == "onProjectEvent"
    return args[0]


def test_ok_true_notifies_with_kwarg_pid(captured_events):
    @_emit("project_updated")
    def fake(project_id: str):
        return {"ok": True}

    assert fake(project_id="p1") == {"ok": True}
    assert _shape(captured_events) == {
        "type": "project_updated", "project_id": "p1", "files_changed": True}


def test_ok_true_notifies_with_positional_pid(captured_events):
    # chat_tools._dispatch passes project_id positionally.
    @_emit("project_updated")
    def fake(project_id: str, script: dict):
        return {"ok": True}

    fake("p2", {})
    assert _shape(captured_events)["project_id"] == "p2"


def test_ok_false_never_notifies(captured_events):
    @_emit("project_updated")
    def fake(project_id: str):
        return {"ok": False, "error": "nope"}

    assert fake("p1")["ok"] is False
    assert captured_events == []


def test_dry_run_kwarg_skips_notify(captured_events):
    @_emit("project_updated")
    def fake(project_id: str, dry_run: bool = False):
        return {"ok": True}

    fake("p1", dry_run=True)
    assert captured_events == []


def test_dry_run_positional_skips_notify(captured_events):
    @_emit("project_updated")
    def fake(project_id: str, section_type: str, sub_visuals: list,
             dry_run: bool = False):
        return {"ok": True}

    fake("p1", "scene", [], True)
    assert captured_events == []


def test_pid_from_result_for_create(captured_events):
    @_emit("projects_changed", action="created", pid_from_result=True)
    def fake(name: str):
        return {"ok": True, "project_id": "new-id"}

    fake("topic")
    assert _shape(captured_events) == {
        "type": "projects_changed", "project_id": "new-id",
        "action": "created", "files_changed": True}


def test_status_only_tick_sets_files_changed_false(captured_events):
    @_emit("project_updated", files_changed=False)
    def fake(project_id: str):
        return {"ok": True}

    fake("p1")
    assert _shape(captured_events)["files_changed"] is False


def test_broken_queue_never_breaks_result(captured_events, monkeypatch):
    import backend.core.bridge as bridge
    monkeypatch.setattr(bridge, "ui_queue", None)

    @_emit("project_updated")
    def fake(project_id: str):
        return {"ok": True, "data": 1}

    assert fake("p1") == {"ok": True, "data": 1}


def _emit(*a, **k):
    return S._emit_project_event(*a, **k)


WRAPPED = [
    "create_project", "delete_project", "save_script", "save_design",
    "save_visuals", "save_visuals_batch", "clear_visuals", "clear_assets",
    "update_voice_settings", "update_transcribe_settings", "cancel_stage",
]


@pytest.mark.parametrize("tool", WRAPPED)
def test_wrapped_tool_preserves_name_and_signature(tool):
    fn = getattr(S, tool)
    assert fn.__name__ == tool
    assert not inspect.iscoroutinefunction(fn)
    assert hasattr(fn, "__wrapped__")
    assert (list(inspect.signature(fn).parameters)
            == list(inspect.signature(fn.__wrapped__).parameters))


def test_pid_fallback_from_result_dict(captured_events):
    # When pid_from_result is False and pid was not passed in args/kwargs,
    # fallback to result.get('project_id')
    @_emit("project_updated")
    def fake(data: dict):
        return {"ok": True, "project_id": "fallback-pid"}

    fake({"some": "arg"})
    assert _shape(captured_events) == {
        "type": "project_updated", "project_id": "fallback-pid", "files_changed": True}


def test_chat_stage_via_queue_run_stage_notifies(captured_events, monkeypatch):
    from backend.agent import chat_tools
    from backend.pipeline.queue import global_queue_manager

    monkeypatch.setattr(global_queue_manager, "queue_project", lambda pid, steps: True)
    res = chat_tools._stage_via_queue("run_stage", {"stage": "generate_voiceover", "wait": False}, "p-chat")
    assert res.get("ok") is True
    assert _shape(captured_events) == {
        "type": "project_updated", "project_id": "p-chat", "files_changed": False}


def test_chat_stage_via_queue_cancel_notifies(captured_events, monkeypatch):
    from backend.agent import chat_tools
    from backend.pipeline.queue import global_queue_manager

    monkeypatch.setattr(global_queue_manager, "cancel_project", lambda pid: None)
    res = chat_tools._stage_via_queue("cancel_stage", {"stage": "generate_voiceover"}, "p-chat")
    assert res.get("ok") is True
    assert _shape(captured_events) == {
        "type": "project_updated", "project_id": "p-chat", "files_changed": False}


def test_bridge_create_and_delete_project_notifies(captured_events, monkeypatch):
    from backend.core import bridge

    monkeypatch.setattr(bridge, "create_project", lambda *a, **k: "p-new")
    monkeypatch.setattr(bridge, "delete_project", lambda *a, **k: True)
    monkeypatch.setattr(bridge, "get_project", lambda *a, **k: None)

    api = bridge.ApiBridge()
    created = api.create_new_project("New Proj", "", "C:/tmp")
    assert created.get("success") is True
    assert _shape(captured_events) == {
        "type": "projects_changed", "project_id": "p-new", "action": "created", "files_changed": True}

    captured_events.clear()
    deleted = api.db_delete_project("p-new")
    assert deleted is True
    assert _shape(captured_events) == {
        "type": "projects_changed", "project_id": "p-new", "action": "deleted", "files_changed": True}

