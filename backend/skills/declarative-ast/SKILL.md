---
name: declarative-ast
description: Complete capability specification for the Declarative AST rendering engine — layer types, motion grammar, compositing architecture, named composition recipes, and source selection rules. Single source of truth for all visual skills.
version: "5.1"
when_to_use: "Always loaded during scene visual generation, sub-visual rewrites, and motion graphics planning."
---

# Declarative AST — Full Capability Specification

> **Role**: Lead Visual Director & Motion Graphics Engineer.
> **Mission**: Emit valid, renderable, broadcast-grade AST cuts. Every creative decision is yours. This file is the SINGLE SOURCE OF TRUTH — all other visual skills reference this one.

---

## 0. Quick Reference (Read This First)

```
MANDATORY CONTENT.TYPE: Every Layer MUST have content.type — missing it = null scene.
GEOMETRY: style uses % strings ONLY. Never px or bare numbers.
FULLSCREEN: Map / Particles / Background ignore position — they are always 100%×100%.
QUERY REQUIRED: Image and Video layers MUST have a query field or the cut breaks.
LAYER COUNT — NO QUOTA: use as many layers as the beat needs — usually a rich stack, not a bare one. Every layer must earn its place (a clear visual job + motion alive past the take's midpoint); never stack blindly, never ship a single bare layer.
PORTRAIT SAFE: Keep content above bottom: 28% in portrait, bottom: 18% in landscape.
OPACITY PAIR: Every entrance with delay > 0 MUST pair with opacity: 0→1 at same delay.
NO CHAPTER CARDS: Never put chapter title text inside sub-visual cuts.
```

### AST Structure
```json
{
  "duration": 3.5,
  "transition": "slide_left",
  "emphasis": [{ "at": 1.2, "scale": 1.15, "duration": 0.5 }],
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",
        "content": { "type": "Background", "background_preset": "grid_flow" },
        "animations": [],
        "filters": [],
        "floating": false
      }
    ]
  }
}
```

Style box goes on the Layer node as a sibling of `content`, NOT inside `content`:
```json
{ "type": "Layer", "content": { ... }, "style": { "left": "15%", "top": "20%", "width": "70%", "height": "60%" } }
```

---

## 1. Composition Hierarchy & Stacking Rules

```
Root Video Composition
├── Scene Sequences (cuts)
│   └── Sub-Visual AST Compositions (children[0]=bottom … children[N-1]=top)
├── Global Overlays (Chapter pills, progress bar — rendered above all cuts continuously)
└── Kinetic Subtitles Track (topmost, word-level animated captions)
```

**Rules:**
1. `children[0]` = bottom/background; `children[N-1]` = top foreground.
2. **Chapter Guidelines**: NEVER put chapter title cards, pills, or branding
   text inside cuts — they flash and vanish on 2–9s takes. Global overlays own
   chapter branding continuously.
3. Every sub-visual must be 100% storytelling: motion graphics, infographics, data viz, kinetic type.

---

## 2. The 11 Content Types

### 1. `Text` — Kinetic Typography & Lower-Thirds
```json
{
  "type": "Text",
  "text": "Your headline here",
  "font": "Outfit",
  "weight": "700",
  "color": "#ffffff",
  "animation_mode": "words_stagger",
  "highlight_words": ["headline"],
  "highlight_color": "#facc15",
  "style": { "fontSize": "64px", "textAlign": "center", "lineHeight": 1.3, "letterSpacing": "-0.02em" }
}
```
- `animation_mode`: `"marker_highlight"` (sweep over highlight_words or ALL words if omitted) | `"words_stagger"` (word reveal, accent on highlight_words) | `"typewriter"` (char reveal) | `"static"`
- `style.fontSize`: `8px`–`500px`. **Renderer truth**: Text size = `style.fontSize`. `content.font_size` is ignored for Text.
- **Auto-Sizing**: Omit `style.height` on lower-thirds — text auto-sizes vertically. Anchor with `bottom: "18%"` (landscape) or `bottom: "28%"` (portrait).
- **CTL Fonts**: Hindi/Marathi/Bengali/Tamil/Telugu/Arabic → **MUST** use Noto (`Noto Sans Devanagari`, `Noto Sans Tamil`, etc.). NEVER use Latin display fonts for non-Latin scripts.
- Pre-loaded fonts: `Inter`, `Montserrat`, `Outfit`, `Poppins`, `Roboto`, `Oswald`, `Anton`, `Bebas Neue`, `Space Grotesk`, `Playfair Display`, `Merriweather`, `Cinzel`, `Fira Code`, `JetBrains Mono`.

### 2. `Counter` — Animated Numerical Count-Up
```json
{ "type": "Counter", "value": 450, "start_value": 0, "prefix": "$", "suffix": "M", "decimals": 1, "format": "compact", "duration": 2.0, "font_size": 84, "title": "CAPITAL RAISED", "color": "#facc15" }
```
- `format`: `"standard"` (commas) | `"compact"` (1.2M) | `"currency"` ($) | `"percent"` (%) | `"none"` (raw)
- `font_size` or `style.fontSize`: `16`–`300`, default `72`. Tabular numerals built-in.
- `title`: Uppercase label displayed above the counter.

