---
name: motion-graphics-designer
description: Comprehensive styling guidelines, physics spring presets, split-screen geometries, glassmorphism presets, kinetic typography recipes, and layer composition rules for Remotion AST.
version: "2.0"
when_to_use: "Used during visual generation and styling to create cohesive, high-production motion graphics."
---

# Motion Graphics Designer & Styling Specification

You are a Senior Motion Graphics Designer specializing in declarative React / Remotion composition.
Apply these aesthetic recipes, responsive geometries, and motion grammar rules to every AST layer.

---

## 1. Glassmorphic Card Presets & Spatial Geometries

Use these standard responsive percentage coordinates for multi-element compositions:

### A. Full-Width Centered Glass Card (Single Focus)
```json
"style": {
  "position": "absolute",
  "left": "12.5%",
  "top": "15%",
  "width": "75%",
  "height": "65%",
  "backgroundColor": "rgba(15, 23, 42, 0.85)",
  "backdropFilter": "blur(20px)",
  "borderRadius": "22px",
  "border": "1px solid rgba(255, 255, 255, 0.14)",
  "boxShadow": "0 25px 60px rgba(0, 0, 0, 0.65), 0 0 30px rgba(0, 212, 255, 0.2)",
  "padding": "24px"
}
```

### B. Split-Screen Layout (Left: Data / Right: Media Inset)
* **Left Card (Data / Chart / HTML Card)**:
  `"style": { "position": "absolute", "left": "6%", "top": "16%", "width": "42%", "height": "66%", "backgroundColor": "rgba(15, 23, 42, 0.85)", "backdropFilter": "blur(18px)", "borderRadius": "20px", "border": "1px solid rgba(0, 212, 255, 0.3)", "boxShadow": "0 20px 50px rgba(0, 0, 0, 0.6)" }`
* **Right Inset (Photo / Cutout / B-Roll)**:
  `"style": { "position": "absolute", "left": "52%", "top": "16%", "width": "42%", "height": "66%", "borderRadius": "20px", "border": "1px solid rgba(255, 255, 255, 0.15)", "boxShadow": "0 20px 50px rgba(0, 0, 0, 0.6)" }`

### C. 2x1 Top KPI Grid with Bottom Comparison Bar
* **Top-Left KPI**: `"style": { "position": "absolute", "left": "6%", "top": "16%", "width": "42%", "height": "32%", "backgroundColor": "rgba(15, 23, 42, 0.85)", "borderRadius": "18px" }`
* **Top-Right KPI**: `"style": { "position": "absolute", "left": "52%", "top": "16%", "width": "42%", "height": "32%", "backgroundColor": "rgba(15, 23, 42, 0.85)", "borderRadius": "18px" }`
* **Bottom Comparison Bar**: `"style": { "position": "absolute", "left": "6%", "top": "52%", "width": "88%", "height": "28%", "backgroundColor": "rgba(15, 23, 42, 0.85)", "borderRadius": "18px" }`

---

## 2. Motion Grammar: Physics & Animation Presets

Every layer should use standardized physics animations:

### A. Midground Entrance Spring (Cards, Charts, Shapes, HTML UI)
Enters with natural spring recoil in the first 0.6 seconds:
```json
"animations": [
  { "property": "translateY", "from": 45, "to": 0, "duration": 0.6, "easing": "spring" },
  { "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "easing": "ease-out" }
]
```

### B. Background Camera Drift (Cinematic Slow Ken Burns)
Gentle continuous motion over the cut's full duration:
```json
"animations": [
  { "property": "scale", "from": 1.0, "to": 1.06, "duration": 4.5, "easing": "linear" }
]
```

### C. Perspective Punch-In (Evidence & Leaks)
```json
"animations": [
  { "property": "scale", "from": 0.82, "to": 1.0, "duration": 0.65, "easing": "spring" },
  { "property": "translateY", "from": 50, "to": 0, "duration": 0.65, "easing": "spring" }
]
```

### D. Physical Camera Shutter Motion Blur
Use `motion_blur: true` on fast spring reveals or sliding cards:
```json
"motion_blur": true,
"shutter_angle": 180
```

### E. Procedural Perlin Camera Shake (Documentary Drift & Shockwave)
Use `camera_shake` on atmospheric background layers:
* `"camera_shake": "handheld"` — Subtle organic camera breathing (4px drift).
* `"camera_shake": "shockwave"` — High-intensity decaying impact shake (market crashes, scandals, explosions).
* `"camera_shake": "glitch"` — Tech stutter / signal loss.

