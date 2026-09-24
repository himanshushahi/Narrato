"""
SFX search + download service (Freesound primary, direct-URL fallback).

Freesound APIv2 (free key at https://freesound.org/apiv2/apply):
  GET https://freesound.org/apiv2/search/text/
    ?query=<q>&token=<KEY>&fields=id,name,tags,username,license,previews,duration,avg_rating,num_downloads
    &sort=<score|downloads_desc|rating_desc|created_desc|duration_asc>&page_size=<n>

Pixabay has no official audio API endpoint, so Pixabay CDN mp3 URLs
(https://cdn.pixabay.com/audio/...) are supported as direct download URLs
via download_sfx_url() — used for manual add + AI fallback.
"""
import logging
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

FREESOUND_SEARCH_URL = "https://freesound.org/apiv2/search/text/"
TRENDING_SORTS = ("downloads_desc", "rating_desc", "score", "created_desc")


def _get_freesound_key() -> str:
    try:
        from backend.database.db import get_setting
        return (get_setting("freesound_api_key") or "").strip()
    except Exception:
        return ""


def search_freesound(query: str, api_key: str = "", limit: int = 10,
                     sort: str = "downloads_desc",
                     license_filter: str = "") -> List[Dict[str, Any]]:
    """Search Freesound and return normalized SFX dicts. Empty list on error."""
    import requests
    key = (api_key or _get_freesound_key()).strip()
    if not key:
        return []
    if sort not in TRENDING_SORTS:
        sort = "downloads_desc"
    try:
        limit = max(1, min(50, int(limit)))
    except (ValueError, TypeError):
        limit = 10
    params = {
        "query": query or "",
        "token": key,
        "fields": "id,name,tags,username,license,previews,duration,avg_rating,num_downloads",
        "sort": sort,
        "page_size": limit,
    }
    # Prefer CC0 (commercial-safe) when caller asks; Freesound filter syntax:
    # filter=license:"Creative Commons 0"
    if license_filter == "cc0":
        params["filter"] = 'license:"Creative Commons 0"'
    try:
        res = requests.get(FREESOUND_SEARCH_URL, params=params, timeout=15)
        res.raise_for_status()
        data = res.json()
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        if status in (401, 403):
            raise PermissionError(
                f"Freesound rejected the API key (HTTP {status}). "
                "Check Settings → Stock Media Providers for a valid key.")
        logger.warning(f"Freesound search failed for '{query}': {e}")
        return []
    except Exception as e:
        logger.warning(f"Freesound search failed for '{query}': {e}")
        return []
    out = []
    for s in data.get("results", []):
        previews = s.get("previews") or {}
        preview_url = previews.get("preview-hq-mp3") or previews.get("preview-lq-mp3") or ""
        out.append({
            "id": str(s.get("id", "")),
            "name": s.get("name", "Untitled SFX"),
            "duration": float(s.get("duration") or 0),
            "preview_url": preview_url,
            "license": s.get("license", ""),
            "author": s.get("username", ""),
            "tags": s.get("tags", []),
            "downloads": int(s.get("num_downloads") or 0),
            "rating": float(s.get("avg_rating") or 0),
            "source": "freesound",
        })
    return out


def search_sfx(query: str, limit: int = 10, sort: str = "downloads_desc",
               license_filter: str = "") -> Dict[str, Any]:
    """Unified search used by bridge + file-server + agent tool.

    license_filter="cc0" restricts to Creative Commons 0 (commercial-safe).
    Returns {"query", "sfx": [...], "source", "error"?}.
    """
    key = _get_freesound_key()
    if not key:
        return {
            "query": query,
            "sfx": [],
            "source": "freesound",
            "error": "Freesound API key not configured. Add it in Settings → SFX / API Keys.",
        }
    try:
        results = search_freesound(query, key, limit=limit, sort=sort, license_filter=license_filter)
    except PermissionError as e:
        return {"query": query, "sfx": [], "source": "freesound", "error": str(e)}
    return {"query": query, "sfx": results, "source": "freesound"}


#: Max single SFX download (Freesound previews are ~100-500KB; Pixabay mp3s a few MB).
SFX_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024


