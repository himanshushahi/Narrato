import os
import sys
import eel

# Ensure python finds modules in parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.database.db import init_db
from backend.pipeline.queue import global_queue_manager
from backend.core.bridge import setup_bridge_callbacks
from backend.core.logger import logger

# Expose static media serving via Eel's internal Bottle instance
# This handles files like project voiceovers, stock images/videos, and background music
@eel.btl.route('/api/media')
def serve_media():
    import bottle
    file_path = bottle.request.query.get('path')
    if not file_path:
        return bottle.HTTPError(400, "Missing path parameter")
        
    # Clean path and verify exists
    file_path = os.path.abspath(file_path)
    if not os.path.exists(file_path):
        return bottle.HTTPError(404, "File not found")
        
    # Security check: verify file extension is a media file
    valid_exts = ('.wav', '.mp3', '.mp4', '.mkv', '.mov', '.webm', '.avi', '.ogg', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.css', '.woff2', '.ttf')
    if not file_path.lower().endswith(valid_exts):
        return bottle.HTTPError(400, "Invalid file format")
        
    dirname = os.path.dirname(file_path)
    filename = os.path.basename(file_path)
    response = bottle.static_file(filename, root=dirname)
    # Prevent Chrome disk-cache issues during Remotion headless rendering
    response.set_header('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.set_header('Access-Control-Allow-Origin', '*')
    return response

def main():
    logger.info("Starting RenderFlow Studio...")
    
    # 1. Initialize DB tables
    init_db()
    
    # 2. Setup callback links for Eel
    setup_bridge_callbacks()
    
    # 3. Spin up background queue worker
    global_queue_manager.start()
    
    env = os.environ.get("ENVIRONMENT", "development")
    logger.info(f"App environment set to: {env}")
    
    if env == "development":
        # In dev, the React app runs via Vite on 5173
        dummy_dir = os.path.join(os.path.dirname(__file__), "dummy")
        os.makedirs(dummy_dir, exist_ok=True)
        eel.init(dummy_dir, allowed_extensions=[])

        # Explicitly register exposed JS functions so Eel's Python side knows they exist.
        funcs = ["on_log_stream", "on_progress_update", "on_kokoro_download_progress", "on_whisper_download_progress", "on_ytdlp_update_progress"]
        eel._js_functions = funcs
        for f in funcs:
            eel._import_js_function(f)

        try:
            logger.info("Connecting Eel to Vite dev server at http://localhost:5173...")
            eel.start(
                {
                    "scheme": "http",
                    "host": "localhost",
                    "port": 5173,
                    "path": ""
                },
                host="127.0.0.1",
                port=8888,
                mode="chrome",
                shutdown_delay=2.0
            )
        except Exception as e:
            logger.error(f"Eel start failed (ensure Vite is running on port 5173 first): {e}")
    else:
        # Production build mode: point to the built 'web' folder (compiled React code)
        from backend.core.config import BUNDLE_DIR
        web_dir = os.path.join(BUNDLE_DIR, "frontend", "dist")
        if not os.path.exists(web_dir):
            web_dir = os.path.join("frontend", "dist")
            
        logger.info(f"Initializing Eel pointing to compiled web directory: {web_dir}")
        eel.init(web_dir, allowed_extensions=[])
        
        # Explicitly register exposed JS functions so Eel's Python side knows they exist in production.
        funcs = ["on_log_stream", "on_progress_update", "on_kokoro_download_progress", "on_whisper_download_progress", "on_ytdlp_update_progress"]
        eel._js_functions = funcs
        for f in funcs:
            eel._import_js_function(f)
        
        try:
            eel.start(
                "index.html",
                size=(1280, 800),
                shutdown_delay=2.0
            )
        except (SystemExit, KeyboardInterrupt):
            logger.info("Application closed by user.")
            
    # Shutdown queue worker nicely on exit
    logger.info("Stopping background tasks and cleaning up on close...")
    global_queue_manager.stop()
    logger.info("Goodbye!")

if __name__ == "__main__":
    main()
