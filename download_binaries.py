import os
import sys
import urllib.request
import zipfile
import tempfile
import shutil
import ssl
from pathlib import Path

def download_file(url, dest_path, name="file"):
    print(f"[INFO] Downloading {name} from {url}...")
    context = ssl._create_unverified_context()
    
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    
    with urllib.request.urlopen(req, context=context) as response, open(dest_path, 'wb') as out_file:
        total_size = int(response.info().get('Content-Length', 0))
        downloaded = 0
        block_size = 1024 * 1024  # 1MB
        
        while True:
            buffer = response.read(block_size)
            if not buffer:
                break
            downloaded += len(buffer)
            out_file.write(buffer)
            
            if total_size > 0:
                percent = int(downloaded * 100 / total_size)
                sys.stdout.write(f"\rProgress: {percent}% ({downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB)")
            else:
                sys.stdout.write(f"\rProgress: {downloaded // (1024*1024)}MB")
            sys.stdout.flush()
    print("\n[SUCCESS] Download completed.")

def main():
    root_dir = Path(__file__).resolve().parent
    bin_dir = root_dir / "bin"
    bin_dir.mkdir(exist_ok=True)
    
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"
    ytdlp_exe = bin_dir / "yt-dlp.exe"
    node_exe = bin_dir / "node.exe"
    
    if ffmpeg_exe.exists() and ffprobe_exe.exists() and ytdlp_exe.exists() and node_exe.exists():
        print("[INFO] ffmpeg.exe, ffprobe.exe, yt-dlp.exe, and node.exe already exist in bin/ folder.")
        return
        
    # Gyan.dev provides reliable release builds for Windows
    ffmpeg_url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    ytdlp_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    node_url = "https://nodejs.org/dist/v20.13.1/node-v20.13.1-win-x64.zip"
    
    # 1. Download and extract FFmpeg/FFprobe if needed
    if not (ffmpeg_exe.exists() and ffprobe_exe.exists()):
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "ffmpeg.zip"
            try:
                download_file(ffmpeg_url, zip_path, "FFmpeg/FFprobe Bundle")
            except Exception as e:
                print(f"\n[ERROR] Failed to download FFmpeg: {e}")
                sys.exit(1)
                
            print("[INFO] Extracting ffmpeg.exe and ffprobe.exe...")
            try:
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    extracted_count = 0
                    for member in zip_ref.namelist():
                        filename = os.path.basename(member)
                        if filename in ["ffmpeg.exe", "ffprobe.exe"]:
                            # Extract this file to bin_dir
                            with zip_ref.open(member) as source, open(bin_dir / filename, "wb") as target:
                                shutil.copyfileobj(source, target)
                            print(f"[SUCCESS] Extracted {filename} to {bin_dir / filename}")
                            extracted_count += 1
                    if extracted_count < 2:
                        print(f"[WARNING] Only found {extracted_count} of 2 required files in the archive.")
            except Exception as e:
                print(f"[ERROR] Failed to extract archive: {e}")
                sys.exit(1)
    else:
        print("[INFO] FFmpeg and FFprobe already exist. Skipping FFmpeg download.")

    # 2. Download yt-dlp if needed
    if not ytdlp_exe.exists():
        try:
            download_file(ytdlp_url, ytdlp_exe, "yt-dlp")
            print(f"[SUCCESS] yt-dlp.exe successfully downloaded and placed in the bin/ folder!")
        except Exception as e:
            print(f"\n[ERROR] Failed to download yt-dlp: {e}")
            sys.exit(1)
    else:
        print("[INFO] yt-dlp.exe already exists. Skipping yt-dlp download.")

    # 3. Download portable Node.js if needed
    if not node_exe.exists():
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "node.zip"
            try:
                download_file(node_url, zip_path, "Node.js Portable Bundle")
            except Exception as e:
                print(f"\n[ERROR] Failed to download Node.js: {e}")
                sys.exit(1)
                
            print("[INFO] Extracting node.exe...")
            try:
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    for member in zip_ref.namelist():
                        filename = os.path.basename(member)
                        if filename == "node.exe":
                            with zip_ref.open(member) as source, open(node_exe, "wb") as target:
                                shutil.copyfileobj(source, target)
                            print(f"[SUCCESS] Extracted node.exe to {node_exe}")
                            break
            except Exception as e:
                print(f"[ERROR] Failed to extract Node.js archive: {e}")
                sys.exit(1)
    else:
        print("[INFO] node.exe already exists. Skipping Node.js download.")

    print("[SUCCESS] All required binaries are present in the bin/ folder!")

if __name__ == "__main__":
    main()
