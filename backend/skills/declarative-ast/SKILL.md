---
name: declarative-ast
description: Complete specification and best practices for the Declarative AST visual rendering engine in Remotion.
version: "1.0"
when_to_use: "Always loaded during scene visual generation, sub-visual rewrites, and motion graphics planning."
---

# Declarative AST Architecture & Motion Graphics Specification

You are the Lead Visual Director and Motion Graphics Engineer for a documentary video rendering engine powered by Remotion.

The engine constructs visuals using an **Abstract Syntax Tree (AST)**. Each sub-visual cut in a scene defines a declarative `composition` tree consisting of `Sequence` nodes (containers) and `Layer` nodes (renderable content).

---

## 1. Composition Hierarchy & Chapter Guidelines (No Static Chapter Title Layers)

```
Root Video Composition (NitishRajputComposition)
├── Scene Sequences (Scene 1, Scene 2, ... cuts)
│   └── Sub-Visual AST Compositions (Charts, Mockups, B-Roll, Kinetic Text) [z-index: 0–39]
├── Global Overlays & Branding Track (Watermarks, Progress Bars, Chapter Pills) [z-index: 95]
└── Kinetic Subtitles Track (Word-level animated captions) [z-index: 100]
```

### 🚫 CRITICAL RULE: NO STATIC CHAPTER TITLES IN SUB-VISUALS
* **DO NOT** add static chapter title badges, scene name cards, or temporary header pills inside sub-visual AST cuts (e.g. `CHAPTER 1: THE DISCOVERY`).
* **Why**: Sub-visual cuts only last 2–4 seconds. Embedding chapter badges inside sub-visuals causes them to flash and abruptly disappear, breaking visual continuity.
* **How Chapters Work**: Chapter names and persistent branding are managed **continuously** across the video at the Root Composition level via the Global Overlays engine (`GlobalOverlaysRenderer`).
* **Sub-Visual Focus**: Every sub-visual must be dedicated 100% to **meaningful content storytelling** — motion graphics, infographics, document evidence, cinematic footage, kinetic typography, and data visualization.

---

## 2. Standardized Z-Index Hierarchy

All AST layers must strictly follow this Z-index scale:

| Z-Index Range | Layer Classification | Description & Examples |
|---|---|---|
| **0 – 9** | **Background Media** | Fullscreen stock video, ambient background images, interactive maps, subtle texture overlays |
| **10 – 29** | **Midground Visuals** | Infographic charts (`Chart`), metric counters (`Counter`), document mockups (`Mockup`), milestone timelines (`Timeline`), vector shapes (`Shape`), picture-in-picture insets, split-screen media |
| **30 – 39** | **Foreground Typography** | Kinetic callouts, quote highlights, data callouts, lower-third titles (respecting subtitle safe area) |
| *95* | *Root Global Overlays* | *Managed automatically by root engine: persistent channel watermark, chapter pill, progress bar* |
| *100* | *Kinetic Subtitles* | *Managed automatically by root engine: word-level subtitle captions* |

---

## 3. The 10 Valid AST Content Types

The `content` object inside every `Layer` must specify one of the **10 supported types**:

### 1. `Chart` (Infographics & Data Visualization)
Renders animated data charts with smooth spring physics.
* **Fields**:
  * `chart_type`: `"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`
  * `data`: Array of objects `[{"label": "2021", "value": 45, "color": "#f59e0b"}, ...]`
  * `title` (optional): Chart headline string
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 15,
  "content": {
    "type": "Chart",
    "chart_type": "bar",
    "title": "ANNUAL REVENUE GROWTH ($M)",
    "data": [
      { "label": "2021", "value": 12, "color": "#38bdf8" },
      { "label": "2022", "value": 28, "color": "#60a5fa" },
      { "label": "2023", "value": 64, "color": "#f59e0b" },
      { "label": "2024", "value": 110, "color": "#10b981" }
    ],
    "style": { "width": "75%", "height": "65%", "left": "12.5%", "top": "15%" }
  }
}
```

---

### 2. `Counter` (High-Impact Metric Callouts)
Renders a dynamic rolling number counter with easing.
* **Fields**:
  * `from`: Starting number (e.g. `0`)
  * `to`: Ending number (e.g. `14200000`)
  * `prefix` (optional): Currency or symbol (e.g. `"$"` or `"₹"`)
  * `suffix` (optional): Unit string (e.g. `"M"`, `"%"` or `"+ Users"`)
  * `decimals` (optional): Number of decimal places (e.g. `1`)
  * `label` (optional): Description underneath counter
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 20,
  "content": {
    "type": "Counter",
    "from": 0,
    "to": 85.4,
    "prefix": "$",
    "suffix": " Billion",
    "decimals": 1,
    "label": "Total Valuation Slashed in 48 Hours",
    "color": "#ef4444",
    "style": { "top": "30%", "left": "10%", "width": "80%" }
  }
}
```

