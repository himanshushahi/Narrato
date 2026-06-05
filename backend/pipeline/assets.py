import os
import json
import requests
import subprocess
from pathlib import Path
from backend.database.db import get_setting, get_project, update_project
from backend.core.logger import logger
from backend.core.config import get_ytdlp_path, get_ffmpeg_path

def search_pexels_photo(query, api_key):
    """Searches Pexels for a photo matching the query. Returns url to download."""
    if not api_key:
        return None
    url = f"https://api.pexels.com/v1/search?query={requests.utils.quote(query)}&per_page=1"
    headers = {"Authorization": api_key}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        res.raise_for_status()
        data = res.json()
        photos = data.get("photos", [])
        if photos:
            # Return high res or medium res
            return photos[0].get("src", {}).get("large2x") or photos[0].get("src", {}).get("original")
    except Exception as e:
        logger.warning(f"Pexels photo search failed for '{query}': {e}")
    return None

def search_pexels_video(query, api_key):
    """Searches Pexels for a video matching the query. Returns download url."""
    if not api_key:
        return None
    url = f"https://api.pexels.com/videos/search?query={requests.utils.quote(query)}&per_page=1"
    headers = {"Authorization": api_key}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        res.raise_for_status()
        data = res.json()
        videos = data.get("videos", [])
        if videos:
            video_files = videos[0].get("video_files", [])
            # Filter for mp4 and hd or sd
            mp4_files = [vf for vf in video_files if vf.get("file_type") == "video/mp4"]
            if mp4_files:
                # Try to get hd resolution if possible
                hd_files = [vf for vf in mp4_files if vf.get("quality") == "hd"]
                if hd_files:
                    return hd_files[0].get("link")
                return mp4_files[0].get("link")
    except Exception as e:
        logger.warning(f"Pexels video search failed for '{query}': {e}")
    return None

def download_youtube_video(query, dest_path, start_offset=15, duration=15):
    """
    Downloads a short clip from YouTube matching the query using yt-dlp.
    Quality defaults to 1080p, falls back to 720p or lower.
    Downloads the segment after start_offset seconds.
    """
    ytdlp_path = get_ytdlp_path()
    ffmpeg_path = get_ffmpeg_path()
    
    logger.info(f"download_youtube_video: Query='{query}', start_offset={start_offset}, duration={duration}")
    
    start_sec = start_offset
    end_sec = start_sec + duration
    
    # We build the download-sections string: e.g. "*15-30" or "*0-15"
    sections_str = f"*{start_sec}-{end_sec}"
    
    cmd = [
        ytdlp_path,
        f"ytsearch1:{query}",
        "-f", "mp4[height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "--max-downloads", "1",
        "--no-playlist",
        "--download-sections", sections_str,
        "--force-keyframes-at-cuts",
        "--merge-output-format", "mp4",
        "--ffmpeg-location", ffmpeg_path,
        "--no-warnings",
        "-o", str(dest_path)
    ]
    
    try:
        logger.info(f"Executing yt-dlp command: {' '.join(cmd)}")
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
        
        # Prioritize checking if the file was downloaded successfully (yt-dlp may return non-zero when aborting remaining search items)
        if dest_path.exists() and dest_path.stat().st_size > 0:
            logger.info(f"Successfully downloaded YouTube clip to {dest_path}")
            return True
            
        if res.returncode != 0:
            logger.error(f"yt-dlp failed with returncode {res.returncode}. stderr: {res.stderr}")
            return False
            
        logger.error(f"yt-dlp command finished but dest_path {dest_path} was not created.")
        return False
    except Exception as e:
        logger.error(f"Exception while executing yt-dlp: {e}")
        return False

def download_asset(url, dest_path):
    """Downloads a binary asset from a URL and saves it."""
    try:
        logger.info(f"Downloading stock asset from: {url}")
        res = requests.get(url, stream=True, timeout=30)
        res.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in res.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        logger.error(f"Failed to download stock asset from {url}: {e}")
    return False

