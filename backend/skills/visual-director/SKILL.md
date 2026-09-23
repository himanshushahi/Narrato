---
name: visual-director-core
version: "2.1"
description: "Master Visual Director rules for 3-layer parallax depth, 15 AST archetypes incl. viral breakers, anti-template variety contract, motion vocabulary v2, camera pacing curves, and motion sync."
when_to_use: "Always loaded during bulk scene visual generation, storyboarding, and visual direction."
---

# Visual Director Core Specification & Motion Grammar

> **Role**: Lead Motion Graphics Designer & Visual Director  
> **Mission**: Build bold, cinematic, and dynamic composites with multi-layer depth, tactile physics, and precise narration sync across Remotion AST scenes.

---

## 1. Cinematic Direction & Dynamic Composition

You are a top-tier Motion Graphics Designer and Visual Director. Be bold, cinematic, and creative!  
**DO NOT** default to lazy `[Full Screen Image] → [Centered Text]` layouts.  
Every sub-visual should feel like an intentional, high-production composite with multi-layer depth.

---

## 2. Quantity & Pacing Curve Guidelines

| Video Section | Target Beat Duration | Visual Style & Cutting Rhythm |
|---|---|---|
| **Intro / Hook (First 0–10s)** | **~2.0s – 2.8s** per sub-visual | High-velocity cuts, kinetic typography, punch-in shockwaves, glitch reveals |
| **Middle Scenes (Deep Dive)** | **~3.2s – 4.5s** per sub-visual | Balanced rhythm, data charts, documentary dossiers, route maps |
| **Conclusion / Summary** | **~2.5s – 3.5s** per sub-visual | Dynamic summary cards, key metrics, call-to-action motion |

### Timing & Transition Guidelines
- Break narration into logical visual beats — one sub-visual per beat.
- **Hook Velocity (Intro Scene, first 0–10s)**: Aim for high-speed cuts (**~2.0s – 2.8s per sub-visual beat**) with kinetic typography and shockwave/glitch reveals. Shorter or longer is fine if the beat needs it.
- **Deep Dive (Middle Scenes)**: Aim for balanced rhythm (**~3.2s – 4.5s per sub-visual beat**) for data charts and document analysis.
- The sum of all sub-visual durations MUST exactly equal the Total Scene Duration (technical requirement — the renderer normalizes small mismatches).
- Vary transitions across cuts — e.g. `fade`, `crossfade`, `dissolve`, `slide_left`, `slide_right`, `slide_up`, `slide_down`, `zoom_in`, `zoom_out`, `whip_pan`, `glitch`, `none`, `cut`. Any renderer-supported transition is allowed; unknown names fall back to `fade`.

---

## 3. 3-Layer Faux-3D Parallax Depth Standard

Great motion graphics are defined by **depth, hierarchy, and contrast**. Every sub-visual cut should construct depth across 3 ordered layers (stacking = children array order, `children[0]` = bottom ... `children[N-1]` = top):

| Layer Order | Classification | Content Options | Motion Grammar |
|---|---|---|---|
| **Layer 1: children[0]** | **Atmospheric Canvas (Background)** | `Background` procedural presets, darkened `Video` B-roll, high-contrast `Image`, vector `Map`, or `HTML` grid | Continuous camera drift (`scale: 1.0 -> 1.06`, linear) or shader flow |
| **Layer 2: middle children** | **Graphic Subject (Midground)** | `Chart`, `Counter`, vector `Shape`, `Lottie`, vintage paper/memo `HTML` | Physics spring entrance (`translateY: 40 -> 0`, `easing: "spring"`), motion blur |
| **Layer 3: last children** | **Typography & Accents (Foreground)** | Kinetic `Text`, Lucide `Shape` icon badges, particle atmosphere overlays | Staggered reveal, marker highlight, typewriter, above subtitle safe zone |

