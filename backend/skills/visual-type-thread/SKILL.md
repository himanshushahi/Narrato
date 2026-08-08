---
name: visual-type-thread
version: "1.0"
when_to_use: "When generating simulated social media or chat conversations."
---
=== THREAD SCHEMAS ===
- visual_type: "thread"
- visual_meta: {"platform": "whatsapp"|"imessage"|"twitter"|"discord", "messages": [{"sender": str, "text": str, "is_self": bool}], "title": str}
