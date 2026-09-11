# Narrato (Remotion Canvas)

**Narrato** is a local-first AI video generation studio and motion graphics engine for Windows. You describe a topic, and Narrato writes the script, plans cinematic storyboards, synthesizes neural voiceover (with voice cloning), composes multi-layered declarative visual ASTs (motion graphics, charts, mockups, b-roll), and renders a finished video — all on your own machine.

It pairs a **Python backend** (pywebview desktop shell, autonomous agent engine, SQLite, AI/TTS pipelines) with a **React + TypeScript frontend** (Remotion for video composition and playback) and ships as a standalone installer built with PyInstaller + NSIS.

> The repository folder is `remotion_canvas`; the product name is **Narrato**.

---

## What's New: Declarative AST & Agentic Architecture

Narrato has evolved beyond rigid hardcoded video templates into a full **Declarative Abstract Syntax Tree (AST)** motion graphics engine guided by an autonomous multi-skill agentic pipeline:

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
Visuals are represented as a composable, declarative Abstract Syntax Tree rather than monolithic templates:
- **10 Core AST Primitives**:
  - `Chart`: Animated bar, line, pie, donut, and progress charts with spring physics.
  - `Counter`: Easing numerical counters for financial metrics, percentages, and valuations.
  - `Mockup`: Stylized leaked document memos (`CONFIDENTIAL`), newspaper clippings, tweets, and browser evidence.
  - `Timeline`: Milestone sequences and chronological event trackers with glowing nodes.
  - `Shape`: Vector shapes, directional arrows, callouts, and animated SVG paths (`@remotion/shapes` & `@remotion/paths`).
  - `Text`: Dynamic typography with kinetic animation modes (`words_stagger`, `typewriter`, `marker_highlight`).
  - `Image`: High-res photos, Ken Burns scale/pan effects, transparent PNG cutouts (Pixabay/Wikipedia).
  - `Video`: Cinematic B-roll footage, timelapses, and ambient backgrounds.
  - `Map`: Geographic territory visualizations (`modern_dark`, `nautical_blue`, `vintage`).
  - `HTML`: Custom inline SVG and CSS animations.
- **Order-Based Multi-Layer Compositor**:
  - **Background (First child)**: Background media, footage, ambient textures, and vector maps.
  - **Midground (Middle children)**: Motion graphics (glassmorphic cards, charts, mockups, counters, timelines).
  - **Foreground (Last children)**: Typography and data callouts (respecting subtitle safe areas).
  - `95`: Root Global Overlays (persistent channel watermark, chapter branding, progress bar).
  - `100`: Kinetic Subtitles Track (word-level synced captions).
- **Anti-Pattern Guardrails**: No flashing static chapter cards inside sub-visual cuts — chapter branding is rendered continuously across scenes at the root composition level.

### 2. Modular Skills System (`backend/skills/`)
All prompt intelligence is decoupled from code into **17 hot-reloadable Markdown skills** with YAML frontmatter:
- **Scripting & Direction**: `script-outline-director`, `script-base-writer`, `script-scene-writer`, `scriptwriter`, `script-rewriter`, `script-scene-adder`.
- **Visuals & Motion**: `art-director-design-system`, `declarative-ast`, `visual-director-core`, `motion-graphics-designer`, `storyboard-planner`, `visual-rewriter`, `sub-visual-rewriter`.
- **Search & Subtitles**: `search-query-optimizer`, `stock-asset-searcher`, `subtitle-designer`, `editor-qa`.
- **Dynamic Context Injection**: Safe template interpolation (`skill_loader.render_skill`) with automatic disk modification detection (`st_mtime` hot-reloading).

### 3. Autonomous Agent Engine & Tool Loop (`backend/agent/`)
- Multi-turn tool execution loop (`AgentRunner`) enabling models to search the web, query project files, load skill definitions, and fetch stock media before generating final JSON schemas.
- Real-time telemetry feed (`emit_activity`) tracking tool invocations, skill preloads, file reads, and LLM turns in the UI.
- Visual correction loop (`validate_and_correct_visuals`) verifying AST schema conformance, duration math, and layer order boundaries.

### 4. Global Design System & Complex Text Layout (CTL) Support
- **Art Director**: Auto-generates cohesive color palettes, typography rules, and glassmorphism styling presets for each video.
- **Complex Text Layout (CTL)**: Strict Unicode shaping support for Indic scripts (Hindi/Devanagari, Tamil, Bengali) and Arabic using bundled Noto fonts (`Noto Sans Devanagari`), preventing broken matras/ligatures.

### 5. AI Voiceover & Audio Engine
- **Edge TTS** (fast, online neural voices for Hindi, English, and dozens of languages).
- **XTTS v2 Voice Cloning** (offline voice cloning from reference audio clips; auto-unloaded after 30s of inactivity to free VRAM/RAM).
- **Faster-Whisper Transcription**: Word-level timestamps for kinetic subtitles and synced visual animations.

### 6. Interactive Studio & Timeline Editor
- Full-screen editor (`/editor/:id`) with live Remotion player preview, timeline scrubbing, asset management, and script inspectors.
- Interactive AI rewriting: targeted scene rewrites, sub-visual cut regenerations, and single-click scene additions.
- Resumable chunked rendering with hardware encoding (NVENC / CPU FFmpeg).

