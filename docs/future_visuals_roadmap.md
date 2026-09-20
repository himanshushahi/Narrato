# Visual Layers Roadmap — Current, Upgrades, New & Advanced Panel

> This is the single backlog for all visual-layer work. Old Tier 2/3 content was
> removed — tiers are replaced by priority lanes below.
> Per-type implementation checklist lives in `docs/visual_type_implementation.md`
> (renderer → `ASTRenderer.tsx` → `AstGraphicalEditor.tsx` → `VideoTrack.tsx` badge
> → `backend/pipeline/ai.py` schema+prompts → skills → `npm run build:remotion`).

Legend: `✅ shipped` · `🔧 upgrade needed` · `🆕 to implement` · `💡 proposed`

Conventions every item must follow:
- New AST content types: extend `ASTLayerContent` in
  `frontend/src/components/video/ASTRenderer.tsx`, add a dispatcher branch, a form
  block in `AstGraphicalEditor.tsx` (type option + `changeType` defaults), a
  `VideoTrack.tsx` badge, `LAYER_CONTENT_SCHEMA` + `visuals_system_prompt` in
  `backend/pipeline/ai.py`, and docs in `declarative-ast` + `visual-director` +
  `editor-qa` (+ `storyboard-planner` / `motion-graphics-designer` where relevant).
- Procedural layers (no stock query/file) need NO `pipeline/assets.py` change —
  only `Image`/`Video`-backed types touch the asset downloader.
- Verify with `npx tsc --noEmit` (frontend) and `pytest tests/ -q` (backend).

---

## 1. Layers we already have (11) + required upgrades

| # | Type | File | Status | Upgrades needed |
|---|------|------|--------|-----------------|
| 1 | `Image` | `ASTRenderer.tsx` → `MediaNode` | ✅ | 🔧 Ken Burns presets (zoom-in/out, pan L/R) as one-click animation presets; grayscale→color reveal; cutout `drop-shadow` toggle. |
| 2 | `Video` | `ASTRenderer.tsx` → `MediaNode` | ✅ | 🔧 Speed control (`playbackRate`), `loop` editor UI, poster/freeze-last-frame toggle, volume fade (for ambient beds). |
| 3 | `Text` | `KineticText.tsx` | ✅ | 🔧 Preset library (lower-third slide-in, quote typewriter, TikTok word-pop); per-word colors; stroke/outline + background-pill options. See §3 — several of these land as presets, not schema. |
| 4 | `Chart` | `ChartRenderer.tsx` (`bar\|line\|pie\|donut\|progress`) | ✅🔧 | 🔧 Add `area`, `horizontal_bar`, `stacked_bar`, `gauge/radial`; value formatting (`%, $, M/B`); axis labels + target-line. Highest data-storytelling ROI after Counter. |
| 5 | `Shape` | `ShapeRenderer.tsx` (`rectangle\|circle\|star\|triangle\|arrow\|polygon\|path\|icon`, Lucide via `DynamicIcon.tsx`) | ✅ | 🔧 More `preset_path`s (bracket zoom-box, underline swoosh, double-arrow, dashed route); arrow-head styles; icon + label combo preset (callout). |
| 6 | `Lottie` | `LottieRenderer.tsx` (`@remotion/lottie`) | ✅ | 🔧 Curated URL preset gallery (arrows, checkmarks, alerts, confetti bursts) so AI/editors stop pasting dead CDN links; segment play (`from/to` frames). |
| 7 | `Map` | `DataVisualizations.tsx` (d3-geo + `world-110m.json`) | ✅🔧 | 🔧 Zoom-to-region animation; sequential callouts (one label at a time, fade previous); route draw + pulsing markers; choropleth fill (`values` per country); more `map_style`s (satellite-dark, paper). |
| 8 | `HTML` | `ASTRenderer.tsx` (`dangerouslySetInnerHTML`) | ✅ | 🔧 Do NOT extend — shrink it. Every pattern below that is hand-written HTML today (memo, chat, KPI card, table) should graduate to a typed layer (§2). Keep `HTML` as escape hatch + add snippet library (memo, chat, KPI, newspaper) in `AstHtmlCodeEditor`. |
| 9 | `Particles` | `ParticlesRenderer.tsx` (`confetti\|embers\|dust\|money_rain\|snow\|stars`) | ✅ | 🔧 New presets: `rain`, `sparks_rise`, `fireflies`, `matrix_glyphs`; emitter zone control (top/full/edges); gust direction keyframe. Rule stays: max ONE per cut, topmost. |
| 10 | `Counter` | `CounterRenderer.tsx` (`standard\|compact\|currency\|percent`) | ✅ | 🔧 Add radial circular progress ring option; custom gradient text fill; ease curve selector. |
| 11 | `Background` | `BackgroundRenderer.tsx` (`gradient_mesh\|grid_flow\|waves\|dots\|blueprint\|vignette_loop\|paper_grain`) | ✅ | 🔧 Additional shader presets (`aurora`, `matrix_rain`, `cyber_lines`); subtle audio-reactive pulse integration. |

