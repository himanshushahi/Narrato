# Backend AI Agent & Custom Tools Architecture Guide

This document covers the **Backend AI Agent Execution Engine**, **Tool Calling Framework**, **Self-Correction Loops**, and the step-by-step developer guide for adding **Custom AI Tools** in Remotion Canvas.

---

## 1. Agent Architecture & Execution Loop

The AI Agent in Remotion Canvas operates in two distinct modes:
1. **Pipeline Mode (Autonomous Generation)**: Multi-worker background generation for bulk scenes, outlines, and AST visual trees.
2. **Interactive Bridge Mode (Editor Assistant)**: Targeted rewriting, property tweaking, and intelligent scene mutations triggered from the UI.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             USER / PIPELINE INVOCATION                      │
│                                                                             │
│  Pipeline (ai.py) or Editor Chat (bridge.py) calls AgentRunner.run_with_tools │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AGENT EXECUTION ENGINE (agent_engine.py)                 │
│                                                                             │
│  Turn Loop (Up to MAX_AGENT_TURNS / PIPELINE_VISUAL_TURNS):                 │
│  1. Injects tool schemas into system prompt                                 │
│  2. Calls LLM with message history                                          │
│  3. Parses tool calls from output (```tool {"name": "...", "args": {...}}```)│
│  4. Executes tool via execute_tool()                                        │
│  5. Appends tool result to history and loops                                │
│                                                                             │
│  Final Turn:                                                                │
│  Enforces strict JSON schema validation for output structure                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VALIDATION & SELF-CORRECTION (validators.py)             │
│                                                                             │
│  validate_sub_visuals()                                                     │
│  - Verifies timing math: sum(sub_visual.duration) == scene.duration         │
│  - Auto-normalizes rounding differences deterministically                   │
│  - If structurally broken: triggers 1-turn automated correction loop        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tool Architecture & Allowlist Security

Tools are strictly controlled via **Scope-Based Allowlists** in [**`backend/agent/agent_engine.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/agent_engine.py). This prevents bulk pipeline generation runs from performing recursive project mutations or infinite loops.

### Tool Category Matrix

| Category | Tools | Allowed In | Purpose |
|---|---|---|---|
| **Research & Context** | `web_search`, `get_skill`, `read_project_file`, `list_project_files`, `project_status_report` | Pipeline & Bridge | Live web browsing, reading skill instructions, inspecting project structure and status. |
| **Asset Verification** | `search_pexels_photo`, `search_pexels_video`, `search_wikipedia_image`, `search_pixabay_photo`, `search_pixabay_video`, `search_youtube_video` | Pipeline Visuals & Bridge Visuals | Validates that stock media, entity portraits, or YouTube clips exist before creating visual AST cuts. |
| **~~Project Mutation~~ (removed)** | ~~`edit_sub_visual_property`, `regenerate_scene_visuals`, `rewrite_script_section`, `update_visual_settings`, `insert_scene`, `delete_scene`, `invalidate_scene_cache`~~ | — | **Deleted during dead-code cleanup:** no allowlist ever included mutation tools and the GUI never called them (scene operations live directly in `backend/core/bridge.py` as `ApiBridge` methods). The registry is now fully read-only (11 tools). See `docs/llm_calls_complete_guide.md` §7–§8. |

### Scope Allowlists (`agent_engine.py`)

```python
# Bulk Visual Pipeline (Read-only research + asset verification, NO project mutation)
PIPELINE_VISUAL_TOOLS = frozenset({
    "web_search", "get_skill",
    "read_project_file", "list_project_files", "project_status_report",
    "search_pexels_photo", "search_pexels_video",
    "search_wikipedia_image",
    "search_pixabay_photo", "search_pixabay_video",
    "search_youtube_video",
})

# Bulk Script Pipeline (Research only)
SCRIPT_NARRATION_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})
```

---

## 3. Automated Self-Correction Loop

Visual timing math must be exact: the sum of all sub-visual durations must equal the scene's narration duration to 2 decimal places.

In [**`backend/agent/agent_engine.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/agent_engine.py) (`validate_and_correct_visuals`):
1. **Deterministic Repair**: If the duration discrepancy is due to rounding (e.g. 0.05s off), `validate_sub_visuals()` in [`validators.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/validators.py) automatically scales and fixes the last element without wasting LLM tokens.
2. **Correction Turn**: If the output is structurally invalid (missing required fields or non-list), a 1-turn targeted correction prompt is sent to the LLM to fix the structure before falling back to defaults.

---

## 4. How to Add a New Custom Tool (Step-by-Step)

Here is the exact guide for adding custom tools to empower the AI Agent. We will use the two planned features from [`docs/future_feature.md`](file:///D:/Real-Life-Projects/remotion_canvas/docs/future_feature.md):
1. **`search_lucide_icons`**: Finding SVG icon names for glassmorphic cards and mockups.
2. **`search_sfx_audio`**: Searching sound effect names to synchronize with animations.

---

### Step 1: Implement the Tool Function in `backend/agent/tools.py`

Add the implementation function in [**`backend/agent/tools.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/tools.py):

