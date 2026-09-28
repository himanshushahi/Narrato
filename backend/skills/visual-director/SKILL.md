---
name: visual-director-core
version: "4.0"
description: "Core capability reference for visual direction: layer types and fields, universal advanced manipulation, cut transitions, and compositing depth. No prescribed looks; compose freely."
when_to_use: "Always loaded during bulk scene visual generation, storyboarding, and visual direction."
---

# Visual Director Core (Capabilities & Motion Graphics Harness)

> **Role**: Lead Visual Director & Motion Systems Engineer.  
> **Mission**: Emit valid, renderable AST cuts from the 11 layer types. Every creative decision — types, counts, geometry, motion, looks — is yours. This file lists what the harness supports and what breaks rendering. Full semantics: `declarative-ast`.

---

## 1. Cut Structure & Scene Timing
* **1 Cut Per Visual Beat**: Emit multiple sub-visual cuts per scene to match narrative pacing.
* **Duration Math**: The sum of all sub-visual `duration` values MUST equal the Total Scene Duration exactly (2 decimal places).
* **Array Stacking**: `children[0]` is the bottom background; subsequent layers stack on top (`children[N-1]` is foreground).
* **Cut-Level Transitions**: `"transition": "cut" | "slide_left" | "slide_right" | "slide_up" | "slide_down" | "zoom_in" | "zoom_out" | "whip_pan" | "glitch" | "crossfade" | "dissolve" | "fade" | "none"`.
* **Mid-Cut Punch-Ins**: `"emphasis": [{"at": 1.2, "scale": 1.15, "duration": 0.5}]` (focal scale snap; keep `at + duration` inside the cut).
* **Audio Ducking**: `"mute_voiceover": true` (pauses narration) | `"mute_bg_music": true` (silences music).
* **🚫 NO CHAPTER BADGES**: Root overlays handle chapter pills continuously; static chapter badges inside 2–4s cuts flash and break visual continuity.

---

## 2. Part 1: Visual-Specific Capabilities (The 11 Content Types, Layer Types & Layers)

1. **`Text`**: `text`, `font`, `weight` (400–900), `style.fontSize` (`8px`–`500px`), `animation_mode` (`"marker_highlight"` | `"words_stagger"` | `"typewriter"` | `"static"`), `highlight_words`, `highlight_color`, `color`, `style.textAlign`, `style.lineHeight`, `style.letterSpacing`, `style.textShadow`. For lower-thirds/callouts, omit `style.height` (auto-sizes). Complex scripts (Hindi, Marathi, Tamil, etc.) **MUST** use matching Noto fonts (e.g. `Noto Sans Devanagari`).
2. **`Counter`**: `value`, `start_value` (0), `prefix` (`$`, `+`, `₹`), `suffix` (`%`, `M+`, `B`), `decimals` (0–2), `duration` (count-up seconds, 0.2–10s), `format` (`"standard"` | `"compact"` | `"currency"` | `"percent"` | `"none"`), `font_size` (16–300px), `title` (category headline), `color`, tabular numerals built-in.
3. **`Shape`**: `shape_type` (`"rectangle"` | `"circle"` | `"star"` | `"triangle"` | `"arrow"` | `"polygon"` | `"path"` | `"icon"`), `icon_name` (1,500+ Lucide icons in kebab-case, e.g. `"trending-up"`, `"shield-alert"`, `"zap"`), `fill`, `stroke`, `stroke_width`, `corner_radius`, `direction`, `preset_path` (`"route_arch"` | `"horizontal_line"` | `"pointer_curve"` | `"corner_brackets"` | `"wave_pulse"` | `"circle_reticle"`), `path_d` (1920×1080 canvas), `draw_animation` (animates stroke drawing), `glow` (neon bloom).
4. **`Chart`**: `chart_type` (`"bar"` | `"line"` | `"pie"` | `"donut"` | `"progress"`), `data: [{"label", "value", "color"}]`, `title`, `title_size`, `bar_radius`, `bar_gap`, `bar_max_width`, `bar_glow`, `style.color`.
5. **`Background`**: Procedural shaders (zero asset downloads): `background_preset` (`"gradient_mesh"` | `"grid_flow"` | `"waves"` | `"dots"` | `"blueprint"` | `"vignette_loop"` | `"paper_grain"`), `colors: [base, accent1, accent2]`, `speed` (0.2–3.0). Always fullscreen, bottom layer.
6. **`Image`**: `query` (1–3 English keywords) + `source` (`"pexels"` | `"pixabay"` | `"wikipedia"`). Use Pixabay `image_type: "illustration"`/`"vector"` for transparent cutouts/stickers. `objectFit`: `"cover"` | `"contain"` | `"fill"`.
7. **`Video`**: `query` (1–3 English keywords) + `source` (`"pexels"` | `"pixabay"` | `"youtube"`). `volume` (0.0–1.0), `loop: false` (freezes last frame) | `true`, `yt_start_offset`, `yt_duration` (max 30s), `objectFit`.
8. **`Lottie`**: `lottie_url` or `animation_data`, `loop`, `playback_rate`, `direction: "forward" | "backward"`.
9. **`Particles`**: `particle_preset` (`"confetti"` | `"embers"` | `"dust"` | `"money_rain"` | `"snow"` | `"stars"`), `particle_count` (10–300), `particle_colors`, `particle_speed`, `particle_direction`, `particle_opacity`.
10. **`Map`**: `map_style` (`"modern_dark"` | `"vintage"` | `"minimal_light"` | `"nautical_blue"`), `locations: [{"name", "coord": [lat, lon]}]`.
11. **`HTML`**: `html_content` (inline CSS/SVG/HTML for evidence documents, code snippets, receipts, glass cards). Single 100% filler root, fluid type (`clamp()`, `cqw`, `"%"`), no remote assets.

