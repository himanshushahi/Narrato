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

def strip_local_paths(data):
    if isinstance(data, dict):
        return {k: strip_local_paths(v) for k, v in data.items() if k != "local_path"}
    elif isinstance(data, list):
        return [strip_local_paths(v) for v in data]
    return data

def is_visuals_stale(project_dict, project_dir):
    """Check if the sub-visuals in script.json are missing or empty."""
    script_path = project_dir / "script.json"
    if not script_path.exists():
        return True
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script_data = json.load(f)
            
        def has_visuals(section):
            if not section: return False
            return len(section.get('sub_visuals', [])) > 0

        if not has_visuals(script_data.get('introduction')):
            return True
        if not has_visuals(script_data.get('conclusion')):
            return True
            
        scenes = script_data.get('scenes', [])
        if not scenes:
            return True
        for scene in scenes:
            if not has_visuals(scene):
                return True
                
        return False
    except Exception as e:
        logger.warning(f"Failed to check visuals staleness: {e}")
        return True

def _collect_local_paths(node, paths):
    if isinstance(node, dict):
        if "local_path" in node and node["local_path"]:
            paths.append(node["local_path"])
        if "visual_path" in node and node["visual_path"]:
            paths.append(node["visual_path"])
        for v in node.values():
            _collect_local_paths(v, paths)
    elif isinstance(node, list):
        for v in node:
            _collect_local_paths(v, paths)

def _is_preview_temp_path(path_str):
    """True when a stored path points at a transient previews/ file.

    The visual editors (AstGraphicalEditor) write the preview/downloaded file
    path straight into ``composition.content.local_path`` for instant playback.
    Those ``assets/previews/{preview_*,upload_*}`` files are transient: stale
    sweeps and post-save preview cleanup delete them. Anything still pointing
    there at save time must be promoted into ``assets/`` first, otherwise the
    image renders while editing but is gone on revisit.
    """
    if not path_str or not isinstance(path_str, str):
        return False
    lower = path_str.replace("\\", "/").lower()
    if "/previews/" not in lower:
        return False
    base = lower.rsplit("/", 1)[-1]
    return base.startswith("preview_") or base.startswith("upload_")


def promote_preview_paths_to_assets(project_id, script_data=None, manifest_data=None):
    """Copy transient previews/ files into the project assets/ dir.

    Walks ``script_data`` (AST ``local_path``) and ``manifest_data``
    (``visual_path``/``local_path``), copies every existing file that still
    lives under ``assets/previews/`` into ``assets/`` with a stable
    ``asset_<orig_stem>.<ext>`` name, and rewrites the reference in place.

    Idempotent: the same source always maps to the same destination, so repeat
    saves and duplicated cuts sharing one preview converge on one file.
    Returns ``{"promoted": {src: dest}, "count": n}``.
    """
    import shutil
    from backend.core.config import get_storage_dir

    promoted = {}
    try:
        project_dir = get_storage_dir() / project_id
        assets_dir = project_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.warning(f"Preview promotion skipped, assets dir unavailable: {e}")
        return {"promoted": promoted, "count": 0}

    def _same_content(a: Path, b: Path) -> bool:
        """Content equality without hashing gigabytes on the happy path."""
        try:
            if a.stat().st_size != b.stat().st_size:
                return False
        except OSError:
            return False
        # Same size is not same content: compare chunked hashes. Sizes match
        # here, so this only runs on the rare name-collision path.
        try:
            import hashlib as _hl
            ha, hb = _hl.sha256(), _hl.sha256()
            with open(a, "rb") as fa, open(b, "rb") as fb:
                while True:
                    ca, cb = fa.read(1024 * 1024), fb.read(1024 * 1024)
                    if not ca and not cb:
                        break
                    ha.update(ca)
                    hb.update(cb)
            return ha.digest() == hb.digest()
        except OSError:
            return False

    def _dest_for(src_path: Path) -> Path:
        stem = src_path.stem  # e.g. upload_d87ff738 / preview_ab12cd34
        if stem.startswith("asset_"):
            dest_name = src_path.name
        else:
            dest_name = f"asset_{stem}{src_path.suffix.lower()}"
        dest = assets_dir / dest_name
        if dest.exists() and _same_content(dest, src_path):
            return dest
        if not dest.exists():
            return dest
        counter = 1
        while True:
            alt = assets_dir / f"{dest.stem}_{counter}{dest.suffix}"
            if not alt.exists() or _same_content(alt, src_path):
                return alt
            counter += 1
            if counter > 100:
                return alt

    # Resolve once: promotion is strictly contained to this project's
    # previews/ directory. Stored paths arrive from the frontend, so a mere
    # substring check would let a crafted absolute path pointing at a foreign
    # previews/ dir trigger an arbitrary-file copy into assets/.
    try:
        _preview_dir_resolved = (assets_dir / "previews").resolve()
    except Exception:
        _preview_dir_resolved = None

    def _promote_one(path_str):
        if not _is_preview_temp_path(path_str):
            return path_str
        # Already-promoted in this pass (e.g. duplicated cut sharing a preview)
        if path_str in promoted:
            return promoted[path_str]
        try:
            src = Path(path_str)
        except Exception:
            return path_str
        if _preview_dir_resolved is None:
            return path_str
        try:
            inside = src.resolve().relative_to(_preview_dir_resolved)
            _ = inside
        except Exception:
            return path_str
        if not src.exists():
            # Dangling reference (swept preview) — leave as-is; caller renders
            # fallback rather than pointing at a file we cannot materialize.
            logger.warning(f"Preview promotion: source missing, keeping dangling ref: {path_str}")
            return path_str
        try:
            dest = _dest_for(src)
            if not dest.exists():
                import time as _ptime
                shutil.copy(str(src), str(dest))
                _pnow = _ptime.time()
                try:
                    os.utime(dest, (_pnow, _pnow))
                except OSError:
                    pass
                logger.info(f"Promoted preview asset {src.name} -> {dest.name}")
            promoted[path_str] = str(dest)
            return str(dest)
        except Exception as e:
            logger.warning(f"Preview promotion failed for {path_str}: {e}")
            return path_str

    def _walk(node):
        if isinstance(node, dict):
            for key in ("local_path", "visual_path"):
                if node.get(key):
                    node[key] = _promote_one(node[key])
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    try:
        if script_data is not None:
            _walk(script_data)
        if manifest_data is not None:
            _walk(manifest_data)
    except Exception as e:
        logger.warning(f"Preview promotion walk failed: {e}")

    return {"promoted": promoted, "count": len(promoted)}


