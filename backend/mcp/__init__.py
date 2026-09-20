"""Narrato MCP server: LLM-free pipeline tools for external agents.

The server exposes the deterministic "hands" of the video pipeline
(projects, scripts, designs, mechanical stages, visuals persistence,
status) over the Model Context Protocol. All creative/LLM work — script
prose, design systems, sub-visual ASTs — is authored by the connected
agent; this process never calls an LLM and never needs an API key.

Entrypoint: ``python -m backend.mcp.server`` (stdio transport) or
``python -m backend.mcp.server --http`` (localhost Streamable HTTP at
``http://127.0.0.1:8765/mcp``).
"""

from backend.mcp.server import main

__all__ = ["main"]
