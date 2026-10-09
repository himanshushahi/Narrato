"""Central connectivity + network-error taxonomy for offline handling.

Covers every edge case where the user opens the app offline or the
internet drops mid-run (pipeline stage, chat turn, asset download):

- ``check_internet()``: fast, never-raises probe (DNS socket + HTTPS),
  cached for a few seconds so hot paths (queue loop, chat retries) don't
  stall on probes.
- ``classify_exception()``: maps raw SDK/socket/requests exceptions to a
  stable ``(error_code, user_message, retryable)`` triple so the frontend
  can show "No internet — reconnect and resume" instead of raw tracebacks.
- ``NETWORK_STEPS``: pipeline stages that require internet. Used as the
  pre-flight gate in bridge + queue.

Error codes (stable contract with frontend):
    OK, NETWORK_OFFLINE, DNS_FAILURE, TIMEOUT, AUTH_INVALID_KEY,
    RATE_LIMITED, PROVIDER_UNREACHABLE, BACKEND_DOWN, UNKNOWN
"""

import socket
import time
import urllib.request
from typing import Tuple

from backend.core.logger import logger

# Pipeline stages that cannot succeed without internet. transcribe/render
# are local-only; everything else touches LLM / TTS / stock providers.
NETWORK_STEPS = frozenset({
    "generate_script",
    "generate_voiceover",
    "generate_visuals",
    "fetch_assets",
})

OFFLINE_MESSAGE = (
    "No internet connection. Check your connection, then resume — "
    "completed stages are saved; the interrupted stage re-runs."
)

# Cache the probe briefly: parallel pipeline/chat polling must not each
# block on socket timeouts.
_cache: dict = {"at": 0.0, "internet": True, "latency_ms": 0.0}
CACHE_TTL_S = 10.0


def _tcp_probe(timeout: float = 3.0) -> bool:
    """Bare-TCP reachability (works even when DNS/HTTPS is hijacked)."""
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=timeout).close()
        return True
    except OSError:
        return False


