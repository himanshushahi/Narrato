import os
import json
import hashlib
import requests
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from backend.database.db import get_setting, get_project, update_project
from backend.core.logger import logger
from backend.core.config import get_ytdlp_path, get_ffmpeg_path, get_startupinfo


def compute_script_content_hash(script_data):
    """
    Computes a deterministic hash of all scene narration content.

    The hash captures everything that affects voiceover output: narration text
    for introduction, every scene, and conclusion. If any of these change,
    the hash will differ and the pipeline knows to regenerate voiceover.

    Returns a hex string, or empty string if no script data is provided.
    """
    if not script_data:
        return ""

    parts = []

    # Introduction
    intro = script_data.get("introduction") or {}
    parts.append(f"intro:{intro.get('hook') or ''}")

    # Each scene
    scenes = script_data.get("scenes") or []
    for i, scene in enumerate(scenes):
        parts.append(f"scene_{i}:{scene.get('narration') or ''}")

    # Conclusion
    conclusion = script_data.get("conclusion") or {}
    summary = conclusion.get('summary') or ''
    cta = conclusion.get('cta') or ''
    parts.append(f"conclusion:{summary}{cta}")

    content_str = "\n".join(parts)
    return hashlib.sha256(content_str.encode("utf-8")).hexdigest()

def is_visuals_stale(project_dict, project_dir):
    """Check if the sub-visual structure in script.json differs from manifest.json."""
    script_path = project_dir / "script.json"
    manifest_path = project_dir / "voiceover" / "manifest.json"
    if not script_path.exists() or not manifest_path.exists():
        return True
        
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script_data = json.load(f)
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)
            
        scene_counter = 0
        for manifest_scene in manifest_data:
            sec_type = manifest_scene.get("section_type")
            live_sub_visuals = []
            
            if sec_type == 'introduction' and script_data.get('introduction'):
                live_sub_visuals = script_data['introduction'].get('sub_visuals', [])
            elif sec_type == 'conclusion' and script_data.get('conclusion'):
                live_sub_visuals = script_data['conclusion'].get('sub_visuals', [])
            elif sec_type == 'scene' and isinstance(script_data.get('scenes'), list):
                if scene_counter < len(script_data['scenes']):
                    script_scene = script_data['scenes'][scene_counter]
                    live_sub_visuals = script_scene.get('sub_visuals', [])
                scene_counter += 1
                
            orig_sub_visuals = manifest_scene.get("sub_visuals", [])
            
            relevant_live = [{"visual_type": lsv.get("visual_type"), "visual_cue": lsv.get("visual_cue")} for lsv in live_sub_visuals]
            relevant_orig = [{"visual_type": osv.get("visual_type"), "visual_cue": osv.get("visual_cue")} for osv in orig_sub_visuals]
            
            if relevant_live != relevant_orig:
                return True
    except Exception as e:
        logger.warning(f"Failed to check visuals staleness: {e}")
        return True
    return False

def is_assets_stale(project_dict, project_dir):
    """Check if any downloaded files referenced in assets_manifest.json are missing."""
    assets_manifest_path = project_dir / "assets" / "assets_manifest.json"
    if not assets_manifest_path.exists():
        return True
        
    try:
        with open(assets_manifest_path, "r", encoding="utf-8") as f:
            assets_manifest = json.load(f)
            
        for scene in assets_manifest:
            for sv in scene.get("sub_visuals", []):
                v_path = sv.get("visual_path")
                if v_path and not Path(v_path).exists():
                    return True
                    
        bg_music = project_dict.get("bg_music_path")
        if bg_music and not Path(bg_music).exists():
            return True
            
    except Exception as e:
        logger.warning(f"Failed to check assets staleness: {e}")
        return True
    return False


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

