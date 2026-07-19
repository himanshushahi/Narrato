import os
import sys
import subprocess
from pathlib import Path

def is_production():
    return getattr(sys, 'frozen', False) or os.environ.get("ENVIRONMENT") == "production"

# Resolve workspace root vs frozen bundle directories
if is_production():
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
    """Returns the base application data directory (AppData in prod, app root in dev)."""
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
    d = BASE_DIR / "assets" / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_models_dir() -> Path:
    # Models are stored statically in BASE_DIR / "models" (AppData in production, project root in dev)
    d = BASE_DIR / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_exports_dir() -> Path:
    d = get_workspace_dir() / "exports"
    d.mkdir(parents=True, exist_ok=True)
    return d

def get_assets_dir() -> Path:
    """Returns the stable directory for globally-managed assets (e.g. bg_music).

    Dev: {project_root}/assets/
    Prod: %LOCALAPPDATA%/Narrato/assets/
    """
    d = BASE_DIR / "assets"
    d.mkdir(parents=True, exist_ok=True)
    return d

# FFmpeg path resolution
def _get_binary_path(name, resolve=False):
    ext = ".exe" if os.name == "nt" else ""
    local_path = BIN_DIR / f"{name}{ext}"
    if local_path.exists():
        return str(local_path.resolve()) if resolve else str(local_path)
    return name

def get_ffmpeg_path():
    return _get_binary_path("ffmpeg")

def get_ffprobe_path():
    return _get_binary_path("ffprobe")

def get_ytdlp_path():
    return _get_binary_path("yt-dlp")

def get_node_path():
    return _get_binary_path("node", resolve=True)

def get_startupinfo():
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo

def get_remotion_cache_dir() -> Path:
    """Returns a writable directory for Remotion's internal cache (.remotion folder).

    In production, this points to LOCALAPPDATA/Narrato/cache/remotion to avoid
    permission issues when installed in C:\\Program Files.
    In development, it points to frontend/node_modules/.remotion as usual.
    """
    if is_production():
        cache_dir = BASE_DIR / "cache" / "remotion"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir
    else:
        # Dev mode: use the standard location
        return Path(__file__).resolve().parent.parent.parent / "frontend" / "node_modules" / ".remotion"
