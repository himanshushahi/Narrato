# Coordinate Spec — Layer Geometry Single Source of Truth

Authoritative reference for every layer-geometry decision: renderer
(`ASTRenderer.tsx`), editor overlay (`CanvasOverlay.tsx`), backend validation
(`backend/agent/schemas.py`, `validators.py`, `geometry.py`), and all visual
skills. When code and a skill disagree, **this doc + `schemas.py` win**.

## 1. Canvas

| Format | Logical canvas (W×H px) |
|---|---|
| landscape | 1920 × 1080 |
| portrait | 1080 × 1920 |
| square | 1080 × 1080 |

Preview lays out at logical size and CSS-scales (0.5× fast mode); export
renders at scale 1. `%` semantics are resolution-independent; `px` fontSize
is logical-px.

**% → px cheat sheet** (`%` of width for x-axis, `%` of height for y-axis):

| % | landscape W (÷1920) | landscape H (÷1080) | portrait W (÷1080) | portrait H (÷1920) |
|---|---|---|---|---|
| 5% | 96 | 54 | 54 | 96 |
| 10% | 192 | 108 | 108 | 192 |
| 25% | 480 | 270 | 270 | 480 |
| 40% | 768 | 432 | 432 | 768 |
| 50% | 960 | 540 | 540 | 960 |

Equal % on width and height are NOT equal pixels. For true squares/circles
use `aspectRatio: "1 / 1"` and drop `height` (browser derives it).

## 2. The box (`content.style` is the ONLY geometry authority)

- Keys: `left/top/right/bottom/width/height` as **`%` strings only**
  (`"42%"`). Never `px`, never bare numbers — the saver coerces them (§5).
- Origin: **top-left**, +x right, +y down. `position` is always absolute
  (omit it; non-`absolute` values are stripped at save).
- **Anchor rule: `top` XOR `bottom`, `left` XOR `right` (prefer `left`).**
  Conversion: `left = 100 − right − width`, `top = 100 − bottom − height`.
- Lower-thirds anchor to `bottom` (e.g. `{left:"6%", bottom:"18%", width:"88%"}`).
- Center math: `left = 50 − width/2`, `top = 50 − height/2`.
- Every non-background layer MUST carry a full box. Background `children[0]`
  with no box = fullscreen. Missing boxes are filled at save
  (`CENTER_CARD_FILL {left:15%, top:16%, w:70%, h:66%}`,
  text `LOWER_THIRD_FILL {bottom:18%, left:6%, w:88%}`).
- NEVER `transform/translate/opacity/filter` in `style` (outer `transform`
  is stripped; static rotate/scale have dedicated keys, §6).
- Stacking = `children` array order (`children[0]` = bottom). No `z_index`.

## 3. Clamp table (applied at save)

| Key | Range | Floor |
|---|---|---|
| `width` / `height` | [floor, 100] | 5% (2% for Shape) |
| `left` / `top` / `right` / `bottom` | [−20, 100] | — |

Partial off-canvas (e.g. `left:-10%` slide-ins) is legal. Only *entirely*
off-canvas warns. Double anchors resolve to `left`, and to `bottom` for Text (lower-thirds
stay glued to the safe area) / `top` for every other type. Single-anchor
`bottom` lower-thirds survive untouched.

## 4. Forced fullscreen

`Map`, `Particles`, `Background` are always `100% × 100%` — any positioned
box written for them is discarded at save AND at render. `HTML` is
deliberately positionable.

## 5. Input coercion (what the saver does to sloppy input)

- Bare numbers / numeric strings `≤100` → `%`; `>100` → `px` on the
  format grid then converted to `%` (so `200` = 10.42% landscape width but
  18.52% portrait — **always write explicit `%`**; always save with the
  correct `video_format`).
- `translate(-50%,-50%)`-style transforms are folded into `left/top`
  (same-unit only); anything else is dropped.
- `transition` names fuzzy-match (`subtle_slide` → `slide_left`, else `fade`).
- `emphasis`: `at` clamped to cut duration, `scale` ∈ [1.02, 1.6],
  `duration` ∈ [0.2, 2.0].
- Cut `duration` renorm scales cut lengths only — `animations[].delay`,
  `duration`, and `emphasis.at` are NOT rescaled. Re-verify delays after
  a renorm (MCP: check `cut_durations_final`).

## 6. Transforms & motion compose

Static `rotate/scale/scaleX/scaleY` on the container **multiply** with
animator keyframes (they do not replace them). Negative `scaleX` mirrors.
`transform_origin` defaults to `center` and only matters with motion.
`borderRadius` % is clamped ≤ 50%.

## 7. Text metrics

- Boxed text defaults to `64px`; free text (no box) renders `100px`.
- Complex scripts (Devanagari, Tamil, Arabic, …) get `lineHeight 1.6` +
  `0.08em` vertical padding by default; Latin gets `1.25`. Explicit values win.
- Omit `height` on text layers (auto-height); fixed-height boxes +
  `overflow:hidden` clip descenders/matras.
- `Counter` resolves `font_size ?? fontSize ?? style.fontSize` (unlike
  Text's style-only rule).

## 8. Overflow / clipping model

Custom-layout or rounded containers clip (`overflow:hidden`); small Shape
stages (≤25% w&h) are `overflow:visible` so accent glyphs can overhang.
`words_stagger` long words wrap (`min-width:0`, `overflow-wrap`) instead of
bleeding. HTML inner CSS is NOT modeled — see §9.

## 9. HTML layers (second source of truth — constrained by contract)

`content.style` is the box; `content.html_content` is markup inside it.
The contract (enforced by lint, see skill `declarative-ast`):

- Single filler root: `width:100%;height:100%;box-sizing:border-box;overflow:hidden`.
- BANNED inside: `position:fixed`, `vw/vh/vmin` units, root `transform`
  (use `style.rotate/scale`), unscoped `<style>` (bleeds across layers),
  `<img>/<video>/<iframe>`, `src=`, `url(`, `http`, `data:`/base64.
- Fluid type only: `clamp()` / `%` — no fixed-px fonts (they don't scale
  with the `%` box, and break on portrait/4K).
- Inner `%` resolves against the **layer box**; inner `px`/`vw`/`fixed`
  resolve against the **canvas/document** — never use the latter.

## 10. Safe areas (convention — renderer does NOT enforce)

- Subtitles: keep clear `bottom:18%` landscape / `28%` portrait
  (`subtitle_position: bottom|top|hidden` overrides per cut).
- Root overlays (pill / progress / watermark) paint above all cuts.

## 11. Unified ranges (single system end to end)

Backend `schemas._clamp_percent` is the authority and every surface
matches it: sizes 5–100% (2% Shape), positions −20–100%.

- Overlay drag clamps to the same ranges (`computeDrag`) — what you drag
  is what survives the save. Move preserves the author's anchor
  (`right`/`bottom` recomputed numerically); resize commits resolved
  `left`/`top` numbers.
- Layout sliders: sizes 5–100%; positions 0–100 display (exact negatives
  via the % input or drag). Grid label follows project format.
- Agents get the normalized result echoed: every `dry_run`/persist/probe
  geometry report carries `container` + per-box `box_px {x,y,w,h}`.
- `geometry.html_warnings` flags HTML contract violations pre-save.