def _get_original_wikimedia_url(image_filename, headers):
    """Resolve a Wikimedia image filename to its original (full-resolution) URL.

    Uses the imageinfo API which returns the canonical download URL for the
    original file on Wikimedia Commons. With proper User-Agent and Referer
    headers this URL is generally accessible for download.
    """
    if not image_filename:
        return None

    # The pageimage field comes without a namespace prefix (e.g. "Harshad_Mehta.jpg")
    # but imageinfo expects the full File: prefixed title.
    if not image_filename.startswith("File:"):
        image_filename = f"File:{image_filename}"

    api_url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "titles": image_filename,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    }
    res = requests.get(api_url, params=params, headers=headers, timeout=10)
    res.raise_for_status()
    data = res.json()

    query_pages = data.get("query", {}).get("pages", {})
    for page_id, page_data in query_pages.items():
        if page_id == "-1":
            continue
        image_info = page_data.get("imageinfo", [])
        if image_info:
            return image_info[0].get("url", "")

    return None


def search_wikipedia_image(query):
    """Searches Wikipedia for a person/entity and returns the main image URL.

    Uses the Wikipedia API to find the best-matching page and retrieves its
    primary (infobox) image in original quality. Falls back to a 1920px
    thumbnail if the original cannot be obtained.

    This is ideal for 'portrait' type sub-visuals where Pexels stock photos
    would be inaccurate for specific people.
    """
    if not query or not query.strip():
        return None

    headers = {
        "User-Agent": WIKIMEDIA_USER_AGENT,
    }
    api_url = "https://en.wikipedia.org/w/api.php"
    search_query = query.strip()

    try:
        # Step 1: Search Wikipedia for the best-matching page
        search_params = {
            "action": "query",
            "list": "search",
            "srsearch": search_query,
            "srlimit": 3,
            "format": "json"
        }
        res = requests.get(api_url, params=search_params, headers=headers, timeout=10)
        res.raise_for_status()
        data = res.json()

        pages = data.get("query", {}).get("search", [])
        if not pages:
            logger.warning(f"Wikipedia search returned no results for '{query}'")
            return None

        page_title = pages[0].get("title", "")
        if not page_title:
            return None

        logger.info(f"Wikipedia: found page '{page_title}' for query '{query}'")

        # Step 2: Get the page's primary image info (filename + thumbnail)
        image_params = {
            "action": "query",
            "titles": page_title,
            "prop": "pageimages",
            "piprop": "thumbnail",
            "pithumbsize": 1920,
            "format": "json"
        }
        res = requests.get(api_url, params=image_params, headers=headers, timeout=10)
        res.raise_for_status()
        data = res.json()

        thumbnail_url = None
        image_filename = None

        for page_id, page_data in data.get("query", {}).get("pages", {}).items():
            if page_id == "-1":
                continue
            # pageimage holds the raw filename (e.g. "Harshad_Mehta.jpg")
            image_filename = page_data.get("pageimage", "")
            # Fallback thumbnail in case original resolution is unavailable
            thumb = page_data.get("thumbnail", {})
            thumbnail_url = thumb.get("source", "")
            break

        # Step 3: Resolve the original (full-resolution) file URL via imageinfo API
        if image_filename:
            try:
                original_url = _get_original_wikimedia_url(image_filename, headers)
                if original_url:
                    # Force HTTPS (defensive — Wikipedia already returns https)
                    if original_url.startswith("http://"):
                        original_url = "https://" + original_url[7:]
                    logger.info(f"Wikipedia: found ORIGINAL image for '{page_title}': {original_url}")
                    return original_url
            except Exception as e:
                logger.warning(f"Wikipedia: imageinfo API failed for '{image_filename}': {e}")

        # Step 4: Fallback to the 1920px thumbnail URL
        if thumbnail_url:
            if thumbnail_url.startswith("http://"):
                thumbnail_url = "https://" + thumbnail_url[7:]
            logger.info(f"Wikipedia: using thumbnail (original unavailable) for '{page_title}': {thumbnail_url}")
            return thumbnail_url

        logger.warning(f"Wikipedia: no image found for page '{page_title}'")
        return None

    except requests.RequestException as e:
        logger.warning(f"Wikipedia API request failed for '{query}': {e}")
        return None
    except Exception as e:
        logger.warning(f"Wikipedia search failed for '{query}': {e}")
        return None


