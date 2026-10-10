---
name: subtitle-designer
version: "3.0"
description: "Kinetic subtitle typography rules, viral-caption styles (stroke, word-pill, karaoke layouts), full settings key reference, safe margin areas, and complex text layout (CTL) font compliance."
when_to_use: "When updating subtitle styling (fonts, colors, positions, outlines, animations, viral presets) for a video."
exposure: agent
---

# Kinetic Subtitle Design & Safe Area Specification

> **Role**: Lead Motion Graphics Subtitle & Kinetic Typography Designer  
> **Mission**: Design clear, high-contrast subtitles that never clash with visual elements, stay within mobile/desktop safe areas, and render complex scripts with zero ligature breakage.

---

## 1. Quick Reference & Styling Matrix

| Property | Landscape (16:9) | Portrait (9:16) | Standard Recommendation |
|---|---|---|---|
| **Placement** | Bottom Center | Bottom Center | Above bottom 18% (landscape) or 28% (portrait) |
| **Max Chars / Line** | ~42 characters | ~28 characters | Split long sentences across multiple lines |
| **Stroke & Outline** | 2–4px dark stroke | 3–5px dark stroke | High contrast fill + shadow/stroke; never fill alone |
| **Animation Speed** | 100–300ms per word/line | 100–250ms per word/line | Fade or slide-in; fast enough to stay readable |
| **Font (Complex Scripts)** | `Noto Sans Devanagari` etc. | `Noto Sans Devanagari` etc. | Mandatory for Hindi, Marathi, Tamil, Arabic |

---

## 2. Subtitle Styling Rules

- Subtitles must stay readable over any background: high contrast between fill and background.
- Use an outline (stroke) and/or shadow behind the text — never rely on fill color alone.
- Keep font size proportional to the video resolution (larger for 4K, smaller for mobile portrait).
- Fonts: any Google Fonts family works — the app downloads and embeds it at
  runtime (`Anton`, `Archivo Black`, `Luckiest Guy`, `Titan One` are the
  viral picks). Avoid truly exotic/paid families outside Google Fonts.
- **CRITICAL**: For complex scripts (Hindi/Devanagari, Bengali, Tamil, Arabic, etc.), you **MUST** use the corresponding Noto font (e.g., `Noto Sans Devanagari`) to prevent broken Unicode shaping. Do not use generic fonts for these languages.

---

## 3. Positioning & Safe Areas

- Default position is lower-center (like YouTube captions) — do NOT place text under UI elements.
- Portrait videos: keep subtitles within the safe area, away from screen edges (10% margin).
- Only raise the subtitle position when a visual has critical content at the bottom of the frame.
- Ensure midground cards and charts maintain clearance above the subtitle zone.

---

## 4. Animation Dynamics

- Prefer fade/slide-in per word or line; keep animation durations short (100-300ms) so text is readable.
- Never animate subtitles so fast that viewers cannot read them.
- Preserve temporal synchronization with voiceover audio playback.

---

## 5. Line Length & Pacing Constraints

- Keep each subtitle line under ~42 characters. Split long sentences across multiple lines.
- Match the word timestamps: each subtitle must cover exactly its spoken window.

---

## 6. Settings Key Reference (project_settings blob)

Canonical defaults live in `frontend/src/utils/subtitleSchema.ts` (`SUBTITLE_DEFAULTS`).
The renderer merges user settings over those defaults; `backend/agent/tools.py`
(`SUBTITLE_SETTING_KEYS` + `VISUAL_SETTINGS_SPEC`) validates the same keys.
`render.py` hashes the whole settings dict, so any key below invalidates the
frame cache automatically. Empty string on `glowColor` / `pillBgColor` /
`pillTextColor` means "follow the active color".

