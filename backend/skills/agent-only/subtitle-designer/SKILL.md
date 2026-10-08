---
name: subtitle-designer
version: "2.0"
description: "Kinetic subtitle typography rules, contrast boundaries, safe margin areas, and complex text layout (CTL) font compliance."
when_to_use: "When updating subtitle styling (fonts, colors, positions, outlines) for a video."
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
- Fonts: prefer web-safe families or bundled font names the renderer supports. Avoid exotic families.
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

## 6. Pre-Flight Subtitle Checklist

- [ ] High-contrast outline/shadow applied behind fill color
- [ ] Safe area margins respected (bottom 18% for landscape, 28% for portrait)
- [ ] Line length is under 42 characters (landscape) or 28 characters (portrait)
- [ ] Complex scripts (Hindi, Tamil, etc.) configured with appropriate Noto fonts
- [ ] Word-level timestamps match voiceover playback window
