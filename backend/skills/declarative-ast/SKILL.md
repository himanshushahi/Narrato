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

## 2. Standardized Z-Index Hierarchy & 3-Layer Depth Standard

Great motion graphics are defined by **depth, hierarchy, and contrast**. Every sub-visual cut should construct depth across 3 standardized layers:

| Layer Range | Z-Index | Classification | Role & Motion Grammar |
|---|---|---|---|
| **Layer 1** | **0 – 9** | **Atmospheric Canvas (Background)** | Darkened footage, video loops (`volume: 0`), vector maps, or high-contrast imagery with cinematic filters (`brightness(0.35)`, `contrast(1.15)`). Always include continuous camera drift (`scale: 1.0 -> 1.06`). |
| **Layer 2** | **10 – 29** | **Graphic Subject (Midground)** | Glassmorphic cards, animated charts (`Chart`), vector shapes & path drawings (`Shape`), bespoke HTML evidence cards (`HTML`), split-screen insets. Fast physics spring entrance (`translateY: 40 -> 0`, `opacity: 0 -> 1`, `easing: "spring"`). |
| **Layer 3** | **30 – 39** | **Typography & Accents (Foreground)** | Kinetic callouts (`marker_highlight`, `words_stagger`, `typewriter`), indicator arrows/pointers, data badges. Staggered reveal entering after the midground card (respecting subtitle safe area). |

---

## 3. Motion Grammar: Physics & Timing Rules

Every layer should move with purpose according to its role:

1. **Backgrounds (Camera Drift)**:
   * Use linear or ease-out scale/translate over the full cut duration:
     `"animations": [{ "property": "scale", "from": 1.0, "to": 1.06, "duration": 5.0, "easing": "linear" }]`
2. **Midground Graphics (Physics Spring Entrance)**:
   * Cards, charts, shapes, and HTML UI elements must enter via spring physics in the first 0.5s–0.8s:
     `"animations": [{ "property": "translateY", "from": 50, "to": 0, "duration": 0.6, "easing": "spring" }, { "property": "opacity", "from": 0, "to": 1, "duration": 0.5, "easing": "ease-out" }]`
3. **Foreground Typography (Selective Kinetic Accenting)**:
   * Use `animation_mode: "marker_highlight"` with `highlight_words` on high-impact keywords.
   * Use `animation_mode: "words_stagger"` for impactful statements.
   * Use `animation_mode: "typewriter"` for quotes or confidential notes.
4. **Atmospheric / Breather Beats**:
   * When narration is contemplative or cinematic, a styled single/dual-layer cut (high-contrast B-roll + subtle vignette + subtle lower-third) is appropriate. Avoid unstyled naked stock media.

---

## 4. The 7 Valid AST Content Types

The `content` object inside every `Layer` must specify one of the **7 supported types**:

### 1. `Chart` (Infographics & Data Visualization)
* `chart_type`: `"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`
* `data`: Array of objects `[{"label": "2021", "value": 45, "color": "#f59e0b"}, ...]`
* `title` (optional): Chart headline string

### 2. `Shape` (Vector Shapes, Paths & Callouts)
* `shape_type`: `"rectangle"` | `"circle"` | `"star"` | `"triangle"` | `"arrow"` | `"polygon"` | `"path"`
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

### 3. `Text` (Kinetic Typography & Lower-Thirds)
* `text`: Content string
* `font`: Font family name (e.g. `"Inter"`, `"Oswald"`, `"Montserrat"`)
* `animation_mode`: `"words_stagger"` | `"typewriter"` | `"marker_highlight"` | `"static"`
* `highlight_words` (optional): Words to accentuate with marker color
* `highlight_color` (optional): Accent color (e.g. `"#facc15"`)
* **CTL/Indic Fonts**: For Hindi, Tamil, Bengali, Arabic, etc., ALWAYS use Noto fonts (e.g. `Noto Sans Devanagari`).

### 4. `Image` (Photos, Evidence & Vector Cutouts)
* `sources`: `pexels` (photos/backgrounds), `pixabay` (photos, and with `image_type="illustration"` or `"vector"` transparent PNG cutouts), `wikipedia` (real-world entities/figures).

### 5. `Video` (Dynamic B-Roll & Ambient Motion)
* `sources`: `pexels` (stock video) or `youtube` (timelapses/clips). Always `"volume": 0`.

### 6. `Map` (Geographic Context & Route Markers)
* `map_style`: `"modern_dark"`, `"vintage"`, `"minimal_light"`, `"nautical_blue"`
* `locations`: `[{"name": "City", "coord": [lat, lon]}]`

### 7. `HTML` (Universal Dynamic Canvas: Evidence Memos, UI Mocks, Custom Shapes, Timelines)
* `html_content`: Custom inline HTML/SVG/CSS markup. Ideal for bespoke leaked documents, chat bubbles, technical HUD blueprints, comparison cards, and metric tickers.
* Combine inline CSS with Tailwind-like inline styling, gradients, and backdrop filters for infinite creative variety.

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
        "z_index": 0,
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
        "z_index": 15,
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
            "backgroundColor": "rgba(15, 23, 42, 0.85)",
            "backdropFilter": "blur(20px)",
            "borderRadius": "20px",
            "border": "1px solid rgba(0, 212, 255, 0.3)",
            "boxShadow": "0 20px 50px rgba(0, 0, 0, 0.6)"
          }
        },
        "animations": [{ "property": "translateY", "from": 40, "to": 0, "duration": 0.6, "easing": "spring" }]
      },
      {
        "type": "Layer",
        "z_index": 15,
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
            "borderRadius": "20px",
            "border": "1px solid rgba(255, 255, 255, 0.15)",
            "boxShadow": "0 20px 50px rgba(0, 0, 0, 0.6)"
          }
        },
        "animations": [{ "property": "translateY", "from": 40, "to": 0, "duration": 0.7, "easing": "spring" }]
      },
      {
        "type": "Layer",
        "z_index": 30,
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
        "z_index": 0,
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
        "z_index": 15,
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
        "z_index": 30,
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
        "z_index": 0,
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
        "z_index": 15,
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
        "z_index": 5,
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
        "z_index": 15,
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
        "z_index": 30,
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
        "z_index": 0,
        "content": {
          "type": "HTML",
          "html_content": "<div style='width:100%;height:100%;background-color:#0b1120;background-image:linear-gradient(rgba(0,212,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.06) 1px, transparent 1px);background-size:40px 40px;'></div>"
        }
      },
      {
        "type": "Layer",
        "z_index": 12,
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
        "z_index": 20,
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
        "z_index": 0,
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
        "z_index": 15,
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
        "z_index": 15,
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
        "z_index": 15,
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
            "backgroundColor": "rgba(15, 23, 42, 0.85)",
            "backdropFilter": "blur(18px)",
            "borderRadius": "18px",
            "border": "1px solid rgba(255, 255, 255, 0.12)"
          }
        },
        "animations": [{ "property": "translateY", "from": 30, "to": 0, "duration": 0.7, "easing": "spring" }]
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



