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
