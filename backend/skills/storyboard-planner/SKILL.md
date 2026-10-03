---
name: storyboard-planner
description: "Storyboard planning: break narration into timed visual beats with explicit layouts, layer type decisions, and recipe selection guidance."
version: "4.1"
when_to_use: "Used during Stage 1 visual planning to plan timed beats before generating AST code."
---

# Storyboard Planner — Beat Planning & Layout Decisions

> **Role**: Visual Planning Engineer.
> **Mission**: Break narration into timed beats with explicit spatial layouts, type decisions, and recipe selection. Layer capabilities: `declarative-ast`. Motion recipes: `motion-graphics-designer`.

---

## 1. Plan Structure

For each scene, output a storyboard plan describing:

1. **Beat Count & Exact Durations**: sub-visual durations summing exactly to total scene duration (2 decimals).
2. **Recipe per beat**: name the recipe from `declarative-ast §7` (A–J) OR describe a custom pattern.
3. **Layer Types per beat**: list content types + approximate positions (e.g. "Background(grid_flow) + Counter(left 20%, metric) + Text(lower-third, words_stagger)").
4. **Media needs per beat**: for Image/Video, state the `query` + `source` explicitly.
5. **Transition per beat**: pick the transition that matches the energy shift.
6. **Spatial Layout per beat**: every beat line states layer types + approximate
   positions + motion phases (canvas, establish/develop/evolve/resolve), so the
   AST author never invents geometry.

**Plan format (single continuous take — the default):**
```
Scene 3 (total: 9.0s, 1 continuous take, zoom_in):
  Canvas: archive map image ("atlantic ocean vintage map") fullscreen + Archival Monochrome + scale drift 1.0→1.3 over full 9s + Particles(dust, loop)
  0.0–2.5s ESTABLISH: full map + vignette; copper route path draws (draw_animation) toward Ireland
  2.5–5.0s DEVELOP: camera pans/translates onto Ireland; depth gauge card (frosted Shape + backdrop blur) slides in from right
  5.0–7.5s EVOLVE (word-synced: "4000 meters" @5.1s, "snapped" @6.8s): gauge marker_highlight @5.1s; map grades abyssal blue; route path exits, crack reticle pulses @6.8s
  7.5–9.0s RESOLVE: callout recedes with blur; concluding headline (words_stagger) + emphasis punch @8.0s
  Media: Image(archive, "atlantic ocean vintage map") — authentic, not stock. No 2nd cut: one geography, one camera journey.
```

Multi-cut plan (only with beat-shift justification):
```
Scene 5 (total: 9.0s, 2 cuts — Cut 2 because: 1858 London → 2024 Mumbai, geography one map canvas cannot pan to):
  Cut 1 (5.0s, whip_pan): continuous take as above, ending on London callout
  Cut 2 (4.0s, dissolve): Mumbai B-roll take — Video(youtube, "mumbai coastline aerial") + gauge exit/stagger pair
```

---

## 2. Beat Count Decision Guide — One Continuous Take by Default

| Scene Duration | Recommended Cuts | Notes |
|---|---|---|
| 3–6s | 1 cut | Single continuous take: establish → evolve → resolve |
| 6–9s | 1 cut | Single continuous take with camera journey + exit/stagger pair |
| 9–12s | 1 cut (2 only on beat shift) | Prefer one 9–12s living canvas; split only for location/time/energy breaks |
| 12s+ | 1–2 cuts | One long take preferred; 2nd cut only with written justification |

**Default is 1 cut per scene.** A second cut needs a one-line justification
naming the beat shift it serves (location change, time jump, data→human pivot,
energy reset). **Never force extra cuts** — chopping a 9s thought into halves
to hit a quota resets the viewer's eye and reads as slideshow editing.

---

## 3. Layer Type Decision Guide

**What's the narrative role of this beat?**

| Beat Role | Recommended Base Layer | Hero Layer | Text Treatment |
|---|---|---|---|
| Hard data / metric | Background (blueprint or grid_flow) | Counter or Chart | words_stagger or marker_highlight |
| Action / event | Video (youtube or pexels) darkened | Particles(embers or dust) | marker_highlight, large |
| Geography / location | Map (modern_dark) | Shape(corner_brackets) | static callout |
| Human story / emotion | Image (pexels, portrait) with Golden Hour | Shape (frosted card) | marker_highlight or words_stagger |
| Tech product / demo | Video (youtube, product query) | HTML (glass spec card) | typewriter |
| Historical evidence | Image (archive) with Archival Monochrome | HTML (document card) | static |
| Abstract / science | Background (waves or gradient_mesh) | Chart or Lottie | words_stagger |
| Multiple KPIs | Background (dots or blueprint) | 3× Counter side-by-side | static label under each |
| Cause → Effect | Single cut with exit/stagger | Two Counter or Text layers (A exits, B enters) | static or words_stagger |

---

## 4. Source Provider Selection in Planning

When planning media beats, annotate each beat with the exact `query` + `source` — don't leave it to the AST author to guess.

### 4.1 Rule: Real/Specific → Authentic Providers