### Detailed Parallax Guidelines
1. **Background (Atmospheric Canvas, first child)**: Full-screen base layer — choose the BEST type for the narrative moment:
   - **Background**: Procedural kinetic background canvas (`gradient_mesh`, `grid_flow`, `waves`, `dots`, `blueprint`, `vignette_loop`, `paper_grain`). Sleek procedural math animation with 0 asset downloads.
   - **Video**: Darkened B-roll footage + slow continuous camera drift (`scale: 1.0 -> 1.06`, `linear`).
   - **Image**: Darkened high-contrast photograph + camera drift (entity spotlights, evidence, historical).
   - **Map**: Vector globe with animated route (geography-central narration).
   - **HTML**: CSS gradient/grid canvas (tech/data/infographic beats without distracting footage).
   - ⚠️ **VARIETY (encouraged)**: Prefer not to use the same base type for consecutive cuts. Alternate between Background presets, Video, Image, HTML Gradients, and Maps when the story allows — repetition is allowed when the narrative needs continuity.
2. **Midground (Graphic Subject, middle children)**: Data charts (`Chart`), metric counters (`Counter` with tabular numerals & spring pop), cards, vector shapes, vintage newspaper cutouts, or bespoke HTML evidence cards with physics spring entrance (`translateY: 40 -> 0`, `opacity: 0 -> 1`, `easing: "spring"`).
   - 💡 **Speed Differential**: Fast spring entrance on midground + slow linear drift on background creates a cinematic 3D parallax effect!
   - 💡 Set `motion_blur: true` on fast midground entrances for physical camera shutter blur.
   - 💡 Charts usually read best as middle children over HTML gradients or darkened video. A full-screen chart as first child is allowed when the data IS the beat.
3. **Foreground (Typography & Accents, last children)**: Kinetic typography (`marker_highlight`, `words_stagger`, `typewriter`) and indicator callout pointers (staying above `bottom: 18%` safe area).

---

## 4. Supported AST Content Types Overview

The renderer supports **11 distinct content types**. Combine them freely across layers:

| Primitive | Primary Use Case | Key Differentiators |
|---|---|---|
| **`Counter`** | Market caps, financials, milestones | Tabular numerals, decimal formatting, spring pop |
| **`Background`** | Zero-download dynamic base canvases | Procedural shaders (`gradient_mesh`, `grid_flow`, `waves`, etc.) |
| **`Chart`** | Data comparisons, growth, distributions | Bar, line, pie, donut, progress |
| **`Shape`** | Framing, arrows, pointers, paths, icons | 1,500+ Lucide icons, animated SVG paths, glow |
| **`Lottie`** | Vector UI micro-animations | 60 FPS vector icons, alerts, checkmarks |
| **`Particles`** | Atmospheric mood overlays | Confetti, embers, dust, money rain, snow, stars |
| **`Text`** | Headlines, evidence quotes, callouts | Kinetic modes: `marker_highlight`, `words_stagger`, `typewriter` |
| **`Image`** | Archival photos, logos, transparent cutouts | Sources: `pexels`, `pixabay` (illustrations/vectors), `wikipedia` |
| **`Video`** | Cinematic B-roll, timelapses | Sources: `pexels`, `pixabay`, `youtube` (with start/duration trim) |
| **`Map`** | Routes, territories, flight paths | Interactive 3D globe, 4 map themes, multi-pin routes |
| **`HTML`** | Custom evidence dossiers, leaked memos | Custom CSS, glowing borders, comparison cards |

---

## 5. Content Type Selection Guide

### 1. Counter
- Animated numerical count-up with tabular numerals, decimal precision, prefix/suffix (e.g. `$100M+`), and spring finish pop.
- Full fields: `value` (target, default 100), `start_value` (default 0), `prefix`/`suffix`, `decimals` (default 0), `duration` (count-up seconds, default 2.0), `format: "standard" | "compact" | "currency" | "percent" | "full"→standard | "none"`, `font_size` 16–300 (default 72), `title` (uppercase label above), `color`/`font`/`weight`.
- Ideal for financial metrics, market valuation, milestone counts, growth stats. Style extras: `fontSize`/`textAlign`/`letterSpacing`.

