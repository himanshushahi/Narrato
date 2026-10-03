---
name: editor-qa
version: "4.0"
description: "Quality assurance checklist: production failure modes, duration math, AST structure, and rendering guardrails. Read before finalizing any visual output."
when_to_use: "Before finalizing any edit — scene rewrites, visual regenerations, reorders, duration changes."
---

# Editor Quality Assurance — Production Guardrails

> **Role**: Quality Assurance Lead & Video Integrity Auditor
> **Mission**: Enforce editorial, mathematical, rendering, and linguistic guardrails across all output.

---

## 1. Critical Production Failure Modes (Real Breaks)

These are the actual failure modes observed in production — check all before submitting:

| # | Failure | Symptom | Fix |
|---|---|---|---|
| **F1** | `content.type` missing on a Layer | Entire scene renders null — no error, just blank | **ALWAYS** set `type` field inside every `content` object |
| **F2** | Image/Video layer without `query` | Pipeline cannot download asset → broken cut | Every Image/Video MUST have `query: "1-3 english keywords"` |
| **F3** | `Map` or `Particles` with position/size | Position is silently ignored → always fullscreen | Don't position Map/Particles; overlay Shape/Text on top |
| **F4** | Wrong source for type | `youtube` for Image = no asset; `wikipedia` for Video = no asset | See source matrix: wikipedia=Image only, youtube=Video only |
| **F5** | `youtube` clip duration > 30s | Pipeline truncates — clip ends abruptly | Keep `yt_duration ≤ 30`. Default is 15s. |
| **F6** | Duration sum ≠ scene duration | Validator auto-corrects minor float drift; structural gaps = broken timing | Recalculate. Sum of all `duration` must match exactly (2 decimal places). |
| **F7** | Chapter title badge inside cut | Flashes in 2–4s, looks broken | NEVER. Root overlays render chapter pills continuously. |
| **F8** | `transform` CSS in `style` | Engine strips it; layer renders outside its box with no fix | Use `animations[]` for motion; `rotate`/`scale`/`rotateX` for static 3D |
| **F9** | Entrance with `delay > 0`, no opacity pair | Element pops in at full opacity at wrong time | Pair every entrance with `{ "property": "opacity", "from": 0, "to": 1, "delay": same }` |
| **F10** | Kinetic text below subtitle safe area | Text and subtitle overlap | Keep text above `bottom: 18%` (landscape) or `bottom: 28%` (portrait) |
| **F11** | Raw `px` in geometry | Ingest normalizes to `%` but may drift | Use `%` strings directly: `"left": "15%"` not `"left": 288` |
| **F12** | `top` AND `bottom` both set | Engine resolves conflict (Text keeps bottom, others keep top) | Set only ONE vertical anchor. Use `bottom` for lower-thirds. |
| **F13** | `style` placed inside `content` | Box geometry ignored; layer renders at default position | `style` goes on the **Layer node** as sibling of `content`, not inside `content` |
| **F14** | `sources[]` array instead of query | Validator tries to hoist but may fail silently | Output `query` + `source` directly, never `sources[]` array |

---

## 2. Core Validation Rules

| Rule | Domain | Requirement |
|---|---|---|
| **1** | Narrative Integrity | Rewritten segments connect seamlessly with surrounding scenes. No contradiction with established facts. |
| **2** | Language & CTL Shaping | Spoken text in native script. Noto fonts for complex scripts (`Noto Sans Devanagari` etc.). NEVER Latin display fonts for non-Latin languages. |
| **3** | Duration Math | Sub-visual durations sum EXACTLY to scene duration (2 decimal places). |
| **4** | AST Primitives | Only 11 valid types: `Text`, `Counter`, `Shape`, `Chart`, `Background`, `Image`, `Video`, `Lottie`, `Particles`, `Map`, `HTML`. No invented types. |
| **5** | Stacking & Layer Order | `children[0]` = bottom background. `children[N-1]` = top foreground. Subtitle safe area respected. |
| **6** | Preserve Untouched | On targeted edits, non-targeted scenes and fields stay byte-identical. |
| **7** | Opacity Fade on Entrance | Every entrance animation with `delay > 0` MUST pair with matching `opacity: 0→1`. |
| **8** | Harness Reports | Read `timing`/`variety` reports on every save and apply their fixes (delay-fit, enum remaps). |
| **9** | Layer Count (No Quota) | Use as many layers as the beat needs — usually a rich stack. Every layer earns its place (clear job + motion); never stack blindly, never ship a single bare layer (Background alone = unfinished). |
| **10** | Variety | Don't use the same Background preset, transition, or composition recipe for consecutive cuts across the whole video. |

---

## 3. Source Provider Validation

**Core rule**: Real/specific/named things → authentic providers. Generic/atmospheric → stock providers.

```
Image-only sources:   pexels ✓   pixabay ✓   wikipedia ✓   archive ✓   youtube ✗
Video-only sources:   pexels ✓   pixabay ✓   wikipedia ✗   archive ✓   youtube ✓
```

| If the scene shows... | Correct Image Source | Correct Video Source |
|---|---|---|
| Real person (politician, CEO, athlete, scientist) | `wikipedia` (exact full name) | `youtube` (speech/event) |
| Brand logo / company symbol | `wikipedia` (exact company name) | `youtube` (launch/keynote) |
| Historical event (pre-1990, WW2, independence) | `archive` | `archive` OR `youtube` documentary |
| Space / NASA / planetary | `archive` | `archive` OR `youtube` launch |
| Tech product demo | `pexels` device shot | `youtube` demo/review |
| Science concept / 3D animation | `pixabay` illustration | `youtube` animation |
| Sports match (real footage) | `pexels` stadium (generic) | `youtube` match highlight |
| Generic city / crowd / nature | `pexels` | `pexels` |
| Transparent cutout badge | `pixabay` + `image_type: illustration` | — |

**Source anti-patterns to catch:**
- `Image + youtube` → REJECT: YouTube is Video only
- `Video + wikipedia` → REJECT: Wikipedia is Image only
- `"city skyline" + youtube` → REJECT: generic B-roll belongs in pexels
- `"Modi portrait" + pexels` → REJECT: real person needs wikipedia
- `"moon landing" + pexels` → REJECT: historical event needs archive
- Query in Hindi/regional language → REJECT: all queries must be English

---

## 4. Pre-Submission Checklist

- [ ] Every Layer's `content` has a `type` field (F1)
- [ ] Every Image/Video has `query` in English (F2)
- [ ] Map/Particles are not being positioned (F3)
- [ ] Source types match their allowed media type (F4)
- [ ] YouTube clips: `yt_duration ≤ 30` (F5)
- [ ] Duration sum matches scene total exactly (F6)
- [ ] No static chapter title text inside cuts (F7)
- [ ] No `transform` key in `style` (F8)
- [ ] Every entrance with `delay > 0` pairs with `opacity: 0→1` (F9)
- [ ] Lower-thirds above `bottom: 18%` (landscape) / `bottom: 28%` (portrait) (F10)
- [ ] Geometry uses `%` strings only (F11)
- [ ] Only one vertical anchor per layer: `top` OR `bottom`, not both (F12)
- [ ] `style` box is on the Layer node, not inside `content` (F13)
- [ ] No `sources[]` array — use `query` + `source` (F14)
- [ ] Spoken text in correct native script (no transliterations)
- [ ] Complex scripts use Noto fonts
- [ ] No markdown/backticks wrapping the JSON output
- [ ] Rich purposeful layering — every layer earns its place, no single bare layer, no blind stacking
