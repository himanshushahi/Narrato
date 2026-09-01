# Master Prompt: Upgrade Existing Terminal to a High-Performance, Feature-Rich Global Terminal

> **Instructions for Use:**
> Copy and paste the entire prompt below into your AI coding assistant (Cursor, Antigravity, Claude Code, ChatGPT, etc.) in your other project. It is specifically designed to guide the AI to inspect your existing terminal setup and upgrade it into a production-grade, developer-friendly terminal without breaking your current codebase.

---

```markdown
# Role & Task Objective
You are an expert full-stack engineer and UI/UX systems architect. In this project, we already have a basic/normal terminal UI, but it lacks advanced developer tools, smart stream batching, rich log filtering, stream multiplexing, and robust UI controls.

Your task is to **upgrade and enhance our existing terminal system** into a high-performance, desktop-grade **Global Terminal** with full backend log interception, micro-batched streaming, smart auto-scroll, regex search highlighting, level & source filtering, expandable tracebacks, dual docking modes, and system diagnostics.

Do NOT rewrite the whole application from scratch. Instead, analyze our existing terminal files, backend communication bridge (pywebview, WebSocket, SSE, Electron IPC, or Socket.io), and state management, then upgrade them systematically following the specifications below.

---

## 1. Core Feature Requirements to Implement / Upgrade

### A. Backend: Complete Log Capture & Multiplexing
1. **Root & 3rd-Party Logger Interception (`TerminalLogHandler`)**:
   - Attach a custom logging handler to the Python root logger (`logging.getLogger()`) so that all logs from our app AND third-party libraries (e.g., `torch`, `whisper`, `transformers`, `urllib3`, `yt-dlp`, `werkzeug`, `fastapi`, `uvicorn`) are captured with their severity level, timestamp (`HH:mm:ss.SSS`), source name, message, and exception stack traces.
2. **Standard Output & Error Interceptor (`StdOutErrInterceptor`)**:
   - Wrap `sys.stdout` and `sys.stderr` with a thread-safe interceptor that passes output to the original console/file while also capturing raw `print()` statements and C-extension logs as structured terminal entries.
   - Use line buffering so partial chunks are concatenated before emission.
   - Use thread-local reentrancy guards to prevent infinite logging recursion.
3. **In-Memory Ring Buffer & Catch-up Replay**:
   - Maintain a thread-safe ring buffer (e.g., `deque(maxlen=2000)`) in the backend so recent logs generated during startup or prior to UI load can be instantly replayed when the terminal connects.
4. **Micro-Batched Stream Dispatching**:
   - Do NOT emit single events on every log line (which freezes the UI during high-frequency tasks like video rendering, training, or OCR).
   - Collect log entries in a thread-safe queue and flush micro-batches (e.g., up to 50 logs every 50ms) to the frontend.
5. **Backend Endpoints / IPC Handlers**:
   - `get_recent_logs(limit=500)`: Replay historical logs.
   - `clear_backend_logs()`: Reset in-memory buffer.
   - `open_logs_folder()`: Open the OS log directory in Explorer/Finder (`os.startfile` / `open` / `xdg-open`).
   - `get_system_diagnostic()`: Return real-time OS, CPU load, RAM usage, GPU VRAM, PyTorch/CUDA info, Python version, and storage directory paths.
   - `export_logs()`: Export consolidated formatted logs to a `.log` file on disk.

---

### B. Frontend: State Management & Memory Safety
1. **Store Upgrades (`useTerminalStore` or equivalent Zustand/Redux/Pinia store)**:
   - **Log Schema**:
     ```typescript
     export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SYSTEM' | 'RAW';
     export interface LogEntry {
       id: string;
       timestamp: string;
       level: LogLevel;
       source: string; // e.g., 'FFmpeg', 'Whisper', 'Audio', 'PyTorch', 'Database', 'stdout', 'Server'
       message: string;
       exc_info?: string | null; // Traceback / Stack trace
     }
     ```
   - **Memory Cap**: Circular buffer in frontend state (cap at 2,000–2,500 entries) to prevent browser memory leaks.
   - **Unread Badging**: Track `unreadErrorsCount` and `unreadWarnsCount` while the terminal is closed.
   - **Persistent Preferences**: Save user preferences (`height`, `isFloating`, `autoScroll`, `filterLevel`) in `localStorage`.

---

### C. Frontend: UI/UX Component Enhancements

1. **Dual Docking & Layout Modes**:
   - **Bottom Drawer Mode (Default)**: Slides up from the bottom with smooth spring/cubic-bezier animations; resizable via a top drag handle (clamped between 160px and 85vh).
   - **Floating Window Mode**: Draggable & floating popout box with header drag handle for multi-window workflows.
   - **Maximized View**: Fullscreen diagnostic mode toggle.
2. **Terminal Toolbar**:
   - **Level Filter Badges**: Quick toggle pills (`All`, `Errors`, `Warnings`, `Info`, `Debug`) with live count badges.
   - **Source Filter Dropdown**: Dynamically collects all unique sources in the stream.
   - **Search & Highlighting**: Real-time search query input with regex/case-insensitive support and in-line yellow substring highlights on matching rows.
   - **Auto-Scroll Toggle Lock**: Icon button showing active status.
   - **Actions**:
     - Copy all/visible logs to clipboard with visual toast/check feedback.
     - Export to `.log` file on disk.
     - Open logs folder in OS File Explorer.
     - Clear terminal logs (resets both backend and frontend buffers).
     - Print System & GPU diagnostics directly into the terminal stream.
3. **Smart Auto-Scroll & Freeze Detection**:
   - If user is near the bottom (< 60px), automatically scroll down as new logs arrive.
   - If user scrolls up to inspect an earlier log, auto-scroll pauses and displays a floating pill: `New logs below ↓ (Click to jump)`.
   - Clicking the pill or scrolling back to the bottom instantly resumes auto-scroll.
4. **Log Line Rendering (`TerminalLogItem`)**:
   - JetBrains Mono / monospace font with subtle line numbers and timestamps (`HH:mm:ss.SSS`).
   - Color-coded badges per severity:
     - `DEBUG`: Slate/Cyan
     - `INFO`: Sky/Blue
     - `WARN`: Amber/Yellow
     - `ERROR`: Rose/Red with subtle background tint
     - `SYSTEM`: Emerald/Green
   - Clean source category chips (`[FFmpeg]`, `[Whisper]`, `[PyTorch]`, `[stdout]`, etc.).
   - Expandable Python traceback viewer with `▶ Stack Trace` toggle button.
   - Copy single log line on hover.
5. **Terminal Status Bar**:
   - Live backend connection indicator (animated green pulse dot).
   - Total line counter & visible filtered count (e.g., `Showing 45 of 820 logs`).
   - Quick action pills: `Ping` (measures backend latency in ms), `SysInfo`, `Clear`.
6. **Global Accessibility & Hotkeys**:
   - Topbar terminal toggle button with glowing badge showing unread error counts when closed.
   - Global keyboard shortcuts: `Ctrl + \`` (Backquote) or `Ctrl + Shift + T` to toggle the terminal from anywhere in the app.

