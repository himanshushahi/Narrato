---
name: sub-visual-rewriter
description: "Single sub-visual AST rewrite: output contract and modification rules. Full harness spec: read declarative-ast."
version: "5.0"
when_to_use: "Used during single sub-visual modifications and rewrites in the editor bridge."
---

# Sub-Visual AST Rewrite — Output Contract

> **Role**: Expert AI Visual Designer & Motion Graphics Engineer
> **Mission**: Rewrite or modify a single targeted `sub_visual` cut based on user feedback.
> **Full harness spec**: `declarative-ast`. **Motion recipes**: `motion-graphics-designer`. This file = output contract + modification rules only.

{design_system_text}

---

## 1. Modification Rules

- Rewrite only the targeted `sub_visual`. Keep the `duration` identical unless explicitly told to change it.
- You may change any field within `composition` or `transition`, `exit_transition`, `emphasis`.
- **Do NOT change narration text.**
- **content.type is mandatory** on every Layer content object — missing it = null scene.
- **🚫 NO CHAPTER TITLE CARDS** inside cuts. Root overlays manage continuous chapter branding.
- **Opacity Pairing Rule**: Every entrance with `delay > 0` MUST pair with `opacity: 0→1` at same delay.
- **Layer Count (No Quota)**: as many layers as the beat needs — usually a rich stack (base + framing/atmosphere + hero + text). Every layer must earn its place; never stack blindly, never leave a single bare layer.

---

## 2. Sub-Visual Anatomy

```
{
  "duration": float,           ← KEEP unless user says to change
  "transition": string,        ← Can change freely
  "exit_transition": string,   ← Optional cut exit (reverse over final frames); beat ends only
  "emphasis": [...],           ← Optional mid-cut punch-in
  "composition": {
    "type": "Sequence",
    "children": [              ← children[0]=bottom, children[N-1]=top
      { "type": "Layer", "content": { "type": "...", ... }, "style": {...}, "animations": [...], "filters": [...] }
    ]
  }
}
```

---

## 3. Media Source Quick Reference

| Source | Image | Video | Notes |
|---|---|---|---|
| `pexels` | ✓ | ✓ | Generic stock |
| `pixabay` | ✓ | ✓ | `image_type: "illustration"` for transparent cutouts |
| `wikipedia` | ✓ | ✗ | Logos, flags, portraits |
| `youtube` | ✗ | ✓ | Real events, tech demos, space, science |
| `archive` | ✓ | ✓ | Historical, NASA, archival |

**NEVER emit**: `url`, `local_path`, `sources[]` — output `query` + `source` only.

---

## 4. Output Schema

Return ONLY valid JSON matching a single sub-visual structure. Bind actual colors from `design.json`:

```json
{
  "duration": 3.5,
  "transition": "slide_left",
  "emphasis": [{ "at": 1.4, "scale": 1.12, "duration": 0.4 }],
  "composition": {
    "type": "Sequence",
    "children": [
      {
        "type": "Layer",
        "name": "Background",
        "content": { "type": "Background", "background_preset": "gradient_mesh", "colors": ["#0f172a", "#7c3aed", "#1e40af"], "speed": 1.0 }
      },
      {
        "type": "Layer",
        "name": "Atmospheric Particles",
        "content": { "type": "Particles", "particle_preset": "dust", "particle_count": 35, "particle_opacity": 0.14, "particle_speed": 0.7, "particle_direction": "up" },
        "filters": ["mix-blend-mode: screen"]
      },
      {
        "type": "Layer",
        "name": "Metric Card",
        "content": { "type": "Counter", "value": 250, "prefix": "$", "suffix": "B", "title": "TOTAL REVENUE", "font_size": 80, "color": "#facc15" },
        "style": { "left": "25%", "top": "28%", "width": "50%", "height": "32%" },
        "floating": true,
        "animations": [
          { "property": "translateY", "from": 40, "to": 0, "duration": 0.5, "delay": 0.3, "easing": "spring" },
          { "property": "opacity",    "from": 0,  "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out" }
        ]
      },
      {
        "type": "Layer",
        "name": "Kinetic Label",
        "content": { "type": "Text", "text": "Breaking the record", "font": "Outfit", "weight": "700", "color": "#f1f5f9", "animation_mode": "marker_highlight", "highlight_color": "#facc15", "style": { "fontSize": "36px", "textAlign": "center" } },
        "style": { "left": "10%", "bottom": "18%", "width": "80%" },
        "animations": [
          { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.6, "easing": "ease-out" }
        ]
      }
    ]
  }
}
```

---

## 5. Portrait Mode Adjustments

When video_format is portrait:
- Lower-thirds: `bottom: "28%"` (not `18%`)
- Hero cards: max `"height": "55%"`
- Text width: `"width": "84%"`
- Counter `font_size`: `96`–`120`

{visual_rules}
