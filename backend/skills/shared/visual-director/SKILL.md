---
name: visual-director-core
version: "5.1"
description: "Visual Director operational rules, production gotchas, and multi-layer depth architecture. Full capability spec: read declarative-ast."
when_to_use: "Always loaded during bulk scene visual generation, storyboarding, and visual direction."
exposure: agent
---

# Visual Director Core — Operational Rules & Gotchas

> **Role**: Lead Visual Director & Motion Systems Engineer.
> **Mission**: Emit valid, renderable AST cuts from the 11 layer types.
> **Full capability spec is in `declarative-ast`** — read it first. This file contains operational rules, production gotchas, and compositing architecture you MUST apply.

---

## 1. Mandatory Pre-Flight Checks

Before generating any visual output, verify:

- [ ] `content.type` is set on every Layer — **missing it makes the entire scene null**
- [ ] Every Image/Video layer has a `query` field — no query = broken cut, no download
- [ ] `sub_visual.duration` values sum exactly to total scene duration (2 decimal places)
- [ ] No chapter title cards inside cuts (root overlays handle chapter pills continuously)
- [ ] Key content is above subtitle safe areas: `bottom: 18%` (landscape) / `bottom: 28%` (portrait)
- [ ] Every entrance with `delay > 0` pairs with `opacity: 0→1` at the same delay
- [ ] Visual Style: Pick 1 style per scene from `visual-style-library` (max 2–3 per video); bind colors/fonts to `design.json` tokens

---

## 1.5. Visual Style Selection & The 50-Style Library

Pull looks from `visual-style-library` (50 styles across 5 families: editorial, cinematic, 3d, tech, organic).
- **Rule**: Pick **ONE style per scene**, max 2–3 distinct styles per video.
- **AST Mapping**: Map the style's primitives:
  - `base` = Layer 0 (background/texture)
  - `hero` = Layer 2 (main visual/data/media)
  - `text` = Layer 3 (keyword stagger/headline)
  - `filters` = layer filters (e.g. `noir_hard`, `paper_grain`, `cyberpunk`)
  - `transitions` = cut transition family
- **Tokens**: Bind style colors/fonts to `design.json` tokens (`primary`, `secondary`, `accent`, `heading_font`, `body_font`) — never invent disconnected hex colors.
- **Querying**: Use `get_skill('visual-style-library', section='<slug_or_family>')` (e.g. section='cybersecurity-hud' or section='tech') to inspect the exact layer recipe and transition family.

---

## 2. Cut Structure & Timing Rules — Single Take First

**Default: ONE continuous cut per scene.** A scene is one living canvas whose
camera and layers evolve across the full narration — not a slideshow of
mini-cuts. Chopping a 9s thought into two arbitrary 4.5s halves resets the
viewer's eye, kills momentum, and reads as amateur editing.

- **1 scene = 1 continuous take** (up to ~12s): choreograph camera drift,
  exit/stagger beats, word-synced reveals, and continuous ambient motion
  *inside* the single cut (see `declarative-ast` §6.5 and
  `motion-graphics-designer` §3.5). Aim to keep the canvas alive for the whole
  duration — a canvas frozen after the first second reads as a still image;
  deliberate holds need a one-line reason in the beat plan.
