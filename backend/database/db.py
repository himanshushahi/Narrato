import sqlite3
import json
import uuid
from datetime import datetime
from contextlib import contextmanager
from backend.core.config import DB_PATH
from backend.core.logger import logger

@contextmanager
def get_db_connection():
    """Context manager for SQLite connection with automatic commit and closing."""
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database error occurred: {e}", exc_info=True)
        raise e
    finally:
        conn.close()

def init_db():
    """Initialize database tables if they do not exist."""
    logger.info(f"Initializing SQLite database at: {DB_PATH}")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Projects Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT,
                status TEXT DEFAULT 'created',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                language TEXT DEFAULT 'hi',
                style TEXT DEFAULT 'nitish_rajput',
                duration_mode TEXT DEFAULT 'medium',
                video_format TEXT DEFAULT 'landscape',
                script_path TEXT,
                audio_path TEXT,
                transcription_path TEXT,
                assets_manifest_path TEXT,
                video_path TEXT,
                tts_engine TEXT DEFAULT 'edge',
                tts_voice TEXT DEFAULT 'hi-IN-SwaraNeural',
                tts_speed REAL DEFAULT 1.0,
                bg_music_path TEXT,
                bg_music_volume REAL DEFAULT 0.15,
                project_settings TEXT,
                export_folder TEXT
            )
        """)

        # Add project_settings and export_folder to existing databases
        try:
            cursor.execute("ALTER TABLE projects ADD COLUMN video_format TEXT DEFAULT 'landscape'")
        except sqlite3.OperationalError:
            pass # Column already exists
            
        try:
            cursor.execute("ALTER TABLE projects RENAME COLUMN subtitle_settings TO project_settings")
        except sqlite3.OperationalError:
            pass # Column doesn't exist or already renamed
            
        try:
            cursor.execute("ALTER TABLE projects ADD COLUMN project_settings TEXT")
        except sqlite3.OperationalError:
            pass # Column already exists
            
        try:
            cursor.execute("ALTER TABLE projects RENAME COLUMN project_folder TO export_folder")
        except sqlite3.OperationalError:
            pass # Either project_folder doesn't exist, or export_folder already exists
            
        try:
            cursor.execute("ALTER TABLE projects ADD COLUMN export_folder TEXT")
        except sqlite3.OperationalError:
            pass # Column already exists

        # Tasks Table (Sub-tasks inside a project pipeline)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                step TEXT NOT NULL, -- 'generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render'
                status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
                progress REAL DEFAULT 0.0,
                message TEXT,
                error_message TEXT,
                updated_at TEXT NOT NULL,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Add token telemetry columns to existing databases
        try:
            cursor.execute("ALTER TABLE tasks ADD COLUMN prompt_tokens INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass # Column already exists
            
        try:
            cursor.execute("ALTER TABLE tasks ADD COLUMN completion_tokens INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass # Column already exists

        # Settings Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        
        # Insert default settings if empty or missing
        default_settings = {
            "openai_api_key": "",
            "openai_base_url": "https://api.openai.com/v1",
            "openai_model": "gpt-4o",
            "openai_temperature": "0.7",
            "openai_max_tokens": "4096",
            "openai_top_p": "1.0",
            "llm_concurrency": "3",
            "whisper_model": "base",
            "whisper_device": "cpu", # 'cpu' or 'cuda'
            "tts_engine": "edge", # 'edge' or 'xtts'
            "tts_voice": "hi-IN-SwaraNeural", # default Edge voice (Hindi)
            "tts_speed": "1.0",
            "tts_pitch": "0",
            "xtts_reference_voice": "", # XTTS reference clip path for voice cloning
            "bg_music_path": "",
            "bg_music_volume": "0.15",
            "pexels_api_key": "", # User's Pexels API Key
            "pixabay_api_key": "", # User's Pixabay API Key
            "use_pexels": True,
            "use_youtube": True, # Enabled by default, user can toggle
            "youtube_download_duration": "15",
            "web_search_enabled": False,     # Master toggle for web search
            "web_search_provider": "langsearch",  # Search provider
            "web_search_api_key": "",        # LangSearch API key
            "render_resolution": "1080p",
            "render_concurrency": "75%",
            "render_fps": "30",
            "render_crf": "23",
            "render_codec": "h264",
            "render_hardware": "cpu",
            "render_timeout": "600000"
        }
        for k, v in default_settings.items():
            cursor.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (k, json.dumps(v))
            )
            
        # Cleanup stuck pipeline runs from previous application instance
        cursor.execute("""
            UPDATE projects 
            SET status = 'cancelled' 
            WHERE status IN ('processing', 'queued')
        """)
        cursor.execute("""
            UPDATE tasks 
            SET status = 'failed', message = 'Interrupted', error_message = 'Pipeline execution interrupted by app restart.'
            WHERE status IN ('running', 'pending')
        """)
        logger.info("Database startup cleanup: marked stuck projects as cancelled and tasks as failed.")
    logger.info("Database initialized successfully.")

# Project Operations
def create_project(name, video_type, export_folder, language="hi", style="nitish_rajput", duration_mode="medium", video_format="landscape"):
    project_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    tts_engine = get_setting("tts_engine") or "edge"
    global_voice = get_setting("tts_voice")
    if global_voice and ((language == "hi" and global_voice.startswith("hi-")) or (language != "hi" and global_voice.startswith("en-"))):
        tts_voice = global_voice
    else:
        tts_voice = "hi-IN-SwaraNeural" if language == "hi" else "en-US-AndrewNeural"
            
    tts_speed = float(get_setting("tts_speed") or 1.0)
    bg_music_path = get_setting("bg_music_path") or ""
    bg_music_volume = float(get_setting("bg_music_volume") or 0.15)
    
    # Handle default styling presets
    project_settings_dict = {}
    
    # Pin whisper_model to the language-appropriate default
    whisper_model = get_setting("whisper_model") or "base"
    if language == "hi" and whisper_model in ["small", "base"]:
        whisper_model = "collabora/faster-whisper-small-hindi"
    elif language != "hi" and whisper_model == "collabora/faster-whisper-small-hindi":
        try:
            from backend.pipeline.transcribe import get_best_downloaded_whisper_model
            whisper_model = get_best_downloaded_whisper_model(fallback="small")
        except ImportError:
            whisper_model = "small"
    project_settings_dict["whisper_model"] = whisper_model
    
    default_sub_preset_id = get_setting("default_subtitle_preset_id")
    subtitle_presets = get_setting("subtitle_presets") or []
    if default_sub_preset_id and subtitle_presets:
        for preset in subtitle_presets:
            if preset.get("id") == default_sub_preset_id:
                project_settings_dict.update(preset.get("settings", {}))
                break
                
    default_brand_preset_id = get_setting("default_branding_preset_id")
    branding_presets = get_setting("branding_presets") or []
    if default_brand_preset_id and branding_presets:
        for preset in branding_presets:
            if preset.get("id") == default_brand_preset_id:
                project_settings_dict.update(preset.get("settings", {}))
                break
                
    project_settings = json.dumps(project_settings_dict) if project_settings_dict else None
        
    with get_db_connection() as conn:
        conn.execute("""
            INSERT INTO projects (id, name, prompt, created_at, updated_at, language, style, duration_mode, video_format, tts_engine, tts_voice, tts_speed, bg_music_path, bg_music_volume, project_settings, export_folder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (project_id, name, video_type, now, now, language, style, duration_mode, video_format, tts_engine, tts_voice, tts_speed, bg_music_path, bg_music_volume, project_settings, export_folder))
    logger.info(f"Created project in database: {name} (ID: {project_id}, Lang: {language}, Style: {style}, Format: {video_format}, ExportFolder: {export_folder})")
    return project_id

