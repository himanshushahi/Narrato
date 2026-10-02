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

# Cap on how many app_*.log files are kept (newest win, 0 disables).
# Per-PID filenames mean every launch leaves a file behind — age pruning
# alone lets dozens accumulate within the retention window.
def _get_log_keep_files() -> int:
    val = os.environ.get("NARRATO_LOG_KEEP_FILES", "10")
    try:
        return max(0, int(val.strip() if val else 10))
    except (ValueError, TypeError):
        return 10

LOG_KEEP_FILES = _get_log_keep_files()


def _configured_level(env_name: str, default: str) -> int:
    """Resolve a logging level from env (e.g. NARRATO_FILE_LOG_LEVEL=DEBUG)."""
    try:
        return getattr(logging, str(os.environ.get(env_name, default) or default).strip().upper())
    except (AttributeError, TypeError):
        return logging.INFO

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

    # File handler (Rotating, max 5MB, keeps 3 backups). Level INFO by
    # default: DEBUG here turned every per-layer/per-request trace into
    # thousands of lines per agent run (78% DEBUG in the worst files).
    # Opt back into the firehose with NARRATO_FILE_LOG_LEVEL=DEBUG.
    if not NO_FILE_LOG:
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8", delay=True
        )
        file_handler.setLevel(_configured_level("NARRATO_FILE_LOG_LEVEL", "INFO"))
        file_handler.setFormatter(LOG_FORMAT)
        logger.addHandler(file_handler)

    # UI custom handler for webview streaming (INFO: same firehose reason;
    # NARRATO_UI_LOG_LEVEL=DEBUG restores full streaming).
    ui_handler = UILogHandler()
    ui_handler.setLevel(_configured_level("NARRATO_UI_LOG_LEVEL", "INFO"))
    ui_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(ui_handler)

    _prune_old_logs()
    return logger


def _prune_old_logs() -> int:
    """Delete app_*.log* files older than LOG_RETENTION_DAYS, then cap the
    survivors at LOG_KEEP_FILES newest (except our own current file). Returns
    the pruned count. Best-effort, never raises."""
    import re
    import time
    pruned = 0
    current_prefix = f"{LOG_FILE.name}."
    try:
        paths = list(LOGS_DIR.glob("app_*.log*"))
    except OSError:
        return 0
    if LOG_RETENTION_DAYS > 0:
        cutoff = time.time() - LOG_RETENTION_DAYS * 86400
        survivors = []
        for path in paths:
            try:
                if path.resolve() == LOG_FILE.resolve() or path.name.startswith(current_prefix):
                    continue
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    pruned += 1
                else:
                    survivors.append(path)
            except OSError:
                continue
    else:
        try:
            survivors = [p for p in paths
                         if p.resolve() != LOG_FILE.resolve()
                         and not p.name.startswith(current_prefix)]
        except OSError:
            survivors = []
    # Count cap: per-PID names accumulate fast (every launch + dev restart),
    # so keep only the newest LOG_KEEP_FILES primary logs. A primary's
    # rotated backups (app_<pid>.log.<n>) go down with it.
    if LOG_KEEP_FILES > 0:
        primary_re = re.compile(r"^app_.*\.log$")
        primaries = sorted(
            (p for p in survivors if primary_re.match(p.name)),
            key=lambda p: p.stat().st_mtime if p.exists() else 0,
            reverse=True,
        )
        doomed = set(primaries[LOG_KEEP_FILES:])
        doomed_names = {d.name for d in doomed}
        for path in survivors:
            try:
                if path in doomed or any(
                    path.name.startswith(name + ".") for name in doomed_names
                ):
                    path.unlink(missing_ok=True)
                    pruned += 1
            except OSError:
                continue
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
    file_handler.setLevel(_configured_level("NARRATO_FILE_LOG_LEVEL", "INFO"))
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