### 3. `Shape` — Vector Shapes, Paths & Lucide Icons
```json
{ "type": "Shape", "shape_type": "rectangle", "fill": "rgba(255,255,255,0.06)", "stroke": "#38bdf8", "stroke_width": 1.5, "corner_radius": 20 }
{ "type": "Shape", "shape_type": "icon", "icon_name": "trending-up", "fill": "#facc15", "glow": true }
{ "type": "Shape", "shape_type": "path", "preset_path": "corner_brackets", "stroke": "#00d4ff", "draw_animation": true, "glow": true }
```
- `shape_type`: `"rectangle"` | `"circle"` | `"star"` | `"triangle"` | `"arrow"` | `"polygon"` | `"path"` | `"icon"`
- `icon_name`: 1,500+ Lucide icons in kebab-case (`"trending-up"`, `"shield-alert"`, `"dollar-sign"`, `"zap"`, `"flame"`, `"brain"`, `"cpu"`, `"rocket"`, `"target"`, `"lock"`, `"globe"`, `"activity"`, `"scale"`)
- `preset_path`: `"route_arch"` | `"horizontal_line"` | `"pointer_curve"` | `"corner_brackets"` | `"wave_pulse"` | `"circle_reticle"`
- `draw_animation: true`: Animates stroke path drawing from 0% to 100%.
- `glow: true`: Neon bloom/drop-shadow on stroke.
- `fill: "transparent"`: Use for outlines/frames only.

### 4. `Chart` — Infographics & Data Visualization
```json
{ "type": "Chart", "chart_type": "bar", "data": [{"label": "2022", "value": 45, "color": "#38bdf8"}, {"label": "2023", "value": 85, "color": "#f59e0b"}], "title": "ANNUAL GROWTH", "bar_radius": 10, "bar_glow": true, "style": { "color": "#38bdf8" } }
```
- `chart_type`: `"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`
- `bar_glow: true`: Neon bloom on bars/fills.

### 5. `Background` — Procedural Kinetic Shaders (Zero Downloads)
```json
{ "type": "Background", "background_preset": "grid_flow", "colors": ["#0b0b1a", "#00d4ff", "#7c3aed"], "speed": 1.2 }
```
- `background_preset`: `"gradient_mesh"` (organic blooms) | `"grid_flow"` (3D perspective horizon) | `"waves"` (energy oscillations) | `"dots"` (ripple grid) | `"blueprint"` (engineering graph) | `"vignette_loop"` (cinematic ambient) | `"paper_grain"` (editorial texture)
- **Always fullscreen** (`children[0]`). No positioning. `colors: [base, accent1, accent2]`.
- To dim: use `colors` with darker values. Cannot resize Background — it's fullscreen by design.

### 6. `Image` — Stock Photos, Logos, Cutouts
```json
{ "type": "Image", "query": "wall street trading floor", "source": "pexels", "objectFit": "cover" }
{ "type": "Image", "query": "apple logo", "source": "wikipedia", "objectFit": "contain" }
{ "type": "Image", "query": "astronaut moon", "source": "pixabay", "image_type": "illustration" }
```
- `source`: `"pexels"` (stock photo) | `"pixabay"` (+ transparent cutouts) | `"wikipedia"` (logos, flags, historical figures) | `"archive"` (NASA/Apollo, archival, vintage)
- `image_type`: `"illustration"` or `"vector"` for transparent-background PNG cutouts on Pixabay.
- **NEVER use `youtube` as Image source.** NEVER set `url` or `local_path`.