### 2. Background
- Procedural kinetic background canvas presets (`background_preset: "gradient_mesh" | "grid_flow" | "waves" | "dots" | "blueprint" | "vignette_loop" | "paper_grain"`, `colors`, `speed`).
- Fullscreen base canvas with fluid math animation that never fails to render.

### 3. Chart
- Statistics, comparisons, growth trends, market share, distributions (`chart_type: "bar" | "line" | "pie" | "donut" | "progress"`).
- Add `title`, `title_size` (default 28), `bar_radius` (10), `bar_gap` (16), `bar_max_width` (90), `bar_glow` (default true), `style.color` to art-direct bars/lines/pies.

### 4. Shape
- Hardware-accelerated vector shapes, arrows, callout pointers, framing rectangles, animated SVG paths.
- Full spec lives in `declarative-ast` § Shape (SOT) — summary: `shape_type: rectangle|circle|star|triangle|arrow|polygon|path|icon`, `fill`/`stroke`/`stroke_width`/`corner_radius`/`direction: up|down|left|right`/`angle`.
- `preset_path: "route_arch" | "horizontal_line" | "pointer_curve" | "corner_brackets" | "wave_pulse" | "circle_reticle"`, custom `path_d` (1920×1080 canvas) + `view_box`, `draw_animation` + `glow`.
- Glyph sizing `radius`/`points`/`inner_radius` (star/polygon tuning; box = stage — never content `width`/`height` alongside a style box, use small `%` boxes for dots).
- Vector icons (`shape_type: "icon"`, `icon_name`: any kebab-case Lucide name e.g. `"trending-up" | "shield-alert" | "dollar-sign" | "rocket" | "sparkles" | "crown" | ...` — 1500+ supported).

### 5. Lottie
- 60 FPS vector micro-animations, animated icons, warning badges, checkmarks, dynamic accents.
- `lottie_url` or inline `animation_data` which takes precedence, `loop` default true, `playback_rate` default 1.0, playback `direction: "forward" | "backward"` (`lottie_direction` is an accepted alias).
- Safe starter URLs: `https://assets10.lottiefiles.com/packages/lf20_qp1q7mct.json` (checkmark), `https://assets9.lottiefiles.com/packages/lf20_5tkuno.json` (alert). Same-CDN-shape extras that work: loading spinner (`lf20_p8bfn5to`), money (`lf20_9xrenieu`), confetti burst (`lf20_rovf9gzu`), trend arrow (`lf20_sj0rwar7`), bell CTA (`lf20_myeuhs7h`) under `https://assets*.lottiefiles.com/packages/`. Any LottieFiles URL works. RULE: one small accent badge per cut (8–18% box) with spring entrance — never fullscreen. When unsure a URL loads, use a Lucide `Shape icon` instead. NEVER emit a `src` field (folded into `lottie_url` by the validator).

### 6. Particles
- Canvas atmosphere overlay — `particle_preset: "confetti" | "embers" | "dust" | "money_rain" | "snow" | "stars"`, plus full overrides: `particle_count` (10–300), `particle_size`, `particle_speed` (0.1–3), `particle_direction` (`up|down|left|right|outward|twinkle`), `particle_opacity`, `particle_colors[]`.
- Prefer ONE per cut as LAST child matched to emotion (profits → money_rain, scandal → embers, victory → confetti); a second layer is allowed for dense celebration beats. Keep clear of key text.

