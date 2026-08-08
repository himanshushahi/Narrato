# Narrato (Remotion Canvas)

**Narrato** is a local-first AI video generation studio for Windows. You describe a topic, and Narrato
writes the script, generates the voiceover (with voice cloning), fetches media, and renders a finished
video — all on your own machine. It pairs a **Python backend** (pywebview desktop shell, SQLite, AI/TTS
pipelines) with a **React + TypeScript frontend** (Remotion for video composition) and ships as a
standalone installer built with PyInstaller + NSIS.

> The repository folder is `remotion_canvas`; the product name is **Narrato**.

---

## Features

### Content pipeline (one-click video generation)
- **AI scriptwriting** — topic → full scene-by-scene script (introduction, scenes, conclusion) with
  strict JSON schema validation and anti-hallucination prompting. Hindi & English.
- **AI voiceover** — two engines:
  - **Edge TTS** (default, fast, online) — Hindi/English neural voices.
  - **XTTS v2 voice cloning** (offline, `coqui/XTTS-v2`) — clone a voice from a
    reference clip; per-language voice profiles. The model is loaded lazily and **auto-unloaded after
    30s of inactivity** (with VRAM/RAM release) to avoid memory leaks.
- **Transcription** — faster-whisper (incl. a Hindi fine-tune), SRT/VTT export, word-level timings for
  kinetic subtitles.
- **AI visuals** — an LLM generates a per-scene visual manifest (10+ visual types, see below).
- **Asset fetching** — Pexels photos/videos, Wikipedia/Wikimedia images, YouTube clips (yt-dlp), and
  direct URLs; content-hash based staleness detection so completed steps are never redone.
- **Render** — Remotion via a custom programmatic `render.mjs` script: resumable chunked frame rendering,
  separate audio pass, FFmpeg mux, optional NVENC hardware encoding, custom bundled ffmpeg/ffprobe.

### Video style system ("nitish_rajput" style)
Rich Remotion composition with dozens of visuals: **kinetic subtitles**, device mockups,
paper texture/overlays, parallax + pan-scan images, zoom/transition wrappers, data visualizations,
numbered lists, **maps (d3-geo/topojson)**, **code blocks** (highlight.js), **thread
simulations**, **HTML/CSS custom visuals**, newspaper layouts — each with its own editor panel.

### Studio & editor
- Dashboard ("Studio") — create projects from a topic + language + style.
- Full-screen editor (`/editor/:id`) — timeline, Remotion video preview, media sidebar, and inspector
  tabs: Script, Settings, Subtitles, Voice, Export. Keyboard shortcuts included.
- Settings page — LLM providers (OpenAI / NVIDIA NIM / HuggingFace), Whisper models, TTS engine +
  voice profiles, background music, render settings, yt-dlp updates, and **GPU Acceleration** (below).
- Multi-window mode (`NARRATO_NUM_WINDOWS` env var), live pipeline progress, terminal log viewer,
  toasts, and a sequential background **QueueManager** (cancel/resume support).

### GPU acceleration (CPU edition + in-app GPU runtime)
- The default installer bundles **CPU-only torch** (slim, ~1 GB).
- Users with an **NVIDIA GPU** can download the CUDA torch runtime (~2.6 GB) from
  **Settings → GPU Acceleration** — no second installer, no manual pip.
