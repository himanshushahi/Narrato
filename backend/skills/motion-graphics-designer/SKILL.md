---
name: motion-graphics-designer
description: "Comprehensive capability reference for motion systems: keyframe engine, kinetic typography, camera dynamics, filter looks, transitions, and multi-layer compositing depth. No prescribed looks; choreograph freely."
version: "4.0"
when_to_use: "Used during visual generation, motion graphics choreography, and styling."
---

# Motion Graphics Designer (Harness Motion Architecture)

> **Role**: Lead Motion Systems Engineer & Choreographer.  
> **Mission**: Emit valid animated AST with broadcast-quality motion graphics. Every creative decision — geometry, motion curves, timing staggers, visual looks — is yours. This file details the full motion harness. Full schema: `declarative-ast`.

---

## 1. Universal Geometry Authority (`style` — LayerBox SOT v1)

LayerBox SOT v1 is the ONLY geometry authority:
* **`%` Strings Only**: `left`, `top`, `width`, `height` (or `bottom` for lower-thirds; `right` for right-aligned). Never write raw `px` or bare numbers.
* **Anchor XOR Rule**: `top` XOR `bottom` (lower-thirds anchor `bottom: "18%"`, cards anchor `top`). `left` XOR `right` (prefer `left`).
* **Center Formula**: `left: "30%"` for `width: "40%"` (`50 - width/2`). Same vertically for `top`.
* **Border Radius**: `"0px"` (sharp), `"16px"` (subtle), `"24px"` (card), `"32px"` (round), `"9999px"` (pill), `"50%"` (circle with `aspectRatio: "1 / 1"`).
* **Static Transforms (Compose with Keyframes)**:
  * `rotate`: Angle in degrees (e.g. `rotate: -4` for dynamic editorial tilt).
  * `scale`: Multiplier (`1.0` = 100%, `1.15` = punch zoom).
  * `scaleX: -1`: Flips horizontally (mirror left-to-right).
  * `scaleY: -1`: Flips vertically (mirror upside-down).
* **Fullscreen Types**: `Background`, `Map`, and `Particles` are always fullscreen `{"width": "100%", "height": "100%"}` with no positioning offsets.
* **Card Layout Presets**:
  * Hero Center Card: `{"left": "15%", "top": "15%", "width": "70%", "height": "65%", "borderRadius": "24px"}`.
  * Left Split Card: `{"left": "8%", "top": "15%", "width": "42%", "height": "70%", "borderRadius": "20px"}`.
  * Lower-Third Info Bar: `{"left": "8%", "bottom": "18%", "width": "50%", "borderRadius": "16px"}` (omit `height`).
  * Square Reticle Badge: `{"left": "35%", "top": "25%", "width": "30%", "aspectRatio": "1 / 1", "borderRadius": "50%"}`.
* **NEVER a raw `transform` in `style`**: Stripped by engine; breaks overlay synchronization.

---

## 2. Multi-Track Keyframe Animation Engine (`animations`)

Any layer can carry an array of keyframe tracks:
```json
{
  "property": "translateY",
  "from": 45,
  "to": 0,
  "duration": 0.6,
  "delay": 0.5,
  "easing": "spring"
}
```

### The 10 Animatable Properties
* **Spatial Properties (Drive Camera Shutter Motion Blur)**:
  * `translateY`: Vertical travel in pixels (`45 -> 0` = slide up entrance, `0 -> -45` = slide up exit).
  * `translateX`: Horizontal travel in pixels (`60 -> 0` = slide in entrance).
  * `translateZ`: 3D depth travel in pixels along camera Z-axis (`-150 -> 0` = fly-in toward camera from screen depth, `0 -> 100` = pop out toward viewer).
  * `scale`: Zoom multiplier (`0.85 -> 1.0` = spring pop, `1.0 -> 1.06` = slow cinematic parallax drift).
  * `rotate`: 2D planar rotation in degrees (`-12 -> 0`).
  * `rotateX`: 3D card tilt angle (`25 -> 0`).
  * `rotateY`: 3D card pan angle (`25 -> 0`).
* **Non-Spatial Properties (Optical & Luma Fades — do not trigger shutter blur)**:
  * `opacity`: Transparency fade (`0 -> 1` or `1 -> 0`).
  * `blur`: Rack-focus in pixels (`12 -> 0` = sharpens from blurred focus).
  * `brightness`: Exposure flash multiplier (`0.3 -> 1.0` = flash-in, `1.8 -> 1.0` = lens flare settle).

