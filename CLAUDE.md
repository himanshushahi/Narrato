# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Narrato is an AI-driven desktop app for programmatic video generation. Python/Eel backend drives a React/Remotion frontend, bundled as a standalone Windows executable. Users enter a documentary topic, an LLM generates a script with visual cues, assets are auto-fetched (Pexels, YouTube), voiceover is synthesized (Edge TTS or Kokoro ONNX), and the final video is rendered via Remotion in a Chrome headless browser.

## Development Commands

### Setup
```bash
python setup.py                  # Creates .venv, installs python deps, npm install
python download_binaries.py      # Downloads FFmpeg, FFprobe, yt-dlp into ./bin/
```

### Backend (Python)
```bash
python main.py dev               # Launches backend in dev mode (connects to Vite on :5173)
python main.py                   # Production mode (serves built frontend from frontend/dist)
```

### Frontend (React/Vite)
```bash
cd frontend
npm run dev                      # Vite dev server on :5173
npm run build                    # TypeScript check + Vite production build
npm run lint                     # ESLint
npm run build:remotion           # Bundle Remotion compositions for rendering (output: dist-remotion/)
npm run build:render             # Bundle render script with esbuild (output: dist-render/render.mjs)
```

### Two-terminal dev workflow
1. `cd frontend && npm run dev`
2. `python main.py dev`

### Build & Package (Windows)
```powershell
powershell ./build.ps1           # PyInstaller + NSIS installer creation
```

## Architecture

### Frontend → Backend Communication (Eel Bridge)

The entire IPC layer runs over a custom Eel WebSocket bridge:

1. **Python exposes functions** via `@eel.expose` in [backend/core/bridge.py](backend/core/bridge.py) — these are callable from JS as `eel.function_name(args)`.
2. **JS registers callbacks** via `window.eel.expose(cb, "name")` in [frontend/src/store/eelListeners.ts](frontend/src/store/eelListeners.ts) — Python calls these with `eel.on_name(data)()`.
3. **Connection monitoring** in [frontend/src/utils/eel-bridge.ts](frontend/src/utils/eel-bridge.ts) handles the race where the frontend loads before Python's WebSocket server is ready. It retries with exponential backoff automatically.
4. **Vite proxy** at [frontend/vite.config.ts](frontend/vite.config.ts) forwards `/eel`, `/eel.js`, and `/api/media` to Python's Eel server at `127.0.0.1:8888` during development.

### Backend Structure (`backend/`)

| Module | File | Role |
|--------|------|------|
| Core | [backend/core/app.py](backend/core/app.py) | App init: DB init, bridge setup, queue start, Eel browser launch |
| Config | [backend/core/config.py](backend/core/config.py) | Path resolution (dev vs frozen/production), FFmpeg/Node/yt-dlp paths |
| Bridge | [backend/core/bridge.py](backend/core/bridge.py) | All `@eel.expose` functions — the complete IPC surface between frontend and backend |
| DB | [backend/database/db.py](backend/database/db.py) | SQLite storage: `projects`, `tasks`, `settings` tables with CRUD |
| Pipeline Queue | [backend/pipeline/queue.py](backend/pipeline/queue.py) | Threaded `QueueManager` — sequential pipeline step executor, cancel/resume support |
| AI / Script Gen | [backend/pipeline/ai.py](backend/pipeline/ai.py) | LLM integration (OpenAI + NVIDIA NIM), script generation pipeline, JSON schema validation, chart data generation |
| TTS | [backend/pipeline/tts.py](backend/pipeline/tts.py) | Edge TTS and Kokoro ONNX voiceover synthesis, audio concatenation, manifest generation |
| Transcribe | [backend/pipeline/transcribe.py](backend/pipeline/transcribe.py) | Faster-Whisper transcription with word-level timestamps, SRT/VTT export |
| Assets | [backend/pipeline/assets.py](backend/pipeline/assets.py) | Pexels stock media download, YouTube clip download via yt-dlp, asset cleanup |
| Render | [backend/pipeline/render.py](backend/pipeline/render.py) | Resumable Remotion frame render + audio extraction + FFmpeg muxing |

### Frontend Structure (`frontend/`)

| Layer | Key Files |
|-------|-----------|
| Entry | [frontend/src/main.tsx](frontend/src/main.tsx) — Eel listener init, React mount |
| Routing | [frontend/src/App.tsx](frontend/src/App.tsx) — HashRouter, sidebar, Dashboard/Editor/Settings routes |
| Pages | [Dashboard.tsx](frontend/src/pages/Dashboard.tsx) — project CRUD; [SettingsPage.tsx](frontend/src/pages/SettingsPage.tsx) — config |
| Editor | [EditorWorkspace.tsx](frontend/src/features/EditorWorkspace/EditorWorkspace.tsx) — main editor layout (grid: sidebar/preview/inspector/timeline) |
| State | 4 Zustand stores: `useProjectStore`, `useEditorStore`, `useSettingsStore`, `useUIStore` |
| Video Compositions | [frontend/src/components/video/](frontend/src/components/video/) — Remotion components (NitishRajputComposition, KineticSubtitles, PanScanImage, etc.) |
| Render Script | [frontend/src/render.mjs](frontend/src/render.mjs) — Node.js script using `@remotion/renderer` API for frame-by-frame and audio rendering |

### Video Pipeline (5 Sequential Steps)

Managed by `QueueManager` in [backend/pipeline/queue.py](backend/pipeline/queue.py):

1. **generate_script** — LLM generates outline → intro/conclusion → scenes (parallel) → script.json
2. **generate_voiceover** — TTS synthesis per section → concat audio → manifest.json with sub_visuals
3. **transcribe** — Faster-Whisper word-level alignment → transcription.json + SRT/VTT
4. **fetch_assets** — Pexels photo/video + YouTube clips per sub_visual → local assets/
5. **render** — Node.js Remotion renders frames (resumable) + audio → FFmpeg mux → MP4

### Resumable Rendering

The render pipeline ([backend/pipeline/render.py](backend/pipeline/render.py) + [frontend/src/render.mjs](frontend/src/render.mjs)) supports resumption:

1. A content hash of render props is stored in `render_cache/hash.txt`.
2. Individual frames are saved as `element-XXXXXX.webp` in `render_cache/frames/`.
3. On re-render, missing frame ranges are computed and only those are re-rendered.
4. Audio is cached separately in `render_cache/audio.wav`.
5. Final muxing via FFmpeg combines cached frames + audio.

### Key Patterns

- **Eel bridge calls** go through `callEel<T>(fnName, ...args)` in [frontend/src/utils/eel-bridge.ts](frontend/src/utils/eel-bridge.ts) — returns `T | null` on failure.
- **Pipeline progress** flows Python → JS via `eel.on_progress_update` → Zustand store updates.
- **Asset server**: A local Node.js HTTP server (![render.mjs](frontend/src/render.mjs)) serves local media files to Chrome during rendering (avoids `file://` CORS issues).
- **JSON repair**: LLM outputs are notoriously malformed; [backend/pipeline/ai.py](backend/pipeline/ai.py) has `repair_json_string()` and `clean_json_response()` for recovery.
- **Settings**: All persisted in SQLite `settings` table as JSON-stringified values, accessible via `get_setting(key)` / `update_settings(dict)`.
