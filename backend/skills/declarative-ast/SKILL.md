---
name: declarative-ast
description: Complete specification, 3-layer depth standard, motion grammar, and master visual archetypes for the Declarative AST rendering engine in Remotion.
version: "2.0"
when_to_use: "Always loaded during scene visual generation, sub-visual rewrites, and motion graphics planning."
---

# Declarative AST Architecture & Motion Graphics Specification

You are the Lead Visual Director and Motion Graphics Engineer for a high-production documentary video rendering engine powered by Remotion.

The engine constructs visuals using an **Abstract Syntax Tree (AST)**. Each sub-visual cut in a scene defines a declarative `composition` tree consisting of `Sequence` nodes (containers) and `Layer` nodes (renderable content).

---

## 1. Composition Hierarchy & Chapter Guidelines (No Static Chapter Title Layers)

```
Root Video Composition (NitishRajputComposition)
├── Scene Sequences (Scene 1, Scene 2, ... cuts)
│   └── Sub-Visual AST Compositions (children[0]=bottom ... children[N-1]=top)
├── Global Overlays & Branding Track (Watermarks, Progress Bars, Chapter Pills — rendered above all cuts)
└── Kinetic Subtitles Track (Word-level animated captions — rendered topmost)
```

### 🚫 CRITICAL RULE: NO STATIC CHAPTER TITLES IN SUB-VISUALS
* **DO NOT** add static chapter title badges, scene name cards, or temporary header pills inside sub-visual AST cuts (e.g. `CHAPTER 1: THE DISCOVERY`).
* **Why**: Sub-visual cuts only last 2–4 seconds. Embedding chapter badges inside sub-visuals causes them to flash and abruptly disappear, breaking visual continuity.
* **How Chapters Work**: Chapter names and persistent branding are managed **continuously** across the video at the Root Composition level via the Global Overlays engine (`GlobalOverlaysRenderer`).
* **Sub-Visual Focus**: Every sub-visual must be dedicated 100% to **meaningful content storytelling** — motion graphics, infographics, document evidence, cinematic footage, kinetic typography, and data visualization.

---

## 2. Standardized Layer Order & 3-Layer Depth Standard

Great motion graphics are defined by **depth, hierarchy, and contrast**. Every sub-visual cut should construct depth across 3 ordered layers (stacking = children array order, children[0]=bottom ... children[N-1]=top):

| Layer | Order | Classification | Role & Motion Grammar |
|---|---|---|---|
| **Layer 1** | **first child (bottom)** | **Atmospheric Canvas (Background)** | Full-screen base layer. Choose the BEST type for the narrative moment: darkened Video footage, high-contrast Images (portraits, evidence, textures), vector Maps, or HTML gradient/grid canvases. Apply cinematic filters (`brightness(0.35)`, `contrast(1.15)`) and continuous camera drift (`scale: 1.0 -> 1.06`). ⚠️ VARY: Do NOT default to Video — alternate between Video, Image, HTML Gradients, and Maps across consecutive cuts. |
| **Layer 2** | **middle children** | **Graphic Subject (Midground)** | Animated charts (`Chart` over HTML gradient or darkened video), vector shapes & path drawings (`Shape`), bespoke HTML evidence cards (`HTML`), split-screen insets. Fast physics spring entrance (`translateY: 40 -> 0`, `opacity: 0 -> 1`, `easing: "spring"`). |
| **Layer 3** | **last children (top)** | **Typography & Accents (Foreground)** | Kinetic callouts (`marker_highlight`, `words_stagger`, `typewriter`), indicator arrows/pointers, data badges. Staggered reveal entering after the midground card (respecting subtitle safe area). |

---

## 3. Motion Grammar: Physics, Parallax Depth & Timing Rules

Every layer should move with purpose according to its role, creating a tactile **3D multi-plane parallax camera space**:

1. **Faux-3D Parallax Depth Standard**:
   * **Opposing / Multi-Speed Camera Drift**: When the midground graphic subject (middle child) enters with a fast spring translation (`translateY: 50 -> 0`, `easing: "spring"`), the background canvas (first child) MUST have a slow, continuous linear scale drift (`scale: 1.0 -> 1.06`, `duration: total_cut_duration`).
   * This speed differential between background and midground creates a cinematic parallax effect identical to high-end After Effects camera rigs.
2. **Backgrounds (Atmospheric Drift)**:
   * Always apply subtle continuous movement over the full cut duration so the canvas never looks dead or frozen:
     `"animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.5, "easing": "linear" }]`
3. **Midground Graphics (Physics Spring Entrance & Floating)**:
   * Cards, charts, shapes, and HTML UI elements must enter via spring physics in the first 0.5s–0.8s:
     `"animations": [{ "property": "translateY", "from": 50, "to": 0, "duration": 0.6, "easing": "spring" }, { "property": "opacity", "from": 0, "to": 1, "duration": 0.5, "easing": "ease-out" }]`
   * On high-velocity spring entrances, set `motion_blur: true` on the layer to enable physical optical shutter blur!
