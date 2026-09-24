import json
import os
import threading

from backend.core.config import BASE_DIR, is_production

if is_production():
    PREFS_FILE = str(BASE_DIR / "prefs.json")
else:
    PREFS_FILE = str(BASE_DIR / ".dev_data" / "prefs.json")

# Guards the read-merge-write sequence: the app runs several windows, each
# with its own bridge, so concurrent save_prefs calls would otherwise lose
# updates (last read wins). The lock serializes the whole load-merge-save.
_prefs_lock = threading.Lock()

def load_prefs():
    if os.path.exists(PREFS_FILE):
        try:
            with open(PREFS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            from backend.core.logger import logger
            logger.error(f"Failed to load preferences: {e}")
    return {}

def save_prefs(data: dict):
    with _prefs_lock:
        try:
            os.makedirs(os.path.dirname(PREFS_FILE), exist_ok=True)
            # Load existing first to merge, so we don't overwrite other settings
            current_prefs = load_prefs()
            current_prefs.update(data)

            tmp_file = PREFS_FILE + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(current_prefs, f, indent=4)

            os.replace(tmp_file, PREFS_FILE)
        except Exception as e:
            from backend.core.logger import logger
            logger.error(f"Failed to save preferences: {e}")
