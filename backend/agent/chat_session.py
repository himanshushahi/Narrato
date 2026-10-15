"""Long-horizon chat sessions for the in-app Export-tab agent.

Normal agent harness behavior — no output scraping:

- real ``messages[]`` history (system / user / assistant / tool),
- real ``tools`` parameter, structured ``tool_calls`` from the response object
  (see :mod:`backend.agent.chat_loop`),
- the model's reasoning stream is stored as ``thinking`` entries and shown
  in the UI in a collapsible block,
- every tool result is appended back as a ``tool`` message so the next turn
  reasons over real outcomes,
- destructive actions and the final render pause for explicit user approval
  (human-in-the-loop) instead of executing blindly.

Same tools and the same MCP context (instructions + pipeline guide + skill
gates) as an external MCP agent; same app LLM as the pipeline.
"""

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Dict, List

from backend.core.logger import logger
from backend.agent.chat_tools import (
    CHAT_TOOL_NAMES,
    execute_chat_tool,
    get_chat_tools_schema,
)
from backend.agent.chat_loop import call_llm_with_tools


MAX_CHAT_TURNS = 60
MAX_LLM_MESSAGES = 41  # system + last 40
DESTRUCTIVE_TOOLS = frozenset({"delete_project", "clear_visuals", "clear_assets"})