### 7. Text
- Dynamic headlines, data callouts, dramatic reveals, kinetic typography.
  * `animation_mode: "words_stagger"` for impactful statements.
  * `animation_mode: "typewriter"` for investigative notes or quotes.
  * `animation_mode: "marker_highlight"` with `highlight_words: ["keyword"]` for emphasis.
  * `animation_mode: "static"` for labels, badges, lower-thirds that should simply be legible — valid, not lazy, when the beat is calm.
  * Fine type controls: `lineHeight`, `letterSpacing`, `fontStyle`, `textAlign`, `textShadow`. Keep text and cards above `bottom: 18%` (landscape) or `28%` (portrait) safe area for subtitle readability.
  * For complex scripts (Hindi, Tamil, Bengali, Arabic, etc.), you MUST specify the corresponding Noto font (e.g. `Noto Sans Devanagari`, `Noto Sans Tamil`) to guarantee proper Unicode matra and ligature shaping.

### 8. Image
- High-resolution stock photos, textures, overlays, portraits, evidence photos, and **official company/brand logos**.
  * **Company / Brand Logos (suggestion)**: `source: "wikipedia"` with exact entity name often fetches official transparent SVGs (Image layers only — never `wikipedia` on Video).
  * **Crypto / Concept Logos (suggestion)**: `source: "pixabay"` with `image_type: "vector"`.
  * **Real People Portraits (suggestion)**: `source: "wikipedia"` (query = exact person name).
  * **Transparent Cutouts (suggestion)**: `source: "pixabay"` with `image_type: "illustration"` or `"vector"`. `image_type: "photo" | "all"` also works for generic photos.

### 9. Video
- Cinematic B-roll, timelapses, dramatic motion backgrounds.
- `volume` range is 0–1 (default 0); non-zero ambient (e.g. `0.1`–`0.25`) + `loop: true` allowed. Keep non-zero volume low so it never clashes with spoken narration, unless `mute_voiceover: true` is set on the cut.
- `loop: false` freezes on the last frame when the clip ends early.
- YouTube-only trims `yt_start_offset` / `yt_duration` (defaults 15s/15s, max 30s) to cue the exact moment.
- Image/Video layers REQUIRE `query` (1–3 English keywords) + `source` — MATRIX: Image ← `pexels|pixabay|wikipedia`, Video ← `pexels|pixabay|youtube` (crossed sources fall back to wrong-type Pexels, intended source lost). NEVER emit `sources[]`, `url`, `local_path`, `asset_url`.

### 10. Map
- Geography, routes, territories (`map_style: "modern_dark" | "vintage" | "minimal_light" | "nautical_blue"`).
- `locations: [{name, coord:[lat,lon]}]` supports multi-pin itineraries, not just 2-city routes.

### 11. HTML
- Universal dynamic canvas for bespoke documentary evidence, vintage newspaper clippings, leaked audit memos, encrypted chat dialogues, comparison cards, metric tickers, and custom SVG diagrams.
- One card per HTML layer (own `style` box + staggered entrance `delay`s); `html_content` is a plain JSON string — `<`/`>` need NO special escaping, NEVER skip HTML via MCP, just emit valid JSON.
- Keep to CSS + typography + inline SVG (no `<img>`/`<video>`/`<iframe>`/`src=`/`url(...)`/`background-image`/remote links — pair a separate query-only Image/Video layer side-by-side instead).

---

## 6. Universal Motion Modifiers & FX Pack

| Modifier | Target Property | Values / Configuration | Visual Impact |
|---|---|---|---|
| **Motion Blur** | `motion_blur` | `true` (shutter angle 45–360, default 180) | Physical camera shutter blur on high-speed springs/drifts |
| **Camera Shake** | `camera_shake` | `"handheld"`, `"shockwave"`, `"glitch"` | Organic camera breathing, market crash impact, tech jitter |
| **Punch-In** | `emphasis` | `[{ "at": 1.2, "scale": 1.15, "duration": 0.5 }]` | Sub-visual level emphasis zoom on dramatic words/stats |
| **CSS Looks** | `filters` | Neon Glow Pop, Cyberpunk, Golden Hour, Bleach Bypass, Night Vision, Thermal False-Color, Noir Hard, Dream Blur | Stylistic color grading & atmosphere |
| **SVG Looks** | `filters` | `url(#fx-emboss)`, `url(#fx-sharpen)`, `url(#fx-posterize)`, `url(#fx-duotone-midnight)`, `url(#fx-duotone-inferno)`, `url(#fx-thermal)` | Tactile paper texture, noir duotone, thermal imaging |

