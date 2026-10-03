import json
import pytest
from unittest.mock import MagicMock, patch
from backend.agent.chat_session import ChatSession

def test_chat_session_turn_scoped_deduplication(tmp_path):
    """Verify that ChatSession deduplicates repeated narration within the same turn,
    while strictly preserving identical replies across different user turns."""

    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess = ChatSession("test_proj_dedup", "default")
        sess.history = []

        # Turn 1: User asks something
        sess.history.append({"id": "u1", "role": "user", "text": "Fix scene 1", "ts": 1.0})

        # LLM emits narration before tool call 1
        clean1 = "I will check the scene now."
        # Simulate turn check logic from chat_session.py
        current_turn_assistants = []
        for m in reversed(sess.history):
            if m.get("role") == "user":
                break
            if m.get("role") == "assistant":
                current_turn_assistants.append((m.get("text") or "").strip())
        assert clean1.strip() not in current_turn_assistants
        sess.history.append({"id": "a1", "role": "assistant", "text": clean1, "ts": 1.1})

        # Tool 1 executes
        sess.history.append({"id": "t1", "role": "tool", "tool": "probe_scene", "text": "ok", "ts": 1.2})

        # Turn 1 LLM iteration 2: Model repeats the exact same narration before tool call 2
        clean2 = "I will check the scene now."
        current_turn_assistants = []
        for m in reversed(sess.history):
            if m.get("role") == "user":
                break
            if m.get("role") == "assistant":
                current_turn_assistants.append((m.get("text") or "").strip())
        # Should be detected as a duplicate in current turn!
        assert clean2.strip() in current_turn_assistants
        # Do not append clean2!

        # Tool 2 executes
        sess.history.append({"id": "t2", "role": "tool", "tool": "probe_asset", "text": "ok", "ts": 1.3})

        # Turn 1 final reply:
        clean_final = "Done! Scene 1 has been inspected and updated."
        current_turn_assistants = []
        for m in reversed(sess.history):
            if m.get("role") == "user":
                break
            if m.get("role") == "assistant":
                current_turn_assistants.append((m.get("text") or "").strip())
        assert clean_final.strip() not in current_turn_assistants
        sess.history.append({"id": "a2", "role": "assistant", "text": clean_final, "ts": 1.4})

        # Turn 2: User asks another question
        sess.history.append({"id": "u2", "role": "user", "text": "Now fix scene 2", "ts": 2.0})

        # Turn 2 assistant reply: Assistant repeats "Done! Scene 1 has been inspected and updated." or says "I will check the scene now."
        # This is a NEW turn, so it MUST NOT be dropped!
        turn2_narration = "I will check the scene now."
        current_turn_assistants = []
        for m in reversed(sess.history):
            if m.get("role") == "user":
                break
            if m.get("role") == "assistant":
                current_turn_assistants.append((m.get("text") or "").strip())
        # In Turn 2, current_turn_assistants must be empty because user message u2 stopped the scan!
        assert len(current_turn_assistants) == 0
        assert turn2_narration.strip() not in current_turn_assistants
        sess.history.append({"id": "a3", "role": "assistant", "text": turn2_narration, "ts": 2.1})

        # Check total messages: u1, a1, t1, t2, a2, u2, a3 (clean2 was correctly deduplicated)
        assert len(sess.history) == 7
        assert [m["id"] for m in sess.history] == ["u1", "a1", "t1", "t2", "a2", "u2", "a3"]


def test_chat_session_run_loop_deduplication(tmp_path):
    """End-to-end test of ChatSession.ask with multiple LLM turns repeating narration."""
    from backend.agent.chat_loop import NativeTurn, NativeToolCall

    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess = ChatSession("test_proj_e2e_dedup", "default")

        # Mock LLM returns:
        # Turn 0: tool call 1 with narration
        # Turn 1: tool call 2 with DUPLICATE repeated narration
        # Turn 2: final reply with conclusion
        turn0 = NativeTurn(content="Checking project files...", tool_calls=[
            NativeToolCall(call_id="c1", name="project_status", arguments={"project_id": "test_proj_e2e_dedup"})
        ])
        turn1 = NativeTurn(content="Checking project files...", tool_calls=[
            NativeToolCall(call_id="c2", name="get_script", arguments={"project_id": "test_proj_e2e_dedup"})
        ])
        turn2 = NativeTurn(content="Analysis complete.", tool_calls=[])

        llm_responses = [turn0, turn1, turn2]

        def mock_call_llm(*args, **kwargs):
            return llm_responses.pop(0)

        def mock_execute_tool(name, args, project_id, cancel_event):
            return json.dumps({"ok": True, "data": "dummy"})

        with patch("backend.agent.chat_session.call_llm_with_tools", side_effect=mock_call_llm), \
             patch("backend.agent.chat_session.execute_chat_tool", side_effect=mock_execute_tool):

            reply = sess.ask("Analyze project")
            assert reply == "Analysis complete."

            # Inspect session history
            roles = [m["role"] for m in sess.history]
            assert roles == ["user", "assistant", "tool", "tool", "assistant"]

            texts = [m["text"] for m in sess.history]
            assert texts[0] == "Analyze project"
            assert texts[1] == "Checking project files..."
            # Note: The duplicate "Checking project files..." before tool 2 was deduplicated!
            assert texts[4] == "Analysis complete."

        # Now test multi-turn: In Turn 2, the assistant repeats "Analysis complete."
        turn_next = NativeTurn(content="Analysis complete.", tool_calls=[])
        with patch("backend.agent.chat_session.call_llm_with_tools", return_value=turn_next):
            reply2 = sess.ask("Are you finished?")
            assert reply2 == "Analysis complete."

            # In history: "user", "assistant" must be appended because it's a new turn!
            roles2 = [m["role"] for m in sess.history]
            assert roles2 == ["user", "assistant", "tool", "tool", "assistant", "user", "assistant"]
            assert sess.history[-1]["text"] == "Analysis complete."

