---
name: stock-asset-searcher
version: "2.0"
description: "Stock media search optimization guide for Pexels, Pixabay, Wikipedia, and YouTube asset sourcing in Remotion AST layers."
when_to_use: "When crafting search queries for stock media (Pexels photos/videos, Pixabay photos/videos/illustrations, Wikipedia images) or choosing visual_cue keywords."
---

# Stock Asset Sourcing & Search Optimization Guide

> **Role**: Asset Acquisition Specialist & Stock Media Researcher  
> **Mission**: Formulate high-signal, keyword-optimized queries for Pexels, Pixabay, Wikipedia, and YouTube that return relevant, high-resolution media without breaking AST contracts.

---

## 1. Quick Reference: Source Capability Matrix

| Source | Content Types | Best Used For | Speed | Query Rules |
|---|---|---|---|---|
| **`pexels`** | `Image`, `Video` | High-quality cinematic B-roll, 4K nature/cityscapes, realistic photography | Fast | 1–3 broad English keywords (e.g. `"city neon"`) |
| **`pixabay`** | `Image`, `Video` | Transparent PNG cutouts, vector art, icon badges, digital illustrations | Fast | Concrete nouns + `"image_type": "illustration"` or `"vector"` |
| **`wikipedia`** | `Image` only | Real historical figures, politicians, CEOs, company logos, country flags | Medium | **EXACT entity name** (e.g. `"Narendra Modi"`, `"Apple Inc."`) |
| **`youtube`** | `Video` only | Specialized timelapses, aerial drone views, unique documentary clips | Slower | Must verify via search tool first; set `yt_start_offset` & `yt_duration` |

---

## 2. Stock Keyword & Query Formatting Rules

- The `query` MUST always be in English, even when the video language is Hindi/Marathi/etc.
- Use 1-3 BROAD keywords optimized for stock search engines — NOT sentences.
  * **GOOD**: `"city neon"`  
  * **BAD**: `"a sprawling city with neon lights at night"`
- Prefer concrete, visually rich nouns (e.g. `"mountain fog"`, `"trading floor"`, `"old map"`).
- Avoid abstract words that have no visual representation (e.g. `"truth"`, `"freedom"`).

---

## 3. Media Source Selection Guide

### 1. Pexels (`source: "pexels"`)
- High-quality landscape/portrait **photos** and **B-roll video footage**.
- Realistic stock backgrounds, people, cityscapes, nature.
- Supports orientation filtering (landscape/portrait).

### 2. Pixabay (`source: "pixabay"`)
- Stock photos (large catalog, similar to Pexels).
- **Transparent-background PNG cutouts**: icons, illustrations, vectors, diagrams, clipart.
  * To request transparent assets set `"image_type": "illustration"` or `"image_type": "vector"` on the layer content.
  * Standard `largeImageURL` photos are JPEG. Illustrations/vectors use `webformatURL` (PNG).
- Animation loops, abstract backgrounds, digital art.
- If Pixabay has no match, the system automatically tries Pexels instead.

**Pixabay `image_type` values (use on layer `content` with `source: "pixabay"`):**

| Value | Output Format | Primary Use Case |
|---|---|---|
| `"photo"` | JPEG | Standard photographic stock image |
| `"illustration"` | PNG (Transparent) | Flat illustrations, cutouts, UI badges, isolated icons |
| `"vector"` | SVG / PNG | Vector graphics, company logos, structural diagrams |
| `"all"` | Mixed | Default catalog mix |

Example AST layer for a transparent icon overlay (LayerBox SOT v1: `%`-only boxes, `left` anchor — never `px`, never `right`):
```json
{
  "type": "Layer",
  "content": {
    "type": "Image",
    "query": "rupee coin gold",
    "source": "pixabay",
    "image_type": "illustration",
    "style": { "position": "absolute", "width": "8%", "height": "12%", "top": "10%", "left": "84%" }
  }
}
```

### 3. YouTube (`source: "youtube"`)
- **Cinematic B-roll or animation loops** not available on Pexels/Pixabay.
- **Timelapse footage**, slow-motion clips, specific aesthetic footage.
- Drone shots, aerial views, nature footage with specific atmosphere.
- ⚠️ **Slower than Pexels/Pixabay** — use sparingly.
- ⚠️ **Only works on `Video` type layers** (never on `Image` layers).
- Optional fields: `yt_start_offset` (default 15s — skips intros) and `yt_duration` (default 15s, max 30s).
- Verify a result exists before using this source (Internal pipeline: `search_youtube_video` tool | External MCP Agent: `search_media(source="youtube_video", query=...)`).

Example AST layer for a YouTube clip:
```json
{
  "type": "Layer",
  "content": {
    "type": "Video",
    "query": "city timelapse night cinematic",
    "source": "youtube",
    "yt_start_offset": 20,
    "yt_duration": 12,
    "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
  }
}
```

### 4. Wikipedia (`source: "wikipedia"`)
- **Real people's portraits**: politicians, CEOs, scientists, historical figures.
- **Specific entities**: country flags, company logos, landmarks.
- Query MUST be the **exact full name** — no generic descriptors.
  * **GOOD**: `"Narendra Modi"`  
  * **BAD**: `"Indian Prime Minister"`
- Falls back to Pexels if Wikipedia has no image.

---

## 4. Search Quality & Entity Guidelines

- **For Pexels photos**: add orientation hints when the video format is fixed (landscape/portrait).
- **For Pexels videos**: prefer queries with motion potential (e.g. `"traffic timelapse"` over `"traffic"`).
- **For Wikipedia/portrait**: use the EXACT full name of the person/entity only — no descriptors.
- **For Pixabay illustrations**: use simple, concrete noun keywords (e.g. `"rocket launch"`, `"magnifying glass"`, `"gear cog"`).

---

## 5. Fallback Rules & Media Contract

- If a search returns nothing, broaden the query to a more generic category, then fall back to a generic scene visual.
- If Pixabay has no match, the system automatically tries Pexels instead.
- **QUERY-ONLY CONTRACT**: Output ONLY `query` and `source`. Never fabricate an image URL or copy URLs into AST JSON — downstream pipeline downloads and resolves local paths automatically.

---

## 6. Pre-Search Verification Checklist

- [ ] Query is written in English (1–3 broad keywords)
- [ ] Wikipedia queries use exact entity names (e.g., `"Satya Nadella"`)
- [ ] Transparent graphics use `source: "pixabay"` with `image_type: "illustration"`
- [ ] YouTube sources specify `yt_start_offset` and `yt_duration`
- [ ] No fabricated remote URLs in layer content
