---
name: motion-graphics-designer
description: "Comprehensive styling guidelines, physics spring presets, split-screen geometries, card layout presets, kinetic typography recipes, and layer composition rules for Remotion AST."
version: "2.0"
when_to_use: "Used during visual generation and styling to create cohesive, high-production motion graphics."
---

# Motion Graphics Designer & Styling Specification

> **Role**: Senior Motion Graphics Designer & Remotion Compositor  
> **Mission**: Apply aesthetic recipes, responsive percentage geometries, physics spring presets, and kinetic typography to every Remotion AST layer.

You are a Senior Motion Graphics Designer specializing in declarative React / Remotion composition.  
Apply these aesthetic recipes, responsive geometries, and motion grammar rules to every AST layer.

---

## 1. Card Layout Presets & Spatial Geometries

Use these standard responsive percentage coordinates for multi-element compositions.  
**LayerBox SOT v1**: the style box is the ONLY geometry authority — `%` strings ONLY (never `px`, never bare numbers), `top` XOR `bottom` (lower-thirds use `bottom`, all cards use `top`), `left` XOR `right` (prefer `left`), every non-background layer carries a full `left`+`top`+`width`+`height` box. `Map`/`Particles`/`Background` are always fullscreen (`100%`/`100%`, no position keys). `Shape` box = stage (content `width`/`height` alongside a box is dropped — use small `%` boxes for dots, never `px`).

### Spatial Layout Presets Matrix

| Preset | Target Aspect | Box Coordinates (`style`) | Best Used For |
|---|---|---|---|
| **A. Centered Card** | Landscape (16:9) | `left: "12.5%", top: "15%", width: "75%", height: "65%", borderRadius: "22px"` | Single-focus data card, dossier, or main hero subject |
| **B. Split-Screen Left** | Landscape (16:9) | `left: "6%", top: "16%", width: "42%", height: "66%", borderRadius: "20px"` | Data chart, metric counter, or HTML leaked memo |
| **B. Split-Screen Right** | Landscape (16:9) | `left: "52%", top: "16%", width: "42%", height: "66%", borderRadius: "20px"` | Media inset (archival photo, Wikipedia logo, cutout) |
| **C. Portrait Top-Stack** | Portrait (9:16) | `top: "8%", height: "18%"` + subject `top: "30%", height: "40%"` | Shorts/Reels headline over centered graphic subject |
| **C. Portrait Center-Punch** | Portrait (9:16) | `top: "35%", height: "30%"` (full width) | Big metric counter, explosive stat, or single icon callout |
| **C. Portrait Split-Stack** | Portrait (9:16) | Card 1: `top: "12%", height: "34%"`; Card 2: `top: "50%", height: "20%"` | Dual comparison metrics stacked vertically in mobile format |
| **D. 2x1 Top KPI + Bar** | Landscape (16:9) | Left: `left: "6%", top: "16%", width: "42%", height: "32%"`; Right: `left: "52%", top: "16%", width: "42%", height: "32%"`; Bottom: `left: "6%", top: "52%", width: "88%", height: "28%"` | Dual KPI metric cards above full-width comparative chart |

Canvas pixel grids: landscape = 1920×1080, portrait = 1080×1920. Equal `%` on width and height ≠ equal pixels — use `aspectRatio: "1 / 1"` (+ drop `height`) for true squares/circles.

**Collision / Overlap guard**: when a cut has multiple positioned layers, verify boxes do NOT overlap unless intentional (e.g., text label over an image). Use the presets below (A–C) for safe splits. Common safe horizontal split: left `left: "6%", width: "42%"` + right `left: "52%", width: "42%"` (6% gap). Vertical stacking: `top` + `height` + gap ≤ 100%. Overlap is acceptable ONLY when a foreground element (text, badge, shape dot) intentionally sits atop a background/image layer.

