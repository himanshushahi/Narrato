---
name: declarative-ast
description: Complete capability specification for the Declarative AST rendering engine — layer types, motion grammar, compositing architecture, and core composition rules. Single source of truth for visual skills.
version: "5.1"
when_to_use: "Always loaded during scene visual generation, sub-visual rewrites, and motion graphics planning."
exposure: agent
---

# Declarative AST — Full Capability Specification

> **Role**: Lead Visual Director & Motion Graphics Engineer.
> **Mission**: Emit high-impact, broadcast-grade AST cuts. The deterministic compiler middleware automatically enriches your AST with vignettes, Ken Burns drift, safe-area bounds, and frame-0 delay clamps. Focus your creativity on visual hierarchy, narrative metaphor, and motion choreography.

---

## 0. Quick Reference (Read This First)

```
MANDATORY CONTENT.TYPE: Every Layer MUST have content.type (Text, Counter, Shape, Chart, Background, Image, Video, HTML, Particles, Map, Lottie).
GEOMETRY SOT: style lives inside content as content.style with % strings.
STACKING: children[0]=bottom background canvas, children[N-1]=top foreground.
MEDIA QUERIES: Image and Video layers require 1-3 targeted English keywords.
DETERMINISTIC POLISH: The compiler auto-injects dark vignettes over footage, Ken Burns drift on static images, safe-area bounds, and clamps frame-0 delays.
DESIGN BINDING: Bind colors and typography to active design.json tokens.
```

---

## 1. Composition Hierarchy & Stacking Rules

A cut is a JSON object with `duration`, `transition`, and a `composition` containing ordered `children` layers. Stacking is strictly array order (`children[0]=bottom` ... `children[N-1]=top`):
- `children[0]` = Bottom foundation (Background canvas or Video/Image B-roll)
- `children[1]` = Mid-Back framing & atmosphere (Particles, SVG path, frosted container)
- `children[2]` = Mid-Fore hero subject (Chart, Counter, document card, transparent cutout)
- `children[N-1]` = Top foreground (Kinetic Typography, callout tags, reticles)

**Chapter Guidelines**: NEVER put chapter title cards, pills, or branding text inside cuts — global overlays own chapter branding continuously. Every sub-visual cut must be 100% storytelling.

```json
{
  "duration": 4.5, "transition": "slide_left",
  "emphasis": [{ "at": 2.0, "scale": 1.12, "duration": 0.5 }],
  "composition": {
    "type": "Sequence",
    "children": [
      { "type": "Layer", "name": "Background", "content": { "type": "Background", "background_preset": "grid_flow", "colors": ["#0b0b1a", "#00d4ff", "#7c3aed"], "speed": 1.2 } },
      { "type": "Layer", "name": "Headline", "content": { "type": "Text", "text": "The System Breached", "font": "Outfit", "weight": "800", "color": "#ffffff", "animation_mode": "words_stagger", "highlight_words": ["Breached"], "highlight_color": "#00d4ff", "style": { "position": "absolute", "left": "10%", "top": "40%", "width": "80%", "fontSize": "72px", "textAlign": "center" } },
        "animations": [{ "property": "translateY", "from": 40, "to": 0, "duration": 0.6, "delay": 0.3, "easing": "spring" }, { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out" }] }
    ]
  }
}
```

---

## 2. The 11 Content Types

### 1. Text — Kinetic Typography & Lower-Thirds
```json
{ "type": "Text", "text": "Headline here", "font": "Outfit", "weight": "700", "color": "#ffffff", "animation_mode": "words_stagger", "highlight_words": ["Headline"], "highlight_color": "#facc15", "style": { "fontSize": "64px", "textAlign": "center" } }
```
- `animation_mode`: `"words_stagger"` (word reveal) | `"marker_highlight"` (accent sweep) | `"typewriter"` | `"static"`.
- CTL non-Latin scripts (Hindi, Bengali, Arabic) use Noto fonts (`Noto Sans Devanagari`, `Noto Sans Arabic`) for proper glyph shaping.

### 2. Counter — Animated Numerical Rollups
```json
{ "type": "Counter", "value": 450, "start_value": 0, "prefix": "$", "suffix": "M", "decimals": 1, "format": "compact", "duration": 2.0, "font_size": 84, "title": "CAPITAL RAISED", "color": "#facc15" }
```
- `format`: `"compact"` (1.2M) | `"currency"` ($) | `"percent"` (%) | `"standard"` (commas). Default font_size is 72.

