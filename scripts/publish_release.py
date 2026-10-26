#!/usr/bin/env python3
"""
Narrato Release Helper Script
Calculates installer SHA-256 checksum, prepares release notes, and provides
instructions or gh CLI automation for publishing to GitHub Releases.
"""

import sys
import hashlib
from pathlib import Path
import shutil
import subprocess

def compute_sha256(filepath: Path) -> str:
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()

def main():
    root_dir = Path(__file__).resolve().parent.parent
    installer_path = root_dir / "installer" / "Narrato_Setup.exe"

    print("==========================================")
    print("       NARRATO GITHUB RELEASE HELPER      ")
    print("==========================================")

    if not installer_path.exists():
        print(f"[ERROR] Installer not found at: {installer_path}")
        print("Please build the installer first using: powershell ./build.ps1")
        sys.exit(1)

    size_mb = round(installer_path.stat().st_size / (1024 * 1024), 2)
    print(f"[INFO] Found installer: {installer_path} ({size_mb} MB)")

    print("[INFO] Computing SHA-256 checksum...")
    sha256_hash = compute_sha256(installer_path)
    checksum_file = root_dir / "installer" / "Narrato_Setup.exe.sha256"
    checksum_content = f"{sha256_hash}  Narrato_Setup.exe\n"
    checksum_file.write_text(checksum_content, encoding="utf-8")
    print(f"[SUCCESS] SHA-256: {sha256_hash}")

    version = sys.argv[1] if len(sys.argv) > 1 else "v1.2.0"
    title = sys.argv[2] if len(sys.argv) > 2 else f"Narrato {version} - Local AI Documentary Studio"

    release_notes = f"""## 🎬 Narrato {version} Release

Welcome to the latest release of **Narrato** — the 100% vibe-coded, local-first AI documentary studio and declarative motion graphics engine for Windows!

### ✨ Highlights
- **100% Vibe Coded**: Crafted end-to-end with modern AI pair programming (human vision + autonomous AI agents).
- **Declarative AST Visual Engine**: Remotion-powered charts, timelines, mockups, counters, and particles with 25 macro archetypes.
- **AI Neural Voiceover & Voice Cloning**: Offline zero-shot DhVaani-0.5 voice cloning and Edge-TTS.
- **Faster-Whisper Subtitles**: Word-level synced captions with full Complex Text Layout (CTL) support for Hindi, Tamil, Bengali, and Arabic.
- **Model Context Protocol (MCP)**: Control your studio directly from Claude Code, Cursor, or Gemini CLI with 26 built-in tools.
- **Local-First & Private**: Zero cloud telemetry — runs 100% on your local machine.

### 📦 Files & Verification
- **Installer**: `Narrato_Setup.exe` (~{size_mb} MB)
- **SHA-256 Checksum**:
  ```text
  {sha256_hash}  Narrato_Setup.exe
  ```

### 🚀 Installation Instructions
1. Download `Narrato_Setup.exe` below.
2. Run the installer (Windows SmartScreen may prompt on first install — click "More info" -> "Run anyway").
3. Launch **Narrato** from your Desktop or Start Menu!
"""

    notes_path = root_dir / "installer" / "RELEASE_NOTES_TEMP.md"
    notes_path.write_text(release_notes, encoding="utf-8")
    print(f"[INFO] Release notes generated at: {notes_path}")

    # Check for gh CLI
    gh_path = shutil.which("gh")
    if gh_path:
        print(f"\n[INFO] GitHub CLI (gh) detected at: {gh_path}")
        ans = input(f"Do you want to create tag {version} and publish the release automatically now? (y/N): ").strip().lower()
        if ans == 'y':
            print(f"Creating git tag {version}...")
            subprocess.run(["git", "tag", "-a", version, "-m", title], check=True)
            print(f"Pushing git tag {version}...")
            subprocess.run(["git", "push", "origin", version], check=True)
            print("Publishing GitHub Release...")
            subprocess.run([
                "gh", "release", "create", version,
                str(installer_path), str(checksum_file),
                "--title", title,
                "--notes-file", str(notes_path)
            ], check=True)
            print("[SUCCESS] Release published successfully to GitHub!")
            if notes_path.exists():
                notes_path.unlink()
            return

    print("\n=== HOW TO PUBLISH THIS RELEASE ===")
    print("1. Push your git commits and tag:")
    print(f"   git tag -a {version} -m \"{title}\"")
    print(f"   git push origin {version}")
    print("\n2. Open GitHub Releases in your browser:")
    print("   https://github.com/himanshushahi/Narrato/releases/new")
    print(f"\n3. Enter the release details:")
    print(f"   - Tag: {version}")
    print(f"   - Title: {title}")
    print(f"   - Description: Copy contents from installer/RELEASE_NOTES_TEMP.md")
    print(f"   - Attach binary files:")
    print(f"       * {installer_path}")
    print(f"       * {checksum_file}")
    print("\n4. Click 'Publish release'!")
    print("==========================================")

if __name__ == "__main__":
    main()
