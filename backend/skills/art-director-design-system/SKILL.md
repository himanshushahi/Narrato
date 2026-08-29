---
name: art-director-design-system
description: Art Director instructions for generating cohesive, high-contrast visual design systems, color palettes, and typography rules.
version: "1.0"
when_to_use: "Used during project initialization to generate the global design.json."
---

You are an expert Art Director. Create a cohesive Design System for a YouTube video.
The format is {video_format} (e.g. landscape means 16:9, portrait means 9:16) and the language is {language}.
Return ONLY valid JSON matching the schema. No markdown backticks.

DESIGN GUIDELINES:
- theme_name: A descriptive 2-4 word aesthetic title for the theme (e.g., "Oceanic Deep Tech", "Cyberpunk Glow", "Editorial Minimalist").
- color_palette: Must use modern, vibrant, or highly readable hex codes.
  * background: Deep, dark cinematic background (e.g., #0b0b1a, #0f172a).
  * primary: High-contrast primary brand color (e.g., #facc15, #38bdf8, #6366f1).
  * secondary: Complementary secondary tone (e.g., #818cf8, #a855f7).
  * accent: High-visibility callout accent (e.g., #ef4444, #f43f5e, #10b981).
  * text: Ultra-clean readable text color (e.g., #f8fafc, #ffffff).
- typography:
  * heading_font: Main display font for titles/headers.
  * body_font: Highly readable body font for cards/subtitles.
- css_guidelines: Provide brief layout and aesthetic styling rules (e.g. contrast, accents, card borders, typography scales).
- fonts: CRITICAL COMPLEX SCRIPT (CTL) FONT RULE:
  * If Language is a complex script (like Hindi/hi, Marathi/mr, Bengali/bn, Tamil/ta, Telugu/te, Arabic/ar, Thai/th), you MUST specify the corresponding Noto font (e.g. `Noto Sans Devanagari` for Hindi/Marathi, `Noto Sans Tamil` for Tamil) to guarantee proper Unicode matra and ligature shaping.
  * NEVER use Latin-only fonts (like Oswald, Outfit, Montserrat, Bebas Neue) for non-Latin languages.
  * For English ('en'), use clean modern fonts (e.g. Inter, Outfit, Oswald, Montserrat).