def is_assets_stale(project_dict, project_dir):
    """Check if the sub-visual structure in script.json differs from manifest, or if files are missing."""
    script_path = project_dir / "script.json"
    if not script_path.exists():
        return True

    manifest_path_str = project_dict.get('assets_manifest_path') if project_dict else None
    manifest_path = Path(manifest_path_str) if manifest_path_str and Path(manifest_path_str).exists() else None
    if not manifest_path:
        for candidate in [project_dir / "voiceover" / "manifest.json", project_dir / "assets" / "assets_manifest.json"]:
            if candidate.exists():
                manifest_path = candidate
                break

    if not manifest_path:
        return True
        
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            assets_manifest = json.load(f)
        with open(script_path, "r", encoding="utf-8") as f:
            script_data = json.load(f)
            
        # Check 1: Are any files missing?
        paths = []
        _collect_local_paths(assets_manifest, paths)
        for p in paths:
            if not Path(p).exists():
                return True
                    
        bg_music = project_dict.get("bg_music_path") if project_dict else None
        if bg_music and not Path(bg_music).exists():
            return True
            
        # Check 2: Did the section count or sub_visuals structure change?
        script_scenes = script_data.get('scenes', []) if isinstance(script_data.get('scenes'), list) else []
        manifest_scenes = [m for m in assets_manifest if m.get("section_type") == "scene"]
        if len(manifest_scenes) != len(script_scenes):
            logger.info(f"assets stale: scene count mismatch (manifest_scenes={len(manifest_scenes)}, script_scenes={len(script_scenes)})")
            return True

        has_intro_in_manifest = any(m.get("section_type") == "introduction" for m in assets_manifest)
        has_intro_in_script = bool(script_data.get("introduction") and (
            script_data["introduction"].get("hook") or script_data["introduction"].get("sub_visuals")
        ))
        if has_intro_in_manifest != has_intro_in_script:
            logger.info(f"assets stale: intro presence mismatch (manifest={has_intro_in_manifest}, script={has_intro_in_script})")
            return True

        has_conclusion_in_manifest = any(m.get("section_type") == "conclusion" for m in assets_manifest)
        has_conclusion_in_script = bool(script_data.get("conclusion") and (
            script_data["conclusion"].get("summary") or script_data["conclusion"].get("cta") or script_data["conclusion"].get("sub_visuals")
        ))
        if has_conclusion_in_manifest != has_conclusion_in_script:
            logger.info(f"assets stale: conclusion presence mismatch (manifest={has_conclusion_in_manifest}, script={has_conclusion_in_script})")
            return True

        scene_counter = 0
        for manifest_scene in assets_manifest:
            sec_type = manifest_scene.get("section_type")
            live_sub_visuals = []
            
            if sec_type == 'introduction' and script_data.get('introduction'):
                live_sub_visuals = script_data['introduction'].get('sub_visuals', [])
            elif sec_type == 'conclusion' and script_data.get('conclusion'):
                live_sub_visuals = script_data['conclusion'].get('sub_visuals', [])
            elif sec_type == 'scene':
                if scene_counter < len(script_scenes):
                    script_scene = script_scenes[scene_counter]
                    live_sub_visuals = script_scene.get('sub_visuals', [])
                scene_counter += 1
                
            orig_sub_visuals = manifest_scene.get("sub_visuals", [])
            
            relevant_live = strip_local_paths(live_sub_visuals)
            relevant_orig = strip_local_paths(orig_sub_visuals)
            
            if relevant_live != relevant_orig:
                logger.info(f"assets stale: sub_visuals changed for section {sec_type}")
                return True

        if scene_counter != len(script_scenes):
            logger.info(f"assets stale: scene count mismatch (processed={scene_counter}, total={len(script_scenes)})")
            return True
                
        return False
    except Exception as e:
        logger.warning(f"Failed to check assets staleness: {e}")
        return True