- The backend detects the NVIDIA driver (nvidia-smi/WMI, not torch), streams the official
  `torch-2.12.0+cu126` wheel into `%LOCALAPPDATA%\Narrato\gpu_runtime\`, verifies it (size + sha256 +
  zip integrity), and redirects imports to it on next launch (`main.py → apply_runtime`, before any
  torch import).
- Safe fallbacks: if CUDA fails to start, the app logs, disables the pref, shows a toast, and runs on
  CPU. The runtime can be removed anytime from Settings.

---

## Tech stack

| Layer      | Technology |
|------------|------------|
| Desktop shell | **pywebview 6.2** (Edge WebView2) + Python **3.14** |
| Backend    | Python — pywebview `js_api` bridge, SQLite (WAL), threading queue |
| TTS        | **coqui-tts 0.27.5** (XTTS v2), **edge-tts 7.2.8**, torch 2.12.0, transformers 4.57.6 |
| Speech-to-text | **faster-whisper 1.2.1** (ctranslate2) |
| LLM        | OpenAI-compatible API (OpenAI, NVIDIA NIM, HuggingFace) + LangSearch web search |
| Frontend   | **React 19**, **TypeScript 5.7**, **Vite 6**, **Tailwind CSS 4**, **Zustand 5**, framer-motion, react-router 7 (hash router) |
| Video      | **Remotion 4.0.469** (player + programmatic renderer), d3-geo/d3-shape/topojson, highlight.js |
| Packaging  | **PyInstaller 6.x** (`narrato.spec`) + **NSIS** (`installer/installer.nsi`) |
| Media tools| Bundled `bin/`: ffmpeg, ffprobe, yt-dlp, node.exe (sha256-verified by `download_binaries.py`) |

---

## Architecture

```
┌────────────────────── React/TypeScript UI (Vite build, served in a pywebview window) ─────────────────────┐
│  Studio (Dashboard) · Editor (/editor/:id) · Settings      Zustand stores (project/settings/editor/ui)      │
│  callApi('method', ...) → window.pywebview.api.*           events: window.onProgressUpdate / onLogStream…    │
└──────────────────────────────┬────────────────────────────────────────────────────────────────────────────┘
                               │ JSON over pywebview bridge
                               ▼
┌────────────────────── backend/core/bridge.py — ApiBridge ──────────────────────┐
│  project CRUD · pipeline start/cancel/resume · settings/prefs · model downloads │
│  TTS preview · asset previews · GPU runtime (status/download/enable/remove)     │
│  ui_queue + ui_update_loop push progress/toasts/logs to the frontend            │
└───────┬──────────────┬────────────────┬──────────────────┬─────────────────────┘
        ▼              ▼                ▼                  ▼
  database/db.py   pipeline/         core/              media file_server
  SQLite:          QueueManager     config (paths)      http.server on localhost
  projects,        (sequential):    prefs.json          serves project media to
  tasks, settings  ① generate_script logger (UI stream) the UI (loopback-only)
  (WAL, startup    ② generate_voiceover power manager
   cleanup of      ③ transcribe      gpu_runtime (new)
   stuck runs)     ④ generate_visuals
                   ⑤ fetch_assets
                   ⑥ render
        └──────────────┬──────────────────────────────┘
                       ▼
  Remotion: node render.mjs (dist-render) → frames + audio → ffmpeg mux → final MP4
  Assets: Pexels / Wikipedia / YouTube (yt-dlp) · Models: HF (XTTS, Whisper)
