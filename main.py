import os
import sys
import subprocess

class NullWriter:
    def write(self, text):
        pass
    def flush(self):
        pass

# Avoid crashes when running in windowed modes on Windows where stdout/stderr are None
if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()

def ensure_virtual_env():
    # If the script is running inside a PyInstaller frozen state, do not use venv.
    if getattr(sys, 'frozen', False):
        return

    # Detect if we are already inside the virtual environment
    in_venv = (sys.prefix != sys.base_prefix)
    if in_venv:
        return

    # Check if a local .venv folder exists
    root_dir = os.path.dirname(os.path.abspath(__file__))
    venv_dir = os.path.join(root_dir, ".venv")
    venv_python = os.path.join(venv_dir, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv_dir, "bin", "python")

    if os.path.exists(venv_python):
        print(f"[INFO] Launching app via virtual environment: {venv_python}")
        try:
            script_path = os.path.abspath(sys.argv[0])
            result = subprocess.run([os.path.abspath(venv_python), script_path] + sys.argv[1:])
            sys.exit(result.returncode)
        except Exception as e:
            print(f"[ERROR] Failed to run with virtual environment: {e}")
            sys.exit(1)
    else:
        print("[WARNING] Local virtual environment (.venv) was not found. Please run 'python setup.py' to initialize dependencies.")

def main():
    # Set AppUserModelID for correct taskbar icon grouping in Windows
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("himanshushahi.narrato.1.0")
        except Exception:
            pass

    # 1. Enforce virtual environment running
    ensure_virtual_env()

    # 2. Determine and assign Environment mode
    is_dev = len(sys.argv) > 1 and sys.argv[1].lower() == "dev"
    if is_dev:
        os.environ["ENVIRONMENT"] = "development"
    else:
        os.environ["ENVIRONMENT"] = "production"

    # 3. Load and launch pywebview backend app
    from backend.core.app import main as run_app
    run_app()

if __name__ == "__main__":
    main()
