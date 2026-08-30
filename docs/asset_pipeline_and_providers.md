# Multi-Source Asset Fetching & Media Pipeline Guide

This document details the architecture, provider integrations, caching strategies, and extension guide for the **Asset Fetching and Media Pipeline** in Remotion Canvas.

---

## 1. Pipeline Architecture & Media Flow

The Asset Pipeline transforms declarative AST queries (e.g., `"source": "pexels"`, `"query": "stock market crash"`, `"source": "youtube"`) into cached, high-performance local media files decoded smoothly by Chromium and Remotion.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DECLARATIVE AST LAYER                            │
│  { "type": "Layer", "content": { "type": "Image"|"Video", "query": "...",  │
│    "source": "pexels"|"pixabay"|"wikipedia"|"youtube" } }                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ASSET PIPELINE (backend/pipeline/assets.py)              │
│                                                                             │
│  _fetch_ast_layer_asset()                                                   │
│   ├── source == "wikipedia" ──► search_wikipedia_image() (MediaWiki API)    │
│   ├── source == "pixabay"   ──► search_pixabay_photo() / _video() (Pixabay) │
│   │                              └─► Transparent PNG cutouts (illustration) │
│   ├── source == "youtube"   ──► download_youtube_video() (yt-dlp slicing)   │
│   └── source == "pexels"    ──► search_pexels_photo() / _video() (Pexels)   │
│                                                                             │
│  Caching: Hashes verified -> downloads to <project_dir>/assets/asset_*.ext │
│  Fallback: Wikipedia -> Pexels | Pixabay -> Pexels | YouTube -> Pexels      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                LOCAL STREAMING FILE SERVER (backend/core/file_server.py)    │
│                                                                             │
│  - Custom HTTP daemon on 127.0.0.1 (Dynamic ephemeral port)                 │
│  - HTTP 206 Partial Content (Byte-Range requests for video seeking)         │
│  - Loopback CORS security + ETag caching + On-demand thumbnails (?thumb=1)  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 FRONTEND REMOTION & WEBVIEW2 VIDEO ENGINE                   │
│                                                                             │
│  - Remotion <Img> / <Video> rendered via getMediaUrlSync(local_path)        │
│  - Codec Verified: H.264/AVC baseline (Chrome headless compatible)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Media Providers & Capabilities Matrix

| Provider | Supported Media Types | Query / Parameter Specifics | Key Functions in `assets.py` | Best Use Cases |
|---|---|---|---|---|
| **Pexels** | Images (JPG/PNG), Videos (MP4) | Uses orientation filtering (`portrait` vs `landscape`). Selects HD 1080p stream. | `search_pexels_photo()`, `search_pexels_video()` | Realistic cinematic B-roll, nature, cityscapes, background footage. |
| **Pixabay** | Photos (JPG), Illustrations / Vectors (Transparent PNG), Videos (MP4) | Supports `image_type="illustration"` or `"vector"`. Returns transparent PNG cutouts via `webformatURL`. | `search_pixabay_photo()`, `search_pixabay_video()` | Floating icon badges, transparent PNG cutout overlays, graphics. |
| **Wikipedia (Wikimedia)** | Entity Portraits, Logos, Historical Photos | Query must be exact entity name (e.g. `"Narendra Modi"`, `"Enron"`). Resolves full-res `imageinfo` canonical URL. | `search_wikipedia_image()`, `_get_original_wikimedia_url()` | Real people portraits, company logos, landmark historical evidence. |
| **YouTube (`yt-dlp`)** | Video Clips (MP4) | Downloads targeted sliced clips using `yt_start_offset` (default 15s) and `yt_duration` (max 30s). | `download_youtube_video()` | Rare documentary footage, timelapses, loops not on stock sites. |

---

## 3. Core Source Implementations

### A. Pixabay Transparent PNG Cutouts
Pixabay supports transparent vector and illustration cutouts.
When the AI sets `"image_type": "illustration"` or `"vector"` on an `Image` layer:
1. `search_pixabay_photo()` queries `https://pixabay.com/api/?image_type=illustration`.
2. Pixabay returns a transparent PNG via `webformatURL` (whereas `largeImageURL` is always JPEG).
3. The downloader detects `.png` extension and saves transparency.

```python
# In backend/pipeline/assets.py
pixabay_image_type = content.get("image_type", "all")
asset_url = search_pixabay_photo(query, pixabay_api_key, video_format, image_type=pixabay_image_type)
```

---

### B. Wikipedia Entity Scraping (Full-Resolution Pipeline)
Wikipedia images are scraped through a 4-step canonical resolution pipeline:
1. **Search Query**: Queries `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={query}` to find the matching Wikipedia article.
2. **PageImage Lookup**: Retrieves the article's `pageimage` filename (e.g., `Harshad_Mehta.jpg`).
3. **Full-Res Canonical Resolution**: Calls `imageinfo` API on Wikimedia Commons to get the original uncompressed source URL.
4. **Header Compliance**: Sends `User-Agent: RemotionCanvas/1.0` and `Referer: https://en.wikipedia.org/` to avoid Wikimedia CDN 403 blocks.

