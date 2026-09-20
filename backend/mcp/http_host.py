"""In-app host for the Narrato MCP HTTP endpoint.

Started automatically from ``backend.core.app.main`` (dev and production)
so agents can connect with only a localhost URL — no manual command.

Honors:
- ``NARRATO_MCP_DISABLE=1`` — skip starting (opt-out).
- ``NARRATO_MCP_PORT=<n>`` — preferred port (default 8765). When the
  preferred port is busy, a free loopback port is picked instead and the
  effective URL is logged + available via :func:`get_mcp_url`.

The socket is always bound to 127.0.0.1: these tools execute
ffmpeg/TTS and read project files, so the endpoint must never listen
on a network interface.
"""

import os
import socket
import threading

from backend.core.logger import logger

DEFAULT_MCP_PORT = 8765
MCP_HOST = "127.0.0.1"

_mcp_url = None
_mcp_thread = None
_tool_names_cache: list | None = None


def get_tool_names() -> list:
    """Registered MCP tool names, cached after first enumeration (the set
    is static per process; re-listing per UI refresh is pure overhead)."""
    global _tool_names_cache
    if _tool_names_cache is not None:
        return _tool_names_cache
    try:
        import asyncio
        from backend.mcp.server import mcp as _mcp_server
        _tool_names_cache = sorted(t.name for t in asyncio.run(_mcp_server.list_tools()))
    except Exception as e:
        logger.warning(f"MCP tool enumeration failed: {e}")
        _tool_names_cache = []
    return _tool_names_cache


def _wait_reachable(port: int, timeout_s: float = 8.0) -> bool:
    """Readiness probe: the URL is only published once the endpoint serves
    HTTP, so a copied URL never fails for the first seconds. Any HTTP
    response bytes (even 404/405 for a bare GET) prove the server — not
    some other socket squatter — owns the port."""
    import time
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.settimeout(0.5)
            probe.connect((MCP_HOST, port))
            probe.sendall(b"GET /mcp HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            return probe.recv(12).startswith(b"HTTP/")
        except OSError:
            time.sleep(0.25)
        finally:
            probe.close()
    return False


def _port_available(port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((MCP_HOST, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def _free_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((MCP_HOST, 0))
        return probe.getsockname()[1]
    finally:
        probe.close()


def resolve_mcp_port(preferred: int | None = None) -> int:
    """Pick the port the MCP endpoint will listen on.

    Precedence: explicit arg > NARRATO_MCP_PORT env > 8765. Falls back
    to a free loopback port when the preferred one is occupied.
    """
    if preferred is None:
        try:
            preferred = int(os.environ.get("NARRATO_MCP_PORT", "") or DEFAULT_MCP_PORT)
        except ValueError:
            preferred = DEFAULT_MCP_PORT
    if _port_available(preferred):
        return preferred
    fallback = _free_port()
    logger.warning(f"MCP port {preferred} busy — using {fallback} instead.")
    return fallback


def get_mcp_url() -> str | None:
    """Effective MCP URL once started (None until then)."""
    return _mcp_url


def start_mcp_http_server(port: int | None = None):
    """Boot the Streamable-HTTP MCP endpoint in a daemon thread.

    Returns (thread, url), or (None, None) when disabled/failed. Never
    raises — a failed MCP host must not take down the desktop app.
    """
    global _mcp_url, _mcp_thread
    if os.environ.get("NARRATO_MCP_DISABLE") == "1":
        logger.info("MCP HTTP server disabled via NARRATO_MCP_DISABLE=1.")
        return None, None
    if _mcp_thread is not None and _mcp_thread.is_alive():
        logger.info(f"MCP HTTP server already running at {_mcp_url}.")
        return _mcp_thread, _mcp_url
    try:
        # Lazy import: MCP deps must never break app startup.
        from backend.mcp.server import mcp as _mcp_server
    except Exception as e:
        logger.warning(f"MCP HTTP server not started (import failed): {e}")
        return None, None
    # Port pick → thread bind is check-then-act: a stolen port surfaces as
    # "reachable check failed" (uvicorn dies, nothing serves). Retry once
    # with a freshly resolved port before giving up.
    for attempt in (1, 2):
        try:
            chosen = resolve_mcp_port(port if attempt == 1 else None)
            url = f"http://{MCP_HOST}:{chosen}/mcp"
            thread = threading.Thread(
                target=_mcp_server.run,
                kwargs={"transport": "streamable-http", "host": MCP_HOST, "port": chosen},
                name="narrato-mcp-http",
                daemon=True,
            )
            thread.start()
            _mcp_thread = thread
            if _wait_reachable(chosen):
                _mcp_url = url
                logger.info(f"Narrato MCP server listening on {url} — point your agent at this URL.")
                return thread, url
            logger.warning(f"MCP HTTP server thread started but {url} not reachable; "
                           f"{'retrying once' if attempt == 1 else 'giving up'}.")
        except Exception as e:
            logger.warning(f"MCP HTTP server failed to start: {e}")
    return _mcp_thread, None
