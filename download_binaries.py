import os
import sys
import urllib.request
import zipfile
import tempfile
import shutil
import ssl
from pathlib import Path

def download_ffmpeg(url, dest_path):
    print(f"[INFO] Downloading FFmpeg from {url}...")
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
    
    if ffmpeg_exe.exists() and ffprobe_exe.exists():
        print("[INFO] ffmpeg.exe and ffprobe.exe already exist in bin/ folder.")
        return
        
    # Gyan.dev provides reliable release builds for Windows
    url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    
    with tempfile.TemporaryDirectory() as temp_dir:
        zip_path = Path(temp_dir) / "ffmpeg.zip"
        try:
            download_ffmpeg(url, zip_path)
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

    print("[SUCCESS] FFmpeg and FFprobe binaries are successfully placed in the bin/ folder!")

if __name__ == "__main__":
    main()