def _resolve_pexels_orientation(video_format=None):
    """Resolve Pexels preferred and fallback orientations from a video format string.

    Accepts:
      - ``"landscape"``, ``"portrait"``  (project DB values)
      - ``"9:16"``, ``"Shorts/Reels (9:16)"``  (global-setting variants)
      - ``None`` → reads the global ``video_format`` setting

    Returns (preferred_orientation, fallback_orientation).
    """
    from backend.database.db import get_setting

    if video_format is None:
        video_format = get_setting("video_format") or "Shorts/Reels (9:16)"
    preferred = "portrait" if ("9:16" in video_format or video_format == "portrait") else "landscape"
    fallback = "landscape" if preferred == "portrait" else "portrait"
    return preferred, fallback


def search_pexels_photo(query, api_key, video_format=None):
    """Searches Pexels for a photo matching the query. Returns url to download.
    
    Uses the provided video_format (e.g. "landscape", "portrait", "9:16")
    to determine orientation. Falls back to the global setting if not given.
    """
    if not api_key or not query:
        return None
        
    import random
    
    preferred_orientation, fallback_orientation = _resolve_pexels_orientation(video_format)

    def _do_search(orientation):
        safe_query = requests.utils.quote(str(query))
        url = f"https://api.pexels.com/v1/search?query={safe_query}&per_page=5&orientation={orientation}"
        headers = {"Authorization": api_key}
        try:
            res = requests.get(url, headers=headers, timeout=15)
            res.raise_for_status()
            data = res.json()
            photos = data.get("photos", [])
            if photos:
                # Pick a random photo from the top results (up to 3) to add variety
                photo = random.choice(photos[:3])
                return photo.get("src", {}).get("large2x") or photo.get("src", {}).get("original")
        except Exception as e:
            logger.warning(f"Pexels photo search failed for '{query}' with orientation '{orientation}': {e}")
        return None

    result = _do_search(preferred_orientation)
    if result:
        return result
        
    logger.info(f"Pexels photo search returned 0 results for '{query}' ({preferred_orientation}). Retrying with {fallback_orientation}.")
    return _do_search(fallback_orientation)

def search_pexels_video(query, api_key, video_format=None):
    """Searches Pexels for a video matching the query. Returns download url.
    
    Uses the provided video_format (e.g. "landscape", "portrait", "9:16")
    to determine orientation. Falls back to the global setting if not given.
    """
    if not api_key or not query:
        return None
        
    import random
    
    preferred_orientation, fallback_orientation = _resolve_pexels_orientation(video_format)

    def _do_search(orientation):
        safe_query = requests.utils.quote(str(query))
        url = f"https://api.pexels.com/videos/search?query={safe_query}&per_page=5&orientation={orientation}"
        headers = {"Authorization": api_key}
        try:
            res = requests.get(url, headers=headers, timeout=15)
            res.raise_for_status()
            data = res.json()
            videos = data.get("videos", [])
            if videos:
                video = random.choice(videos[:3])
                video_files = video.get("video_files", [])
                # Filter for mp4 and hd or sd
                mp4_files = [vf for vf in video_files if vf.get("file_type") == "video/mp4"]
                if mp4_files:
                    # Try to get hd resolution if possible
                    hd_files = [vf for vf in mp4_files if vf.get("quality") == "hd"]
                    if hd_files:
                        return hd_files[0].get("link")
                    return mp4_files[0].get("link")
        except Exception as e:
            logger.warning(f"Pexels video search failed for '{query}' with orientation '{orientation}': {e}")
        return None

    result = _do_search(preferred_orientation)
    if result:
        return result
        
    logger.info(f"Pexels video search returned 0 results for '{query}' ({preferred_orientation}). Retrying with {fallback_orientation}.")
    return _do_search(fallback_orientation)

def _resolve_pixabay_orientation(video_format=None):
    from backend.database.db import get_setting
    if video_format is None:
        video_format = get_setting("video_format") or "Shorts/Reels (9:16)"
    preferred = "vertical" if ("9:16" in video_format or video_format == "portrait") else "horizontal"
    fallback = "horizontal" if preferred == "vertical" else "vertical"
    return preferred, fallback