```python
# Standard Lucide icon directory for motion graphics
LUCIDE_ICONS = {
    "finance": ["trending-up", "trending-down", "dollar-sign", "credit-card", "wallet", "bar-chart-3"],
    "security": ["shield-alert", "shield-check", "lock", "key", "fingerprint", "alert-triangle"],
    "technology": ["server", "cpu", "database", "terminal", "network", "code", "cloud"],
    "documentary": ["file-text", "newspaper", "archive", "landmark", "scale", "search"],
}

def search_lucide_icons(query: str, category: str = None) -> list[str]:
    """Finds matching Lucide icon names for UI cards, mockups, and AST shapes."""
    query = (query or "").lower().strip()
    results = []
    
    for cat, icons in LUCIDE_ICONS.items():
        if category and category.lower() != cat:
            continue
        for icon in icons:
            if query in icon or query in cat:
                results.append(icon)
                
    # Fallback to popular icons if no exact match
    if not results:
        results = ["sparkles", "arrow-right", "info", "help-circle"]
        
    return results[:8]
```

---

### Step 2: Define the Tool Schema in `get_tools_schema()`

In [**`backend/agent/tools.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/tools.py), add the JSON schema inside `get_tools_schema()`:

```python
{
    "type": "function",
    "function": {
        "name": "search_lucide_icons",
        "description": "Searches for valid Lucide SVG icon names (e.g. 'trending-up', 'shield-alert', 'dollar-sign') to use inside glassmorphic cards, mockups, and vector Shape layers.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keyword (e.g. 'growth', 'fraud', 'bank', 'database')"
                },
                "category": {
                    "type": "string",
                    "enum": ["finance", "security", "technology", "documentary"],
                    "description": "Optional category filter"
                }
            },
            "required": ["query"]
        }
    }
}
```

---

### Step 3: Register in `execute_tool()` Dispatcher

In [**`backend/agent/tools.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/tools.py):

```python
if tool_name == "search_lucide_icons":
    query = arguments.get("query", "")
    category = arguments.get("category")
    icons = search_lucide_icons(query, category)
    return f"Matching Lucide icons: {json.dumps(icons)}"
```

---

### Step 4: Add to Agent Allowlists in `agent_engine.py`

In [**`backend/agent/agent_engine.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/agent_engine.py):

```python
PIPELINE_VISUAL_TOOLS = frozenset({
    # ... existing tools ...
    "search_lucide_icons",  # <-- Added
})

BRIDGE_VISUAL_TOOLS = frozenset({
    # ... existing tools ...
    "search_lucide_icons",  # <-- Added
})
```

---

### Step 5: Expose Tool in AI Skills

Update [**`backend/skills/declarative-ast/SKILL.md`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/declarative-ast/SKILL.md) and [**`backend/skills/motion-graphics-designer/SKILL.md`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/motion-graphics-designer/SKILL.md):
- Instruct the AI that it can call `search_lucide_icons` when designing Mockup badges or Shape icon callouts.

---

## 5. Skill Loader & Dynamic Prompt Templating

Skills in `backend/skills/` are managed by [**`backend/agent/skill_loader.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/skill_loader.py):
- **Frontmatter Parsing**: Extracts YAML metadata (`name`, `version`, `when_to_use`).
- **Template Parameter Substitution**: Skills support variable injection (e.g. `{video_format}`, `{language}`, `{target_duration}`).

Example rendering a skill dynamically:
```python
from backend.agent.skill_loader import skill_loader

prompt = skill_loader.render_skill(
    "art-director-design-system",
    video_format="landscape",
    language="hi"
)
```

---

## 6. Developer Checklist for New Tools

When creating a new agent tool:
- [ ] Tool implementation function written in `backend/agent/tools.py`
- [ ] Schema added to `get_tools_schema()` in `backend/agent/tools.py`
- [ ] Tool dispatcher registered in `execute_tool()` in `backend/agent/tools.py`
- [ ] Added to appropriate allowlists (`PIPELINE_VISUAL_TOOLS`, `BRIDGE_VISUAL_TOOLS`, etc.) in `backend/agent/agent_engine.py`
- [ ] Mentioned in relevant skill prompt markdown files in `backend/skills/`
- [ ] Tested via interactive rewrite or pipeline run with tool telemetry verified in logs