---

## 2. Reference Implementation Templates

### Backend Reference: `terminal_logger.py`
```python
import os, sys, time, uuid, queue, logging, threading, traceback, platform
from collections import deque
from datetime import datetime
from typing import Any, Dict, List, Optional

MAX_LOG_HISTORY = 2000
_log_history = deque(maxlen=MAX_LOG_HISTORY)
_log_history_lock = threading.Lock()
_live_log_queue = queue.Queue(maxsize=10000)
_thread_local = threading.local()
_dispatcher_started = False
_dispatcher_lock = threading.Lock()

def _classify_source(name: str, pathname: Optional[str] = None) -> str:
    name_l = (name or "").lower()
    path_l = (pathname or "").lower()
    if "ffmpeg" in name_l or "ffmpeg" in path_l: return "FFmpeg"
    if "whisper" in name_l or "stt" in name_l: return "Whisper"
    if "torch" in name_l or "cuda" in name_l: return "PyTorch"
    if "server" in name_l or "http" in name_l: return "Server"
    if "db" in name_l or "sqlite" in name_l: return "Database"
    if "stdout" in name_l: return "stdout"
    if "stderr" in name_l: return "stderr"
    return name if name else "App"

def add_terminal_log(level: str, message: str, source: str = "App", exc_info: Optional[str] = None):
    if not message or not message.strip():
        return
    norm_level = "WARN" if level.upper() == "WARNING" else level.upper()
    entry = {
        "id": uuid.uuid4().hex[:8],
        "timestamp": datetime.now().strftime("%H:%M:%S.%f")[:-3],
        "level": norm_level,
        "source": source,
        "message": message.strip(),
        "exc_info": exc_info,
    }
    with _log_history_lock:
        _log_history.append(entry)
    try:
        _live_log_queue.put_nowait(entry)
    except queue.Full:
        pass

class TerminalLogHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.setLevel(logging.DEBUG)

    def emit(self, record: logging.LogRecord):
        if getattr(_thread_local, 'in_log_handler', False):
            return
        _thread_local.in_log_handler = True
        try:
            msg = self.format(record)
            exc_text = "".join(traceback.format_exception(*record.exc_info)).strip() if record.exc_info else None
            source = _classify_source(record.name, getattr(record, 'pathname', None))
            add_terminal_log(record.levelname, msg, source=source, exc_info=exc_text)
        finally:
            _thread_local.in_log_handler = False

class StdOutErrInterceptor:
    def __init__(self, original_stream, stream_type: str = "stdout"):
        self._original = original_stream
        self._stream_type = stream_type
        self._buffer = ""
        self._lock = threading.Lock()

    def write(self, text: str):
        if self._original is not None:
            try: self._original.write(text)
            except Exception: pass
        if not text or getattr(_thread_local, 'in_interceptor', False):
            return
        _thread_local.in_interceptor = True
        try:
            with self._lock:
                self._buffer += text
                if "\n" in self._buffer:
                    lines = self._buffer.split("\n")
                    self._buffer = lines[-1]
                    for line in lines[:-1]:
                        trimmed = line.strip()
                        if trimmed:
                            level = "ERROR" if self._stream_type == "stderr" else "INFO"
                            add_terminal_log(level, trimmed, source=self._stream_type)
        finally:
            _thread_local.in_interceptor = False

    def flush(self):
        if self._original is not None:
            try: self._original.flush()
            except Exception: pass
        with self._lock:
            if self._buffer.strip():
                level = "ERROR" if self._stream_type == "stderr" else "INFO"
                add_terminal_log(level, self._buffer.strip(), source=self._stream_type)
                self._buffer = ""
```