def search_pixabay_photo(query, api_key, video_format=None, image_type: str = "all"):
    """Searches Pixabay for a photo matching the query. Returns url to download.

    Args:
        image_type: Pixabay image_type filter — 'all', 'photo', 'illustration', 'vector'.
            Use 'illustration' or 'vector' to request transparent-background PNG assets
            (icons, cutouts, diagrams). The returned URL will be a PNG when these types
            are requested and Pixabay has matching assets.
    """
    if not api_key:
        return None
    import random
    preferred, fallback = _resolve_pixabay_orientation(video_format)
    valid_types = {"all", "photo", "illustration", "vector"}
    image_type = image_type if image_type in valid_types else "all"

    def _do_search(orientation):
        url = (
            f"https://pixabay.com/api/?key={api_key}"
            f"&q={requests.utils.quote(query)}"
            f"&orientation={orientation}"
            f"&image_type={image_type}"
            f"&per_page=5"
        )
        try:
            res = requests.get(url, timeout=15)
            res.raise_for_status()
            data = res.json()
            hits = data.get("hits", [])
            if hits:
                photo = random.choice(hits[:3])
                # For illustrations/vectors Pixabay returns a PNG webformat URL.
                # largeImageURL is always JPEG; for transparent assets prefer webformatURL.
                if image_type in ("illustration", "vector"):
                    return photo.get("webformatURL") or photo.get("largeImageURL")
                return photo.get("largeImageURL")
        except Exception as e:
            logger.warning(f"Pixabay photo search failed for '{query}' with orientation '{orientation}': {e}")
        return None

    result = _do_search(preferred)
    if result:
        return result
    return _do_search(fallback)

def search_pixabay_video(query, api_key, video_format=None):
    """Searches Pixabay for a video matching the query. Returns url to download."""
    if not api_key:
        return None
    import random
    
    # Note: Pixabay doesn't directly support orientation in video search API in the same way, but we can search without it
    # or just use the generic search.
    url = f"https://pixabay.com/api/videos/?key={api_key}&q={requests.utils.quote(query)}&per_page=5"
    try:
        res = requests.get(url, timeout=15)
        res.raise_for_status()
        data = res.json()
        hits = data.get("hits", [])
        if hits:
            video = random.choice(hits[:3])
            videos = video.get("videos", {})
            # Try to get hd
            if videos.get("large", {}).get("url"):
                return videos["large"]["url"]
            if videos.get("medium", {}).get("url"):
                return videos["medium"]["url"]
            if videos.get("small", {}).get("url"):
                return videos["small"]["url"]
    except Exception as e:
        logger.warning(f"Pixabay video search failed for '{query}': {e}")
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


def normalize_video_asset(video_path):
    """
    Normalizes a video file with FFmpeg to make it 100% seekable and flicker-free in Chromium/Remotion:
      1. Forces keyframes (GOP) every 15 frames (-g 15 -keyint_min 15) so Chromium seeks in <2ms.
      2. Normalizes framerate to constant 30 FPS (-r 30).
      3. Faststart flag (-movflags +faststart) so moov headers are at the file beginning.
      4. Standard pixel format (-pix_fmt yuv420p).
    """
    if not video_path:
        return ""
    p = Path(video_path)
    if not p.exists() or p.suffix.lower() not in [".mp4", ".mov", ".webm", ".avi", ".mkv"]:
        return str(video_path)

    ffmpeg_exe = get_ffmpeg_path()
    if not ffmpeg_exe or not Path(ffmpeg_exe).exists():
        return str(video_path)

    temp_normalized = p.with_name(f"{p.stem}_norm.mp4")
    startupinfo = get_startupinfo()

    cmd = [
        str(ffmpeg_exe),
        "-y",
        "-i", str(p),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "18",
        "-g", "15",
        "-keyint_min", "15",
        "-r", "30",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac",
        str(temp_normalized)
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, startupinfo=startupinfo, timeout=120)
        if res.returncode == 0 and temp_normalized.exists() and temp_normalized.stat().st_size > 0:
            target_path = p.with_suffix(".mp4")
            if p.exists() and p != target_path:
                try: p.unlink()
                except: pass
            temp_normalized.replace(target_path)
            logger.info(f"Successfully normalized video asset: {target_path.name}")
            return str(target_path)
        else:
            if temp_normalized.exists():
                try: temp_normalized.unlink()
                except: pass
    except Exception as e:
        logger.warning(f"Exception during video normalization for {video_path}: {e}")
        if temp_normalized.exists():
            try: temp_normalized.unlink()
            except: pass

    return str(video_path)


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

from backend.core.media_types import IMAGE_EXTS, VIDEO_EXTS
KNOWN_MEDIA_EXTENSIONS = sorted(IMAGE_EXTS | VIDEO_EXTS)


