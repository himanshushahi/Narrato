import json
from unittest.mock import patch
from backend.agent.chat_session import ChatSession
from backend.agent.chat_loop import NativeTurn


def _make_session(tmp_path, pid="test_proj_err"):
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess = ChatSession(pid, "default")
        sess.history = []
        return sess


def test_llm_runtime_error_persisted_and_emitted(tmp_path):
    sess = _make_session(tmp_path)

    def boom(messages, tools, cancel_event, label, on_delta=None):
        raise RuntimeError("The configured model/provider rejected function calling (400).")

    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path), \
         patch("backend.agent.chat_session.call_llm_with_tools", side_effect=boom):
        reply = sess.ask("go", on_event=events.append)

    assert "Agent stopped" in reply
    kinds = [(m.get("role"), m.get("kind")) for m in sess.history]
    assert ("system", "error") in kinds
    err_evts = [e for e in events if e.get("type") == "error"]
    assert err_evts, "expected a live error event"
    # Live event carries the persisted id so the frontend upsert survives refresh.
    hist_ids = {m.get("id") for m in sess.history}
    assert err_evts[0]["id"] in hist_ids
    assert sess.history[-1]["id"] == err_evts[0]["id"] or err_evts[0]["id"] in hist_ids


def test_cancel_persisted_as_notice(tmp_path):
    sess = _make_session(tmp_path)

    def cancelled(messages, tools, cancel_event, label, on_delta=None):
        import threading
        raise InterruptedError("Cancelled")

    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path), \
         patch("backend.agent.chat_session.call_llm_with_tools", side_effect=cancelled):
        reply = sess.ask("go", on_event=events.append)

    assert reply == "Stopped by user."
    kinds = [(m.get("role"), m.get("kind")) for m in sess.history]
    assert ("system", "notice") in kinds
    assert any(e.get("type") == "notice" for e in events)


def test_budget_exhaustion_persisted(tmp_path):
    sess = _make_session(tmp_path)
    turn = NativeTurn(content="", reasoning="")
    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path), \
         patch("backend.agent.chat_session.call_llm_with_tools", return_value=turn), \
         patch("backend.agent.chat_session.MAX_CHAT_TURNS", 2):
        reply = sess.ask("go", on_event=events.append)
    assert "ran out of steps" in reply
    assert any(m.get("role") == "system" and m.get("kind") == "error" for m in sess.history)


def test_report_error_public_entry(tmp_path):
    sess = _make_session(tmp_path)
    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess.report_error("Agent stopped: boom", on_event=events.append)
    assert any(m.get("kind") == "error" for m in sess.history)
    assert any(e.get("type") == "error" for e in events)


def test_report_error_handles_push_failure(tmp_path):
    sess = _make_session(tmp_path)
    events = []
    with patch.object(sess, '_push_error', side_effect=OSError('disk full')):
        res = sess.report_error('Agent stopped: disk full', on_event=events.append)
    assert isinstance(res, dict)
    assert res.get('id')
    assert res.get('kind') == 'error'
    assert len(events) == 1
    assert events[0].get('type') == 'error'
    assert events[0].get('id') == res.get('id')


def test_budget_exhaustion_unified_text(tmp_path):
    sess = _make_session(tmp_path)
    turn = NativeTurn(content='', reasoning='')
    with patch('backend.agent.chat_session._session_dir', return_value=tmp_path), \
         patch('backend.agent.chat_session.call_llm_with_tools', return_value=turn), \
         patch('backend.agent.chat_session.MAX_CHAT_TURNS', 1):
        reply = sess.ask('go')
    assert reply == 'Agent stopped: ran out of steps for this turn — please ask me to continue.'
    assert sess.history[-1]['text'] == reply


def test_resolve_pending_approved_error_handling(tmp_path):
    sess = _make_session(tmp_path)
    sess.pending = {
        "id": "pend1", "kind": "render", "tool": "run_stage",
        "args": {"stage": "render"}, "call_id": "c1", "turn": "turn1"
    }
    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path), \
         patch("backend.agent.chat_session.execute_chat_tool", side_effect=RuntimeError("render failed")):
        reply = sess.ask("", confirm_action=True, on_event=events.append)
    assert "Agent stopped during run_stage" in reply
    assert not sess.running
    kinds = [(m.get("role"), m.get("kind")) for m in sess.history]
    assert ("system", "error") in kinds
    types = [e.get("type") for e in events]
    assert "started" in types
    assert "tool_start" in types
    assert "error" in types
    assert "done" in types


def test_resolve_pending_approved_interrupted(tmp_path):
    sess = _make_session(tmp_path)
    sess.pending = {
        "id": "pend2", "kind": "destructive", "tool": "clear_visuals",
        "args": {}, "call_id": "c2", "turn": "turn2"
    }
    events = []
    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path), \
         patch("backend.agent.chat_session.execute_chat_tool", side_effect=InterruptedError("cancelled")):
        reply = sess.ask("", confirm_action=True, on_event=events.append)
    assert reply == "Stopped by user."
    assert not sess.running
    kinds = [(m.get("role"), m.get("kind")) for m in sess.history]
    assert ("system", "notice") in kinds
    types = [e.get("type") for e in events]
    assert "started" in types
    assert "tool_start" in types
    assert "notice" in types
    assert "done" in types