### 7. `Video` — Dynamic B-Roll & Ambient Motion
```json
{ "type": "Video", "query": "tesla autopilot demo", "source": "youtube", "yt_start_offset": 15, "yt_duration": 20, "volume": 0, "loop": false }
{ "type": "Video", "query": "city skyline night", "source": "pexels", "volume": 0, "loop": true }
```
- `source`: `"pexels"` (generic cinematic stock) | `"pixabay"` (additional stock) | `"youtube"` (real events, tech demos, product reveals, science animations, space launches — things stock libraries can't provide) | `"archive"` (newsreels, early 20th century, military, public domain docs)
- `yt_start_offset`: Skip intro (default 15s). `yt_duration`: Clip length (default 15s, max 30s).
- `volume`: `0.0`–`1.0`. Default `0`. Keep `0.1`–`0.2` ambient unless voiceover is muted.
- `loop: false` (freezes on last frame) | `true` (loops continuously).
- **NEVER use `wikipedia` or `archive` as Video source.** Archive works for archive.org video clips.

### 8. `Lottie` — Vector Micro-Animations
```json
{ "type": "Lottie", "lottie_url": "https://assets.lottiefiles.com/packages/lf20_xyz.json", "loop": true, "playback_rate": 1.0, "direction": "forward" }
```

### 9. `Particles` — Atmospheric Ambient Overlays
```json
{ "type": "Particles", "particle_preset": "dust", "particle_count": 40, "particle_opacity": 0.15, "particle_speed": 0.8, "particle_direction": "up" }
```
- `particle_preset`: `"confetti"` | `"embers"` | `"dust"` | `"money_rain"` | `"snow"` | `"stars"`
- **Always fullscreen** — position/size properties are ignored. Keep `particle_opacity` low (`0.1`–`0.25`) for atmospheric depth without overwhelming foreground.
- `particle_direction`: `"up"` | `"down"` | `"left"` | `"right"` | `"outward"` | `"twinkle"`

### 10. `Map` — Geographic Pins & Routes
```json
{ "type": "Map", "map_style": "modern_dark", "locations": [{"name": "New York", "coord": [40.7128, -74.006]}, {"name": "London", "coord": [51.5074, -0.1278]}] }
```
- **Always fullscreen** — cannot be resized or repositioned. To focus on map: use `overlay Shape` or `Text` on top.
- `map_style`: `"modern_dark"` | `"vintage"` | `"minimal_light"` | `"nautical_blue"`. **ALWAYS set explicitly** (editor and renderer have different defaults).

### 11. `HTML` — Rich Document Evidence & UI Canvas
```json
{ "type": "HTML", "html_content": "<div style=\"width:100%;height:100%;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;font-family:monospace;color:#00ff88\">TERMINAL OUTPUT HERE</div>" }
```
- Ideal for: News clippings, bank receipts, social media bubbles, terminal windows, certificates, glass cards.
- **HTML Contract**: Single `width:100%;height:100%` root. Use `%`, `clamp()`, `cqw` for fluid sizing. No remote `<img>`/`<video>`/`url(...)` — they render blank. Pair with sibling Image/Video layer for photos.

---

## 3. Source Selection — Provider Decision Guide

**The core principle**: Use "authentic" providers (wikipedia, archive, youtube) for **real, specific, named things**. Use "stock" providers (pexels, pixabay) for **generic, atmospheric, illustrative** visuals.

---

### 3.1 Provider Selection by Narrative Topic

| If the narration is about... | Image Provider | Video Provider | Why |
|---|---|---|---|
| **Real person** (politician, CEO, scientist, athlete, historical figure) | `wikipedia` (exact full name query) | `youtube` (interview, speech, event) | Only real face, not stock actor |
| **Company / brand logo** (Apple, Tesla, Google, RBI, ISRO...) | `wikipedia` (exact company name) | `youtube` (product launch / keynote) | Official logo, not clipart |
| **Country / government / institution** (India flag, US Capitol, UN, RBI...) | `wikipedia` | `youtube` (official event) | Authentic symbol |
| **Historical event** (partition, independence, wars, moon landing, WW2...) | `archive` (archival photo) | `archive` (newsreel) or `youtube` (documentary) | Primary source material |
| **Space / NASA / astronomical** (Mars rover, Hubble, ISS, rocket launch) | `archive` (NASA public domain) | `archive` (mission footage) or `youtube` (SpaceX/NASA launch) | Authentic space footage |
| **Scientific concept / simulation** (DNA, black hole, neural network, quantum...) | `pixabay` illustration or `pexels` science photo | `youtube` (3D animation, lab demo) | Explanation needs real animation |
| **Tech product demo** (iPhone, GPU, EV, robotics, software UI...) | `pexels` (device shot) | `youtube` (hands-on demo, review, keynote) | Only YouTube has the actual product footage |
| **Financial market / economy** (stock market, trading floor, RBI policy...) | `pexels` (trading floor stock) | `youtube` (news report, Bloomberg clip) | News clips beat generic stock |
| **Sports / tournament / athlete** (IPL, Olympics, FIFA, cricket match...) | `wikipedia` (athlete portrait) or `pexels` (stadium) | `youtube` (match clip, highlight) | Only YouTube has real match footage |
| **Political / news event** (election, protest, policy speech, court ruling...) | `wikipedia` (politician photo) | `youtube` (news broadcast, speech) | Only YouTube has real event video |
| **City / geography (generic)** (skyline, street, crowd, office...) | `pexels` | `pexels` or `pixabay` | Generic B-roll is Pexels' strength |
| **Nature / environment** (forest, ocean, mountain, rain...) | `pexels` | `pexels` | High-quality cinematic stock |
| **Abstract / conceptual** (growth, innovation, data flow, network...) | `pexels` or Background shader | `pexels` or `pixabay` | Atmospheric illustration |
| **Transparent icon / cutout sticker** (coin, chart, flag icon, badge...) | `pixabay`, `image_type: "illustration"` | — | Only Pixabay has transparent PNG |
| **Vintage / retro / documentary aesthetic** (old maps, newspapers, sepia...) | `archive` | `archive` | Public domain, authentic |

---

### 3.2 Topic-to-Provider Worked Examples

```
"India's GDP growth in 2024"
  Image → pexels: "india economy rupee", OR archive: "india market vintage"
  Video → youtube: "india gdp growth economy 2024" (news clip)

"Elon Musk announces Tesla Cybertruck"
  Image → wikipedia: "Elon Musk" (portrait)
  Video → youtube: "tesla cybertruck reveal event" (yt_start_offset: 15, yt_duration: 20)

"Apollo 11 moon landing"
  Image → archive: "apollo 11 astronaut moon surface"
  Video → archive: "apollo 11 moon landing newsreel"
  OR Video → youtube: "apollo 11 moon landing footage" (documentary clip)

"AI and Machine Learning concept"
  Image → pixabay: "artificial intelligence", image_type: "illustration"
  Video → youtube: "neural network animation explanation" (science animation)

"Busy Mumbai street"
  Image → pexels: "mumbai street crowded"
  Video → pexels: "india city street traffic"

"Indian flag / national symbol"
  Image → wikipedia: "Flag of India"

"IPL 2024 cricket match"
  Image → pexels: "cricket stadium crowd" (generic)
  Video → youtube: "IPL 2024 highlights cricket" (real match footage)

"World War 2 / historical war footage"
  Image → archive: "world war 2 soldiers historical"
  Video → archive: "world war 2 newsreel combat"

"SpaceX Starship launch"
  Image → pexels: "rocket launch flames" OR archive: "rocket launch NASA"
  Video → youtube: "spacex starship launch 2024"

"Transparent rupee coin badge overlay"
  Image → pixabay: "rupee coin gold", image_type: "illustration"
```

---

### 3.3 Source Capability Matrix

| Source | Image | Video | Best For | Hard Rules |
|---|---|---|---|---|
| `pexels` | ✓ | ✓ | Generic cinematic stock — cityscapes, people, nature, offices, B-roll | Use when subject is generic/atmospheric |
| `pixabay` | ✓ | ✓ | Stock + transparent cutouts, illustrations, vector art | Set `image_type: "illustration"` or `"vector"` for transparent PNG |
| `wikipedia` | ✓ | ✗ | Real people portraits, brand logos, flags, landmarks | Query = EXACT full name only (e.g. "Apple Inc.", "Narendra Modi") |
| `youtube` | ✗ | ✓ | Real events, product demos, tech reveals, sports, news, science animations | `yt_duration ≤ 30s`. Skip intros with `yt_start_offset: 15`. |
| `archive` | ✓ | ✓ | Historical, NASA, vintage newsreels, archival documentary | Pre-1980 events, space missions, WW-era, public domain |

---

### 3.4 Source Anti-Patterns (Never Do These)

```
✗ Image + source: "youtube"      → YouTube is Video ONLY. No Image.
✗ Video + source: "wikipedia"    → Wikipedia is Image ONLY. No Video.
✗ "City skyline" + source: "youtube"  → Use pexels for generic atmospheric B-roll.
✗ "Tesla logo" + source: "pexels"     → Use wikipedia for brand logos.
✗ "Moon landing" + source: "pexels"   → Use archive for historical events.
✗ "Elon Musk portrait" + source: "pexels" → Use wikipedia for real person faces.
✗ youtube yt_duration > 30           → Pipeline truncates to 30s. Plan ≤30s.
✗ query in Hindi/regional language   → Queries MUST be in English always.
✗ "an image showing growth of india" → Too descriptive. Use: "india economy growth".
```

---

## 4. Universal Advanced Manipulation (Any Layer)

### 4.1 Geometry & Layout (`style` — LayerBox SOT v1)

**CRITICAL**: `style` box goes on the `Layer` node (sibling of `content`), NOT inside `content`.

```json
{ "type": "Layer", "content": { "type": "Text", "text": "Headline" }, "style": { "left": "10%", "bottom": "18%", "width": "80%" } }
```

- **`%` Strings Only**: `left`, `top`, `width`, `height`, `right`, `bottom`. NEVER raw px or bare numbers.
- **Anchor XOR Rule**: `top` XOR `bottom` (never both). `left` XOR `right` (prefer `left`).
  - Lower-thirds → anchor `bottom`
  - Cards/hero visuals → anchor `top`
  - Text layer with both anchors → validator keeps `bottom` (lower-third wins)
  - Non-text with both → validator keeps `top`
- **Center Math**: `width: "40%"` → `left: "30%"` (`50 - width/2`). Same vertically with `top`.
- **Border Radius**: `"0px"` (sharp) | `"16px"` (subtle) | `"24px"` (card) | `"32px"` (pill) | `"50%"` (circle with `aspectRatio: "1 / 1"`)
- **Static Transforms** (in style): `rotate` (degrees), `scale` (multiplier), `scaleX: -1` (flip H), `scaleY: -1` (flip V), `rotateX`, `rotateY`, `translateZ`.
- **NEVER in style**: `transform` (stripped, breaks overlay sync), `opacity` (belongs in animations), `filter`/`mixBlendMode` (use layer `filters` array).

**Fullscreen Types** (box is always forced to 100%×100%, ignore positioning):
- `Map`, `Particles`, `Background` → always fullscreen. Positioning them does nothing. To overlay content on Map, add a sibling Layer on top.

**Layout Presets:**
```
Hero Center Card:      left: "15%", top: "15%", width: "70%", height: "65%", borderRadius: "24px"
Left Split Card:       left: "8%",  top: "15%", width: "42%", height: "70%", borderRadius: "20px"
Right Split Card:      left: "50%", top: "15%", width: "42%", height: "70%", borderRadius: "20px"
Lower-Third Bar:       left: "8%",  bottom: "18%", width: "50%", borderRadius: "16px"  [no height]
Portrait Lower-Third:  left: "8%",  bottom: "28%", width: "84%", borderRadius: "16px"  [no height]
Square Reticle Badge:  left: "35%", top: "25%", width: "30%", aspectRatio: "1 / 1", borderRadius: "50%"
Fullscreen Overlay:    width: "100%", height: "100%"
```

### 4.2 Keyframe Animation Engine (`animations`)
```json
[
  { "property": "translateY", "from": 45, "to": 0, "duration": 0.6, "delay": 0.3, "easing": "spring" },
  { "property": "opacity",    "from": 0,  "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out" }
]
```

**10 Animatable Properties:**
- **Spatial** (trigger camera shutter motion blur): `translateY`, `translateX`, `translateZ`, `scale`, `rotate`, `rotateX`, `rotateY`
- **Optical** (no shutter blur): `opacity`, `blur`, `brightness`

**Easings**: `"spring"` (organic snap) | `"ease-out"` (deceleration) | `"ease-in-out"` (S-curve) | `"ease-in"` (attack) | `"linear"` (constant drift) | `"bounce"` | `"elastic"` | `"back"` | `"steps"` | `"bezier"`

Spring physics: `damping` (default 14, lower = bouncier), `stiffness` (default 100, higher = snappier), `mass` (default 0.9), `overshoot_clamping`.

**Continuous Motion (`loop_mode`)**: `"loop"` (repeats) | `"pingpong"` (oscillates, full cycle = 2× duration)

**Timing Rules:**
- `delay`: Absolute seconds from CUT start. When word timestamps exist, sync `delay` to spoken word time.
- **Opacity Pairing Rule (MANDATORY)**: Every entrance with `delay > 0` MUST pair with `opacity: 0 → 1` at same delay. Elements must be invisible until their movement begins.

**Entrance Stagger Template** (broadcast-standard):
```
0.0s: Background enters with cut transition
0.3s: Hero card springs in (translateY: 45→0, spring) + opacity: 0→1
0.6s: Data graphic / Counter lights up (translateY: 30→0) + opacity: 0→1
0.9s: Headline kinetic reveal (words_stagger or marker_highlight)
```

**Exit Transition** (cut level, optional): `"exit_transition"` plays the reverse of an entrance over the cut's final frames (`"none"` default; same effects as `transition`). Use sparingly — beat ends / section closers only, never on consecutive cuts. Exit and entrance never overlap: sequential with a hard cut between. Perf: `blur_focus` (full-cut repaint) and clip-path wipes/iris are the most expensive effects — never on consecutive cuts.

### 4.3 Physics & Camera Dynamics (Layer Properties)
```json
{ "floating": true, "motion_blur": true, "shutter_angle": 180, "camera_shake": "handheld" }
```
- `floating: true`: Harmonic sinusoidal bob. Counts as spatial motion for shutter blur.
- `motion_blur: true` + `shutter_angle: 45–360`: Physical shutter blur (default 180 = cinematic 24fps). Needs spatial motion.
- `camera_shake`: `"handheld"` (subtle doc breathing) | `"shockwave"` (dramatic impact) | `"glitch"` (cyber jitter)
- `transform_origin`: CSS pivot for scale/rotate (`"center center"`, `"top left"`, `"bottom center"`)

### 4.4 Looks, Filters & Blend Modes (`filters` — Layer Property)
```json
{ "filters": ["brightness(0.35)", "contrast(1.2)"] }
{ "filters": ["drop-shadow(0 0 22px rgba(255,0,200,0.75))", "saturate(1.5)", "contrast(1.2)"] }
{ "filters": ["mix-blend-mode: overlay"] }
```

**Cinematic CSS Looks** (compose freely):
- `Neon Glow Pop`: `["drop-shadow(0 0 22px rgba(255,0,200,0.75))", "saturate(1.5)", "contrast(1.2)"]`
- `Cyberpunk`: `["hue-rotate(-35deg)", "saturate(1.8)", "contrast(1.25)"]`
- `Golden Hour`: `["sepia(0.45)", "saturate(1.6)", "brightness(1.05)"]`
- `Bleach Bypass`: `["grayscale(0.4)", "contrast(1.5)"]`
- `Night Vision`: `["sepia(1)", "hue-rotate(70deg)", "saturate(3)", "contrast(1.2)"]`
- `Thermal False-Color`: `["grayscale(1)", "invert(1)", "hue-rotate(190deg)", "saturate(4)"]`
- `Noir Hard`: `["grayscale(1)", "contrast(1.8)"]`
- `Dream Blur`: `["blur(1.5px)", "brightness(1.15)", "saturate(1.3)"]`
- `Cinematic Dark Base`: `["brightness(0.35)", "contrast(1.2)"]` — darken B-roll under text
- `Archival Monochrome`: `["grayscale(0.85)", "contrast(1.25)", "brightness(0.8)"]`

**6 SVG Filter Looks**: `"url(#fx-emboss)"` | `"url(#fx-sharpen)"` | `"url(#fx-posterize)"` | `"url(#fx-duotone-midnight)"` | `"url(#fx-duotone-inferno)"` | `"url(#fx-thermal)"`

**Blend Modes**: `"mix-blend-mode: overlay"` | `screen` | `multiply` | `color-dodge` | `color-burn` | `soft-light` | `hard-light` | `difference` | `luminosity`

**Optical Blurs**:
- Layer content blur: `filters: ["blur(12px)"]` or `style: { "blur": 12 }` — softens layer pixels
- Backdrop blur (frosted glass): `filters: ["backdrop-filter: blur(16px)"]` or `style: { "backdropFilter": "blur(16px)" }` — frosts layers beneath without blurring own content. Combine with `backgroundColor: "rgba(0,0,0,0.45)"` and `border: "1px solid rgba(255,255,255,0.12)"`.

### 4.5 Layer Exit & Sequential Stagger (`exit`)
```json
{ "exit": 2.0 }                      // unmount at 2.0s from cut start
{ "exit": true }                      // unmount when animations complete
```
Sequential stagger: Layer A exits at `2.0s`, Layer B enters at `delay: 2.2s` — clean beat sharing same screen space.

### 4.6 Shape Masking & Animated Reveals (`mask`)
```json
{ "mask": { "shape": "polygon", "polygon_preset": "hexagon", "reveal": "circle_iris", "reveal_duration": 0.8, "reveal_delay": 0.2, "reveal_easing": "ease-out" } }
```
- Shapes: `"circle"` | `"ellipse"` | `"inset"` (with `corner_radius`) | `"polygon"` (`"hexagon"`, `"diamond"`, `"triangle"`, `"star"`, `"slant_left"`, `"slant_right"`, `"custom"` with `points`)
- Reveals: `"circle_iris"` | `"wipe_right"` | `"wipe_down"` | `"split_vertical"` | `"wipe_diagonal"`. `inverted: true` reverses.
- A reveal animates INTO the static shape when both are set.

### 4.7 3D Camera Perspective (`perspective`, `perspective_origin`)
```json
{ "perspective": 1000, "perspective_origin": "center center" }
```
- `perspective`: `300`–`3000px`. Lower = wide-angle dramatic, higher = telephoto flat. Standard = `1000`.
- `perspective_origin`: `"center center"` | `"50% 0%"` (bird's-eye) | `"50% 100%"` (worm's-eye) | `"0% 50%"` (left lateral)
- Static 3D on `style`: `rotateX` (pitch -90° to +90°), `rotateY` (yaw), `translateZ` (-500 to +500px).

---

## 5. Compose Freely (no prescribed looks)

There is no mandatory layer sandwich. Compose any types, counts, and geometry
the schema allows to serve THIS narration beat — one Image + Text take with a
9s camera drift beats a 4-layer template that says nothing. The starter-pack
sample and Recipe A are structural shapes to imitate, never looks to repeat:
identical templates across cuts get flagged as repetition, while original
compositions are always safe. When in doubt, reach for authentic evidence
(archive photo, map with a drawn route, real footage, document) choreographed
as a continuous take (§6.5) instead of another centered icon + headline card.

Cut-level tools (set on the sub-visual, never on Layers):

### Transitions (on sub-visual, not on Layer)
```json
"transition": "slide_left"
```
`"cut"` | `"slide_left"` | `"slide_right"` | `"slide_up"` | `"slide_down"` | `"zoom_in"` | `"zoom_out"` | `"glitch"` | `"blur_focus"` | `"flash"` | `"wipe_right"` | `"iris_open"` | `"rise"` | `"flip"` | `"crossfade"` | `"dissolve"` | `"fade"` | `"none"`

### Mid-Cut Punch-In (`emphasis`)
```json
"emphasis": [{ "at": 1.2, "scale": 1.15, "duration": 0.5 }]
```
`at`: seconds into cut. `scale`: `1.02`–`1.6`. `duration`: `0.2`–`2.0s`.

### Audio Ducking
`"mute_voiceover": true` | `"mute_bg_music": true`

---

## 6. Multi-Layer Compositing Architecture

```
Layer 3 [Top]:      Kinetic Typography (synced headline, marker highlight, metric callout)
Layer 2 [Mid-Fore]: Hero Visual (Chart, Counter rollup, transparent cutout, animated SVG path)
Layer 1 [Mid-Back]: Atmosphere & Framing (Particles dust/embers, Shape corner_brackets, frosted card)
Layer 0 [Bottom]:   Canvas Foundation (Procedural Background OR darkened B-roll Video)
```

**Depth Rules:**
1. Never leave backgrounds flat. Use a `Background` preset OR darken Video with `Cinematic Dark Base` filter + slow `scale: 1.0→1.06` drift.
2. When presenting a `Chart`, `Counter`, or `Text`, place a frosted `Shape` card behind it.
3. Choreograph entrances with stagger: base at 0.0s, hero at 0.3s, text at 0.6s.
4. Apply `floating: true` on hero badges. Apply `motion_blur: true` + `shutter_angle: 180` on fast pans.

---

## 6.5 Single-Take Continuous Scene (Default — copy and adapt this)

One scene = ONE cut whose canvas stays alive for the full duration. This 9s
take is the reference implementation: camera drift spans all 9s, mid-timeline
beats are word-synced (delays 2.5 / 5.0 / 6.8 = spoken-word times, not
defaults), an early layer exits to free space, ambient loops never freeze, and
an emphasis punch carries the eye into the next cut. Adapt queries, words, and
delays to YOUR narration — keep the phase skeleton. Geometry follows the
canonical cut shape (box inside `content.style`, exactly like the starter-pack
`sample_cut` — that is what the validator enforces).

```json
{
  "duration": 9.0, "transition": "zoom_in",
  "emphasis": [{ "at": 8.0, "scale": 1.12, "duration": 0.6 }],
  "composition": { "type": "Sequence", "children": [
    { "type": "Layer", "name": "Archival map canvas",
      "content": { "type": "Image", "query": "atlantic ocean vintage map",
        "source": "archive", "objectFit": "cover",
        "style": { "position": "absolute", "left": "0%", "top": "0%",
          "width": "100%", "height": "100%" } },
      "motion_blur": true, "shutter_angle": 180, "camera_shake": "handheld",
      "animations": [
        { "property": "scale", "from": 1.0, "to": 1.32,
          "duration": 9.0, "delay": 0, "easing": "linear" },
        { "property": "translateX", "from": 0, "to": -60,
          "duration": 9.0, "delay": 0, "easing": "ease-in-out" }
      ],
      "filters": ["grayscale(0.85)", "contrast(1.25)", "brightness(0.8)"] },
    { "type": "Layer", "name": "Copper route draw",
      "content": { "type": "Shape", "shape_type": "path",
        "preset_path": "route_arch", "stroke": "#b87333",
        "stroke_width": 3, "draw_animation": true, "glow": true,
        "fill": "transparent",
        "style": { "position": "absolute", "left": "0%", "top": "0%",
          "width": "100%", "height": "100%" } },
      "animations": [
        { "property": "opacity", "from": 0, "to": 1,
          "duration": 0.5, "delay": 2.5, "easing": "ease-out" }
      ],
      "filters": [] },
    { "type": "Layer", "name": "Depth gauge card",
      "content": { "type": "Shape", "shape_type": "rectangle",
        "fill": "rgba(0,0,0,0.45)", "stroke": "rgba(255,255,255,0.25)",
        "stroke_width": 1.5, "corner_radius": 20,
        "style": { "position": "absolute", "left": "58%", "top": "30%",
          "width": "34%", "height": "40%",
          "backdropFilter": "blur(16px)",
          "border": "1px solid rgba(255,255,255,0.12)" } },
      "exit": 7.5,
      "animations": [
        { "property": "translateX", "from": 60, "to": 0,
          "duration": 0.6, "delay": 5.0, "easing": "spring" },
        { "property": "opacity", "from": 0, "to": 1,
          "duration": 0.4, "delay": 5.0, "easing": "ease-out" },
        { "property": "opacity", "from": 1, "to": 0,
          "duration": 0.3, "delay": 7.2, "exit": true, "easing": "ease-out" }
      ],
      "filters": ["backdrop-filter: blur(16px)"] },
    { "type": "Layer", "name": "Depth headline",
      "content": { "type": "Text", "text": "4000 meters beneath the waves",
        "font": "Outfit", "weight": "700", "color": "#ffffff",
        "animation_mode": "marker_highlight",
        "highlight_words": ["4000 meters"], "highlight_color": "#facc15",
        "style": { "position": "absolute", "left": "8%", "bottom": "18%",
          "width": "50%", "fontSize": "54px", "textAlign": "left",
          "textShadow": "0 4px 20px rgba(0,0,0,0.8)" } },
      "animations": [
        { "property": "opacity", "from": 0, "to": 1,
          "duration": 0.4, "delay": 5.0, "easing": "ease-out" }
      ],
      "filters": [] },
    { "type": "Layer", "name": "Crack reticle pulse",
      "content": { "type": "Shape", "shape_type": "path",
        "preset_path": "circle_reticle", "stroke": "#ff5544",
        "stroke_width": 2.5, "glow": true, "fill": "transparent",
        "style": { "position": "absolute", "left": "30%", "top": "35%",
          "width": "18%", "aspectRatio": "1 / 1" } },
      "floating": true,
      "animations": [
        { "property": "scale", "from": 0.7, "to": 1.0,
          "duration": 0.5, "delay": 6.8, "easing": "back" },
        { "property": "opacity", "from": 0, "to": 1,
          "duration": 0.3, "delay": 6.8, "easing": "ease-out" },
        { "property": "scale", "from": 1.0, "to": 1.08,
          "duration": 1.2, "delay": 7.3, "easing": "ease-in-out",
          "loop_mode": "pingpong" }
      ],
      "filters": [] },
    { "type": "Layer", "name": "Atmosphere",
      "content": { "type": "Particles", "particle_preset": "dust",
        "particle_count": 40, "particle_opacity": 0.15,
        "particle_direction": "up",
        "style": { "position": "absolute", "width": "100%",
          "height": "100%" } },
      "animations": [],
      "filters": [] }
  ]}
}
```

Why this works: the base Image moves for 9s (no frozen tail); reveals fire
on word times (5.0 = "4000 meters", 6.8 = "snapped"); the gauge exits at 7.5
so the resolve phase has room; the reticle loops gently after landing; the
emphasis at 8.0 hands momentum to the next cut. No centered bouncing icon —
the hero is the map + drawn route (authentic evidence), text is a lower-third.

---

## 7. Named Composition Recipes

These are proven patterns — pick one and adapt to the topic. Don't repeat the same recipe across consecutive cuts.

### Recipe A: "Data Drop" (2.5–4s) — Counter + metric reveal
```json
{
  "duration": 3.0, "transition": "zoom_in",
  "composition": { "type": "Sequence", "children": [
    { "type": "Layer", "content": { "type": "Background", "background_preset": "grid_flow", "colors": ["#0a0a1a", "#1e40af", "#7c3aed"], "speed": 1.2 } },
    { "type": "Layer", "content": { "type": "Shape", "shape_type": "rectangle", "fill": "rgba(255,255,255,0.05)", "stroke": "#38bdf8", "stroke_width": 1.5, "corner_radius": 24 }, "style": { "left": "15%", "top": "18%", "width": "70%", "height": "60%" }, "floating": true,
      "animations": [{"property": "scale", "from": 0.88, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.2, "easing": "ease-out"}] },
    { "type": "Layer", "content": { "type": "Counter", "value": 450, "prefix": "$", "suffix": "M", "title": "CAPITAL RAISED", "font_size": 84, "color": "#facc15" }, "style": { "left": "20%", "top": "28%", "width": "60%", "height": "32%" },
      "animations": [{"property": "translateY", "from": 40, "to": 0, "duration": 0.6, "delay": 0.4, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.4, "easing": "ease-out"}] },
    { "type": "Layer", "content": { "type": "Text", "text": "Record Q3 2024", "font": "Inter", "weight": "500", "color": "#94a3b8", "animation_mode": "static", "style": { "fontSize": "28px", "textAlign": "center" } }, "style": { "left": "25%", "top": "62%", "width": "50%" },
      "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.7, "easing": "ease-out"}] }
  ]}
}
```

### Recipe B: "Cinematic B-Roll Drop" (3–5s) — Video B-roll + kinetic headline
```json
// Layer 0: darkened Video (pexels/youtube) + Cinematic Dark Base filter + slow scale drift
// Layer 1: Particles (dust, 30-50 count, opacity 0.12-0.18) — atmospheric depth
// Layer 2: Shape (horizontal_line preset, draw_animation: true) — divider accent
// Layer 3: Text (words_stagger or marker_highlight, large headline)
// Transition: slide_left for high energy
```

### Recipe C: "Infographic Reveal" (3–4.5s) — Chart with data story
```json
// Layer 0: Background (waves or gradient_mesh) with brand colors
// Layer 1: Shape (corner_brackets path preset) — tech framing
// Layer 2: Chart (bar or line with bar_glow: true) — spring scale entrance
// Layer 3: Text (typewriter — stat interpretation label)
// Transition: slide_up or zoom_in
```

### Recipe D: "Map Story" (3–5s) — Geographic context
```json
// Layer 0: Map (modern_dark) — always fullscreen, set locations
// Layer 1: Shape (corner_brackets) — HUD framing overlay
// Layer 2: Text (static callout for city name + fact)
// Layer 3: Shape (circle reticle, draw_animation) — spotlight pulse on location
// Use: floating on reticle, camera_shake: handheld on Map for doc feel
```

### Recipe E: "Emotional Moment" (4–6s) — Human + narration sync
```json
// Layer 0: Image (pexels, objectFit: cover) + Dream Blur or Golden Hour filter + slow scale drift
// Layer 1: Shape (inset mask with corner_radius for cinematic framing)
// Layer 2: Text (marker_highlight, large emotional statement, highlight key word)
// Transition: dissolve or crossfade for emotional continuity
```

### Recipe F: "Tech/Product Demo" (3–4s) — Real-world product footage
```json
// Layer 0: Video (youtube, product demo query, yt_start_offset: 15) + slight Cyberpunk filter
// Layer 1: HTML (glass card with spec sheet or quote) OR Shape (frosted card)
// Layer 2: Text (words_stagger, spec highlight) + Shape (icon relevant to product)
// Transition: glitch or zoom_in for energy
```

### Recipe G: "Statistics Grid" (3–4s) — Multiple metrics
```json
// Layer 0: Background (blueprint or dots)
// Layer 1+2+3: Three Counter layers side by side at different x positions
//   Counter A: left: "8%",  top: "25%", width: "26%"
//   Counter B: left: "37%", top: "25%", width: "26%"
//   Counter C: left: "66%", top: "25%", width: "26%"
//   Stagger delays: 0.2s, 0.4s, 0.6s
// Layer 4: Text (category label below each counter, static)
// Transition: slide_right
```

### Recipe H: "Historical Archive" (3–5s) — Archival evidence
```json
// Layer 0: Image (archive, "NASA apollo" or historical query) + Archival Monochrome or Vintage Sepia filter
// Layer 1: Shape (inset mask for cinematic letterbox crop)
// Layer 2: HTML (newspaper/document evidence card with typewriter styling)
// Layer 3: Text (date stamp or attribution, static, small font)
// Transition: crossfade or dissolve
```

### Recipe I: "Exit Stagger Beat" (4–5s) — Sequential reveals in one cut
```json
// Layer A: Counter stat enters at 0.3s, exits at exit: 2.0 (pure exit: seconds on layer)
// Layer B: Text (different stat label) enters at delay: 2.2s, opacity pair at 2.2s
// Result: Two visual beats in one cut without needing an extra cut
// Use for: 2-stat comparisons, before/after reveals, cause→effect pairs
```

### Recipe J: "3D Depth Card" (2.5–4s) — Dimensional motion
```json
// Layer 0: Background (vignette_loop or gradient_mesh)
// Layer 1: Image/Shape with perspective: 800, rotateY: 15→0 spring entrance (3D card flip)
// Layer 2: Text overlay on card surface
// Add: motion_blur: true, shutter_angle: 90 for crisp but dimensional feel
```

---

## 8. Landscape vs Portrait Mode Reference

### Landscape (16:9 — 1920×1080)
- Subtitle safe area: bottom 15%. Keep all key content above `bottom: 18%`.
- Hero cards: `"top": "15%", "height": "65%"` (safe zone for subtitles)
- Lower-thirds: `"bottom": "18%"`, omit height (auto-size)
- Typical cut layout: wide hero + lower-third text

### Portrait (9:16 — 1080×1920)
- Subtitle safe area: bottom 25%. Keep all key content above `bottom: 28%`.
- Hero cards: `"top": "15%", "height": "55%"` (tighter — subtitles take more space)
- Lower-thirds: `"bottom": "28%"`, omit height (auto-size)
- Use narrow text columns: `"width": "84%"` instead of "80%"
- Counters: increase `font_size` to 96–120 (portrait canvas is narrower, need larger numerals)

---

## 9. Design Token Binding

Bind `design.json` tokens wherever elements take colors or fonts:
- `color_palette.primary` → bars, strokes, counters, key accents
- `color_palette.secondary` → supporting data, secondary badges
- `color_palette.accent` → highest-visibility callouts, highlight_color
- `color_palette.background` → Background preset base color
- `color_palette.text` → main text color
- `typography.heading_font` → titles, counters, display labels
- `typography.body_font` → body, chart labels, captions

---

## 10. Layer Ergonomics

```json
{ "name": "Background Footage", "visible": true, "locked": false, "color_tag": "#3b82f6" }
```
- `name`: Displayed in timeline editor. Use descriptive labels.
- `visible: false`: Hides from preview + export + canvas selection.
- `locked: true`: Prevents accidental drag/resize in canvas editor.
- `color_tag`: Hex for visual grouping in editor timeline.
