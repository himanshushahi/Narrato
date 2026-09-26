# 🎬 Narrato

> **Local-first AI documentary studio & declarative motion graphics engine powered by Remotion and Model Context Protocol (MCP).**

**Narrato** is a local-first AI video generation studio and motion graphics engine for Windows. You describe a topic, and Narrato conducts web research, writes structured scripts, synthesizes neural voiceover (with voice cloning), aligns word-level subtitles, composes multi-layered declarative visual ASTs (motion graphics, charts, mockups, b-roll, particles), and renders finished videos — all entirely on your own machine.

It pairs a **Python backend** (pywebview desktop shell, autonomous agent engine, SQLite, AI/TTS pipelines) with a **React + TypeScript frontend** (Remotion for video composition and playback), and supports external agent automation via its built-in **MCP Server**.

---

## Declarative AST & Agentic Architecture

Narrato does not use rigid hardcoded video templates. Instead, it relies on a full **Declarative Abstract Syntax Tree (AST)** motion graphics engine guided by an autonomous multi-skill agentic pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AUTONOMOUS AGENT PIPELINE                          │
│                                                                             │
│  Topic & Format ──► [Art Director] ──► Global Design System (design.json)   │
│                          │                                                  │
│                          ▼                                                  │
│  [Outline Director] ──► [Base Writer] ──► [Scene Writer + Web Search Agent] │
│                          │                                                  │
│                          ▼                                                  │
│  [Storyboard Planner] ──► [Visual Director & Motion Graphics Designer]     │
│                          │                                                  │
│                          ▼                                                  │
│        Declarative AST Compositions (Sequence / Layer / Primitives)         │
│                          │                                                  │
│                          ▼                                                  │
│         Remotion Engine (Order-Based Layer Compositor) ──► MP4            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Features

### 1. Declarative AST Visual Engine
Visuals are authored as a composable, declarative Abstract Syntax Tree:
- **11 Core AST Primitives**:
  - `Chart`: Animated bar, line, pie, donut, and progress charts with spring physics.
  - `Counter`: Easing numerical counters for financial metrics, percentages, and valuations.
  - `Mockup`: Stylized leaked document memos (`CONFIDENTIAL`), newspaper clippings, tweets, and browser evidence.
  - `Timeline`: Milestone sequences and chronological event trackers with glowing nodes.
  - `Shape`: Vector shapes, directional arrows, callouts, and animated SVG paths (`@remotion/shapes` & `@remotion/paths`).
  - `Text`: Dynamic typography with kinetic animation modes (`words_stagger`, `typewriter`, `marker_highlight`).
  - `Image`: High-res photos, Ken Burns scale/pan effects, transparent PNG cutouts (Pixabay/Wikipedia/Pexels).
  - `Video`: Cinematic B-roll footage, timelapses, and ambient backgrounds.
  - `Map`: Geographic territory visualizations (`modern_dark`, `nautical_blue`, `vintage`).
  - `Particles`: Dynamic particle overlays (`dust`, `snow`, `sparkles`, `smoke`, `fireflies`) matched to beat moods.
  - `HTML` / `Lottie`: Inline SVG, custom CSS micro-animations, and vector Lottie animations.
- **Order-Based Multi-Layer Compositor**:
  - **Background (First child)**: Background media, footage, ambient textures, and vector maps.
  - **Midground (Middle children)**: Motion graphics (glassmorphic cards, charts, mockups, counters, timelines).
  - **Foreground (Last children)**: Typography, data callouts, and particle overlays (respecting safe areas).
  - `95`: Root Global Overlays (persistent channel watermark, chapter branding, progress bar).
  - `100`: Kinetic Subtitles Track (word-level synced captions).

### 2. Modular Skills System (`backend/skills/`)
All prompt intelligence is decoupled from code into **17 hot-reloadable Markdown skills** with YAML frontmatter:
- **Scripting & Direction**: `script-outline-director`, `script-base-writer`, `script-scene-writer`, `scriptwriter`, `script-rewriter`, `script-scene-adder`.
- **Visuals & Motion**: `art-director-design-system`, `declarative-ast`, `visual-director`, `motion-graphics-designer`, `storyboard-planner`, `visual-rewriter`, `sub-visual-rewriter`.
- **Search & Subtitles**: `search-query-optimizer`, `stock-asset-searcher`, `subtitle-designer`, `editor-qa`.
- **Dynamic Context Injection**: Safe template interpolation (`skill_loader.render_skill`) with automatic disk modification detection (`st_mtime` hot-reloading).