### Motion Modifier Guidelines
- **Motion Blur**: Set `motion_blur: true` on fast-moving cards or spring entrances to enable physical camera shutter blur.
- **Camera Shake**: Set `camera_shake: "handheld"` on ambient footage layers for organic documentary breathing, `camera_shake: "shockwave"` for high-impact market crash / explosion reveals, or `camera_shake: "glitch"` for fast digital tech jitter.
- **2026 FX Pack** (layer `filters` array): cinematic CSS looks — `Neon Glow Pop`, `Cyberpunk`, `Golden Hour`, `Bleach Bypass`, `Night Vision`, `Thermal False-Color`, `Noir Hard`, `Dream Blur` (compose freely) — plus 6 SVG looks `url(#fx-emboss)`, `url(#fx-sharpen)`, `url(#fx-posterize)`, `url(#fx-duotone-midnight)`, `url(#fx-duotone-inferno)`, `url(#fx-thermal)` (one per layer is the norm, stacking allowed experimentally; disabled on transparent Particles canvas). Use freely wherever the beat needs energy; combine CSS + SVG looks on stacked cuts (blend modes need a layer beneath to be visible).
- **Punch-In Emphasis** (sub-visual level, sibling of `transition`, NOT inside layers): `"emphasis": [{"at": 1.2, "scale": 1.15, "duration": 0.5}]` — 0+ marks on any cut length, `scale` 1.02–1.6, `duration` 0.2–2s, keep `at+duration` inside the cut; place on the most shocking word/stat.

---

## 6B. Motion Vocabulary v2 (beyond slide-up cards)

`translateY spring` alone reads as a slide deck. Reach for these on at least 1 cut per scene:

| Move | Recipe | When |
|---|---|---|
| **Slam Zoom** | Text `scale: 1.6 -> 1.0 spring 0.5s` + `motion_blur: true` + `emphasis` punch | shock stats, crash words (Archetype 13) |
| **Tilt Reveal** | `rotate: -6 -> 0` + `translateY` + opacity, `transform_origin: "center center"` | paper memos, editorial cutouts |
| **Rack-Focus** | `blur: 12 -> 0` + opacity `0.5s ease-out` (no shutter blur — pair with a scale drift if you want blur) | archival photos, evidence reveals |
| **Flash Reveal** | `brightness: 0.3 -> 1.0` + opacity | leaked docs, dawn/triumph beats |
| **Lateral Whip** | `translateX: -60/60 -> 0 spring` on collage halves with opposite signs | split-screens, comparisons (Archetype 14) |
| **Stagger Cascade** | 2–3 one-card HTML layers with delays `0.3 / 0.55 / 0.8` + shared `horizontal_line` draw-on | timelines, rankings (Archetype 15) |

Quota: ≥1 non-`translateY` entrance per scene, ≥1 `emphasis` or `camera_shake` moment per 3 cuts.

## 6C. Anti-Template Contract (hard variety rules)

1. NEVER emit two consecutive cuts with the same layer signature (e.g. `Video→HTML→Text` twice). Change bg type, geometry preset, or text mode.
2. Cycle `children[0]` across cuts (`Video` → `Background` preset → `Image` → `HTML` gradient → `Map`). Same bg twice in a row needs a story reason.
3. One viral breaker per 3+-cut scene: full-bleed impact word (no card), duotone collage cutout, or ticker/timeline rail (`declarative-ast` Archetypes 13–15).
4. Never reuse the same HTML shell twice in a row (Brutalist / Noir / Terminal / Paper / Neon Outline / Ticker — see `declarative-ast §5B`). The default navy glass card is banned unless the beat is a genuine dossier.
5. Never repeat `animation_mode` + position twice in a row (two centered `marker_highlight` headlines back-to-back is rejected).

