import http.server
import os
import socketserver
import threading
import queue
import shutil
import hashlib
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs

VALID_MEDIA = ('.mp3', '.wav', '.mp4', '.png', '.jpg', '.jpeg', '.gif', '.webm', '.mkv', '.mov', '.avi', '.ogg', '.webp', '.svg', '.css', '.woff2', '.ttf')

CONTENT_TYPES = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.webm': 'video/webm', '.ogg': 'audio/ogg',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

CHUNK_SIZE = 64 * 1024


def _is_loopback_origin(origin: str) -> bool:
    """True for the dev frontend (vite on localhost:5174) and the app itself.

    Media responses historically sent Access-Control-Allow-Origin: * so the dev
    frontend could read them cross-origin. A wildcard also lets ANY website open
    in the user's browser read files served on 127.0.0.1 — restrict the header
    to loopback origins only (production is same-origin and needs no CORS).
    """
    try:
        from urllib.parse import urlparse
        host = urlparse(origin).hostname or ""
        return host in ("127.0.0.1", "localhost", "::1")
    except Exception:
        return False

_file_server_port = None
_file_server = None
_thread = None


from backend.core.config import BASE_DIR
from backend.core.config import get_remotion_cache_dir, get_startupinfo, BIN_DIR
from backend.core.logger import logger
import json

# ── On-demand thumbnails ──────────────────────────────────────────────
# The editor browser shows many media assets at once (hundreds for long
# videos). Serving them at full resolution decodes hundreds of MB and
# stalls the UI. `?path=<file>&thumb=1` serves a small cached JPEG
# (images via Pillow, video poster frame via ffmpeg) instead.
THUMB_WIDTH = 320

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'}
VIDEO_EXTS = {'.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v'}

_thumb_lock = threading.Lock()


def _get_ffmpeg_path() -> str:
    exe = BIN_DIR / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    return str(exe) if exe.exists() else "ffmpeg"


def _thumbnail_path_for(media_path: Path):
    """Cache key includes file identity (mtime+size) so re-downloaded
    assets regenerate their thumbnail automatically.

    Returns None if the media file vanished (e.g. a re-download swapped
    the file between the existence check and here) — callers must handle
    it instead of crashing the request."""
    try:
        stat = media_path.stat()
    except OSError:
        return None
    raw = f"{media_path}|{stat.st_mtime_ns}|{stat.st_size}"
    key = hashlib.md5(raw.encode('utf-8')).hexdigest()[:20]
    cache_dir = get_remotion_cache_dir() / "thumbs"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{key}.jpg"


def _placeholder_thumb_path() -> Path:
    """One-shot placeholder JPEG served while a video thumbnail is generating
    in the background. NOTE: this is a separate file with its own ETag — once
    the real thumbnail exists the browser does NOT magically revalidate to it;
    the client must re-request the URL (MediaSidebar retries video thumbs with
    a cache-buster) for the real thumb to be served."""
    cache_dir = get_remotion_cache_dir() / "thumbs"
    cache_dir.mkdir(parents=True, exist_ok=True)
    placeholder = cache_dir / "_placeholder.jpg"
    if not placeholder.exists():
        with _thumb_lock:
            if not placeholder.exists():
                try:
                    from PIL import Image
                    img = Image.new("RGB", (THUMB_WIDTH, THUMB_WIDTH), (28, 25, 23))
                    img.save(placeholder, "JPEG", quality=70)
                except Exception:
                    return None
    return placeholder


_thumb_queue = queue.Queue()
_thumb_worker_started = False
# Thumb paths currently queued or generating — dedupes the duplicate ffmpeg
# jobs that repeated client retries would otherwise enqueue.
_thumb_in_flight = set()


def _enqueue_thumbnail(media_path: Path, thumb_path: Path, ext: str):
    key = str(thumb_path)
    with _thumb_lock:
        if key in _thumb_in_flight:
            return
        _thumb_in_flight.add(key)
    _thumb_queue.put((media_path, thumb_path, ext))


def _ensure_thumbnail_worker():
    global _thumb_worker_started
    if _thumb_worker_started:
        return
    with _thumb_lock:
        if _thumb_worker_started:
            return
        _thumb_worker_started = True

        def worker():
            while True:
                media_path, thumb_path, ext = _thumb_queue.get()
                try:
                    _generate_thumbnail(media_path, thumb_path, ext)
                except Exception:
                    logger.warning(f"Background thumbnail generation failed for {media_path}")
                finally:
                    with _thumb_lock:
                        _thumb_in_flight.discard(str(thumb_path))
                    _thumb_queue.task_done()

        threading.Thread(target=worker, daemon=True).start()


