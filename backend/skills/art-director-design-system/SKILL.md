---
name: art-director-design-system
description: "Art Director instructions for generating cohesive, high-contrast visual design systems, color palettes, typography, and styling rules."
version: "2.0"
when_to_use: "Used during project initialization to generate the global design.json."
---

# Art Director Design System Specification

> **Role**: Executive Art Director & Visual Identity Architect  
> **Target Format**: `{video_format}` (e.g., landscape = 16:9, portrait = 9:16)  
> **Target Language**: `{language}`  
> **Output Contract**: Return ONLY valid JSON matching the schema. No markdown backticks or commentary.

{genre_guidance}

---

## 1. Design Token Matrix & Schema Reference

| Field | Sub-Property | Type | Required | Description & Standard Defaults |
|---|---|---|---|---|
| `theme_name` | — | `string` | Yes | Descriptive 2–4 word aesthetic title (e.g., `"Oceanic Deep Tech"`, `"Cyberpunk Glow"`, `"Editorial Minimalist"`, `"Warm Amber Narrative"`, `"Paper Daylight"`). |
| `color_palette` | `background` | `string (hex)` | Yes | Canvas base: Dark cinematic (e.g. `#0b0b1a`, `#0f172a`) or light editorial (`#faf7f0`, `#f8fafc`). |
| | `primary` | `string (hex)` | Yes | High-contrast brand anchor (`#facc15`, `#00d4ff`, `#10b981`, `#f59e0b`). |
| | `secondary` | `string (hex)` | Yes | Complementary tone (`#818cf8`, `#8b5cf6`, `#fbbf24`). |
| | `accent` | `string (hex)` | Yes | High-visibility callout (`#ef4444`, `#f43f5e`, `#10b981`). |
| | `text` | `string (hex)` | Yes | Maximum contrast text (`#f8fafc` on dark backgrounds, `#0f172a` on light). |
| `typography` | `heading_font` | `string` | Yes | Main display font for titles/headers. |
| | `body_font` | `string` | Yes | Highly readable body font for cards and subtitles. |
| `css_guidelines` | — | `string` | Yes | Brief layout, border radius, contrast, and typography styling rules. |

---

## 2. Design System Guidelines & Token Roles

DESIGN GUIDELINES (any genre-fitting palette allowed — dark cinematic is a strong default, light/editorial/mono themes allowed):
- **theme_name**: A descriptive 2-4 word aesthetic title for the theme (e.g., "Oceanic Deep Tech", "Cyberpunk Glow", "Editorial Minimalist", "Warm Amber Narrative", "Paper Daylight").
- **color_palette**: Modern, vibrant, highly readable hex codes aligned with genre.
  * **background**: Any readable canvas — dark cinematic (e.g. `#0b0b1a`, `#0f172a`) or light editorial (e.g. `#faf7f0`, `#f8fafc`) when the story fits.
  * **primary**: High-contrast primary brand color (e.g., `#facc15`, `#00d4ff`, `#10b981`, `#f59e0b`).
  * **secondary**: Complementary secondary tone (e.g., `#818cf8`, `#8b5cf6`, `#fbbf24`).
  * **accent**: High-visibility callout accent (e.g., `#ef4444`, `#f43f5e`, `#10b981`).
  * **text**: Readable text color with strong contrast on background (e.g. `#f8fafc` on dark, `#0f172a` on light).
- **typography**:
  * **heading_font**: Main display font for titles/headers.
  * **body_font**: Highly readable body font for cards/subtitles.
- **css_guidelines**: Provide brief layout and aesthetic styling rules (e.g. contrast, accents, card borders, typography scales).

---

## 3. Complex Text Layout (CTL) Font Rules

CRITICAL COMPLEX SCRIPT (CTL) FONT RULE:
- If Language is a complex script (like Hindi/hi, Marathi/mr, Bengali/bn, Tamil/ta, Telugu/te, Arabic/ar, Thai/th), you **MUST** specify the corresponding Noto font (e.g. `Noto Sans Devanagari` for Hindi/Marathi, `Noto Sans Tamil` for Tamil) to guarantee proper Unicode matra and ligature shaping.
- **NEVER** use Latin-only display fonts (like Oswald, Outfit, Montserrat, Bebas Neue) for non-Latin languages — they break ligatures and render detached matras.
- For English ('en'), clean modern fonts (e.g. Inter, Outfit, Oswald, Montserrat). Any renderer-supported font allowed.

---

## 4. Output JSON Contract

Return ONLY valid JSON matching this schema:

```json
{
  "theme_name": "Oceanic Deep Tech",
  "color_palette": {
    "background": "#0b0b1a",
    "primary": "#00d4ff",
    "secondary": "#818cf8",
    "accent": "#ef4444",
    "text": "#f8fafc"
  },
  "typography": {
    "heading_font": "Outfit",
    "body_font": "Inter"
  },
  "css_guidelines": "High-contrast dark canvas with subtle glowing cyan accents and rounded 16px cards."
}
```

---

## 5. Verification Checklist

- [ ] Theme name is descriptive (2–4 words)
- [ ] Hex colors provide sufficient contrast ratio (WCAG AA compliant)
- [ ] If language is non-Latin, fonts use appropriate Noto family (`Noto Sans Devanagari`, etc.)
- [ ] Output is 100% valid JSON without markdown wrapping or backticks
