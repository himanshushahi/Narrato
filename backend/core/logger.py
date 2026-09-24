import logging
import sys
import os
from logging.handlers import RotatingFileHandler
from backend.core.config import BASE_DIR

# Log directory & file path (unified under central BASE_DIR)
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS_DIR / f"app_{os.getpid()}.log"

# Opt-out for short-lived workers (MCP stdio spawns one process per agent
# connection — without this each leaves an app_<pid>.log behind).
NO_FILE_LOG = os.environ.get("NARRATO_NO_FILE_LOG", "").strip() == "1"
# Hygiene: files older than this are pruned at startup (0 disables).
def _get_log_retention_days() -> int:
    val = os.environ.get("NARRATO_LOG_RETENTION_DAYS", "7")
    try:
        return max(0, int(val.strip() if val else 7))
    except (ValueError, TypeError):
        return 7

LOG_RETENTION_DAYS = _get_log_retention_days()

# Define log format
LOG_FORMAT = logging.Formatter(
    "[%(asctime)s] [%(levelname)s] [%(name)s:%(filename)s:%(lineno)d]: %(message)s"
)

# UI stream callback (registered by bridge.py)
_log_callback = None

class UILogHandler(logging.Handler):
    """Custom logging handler to push logs to UI via webview bridge."""
    def emit(self, record):
        try:
            msg = self.format(record)
            if _log_callback:
                _log_callback(msg)
        except Exception:
            self.handleError(record)

def setup_logger():
    logger = logging.getLogger("Narrato")
    logger.setLevel(logging.DEBUG)
    
    # Ensure stdout/stderr do not crash on Windows charmap/cp1252 encodings
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass

    # Avoid duplicate handlers if setup is run multiple times
    if logger.handlers:
        return logger

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(console_handler)

    # File handler (Rotating, max 5MB, keeps 3 backups)
    if not NO_FILE_LOG:
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8", delay=True
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(LOG_FORMAT)
        logger.addHandler(file_handler)

    # UI custom handler for webview streaming
    ui_handler = UILogHandler()
    ui_handler.setLevel(logging.DEBUG)
    ui_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(ui_handler)

    _prune_old_logs()
    return logger


def _prune_old_logs() -> int:
    """Delete app_*.log* files older than LOG_RETENTION_DAYS (except our own
    current file). Returns the pruned count. Best-effort, never raises."""
    if LOG_RETENTION_DAYS <= 0:
        return 0
    import time
    cutoff = time.time() - LOG_RETENTION_DAYS * 86400
    pruned = 0
    current_prefix = f"{LOG_FILE.name}."
    try:
        for path in LOGS_DIR.glob("app_*.log*"):
            try:
                if path.resolve() == LOG_FILE.resolve() or path.name.startswith(current_prefix):
                    continue
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    pruned += 1
            except OSError:
                continue
    except OSError:
        pass
    return pruned


def disable_file_logging() -> None:
    """Detach file handlers (short-lived workers: MCP stdio servers)."""
    for handler in list(logger.handlers):
        if isinstance(handler, RotatingFileHandler):
            try:
                handler.close()
            except Exception:
                pass
            logger.removeHandler(handler)


def enable_file_logging() -> None:
    """(Re)attach the per-PID rotating file handler (standalone servers)."""
    if any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
        return
    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8", delay=True
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(file_handler)


def configure_stdio_worker() -> None:
    """MCP stdio mode: stdout is the JSON-RPC transport, so NOTHING may be
    written there. Drop file + stdout handlers; keep logs on stderr."""
    disable_file_logging()
    for handler in list(logger.handlers):
        stream = getattr(handler, "stream", None)
        if isinstance(handler, logging.StreamHandler) and stream is sys.stdout:
            logger.removeHandler(handler)
    if not any(isinstance(h, logging.StreamHandler)
               and getattr(h, "stream", None) is sys.stderr
               for h in logger.handlers):
        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setLevel(logging.INFO)
        stderr_handler.setFormatter(LOG_FORMAT)
        logger.addHandler(stderr_handler)

# Initialize logger
logger = setup_logger()

def register_log_callback(callback):
    """Register the UI callback function for streaming logs to frontend."""
    global _log_callback
    _log_callback = callback
    logger.info("UI real-time log streaming callback registered successfully.")