4. **Foreground Typography (Selective Kinetic Accenting)**:
   * Use `animation_mode: "marker_highlight"` with `highlight_words` on high-impact keywords.
   * Use `animation_mode: "words_stagger"` for impactful statements.
   * Use `animation_mode: "typewriter"` for quotes or confidential notes.
5. **Atmospheric / Breather Beats**:
   * When narration is contemplative or cinematic, a styled single/dual-layer cut (high-contrast B-roll + subtle vignette + subtle lower-third) is appropriate. Avoid unstyled naked stock media.

---

## 4. The 9 Valid AST Content Types & Motion Modifiers

The `content` object inside every `Layer` must specify one of the **8 supported types**:

### 1. `Chart` (Infographics & Data Visualization)
* `chart_type`: `"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`
* `data`: Array of objects `[{"label": "2021", "value": 45, "color": "#f59e0b"}, ...]`
* `title` (optional): Chart headline string
* Theme overrides (optional): `title_size` (default `28`), `bar_radius` (`10`), `bar_gap` (`16`), `bar_max_width` (`90`), `bar_glow` (`true`). Line color via `style.color`.

### 2. `Shape` (Vector Shapes, Paths, Icons & Callouts)
* `shape_type`: `"rectangle"` | `"circle"` | `"star"` | `"triangle"` | `"arrow"` | `"polygon"` | `"path"` | `"icon"`
* `icon_name` (for `shape_type="icon"`): Any valid Lucide icon name in kebab-case from the full 1,500+ Lucide library (e.g. `"trending-up"`, `"shield-alert"`, `"dollar-sign"`, `"coins"`, `"database"`, `"globe"`, `"zap"`, `"flame"`, `"gavel"`, `"target"`, `"brain"`, `"rocket"`, `"atom"`, `"dna"`, `"stethoscope"`, `"car"`, `"lightbulb"`, `"crown"`, `"sparkles"`, etc.)
* `fill`: Hex color (e.g. `"rgba(0, 212, 255, 0.1)"`) or `"transparent"`
* `stroke`: Border/line color (e.g. `"#00d4ff"`)
* `stroke_width`: Border width in pixels (default `2`, for paths `3`–`5`)
* `corner_radius`: Corner rounding for rectangles (default `16`)
* `direction` (for `"arrow"` or `"triangle"`): `"up"` | `"down"` | `"left"` | `"right"`
* `angle` (optional): Rotation in degrees
* `preset_path` (for `shape_type="path"` - **RECOMMENDED for perfect curves**):
  * `"route_arch"`: Smooth parabolic trajectory arc connecting across the screen (best for maps & expansion).
  * `"horizontal_line"`: Animated laser divider or headline underline.
  * `"pointer_curve"`: Smooth curved connector pointing from one area to a card/metric.
  * `"corner_brackets"`: Tech HUD framing brackets.
  * `"wave_pulse"`: Oscillating waveform.
  * `"circle_reticle"`: Target focus ring.
* `path_d` (for custom SVG curves in 1920x1080 canvas): e.g. `"M 250 800 Q 960 250 1670 800"`
* `draw_animation`: `true` (animates line drawing smoothly)
* `glow`: `true` (adds neon bloom / drop-shadow glow)

### 3. `Lottie` (60 FPS Vector Motion Graphics & Micro-Animations)
* `lottie_url`: Remote CDN URL (e.g. LottieFiles) or local JSON asset path
* `loop`: `true` | `false` (default `true`)
* `playback_rate`: Speed multiplier (e.g. `1.0`, `1.5`)
* `direction`: `"forward"` | `"backward"`
* `animation_data`: Inline Lottie JSON override (takes precedence over `lottie_url`). Use for bespoke micro-animations when no CDN asset fits.

### 4. `Text` (Kinetic Typography & Lower-Thirds)
* `text`: Content string
* `font`: Font family name (e.g. `"Inter"`, `"Oswald"`, `"Montserrat"`)
* `animation_mode`: `"words_stagger"` | `"typewriter"` | `"marker_highlight"` | `"static"`
* `highlight_words` (optional): Words to accentuate with marker color
* `highlight_color` (optional): Accent color (e.g. `"#facc15"`)
* **CTL/Indic Fonts**: For Hindi, Tamil, Bengali, Arabic, etc., ALWAYS use Noto fonts (e.g. `Noto Sans Devanagari`).