### 7. In-App GPU Acceleration
- Slim default installer (~1 GB, CPU torch).
- One-click in-app CUDA runtime download (~2.6 GB) for NVIDIA GPUs via **Settings → GPU Acceleration**, verified with sha256 checksums and zip-slip protection.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | **pywebview 6.2** (Edge WebView2) + Python **3.14** |
| **Backend & Agent** | Python, `AgentRunner` tool loop, SQLite (WAL mode), `SkillLoader` |
| **TTS & Voice** | **coqui-tts 0.27.5** (XTTS v2), **edge-tts 7.2.8**, torch 2.12.0 |
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
  • skill_loader   • tts.py (Edge/XTTS)• YAML frontmatter   • logger (UI stream)
  • tools.py       • transcribe.py     • safe templating    • gpu_runtime.py
  • cache.py       • assets.py         • hot-reload         • file_server.py
  • telemetry.py   • render.py (Remotion)                   • database/db.py
```

---

## Repository Structure

```
remotion_canvas/
├── backend/
│   ├── agent/                 # Autonomous agent loop, skill loader, tools & cache
│   │   ├── agent_engine.py    # Multi-turn tool execution loop
│   │   ├── skill_loader.py    # Skill parser, hot-reloader & template renderer
│   │   ├── tools.py           # Tool definitions (web search, project files, assets)
│   │   ├── cache.py           # LLM response caching engine
│   │   └── telemetry.py       # Live agent activity logger
│   ├── skills/                # 17 modular SKILL.md prompt definitions
│   │   ├── declarative-ast/   # AST schema & motion graphics specification
│   │   ├── visual-director/   # Visual beat archetypes & composition rules
│   │   ├── motion-graphics-designer/ # Glassmorphism & kinetic typography recipes
│   │   ├── storyboard-planner/# 6 visual beat planning archetypes
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
│   ├── core/                  # Bridge, app shell, config, GPU runtime, logger
│   ├── database/              # SQLite database (projects, tasks, settings)
│   └── pipeline/              # Script, voiceover, transcription, visual & render pipelines
├── frontend/
│   ├── src/
│   │   ├── components/video/  # Remotion compositions & AST primitive renderers
│   │   ├── features/          # Editor workspace, timeline, visual inspectors
│   │   ├── pages/             # Dashboard, Settings
│   │   └── store/             # Zustand state management
│   └── render.mjs             # Headless Remotion rendering script
├── tests/                     # 83 pytest tests (agent core, GPU runtime, live LLM harness)
├── main.py                    # App entrypoint (dev/prod router)
└── download_binaries.py       # Binaries downloader (FFmpeg, Node, yt-dlp)
```

---

## Development Setup

### Prerequisites
- **Windows 10/11**
- **Python 3.14** (required for pinned GPU runtime compatibility)
- **Node.js 20+** and **npm**
- **NSIS** (optional, for packaging installer)
- Optional: **NVIDIA GPU** with driver ≥ 560.x for CUDA acceleration

### Setup Steps

```bash
# 1. Clone repository
git clone <repo-url> remotion_canvas
cd remotion_canvas

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

Run the full pytest suite covering Agent Core, GPU Runtime, and Live LLM Pipeline harnesses:

```bash
.\.venv\Scripts\python.exe -m pytest
```

All 83 tests execute in under 1 second with local mock harnesses and schema verification.

---

## Building the Standalone Installer

```powershell
# CPU edition (default — slim installer with in-app GPU runtime download)
powershell ./build.ps1

# GPU edition (bundled CUDA torch)
powershell ./build.ps1 -Gpu
```

The output installer is generated at `installer/Narrato_Setup.exe`.

------

## Settings Overview

| Setting | Options / Notes |
|---|---|
| **LLM Provider** | OpenAI-Compatible Endpoint (model, temperature, tokens, base URL) |
| **Web Search** | LangSearch (master toggle + API key) — feeds real-time web facts to scriptwriter agent |
| **Whisper** | Faster-Whisper models (including `collabora/faster-whisper-small-hindi`), device CPU/CUDA |
| **TTS Engine** | Edge TTS (voices, speed, pitch) or XTTS v2 (voice profiles, reference clip, ~1.8 GB model) |
| **Media Sources** | Pexels API key, Pixabay illustrations/vectors, Wikipedia images, YouTube clips |
| **Render Engine** | Resolution, FPS, CRF, codec, concurrency, hardware acceleration (CPU / NVENC) |
| **GPU Acceleration** | Detect NVIDIA GPU, download CUDA runtime (2.6 GB), enable/disable, remove |

---

## Troubleshooting

- **"XTTS model loaded on cpu" even with an NVIDIA GPU** — The installed torch is the CPU wheel. Download the CUDA runtime in-app from **Settings → GPU Acceleration** or run `pip install torch==2.12.0+cu126 --index-url https://download.pytorch.org/whl/cu126`.
- **transformers must stay < 5** — `coqui-tts 0.27.5` requires transformers 4.x (pinned to 4.57.6).
- **torchcodec / FFmpeg DLL errors** — `backend/xtts.py::_ensure_torchcodec_dlls` auto-provisions the FFmpeg 4.3 DLLs into `%LOCALAPPDATA%\Narrato\torchcodec\` and registers them in the Windows DLL search path.
- **Complex Script Font Rendering** — If Hindi/Devanagari, Tamil, or Arabic subtitles or motion text show broken Unicode matras/ligatures, ensure `Noto Sans Devanagari` (or corresponding Noto font) is selected in the design system.

---

## License & Privacy

**Local-first by design**: Voice cloning, transcription, Remotion video composition, frame rendering, and SQLite databases run 100% locally on your machine. API keys for external LLMs (OpenAI-compatible providers) and stock media providers are encrypted and stored in local SQLite / `prefs.json` and never leave your machine.
