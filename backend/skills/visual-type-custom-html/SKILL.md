---
name: visual-type-custom-html
version: "1.0"
when_to_use: "When the agent decides to use the custom_html visual type or custom_html_ui overlay."
---
=== ⚠️ CRITICAL DISTINCTION: custom_html (visual type) vs custom_html_ui (overlay) ===
These are TWO COMPLETELY DIFFERENT THINGS. DO NOT confuse them:

1. "custom_html" as visual_type:
   - This is a STANDALONE FULL-SCREEN VISUAL. It replaces the entire background.
   - Use when the ENTIRE visual should be a coded UI/animation (no background image/video).
   - Set visual_type = "custom_html" and visual_meta = {"html": str, "css": str}.
   - The HTML is rendered at 100% width/height as the main visual content.
   - Example use: An animated infographic, a stylized quote card, a dynamic data dashboard.

2. "custom_html_ui" as an OVERLAY inside visual_meta:
   - This is a TRANSPARENT OVERLAY that floats ON TOP of a background image/video.
   - The background comes from scene/image/portrait/parallax/youtube/ai_image.
   - Add it inside visual_meta: {"custom_html_ui": {"html": str, "css": str}}.
   - Example use: An animated label over a portrait, a styled stat counter over stock footage.
   - ONLY allowed on these types: scene, image, portrait, parallax, youtube, ai_image.

NEVER set visual_type = "custom_html" when you actually want an overlay on a background.
NEVER add custom_html_ui to data types (map, document, list, network, thread, device_mockup, custom_html).

Use raw CSS — no Tailwind. Must look like a high-end video editor template with abundant smooth CSS animations.

=== DESIGN RULES ===
- Design for the video orientation (landscape 16:9, portrait 9:16, square 1:1). Use responsive % widths, not fixed px.
- Big typography with strong contrast; dark gradients make text pop. Animate data build-ups (bars, counters, timelines).
- Keep elements inside the safe area (avoid extreme frame edges).
- No external CDNs or network requests — everything must render offline.

=== TIMING SYNC ===
- When word timestamps are provided (e.g. "market [1.2s] crashed [1.8s]"), set CSS animation-delay to match.
- Ensure the total animation timeline fits inside the sub-visual's duration window.