```

### Key modules

| Module | Responsibility |
|--------|----------------|
| `backend/core/app.py` | pywebview app entry: windows, ports, taskbar, lifecycle |
| `backend/core/bridge.py` | The whole JS↔Python API surface (`ApiBridge`) + UI event push |
| `backend/core/config.py` | Path resolution: dev = repo root, prod = `%LOCALAPPDATA%\Narrato` |
| `backend/core/prefs.py` | `prefs.json` (thread-safe load-merge-save), e.g. `gpu_enabled`, `xtts_profiles`, `sidebar_collapsed` |
| `backend/core/file_server.py` | Localhost media server for the UI (loopback-origin-checked) |
| `backend/core/gpu_runtime.py` | GPU runtime: NVIDIA detection, wheel download/extract (zip-slip safe), manifest, `apply_runtime()` sys.path redirect |
| `backend/core/logger.py` | Logging with a UI handler (`onLogStream`) |
| `backend/core/power.py` | PowerManager — keeps the machine awake during jobs, auto-instruments bridge calls |
| `backend/database/db.py` | SQLite schema + CRUD (projects, tasks, settings) |
| `backend/pipeline/queue.py` | Sequential background queue with cancel events + progress callbacks |
| `backend/pipeline/ai.py` | LLM calls (JSON-schema enforced, retries, caching), script & visuals pipelines, web context |
| `backend/pipeline/tts.py` | Edge TTS, voiceover assembly (ffmpeg concat), staleness hashing |
| `backend/xtts.py` | XTTS v2: model download, voice cloning, torchcodec FFmpeg-DLL provisioning, 30s idle unload |
| `backend/pipeline/transcribe.py` | faster-whisper download/load, SRT/VTT export, staleness hashing |
| `backend/pipeline/assets.py` | Pexels/Wikipedia/YouTube asset fetching + previews + cleanup |
| `backend/pipeline/render.py` | Orchestrates `render.mjs` (frames/audio/mux), hash-based resume |
| `backend/pipeline/web_search.py` | LangSearch provider for LLM web context |
| `main.py` | Entry point: dev/prod env, GPU runtime activation, launches the app |
| `setup.py` | First-run helper: venv ensure, dependency check, ffmpeg/node check |

### Frontend structure
- `pages/` — `Dashboard.tsx` (Studio), `SettingsPage.tsx`
- `features/EditorWorkspace/` — timeline, video preview, media sidebar, inspector tabs (Script, Settings, Subtitle, Voice, Export), hooks (`usePipeline`, `useEditorData`, `useScriptEditing`, `useProjectAssets`, `useKeyboardShortcuts`)
- `features/ProjectEditor/` — per-visual-type editors (SubVisuals, Newspaper, CustomHtmlUi, ChartData, MapLocations, Numbering, Parallax, NetworkData, HtmlData, Transform, Timeline…)
- `features/Settings/` — `AIProviderCard`, `voiceConstants`
- `components/video/` — Remotion compositions: `NitishRajputComposition`, `KineticSubtitles`, `DeviceMockup`, `PaperOverlay`, `DataVisualizations`, `ThreadSimulation`, `ParallaxImage`, `ZoomWrapper`, `TransitionWrapper`, `NumberingList`, `CustomHtmlVisual`, `RemotionVideoPlayer`…
- `store/` — Zustand: `useProjectStore`, `useSettingsStore`, `useEditorStore`, `useUIStore`, `pywebviewListeners` (registers `window.*` event handlers)
- `src/render.mjs` — production Remotion renderer (chunked, resumable, NVENC-capable)

---

## Data & storage locations

| Mode | Base dir |
|------|----------|
| Development | repo root (`storage/`, `models/`, `assets/`, `temp/`, `exports/`, `.dev_data/prefs.json`) |
| Production (installed) | `%LOCALAPPDATA%\Narrato\` (`storage/`, `models/`, `assets/`, `temp/`, `exports/`, `bin/`, `node/`, `gpu_runtime/`, `prefs.json`) |

User data (default reference voice, bg music, fonts) lives in `assets/` and **survives reinstalls**.
The GPU runtime in `gpu_runtime/` also survives reinstalls.

---

## Prerequisites

- **Windows 10/11** (the app is Windows-targeted; the build pipeline is PowerShell)
- **Python 3.14** (the GPU runtime wheel is pinned to cp314)
- **Node.js 20+** and **npm** (frontend + Remotion renderer)
- **NSIS** (only to build the installer; `makensis` in PATH or default install dirs)
- Optional: **NVIDIA GPU** with driver ≥ 560.x for CUDA acceleration

---

## Development setup

```bash
# 1. Clone
git clone <repo-url> remotion_canvas
cd remotion_canvas

# 2. Python environment (Python 3.14)
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt          # GPU torch (CUDA 12.6) for dev machines
# or, for CPU-only dev:
# pip install -r requirements-cpu.txt

# 3. Bundled binaries (ffmpeg, ffprobe, yt-dlp, node)
python download_binaries.py

# 4. Frontend
cd frontend
npm install
cd ..
```

### Run in development mode

Two terminals:

```bash
# Terminal 1 — Vite dev server (port 5174)
cd frontend
npm run dev

# Terminal 2 — Python backend
.\.venv\Scripts\python.exe main.py dev
```

`python setup.py` is an optional first-run helper that checks the venv, dependencies, ffmpeg and
node_modules, and installs what's missing.

> Note: the frontend talks to the backend exclusively through the pywebview bridge
> (`window.pywebview.api`). In a plain browser (no pywebview) the UI renders but API calls are no-ops —
> always run via `main.py dev`.

---

## Testing

```bash
.\.venv\Scripts\python.exe -m pytest        # 23 tests: gpu_runtime (detection, manifest,
                                            # zip-slip extract, download, activation)