def download_sfx_url(url: str, dest: Path, timeout: int = 60) -> Path:
    """Download any direct audio URL (Freesound preview, Pixabay CDN, manual) to dest.

    Only http(s) URLs are accepted and the body is capped at
    SFX_MAX_DOWNLOAD_BYTES to bound disk fill from bad/oversized responses.
    """
    import requests
    from urllib.parse import urlparse
    scheme = urlparse(url or "").scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError(f"Refusing non-HTTP(S) audio URL: {url[:80]}")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "Mozilla/5.0 (Narrato SFX downloader)"}
    total = 0
    with requests.get(url, headers=headers, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    total += len(chunk)
                    if total > SFX_MAX_DOWNLOAD_BYTES:
                        raise ValueError(
                            f"Audio download exceeds {SFX_MAX_DOWNLOAD_BYTES // (1024 * 1024)}MB cap.")
                    f.write(chunk)
    return dest


def probe_audio_seconds(path: Path) -> float:
    """Return audio duration via ffprobe, or -1.0 when the file is not valid audio.

    FileNotFoundError (no ffprobe binary) propagates so callers can tell a
    broken environment apart from a corrupt download.
    """
    import subprocess
    from backend.core.config import get_ffprobe_path, get_startupinfo
    res = subprocess.run(
        [get_ffprobe_path(), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, timeout=10, startupinfo=get_startupinfo())
    if res.returncode == 0 and res.stdout.strip():
        try:
            dur = float(res.stdout.strip())
            return dur if dur > 0 else -1.0
        except (ValueError, TypeError):
            return -1.0
    return -1.0


def build_sfx_clip_dict(clip_id: str, name: str, dest: Path, start_frame: int,
                        dur_frames: int, dur_sec: float, sfx_vol: float = 0.5) -> Dict[str, Any]:
    """Single constructor for sfx_clips entries (shared by bridge + download flows)."""
    return {
        "id": clip_id,
        "name": name or clip_id,
        "audio_path": str(dest),
        "start_frame": max(0, int(start_frame or 0)),
        "duration_frames": dur_frames,
        "source_start_seconds": 0.0,
        "source_duration_seconds": dur_sec,
        "volume": sfx_vol,
        "loop": False,
        "fade_in_seconds": 0.0,
        "fade_out_seconds": 0.0,
        "is_muted": False,
    }


def download_preview_to_project(project_id: str, audio_url: str, name: str = "sfx",
                                start_frame: int = 0) -> Dict[str, Any]:
    """Download a preview/CDN URL into storage/<id>/sfx/ and append to sfx_clips.

    Used by bridge.download_sfx_to_project (SFX tab manual flow).
    """
    import uuid
    from urllib.parse import urlparse
    from backend.core.config import get_storage_dir
    from backend.database.db import get_project, update_project
    import json as _json

    proj_dir = get_storage_dir() / project_id
    sfx_dir = proj_dir / "sfx"
    sfx_dir.mkdir(parents=True, exist_ok=True)

    # Guess extension from URL path, default mp3
    path_part = urlparse(audio_url).path or ""
    ext = Path(path_part).suffix.lower() or ".mp3"
    if ext not in (".mp3", ".wav", ".ogg", ".flac", ".m4a"):
        ext = ".mp3"
    clip_id = f"sfx_{uuid.uuid4().hex[:8]}"
    dest = sfx_dir / f"{clip_id}{ext}"
    try:
        download_sfx_url(audio_url, dest)
    except Exception as e:
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        return {"success": False, "error": f"Download failed: {e}"}

    # Reject non-audio payloads (e.g. an HTML error page saved as .mp3)
    # instead of creating a silent 3s clip that breaks the export mix.
    if dest.stat().st_size < 1024:
        dest.unlink(missing_ok=True)
        return {"success": False, "error": "Downloaded file is too small to be audio — the URL may be expired or invalid."}
    try:
        dur_sec = probe_audio_seconds(dest)
    except FileNotFoundError:
        # No ffprobe binary: environment can't render audio anyway; keep a
        # best-effort clip rather than bricking the feature.
        logger.warning("ffprobe not found while adding SFX; using 3s fallback duration.")
        dur_sec = 3.0
    if dur_sec <= 0:
        dest.unlink(missing_ok=True)
        return {"success": False, "error": "Downloaded file is not valid audio (ffprobe found no duration)."}
    dur_frames = max(6, int(round(dur_sec * 30)))

    try:
        # Fixed per-clip default; the sfx_volume setting acts purely as
        # master gain at mix time (mirrors bg_music_volume vs clip.volume).
        sfx_vol = 0.5
        proj = get_project(project_id) or {}
        raw = proj.get("sfx_clips")
        clips = []
        if raw:
            try:
                clips = _json.loads(raw) if isinstance(raw, str) else list(raw)
            except Exception:
                clips = []
        new_clip = build_sfx_clip_dict(
            clip_id, name or Path(path_part).name or clip_id, dest,
            start_frame, dur_frames, dur_sec, sfx_vol,
        )
        clips.append(new_clip)
        update_project(project_id, sfx_clips=_json.dumps(clips))
        return {"success": True, "clip": new_clip, "clips": clips}
    except Exception as e:
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        return {"success": False, "error": str(e)}