---

## 3. Part 2: Universal Advanced Manipulation Controls & Motion Grammar (Any Layer)

1. **Geometry & Layout (`style`)**:
   - LayerBox SOT v1: `%` strings ONLY (`left`, `top`, `width`, `height`, or `bottom`). Never write raw `px`.
   - Centering formula: `left: "30%"` for `width: "40%"` (`50 - width/2`).
   - `borderRadius`: `"0px"`, `"16px"`, `"24px"`, `"32px"`, `"50%"` (circle with `aspectRatio: "1 / 1"`).
   - Static transform: `rotate` (deg tilt), `scale` (10–500%), `scaleX: -1` (flip H mirror), `scaleY: -1` (flip V).
2. **Keyframe Animations (`animations`)**:
   - Spatial props (drive shutter blur): `translateY`, `translateX`, `scale`, `rotate`, `rotateX`, `rotateY`.
   - Non-spatial props (optical fades): `opacity` (0->1), `blur` (px rack focus, e.g. 10->0), `brightness` (multiplier flash).
   - Parameters: `from`, `to`, `duration`, `delay` (seconds from cut start), `easing` (`"spring"` | `"ease-out"` | `"ease-in-out"` | `"linear"`).
   - Word Sync & Opacity: When word timestamps exist, sync `delay` to the spoken word time. Always pair `delay > 0` with `opacity: 0 -> 1`.
3. **Physics & Camera Dynamics (`motion`)**:
   - `floating: true`: Organic harmonic floating drift (sinusoidal hovering bob). Counts as spatial motion.
   - `motion_blur: true` + `shutter_angle`: Camera shutter blur (45–360, default 180).
   - `camera_shake: "handheld" | "shockwave" | "glitch" | "none"`.
   - `transform_origin`: Pivot point for scale/rotate (`"center center"`, `"top left"`, etc.).
4. **Looks, Filters & Blend Modes (`filters`)**:
   - CSS Looks: `Neon Glow Pop`, `Cyberpunk`, `Golden Hour`, `Bleach Bypass`, `Night Vision`, `Thermal False-Color`, `Noir Hard`, `Dream Blur`, `Cinematic Dark Base`.
   - SVG Looks: `"url(#fx-emboss)"`, `"url(#fx-sharpen)"`, `"url(#fx-posterize)"`, `"url(#fx-duotone-midnight)"`, `"url(#fx-duotone-inferno)"`, `"url(#fx-thermal)"`.
   - Blend Modes: `filters: ["mix-blend-mode: overlay"]` (or `screen`, `multiply`, `color-dodge`, etc.).
5. **Layer Exit & Stagger (`exit`)**:
   - Layer-level `exit: true` or `exit: <seconds>`, or animation track `exit: true`. Unmounts the layer cleanly so subsequent elements can enter the same screen space without visual collision.

---

## 4. Part 3: Multi-Layer Compositing Architecture

To produce broadcast-quality modern motion graphics, build cuts with **layered visual depth**:
* **Layer 0 (Canvas Base)**: Procedural `Background` shader OR darkened cinematic `Video`/`Image` with `filters: ["brightness(0.35)", "contrast(1.2)"]` and slow `scale: 1.0 -> 1.06` drift.
* **Layer 1 (Atmosphere & Framing)**: Subtle `Particles` (dust/embers at low opacity), vector brackets (`Shape` with `preset_path: "corner_brackets"`), or a translucent frosted card backing.
* **Layer 2 (Hero Focus)**: Animated `Chart`, `Counter` rollup, transparent cutout graphic (`Image` with Pixabay vector/illustration), or SVG path with `draw_animation: true` and `glow: true`.
* **Layer 3 (Kinetic Typography)**: Narrative headline or callout badge synced to spoken words (`marker_highlight` or `words_stagger`), safely positioned above `bottom: 18%` (landscape) / `28%` (portrait).