def _session_dir(project_id: str) -> Path:
    from backend.core.config import get_storage_dir
    d = get_storage_dir() / project_id / "chat"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _session_path(project_id: str, session_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", session_id or "") or "default"
    return _session_dir(project_id) / f"session_{safe}.json"


def _split_thinking(content: str) -> tuple:
    """Split literal <think> blocks (some models emit them as text) into
    (thinking, clean_text). Display hygiene only — not tool parsing."""
    thinks = re.findall(r"<think>(.*?)</think\s*>", content or "",
                        flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r"<think>.*?(?:</think\s*>|$)", "", content or "",
                   flags=re.DOTALL | re.IGNORECASE).strip()
    thinking = "\n\n".join(t.strip() for t in thinks if t.strip())
    return thinking, clean


def _build_system_prompt(project_id: str) -> str:
    """Same context as MCP (instructions + pipeline guide + live snapshot),
    plus an agent charter describing capabilities and workflow.

    Deliberately contains NO calling syntax: tools arrive via the native
    ``tools`` parameter, so there is nothing to explain and nothing that
    can drift from what the backend actually executes.
    """
    from backend.mcp.server import NARRATO_SERVER_INSTRUCTIONS, pipeline_guide

    parts = [NARRATO_SERVER_INSTRUCTIONS]
    try:
        parts.append("\n\n# PIPELINE GUIDE (narrato://pipeline-guide)\n" + pipeline_guide())
    except Exception as e:
        logger.warning(f"chat pipeline-guide inject failed: {e}")
    try:
        from backend.database import db as _db
        proj = _db.get_project(project_id) or {}
        tasks = _db.get_project_tasks(project_id) or []
        snap = {
            "project_id": project_id,
            "name": proj.get("name"),
            "language": proj.get("language"),
            "video_format": proj.get("video_format"),
            "duration_mode": proj.get("duration_mode"),
            "status": proj.get("status"),
            "video_path": proj.get("video_path"),
            "tasks": [{k: t.get(k) for k in ("step", "status", "progress", "message")} for t in tasks],
        }
        parts.append("\n\n# CURRENT PROJECT SNAPSHOT\n" + json.dumps(snap, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"chat project snapshot failed: {e}")
    parts.append(
        "\n\n# AGENT CHARTER (in-app assistant)\n"
        f"You are working inside the Narrato desktop app on project_id={project_id}.\n"
        "Your function tools are provided natively — just use them directly. "
        "Never write out tool calls as text, code fences, XML, or any other markup; "
        "anything you type is shown to the user as-is and never executed.\n"
        "What you can do: inspect the project (project_status, get_script, get_visuals, "
        "probe_*, read_project_file, get_receipt), ground yourself in the skills (get_stage_skills, "
        "get_skill, search_tools for the rest), author (save_script — full rewrites only, "
        "patch_script for single-section fixes, save_design, save_visuals, save_visuals_batch), "
        "verify media (search_media, verify_stock), research (web_search), cost-preview (estimate_cost), run mechanical stages "
        "(run_stage for voiceover/transcribe/assets/render, idempotency_key guards repeats), review frames (review_frame), "
        "and gate publishing (qa_gate — call before render, never render when it fails).\n"
        "Workflow you must follow: skill grounding before authoring "
        "(get_stage_skills per stage, plus one full declarative-ast section before visuals); "
        "validate with dry_run before persisting visuals; prefer save_visuals_batch for whole "
        "videos; run fetch_assets before review_frame; review every section, then STOP and "
        "present a review summary — the final render runs only after the user's explicit "
        "approval, as do deletions and clears (ask, don't assume). After render, spot-check "
        "the finished file with review_frame(mode=render) before declaring done.\n"
        "Slow stages (generate_voiceover, transcribe, render — minutes long): call "
        "run_stage(wait=true) and await the result; the turn stays open and Stop still "
        "works. Only use run_stage(wait=false) when the user wants to keep chatting "
        "meanwhile — then loop sleep (~90s for the slow three, ~45s for fetch_assets) "
        "→ stage_status until completed/failed, and run NO other mutating tool while "
        "the stage is queued/running (read-only probes are fine).\n"
        "Reply in the user's language with short progress summaries: what you did, key "
        "numbers (scenes, timings, warnings), and what happens next. Never paste raw JSON "
        "dumps or invent results you did not receive from a tool."
    )
    return "\n".join(parts)


class ChatSession:
    """One persistent conversation bound to a project."""

    _sessions: Dict[str, "ChatSession"] = {}
    _lock = threading.Lock()

    def __init__(self, project_id: str, session_id: str = "default"):
        self.project_id = project_id
        self.session_id = session_id or "default"
        self.cancel_event = threading.Event()
        self.running = False
        # Monotonic sequence for canonical ordering. Every history entry
        # gets a seq on append; the frontend sorts persisted entries by seq
        # instead of relying on live-insertion order or float timestamps.
        self._seq = 0
        # UI log: user | thinking | assistant | tool | system
        self.history: List[dict] = []
        # Native LLM messages: system | user | assistant(+tool_calls) | tool
        self.llm_messages: List[dict] = []
        # Human-in-the-loop gate: None or {id, kind, tool, args, call_id}
        self.pending: dict | None = None
        self._load()

    @classmethod
    def get(cls, project_id: str, session_id: str = "default") -> "ChatSession":
        key = f"{project_id}::{session_id or 'default'}"
        with cls._lock:
            s = cls._sessions.get(key)
            if s is None:
                s = ChatSession(project_id, session_id)
                cls._sessions[key] = s
            return s

    # -- persistence ---------------------------------------------------
    def _load(self):
        try:
            p = _session_path(self.project_id, self.session_id)
            if p.exists():
                doc = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(doc, dict):
                    if isinstance(doc.get("history"), list):
                        self.history = doc["history"][-200:]
                    if isinstance(doc.get("llm_messages"), list):
                        self.llm_messages = doc["llm_messages"][-MAX_LLM_MESSAGES:]
                        self.llm_messages = self._capped_llm_messages()
                    if isinstance(doc.get("pending"), dict):
                        self.pending = doc["pending"]
        except Exception as e:
            logger.warning(f"chat history load failed: {e}")
            self.history, self.llm_messages, self.pending = [], [], None
        # Backfill seq for sessions persisted before seq existed, then
        # resume the counter past the highest seen value.
        try:
            max_seq = -1
            for m in self.history:
                if isinstance(m, dict) and isinstance(m.get("seq"), int):
                    max_seq = max(max_seq, m["seq"])
            next_seq = 0
            for m in self.history:
                if isinstance(m, dict) and not isinstance(m.get("seq"), int):
                    m["seq"] = next_seq
                    next_seq += 1
            self._seq = max(max_seq + 1, next_seq, len(self.history))
        except Exception:
            self._seq = len(self.history)
        if not self.llm_messages:
            self.llm_messages = [{"role": "system",
                                  "content": _build_system_prompt(self.project_id)}]
        self._sanitize_llm_messages()

    def _sanitize_llm_messages(self) -> None:
        """Drop assistant tool_call entries that never received tool responses.

        A previous bug appended assistant tool_calls without executing them,
        leaving dangling calls: strict providers reject the history (400) and
        lenient ones see phantom calls. An assistant message is kept only when
        every one of its call ids is answered by a later tool message before
        the next user/assistant/system turn.
        """
        msgs = [m for m in self.llm_messages if isinstance(m, dict)]
        if not msgs:
            return
        drop: set = set()
        for i, m in enumerate(msgs):
            if m.get("role") != "assistant" or not m.get("tool_calls"):
                continue
            want = {tc.get("id") for tc in m["tool_calls"] if isinstance(tc, dict)}
            want.discard(None)
            if not want:
                continue
            got: set = set()
            for later in msgs[i + 1:]:
                if later.get("role") in ("user", "system"):
                    break
                if later.get("role") == "assistant":
                    break
                if later.get("role") == "tool" and later.get("tool_call_id") in want:
                    got.add(later.get("tool_call_id"))
            if want - got:
                drop.add(i)
        if drop:
            logger.warning(f"chat sanitize: dropping {len(drop)} orphan tool-call message(s).")
            self.llm_messages = [m for i, m in enumerate(msgs) if i not in drop]
            if not any(isinstance(m, dict) and m.get("role") == "system" for m in self.llm_messages):
                self.llm_messages.insert(0, {"role": "system",
                                             "content": _build_system_prompt(self.project_id)})

    def _save(self):
        try:
            p = _session_path(self.project_id, self.session_id)
            p.write_text(json.dumps(
                {"project_id": self.project_id, "session_id": self.session_id,
                 "updated_at": time.time(), "pending": self.pending,
                 "history": self.history[-200:],
                 "llm_messages": self._capped_llm_messages()},
                ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"chat history save failed: {e}")

    def _capped_llm_messages(self) -> list:
        """System prompt first, then the most recent turns. A naive tail
        slice would drop the system message once history grows past the cap,
        silently losing the MCP instructions + charter mid-conversation."""
        sys_msgs = [m for m in self.llm_messages[:1]
                    if isinstance(m, dict) and m.get("role") == "system"]
        rest = [m for m in self.llm_messages
                if isinstance(m, dict) and m.get("role") != "system"]
        return sys_msgs + rest[-(MAX_LLM_MESSAGES - 1):]

    def _next_seq(self) -> int:
        s = self._seq
        self._seq += 1
        return s

    def _append_history(self, entry: dict) -> dict:
        """Append one UI-log entry with a stable id, timestamp and monotonic
        seq. The seq is the canonical ordering key consumed by the frontend;
        array position alone is not reliable across live merges."""
        entry.setdefault("id", uuid.uuid4().hex[:8])
        entry.setdefault("ts", time.time())
        entry["seq"] = self._next_seq()
        self.history.append(entry)
        return entry

    def clear(self):
        self.history = []
        self._seq = 0
        self.pending = None
        self.llm_messages = [{"role": "system",
                              "content": _build_system_prompt(self.project_id)}]
        self._save()

    def to_dict(self) -> dict:
        return {"project_id": self.project_id, "session_id": self.session_id,
                "running": self.running, "pending": self.pending,
                "messages": self.history[-200:]}

    # -- public turn API -------------------------------------------------
    def ask(self, user_text: str, confirm_render: bool = False,
            confirm_action=None, on_event: Callable[[dict], None] = None) -> str:
        """Run one user turn to completion (blocking). Returns final reply."""
        if self.running:
            return "A turn is already running — please wait or stop it first."
        # Resolve a pending human-in-the-loop gate first.
        if self.pending is not None and confirm_action is not None:
            return self._resolve_pending(bool(confirm_action), on_event)
        if self.pending is not None:
            return "That action still needs your approval — approve or deny it first."
        # The in-memory session may predate the orphan-call repair.
        self._sanitize_llm_messages()
        self.running = True
        self.cancel_event.clear()
        try:
            text = (user_text or "").strip()
            if confirm_render and not text:
                text = "Approved — proceed with the final render."
            self._append_history({"role": "user", "text": text})
            self.llm_messages.append({"role": "user", "content": text})
            if confirm_render:
                note = ("The user approved the final render in the app. "
                        "Proceed with run_stage(render, confirm_render=true).")
                self.llm_messages.append({"role": "system", "content": note})
            self._save()
            if on_event:
                self._emit(on_event, {"type": "started"})
            try:
                reply = self._run_loop(on_event, MAX_CHAT_TURNS)
            except InterruptedError:
                self._push_notice("Stopped by user.", on_event)
                reply = "Stopped by user."
            except Exception as e:
                logger.error(f"chat turn failed: {e}", exc_info=True)
                self._push_error(f"Agent stopped: {e}", on_event)
                reply = f"Agent stopped: {e}"
            self._save()
            self._emit(on_event, {"type": "done", "text": reply})
            return reply
        finally:
            self.running = False
            self._save()

    # -- approval gate ---------------------------------------------------
    def _wants_approval(self, name: str, args: dict) -> str | None:
        if name == "run_stage" and (args.get("stage") == "render") \
                and not self._is_truthy(args.get("confirm_render")):
            return "render"
        if name in DESTRUCTIVE_TOOLS:
            return "destructive"
        return None

    @staticmethod
    def _is_truthy(value) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).strip().lower() not in ("", "false", "0", "no", "off")

    def _resolve_pending(self, approved: bool, on_event) -> str:
        pend = self.pending or {}
        self.pending = None
        if not approved:
            note = (f"The user denied the {pend.get('kind')} action "
                    f"({pend.get('tool')}). Do not retry it; ask how to proceed instead.")
            self.llm_messages.append({"role": "system", "content": note})
            reply = "Understood — I won't do that. Tell me how you'd like to proceed."
            entry = self._append_history({"role": "assistant", "text": reply})
            self._save()
            self._emit(on_event, {"type": "assistant", "id": entry["id"],
                                  "text": entry["text"], "ts": entry["ts"],
                                  "seq": entry["seq"]})
            self._emit(on_event, {"type": "done", "text": reply})
            return reply
        # Approved: run exactly the held action, then keep reasoning.
        name, args, call_id = pend.get("tool"), dict(pend.get("args") or {}), pend.get("call_id")
        pend_turn = pend.get("turn")
        if pend.get("kind") == "render" and name == "run_stage":
            args["confirm_render"] = True
        tc_item = {
            "id": call_id, "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}
        }
        if pend.get("extra_content"):
            tc_item["extra_content"] = pend["extra_content"]
        self.llm_messages.append({
            "role": "assistant", "content": None,
            "tool_calls": [tc_item]})
        self.running = True
        self.cancel_event.clear()
        try:
            self._emit(on_event, {"type": "started"})
            self._emit(on_event, {"type": "tool_start", "tool": name,
                                  "args": args, "call_id": call_id,
                                  "turn": pend_turn})
            try:
                result_text = execute_chat_tool(name, args, self.project_id,
                                                self.cancel_event)
            except InterruptedError:
                self._push_notice("Stopped by user.", on_event, turn=pend_turn)
                self._emit(on_event, {"type": "done", "text": "Stopped by user."})
                return "Stopped by user."
            except Exception as e:
                logger.error(f"chat approved tool {name} failed: {e}", exc_info=True)
                self._push_error(f"Agent stopped during {name}: {e}", on_event, turn=pend_turn)
                self._emit(on_event, {"type": "done", "text": f"Agent stopped during {name}: {e}"})
                return f"Agent stopped during {name}: {e}"
            self._push_tool_result(name, call_id, args, result_text, on_event,
                                   turn=pend_turn)
            try:
                reply = self._run_loop(on_event, MAX_CHAT_TURNS)
            except InterruptedError:
                self._push_notice("Stopped by user.", on_event, turn=pend_turn)
                reply = "Stopped by user."
            except Exception as e:
                logger.error(f"chat turn failed: {e}", exc_info=True)
                self._push_error(f"Agent stopped: {e}", on_event, turn=pend_turn)
                reply = f"Agent stopped: {e}"
            self._emit(on_event, {"type": "done", "text": reply})
            return reply
        finally:
            self.running = False
            self._save()

    # -- core loop ---------------------------------------------------------
    def _run_loop(self, on_event, budget: int) -> str:
        tools = get_chat_tools_schema()
        label = f"Chat ({self.project_id[:8]})"
        for _ in range(budget):
            if self.cancel_event.is_set():
                self._push_notice("Stopped by user.", on_event)
                return "Stopped by user."
            turn_id = uuid.uuid4().hex[:8]

            def _on_delta(kind: str, delta: str, _tid=turn_id):
                self._emit(on_event, {"type": "stream", "turn": _tid,
                                      "kind": kind, "delta": delta})

            try:
                turn = call_llm_with_tools(self._capped_llm_messages(),
                                           tools, self.cancel_event, label,
                                           on_delta=_on_delta if on_event else None)
            except InterruptedError:
                self._push_notice("Stopped by user.", on_event, turn=turn_id)
                return "Stopped by user."
            except RuntimeError as e:
                logger.error(f"chat LLM turn failed: {e}", exc_info=True)
                self._push_error(f"Agent stopped: {e}", on_event, turn=turn_id)
                return f"Agent stopped: {e}"
            except Exception as e:
                logger.error(f"chat LLM turn failed: {e}", exc_info=True)
                self._push_error(f"Agent stopped: {type(e).__name__}: {e}",
                                 on_event, turn=turn_id)
                return f"Agent stopped: {type(e).__name__}: {e}"
            thinking, clean = _split_thinking(turn.content or "")
            parts = []
            if (turn.reasoning or "").strip():
                parts.append(turn.reasoning.strip())
            if thinking:
                parts.append(thinking)
            if parts:
                entry = self._append_history({"role": "thinking",
                         "text": "\n\n".join(parts)[:6000], "turn": turn_id})
                self._save()
                self._emit(on_event, {"type": "thinking", "id": entry["id"],
                                      "text": entry["text"], "ts": entry["ts"],
                                      "seq": entry["seq"], "turn": turn_id})
            if turn.tool_calls:
                # Assistant message (may carry narration like "I'll check…").
                tc_payload = []
                for c in turn.tool_calls:
                    item = {
                        "id": c.call_id, "type": "function",
                        "function": {"name": c.name, "arguments": json.dumps(c.arguments)}
                    }
                    if getattr(c, "extra_content", None):
                        item["extra_content"] = c.extra_content
                    tc_payload.append(item)
                self.llm_messages.append({
                    "role": "assistant", "content": clean or None,
                    "tool_calls": tc_payload})
                if clean:
                    # Deduplicate only within the current user turn (messages after the latest user message)
                    current_turn_assistants = []
                    for m in reversed(self.history):
                        if m.get("role") == "user":
                            break
                        if m.get("role") == "assistant":
                            current_turn_assistants.append((m.get("text") or "").strip())
                    if clean.strip() not in current_turn_assistants:
                        entry = self._append_history({"role": "assistant",
                                             "text": clean[:6000], "turn": turn_id})
                        self._save()
                        self._emit(on_event, {"type": "assistant", "id": entry["id"],
                                              "text": entry["text"], "ts": entry["ts"],
                                              "seq": entry["seq"], "turn": turn_id})
                for call in turn.tool_calls:
                    if self.cancel_event.is_set():
                        self._push_notice("Stopped by user.", on_event, turn=turn_id)
                        return "Stopped by user."
                    if call.arguments_error:
                        self._push_tool_result(
                            call.name, call.call_id, call.arguments,
                            json.dumps({"ok": False,
                                        "error": call.arguments_error + " — retry with valid JSON arguments."}),
                            on_event, turn=turn_id)
                        continue
                    if call.name not in CHAT_TOOL_NAMES:
                        self._push_tool_result(
                            call.name, call.call_id, call.arguments,
                            json.dumps({"ok": False,
                                        "error": f"Unknown tool {call.name!r}. Use only the provided functions."}),
                            on_event, turn=turn_id)
                        continue
                    gate = self._wants_approval(call.name, call.arguments)
                    if gate:
                        # Detach the held call from its assistant message (tool
                        # results for already-executed siblings sit on top, so
                        # scan back): _resolve_pending re-appends it alone on
                        # approval, and a duplicated call_id is invalid for
                        # strict providers. Executed siblings and their tool
                        # results stay intact.
                        for msg in reversed(self.llm_messages):
                            if not isinstance(msg, dict) or msg.get("role") != "assistant" \
                                    or not isinstance(msg.get("tool_calls"), list):
                                continue
                            if not any(isinstance(tc, dict) and tc.get("id") == call.call_id
                                       for tc in msg["tool_calls"]):
                                continue
                            kept = [tc for tc in msg["tool_calls"]
                                    if not (isinstance(tc, dict) and tc.get("id") == call.call_id)]
                            if kept or msg.get("content"):
                                if kept:
                                    msg["tool_calls"] = kept
                                else:
                                    msg.pop("tool_calls", None)
                            else:
                                self.llm_messages.remove(msg)
                            break
                        self.pending = {"id": uuid.uuid4().hex[:8], "kind": gate,
                                        "tool": call.name, "args": call.arguments,
                                        "call_id": call.call_id, "turn": turn_id,
                                        "extra_content": getattr(call, "extra_content", None)}
                        self._save()
                        self._emit(on_event, {"type": "confirm", "id": self.pending["id"],
                                              "kind": gate, "tool": call.name,
                                              "args": call.arguments})
                        if gate == "render":
                            return ("The video is built and reviewed. Approve the final "
                                    "render to continue — or tell me what to fix first.")
                        return (f"This will run {call.name}, which cannot be undone. "
                                "Approve it to continue — or tell me what to do instead.")
                    # Normal path: run the tool NOW and append its result so the
                    # next turn reasons over real outcomes.
                    self._emit(on_event, {"type": "tool_start", "tool": call.name,
                                          "args": call.arguments, "call_id": call.call_id,
                                          "turn": turn_id})
                    try:
                        result_text = execute_chat_tool(call.name, call.arguments,
                                                        self.project_id, self.cancel_event)
                    except InterruptedError:
                        self._push_notice("Stopped by user.", on_event, turn=turn_id)
                        return "Stopped by user."
                    except Exception as e:
                        logger.error(f"chat tool {call.name} failed: {e}", exc_info=True)
                        self._push_error(f"Agent stopped during {call.name}: {e}",
                                         on_event, turn=turn_id)
                        return f"Agent stopped during {call.name}: {e}"
                    self._push_tool_result(call.name, call.call_id, call.arguments,
                                           result_text, on_event, turn=turn_id)
                self._save()
                continue  # results appended — next turn reasons over them
            # No tool calls: final reply.
            if clean:
                self.llm_messages.append({"role": "assistant", "content": clean})
                current_turn_assistants = []
                for m in reversed(self.history):
                    if m.get("role") == "user":
                        break
                    if m.get("role") == "assistant":
                        current_turn_assistants.append((m.get("text") or "").strip())
                if clean.strip() not in current_turn_assistants:
                    entry = self._append_history({"role": "assistant",
                                         "text": clean[:6000], "turn": turn_id})
                    self._save()
                    self._emit(on_event, {"type": "assistant", "id": entry["id"],
                                          "text": entry["text"], "ts": entry["ts"],
                                          "seq": entry["seq"], "turn": turn_id})
                return clean
            self.llm_messages.append({"role": "system", "content":
                                      "Your reply was empty. Answer the user directly."})
        msg = "Agent stopped: ran out of steps for this turn — please ask me to continue."
        self._push_error(msg, on_event)
        return msg

    def _push_error(self, text: str, on_event, turn: str | None = None) -> dict:
        """Persist an agent-stopping error to history AND push it live.

        Previously LLM failures (provider 400, rate limits, unexpected
        exceptions) were returned as bare strings: the frontend's `done`
        handler ignores text, and the bridge's transient `error` event used
        a random id wiped by the next refresh. Both made the stop reason
        invisible. Errors now live in `history` (role=system, kind=error)
        like every other message, so refresh keeps them.
        """
        payload: dict = {"role": "system", "kind": "error",
                         "text": str(text or "Turn failed.")[:6000]}
        if turn is not None:
            payload["turn"] = turn
        entry = self._append_history(payload)
        self._save()
        evt: dict = {"type": "error", "kind": "error",
                     "error": str(text or "Turn failed.")[:2000],
                     "text": str(text or "Turn failed.")[:2000],
                     "id": entry["id"], "seq": entry["seq"], "ts": entry["ts"]}
        if turn is not None:
            evt["turn"] = turn
        self._emit(on_event, evt)
        return entry

    def _push_notice(self, text: str, on_event, turn: str | None = None) -> dict:
        """Persist a non-error stop reason (user cancel). Same dual
        history + live delivery as errors, but rendered as a neutral pill."""
        payload: dict = {"role": "system", "kind": "notice",
                         "text": str(text or "Stopped.")[:6000]}
        if turn is not None:
            payload["turn"] = turn
        entry = self._append_history(payload)
        self._save()
        evt: dict = {"type": "notice", "kind": "notice",
                     "text": str(text or "Stopped.")[:2000],
                     "id": entry["id"], "seq": entry["seq"], "ts": entry["ts"]}
        if turn is not None:
            evt["turn"] = turn
        self._emit(on_event, evt)
        return entry

    # Public entry for out-of-session reporters (e.g. bridge._worker) that
    # catch an exception outside _run_loop. Same persistence guarantee.
    def report_error(self, text: str, on_event=None, turn: str | None = None) -> dict:
        try:
            return self._push_error(text, on_event, turn=turn)
        except Exception as e:
            logger.warning(f"chat report_error failed to persist/emit: {e}", exc_info=True)
            fallback_id = uuid.uuid4().hex[:8]
            fallback_entry: dict = {
                "role": "system",
                "kind": "error",
                "text": str(text or "Turn failed.")[:6000],
                "id": fallback_id,
            }
            if turn is not None:
                fallback_entry["turn"] = turn
            fallback_evt: dict = {
                "type": "error",
                "kind": "error",
                "error": str(text or "Turn failed.")[:2000],
                "text": str(text or "Turn failed.")[:2000],
                "id": fallback_id,
            }
            if turn is not None:
                fallback_evt["turn"] = turn
            self._emit(on_event, fallback_evt)
            return fallback_entry

    def _push_tool_result(self, name: str, call_id: str, args: dict,
                           result_text: str, on_event, turn: str | None = None) -> None:
        self.llm_messages.append({"role": "tool", "tool_call_id": call_id,
                                  "content": result_text[:6000]})
        history_entry: dict = {"role": "tool", "tool": name,
                             "call_id": call_id, "args": args if isinstance(args, dict) else {},
                             "text": result_text[:6000]}
        if turn is not None:
            history_entry["turn"] = turn
        entry = self._append_history(history_entry)
        self._save()
        try:
            lowered = result_text.lower()
            ok = '"ok": true' in lowered or '"ok":true' in lowered
        except Exception:
            ok = True
        evt: dict = {"type": "tool_done", "tool": name, "ok": ok,
                     "call_id": call_id, "text": result_text[:2000],
                     "id": entry["id"], "seq": entry["seq"], "ts": entry["ts"]}
        if turn is not None:
            evt["turn"] = turn
        self._emit(on_event, evt)

    @staticmethod
    def _emit(on_event, evt: dict) -> None:
        if not on_event:
            return
        try:
            on_event(evt)
        except Exception:
            pass