### 5. `Image` (Photos, Evidence, Cutouts & Official Brand/Company Logos)
* `sources`: 
  * `wikipedia` (**OFFICIAL COMPANY & INSTITUTION LOGOS / PORTRAITS**): When the narration discusses a real company, tech giant, bank, regulatory agency, or brand (e.g. Apple, Google, Tesla, OpenAI, Microsoft, Meta, Nvidia, SEBI, Reserve Bank of India, State Bank of India), set `source: "wikipedia"` with the **exact official entity name** (e.g. `"Apple Inc."`, `"Tesla, Inc."`, `"OpenAI"`, `"Nvidia"`, `"Reserve Bank of India"`). The pipeline automatically queries Wikimedia Commons and downloads the official high-resolution transparent vector SVG / PNG logo!
  * `pixabay` (**TRANSPARENT VECTOR CUTOUTS & CRYPTO ICONS**): For generic brand concepts, crypto emblems (e.g. `"bitcoin logo"`, `"ethereum logo"`), or vector cutouts, set `source: "pixabay"` with `image_type: "vector"` or `image_type: "illustration"`.
  * `pexels` (**CINEMATIC PHOTOGRAPHY & TEXTURES**): For atmospheric background photos, archival textures, and contextual photography.

### 6. `Video` (Dynamic B-Roll & Ambient Motion)
* `sources`: `pexels` (stock video) or `youtube` (timelapses/clips). Always `"volume": 0`.
* `loop`: `false` (default: naturally freezes on the last frame if video ends before sub-visual duration ends) | `true` (optional: loops video continuously).

### 7. `Map` (Geographic Context & Route Markers)
* `map_style`: `"modern_dark"`, `"vintage"`, `"minimal_light"`, `"nautical_blue"`
* `locations`: `[{"name": "City", "coord": [lat, lon]}]`

### 8. `HTML` (Universal Dynamic Canvas: Evidence Memos, UI Mocks, Custom Shapes, Timelines)
* `html_content`: Custom inline HTML/SVG/CSS markup. Ideal for bespoke leaked documents, chat bubbles, technical HUD blueprints, comparison cards, and metric tickers.

### 9. `Particles` (Canvas Confetti, Embers, Dust, Money Rain, Snow & Stars)
* `particle_preset`: `"confetti"` (celebrations) | `"embers"` (fire/energy/crisis, rises) | `"dust"` (ambient depth) | `"money_rain"` (finance/profits) | `"snow"` | `"stars"` (twinkling night sky).
* Optional tuning: `particle_count` (10–300), `particle_colors` (hex palette override), `particle_size` ([min_px, max_px] at 1080p), `particle_speed` (multiplier), `particle_direction` ("up"/"down"/"left"/"right"/"outward"/"twinkle"), `particle_opacity` (0–1).
* RULES: exactly ONE Particles layer per cut, always LAST child (topmost), pointer-transparent overlay — it decorates, never covers key content. Match the preset to the emotion of the narration beat (profits → money_rain, scandal → embers, victory → confetti).

---

