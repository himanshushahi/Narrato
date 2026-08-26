---
name: stock-asset-searcher
version: "1.0"
when_to_use: "When crafting search queries for stock media (Pexels photos/videos, Wikipedia images) or choosing visual_cue keywords."
---
=== STOCK KEYWORD RULES ===
- The `query` MUST always be in English, even when the video language is Hindi/Marathi/etc.
- Use 1-3 BROAD keywords optimized for stock search engines — NOT sentences.
  GOOD: "city neon"  BAD: "a sprawling city with neon lights at night"
- Prefer concrete, visually rich nouns (e.g. "mountain fog", "trading floor", "old map").
- Avoid abstract words that have no visual representation (e.g. "truth", "freedom").

=== SEARCH QUALITY ===
- For Pexels photos: add orientation hints when the video format is fixed (landscape/portrait/square).
- For Pexels videos: prefer queries with motion potential (e.g. "traffic timelapse" over "traffic").
- For Wikipedia/portrait: use the EXACT full name of the person/entity only — no descriptors.

=== FALLBACKS ===
- If a search returns nothing, broaden the query to a more generic category, then fall back to a generic scene visual.
- Never fabricate an image URL that the search API did not return.
