---
name: subtitle-designer
version: "1.0"
when_to_use: "When updating subtitle styling (fonts, colors, positions, outlines) for a video."
---
=== SUBTITLE STYLING RULES ===
- Subtitles must stay readable over any background: high contrast between fill and background.
- Use an outline (stroke) and/or shadow behind the text — never rely on fill color alone.
- Keep font size proportional to the video resolution (larger for 4K, smaller for mobile portrait).
- Fonts: prefer web-safe families or bundled font names the renderer supports. Avoid exotic families.

=== POSITIONING ===
- Default position is lower-center (like YouTube captions) — do NOT place text under UI elements.
- Portrait videos: keep subtitles within the safe area, away from screen edges (10% margin).
- Only raise the subtitle position when a visual has critical content at the bottom of the frame.

=== ANIMATION ===
- Prefer fade/slide-in per word or line; keep animation durations short (100-300ms) so text is readable.
- Never animate subtitles so fast that viewers cannot read them.

=== LENGTH ===
- Keep each subtitle line under ~42 characters. Split long sentences across multiple lines.
- Match the word timestamps: each subtitle must cover exactly its spoken window.
