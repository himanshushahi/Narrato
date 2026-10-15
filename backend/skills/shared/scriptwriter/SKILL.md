---
name: scriptwriter
version: "2.0"
description: "Master scriptwriting guidelines, tone rules, anti-AI-isms, native script enforcement, and TTS pronunciation formatting."
when_to_use: "When writing or rewriting narration, hooks, summaries, CTAs, or scene scripts."
exposure: agent
---

# Master Scriptwriting & Narration Guidelines

> **Role**: Master Scriptwriter & Voiceover Producer  
> **Mission**: Produce authentic, human-sounding narration, tight pacing, and TTS-safe phonetic text in the requested native script.

---

## 1. Core Narration Rules

- The `narration` field is the spoken voiceover. It MUST be a non-empty string. Never leave it blank.
- Never repeat the video title/topic verbatim in spoken text. Write original spoken content instead.
- Every claim must be factual and verifiable. No speculation unless clearly marked as opinion.

---

## 2. Language & Native Script Enforcement

- Spoken text (hook, narration, summary, cta) MUST be written in the requested language's native script.
  For Hindi ('hi') that means Devanagari (हिंदी). **NEVER use English alphabet transliterations.**
- This applies to Introduction and Conclusion too. Titles/chapter titles may use the requested language.

---

## 3. TTS-Friendly Writing & Phonetic Formatting

| Rule | What to Avoid | What to Write Instead (TTS Safe) |
|---|---|---|
| **Numbers** | `42`, `1,000,000` | `"forty-two"`, `"one million"` |
| **Abbreviations** | `e.g.`, `i.e.`, `etc.` | `"for example"`, `"that is"`, `"and so on"` |
| **Special Symbols** | `&`, `@`, `©`, `→`, `%` | `"and"`, `"at"`, `"percent"` |
| **Dates** | `Jan 1, 2024` | `"January first, twenty twenty-four"` |
| **Initials** | `USA`, `FBI`, `AI`, `USB` | `"U.S.A."`, `"F.B.I."`, `"A.I."`, `"U.S.B."` |
| **Product names** | `OpenAI` (reads as "openay") | `"Open A I"` (letter-spelled) |
| **Punctuation** | Semicolons, em-dashes, parentheses | Commas and periods for natural speech pauses |

### Detailed TTS Guidelines
- Write numbers as words ("forty-two" NOT "42"), avoid abbreviations ("for example" NOT "e.g.").
- Use short clear sentences. Avoid special characters (& @ ©) that break TTS.
- Write dates in full. Use commas and periods for natural pauses.
- Spell out initials with periods: "U.S.A." NOT "USA", "F.B.I." NOT "FBI", "A.I." NOT "AI", "U.S.B." NOT "USB".
- Letter-spell product names that TTS slurs: "Open A I" NOT "OpenAI".
- Avoid parentheses — restructure sentences naturally instead.

---

## 4. Length, Pacing & Word Budgeting

| Language | Target Speaking Rate | Formula for Narration Budget |
|---|---|---|
| **English ('en')** | ~180 words/min (~3 words/sec) | `Target Seconds × 3.0` words |
| **Hindi ('hi')** | ~4.5 syllables/sec (~2.5 words/sec) | `Target Seconds × 2.5` words |

### Detailed Pacing Rules
- Match the target speaking duration: English ~180 words/min (3 words/sec), Hindi ~4.5 syllables/sec.
- Estimate words via: seconds × speaking_rate. Keep narration tight — every spoken second adds video length.
- Rewrites must match the pacing and content density of surrounding scenes.

---

## 4b. Video Architecture & Scene Breakdown Matrix (Critical)

In Narrato, a **scene is a ~7–12 second visual chapter/beat**, NOT an essay section.
Never write 4–6 long 60-second scenes for a multi-minute video.
Exact per-scene budgets come from `get_stage_skills('script', project_id)` →
`outline_targets` (authoritative). This table is the overview.

| Format | Duration Mode | Total Seconds | Required Scenes | Per-Scene | Words/Scene (EN) | Total Words (EN) |
|---|---|---|---|---|---|---|
| Landscape | medium (~5m) | 300 | 20–30 | ~9s | ~27 | ~900 |
| Landscape | long (~10m) | 600 | 40–55 | ~10s | ~30 | ~1800 |
| Landscape | extra_long (~15m) | 900 | 60–75 | ~11s | ~33 | ~2700 |
| Portrait | short (~60s) | 60 | 4–6 | ~7s | ~21 | ~180 |
| Portrait | medium (~90s) | 90 | 6–8 | ~9s | ~27 | ~270 |
| Portrait | long (~2m) | 120 | 8–12 | ~8s | ~24 | ~360 |

### Scene-count rules
- For a 5-minute landscape video: generate **20 to 30 scenes (~27 words each)**. Never 5 scenes.
- Each scene gets roughly equal screen time with its own chapter title and narrative beat.
- A 60-second scene breaks visual pacing (frozen cuts, minute-long voiceover chunk, broken subtitles). Keep scenes short (~7–12s).
- Hindi uses ~2.5 words/sec: same scene counts, ~18–28 words per scene. Follow `outline_targets` exactly.

---

## 5. Anti-AI-Isms & Natural Human Voice (Critical)

| Category | Forbidden AI Clichés (NEVER USE) | Preferred Natural Phrasing |
|---|---|---|
| **Buzzwords** | delve, tapestry, fostering, meticulous, vibrant, boasts, intricate, underscore, pivotal | explore, shows, built, detailed, active, has, key |
| **Grand Statements** | "stands as a testament", "plays a crucial role", "marking a pivotal moment", "a stark reminder" | State the factual occurrence directly without melodrama. |
| **Contrived Contrasts** | "Not just X, but also Y", "It's not X, it's Y" | Clear declarative sentences. |
| **Pretentious Verbs** | "serves as", "features" | Basic copulatives: "is", "are", "has". |

### Detailed Tone Guidelines
- Write like a human! Avoid predictable "AI voice" clichés and marketing buzzwords.
- **NEVER** use overused AI vocabulary like: "delve", "tapestry", "fostering", "meticulous", "vibrant", "boasts", "intricate", "underscore", "pivotal".
- **NEVER** use grand, exaggerated statements of legacy or importance (e.g. "stands as a testament", "plays a crucial role", "marking a pivotal moment", "a stark reminder").
- **AVOID** rigid parallelisms and contrast structures like "Not just X, but also Y" or "It's not X, it's Y".
- Use basic copulatives ("is", "are") instead of contrived synonyms ("serves as", "features").
- Keep tone neutral and encyclopedic/documentary style. Avoid overly promotional puffery.

---

## 6. Pre-Submission Script Checklist

- [ ] `narration` field is non-empty and original
- [ ] Spoken text is in target native script (Devanagari for Hindi; no Hinglish/transliterations)
- [ ] Numbers, dates, and symbols are converted to spoken phonetic words
- [ ] Word count matches target seconds × speaking rate
- [ ] Scene count matches Duration Mode matrix (e.g. 20–30 scenes for 5m landscape, never 5)
- [ ] Each scene is short (~7–12s, ~21–33 EN words — follow outline_targets), not a 60s chapter
- [ ] Zero forbidden AI buzzwords ("delve", "tapestry", etc.)
- [ ] Facts are verifiable with no fabricated claims
