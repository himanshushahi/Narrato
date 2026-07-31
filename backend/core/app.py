import os
import sys
import time
import threading
import ctypes
from ctypes import wintypes
import webview

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.database.db import init_db
from backend.pipeline.queue import global_queue_manager
from backend.core.bridge import ApiBridge, setup_bridge_callbacks, ui_update_loop
from backend.core.logger import logger
from backend.core.file_server import start_file_server, get_file_server_port
from backend.core.config import BASE_DIR, BUNDLE_DIR
from backend.core.power import power_manager

NUM_WINDOWS = int(os.environ.get("NARRATO_NUM_WINDOWS", "1"))

WINDOW_PROPS = dict(
    width=1280,
    height=800,
    resizable=True,
    easy_drag=False,
    min_size=(900, 600),
)


def _get_icon_path():
    # In development, use public/. In production, use dist/
    icon_pub = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "logo.ico")
    icon_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist", "logo.ico")
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        icon_frozen = os.path.join(exe_dir, "_internal", "frontend", "dist", "logo.ico")
        if os.path.exists(icon_frozen): return icon_frozen
    if os.path.exists(icon_dist): return icon_dist
    if os.path.exists(icon_pub): return icon_pub
    return None


def _get_free_port():
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def _unstack_taskbar_windows():
    """Apply WS_EX_APPWINDOW to each Narrato window so they appear as
    separate taskbar entries rather than stacking under one icon."""
    time.sleep(1)

    user32 = ctypes.windll.user32
    GWL_EXSTYLE = -20
    WS_EX_APPWINDOW = 0x00040000

    found = []

    def enum_callback(hwnd, _):
        length = user32.GetWindowTextLengthW(hwnd) + 1
        buffer = ctypes.create_unicode_buffer(length)
        user32.GetWindowTextW(hwnd, buffer, length)
        if buffer.value.startswith("Narrato"):
            found.append(hwnd)
        return True

    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(callback_type(enum_callback), 0)

    for hwnd in found:
        style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        new_style = style | WS_EX_APPWINDOW
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_style)


def _create_windows(url_or_path):
    bridges = [ApiBridge(window_id=i) for i in range(NUM_WINDOWS)]
    windows = []
    for i, bridge in enumerate(bridges):
        title = "Narrato" if i == 0 else f"Narrato - Viewport {i + 1}"
        window = webview.create_window(title, url_or_path, js_api=bridge, **WINDOW_PROPS)
        bridge._window = window
        windows.append(window)
    return bridges, windows


def main():
    logger.info("Starting Narrato...")

    power_manager.start()
    init_db()

    setup_bridge_callbacks()

    ui_thread = threading.Thread(target=ui_update_loop, daemon=True)
    ui_thread.start()

    global_queue_manager.start()

    file_server_port = start_file_server()
    logger.info(f"Media file server started on port {file_server_port}")

    icon_path = _get_icon_path()
    env = os.environ.get("ENVIRONMENT", "development")

    threading.Thread(target=_unstack_taskbar_windows, daemon=True).start()

    pywebview_port = _get_free_port()

    if env == "development":
        dev_url = "http://localhost:5174"
        try:
            _create_windows(dev_url)
            webview.start(debug=True, private_mode=False, icon=icon_path, storage_path=str(BASE_DIR / "webview_data"), http_port=pywebview_port)
        except Exception as e:
            logger.error(f"pywebview start failed (ensure Vite is running on port 5174): {e}")
    else:

        # Use file server to serve frontend dynamically without copying (Issue 4)
        local_url = f"http://127.0.0.1:{file_server_port}/"
        logger.info(f"Starting pywebview with production build via: {local_url}")
        
        try:
            _create_windows(local_url)
            webview.start(debug=False, private_mode=False, icon=icon_path, storage_path=str(BASE_DIR / "webview_data"), http_port=pywebview_port)
        except (SystemExit, KeyboardInterrupt):
            logger.info("Application closed by user.")

    logger.info("Stopping background tasks and cleaning up on close...")
    global_queue_manager.stop()
    from backend.core.file_server import stop_file_server
    stop_file_server()
    logger.info("Goodbye!")


if __name__ == "__main__":
    main()
