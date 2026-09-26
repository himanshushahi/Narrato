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
_mcp_inventory_cache: dict | None = None


def _run_coro(coro, timeout: float = 10.0):
    """Run one coroutine from sync code: a single event loop, a single
    timeout (UI thread safe). Previously each list_*() call paid its own
    asyncio.run() + 5s timeout — up to ~20s on the first poll."""
    import asyncio
    import concurrent.futures

    async def _wait():
        return await asyncio.wait_for(coro, timeout=timeout)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(lambda: asyncio.run(_wait())).result(
                timeout=timeout + 2)
    return asyncio.run(_wait())


async def _collect_inventory(server) -> dict:
    """List tools/resources/templates/prompts on ONE loop (single timeout,
    no per-call overhead). Individual list failures degrade to []."""
    import asyncio
    calls = {
        "tools": server.list_tools(),
        "resources": server.list_resources(),
        "resource_templates": server.list_resource_templates(),
        "prompts": server.list_prompts(),
    }
    results = await asyncio.gather(*calls.values(), return_exceptions=True)
    out = {}
    for key, res in zip(calls, results):
        out[key] = [] if isinstance(res, Exception) else (res or [])
    return out


def get_mcp_inventory() -> dict:
    """Full MCP inventory: tools + resources + resource_templates + prompts.

    Static per process, so cached — and intentionally NOT gated on the HTTP
    URL being up (the registry exists as soon as the module imports).
    Agents calling resources/list AND resources/templates/list is correct
    discovery per the MCP spec — 0 templates is a valid, expected result
    for this server (reads are tools by design: skill-gate side effects +
    structured args don't map to URI templates). Never raises."""
    global _mcp_inventory_cache
    if _mcp_inventory_cache:
        return _mcp_inventory_cache
    empty = {"tools": [], "resources": [], "resource_templates": [],
             "prompts": []}
    try:
        from backend.mcp.server import mcp as _mcp_server
        raw = _run_coro(_collect_inventory(_mcp_server))
        tools = raw.get("tools", [])
        resources = raw.get("resources", [])
        templates = raw.get("resource_templates", [])
        prompts = raw.get("prompts", [])
        _mcp_inventory_cache = {
            "tools": sorted(t.name for t in tools),
            "resources": sorted(
                str(getattr(r, "uri", None) or getattr(r, "name", str(r)))
                for r in resources),
            "resource_templates": sorted(
                str(getattr(t, "uriTemplate", None) or getattr(t, "name", str(t)))
                for t in templates),
            "prompts": sorted(p.name for p in prompts),
        }
        return _mcp_inventory_cache
    except Exception as e:
        logger.warning(f"MCP inventory enumeration failed: {e}")
        return empty


def get_tool_names() -> list:
    """Registered MCP tool names, cached after first enumeration (the set
    is static per process; re-listing per UI refresh is pure overhead)."""
    global _tool_names_cache
    if _tool_names_cache:
        return _tool_names_cache
    _tool_names_cache = get_mcp_inventory()["tools"]
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
    _thread_error: list = []
    for attempt in (1, 2):
        try:
            # Second attempt must not re-pick the same preferred port that
            # just failed — force a free loopback port instead.
            if attempt == 1:
                chosen = resolve_mcp_port(port)
            else:
                chosen = _free_port()
            url = f"http://{MCP_HOST}:{chosen}/mcp"

            def _run_mcp(_server=_mcp_server, _chosen=chosen):
                try:
                    # Frozen windowed builds (console=False) replace
                    # sys.stdout/stderr with NullWriter lacking isatty() —
                    # uvicorn's ColourizedFormatter calls sys.stdout.isatty()
                    # at Config time and crashes the thread before bind.
                    import sys as _sys
                    for _name in ("stdout", "stderr"):
                        _s = getattr(_sys, _name, None)
                        if _s is None:
                            class _NullStream:
                                def write(self, *a, **k):
                                    pass
                                def flush(self):
                                    pass
                                def isatty(self):
                                    return False
                            setattr(_sys, _name, _NullStream())
                        elif not hasattr(_s, "isatty"):
                            try:
                                _s.isatty = lambda: False  # type: ignore
                            except Exception:
                                pass
                    _server.run(transport="streamable-http", host=MCP_HOST, port=_chosen)
                except Exception:
                    logger.exception(f"MCP server thread crashed on port {_chosen}.")
                    _thread_error.append(True)

            thread = threading.Thread(
                target=_run_mcp,
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
                           f"{'retrying once with free port' if attempt == 1 else 'giving up'}. "
                           f"thread_alive={thread.is_alive()} crashed={bool(_thread_error)}.")
        except Exception as e:
            logger.warning(f"MCP HTTP server failed to start: {e}")
    return _mcp_thread, None