def _fetch_single_sub_visual(sub_visual, assets_dir, seg_idx, sub_idx, api_key):
    """Downloads a single sub-visual asset. Returns updated sub_visual dict."""
    visual_type = sub_visual.get("visual_type", "scene")
    visual_cue = sub_visual.get("visual_cue", "")
    visual_meta = sub_visual.get("visual_meta") or {}
    if not isinstance(visual_meta, dict):
        visual_meta = {}
    
    # Smart check: If asset is already downloaded, skip!
    existing_path = sub_visual.get("visual_path", "")
    if existing_path and Path(existing_path).exists():
        logger.info(f"Asset already exists for [{seg_idx}:{sub_idx}] '{existing_path}', skipping download.")
        return sub_visual
        
    sub_visual["visual_path"] = ""  # default
    
    if visual_type == "youtube":
        dest_file = assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}.mp4"
        logger.info(f"Sub-visual [{seg_idx}:{sub_idx}] YouTube: '{visual_cue}'")
        
        start_offset = int(visual_meta.get("start_offset", 15))
        duration = int(visual_meta.get("duration", 15))
        
        yt_success = download_youtube_video(visual_cue, dest_file, start_offset=start_offset, duration=duration)
        if yt_success:
            sub_visual["visual_path"] = str(dest_file)
        else:
            logger.warning(f"YouTube failed for [{seg_idx}:{sub_idx}]. Falling back to stock.")
            fallback_type = "scene"
            asset_url = None
            ext = ".mp4"
            
            if api_key:
                asset_url = search_pexels_video(visual_cue, api_key)
                if not asset_url:
                    asset_url = search_pexels_photo(visual_cue, api_key)
                    ext = ".jpg"
                    fallback_type = "image"
                    
            if asset_url:
                dest_file_fb = assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}{ext}"
                if download_asset(asset_url, dest_file_fb):
                    sub_visual["visual_path"] = str(dest_file_fb)
                    sub_visual["visual_type"] = fallback_type
                    logger.info(f"Saved fallback {fallback_type} for [{seg_idx}:{sub_idx}].")
                    
    elif visual_type in ("scene", "portrait", "image", "parallax") and api_key:
        logger.info(f"Sub-visual [{seg_idx}:{sub_idx}] Pexels: '{visual_cue}' (type: {visual_type})")
        
        asset_url = None
        ext = ".jpg"
        
        # If scene or parallax, search video first (B-Roll)
        if visual_type == "scene":
            asset_url = search_pexels_video(visual_cue, api_key)
            ext = ".mp4"
            
        # Fallback to image search if video not found or type is image/portrait/parallax
        if not asset_url:
            asset_url = search_pexels_photo(visual_cue, api_key)
            ext = ".jpg"
            
        if asset_url:
            dest_file = assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}{ext}"
            if download_asset(asset_url, dest_file):
                sub_visual["visual_path"] = str(dest_file)
                logger.info(f"Saved asset_{seg_idx:03d}_{sub_idx:02d}{ext}")
    # Programmatic types (chart, map, document, network) don't need downloads
    
    return sub_visual


