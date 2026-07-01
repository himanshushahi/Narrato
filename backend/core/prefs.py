import json
import os

import sys

APP_NAME = "Narrato"

if getattr(sys, 'frozen', False) or os.environ.get("ENVIRONMENT") == "production":
    # Production: Store in %LOCALAPPDATA%
    PREFS_FILE = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), APP_NAME, "prefs.json")
else:
    # Development: Store in project folder (.dev_data/prefs.json)
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    PREFS_FILE = os.path.join(project_root, ".dev_data", "prefs.json")

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
