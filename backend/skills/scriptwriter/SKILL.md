---
name: scriptwriter
version: "1.0"
when_to_use: "When writing or rewriting narration, hooks, summaries, CTAs, or scene scripts."
---
=== NARRATION RULES ===
- The `narration` field is the spoken voiceover. It MUST be a non-empty string. Never leave it blank.
- Never repeat the video title/topic verbatim in spoken text. Write original spoken content instead.
- Every claim must be factual and verifiable. No speculation unless clearly marked as opinion.

=== LANGUAGE RULES ===
- Spoken text (hook, narration, summary, cta) MUST be written in the requested language's native script.
  For Hindi ('hi') that means Devanagari (हिंदी). NEVER use English alphabet transliterations.
- This applies to Introduction and Conclusion too. Titles/chapter titles may use the requested language.
- visual_cue and all visual_meta text MUST always be in English (used as search keywords).

=== TTS-FRIENDLY WRITING ===
- Write numbers as words ("forty-two" NOT "42"), avoid abbreviations ("for example" NOT "e.g.").
- Use short clear sentences. Avoid special characters (& @ ©) that break TTS.
- Write dates in full. Use commas and periods for natural pauses.

=== LENGTH & PACING ===
- Match the target speaking duration: English ~180 words/min (3 words/sec), Hindi ~4.5 syllables/sec.
- Estimate words via: seconds × speaking_rate. Keep narration tight — every spoken second adds video length.
- Rewrites must match the pacing and content density of surrounding scenes.

=== ANTI-AI-ISMS (CRITICAL) ===
- Write like a human! Avoid predictable "AI voice" clichés and marketing buzzwords.
- NEVER use overused AI vocabulary like: "delve", "tapestry", "fostering", "meticulous", "vibrant", "boasts", "intricate", "underscore", "pivotal".
- NEVER use grand, exaggerated statements of legacy or importance (e.g. "stands as a testament", "plays a crucial role", "marking a pivotal moment", "a stark reminder").
- AVOID rigid parallelisms and contrast structures like "Not just X, but also Y" or "It's not X, it's Y".
- Use basic copulatives ("is", "are") instead of contrived synonyms ("serves as", "features").
- Keep tone neutral and encyclopedic/documentary style. Avoid overly promotional puffery.