def _etag_for(media_path: Path, file_size: int) -> str:
    """Weak ETag from file identity — lets the browser revalidate cheaply."""
    try:
        stat = media_path.stat()
        tag = f"{stat.st_mtime_ns:x}-{stat.st_size:x}"
    except Exception:
        tag = f"x-{file_size:x}"
    return f'W/"{tag}"'


def _generate_thumbnail(media_path: Path, thumb_path: Path, ext: str) -> bool:
    try:
        if ext in VIDEO_EXTS:
            cmd = [
                _get_ffmpeg_path(), "-y",
                "-ss", "0.5",
                "-i", str(media_path),
                "-vf", f"scale={THUMB_WIDTH}:-2",
                "-frames:v", "1",
                "-q:v", "5",
                str(thumb_path),
            ]
            subprocess.run(cmd, capture_output=True, timeout=20, startupinfo=get_startupinfo())
        else:
            from PIL import Image
            with Image.open(media_path) as img:
                img = img.convert("RGB")
                img.thumbnail((THUMB_WIDTH, THUMB_WIDTH))
                img.save(thumb_path, "JPEG", quality=70)
        return thumb_path.exists() and thumb_path.stat().st_size > 0
    except Exception as e:
        logger.warning(f"Thumbnail generation failed for {media_path}: {e}")
        return False

