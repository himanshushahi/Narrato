# Narrato

Narrato is a powerful, AI-driven desktop application for programmatic video generation. Built with a Python backend (powered by Eel) and a modern React/Remotion frontend, it allows users to dynamically generate complex, data-driven, and kinetic video compositions directly from their desktop.

## ✨ Features

- **Programmatic Video Rendering:** Leverages [Remotion](https://www.remotion.dev/) to write and render videos using React components.
- **AI-Powered Pipeline:** 
  - **Text-to-Speech:** Integrated with Edge TTS and Kokoro ONNX for high-quality voice generation.
  - **Transcription:** Fast and accurate speech-to-text using `faster-whisper`.
- **Pre-built Compositions:** Includes ready-to-use video modules such as Kinetic Subtitles, Data Visualizations, Pan-Scan Images, Paper Overlays, and documentary-style compositions (e.g., Nitish Rajput style).
- **Modern UI/UX:** Built with React 19, Tailwind CSS v4, and Framer Motion, featuring glassmorphism elements, animated tabs, and live terminal logs.
- **Desktop Integration:** Seamlessly bridged using Eel. Can be packaged as a standalone Windows application with an NSIS installer.

---

## 🛠️ Tech Stack

### Backend (Python)
- **Core:** Python, [Eel](https://github.com/python-eel/Eel)
- **AI & Audio Processing:** `faster-whisper`, `edge-tts`, `kokoro-onnx`, `torch`, `onnxruntime`
- **Media & Assets:** FFmpeg, Pillow, SoundFile, Requests

### Frontend (Web)
- **Framework:** React 19, TypeScript, Vite
- **Video Engine:** Remotion (`@remotion/player`, `@remotion/cli`)
- **Styling & Animation:** Tailwind CSS v4, Framer Motion
- **State Management & Routing:** Zustand, React Router DOM

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** (required for frontend dependencies and the Remotion rendering CLI)
- **FFmpeg:** Must be installed in your system PATH or placed in the `./bin/` directory.

### 1. Installation & Setup

To initialize the project and install all dependencies (it will automatically set up a Python virtual environment and install Node modules), simply run:

```bash
python setup.py
```

To download necessary FFmpeg binaries locally (if you don't have them installed globally), you can run:

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

To bundle the application into a standalone Windows executable and generate an installer:

```powershell
powershell ./build.ps1
```
*Note: This script uses PyInstaller (`narrato.spec`) to build the executable and NSIS (`installer/installer.nsi`) to generate the setup wizard.*

---

## 📂 Project Structure

```text
remotion_canvas/
├── backend/                  # Python Eel backend
│   ├── core/                 # App initialization, config, and bridge
│   ├── database/             # Local database integrations
│   └── pipeline/             # AI components (TTS, Transcribe, Render queue)
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── components/       # UI Components (GlassCard, TerminalLogs, etc.)
│   │   ├── components/video/ # Remotion Video Compositions
│   │   ├── pages/            # App routing pages
│   │   └── store/            # Zustand state
├── installer/                # NSIS script and asset downloaders for Windows installer
├── bin/                      # (Optional) Local FFmpeg binaries
├── main.py                   # Entry point for the application
├── setup.py                  # Environment initialization script
├── build.ps1                 # Build script for PyInstaller & NSIS
└── narrato.spec              # PyInstaller specification
```

## 📝 License
[Specify License Here]
