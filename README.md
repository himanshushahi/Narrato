# Narrato

Narrato is a powerful, AI-driven desktop application for programmatic video generation. Built with a Python backend (powered by Pywebview) and a modern React/Remotion frontend, it allows users to dynamically generate complex, data-driven, and kinetic video compositions directly from their desktop.

## ✨ Features

- **Programmatic Video Rendering:** Leverages [Remotion](https://www.remotion.dev/) to write and render videos using React components (`@remotion/player` and `@remotion/cli`).
- **AI-Powered Pipeline:**
  - **Script Generation:** Integrates with OpenAI and NVIDIA NIM to generate highly contextual, multi-scene video scripts with automatic web search context for factual accuracy.
  - **Text-to-Speech:** Integrated with Edge TTS, Kokoro ONNX, and Piper TTS for high-quality, localized voice generation.
  - **Transcription:** Fast and accurate speech-to-text using `faster-whisper` and `ctranslate2`.
- **Pre-built Compositions:** Includes ready-to-use video modules such as Kinetic Subtitles, Data Visualizations (powered by `d3-geo` and `d3-shape`), Pan-Scan Images, Paper Overlays, and narrative-style compositions.
- **Modern UI/UX:** Built with React 19, Tailwind CSS v4, and Framer Motion, featuring glassmorphism elements, animated tabs, code editors (`react-simple-code-editor`), and live terminal logs.
- **Desktop Integration:** Seamlessly bridged using `pywebview`. Can be packaged as a standalone Windows application with an NSIS installer.

---

## 🛠️ Tech Stack

### Backend (Python)
- **Core:** Python, `pywebview` (for UI bridge and window management)
- **AI, LLM & Audio Processing:** `faster-whisper`, `edge-tts`, `kokoro-onnx`, `piper-tts`, `openai`, `torch`, `onnxruntime`, `ctranslate2`
- **Media & Assets:** FFmpeg, yt-dlp, Pillow, SoundFile, Requests

### Frontend (Web)
- **Framework:** React 19, TypeScript, Vite
- **Video Engine:** Remotion (`@remotion/player`, `@remotion/cli`)
- **Styling & Animation:** Tailwind CSS v4, Framer Motion
- **Data & Maps:** `d3-geo`, `d3-shape`, `topojson-client`
- **State Management & Routing:** Zustand, React Router DOM

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** (required for frontend dependencies and the Remotion rendering CLI)
- **FFmpeg & yt-dlp:** Must be installed in your system PATH or placed in the `./bin/` directory.

### 1. Installation & Setup

To initialize the project, clone the repo and run the automated setup script. It will automatically create a Python virtual environment (`.venv`), install all pip packages, and install Node modules in the `frontend` folder:

```bash
python setup.py
```

To download necessary FFmpeg and yt-dlp binaries locally (if you don't have them installed globally), run:

```bash
python download_binaries.py
```

### 2. Running the Application

#### Development Mode
Run the application with hot-reloading for both the React frontend and Python backend. You will need two terminals.

**Terminal 1 (Frontend):**
```bash
cd frontend
npm run dev
```

**Terminal 2 (Backend):**
```bash
# This will automatically use the local .venv
python main.py dev
```

#### Local Production Mode
Run the compiled React build served directly by the Python backend.

```bash
cd frontend
npm run build
cd ..
python main.py
```

---

## 📦 Building & Packaging

### Prerequisites (one-time setup)

| Tool | Required | Install Command (Windows) |
|------|----------|---------------------------|
| Python 3.10+ | ✅ Yes | `winget install Python.Python.3.12` |
| Node.js 18+ (npm) | ✅ Yes | `winget install OpenJS.NodeJS.LTS` |
| NSIS | ⚠️ Optional | `winget install NSIS.NSIS` |
| Git | ⚠️ Optional | `winget install Git.Git` |

### Build Command

After prerequisites are installed, run:

```powershell
powershell -ExecutionPolicy Bypass -File ./build.ps1
```

### What the build script does

1. **Python environment** — Creates/activates `.venv`, installs `requirements.txt` + `pyinstaller`
2. **Binaries** — Runs `download_binaries.py` (ffmpeg, yt-dlp, node)
3. **Frontend (Vite)** — `npm install` → `npm run build` → `npm run build:remotion` → `npm run build:render`
4. **Render deps** — Generates `frontend/dist-render/package.json` with exact versions, runs `npm install --production`
5. **PyInstaller** — Builds `dist/Narrato/Narrato.exe` using `narrato.spec`
6. **NSIS Installer** — Creates `installer/Narrato_Setup.exe` (requires NSIS)

### Output Artifacts

| Artifact | Path | Purpose |
|----------|------|---------|
| Portable exe | `dist/Narrato/Narrato.exe` | **Test this first** — standalone, no install |
| NSIS installer | `installer/Narrato_Setup.exe` | **Distribute this** — installs to `Program Files` |

### Recommended Test Workflow

```powershell
# 1. Build
powershell -ExecutionPolicy Bypass -File ./build.ps1

# 2. Test portable (no admin needed)
.\dist\Narrato\Narrato.exe

# 3. If good, test installer (requires admin)
.\installer\Narrato_Setup.exe
# Installs to: C:\Program Files\Narrato\Narrato.exe
```

*Notes:*
- The portable exe and installed exe share the same AppData folder (`%LOCALAPPDATA%\Narrato`) for database, models, exports, and cache.
- If NSIS is not installed, the script skips installer generation with a warning.

---

## 📂 Project Structure

```text
remotion_canvas/
├── backend/                  # Python pywebview backend
│   ├── core/                 # App initialization, config, logger, file server, and bridge
│   ├── database/             # Local database integrations
│   └── pipeline/             # AI components (LLM Script Gen, TTS, Transcribe, Render queue)
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── components/       # UI Components (GlassCard, TerminalLogs, Code Editor, etc.)
│   │   ├── components/video/ # Remotion Video Compositions & Modules
│   │   ├── pages/            # App routing pages
│   │   └── store/            # Zustand state management
├── installer/                # NSIS script and asset downloaders for Windows installer
├── bin/                      # (Optional) Local FFmpeg & yt-dlp binaries
├── main.py                   # Entry point for the application
├── setup.py                  # Environment initialization script
├── build.ps1                 # Build script for PyInstaller & NSIS
└── narrato.spec              # PyInstaller specification
```

## 📝 License
[Specify License Here]