---

### 3. `Mockup` (Documentary Artifacts & Evidence)
Renders stylized real-world artifacts (documents, leaks, tweets, browser pages).
* **Fields**:
  * `preset`: `"newspaper"` | `"document"` | `"browser"` | `"social_post"`
  * `headline`: Primary article or post heading
  * `author` / `handle`: Author details (for social/newspaper)
  * `body`: Text snippet or quote
  * `badge` (optional): Stamp like `"CONFIDENTIAL"`, `"LEAKED"`, `"BREAKING"`
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 15,
  "content": {
    "type": "Mockup",
    "preset": "document",
    "badge": "CLASSIFIED",
    "headline": "INTERNAL AUDIT MEMORANDUM #409",
    "author": "Financial Crimes Investigation Division",
    "body": "Discrepancies identified across offshore transaction logs totaling $240,000,000 between Q2 and Q4.",
    "style": { "width": "65%", "height": "70%", "left": "17.5%", "top": "12%" }
  },
  "animations": [
    { "property": "scale", "from": 0.8, "to": 1.0, "duration": 0.6, "easing": "spring" },
    { "property": "translateY", "from": 60, "to": 0, "duration": 0.6, "easing": "spring" }
  ]
}
```

---

### 4. `Timeline` (Chronological Milestones & Roadmaps)
Renders a sequence of historical dates and events with animated markers.
* **Fields**:
  * `title` (optional): Timeline headline
  * `events`: Array of `[{"year": "2019", "title": "Initial IPO", "description": "Listed on NASDAQ"}, ...]`
  * `orientation`: `"vertical"` | `"horizontal"`
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 15,
  "content": {
    "type": "Timeline",
    "title": "KEY INVESTIGATION MILESTONES",
    "events": [
      { "year": "JAN 2022", "title": "Whistleblower Report", "description": "First internal memo leaked to regulators" },
      { "year": "OCT 2022", "title": "Formal Subpoena", "description": "Federal authorities initiate joint audit" },
      { "year": "MAR 2023", "title": "Court Settlement", "description": "$1.2B civil penalty imposed" }
    ],
    "style": { "width": "80%", "left": "10%", "top": "15%" }
  }
}
```

---

### 5. `Shape` (Vector Shapes, Paths & Callouts)
Renders hardware-accelerated vector shapes (`@remotion/shapes`) and animated SVG path drawings (`@remotion/paths`).
* **Fields**:
  * `shape_type`: `"rectangle"` | `"circle"` | `"star"` | `"triangle"` | `"arrow"` | `"polygon"` | `"path"`
  * `fill`: Hex color or `"transparent"`
  * `stroke`: Border/line color (e.g. `"#f59e0b"`)
  * `stroke_width`: Border width in pixels
  * `radius`: Size in pixels
  * `path_d` (if `shape_type="path"`): SVG path definition string
  * `draw_animation`: `true` (animates line drawing)
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 12,
  "content": {
    "type": "Shape",
    "shape_type": "rectangle",
    "fill": "rgba(245, 158, 11, 0.1)",
    "stroke": "#f59e0b",
    "stroke_width": 2,
    "style": { "width": "400px", "height": "250px", "left": "10%", "top": "20%", "borderRadius": "16px" }
  }
}
```

---

### 6. `Text` (Kinetic Typography & Lower-Thirds)
Renders animated typography with advanced kinetic modes.
* **Fields**:
  * `text`: Content string
  * `font`: Font family name (e.g. `"Inter"`, `"Oswald"`, `"Montserrat"`)
  * `animation_mode`: `"words_stagger"` | `"typewriter"` | `"marker_highlight"` | `"static"`
  * `highlight_words` (optional): Words to accentuate with marker color
  * `highlight_color` (optional): Accent color (e.g. `"#facc15"`)
  * **CRITICAL CTL/INDIC FONT RULE**: For complex scripts (Hindi/Devanagari, Tamil, Bengali, Arabic, etc.), ALWAYS specify a Noto font (e.g. `Noto Sans Devanagari`) to guarantee correct Unicode matra and ligature shaping.
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 30,
  "content": {
    "type": "Text",
    "text": "WHERE DID THE 240 MILLION DOLLARS DISAPPEAR?",
    "font": "Inter",
    "weight": "800",
    "color": "#ffffff",
    "animation_mode": "marker_highlight",
    "highlight_words": ["240 MILLION DOLLARS", "DISAPPEAR?"],
    "highlight_color": "#ef4444",
    "style": {
      "position": "absolute",
      "bottom": "18%",
      "left": "6%",
      "width": "88%",
      "fontSize": "48px",
      "textAlign": "left",
      "textShadow": "0 10px 30px rgba(0,0,0,0.9)"
    }
  }
}
```

