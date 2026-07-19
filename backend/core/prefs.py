import json
import os
from pathlib import Path

from backend.core.config import BASE_DIR, is_production

if is_production():
    PREFS_FILE = str(BASE_DIR / "prefs.json")
else:
    PREFS_FILE = str(BASE_DIR / ".dev_data" / "prefs.json")

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
    try:
        os.makedirs(os.path.dirname(PREFS_FILE), exist_ok=True)
        # Load existing first to merge, so we don't overwrite other settings
        current_prefs = load_prefs()
        current_prefs.update(data)
        
        with open(PREFS_FILE, "w", encoding="utf-8") as f:
            json.dump(current_prefs, f, indent=4)
    except Exception as e:
        from backend.core.logger import logger
        logger.error(f"Failed to save preferences: {e}")
