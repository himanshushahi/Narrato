---
name: stock-asset-searcher
version: "2.0"
description: "Stock media search optimization guide for Pexels, Pixabay, Wikipedia, YouTube, and Internet Archive asset sourcing in Remotion AST layers."
when_to_use: "When crafting search queries for stock media (Pexels photos/videos, Pixabay photos/videos/illustrations, Wikipedia images, Internet Archive historical media) or choosing visual_cue keywords."
---

# Stock Asset Sourcing & Search Optimization Guide

> **Role**: Asset Acquisition Specialist & Stock Media Researcher  
> **Mission**: Formulate high-signal, keyword-optimized queries for Pexels, Pixabay, Wikipedia, YouTube, and Internet Archive that return relevant, high-resolution media without breaking AST contracts.

---

## 1. Quick Reference: Source Capability Matrix

| Source | Content Types | Best Used For | Speed | Query Rules |
|---|---|---|---|---|
| **`pexels`** | `Image`, `Video` | High-quality cinematic B-roll, 4K nature/cityscapes, realistic photography | Fast | 1–3 broad English keywords (e.g. `"city neon"`) |
| **`pixabay`** | `Image`, `Video` | Transparent PNG cutouts, vector art, icon badges, digital illustrations | Fast | Concrete nouns + `"image_type": "illustration"` or `"vector"` |
| **`wikipedia`** | `Image` only | Real historical figures, politicians, CEOs, company logos, country flags | Medium | **EXACT entity name** (e.g. `"Narendra Modi"`, `"Apple Inc."`) |
| **`youtube`** | `Video` only | Real-world news & events, tech/product demos, science simulations, archival footage | Automatic (yt-dlp) | 1–4 specific English keywords (e.g. `"spacex starship launch"`) |
| **`archive`** | `Image`, `Video` | Authentic historical newsreels, space/NASA missions, vintage photography, documentary archives | Fast (Open API) | 1–4 specific English keywords (e.g. `"apollo 11 astronaut"`, `"great depression breadline"`) |

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
- **WHEN TO USE (Primary Trigger Rule)**: Choose YouTube whenever the narration refers to **real-world subjects, branded hardware, or events that generic stock libraries (Pexels) do not have**:
  * **Real-World Events & News**: rocket launches (SpaceX, NASA), courtroom trials, protests, political summits, historic speeches.
  * **Tech & Product Demonstrations**: Tesla Cybertruck driving, Apple Vision Pro review, Nvidia GPU keynote, Boston Dynamics robotics.
  * **Scientific Explanations & 3D Simulations**: how the immune system fights viruses, quantum computer simulations, black hole accretion disk, surgical procedures.
  * **Documentary & Archival Moments**: historic moments, archival broadcast news, Apollo 11 moon landing broadcast, 2008 financial crisis.
  *(Note: For generic ambient mood footage like generic office workers or sunset clouds, prefer `pexels`)*.
- **Strictly for Video**: `source: "youtube"` is strictly for `Video` layers (never for `Image` layers).
- **Automatic Clip Extraction**: The pipeline automatically downloads and extracts a clean 1080p MP4 clip via `yt-dlp`.
- **Timing Parameters**:
  * `yt_start_offset`: Seconds to skip from video start to bypass channel intros/logos (default `15s`).
  * `yt_duration`: Seconds of footage to capture (default `15s`, pipeline maximum `30s`).
- Optional pre-verification: In MCP, you can call `search_media(source="youtube_video", query=...)` to preview title and duration.

Example AST layer for a YouTube clip:
```json
{
  "type": "Layer",
  "content": {
    "type": "Video",
    "query": "spacex starship launch cinematic",
    "source": "youtube",
    "yt_start_offset": 15,
    "yt_duration": 15,
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

### 5. Internet Archive (`source: "archive"`)
- **Dual Support**: Supports BOTH `Image` and `Video` content types.
- **Zero API Keys Required**: Direct access to millions of public domain media items on archive.org.
- **WHEN TO USE (Primary Trigger Rule)**:
  * **Historic & Archival Events**: Apollo missions, moon landings, early 20th century history, World War newsreels, Great Depression, historic speeches.
  * **Space & NASA Archival Footage**: Space Shuttle launches, Mars Rover images, ISS footage, Hubble photography.
  * **Vintage & Classic Documentaries**: Classic public domain educational films, archival news broadcasts, retro city streetscapes.
  * **Authentic Documentary Proof**: Historical documents, vintage patents, newspaper front pages, antique maps.
- **Automatic Fallback**: If an archive query yields no files, the pipeline seamlessly falls back to Pexels/Pixabay.
- **Pre-verification**:
  * In MCP, call `search_media(source="archive_photo", query=...)` or `search_media(source="archive_video", query=...)`.
  * For internal LLM, use tools `search_archive_photo` or `search_archive_video`.

Example AST layer for an Internet Archive historic photo:
```json
{
  "type": "Layer",
  "content": {
    "type": "Image",
    "query": "apollo 11 astronaut moon surface",
    "source": "archive",
    "style": { "position": "absolute", "width": "100%", "height": "100%", "objectFit": "cover" }
  }
}
```

Example AST layer for an Internet Archive historical video:
```json
{
  "type": "Layer",
  "content": {
    "type": "Video",
    "query": "world war 2 newsreel pacific",
    "source": "archive",
    "style": { "position": "absolute", "width": "100%", "height": "100%", "objectFit": "cover" }
  }
}
```

---

## 4. Search Quality & Entity Guidelines

- **For Pexels photos**: add orientation hints when the video format is fixed (landscape/portrait).
- **For Pexels videos**: prefer queries with motion potential (e.g. `"traffic timelapse"` over `"traffic"`).
- **For Wikipedia/portrait**: use the EXACT full name of the person/entity only — no descriptors.
- **For Pixabay illustrations**: use simple, concrete noun keywords (e.g. `"rocket launch"`, `"magnifying glass"`, `"gear cog"`).
- **For Internet Archive**: use 1–4 specific keywords describing the historical event, mission, or documentary topic (e.g. `"apollo 11"`, `"pearl harbor newsreel"`, `"wright brothers flight"`).

---

## 5. Fallback Rules & Media Contract

- If a search returns nothing, broaden the query to a more generic category, then fall back to a generic scene visual.
- If Pixabay or Archive has no match, the system automatically tries Pexels instead.
- **QUERY-ONLY CONTRACT**: Output ONLY `query` and `source`. Never fabricate an image URL or copy URLs into AST JSON — downstream pipeline downloads and resolves local paths automatically.

---

## 6. Pre-Search Verification Checklist

- [ ] Query is written in English (1–3 broad keywords, or 1–4 specific keywords for YouTube/Archive)
- [ ] Wikipedia queries use exact entity names (e.g., `"Satya Nadella"`)
- [ ] Transparent graphics use `source: "pixabay"` with `image_type: "illustration"`
- [ ] YouTube sources specify `yt_start_offset` and `yt_duration`
- [ ] Archival/historical media uses `source: "archive"` or `source: "youtube"`
- [ ] No fabricated remote URLs in layer content
