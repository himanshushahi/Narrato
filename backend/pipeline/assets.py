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
    progress_cb(10.0, "Starting visual assets download...")

    # 1. Fetch visual assets for each scene
    for idx, segment in enumerate(manifest):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        visual_type = segment.get("visual_type", "scene")
        visual_cue = segment.get("visual_cue", "")
        
        segment["visual_path"] = "" # default
        
        # Read script.json so we can sync fallbacks
        script_path = project_dir / "script.json"
        script_data = None
        script_modified = False
        if script_path.exists():
            try:
                with open(script_path, "r", encoding="utf-8") as sf:
                    script_data = json.load(sf)
            except Exception as e:
                logger.warning(f"Could not load script.json in pipeline: {e}")

        # If type is youtube, download from youtube first. If it fails, fall back to stock video/photo.
        if visual_type == "youtube":
            dest_file = assets_dir / f"asset_{idx:03d}.mp4"
            logger.info(f"Segment {idx} is YouTube visual type. Sourcing from YouTube: '{visual_cue}'")
            
            visual_meta = segment.get("visual_meta") or {}
            if not isinstance(visual_meta, dict):
                visual_meta = {}
            start_offset = int(visual_meta.get("start_offset", 15))
            duration = int(visual_meta.get("duration", 15))
            
            yt_success = download_youtube_video(visual_cue, dest_file, start_offset=start_offset, duration=duration)
            if yt_success:
                segment["visual_path"] = str(dest_file)
                logger.info(f"Saved youtube asset_{idx:03d}.mp4 locally.")
            else:
                logger.warning(f"YouTube download failed for segment {idx}. Falling back to stock video.")
                fallback_type = "scene"
                asset_url = None
                ext = ".mp4"
                
                if api_key:
                    asset_url = search_pexels_video(visual_cue, api_key)
                    if not asset_url:
                        logger.warning(f"Stock video fallback failed for segment {idx}. Trying stock photo.")
                        asset_url = search_pexels_photo(visual_cue, api_key)
                        ext = ".jpg"
                        fallback_type = "image"
                        
                if asset_url:
                    dest_file_fb = assets_dir / f"asset_{idx:03d}{ext}"
                    if download_asset(asset_url, dest_file_fb):
                        segment["visual_path"] = str(dest_file_fb)
                        segment["visual_type"] = fallback_type
                        logger.info(f"Successfully saved fallback {fallback_type} asset locally.")
                        # Sync visual_type to script_data
                        if script_data:
                            section_type = segment.get("section_type")
                            if section_type == "introduction" and "introduction" in script_data:
                                script_data["introduction"]["visual_type"] = fallback_type
                                script_modified = True
                            elif section_type == "conclusion" and "conclusion" in script_data:
                                script_data["conclusion"]["visual_type"] = fallback_type
                                script_modified = True
                            elif section_type == "scene" and "scenes" in script_data:
                                script_scene_idx = sum(1 for s in manifest[:idx] if s.get("section_type") == "scene")
                                if script_scene_idx < len(script_data["scenes"]):
                                    script_data["scenes"][script_scene_idx]["visual_type"] = fallback_type
                                    script_modified = True
                else:
                    segment["visual_path"] = ""
                    logger.warning(f"Fallback asset gathering failed for segment {idx}.")
                    
            if script_modified and script_data:
                try:
                    with open(script_path, "w", encoding="utf-8") as sf:
                        json.dump(script_data, sf, indent=2, ensure_ascii=False)
                    logger.info("Synchronized fallback visual types to script.json")
                except Exception as e:
                    logger.error(f"Failed to save synchronized script.json: {e}")

        # Only download asset if visual type is image or B-roll scene
        elif visual_type in ("scene", "portrait", "image") and api_key:
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
                    
        progress_cb(10.0 + (idx + 1) / total_segments * 70.0, f"Downloading visual assets... {idx + 1}/{total_segments}") # progress 10% -> 80%

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