---

## 7. Animation Delay, Narration Sync & Opacity Pairing

- `delay` is seconds from the CUT start. Cut transitions run ~0.5s — entrances with small `delay` can play under the transition; `0.3–0.5` is a safe default, `0` is allowed for `cut`/`none` transitions and ambient drift.
- **Pair entrances with opacity fade on delayed reveals:** when animating entrance properties (`translateY`, `translateX`, `scale`, `rotate`, `rotateX`, `rotateY`, `blur`), ALWAYS include a simultaneous `{ "property": "opacity", "from": 0, "to": 1, "duration": 0.45, "delay": ..., "easing": "ease-out" }` on the same layer whenever `delay > 0` so elements stay invisible before they enter (otherwise they sit frozen on screen at their starting offset before the delay). Spatial-only entrances without fade are allowed ONLY for instant punch/whip beats at `delay: 0`.
- Animate freely: give full `animations` keyframes to whichever layers carry the beat (1 hero layer is the safe default; up to 3 animated layers allowed on rich cuts). Background drift + midground spring + foreground stagger is a valid premium combo — avoid animating 5+ layers at once which looks chaotic.
- When `Exact Spoken Words with Timestamps` are provided, compute `delay` = (word timestamp − sub-visual start offset), clamped to `[0, cut_duration − animation_duration]`, so each visual enters exactly when the narration mentions it.
- `delay + duration` SHOULD fit inside the sub-visual's `duration` (overflow gets clipped). On short cuts (≤2.5s) use a short `duration` (0.4–0.5s) at the word-timed `delay`.

---

## 8. Composition Variety & Quality Standards

- 🚫 **NO CHAPTER TITLE BADGES**: Do NOT create static chapter title cards or header badges inside sub-visual cuts. Chapter indicators are rendered continuously by the root composition overlay engine.
- Prefer fresh layouts per cut — reuse is allowed when the narrative needs continuity (recurring segment branding, ongoing data story).
- Rich starting points: split-screen data HUDs, vintage newspaper clippings (HTML), leaked dossiers (HTML), macro metrics, route maps (Map), corporate spotlights (Wikipedia Image logo + ticker), vector animations (Lottie), cinematic atmosphere beats.
- Portrait presets: Top-stack (headline top 8% + subject center), Center-punch (one big metric center 35–65%), Split-stack (two cards vertical 12%/50%). Landscape presets A–C in `motion-graphics-designer` also work.
- Always use `style` on layers — responsive percentage coordinates (`left`, `top`, `width`, `height`).
- Use the project's design system tokens (`primary`, `accent`, `surface`, `glow`, `heading_font`) when available; a custom palette is allowed when the beat demands it.
- **Quality guide** (aim, don't gate):
  1. *Depth*: 2–4 ordered layers (background canvas + subject + accents).
  2. *Anchor*: Prefer at least one Map, Data Chart, or Document/Timeline per scene when the story supports it.
  3. *Safe Areas*: Keep key text/cards above `bottom: 18%` (landscape) or `bottom: 28%` (portrait).
  4. *Pacing*: Fast intros (~2.0s–2.8s) and rhythmic middles (~3.2s–4.5s) are good defaults.

---

## 9. Pre-Flight Visual Verification Checklist

- [ ] Every cut has 2–3 stacked layers establishing background, midground, and foreground
- [ ] No static chapter title cards embedded in sub-visual cuts
- [ ] Every delayed entrance animation (`delay > 0`) is paired with an opacity fade
- [ ] Subtitle safe area (bottom 18% landscape / 28% portrait) remains clear of primary text
- [ ] Non-Latin languages use Noto fonts (`Noto Sans Devanagari`, etc.)
- [ ] Sub-visual durations sum exactly to total scene duration
- [ ] Image and Video layers specify `query` and valid `source` (no hardcoded URLs)
