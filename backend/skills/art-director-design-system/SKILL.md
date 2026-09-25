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

{design_guidance}

---

## 1. Design Token Matrix & Schema Reference

| Field | Sub-Property | Type | Required | Description & Standard Defaults |
|---|---|---|---|---|
| `theme_name` | — | `string` | Yes | Novel 2–4 word aesthetic title YOU INVENT for this topic (never reuse suggestion-list names or past outputs). |
| `color_palette` | `background` | `string (hex)` | Yes | Canvas base YOU INVENT per the assigned variety direction (dark, light, or mid-tone — any `#RRGGBB` with strong text contrast). |
| | `primary` | `string (hex)` | Yes | High-contrast brand anchor YOU INVENT (any saturated `#RRGGBB`, never a spec-example copy). |
| | `secondary` | `string (hex)` | Yes | Complementary tone YOU INVENT (distinct hue family from primary). |
| | `accent` | `string (hex)` | Yes | High-visibility callout YOU INVENT (highest contrast against background). |
| | `text` | `string (hex)` | Yes | Maximum contrast text YOU INVENT (light `#RRGGBB` on dark backgrounds, dark `#RRGGBB` on light). |
| `typography` | `heading_font` | `string` | Yes | Main display font for titles/headers. |
| | `body_font` | `string` | Yes | Highly readable body font for cards and subtitles. |
| `css_guidelines` | — | `string` | Yes | Brief layout, border radius, contrast, and typography styling rules. |

---

## 2. Design System Guidelines & Token Roles

VARIETY & ANTI-REPETITION RULES (highest priority — the user complains every theme looks the same):
- NEVER copy the example hex codes in this spec (`#0b0b1a`, `#0f172a`, `#00d4ff`, `#facc15`, `#ef4444`, `#faf7f0`) verbatim. They are shape examples, not outputs. Every generation MUST emit a visibly fresh palette.
- ALWAYS honor the `ASSIGNED VARIETY DIRECTION` from the creative brief (lighting + hue lane). It overrides the "dark cinematic" default. Dark cinematic is only ONE of many allowed looks — light editorial, mono+pop, earth, teal, plum, frost, duotone, moss, noir, slate, and sand are equally valid.
- theme_name MUST be novel (2–4 words you invent for this topic). NEVER repeat past names across projects.
- Derive at least one hue cue from the video Topic/Title (e.g. finance+gold, ocean+teal, crime+crimson) so different topics never converge to one palette.
- Keep WCAG AA contrast: text vs background ≥ 4.5:1, primary vs background ≥ 3:1. banned pairs: near-identical background+text, two neon primaries that vibrate.

DESIGN GUIDELINES (any topic-fitting palette allowed):
- **theme_name**: A novel 2-4 word aesthetic title you invent for THIS topic.
- **color_palette**: Modern, vibrant, highly readable hex codes invented for THIS topic AND the assigned variety direction.
  * **background**: A canvas YOU INVENT to match the assigned lighting lane (dark, light, or mid-tone — never a spec-example copy).
  * **primary**: A high-contrast brand color YOU INVENT (saturated, topic-fitting).
  * **secondary**: A complementary tone YOU INVENT (different hue family from primary).
  * **accent**: A high-visibility callout YOU INVENT (maximum pop against background).
  * **text**: A readable color YOU INVENT with strong contrast on background (light on dark, dark on light).
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

Return ONLY valid JSON matching this schema.
NOTE: the values below are a SHAPE EXAMPLE ONLY — DO NOT copy these hex codes, theme name, or fonts into your answer. Invent fresh values per the variety rules above.

```json
{
  "theme_name": "Copper Atlas Memoir",
  "color_palette": {
    "background": "#17352a",
    "primary": "#e07a2c",
    "secondary": "#7fb069",
    "accent": "#d6495b",
    "text": "#f4f1e8"
  },
  "typography": {
    "heading_font": "Outfit",
    "body_font": "Inter"
  },
  "css_guidelines": "Warm moss canvas with copper accents and rounded 16px cards."
}
```

---

## 5. Verification Checklist

- [ ] Theme name is novel (2–4 words, not a suggestion-list copy)
- [ ] Palette is visibly different from past outputs and honors the assigned variety direction
- [ ] Hex colors provide sufficient contrast ratio (WCAG AA compliant)
- [ ] If language is non-Latin, fonts use appropriate Noto family (`Noto Sans Devanagari`, etc.)
- [ ] Output is 100% valid JSON without markdown wrapping or backticks
