---
name: storyboard-planner
description: "Storyboard planning: break narration into timed visual beats with explicit layouts, layer type decisions, and recipe selection guidance."
version: "4.0"
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

**Plan format:**
```
Scene 3 (total: 9.0s):
  Beat 1 (3.5s, zoom_in): Recipe A "Data Drop" — Counter($450M) + frosted Shape card + Text(words_stagger, lower-third)
    Media: none (Background: grid_flow)
  Beat 2 (3.5s, whip_pan): Recipe B "Cinematic B-Roll" — Video(youtube, "tesla factory robots") darkened + Particles(embers) + Text(marker_highlight, headline)
  Beat 3 (2.0s, slide_left): Recipe C "Infographic Reveal" — Background(waves) + Chart(bar, "quarterly growth") + Text(typewriter, label)
```

---

## 2. Beat Count Decision Guide

| Scene Duration | Recommended Cuts | Notes |
|---|---|---|
| 3–5s | 1 cut | Single strong visual beat |
| 6–9s | 2 cuts | Main beat + supporting beat |
| 9–12s | 2–3 cuts | Standard scene: 3 acts (intro, data, cta) |
| 12s+ | 3–4 cuts | Full narrative arc within scene |

**Never force extra cuts** — a 4s scene with 3 cuts means each cut is ~1.3s. Too short for animations to land.

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