**objectFit per layer role** (Image/Video only): background (fullscreen) → `"cover"` (fills frame, crops edges); positioned card with `borderRadius: "50%"` → `"cover"` (essential for circle crop); icon/illustration overlay (transparent-bg Pixabay cutouts) → `"contain"` (preserves aspect without cropping transparent edges); default when omitted = `"cover"` for positioned layers.

**Text height omission**: for Text lower-thirds and callout labels, OMIT `height` so text auto-sizes vertically from content. Set `height` only for fixed-height clipping (scrolling ticker, rigid card frame). Lower-third fills use `bottom: "18%"` anchor with no height — the box grows upward.

Prefer base position boxes (`left`, `top`, `width`, `height`, `borderRadius`) for layout — position is always absolute. Static `style` transforms (`rotate` deg, `scale`/`scaleX`/`scaleY` multiplier, negative mirrors e.g. `scaleX: -1` for H-flip, `aspectRatio` e.g. `"1 / 1"` for circles, `bottom` anchor for lower-thirds) are allowed sparingly for emphasis — they compose with keyframe animations. NEVER write a raw `transform` string in `style` (no `translateX(-50%)` centering — center with explicit math: width `42%` → `left: "29%"`); the key is removed and the editor overlay box loses sync. Pivot via layer `transform_origin` (default `center center`).

### A. Full-Width Centered Card (Single Focus)
```json
"style": {
  "position": "absolute",
  "left": "12.5%",
  "top": "15%",
  "width": "75%",
  "height": "65%",
  "borderRadius": "22px"
}
```

### B. Split-Screen Layout (Left: Data / Right: Media Inset)
* **Left Card (Data / Chart / HTML Card)**:
  `"style": { "position": "absolute", "left": "6%", "top": "16%", "width": "42%", "height": "66%", "borderRadius": "20px" }`
* **Right Inset (Photo / Cutout / B-Roll)**:
  `"style": { "position": "absolute", "left": "52%", "top": "16%", "width": "42%", "height": "66%", "borderRadius": "20px" }`

### C. Portrait Presets (9:16 — use for Shorts/Reels)
* **Top-stack**: headline `top: "8%", height: "18%"` + subject `top: "30%", height: "40%"` + caption `bottom: "30%"`.
* **Center-punch**: one big metric `top: "35%", height: "30%"`, full width.
* **Split-stack**: two cards `top: "12%", height: "34%"` + `top: "50%", height: "20%"`.

### D. 2x1 Top KPI Grid with Bottom Comparison Bar
* **Top-Left KPI**: `"style": { "position": "absolute", "left": "6%", "top": "16%", "width": "42%", "height": "32%", "borderRadius": "18px" }`
* **Top-Right KPI**: `"style": { "position": "absolute", "left": "52%", "top": "16%", "width": "42%", "height": "32%", "borderRadius": "18px" }`
* **Bottom Comparison Bar**: `"style": { "position": "absolute", "left": "6%", "top": "52%", "width": "88%", "height": "28%", "borderRadius": "18px" }`

---

## 2. Motion Grammar: Physics & Animation Presets

| Animation Preset | Target Layers | Recommended Keyframes | Easing & Physics |
|---|---|---|---|
| **Spring Entrance** | Cards, Charts, Shapes | `translateY: 45 -> 0`, `opacity: 0 -> 1` | `easing: "spring"`, `duration: 0.6`, `delay: 0.4–0.5` |
| **Ken Burns Drift** | Background Canvas / Footage | `scale: 1.0 -> 1.06` | `easing: "linear"`, duration = cut duration |
| **Perspective Punch-In** | Leaked Memos, Evidence | `scale: 0.82 -> 1.0`, `translateY: 50 -> 0` | `easing: "spring"`, `duration: 0.65` |
| **Rack-Focus Fade** | Archival Media, Backgrounds | `blur: 10 -> 0`, `opacity: 0 -> 1` | `easing: "ease-out"`, `duration: 0.6` |
| **Mid-Cut Emphasis** | Shocking Stats, Revelations | `scale: 1.15`, `duration: 0.5` at sub-visual level | Fires mid-cut at key spoken word |