def fetch_single_scene_asset(project_id, manifest_scene_index, visual_type, visual_cue):
    """
    Searches and downloads a visual asset from the internet for a single scene,
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
    segment["visual_type"] = visual_type
    segment["visual_cue"] = visual_cue
    
    project_dir = get_storage_dir() / project_id
    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Clean up any existing downloaded asset files for this scene index
    for existing_ext in (".mp4", ".jpg", ".png", ".jpeg"):
        old_file = assets_dir / f"asset_{manifest_scene_index:03d}{existing_ext}"
        if old_file.exists():
            try:
                old_file.unlink()
            except Exception as e:
                logger.warning(f"Could not delete old asset file {old_file}: {e}")
                
    # 2. Check if type requires internet download
    fallback_warning = None
    if visual_type == "youtube":
        dest_file = assets_dir / f"asset_{manifest_scene_index:03d}.mp4"
        logger.info(f"Single fetch: Sourcing from YouTube: '{visual_cue}'")
        
        visual_meta = segment.get("visual_meta") or {}
        if not isinstance(visual_meta, dict):
            visual_meta = {}
        start_offset = int(visual_meta.get("start_offset", 15))
        duration = int(visual_meta.get("duration", 15))
        
        yt_success = download_youtube_video(visual_cue, dest_file, start_offset=start_offset, duration=duration)
        if yt_success:
            segment["visual_path"] = str(dest_file)
            segment["visual_type"] = "youtube"
        else:
            logger.warning(f"YouTube fetch failed for single scene. Falling back to stock video.")
            fallback_warning = "YouTube download failed. Fell back to stock video."
            fallback_type = "scene"
            asset_url = None
            ext = ".mp4"
            
            api_key = get_setting("pexels_api_key")
            
            if api_key:
                asset_url = search_pexels_video(visual_cue, api_key)
                if not asset_url:
                    logger.warning("Stock video fallback failed. Sourcing stock photo.")
                    fallback_warning = "YouTube and stock video failed. Fell back to stock photo."
                    asset_url = search_pexels_photo(visual_cue, api_key)
                    ext = ".jpg"
                    fallback_type = "image"
                    
            if asset_url:
                dest_file_fb = assets_dir / f"asset_{manifest_scene_index:03d}{ext}"
                if download_asset(asset_url, dest_file_fb):
                    segment["visual_path"] = str(dest_file_fb)
                    segment["visual_type"] = fallback_type
                    # Update script.json database to keep UI in sync
                    script_path = project_dir / "script.json"
                    if script_path.exists():
                        try:
                            with open(script_path, "r", encoding="utf-8") as sf:
                                script_data = json.load(sf)
                            section_type = segment.get("section_type")
                            if section_type == "introduction" and "introduction" in script_data:
                                script_data["introduction"]["visual_type"] = fallback_type
                            elif section_type == "conclusion" and "conclusion" in script_data:
                                script_data["conclusion"]["visual_type"] = fallback_type
                            elif section_type == "scene" and "scenes" in script_data:
                                script_scene_idx = sum(1 for s in manifest[:manifest_scene_index] if s.get("section_type") == "scene")
                                if script_scene_idx < len(script_data["scenes"]):
                                    script_data["scenes"][script_scene_idx]["visual_type"] = fallback_type
                            with open(script_path, "w", encoding="utf-8") as sf:
                                json.dump(script_data, sf, indent=2, ensure_ascii=False)
                        except Exception as e:
                            logger.error(f"Failed to sync script visual type: {e}")
                else:
                    segment["visual_path"] = ""
                    fallback_warning = "YouTube and stock media fallbacks all failed."
            else:
                segment["visual_path"] = ""
                fallback_warning = "YouTube failed and stock media API was not configured/failed."
                
    elif visual_type in ("scene", "portrait", "image"):
        api_key = get_setting("pexels_api_key")
        
        if api_key:
            logger.info(f"Single fetch: Searching Pexels for segment {manifest_scene_index}: '{visual_cue}' (type: {visual_type})")
            
            asset_url = None
            ext = ".jpg"
            
            if visual_type == "scene":
                asset_url = search_pexels_video(visual_cue, api_key)
                ext = ".mp4"
            
            if not asset_url:
                asset_url = search_pexels_photo(visual_cue, api_key)
                ext = ".jpg"
                
            if asset_url:
                dest_file = assets_dir / f"asset_{manifest_scene_index:03d}{ext}"
                if download_asset(asset_url, dest_file):
                    segment["visual_path"] = str(dest_file)
                    logger.info(f"Saved single asset_{manifest_scene_index:03d}{ext} locally.")
                else:
                    segment["visual_path"] = ""
            else:
                segment["visual_path"] = ""
        else:
            segment["visual_path"] = ""
    else:
        # Programmatic visual types (map, chart, document) do not need Pexels
        segment["visual_path"] = ""
        
    # Write back the updated manifest
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        
    return {"success": True, "segment": segment, "fallback_warning": fallback_warning}