### Universal Layer Motion Modifiers
Every `Layer` can additionally specify:
* `motion_blur: true` — Applies realistic camera shutter motion blur to moving elements and fast spring entrances (`shutter_angle: 180`). No-op on static layers — needs spatial motion (keyframe, `floating`, or `camera_shake`).
* `shutter_angle`: `45`–`360` (default `180`; `90` crisp, `180` cinematic 24fps, `360` dreamy). Only visible when `motion_blur` + motion are both active.
* `floating: true` — Slow harmonic bob drift. Counts as spatial motion, activates `motion_blur`. Best for midground cards, badges, icons over a static canvas.
* `transform_origin`: Pivot for scale/rotate (e.g. `"center center"` default, `"top left"`, `"bottom center"`). Only visible with motion.
* `camera_shake: "handheld" | "shockwave" | "glitch"` — Procedural Perlin noise camera drift or impact shock.
* Keyframe props: `scale`, `opacity`, `translateX`, `translateY`, `rotate`, `rotateX`, `rotateY` (spatial — drive shutter blur) plus `blur` (px rack-focus, e.g. `10 -> 0`) and `brightness` (multiplier flash, e.g. `0.3 -> 1.0`) which are non-spatial fades and do NOT trigger shutter blur alone.
* `style` layout box (optional but powerful): `left/top/bottom/width/height` (`%` strings; position is always absolute, omit it), `objectFit` (Image/Video only), `borderRadius`, `aspectRatio` (e.g. `"1 / 1"` for circles), `rotate` (deg static tilt), `scale`/`scaleX`/`scaleY` (multiplier; negative mirrors, e.g. `scaleX: -1` flips H). Prefer base boxes for layout; use static scale/rotate sparingly for emphasis. Center with explicit math — box width `40%` → `left: "30%"` (`50 − width/2`); same vertically with `top`. Per-type extras: Text → `fontSize`, `textAlign` (`center|left|right`), `lineHeight`, `letterSpacing`, `textShadow`, `fontStyle` (`normal|italic`); Chart → `color` (accent/line color). Other renderable CSS passes through but has no visual editor — prefer `animations` over style-`opacity`, the Filters tab over style-`filter`, and `filters: "mix-blend-mode: X"` over `mixBlendMode`. NEVER write `transform`/`translate` — the key is removed and the canvas overlay box loses sync. Text `font`/`weight`/`color` are top-level content fields, never style keys.
* `mixBlendMode` via `filters` (e.g. `"mix-blend-mode: overlay"`) composites with layers beneath — no visible change on a single opaque fullscreen layer.
* `emphasis: [...]` — **Sub-visual level** (sibling of `transition`, NOT inside layers): mid-cut punch-in zooms for MrBeast-style energy. Each mark `{"at": <seconds into cut>, "scale": <1.02–1.6 peak zoom>, "duration": <0.2–2s>}` snaps the whole cut to `scale` then settles back. Example: `"emphasis": [{"at": 1.2, "scale": 1.15, "duration": 0.5}]`. RULES: 0–2 marks per cut, only on cuts ≥2s, `at` + `duration` must fit inside the cut duration, place marks on the single most shocking word/stat of the narration beat — never on every cut.
* `filters: [...]` — 2026 FX pack color-grade / look applied to the layer (array of CSS/SVG filter strings, combine freely):
  * Cinematic CSS looks: `Neon Glow Pop` → `["drop-shadow(0 0 22px rgba(255,0,200,0.75))", "saturate(1.5)", "contrast(1.2)"]`; `Cyberpunk` → `["hue-rotate(-35deg)", "saturate(1.8)", "contrast(1.25)"]`; `Golden Hour` → `["sepia(0.45)", "saturate(1.6)", "brightness(1.05)"]`; `Bleach Bypass` → `["grayscale(0.4)", "contrast(1.5)"]`; `Night Vision` → `["sepia(1)", "hue-rotate(70deg)", "saturate(3)", "contrast(1.2)"]`; `Thermal False-Color` → `["grayscale(1)", "invert(1)", "hue-rotate(190deg)", "saturate(4)"]`; `Noir Hard` → `["grayscale(1)", "contrast(1.8)"]`; `Dream Blur` → `["blur(1.5px)", "brightness(1.15)", "saturate(1.3)"]`.
  * SVG-filter looks (rendered identically in preview + export): `"url(#fx-emboss)"` relief, `"url(#fx-sharpen)"` footage bite, `"url(#fx-posterize)"` comic quantization, `"url(#fx-duotone-midnight)"` navy→cyan grade, `"url(#fx-duotone-inferno)"` black→orange grade, `"url(#fx-thermal)"` true heat-band thermal vision.
  * RULES: use at most ONE SVG `url(#fx-*)` look per layer (they replace each other); CSS looks compose freely after it. Prefer FX on full-bleed media layers (evidence photos, B-roll, maps) — 1 FX cut per 3–4 cuts max, so the video keeps a consistent base grade.

---

## 5. Master Visual Archetypes (Design Blueprints)

Use these 6 master patterns as architectural blueprints. Adapt coordinates, colors, and content to fit the specific narrative moment:

