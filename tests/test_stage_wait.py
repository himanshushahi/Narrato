"""Waiting discipline: sleep tool, stage-aware hints, and the guard that
locks mutating tools while a pipeline stage runs.
"""
import json
import threading
import time

import pytest

from backend.agent import chat_tools


def test_sleep_returns_slept_seconds(fake_clock):
    t0 = time.time()
    res = chat_tools._sleep_tool({"seconds": 1})
    dt = time.time() - t0
    assert res["ok"] is True
    assert res["slept_seconds"] == 1
    assert dt >= 1
    assert "stage_status" in res["hint"]


@pytest.fixture()
def fake_clock(monkeypatch):
    """Advance a fake clock instead of really waiting."""
    now = [1000.0]
    monkeypatch.setattr(time, "time", lambda: now[0])
    monkeypatch.setattr(time, "sleep", lambda s: now.__setitem__(0, now[0] + s))
    return now


def test_sleep_clamps_to_max(fake_clock):
    res = chat_tools._sleep_tool({"seconds": 3600})
    assert res["slept_seconds"] == chat_tools.SLEEP_MAX_SECONDS == 120
    assert fake_clock[0] >= 1000.0 + 120


def test_sleep_floor_and_invalid(fake_clock):
    assert chat_tools._sleep_tool({"seconds": 0})["slept_seconds"] == 1
    assert chat_tools._sleep_tool({"seconds": "nonsense"})["slept_seconds"] == 60
    assert chat_tools._sleep_tool({})["slept_seconds"] == 60
    assert chat_tools._sleep_tool({"seconds": "inf"})["slept_seconds"] == 60
    assert chat_tools._sleep_tool({"seconds": 1e999})["slept_seconds"] == 60


def test_sleep_honors_cancel_event():
    ev = threading.Event()
    ev.set()
    with pytest.raises(InterruptedError):
        chat_tools._sleep_tool({"seconds": 60}, ev)


def test_sleep_in_chat_schema():
    names = [t["function"]["name"] for t in chat_tools.get_chat_tools_schema()]
    assert "sleep" in names
    assert "sleep" in chat_tools.CHAT_TOOL_NAMES


def test_chat_guard_refuses_mutation_while_busy(monkeypatch):
    from backend.pipeline import queue as queue_mod

    monkeypatch.setattr(queue_mod.global_queue_manager, "_active_project_id", "p1", raising=False)
    res = json.loads(chat_tools.execute_chat_tool(
        "save_design", {"project_id": "p1", "design": {}}, "p1"))
    assert res["ok"] is False
    assert res.get("awaiting_stage") is not None
    assert "sleep" in res["error"]


def test_chat_guard_allows_readonly_and_sleep_while_busy(monkeypatch, fake_clock):
    from backend.pipeline import queue as queue_mod

    monkeypatch.setattr(queue_mod.global_queue_manager, "_active_project_id", "p1", raising=False)
    # sleep is not guarded and works fine while a stage runs
    res = json.loads(chat_tools.execute_chat_tool("sleep", {"seconds": 1}, "p1"))
    assert res["ok"] is True


def test_chat_guard_allows_dry_run_while_busy(monkeypatch):
    from backend.pipeline import queue as queue_mod

    monkeypatch.setattr(queue_mod.global_queue_manager, "_active_project_id", "p1", raising=False)
    # dry_run validations write nothing: must pass the guard (they may still
    # fail later on content, but never with awaiting_stage).
    res = json.loads(chat_tools.execute_chat_tool(
        "save_visuals", {"project_id": "p1", "section_type": "scene",
                         "sub_visuals": [], "dry_run": True}, "p1"))
    assert "awaiting_stage" not in res


def test_mcp_guard_refuses_mutation_while_busy():
    from backend.mcp import server as S

    S._STAGE_FUTURES["p9_transcribe"] = object()  # marker: no .done -> busy
    try:
        res = S.save_design("p9", {})
        assert res["ok"] is False
        assert res.get("awaiting_stage") == "transcribe"
    finally:
        S._STAGE_FUTURES.pop("p9_transcribe", None)


def test_mcp_guard_allows_dry_run_while_busy():
    from backend.mcp import server as S

    S._STAGE_FUTURES["p9_transcribe"] = object()
    try:
        res = S.save_visuals("p9", "scene", [], dry_run=True)
        assert "awaiting_stage" not in res
    finally:
        S._STAGE_FUTURES.pop("p9_transcribe", None)


def test_mcp_sleep_tool_registered(fake_clock):
    from backend.mcp import server as S

    res = S.sleep(1)
    assert res["ok"] is True and res["slept_seconds"] == 1
    assert S.sleep(3600)["slept_seconds"] == 120
    assert S.sleep("inf")["slept_seconds"] == 60


def test_chat_guard_matches_queued_tuple_entries(monkeypatch):
    """Desktop queue entries are (project_id, steps, is_resume) tuples —
    the guard must look inside them, not compare bare ids."""
    from backend.pipeline import queue as queue_mod

    monkeypatch.setattr(queue_mod.global_queue_manager, "_active_project_id", None, raising=False)
    monkeypatch.setattr(queue_mod.global_queue_manager, "_queue",
                        [("p1", ["transcribe"], False)], raising=False)
    res = json.loads(chat_tools.execute_chat_tool(
        "save_design", {"project_id": "p1", "design": {}}, "p1"))
    assert res["ok"] is False
    assert "awaiting_stage" in res
    assert isinstance(res["awaiting_stage"], str)


def test_chat_guard_awaiting_stage_is_string(monkeypatch):
    """awaiting_stage is always a stage-name string, never a boolean, so
    agents can parse it reliably."""
    from backend.pipeline import queue as queue_mod

    monkeypatch.setattr(queue_mod.global_queue_manager, "_active_project_id", "p1", raising=False)
    res = json.loads(chat_tools.execute_chat_tool(
        "save_design", {"project_id": "p1", "design": {}}, "p1"))
    assert isinstance(res["awaiting_stage"], str)


def test_mcp_guard_dry_run_int_passthrough():
    from backend.mcp import server as S

    S._STAGE_FUTURES["p9_transcribe"] = object()
    try:
        res = S.save_visuals("p9", "scene", [], dry_run=1)
        assert "awaiting_stage" not in res
    finally:
        S._STAGE_FUTURES.pop("p9_transcribe", None)


def test_mcp_guard_stage_name_with_underscored_project():
    from backend.mcp import server as S

    S._STAGE_FUTURES["my_proj_transcribe"] = object()
    try:
        res = S.save_design("my_proj", {})
        assert res.get("awaiting_stage") == "transcribe"
    finally:
        S._STAGE_FUTURES.pop("my_proj_transcribe", None)