### 3. Autonomous Agent Engine & Tool Loop (`backend/agent/`)
- Multi-turn tool execution loop (`AgentRunner`) enabling models to search the web, inspect project files, load skill definitions, and fetch stock media before generating final JSON schemas.
- Real-time telemetry feed (`emit_activity`) tracking tool invocations, skill preloads, file reads, and LLM turns in the UI.
- Visual correction loop (`validate_and_correct_visuals`) verifying AST schema conformance, duration math, and layer order boundaries.

### 4. Global Design System & Complex Text Layout (CTL) Support
- **Art Director**: Auto-generates cohesive color palettes, typography rules, and glassmorphism styling presets for each video.
- **Complex Text Layout (CTL)**: Strict Unicode shaping support for Indic scripts (Hindi/Devanagari, Tamil, Bengali) and Arabic using bundled Noto fonts (`Noto Sans Devanagari`), preventing broken matras and ligatures.

### 5. AI Voiceover & Audio Engine
- **Edge TTS**: Fast, high-quality neural voices for Hindi, English, and dozens of languages.
- **OmniVoice Voice Cloning**: Offline voice cloning from reference audio clips (~3.3 GB model; auto-unloaded after 30s of inactivity to free VRAM/RAM).
- **Faster-Whisper Transcription**: Word-level timestamps for kinetic subtitles and synced visual animations, with word-level discrepancy audits and auto-alignment.

### 6. Interactive Studio & Timeline Editor
- Full-screen editor (`/editor/:id`) with live Remotion player preview, timeline scrubbing, asset management, and script inspectors.
- Interactive AI rewriting: targeted scene rewrites, sub-visual cut regenerations, and single-click scene additions.
- Resumable chunked rendering with hardware encoding (NVENC / CPU FFmpeg).

### 7. In-App GPU Acceleration
- Slim default installer (~1 GB, CPU torch).
- One-click in-app CUDA runtime download (~2.6 GB) for NVIDIA GPUs via **Settings → GPU Acceleration**, verified with sha256 checksums and zip-slip protection.

### 8. MCP Agent Control (External AI Agents)
Any MCP-compatible coding agent (Claude Code, opencode, Cursor, Gemini CLI) can drive the full pipeline — **26 tools + 1 resource + 1 prompt**, no app LLM key needed:
- **Projects**: create / list / status / delete (validated inputs, collision-proof export folders).
- **Script, design & voice**: save/validate narration, design systems, voice + whisper settings.
- **Stage Grounding Guardrail**: Strict gates require agents to ground themselves via `get_stage_skills` or `get_skill` before authoring scripts, designs, or visuals.
- **Mechanical stages**: voiceover → transcribe → assets → render, with background submit + poll + cancel, strictly serialized per project.
- **Visual iteration**: true audio timings, per-section save, single-cut patch, dry-run validation, contact-sheet review frames (rendered / headless-Remotion / asset lineup).
- **Human review gate**: agents build through asset download, then stop — final render requires your explicit approval (`confirm_render=true`).
- Auto-starts with the app on loopback only (`http://127.0.0.1:8765/mcp`); full guide in [`docs/mcp_agent_control.md`](docs/mcp_agent_control.md), live status in **Settings → Agent Control**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | **pywebview 6.2** (Edge WebView2) + Python **3.12 / 3.14** |
| **Backend & Agent** | Python, `AgentRunner` tool loop, SQLite (WAL mode), `SkillLoader` |
| **TTS & Voice** | **omnivoice 0.2.1** (OmniVoice voice cloning), **edge-tts 7.2.8**, torch 2.12.0 |
| **Speech-to-Text** | **faster-whisper 1.2.1** (ctranslate2) |
| **LLM & Search** | OpenAI-Compatible LLM APIs (OpenAI, OpenRouter, Groq, Ollama, DeepSeek) + LangSearch web search |
| **Frontend** | **React 19**, **TypeScript 5.7**, **Vite 6**, **Tailwind CSS 4**, **Zustand 5**, framer-motion |
| **Video Engine** | **Remotion 4.0.469**, Declarative AST Compositor, d3-geo, highlight.js |
| **Packaging** | **PyInstaller 6.x** (`narrato.spec`) + **NSIS** (`installer/installer.nsi`) |
| **Media Tools** | Bundled `bin/`: ffmpeg, ffprobe, yt-dlp, node.exe (sha256 verified) |

---

## Architecture Overview

