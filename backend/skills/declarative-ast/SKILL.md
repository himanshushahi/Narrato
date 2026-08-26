---
name: declarative-ast
description: Learn how to generate the Declarative AST for the video rendering engine.
---

# Declarative AST Architecture

You are the director of a video generation engine. Instead of providing rigid templates, you must construct an Abstract Syntax Tree (AST) representing the visual composition. 

The AST is composed of `Sequence` nodes (which hold children) and `Layer` nodes (which hold content).

## Schema
The engine parses a top-level `composition` property for every scene's sub_visual.

```json
{
  "sub_visuals": [
    {
      "composition": {
        "type": "Sequence",
        "children": [
          {
            "type": "Layer",
            "z_index": 0,
            "content": {
              "type": "Image",
              "query": "cinematic wide shot of a futuristic city",
              "source": "pexels"
            },
            "animations": [
              {
                "property": "scale",
                "from": 1.0,
                "to": 1.2,
                "duration": 5.0,
                "easing": "ease-in-out"
              }
            ]
          },
          {
            "type": "Layer",
            "z_index": 10,
            "content": {
              "type": "Text",
              "text": "THE FUTURE",
              "color": "#ffffff",
              "font": "Outfit",
              "style": {
                "position": "absolute",
                "bottom": "10%",
                "left": "5%",
                "fontSize": "80px",
                "textAlign": "left",
                "textShadow": "0 4px 20px rgba(0,0,0,0.8)"
              }
            },
            "animations": [
              {
                "property": "opacity",
                "from": 0.0,
                "to": 1.0,
                "duration": 1.0,
                "easing": "linear"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

## Content Types
The `content` object inside a `Layer` must have a `type`:
- `Image` or `Video`: Provide `query` and `source` (`pexels`, `pixabay`, `wikipedia`). The engine will automatically search and download these assets.
- `Text`: Provide `text`, `color`, `font`, and `weight`.
- `Map`: Provide `map_style` (e.g., `modern_dark`) and an array of `locations` (e.g. `[{"name": "London", "coord": [51.5074, -0.1278]}]`).
- `HTML`: Provide `html_content` containing raw HTML/CSS or inline `<svg>` elements with `<style>` blocks for keyframe animations (like stroke-dashoffset path drawing).

**These are the ONLY valid content types.** Do not use any other type value.

## The `style` Property (CRITICAL)
Every layer's `content` can include a `style` object with CSS properties that control layout and positioning.
Without `style`, layers default to fullscreen stacked — which looks like a boring slideshow.

**Use `style` to create dynamic compositions:**

### Split Screen
```json
{"type": "Layer", "z_index": 0, "content": {"type": "Image", "query": "old computer lab", "source": "pexels", "style": {"width": "50%", "height": "100%", "left": "0", "top": "0", "objectFit": "cover"}}}
{"type": "Layer", "z_index": 1, "content": {"type": "Image", "query": "modern server room", "source": "pexels", "style": {"width": "50%", "height": "100%", "right": "0", "top": "0", "objectFit": "cover"}}}
```

### Picture-in-Picture
```json
{"type": "Layer", "z_index": 0, "content": {"type": "Video", "query": "data center timelapse", "source": "pexels", "style": {"width": "100%", "height": "100%", "objectFit": "cover"}}}
{"type": "Layer", "z_index": 5, "content": {"type": "Image", "query": "portrait of scientist", "source": "wikipedia", "style": {"width": "30%", "height": "30%", "top": "5%", "right": "5%", "borderRadius": "16px", "objectFit": "cover", "boxShadow": "0 8px 32px rgba(0,0,0,0.5)"}}}
```

### Lower-Third Text
```json
{"type": "Layer", "z_index": 10, "content": {"type": "Text", "text": "THE TURNING POINT", "color": "#ffffff", "font": "Oswald", "weight": 700, "style": {"position": "absolute", "bottom": "8%", "left": "5%", "width": "90%", "fontSize": "56px", "textAlign": "left", "letterSpacing": "4px"}}}
```

### Multi-Image Collage
```json
{"type": "Layer", "z_index": 0, "content": {"type": "Image", "query": "newspaper headline", "source": "pexels", "style": {"width": "55%", "height": "55%", "top": "5%", "left": "3%", "objectFit": "cover", "borderRadius": "12px", "boxShadow": "0 4px 20px rgba(0,0,0,0.4)"}}}
{"type": "Layer", "z_index": 1, "content": {"type": "Image", "query": "courtroom interior", "source": "pexels", "style": {"width": "45%", "height": "45%", "bottom": "5%", "right": "3%", "objectFit": "cover", "borderRadius": "12px", "boxShadow": "0 4px 20px rgba(0,0,0,0.4)"}}}
```

### Texture Overlay with Blending
```json
{"type": "Layer", "z_index": 0, "content": {"type": "Image", "query": "dark forest aerial", "source": "pexels"}}
{"type": "Layer", "z_index": 5, "content": {"type": "Image", "query": "film grain noise texture", "source": "pexels"}, "filters": ["opacity(0.3)", "mix-blend-mode: overlay"]}
```

### Native Motion Graphics (SVG/HTML)
```json
{"type": "Layer", "z_index": 10, "content": {"type": "HTML", "html_content": "<style>@keyframes draw { to { stroke-dashoffset: 0; } }</style><svg width='100%' height='100%' viewBox='0 0 100 100'><path d='M10 50 Q 50 10 90 50' fill='transparent' stroke='#00F5D4' stroke-width='2' stroke-dasharray='100' stroke-dashoffset='100' style='animation: draw 2s forwards;' /></svg>"}}
```

## Standardized Z-Index Hierarchy (STRICT)
All layers must strictly use the following Z-index ranges to prevent visual clobbering:
- `0 - 9`: Backgrounds (Fullscreen Images, Videos, Maps, ambient textures)
- `10 - 29`: Midground (Picture-in-Picture insets, multi-image collages, animated SVG charts, vector shapes)
- `30 - 39`: Foreground Text (Lower-third titles, kinetic typography, callout quotes)
- `40 - 50`: Scene UI & Chapter Badges (Chapter titles, milestone pills, header badges)

## Subtitle Safe Areas & Dodging (`subtitle_position`)
Subtitles are rendered as an active kinetic typography track.
- **Landscape (16:9)**: Bottom 15% is reserved for subtitles. Position lower-third text above `bottom: 18%` or use top/left/right coordinates.
- **Portrait (9:16)**: Bottom 25% is reserved for stacked mobile captions. Position lower-third text above `bottom: 28%`.
- **Dynamic Subtitle Dodging**: Each sub-visual object can optionally declare `"subtitle_position"`:
  - `"bottom"` (default)
  - `"top"`: Moves subtitles to top (useful when bottom area contains documents, maps, or data to read)
  - `"hidden"`: Temporarily suppresses subtitles (useful for dense full-screen charts)

```json
{
  "sub_visuals": [
    {
      "subtitle_position": "top",
      "transition": "fade",
      "duration": 4.0,
      "composition": { ... }
    }
  ]
}
```

## Chapter Title Layers (Sub-Visual 0 of Each Scene)
In the **first sub-visual of every scene (sub-visual 0)**, you MUST include a Chapter Title layer (`z_index: 40 - 50`) that introduces the scene title:
```json
{
  "type": "Layer",
  "z_index": 45,
  "content": {
    "type": "Text",
    "text": "CHAPTER 1: THE DISCOVERY",
    "font": "Outfit",
    "weight": "800",
    "style": {
      "position": "absolute",
      "top": "5%",
      "left": "5%",
      "fontSize": "22px",
      "letterSpacing": "2px",
      "textTransform": "uppercase",
      "color": "#f8fafc",
      "padding": "6px 16px",
      "backgroundColor": "rgba(15, 23, 42, 0.75)",
      "borderLeft": "4px solid #f59e0b",
      "borderRadius": "6px",
      "backdropFilter": "blur(8px)"
    }
  },
  "animations": [
    { "property": "opacity", "from": 0.0, "to": 1.0, "duration": 0.4 },
    { "property": "translateX", "from": -25.0, "to": 0.0, "duration": 0.4 }
  ]
}
```

## Animations
You can apply native Remotion physics by providing an array of `animations` on any layer.
Supported properties: `scale`, `opacity`, `translateX`, `translateY`, `rotate`, `rotateX`, `rotateY`.
Supported easing: `linear`, `spring`, `ease-in`, `ease-out`, `ease-in-out`.

Use dramatic animation values for impact:
- Scale entrances: from 0.3 → 1.0 with `spring` easing
- Slide-ins: translateX from ±300 or translateY from ±200
- Rotations: rotateY from 90 → 0 for a 3D reveal
- Combine multiple properties for cinematic motion (e.g., scale + opacity + translateY simultaneously)

## Filters
You can apply standard CSS filters via the `filters` array on a layer. For example: `["blur(5px)", "brightness(0.8)"]`.
Use `brightness(0.3)` or `brightness(0.4)` on background images to make overlaid text pop.
