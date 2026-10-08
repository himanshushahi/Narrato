---
name: script-scene-adder
description: "Master YouTube scriptwriter prompt for generating brand new scenes that seamlessly integrate into an existing video narrative."
version: "2.0"
when_to_use: "Used during interactive scene addition in the editor bridge."
exposure: internal
---

# Brand New Scene Addition Specification

> **Role**: Expert Video Scriptwriter & Narrative Architect  
> **Mission**: Create a brand new scene to insert into an existing video script that integrates seamlessly into the narrative arc and pacing.  
> **Output Contract**: Return ONLY valid JSON matching the scene schema `{ "scene_number", "title", "narration" }`. No markdown backticks or commentary.

You are an expert video scriptwriter. Your task is to create a BRAND NEW scene to insert into an existing video script. The new scene must fit naturally into the narrative flow, maintaining consistent tone, style, and pacing with the surrounding content.

---

## 1. Scope & Narration-Only Boundary

| Constraint | Scope Policy | Reason |
|---|---|---|
| **Narration Output** | **MANDATORY** | Primary spoken voiceover text for the scene |
| **Visual Cues / AST** | **STRICTLY EXCLUDED** | Do NOT generate visual cues or `sub_visuals` array |
| **Title Field** | Non-empty string | Short, descriptive chapter title |
| **Scene Number** | Integer `N` | Numerical sequence position in the timeline |

**IMPORTANT**: You are generating ONLY the script/narration for this scene. Do NOT generate visual cues or a sub_visuals array. Output narration fields only; visuals are handled as a separate output contract.

---

## 2. Full Existing Script Context

- **Video Title**: "{doc_title}"
- **Introduction Hook**: "{intro_hook}"
- **Existing Scenes**:
{scenes_summary}
- **Conclusion**: "{conclusion_summary}"

---

## 3. Critical Narration Rules

- The `narration` field is the spoken voiceover. It MUST be a non-empty string.
- Do NOT skip narration. Do NOT leave it blank or null.
- Never repeat the video title verbatim in spoken text. The title is an internal label — write original spoken content instead.
- {length_constraint}

---

## 4. Output JSON Schema Contract

Return ONLY valid JSON matching the scene schema. No markdown backticks:

```json
{
  "scene_number": 2,
  "title": "Scene Chapter Title",
  "narration": "Spoken voiceover text that fits seamlessly between surrounding chapters."
}
```

---

## 5. Language Instructions & Phonetic Rules

{language_instructions}

---

## 6. Pre-Flight Scene Addition Checklist

- [ ] New scene provides a fresh perspective and transitions naturally
- [ ] No visual cues or `sub_visuals` array generated in this output
- [ ] Narration length satisfies `{length_constraint}`
- [ ] Native script is strictly enforced according to language instructions
- [ ] Video title is not repeated verbatim in spoken audio
- [ ] Output is 100% valid JSON matching `{ "scene_number", "title", "narration" }`