* **Pair entrances with opacity fade on delayed reveals:** adding `{ "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "delay": ..., "easing": "ease-out" }` ensures elements stay hidden until they start moving. Whenever `delay > 0`, ALWAYS pair spatial entrances with an opacity fade at the same delay (otherwise elements sit frozen on screen at their starting offset before the delay). Spatial-only entrances without fade are allowed ONLY for instant punch/whip beats at `delay: 0`.

### A. Midground Entrance Spring (Cards, Charts, Shapes, HTML UI)
Enters with natural spring recoil — fires after the cut transition settles (`delay` ~0.3–0.5s, see Timing Rules below):
```json
"animations": [
  { "property": "translateY", "from": 45, "to": 0, "duration": 0.6, "delay": 0.5, "easing": "spring" },
  { "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "delay": 0.5, "easing": "ease-out" }
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
  { "property": "scale", "from": 0.82, "to": 1.0, "duration": 0.65, "delay": 0.5, "easing": "spring" },
  { "property": "translateY", "from": 50, "to": 0, "duration": 0.65, "delay": 0.5, "easing": "spring" },
  { "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "delay": 0.5, "easing": "ease-out" }
]
```

### D. Physical Camera Shutter Motion Blur
Use `motion_blur: true` on fast spring reveals or sliding cards (no-op without spatial motion — needs a keyframe, `floating: true`, or `camera_shake`):
```json
"motion_blur": true,
"shutter_angle": 180
```
`shutter_angle`: `45`–`360` (`90` crisp, `180` cinematic, `360` dreamy). `floating: true` adds slow harmonic bob and counts as motion. `transform_origin` sets the scale/rotate pivot.

### D2. Rack-Focus & Flash Keyframes (non-spatial fades)
```json
"animations": [
  { "property": "blur", "from": 10, "to": 0, "duration": 0.6, "delay": 0.5, "easing": "ease-out" },
  { "property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.5, "easing": "ease-out" }
]
```
`blur` (px) and `brightness` (multiplier) fade without triggering shutter blur — pair with opacity for reveals.

### E. Procedural Perlin Camera Shake (Documentary Drift & Shockwave)
Use `camera_shake` on atmospheric background layers:
* `"camera_shake": "handheld"` — Subtle organic camera breathing (4px drift).
* `"camera_shake": "shockwave"` — High-intensity decaying impact shake (market crashes, scandals, explosions).
* `"camera_shake": "glitch"` — Tech stutter / signal loss.

### F. Mid-Cut Punch-In Emphasis (Sub-Visual Level)
Unlike entrance animations, `emphasis` marks fire mid-cut — sudden zoom snap + settle on the beat's key moment (sibling of `transition`, NOT inside layers):
```json
"emphasis": [{ "at": 1.2, "scale": 1.15, "duration": 0.5 }]
```
 0+ marks per cut on the beat's key moments, `scale` 1.02–1.6, keep `at+duration` inside the cut. Pair with the 2026 FX pack (`filters`: Thermal/Night-Vision/duotones) and `Particles` for maximum-impact beats.
* `filters` blend note: `"mix-blend-mode: overlay/screen/multiply/..."` composites with layers beneath — invisible on a single opaque fullscreen layer, so only use on stacked cuts.

### G. Animation Delay, Narration Sync & Layer Motion (guidance)
`delay` is in seconds from the CUT start (not video start). Use it freely:
* **Animate the layers that carry the beat:** 1 hero layer is the safe default; up to 3 animated layers allowed on rich cuts (background drift + midground spring + foreground stagger is premium). Avoid animating 5+ layers at once.
* **Small delays on entrances:** cut transitions run ~0.5s — `delay` ~0.3–0.5 keeps entrances visible; `delay: 0` is allowed for `cut`/`none` transitions and ambient drift.
* **Sync to the spoken word:** you receive `Exact Spoken Words with Timestamps (Seconds from Scene Start)` plus each sub-visual's start offset within the scene. Compute `delay` = (word timestamp − sub-visual start offset), clamped to `[0, cut_duration − animation_duration]`, so the layer the narration is talking about enters exactly when it is mentioned. Example: sub-visual starts at 4.0s in the scene, "GDP" is spoken at [6.3s] → `delay: 2.3` on the GDP card entrance.
* **Fit the cut:** `delay + duration` SHOULD fit inside the sub-visual's `duration` (overflow is clipped). On short cuts (≤2.5s) prefer the word-timed `delay` with a short `duration` (0.4–0.5s).
* Foreground typography follows the same rule with a slightly later stagger (`delay`: word time, or 0.7+ when no timestamp matches).

