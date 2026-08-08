---
name: visual-director-core
version: "1.0"
when_to_use: "Always loaded during bulk scene visual generation."
---
=== MAXIMIZE CREATIVITY & DYNAMIC VISUALS ===
Be extremely creative! Build a visually engaging video:
- If explaining a concept, use a 'network' diagram.
- If making a claim, use a 'document' to flash dramatic evidence on screen.
- If showing data, use a dynamic 'list' or 'network'.
- Use 'visual_meta' to write evocative copy, inject dramatic headlines, and compose visually stunning overlays.

=== QUANTITY & TIMING ===
- Break narration into logical visual beats — one sub-visual per beat.
- Each sub-visual: 2-15 seconds. The sum MUST equal the Total Scene Duration.
- For 'list' type: create 1 sub-visual PER LIST ITEM.
- Vary transitions: subtle_slide, fade, slide_left, slide_right, slide_up, slide_down, zoom_in, zoom_out, glitch, none.

=== VALID VISUAL TYPES (USE ONLY THESE) ===
map | document | portrait | scene | image | youtube | parallax | network | list | custom_html | thread | device_mockup | ai_image

=== TYPE SELECTION GUIDE — CHOOSE THE RIGHT VISUAL ===
- list: Ranked items, countdowns, top-N lists, step-by-step. E.g. "Top 5", "How to".

- map: Geography, routes, locations, territories, borders.
- document: Factual claims, news events, classified archives, archival evidence. (See DOCUMENT RULES below.)

- network: Connections between people, organizations, relationships.
- portrait: Specific people or entities. visual_cue = person's EXACT FULL NAME only (used as Wikipedia search query). Do NOT add descriptive words — just the name. E.g. "Harshad Mehta", not "Harshad Mehta stockbroker".
- parallax: Dramatic visual reveals with layered 3D depth.
- custom_html: A FULL-SCREEN standalone visual type. See CRITICAL DISTINCTION below.
- thread: Simulated social media / chat conversations.
- device_mockup: Content inside a realistic device frame (iphone/macbook).
- scene/image/ai_image: Default fallback (ai_image = AI-generated via HuggingFace). visual_cue MUST be 1-3 broad keywords optimized for stock photo search engines (e.g. 'city neon' instead of 'a sprawling city with neon lights at night').
- youtube: Real-world footage.

Use `get_visual_type_rules` tool if you need exact schemas and rules for complex visual types like `custom_html` or `document`. For simple types like `scene`, `image`, `ai_image`, use an empty `visual_meta: {}`.
