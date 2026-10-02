import json
import pytest
from unittest.mock import MagicMock, patch
from backend.agent.chat_session import ChatSession
from backend.agent.chat_loop import NativeTurn, NativeToolCall


def test_chat_session_preserves_extra_content_for_gemini(tmp_path):
    """Verify that ChatSession preserves extra_content (such as Gemini thought_signature)
    in the llm_messages payload across tool turns."""

    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess = ChatSession("test_proj_gemini", "default")
        sess.history = []

        fake_signature = {"google": {"thought_signature": "opaque_encrypted_token_123"}}
        turn_tool = NativeTurn(
            content="",
            reasoning="Checking the scene...",
            tool_calls=[
                NativeToolCall(
                    call_id="call_999",
                    name="probe_scene",
                    arguments={"project_id": "test_proj_gemini"},
                    extra_content=fake_signature,
                )
            ],
        )
        turn_final = NativeTurn(content="Scene inspection complete.", reasoning="")

        calls_received = []

        def mock_call_llm(messages, tools, cancel_event, label, on_delta=None):
            calls_received.append(list(messages))
            if len(calls_received) == 1:
                return turn_tool
            return turn_final

        def mock_execute_tool(name, args, project_id, cancel_event):
            return json.dumps({"ok": True, "scene_count": 5})

        with patch("backend.agent.chat_session.call_llm_with_tools", side_effect=mock_call_llm), \
             patch("backend.agent.chat_session.execute_chat_tool", side_effect=mock_execute_tool):

            reply = sess.ask("Inspect project scenes")

        assert reply == "Scene inspection complete."
        assert len(calls_received) == 2

        # In turn 2, check the assistant message passed to the model
        turn_2_messages = calls_received[1]
        assistant_msgs = [m for m in turn_2_messages if m.get("role") == "assistant"]
        assert len(assistant_msgs) >= 1
        tc_entry = assistant_msgs[0]["tool_calls"][0]
        assert tc_entry["id"] == "call_999"
        assert tc_entry["extra_content"] == fake_signature


def test_chat_session_standard_openai_omits_extra_content(tmp_path):
    """Verify that when the provider does NOT send extra_content (e.g. OpenAI / DeepSeek),
    no extra_content key is injected into the tool_calls payload."""

    with patch("backend.agent.chat_session._session_dir", return_value=tmp_path):
        sess = ChatSession("test_proj_openai", "default")
        sess.history = []

        turn_tool = NativeTurn(
            content="",
            reasoning="",
            tool_calls=[
                NativeToolCall(
                    call_id="call_openai_1",
                    name="probe_scene",
                    arguments={"project_id": "test_proj_openai"},
                    extra_content=None,
                )
            ],
        )
        turn_final = NativeTurn(content="All done.", reasoning="")

        calls_received = []

        def mock_call_llm(messages, tools, cancel_event, label, on_delta=None):
            calls_received.append(list(messages))
            if len(calls_received) == 1:
                return turn_tool
            return turn_final

        def mock_execute_tool(name, args, project_id, cancel_event):
            return json.dumps({"ok": True})

        with patch("backend.agent.chat_session.call_llm_with_tools", side_effect=mock_call_llm), \
             patch("backend.agent.chat_session.execute_chat_tool", side_effect=mock_execute_tool):

            reply = sess.ask("Run inspection")

        assert reply == "All done."
        assert len(calls_received) == 2

        turn_2_messages = calls_received[1]
        assistant_msgs = [m for m in turn_2_messages if m.get("role") == "assistant"]
        tc_entry = assistant_msgs[0]["tool_calls"][0]
        assert "extra_content" not in tc_entry
