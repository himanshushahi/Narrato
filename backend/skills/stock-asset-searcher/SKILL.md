---
name: stock-asset-searcher
version: "1.1"
when_to_use: "When crafting search queries for stock media (Pexels photos/videos, Pixabay photos/videos/illustrations, Wikipedia images) or choosing visual_cue keywords."
---
=== STOCK KEYWORD RULES ===
- The `query` MUST always be in English, even when the video language is Hindi/Marathi/etc.
- Use 1-3 BROAD keywords optimized for stock search engines — NOT sentences.
  GOOD: "city neon"  BAD: "a sprawling city with neon lights at night"
- Prefer concrete, visually rich nouns (e.g. "mountain fog", "trading floor", "old map").
- Avoid abstract words that have no visual representation (e.g. "truth", "freedom").

=== SOURCE SELECTION GUIDE ===

**`source: "pexels"`** — Best for:
- High-quality landscape/portrait **photos** and **B-roll video footage**
- Realistic stock backgrounds, people, cityscapes, nature
- Requires Pexels API key. Supports orientation filtering (landscape/portrait).

**`source: "pixabay"`** — Best for:
- Stock photos (large catalog, similar to Pexels)
- **Transparent-background PNG cutouts**: icons, illustrations, vectors, diagrams, clipart
  → To request transparent assets set `"image_type": "illustration"` or `"image_type": "vector"` on the layer content.
  → Standard `largeImageURL` photos are JPEG. Illustrations/vectors use `webformatURL` (PNG).
- Animation loops, abstract backgrounds, digital art
- Requires Pixabay API key. Falls back to Pexels if key is missing.

**`source: "youtube"`** — Best for:
- **Cinematic B-roll or animation loops** not available on Pexels/Pixabay
- **Timelapse footage**, slow-motion clips, specific aesthetic footage
- Drone shots, aerial views, nature footage with specific atmosphere
- ⚠️ **Slower than Pexels/Pixabay** — yt-dlp must be installed. Use sparingly.
- ⚠️ **Only works on `Video` type layers** (never on `Image` layers).
- Optional fields: `yt_start_offset` (default 15s — skips intros) and `yt_duration` (default 15s, max 30s).
- Use `search_youtube_video` tool to verify a result exists before using this source.

Example AST layer for a YouTube clip:
```json
{
  "type": "Layer", "z_index": 1,
  "content": {
    "type": "Video",
    "query": "city timelapse night cinematic",
    "source": "youtube",
    "yt_start_offset": 20,
    "yt_duration": 12,
    "style": {"width": "100%", "height": "100%", "objectFit": "cover"}
  }
}
```

**Pixabay `image_type` values (use on the layer's `content` object with `source: "pixabay"`):**
| value | Use case |
|---|---|
| `"photo"` | Standard photographic image (JPEG) |
| `"illustration"` | Flat illustrations, PNG with transparency (cutouts, icons) |
| `"vector"` | SVG/vector art, also returned as PNG. Good for logos, diagrams |
| `"all"` | Default — mix of all types |

Example AST layer for a transparent icon overlay:
```json
{
  "type": "Layer", "z_index": 20,
  "content": {
    "type": "Image",
    "query": "rupee coin gold",
    "source": "pixabay",
    "image_type": "illustration",
    "style": {"width": "120px", "height": "120px", "top": "10%", "right": "8%"}
  }
}
```

**`source: "wikipedia"`** — Best for:
- **Real people's portraits**: politicians, CEOs, scientists, historical figures
- **Specific entities**: country flags, company logos, landmarks
- Query MUST be the **exact full name** — no generic descriptors.
  GOOD: `"Narendra Modi"` BAD: `"Indian Prime Minister"`
- Falls back to Pexels if Wikipedia has no image.

=== SEARCH QUALITY ===
- For Pexels photos: add orientation hints when the video format is fixed (landscape/portrait/square).
- For Pexels videos: prefer queries with motion potential (e.g. "traffic timelapse" over "traffic").
- For Wikipedia/portrait: use the EXACT full name of the person/entity only — no descriptors.
- For Pixabay illustrations: use simple, concrete noun keywords (e.g. "rocket launch", "magnifying glass", "gear cog").

=== FALLBACKS ===
- If a search returns nothing, broaden the query to a more generic category, then fall back to a generic scene visual.
- Pixabay automatically falls back to Pexels if the Pixabay API key is not configured.
- Never fabricate an image URL that the search API did not return.
