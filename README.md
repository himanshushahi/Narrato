<div align="center">

# 🎬 Narrato

### Local-First AI Documentary Studio & Declarative Motion Graphics Engine

[![GitHub Release](https://img.shields.io/github/v/release/himanshushahi/Narrato?style=for-the-badge&color=2563EB)](https://github.com/himanshushahi/Narrato/releases/latest)
[![Vibe Coded](https://img.shields.io/badge/Vibe%20Coded-100%25-ff69b4?style=for-the-badge&logo=openai&logoColor=white)](https://github.com/himanshushahi/Narrato#--the-100-vibe-coded-story)
[![License: MIT](https://img.shields.io/badge/License-MIT-10B981.svg?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-556%20Passed-brightgreen.svg?style=for-the-badge)](tests/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/himanshushahi/Narrato/releases/latest)
[![Python](https://img.shields.io/badge/Python-3.12%20%7C%203.14-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Remotion](https://img.shields.io/badge/Motion%20Engine-Remotion%204.x-8B5CF6?style=for-the-badge&logo=react&logoColor=white)](https://remotion.dev)
[![MCP](https://img.shields.io/badge/MCP-26%20Tools%20Ready-F97316?style=for-the-badge)](docs/mcp_agent_control.md)

<p align="center">
  <b>Turn any topic into a finished, broadcast-quality video documentary — completely on your own machine.</b><br/>
  Research, scriptwriting, neural voice cloning, word-synced subtitles, motion graphics AST, and Remotion rendering — with zero cloud lock-in.
</p>

---

[📥 Download Prebuilt Installer](#-download-prebuilt-installer-windows) • 
[🎸 The Vibe Coded Story](#--the-100-vibe-coded-story) • 
[✨ Features](#-core-features) • 
[📐 Architecture](#-declarative-ast--agentic-architecture) • 
[🤖 MCP Agent Control](#-model-context-protocol-mcp-agent-control) • 
[🛠️ Quick Start](#-quick-start--development-setup) • 
[🤝 Contributing](#-contributing)

---

</div>

## 📥 Download Prebuilt Installer (Windows)

Don't want to mess with Python or Node environments? Grab the ready-to-run Windows standalone installer:

### 👉 **[Download Narrato_Setup.exe (Latest Release)](https://github.com/himanshushahi/Narrato/releases/latest)**

- **OS**: Windows 10 / 11 (64-bit)
- **Included**: Bundles the complete desktop UI, Python backend, SQLite database, Edge WebView2 bridge, Remotion rendering runtime, and auxiliary binaries (FFmpeg, Node, yt-dlp).
- **GPU Acceleration**: Runs out-of-the-box on CPU. If you have an NVIDIA GPU, download the optional 1-click CUDA runtime (~2.6 GB) directly in **Settings → GPU Acceleration**.
- **SHA-256 Checksum**: Provided with every release on the [GitHub Releases page](https://github.com/himanshushahi/Narrato/releases).

---

## 🎸 The 100% Vibe-Coded Story

> **"What happens when you combine human vision with autonomous AI coding agents and push agentic software engineering to its absolute limit?"**

**Narrato is 100% vibe-coded from day one.**

Every single component in this repository — from the pywebview desktop bridge to the Remotion motion graphics compositor, the 17 modular prompt skills, the Pydantic AST validation rules, the 26 MCP automation tools, and all **556 automated tests** — was designed, architected, and built through high-bandwidth human-agent pair programming (Antigravity, Gemini, Claude, Cursor).

### Why Vibe-Coding Works Here:
1. **Rigorous Contracts Over Hand-Waving**: AI agents excel when given strict boundaries. Narrato is anchored by a formal **Declarative Abstract Syntax Tree (AST)** for visuals, Pydantic models for validation, and a deterministic layer compositor.
2. **Modular Prompts as Code (`backend/skills/`)**: Instead of opaque multi-page system prompts, intelligence is decoupled into 17 hot-reloadable Markdown skills with YAML frontmatter.
3. **556 Automated Tests**: Every stage is protected by comprehensive pytest suites that run in ~8 seconds, allowing rapid iteration without regressions.
4. **Open Invitation to Vibe Coders**: We encourage contributors to bring their favorite AI tools (Claude Code, Cursor, Antigravity, Copilot) to build new skills, visual primitives, and features! Read our [Contributing Guide](CONTRIBUTING.md) to join the vibe.

---

## 📐 Declarative AST & Agentic Architecture

Narrato does not use rigid, hardcoded video templates. Instead, it relies on a composable **Declarative Abstract Syntax Tree (AST)** motion graphics engine guided by an autonomous multi-skill agentic pipeline:

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

## ✨ Core Features

### 1. Declarative AST Visual Engine
Visuals are authored as a composable, declarative Abstract Syntax Tree:
- **11 Core AST Primitives**:
  - `Chart`: Animated bar, line, pie, donut, and progress charts with spring physics.
  - `Counter`: Easing numerical counters for financial metrics, percentages, and valuations.
  - `Mockup`: Stylized leaked document memos (`CONFIDENTIAL`), newspaper clippings, tweets, and browser evidence.
  - `Timeline`: Milestone sequences and chronological event trackers with glowing nodes.
  - `Shape`: Vector shapes, directional arrows, callouts, and animated SVG paths (`@remotion/shapes` & `@remotion/paths`).
  - `Text`: Dynamic typography with kinetic animation modes (`words_stagger`, `typewriter`, `marker_highlight`).
  - `Image`: High-res photos, Ken Burns scale/pan effects, transparent PNG cutouts (Pixabay / Wikipedia / Pexels / Internet Archive).
  - `Video`: Cinematic B-roll footage, archival newsreels (Internet Archive), timelapses, and ambient backgrounds.
  - `Map`: Geographic territory visualizations (`modern_dark`, `nautical_blue`, `vintage`).
  - `Particles`: Dynamic particle overlays (`dust`, `snow`, `sparkles`, `smoke`, `fireflies`) matched to beat moods.
  - `HTML` / `Lottie`: Inline SVG, custom CSS micro-animations, and vector Lottie animations.
- **25 Macro Archetypes**: Instant full-screen layouts (e.g. `financial_breakdown`, `verdict_dossier`, `satellite_recon`, `timeline_evolution`, `quote_callout`).
- **Order-Based Multi-Layer Compositor**:
  - **Background (First child)**: Background media, footage, ambient textures, and vector maps.
  - **Midground (Middle children)**: Motion graphics (glassmorphic cards, charts, mockups, counters, timelines).
  - **Foreground (Last children)**: Typography, data callouts, and particle overlays (respecting safe areas).
  - **Layer 95**: Root Global Overlays (persistent channel watermark, chapter branding, progress bar).
  - **Layer 100**: Kinetic Subtitles Track (word-level synced captions).

### 2. 17 Hot-Reloadable Skills (`backend/skills/`)
All generative intelligence is decoupled from code into **17 hot-reloadable Markdown skills** with YAML frontmatter:
- **Scripting & Direction**: `script-outline-director`, `script-base-writer`, `script-scene-writer`, `scriptwriter`, `script-rewriter`, `script-scene-adder`.
- **Visuals & Motion**: `art-director-design-system`, `declarative-ast`, `visual-director`, `motion-graphics-designer`, `storyboard-planner`, `visual-rewriter`, `sub-visual-rewriter`.
- **Search & Subtitles**: `search-query-optimizer`, `stock-asset-searcher`, `subtitle-designer`, `editor-qa`.
- **Hot-Reloading**: Modify any prompt in `backend/skills/` while the app is running — Narrato detects file timestamp changes (`st_mtime`) and applies the new prompt rules immediately!

### 3. AI Voiceover & DhVaani Voice Cloning
- **Edge TTS**: Fast, ultra-smooth neural voices for English, Hindi, and 40+ international languages.
- **DhVaani Voice Cloning**: Offline zero-shot voice cloning from a 5–10s reference audio clip (~0.5 GB model; auto-unloaded after 30s of inactivity to free VRAM/RAM).
- **Local Audio Ducking & SFX**: Procedural whooshes, camera shutters, and bass drops automatically mixed with background music.

### 4. Faster-Whisper Subtitles & Complex Text Layout (CTL)
- **Word-Level Precision**: Powered by Faster-Whisper `large-v3-turbo` with word-level alignment and discrepancy repair.
- **Complex Text Layout (CTL)**: Built-in support for Indic scripts (Hindi/Devanagari, Tamil, Bengali) and Arabic using bundled Google Noto fonts (`Noto Sans Devanagari`), preventing broken combining marks (matras/viramas) or disjointed ligatures.

### 5. Interactive Studio & Timeline Editor
- Full-screen timeline workspace (`/editor/:id`) with live Remotion player preview, timeline scrubbing, asset management, and script inspectors.
- **AI Rewriting Loop**: Targeted single-scene rewrites, sub-visual cut regenerations, and single-click scene additions.
- **Smart Resume Rendering**: Resumable chunked rendering with hardware encoding (NVENC / CPU FFmpeg).

### 6. Model Context Protocol (MCP) Agent Control
Any MCP-compatible coding agent (Claude Code, Cursor, Gemini CLI, opencode) can drive Narrato end-to-end — **26 tools + 1 resource + 1 prompt**:
- Inspect projects, author scripts, validate AST schemas, download assets, and trigger final video renders.
- See [MCP Agent Control Guide](docs/mcp_agent_control.md) for complete details.

---

## 🤖 Model Context Protocol (MCP) Quickstart

Connect your favorite AI agent to Narrato in seconds! When Narrato runs, it automatically starts a local MCP server at `http://127.0.0.1:8765/mcp`.

### Claude Desktop / Cursor Config
Add Narrato to your `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "narrato": {
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

Now you can tell Claude or Cursor:
> *"Create a 60-second documentary project in Narrato about the Apollo 11 moon landing with vintage design and line charts."*

---

## 🛠️ Quick Start / Development Setup

If you prefer to run or develop from source:

### Prerequisites
- **Windows 10 / 11**
- **Python 3.12+** or **3.14**
- **Node.js 20+** and **npm**

### 1. Clone & Set Up Python
```bash
git clone https://github.com/himanshushahi/Narrato.git
cd Narrato

python -m venv .venv
.\.venv\Scripts\activate

# CPU development:
pip install -r requirements-cpu.txt
pip install pytest pytest-asyncio typeguard

# Or with local CUDA torch:
# pip install -r requirements.txt
```

### 2. Download Media Binaries
Fetches verified portable builds of FFmpeg, Node, and yt-dlp:
```bash
python download_binaries.py
```

### 3. Install Frontend Dependencies
```bash
cd frontend
npm install
cd ..
```

### 4. Run in Development Mode
Launch both the Vite UI server and the Python desktop shell in two terminal windows:

```bash
# Terminal 1: Vite Dev Server (port 5174)
cd frontend
npm run dev

# Terminal 2: Python Backend
.\.venv\Scripts\python.exe main.py dev
```

---

## 🧪 Testing Suite

Narrato maintains a rock-solid test suite with local mock harnesses, schema verification, and AST boundary checks:

```bash
.\.venv\Scripts\python.exe -m pytest
```

```text
======================= 556 passed in 7.96s =======================
```

All **556 tests** run in ~8 seconds without needing external network calls or GPU access.

---

## 📦 Building the Production Installer (.EXE)

To compile the standalone Windows executable and NSIS setup installer:

```powershell
# CPU Edition (Default — slim installer, GPU runtime downloadable in-app)
powershell ./build.ps1

# GPU Edition (Bundled CUDA torch wheel)
powershell ./build.ps1 -Gpu
```

The build pipeline:
1. Compiles the Vite React bundle.
2. Bundles the Remotion composition.
3. Compiles the headless Remotion render runner.
4. Packages the Python backend with PyInstaller (`dist/Narrato/Narrato.exe`).
5. Compiles the NSIS setup executable at `installer/Narrato_Setup.exe`.

### Automated GitHub Releases
Every git tag push (e.g. `git tag v1.2.0 && git push origin v1.2.0`) triggers the automated [Release Workflow](.github/workflows/release.yml) in GitHub Actions, which builds the Windows installer and publishes it to GitHub Releases with SHA-256 checksums!

---

## 🏛️ System Architecture

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
  • skill_loader   • tts.py (Edge/DhVaani)• YAML frontmatter   • logger (UI stream)
  • tools.py       • transcribe.py     • safe templating    • gpu_runtime.py
  • schemas.py     • assets.py         • hot-reload         • file_server.py
  • telemetry.py   • render.py (Remotion)                   • database/db.py
  • validators.py  • sfx / icons                        • mcp/server.py
```

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | [pywebview 6.2](https://pywebview.flowrl.com/) (Edge WebView2) + Python 3.12 / 3.14 |
| **Backend & Agent** | Python, `AgentRunner` tool loop, SQLite (WAL mode), `SkillLoader` |
| **TTS & Voice** | [DhVaani 0.5](https://huggingface.co/ARTPARK-IISc/DhVaani-0.5) (Voice Cloning), [edge-tts](https://github.com/rany2/edge-tts), torch 2.12.0 |
| **Speech-to-Text** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (ctranslate2, large-v3-turbo) |
| **LLM & Search** | OpenAI-Compatible LLM APIs (OpenAI, OpenRouter, Groq, Ollama, DeepSeek) + LangSearch |
| **Frontend** | [React 19](https://react.dev), [TypeScript 5.7](https://www.typescriptlang.org/), [Vite 6](https://vitejs.dev), [Tailwind CSS 4](https://tailwindcss.com), [Zustand 5](https://github.com/pmndrs/zustand), framer-motion |
| **Video Engine** | [Remotion 4.0](https://remotion.dev), Declarative AST Compositor, d3-geo, highlight.js |
| **Agent Protocol** | [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) (26 tools, 1 resource, 1 prompt) |
| **Packaging** | [PyInstaller 6.x](https://pyinstaller.org/) (`narrato.spec`) + [NSIS 3.x](https://nsis.sourceforge.io/) (`installer/installer.nsi`) |
| **Media Tools** | Bundled `bin/`: ffmpeg, ffprobe, yt-dlp, portable node.exe (sha256 verified) |

---

## 🔒 Privacy & Local-First Guarantee

- **Zero Cloud Telemetry**: Narrato never tracks user behavior, sends usage statistics, or pings central servers.
- **Local Credentials**: External LLM API keys and search tokens are stored exclusively in your local machine's encrypted SQLite database and are never sent anywhere except the official endpoints you configure.
- **Offline Renders**: All Remotion rendering, Faster-Whisper transcriptions, and DhVaani voice synthesis happen 100% locally on your CPU or NVIDIA GPU.

---

## 🤝 Contributing

We welcome contributions of all kinds! Whether you want to add a new Remotion motion graphic component, refine a prompt skill in `backend/skills/`, improve voice cloning quality, or squash a bug.

Please check out our [**Contributing Guide (CONTRIBUTING.md)**](CONTRIBUTING.md) to get started.

### Community & Code of Conduct
Please review our [**Code of Conduct (CODE_OF_CONDUCT.md)**](CODE_OF_CONDUCT.md) to ensure an open, inclusive, and harassment-free environment for everyone.

---

## 📄 License

Narrato is licensed under the **[MIT License](LICENSE)**. You are free to use, modify, distribute, and build commercial products on top of it.

---

<div align="center">
  <b>Crafted with ❤️ and 100% Vibe Coded by Himanshu Kumar Shahi & AI Pair Programmers.</b><br/>
  <sub>Star ⭐ the repository if you love local-first AI video creation!</sub>
</div>