| What the beat is about | Image provider | Video provider |
|---|---|---|
| Real person (PM, CEO, athlete, historical figure) | `wikipedia` + exact full name | `youtube` speech/interview/event |
| Company brand / logo | `wikipedia` + exact company name | `youtube` product launch/keynote |
| Country flag / government body | `wikipedia` | `youtube` official event |
| Historical event (pre-1990, partition, WW2, independence) | `archive` archival photo | `archive` newsreel OR `youtube` documentary |
| Space / NASA / planetary science | `archive` NASA image | `archive` mission footage OR `youtube` launch |
| Tech product demo / hands-on | `pexels` device/person shot | `youtube` review/demo/keynote |
| Science concept / 3D animation | `pixabay` illustration | `youtube` 3D explanation animation |
| Sports match / tournament highlight | `pexels` stadium (generic) | `youtube` match/highlight reel |
| News broadcast / political event | `wikipedia` (person photo) | `youtube` news clip |
| Generic city / street / crowd / office | `pexels` | `pexels` |
| Nature / weather / landscape | `pexels` | `pexels` |
| Abstract concept (growth, AI, data) | `pexels` or Background shader | `pexels` or `pixabay` |
| Transparent icon / cutout badge | `pixabay` + `image_type: illustration` | — |
| Vintage / archival / documentary look | `archive` | `archive` |

### 4.2 Provider Worked Examples for Plans

```
Scene: "India's economic growth in the 1990s liberalisation era"
  Beat 1 (Image): archive → "india 1991 economic reform market"
  Beat 2 (Video): youtube → "india liberalisation 1991 documentary"

Scene: "Narendra Modi announces PLI scheme"
  Image: wikipedia → "Narendra Modi"  (exact name = real portrait)
  Video: youtube → "modi PLI scheme launch announcement"

Scene: "SpaceX Starship launch"
  Image: archive → "rocket launch NASA" OR pexels → "rocket launch flames"
  Video: youtube → "spacex starship launch 2024"  (real footage)

Scene: "Busy Mumbai street life"
  Image: pexels → "mumbai street crowded"  (generic = pexels)
  Video: pexels → "india city street traffic"

Scene: "AI / machine learning concept"
  Image: pixabay → "artificial intelligence", image_type: illustration
  Video: youtube → "neural network animation visualization"  (no real stock for this)

Scene: "Rupee / currency badge overlay"
  Image: pixabay → "rupee coin gold", image_type: illustration  (transparent PNG)

Scene: "World War 2 Pacific theatre"
  Image: archive → "world war 2 soldiers pacific"
  Video: archive → "world war 2 newsreel pacific 1945"

Scene: "IPL cricket match highlights"
  Image: pexels → "cricket stadium crowd"  (generic stadium, not real player)
  Video: youtube → "IPL 2024 cricket highlights"  (only YouTube has real match)
```

### 4.3 Anti-Patterns to Flag in Plans

```
✗ "city skyline" + youtube    → Use pexels. YouTube = real/named, not generic B-roll.
✗ "Tesla logo" + pexels       → Use wikipedia: "Tesla Inc." for brand logos.
✗ "Nehru portrait" + pexels   → Use wikipedia: "Jawaharlal Nehru" for real faces.
✗ "moon landing" + pexels     → Use archive: "apollo 11 moon surface".
✗ Image + youtube             → YouTube is Video ONLY. Never use for Image.
✗ Video + wikipedia           → Wikipedia is Image ONLY. Never use for Video.
✗ yt_duration > 30            → Pipeline truncates at 30s. Plan ≤ 30s.
✗ Query in Hindi              → All queries in English, always.
```

---

## 5. Variety Planning Rules

Across the full scene sequence:
- **Alternate energy**: high-energy beat → lower-energy beat → high-energy
- **Vary base layers**: don't use the same Background preset more than twice in a row
- **Vary transitions**: pick from different energy groups per scene
  - High energy: `whip_pan`, `glitch`, `zoom_in`, `slide_left`/`right`
  - Mid energy: `slide_up`/`down`, `zoom_out`
  - Low energy: `crossfade`, `dissolve`, `fade`
- **Vary recipes**: don't repeat the same recipe for consecutive scenes unless narration demands it
- **Mix content types**: if 3 consecutive scenes use Counter, plan a Chart or Video beat instead

---

## 6. Functional Constraints (Render-Breakers)

- Beat durations sum exactly to the scene total (no rounding).
- No static chapter title cards inside cuts (root overlays render chapters).
- Keep primary content above subtitle safe areas: `18%` landscape, `28%` portrait.
- Map and Particles cannot be positioned — plan overlay Shapes/Text on top.
- YouTube clips max 30s — plan accordingly for the beat duration.
- `content.type` MUST be set on every layer — note it in the plan for the AST author.

---

## 7. Pre-Flight Checklist

- [ ] Beat durations sum exactly to scene total
- [ ] Every beat has a named recipe or explicit type layout
- [ ] Media beats specify query + source
- [ ] No chapter title cards planned inside cuts
- [ ] Layouts are explicit per beat (types + positions + motion described)
- [ ] Variety rules satisfied (transitions, base layers, recipes varied)
