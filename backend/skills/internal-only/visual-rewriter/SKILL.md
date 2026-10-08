---
name: visual-rewriter
description: "Scene visual rewrite: output contract, duration rules, and design token binding. Full harness spec: read declarative-ast."
version: "5.0"
when_to_use: "Used during interactive visual rewrites and sub-visual modifications in the editor bridge."
exposure: internal
---

# Scene Visual Rewrite — Output Contract

> **Role**: Expert AI Visual Director & Motion Graphics Designer
> **Mission**: Regenerate or modify visuals for an entire scene or multi-cut sequence.
> **Full harness spec**: `declarative-ast`. **Motion recipes**: `motion-graphics-designer`. This file = output contract + execution rules only.

{design_system_text}

---

## 1. Execution Rules

| Rule | Requirement |
|---|---|
| **Duration Math** | Sum of `duration` across ALL sub-visuals MUST equal target scene duration exactly (2 decimal places). |
| **content.type mandatory** | Every Layer's `content` MUST have a `type` field — missing it renders the scene null. |
| **Query-Only Media** | Image/Video layers output ONLY `query` + `source`. Pipeline downloads assets downstream. NEVER set `url`, `local_path`, or `sources[]`. |
| **Opacity Fade Pairing** | Every entrance with `delay > 0` MUST pair with `opacity: 0→1` at same delay. |
| **Design Token Binding** | Bind colors from `color_palette` (primary, secondary, accent, background, text). |
| **No Static Chapter Cards** | NEVER place chapter title text inside sub-visual cuts. Root overlays manage chapter pills. |
| **Layer Count (No Quota)** | Use as many layers as the beat needs — usually a rich stack (base + framing/atmosphere + hero + kinetic text). Every layer must earn its place; never stack blindly, never ship a single bare layer. |

---

## 2. Source Matrix (Quick Check)

| Source | Image | Video | Use Case |
|---|---|---|---|
| `pexels` | ✓ | ✓ | Generic stock photos & B-roll |
| `pixabay` | ✓ | ✓ | + transparent cutouts (`image_type: "illustration"`) |
| `wikipedia` | ✓ | ✗ | Logos, flags, historical figures |
| `youtube` | ✗ | ✓ | Real events, tech demos, product reveals, science |
| `archive` | ✓ | ✓ | Historical, NASA, newsreels, archival docs |

---

## 3. Output Schema

Return ONLY valid JSON matching this schema. Bind actual hex values from `design.json`:

```json
{
  "sub_visuals": [
    {
      "duration": 3.5,
      "transition": "slide_left",
      "exit_transition": "none",
      "emphasis": [{ "at": 1.2, "scale": 1.15, "duration": 0.5 }],
      "composition": {
        "type": "Sequence",
        "children": [
          {
            "type": "Layer",
            "name": "Background",
            "content": { "type": "Background", "background_preset": "grid_flow", "colors": ["#0a0a1a", "#1e40af", "#7c3aed"], "speed": 1.2 }
          },
          {
            "type": "Layer",
            "name": "Frosted Card",
            "content": { "type": "Shape", "shape_type": "rectangle", "fill": "rgba(255,255,255,0.06)", "stroke": "#38bdf8", "stroke_width": 1.5, "corner_radius": 24 },
            "style": { "left": "15%", "top": "18%", "width": "70%", "height": "60%" },
            "floating": true,
            "animations": [
              { "property": "scale",   "from": 0.88, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "spring" },
              { "property": "opacity", "from": 0,    "to": 1,   "duration": 0.3, "delay": 0.2, "easing": "ease-out" }
            ]
          },
          {
            "type": "Layer",
            "name": "Metric Counter",
            "content": { "type": "Counter", "value": 450, "prefix": "$", "suffix": "M", "title": "CAPITAL RAISED", "font_size": 84, "color": "#facc15" },
            "style": { "left": "20%", "top": "28%", "width": "60%", "height": "32%" },
            "animations": [
              { "property": "translateY", "from": 40, "to": 0, "duration": 0.6, "delay": 0.4, "easing": "spring" },
              { "property": "opacity",    "from": 0,  "to": 1, "duration": 0.4, "delay": 0.4, "easing": "ease-out" }
            ]
          },
          {
            "type": "Layer",
            "name": "Kinetic Headline",
            "content": { "type": "Text", "text": "Record funding round", "font": "Outfit", "weight": "700", "color": "#f1f5f9", "animation_mode": "words_stagger", "highlight_words": ["Record"], "highlight_color": "#facc15", "style": { "fontSize": "40px", "textAlign": "center" } },
            "style": { "left": "10%", "bottom": "18%", "width": "80%" },
            "animations": [
              { "property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.7, "easing": "ease-out" }
            ]
          }
        ]
      }
    }
  ]
}
```

---

## 4. Portrait Mode Layout Adjustments

When `video_format` is portrait:
- Lower-thirds: `bottom: "28%"` (not `18%`)
- Hero card height: `"height": "55%"` max (subtitle zone is larger)
- Text width: `"width": "84%"` (narrower canvas)
- Counter `font_size`: increase to `96`–`120` for portrait readability

{visual_rules}
