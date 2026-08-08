---
name: visual-type-document
version: "1.0"
when_to_use: "When generating a document visual"
---
=== DOCUMENT RULES (ARCHIVAL / EVIDENCE VISUALS) ===
- ALWAYS set "show_image": false in document visual_meta.
- DO NOT generate "image_url" or "image_caption" fields.
- The user will manually upload archival/evidence images themselves.
- Focus on writing compelling text content: headline, doc_text, highlight_text, pull_quote.

=== SCHEMA ===
- visual_type: "document"
- visual_meta: {"title": str, "headline": str, "subtitle": str, "doc_text": str, "highlight_text": str, "source": str, "date": str, "section": str, "pull_quote": str, "show_image": false}