---

## 3. Kinetic Typography Recipes

| Mode | Purpose | Visual Mechanics | Ideal Use Case |
|---|---|---|---|
| **`marker_highlight`** | Keyword punch | Background highlight sweep over `highlight_words` | High-impact statistics, core arguments |
| **`words_stagger`** | Impact statements | Word-by-word staggered reveal | Provocative statements, dramatic conclusions |
| **`typewriter`** | Evidence reading | Character-by-character reveal with typing cursor | Leaked audit quotes, courtroom transcripts |
| **`static`** | Clean badges | Zero animation, pure high-contrast text | Lower-third titles, data card headers |

### A. Marker Highlight Mode (High-Impact Data Callouts)
Accentuates 1–3 punchy keywords with the design system accent color:
```json
{
  "type": "Layer",
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

Always apply the project's generated **Art Director Design System** (`design.json`) tokens across the 3 ordered layers (children[0]=bottom):
1. **Background (Atmospheric Canvas, first child)**: Full-screen base — darkened Video footage, Images, HTML gradient canvases, or Maps + camera drift (`scale: 1.0 -> 1.06`). Vary the base type across cuts.
2. **Midground (Graphic Subject, middle children)**: Cards, charts, vector shapes, or bespoke HTML evidence UI with spring physics.
3. **Foreground (Typography & Accents, last children)**: Kinetic text and indicator pointers respecting subtitle safe area (`bottom > 18%` for landscape).

* **Primary Color (`color_palette.primary`)**: Apply to main chart bars, indicator paths, and key glowing borders.
* **Accent Color (`color_palette.accent`)**: Apply to highlight marker text, alert callout badges, and contrasting chart bars.
* **Surface Background (`color_palette.surface`)**: Reserved for bespoke HTML evidence UI backgrounds.
* **Typography (`typography.heading_font`)**: Use for all header cards, callouts, and kinetic text (`Inter`, `Montserrat`, `Oswald`, etc.).

---

## 5. Vector Shape & Path Presets

Use `Shape` layers with `preset_path` for broadcast-grade motion graphics:

### A. Trajectory Arc & Route Connector (Maps / Connections)
```json
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
}
```

### B. Tech HUD Framing Brackets (Documentary & Evidence Focus)
```json
{
  "type": "Layer",
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
  "content": {
    "type": "Shape",
    "shape_type": "arrow",
    "direction": "down",
    "radius": 40,
    "fill": "#00d4ff",
    "stroke": "#ffffff",
    "stroke_width": 2,
    "glow": true,
    "style": { "position": "absolute", "left": "46%", "top": "44%", "width": "8%", "height": "12%" }
  },
  "animations": [
    { "property": "translateY", "from": -20, "to": 0, "duration": 0.5, "delay": 0.5, "easing": "spring" },
    { "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "delay": 0.5, "easing": "ease-out" }
  ]
}
```

---

## 6. Pre-Flight Motion Graphics Checklist

- [ ] All coordinates use LayerBox `%` strings only (no `px`, no bare numbers)
- [ ] No raw `transform` property placed inside `style`
- [ ] All delayed entrance animations (`delay > 0`) are paired with opacity fade
- [ ] Subtitle safe area (`bottom: 18%` landscape, `28%` portrait) is respected
- [ ] Motion blur enabled on high-velocity spring entrances
- [ ] Multi-element splits verify non-overlapping boundaries