def _cleanup_conflicting_asset_files(assets_dir, seg_idx, sub_idx, layer_idx, keep_file=None):
    """Removes existing asset files for the given segment/sub/layer cut with different extensions or legacy naming."""
    prefix = f"asset_{seg_idx:03d}_{sub_idx:02d}_{layer_idx:02d}"
    legacy_prefix = f"asset_{seg_idx:03d}_{sub_idx:02d}"
    keep_norm = None
    if keep_file:
        try:
            keep_norm = os.path.normcase(str(Path(keep_file).resolve()))
        except Exception:
            keep_norm = str(keep_file)

    prefixes = [prefix] if layer_idx > 0 else [prefix, legacy_prefix]
    for check_ext in KNOWN_MEDIA_EXTENSIONS:
        for pfx in prefixes:
            old_f = assets_dir / f"{pfx}{check_ext}"
            if old_f.exists():
                try:
                    if keep_norm and os.path.normcase(str(old_f.resolve())) == keep_norm:
                        continue
                    old_f.unlink()
                    logger.info(f"Removed previous conflicting asset file: {old_f.name}")
                except Exception as e:
                    logger.warning(f"Could not remove old asset file {old_f}: {e}")


def _fetch_ast_layer_asset(layer, assets_dir, seg_idx, sub_idx, layer_idx, api_key, pixabay_api_key, cancel_event, video_format):
    """Downloads media for a single AST layer if it is Image or Video."""
    content = layer.get("content", {})
    content_type = content.get("type", "")
    
    if content_type not in ["Image", "Video"]:
        return layer
        
    existing_path = content.get("local_path", "")
    if existing_path and Path(existing_path).exists():
        logger.info(f"Asset already exists for layer [{seg_idx}:{sub_idx}:{layer_idx}] '{existing_path}', skipping download.")
        return layer
        
    query = content.get("query", "")
    source = content.get("source", "pexels").lower()
    
    if not query:
        return layer
        
    asset_url = None
    # Determine default extension — will be refined once we have the actual URL.
    ext = ".mp4" if content_type == "Video" else ".jpg"

    logger.info(f"Layer [{seg_idx}:{sub_idx}:{layer_idx}] AST search: '{query}' (source: {source}, type: {content_type})")

    if source == "wikipedia" and content_type == "Image":
        asset_url = search_wikipedia_image(query)
        if not asset_url and api_key:
            logger.info("Wikipedia failed, falling back to Pexels.")
            asset_url = search_pexels_photo(query, api_key, video_format)

    elif source == "pixabay":
        if not pixabay_api_key:
            logger.warning("Pixabay API key missing, falling back to Pexels.")
            if content_type == "Video":
                asset_url = search_pexels_video(query, api_key, video_format) if api_key else None
            else:
                asset_url = search_pexels_photo(query, api_key, video_format) if api_key else None
        else:
            if content_type == "Video":
                asset_url = search_pixabay_video(query, pixabay_api_key, video_format)
            else:
                # Pass through image_type if the LLM set it on the layer (e.g. "illustration"
                # for transparent-background PNG cutouts)
                pixabay_image_type = content.get("image_type", "all")
                asset_url = search_pixabay_photo(query, pixabay_api_key, video_format, image_type=pixabay_image_type)

            # fallback to pexels
            if not asset_url and api_key:
                logger.info("Pixabay failed, falling back to Pexels.")
                if content_type == "Video":
                    asset_url = search_pexels_video(query, api_key, video_format)
                else:
                    asset_url = search_pexels_photo(query, api_key, video_format)

    elif source == "youtube":
        if content_type != "Video":
            # YouTube makes no sense for Image layers; fall back to Pexels photo.
            logger.warning("source='youtube' used on a non-Video layer — falling back to Pexels photo.")
            asset_url = search_pexels_photo(query, api_key, video_format) if api_key else None
        else:
            start_offset = int(content.get("yt_start_offset") or 15)
            yt_duration = min(int(content.get("yt_duration") or 15), 30)  # cap at 30s
            dest_file = assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}_{layer_idx:02d}.mp4"
            logger.info(
                f"Layer [{seg_idx}:{sub_idx}:{layer_idx}] YouTube search: '{query}' "
                f"offset={start_offset}s duration={yt_duration}s"
            )
            success = download_youtube_video(
                query, dest_file,
                start_offset=start_offset,
                duration=yt_duration,
                cancel_event=cancel_event,
            )
            if success:
                _cleanup_conflicting_asset_files(assets_dir, seg_idx, sub_idx, layer_idx, keep_file=dest_file)
                content["local_path"] = str(dest_file)
                logger.info(f"Saved YouTube clip to {dest_file}")
                return layer  # local_path already set, skip the URL download path
            else:
                logger.warning(f"YouTube download failed for '{query}', falling back to Pexels video.")
                asset_url = search_pexels_video(query, api_key, video_format) if api_key else None

    else:
        # Default to pexels
        if content_type == "Video" and api_key:
            asset_url = search_pexels_video(query, api_key, video_format)
        elif api_key:
            asset_url = search_pexels_photo(query, api_key, video_format)

    if asset_url:
        # Sniff the real extension from the URL to correctly handle Pixabay PNGs,
        # Wikipedia images (which may be .jpg, .png, .svg, .webp, .avif, .bmp...), etc.
        if content_type != "Video":
            from backend.core.media_types import IMAGE_EXTS as _IMG_EXTS
            url_path = asset_url.split("?")[0].split("#")[0].lower()
            matched = next((e for e in _IMG_EXTS if url_path.endswith(e)), None)
            ext = matched if matched else ".jpg"
        dest_file = assets_dir / f"asset_{seg_idx:03d}_{sub_idx:02d}_{layer_idx:02d}{ext}"
        if download_asset(asset_url, dest_file, cancel_event=cancel_event):
            _cleanup_conflicting_asset_files(assets_dir, seg_idx, sub_idx, layer_idx, keep_file=dest_file)
            if content_type == "Video":
                dest_file = Path(normalize_video_asset(dest_file))
            content["local_path"] = str(dest_file)
            # STRICT: keep the declared content.type — stock search already
            # fetched type-specific results (photo vs video). Warn on mismatch
            # instead of silently flipping, so pipeline output stays predictable.
            from backend.core.media_types import infer_media_type as _infer
            sniffed = _infer(dest_file, content.get("type", ""))
            if sniffed != content.get("type"):
                logger.warning(f"Downloaded {dest_file} looks like '{sniffed}' but layer declares '{content.get('type')}' — keeping declared type.")
            logger.info(f"Saved AST asset to {dest_file} (type: {content.get('type')})")
            
    return layer