### Physics & Easing Curves
* `"spring"`: High-energy organic snap with physical spring bounce (ideal for cards, icons, counters, and callout badges). Supports `damping` (default 14), `stiffness` (default 100), `mass` (default 0.9), and `overshoot_clamping` (boolean).
* `"bounce"`: Gravitational bouncing impact.
* `"elastic"`: Rubber-band overshoot (with optional `elastic_bounciness`).
* `"back"`: Anticipation wind-up before launching forward (with optional `back_overshoot`).
* `"steps"`: Stepped stop-motion / 8-bit frame rate effect (with optional `steps_count`).
* `"bezier"`: Custom cubic Bézier curve with `bezier_points: [x1, y1, x2, y2]`.
* `"ease-out"`: Smooth deceleration (ideal for charts, lines, and typography).
* `"ease-in-out"`: Graceful S-curve for continuous flowing movement.
* `"linear"`: Constant-rate drift (ideal for slow background scale zooms and ticker scrolls).
* `"ease-in"`: Acceleration attack (ideal for whip pans and exits).
* **Continuous Motion (`loop_mode`)**: `"loop"` (repeats from start) or `"pingpong"` (oscillates continuously, e.g. scale `1.0 -> 1.08` pulsing).


### Timing & Opacity Pairing Rules
* `delay`: Absolute seconds from CUT start (not video start).
* **Word Sync**: When spoken word timestamps exist, set `delay = spoken_word_time - cut_start_time` so elements pop exactly as the narrator speaks them!
* **Opacity Pairing Rule**: Every entrance animation with `delay > 0` MUST pair with an `opacity: 0 -> 1` keyframe at the exact same delay, so elements stay hidden until their movement begins.

---

## 3. Layer Exit & Sequential Stagger (`exit`)

By default, layers persist for the full cut duration. To choreograph multi-beat sequences inside a single cut without visual collisions:
* **Layer-level `exit: true`**: Automatically unmounts the layer as soon as its keyframe animations end.
* **Layer-level `exit: <seconds>`**: Unmounts the layer at an exact timestamp from cut start (e.g. `exit: 2.0`).
* **Track-level `exit: true`**: Animation track skips evaluating until its delay begins, animates, and unmounts the layer upon completion (e.g. `{ "property": "opacity", "from": 1, "to": 0, "duration": 0.4, "delay": 2.0, "exit": true }`).
* **Sequential Stagger Workflow**: Layer A enters at `delay: 0.3s`, displays its stat, and exits at `exit: 2.0s`. Layer B enters at `delay: 2.2s` in the same screen space, creating a dynamic, continuous story beat.

---

## 4. Physics & Camera Dynamics (`motion`)

* **`floating: true`**: Enables harmonic sinusoidal floating drift (slow hovering bob). Adds organic life to static infographics, metric cards, and cutout stickers. Counts as spatial motion.
* **`motion_blur: true` + `shutter_angle: 45–360`**: Physical optical camera shutter blur on moving layers. Default `180` (cinematic 24fps standard). Requires spatial motion (`animations`, `floating`, or `camera_shake`).
* **`camera_shake: "handheld" | "shockwave" | "glitch" | "none"`**:
  * `"handheld"`: Subtle organic documentary camera breathing.
  * `"shockwave"`: Dramatic earthquake tremor for high-impact facts and reveals.
  * `"glitch"`: Cybernetic high-frequency jitter.
* **`transform_origin`**: CSS pivot point for scale/rotate (`"center center"`, `"top left"`, `"bottom center"`, etc.).
* **Shape Masking & Animated Reveals (`mask`)**:
  * Shape: `"circle"`, `"ellipse"`, `"inset"` (with `corner_radius`), or `"polygon"` (`"hexagon"`, `"diamond"`, `"triangle"`, `"star"`, `"slant_left"`, `"slant_right"`, `"custom"` points).
  * Animated reveals: `"circle_iris"`, `"wipe_right"`, `"wipe_down"`, `"split_vertical"` (center-out curtain), `"wipe_diagonal"` (corner-to-corner) with `reveal_duration`, `reveal_delay`, `reveal_easing` (`linear`/`ease-in`/`ease-out`/`ease-in-out`/`bounce`), `inverted`. A reveal animates INTO the static shape when both are set.
* **3D Camera Perspective & Spatial Depth (`perspective`, `perspective_origin`)**:
  * `perspective: 1000`: Camera lens focal distance in pixels (lower = wide-angle dramatic depth; higher = telephoto flat).
  * `perspective_origin: "center center"`: Vanishing point (supports `"50% 0%"` for bird's-eye looking down, `"50% 100%"` for worm's-eye looking up).
  * Static 3D transforms on `content.style`: `rotateX` (pitch tilt, -90° to +90°), `rotateY` (pan yaw, -90° to +90°), `translateZ` (spatial depth, -500px to +500px).
* **Layer Timeline Ergonomics**:
  * `name`: Descriptive label in timeline (e.g. `"Presenter Spotlight"`, `"Metric Card"`).
  * `visible`: `false` hides layer; `locked`: `true` locks layer against canvas drag.

---

## 5. Kinetic Typography Engine & Kinetic Typography Recipes

* **4 Animation Modes**:
  * `"marker_highlight"`: Vibrant background color marker sweep across `highlight_words` (sweeps ALL words if `highlight_words` is omitted).
  * `"words_stagger"`: Kinetic word-by-word reveal (only words in `highlight_words` receive accent color).
  * `"typewriter"`: Character reveal with blinking terminal cursor.
  * `"static"`: Clean static typography.
