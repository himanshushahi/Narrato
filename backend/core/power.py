import time
import threading
import ctypes
import os
import functools
from backend.core.logger import logger

class PowerManager:
    def __init__(self):
        self.last_activity = time.time()
        self.active_tasks = 0
        self.timeout_seconds = 60
        self.is_awake = False
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        
        if os.name == 'nt':
            try:
                ctypes.windll.kernel32.SetThreadExecutionState.argtypes = [ctypes.c_uint]
                ctypes.windll.kernel32.SetThreadExecutionState.restype = ctypes.c_uint
            except Exception as e:
                logger.warning(f"Could not configure SetThreadExecutionState: {e}")

    def ping(self):
        """Called by background tasks reporting progress to keep system awake."""
        self.last_activity = time.time()

    def acquire(self):
        """Called when a synchronous endpoint starts."""
        with self._lock:
            self.active_tasks += 1

    def release(self):
        """Called when a synchronous endpoint finishes."""
        with self._lock:
            self.active_tasks = max(0, self.active_tasks - 1)

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()

    def _monitor_loop(self):
        while self._running:
            now = time.time()
            with self._lock:
                active = self.active_tasks
                
            should_be_awake = (active > 0) or ((now - self.last_activity) < self.timeout_seconds)
            
            if should_be_awake:
                if not self.is_awake or os.name == 'nt':
                    if os.name == 'nt':
                        try:
                            # 0x80000003 = ES_CONTINUOUS (0x80000000) | ES_DISPLAY_REQUIRED (0x00000002) | ES_SYSTEM_REQUIRED (0x00000001)
                            # ES_DISPLAY_REQUIRED is crucial for Modern Standby systems to prevent sleep
                            ctypes.windll.kernel32.SetThreadExecutionState(0x80000003)
                        except Exception as e:
                            logger.error(f"SetThreadExecutionState(enable) failed: {e}")
                    if not self.is_awake:
                        self.is_awake = True
                        logger.debug(f"Sleep prevention ENABLED (Tasks: {active}).")
            elif self.is_awake:
                if os.name == 'nt':
                    try:
                        # 0x80000000 = ES_CONTINUOUS
                        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
                    except Exception as e:
                        logger.error(f"SetThreadExecutionState(disable) failed: {e}")
                self.is_awake = False
                logger.debug("Sleep prevention DISABLED (Idle).")
            
            time.sleep(10)

power_manager = PowerManager()

def auto_instrument_bridge(cls):
    """Class decorator to auto-wrap all public ApiBridge methods with acquire/release."""
    for name in dir(cls):
        if name.startswith('_'):
            continue
        attr = getattr(cls, name)
        if callable(attr):
            def make_wrapper(fn):
                @functools.wraps(fn)
                def wrapper(*args, **kwargs):
                    power_manager.acquire()
                    try:
                        return fn(*args, **kwargs)
                    finally:
                        power_manager.release()
                return wrapper
            setattr(cls, name, make_wrapper(attr))
    return cls
