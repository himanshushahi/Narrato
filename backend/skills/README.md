# Narrato Agent Skills Registry — v5.1

18 specialized AI agent skills powering the Narrato video production engine.
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

## 2. Complete Skills Directory (by audience folder)

### `shared/` — used by BOTH the internal pipeline and MCP/chat agents

| # | Skill | Stage | Focus | Dynamic Vars |
|---|---|---|---|---|
| **1** | [`script-base-writer`](shared/script-base-writer/SKILL.md) | Script (Stage 2) | High-retention intro hooks, summaries, CTAs | `{language}`, `{script_rules_block}`, `{sentence_rule}` |
| **2** | [`scriptwriter`](shared/scriptwriter/SKILL.md) | Script (General) | Voiceover tone, anti-AI-isms, TTS rules | — |
| **3** | [`art-director-design-system`](shared/art-director-design-system/SKILL.md) | Design System | Palettes, typography, CSS tokens, CTL fonts | `{video_format}`, `{language}`, `{design_guidance}` |
| **4** | [`storyboard-planner`](shared/storyboard-planner/SKILL.md) | Visuals (Stage 1) | Beat planning, layer type decisions, recipe selection | — |
| **5** | [`declarative-ast`](shared/declarative-ast/SKILL.md) | Visuals (Core Truth) | **All layer types, motion grammar, 10 named recipes, source decision tree, landscape/portrait reference** | — |
| **6** | [`visual-director-core`](shared/visual-director/SKILL.md) | Visuals (Operations) | Production gotchas, depth architecture, variety checklist | — |
| **7** | [`motion-graphics-designer`](shared/motion-graphics-designer/SKILL.md) | Visuals (Choreography) | Entrance recipes, filter guide, timing density | — |
| **8** | [`editor-qa`](shared/editor-qa/SKILL.md) | Verification | **14 production failure modes + pre-submission checklist** | — |
| **9** | [`visual-style-library`](shared/visual-style-library/SKILL.md) | Visuals (Style Looks) | **50 named visual/motion styles + AST mappings; 1 style per scene, design-token bound** | — |

### `agent-only/` — MCP/chat agent guides (never loaded by pipeline code)

| # | Skill | Stage | Focus | Dynamic Vars |
|---|---|---|---|---|
| **9** | [`stock-asset-searcher`](agent-only/stock-asset-searcher/SKILL.md) | Media Sourcing | Pexels, Pixabay, Wikipedia, YouTube, Archive sourcing | — |
| **10** | [`subtitle-designer`](agent-only/subtitle-designer/SKILL.md) | Subtitles | Contrast outlines, positioning, safe areas | — |

### `internal-only/` — pipeline/bridge stage prompts (hidden from agents)

| # | Skill | Stage | Focus | Dynamic Vars |
|---|---|---|---|---|
| **11** | [`script-outline-director`](internal-only/script-outline-director/SKILL.md) | Script (Stage 1) | Chapter structure, scene breakdown | `{target_duration}`, `{min_scenes}`, `{max_scenes}`, `{per_scene_time}`, `{per_scene_words}`, `{language}`, `{script_rules_block}` |
| **12** | [`script-scene-writer`](internal-only/script-scene-writer/SKILL.md) | Script (Stage 3) | Scene narration, word budgeting | `{scene_num}`, `{chapter_title}`, `{per_scene_duration}`, `{per_scene_word_target}`, `{prev_context}`, `{language}`, `{script_rules_block}`, `{sentence_rule}` |
| **13** | [`script-rewriter`](internal-only/script-rewriter/SKILL.md) | Script Bridge | Scene rewriting & tone repair | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{language}`, `{language_instructions}`, `{length_constraint}` |
| **14** | [`script-scene-adder`](internal-only/script-scene-adder/SKILL.md) | Script Bridge | Inserting new scene narrations | `{doc_title}`, `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`, `{length_constraint}`, `{language_instructions}` |
| **15** | [`visual-rewriter`](internal-only/visual-rewriter/SKILL.md) | Visuals Bridge | Multi-cut scene visual regeneration | `{design_system_text}`, `{visual_rules}`, `{style_block}` |
| **16** | [`sub-visual-rewriter`](internal-only/sub-visual-rewriter/SKILL.md) | Visuals Bridge | Single sub-visual AST modification | `{design_system_text}`, `{visual_rules}`, `{style_block}` |
| **17** | [`search-query-optimizer`](internal-only/search-query-optimizer/SKILL.md) | Research | Web search query formulation | — |

---

## 2b. Audience Split (folder + `exposure` frontmatter flag)

Skills live in audience folders — `shared/`, `agent-only/`, `internal-only/` —
and each `SKILL.md` carries a matching `exposure: agent|internal` flag that drives
`list_skills`/`get_skill` filtering at runtime (so the folder layout and the
loader can never silently disagree).

- **`exposure: agent`** (11 skills) — offered to MCP/chat agents via `list_skills`/`get_skill`:
  `scriptwriter`, `script-base-writer`, `art-director-design-system`,
  `storyboard-planner`, `declarative-ast`, `visual-director-core`,
  `motion-graphics-designer`, `stock-asset-searcher`, `subtitle-designer`, `editor-qa`,
  `visual-style-library`.
- **`exposure: internal`** (7 skills) — pipeline/bridge stage prompts with code-filled
  template vars (`{target_duration}`, `{scene_num}`, `{doc_title}`, …). Loaded directly
  by `pipeline/ai.py` and `core/bridge.py`; hidden from agent listings and refused
  by `get_skill` with `SKILL_INTERNAL_ONLY` so agents are never offered raw templates.

`SkillLoader.get_agent_skills()` is the single filter; `get_all_skills()` (incl. internal)
remains for backend code and `append_skill_learning` name validation.

## 3. Grounding Gates & MCP Access Patterns

| Pipeline Stage | Mandatory Skills | One-Call Shortcut |
|---|---|---|
| **`script`** | `scriptwriter` (or `script-base-writer`) | `get_stage_skills('script', project_id)` |
| **`design`** | `art-director-design-system` | `get_stage_skills('design', project_id)` |
| **`visuals`** | `declarative-ast`, `visual-director-core`, `motion-graphics-designer` (+ `visual-style-library` index bundled, deep sections on demand) | `get_stage_skills('visuals', project_id)` |

### Progressive Disclosure (Token Saving)
1. **Lightweight TOC**: `get_skill(name, brief=True)` — metadata + section list (<300 tokens).
2. **Selective Extraction**: `get_skill(name, section="...")` — e.g. `section="Named Composition Recipes"`.
3. **One-Call Starter Pack**: `get_stage_skills(stage=...)` — satisfies quality gate in a single request.

---

## 4. Continuous Learning (LEARNINGS.md)

Core visual skills have a `LEARNINGS.md` file for capturing session observations:
- [`shared/declarative-ast/LEARNINGS.md`](shared/declarative-ast/LEARNINGS.md) — edge cases, new patterns
- [`shared/visual-director/LEARNINGS.md`](shared/visual-director/LEARNINGS.md) — operational failures
- [`shared/motion-graphics-designer/LEARNINGS.md`](shared/motion-graphics-designer/LEARNINGS.md) — choreography patterns

Append observations to LEARNINGS.md during sessions. Review and fold confirmed learnings into SKILL.md manually.
