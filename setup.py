import os
import sys
import subprocess
import shutil

def ensure_virtual_env():
    # Detect if we are already in a virtual environment
    in_venv = (sys.prefix != sys.base_prefix)
    
    if in_venv:
        print("[SUCCESS] Already running inside virtual environment.")
        return
        
    # We are not in a venv. Check if .venv exists
    venv_dir = os.path.join(os.path.dirname(__file__), ".venv")
    venv_python = os.path.join(venv_dir, "Scripts", "python.exe") if os.name == "nt" else os.path.join(venv_dir, "bin", "python")
    
    if not os.path.exists(venv_dir):
        print(f"[INFO] Creating a new Python virtual environment in: {venv_dir}")
        try:
            subprocess.run([sys.executable, "-m", "venv", ".venv"], check=True)
            print("[SUCCESS] Virtual environment created successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to create virtual environment: {e}")
            return
            
    if os.path.exists(venv_python):
        print("[INFO] Re-spawning setup process inside virtual environment...")
        try:
            script_path = os.path.abspath(sys.argv[0])
            result = subprocess.run([os.path.abspath(venv_python), script_path] + sys.argv[1:])
            sys.exit(result.returncode)
        except Exception as e:
            print(f"[ERROR] Failed to re-spawn in virtual environment: {e}")


def check_python_dependencies():
    print("=== Checking Python Dependencies ===")
    try:
        import webview
        import faster_whisper
        import edge_tts
        import TTS  # coqui-tts (XTTS v2 voice cloning)
        import huggingface_hub
        import soundfile
        import numpy
        import torch
        import requests
        import psutil
        print("[SUCCESS] All python packages are installed.")
        return True
    except ImportError as e:
        print(f"[INFO] Missing dependency: {e.name}")
        print("Running: pip install -r requirements.txt")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
            print("[SUCCESS] Dependencies installed successfully.")
            return True
        except Exception as ex:
            print(f"[ERROR] Failed to install dependencies automatically: {ex}")
            print("Please run: pip install -r requirements.txt manually.")
            return False

def check_ffmpeg():
    print("\n=== Checking FFmpeg ===")
    
    # Check local bin first
    bin_ext = ".exe" if os.name == "nt" else ""
    local_ffmpeg = os.path.join(os.path.dirname(__file__), "bin", f"ffmpeg{bin_ext}")
    
    if os.path.exists(local_ffmpeg):
        print(f"[SUCCESS] Found local bundled FFmpeg at: {local_ffmpeg}")
        return True
        
    # Check system path
    ffmpeg_in_path = shutil.which("ffmpeg")
    if ffmpeg_in_path:
        print(f"[SUCCESS] Found system FFmpeg in PATH: {ffmpeg_in_path}")
        return True
        
    print("[ERROR] FFmpeg was not found on your system or in './bin/'.")
    print("To install FFmpeg and FFprobe automatically, please run:")
    print("  python download_binaries.py")
    print("Alternatively, place static builds inside the './bin/' folder of this directory.")
    return False

def check_ytdlp():
    print("\n=== Checking yt-dlp ===")
    
    # Check local bin first
    bin_ext = ".exe" if os.name == "nt" else ""
    local_ytdlp = os.path.join(os.path.dirname(__file__), "bin", f"yt-dlp{bin_ext}")
    
    if os.path.exists(local_ytdlp):
        print(f"[SUCCESS] Found local bundled yt-dlp at: {local_ytdlp}")
        return True
        
    # Check system path
    ytdlp_in_path = shutil.which("yt-dlp")
    if ytdlp_in_path:
        print(f"[SUCCESS] Found system yt-dlp in PATH: {ytdlp_in_path}")
        return True
        
    print("[ERROR] yt-dlp was not found on your system or in './bin/'.")
    print("To install yt-dlp automatically, please run:")
    print("  python download_binaries.py")
    return False

def check_node_dependencies():
    print("\n=== Checking Node/React/Remotion Dependencies ===")
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
    node_modules = os.path.join(frontend_dir, "node_modules")
    
    if os.path.exists(node_modules):
        print("[SUCCESS] Frontend node_modules are already installed.")
        return True
        
    print("[INFO] Frontend node_modules are missing.")
    print("Running 'npm install' inside the frontend folder...")
    try:
        # Check npm availability
        npm_bin = shutil.which("npm")
        if not npm_bin:
            print("[ERROR] NPM not found in your system PATH. Please install Node.js (v18+) to run the frontend developer tools and Remotion renderer.")
            return False
            
        subprocess.run(["npm", "install"], cwd=frontend_dir, shell=True, check=True)
        print("[SUCCESS] Node dependencies installed successfully.")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to install node dependencies: {e}")
        print("Please run: cd frontend; npm install manually.")
        return False

def main():
    # Enforce virtual environment usage
    ensure_virtual_env()

    print("==========================================")
    print("      Narrato Setup Helper      ")
    print("==========================================\n")
    
    deps_ok = check_python_dependencies()
    ffmpeg_ok = check_ffmpeg()
    ytdlp_ok = check_ytdlp()
    node_ok = check_node_dependencies()
    
    print("\n==========================================")
    if deps_ok and ffmpeg_ok and ytdlp_ok and node_ok:
        print(" STATUS: Ready to launch!")
        print("==========================================")
        print("To run the application in development mode:")
        print("1. Terminal 1: Start Vite (cd frontend; npm run dev)")
        print("2. Terminal 2: Run Python (python main.py dev)")
        print("\nTo run the application in local production mode:")
        print("1. Compile react: cd frontend; npm run build")
        print("2. Run Python: python main.py")
        print("\nTo bundle for standalone Windows distribution:")
        print("1. Run: powershell ./build.ps1")
    else:
        print(" STATUS: Action required before launching!")
        print("==========================================")
        print("Please fix the issues highlighted above and run setup.py again.")

if __name__ == "__main__":
    main()