def _fetch_ast_assets_for_sub_visual(sub_visual, assets_dir, seg_idx, sub_idx, api_key, pixabay_api_key, cancel_event, video_format):
    """Traverses the AST composition and downloads required media for Image/Video layers."""
    composition = sub_visual.get("composition", {})
    if composition.get("type") == "Sequence":
        children = composition.get("children", [])
        for layer_idx, layer in enumerate(children):
            if cancel_event and cancel_event.is_set():
                raise InterruptedError("Cancelled")
                
            # If it's a Layer containing content, fetch asset
            if layer.get("type") == "Layer" and "content" in layer:
                _fetch_ast_layer_asset(layer, assets_dir, seg_idx, sub_idx, layer_idx, api_key, pixabay_api_key, cancel_event, video_format)
                
    return sub_visual


def _has_meaningful_sub_visuals(subs):
    """Check if sub_visuals list contains non-empty compositions with children."""
    if not isinstance(subs, list) or len(subs) == 0:
        return False
    for sv in subs:
        if isinstance(sv, dict):
            comp = sv.get("composition")
            if isinstance(comp, dict) and comp.get("children"):
                return True
    return False


def fetch_assets_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Assets acquisition step of pipeline."""
    manifest_path_str = project_dict.get('assets_manifest_path')
    manifest_path = Path(manifest_path_str) if manifest_path_str else None
    
    # If the user deleted the assets folder, fallback to the voiceover manifest
    if not manifest_path or not manifest_path.exists():
        manifest_path = project_dir / "voiceover" / "manifest.json"

    if not manifest_path.exists():
        raise FileNotFoundError(f"Segment manifest not found. Please re-run Voiceover generation.")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Sync live sub-visuals from script.json into manifest BEFORE fetching
    script_path = project_dir / "script.json"
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script_data = json.load(f)
            
            script_scenes = script_data.get("scenes", []) if isinstance(script_data.get("scenes"), list) else []
            scene_counter = 0
            for segment in manifest:
                sec_type = segment.get("section_type")
                if sec_type == "introduction" and script_data.get("introduction"):
                    subs = script_data["introduction"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(segment.get("sub_visuals")):
                        if subs:
                            segment["sub_visuals"] = subs
                elif sec_type == "conclusion" and script_data.get("conclusion"):
                    subs = script_data["conclusion"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(segment.get("sub_visuals")):
                        if subs:
                            segment["sub_visuals"] = subs
                elif sec_type == "scene":
                    if scene_counter < len(script_scenes):
                        script_scene = script_scenes[scene_counter]
                        subs = script_scene.get("sub_visuals")
                        if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(segment.get("sub_visuals")):
                            if subs:
                                segment["sub_visuals"] = subs
                    scene_counter += 1
        except Exception as e:
            logger.warning(f"Could not merge script.json into manifest before asset fetch: {e}")

    api_key = get_setting("pexels_api_key")
    pixabay_api_key = get_setting("pixabay_api_key")

    if not api_key and not pixabay_api_key:
        logger.warning("No API keys configured (Pexels/Pixabay). Will fall back to programmatic layouts or text-only AST.")

    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Count total sub_visuals for progress tracking
    total_sub_visuals = sum(len(seg.get("sub_visuals", [])) for seg in manifest)
    total_sub_visuals = max(1, total_sub_visuals)
    completed_sub_visuals = 0

    progress_cb(10.0, "Starting AST visual assets download...")

    # 1. Fetch visual assets for each AST sequence
    for idx, segment in enumerate(manifest):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        sub_visuals = segment.get("sub_visuals", [])
        if not isinstance(sub_visuals, list):
            sub_visuals = []

        for sub_idx, sub_visual in enumerate(sub_visuals):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            _fetch_ast_assets_for_sub_visual(sub_visual, assets_dir, idx, sub_idx, api_key, pixabay_api_key, cancel_event, video_format=project_dict.get("video_format", "landscape"))

            completed_sub_visuals += 1
            progress_cb(
                10.0 + (completed_sub_visuals / total_sub_visuals) * 70.0,
                f"Downloading AST assets... {completed_sub_visuals}/{total_sub_visuals}"
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

    # 4. Save visual_paths back to script.json for persistence without clobbering rich sub-visuals
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script = json.load(f)
                
            script_scenes = script.get("scenes", [])
            manifest_scenes = [m for m in manifest if m.get("section_type") == "scene"]
            
            # Intro
            manifest_intro = next((m for m in manifest if m.get("section_type") == "introduction"), None)
            if manifest_intro and "introduction" in script:
                m_subs = manifest_intro.get("sub_visuals", [])
                if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(script["introduction"].get("sub_visuals")):
                    script["introduction"]["sub_visuals"] = m_subs
                
            # Conclusion
            manifest_conclusion = next((m for m in manifest if m.get("section_type") == "conclusion"), None)
            if manifest_conclusion and "conclusion" in script:
                m_subs = manifest_conclusion.get("sub_visuals", [])
                if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(script["conclusion"].get("sub_visuals")):
                    script["conclusion"]["sub_visuals"] = m_subs
                
            # Scenes
            for i, sc in enumerate(script_scenes):
                if i < len(manifest_scenes):
                    m_subs = manifest_scenes[i].get("sub_visuals", [])
                    if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                        sc["sub_visuals"] = m_subs
                    
            with open(script_path, "w", encoding="utf-8") as f:
                json.dump(script, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to persist visual_paths to script.json: {e}")

    # 5. Clean up any removed/orphaned assets on disk that are not referenced in the manifest
    try:
        cleanup_removed_assets(project_dict['id'], manifest)
    except Exception as e:
        logger.warning(f"Post-download asset reconciliation failed: {e}")

    progress_cb(100.0, "Asset downloading complete!")
    logger.info("Asset gathering pipeline step completed.")


def fetch_single_scene_asset(project_id, manifest_scene_index, sub_visual_index):
    """
    Searches and downloads missing visual assets for a single sub_visual's AST composition,
    and updates the assets manifest file.
    """
    from backend.database.db import get_project, get_setting
    from backend.core.config import get_storage_dir

    project = get_project(project_id)
    if not project:
        logger.error(f"Project not found: {project_id}")
        return {"success": False, "error": "Project not found"}

    manifest_path_str = project.get('assets_manifest_path')
    manifest_path = Path(manifest_path_str) if manifest_path_str else None
    if not manifest_path or not manifest_path.exists():
        manifest_path = Path(get_storage_dir() / project_id / "voiceover" / "manifest.json")

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

    project_dir = get_storage_dir() / project_id
    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Fetch AST assets
    api_key = get_setting("pexels_api_key")
    pixabay_api_key = get_setting("pixabay_api_key")
    _fetch_ast_assets_for_sub_visual(sub_visual, assets_dir, manifest_scene_index, sub_visual_index, api_key, pixabay_api_key, cancel_event=None, video_format=project.get("video_format", "landscape"))

    # Write back the updated manifest
    sub_visuals[sub_visual_index] = sub_visual
    segment["sub_visuals"] = sub_visuals

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Save visual_path back to script.json for persistence
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

    # Reconcile disk assets to purge any superseded cut files
    try:
        cleanup_removed_assets(project_id, manifest)
    except Exception as e:
        logger.warning(f"Single scene asset reconciliation failed: {e}")

    return {"success": True, "segment": segment, "sub_visual": sub_visual}


def preview_asset_download(project_id, query, visual_type="image"):
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

    if not query:
        return {"success": False, "error": "Query is required"}

    api_key = get_setting("pexels_api_key")
    if not api_key:
        return {"success": False, "error": "Pexels API key not configured"}

    from backend.core.config import get_storage_dir
    import uuid
    project_dir = get_storage_dir() / project_id
    assets_dir = project_dir / "assets"
    preview_dir = assets_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    content_type = "Video" if (visual_type or "").lower() == "video" else "Image"
    source = "pexels"

    # Mock AST Layer for preview fetching
    layer = {
        "type": "Layer",
        "content": {
            "type": content_type,
            "query": query,
            "source": source
        }
    }

    _fetch_ast_layer_asset(
        layer, preview_dir, 0, 0, 99, api_key, get_setting("pixabay_api_key"),
        cancel_event=None, video_format=project.get("video_format", "landscape")
    )

    if layer["content"].get("local_path"):
        local_path = layer["content"]["local_path"]
        # Rename to a random ID
        ext = Path(local_path).suffix
        preview_id = uuid.uuid4().hex[:8]
        dest_path = preview_dir / f"preview_{preview_id}{ext}"
        try:
            Path(local_path).rename(dest_path)
            local_path = str(dest_path)
        except:
            pass

        logger.info(f"Preview asset downloaded to {local_path}")
        return {"success": True, "visual_path": local_path}
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
    manifest_path_str = project.get('assets_manifest_path')
    if old_manifest_path:
        old_manifest_file = Path(old_manifest_path)
    elif manifest_path_str:
        old_manifest_file = Path(manifest_path_str)
    else:
        old_manifest_file = get_storage_dir() / project_id / "voiceover" / "manifest.json"

    if output_manifest_path:
        output_path = Path(output_manifest_path)
    else:
        output_path = old_manifest_file

    old_manifest = []
    if old_manifest_file.exists():
        try:
            with open(old_manifest_file, "r", encoding="utf-8") as f:
                old_manifest = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load old manifest from {old_manifest_file}: {e}")

    assets_dir = get_storage_dir() / project_id / "assets"

    # Build set of all kept paths from the AST, script.json, and voiceover manifest
    kept_paths = []
    _collect_local_paths(new_manifest_data, kept_paths)
    
    script_file = get_storage_dir() / project_id / "script.json"
    if script_file.exists():
        try:
            with open(script_file, "r", encoding="utf-8") as f:
                script_content = json.load(f)
            _collect_local_paths(script_content, kept_paths)
        except Exception:
            pass

    vo_manifest_file = get_storage_dir() / project_id / "voiceover" / "manifest.json"
    if vo_manifest_file.exists():
        try:
            with open(vo_manifest_file, "r", encoding="utf-8") as f:
                vo_manifest_content = json.load(f)
            _collect_local_paths(vo_manifest_content, kept_paths)
        except Exception:
            pass

    kept_paths_set = set()
    for p in kept_paths:
        if p and isinstance(p, str):
            try:
                kept_paths_set.add(os.path.normcase(str(Path(p).resolve())))
            except Exception:
                kept_paths_set.add(os.path.normcase(p))

    deleted_files = []
    preserved_files = []

    def _managed_stem(stem: str) -> bool:
        return (
            stem.startswith("asset_")
            or stem.startswith("preview_")
            or stem.startswith("upload_")
        )

    def _reconcile_file(file_path, deleted_files, preserved_files):
        try:
            resolved_norm = os.path.normcase(str(file_path.resolve()))
        except Exception:
            resolved_norm = os.path.normcase(str(file_path))

        if resolved_norm in kept_paths_set:
            preserved_files.append(str(file_path))
        else:
            if file_path.suffix.lower() in KNOWN_MEDIA_EXTENSIONS:
                try:
                    file_path.unlink()
                    deleted_files.append(str(file_path))
                    logger.info(f"Deleted orphaned asset: {file_path.name}")
                except Exception as e:
                    logger.warning(f"Could not delete {file_path}: {e}")

    if assets_dir.exists():
        for file_path in assets_dir.iterdir():
            if not file_path.is_file():
                continue
            # Only clean up managed files (promoted assets, legacy previews,
            # upload copies) — never touch overlays, fonts, or user files.
            if not _managed_stem(file_path.stem):
                continue
            _reconcile_file(file_path, deleted_files, preserved_files)

        # Reconcile transient previews/ copies too: after promotion the
        # originals are unreferenced and would otherwise linger (videos can be
        # hundreds of MB). Referenced previews are always preserved; only
        # unreferenced files older than the abandonment window are removed so
        # in-flight editing previews (not yet saved to disk, hence invisible
        # to the kept-paths set) are never deleted mid-edit.
        previews_dir = assets_dir / "previews"
        if previews_dir.exists():
            import time as _time
            _now = _time.time()
            for file_path in previews_dir.iterdir():
                if not file_path.is_file():
                    continue
                if not _managed_stem(file_path.stem):
                    continue
                try:
                    resolved_norm = os.path.normcase(str(file_path.resolve()))
                except Exception:
                    resolved_norm = os.path.normcase(str(file_path))
                if resolved_norm in kept_paths_set:
                    preserved_files.append(str(file_path))
                    continue
                try:
                    # Use max(mtime, ctime): uploaded copies may carry the
                    # source file's original (years-old) mtime; ctime is the
                    # actual copy time. Prevents deleting in-flight previews
                    # mid-edit during save reconciliation.
                    _st = file_path.stat()
                    _file_time = max(_st.st_mtime, getattr(_st, "st_ctime", _st.st_mtime))
                    if _now - _file_time < 3600:
                        preserved_files.append(str(file_path))
                        continue
                except OSError:
                    pass
                if file_path.suffix.lower() in KNOWN_MEDIA_EXTENSIONS:
                    try:
                        file_path.unlink()
                        deleted_files.append(str(file_path))
                        logger.info(f"Deleted orphaned preview asset: {file_path.name}")
                    except Exception as e:
                        logger.warning(f"Could not delete {file_path}: {e}")
            try:
                if not any(previews_dir.iterdir()):
                    previews_dir.rmdir()
                    logger.info(f"Removed empty previews directory: {previews_dir}")
            except Exception:
                pass

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
    if isinstance(old_manifest, list):
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

    # Write new manifest to disk if output_path is provided
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
