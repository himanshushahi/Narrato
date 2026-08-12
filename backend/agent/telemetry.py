"""
Agent activity telemetry.

Records a live, thread-safe feed of what the AI agent is doing — tool calls,
skill reads, file reads/writes, LLM calls, and web searches — and forwards each
entry to registered callbacks (the UI bridge registers one that pushes events
to the frontend via ui_queue).

Entry shape:
    {
        "id": str,          # unique id (counter + time)
        "ts": float,        # unix timestamp
        "kind": str,        # "tool" | "skill" | "file" | "llm" | "web"
        "name": str,        # e.g. tool name, skill name, relative path, label
        "detail": str,      # short human-readable detail (args/path/status)
        "status": str,      # "running" | "ok" | "error" | "skipped"
    }

Emitters may attach structured payloads via keyword arguments (e.g.
args=/result= for tool calls, version=/scope= for skill reads). These extra
keys are stored verbatim on the entry so the UI can render them without
parsing the detail string, and are preserved by update_activity().

Long-running calls emit a "running" entry once and then RESOLVE it in place via
update_activity(), so the feed shows one entry per call and the frontend's
"active" badge reflects only genuinely in-flight work.
"""

import itertools
import threading
import time
from collections import deque

_ACTIVITY_MAX = 300

_lock = threading.Lock()
_activity = deque(maxlen=_ACTIVITY_MAX)
_callbacks = []
_id_counter = itertools.count(1)


def _next_id():
    # itertools.count is atomic under the GIL — safe from concurrent
    # pipeline workers, unlike a plain global counter.
    return f"{time.time():.3f}-{next(_id_counter)}"


def register_activity_callback(callback):
    """Register a callable invoked with each new activity entry."""
    with _lock:
        _callbacks.append(callback)


def emit_activity(kind: str, name: str, detail: str = "", status: str = "ok", **extra) -> str:
    """Record one activity entry, broadcast it, and return its id so the caller
    can later resolve it via update_activity().

    extra: optional structured fields (e.g. args, result, version, scope)
    stored verbatim on the entry for the UI to render.
    """
    entry = {
        "id": _next_id(),
        "ts": time.time(),
        "kind": kind,
        "name": name,
        "detail": detail,
        "status": status,
        **extra,
    }
    with _lock:
        _activity.appendleft(entry)
        callbacks = list(_callbacks)
    for cb in callbacks:
        try:
            cb(entry)
        except Exception:
            pass  # a broken sink must never break the agent
    return entry["id"]


def update_activity(entry_id: str, status: str, detail: str = None, **extra):
    """Resolve a previously emitted entry in place (e.g. "running" -> "ok").

    Sends the updated snapshot to callbacks so the frontend can replace the
    existing row instead of appending a duplicate.

    extra: structured fields to merge into the entry (e.g. result for tool
    calls), keeping fields emitted earlier (args) intact.
    """
    if not entry_id:
        return
    with _lock:
        for entry in _activity:
            if entry["id"] == entry_id:
                entry["status"] = status
                if detail is not None:
                    entry["detail"] = detail
                for key, value in extra.items():
                    entry[key] = value
                snapshot = dict(entry)
                callbacks = list(_callbacks)
                break
        else:
            return
    for cb in callbacks:
        try:
            cb(snapshot)
        except Exception:
            pass


def get_agent_activity() -> list:
    """Return the recorded activity feed, newest first."""
    with _lock:
        return list(_activity)


def clear_agent_activity():
    """Drop all recorded entries (used by tests and the UI clear button)."""
    with _lock:
        _activity.clear()
