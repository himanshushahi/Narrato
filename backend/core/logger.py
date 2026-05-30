import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from backend.core.config import BASE_DIR

# Log directory & file path (unified under central BASE_DIR)
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS_DIR / "app.log"

# Define log format
LOG_FORMAT = logging.Formatter(
    "[%(asctime)s] [%(levelname)s] [%(name)s:%(filename)s:%(lineno)d]: %(message)s"
)

# Eel stream callback (will be registered by bridge.py)
_log_callback = None

class EelLogHandler(logging.Handler):
    """Custom logging handler to push logs to Eel client."""
    def emit(self, record):
        try:
            msg = self.format(record)
            if _log_callback:
                _log_callback(msg)
        except Exception:
            self.handleError(record)

def setup_logger():
    logger = logging.getLogger("RenderFlowStudio")
    logger.setLevel(logging.DEBUG)
    
    # Avoid duplicate handlers if setup is run multiple times
    if logger.handlers:
        return logger

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(console_handler)

    # File handler (Rotating, max 5MB, keeps 3 backups)
    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(file_handler)

    # Eel custom handler for UI streaming
    eel_handler = EelLogHandler()
    eel_handler.setLevel(logging.DEBUG)
    eel_handler.setFormatter(LOG_FORMAT)
    logger.addHandler(eel_handler)

    return logger

# Initialize logger
logger = setup_logger()

def register_log_callback(callback):
    """Register the Eel JS callback function for streaming logs to frontend."""
    global _log_callback
    _log_callback = callback
    logger.info("Eel real-time log streaming callback registered successfully.")
