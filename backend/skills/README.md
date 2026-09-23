# Remotion Canvas Agent Skills Registry

This directory contains the 17 specialized AI agent skills powering the Remotion Canvas video production engine.  
Skills are consumed by both the **Internal Application LLM** (via `SkillLoader.render_skill()`) and **External MCP Agents** (via `get_skill`, `get_stage_skills`, and `list_skills`).

---

## 1. Unified Skill Anatomy

Every skill file (`SKILL.md`) adheres to the following structural standard:

```
├── YAML Frontmatter     (name, version, description, when_to_use)
├── H1 Title & Persona   (Executive role, mission, output contract)
├── ## Section Headers   (Parsed by regex for granular MCP retrieval & TOC)
├── Markdown Tables      (High-density parameter matrices & constraint tables)
├── JSON Schemas         (Strict input/output contracts)
└── Checklists           (Pre-flight verification guards)
```

---

## 2. Complete Skills Directory Matrix

| # | Skill Name | Pipeline Stage | Primary Focus | Dynamic Template Variables |
|---|---|---|---|---|
| **1** | [`script-outline-director`](script-outline-director/SKILL.md) | Script (Stage 1) | Chapter structure, scene breakdown, pacing | `{target_duration}`, `{min_scenes}`, `{max_scenes}`, `{per_scene_time}`, `{per_scene_words}`, `{language}`, `{script_rules_block}`, `{genre_script_guidance}` |
| **2** | [`script-base-writer`](script-base-writer/SKILL.md) | Script (Stage 2) | High-retention intro hooks, summaries, CTAs | `{language}`, `{script_rules_block}`, `{sentence_rule}` |
| **3** | [`script-scene-writer`](script-scene-writer/SKILL.md) | Script (Stage 3) | Individual scene narration, word budgeting | `{scene_num}`, `{chapter_title}`, `{per_scene_duration}`, `{per_scene_word_target}`, `{prev_context}`, `{language}`, `{script_rules_block}`, `{sentence_rule}`, `{genre_script_guidance}` |
| **4** | [`scriptwriter`](scriptwriter/SKILL.md) | Script (General) | Voiceover tone, anti-AI-isms, TTS rules | — |
| **5** | [`script-rewriter`](script-rewriter/SKILL.md) | Script Bridge | Interactive scene rewriting & tone repair | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{language}`, `{language_instructions}`, `{length_constraint}` |
| **6** | [`script-scene-adder`](script-scene-adder/SKILL.md) | Script Bridge | Inserting brand new scene narrations | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{length_constraint}`, `{language_instructions}` |
| **7** | [`art-director-design-system`](art-director-design-system/SKILL.md) | Design System | Palettes, typography, CSS tokens, CTL fonts | `{video_format}`, `{language}`, `{genre_guidance}` |
| **8** | [`storyboard-planner`](storyboard-planner/SKILL.md) | Visuals (Stage 1) | Narrative visual beats, 10 visual archetypes | — |
| **9** | [`visual-director-core`](visual-director/SKILL.md) | Visuals (Stage 2) | 3-layer parallax, 11 AST primitives, camera | — |
| **10** | [`declarative-ast`](declarative-ast/SKILL.md) | Visuals (Spec) | Master AST technical specification | — |
| **11** | [`motion-graphics-designer`](motion-graphics-designer/SKILL.md) | Visuals (Motion) | Card layouts, physics springs, kinetic text | — |
| **12** | [`sub-visual-rewriter`](sub-visual-rewriter/SKILL.md) | Visuals Bridge | Targeted single sub-visual AST modification | `{design_system_text}`, `{visual_rules}` |
| **13** | [`visual-rewriter`](visual-rewriter/SKILL.md) | Visuals Bridge | Multi-cut scene visual regeneration | `{design_system_text}`, `{visual_rules}` |
| **14** | [`stock-asset-searcher`](stock-asset-searcher/SKILL.md) | Media Sourcing | Pexels, Pixabay, Wikipedia, YouTube sourcing | — |
| **15** | [`search-query-optimizer`](search-query-optimizer/SKILL.md) | Research | High-signal web search query formulation | — |
| **16** | [`subtitle-designer`](subtitle-designer/SKILL.md) | Subtitles | Contrast outlines, positioning, safe areas | — |
| **17** | [`editor-qa`](editor-qa/SKILL.md) | Verification | Pre-submission QA guardrails & math checks | — |

---

## 3. Grounding Gates & MCP Access Patterns

To guarantee video quality, the MCP server enforces grounding preconditions:

| Pipeline Stage | Mandatory Grounding Skills | One-Call Shortcut |
|---|---|---|
| **`script`** | `scriptwriter` (or `script-base-writer`) | `get_stage_skills(stage='script', project_id=...)` |
| **`design`** | `art-director-design-system` | `get_stage_skills(stage='design', project_id=...)` |
| **`visuals`** | `declarative-ast`, `visual-director-core`, `motion-graphics-designer` | `get_stage_skills(stage='visuals', project_id=...)` |

### Progressive Disclosure (Token Saving)
1. **Lightweight TOC**: Call `get_skill(name, brief=True)` to retrieve the metadata and section list (< 300 tokens).
2. **Selective Extraction**: Call `get_skill(name, section="...")` to fetch only the needed section (e.g. `section="Chart"` or `section="Pacing"`).
3. **One-Call Starter Pack**: Call `get_stage_skills(stage=...)` to satisfy the quality gate in a single request.