* **Advanced Typography Controls**:
  * `style.fontSize`: Exact pixel size (`8px`–`500px`; boxed default `64px`, free text `100px`).
  * `style.letterSpacing`: Tracking (e.g. `"-0.02em"` for modern tight titles, `"0.08em"` for tracked uppercase categories).
  * `style.lineHeight`: Line spacing (e.g. `1.2`, `1.4`, `1.6`; complex scripts auto-set to `1.6`).
  * `style.textShadow`: Soft shadow (`0 4px 20px rgba(0,0,0,0.8)`), strong (`0 6px 30px rgba(0,0,0,0.9)`), neon glow (`0 0 30px rgba(0,212,255,0.8)`).
  * **Auto-Sizing**: Omit `style.height` on text layers so the box automatically fits its content vertically.
  * **CTL Fonts**: Complex scripts (Hindi, Marathi, Tamil, etc.) **MUST** use matching Noto fonts (e.g. `Noto Sans Devanagari`).

---

## 6. Looks, Filters & Blend Modes (`filters`)

Apply cinematic looks and composite blending via the `filters` string array:
* **8 Cinematic CSS Looks**:
  * `Neon Glow Pop`: `["drop-shadow(0 0 22px rgba(255,0,200,0.75))", "saturate(1.5)", "contrast(1.2)"]`
  * `Cyberpunk`: `["hue-rotate(-35deg)", "saturate(1.8)", "contrast(1.25)"]`
  * `Golden Hour`: `["sepia(0.45)", "saturate(1.6)", "brightness(1.05)"]`
  * `Bleach Bypass`: `["grayscale(0.4)", "contrast(1.5)"]`
  * `Night Vision`: `["sepia(1)", "hue-rotate(70deg)", "saturate(3)", "contrast(1.2)"]`
  * `Thermal False-Color`: `["grayscale(1)", "invert(1)", "hue-rotate(190deg)", "saturate(4)"]`
  * `Noir Hard`: `["grayscale(1)", "contrast(1.8)"]`
  * `Dream Blur`: `["blur(1.5px)", "brightness(1.15)", "saturate(1.3)"]`
* **Base Grades**: `Cinematic Dark Base` (`["brightness(0.35)", "contrast(1.2)"]`), `Archival Monochrome`, `Vintage Sepia`, `Vibrant Tech Glow`.
* **6 SVG Filter Looks** (rendered identically in preview & export):
  * `"url(#fx-emboss)"`: 3D stone/metal relief
  * `"url(#fx-sharpen)"`: Crisp footage bite
  * `"url(#fx-posterize)"`: Pop-art comic quantization
  * `"url(#fx-duotone-midnight)"`: Deep navy → cyan grade
  * `"url(#fx-duotone-inferno)"`: Dark amber → fire grade
  * `"url(#fx-thermal)"`: Multi-band thermal heat signature
* **10 Blend Modes**: `filters: ["mix-blend-mode: overlay"]` (or `screen`, `multiply`, `color-dodge`, etc.).

---

## 7. Cut Transitions, Energy Dynamics & Audio Ducking

Configured at the **sub-visual cut level**:
* **13 Transitions**: `"transition": "cut" | "slide_left" | "slide_right" | "slide_up" | "slide_down" | "zoom_in" | "zoom_out" | "whip_pan" | "glitch" | "crossfade" | "dissolve" | "fade" | "none"`.
* **Mid-Cut Punch-Ins**: `"emphasis": [{"at": 1.2, "scale": 1.15, "duration": 0.5}]` (snaps scale and eases back down, providing visual energy without interrupting footage).
* **Audio Ducking**: `"mute_voiceover": true` (pauses narration) | `"mute_bg_music": true` (silences music).

---

## 8. Multi-Layer Compositing Architecture & Multi-Layer Depth Rules

Modern motion designers build visual depth by stacking multiple coordinated layers:
* **Layer 0 (Canvas Base)**: Procedural `Background` shader OR darkened cinematic `Video`/`Image` with `filters: ["brightness(0.35)", "contrast(1.2)"]` and subtle `scale: 1.0 -> 1.06` drift.
* **Layer 1 (Atmosphere & Framing)**: Subtle `Particles` (dust/embers at low opacity), vector brackets (`Shape` with `preset_path: "corner_brackets"`), or a translucent frosted card backing.
* **Layer 2 (Hero Focus)**: Animated `Chart`, `Counter` rollup, transparent cutout graphic (`Image` with Pixabay vector/illustration), or SVG path with `draw_animation: true` and `glow: true`.
* **Layer 3 (Kinetic Typography)**: Narrative headline or callout badge synced to spoken words (`marker_highlight` or `words_stagger`), safely positioned above `bottom: 18%` (landscape) / `28%` (portrait).