---

## 3. Step-by-Step Execution Plan

Please proceed through the following steps:

1. **Audit Existing Setup**:
   - Locate our current terminal component(s), logging files, and bridge communication mechanism.
   - Identify which pieces already exist and map out the exact files to modify.

2. **Upgrade Backend Logging & Streaming**:
   - Add/update the custom `TerminalLogHandler` and attach it to the root logger.
   - Install `StdOutErrInterceptor` on `sys.stdout` and `sys.stderr`.
   - Implement micro-batch queue dispatcher (flushing every 50ms).
   - Implement the bridge endpoints (`get_recent_logs`, `clear_backend_logs`, `open_logs_folder`, `get_system_diagnostic`, `export_logs`).

3. **Upgrade Frontend Store (`useTerminalStore`)**:
   - Add circular log array (cap 2,500 items).
   - Add level filters (`ALL`, `ERROR`, `WARN`, `INFO`, `DEBUG`), source filtering, search state, and auto-scroll flag.
   - Add unread error and warning counters.
   - Wire backend streaming event listener and initial replay call.

4. **Upgrade Terminal UI Components**:
   - Build / Refactor:
     - `TerminalToolbar` (Filters, Search, Auto-scroll, Copy, Export, Clear, SysInfo, Docking toggles).
     - `TerminalLogItem` (Formatted timestamp, color badges, source tags, query highlight, expandable stack trace, copy button).
     - `TerminalStatusBar` (Live pulse, count stats, jump-to-bottom notification, latency ping).
     - `GlobalTerminal` (Bottom resizable drawer with drag handle & floating mode).

5. **Layout & Global Integration**:
   - Mount `<GlobalTerminal />` in the root layout.
   - Add terminal toggle button with animated unread badge to Topbar / Header.
   - Add global keyboard shortcuts (`Ctrl + \`` or `Ctrl + Shift + T`).

6. **Verify & Test**:
   - Compile the frontend (`npm run build` or `tsc`).
   - Test high-frequency logging to confirm no UI stutter.
   - Test level filtering, search matching, auto-scroll freeze, and exception tracebacks.

Begin by inspecting the codebase, locating the existing terminal and logging files, and presenting the upgrade plan!
```