### 3. Shape — Vector Shapes, Paths & Lucide Icons
```json
{ "type": "Shape", "shape_type": "icon", "icon_name": "shield-alert", "stroke": "#00d4ff", "glow": true }
{ "type": "Shape", "shape_type": "rectangle", "fill": "rgba(255,255,255,0.06)", "stroke": "#38bdf8", "stroke_width": 1.5, "corner_radius": 20 }
{ "type": "Shape", "shape_type": "path", "preset_path": "route_arch", "stroke": "#facc15", "draw_animation": true, "glow": true }
```
- Lucide icons are stroke-only outline glyphs: set color via `stroke`, not `fill`. Presets: `route_arch`, `corner_brackets`, `wave_pulse`, `circle_reticle`.

### 4. Chart — Infographics & Data Visualization
```json
{ "type": "Chart", "chart_type": "bar", "data": [{"label": "2023", "value": 45, "color": "#38bdf8"}, {"label": "2024", "value": 85, "color": "#f59e0b"}], "title": "ANNUAL SURGE", "bar_radius": 10, "bar_glow": true }
```
- `chart_type`: `"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`.

### 5. Background — Procedural Kinetic Shaders (Zero Downloads)
```json
{ "type": "Background", "background_preset": "grid_flow", "colors": ["#0b0b1a", "#00d4ff", "#7c3aed"], "speed": 1.2 }
```
- Presets: `"gradient_mesh"`, `"grid_flow"`, `"waves"`, `"dots"`, `"blueprint"`, `"vignette_loop"`, `"paper_grain"`. Fullscreen canvas.

### 6. Image — Stock Photos, Logos & Transparent Cutouts
```json
{ "type": "Image", "query": "cyberpunk hacker terminal", "source": "pexels", "objectFit": "cover" }
{ "type": "Image", "query": "bitcoin coin gold", "source": "pixabay", "image_type": "illustration" }
```
- `source`: `"pexels"` (stock photos) | `"pixabay"` (+ transparent PNG cutouts) | `"wikipedia"` (official logos & portraits) | `"archive"` (vintage & NASA).

### 7. Video — Cinematic B-Roll Footage
```json
{ "type": "Video", "query": "server rack blinking lights", "source": "pexels", "volume": 0, "loop": true }
{ "type": "Video", "query": "spacex rocket launch", "source": "youtube", "yt_start_offset": 15, "yt_duration": 20 }
```
- `source`: `"pexels"` (generic stock) | `"youtube"` (specific events & real tech) | `"archive"` (newsreels).

### 8. Lottie — Vector Micro-Animations
```json
{ "type": "Lottie", "lottie_url": "https://assets.lottiefiles.com/packages/lf20_xyz.json", "loop": true, "playback_rate": 1.0 }
```

### 9. Particles — Atmospheric Ambient Overlays
```json
{ "type": "Particles", "particle_preset": "dust", "particle_count": 40, "particle_opacity": 0.18, "particle_direction": "up" }
```
- Presets: `"dust"`, `"embers"`, `"confetti"`, `"money_rain"`, `"snow"`, `"stars"`. Fullscreen overlay providing cinematic visual depth.

### 10. Map — Geographic Pins & Routes
```json
{ "type": "Map", "map_style": "modern_dark", "locations": [{"name": "New York", "coord": [40.7128, -74.006]}, {"name": "London", "coord": [51.5074, -0.1278]}] }
```
- `map_style`: `"modern_dark"` | `"vintage"` | `"minimal_light"` | `"nautical_blue"`.

### 11. HTML — Rich Document Evidence & UI Canvas
```json
{ "type": "HTML", "html_content": "<div style=\"width:100%;height:100%;box-sizing:border-box;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;font-family:monospace;color:#00ff88\">TRANSACTION VERIFIED</div>" }
```
- Ideal for receipts, bank ledgers, terminal outputs, dossiers, and code snippets. Root must be 100% width and height.

---

## 3. Source Selection — Provider Decision Guide

