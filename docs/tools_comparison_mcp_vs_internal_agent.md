# Narrato Tools Comparison: MCP Server vs. Internal LLM Agent

This document provides a comprehensive comparison, sorting, and reference of all tools available in **Narrato**. It compares the tools exposed by the **External MCP (Model Context Protocol) Server** against the tools provided to the **Internal LLM Agent** (the conversational assistant within the Narrato desktop UI).

---

## 1. Executive Summary & Architectural Context

Narrato operates two distinct tool interfaces for AI agents:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NARRATO ECOSYSTEM                                     │
├─────────────────────────────────────────────┬───────────────────────────────────────────┤
│         1. EXTERNAL MCP SERVER              │         2. INTERNAL LLM AGENT             │
│   (backend/mcp/server.py — 31 Tools)        │    (backend/agent/tools.py — 14 Tools)    │
├─────────────────────────────────────────────┼───────────────────────────────────────────┤
│ • Consumed by: External IDE/CLI Agents      │ • Consumed by: Built-in UI Chat Drawer    │
│   (Antigravity, Claude Code, Cursor, Roo)   │   (OpenAI, Gemini, Anthropic, Ollama)     │
│ • Role: Full hands-on pipeline automation   │ • Role: Interactive assistant & ideation  │
│   (project creation, voiceover, transcribe, │   (script refinement, asset verification, │
│    AST authoring, headless review, render)  │    cut inspection, and project diagnosis) │
│ • Transport: stdio / loopback HTTP (8765)   │ • Execution: In-process Python dispatcher │
│ • Execution: LLM-free validation & engine   │ • UI Bridge: Bridge chat & pipeline loop  │
└─────────────────────────────────────────────┴───────────────────────────────────────────┘
```

### Tool Counts Summary

| Category | Count | Description |
|---|:---:|---|
| **MCP Tools Total** | **31** | Full programmatic control over Narrato's video creation engine. |
| **Internal LLM Agent Tools Total** | **17** | Interactive assistant and generation tools for research, probing, iconography, pre-flight linting, and asset checks. |
| **Shared / Both Have** | **12** | Tools present in both systems (direct matches or functional equivalents). |
| **Only MCP Has** | **19** | Pipeline runners, project CRUD, AST authoring, frame review, settings. |
| **Only Internal Agent Has** | **7** | Dedicated provider-specific search functions, in-memory icon search, and pre-flight visual linter. |

---

## 2. Quick Categorization & Sorting

### Group A: Tools Available in Both (Shared & Functional Equivalents)
1. **`web_search`** *(Exact match)* — Live web search for statistics, facts, and research.
2. **`get_skill`** *(Exact match)* — Specialized skill instructions for scriptwriting, ASTs, and motion design.
3. **`read_project_file`** *(Exact match)* — Reads artifacts (`script.json`, `design.json`, manifests) safely.
4. **`list_project_files`** *(Exact match)* — Lists files inside project storage directories.
5. **`probe_cut`** *(Exact match)* — Detailed inspection of a single cut (geometry, timing, assets).
6. **`probe_scene`** *(Exact match)* — Inspection of a section (cut summaries, variety, durations).
7. **`probe_asset`** *(Exact match)* — Verification of downloaded media files for a specific cut layer.
8. **`get_word_timings`** *(Functional equivalent to MCP `get_transcription`)* — Looks up exact spoken word timestamps from `transcription.json`.
9. **Project Status Overview** *(Functional equivalent)*:
   - MCP: `project_status` (DB row, pipeline task states, language, format).
   - Internal Agent: `project_status_report` (Deep summary: script structure, scene count, design system, visual settings).
10. **Media Verification** *(Functional equivalent)*:
   - MCP: `search_media` (Unified gateway with `source` parameter).
   - Internal Agent: 6 dedicated tools (`search_pexels_photo`, `search_pexels_video`, `search_wikipedia_image`, `search_pixabay_photo`, `search_pixabay_video`, `search_youtube_video`).
11. **Iconography Tools (Internal Agent)**:
   - `search_icons` — Fast in-memory semantic search for valid Lucide icons.

---

### Group B: Tools ONLY in MCP (22 Tools)
These tools exist exclusively in MCP because external agents drive Narrato headlessly and require programmatic access to pipeline stages, database state, and AST visual authoring.

#### 1. Pipeline Execution & Stage Management (3 tools)
- **`run_stage`** — Executes pipeline stages (`generate_voiceover`, `transcribe`, `fetch_assets`, `render`).
- **`stage_status`** — Polls progress and logs for asynchronous background stages.
- **`cancel_stage`** — Stops a running pipeline stage gracefully.

#### 2. Project Lifecycle & Management (3 tools)
- **`create_project`** — Creates a new video project in SQLite and sets up the storage directory.
- **`list_projects`** — Lists all projects with their status, language, and timestamps.
- **`delete_project`** — Permanently deletes a project, its database rows, tasks, and storage folder.

#### 3. Core Creative Persistence (3 tools)
- **`save_script`** — Validates schema, checks scene pacing budgets, persists `script.json`.
- **`get_script`** — Reads `script.json` (with or without visual ASTs).
- **`save_design`** — Validates and saves the global design system (colors, typography, CSS theme).

#### 4. Visual AST Authoring & Mutation (5 tools)
- **`save_visuals`** — Validates, normalizes durations, auto-repairs legacy syntax, and persists AST for a section/cut.
- **`save_visuals_batch`** — High-efficiency batch authoring for multiple sections in 1 call with video variety checks.
- **`get_visuals`** — Reads back sub-visuals for a section or cut without loading the whole script.
- **`clear_visuals`** — Deletes all visual ASTs across all sections.
- **`clear_assets`** — Purges downloaded media assets to force clean re-fetching.

#### 5. Multimodal Frame Review (1 tool)
- **`review_frame`** — Generates a contact-sheet JPEG snapshot (cut motion or section progression) for visual QA.

#### 6. Audio Timing & Transcription (2 tools)
- **`get_section_timings`** — Per-section voiceover narration durations and word-level timestamps.
- **`get_transcription`** — Word-level transcription data with pagination and section filters.

#### 7. Project Settings & Voices (3 tools)
- **`list_voice_options`** — Discovers available TTS engines, Edge voices, and voice clone profiles.
- **`update_voice_settings`** — Configures TTS engine, voice, speed, pitch, and background music.
- **`update_transcribe_settings`** — Configures Whisper model and compute device.

#### 8. Skill Discovery & Bundling (2 tools)
- **`list_skills`** — Lists all available writing and director skills.
- **`get_stage_skills`** — One-shot starter pack of required skills tailored for a specific pipeline stage.

---

### Group C: Tools ONLY in Internal LLM Agent (5 Tools)
The internal agent exposes individual, dedicated tools for stock asset verification rather than a single unified function:

1. **`search_pexels_photo`** — Dedicated Pexels photo search (`query`, `orientation`).
2. **`search_pexels_video`** — Dedicated Pexels video search (`query`, `orientation`).
3. **`search_wikipedia_image`** — Dedicated Wikipedia entity/person portrait search (`query`).
4. **`search_pixabay_photo`** — Dedicated Pixabay photo search with `image_type` filtering (`photo`, `illustration`, `vector`).
5. **`search_pixabay_video`** — Dedicated Pixabay stock video search (`query`).
6. **`search_youtube_video`** — Dedicated YouTube video existence check via `yt-dlp` (`query`).

*(Note: In MCP, all 6 providers are accessed via `search_media(source="...", query="...", orientation="...")`).*

---

## 3. Detailed Side-by-Side Comparison Matrix

| Tool Name | MCP Server | Internal Agent | Arguments Comparison | Functional Purpose |
|---|:---:|:---:|---|---|
| `web_search` | ✅ | ✅ | **MCP**: `query`, `count=3`<br>**Agent**: `query`, `count=3` | Live web research for facts, statistics, and citations via LangSearch API. |
| `get_skill` | ✅ | ✅ | **MCP**: `skill_name`, `language`, `video_format`, `section`, `brief`, `project_id`<br>**Agent**: `name` | Loads specialized skill guides (e.g., `declarative-ast`, `scriptwriter`). MCP supports pagination and brief section maps. |
| `read_project_file` | ✅ | ✅ | **MCP**: `project_id`, `path`, `offset=0`<br>**Agent**: `project_id`, `filename` | Reads project storage artifacts safely with path traversal protection. |
| `list_project_files` | ✅ | ✅ | **MCP**: `project_id`<br>**Agent**: `project_id` | Lists all files and sizes in the project folder. |
| `probe_cut` | ✅ | ✅ | **MCP**: `project_id`, `section_type`, `scene_index`, `cut_index`<br>**Agent**: Same | Inspects 1 cut: JSON structure, geometry, timings, and downloaded asset verification. |
| `probe_scene` | ✅ | ✅ | **MCP**: `project_id`, `section_type`, `scene_index`<br>**Agent**: Same | Inspects 1 section: cut summaries, geometry rollups, energy, and visual variety. |
| `probe_asset` | ✅ | ✅ | **MCP**: `project_id`, `section_type`, `scene_index`, `cut_index`, `layer_index`<br>**Agent**: Same | Inspects 1 layer's media file: existence, disk path, dimensions, format, duration. |
| `project_status` / `project_status_report` | ✅ (`project_status`) | ✅ (`project_status_report`) | **MCP**: `project_id`<br>**Agent**: `project_id` | MCP returns DB row and task states; Internal Agent returns a formatted text overview of script, design, visual settings, and assets. |
| Media Search (`search_media` vs Dedicated) | ✅ (`search_media`) | ✅ (6 dedicated tools) | **MCP**: `source`, `query`, `orientation`<br>**Agent**: Separate tools per source | Verifies stock assets exist before assigning queries to visual AST layers. |
| `run_stage` | ✅ | ❌ | **MCP**: `project_id`, `stage`, `wait=True`, `confirm_render=False` | Triggers voiceover, transcription, asset downloading, or rendering. Internal Agent delegates this to the UI queue. |
| `stage_status` | ✅ | ❌ | **MCP**: `project_id`, `stage` | Polls progress and status of background pipeline tasks. |
| `cancel_stage` | ✅ | ❌ | **MCP**: `project_id`, `stage` | Gracefully terminates a running pipeline task. |
| `create_project` | ✅ | ❌ | **MCP**: `name`, `language`, `video_format`, `duration_mode`, `export_folder`, `style`, `style_hint` | Creates a new project. Desktop users use the UI modal. |
| `list_projects` | ✅ | ❌ | **MCP**: None | Lists all projects in the database. |
| `delete_project` | ✅ | ❌ | **MCP**: `project_id` | Deletes a project and its folder from disk. |
| `save_script` | ✅ | ❌ | **MCP**: `project_id`, `script`, `force=False` | Validates and persists `script.json` with scene pacing budget enforcement. |
| `get_script` | ✅ | ❌ | **MCP**: `project_id`, `include_visuals=False` | Reads `script.json`, stripping visual ASTs by default to preserve context. |
| `save_design` | ✅ | ❌ | **MCP**: `project_id`, `design` | Validates and persists design system (colors, typography, CSS guidelines). |
| `save_visuals` | ✅ | ❌ | **MCP**: `project_id`, `section_type`, `sub_visuals`, `scene_index`, `cut_index`, `dry_run`, `auto_migrate` | Persists visual AST for a section/cut with geometry and timing validation. |
| `save_visuals_batch` | ✅ | ❌ | **MCP**: `project_id`, `sections`, `dry_run=False` | Batch validates/persists ASTs for multiple sections with whole-video variety checks. |
| `get_visuals` | ✅ | ❌ | **MCP**: `project_id`, `section_type`, `scene_index`, `cut_index=-1` | Reads visual AST for a single cut or section. |
| `clear_visuals` | ✅ | ❌ | **MCP**: `project_id`, `clear_assets=True` | Clears all visual ASTs across all sections. |
| `clear_assets` | ✅ | ❌ | **MCP**: `project_id` | Deletes all downloaded media files to trigger re-downloading. |
| `review_frame` | ✅ | ❌ | **MCP**: `project_id`, `section_type`, `scene_index`, `cut_index`, `scope`, `mode`, `max_cells` | Returns headless Remotion preview contact sheets as single JPEG images for visual QA. |
| `get_section_timings` | ✅ | ❌ | **MCP**: `project_id`, `include_words=True` | Returns true section narration durations and word timestamps after TTS. |
| `get_transcription` | ✅ | ❌ | **MCP**: `project_id`, `section_type`, `scene_index`, `segment_id`, `offset`, `limit` | Returns word-level timestamps and subtitle segmentation data. |
| `list_voice_options` | ✅ | ❌ | **MCP**: None | Returns available TTS engines, Edge Neural voices, and cloned profiles. |
| `update_voice_settings` | ✅ | ❌ | **MCP**: `project_id`, `settings` | Configures TTS voice, speed, pitch, and background music volume. |
| `update_transcribe_settings` | ✅ | ❌ | **MCP**: `project_id`, `settings` | Configures Whisper model name and compute device. |
| `list_skills` | ✅ | ❌ | **MCP**: None | Lists available writing and visual guide skills. |
| `get_stage_skills` | ✅ | ❌ | **MCP**: `stage`, `project_id`, `language`, `video_format` | One-shot bundled starter pack of skills for a given stage. |
| `search_pexels_photo` | ❌ (in `search_media`) | ✅ | **Agent**: `query`, `orientation` | Searches Pexels stock photos. |
| `search_pexels_video` | ❌ (in `search_media`) | ✅ | **Agent**: `query`, `orientation` | Searches Pexels stock video clips. |
| `search_wikipedia_image` | ❌ (in `search_media`) | ✅ | **Agent**: `query` | Searches Wikipedia for primary entity/portrait images. |
| `search_pixabay_photo` | ❌ (in `search_media`) | ✅ | **Agent**: `query`, `orientation`, `image_type` | Searches Pixabay photos/vectors with transparent cutout support. |
| `search_pixabay_video` | ❌ (in `search_media`) | ✅ | **Agent**: `query` | Searches Pixabay stock video footage. |
| `search_youtube_video` | ❌ (in `search_media`) | ✅ | **Agent**: `query` | Checks YouTube video downloadability via yt-dlp. |
| `search_icons` | ❌ (internal) | ✅ | **Agent**: `query`, `limit=5` | Semantic in-memory search for valid Lucide icon names and categories. Read-only. |
| `get_word_timings` | ❌ (in `get_transcription`) | ✅ | **Agent**: `project_id`, `query` | Searches spoken word timestamps in `transcription.json` for precise kinetic sync. Read-only. |

---

## 4. Deep Dive: Why the Division Exists

### Why Doesn't the Internal LLM Agent Have Pipeline & Stage Tools?
1. **Human-in-the-Loop GUI**: In the Narrato desktop application, users initiate pipeline stages (Voiceover, Transcription, Asset Fetching, Rendering) by clicking intuitive buttons on the interface.
2. **Preventing Agent Runaway**: Giving the internal chat LLM autonomous execution power to run ffmpeg or invoke GPU rendering could trigger accidental multi-minute blocking processes.
3. **Focused Specialization**: The internal agent is designed for surgical editing: answering questions about the project, checking whether stock assets exist, and probing cuts.

### Why Does MCP Have the Full Suite of Tools?
1. **Headless Automation**: External coding assistants (like Antigravity, Claude, or Cursor) operate outside the desktop GUI. They need to run the entire video production lifecycle from scratch without touching a mouse.
2. **Deterministic Gates**: MCP tools enforce strict validation gates (e.g., human review gate before `render_video`, pacing checks before `save_script`, and dry-run linting before `save_visuals`).
3. **Multimodal Feedback**: With `review_frame`, MCP agents receive real rendered image strips to evaluate visual aesthetics, text legibility, and animation flow directly in chat.

### Internal Agent Tool Scoping: Pipeline vs. Bridge Rewrites
The internal LLM agent operates under two distinct contexts with different allowlists:

1. **Automated Bulk Pipeline Generation (`PIPELINE_VISUAL_TOOLS`)**:
   - During `generate_visuals_pipeline`, all scenes are planned and generated concurrently in worker threads.
   - The final `manifest.json` is written to disk in a single batch **after all scenes complete**.
   - Assets are fetched in a subsequent stage (`fetch_assets`), and frames are rendered in `render`.
   - **Post-generation inspection tools are strictly excluded** (`probe_cut`, `probe_scene`, `probe_asset`, `review_frame`). If called mid-generation, they would return empty cuts, index errors, or report missing asset files.
   - Allowed tools are strictly in-memory and pre-flight: `search_icons`, media verification (`search_pexels_*`, `search_pixabay_*`, `search_wikipedia_image`, `search_youtube_video`), `get_skill`, and `web_search`.

2. **Interactive Bridge Rewrites / Editing (`BRIDGE_VISUAL_TOOLS`)**:
   - Used when a user interactively requests scene or cut updates in the editor (e.g., "rewrite cut 2", "make scene 1 more energetic").
   - The project is already saved on disk, `manifest.json` is populated, and assets are already downloaded.
   - Full probe suite is enabled: `probe_cut`, `probe_scene`, `probe_asset`, `get_word_timings` (with `scene_index` support), `search_icons`, and media searches.

---

## 5. Summary Reference

- Total Unique Capabilities: **36 distinct operations**.
- For external IDE automation: Connect to the **MCP Server** (`backend/mcp/server.py` on `http://127.0.0.1:8765/mcp`).
- For editor chat features: Modify the **Internal Agent Registry** (`backend/agent/tools.py`).
