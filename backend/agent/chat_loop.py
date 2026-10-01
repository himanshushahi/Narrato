"""Native function-calling loop primitive for the in-app chat agent.

Unlike the pipeline's ``AgentRunner`` (which asks the model to emit
```tool fenced blocks and scrapes them back out of free text), this module
talks to the provider like a normal agent harness:

- real ``messages[]`` history (system / user / assistant / tool),
- real ``tools`` parameter (OpenAI-compatible function schemas),
- structured ``tool_calls`` parsed from the response object — never from text.

No regexes, no fences, no XML. If the configured provider/model cannot do
function calling, the error says so instead of silently degrading.
"""

import concurrent.futures
import json
import random
import threading
import time
from dataclasses import dataclass, field

from backend.core.logger import logger


@dataclass
class NativeToolCall:
    call_id: str
    name: str
    arguments: dict = field(default_factory=dict)
    arguments_error: str = ""


@dataclass
class NativeTurn:
    content: str = ""
    reasoning: str = ""
    tool_calls: list = field(default_factory=list)  # list[NativeToolCall]


def call_llm_with_tools(messages: list, tools: list, cancel_event=None,
                        activity_label: str = "Chat", on_delta=None) -> NativeTurn:
    """One native chat-completion turn with function calling.

    Returns content + reasoning + structured tool calls. Raises
    InterruptedError on cancel, RuntimeError with an actionable message when
    the provider rejects function calling. Never cached (cached tool calls
    would replay real writes).

    on_delta(kind, text) (kind 'text' | 'thinking') receives batched streaming
    deltas for live UI updates. A broken sink never breaks the turn. Tool-call
    arguments are deliberately NOT streamed — partial JSON can never execute;
    calls run only from the fully assembled turn.
    """
    from backend.pipeline.ai import _resolve_llm_config, _record_usage
    from backend.agent.telemetry import emit_activity, update_activity
    from openai import OpenAI
    import openai

    if cancel_event is None:
        cancel_event = threading.Event()

    cfg = _resolve_llm_config(None)
    provider, api_key = cfg["provider"], cfg["api_key"]
    base_url, model = cfg["base_url"], cfg["model"]
    temperature, max_tokens, top_p = cfg["temperature"], cfg["max_tokens"], cfg["top_p"]
    if max_tokens < 8192:
        # Tool-call turns carry arguments + reasoning; a small budget starves
        # the visible content (same lesson as the pipeline's reasoning boost).
        max_tokens = 8192

    entry_id = emit_activity("llm", activity_label, f"{provider} / {model}", "running")

    def _run_completion(client, req_kwargs):
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(client.chat.completions.create, **req_kwargs)
            while not future.done():
                if cancel_event.is_set() or cancel_event.wait(0.5):
                    try:
                        client.close()
                    except Exception:
                        pass
                    raise InterruptedError("Cancelled")
            return future.result()

    client = OpenAI(api_key=api_key,
                    base_url=base_url.rstrip("/") if base_url else None,
                    timeout=300.0)
    base_kwargs = {"model": model, "messages": messages, "tools": tools,
                   "tool_choice": "auto", "temperature": temperature,
                   "max_tokens": max_tokens, "top_p": top_p}

    max_retries = 3
    for attempt in range(max_retries):
        if cancel_event.is_set():
            update_activity(entry_id, "error", "cancelled")
            raise InterruptedError("Cancelled")
        try:
            stream = _run_completion(client, {**base_kwargs, "stream": True})
            content_parts, reasoning_parts = [], []
            calls: dict = {}  # index -> {id, name, args_chunks}
            usage = None
            # Batched delta forwarding: per-chunk evaluate_js would thrash the
            # pywebview bridge, so flush at most every ~120ms.
            pending_text: list = []
            pending_think: list = []
            last_flush = time.monotonic()

            def _flush(force: bool = False):
                nonlocal last_flush
                if on_delta is None:
                    pending_text.clear()
                    pending_think.clear()
                    return
                if not force and (time.monotonic() - last_flush < 0.12):
                    return
                if pending_text:
                    try:
                        on_delta("text", "".join(pending_text))
                    except Exception:
                        pass
                    pending_text.clear()
                if pending_think:
                    try:
                        on_delta("thinking", "".join(pending_think))
                    except Exception:
                        pass
                    pending_think.clear()
                last_flush = time.monotonic()

            for chunk in stream:
                if cancel_event.is_set():
                    try:
                        stream.close()
                    except Exception:
                        pass
                    raise InterruptedError("Cancelled")
                if not chunk.choices:
                    if getattr(chunk, "usage", None) is not None:
                        usage = chunk.usage
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "content", None):
                    content_parts.append(delta.content)
                    pending_text.append(delta.content)
                if getattr(delta, "reasoning_content", None):
                    reasoning_parts.append(delta.reasoning_content)
                    pending_think.append(delta.reasoning_content)
                _flush()
                for tc in getattr(delta, "tool_calls", None) or []:
                    slot = calls.setdefault(tc.index, {"id": "", "name": "", "args": []})
                    if getattr(tc, "id", None):
                        slot["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            slot["name"] = fn.name
                        if getattr(fn, "arguments", None):
                            slot["args"].append(fn.arguments)
                if getattr(chunk, "usage", None) is not None:
                    usage = chunk.usage

            _flush(force=True)

            turn = NativeTurn(content="".join(content_parts).strip(),
                              reasoning="".join(reasoning_parts).strip())
            for idx in sorted(calls):
                slot = calls[idx]
                if not slot["name"]:
                    continue
                raw_args = "".join(slot["args"]).strip() or "{}"
                try:
                    parsed = json.loads(raw_args)
                    if not isinstance(parsed, dict):
                        parsed = {}
                    err = ""
                except Exception as e:
                    parsed, err = {}, f"arguments were not valid JSON: {e}"
                turn.tool_calls.append(NativeToolCall(
                    call_id=slot["id"] or f"call_{idx}",
                    name=slot["name"], arguments=parsed, arguments_error=err))

            if not turn.content and not turn.tool_calls and not turn.reasoning:
                # Empty stream (some models/reasoning setups) — one
                # non-streaming attempt before giving up on this attempt.
                logger.warning("chat native turn streamed empty; retrying non-streaming once.")
                resp = _run_completion(client, {**base_kwargs, "stream": False})
                if resp.choices:
                    msg = resp.choices[0].message
                    turn.content = (msg.content or "").strip()
                    for tc in msg.tool_calls or []:
                        try:
                            parsed = json.loads(tc.function.arguments or "{}")
                            err = "" if isinstance(parsed, dict) else "not an object"
                            if not isinstance(parsed, dict):
                                parsed = {}
                        except Exception as e:
                            parsed, err = {}, f"arguments were not valid JSON: {e}"
                        turn.tool_calls.append(NativeToolCall(
                            call_id=tc.id, name=tc.function.name,
                            arguments=parsed, arguments_error=err))
                    usage = resp.usage

            if usage is not None:
                try:
                    _record_usage(getattr(usage, "prompt_tokens", 0) or 0,
                                  getattr(usage, "completion_tokens", 0) or 0)
                except Exception:
                    pass
            update_activity(entry_id, "ok",
                            f"{provider} / {model} · {len(turn.tool_calls)} tool call(s)")
            return turn
        except InterruptedError:
            update_activity(entry_id, "error", "cancelled")
            raise
        except openai.BadRequestError as e:
            body = ""
            try:
                body = e.response.text if hasattr(e, "response") else str(e)
            except Exception:
                body = str(e)
            logger.error(f"chat native turn rejected: {body[:500]}")
            update_activity(entry_id, "error", "provider rejected function calling")
            raise RuntimeError(
                "The configured model/provider rejected function calling "
                f"({str(e)[:200]}). The in-app agent needs a tool-capable "
                "model — pick one with function-calling support in Settings → AI provider."
            )
        except openai.RateLimitError:
            if attempt < max_retries - 1:
                wait = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"chat rate limited; retrying in {wait:.1f}s.")
                if cancel_event.wait(wait):
                    update_activity(entry_id, "error", "cancelled")
                    raise InterruptedError("Cancelled")
                continue
            update_activity(entry_id, "error", "rate limited")
            raise RuntimeError("LLM rate limit exceeded. Wait a bit and try again.")
        except (RuntimeError, InterruptedError):
            raise
        except Exception as e:
            logger.warning(f"chat native turn failed ({type(e).__name__}: {e}), "
                           f"attempt {attempt + 1}/{max_retries}.")
            if attempt < max_retries - 1:
                if cancel_event.wait(2.0):
                    update_activity(entry_id, "error", "cancelled")
                    raise InterruptedError("Cancelled")
                continue
            update_activity(entry_id, "error", str(e)[:120])
            raise RuntimeError(f"LLM call failed: {e}")
    raise RuntimeError("LLM call failed after retries.")
