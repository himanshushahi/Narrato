# Narrato Agent Skills Registry — v5.0

17 specialized AI agent skills powering the Narrato video production engine.
Skills are consumed by both the **Internal Application LLM** (via `SkillLoader.render_skill()`) and **External MCP Agents** (via `get_skill`, `get_stage_skills`, `list_skills`).

---

## 1. Skill Architecture (v5.0)

**Single Source of Truth model**: `declarative-ast` is the complete capability reference.
All other visual skills reference it instead of duplicating spec content.

```
declarative-ast ──── CORE TRUTH ────────────────────────────────────
  Contains: 11 content types, full motion grammar, 10 named composition
  recipes, source selection decision tree, landscape vs portrait reference,
  layer ergonomics. All visual skills reference this.

visual-director-core ── OPERATIONAL RULES ─────────────────────────
  Contains: Pre-flight checklist, production gotchas table (14 failure
  modes), multi-layer depth architecture, entrance stagger template,
  recipe quick-pick index, visual variety checklist.

motion-graphics-designer ── CHOREOGRAPHY COOKBOOK ─────────────────
  Contains: 6 concrete entrance motion recipes, continuous motion patterns,
  exit/stagger sequences, filter application guide, kinetic typography
  reference, timing density guide.

visual-rewriter / sub-visual-rewriter ── OUTPUT CONTRACTS ──────────
  Contains: Output schema, execution rules, source matrix, portrait mode
  adjustments. No duplicated spec — reference declarative-ast for details.
```

---

## 2. Complete Skills Directory

| # | Skill | Stage | Focus | Dynamic Vars |
|---|---|---|---|---|
| **1** | [`script-outline-director`](script-outline-director/SKILL.md) | Script (Stage 1) | Chapter structure, scene breakdown | `{target_duration}`, `{min_scenes}`, `{max_scenes}`, `{per_scene_time}`, `{per_scene_words}`, `{language}`, `{script_rules_block}` |
| **2** | [`script-base-writer`](script-base-writer/SKILL.md) | Script (Stage 2) | High-retention intro hooks, summaries, CTAs | `{language}`, `{script_rules_block}`, `{sentence_rule}` |
| **3** | [`script-scene-writer`](script-scene-writer/SKILL.md) | Script (Stage 3) | Scene narration, word budgeting | `{scene_num}`, `{chapter_title}`, `{per_scene_duration}`, `{per_scene_word_target}`, `{prev_context}`, `{language}`, `{script_rules_block}`, `{sentence_rule}` |
| **4** | [`scriptwriter`](scriptwriter/SKILL.md) | Script (General) | Voiceover tone, anti-AI-isms, TTS rules | — |
| **5** | [`script-rewriter`](script-rewriter/SKILL.md) | Script Bridge | Scene rewriting & tone repair | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{language}`, `{language_instructions}`, `{length_constraint}` |
| **6** | [`script-scene-adder`](script-scene-adder/SKILL.md) | Script Bridge | Inserting new scene narrations | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{length_constraint}`, `{language_instructions}` |
| **7** | [`art-director-design-system`](art-director-design-system/SKILL.md) | Design System | Palettes, typography, CSS tokens, CTL fonts | `{video_format}`, `{language}`, `{design_guidance}` |
| **8** | [`storyboard-planner`](storyboard-planner/SKILL.md) | Visuals (Stage 1) | Beat planning, layer type decisions, recipe selection | — |
| **9** | [`declarative-ast`](declarative-ast/SKILL.md) | Visuals (Core Truth) | **All layer types, motion grammar, 10 named recipes, source decision tree, landscape/portrait reference** | — |
| **10** | [`visual-director-core`](visual-director/SKILL.md) | Visuals (Operations) | Production gotchas, depth architecture, variety checklist | — |
| **11** | [`motion-graphics-designer`](motion-graphics-designer/SKILL.md) | Visuals (Choreography) | Entrance recipes, filter guide, timing density | — |
| **12** | [`sub-visual-rewriter`](sub-visual-rewriter/SKILL.md) | Visuals Bridge | Single sub-visual AST modification | `{design_system_text}`, `{visual_rules}` |
| **13** | [`visual-rewriter`](visual-rewriter/SKILL.md) | Visuals Bridge | Multi-cut scene visual regeneration | `{design_system_text}`, `{visual_rules}` |
| **14** | [`stock-asset-searcher`](stock-asset-searcher/SKILL.md) | Media Sourcing | Pexels, Pixabay, Wikipedia, YouTube, Archive sourcing | — |
| **15** | [`search-query-optimizer`](search-query-optimizer/SKILL.md) | Research | Web search query formulation | — |
| **16** | [`subtitle-designer`](subtitle-designer/SKILL.md) | Subtitles | Contrast outlines, positioning, safe areas | — |
| **17** | [`editor-qa`](editor-qa/SKILL.md) | Verification | **14 production failure modes + pre-submission checklist** | — |

---

## 3. Grounding Gates & MCP Access Patterns

| Pipeline Stage | Mandatory Skills | One-Call Shortcut |
|---|---|---|
| **`script`** | `scriptwriter` (or `script-base-writer`) | `get_stage_skills('script', project_id)` |
| **`design`** | `art-director-design-system` | `get_stage_skills('design', project_id)` |
| **`visuals`** | `declarative-ast`, `visual-director-core`, `motion-graphics-designer` | `get_stage_skills('visuals', project_id)` |

### Progressive Disclosure (Token Saving)
1. **Lightweight TOC**: `get_skill(name, brief=True)` — metadata + section list (<300 tokens).
2. **Selective Extraction**: `get_skill(name, section="...")` — e.g. `section="Named Composition Recipes"`.
3. **One-Call Starter Pack**: `get_stage_skills(stage=...)` — satisfies quality gate in a single request.

---

## 4. Continuous Learning (LEARNINGS.md)

Core visual skills have a `LEARNINGS.md` file for capturing session observations:
- [`declarative-ast/LEARNINGS.md`](declarative-ast/LEARNINGS.md) — edge cases, new patterns
- [`visual-director/LEARNINGS.md`](visual-director/LEARNINGS.md) — operational failures
- [`motion-graphics-designer/LEARNINGS.md`](motion-graphics-designer/LEARNINGS.md) — choreography patterns

Append observations to LEARNINGS.md during sessions. Review and fold confirmed learnings into SKILL.md manually.
