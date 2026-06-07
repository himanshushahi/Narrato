import os
import sys
from pathlib import Path

# Resolve workspace root vs frozen bundle directories
if getattr(sys, 'frozen', False) or os.environ.get("ENVIRONMENT") == "production":
    # Production/Frozen mode: Writeable folders (logs, storage, exports, models) go to %LOCALAPPDATA%/Narrato
    appdata_local = os.environ.get("LOCALAPPDATA")
    if not appdata_local:
        appdata_local = str(Path.home() / "AppData" / "Local")
    BASE_DIR = Path(appdata_local).resolve() / "Narrato"
    
    if getattr(sys, 'frozen', False):
        # Bundled read-only assets are located in sys._MEIPASS
        BUNDLE_DIR = Path(sys._MEIPASS).resolve()
    else:
        BUNDLE_DIR = Path(__file__).resolve().parent.parent.parent
        
    # Prepend portable Node.js and local bin to PATH so subprocesses can resolve them offline
    node_dir = BASE_DIR / "node"
    bin_dir = BASE_DIR / "bin"
    paths_to_add = []
    if node_dir.exists():
        paths_to_add.append(str(node_dir))
    if bin_dir.exists():
        paths_to_add.append(str(bin_dir))
    if paths_to_add:
        os.environ["PATH"] = os.pathsep.join(paths_to_add) + os.pathsep + os.environ.get("PATH", "")
else:
    # Live development mode: Writeable folders reside inside workspace root
    BASE_DIR = Path(__file__).resolve().parent.parent.parent
    BUNDLE_DIR = BASE_DIR

# Ensure central storage folder exists for database
(BASE_DIR / "storage").mkdir(parents=True, exist_ok=True)

# Database path (statically in central global storage folder)
DB_PATH = BASE_DIR / "storage" / "narrato.db"

# Binaries directory
BIN_DIR = BASE_DIR / "bin"

def get_workspace_dir() -> Path:
    """Dynamically resolves the active workspace directory path."""
    from backend.database.db import get_setting
    try:
        custom_path = get_setting("workspace_directory")
        if custom_path:
            p = Path(custom_path).resolve()
            if p.exists():
                return p
    except Exception:
        pass
    return BASE_DIR

def get_storage_dir() -> Path:
    d = get_workspace_dir() / "storage"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_temp_dir() -> Path:
    d = get_workspace_dir() / "temp"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_fonts_dir() -> Path:
    d = BASE_DIR / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_models_dir() -> Path:
    # Models are stored statically in BASE_DIR / "models" (AppData in production, project root in dev)
    d = BASE_DIR / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_logs_dir() -> Path:
    d = get_workspace_dir() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_exports_dir() -> Path:
    d = get_workspace_dir() / "exports"
    d.mkdir(parents=True, exist_ok=True)
    return d

# FFmpeg path resolution
def get_ffmpeg_path():
    ffmpeg_ext = ".exe" if os.name == "nt" else ""
    local_ffmpeg = BIN_DIR / f"ffmpeg{ffmpeg_ext}"
    if local_ffmpeg.exists():
        return str(local_ffmpeg)
    return "ffmpeg"

def get_ffprobe_path():
    ffmpeg_ext = ".exe" if os.name == "nt" else ""
    local_ffprobe = BIN_DIR / f"ffprobe{ffmpeg_ext}"
    if local_ffprobe.exists():
        return str(local_ffprobe)
    return "ffprobe"

def get_ytdlp_path():
    ytdlp_ext = ".exe" if os.name == "nt" else ""
    local_ytdlp = BIN_DIR / f"yt-dlp{ytdlp_ext}"
    if local_ytdlp.exists():
        return str(local_ytdlp)
    return "yt-dlp"

def get_node_path():
    node_ext = ".exe" if os.name == "nt" else ""
    local_node = BIN_DIR / f"node{node_ext}"
    if local_node.exists():
        return str(local_node.resolve())
    return "node"