```

---

## Building the installer

```powershell
# CPU edition (default — slim installer; GPU support downloadable in-app)
powershell ./build.ps1

# GPU edition (fat build with CUDA torch baked in — uses the dev .venv)
powershell ./build.ps1 -Gpu
```

What `build.ps1` does:
1. Creates/uses the build venv — `.venv-build-cpu` (Python 3.14, CPU torch) for CPU builds, `.venv` for `-Gpu`
2. `pip install -r requirements-cpu.txt` (or `requirements.txt`) + PyInstaller
3. `download_binaries.py` (ffmpeg/ffprobe/yt-dlp/node into `bin/`)
4. Cleans `frontend/dist`, `dist/`, `build/`
5. `npm ci` + `npm run build` (vite) + `build:remotion` + `build:render`
6. PyInstaller `narrato.spec` → `dist/Narrato/Narrato.exe`
7. NSIS → `installer/Narrato_Setup.exe`

**Faster incremental rebuild** (skips the ~3-4 min npm phases):
```powershell
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm narrato.spec
makensis installer\installer.nsi
```

### Build gotchas
- **Close Narrato.exe before rebuilding** — the clean phase corrupts `dist/` if the app is running.
- **Stop the Vite dev server before `build.ps1`** — `npm ci` replaces `node_modules`, which a running
  Vite holds locked.
- **`requirements-cpu.txt` must NOT contain `--extra-index-url`** — pip would resolve `torch==2.12.0`
  to the `+cu126` wheel (PEP 440: local versions win) and silently install the GPU build.
- The GPU runtime wheel is pinned to **cp314** — build venvs must be Python 3.14 (`build.ps1` handles this).

---

## Settings overview

| Setting | Options / notes |
|---------|-----------------|
| LLM provider | OpenAI / NVIDIA NIM / HuggingFace (model, temperature, tokens, base URL) |
| Web search | LangSearch (master toggle + API key) — feeds the scriptwriter facts |
| Whisper | model (incl. `collabora/faster-whisper-small-hindi`), device cpu/cuda |
| TTS engine | Edge TTS (voices, speed, pitch) or XTTS (voice profiles, reference clip, download ~1.8 GB model) |
| Media | Pexels API key, YouTube on/off + clip duration, bg music + volume |
| Render | resolution, fps, CRF, codec, concurrency, hardware (cpu / cuda for NVENC), timeout |
| GPU Acceleration | detect NVIDIA, download CUDA runtime (2.6 GB), enable/disable, remove |

---

## Troubleshooting

- **"XTTS model loaded on cpu" even with an NVIDIA GPU** — the installed torch is the CPU wheel.
  Install the CUDA build: `pip install torch==2.12.0+cu126 --index-url https://download.pytorch.org/whl/cu126`
  (or use the in-app GPU download on a CPU-edition build).
- **transformers must stay < 5** — `coqui-tts 0.27.5` breaks on transformers 5.x (pin 4.57.6).
- **torchcodec / FFmpeg DLL errors** — `backend/xtts.py::_ensure_torchcodec_dlls`
  auto-provisions the FFmpeg 4.3 DLLs torchcodec needs into the writable user-data
  dir (`%LOCALAPPDATA%\Narrato\torchcodec\` in installed builds — the package dir
  under Program Files is read-only) and registers it in the DLL search path.
- **A fresh build "still fails"** — check `%LOCALAPPDATA%\Narrato\assets\` for a corrupt/0-byte
  cached file (e.g. `default_reference.wav`); the app heals it in code — rebuilding/reinstalling won't.
- **Long XTTS texts on 4 GB GPUs** — the backend chunks text per sentence; keep clips reasonable.

---

## License / notes

Local-first by design: the app itself runs fully offline once models are downloaded; only LLM/asset
fetching (and Edge TTS) require internet and, where applicable, API keys. All keys are stored in the
local SQLite `settings` table / `prefs.json` and never leave your machine.