class MediaHandler(http.server.BaseHTTPRequestHandler):
    def _send_thumb(self, thumb_path: Path):
        """Serve a thumbnail JPEG with revalidation-friendly headers.

        no-cache: the client retries the thumb URL (with a cache-buster)
        until the real thumbnail replaces the placeholder; ETag keeps those
        retries cheap via 304."""
        thumb_size = thumb_path.stat().st_size
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(thumb_size))
        origin = self.headers.get('Origin', '')
        if _is_loopback_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('ETag', _etag_for(thumb_path, thumb_size))
        self.send_header('Cache-Control', 'private, no-cache')
        self.end_headers()
        with open(thumb_path, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)

    def do_GET(self):
        parsed = urlparse(self.path)
        
        # keep_blank_values: a bare `?path=` must still take the media branch
        # (it 404s there), exactly like the old startswith('path=') check.
        params = parse_qs(parsed.query, keep_blank_values=True)

        # 0. Handle API endpoints
        if parsed.path == '/api/icons/search':
            from backend.pipeline.icons import search_lucide_icons
            query = params.get('q', [''])[0]
            try:
                limit = int(params.get('limit', [12])[0])
            except (ValueError, TypeError):
                limit = 12
            results = search_lucide_icons(query, limit=limit)
            body = json.dumps({"query": query, "icons": results}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == '/api/sfx/search':
            try:
                from backend.pipeline.sfx import search_sfx
                query = params.get('q', [''])[0].strip()
                if not query:
                    raise ValueError("Missing required 'q' (search query) parameter.")
                try:
                    limit = int(params.get('limit', [10])[0])
                except (ValueError, TypeError):
                    limit = 10
                sort = params.get('sort', ['downloads_desc'])[0]
                license_filter = params.get('license', [''])[0]
                result = {"success": True,
                          **search_sfx(query, limit=limit, sort=sort, license_filter=license_filter)}
            except Exception as e:
                result = {"success": False, "query": params.get('q', [''])[0],
                          "sfx": [], "source": "freesound", "error": str(e)}
            body = json.dumps(result).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 1. Handle frontend files from URL path. A request is media ONLY when
        # it carries a `path` query parameter — checking membership (not a
        # startswith prefix) so future extra query params can't misroute a
        # media URL into the frontend branch (which would serve index.html).
        if 'path' not in params:
            path = parsed.path
            if path == '/':
                path = '/index.html'
            
            from pathlib import Path
            project_root = Path(__file__).resolve().parent.parent.parent
            if (project_root / "_internal").exists():
                web_dir = project_root / "_internal" / "frontend" / "dist"
            else:
                web_dir = project_root / "frontend" / "dist"
            
            local_path = (web_dir / path.lstrip('/')).resolve()
            # Windows paths are case-insensitive: compare with normcase so a
            # differently-cased URL can neither escape the web root nor get
            # spuriously misrouted to index.html.
            if os.name == 'nt':
                within_root = os.path.normcase(str(local_path)).startswith(
                    os.path.normcase(str(web_dir.resolve())))
            else:
                within_root = str(local_path).startswith(str(web_dir.resolve()))
            if not within_root:
                local_path = web_dir / "index.html"
            elif not local_path.exists():
                local_path = web_dir / "index.html"
            
            if local_path.exists():
                if local_path.name == "index.html":
                    with open(local_path, 'r', encoding='utf-8') as f:
                        html_content = f.read()
                    from backend.core.prefs import load_prefs
                    prefs_data = load_prefs()
                    # json.dumps does not escape < > & — a pref value containing
                    # "</script>" would break out of this inline <script> and
                    # inject markup into the app window (self-XSS). Emit them as
                    # \uXXXX escapes: still valid JSON, decoded back by JS.
                    prefs_json = (
                        json.dumps(prefs_data)
                        .replace('<', '\\u003c')
                        .replace('>', '\\u003e')
                        .replace('&', '\\u0026')
                    )
                    injection = f"<script>window.__INITIAL_PREFS__ = {prefs_json};</script>"
                    html_content = html_content.replace('</head>', f'{injection}</head>')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html')
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                    self.end_headers()
                    self.wfile.write(html_content.encode('utf-8'))
                    return
                else:
                    ext = local_path.suffix.lower()
                    if ext == '.js': ctype = 'application/javascript'
                    elif ext == '.css': ctype = 'text/css'
                    elif ext == '.ico': ctype = 'image/x-icon'
                    elif ext == '.svg': ctype = 'image/svg+xml'
                    else: ctype = CONTENT_TYPES.get(ext, 'application/octet-stream')
                    
                    self.send_response(200)
                    self.send_header('Content-Type', ctype)
                    self.send_header('Content-Length', str(local_path.stat().st_size))
                    self.send_header('Cache-Control', 'max-age=3600')
                    self.end_headers()
                    with open(local_path, 'rb') as f:
                        shutil.copyfileobj(f, self.wfile)
                    return
            else:
                # During development if frontend dist doesn't exist, we might hit here.
                self.send_response(404)
                self.end_headers()
                return

        # 2. Handle media via ?path=
        file_path = params.get('path', [None])[0]
        if not file_path:
            self.send_response(404)
            self.end_headers()
            return

        # Security: Prevent arbitrary file read (Issue 8)
        from pathlib import Path
        try:
            resolved_path = Path(file_path).resolve()
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        if not resolved_path.exists():
            self.send_response(404)
            self.end_headers()
            return

        ext = resolved_path.suffix.lower()
        if ext not in VALID_MEDIA:
            self.send_response(400)
            self.end_headers()
            return

        allowed = False
        if resolved_path.is_relative_to(BASE_DIR.resolve()):
            allowed = True
        else:
            from backend.core.prefs import load_prefs
            prefs = load_prefs()
            export_folder = prefs.get("export_folder")
            if export_folder:
                try:
                    if resolved_path.is_relative_to(Path(export_folder).resolve()):
                        allowed = True
                except Exception:
                    pass

        if not allowed:
            try:
                from backend.database.db import get_db_connection
                with get_db_connection() as conn:
                    rows = conn.execute("SELECT video_path, audio_path, bg_music_path, export_folder FROM projects").fetchall()
                    for r in rows:
                        if r['video_path'] and resolved_path == Path(r['video_path']).resolve():
                            allowed = True; break
                        if r['audio_path'] and resolved_path == Path(r['audio_path']).resolve():
                            allowed = True; break
                        if r['bg_music_path'] and resolved_path == Path(r['bg_music_path']).resolve():
                            allowed = True; break
                        if r['export_folder']:
                            try:
                                if resolved_path.is_relative_to(Path(r['export_folder']).resolve()):
                                    allowed = True; break
                            except Exception:
                                pass
            except Exception:
                pass

        # Allow any existing valid media file requested by the media player
        if not allowed and ext in VALID_MEDIA:
            allowed = True

        if not allowed:
            self.send_response(403)
            self.end_headers()
            return

        # Thumbnail request: serve the cached JPEG if present; otherwise
        # generate image thumbs inline (Pillow, ~5ms) and queue only video
        # poster frames (ffmpeg is slow). Video generation must NEVER block
        # the request thread — hundreds of thumbs on first load would
        # serialize 20s ffmpeg jobs and freeze the whole app.
        if 'thumb' in params and (ext in IMAGE_EXTS or ext in VIDEO_EXTS):
            thumb_path = _thumbnail_path_for(resolved_path)
            if thumb_path is not None and thumb_path.exists():
                try:
                    self._send_thumb(thumb_path)
                    return
                except Exception:
                    pass
            if thumb_path is not None:
                if ext in IMAGE_EXTS:
                    # Images are cheap: generate inline so the first request
                    # returns the real thumbnail. A placeholder would never
                    # refresh on its own — the browser only revalidates when
                    # the URL is requested again.
                    if _generate_thumbnail(resolved_path, thumb_path, ext):
                        try:
                            self._send_thumb(thumb_path)
                            return
                        except Exception:
                            pass
                else:
                    _ensure_thumbnail_worker()
                    _enqueue_thumbnail(resolved_path, thumb_path, ext)
            placeholder = _placeholder_thumb_path()
            if placeholder is not None:
                try:
                    self._send_thumb(placeholder)
                    return
                except Exception:
                    pass

        content_type = CONTENT_TYPES.get(ext, 'application/octet-stream')
        try:
            file_size = resolved_path.stat().st_size
        except OSError:
            # Media file vanished between the existence check and here (e.g.
            # a re-download swapped it in place) — never crash the handler.
            self.send_response(404)
            self.end_headers()
            return
        file_path = str(resolved_path)
        range_header = self.headers.get('Range')

        # Revalidate: media must never be served stale. Assets are re-downloaded
        # in place by the pipeline while the app runs; `max-age` caching would
        # serve the OLD bytes (or heuristically-cached 404s during a download)
        # for the cache lifetime — seen as black/empty frames. `no-cache` keeps
        # the browser round-trip cheap via If-None-Match → 304.
        etag = _etag_for(resolved_path, file_size)
        if_none_match = self.headers.get('If-None-Match')
        if if_none_match and etag in [t.strip() for t in if_none_match.split(',')]:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'private, no-cache')
            self.end_headers()
            return

        if range_header:
            try:
                range_val = range_header.replace('bytes=', '').strip()
                parts = range_val.split('-')
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
            except (ValueError, IndexError):
                start = 0
                end = file_size - 1

            if start >= file_size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{file_size}')
                self.end_headers()
                return

            chunk_size = end - start + 1
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', str(chunk_size))
            self.send_header('Content-Type', content_type)
            origin = self.headers.get('Origin', '')
            if _is_loopback_origin(origin):
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('ETag', etag)
            # no-cache: see revalidation note above — stale media is the #1
            # cause of black/empty frames in the preview.
            self.send_header('Cache-Control', 'private, no-cache')
            self.end_headers()

            try:
                with open(file_path, 'rb') as f:
                    f.seek(start)
                    remaining = chunk_size
                    while remaining > 0:
                        chunk = f.read(min(CHUNK_SIZE, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except Exception:
                pass
        else:
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(file_size))
            origin = self.headers.get('Origin', '')
            if _is_loopback_origin(origin):
                self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('ETag', etag)
            # no-cache: see revalidation note above — stale media is the #1
            # cause of black/empty frames in the preview.
            self.send_header('Cache-Control', 'private, no-cache')
            self.end_headers()

            try:
                with open(file_path, 'rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            except Exception:
                pass

    def log_message(self, format, *args):
        logger.debug("FileServer: " + (format % args))


def start_file_server():
    global _file_server_port, _file_server, _thread
    if _file_server is not None:
        return _file_server_port

    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    _file_server_port = sock.getsockname()[1]
    sock.close()

    _file_server = socketserver.ThreadingTCPServer(('127.0.0.1', _file_server_port), MediaHandler)
    _thread = threading.Thread(target=_file_server.serve_forever, daemon=True)
    _thread.start()
    return _file_server_port


def stop_file_server():
    global _file_server, _file_server_port, _thread
    if _file_server:
        _file_server.shutdown()
        _file_server = None
        _file_server_port = None
        _thread = None


def get_file_server_port():
    return _file_server_port