Global renderer upgrades (apply to all layers, not a type):
- `🔧 GIF support` — treat `.gif` as first-class in `MediaNode`/`inferMediaType` (looping reaction clips, memes). Tiny change, big energy payoff.
- `🔧 Aspect handling` — `objectFit: cover|contain|fill` already in style box; expose as dropdown for media layers instead of JSON-only.

---

## 2. New visual layers to implement (priority order)

### P0 — Remaining Next Steps (pure React/CSS/SVG, no assets, no new deps)

- [x] **`Counter`** (Shipped ✅ in `frontend/src/components/video/CounterRenderer.tsx`) — Animated count-up with tabular numerals, prefix/suffix, format presets, and spring pop finish.
- [x] **`Background`** (Shipped ✅ in `frontend/src/components/video/BackgroundRenderer.tsx`) — Procedural kinetic canvas with 7 presets, custom speed, and color palettes.

1. `🆕 Timeline` — milestone track, horizontal or vertical, glowing nodes.
   Props: `events[{date, title, desc?, color?}], orientation, progress (0-1 animated)`.
   Why: the second Vox workhorse after maps; turns abstract history into something
   the eye can follow.
2. `🆕 Quote / LowerThird` — nameplate + pull-quote card.
   Props: `name?, role?, quote?, avatar_query?, style_variant (bar|card|minimal)`.
   Replaces the most common `Text`+`HTML` hand-composition; slide-in-from-left entry.
3. `🆕 CodeBlock` — syntax-highlighted snippet card (template already in
   `visual_type_implementation.md §4`). `highlight.js` is already a dependency —
   wire it into a renderer instead of only the JSON editor.
   Props: `code, language, title?, theme (dark|neon|matrix), show_line_numbers?`.
4. `🆕 Table / Versus` — comparison table, Pros/Cons, `A vs B` split card.
   Props: `headers[], rows[][], highlight_row?, variant (table|pros_cons|versus)`.
   `Chart` covers distributions; tables cover rankings, specs, verdicts.

### P1 — next (small asset or composition work)

7. `🆕 Mockup` — `browser | phone | tweet | youtube | newspaper | document`.
   Props: `mockup_kind, url_or_handle?, title, body, image_local_path?`.
   Graduates today's hand-written HTML evidence cards into typed, AI-safe layers
   with real GUI fields. `tweet`/`newspaper` first (crime/finance docs use them most).
8. `🆕 Ticker` — marquee tape (stocks, crypto, headlines).
   Props: `items[], speed, direction, separator`.
   Cheap infinite loop; huge finance-video feel.
9. `🆕 Terminal` — CLI window with typed commands + blinking cursor.
   Props: `lines[], prompt?, theme`. Pairs with `CodeBlock` for hacking/cyber beats.
10. `🆕 BeforeAfter / SplitScreen / PIP` — swipe slider, 2-up split, talking-head inset.
    Props: `before_local_path?, after_local_path?, split (0-100, animated), label_left?, label_right?`.
    Uses existing `MediaNode`s inside one renderer — no new fetch logic.
11. `🆕 AudioWaveform` — bars synced to `frame` for podcast/clip/listener moments.
    Props: `bar_count, color, style (bars|line|mirror), progress?`.

### P2 — later (heavy: new deps, 3D, or scope risk)

12. `💡 Three3D` (`@remotion/three` + React Three Fiber) — 4–5 curated presets only:
    spinning globe, 3D bar chart on floor, rotating product shot, extruded 3D title,
    orbiting coins. Props: `three_preset, three_config (colors, speed, angle)`.
    Rules: quality-gated (export time rises — reuse the Settings quality-toggle
    pattern), max 1 per scene, never behind kinetic text.
13. `💡 Avatar / TalkingHead` — static presenter cutout with subtle bob + lip-sync-ish
    bounce. Needs cutout asset UX first — defer until `Mockup`/`PIP` land.
14. `💡 Mermaid/Diagram` — flowchart/org-chart renderer. Defer — `Shape:path` +
    `HTML` snippets cover 80% today; revisit if AI keeps emitting diagrams.

### Deliberately NOT new layers (do as presets / editor UX instead)

- Callout arrows, `VS` badges, stat popups, CTA end-cards → preset gallery composing
  existing `Shape` + `Text` (no renderer, no schema). Gallery inserts a ready-made
  layer pair with one click.
- New chart variants that are pure styling (`neon` theme) → `ChartRenderer` props,
  not a type.

---

## 3. Advanced panel — non-layer features (`AstGraphicalEditor.tsx:1654`)