| Subject | Image Source | Video Source | Strategy |
|---|---|---|---|
| **Real Person / Executive** | `wikipedia` | `youtube` | Exact full name query (e.g. "Sam Altman") |
| **Brand / Company Logo** | `wikipedia` | `youtube` | Exact entity name (e.g. "OpenAI", "Tesla") |
| **Historical Archive / NASA** | `archive` | `archive` / `youtube` | Primary source archival footage & photos |
| **Generic B-Roll / Environment** | `pexels` | `pexels` | Atmospheric cinematic keywords |
| **Transparent PNG / Sticker** | `pixabay` (`image_type: "illustration"`) | — | Isolated objects and transparent icons |

---

## 4. Universal Advanced Manipulation (Any Layer)

### 4.1 Keyframe Animations
```json
[
  { "property": "translateY", "from": 45, "to": 0, "duration": 0.6, "delay": 0.3, "easing": "spring" },
  { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out" }
]
```
- **Properties**: Spatial (`translateY`, `translateX`, `scale`, `rotate`), Optical (`opacity`, `blur`, `brightness`).
- **Easings**: `"spring"` (punchy), `"ease-out"` (smooth deceleration), `"linear"` (steady drift), `"ease-in-out"`, `"bounce"`.
- **Continuous loops**: Add `"loop_mode": "loop"` or `"pingpong"`.

### 4.2 Dynamics & Physical Camera
- `floating: true`: Organic harmonic bobbing motion.
- `motion_blur: true` + `shutter_angle: 180`: Shutter motion blur on spatial transitions.
- `camera_shake`: `"handheld"` (subtle doc breath), `"shockwave"` (screen impact), `"glitch"`.
- `filters`: Presets (`["noir_hard"]`, `["cyberpunk"]`, `["golden_hour"]`, `["cinematic_dark_base"]`) or CSS tokens (`["backdrop-filter: blur(16px)"]`).

---

## 5. Compose Freely (no prescribed looks)

Compose any types and layouts that serve the narrative beat:
- **Depth Hierarchy**: Combine background + atmosphere + hero graphic + typography.
- **Immediate Anchors**: The compiler automatically prevents dead air at 0.0s and injects Ken Burns drift on static images.
- **Transitions**: `"slide_left"`, `"slide_right"`, `"slide_up"`, `"zoom_in"`, `"zoom_out"`, `"fade"`, `"crossfade"`, `"dissolve"`, `"glitch"`.
- **Emphasis Punch**: Mid-cut zoom on pivotal words: `"emphasis": [{ "at": 1.8, "scale": 1.15, "duration": 0.4 }]`.

---

## 6. Multi-Layer Compositing Architecture

```
Layer 3 [Top]:      Kinetic Typography (staggered headline, metric badge)
Layer 2 [Mid-Fore]: Hero Subject (Chart, Counter, document card, transparent cutout)
Layer 1 [Mid-Back]: Atmosphere & Framing (Particles, SVG path brackets, contrast scrim)
Layer 0 [Bottom]:   Canvas Foundation (Background shader or cinematic Video B-roll)
```

---

## 7. Named Composition Recipes

- **Data Drop**: Background grid + glassmorphic card + animated Counter + metric badge.
- **Evidence Dossier**: Darkened archival B-roll + auto-vignette scrim + HTML terminal/document card + headline callout.
- **Split Comparison**: Left & right cards with competing stats and Lucide icons.
- **Kinetic Hook**: Dramatic bold typography with word-stagger reveal over particle burst.

---

## 8. Landscape vs Portrait Mode Reference

- **Landscape (16:9 — 1920×1080)**: Subtitle safe area is bottom 18%. Standard hero cards: `top: "15%", height: "65%"`.
- **Portrait (9:16 — 1080×1920)**: Mobile UI overlays occupy top 10% and bottom 28%. Text is safely clamped between `top: 10%` and `top: 72%` with `width: 84%, left: 8%`.

---

## 9. Design Token Binding

Bind all colors and fonts to active `design.json` tokens:
- `color_palette.primary` → Hero numbers, primary buttons, accents.
- `color_palette.secondary` → Supporting data bars, secondary labels.
- `color_palette.accent` → High-alert badges, highlight markers.
- `color_palette.background` → Procedural background canvas.
- `typography.heading_font` → Titles, counters, display labels.
- `typography.body_font` → Body text, chart labels, captions.
