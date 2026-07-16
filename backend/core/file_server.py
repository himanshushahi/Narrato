import http.server
import json
import os
import socketserver
import threading
import shutil
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

_file_server_port = None
_file_server = None
_thread = None


class MediaHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        file_path = params.get('path', [None])[0]
        if not file_path or not os.path.exists(file_path):
            self.send_response(404)
            self.end_headers()
            return

        ext = os.path.splitext(file_path)[1].lower()
        if ext not in VALID_MEDIA:
            self.send_response(400)
            self.end_headers()
            return

        content_type = CONTENT_TYPES.get(ext, 'application/octet-stream')
        file_size = os.path.getsize(file_path)
        range_header = self.headers.get('Range')

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
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
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
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.end_headers()

            try:
                with open(file_path, 'rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            except Exception:
                pass

    def log_message(self, format, *args):
        pass


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