def _https_probe(timeout: float = 5.0) -> Tuple[bool, float]:
    """HTTPS-level probe: catches captive portals / DNS-only failures."""
    start = time.monotonic()
    try:
        req = urllib.request.Request(
            "https://www.google.com/generate_204",
            headers={"User-Agent": "narrato-connectivity-probe/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ok = resp.status in (200, 204)
        return ok, (time.monotonic() - start) * 1000.0
    except Exception:
        return False, 0.0


def check_internet(force: bool = False, timeout: float = 3.0) -> dict:
    """Return {internet, latency_ms, method}. Never raises.

    Order: fast TCP first (3s), then HTTPS confirm. Cached for CACHE_TTL_S
    unless force=True (used by explicit user "Retry" actions).
    """
    now = time.monotonic()
    if not force and (now - _cache["at"] < CACHE_TTL_S):
        return {
            "internet": _cache["internet"],
            "latency_ms": _cache["latency_ms"],
            "cached": True,
        }
    internet = False
    latency_ms = 0.0
    method = "none"
    try:
        if _tcp_probe(timeout=timeout):
            internet = True
            method = "tcp"
            ok, ms = _https_probe(timeout=timeout + 2.0)
            if ok:
                latency_ms = ms
                method = "https"
        else:
            # TCP failed — still try HTTPS once (some networks block 8.8.8.8).
            ok, ms = _https_probe(timeout=timeout + 2.0)
            if ok:
                internet = True
                latency_ms = ms
                method = "https"
    except Exception as e:  # pragma: no cover — defensive, never raises
        logger.warning(f"connectivity probe failed: {e}")
        internet = False
    _cache.update({"at": now, "internet": internet, "latency_ms": latency_ms})
    return {"internet": internet, "latency_ms": latency_ms, "cached": False, "method": method}


def is_online(force: bool = False) -> bool:
    try:
        return bool(check_internet(force=force)["internet"])
    except Exception:
        return False


def cached_online() -> bool | None:
    """Cache-only connectivity view for exception hot paths.

    Returns True/False when the last probe is fresh (within CACHE_TTL_S),
    else None (unknown). Never blocks on sockets — use this inside
    classify_exception so a first failure doesn't hang ~8s on probes.
    """
    try:
        import time as _t
        if (_t.monotonic() - _cache["at"]) < CACHE_TTL_S:
            return bool(_cache["internet"])
    except Exception:
        pass
    return None


def _msg_contains(msg: str, *needles: str) -> bool:
    m = (msg or "").lower()
    return any((n or "").lower() in m for n in needles)


def classify_exception(exc: BaseException) -> Tuple[str, str, bool]:
    """Map any exception to (error_code, user_message, retryable).

    Never raises. Covers: offline/DNS/timeout, bad key, rate limit,
    unreachable provider, plus generic fallback.
    """
    name = type(exc).__name__
    mod = type(exc).__module__ or ""
    msg = str(exc) or name
    low = msg.lower()

    # Explicit offline / DNS / connection failures (requests, urllib,
    # socket, openai.APIConnectionError, httpx.ConnectError, yt-dlp, …).
    offline_markers = (
        "apiConnectionError", "connection error", "connection failed",
        "network error", "network is unreachable", "name resolution",
        "nodename nor servname", "getaddrinfo failed", "temporary failure",
        "no internet", "internet-disconnected", "err_internet_disconnected",
        "err_network", "fetch failed", "failed to fetch", "max retries exceeded",
        "newconnectionerror", "connecterror", "connection aborted",
        "connection reset", "broken pipe", "network unreachable",
    )
    dns_markers = ("nameresolutionerror", "name resolution", "getaddrinfo",
                   "nodename nor servname", "temporary failure in name resolution")
    timeout_markers = ("timeout", "timed out", "deadline exceeded",
                       "readtimeout", "connecttimeout")

    if name in ("APIConnectionError", "ConnectError") or _msg_contains(low, *offline_markers):
        if _msg_contains(low, *dns_markers):
            return ("DNS_FAILURE",
                    "No internet connection (DNS lookup failed). "
                    "Check your connection, then resume — progress is saved.", True)
        return ("NETWORK_OFFLINE", OFFLINE_MESSAGE, True)

    if name in ("APITimeoutError", "Timeout", "TimeoutError", "ReadTimeout",
                "ConnectTimeout") or _msg_contains(low, *timeout_markers):
        # Non-blocking: only claim offline when the cache already proves it.
        # A stale cache means "unknown" -> treat as provider slowness (still
        # retryable) so the handler never blocks ~8s on fresh probes.
        if cached_online() is False:
            return ("NETWORK_OFFLINE", OFFLINE_MESSAGE, True)
        return ("TIMEOUT",
                "Request timed out. Completed stages are saved — retry the stage.", True)

    # Auth problems must NOT look like offline (different fix: Settings key).
    if name in ("AuthenticationError",) or _msg_contains(low, "invalid api key",
            "incorrect api key", "unauthorized", "401", "invalid_api_key"):
        return ("AUTH_INVALID_KEY",
                "LLM provider rejected the API key. Check Settings → AI provider, "
                "then retry.", False)

    if name in ("RateLimitError",) or _msg_contains(low, "rate limit", "429", "too many requests"):
        return ("RATE_LIMITED",
                "LLM rate limit hit. Wait a bit and retry — nothing is lost.", True)

    if name in ("NotFoundError", "APIStatusError", "InternalServerError",
                "APITransportError") or _msg_contains(low, "500 ", "502", "503", "504",
                "base_url", "connection refused"):
        if cached_online() is False:
            return ("NETWORK_OFFLINE", OFFLINE_MESSAGE, True)
        return ("PROVIDER_UNREACHABLE",
                f"AI/media provider unreachable ({name}). "
                "Check Settings → AI provider, then retry.", True)

    # Socket-level leftovers.
    if isinstance(exc, (socket.gaierror, socket.timeout, ConnectionError, TimeoutError)):
        return ("NETWORK_OFFLINE", OFFLINE_MESSAGE, True)

    return ("UNKNOWN", msg[:300] if msg else name, False)


def steps_need_internet(steps: list) -> list:
    """Subset of requested pipeline steps that require internet."""
    return [s for s in (steps or []) if s in NETWORK_STEPS]