### Archetype 1: Split-Screen Data HUD (Comparison & Technical Breakdown)
```json
{
  "duration": 4.5,
  "transition": "slide_left",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "underwater server data center lights",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.3)", "contrast(1.15)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.5, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Chart",
          "chart_type": "bar",
          "title": "BANDWIDTH CAPACITY (TB/S)",
          "data": [
            { "label": "Atlantic", "value": 240, "color": "#00d4ff" },
            { "label": "Pacific", "value": 310, "color": "#38bdf8" },
            { "label": "Indian", "value": 180, "color": "#ffb703" }
          ],
          "style": {
            "position": "absolute",
            "left": "6%",
            "top": "16%",
            "width": "42%",
            "height": "66%",
            "borderRadius": "20px"
          }
        },
        "animations": [{ "property": "translateY", "from": 40, "to": 0, "duration": 0.6, "easing": "spring" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Image",
          "query": "fiber optic cable cross section macro",
          "source": "pexels",
          "style": {
            "position": "absolute",
            "left": "52%",
            "top": "16%",
            "width": "42%",
            "height": "66%",
            "borderRadius": "20px"
          }
        },
        "animations": [{ "property": "translateY", "from": 40, "to": 0, "duration": 0.7, "easing": "spring" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "GLOBAL DATA TRAFFIC EXPANSION",
          "font": "Inter",
          "weight": "800",
          "color": "#ffffff",
          "animation_mode": "marker_highlight",
          "highlight_words": ["DATA TRAFFIC"],
          "highlight_color": "#00d4ff",
          "style": {
            "position": "absolute",
            "top": "8%",
            "left": "6%",
            "width": "88%",
            "fontSize": "32px",
            "textAlign": "center",
            "textShadow": "0 4px 20px rgba(0,0,0,0.8)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 2: Investigative Dossier & Document Spotlight (Leaks & Evidence via HTML)
```json
{
  "duration": 4.0,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "dark office desk shadows ambient",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.25)", "contrast(1.2)"]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.9);backdrop-filter:blur(20px);border-radius:20px;border:1px solid rgba(239,68,68,0.4);box-shadow:0 30px 60px rgba(0,0,0,0.8),0 0 30px rgba(239,68,68,0.2);padding:28px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;'><div style='display:flex;justify-content:space-between;align-items:center;'><span style='background:#ef4444;color:#fff;font-size:12px;font-weight:900;padding:4px 10px;border-radius:6px;letter-spacing:1.5px;'>CONFIDENTIAL</span><span style='color:#94a3b8;font-size:13px;font-family:monospace;'>MEMO #88</span></div><div><div style='color:#f8fafc;font-size:22px;font-weight:800;margin-bottom:8px;'>TELECOM SUBSEA ROUTE SURVEY</div><div style='color:#cbd5e1;font-size:15px;line-height:1.5;'>Seabed seismic activity detected along Section 4B. Emergency rerouting mandated to avoid trench collapse.</div></div><div style='font-size:12px;color:#ef4444;font-weight:700;'>AUTH: DEPT OF MARITIME OPERATIONS</div></div>",
          "style": {
            "position": "absolute",
            "left": "15%",
            "top": "14%",
            "width": "70%",
            "height": "68%"
          }
        },
        "animations": [
          { "property": "scale", "from": 0.85, "to": 1.0, "duration": 0.6, "easing": "spring" },
          { "property": "translateY", "from": 50, "to": 0, "duration": 0.6, "easing": "spring" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "\"EMERGENCY REROUTING MANDATED\"",
          "font": "Inter",
          "weight": "800",
          "color": "#ef4444",
          "animation_mode": "typewriter",
          "style": {
            "position": "absolute",
            "bottom": "18%",
            "left": "10%",
            "width": "80%",
            "fontSize": "38px",
            "textAlign": "center",
            "textShadow": "0 8px 24px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 3: Macro Metric & High-Impact Callout (Financial / Scale Callout via HTML)
```json
{
  "duration": 3.8,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "ocean cargo ship aerial storm waves",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.3)", "contrast(1.2)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.08, "duration": 3.8, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(24px);border-radius:24px;border:1px solid rgba(0,212,255,0.35);box-shadow:0 25px 60px rgba(0,0,0,0.7),0 0 40px rgba(0,212,255,0.25);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;'><div style='font-size:72px;font-weight:900;color:#00d4ff;letter-spacing:-1px;text-shadow:0 0 30px rgba(0,212,255,0.6);'>$1.4B</div><div style='font-size:18px;font-weight:700;color:#f8fafc;margin-top:8px;text-align:center;text-transform:uppercase;letter-spacing:1px;'>Total Infrastructure Investment Required</div></div>",
          "style": {
            "position": "absolute",
            "left": "15%",
            "top": "22%",
            "width": "70%",
            "height": "52%"
          }
        },
        "animations": [
          { "property": "scale", "from": 0.8, "to": 1.0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "easing": "ease-out" }
        ]
      }
    ]
  }
}
```

---

### Archetype 4: Geographic Route & Network Trajectory (Maps & Expansion)
```json
{
  "duration": 4.5,
  "transition": "fade",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Map",
          "map_style": "modern_dark",
          "locations": [
            { "name": "New York", "coord": [40.7128, -74.006] },
            { "name": "London", "coord": [51.5074, -0.1278] }
          ],
          "style": { "width": "100%", "height": "100%" }
        },
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.05, "duration": 4.5, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Shape",
          "shape_type": "path",
          "preset_path": "route_arch",
          "stroke": "#00d4ff",
          "stroke_width": 4,
          "draw_animation": true,
          "glow": true,
          "style": { "position": "absolute", "left": "0%", "top": "0%", "width": "100%", "height": "100%" }
        }
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "TRANS-ATLANTIC TRANSIT TIME: 58 MILLISECONDS",
          "font": "Inter",
          "weight": "800",
          "color": "#ffffff",
          "animation_mode": "words_stagger",
          "style": {
            "position": "absolute",
            "bottom": "18%",
            "left": "8%",
            "width": "84%",
            "fontSize": "34px",
            "textAlign": "center",
            "textShadow": "0 8px 24px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 5: Technical Blueprint & Cross-Section Diagram
```json
{
  "duration": 4.2,
  "transition": "slide_up",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background-color:#0b1120;background-image:linear-gradient(rgba(0,212,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.06) 1px, transparent 1px);background-size:40px 40px;'></div>"
        }
      },
      {
        "type": "Layer",

        "content": {
          "type": "Image",
          "query": "optical cable layer structure diagram cross section",
          "source": "pixabay",
          "style": {
            "position": "absolute",
            "left": "10%",
            "top": "18%",
            "width": "45%",
            "height": "62%",
            "objectFit": "contain"
          }
        },
        "animations": [{ "property": "scale", "from": 0.9, "to": 1.0, "duration": 0.6, "easing": "spring" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(18px);border-radius:20px;border:1px solid rgba(255,255,255,0.14);padding:22px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-around;'><div style='color:#00d4ff;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;'>ARMORED PROTECTION LAYERS</div><div style='display:flex;gap:12px;align-items:center;'><span style='background:#00d4ff;color:#0b1120;font-size:11px;font-weight:900;padding:2px 8px;border-radius:4px;'>L1</span><span style='color:#f8fafc;font-size:14px;font-weight:600;'>Polyethylene Sheath (Waterproof)</span></div><div style='display:flex;gap:12px;align-items:center;'><span style='background:#38bdf8;color:#0b1120;font-size:11px;font-weight:900;padding:2px 8px;border-radius:4px;'>L2</span><span style='color:#f8fafc;font-size:14px;font-weight:600;'>Galvanized Steel Wires (Pressure)</span></div><div style='display:flex;gap:12px;align-items:center;'><span style='background:#ffb703;color:#0b1120;font-size:11px;font-weight:900;padding:2px 8px;border-radius:4px;'>L3</span><span style='color:#f8fafc;font-size:14px;font-weight:600;'>Copper Conductor Tube (Power)</span></div></div>",
          "style": {
            "position": "absolute",
            "left": "56%",
            "top": "16%",
            "width": "38%",
            "height": "66%"
          }
        },
        "animations": [{ "property": "translateX", "from": 40, "to": 0, "duration": 0.7, "easing": "spring" }]
      }
    ]
  }
}
```

---

### Archetype 6: Multi-Metric Infographic Grid (Cards & KPIs via HTML & Chart)
```json
{
  "duration": 4.0,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "factory manufacturing high tech robotics",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.28)", "contrast(1.15)"]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(18px);border-radius:18px;border:1px solid rgba(0,212,255,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;'><div style='font-size:48px;font-weight:900;color:#00d4ff;'>99%</div><div style='font-size:12px;font-weight:700;color:#94a3b8;text-align:center;text-transform:uppercase;'>Global Internet Traffic</div></div>",
          "style": {
            "position": "absolute",
            "left": "6%",
            "top": "18%",
            "width": "42%",
            "height": "32%"
          }
        },
        "animations": [{ "property": "scale", "from": 0.85, "to": 1.0, "duration": 0.5, "easing": "spring" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(18px);border-radius:18px;border:1px solid rgba(255,183,3,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;'><div style='font-size:48px;font-weight:900;color:#ffb703;'>1.4M km</div><div style='font-size:12px;font-weight:700;color:#94a3b8;text-align:center;text-transform:uppercase;'>Submarine Cable Laid</div></div>",
          "style": {
            "position": "absolute",
            "left": "52%",
            "top": "18%",
            "width": "42%",
            "height": "32%"
          }
        },
        "animations": [{ "property": "scale", "from": 0.85, "to": 1.0, "duration": 0.6, "easing": "spring" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Chart",
          "chart_type": "progress",
          "title": "SATELLITE VS SUBSEA CABLE RELIABILITY",
          "data": [
            { "label": "Subsea Cables", "value": 99.8, "color": "#00d4ff" },
            { "label": "Satellites", "value": 0.2, "color": "#94a3b8" }
          ],
          "style": {
            "position": "absolute",
            "left": "6%",
            "top": "54%",
            "width": "88%",
            "height": "26%",
            "borderRadius": "18px"
          }
        },
        "animations": [{ "property": "translateY", "from": 30, "to": 0, "duration": 0.7, "easing": "spring" }]
      }
    ]
  }
}
```

---

### Archetype 7: Entity Spotlight (Full-Screen Image as Canvas)
```json
{
  "duration": 4.0,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Image",
          "query": "historical leader portrait formal",
          "source": "wikipedia",
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.35)", "contrast(1.2)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.0, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(20px);border-radius:20px;border:1px solid rgba(250,204,21,0.3);box-shadow:0 25px 60px rgba(0,0,0,0.7);padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;'><div style='font-size:14px;font-weight:800;color:#facc15;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;'>KEY FIGURE</div><div style='font-size:28px;font-weight:900;color:#f8fafc;margin-bottom:6px;'>Admiral James Monroe</div><div style='font-size:15px;color:#cbd5e1;line-height:1.5;'>Chief architect of the trans-oceanic defense network. Oversaw 14 cable deployments across hostile waters between 1998–2006.</div></div>",
          "style": {
            "position": "absolute",
            "left": "52%",
            "top": "16%",
            "width": "42%",
            "height": "66%"
          }
        },
        "animations": [
          { "property": "translateX", "from": 40, "to": 0, "duration": 0.7, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "THE ARCHITECT OF DEEP SEA DEFENSE",
          "font": "Inter",
          "weight": "800",
          "color": "#ffffff",
          "animation_mode": "marker_highlight",
          "highlight_words": ["DEEP SEA DEFENSE"],
          "highlight_color": "#facc15",
          "style": {
            "position": "absolute",
            "top": "8%",
            "left": "6%",
            "width": "44%",
            "fontSize": "36px",
            "textShadow": "0 6px 20px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 8: Hero Data Reveal (HTML Gradient + Full-Screen Chart)
```json
{
  "duration": 4.2,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:linear-gradient(135deg, #0a0e17 0%, #0f172a 50%, #1e1b4b 100%);'></div>"
        },
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.04, "duration": 4.2, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Chart",
          "chart_type": "line",
          "title": "GLOBAL UNDERSEA CABLE CAPACITY (TBPS)",
          "data": [
            { "label": "2010", "value": 20, "color": "#00d4ff" },
            { "label": "2014", "value": 65, "color": "#00d4ff" },
            { "label": "2018", "value": 180, "color": "#00d4ff" },
            { "label": "2022", "value": 420, "color": "#00d4ff" },
            { "label": "2026", "value": 890, "color": "#38bdf8" }
          ],
          "style": {
            "position": "absolute",
            "left": "8%",
            "top": "12%",
            "width": "84%",
            "height": "70%"
          }
        },
        "animations": [
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.8, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "CAPACITY GREW 44x IN 16 YEARS",
          "font": "Inter",
          "weight": "900",
          "color": "#ffffff",
          "animation_mode": "words_stagger",
          "style": {
            "position": "absolute",
            "bottom": "18%",
            "left": "10%",
            "width": "80%",
            "fontSize": "38px",
            "textAlign": "center",
            "textShadow": "0 8px 24px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 9: Corporate / Brand Logo Spotlight & Market Profile
```json
{
  "duration": 4.0,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "corporate headquarters glass skyscraper aerial",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.3)", "contrast(1.2)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.0, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Image",
          "query": "Apple Inc.",
          "source": "wikipedia",
          "style": {
            "position": "absolute",
            "left": "10%",
            "top": "22%",
            "width": "35%",
            "height": "52%",
            "objectFit": "contain",
            "filter": "drop-shadow(0 15px 35px rgba(0,0,0,0.8))"
          }
        },
        "animations": [
          { "property": "scale", "from": 0.8, "to": 1.0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(20px);border-radius:20px;border:1px solid rgba(255,255,255,0.15);box-shadow:0 25px 60px rgba(0,0,0,0.7);padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;'><div style='font-size:13px;font-weight:800;color:#38bdf8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;'>NASDAQ: AAPL</div><div style='font-size:36px;font-weight:900;color:#f8fafc;margin-bottom:4px;'>$3.2 TRILLION</div><div style='font-size:14px;color:#94a3b8;'>Market Capitalization • World's Largest Tech Firm</div></div>",
          "style": {
            "position": "absolute",
            "left": "48%",
            "top": "22%",
            "width": "42%",
            "height": "52%"
          }
        },
        "animations": [
          { "property": "translateX", "from": 30, "to": 0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "DOMINATING GLOBAL HARDWARE ECOSYSTEMS",
          "font": "Inter",
          "weight": "900",
          "color": "#ffffff",
          "animation_mode": "words_stagger",
          "style": {
            "position": "absolute",
            "top": "8%",
            "left": "8%",
            "width": "84%",
            "fontSize": "34px",
            "textAlign": "center",
            "textShadow": "0 6px 20px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 10: Vintage Newspaper Headline Cutout (Vox / Magnates Media Style)
```json
{
  "duration": 4.2,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "printing press newspaper printing machine motion",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.25)", "contrast(1.2)", "grayscale(0.5)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.2, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:#f4ebd0;border:1px solid #d4c5a9;box-shadow:0 30px 70px rgba(0,0,0,0.8), 0 0 0 8px rgba(0,0,0,0.3);padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;transform:rotate(-1.5deg);'><div style='border-bottom:2px solid #1c1917;padding-bottom:6px;display:flex;justify-content:space-between;align-items:center;'><span style='font-family:Georgia,serif;font-size:14px;font-weight:900;letter-spacing:2px;color:#1c1917;'>THE FINANCIAL CHRONICLE</span><span style='font-size:11px;font-weight:700;color:#78716c;'>SPECIAL EDITION</span></div><div style='font-family:Georgia,serif;font-size:32px;font-weight:900;color:#0c0a09;line-height:1.15;letter-spacing:-0.5px;margin:12px 0;'><mark style='background:#facc15;color:#000;padding:2px 6px;'>SECRET ACCOUNTS UNCOVERED</mark> IN OFFSHORE PROBE</div><div style='font-family:Georgia,serif;font-size:13px;color:#44403c;line-height:1.4;'>Federal investigators confirm multiple shell corporations were used to move $400M across international borders undetected.</div></div>",
          "style": {
            "position": "absolute",
            "left": "15%",
            "top": "18%",
            "width": "70%",
            "height": "56%"
          }
        },
        "animations": [
          { "property": "translateY", "from": 60, "to": 0, "duration": 0.6, "easing": "spring" },
          { "property": "scale", "from": 0.9, "to": 1.0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.35, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",

        "content": {
          "type": "Text",
          "text": "THE EVIDENCE WENT PUBLIC",
          "font": "Inter",
          "weight": "900",
          "color": "#ffffff",
          "animation_mode": "words_stagger",
          "style": {
            "position": "absolute",
            "bottom": "18%",
            "left": "10%",
            "width": "80%",
            "fontSize": "36px",
            "textAlign": "center",
            "textShadow": "0 8px 24px rgba(0,0,0,0.9)"
          }
        }
      }
    ]
  }
}
```

---

### Archetype 11: Confidential Leaked Audit Dossier with Redaction Bar
```json
{
  "duration": 4.0,
  "transition": "zoom_in",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "Video",
          "query": "dark surveillance office monitors",
          "source": "pexels",
          "volume": 0,
          "style": { "width": "100%", "height": "100%", "objectFit": "cover" }
        },
        "filters": ["brightness(0.25)", "contrast(1.2)"],
        "animations": [{ "property": "scale", "from": 1.0, "to": 1.05, "duration": 4.0, "easing": "linear" }]
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.15);border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,0.8);padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;'><div style='display:flex;justify-content:space-between;align-items:center;'><span style='background:#ef4444;color:#fff;font-size:11px;font-weight:900;padding:4px 10px;border-radius:4px;letter-spacing:1.5px;'>CLASSIFIED // TOP SECRET</span><span style='color:#94a3b8;font-size:12px;font-family:monospace;'>DOC-ID: #8849-B</span></div><div style='color:#f8fafc;font-size:18px;line-height:1.6;font-family:monospace;'>\"The internal audit discovered <span style='background:#000;color:#000;padding:2px 14px;border-radius:2px;'>REDACTED</span> transactions unauthorized by the board of directors.\"</div><div style='border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;display:flex;justify-content:space-between;color:#64748b;font-size:11px;'><span>INTERNAL AUDIT DIVISION</span><span>VERIFIED COMPLIANCE</span></div></div>",
          "style": {
            "position": "absolute",
            "left": "15%",
            "top": "22%",
            "width": "70%",
            "height": "52%"
          }
        },
        "animations": [
          { "property": "scale", "from": 0.85, "to": 1.0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "easing": "ease-out" }
        ]
      }
    ]
  }
}
```

---

### Archetype 12: Encrypted Chat & Messenger Leak
```json
{
  "duration": 4.2,
  "transition": "slide_up",
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background:linear-gradient(135deg, #090d16 0%, #0f172a 100%);'></div>"
        }
      },
      {
        "type": "Layer",

        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;display:flex;flex-direction:column;gap:14px;justify-content:center;padding:16px;box-sizing:border-box;'><div style='align-self:flex-start;max-width:70%;background:#1e293b;border:1px solid rgba(255,255,255,0.1);padding:14px 18px;border-radius:18px 18px 18px 4px;color:#f8fafc;font-size:16px;box-shadow:0 10px 25px rgba(0,0,0,0.5);'><span style='font-size:11px;font-weight:700;color:#38bdf8;display:block;margin-bottom:4px;'>Executive VP • 11:42 PM</span>Has the transfer been executed before the market opens?</div><div style='align-self:flex-end;max-width:70%;background:#0284c7;color:#fff;padding:14px 18px;border-radius:18px 18px 4px 18px;font-size:16px;box-shadow:0 10px 25px rgba(2,132,199,0.3);'><span style='font-size:11px;font-weight:700;color:#e0f2fe;display:block;margin-bottom:4px;'>Chief Financial Officer • 11:44 PM</span>Done. No traces left in the primary ledger.</div></div>",
          "style": {
            "position": "absolute",
            "left": "15%",
            "top": "20%",
            "width": "70%",
            "height": "56%"
          }
        },
        "animations": [
          { "property": "translateY", "from": 40, "to": 0, "duration": 0.6, "easing": "spring" },
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "easing": "ease-out" }
        ]
      }
    ]
  }
}
```

---

## 6. Design System Token Integration

When styling AST layers, inject the specific values generated by the project's **Art Director Design System** (`design.json`):
* **`color_palette.primary`** → Use for primary bar charts, active counters, main accents (`#00d4ff`).
* **`color_palette.accent`** → Use for alert metrics, highlighter text, contrasting comparison bars (`#ffb703` or `#ef4444`).
* **`color_palette.surface`** → Use for card backgrounds (`rgba(15, 23, 42, 0.85)`).
* **`color_palette.glow`** → Use for border illumination and box shadows (`0 0 30px rgba(0, 212, 255, 0.3)`).
* **`typography.heading_font`** → Use for titles, counters, and kinetic callouts (`font: "Inter"` or `"Montserrat"`).

---

## 7. Subtitle Safe Areas & Layout Rules

* **Landscape (16:9)**: Subtitles occupy bottom 15%. All lower-third text and card bottoms MUST stay above `bottom: 18%`.
* **Portrait (9:16)**: Mobile captions occupy bottom 25%. All card bottoms MUST stay above `bottom: 28%`.
* **Percentage Geometry**: Always use `%` strings for `left`, `top`, `width`, and `height` to ensure flawless rendering across resolutions.