| Key | Type / Range | Default | Notes |
|---|---|---|---|
| `fontFamily` | string | `Montserrat` | Downloaded via Google Fonts at runtime; viral picks: `Anton`, `Archivo Black`, `Luckiest Guy`, `Titan One` |
| `fontSize` | 20–150 | 54 | px |
| `fontWeight` | 400–900 | 800 | |
| `wordSpacing` | 0–50 | 18 | px gap between words |
| `lineHeight` | 0.9–2.0 | 1.25 | Matters most in `stack` layout |
| `textTransform` | uppercase\|lowercase\|capitalize\|none | uppercase | No-op for Devanagari (safe) |
| `activeColor` | hex | `#fbbf24` | Spoken word |
| `pastColor` | hex | `#d6d3d1` | Already-spoken words |
| `futureColor` | hex | `#f5f5f4` | Upcoming words |
| `strokeWidth` | 0–8 | 0 | px outline; **2–4 = viral look**. 0 = off |
| `strokeColor` | hex | `#000000` | |
| `glowRadius` | 0–40 | 15 | px halo behind the active word; 0 = off |
| `glowColor` | hex or '' | '' (follows active) | |
| `pillStyle` | none\|active | none | `active` = Hormozi box behind the spoken word |
| `pillBgColor` | hex or '' | '' (follows highlight/active) | |
| `pillRadius` | 0–30 | 10 | px corner radius |
| `pillPadding` | css string | `2px 14px` | |
| `pillTextColor` | hex or '' | '' (follows active) | Hormozi sets near-black on yellow |
| `activeAnimation` | bounce\|pop\|jump\|slide\|fade\|scale\|tilt\|none | bounce | `slide`/`fade` are cheapest per frame (no spring) |
| `layoutMode` | sentence\|karaoke\|stack | sentence | `karaoke` = sliding single-line window; `stack` = 2 balanced lines |
| `karaokeWindow` | 3–9 | 5 | Words visible around the active word in karaoke mode |
| `wordsPerScreen` | 1–20 | 10 | Sentence grouping cap (also drives karaoke pacing) |
| `position` | bottom\|center\|top | bottom | Per-cut `subtitle_position` displacement still wins |
| `bottomOffset` | 0–1500 | 120 | px from bottom edge |
| `topOffset` | 0–1500 | 100 | px from top edge (used when position/displacement is top) |
| `backgroundStyle` | none\|highlight\|full_block | highlight | `highlight` = underline bar on read words |
| `highlightBgColor` | hex | `#fbbf24` | |
| `fullBgColor` | css color | `rgba(0,0,0,0.6)` | Only for `full_block` |
| `hide_subtitles` | bool | false | Zero-pixel fast path in the renderer |

---

## 7. Viral Preset Recipes (frontend `VIRAL_PRESETS`)

Apply via the MCP `update_subtitle_settings(project_id, settings)` tool —
keys are validated against `SUBTITLE_SETTING_KEYS` + `VISUAL_SETTINGS_SPEC`
(unknown keys and out-of-range values are rejected, so check §6 first).
Only the render stage resets (new pixels; voiceover/transcribe/assets
untouched). Missing keys fall back to defaults — only set what the recipe
needs. Users can also apply these one-click in the Subtitle settings tab.

- **Hormozi Viral**: `Anton` 64px uppercase, white past/future, 2px black stroke,
  `pillStyle: active` with yellow `#facc15` box + near-black `#0c0a09` pill text,
  `pop` animation, 7 words/screen, no background bar.
- **Abdaal Clean**: `Inter` 50px, `textTransform: none`, soft yellow active
  `#fde047`, no stroke, 12px glow, `fade` animation, no background bar.
- **Beast Loud**: `Anton` 84px uppercase, yellow active `#ffff00`, 3px black
  stroke, `karaoke` layout (window 5), `bounce`, 5 words/screen.
- **Hindi Viral**: `Mukta` 72px, `textTransform: none`, amber active `#facc15`,
  14px glow, `pop`, `highlight` background bar, 7 words/screen.

Rules of thumb: stroke 2–4px + pill OR glow (never all three — muddy);
karaoke layout pairs with short windows (3–5) and punchy animations
(pop/scale); Devanagari presets must keep `textTransform: none` and MUST NOT
use letter-spacing (breaks ligatures — the renderer never applies it).

---

## 8. Pre-Flight Subtitle Checklist

- [ ] High-contrast outline/shadow applied behind fill color
- [ ] Safe area margins respected (bottom 18% for landscape, 28% for portrait)
- [ ] Line length is under 42 characters (landscape) or 28 characters (portrait)
- [ ] Complex scripts (Hindi, Tamil, etc.) configured with appropriate Noto fonts
- [ ] Word-level timestamps match voiceover playback window
- [ ] Every key written exists in §6 (unknown keys are ignored, not errors)
- [ ] Portrait projects start from the portrait-safe baseline (64px, 6 words/screen, 560px offset) unless a preset overrides it
- [ ] Pill + highlight bar never double-stack on the active word (renderer handles this — don't work around it)
