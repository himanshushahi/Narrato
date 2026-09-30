---
name: visual-director-core
version: "5.0"
description: "Visual Director operational rules, production gotchas, and multi-layer depth architecture. Full capability spec: read declarative-ast."
when_to_use: "Always loaded during bulk scene visual generation, storyboarding, and visual direction."
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

---

## 2. Cut Structure & Timing Rules

- **1 Cut Per Visual Beat**: Emit multiple sub-visual cuts per scene to match narration pacing. A 9s scene typically needs 2–3 cuts.
- **Duration Math**: Sum of all `duration` fields MUST equal total scene duration exactly (2 decimal places). The validator auto-corrects minor float drift but not structural gaps.
- **Array Stacking**: `children[0]` = bottom background; `children[N-1]` = foreground. Stacking order IS the rendering order — no z_index.
- **Transition**: Set on each sub-visual, not on layers. Vary transitions across cuts in a scene (don't repeat the same transition 3× in a row).
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

Always build cuts with layered visual depth — never a single layer. Minimum 3 layers per cut:

```
Layer 3 [Top]:      Kinetic Typography (synced headline, metric callout, words_stagger)
Layer 2 [Mid-Fore]: Hero Visual (Chart, Counter, transparent cutout, animated SVG path)
Layer 1 [Mid-Back]: Atmosphere (Particles dust/embers, Shape corner_brackets, frosted card)
Layer 0 [Bottom]:   Canvas Foundation (Background shader OR darkened Video)
```

**Foundation Rules:**
- **Layer 0**: Always `Background` preset OR `Video`/`Image` with `Cinematic Dark Base` filter (`["brightness(0.35)", "contrast(1.2)"]`) + slow `scale: 1.0→1.06` drift animation.
- **Layer 1**: Use `Particles` sparingly (`opacity: 0.12–0.18`), or `Shape` with `preset_path: "corner_brackets"` for HUD framing, or a translucent frosted `Shape` card backing.
- **Layer 2**: The data/story hero: `Chart`, `Counter`, transparent `Image` (Pixabay illustration), or `Shape` path with `draw_animation: true`.
- **Layer 3**: Kinetic text with `bottom: "18%"` (landscape) or `bottom: "28%"` (portrait). Use `marker_highlight` or `words_stagger` for narrative sync.

---

## 5. Entrance Choreography Template

Use this stagger to give each layer a deliberate entrance:

```
0.0s  Background / Video enters with cut transition
0.3s  Frosted card / framing Shape springs in (scale: 0.88→1.0, spring) + opacity: 0→1
0.5s  Hero data graphic / Counter enters (translateY: 40→0, spring) + opacity: 0→1
0.8s  Kinetic headline / label reveals (words_stagger or marker_highlight)
```

For 2s cuts — compress: 0.0s base, 0.2s hero, 0.4s text.
For 5s+ cuts — expand: add a second beat using `exit:` + delayed second layer.

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

**Variety Rule**: Don't use the same recipe for consecutive cuts. Alternate energy levels: high → low → high.

---

## 7. Visual Variety Checklist Per Scene

Before submitting a scene's sub-visuals, verify:
- [ ] At least 2 different content types appear across the scene's cuts (not just Text + Background every time)
- [ ] At least 1 animation uses a non-linear easing (`spring`, `bounce`, or `elastic`) for the hero element
- [ ] Background colors/presets vary across scenes (not the same Background preset for 8 scenes)
- [ ] Transitions are varied — at least 2 different transitions across the video's cuts
- [ ] Portrait mode: geometry uses portrait layout presets (see declarative-ast §8)
