---
name: editor-qa
version: "2.0"
description: "Quality assurance checklist and validation guardrails for script rewrites, visual regenerations, duration integrity, and AST structure."
when_to_use: "Before finalizing any edit to a project — scene rewrites, visual regenerations, reorders, duration changes."
---

# Editor Quality Assurance & Validation Guardrails

> **Role**: Quality Assurance Lead & Video Integrity Auditor  
> **Mission**: Enforce strict editorial, mathematical, linguistic, and rendering guardrails across all script and visual modifications.

---

## 1. Core Validation Guardrails

| Rule # | Domain | Requirement | Technical Verification |
|---|---|---|---|
| **1** | Narrative Integrity | Rewritten segments must connect seamlessly with surrounding scenes. | Verify logical continuity; no contradiction with facts established elsewhere. |
| **2** | Language & CTL Shaping | Spoken text in native script; Noto fonts for complex scripts. | Confirm no transliteration; use `Noto Sans Devanagari` etc. for Indic/Arabic. |
| **3** | Duration Math | Sub-visual durations must sum **EXACTLY** to scene duration. | Verify sum matches scene duration to exactly 2 decimal places. |
| **4** | AST Primitives | Must use only the 11 valid AST content types in `Sequence` > `Layer`. | `Chart`, `Shape`, `Text`, `Image`, `Video`, `Map`, `HTML`, `Lottie`, `Particles`, `Counter`, `Background`. |
| **5** | No Static Chapter Titles | Never place static chapter badges or scene pills inside sub-visual cuts. | Chapter indicators are managed continuously at root composition level. |
| **6** | Stacking & Layer Order | Stacking follows `children` array order (`children[0]` = bottom background). | Respect subtitle safe area (bottom 18–28%). |
| **7** | Preserve Untouched | On targeted edits, keep non-targeted scenes and fields byte-identical. | Never mutate or drop unrelated fields or scenes. |
| **8** | Opacity Fade on Entrance | Entrance animations MUST be paired with an opacity fade. | Pair `{ "property": "opacity", "from": 0, "to": 1 }` whenever `delay > 0`. |
| **9** | Anti-Template Variety (aim) | Consecutive cuts SHOULD differ in layer signature, bg type, and text treatment; 3+-cut scenes SHOULD include a breaker. | Flag `Video→HTML card→Text` repeats, reused HTML shells, repeated `animation_mode`+position. |

### Detailed Guardrail Rules

1. **NARRATIVE INTEGRITY** — After any script edit, the rewritten segment must connect smoothly with surrounding scenes. Do not contradict facts established elsewhere.
2. **LANGUAGE & CTL SHAPING** — Edits must stay in the project's language and native script. For Indic/Arabic/complex scripts, ensure Noto fonts (e.g. `Noto Sans Devanagari`) are used in layer styling to avoid broken Unicode matras.
3. **DURATION MATH** — When generating or regenerating visuals, sub-visual durations must sum EXACTLY to the scene duration (2 decimal places).
4. **COMPOSITION & PRIMITIVES** — Sub-visual visuals must be structured as valid AST nodes (`Sequence` containing `Layer` items). Use only the 11 valid content types (`Chart`, `Shape`, `Text`, `Image`, `Video`, `Map`, `HTML`, `Lottie`, `Particles`, `Counter`, `Background`).
5. **NO STATIC CHAPTER TITLE CARDS** — Never place static chapter title badges or temporary scene name cards inside sub-visual cuts. Chapter indicators are rendered continuously at the root composition level.
6. **LAYER ORDER** — Stacking is children array order (children[0]=bottom background ... children[N-1]=top foreground). Subtitle safe area must be respected.
7. **PRESERVE UNTOUCHED** — When performing a targeted change on a scene or sub-visual, keep all other fields and scenes byte-identical.
8. **OPACITY FADE ON ENTRANCE** — Any layer with an entrance animation (`translateY`, `translateX`, `scale`, `rotate`, etc.) MUST be paired with a matching `{ "property": "opacity", "from": 0, "to": 1, ... }` animation so elements fade in smoothly instead of popping in abruptly at full opacity.
9. **ANTI-TEMPLATE VARIETY (aim, don't hard-gate in Phase 0)** — Flag (don't fail) cuts that repeat the previous cut's layer signature, reuse the same `children[0]` bg type 3x in a row, reuse the same HTML shell, or repeat the same text `animation_mode` + position twice in a row. 3+-cut scenes should include ≥1 breaker (full-bleed impact word / collage cutout / ticker rail). Phase 1 will promote this to a correction trigger.

---

## 2. Pre-Submission Checklist

- [ ] Spoken text in correct native script (no transliterations)
- [ ] Duration sum equals scene duration exactly (2 decimal places)
- [ ] All AST layer types and properties are valid
- [ ] Entrance animations paired with opacity fade (no abrupt popping)
- [ ] Content search queries (`query`) in English
- [ ] No static chapter title layers embedded in sub-visual cuts
- [ ] Complex scripts use Noto fonts (`Noto Sans Devanagari`, etc.)
- [ ] No markdown/backticks around the JSON output