def get_project(project_id):
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return dict(row) if row else None

def get_all_projects():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

def update_project(project_id, **kwargs):
    kwargs['updated_at'] = datetime.utcnow().isoformat()
    columns = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values())
    values.append(project_id)
    with get_db_connection() as conn:
        conn.execute(f"UPDATE projects SET {columns} WHERE id = ?", values)
    logger.debug(f"Updated project {project_id}: {kwargs}")

def delete_project(project_id):
    with get_db_connection() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))
    logger.info(f"Deleted project {project_id} and associated tasks.")

# Task Operations
def create_task(project_id, step):
    task_id = f"{project_id}_{step}"
    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        row = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row:
            conn.execute("""
                UPDATE tasks 
                SET status = 'pending', progress = 0.0, message = 'Restarted', error_message = NULL, updated_at = ?
                WHERE id = ?
            """, (now, task_id))
        else:
            conn.execute("""
                INSERT INTO tasks (id, project_id, step, status, updated_at)
                VALUES (?, ?, ?, 'pending', ?)
            """, (task_id, project_id, step, now))
    return task_id

def get_task(task_id):
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(row) if row else None

def get_project_tasks(project_id):
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM tasks WHERE project_id = ?", (project_id,)).fetchall()
        return [dict(r) for r in rows]

def update_task(task_id, **kwargs):
    kwargs['updated_at'] = datetime.utcnow().isoformat()
    columns = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values())
    values.append(task_id)
    with get_db_connection() as conn:
        conn.execute(f"UPDATE tasks SET {columns} WHERE id = ?", values)

# Settings Operations
def get_setting(key):
    with get_db_connection() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

def get_all_settings():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {r['key']: json.loads(r['value']) for r in rows}

def update_settings(settings_dict):
    with get_db_connection() as conn:
        for k, v in settings_dict.items():
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (k, json.dumps(v))
            )
    logger.info("Application settings updated in database.")
