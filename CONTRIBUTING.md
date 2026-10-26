# Contributing to Narrato 🎬

First off, thank you for considering contributing to Narrato! Whether you are fixing a typo, adding a new Remotion visual component, refining an AI prompt skill, or building an MCP tool, your contributions are warmly welcomed.

---

## 🎸 The 100% Vibe-Coded Philosophy

**Narrato is proudly and uncompromisingly a vibe-coded project.**

It was architected, pair-programmed, iterated, and polished alongside advanced AI coding agents (Antigravity, Gemini, Claude, Cursor, Copilot). We treat AI pair-programming not as a shortcut, but as a premier software engineering discipline:
- **Vision + Autonomous Execution**: Humans drive architectural clarity, creative intent, and domain constraints; AI agents accelerate implementation, refactoring, and test harnesses.
- **AI-Assisted Contributions Are Celebrated**: You are actively encouraged to use AI coding assistants to write code, design motion graphics, craft prompt skills, and add tests!
- **Grounding & Contracts**: "Vibe coding" only works when backed by rock-solid contracts:
  1. **Declarative AST**: Strict Pydantic schemas in Python (`backend/agent/schemas.py`) mirrored in TypeScript (`frontend/src/`).
  2. **Modular Prompts**: 17 decoupled markdown skills (`backend/skills/`) with YAML frontmatter instead of messy hardcoded strings.
  3. **Exhaustive Test Suite**: 556 pytest tests covering agent loops, schema boundaries, and rendering edge cases.

---

## 🛠️ Local Development Setup

### Prerequisites
- **OS**: Windows 10 or 11
- **Python**: 3.12 or 3.14 (Python 3.14 cp314 wheel is supported by the in-app GPU runtime)
- **Node.js**: v20+ and `npm`
- **Git**
- Optional: NVIDIA GPU with CUDA driver ≥ 560.x for local hardware acceleration

### Step-by-Step Setup

1. **Fork and Clone the Repository**
   ```bash
   git clone https://github.com/himanshushahi/Narrato.git
   cd Narrato
   ```

2. **Create Python Virtual Environment**
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate
   ```

3. **Install Python Dependencies**
   - For standard CPU development (fastest install, slim footprint):
     ```bash
     pip install -r requirements-cpu.txt
     pip install pytest pytest-asyncio typeguard
     ```
   - For GPU CUDA development:
     ```bash
     pip install -r requirements.txt
     ```

4. **Download Verified Media Binaries**
   Narrato bundles verified portable binaries for FFmpeg, Node, and yt-dlp:
   ```bash
   python download_binaries.py
   ```

5. **Install Frontend Dependencies**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

6. **Start Development Servers**
   Run the frontend Vite server and Python desktop shell in two separate terminals:

   **Terminal 1 (Vite Dev Server — port 5174):**
   ```bash
   cd frontend
   npm run dev
   ```

   **Terminal 2 (Python Backend Shell):**
   ```bash
   .\.venv\Scripts\python.exe main.py dev
   ```

---

## 🧪 Testing & Quality Assurance

Before submitting any Pull Request, ensure that all test suites pass.

### Running Backend Tests (pytest)
```bash
.\.venv\Scripts\python.exe -m pytest
```
*Narrato has 556 automated tests that run in ~8 seconds.*

### Verifying Frontend Build & Types
```bash
cd frontend
npm run build
npm run build:remotion
cd ..
```
*Ensure there are zero TypeScript compiler errors (`tsc`) or Vite bundler failures.*

---

## 💡 How You Can Contribute

### 1. Authoring or Improving Skills (`backend/skills/`)
All generative intelligence in Narrato lives in decoupled Markdown files with YAML frontmatter:
- **Location**: `backend/skills/<skill-name>/SKILL.md`
- Skills define how the AI writes scripts, selects visual layers, composes motion graphics, and generates search queries.
- Skills support **hot-reloading**: edit the markdown file on disk, and Narrato picks up changes immediately without restarting!

### 2. Adding Visual AST Primitives or Archetypes
Narrato videos are rendered through Remotion via an Abstract Syntax Tree (AST):
- **Core Primitives**: `frontend/src/components/video/layers/` (`Chart`, `Counter`, `Mockup`, `Timeline`, `Shape`, `Text`, `Image`, `Video`, `Map`, `Particles`, `HTML`/`Lottie`).
- **Pydantic Schemas**: If you add new AST parameters, update `backend/agent/schemas.py` and `backend/skills/declarative-ast/SKILL.md`.
- **Macro Archetypes**: Pre-designed full-screen layouts in `backend/agent/archetypes.py`.

### 3. Expanding the Model Context Protocol (MCP) Server (`backend/mcp/`)
Narrato includes a 26-tool MCP server that lets external agents (Claude Code, Cursor, Gemini CLI) drive the entire video creation pipeline:
- Add new endpoints or tools in `backend/mcp/server.py`.
- Ground new tools with stage skills in `backend/mcp/payloads.py`.

### 4. Improving Voiceover & Audio Engine
- Voice profiles, pitch/speed curves, or sound effect triggers (`backend/pipeline/sfx.py`, `backend/pipeline/tts.py`).
- Indic language phonetic tuning and CTL subtitle formatting (`backend/pipeline/transcribe.py`).

---

## 📦 Packaging & Building the Installer

Want to test building the production Windows `.exe` locally?

```powershell
# Build standalone CPU app and NSIS setup installer:
powershell ./build.ps1
```

The resulting standalone executable will be in `dist/Narrato/Narrato.exe`, and the full NSIS setup installer will be in `installer/Narrato_Setup.exe`.

---

## 📝 Commit Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat(scope):` A new feature or capability
- `fix(scope):` A bug fix
- `docs(scope):` Documentation changes
- `style(scope):` Formatting, whitespace, or visual polish
- `refactor(scope):` Code change that neither fixes a bug nor adds a feature
- `perf(scope):` Performance improvements (e.g. rendering speed, caching)
- `test(scope):` Adding or modifying tests
- `chore(scope):` Build scripts, dependencies, or configuration

Example:
```text
feat(visuals): add 3d-isometric-card AST primitive with spring entrance
fix(whisper): preserve Devanagari virama combining marks during subtitle alignment
```

---

## 🤝 Submitting a Pull Request

1. Fork the repo and create your branch from `master`:
   ```bash
   git checkout -b feat/my-amazing-feature
   ```
2. Make your changes with clear, focused commits.
3. Run the test suite:
   ```bash
   pytest
   cd frontend && npm run build
   ```
4. Push to your fork:
   ```bash
   git push origin feat/my-amazing-feature
   ```
5. Open a Pull Request on GitHub. Fill out the PR template — don't hesitate to share the AI prompts or tools you used in the **Vibe Check** section!

Thank you for helping make Narrato the best open-source AI video studio in the world! 🚀
