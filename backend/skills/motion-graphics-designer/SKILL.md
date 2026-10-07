---
name: motion-graphics-designer
description: "Motion choreography cookbook: concrete entrance patterns, exit/stagger sequences, filter application guide, and timing recipes. Full harness spec: read declarative-ast."
version: "5.1"
when_to_use: "Used during visual generation, motion graphics choreography, and styling."
---

# Motion Graphics Designer — Choreography Cookbook

> **Role**: Lead Motion Systems Engineer & Choreographer.
> **Mission**: Apply broadcast-quality motion choreography to AST cuts.
> **Full harness spec is in `declarative-ast`** — read it first. This file contains concrete motion recipes and choreography patterns you apply during visual authoring.

---

## 1. Universal Geometry Reference (LayerBox SOT v1)

Quick card — full rules in `declarative-ast` §4.1:

```
Style box goes INSIDE content as content.style — the ONLY geometry authority.
% strings only. Never px or bare numbers in left/top/width/height.
top XOR bottom (never both). left XOR right (prefer left).
Center formula: left = 50 - width/2.
Map / Particles / Background = always fullscreen (100%×100%), no positioning.
Transform in style = STRIPPED. Use animations[] for motion, not transform CSS.
```

**Card Layout Presets (Quick-Picks):**
```
Hero Center:        left: "15%", top: "15%",  width: "70%", height: "65%", borderRadius: "24px"
Left Split:         left: "8%",  top: "15%",  width: "42%", height: "70%", borderRadius: "20px"
Right Split:        left: "50%", top: "15%",  width: "42%", height: "70%", borderRadius: "20px"
Lower-Third (LS):   left: "8%",  bottom: "18%", width: "50%", borderRadius: "16px"  [no height]
Lower-Third (PT):   left: "8%",  bottom: "28%", width: "84%", borderRadius: "16px"  [no height]
Square Badge:       left: "35%", top: "25%",  width: "30%", aspectRatio: "1 / 1",  borderRadius: "50%"
```

---

## 2. The 10 Animatable Properties

| Property | Type | Common Use | Value Range |
|---|---|---|---|
| `translateY` | Spatial | Slide up entrance: `45→0` | px |
| `translateX` | Spatial | Slide in: `60→0` | px |
| `translateZ` | Spatial | Fly-in from depth: `-150→0` | px |
| `scale` | Spatial | Pop in: `0.85→1.0`, drift: `1.0→1.06` | multiplier |
| `rotate` | Spatial | Tilt entrance: `-10→0` | degrees |
| `rotateX` | Spatial | 3D card flip: `25→0` | degrees |
| `rotateY` | Spatial | 3D pan: `25→0` | degrees |
| `opacity` | Optical | Fade in: `0→1` | 0–1 |
| `blur` | Optical | Rack focus: `12→0` | px |
| `brightness` | Optical | Flash in: `0.3→1.0` | multiplier |

Spatial properties trigger shutter motion blur. Optical do not.

---

## 3. Entrance Motion Recipes

### Standard Hero Spring (cards, badges, counters)
```json
[
  { "property": "translateY", "from": 45, "to": 0, "duration": 0.6, "delay": 0.3, "easing": "spring", "stiffness": 120, "damping": 14 },
  { "property": "opacity",    "from": 0,  "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out" }
]
```

### Scale Pop (icons, shape badges, small cards)
```json
[
  { "property": "scale",   "from": 0.7, "to": 1.0, "duration": 0.5, "delay": 0.4, "easing": "back" },
  { "property": "opacity", "from": 0,   "to": 1,   "duration": 0.3, "delay": 0.4, "easing": "ease-out" }
]
```

### Slide Left (text reveals, list items)
```json
[
  { "property": "translateX", "from": -60, "to": 0, "duration": 0.5, "delay": 0.5, "easing": "ease-out" },
  { "property": "opacity",    "from": 0,   "to": 1, "duration": 0.4, "delay": 0.5, "easing": "ease-out" }
]
```

### Fly In From Depth (3D logo, product shot)
```json
[
  { "property": "translateZ", "from": -200, "to": 0, "duration": 0.7, "delay": 0.2, "easing": "spring" },
  { "property": "rotateY",    "from": 20,   "to": 0, "duration": 0.7, "delay": 0.2, "easing": "spring" },
  { "property": "opacity",    "from": 0,    "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out" }
]
```

### Rack Focus Reveal (sharp image entering from blur)
```json
[
  { "property": "blur",    "from": 14, "to": 0, "duration": 0.8, "delay": 0.1, "easing": "ease-out" },
  { "property": "opacity", "from": 0,  "to": 1, "duration": 0.5, "delay": 0.1, "easing": "ease-out" }
]
```

