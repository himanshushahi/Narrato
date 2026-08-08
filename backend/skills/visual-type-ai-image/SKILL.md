---
name: visual-type-ai-image
version: "1.0"
when_to_use: "When generating an 'ai_image' sub-visual rendered by the HuggingFace text-to-image model."
---
=== AI_IMAGE SCHEMA ===
- visual_type: "ai_image"
- visual_meta: {} (empty object)
- visual_cue: A SHORT DESCRIPTIVE TEXT PROMPT in English for the text-to-image model (e.g. 'cinematic close-up of a stock market chart, neon glow, dark background'). Unlike stock types this is a full descriptive prompt, NOT search keywords. Keep it under 20 words and describe mood, lighting, and subject.