```
┌──────────────────────── React/TypeScript UI (Vite + Remotion) ──────────────────────┐
│  Studio Dashboard · Timeline Editor (/editor/:id) · Settings · Activity Feed        │
│  Zustand Stores · Remotion Player · Declarative AST Layer Inspector                 │
└──────────────────────────────────────────┬──────────────────────────────────────────┘
                                           │ JSON Bridge (window.pywebview.api)
                                           ▼
┌──────────────────────── backend/core/bridge.py (ApiBridge) ─────────────────────────┐
│  Project CRUD · Pipeline Orchestration · Interactive Script/Visual Rewriters        │
│  GPU Runtime Manager · Telemetry Feed Push · Power Management                       │
└───────┬──────────────┬───────────────────┬────────────────────┬─────────────────────┘
        ▼              ▼                   ▼                    ▼
  backend/agent/   backend/pipeline/   backend/skills/      backend/core/
  • agent_engine   • ai.py (LLM core)  • 17 modular skills  • config & prefs
  • skill_loader   • tts.py (Edge/OmniVoice)• YAML frontmatter   • logger (UI stream)
  • tools.py       • transcribe.py     • safe templating    • gpu_runtime.py
  • cache.py       • assets.py         • hot-reload         • file_server.py
  • telemetry.py   • render.py (Remotion)                   • database/db.py
  • validators.py  • sfx / icons                        • mcp/server.py
```

---

## Repository Structure

```
Narrato/
├── backend/
│   ├── agent/                 # Autonomous agent loop, skill loader, tools & validators
│   │   ├── agent_engine.py    # Multi-turn tool execution loop
│   │   ├── skill_loader.py    # Skill parser, hot-reloader & template renderer
│   │   ├── tools.py           # Tool definitions (web search, project files, assets)
│   │   ├── schemas.py         # Pydantic schemas for visual AST, scripts, & designs
│   │   ├── validators.py      # Sub-visual math & layer order validation
│   │   ├── cache.py           # LLM response caching engine
│   │   └── telemetry.py       # Live agent activity logger
│   ├── core/                  # Desktop bridge, app shell, config, GPU runtime, logger
│   │   ├── bridge.py          # ApiBridge connecting React UI to Python pipelines
│   │   ├── app.py             # pywebview desktop window initializer
│   │   ├── gpu_runtime.py     # CUDA runtime manager & downloader
│   │   ├── file_server.py     # Local HTTP media server for Remotion preview
│   │   └── config.py          # App paths, directories & platform detection
│   ├── database/              # SQLite database (projects, tasks, settings, WAL mode)
│   │   └── db.py              # Database queries, migrations, & task records
│   ├── mcp/                   # Model Context Protocol server (26 tools + 1 resource + 1 prompt)
│   │   ├── server.py          # MCP entrypoint, tool definitions & skill grounding gates
│   │   ├── payloads.py        # LLM-free save/validate logic & creative blueprints
│   │   ├── subtitles.py       # Word-level Whisper transcription audit & repair
│   │   ├── frames.py          # Review contact sheets (render / composition / asset)
│   │   ├── stills.py          # Headless Remotion stills for pre-render truth checks
│   │   └── http_host.py       # Localhost HTTP host for in-app MCP serving
│   ├── pipeline/              # Stage executors
│   │   ├── ai.py              # LLM script, design & visual generation pipelines
│   │   ├── tts.py             # Neural TTS (Edge TTS & OmniVoice voice cloning)
│   │   ├── transcribe.py      # Faster-Whisper word-level transcription & subtitles
│   │   ├── assets.py          # Media asset search & download (Pexels, Pixabay, Wikipedia)
│   │   ├── render.py          # Chunked Remotion rendering & FFmpeg muxing
│   │   ├── icons.py           # Lucide icon registry & search
│   │   ├── sfx.py             # Audio sound effect triggers & ducking
│   │   └── queue.py           # Serialized background task execution queue
│   ├── skills/                # 17 modular SKILL.md prompt definitions
│   │   ├── declarative-ast/   # AST schema & motion graphics specification
│   │   ├── visual-director/   # Visual beat archetypes & composition rules
│   │   ├── motion-graphics-designer/ # Glassmorphism & kinetic typography recipes
│   │   ├── storyboard-planner/# Visual beat planning archetypes
│   │   ├── art-director-design-system/ # Design system generation
│   │   ├── script-outline-director/    # Chapter breakdown director
│   │   ├── script-base-writer/         # Intro/conclusion writer
│   │   ├── script-scene-writer/        # Scene narration writer
│   │   ├── script-rewriter/            # Interactive segment rewriter
│   │   ├── script-scene-adder/         # Interactive scene adder
│   │   ├── visual-rewriter/            # Scene visual rewriter
│   │   ├── sub-visual-rewriter/        # Single sub-visual rewriter
│   │   ├── search-query-optimizer/     # Web search query generator
│   │   ├── scriptwriter/      # Core narration & anti-AI-isms rules
│   │   ├── subtitle-designer/ # Subtitle styling & CTL rules
│   │   ├── stock-asset-searcher/       # Keyword optimization
│   │   └── editor-qa/         # Pre-flight guardrails for edits
│   └── omnivoice_tts.py       # Standalone OmniVoice inference helper
├── frontend/
│   ├── src/
│   │   ├── components/video/  # Remotion compositions, AST renderers & Kinetic Text
│   │   ├── features/          # Editor workspace, multi-track timeline, visual inspectors
│   │   ├── pages/             # Dashboard, Project Creator, Settings
│   │   └── store/             # Zustand state management
│   └── render.mjs             # Headless Remotion rendering script
├── docs/                      # Architectural guides & developer specs
├── tests/                     # 288 pytest tests (agent core, MCP, GPU runtime, validation)
├── main.py                    # App entrypoint (dev/prod router)
├── download_binaries.py       # Binaries downloader (FFmpeg, Node, yt-dlp)
├── build.ps1                  # Production build script
└── requirements.txt           # Python dependencies
```

