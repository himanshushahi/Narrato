# Complete LLM Calls Guide — Remotion Canvas

> **Purpose:** a single, beginner-friendly reference for *every* AI call the app makes.
> For each call you will find: **what it does, who triggers it, what context is
> pre-loaded into the prompt, what context the model can pull on-demand via tools,
> which tools it may use, how many turns / tools per turn it gets, what schema it
> must return, and what happens if it fails.**
>
> Code references look like `backend/pipeline/ai.py:914`. Open them to see the exact code.

---

## Table of contents

1. [Big picture in 60 seconds](#1-big-picture-in-60-seconds)
2. [The one choke point: `_call_llm_json`](#2-the-one-choke-point-_call_llm_json)
3. [The agent loop: `AgentRunner.run_with_tools`](#3-the-agent-loop-agentrunnerrun_with_tools)
4. [Turn & tool budgets (the numbers)](#4-turn--tool-budgets-the-numbers)
5. [Pre-loaded vs on-demand context (the core idea)](#5-pre-loaded-vs-on-demand-context-the-core-idea)
6. [Skills catalogue (pre-loaded vs on-demand)](#6-skills-catalogue-pre-loaded-vs-on-demand)
7. [Tools catalogue (all 11 tools)](#7-tools-catalogue-all-11-tools)
8. [Tool allowlists — which call may use which tool](#8-tool-allowlists--which-call-may-use-which-tool)
9. [Every LLM call, in order](#9-every-llm-call-in-order)
   - [9.0 Search-query optimizer](#90-search-query-optimizer-micro-call)
   - [9.1 Design system](#91-design-system-1-call-per-project)
   - [9.2 Script outline](#92-script-outline-1-call-per-script-run)
   - [9.3 Script base (intro + conclusion)](#93-script-base-intro--conclusion-1-call-per-script-run)
   - [9.4 Script scene narration (N calls, parallel, agentic)](#94-script-scene-narration-n-calls-parallel-agentic)
   - [9.5 Visual storyboard plan (1 call per scene)](#95-visual-storyboard-plan-1-call-per-scene-non-agentic)
   - [9.6 Visual AST generation (1 agentic run per scene)](#96-visual-ast-generation-1-agentic-run-per-scene)
   - [9.7 Visual self-correction loops](#97-visual-self-correction-loops-no-extra-prompt-needed)
   - [9.8 Bridge: rewrite script section](#98-bridge-rewrite-script-section-interactive)
   - [9.9 Bridge: regenerate scene visuals](#99-bridge-regenerate-scene-visuals-interactive)
   - [9.10 Bridge: rewrite single sub-visual cut](#910-bridge-rewrite-single-sub-visual-cut-interactive)
   - [9.11 Bridge: add scene with AI](#911-bridge-add-scene-with-ai-interactive)
10. [No nested LLM calls (by design)](#10-no-nested-llm-calls-by-design)
11. [Validation, repair & fallback chain](#11-validation-repair--fallback-chain)
12. [Caching, telemetry & cost tracking](#12-caching-telemetry--cost-tracking)
13. [Quick-reference master table](#13-quick-reference-master-table)
14. [How to add a new LLM call or tool](#14-how-to-add-a-new-llm-call-or-tool)

---

## 1. Big picture in 60 seconds

There are only **two execution paths**, both funnel through one function:

```
USER ACTION
 ├── Pipeline run (bulk generation, background workers)
 │    ├── Script pipeline   → outline → intro/conclusion → N × scene narration
 │    └── Visuals pipeline  → design system → per scene: storyboard plan → AST visuals
 └── Editor bridge (interactive, one click in the UI)
      ├── rewrite script section / add scene
      └── regenerate scene visuals / rewrite single sub-visual cut

ALL OF THE ABOVE ──► AgentRunner.run_with_tools ──► _call_llm_json ──► LLM provider
        (backend/agent/agent_engine.py)      (backend/pipeline/ai.py:914)
```

* **Pipeline mode** = autonomous bulk work, runs on worker threads, larger turn budgets.
* **Bridge mode** = one targeted edit from the editor chat, must stay fast (small budgets).
* **No LLM call ever hits the network directly.** Everything goes through
  `_call_llm_json` (`backend/pipeline/ai.py:914`), which adds retries, caching,
  telemetry, token counting and schema enforcement in one place.

---

## 2. The one choke point: `_call_llm_json`

File: `backend/pipeline/ai.py:914`

Signature (simplified):

```python
_call_llm_json(system_prompt, user_prompt, schema,
               cancel_event, return_raw=False, activity_label=None)
```

What it does on **every** call, in order:

| Step | What happens | Where |
|---|---|---|
| 1. Resolve config | Reads `openai_api_key`, `openai_base_url`, `openai_model`, `temperature`, `max_tokens`, `top_p` from the settings DB. Raises if no key. | `ai.py:836` |
| 2. Force Chain-of-Thought | If a schema is requested and the system prompt has no `<think>` instruction, appends: *"think step-by-step inside `<think>...</think>`, then output ONLY JSON"*. | `ai.py:943` |
| 3. Reasoning token boost | If the model looks like a reasoning model (`deepseek`, `r1`, `qwq`, `nemotron`, `llama`, …) **or** `max_tokens <= 4096`, boosts `max_tokens` to **16384** so thinking tokens don't eat the JSON output. | `ai.py:958` |
| 4. Disk cache lookup | Key = provider + model + temperature + max_tokens + top_p + prompt hashes + API-key hash + `S` (strict) / `L` (loose tool-loop) flag. TTL **30 days**, max **2000 entries** (`backend/agent/cache.py`). | `ai.py:969`, `cache.py:22` |
| 5. Streaming call | Calls the OpenAI-compatible endpoint with `stream=True`, `response_format={"type":"json_object"}` when a schema exists. Falls back to non-streaming if the stream is empty; retries with 4× tokens if reasoning tokens exhausted the budget. | `ai.py:985` |
| 6. Retries | Up to **5 attempts**: exponential backoff on 429 rate-limit; strips `response_format` and retries on 400 (providers that don't support it). Optional fallback provider if configured. | `ai.py:1006` |
| 7. Parse & validate | `clean_json_response()` strips `<think>` blocks, markdown fences, repairs truncated JSON; then `parse_and_validate_model()` coerces through the Pydantic schema. | `ai.py:1101` |
| 8. Cache + telemetry | Successful non-empty responses are cached; a `llm` telemetry entry (`running` → `ok`/`error`) is emitted for the UI activity feed; prompt/completion tokens are recorded against the active task. | `ai.py:1085`, `telemetry.py` |

Two modes:

* **Strict mode** (`return_raw=False`, schema given) — returns a parsed + validated dict.
  Used by all plain calls (outline, design, storyboard plan, final turn of agent runs).
* **Loose mode** (`return_raw=True`, schema `None`) — returns the raw text so the agent
  loop can extract ```` ```tool ```` blocks. Used for every intermediate agent turn
  (`agent_engine.py:289`).

---

## 3. The agent loop: `AgentRunner.run_with_tools`

File: `backend/agent/agent_engine.py:263`

Not every LLM call needs tools. When it does (scene narration, visual AST, all bridge
rewrites), it goes through this **ReAct loop**:

```
turn 1..N:
  1. LLM called in LOOSE mode (no schema) with:
        system_prompt + "=== AVAILABLE TOOLS ===" docs
        user_prompt (+ all previous tool results appended)
  2. Extract ```tool blocks (fenced, bare JSON, arrays — all accepted)
  3a. If tool calls found → execute (1 at a time, or up to 5 in parallel),
      append "Tool '<name>' result:\n<result>" to user_prompt, next turn
  3b. If no tool calls → try to parse final JSON
      • parses → validate via Pydantic → RETURN
      • fails + turns left → append "output ONLY valid JSON…" nudge, next turn
      • fails + last turn → one STRICT-schema call → RETURN
loop exhausted → one final strict-schema call → RETURN
```

Key details (`agent_engine.py`):

* Tool docs are **injected into the system prompt** (`_build_tool_docs`, line 238) —
  only tools in the call's allowlist are documented.
* Tool calls the model invents **outside the allowlist are rejected** with a system
  nudge (`agent_engine.py:304`), they don't execute.
* Valid calls are capped at `MAX_TOOLS_PER_TURN` **after** filtering, so disallowed
  calls can't crowd out allowed ones (`agent_engine.py:309`).
* Identical duplicate calls in one response are de-duplicated, order preserved
  (`_extract_tool_blocks`, line 107).
* `<think>...</think>` reasoning blocks are stripped before tool extraction (line 115).
* Parallel execution uses a `ThreadPoolExecutor(max_workers=min(n, 5))` with
  responsive cancellation (`agent_engine.py:338`).
* `validate_and_correct_visuals` (line 398) wraps the loop for visuals: normalises
  shape aliases (`visuals`/`subvisuals`/`composition`/`data` → `sub_visuals`), fires a
  **correction run** when output is structurally empty, and always runs
  `validate_sub_visuals` for duration math + enum normalisation.

---

## 4. Turn & tool budgets (the numbers)

Defined in `backend/agent/agent_engine.py:173-179`.

| Constant | Value | Used by |
|---|---|---|
| `MAX_AGENT_TURNS` | **4** | Default budget for interactive bridge calls (keeps UI fast). |
| `MAX_TOOLS_PER_TURN` | **8** | Max tool executions accepted per single turn, every call type. Parallel fan-out capped at 5 threads. |
| `PIPELINE_SCRIPT_TURNS` | **5** | Bulk scene-narration runs (background, not blocking UI). |
| `PIPELINE_VISUAL_TURNS` | **6** | Bulk visual-AST runs (background, needs research headroom). |
| Correction turns | **+1 full agent run** | `validate_and_correct_visuals`: one extra `run_with_tools` with the *same* budget when sub-visuals are empty/structural-invalid. Duration rounding errors are fixed **deterministically without any LLM call**. |
| Queryless-media retry | **1 strict call, no tools** | `regenerate_sub_visual` only: if an Image/Video layer lacks `query`, one `use_tools=False` retry. |
| HTTP retries | **5 attempts** | Inside `_call_llm_json` per single LLM request (429 backoff, 400 fallback). |

So the **worst-case LLM requests** for one agentic run = `turns` loose calls + 1 strict
final call (+1 full correction run for visuals in the pathological case).

---

## 5. Pre-loaded vs on-demand context (the core idea)

Every LLM call assembles its prompt from two kinds of context:

* **Pre-loaded context** — baked into `system_prompt` / `user_prompt` *before* the first
  LLM request. The model always sees it, whether it needs it or not. Costs tokens on
  turn 1 but costs zero extra turns. Examples: skill markdown, design system JSON,
  narration text, word timestamps, topic-driven design guidance.
* **On-demand context** — **not** in the prompt. The model must emit a ```` ```tool ````
  block to fetch it, spending one turn + one tool execution. Examples: web search
  results, a skill it hasn't seen yet, `project_status_report`, Pexels/Pixabay checks.
  Keeps turn-1 prompts small and lets the model skip what it doesn't need.

Rule of thumb used in this codebase:

| Pre-load when… | Fetch on-demand when… |
|---|---|
| Needed for *every* output (narration text for visuals, duration target, design system for styling, word timestamps for sync). | Only *sometimes* needed (fresh facts → `web_search`; project state → `project_status_report`; asset existence → `search_pexels_*`). |
| Small and deterministic (pacing line, duration table, neighbour layouts). | Large or unbounded (full `script.json`, whole project file listing). |
| It constrains the output format (skill rules, JSON schema description). | It verifies a hypothesis (does this photo exist? what is the current TTS voice?). |

---

## 6. Skills catalogue (pre-loaded vs on-demand)

Skills live in `backend/skills/*/SKILL.md`, loaded by `backend/agent/skill_loader.py`.
Each has frontmatter `name`, `version`, `when_to_use`. Two access paths:

* **Pre-load** — `skill_loader.render_skill(name, **vars)` (or `get_skill(name)`)
  at prompt-build time; logged as `System Prompt Preload`. Template vars like
  `{video_format}`, `{language}`, `{design_guidance}` are substituted.
* **On-demand** — the model calls the **`get_skill`** tool mid-run; logged as
  `Agent Tool Call`. Same content, fetched only if the model asks.

| Skill | v | Pre-loaded into | Also fetchable on-demand? |
|---|---|---|---|
| `script-outline-director` | 1.0 | §9.2 outline system prompt (+ `scriptwriter` rules injected as `{script_rules_block}`) | yes (`get_skill`) |
| `script-base-writer` | 1.0 | §9.3 intro/conclusion system prompt (+ `scriptwriter` rules) | yes |
| `script-scene-writer` | 1.0 | §9.4 per-scene system prompt (+ `scriptwriter` rules) | yes |
| `scriptwriter` | 1.0 | Injected as `{script_rules_block}` into §9.2/9.3/9.4 | yes (the scene prompt explicitly tells the model it may call `get_skill('scriptwriter')`) |
| `search-query-optimizer` | 1.0 | §9.0 query-generator system prompt | yes |
| `art-director-design-system` | 1.0 | §9.1 design system prompt (`{video_format}`, `{language}`, `{design_guidance}`) | yes |
| `storyboard-planner` | 2.0 | §9.5 plan prompt (appended after topic-driven directive) | yes |
| `visual-director-core` (+ legacy `visual-director`) | 2.0 | §9.6 visuals system prompt (`visual_director_block`); shared rules via `get_shared_visual_rules()` also used in §9.9/9.10 | yes |
| `declarative-ast` | 2.0 | §9.6 + §9.9 + §9.10 via `get_shared_visual_rules()` (+ `_visual_rules_safety_net`) | yes |
| `motion-graphics-designer` | 2.0 | §9.6 as `motion_designer_block` | yes |
| `editor-qa` | 2.0 | §9.6 as `editor_qa_block` | yes |
| `stock-asset-searcher` | 1.1 | Never pre-loaded — model is expected to already know query English-only/1-3-keyword rules from AST skills; available via `get_skill` | **on-demand only** |
| `subtitle-designer` | 1.0 | Never pre-loaded (used as reference for subtitle styling edits) | **on-demand only** |
| `script-rewriter` | 1.0 | §9.8 system prompt (`{language}`, `{doc_title}`, `{scenes_summary}`, …) | yes |
| `script-scene-adder` | 1.0 | §9.11 system prompt | yes |
| `visual-rewriter` | 1.0 | §9.9 system prompt (`{design_system_text}`, `{visual_rules}`) | yes |
| `sub-visual-rewriter` | 1.0 | §9.10 system prompt | yes |

---

## 7. Tools catalogue (all 11 tools)

Defined in `backend/agent/tools.py:get_tools_schema()`, dispatched in
`_execute_tool()`, validated by Pydantic models in
`backend/agent/schemas.py`. Every execution is wrapped with telemetry
(`tool` entry with `args` + `result`, `running` → `ok`/`error`).

### A. Research & context (read-only, available everywhere)

| Tool | What it returns | Notes |
|---|---|---|
| `web_search` | LangSearch results, formatted text (up to 5) | Needs `web_search_api_key` setting; `count` 1–5, default 3. |
| `get_skill` | Full `SKILL.md` body (`--- SKILL: <name> (v…) ---`) | Lists available skills on miss. Telemetry scope = `tool`. |
| `read_project_file` | Raw file text from `<storage>/<project_id>/<filename>` | Path-traversal guarded (`_safe_project_file`). e.g. `design.json`, `script.json`, `subtitles/transcription.json`. |
| `list_project_files` | Recursive relative file list of the project dir | Emits a `file` telemetry entry with the count. |
| `project_status_report` | Compact markdown: language/format, TTS, script structure (titles, word counts, sub-visual counts), design palette/fonts, **current visual settings**, asset readiness (`fetched/total`) | Built by `_project_status_report` in `tools.py`. The "call this first" tool. |

### B. Asset verification (read-only, visuals calls only)

> Contract: **verification only — never copy the returned URL into AST JSON.**
> Output `query` + `source`; the pipeline downloads the asset itself.

| Tool | Backend | Notes |
|---|---|---|
| `search_pexels_photo` / `search_pexels_video` | `pipeline/assets.py` | Needs `pexels_api_key`; `orientation` landscape/portrait. |
| `search_pixabay_photo` | `pipeline/assets.py` | Needs `pixabay_api_key`; extra `image_type` (`illustration`/`vector` for transparent cutouts). |
| `search_pixabay_video` | `pipeline/assets.py` | Smaller catalogue — prefer Pexels for B-roll. |
| `search_wikipedia_image` | `pipeline/assets.py` | No key; best for `portrait` entity images. |
| `search_youtube_video` | `yt-dlp ytsearch1:` | Returns title/uploader/duration or error; needs yt-dlp binary. Use `source='youtube'` + `query` in AST. |

### C. Scene & bridge mutations — NOT tools (live directly in `bridge.py`)

> Scene operations (`update_scene_duration`, `reorder_scenes`, `delete_scene`,
> `add_scene_with_ai`, `regenerate_script_section`, `regenerate_visuals_section`,
> `regenerate_sub_visual`) are **`ApiBridge` methods in `backend/core/bridge.py`**,
> called directly by the GUI (e.g. `useScriptEditing.ts`). They were previously
> also registered as agent tools, but since no allowlist ever included them, the
> wrappers were pure dead code and have been deleted. The rule going forward:
> **user-triggered mutations stay as bridge methods; the tool registry stays
> read-only** (§A–B above).

> **Removed (dead code audits):** `update_design_settings`, `update_subtitles`,
> `update_subtitle_style`, `update_visual_settings`, `update_scene_properties`,
> `set_tts_settings`, `invalidate_scene` (never allowlisted, never called from the
> GUI — the editor mutates the same files via `save_json_file` /
> `save_project_with_cleanup` / `db_update_project` directly), then
> `update_scene_duration`, `reorder_scenes`, `delete_scene`, `add_scene_with_ai`,
> `regenerate_script_section`, `regenerate_scene_visuals` (registered but
> allowlist-excluded wrappers over bridge methods). Deleted from `tools.py` +
> `schemas.py` with their write helpers (`_apply_visual_settings`,
> `_sync_sub_visual_to_manifests`, `_set_section_sub_visuals`, `_invalidate_voiceover`,
> `_deep_merge`, `_to_int`). The visual-settings spec tables are kept as a read-only
> reference for `project_status_report`.

---

## 8. Tool allowlists — which call may use which tool

Enforced in `backend/agent/agent_engine.py:184-220`. The prompt only documents allowed
tools, and disallowed attempts are rejected without executing.

| Allowlist constant | Members | Used by |
|---|---|---|
| `SCRIPT_NARRATION_TOOLS` | `web_search`, `get_skill`, `read_project_file`, `list_project_files`, `project_status_report` | §9.4 pipeline scene narration |
| `PIPELINE_VISUAL_TOOLS` | above 5 **+** `search_pexels_photo`, `search_pexels_video`, `search_wikipedia_image`, `search_pixabay_photo`, `search_pixabay_video`, `search_youtube_video` (11 total) | §9.6 pipeline visuals |
| `BRIDGE_SCRIPT_TOOLS` | same 5 as script narration | §9.8 rewrite script, §9.11 add scene |
| `BRIDGE_VISUAL_TOOLS` | same 11 as pipeline visuals | §9.9 regenerate scene visuals, §9.10 single-cut rewrite |
| `BRIDGE_ADD_SCENE_TOOLS` | same 5 (narration-only; visuals added later) | §9.11 |
| Full registry (no allowlist) | all 11 | Only when `_call_llm_safe(..., use_tools=True)` is invoked without `allowed_tools` (currently no production path does this — all bridge methods pass an allowlist). |

Every registered tool appears in at least one allowlist above — there are no
orphan tools. Scene/bridge mutations are not tools at all: the GUI calls the
underlying `ApiBridge` methods directly (§7C).

---

## 9. Every LLM call, in order

### 9.0 Search-query optimizer (micro-call)

* **File:** `backend/pipeline/ai.py:81` (`_generate_search_query`), via
  `_get_web_context_for_topic` (`ai.py:55`).
* **Trigger:** before outline (§9.2), base (§9.3), and every bridge rewrite/add
  (§9.8–9.11) — whenever web search is enabled **and** keyed.
* **Pre-loaded:** system = `search-query-optimizer` skill (fallback: inline "ONE query,
  max 12 words" instruction); user = `Section: <stage>\nTopic: <context>\nSearch query:`.
* **On-demand:** none (plain call, no tools).
* **Budget:** 1 strict call, `temperature=0.3`, `max_tokens=2048`. Never blocks:
  any failure → falls back to `clean_search_query(context)` (strip non-Latin script).
* **Output:** raw query string; `<think>` stripped; last valid ≤15-word line kept.
* **Then:** `_get_web_context` (`ai.py:19`) runs LangSearch (`count=5`) and returns
  formatted text (or `""` when disabled/keyless/failed). The formatted block is
  **appended to the parent call's user prompt** — it is pre-loaded context for the
  parent, produced by this micro-call.

### 9.1 Design system (1 call per project)

* **File:** `backend/pipeline/ai.py:280` (`generate_project_design_system`).
* **Trigger:** start of `generate_visuals_pipeline`, or any visuals run when
  `design.json` is missing/invalid/language-changed/format-changed/failed.
  Valid cached file → **zero LLM calls**.
* **Pre-loaded system:** `art-director-design-system` skill rendered with
  `{video_format}`, `{language}`, `{design_guidance}` (topic-derived variety lane).
  Fallback: inline art-director brief (honours Noto-font rule for complex scripts).
* **Pre-loaded user:** `Topic / Language / Video Title / Request ID (uuid — defeats
  cache collisions)`.
* **On-demand:** none (plain `_call_llm_json`, no agent loop).
* **Budget:** 1 strict call, schema `DesignSystemResponse` (theme, palette hexes,
  typography, css guidelines), `activity_label="Design System"`.
* **Repair:** `_repair_design_data` fills missing keys, fixes non-hex colours,
  swaps Latin-only fonts (Oswald/Outfit/…) for the language's Noto font; missing
  required keys → `{"theme_name":"default","_failed":True,…}` fallback. Saved with
  `_language/_video_format` stamps; later synced (setdefault-only) into
  `project_settings`.

### 9.2 Script outline (1 call per script run)

* **File:** `backend/pipeline/ai.py:1177` (Stage 1, call at line 1324).
* **Trigger:** every `generate_script_pipeline` run.
* **Pre-loaded system:** `script-outline-director` skill
  (`{script_rules_block}` = `scriptwriter` skill, `{target_duration}`,
  `{min_scenes/max_scenes}`, `{per_scene_time/words}`, `{language}`).
  Inline fallback mirrors the same constraints.
* **Pre-loaded user:** topic, duration/frame count,
  language, chapter-count + word-count requirements, chapter JSON shape. **Plus
  web context** (`_get_web_context_for_topic(topic, "outline generation")`)
  appended when available.
* **Scene-count table** (landscape unless noted):

  | format | mode | scenes | target |
  |---|---|---|---|
  | landscape | medium | 20–30 | 300 s |
  | landscape | long | 40–55 | 600 s |
  | landscape | extra_long | 60–75 | 900 s |
  | portrait | short | 4–6 | 60 s |
  | portrait | medium | 6–8 | 90 s |
  | portrait | long | 8–12 | 120 s |

* **On-demand:** none (plain strict call — outline has no agent loop).
* **Budget:** 1 strict call, schema `OutlineResponse`, `activity_label="Script Outline"`.
* **Repair:** `_extract_chapters_from_outline` accepts `chapters/outline/scenes/sections/…`
  aliases and string chapters; zero chapters → deterministic fallback chapters so the
  run always progresses.

### 9.3 Script base — intro & conclusion (1 call per script run)

* **File:** `backend/pipeline/ai.py:1177` (Stage 2, call at line 1440).
* **Pre-loaded system:** `script-base-writer` skill (`{script_rules_block}`,
  `{target_duration}`, `{language}`, `{sentence_rule}`) — hook/summary/CTA lengths,
  TTS-friendly writing (numbers as words, no abbreviations/special chars), native-script
  mandate. Inline fallback included.
* **Pre-loaded user:** topic, duration/format/language/voiceover-speed header, **full
  outline JSON**, hook/summary/CTA word budgets, speaking-voice visualisation brief,
  expected `{"introduction":{"hook"},"conclusion":{"summary","cta"}}` shape. **Plus web
  context** (`"introduction & conclusion"` stage) appended when available.
* **On-demand:** none (plain strict call).
* **Budget:** 1 strict call, schema `BaseScriptResponse`, `activity_label="Base Script"`.
* **Repair:** `_extract_base_script` accepts `intro/opening`, `outro/ending`, flat
  `hook/summary/cta` aliases; empty fields → deterministic fallback sentences.

### 9.4 Script scene narration (N calls, parallel, agentic)

* **File:** `backend/pipeline/ai.py:1457` (`generate_single_scene`, executed at 1612).
* **Trigger:** once per outline chapter (N = 4–75 depending on table above), run on a
  `ThreadPoolExecutor(max_workers = llm_concurrency setting, default 1)`.
* **Pre-loaded system:** `script-scene-writer` skill (`{script_rules_block}`,
  `{scene_num/chapter_title}`, `{per_scene_duration/word_target}`, `{prev_context}`,
  `{language}`, `{sentence_rule}`) — includes an **AGENT TOOL
  USE** paragraph telling the model it may use web/skill/project tools before writing.
* **Pre-loaded user:** topic, scene identity (number/title/context/previous context),
  audience scenario, duration + word target (recalculated from *actual* chapter count:
  `(target−15) // actual_count`, language-aware WPM: hi 4.5, en 3.0, …), TTS rules,
  strict scene-boundary rules (no intro/outro wrapping), expected
  `{"scene_number","title","narration"}` shape. **No web context appended** — the agent
  is expected to search for itself if facts are missing.
* **On-demand tools:** `SCRIPT_NARRATION_TOOLS` (5: `web_search`, `get_skill`,
  `read_project_file`, `list_project_files`, `project_status_report`).
* **Budget:** `max_turns=PIPELINE_SCRIPT_TURNS` (**5**), `MAX_TOOLS_PER_TURN` **8**,
  schema `ScriptSceneResponse`, `base_activity_label="Scene Narration"`.
* **Repair:** alias unwrap (`scene/data`, `narr/text/content/script/voiceover` →
  `narration`); empty narration → `"{title}: {context}"` fallback + warning; every
  result forced to the outline's `scene_number`.

### 9.5 Visual storyboard plan (1 call per scene, non-agentic)

* **File:** `backend/pipeline/ai.py:2080` (`process_scene`, plan call at line 2193).
* **Trigger:** once per manifest entry whose narration/design changed (unchanged scenes
  are **preserved with duration rescaling — zero LLM calls**, `ai.py:2143`).
* **Pre-loaded system:** topic-driven cinematographer brief +
  `storyboard-planner` skill body. Contains the project ID as `[System Context]`.
* **Pre-loaded user:** topic, scene title, duration, full narration.
* **On-demand:** none (plain strict call with inline `{"storyboard_plan": string}` schema,
  `activity_label="Planning Scene N"`).
* **Failure:** never fatal — falls back to `"No plan available. Make creative decisions
  directly."` and generation (§9.6) proceeds.

### 9.6 Visual AST generation (1 agentic run per scene)

* **File:** `backend/pipeline/ai.py:2080` (generation at line 2219, via
  `AgentRunner.validate_and_correct_visuals`).
* **Pre-loaded system** (assembled once per run, `ai.py:1982`): project-ID header +
  `editor-qa` block + visual-director mission + **`design_system_text`** (the §9.1
  `design.json`, `_`-keys stripped) + `visual-director-core` block +
  `motion-graphics-designer` block + layer capability reference
  + output/duration/error-prevention rules +
  `get_shared_visual_rules()` (= `declarative-ast` skill + safety net: query-English,
  subtitle safe area, delay semantics, query-only media contract).
* **Pre-loaded user** (per scene): topic, scene title/type, **total duration**,
  **full narration**, **exact Whisper word timestamps** (`word [offset]…`, when the
  transcription overlaps the scene window), and the **approved storyboard plan** (§9.5).
* **On-demand tools:** `PIPELINE_VISUAL_TOOLS` (11: §8 — research + project reads +
  all 6 stock/YouTube verifiers; **no mutation tools**).
* **Budget:** `max_turns=PIPELINE_VISUAL_TURNS` (**6**), `MAX_TOOLS_PER_TURN` **8**,
  schema `VisualsArrayResponse`, `base_activity_label="Agent: scene visuals"`.
* **Post:** `validate_and_correct_visuals` normalises aliases, runs
  `validate_sub_visuals` (duration rescale + transition/enum/style sanitisation +
  query-less layer drop with gradient placeholder), fires a same-budget correction run
  only when structurally empty; total exception → single blank `Sequence` cut of full
  duration (never cancels silently). Results run in parallel (`llm_concurrency`
  workers) and are written back to both the manifest and `script.json`.

### 9.7 Visual self-correction loops (no extra prompt needed)

* **File:** `backend/agent/agent_engine.py:398`, `backend/agent/validators.py:389`.
* **Deterministic repair (0 LLM calls):** rounding drift (`|sum − target| > 0.1 s`) is
  rescaled proportionally with the remainder folded into the last cut; bad transitions
  fuzzy-mapped; `z_index` rejected; non-`Layer` children dropped; hallucinated
  `sources[]/url/local_path` normalised to query-only; `transform` folded/stripped;
  `emphasis` marks clamped. Reported as success so no LLM turn is burned.
* **Correction run (+1 agent run, same budget):** only when `sub_visuals` is missing,
  empty, or a non-list. Prompt = original user prompt + `CRITICAL REQUIREMENT: … at
  least 2–4 sub-visuals … sum to <duration>` (or the validator's `error_msg`).
* **Single-cut extras** (§9.10 only): animation `delay+duration ≤ cut` clamping
  (`bridge.py:513`) and the queryless-media retry.

### 9.8 Bridge: rewrite script section (interactive)

* **File:** `backend/core/bridge.py:1493` (`regenerate_script_section`, via
  `_call_llm_safe(..., use_tools=True)` at line 1626).
* **Trigger:** editor "rewrite intro / scene / conclusion" action.
* **Pre-loaded system:** `script-rewriter` skill (`{language}`, `{doc_title}`,
  `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`,
  `{language_instructions}`, `{length_constraint}` ≈ average scene word count).
  Inline fallback mirrors it. Full script context (title/hook/all scenes/conclusion) is
  inside the system prompt.
* **Pre-loaded user:** the original segment JSON + rewrite instruction (+ `CREATE NEW
  SECTION` variant when the segment is empty) + expected shape. **Plus web context**
  (`"script rewrite"` stage) appended when available.
* **On-demand tools:** `BRIDGE_SCRIPT_TOOLS` (5, research + reads only).
* **Budget:** default `MAX_AGENT_TURNS` **4**, `MAX_TOOLS_PER_TURN` **8**
  (`_call_llm_safe` passes no `max_turns`, so the default applies), schema
  `ScriptIntroResponse` / `ScriptConclusionResponse` / `ScriptSceneResponse` by section.
* **Post:** returned to the caller; the caller merges the new narration into
  `script.json` while preserving the existing `sub_visuals` (the bridge method
  itself only produces the text — e.g. the editor does the merge on save).

### 9.9 Bridge: regenerate scene visuals (interactive)

* **File:** `backend/core/bridge.py:1628` (`regenerate_visuals_section`, call at 1704).
* **Pre-loaded system:** `visual-rewriter` skill (`{design_system_text}` from the live
  `design.json`, `{visual_rules}` = `get_shared_visual_rules()`); inline fallback mirrors it.
* **Pre-loaded user:** video title, scene title, **pacing line**
  (`_get_pacing_line`), **narration**, **scene word timings** (exact or
  `APPROXIMATE` when narration edited since voiceover, else `NO_TIMINGS_FALLBACK`),
  **duration table** (`_format_sub_visual_durations`), previous scene's last layout
  (variety guard), current sub-visuals JSON, rewrite instruction, total duration,
  expected `{"sub_visuals":[…]}` shape.
* **On-demand tools:** `BRIDGE_VISUAL_TOOLS` (11, research + reads + stock/YouTube).
* **Budget:** default **4** turns / **8** tools per turn, schema `VisualsArrayResponse`.
* **Post:** alias unwrap (single cut / `visuals` / `subvisuals` / `data` shapes),
  proportional duration renormalisation (`>0.1 s` drift), per-cut animation-delay clamp,
  `materialize_rewrite_previews` (downloads each query into `assets/previews/` so the
  editor plays real footage instantly), returns `{"sub_visuals": […]}`.

### 9.10 Bridge: rewrite single sub-visual cut (interactive)

* **File:** `backend/core/bridge.py:1752` (`regenerate_sub_visual`, call at 1838).
* **Pre-loaded system:** `sub-visual-rewriter` skill (`{design_system_text}`,
  `{visual_rules}`); inline fallback mirrors it.
* **Pre-loaded user:** video/scene titles, pacing line, scene narration, **scene timings
  + cut-relative timings** (`_get_cut_word_timings` — values usable directly as
  animation `delay`; authoritative cut block replaces the scene block when present),
  duration table with `← EDITING THIS` marker, the cut's start offset + duration,
  previous/next cut layouts (anti-repetition guard), original cut JSON, rewrite
  instruction, expected single-cut shape.
* **On-demand tools:** `BRIDGE_VISUAL_TOOLS` (11).
* **Budget:** default **4** turns / **8** tools per turn, schema `SubVisualAST`.
* **Post (three gates):** (1) `normalize_sub_visuals_sources` first; (2) delay-clamp the
  cut; (3) **queryless-media retry** — one strict `use_tools=False` call with a
  `CORRECTION REQUIRED … layer(s) […]` prompt, adopted only if it fixes every layer
  (`bridge.py:1859`); then `materialize_rewrite_previews` for the single cut.

### 9.11 Bridge: add scene with AI (interactive)

* **File:** `backend/core/bridge.py:1888` (`add_scene_with_ai`, call at 1955).
* **Pre-loaded system:** `script-scene-adder` skill (`{language}`, `{doc_title}`,
  `{intro_hook}`, `{scenes_summary}`, `{conclusion_summary}`,
  `{language_instructions}`, `{length_constraint}` ≈ average scene words); inline
  fallback mirrors it. Explicitly narration-only ("do NOT generate visual cues").
* **Pre-loaded user:** new-scene description (+ `scene_number: 1` placeholder note).
  **Plus web context** (`"add new scene"` stage) when available.
* **On-demand tools:** `BRIDGE_ADD_SCENE_TOOLS` (5, research + reads only — no asset
  tools since `sub_visuals` is forced to `[]`).
* **Budget:** default **4** turns / **8** tools per turn, schema `ScriptSceneResponse`;
  caller stamps `sub_visuals: []` (visuals come from a later §9.9/§9.6 run).

---

## 10. No nested LLM calls (by design)

> There used to be agent tools that wrapped bridge methods (`add_scene_with_ai`,
> `regenerate_script_section`, `regenerate_scene_visuals`), which would have let an
> agent run trigger a *second, full* LLM run from inside a tool execution. Those
> wrappers were deleted (§7C): the GUI now calls `api_bridge.*` directly, so every
> bridge method (§9.8–9.11) is exactly one agent run — no recursion is possible.
> The tool registry is fully read-only, so no pipeline or bridge run can mutate the
> project mid-generation either.

---

## 11. Validation, repair & fallback chain

In order, cheapest first:

1. **Pydantic schemas** (`backend/agent/schemas.py`) — narration non-empty, hex colours
   sanitised, `LayerContent` forces `query` on Image/Video, `VisualsArrayResponse`
   rejects query-less media at response level, style keys repaired (`transform` folded
   or stripped, aliases relocated).
2. **Deterministic validators** (`validators.py:validate_sub_visuals`, bridge clamps) —
   duration rescale, transition normalisation, media/style sanitisation, emphasis
   clamping. No tokens spent.
3. **Correction runs** — same-budget agent re-run (§9.7) or single strict retry (§9.10).
4. **Shape-tolerant extraction** — `_extract_base_script`, `_extract_chapters_from_outline`,
   `validate_and_correct_visuals` alias handling, `clean_json_response` repair
   (markdown/`<think>` stripping, trailing-comma fix, truncated-tail recovery,
   `ast.literal_eval` fallback).
5. **Deterministic fallbacks** — fallback chapters/script lines, blank `Sequence` cut of
   full duration, `{"theme_name":"default","_failed":True}` design. The pipeline always
   progresses; failures are logged, never silent.
6. **Transport resilience** — 5 HTTP attempts, 429 backoff, 400 `response_format`
   strip, streaming→non-streaming→boosted-token fallbacks, optional fallback provider,
   cancellation via `cancel_event` at every wait point.

---

## 12. Caching, telemetry & cost tracking

* **Disk cache** (`backend/agent/cache.py`): SQLite at `<storage>/llm_cache.db`
  (override `NARRATO_LLM_CACHE_DB`), version `v2`, TTL 30 days, cap 2000 entries
  (oldest evicted). Key pins provider + model + temperature + max_tokens + top_p +
  prompt hashes + API-key hash + strict/loose flag — switching models, params, keys,
  or turns never serves a stale shape. Loose first-turn tool-loop text is cached too;
  later turns differ (results appended) so keys diverge naturally.
* **Telemetry** (`backend/agent/telemetry.py`, UI via `ApiBridge.get_agent_activity`):
  kinds `llm` / `tool` / `skill` / `file` / `web`, statuses
  `running → ok / error / skipped`, last 300 entries, newest first. Long calls emit
  `running` once and resolve in place (`update_activity`). Skill reads record
  `scope: preload | tool` so this doc's distinction is visible live. Tool entries keep
  structured `args` + `result`.
* **Token accounting** (`ai.py:865`): per-task accumulation guarded by a lock,
  flushed to the tasks table via `usage_tracking_context(task_id)` (prompt +
  completion tokens, streaming `usage` chunks).
* **Progress & cancellation:** `AgentRunner(progress_cb, cancel_event)` emits
  `Agent: Analyzing request (turn i/N)…` / `Executing tool …` messages; every network
  wait and every turn checks `cancel_event` (pipeline queue manager wires it; bridge
  passes a never-set event).

---

## 13. Quick-reference master table

| # | Call | Mode | Pre-loaded context | On-demand (tools) | Turns | Tools/turn | Schema |
|---|---|---|---|---|---|---|---|
| 9.0 | Search-query optimizer | strict micro-call | optimizer skill + `Section/Topic` | — | 1 | — | raw string |
| 9.1 | Design system | strict | art-director skill + topic/title + variety lane | — | 1 | — | `DesignSystemResponse` |
| 9.2 | Outline | strict | outline skill + scriptwriter rules + spec + web ctx | — | 1 | — | `OutlineResponse` |
| 9.3 | Intro + conclusion | strict | base skill + scriptwriter rules + outline + web ctx | — | 1 | — | `BaseScriptResponse` |
| 9.4 | Scene narration ×N (parallel) | **agent** | scene skill + rules + chapter + prev scene | 5 research/read | **5** | 8 | `ScriptSceneResponse` |
| 9.5 | Storyboard plan ×scenes | strict | planner skill + topic directive + narration | — | 1 | — | `{"storyboard_plan"}` |
| 9.6 | Visual AST ×scenes (parallel) | **agent** | director + design system + AST + motion + QA + narration + word timings + plan | 11 research/read/verify | **6** | 8 | `VisualsArrayResponse` |
| 9.7 | Visual correction | agent re-run / deterministic | error msg + duration target | same as parent | +1 run | 8 | same as parent |
| 9.8 | Rewrite script (bridge) | **agent** | rewriter skill + full script ctx + segment + web ctx | 5 research/read | **4** | 8 | Intro/Conclusion/Scene |
| 9.9 | Regen scene visuals (bridge) | **agent** | visual-rewriter + design + rules + narration + timings + table + neighbours | 11 research/read/verify | **4** | 8 | `VisualsArrayResponse` |
| 9.10 | Rewrite 1 cut (bridge) | **agent** | sub-visual-rewriter + design + rules + narration + cut timings + table + neighbours | 11 research/read/verify | **4** (+1 strict retry) | 8 | `SubVisualAST` |
| 9.11 | Add scene (bridge) | **agent** | adder skill + full script ctx + description + web ctx | 5 research/read | **4** | 8 | `ScriptSceneResponse` |

---

## 14. How to add a new LLM call or tool

**New tool** (full checklist also in `docs/agent_and_tools_architecture.md`):

1. Implement in `backend/agent/tools.py`, add its schema to `get_tools_schema()`,
   dispatch in `_execute_tool()`, add a Pydantic args model in `schemas.py`.
2. Add its name to the right allowlist(s) in `backend/agent/agent_engine.py`
   (§8) — the registry is read-only by policy; user-triggered mutations stay as
   bridge methods (§7C), never as tools.
3. Mention it in the relevant `backend/skills/*.md` so the model knows when to call it.
4. Verify in the activity feed (`get_agent_activity`) that `args` + `result` telemetry appears.

**New LLM call:**

1. Build `system_prompt` with `skill_loader.render_skill(...)` (pre-loaded context) and
   a focused `user_prompt` (target data + constraints + expected shape).
2. Plain constrained output → `_call_llm_json(system, user, Schema, cancel_event)`.
   Needs web/skill/project/stock data mid-run → `AgentRunner(...).run_with_tools(system,
   user, Schema, allowed_tools=..., max_turns=...)` (bridge) or
   `validate_and_correct_visuals(...)` (visuals).
3. Append web context via `_get_web_context_for_topic()` only when fresh facts help —
   it is itself a §9.0 micro-call + search, and it never blocks on failure.
4. Add tolerant extraction + a deterministic fallback so the pipeline progresses with
   zero valid output, and confirm the new call shows up under its `activity_label` in
   telemetry.