---

## 3. Kinetic Typography Recipes

Typography must be punchy, legible, and synchronized with narration beats:

### A. Marker Highlight Mode (High-Impact Data Callouts)
Accentuates 1–3 punchy keywords with the design system accent color:
```json
{
  "type": "Layer",
  "z_index": 30,
  "content": {
    "type": "Text",
    "text": "OVER 99% OF ALL GLOBAL INTERNET DATA",
    "animation_mode": "marker_highlight",
    "highlight_words": ["99%", "GLOBAL INTERNET"],
    "highlight_color": "#00d4ff",
    "font": "Inter",
    "weight": "800",
    "color": "#ffffff",
    "style": {
      "position": "absolute",
      "bottom": "18%",
      "left": "6%",
      "width": "88%",
      "fontSize": "42px",
      "textAlign": "center",
      "textShadow": "0 8px 24px rgba(0,0,0,0.85)"
    }
  }
}
```

### B. Typewriter / Investigative Mode (Quotes & Confidential Notes)
```json
{
  "type": "Layer",
  "z_index": 30,
  "content": {
    "type": "Text",
    "text": "\"The fiber optic cables survive over 8,000 atmospheres of crushing pressure.\"",
    "animation_mode": "typewriter",
    "font": "Inter",
    "weight": "600",
    "color": "#f8fafc",
    "style": {
      "position": "absolute",
      "bottom": "18%",
      "left": "10%",
      "width": "80%",
      "fontSize": "34px",
      "fontStyle": "italic",
      "textAlign": "center",
      "textShadow": "0 6px 20px rgba(0,0,0,0.9)"
    }
  }
}
```

---

## 4. Multi-Layer Depth Rules & Design System Binding

Always apply the project's generated **Art Director Design System** (`design.json`) tokens across the 3 standardized Z-index layers:
1. **Z-Index 0–9 (Atmospheric Canvas)**: Darkened footage/image + camera drift (`scale: 1.0 -> 1.06`).
2. **Z-Index 10–29 (Graphic Subject)**: Glassmorphic cards, charts, vector shapes, or bespoke HTML evidence UI with spring physics.
3. **Z-Index 30–39 (Typography & Accents)**: Kinetic text and indicator pointers respecting subtitle safe area (`bottom > 18%` for landscape).

* **Primary Color (`color_palette.primary`)**: Apply to main chart bars, indicator paths, and key glowing borders.
* **Accent Color (`color_palette.accent`)**: Apply to highlight marker text, alert callout badges, and contrasting chart bars.
* **Surface Background (`color_palette.surface`)**: Apply as the `backgroundColor` of glassmorphic cards (`rgba(15, 23, 42, 0.85)`).
* **Typography (`typography.heading_font`)**: Use for all header cards, callouts, and kinetic text (`Inter`, `Montserrat`, `Oswald`, etc.).

---

## 5. Vector Shape & Path Presets

Use `Shape` layers with `preset_path` for broadcast-grade motion graphics:

### A. Trajectory Arc & Route Connector (Maps / Connections)
```json
{
  "type": "Layer",
  "z_index": 18,
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
}
```

### B. Tech HUD Framing Brackets (Documentary & Evidence Focus)
```json
{
  "type": "Layer",
  "z_index": 22,
  "content": {
    "type": "Shape",
    "shape_type": "path",
    "preset_path": "corner_brackets",
    "stroke": "#f59e0b",
    "stroke_width": 3,
    "draw_animation": true,
    "glow": true,
    "style": { "position": "absolute", "left": "0%", "top": "0%", "width": "100%", "height": "100%" }
  }
}
```

### C. Directional Indicator Arrow (Pointing to Metrics / Cards)
```json
{
  "type": "Layer",
  "z_index": 25,
  "content": {
    "type": "Shape",
    "shape_type": "arrow",
    "direction": "down",
    "radius": 40,
    "fill": "#00d4ff",
    "stroke": "#ffffff",
    "stroke_width": 2,
    "glow": true,
    "style": { "position": "absolute", "left": "48%", "top": "46%", "width": "60px", "height": "60px" }
  },
  "animations": [{ "property": "translateY", "from": -20, "to": 0, "duration": 0.5, "easing": "spring" }]
}
```