def download_youtube_video(query, dest_path, start_offset=15, duration=15, cancel_event=None):
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
        startupinfo = get_startupinfo()

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, startupinfo=startupinfo)

        stdout, stderr = "", ""
        while True:
            if cancel_event and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                if dest_path.exists():
                    try: dest_path.unlink()
                    except: pass
                raise InterruptedError("Cancelled")

            try:
                out, err = process.communicate(timeout=0.5)
                stdout = out or ""
                stderr = err or ""
                break
            except subprocess.TimeoutExpired:
                continue

        # Prioritize checking if the file was downloaded successfully (yt-dlp may return non-zero when aborting remaining search items)
        if dest_path.exists() and dest_path.stat().st_size > 0:
            logger.info(f"Successfully downloaded YouTube clip to {dest_path}")
            return True

        if process.returncode != 0:
            logger.error(f"yt-dlp failed with returncode {process.returncode}. stderr: {stderr}")
            return False

        logger.error(f"yt-dlp command finished but dest_path {dest_path} was not created.")
        return False
    except Exception as e:
        logger.error(f"Exception while executing yt-dlp: {e}")
        return False

WIKIMEDIA_USER_AGENT = "RemotionCanvas/1.0 (video generator; mailto:dev@remotioncanvas.local)"


def download_asset(url, dest_path, cancel_event=None):
    """Downloads a binary asset from a URL and saves it.

    Wikimedia Commons blocks requests without a proper User-Agent header,
    so we always send one — it's harmless for other CDNs (Pexels, etc.)
    and essential for Wikimedia-hosted images.
    """
    try:
        logger.info(f"Downloading stock asset from: {url}")
        headers = {
            "User-Agent": WIKIMEDIA_USER_AGENT,
        }
        # Wikimedia also checks Referer in some cases — sending one that
        # matches a legitimate Wikipedia page context avoids further blocks.
        if "wikimedia.org" in url or "wikipedia.org" in url:
            headers["Referer"] = "https://en.wikipedia.org/"
        res = requests.get(url, headers=headers, stream=True, timeout=30)
        res.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in res.iter_content(chunk_size=8192):
                if cancel_event and cancel_event.is_set():
                    f.close()
                    if dest_path.exists():
                        dest_path.unlink()
                    raise InterruptedError("Cancelled")
                if chunk:
                    f.write(chunk)
        return True
    except Exception as e:
        logger.error(f"Failed to download stock asset from {url}: {e}")
    return False

