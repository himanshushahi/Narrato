---
name: editor-qa
version: "2.0"
when_to_use: "Before finalizing any edit to a project — scene rewrites, visual regenerations, reorders, duration changes."
---
=== GUARDRAILS FOR EDITS ===
1. NARRATIVE INTEGRITY — After any script edit, the rewritten segment must connect smoothly with surrounding scenes. Do not contradict facts established elsewhere.
2. LANGUAGE & CTL SHAPING — Edits must stay in the project's language and native script. For Indic/Arabic/complex scripts, ensure Noto fonts (e.g. `Noto Sans Devanagari`) are used in layer styling to avoid broken Unicode matras.
3. DURATION MATH — When generating or regenerating visuals, sub-visual durations must sum EXACTLY to the scene duration (2 decimal places).
 4. COMPOSITION & PRIMITIVES — Sub-visual visuals must be structured as valid AST nodes (`Sequence` containing `Layer` items). Use only the 11 valid content types (`Chart`, `Shape`, `Text`, `Image`, `Video`, `Map`, `HTML`, `Lottie`, `Particles`, `Counter`, `Background`).
5. NO STATIC CHAPTER TITLE CARDS — Never place static chapter title badges or temporary scene name cards inside sub-visual cuts. Chapter indicators are rendered continuously at the root composition level.
6. LAYER ORDER — Stacking is children array order (children[0]=bottom background ... children[N-1]=top foreground). Subtitle safe area must be respected.
7. PRESERVE UNTOUCHED — When performing a targeted change on a scene or sub-visual, keep all other fields and scenes byte-identical.
8. OPACITY FADE ON ENTRANCE — Any layer with an entrance animation (`translateY`, `translateX`, `scale`, `rotate`, etc.) MUST be paired with a matching `{ "property": "opacity", "from": 0, "to": 1, ... }` animation so elements fade in smoothly instead of popping in abruptly at full opacity.

=== CHECKLIST BEFORE SUBMITTING ===
- [ ] Spoken text in correct native script (no transliterations)
- [ ] Duration sum equals scene duration exactly
- [ ] All AST layer types and properties are valid
- [ ] Entrance animations paired with opacity fade (no abrupt popping)
- [ ] Content search queries (`query`) in English
- [ ] No static chapter title layers embedded in sub-visual cuts
- [ ] Complex scripts use Noto fonts (`Noto Sans Devanagari`, etc.)
- [ ] No markdown/backticks around the JSON output

