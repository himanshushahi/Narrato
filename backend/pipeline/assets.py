import os
import json
import requests
from pathlib import Path
from backend.database.db import get_setting
from backend.core.logger import logger

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
    
    total_segments = len(manifest)
    progress_cb(10.0)

    # 1. Fetch visual assets for each scene
    for idx, segment in enumerate(manifest):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        visual_type = segment.get("visual_type", "scene")
        visual_cue = segment.get("visual_cue", "")
        
        segment["visual_path"] = "" # default
        
        # Only download asset if visual type is image or B-roll scene
        # Programmatic visual types (map, chart, document) do not need Pexels
        if visual_type in ("scene", "portrait", "image") and api_key and use_pexels:
            logger.info(f"Searching Pexels for segment {idx}: '{visual_cue}' (type: {visual_type})")
            
            asset_url = None
            ext = ".jpg"
            
            # If scene, search video first (B-Roll)
            if visual_type == "scene":
                asset_url = search_pexels_video(visual_cue, api_key)
                ext = ".mp4"
                
            # Fallback to image search if video not found or type is image/portrait
            if not asset_url:
                asset_url = search_pexels_photo(visual_cue, api_key)
                ext = ".jpg"
                
            if asset_url:
                dest_file = assets_dir / f"asset_{idx:03d}{ext}"
                if download_asset(asset_url, dest_file):
                    segment["visual_path"] = str(dest_file)
                    logger.info(f"Saved asset_{idx:03d}{ext} locally.")
                    
        progress_cb(10.0 + (idx + 1) / total_segments * 70.0) # progress 10% -> 80%

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

    progress_cb(100.0)
    logger.info("Asset gathering pipeline step completed.")