---

### C. YouTube Sliced Downloading (`yt-dlp`)
Rather than downloading full 2-hour videos, `download_youtube_video()` downloads only the required seconds:
```python
# In backend/pipeline/assets.py
cmd = [
    ytdlp_path,
    f"ytsearch1:{query}",
    "-f", "mp4[height<=1080]/bestvideo[height<=1080]+bestaudio/best",
    "--max-downloads", "1",
    "--download-sections", f"*{start_sec}-{end_sec}",
    "--force-keyframes-at-cuts",
    "--merge-output-format", "mp4",
    "--ffmpeg-location", ffmpeg_path,
    "-o", str(dest_path)
]
```

---

## 4. Local File Server & Media Streaming Architecture

Headless Chromium and WebView2 have security restrictions and performance limitations with `file://` URIs:
- Chromium cannot seek / buffer `file://` videos efficiently.
- WebView2 locks files when reading directly.

### The Solution: `backend/core/file_server.py`
1. **Ephemeral Local Port**: Launches an internal HTTP server on `127.0.0.1:<random_port>`.
2. **HTTP 206 Partial Content (Byte-Range Requests)**: Allows instant timeline scrubbing and frame seeking in Remotion Player.
3. **On-Demand Caching Thumbnails**: URL param `?thumb=1` generates and caches lightweight 320px JPEG thumbnails (via Pillow for images and FFmpeg for video poster frames) so MediaSidebar doesn't decode 50 full videos at once.
4. **Loopback CORS Protection**: Validates that requests originate strictly from `localhost` / `127.0.0.1`.

---

## 5. Video Codec Validation (H.264/AVC Probe)

Headless Chrome used by Remotion during video rendering cannot decode HEVC/H.265 (common on iPhones/GoPros) without hardware licensing.

In [**`backend/core/bridge.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/core/bridge.py):
- `_probe_video_codec()` runs `ffprobe` on any user upload.
- Rejects non-Chrome codecs (HEVC, ProRes) before adding them to the project, preventing black export frames.

---

## 6. How to Add a New Stock Media Provider (e.g., Unsplash / Giphy)

Follow this recipe to add a new external media source:

### Step 1: Implement Search Function in `backend/pipeline/assets.py`
```python
def search_unsplash_photo(query: str, api_key: str, video_format: str = "landscape") -> str | None:
    """Searches Unsplash for high-res photography."""
    if not api_key or not query:
        return None
    orientation = "portrait" if video_format == "portrait" else "landscape"
    url = f"https://api.unsplash.com/search/photos?query={requests.utils.quote(query)}&orientation={orientation}&per_page=3"
    headers = {"Authorization": f"Client-ID {api_key}"}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        res.raise_for_status()
        results = res.json().get("results", [])
        if results:
            return results[0]["urls"]["regular"]
    except Exception as e:
        logger.warning(f"Unsplash search failed for '{query}': {e}")
    return None
```

### Step 2: Register Provider in `_fetch_ast_layer_asset()`
In [**`backend/pipeline/assets.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py):
```python
elif source == "unsplash":
    unsplash_key = get_setting("unsplash_api_key")
    if unsplash_key:
        asset_url = search_unsplash_photo(query, unsplash_key, video_format)
    if not asset_url and api_key:
        asset_url = search_pexels_photo(query, api_key, video_format)
```

### Step 3: Expose Provider in AI Skills & Schemas
1. In [**`backend/pipeline/ai.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py): Add `"unsplash"` to `LAYER_CONTENT_SCHEMA["properties"]["source"]["enum"]`.
2. In [**`backend/skills/stock-asset-searcher/SKILL.md`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/stock-asset-searcher/SKILL.md): Add guidelines for when the AI should choose `source: "unsplash"`.
3. In [**`AstGraphicalEditor.tsx`**](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx): Add `<option value="unsplash">Unsplash</option>` to the Source dropdown.

---

## 7. Troubleshooting & Verification

- **Asset download fails**: Verify API keys in the app Settings tab. Check [**`backend/pipeline/assets.py`**](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) logs for 401/403 errors.
- **Wikipedia image 403 Forbidden**: Ensure `WIKIMEDIA_USER_AGENT` and `Referer` headers are intact in `download_asset()`.
- **Video preview black screen**: Check video codec via FFprobe (`H.264/AVC` is required for Chromium).
- **YouTube download timeout**: Verify `yt-dlp.exe` and `ffmpeg.exe` binaries exist in `bin/`. Run the in-app `yt-dlp` update tool from the Settings tab.