---

### 7. `Image` (Photos, Evidence & Vector Cutouts)
Stock photographs, archival portraits, and transparent PNG cutouts.
* **Sources**:
  * `pexels`: High-resolution stock backgrounds and photos.
  * `pixabay`: Stock photos, and with `"image_type": "illustration"` or `"vector"`, transparent PNG cutouts (icons, badges, diagrams).
  * `wikipedia`: Real-world figures, historical events, corporate logos (query must be the exact entity name).
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 0,
  "content": {
    "type": "Image",
    "query": "stock market trading board crash red",
    "source": "pexels",
    "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
  },
  "filters": ["brightness(0.4)", "contrast(1.2)"],
  "animations": [
    { "property": "scale", "from": 1.0, "to": 1.12, "duration": 8.0, "easing": "linear" }
  ]
}
```

---

### 8. `Video` (Dynamic B-Roll & Ambient Motion)
High-energy motion footage and timelapses.
* **Sources**: `pexels` (stock video) or `youtube` (cinematic loops/timelapses via yt-dlp).
* **Audio Rule**: Set `"volume": 0` by default so background video never clashes with voiceover narration.
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 0,
  "content": {
    "type": "Video",
    "query": "server room lights blinking timelapse",
    "source": "pexels",
    "volume": 0,
    "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
  },
  "filters": ["contrast(1.15)", "saturate(1.2)"]
}
```

---

### 9. `Map` (Geographic Context & Route Markers)
Interactive vector maps with highlighted locations.
* **Styles**: `"modern_dark"`, `"vintage"`, `"minimal_light"`, `"nautical_blue"`.
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 5,
  "content": {
    "type": "Map",
    "map_style": "modern_dark",
    "locations": [
      { "name": "New Delhi", "coord": [28.6139, 77.2090] },
      { "name": "Mumbai", "coord": [19.0760, 72.8777] }
    ],
    "style": { "width": "100%", "height": "100%" }
  }
}
```

---

### 10. `HTML` (Custom SVG / CSS Fallback)
Raw SVG or inline HTML markup for bespoke custom diagrams not covered by the standard primitives.
* **Example**:
```json
{
  "type": "Layer",
  "z_index": 15,
  "content": {
    "type": "HTML",
    "html_content": "<style>@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }</style><svg width='100%' height='100%' viewBox='0 0 400 200'><rect width='380' height='180' x='10' y='10' rx='16' fill='rgba(24,24,27,0.8)' stroke='#38bdf8' stroke-width='2'/><text x='30' y='60' fill='#f8fafc' font-family='sans-serif' font-size='20' font-weight='bold'>NETWORK NODE VERIFIED</text></svg>"
  }
}
```

---

## 4. Subtitle Safe Areas & Layout Guidelines

- **Landscape (16:9)**: Kinetic subtitles occupy the bottom 15%. Position lower-third text and midground callouts above `bottom: 18%` (or align to center/top).
- **Portrait (9:16)**: Mobile captions occupy the bottom 25%. Position lower-third text above `bottom: 28%`.
- **Responsive Positioning**: Use percentage coordinates (e.g. `width: "75%"`, `left: "12.5%"`, `top: "15%"`) so compositions scale smoothly across resolutions.
- **Layer Stacking**: Place background footage/images on z-index 0–9, motion primitives (`Chart`, `Counter`, `Mockup`, `Timeline`, `Shape`) on z-index 10–29, and kinetic text callouts on z-index 30–39.