### Flash Brightness (dramatic fact reveal)
```json
[
  { "property": "brightness", "from": 0.0, "to": 1.0, "duration": 0.6, "delay": 0.3, "easing": "ease-out" },
  { "property": "scale",      "from": 1.1, "to": 1.0, "duration": 0.5, "delay": 0.3, "easing": "ease-out" },
  { "property": "opacity",    "from": 0,   "to": 1,   "duration": 0.3, "delay": 0.3, "easing": "ease-out" }
]
```

### Slow Cinematic Drift (background Video or Image)
```json
[
  { "property": "scale", "from": 1.0, "to": 1.06, "duration": 5.0, "delay": 0, "easing": "linear" }
]
```
For a single-take canvas, stretch the drift to the FULL cut duration
(`duration` = cut length, e.g. 9.0) and pair it with a slow translate
(`translateX: 0→-60`, `ease-in-out`) — this is the camera journey. Add
`motion_blur: true, shutter_angle: 180` on the drifting layer.

---

## 3.5 Continuous-Take Choreography (default — one living canvas per scene)

A single take evolves in four phases. Delays below are fractions of the cut,
not fixed seconds — scale them to YOUR cut duration, and bind key beats to
transcription word timestamps (delay = word_start − cut_start):

```
ESTABLISH (0–25%):    base enters with cut transition + full-duration
                      camera drift starts + ambient loop starts
DEVELOP (25–55%):     camera pushes in (scale/translate); SVG path draws
                      (draw_animation); supporting evidence fades in
EVOLVE (55–80%):      word-synced reveals — frosted card / gauge / document
                      slides in on the keyword; marker_highlight sweeps;
                      Counter lands on the number word; spent layers exit
RESOLVE (80–100%):    motion eases, never freezes — blur settles, callout
                       recedes, concluding headline reveals; emphasis
                       punch-in near the end hands momentum to the next cut
                       (or an `exit_transition` carries the whole cut out —
                       prefer one on beat ends, just never on consecutive cuts)
```

### Frozen-tail rule (strong default per cut)

If nothing moves after 50% of the cut, the take usually reads as slideshow.
Aim for at least one of:
- a camera drift / scale animation whose `duration` spans ≥80% of the cut, or
- a `loop_mode` ambient (particles, floating hero, breathing glow), or
- an `exit` + delayed-entrance stagger pair in the back half, or
- an `emphasis` punch-in at ≥70% of the cut.
A deliberate still hold (testimony, memorial) is fine with a one-line reason
in the beat plan.

Entrance-only choreography (everything lands by 0.8s, then static) is the #1
cause of slideshow-looking output. Full working take: `declarative-ast` §6.5.

---

## 4. Continuous Motion (loop_mode)

```json
{ "property": "scale",   "from": 1.0, "to": 1.08, "duration": 1.8, "easing": "ease-in-out", "loop_mode": "pingpong" }  // pulsing badge
{ "property": "rotate",  "from": 0,   "to": 360,  "duration": 8.0, "easing": "linear",      "loop_mode": "loop"     }  // spinner icon
{ "property": "opacity", "from": 0.6, "to": 1.0,  "duration": 1.2, "easing": "ease-in-out", "loop_mode": "pingpong" }  // breathing glow
```

---

## 5. Exit & Sequential Stagger

```json
// Layer A: shows a stat, then exits
{ "type": "Layer", "content": {...}, "exit": 2.0,
  "animations": [
    { "property": "translateY", "from": 30, "to": 0,  "duration": 0.5, "delay": 0.3, "easing": "spring" },
    { "property": "opacity",    "from": 0,  "to": 1,  "duration": 0.4, "delay": 0.3, "easing": "ease-out" },
    { "property": "opacity",    "from": 1,  "to": 0,  "duration": 0.3, "delay": 1.7, "exit": true }
  ]
}

// Layer B: enters after Layer A exits
{ "type": "Layer", "content": {...},
  "animations": [
    { "property": "translateY", "from": 30, "to": 0, "duration": 0.5, "delay": 2.2, "easing": "spring" },
    { "property": "opacity",    "from": 0,  "to": 1, "duration": 0.4, "delay": 2.2, "easing": "ease-out" }
  ]
}
```

---

## 6. Camera Dynamics Quick Reference

| Effect | Config | Best For |
|---|---|---|
| Cinematic float | `floating: true` | Hero cards, badges, counters |
| Shutter blur | `motion_blur: true, shutter_angle: 180` | Whip pans, fast slides |
| Crisp depth | `motion_blur: true, shutter_angle: 90` | Precise 3D reveals |
| Dreamy blur | `motion_blur: true, shutter_angle: 360` | Abstract / artistic cuts |
| Documentary feel | `camera_shake: "handheld"` | News, archive, emotional |
| High-impact reveal | `camera_shake: "shockwave"` | Big fact drops, dramatic moments |
| Cyber/glitch | `camera_shake: "glitch"` | Tech, hacking, data scenes |

---

## 7. Filter Application Guide

Apply filters to match the scene's emotional tone using preset shorthands or tokens:

```json
// Example: applying named presets (compiled automatically into CSS tokens)
{ "type": "Layer", "content": { "type": "Video", "query": "city street" }, "filters": ["noir_hard"] }
{ "type": "Layer", "content": { "type": "Video", "query": "tokyo night" }, "filters": ["cyberpunk", "contrast(1.2)"] }
{ "type": "Layer", "content": { "type": "Image", "query": "mountains" }, "filters": ["cinematic_dark_base", "blur(12px)"] }
```

| Tone / Mood | Filter Recommendation (use in `filters: [...]`) |
|---|---|
| Dark tech / finance / data | `"cinematic_dark_base"` on bg video + `"cyberpunk"` on foreground |
| Warm / human story | `"golden_hour"` on image/video base |
| Thriller / investigation | `"noir_hard"` on video + strong `"contrast(1.4)"` |
| Science / nature / space | `"thermal_false_color"` or `"night_vision"` on archive |
| Retro / historical | `"archival_monochrome"` or `"vintage_sepia"` on archive image |
| Futuristic / AI | `"neon_glow_pop"` on key elements + `"cyberpunk"` on bg |
| Danger / urgency | `brightness(1.8)→1.0` flash animation + `camera_shake: shockwave` |
| Dream / memory | `"dream_blur"` + slow scale drift |

**Blend mode uses:**
- `"mix-blend-mode: overlay"` — overlay a colored shape on video for tinting
- `"mix-blend-mode: screen"` — glowing particles/effects on dark backgrounds
- `"mix-blend-mode: multiply"` — paper texture on bright base
- `"mix-blend-mode: color-dodge"` — lens flare / light leaks

---

## 8. Kinetic Typography Recipes

```json
// marker_highlight — sweep ALL words (no highlight_words needed)
{ "type": "Text", "text": "Revenue hit a new record", "animation_mode": "marker_highlight", "highlight_color": "#facc15" }

// marker_highlight — sweep specific words only
{ "type": "Text", "text": "Revenue hit a new record", "animation_mode": "marker_highlight", "highlight_words": ["new", "record"], "highlight_color": "#f59e0b" }

// words_stagger — reveal word by word, accent highlight_words
{ "type": "Text", "text": "The fastest growth in history", "animation_mode": "words_stagger", "highlight_words": ["fastest", "history"], "highlight_color": "#38bdf8" }

// typewriter — char-by-char terminal reveal
{ "type": "Text", "text": "CLASSIFIED: OPERATION DRAGONFLY", "animation_mode": "typewriter", "font": "Fira Code", "color": "#00ff88" }

// Word sync: when spoken word timestamps exist, set delay = word_start_time - cut_start_time
// Example: word "revenue" starts at 2.4s into cut
{ "animation_mode": "words_stagger", "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 2.4, "easing": "ease-out"}] }
```

---

## 9. 3D Perspective Presets

```json
// Dramatic wide-angle (strong depth distortion)
{ "perspective": 400, "perspective_origin": "center center" }

// Cinematic standard
{ "perspective": 1000, "perspective_origin": "center center" }

// Bird's-eye looking down
{ "perspective": 800, "perspective_origin": "50% 0%" }

// Lateral camera from left
{ "perspective": 1000, "perspective_origin": "0% 50%" }

// Telephoto flat (subtle depth)
{ "perspective": 2500, "perspective_origin": "center center" }
```

---

## 10. Timing Density Guide

No layer quota — use as many layers as the beat needs (usually a rich stack).
Typical depth per cut length, tuned for the eye, not the count:

| Cut Duration | Typical Depth | Beats | Notes |
|---|---|---|---|
| 1.5–2.5s | lean (2–3 purposeful) | 1 | Background + hero or text only. Keep it snappy. |
| 2.5–4s | rich (3–5 purposeful) | 1–2 | Full depth stack. One stagger beat. |
| 4–6s | rich (4–6 purposeful) | 2–3 | Full depth. Use exit/stagger for 2nd beat. Floating on hero. |
| 6s+ | rich (4–6 purposeful) | 2–3 | Add loop_mode motion. Consider `mute_voiceover` for a dramatic pause beat. |

**Rule**: every layer must earn its place — a clear job plus motion (or a
deliberate static role, like a backdrop). A 1.5s cut should NOT carry 6
animated entrances; animation should land before the cut ends. For short cuts:
simpler entrances (0.3s delay max, no stagger). Richness means living layers,
not layer count.

---

## 11. Multi-Layer Depth Rules (with visual-director-core §4)

Motion serves depth, not decoration. Every take keeps a rich, purposeful stack —
foundation, atmosphere/framing, hero, kinetic text in whatever count the beat
needs — and every layer gets a job across time, not just an entrance: the foundation drifts the full take
(§3.5 camera journey), the hero floats or loops, mid-timeline beats
exit/stagger, the headline lands word-synced (§8). If a layer's last keyframe
is before the take's midpoint, give it a loop, a drift extension, an exit, or
cut it — dead layers are visual noise. Full take skeleton: `declarative-ast`
§6.5.