def _fetch_single_sub_visual(sub_visual, assets_dir, seg_idx, sub_idx, api_key, cancel_event, force_download=False, dest_path=None):
    """Downloads a single sub-visual asset. Returns updated sub_visual dict.

    When force_download is True, the existing-file skip check is bypassed,
    ensuring a fresh download even if the asset file already exists on disk.
    This is used by fetch_single_scene_asset which handles its own cleanup.
    """
    visual_type = sub_visual.get("visual_type", "scene")
    visual_cue = sub_visual.get("visual_cue", "")
    visual_meta = sub_visual.get("visual_meta") or {}
    if not isinstance(visual_meta, dict):
        visual_meta = {}

    # Smart check: If asset is already downloaded, skip!
    # When force_download is True (e.g., from fetch_single_scene_asset),
    # skip this check — the caller guarantees a new download is needed.
    existing_path = sub_visual.get("visual_path", "")
    if not force_download and existing_path and Path(existing_path).exists():
        logger.info(f"Asset already exists for [{seg_idx}:{sub_idx}] '{existing_path}', skipping download.")
        return sub_visual

    sub_visual["visual_path"] = ""  # default

    if visual_type == "youtube":
        dest_file = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}.mp4"
        logger.info(f"Sub-visual [{seg_idx}:{sub_idx}] YouTube: '{visual_cue}'")

        start_offset = int(visual_meta.get("start_offset", 15))
        duration = int(visual_meta.get("duration", 15))

        yt_success = download_youtube_video(visual_cue, dest_file, start_offset=start_offset, duration=duration, cancel_event=cancel_event)
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
                dest_file_fb = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}{ext}"
                if download_asset(asset_url, dest_file_fb, cancel_event=cancel_event):
                    sub_visual["visual_path"] = str(dest_file_fb)
                    sub_visual["visual_type"] = fallback_type
                    logger.info(f"Saved fallback {fallback_type} for [{seg_idx}:{sub_idx}].")

    elif visual_type == "ai_image":
        hf_api_key = get_setting("huggingface_api_key")
        hf_model = get_setting("huggingface_model") or "black-forest-labs/FLUX.1-schnell"
        prompt = visual_cue

        if not hf_api_key:
            logger.warning(f"No HuggingFace API key for [{seg_idx}:{sub_idx}]. Falling back to stock image.")
            fallback_type = "image"
            asset_url = search_pexels_photo(visual_cue, api_key) if api_key else None
            if asset_url:
                dest_file_fb = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}.jpg"
                if download_asset(asset_url, dest_file_fb, cancel_event=cancel_event):
                    sub_visual["visual_path"] = str(dest_file_fb)
                    sub_visual["visual_type"] = fallback_type
                    logger.info(f"Saved fallback image for [{seg_idx}:{sub_idx}].")
        else:
            try:
                from huggingface_hub import InferenceClient
                client = InferenceClient(api_key=hf_api_key)
                logger.info(f"Generating AI image for [{seg_idx}:{sub_idx}] with model '{hf_model}'...")
                
                # Check for cancellation before expensive call
                if cancel_event and cancel_event.is_set():
                    raise InterruptedError("Cancelled")
                    
                image = client.text_to_image(prompt=prompt, model=hf_model)
                dest_file = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}.png"
                image.save(str(dest_file))
                sub_visual["visual_path"] = str(dest_file)
                logger.info(f"Successfully generated AI image to {dest_file}")
            except Exception as e:
                logger.error(f"Failed to generate AI image for [{seg_idx}:{sub_idx}]: {e}. Falling back to stock image.")
                fallback_type = "image"
                asset_url = search_pexels_photo(visual_cue, api_key) if api_key else None
                if asset_url:
                    dest_file_fb = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}.jpg"
                    if download_asset(asset_url, dest_file_fb, cancel_event=cancel_event):
                        sub_visual["visual_path"] = str(dest_file_fb)
                        sub_visual["visual_type"] = fallback_type

    elif visual_type in ("scene", "portrait", "image", "parallax") and api_key:
        asset_url = None
        ext = ".jpg"

        # If scene or parallax, search video first (B-Roll)
        if visual_type == "scene":
            asset_url = search_pexels_video(visual_cue, api_key)
            ext = ".mp4"

        # For portrait: try Wikipedia first for accurate images of specific people
        if not asset_url and visual_type == "portrait":
            search_term = visual_cue or visual_meta.get("person_name", "")
            logger.info(f"Sub-visual [{seg_idx}:{sub_idx}] Wikipedia portrait search: '{search_term}'")
            asset_url = search_wikipedia_image(search_term)
            ext = ".jpg"

        # Fallback to Pexels image search if Wikipedia didn't find anything
        # or if type is image/parallax (which don't use Wikipedia)
        if not asset_url:
            logger.info(f"Sub-visual [{seg_idx}:{sub_idx}] Pexels fallback: '{visual_cue}' (type: {visual_type})")
            asset_url = search_pexels_photo(visual_cue, api_key)
            ext = ".jpg"

        if asset_url:
            dest_file = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}{ext}"
            if download_asset(asset_url, dest_file, cancel_event=cancel_event):
                sub_visual["visual_path"] = str(dest_file)
                logger.info(f"Saved asset_{seg_idx:03d}_{sub_idx:02d}{ext}")

    elif visual_type == "device_mockup":
        screen_url = visual_meta.get("screen_image_url", "")
        if screen_url:
            parsed = urlparse(screen_url)
            _, ext = os.path.splitext(parsed.path)
            if not ext:
                ext = ".jpg"
            dest_file = Path(dest_path) if dest_path else assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}{ext}"
            if download_asset(screen_url, dest_file, cancel_event=cancel_event):
                sub_visual["visual_path"] = str(dest_file)
                logger.info(f"Downloaded device_mockup screen asset_{seg_idx:03d}_{sub_idx:02d}{ext}")

    # Programmatic types (chart, map, document, network, timeline) don't need downloads

    return sub_visual