- **A 2nd cut only on a genuine beat shift**: location change, time jump,
  data→human pivot, or energy reset the single canvas cannot absorb. Default
  to 1 cut; when a 2nd is needed, note the beat shift in one line in the beat
  plan ("Cut 2 because: 1858 London → 2024 Mumbai — geography the map canvas
  cannot pan to").
- **Duration Math**: Sum of all `duration` fields MUST equal total scene duration exactly (2 decimal places). The validator auto-corrects minor float drift but not structural gaps.
- **Array Stacking**: `children[0]` = bottom background; `children[N-1]` = foreground. Stacking order IS the rendering order — no z_index.
- **Transition**: Set on each sub-visual, not on layers. Vary transitions across cuts in a scene (avoid repeating the same transition twice in a row). `"exit_transition"` (same effects, reverse over final frames) — use sparingly, a few per video on beat ends/section closers; never on consecutive cuts.
- **Mid-Cut Punch-Ins**: `"emphasis": [{"at": 1.2, "scale": 1.15, "duration": 0.5}]` — use on hero reveal moments.
- **Audio Ducking**: `"mute_voiceover": true` (dramatic pause) | `"mute_bg_music": true` (testimony/silence emphasis).

---

## 3. Production Gotchas (Real Failure Modes)

| Gotcha | What Breaks | Fix |
|---|---|---|
| `content.type` missing | Entire scene renders null | **ALWAYS** set `type` on every `content` object |
| `Map`/`Particles` positioned | Positioning ignored — always fullscreen | Use overlay Shape/Text on top for framing |
| `Background` dimmed via size | Can't reposition/resize | Use darker `colors` array or overlay Shape with opacity |
| Image source = `youtube` | No asset — youtube is Video only | Use `pexels`/`pixabay`/`wikipedia`/`archive` for Image |
| Video source = `wikipedia` | No asset — wikipedia is Image only | Use `pexels`/`youtube`/`archive` for Video |
| Real person face from `pexels` | Stock actor, not the actual person | Use `wikipedia` with exact full name for real portraits |
| Brand logo from `pexels` | Generic or wrong logo | Use `wikipedia` with exact company name |
| Historical event from `pexels` | Stock photo, not archival | Use `archive` for pre-1990 events; `youtube` for documentary |
| Generic B-roll from `youtube` | Wastes yt_duration budget | Use `pexels`/`pixabay` for cityscapes, nature, generic office |
| `transform` in `style` | Stripped by engine, overlay loses sync | Use `animations` for motion, `rotate`/`scale` in style for static |
| `top` + `bottom` both set on Text | Engine keeps `bottom` (lower-third wins) | Set only `bottom` for lower-thirds |
| Raw `px` in geometry | Normalized to % at ingest (may drift) | Use `%` strings from the start |
| Image/Video without `query` | HARD REJECTION from validator | Always set `query: "1-3 english keywords"` |
| Chapter title inside cut | Flashes and vanishes (2-4s cuts) | Never do this — root overlays own chapter pills |
| `youtube` clip > 30s | Pipeline truncates to 30s | Set `yt_duration` ≤ 30, default is 15s |
| Query in Hindi/regional language | Search returns 0 results | Queries MUST be English regardless of video language |

---

## 4. Multi-Layer Compositing Architecture

Build cuts with layered visual depth — no fixed quota. Use as many layers as
the beat needs (usually a rich stack, not a bare one), and make every layer
earn its place: a clear visual job plus motion alive past the take's midpoint.
Six dead layers are worse than three living ones. Typical depth roles:

```
Layer 3 [Top]:      Kinetic Typography (synced headline, metric callout, words_stagger)
Layer 2 [Mid-Fore]: Hero Visual (Chart, Counter, transparent cutout, animated SVG path)
Layer 1 [Mid-Back]: Atmosphere (Particles dust/embers, Shape corner_brackets, frosted card)
Layer 0 [Bottom]:   Canvas Foundation (Background shader OR darkened Video)
```

**Foundation Rules:**
- **Layer 0**: Typically a `Background` preset OR `Video`/`Image` with `Cinematic Dark Base` filter (`"cinematic_dark_base"` or `["brightness(0.35)", "contrast(1.2)"]`) + slow `scale: 1.0→1.06` drift animation.
- **Layer 1**: Use `Particles` sparingly (`opacity: 0.12–0.18`), or `Shape` with `preset_path: "corner_brackets"` for HUD framing, or a translucent frosted `Shape` card backing.
- **Layer 2**: The data/story hero: `Chart`, `Counter`, authentic evidence
  (`archive` photo/document, `Map` with drawn route, real `Video`), transparent
  `Image` (Pixabay illustration), or `Shape` path with `draw_animation: true`.
  Lucide icons read as small accents (badges, bullets) — avoid a lone centered
  icon as the hero of a documentary beat; prefer authentic evidence there.
- **Layer 3**: Kinetic text with `bottom: "18%"` (landscape) or `bottom: "28%"` (portrait). Use `marker_highlight` or `words_stagger` for narrative sync.

---

## 5. Entrance Choreography Template — Continuous-Take Phases

A single take evolves in four phases across its FULL duration. For a 9s cut:

```
0.0–2.5s  ESTABLISH: base canvas enters with the cut transition
          (map / archive image / B-roll with slow scale drift 1.0→1.3
          spanning the whole 9s, not 5s). Ambient loop starts (particles /
          floating hero) so the frame breathes from frame one.
2.5–5.0s  DEVELOP: camera moves INTO the story — pan/zoom toward the
          subject (translateX drift + scale), an SVG path draws
          (draw_animation) along the journey, supporting evidence fades in.
5.0–7.5s  EVOLVE: timed to the narration's key spoken words (use the
          transcription word timestamps for delay values, not 0.3s
          defaults) — a frosted card / gauge / document slides in, a
          marker_highlight sweeps the headline, a Counter lands on the
          exact number word. Earlier layers exit (exit:) to free space.
7.5–9.5s  RESOLVE: motion eases, not freezes — depth-of-field blur settles,
          the callout recedes, the concluding headline reveals. An
          emphasis punch-in or slow push-in carries the eye INTO the next cut.
```

For 4s cuts — compress: establish 0–1s, develop 1–2.5s, evolve+resolve 2.5–4s.
For 12s cuts — expand the DEVELOP phase (longer camera journey) and add a
second exit/stagger pair in EVOLVE.

### Anti-patterns (what makes visuals look 10 years old)

- **Frozen tail**: all animations start at delay 0.2–0.8s and finish by ~1s,
  leaving the rest of the cut static. Aim for motion alive past the midpoint —
  a camera drift spanning full duration, a loop_mode ambient, an exit/stagger
  beat, or an emphasis punch-in. A deliberate still hold (testimony, memorial)
  is fine with a one-line reason in the beat plan.
- **Bouncing center icon**: a generic Lucide icon (anchor, zap, lock, globe)
  springing in the dead center as the "hero" of a serious documentary beat.
  Icons work as accents; heroes read stronger as authentic evidence: archival
  photos, maps with drawn routes, documents, charts, real footage — composed as
  collages / split-screens, not lone centered badges.
- **Arbitrary delays**: hardcoding 0.3s / 0.5s delays when word-level
  transcription timestamps exist. Prefer binding key reveals to the spoken
  word time (delay = word_start − cut_start) — a highlight that fires well
  before the narrator says the word looks broken. For short cuts without
  timestamps, plain 0.3s staggers are fine.
- **Quota chopping**: splitting a scene into N cuts to hit a number instead of
  because the story beats demand it. One continuous take is the default.

---

## 6. Media Provider Quick-Pick

**Rule**: Real & specific → authentic providers. Generic & atmospheric → stock providers.

| Subject Type | Image | Video |
|---|---|---|
| Real person (politician, CEO, athlete, scientist) | `wikipedia` exact full name | `youtube` speech/event |
| Brand logo / company symbol | `wikipedia` exact company name | `youtube` product launch |
| Country flag / govt institution | `wikipedia` | `youtube` official event |
| Historical event (pre-1990) | `archive` | `archive` newsreel or `youtube` doc |
| Space / NASA / planetary | `archive` NASA photos | `archive` mission video or `youtube` launch |
| Tech product hands-on demo | `pexels` device shot | `youtube` demo/review/keynote |
| Science concept / 3D animation | `pixabay` illustration | `youtube` science animation |
| Sports match / tournament | `pexels` stadium (generic) | `youtube` match highlight |
| Financial market / economy news | `pexels` trading floor | `youtube` news broadcast |
| Generic city / street / crowd | `pexels` | `pexels` |
| Nature / landscape / weather | `pexels` | `pexels` |
| Abstract / conceptual B-roll | `pexels` or Background shader | `pexels` or `pixabay` |
| Transparent icon / badge cutout | `pixabay` + `image_type: illustration` | — |
| Vintage / retro / documentary | `archive` | `archive` |

**Anti-patterns** (common mistakes):
- `"city skyline" + youtube` → `pexels`. YouTube is for real/named content, not generic B-roll.
- `"Tesla logo" + pexels` → `wikipedia: "Tesla Inc."`. Logos need exact entity names.
- `"Nehru portrait" + pexels` → `wikipedia: "Jawaharlal Nehru"`. Real faces need Wikipedia.
- `"moon landing" + pexels` → `archive: "apollo 11"`. History needs archive.

---

## 7. Named Recipes Quick-Pick

See `declarative-ast` §7 for full AST skeletons. Pick by narrative beat:

| Narrative Beat | Recipe |
|---|---|
| Revenue / metric / statistic | Recipe A: "Data Drop" |
| Action scene / news event | Recipe B: "Cinematic B-Roll Drop" |
| Trend chart / comparison | Recipe C: "Infographic Reveal" |
| Geography / location | Recipe D: "Map Story" |
| Human story / emotion | Recipe E: "Emotional Moment" |
| Product demo / tech reveal | Recipe F: "Tech/Product Demo" |
| Multiple related KPIs | Recipe G: "Statistics Grid" |
| Historical evidence | Recipe H: "Historical Archive" |
| Two-beat fact in one cut | Recipe I: "Exit Stagger Beat" |
| 3D dimensional visual | Recipe J: "3D Depth Card" |

**Variety Rule**: Don't use the same recipe for consecutive cuts. Alternate energy levels: high → low → high. Study the Viral Kit (declarative-ast §7 Recipes K–R + Craft Notes) so CTA, proof, and timeline beats start from solved patterns — adapt freely or invent when the beat has a better idea.

---

## 8. Visual Variety Checklist Per Scene

Before submitting a scene's sub-visuals, verify:
- [ ] At least 2 different content types appear across the scene's cuts (not just Text + Background every time)
- [ ] At least 1 animation uses a non-linear easing (`spring`, `bounce`, or `elastic`) for the hero element
- [ ] Background colors/presets vary across scenes (not the same Background preset for 8 scenes)
- [ ] Transitions are varied — at least 2 different transitions across the video's cuts
- [ ] Cuts show craft: layered with jobs, staggered entrances, motion through the cut, a closer, intentional grade (see Craft Notes) — centered single-card cuts need a stated reason
- [ ] Portrait mode: geometry uses portrait layout presets (see declarative-ast §8)
