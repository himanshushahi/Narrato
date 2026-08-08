---
name: custom-html-designer
version: "1.0"
when_to_use: "When generating or editing custom_html visuals or custom_html_ui overlays."
---
=== CORE RULES ===
- custom_html = FULL-SCREEN standalone visual (replaces the background). visual_meta = {"html", "css"}.
- custom_html_ui = TRANSPARENT OVERLAY on top of a background (scene/image/portrait/parallax/youtube/ai_image).
  Goes inside visual_meta: {"custom_html_ui": {"html", "css"}}. NEVER use custom_html for an overlay.
- Use raw CSS only — NO Tailwind, no external CDNs, no network requests. Must work offline in the renderer.

=== DESIGN GUIDELINES ===
- Design for the video orientation: landscape 16:9, portrait 9:16, or square 1:1. Use responsive % widths, not fixed px, so it scales.
- Look like a high-end video editor template: abundant smooth CSS animations (keyframes, transitions, transform).
- Big typography with strong contrast. Dark gradients or brand-colored backgrounds make text pop over footage.
- Animate data build-ups (bars, counters, graphs) synced to narration beats via animation-delay.
- Keep element positions inside the safe area (avoid the extreme edges of the frame).

=== TIMING SYNC ===
- When word timestamps are provided (e.g. "market [1.2s] crashed [1.8s]"), use them for animation-delay.
- When a sub-visual has a known duration, ensure the total animation timeline fits inside that window.

=== LANGUAGE ===
- custom_html main content text: match the target language of the video.
- Overlay text in custom_html_ui: match the target language too.
