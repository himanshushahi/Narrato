---
name: motion-graphics-designer
description: "Capability reference for motion graphics: geometry authority, animation system, kinetic text modes, multi-layer compositing facts, and design token binding. No prescribed looks; choreograph freely."
version: "3.0"
when_to_use: "Used during visual generation and styling for motion capabilities."
---

# Motion Graphics Designer (capabilities, not recipes)

> **Role**: Motion systems engineer.
> **Mission**: Emit valid animated AST. Every creative decision — geometry, moves, looks — is yours. This file lists what the animator supports and what breaks rendering. Full semantics: `declarative-ast`.

---

## 1. Card Layout Presets (geometry authority, not a menu)

LayerBox SOT v1 is the ONLY geometry authority: `%` strings only (never `px`, never bare numbers); `top` XOR `bottom`, `left` XOR `right` (prefer `left`); every non-background layer carries a full box. `Map`/`Particles`/`Background` are always fullscreen (`100%`/`100%`, no position keys). `Shape` box = stage. Normative reference (grids, %→px tables, clamp table): `docs/COORDINATE_SPEC.md` — it wins on disagreement.

Positioning facts: base boxes (`left`/`top`/`width`/`height`/`borderRadius`) are layout; static `rotate`/`scale`/`scaleX`/`scaleY`/`aspectRatio` compose with keyframes (pivot = `transform_origin`, default center). NEVER a raw `transform` string (stripped; overlay loses sync). Center math: width 42% → `left: "29%"` (`50−width/2`). Text: omit `height` for auto-size (lower-thirds anchor `bottom: "18%"`, box grows upward).

## 2. Animation System (what plays — choreograph freely)

- Keyframes `{property, from, to, duration, delay, exit}`: `scale opacity translateX translateY rotate rotateX rotateY blur brightness`; easings `linear spring ease-in ease-out ease-in-out`. Spatial props drive shutter blur; `blur`/`brightness` alone are fades (pair with a scale drift if you want blur to bite).
- `delay` = seconds from CUT start (not video). `delay + duration` SHOULD fit inside the cut (overflow clipped). Word sync: `delay` = word time − cut start, clamped to `[0, cut_duration − animation_duration]`. `delay > 0` needs an opacity fade at the same delay (spatial-only allowed at `delay: 0`).
- Sequential stagger & exit: Layer exit is supported via layer-level `exit: true` (unmounts after its animations finish), `exit: <seconds>` (unmounts at timestamp), or keyframe track `exit: true` (skips before delay, unmounts on completion). Use to sequence multiple elements cleanly in the same screen space without lingering overlap.
- `motion_blur: true` needs spatial motion (`shutter_angle` 45–360, default 180); `floating` counts as motion; `camera_shake: handheld|shockwave|glitch|none`; `transform_origin` (pivot, motion-only).
- `emphasis [{at, scale 1.02–1.6, duration 0.2–2}]` is cut-level (sibling of `transition`), keep `at+duration` inside the cut.
- `filters`: CSS looks + SVG `url(#fx-emboss|sharpen|posterize|duotone-midnight|duotone-inferno|thermal)` (replace each other; disabled on transparent Particles canvas) + `mix-blend-mode` (needs a layer beneath — invisible on single opaque fullscreen).

## 3. Kinetic Typography Recipes (mode mechanics, not scripts)

- `marker_highlight`: background sweep over `highlight_words` (omitted = ALL words). `words_stagger`: word-by-word reveal (only listed words highlight). `typewriter`: character reveal + cursor. `static`: no animation.
- Text fields: `font` (17 preloaded families + Noto CTL; others may not export), `weight 400–900`, `style.fontSize` px 8–500 (boxed 64 / free 100), `highlight_color`, `lineHeight`/`letterSpacing`/`fontStyle`/`textAlign`/`textShadow` (complex scripts auto-`lineHeight 1.6`).

## 4. Multi-Layer Depth Rules (compositing facts)

- Order = paint order (`children[0]` bottom). Any count renders.
- Bind `design.json` tokens by name: `color_palette.primary|accent|surface|glow`, `typography.heading_font|body_font`. No example hex — read the project file.
- Overlap report is advisory (`overlap IoU`); intentional stacking and accidental collision read the same — your call.

## 5. Vector Shape Fields

- `shape_type: rectangle|circle|star|triangle|arrow|polygon|path|icon`, `fill`/`stroke`/`stroke_width`/`corner_radius`/`direction: up|down|left|right`/`angle`, `preset_path: route_arch|horizontal_line|pointer_curve|corner_brackets|wave_pulse|circle_reticle`, custom `path_d` (1920×1080 space) + `view_box`, `draw_animation`, `glow`, `radius`/`points`/`inner_radius`, `icon_name` (kebab-case Lucide, 1500+).

## 6. Pre-Flight Checklist (render-breakers only)

- [ ] All coordinates LayerBox `%` strings (no `px`, no bare numbers)
- [ ] No raw `transform` in `style`
- [ ] `delay > 0` paired with opacity fade
- [ ] Subtitle safe area (`bottom: 18%` landscape, `28%` portrait) clear of primary text
- [ ] Complex scripts use Noto fonts