---

## Development Setup

### Prerequisites
- **Windows 10/11**
- **Python 3.12+**
- **Node.js 20+** and **npm**
- **NSIS** (optional, for packaging installer)
- Optional: **NVIDIA GPU** with driver ≥ 560.x for CUDA acceleration

### Setup Steps

```bash
# 1. Clone repository
git clone https://github.com/himanshushahi/Narrato.git
cd Narrato

# 2. Setup Python environment
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt       # CUDA 12.6 torch for dev machines
# or for CPU-only dev: pip install -r requirements-cpu.txt

# 3. Download verified media binaries (ffmpeg, ffprobe, yt-dlp, node)
python download_binaries.py

# 4. Install frontend dependencies
cd frontend
npm install
cd ..
```

### Running in Development Mode

Run the frontend dev server and Python desktop shell in two separate terminals:

```bash
# Terminal 1: Vite dev server (port 5174)
cd frontend
npm run dev

# Terminal 2: Python backend
.\.venv\Scripts\python.exe main.py dev
```

---

## Testing

Run the full pytest suite:

```bash
.\.venv\Scripts\python.exe -m pytest
```

All **288 tests** execute in ~5 seconds with local mock harnesses and schema verification.

---

## Building the Standalone Installer

```powershell
# CPU edition (default — slim installer with in-app GPU runtime download)
powershell ./build.ps1

# GPU edition (bundled CUDA torch)
powershell ./build.ps1 -Gpu
```

The output installer is generated at `installer/Narrato_Setup.exe`.

---

## Settings Overview

| Setting | Options / Notes |
|---|---|
| **LLM Provider** | OpenAI-Compatible Endpoint (model, temperature, tokens, base URL) |
| **Web Search** | LangSearch (master toggle + API key) — feeds real-time web facts to scriptwriter agent |
| **Whisper** | Faster-Whisper models (including `collabora/faster-whisper-small-hindi`), device CPU/CUDA |
| **TTS Engine** | Edge TTS (voices, speed, pitch) or OmniVoice (voice profiles, reference clip, ~3.3 GB model) |
| **Media Sources** | Pexels API key, Pixabay illustrations/vectors, Wikipedia images, YouTube clips |
| **Render Engine** | Resolution, FPS, CRF, codec, concurrency, hardware acceleration (CPU / NVENC) |
| **GPU Acceleration** | Detect NVIDIA GPU, download CUDA runtime (2.6 GB), enable/disable, remove |
| **Agent Control (MCP)** | Live endpoint URL, connect snippets, build flow, safety rules, registered tool inventory |

---

## Troubleshooting

- **"OmniVoice model loaded on cpu" even with an NVIDIA GPU** — The installed torch is the CPU wheel. Download the CUDA runtime in-app from **Settings → GPU Acceleration** or run `pip install torch==2.12.0+cu126 --index-url https://download.pytorch.org/whl/cu126`.
- **transformers must stay >= 5.3** — `omnivoice 0.2.1` requires transformers 5.x. The old `coqui-tts 0.27.5` (XTTS v2, needed transformers < 5) was removed in the OmniVoice migration.
- **Complex Script Font Rendering** — If Hindi/Devanagari, Tamil, or Arabic subtitles or motion text show broken Unicode matras/ligatures, ensure `Noto Sans Devanagari` (or corresponding Noto font) is selected in the design system.

---

## License & Privacy

**Local-first by design**: Voice cloning, transcription, Remotion video composition, frame rendering, and SQLite databases run 100% locally on your machine. API keys for external LLMs (OpenAI-compatible providers) and stock media providers are encrypted and stored in local SQLite / `prefs.json` and never leave your machine.
