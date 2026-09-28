---
name: visual-director-core
version: "3.0"
description: "Capability reference for visual direction: layer types and fields, timing math, media contracts, and harness reports. No prescribed looks; compose freely."
when_to_use: "Always loaded during bulk scene visual generation, storyboarding, and visual direction."
---

# Visual Director Core (capabilities, not direction)

> **Role**: Visual systems engineer.
> **Mission**: Emit valid, renderable AST cuts from the 11 layer types. Every creative decision — types, counts, geometry, motion, looks — is yours. This file lists what the harness supports and what breaks rendering. Full field semantics: `declarative-ast`.

---

## 1. Cut Structure (functional)

- One sub-visual per visual beat. The sum of all sub-visual durations MUST exactly equal the Total Scene Duration (the renderer normalizes small mismatches).
- Stacking is children array order, `children[0]` = bottom … last = top.
- Transitions: `fade crossfade dissolve slide_left slide_right slide_up slide_down zoom_in zoom_out whip_pan glitch none cut` — any renderer-supported transition is allowed; unknown names fall back to `fade`.
- Cut-level flags (siblings of `transition`): `emphasis [{at, scale 1.02–1.6, duration 0.2–2}]` (keep `at+duration` inside the cut), `mute_voiceover` / `mute_bg_music` booleans. `subtitle_position` is DISABLED (renderer forces bottom) — do not emit. `duration_ratio` is editor-managed — do not emit.
- 🚫 **NO CHAPTER TITLE BADGES**: chapter indicators render continuously at root level; static badges inside 2–4s cuts flash and break continuity.

---

## 2. The 11 Layer Types (fields — full semantics in `declarative-ast` §4)

- **Counter**: `value` (default 100), `start_value` (0), `prefix`/`suffix`, `decimals` (0), `duration` (count-up seconds, default 2.0), `format: standard|compact|currency|percent|full→standard|none`, `font_size` 16–300 (default 72), `title`, `color`/`font`/`weight`, `fontSize`/`textAlign`/`letterSpacing`.
- **Background**: `background_preset: gradient_mesh|grid_flow|waves|dots|blueprint|vignette_loop|paper_grain`, `colors[3]`, `speed` 0.2–3.0. Always fullscreen, bottom layer.
- **Chart**: `chart_type: bar|line|pie|donut|progress`, `title`, `title_size` (28), `bar_radius` (10), `bar_gap` (16), `bar_max_width` (90), `bar_glow` (true), `style.color`.
- **Shape**: `shape_type: rectangle|circle|star|triangle|arrow|polygon|path|icon`, `fill`/`stroke`/`stroke_width`/`corner_radius`/`direction: up|down|left|right`/`angle`, `preset_path: route_arch|horizontal_line|pointer_curve|corner_brackets|wave_pulse|circle_reticle`, custom `path_d` (1920×1080 canvas) + `view_box`, `draw_animation`, `glow`, `radius`/`points`/`inner_radius`, `icon_name` (kebab-case Lucide, 1500+). Box = stage — never content `width`/`height` alongside a style box.
- **Lottie**: `lottie_url` or `animation_data` (precedence), `loop` (default true), `playback_rate` (1.0), `direction: forward|backward` (`lottie_direction` alias). NEVER emit `src` (validator folds it).
- **Particles**: `particle_preset: confetti|embers|dust|money_rain|snow|stars`, `particle_count` (10–300), `particle_size`, `particle_speed` (0.1–3), `particle_direction: up|down|left|right|outward|twinkle`, `particle_opacity`, `particle_colors[]`. Renders where placed.
- **Text**: `text`, `font`, `weight 400–900` (default 700), `style.fontSize` px string 8–500 (boxed default 64, free 100 — top-level `content.font_size` is ignored), `animation_mode: static|words_stagger|typewriter|marker_highlight`, `highlight_words` (read by marker/words modes only), `highlight_color`, `lineHeight`/`letterSpacing`/`fontStyle`/`textAlign`/`textShadow`. Complex scripts MUST use the matching Noto font (e.g. `Noto Sans Devanagari`).
- **Image / Video**: REQUIRE `query` (1–3 English keywords) + `source` — MATRIX: Image ← `pexels|pixabay|wikipedia`, Video ← `pexels|pixabay|youtube` (crossed sources fall back to wrong-type Pexels). NEVER `sources[]`, `url`, `local_path`, `asset_url`. `volume` 0–1 (default 0); `loop: false` freezes last frame. YouTube trims: `yt_start_offset`/`yt_duration` (15s/15s, max 30s).
- **Map**: `map_style: modern_dark|vintage|minimal_light|nautical_blue` (set explicitly — renderer falls back to `vintage` when omitted, preview≠export), `locations: [{name, coord:[lat,lon]}]`.
- **HTML**: `html_content` plain JSON string (`<`/`>` need no escaping). CSS + typography + inline SVG only — no `<img>`/`<video>`/`<iframe>`/`src=`/`url(...)`/`background-image`/remote links (render blank; pair a separate query-only media layer). Inner-CSS contract: §4C of `declarative-ast`.

---

## 3. Motion & FX (modifiers — what they do)

- `motion_blur: true` + `shutter_angle` 45–360 (default 180). No-op without spatial motion (keyframe, `floating`, `camera_shake`).
- `camera_shake: handheld|shockwave|glitch|none`. `floating: true` (counts as motion). `transform_origin` (pivot, default center — visible only with motion).
- Keyframes `{property, from, to, duration, delay}`: `scale opacity translateX translateY rotate rotateX rotateY blur brightness`; easings `linear spring ease-in ease-out ease-in-out`.
- `filters`: CSS looks + SVG `url(#fx-emboss|sharpen|posterize|duotone-midnight|duotone-inferno|thermal)` (replace each other; disabled on transparent Particles canvas) + `mix-blend-mode` (needs a layer beneath).
- Timing facts: `delay` = seconds from CUT start. `delay > 0` needs an opacity fade at the same delay (spatial-only allowed at `delay: 0`). `delay` = word time − cut start when timestamps exist, clamped to `[0, cut_duration − animation_duration]`. `delay + duration` SHOULD fit (overflow clipped).

---

## 4. Geometry, Safe Areas, Verification (functional)

- LayerBox: `%`-only boxes; anchor XOR; fullscreen types; full rules in `declarative-ast` modifiers + `docs/COORDINATE_SPEC.md`.
- Subtitle safe area: keep key text/cards above `bottom: 18%` (landscape) / `28%` (portrait). Complex-script text needs Noto fonts.
- Media: `query` + valid `source`, no hardcoded URLs. Durations sum exactly. Delayed entrances pair opacity. No chapter badges in cuts.