The collapsible `Advanced (Layout, Animations, Filters & Motion FX)` section already
has 4 tabs (`layout | animations | filters | motion`, see `AstGraphicalEditor.tsx:1666`).
These items add editor power WITHOUT new AST content types.

### Layout tab (`AstLayoutControls.tsx`) — has presets + coords + transform

Have: Fullscreen, Center Card, Left/Right Split, Lower Third, Top Header presets.
Add:
- [ ] More presets: `Top-Left inset (PIP)`, `Right-rail card`, `Bottom banner (above subtitles)`, `Circle crop (avatar)`, `2-up left/right snap`.
- [ ] Snap-to-grid + alignment buttons (center H/V, snap thirds) and safe-area guides toggle (subtitle 15% landscape / 25% portrait already in skill docs — show them visually).
- [ ] `objectFit` dropdown (`cover|contain|fill`) for media layers; `aspectRatio` quick chips (`16/9, 1/1, 9/16, 4/3`).
- [ ] Per-type `dimensionsNote`/`transformNote` coverage is via `layerCapabilities.ts` — extend notes when P0 layers land (e.g. Timeline crops like Map if shrunk).

### Animations tab (`AstAnimationBuilder.tsx`) — has 9 props + 5 presets

Has props: `translateX/Y, scale, opacity, rotate, rotateX/Y, blur, brightness`.
Has presets: Spring Pop In, Parallax Drift, 3D Card Flip, Rack Focus In, Zoom Punch.
Add:
- [ ] Entrance/exit split (enter spring + fast sharp exit — the Vox rhythm: soft ease-out in, faster out).
- [ ] Delay/stagger controls per keyframe + `loop` toggle for ambient drift (scale 1.0→1.06 infinite).
- [ ] Path-move preset (translate along `preset_path` curve) reusing `Shape` path defs.
- [ ] Copy/paste animations across layers (buttons, clipboard in `useEditorStore`).

### Filters tab (`AstFilterControls.tsx`) — has 2026 FX pack + blend modes

Has: Cinematic Dark Base, Archival Mono, Vintage Sepia, Neon Glow Pop, Cyberpunk,
Golden Hour, Bleach/Night-Vision/Thermal/Noir/Dream + SVG `url(#fx-*)` looks + 10 blend modes.
Add:
- [ ] Filter intensity sliders (each preset = filters + amounts; editing amount rewrites the `brightness(x)` number inline).
- [ ] Before/after preview toggle (bypass `filterStyle` one click).
- [ ] LUT-style save/load: "Save current stack as custom preset" (localStorage, per project).
- [ ] Per-layer-type guardrails already via `disableSvgLooks` (Particles) — add for new transparent-canvas types (Ticker, Waveform).

### Motion FX tab (motion_blur + shutter + floating + camera_shake)

Has: `motion_blur`, `shutter_angle 45–360`, `floating`, `camera_shake (handheld|shockwave|glitch)`, `transform_origin` — with `getMotionState()` gating in `layerCapabilities.ts`.
Add:
- [ ] Punch-in `emphasis` editor (sub-visual-level `[{at, scale, duration}]`, 0–2 per cut) — currently JSON-only; needs a mini UI (mark list + "place at playhead" button).
- [ ] Shake intensity + duration controls (currently fixed presets in `CameraNoise.ts`).
- [ ] Motion-blur quality note already exists via render-quality policy — surface it (blur is export-gated, preview-safe).

---

## 4. Cross-cutting (not a layer, not a tab — do alongside)

- [ ] Transitions expansion: `@remotion/transitions:4.0.469` is installed but prompts only teach `fade/slide/zoom`. Expose `wipe, clockWipe, flip, iris` in the cut `transition` enum + skill docs.
- [ ] Caption styles v2: TikTok word-pop + paper-cutout + karaoke fill on top of existing `KineticSubtitles.tsx` (2026 trend: type IS the visual).
- [ ] SFX lane: whoosh/pop/click/riser pack, auto-attach whoosh on transitions + pop on chart bars; timeline lane with volume (FFmpeg mix path already exists).
- [ ] Vertical 9:16 auto-reframe: portrait + square format setting, safe-zone guides, center-crop wrapper (doubles Shorts/Reels/TikTok surface).
- [ ] Brand kit: per-project fonts/palette/logo/outro + one-click recolor (builds on `design.json` tokens).
- [ ] Beat-sync: beat detection → timeline markers → "cut on beats" + auto-duck voiceover.

### Out of scope (deliberate)

- Full keyframe graph editor (After Effects clone) — fights the AI-first AST model; presets + emphasis cover ~90%.
- Real-time collaboration/comments — infra-heavy, zero visual payoff.
- Cloud/Lambda rendering — only if the local GPU queue bottlenecks.