def fetch_assets_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Assets acquisition step of pipeline."""
    manifest_path = Path(project_dict['assets_manifest_path'])
    if not manifest_path.exists():
        raise FileNotFoundError(f"Segment manifest not found: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    api_key = get_setting("pexels_api_key")


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

            _fetch_single_sub_visual(sub_visual, assets_dir, idx, sub_idx, api_key, cancel_event)

            completed_sub_visuals += 1
            progress_cb(
                10.0 + (completed_sub_visuals / total_sub_visuals) * 70.0,
                f"Downloading visual assets... {completed_sub_visuals}/{total_sub_visuals}"
            )

        segment["sub_visuals"] = sub_visuals

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Fetch background music
    # Priority: project-level bg_music_path > global setting > nothing
    import shutil

    project_bg = project_dict.get("bg_music_path")
    if project_bg and os.path.exists(project_bg):
        logger.info(f"Using project-level background music: {project_bg}")
        src_ext = os.path.splitext(project_bg)[1].lower() or ".mp3"
        local_music = project_dir / f"bg_music{src_ext}"
        if str(local_music) != project_bg:
            try:
                shutil.copy(project_bg, local_music)
                update_project(project_dict['id'], bg_music_path=str(local_music))
            except Exception as e:
                logger.warning(f"Failed to copy project background music: {e}")
        else:
            logger.info("Project bg_music already in standard location.")
    else:
        bg_music_setting = get_setting("bg_music_path")
        if bg_music_setting and os.path.exists(bg_music_setting):
            logger.info(f"Copying configured background music track: {bg_music_setting}")
            local_music = project_dir / "bg_music.mp3"
            try:
                shutil.copy(bg_music_setting, local_music)
                update_project(project_dict['id'], bg_music_path=str(local_music))
            except Exception as e:
                logger.warning(f"Failed to copy background music: {e}")
        else:
            logger.info("No custom background music set. Visual playback will have no sound effects overlay.")

    # 3. Update manifest
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # 4. Save visual_paths back to script.json for persistence
    script_path = project_dir / "script.json"
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
                
            script_scenes = script.get("scenes", [])
            manifest_scenes = [m for m in manifest if m.get("section_type") == "scene"]
            
            # Intro
            manifest_intro = next((m for m in manifest if m.get("section_type") == "introduction"), None)
            if manifest_intro and "introduction" in script:
                script["introduction"]["sub_visuals"] = manifest_intro.get("sub_visuals", [])
                
            # Conclusion
            manifest_conclusion = next((m for m in manifest if m.get("section_type") == "conclusion"), None)
            if manifest_conclusion and "conclusion" in script:
                script["conclusion"]["sub_visuals"] = manifest_conclusion.get("sub_visuals", [])
                
            # Scenes
            for i, sc in enumerate(script_scenes):
                if i < len(manifest_scenes):
                    sc["sub_visuals"] = manifest_scenes[i].get("sub_visuals", [])
                    
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to persist visual_paths to script.json: {e}")

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

    # Save the old visual_path BEFORE downloading so we can fall back if the
    # re-download fails.  This prevents the "self-extinguishing" bug where a
    # transient download failure erases the old asset permanently.
    old_visual_path = sub_visual.get("visual_path", "")

    # 1. Fetch the asset using the shared helper
    # force_download=True: the caller already determined the sub-visual changed,
    # so bypass the "already exists" skip check in _fetch_single_sub_visual.
    api_key = get_setting("pexels_api_key")
    _fetch_single_sub_visual(sub_visual, assets_dir, manifest_scene_index, sub_visual_index, api_key, cancel_event=None, force_download=True)

    downloaded_path = sub_visual.get("visual_path", "")

    # 2. If the download gave us nothing useful, restore the old path so the
    #    sub-visual still has a fallback asset rather than becoming empty.
    if not downloaded_path:
        if old_visual_path and Path(old_visual_path).exists():
            sub_visual["visual_path"] = old_visual_path
            logger.info(f"Re-download failed for [{manifest_scene_index}:{sub_visual_index}], "
                        f"restored old visual_path: {old_visual_path}")
        else:
            logger.warning(f"Re-download failed for [{manifest_scene_index}:{sub_visual_index}], "
                           f"and no viable old file exists either.")

    # 3. Clean up old asset files with extensions that differ from the new download.
    #    This prevents orphaned files when visual_type changes (e.g., .mp4 -> .jpg).
    #    Only run this when the download (or fallback) actually produced a valid file.
    else:
        downloaded_ext = Path(downloaded_path).suffix.lower()
        for existing_ext in (".mp4", ".jpg", ".png", ".jpeg"):
            if existing_ext == downloaded_ext:
                continue  # Same extension -- _fetch_single_sub_visual already overwrote it
            old_file = assets_dir / f"asset_{manifest_scene_index:03d}_{sub_visual_index:02d}{existing_ext}"
            if old_file.exists():
                try:
                    old_file.unlink()
                    logger.info(f"Cleaned up stale asset with different extension: {old_file}")
                except Exception as e:
                    logger.warning(f"Could not delete stale asset file {old_file}: {e}")

    # 4. Write back the updated manifest
    sub_visuals[sub_visual_index] = sub_visual
    segment["sub_visuals"] = sub_visuals

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # 5. Save visual_path back to script.json for persistence
    script_path = project_dir / "script.json"
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)

            script_scenes = script.get("scenes", [])
            manifest_scenes = [m for m in manifest if m.get("section_type") == "scene"]
            
            # Intro
            manifest_intro = next((m for m in manifest if m.get("section_type") == "introduction"), None)
            if manifest_intro and "introduction" in script:
                script["introduction"]["sub_visuals"] = manifest_intro.get("sub_visuals", [])
                
            # Conclusion
            manifest_conclusion = next((m for m in manifest if m.get("section_type") == "conclusion"), None)
            if manifest_conclusion and "conclusion" in script:
                script["conclusion"]["sub_visuals"] = manifest_conclusion.get("sub_visuals", [])
                
            # Scenes
            for i, sc in enumerate(script_scenes):
                if i < len(manifest_scenes):
                    sc["sub_visuals"] = manifest_scenes[i].get("sub_visuals", [])

            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to persist single visual_path to script.json: {e}")

    return {"success": True, "segment": segment, "sub_visual": sub_visual}


def preview_asset_download(project_id, visual_type, visual_cue):
    """
    Downloads a single asset for preview without modifying manifest or script.
    Saves to assets/previews/ directory with a unique temp name.
    Called from the frontend visual editor so users can preview a keyword/type
    before committing (Save) or discarding (Cancel).

    Returns:
        {"success": True, "visual_path": "..."} or {"success": False, "error": "..."}
    """
    project = get_project(project_id)
    if not project:
        return {"success": False, "error": "Project not found"}

    # Programmatic types don't need downloading
    if visual_type in ("chart", "map", "document", "network", "list", "custom_html", "timeline", "thread", "device_mockup"):
        return {"success": True, "path": "", "message": "Non-media visual type previewed successfully."}

    api_key = get_setting("pexels_api_key")
    if not api_key and visual_type not in ("youtube", "ai_image"):
        return {"success": False, "error": "Pexels API key not configured"}

    from backend.core.config import get_storage_dir
    import uuid
    project_dir = get_storage_dir() / project_id
    assets_dir = project_dir / "assets"
    preview_dir = assets_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    # Determine extension based on visual_type
    if visual_type == "youtube" or visual_type == "scene":
        ext = ".mp4"
    else:
        ext = ".jpg"

    preview_id = uuid.uuid4().hex[:8]
    dest_path = preview_dir / f"preview_{preview_id}{ext}"

    sub_visual = {"visual_type": visual_type, "visual_cue": visual_cue, "visual_meta": {}}

    _fetch_single_sub_visual(
        sub_visual, assets_dir, 0, 0, api_key,
        cancel_event=None, force_download=True, dest_path=str(dest_path)
    )

    if sub_visual.get("visual_path"):
        logger.info(f"Preview asset downloaded to {sub_visual['visual_path']}")
        return {"success": True, "visual_path": sub_visual["visual_path"]}
    else:
        return {"success": False, "error": "Failed to download asset"}


def cleanup_preview_assets(project_id, preview_paths):
    """
    Deletes preview asset files that are no longer needed.
    Called from the frontend on Cancel (and optionally after Save).

    Args:
        project_id: Project identifier (for optional empty-directory cleanup)
        preview_paths: List of absolute file paths to delete

    Returns:
        {"success": True, "deleted": [...]}
    """
    deleted = []
    for path_str in preview_paths:
        try:
            path = Path(path_str)
            if path.exists():
                path.unlink()
                deleted.append(path_str)
                logger.info(f"Deleted preview asset: {path_str}")
        except Exception as e:
            logger.warning(f"Failed to delete preview asset {path_str}: {e}")

    # Remove previews directory if now empty
    try:
        from backend.core.config import get_storage_dir
        preview_dir = get_storage_dir() / project_id / "assets" / "previews"
        if preview_dir.exists():
            remaining = list(preview_dir.iterdir())
            if not remaining:
                preview_dir.rmdir()
                logger.info(f"Removed empty previews directory: {preview_dir}")
    except Exception:
        pass

    return {"success": True, "deleted": deleted}


def cleanup_removed_assets(project_id, new_manifest_data, content_hash="", output_manifest_path=None, old_manifest_path=None):
    """
    Compares new manifest with existing assets on disk, deletes removed sub_visual files.
    Also stores a content hash in each manifest entry for change detection on resume.

    Args:
        project_id: Project identifier
        new_manifest_data: Updated manifest structure from frontend
        content_hash: SHA-256 hash of script narration content (from save_project_with_cleanup)
        output_manifest_path: Optional path to write the updated manifest.
        old_manifest_path: Optional path to read the old manifest from. If not provided,
                             reads from the project's assets_manifest_path.

    Returns:
        dict: {deleted_files: [...], preserved_files: [...], new_manifest: {...}}
    """
    from backend.database.db import get_project
    from backend.core.config import get_storage_dir

    project = get_project(project_id)
    if not project:
        logger.error(f"Project not found: {project_id}")
        return {"success": False, "error": "Project not found", "deleted_files": [], "preserved_files": []}

    # Resolve old and output manifest paths
    if old_manifest_path:
        old_manifest_file = Path(old_manifest_path)
    else:
        old_manifest_file = Path(project['assets_manifest_path'])

    if output_manifest_path:
        output_path = Path(output_manifest_path)
    else:
        output_path = old_manifest_file

    if not old_manifest_file.exists():
        logger.warning(f"Old manifest not found: {old_manifest_file}, skipping cleanup")
        return {"success": True, "deleted_files": [], "preserved_files": [], "new_manifest": new_manifest_data}

    # Load old manifest
    with open(old_manifest_file, "r", encoding="utf-8") as f:
        old_manifest = json.load(f)

    assets_dir = get_storage_dir() / project_id / "assets"

    import re
    import uuid

    # Build set of (scene_idx, sub_idx) from new manifest — these are the positions
    # that should have asset files after the rename pass completes.
    kept_positions = set()
    for scene_idx, segment in enumerate(new_manifest_data):
        sub_visuals = segment.get("sub_visuals", [])
        for sub_idx, sv in enumerate(sub_visuals):
            # Only track positions that have actual media files (not programmatic types)
            visual_type = sv.get("visual_type", "")
            if visual_type in ("scene", "image", "portrait", "parallax", "youtube", "ai_image", "device_mockup"):
                kept_positions.add((scene_idx, sub_idx))

    deleted_files = []
    preserved_files = []

    # ── Phase 1: Rename surviving files to match new manifest indices ──
    # This must run BEFORE deletion so that survivors are at their correct
    # positions before we determine which files are truly orphaned.
    # We do this in two passes with temporary names to avoid overwriting
    # files when scenes are INSERTED (which shifts indices and causes collisions).
    rename_operations = []

    # Pass 1a: Move mismatched files to safe temporary names
    for scene_idx, segment in enumerate(new_manifest_data):
        sub_visuals = segment.get("sub_visuals", [])
        for sub_idx, sv in enumerate(sub_visuals):
            old_path_str = sv.get("visual_path", "")
            if not old_path_str:
                continue
            old_path = Path(old_path_str)
            if not old_path.exists():
                sv["visual_path"] = ""
                continue

            expected_stem = f"asset_{scene_idx:03d}_{sub_idx:02d}"
            actual_stem = old_path.stem

            if actual_stem != expected_stem:
                tmp_path = old_path.parent / f"tmp_{uuid.uuid4().hex[:8]}_{old_path.name}"
                try:
                    old_path.rename(tmp_path)
                    final_path = old_path.parent / f"{expected_stem}{old_path.suffix}"
                    rename_operations.append((tmp_path, final_path, sv))
                except Exception as e:
                    logger.warning(f"Could not rename {old_path} to temp: {e}")

    # Pass 1b: Move temporary files to their final expected names
    rename_count = 0
    for tmp_path, final_path, sv in rename_operations:
        try:
            if final_path.exists():
                final_path.unlink()
            tmp_path.rename(final_path)
            sv["visual_path"] = str(final_path)
            rename_count += 1
            logger.info(f"Renamed asset to {final_path.name}")
        except Exception as e:
            logger.warning(f"Could not finalize rename {tmp_path} -> {final_path}: {e}")

    if rename_count > 0:
        logger.info(f"Renamed {rename_count} asset files to match new manifest indices")

    # ── Phase 2: Delete orphaned files by scanning the assets directory ──
    # Any asset_* file whose (scene_idx, sub_idx) position is NOT in
    # kept_positions (from the new manifest) is orphaned and can be removed.
    # This replaces the old approach of iterating old-manifest positions,
    # which broke when scene insert/deletion shifted indices.
    if assets_dir.exists():
        for file_path in assets_dir.iterdir():
            if not file_path.is_file():
                continue
            match = re.match(r"asset_(\d+)_(\d+)", file_path.stem)
            if not match:
                continue
            scene_idx, sub_idx = int(match.group(1)), int(match.group(2))
            if (scene_idx, sub_idx) in kept_positions:
                preserved_files.append(str(file_path))
            else:
                # Check it's one of the known extensions
                if file_path.suffix.lower() in [".mp4", ".jpg", ".png", ".jpeg"]:
                    try:
                        file_path.unlink()
                        deleted_files.append(str(file_path))
                        logger.info(f"Deleted orphaned asset: {file_path}")
                    except Exception as e:
                        logger.warning(f"Could not delete {file_path}: {e}")

    # Embed content hash into each manifest entry for change detection on pipeline resume
    if content_hash:
        for entry in new_manifest_data:
            if isinstance(entry, dict):
                entry["_content_hash"] = content_hash

    # Backport _voiceover_* and related metadata from old manifest entries that may not
    # be present in the frontend-provided manifestData (e.g. manifests generated before
    # these fields were introduced). Without this, pipeline resume would detect stale
    # voiceover on every re-run because _voiceover_engine would be None.
    voiceover_keys = ["_voiceover_engine", "_voiceover_voice", "_voiceover_speed", "_voiceover_pitch"]
    old_by_key = {}
    for idx, old_entry in enumerate(old_manifest):
        if isinstance(old_entry, dict):
            key = (old_entry.get("section_type"), old_entry.get("title", ""), old_entry.get("text", ""))
            old_by_key[key] = old_entry
            old_by_key[idx] = old_entry  # fallback by position
    for new_idx, new_entry in enumerate(new_manifest_data):
        if not isinstance(new_entry, dict):
            continue
        has_any = any(k in new_entry for k in voiceover_keys)
        if has_any:
            continue
        key = (new_entry.get("section_type"), new_entry.get("title", ""), new_entry.get("text", ""))
        match = old_by_key.get(key) or old_by_key.get(new_idx)
        if match and isinstance(match, dict):
            for k in voiceover_keys:
                if k in match:
                    new_entry[k] = match[k]

    # Write new manifest to disk
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(new_manifest_data, f, indent=2, ensure_ascii=False)
        logger.info(f"Updated manifest file: {output_path}")
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
