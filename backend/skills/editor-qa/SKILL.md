---
name: editor-qa
version: "1.0"
when_to_use: "Before finalizing any edit to a project — scene rewrites, visual regenerations, reorders, duration changes."
---
=== GUARDRAILS FOR EDITS ===
1. NARRATIVE INTEGRITY — After any script edit, the rewritten segment must connect smoothly with the
   surrounding scenes. Do not change facts established elsewhere in the video.
2. LANGUAGE — Edits must stay in the project's language and native script. Never mix transliterations.
3. DURATION MATH — When regenerating visuals, sub-visual durations must sum EXACTLY to the scene duration.
   Use the validation error feedback to recalculate rather than shipping approximate sums.
4. COMPOSITION — The visual AST is contained in the `composition` property. Transitions: subtle_slide, fade,
   slide_left, slide_right, slide_up, slide_down, zoom_in, zoom_out, glitch, none.
5. HASH DISCIPLINE — After edits that change narration, the corresponding _narr_hash must be updated so
   downstream smart-resume does not treat the scene as unchanged.
6. PRESERVE UNTOUCHED — When the user asks for a targeted change, keep all other fields byte-identical.

=== CHECKLIST BEFORE SUBMITTING ===
- [ ] Spoken text in correct script, no transliterations
- [ ] Duration sum matches scene duration
- [ ] All AST layer types and properties are valid (Image, Video, Text, Map)
- [ ] Content search queries (`query`) in English
- [ ] Complex scripts (Hindi, Tamil, Arabic, etc.) use Noto fonts (`Noto Sans Devanagari`, etc.) in Text styles
- [ ] No markdown/backticks around the JSON output