def fetch_assets_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Assets acquisition step of pipeline."""
    manifest_path = Path(project_dict['assets_manifest_path'])
    if not manifest_path.exists():
        raise FileNotFoundError(f"Segment manifest not found: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    api_key = get_setting("pexels_api_key")
    use_pexels = get_setting("use_pexels")
    
    if not api_key:
        logger.warning("Pexels API key is not configured. Falling back to internal programmatic layouts.")

    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    
    # Count total sub_visuals for progress tracking
    total_sub_visuals = sum(len(seg.get("sub_visuals", [])) for seg in manifest)
    total_sub_visuals = max(1, total_sub_visuals)
    completed_sub_visuals = 0
    
    progress_cb(10.0, "Starting visual assets download...")

    # 1. Fetch visual assets for each sub_visual in each scene
    for idx, segment in enumerate(manifest):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        sub_visuals = segment.get("sub_visuals", [])
        if not isinstance(sub_visuals, list):
            sub_visuals = []
            
        for sub_idx, sub_visual in enumerate(sub_visuals):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")
            
            _fetch_single_sub_visual(sub_visual, assets_dir, idx, sub_idx, api_key)
            
            completed_sub_visuals += 1
            progress_cb(
                10.0 + (completed_sub_visuals / total_sub_visuals) * 70.0,
                f"Downloading visual assets... {completed_sub_visuals}/{total_sub_visuals}"
            )
        
        segment["sub_visuals"] = sub_visuals

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Fetch background music
    # If settings specify bg_music_path, copy it or download default
    bg_music_setting = get_setting("bg_music_path")
    if bg_music_setting and os.path.exists(bg_music_setting):
        logger.info(f"Copying configured background music track: {bg_music_setting}")
        local_music = project_dir / "bg_music.mp3"
        import shutil
        try:
            shutil.copy(bg_music_setting, local_music)
            update_project(project_dict['id'], bg_music_path=str(local_music))
        except Exception as e:
            logger.warning(f"Failed to copy background music: {e}")
    else:
        # Check if project folder has a bg_music or default music, or we can just download a copyright free track
        logger.info("No custom background music set. Visual playback will have no sound effects overlay.")

    # 3. Update manifest
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    progress_cb(100.0, "Asset downloading complete!")
    logger.info("Asset gathering pipeline step completed.")


def fetch_single_scene_asset(project_id, manifest_scene_index, sub_visual_index, visual_type, visual_cue):
    """
    Searches and downloads a visual asset for a single sub_visual within a scene,
    and updates the assets manifest file.
    """
    from backend.database.db import get_project, get_setting
    from backend.core.config import get_storage_dir
    
    project = get_project(project_id)
    if not project:
        logger.error(f"Project not found: {project_id}")
        return {"success": False, "error": "Project not found"}
        
    manifest_path = Path(project['assets_manifest_path'])
    if not manifest_path.exists():
        logger.error(f"Manifest not found: {manifest_path}")
        return {"success": False, "error": "Manifest file not found"}
        
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
        
    if manifest_scene_index < 0 or manifest_scene_index >= len(manifest):
        logger.error(f"Invalid scene index: {manifest_scene_index}")
        return {"success": False, "error": "Invalid scene index"}
        
    segment = manifest[manifest_scene_index]
    sub_visuals = segment.get("sub_visuals", [])
    
    if sub_visual_index < 0 or sub_visual_index >= len(sub_visuals):
        logger.error(f"Invalid sub_visual index: {sub_visual_index}")
        return {"success": False, "error": "Invalid sub_visual index"}
    
    sub_visual = sub_visuals[sub_visual_index]
    sub_visual["visual_type"] = visual_type
    sub_visual["visual_cue"] = visual_cue
    
    project_dir = get_storage_dir() / project_id
    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Clean up any existing downloaded asset files for this sub_visual
    for existing_ext in (".mp4", ".jpg", ".png", ".jpeg"):
        old_file = assets_dir / f"asset_{manifest_scene_index:03d}_{sub_visual_index:02d}{existing_ext}"
        if old_file.exists():
            try:
                old_file.unlink()
            except Exception as e:
                logger.warning(f"Could not delete old asset file {old_file}: {e}")
                
    # 2. Fetch the asset using the shared helper
    api_key = get_setting("pexels_api_key")
    _fetch_single_sub_visual(sub_visual, assets_dir, manifest_scene_index, sub_visual_index, api_key)
    
    # 3. Write back the updated manifest
    sub_visuals[sub_visual_index] = sub_visual
    segment["sub_visuals"] = sub_visuals
    
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        
    return {"success": True, "segment": segment, "sub_visual": sub_visual}


def cleanup_removed_assets(project_id, new_manifest_data):
    """
    Compares new manifest with existing assets on disk, deletes removed sub_visual files.

    Args:
        project_id: Project identifier
        new_manifest_data: Updated manifest structure from frontend

    Returns:
        dict: {deleted_files: [...], preserved_files: [...], new_manifest: {...}}
    """
    from backend.database.db import get_project
    from backend.core.config import get_storage_dir

    project = get_project(project_id)
    if not project:
        logger.error(f"Project not found: {project_id}")
        return {"success": False, "error": "Project not found", "deleted_files": [], "preserved_files": []}

    manifest_path = Path(project['assets_manifest_path'])
    if not manifest_path.exists():
        logger.warning(f"Manifest not found: {manifest_path}, skipping cleanup")
        return {"success": True, "deleted_files": [], "preserved_files": [], "new_manifest": new_manifest_data}

    # Load old manifest
    with open(manifest_path, "r", encoding="utf-8") as f:
        old_manifest = json.load(f)

    assets_dir = get_storage_dir() / project_id / "assets"

    # Build set of (scene_idx, sub_idx) from new manifest
    kept_positions = set()
    for scene_idx, segment in enumerate(new_manifest_data):
        sub_visuals = segment.get("sub_visuals", [])
        for sub_idx, sv in enumerate(sub_visuals):
            # Only track positions that have actual media files (not programmatic types)
            visual_type = sv.get("visual_type", "")
            if visual_type in ("scene", "image", "portrait", "parallax", "youtube"):
                kept_positions.add((scene_idx, sub_idx))

    # Find and delete orphaned files
    deleted_files = []
    preserved_files = []
    extensions = [".mp4", ".jpg", ".png", ".jpeg"]

    for scene_idx, segment in enumerate(old_manifest):
        sub_visuals = segment.get("sub_visuals", [])
        for sub_idx, sv in enumerate(sub_visuals):
            if (scene_idx, sub_idx) not in kept_positions:
                # This sub_visual was removed or changed to non-media type - delete its files
                for ext in extensions:
                    file_path = assets_dir / f"asset_{scene_idx:03d}_{sub_idx:02d}{ext}"
                    if file_path.exists():
                        try:
                            file_path.unlink()
                            deleted_files.append(str(file_path))
                            logger.info(f"Deleted orphaned asset: {file_path}")
                        except Exception as e:
                            logger.warning(f"Could not delete {file_path}: {e}")
            else:
                # Preserve: check if file exists for kept positions
                for ext in extensions:
                    file_path = assets_dir / f"asset_{scene_idx:03d}_{sub_idx:02d}{ext}"
                    if file_path.exists():
                        preserved_files.append(str(file_path))
                        break  # Only count once per position

    # Write new manifest to disk
    try:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(new_manifest_data, f, indent=2, ensure_ascii=False)
        logger.info(f"Updated manifest file: {manifest_path}")
    except Exception as e:
        logger.error(f"Failed to write new manifest: {e}")
        return {"success": False, "error": str(e), "deleted_files": deleted_files, "preserved_files": preserved_files}

    logger.info(f"Cleanup complete: {len(deleted_files)} deleted, {len(preserved_files)} preserved")
    return {
        "success": True,
        "deleted_files": deleted_files,
        "preserved_files": preserved_files,
        "new_manifest": new_manifest_data
    }

