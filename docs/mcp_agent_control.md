# Narrato MCP Agent Control — Architecture & Developer Guide

External coding agents (Claude Code, opencode, Cursor, Gemini CLI…) drive the full video pipeline through this **Model Context Protocol (MCP)** server: **41 tools + 1 resource + 1 prompt + 0 resource templates (by design)**, served over stdio or localhost Streamable HTTP. The server never calls an LLM and never needs an API key — the connected agent supplies all creative content (script prose, design systems, visual ASTs); the server validates and executes.

> **Internal-loop parity (why MCP visuals match app visuals):** the internal pipeline survives model mistakes via automatic correction turns, so `save_visuals`/`save_visuals_batch` do the same server-side: stray `z_index` keys are stripped, legacy `layers[]` shapes are best-effort converted (always reported in `auto_fixed`), and failures carry a machine-appliable `fix.retry_with` patch. Fix the JSON type and resubmit — never drop a layer kind to dodge a type error. Whole videos go through `save_visuals_batch` (3 calls: batch dry_run → re-dry-run fixed sections → batch persist; coverage is content-hashed, so edited-but-unvalidated content still earns the nudge) instead of 60-90 single-section calls. The batch `video_variety` rollup is the flat-video guard: `uniform_signature=true` or zero total energy cuts blocks nothing but must be fixed before rendering — per-section green is not video green.

> **0 resource templates is expected, not a bug.** MCP clients correctly call both `resources/list` (→ `narrato://pipeline-guide`) and `resources/templates/list` (→ empty) during discovery. Reads stay as **tools** on purpose: `get_skill`/`get_stage_skills` record skill-gate reads (a side effect), and reads like `get_visuals`/`get_transcription` need structured args (section_type, scene_index, cut_index, pagination) that don't map cleanly to URI templates. Do NOT add dummy templates just to make the count non-zero.

Code lives in [`backend/mcp/`](../backend/mcp/):
- `server.py` — tool/resource/prompt definitions + stdio/HTTP entrypoint
- `payloads.py` — LLM-free save/validate logic (scripts, designs, visuals, settings, files)
- `frames.py` — review contact sheets (render / composition / asset modes)
- `stills.py` — headless Remotion stills for pre-render truth checks
- `http_host.py` — in-app localhost host (autostart, port resolution, readiness)

---

## 1. Design split: brains vs hands

```
┌──────────────────────────── EXTERNAL AGENT (your coding agent) ────────────────────────────┐
│  BRAINS: writes narration, designs, sub-visual ASTs, picks voices, verifies queries        │
│  Reads: narrato://pipeline-guide, make_video prompt, skills, timings, review frames        │
└──────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ MCP (tools return ok/error dicts, images as blocks)
                                           ▼
┌──────────────────────────── NARRATO MCP SERVER (no LLM, no API keys) ──────────────────────┐
│  HANDS: validates schemas + durations, writes script.json/design.json/manifests,           │
│  executes voiceover → transcribe → assets → render, serves skills + media search           │
└──────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           │ same functions the desktop pipeline uses
                                           ▼
                         SQLite (WAL) + storage/<project_id>/ + ffmpeg / whisper / remotion
```

Key rule: **save paths are shared, not duplicated.** `save_script_payload` / `save_visuals_payload` mirror the internal pipeline's save semantics (hashing, downstream invalidation, manifest sync), so MCP-authored and app-authored projects are interchangeable.

---

## 2. Transports

| Mode | Command | Client setup |
|---|---|---|
| **Auto (default)** | Just launch the app — `backend/core/app.py` boots the endpoint | Point any agent at `http://127.0.0.1:8765/mcp` (see log line for fallback port) |
| **Manual HTTP** | `python -m backend.mcp.server --http [--port 8765]` | Same URL |
| **stdio** | `python -m backend.mcp.server` | `command: <venv python>, args: [-m, backend.mcp.server]` |

- Loopback-only (`127.0.0.1`): the endpoint executes ffmpeg/TTS and reads project files — it must never listen on a network interface.
- `NARRATO_MCP_PORT` overrides the port; `NARRATO_MCP_DISABLE=1` opts out.
- Port busy → free loopback port is picked and logged; the Settings → Agent Control card always shows the live URL.
- The MCP process shares SQLite/storage with the app via WAL: **one driver per project** (app queue vs agent, never both at once).

---

## 3. Tool inventory (41 tools, 1 resource, 1 prompt, 0 templates)

### Project lifecycle
| Tool | What it does |
|---|---|
| `create_project` | Create project (validates format, duration_mode, language code, paths; collision-proof export folder) |
| `list_projects` | id / name / status / language / updated |
| `project_status` | Full project row (no secrets) + per-stage task states |
| `delete_project` | Irreversible: DB row + tasks + storage folder |

### Script, design & voice
| Tool | What it does |
|---|---|
| `save_script` | Validate + persist narration; resets to post-script stage (purges downstream, creates the `generate_script` task row) |
| `patch_script` | Surgical single-section edit (hook/narration/summary); keeps design, voiceover segments, assets, sub_visuals; resets voiceover/transcribe/render only (Smart Resume re-synthesizes the edited section) |
| `get_script` | Read back (sub-visual ASTs stripped unless `include_visuals=true`) |
| `save_design` | Persist design system (required before visuals; binds `_design_hash`) |
| `list_voice_options` | Engines + per-language Edge suggestions + clone profiles + global defaults — **so the agent asks instead of guessing** |
| `update_voice_settings` | `tts_engine/voice/speed/pitch`, `bg_music_volume` (allowlisted; resets voiceover/transcribe/render only) |
| `update_transcribe_settings` | `whisper_model/device` (validated against known + downloaded ids; reports `downloaded` flag + warning) |
| `update_subtitle_settings` | Kinetic subtitle styling (fonts, colors, stroke, layouts; render-only reset) |
| `get_transcription` | Read word-level transcription & segments (section-scoped or global) |

| `list_skills` / `get_skill` | All 18 writing/visual guides (scriptwriter, visual-director-core, declarative-ast, …). Big skills are ~50KB: `brief=true` returns a section map first, `section="..."` (fuzzy title/subhead/number) pulls one part — never read a whole 50KB skill when a section will do |
| `get_archetypes` | Catalog of 25 broadcast motion graphics macro-archetypes for 1-shot authoring (category filtering: typography, data_finance, forensics_tech, comparison_geo, cinematic_mockups, drama_conclusion) |
| `get_stage_skills` | One-call starter pack per stage (script/design/visuals); satisfies the skill gate |
| `append_skill_learning` | Append-only learning observation to a skill's LEARNINGS.md (edge cases, failure modes, patterns) |
| `probe_cut` / `probe_scene` / `probe_asset` | Read-only inspectors: one cut / one section / one media layer (timing, file truth) |

### Mechanical stages (no LLM inside)
| Tool | What it does |
|---|---|
| `run_stage` | `generate_voiceover → transcribe → fetch_assets → render`; `wait=true` blocks, `wait=false` submits + poll; strictly serialized per project |
| `stage_status` | Poll background submissions |
| `sleep` | Bounded pause (max 120s) while a `wait=false` stage finishes: `sleep(~90s for voiceover/transcribe/render, ~45s for fetch_assets)` → `stage_status`, repeat until completed |
| `cancel_stage` | Stop a running MCP stage at the next checkpoint |
| `get_section_timings` | True audio durations + `start_time` + word timestamps per section |
| `get_visuals` | Read back sub_visuals for ONE section or a SINGLE cut (symmetrical to `save_visuals`, avoids 100KB+ dumps) |
| `save_visuals` | Per-section save; `cut_index` patches ONE cut; `dry_run` validates without writing; auto-repairs z_index + legacy shapes (see `auto_fixed`), machine-appliable `fix`/`retry_with` on failure |
| `save_visuals_batch` | Whole video in 3 calls (batch dry_run → re-dry-run fixes → batch persist); per-section results, duplicate/negative-index guards, project marker against interleaved stages, whole-video `video_variety` rollup |
| `clear_visuals` | Destructive reset: ALL sub_visuals → [] (script + both manifests; counts are logical cuts from script.json); `clear_assets=true` (default) also deletes downloads; `false` keeps downloads but still prunes the stills cache; narration/audio/design kept; fetch_assets + render → pending; marker-held so run_stage can't interleave |
| `clear_assets` | Destructive reset: delete downloads (asset_*/preview_*/manifest/previews) + strip local_path pointers; cuts/queries kept so fetch_assets re-runs clean |
| `review_frame` | Contact-sheet snapshots: `render` (exact mp4 pixels) / `composition` (headless Remotion stills) / `asset` (media lineup) |

### Research & inspection
| Tool | What it does |
|---|---|
| `search_media` | Pexels/Pixabay/Wikipedia/YouTube query check **before** baking queries into cuts (keys stay server-side) |
| `search_tools` | Keyword-search the tool catalog (progressive discovery: empty query returns the 10 core tools) |
| `get_tool_details` | Blurb + group + usage hint for one tool (inspect before calling) |
| `estimate_cost` | Dry-run time preview for remaining stages (no spend; local pipeline is unmetered BYOK, `billable_usd=0`) |
| `qa_gate` | Fail-closed publish gate: pacing/design/voiceover/captions/visuals/assets critical, measured LUFS critical when a render exists (hook + unmeasured-loudness warnings; call before render) |
| `verify_stock` | File-truth stock check per layer + source/license attribution (NOT VLM relevance — that stays with `review_frame` + human gate) |
| `get_receipt` | Video Receipt: input/output sha256 + resume cursor + per-cut assets, deterministic `receipt_id` (pairs with `run_stage(idempotency_key=...)`) |
| `web_search` | **FOR MCP EXTERNAL AGENT ONLY — INTERNAL APP LLM IGNORE.** Fact research for scripts (needs app web-search key; MCP agents should prefer their own native web search first, using this as fallback) |
| `list_project_files` / `read_project_file` | Structured disk inspection (capped text, binaries return size-only, traversal blocked) |

### Context (not tools)
- **Resource `narrato://pipeline-guide`** — canonical build order, clarify-don't-guess rules, gotchas. Agents should read this first.
- **Prompt `make_video(topic)`** — starter workflow: clarify options → build to assets → composition-review → stop for review → render on approval.

---

## 4. Human review gate (render)

`run_stage(render)` is **refused without `confirm_render=true`** — in both wait modes, before any DB write — returning `needs_confirmation: true` plus instructions to fetch assets, then composition-review each section, summarize the build and ask the user. Before asking, run `qa_gate` (fail-closed: pacing/design/voiceover/captions/visuals/assets) and attach `get_receipt` (hashes + resume cursor + per-cut attribution) to the review summary — do NOT render when `qa_gate.ok` is false. Default agent flow therefore ends at `fetch_assets` + `review_frame(composition)` + `qa_gate`; the user reviews/edits in the app; only explicit approval renders. Pass `idempotency_key="..."` on every `run_stage` submit so retried calls replay instead of re-running identical content. The desktop app's own render path is unaffected. Long stages should use `wait=false` + `sleep` + `stage_status` over HTTP to avoid client timeouts — and run no other mutating tool while a stage is queued/running (the server locks saves/clears/settings until it settles with `awaiting_stage`).

---

## 5. Rules agents and users must respect

1. One driver per project (app queue vs MCP agent), one agent session per project.
2. Never hand-edit `script.json` / `design.json` / manifests mid-stage — use the tools (there is a dedicated tool for every mutation, including whisper settings).
3. Never restart/close the app mid-stage: `running` tasks are marked failed on startup (`pending` stages resume cleanly).
4. `update_task` on a missing row is a silent no-op — always `create_task` first (payloads already do; keep it that way).
5. Sub-visual durations must sum to the section's audio length (the validator normalizes, but gross mismatches mean mistimed visuals).
6. Image/Video queries in English; prose in the project's language; no chapter title cards inside cuts; pair entrances with opacity fade whenever delay > 0 (spatial-only without fade allowed at delay: 0).
7. Capability reference (pipeline-guide §10): read ALL THREE visual skills — `visual-director-core` + `motion-graphics-designer` + `declarative-ast` (§4/§4C: 11 layer types, contracts, cut flags). Composition is the agent's creative decision. Every `save_visuals` response carries `timing`/`variety` stats — read them before moving on.
8. Review is mandatory AND post-fetch: `save_visuals` (all sections) → `run_stage(fetch_assets)` → one `review_frame(mode=composition)` pass per section with named fixes, never first-pass and never pre-fetch (composition renders the downloaded `local_path` files — pre-fetch shows placeholders). If a fix adds a new Image/Video query, re-fetch then re-review. Unknown transition names are remapped (reported in `normalizations`).

---

## 6. Adding a new tool (checklist)

1. **Pure logic in `payloads.py`** (or a sibling module like `frames.py`/`stills.py`): validate → compute → write. Keep backend access via module attributes (`_db`) so tests can monkeypatch `backend.database.db.*`.
2. **Thin wrapper in `server.py`**: `@mcp.tool()` returning `{ok: True, …}` / `{ok: False, error: …}`. Never leak the settings table (API keys). Validate enums/paths at the boundary.
3. **Long work**: submit to `_STAGE_POOL`, respect `_project_active_stage` serialization, update task rows running → completed/failed.
4. **Images**: return `(meta_dict, Image(data=jpeg_bytes, format="jpeg"))` — v2 renders this as Text + Image blocks (see `review_frame`).
5. **Docs**: one row in §3 above, one blurb in `McpAgentCard.tsx` `TOOL_GROUPS`, and a line in the pipeline-guide if it changes the workflow.
6. **Tests in `tests/test_mcp.py`**: validation rejects, happy path persists, failure writes nothing (compare file bytes), no real DB/network/LLM (monkeypatch storage + db fns — see `_patch_storage` / `_patch_db`).
7. **Verify live**: stdio handshake + one real call (via a quick test client script), plus `tsc --noEmit` if the Settings card changed.

### Error result contract (every tool, both transports)

Both the external MCP path and the internal chat agent read the same `{ok: false}` dicts, so every failure must be self-correcting on the next turn — never a bare `str(e)`:

- `error_code` — stable machine key (`SCENE_INDEX_OUT_OF_RANGE`, `STAGE_RUNNING`, `SCRIPT_NOT_FOUND`, …).
- `error` — names the failed parameter, shows valid values/ranges in BOTH bases (0-based index ↔ UI 1-based `scene_number`/`cut_number`), and ends with a concrete next action.
- `fix` — machine-appliable where possible: `{"tool", "arguments", "hint"}` and/or `retry_with`; batch rollups set `fix.retry_with` per item so no hint dangles.
- Warnings never masquerade as `ok` and never vanish into server logs: degraded signals ride along on `ok: true` results (`timing.lint_failed` + `warning` on `probe_scene`, `status: "unknown"` on `probe_asset` check-failures, `repetition_warning` on identical consecutive chat-agent calls).

Rationale: the classic failure loop was an agent passing a 1-based UI number as a 0-based index and blindly retrying; dual-base texts + per-item fix patches let it correct in one turn.

## 7. What else MCP *could* do (future tools)

Practical next candidates, roughly by value: environment **preflight** (whisper/model/ffmpeg/GPU present? — prevents doomed 10-minute stages), **voice preview** (audition a voice without a full voiceover run), **music/SFX** search + attach, **render settings** (fps/crf/codec/motion-blur), **scene add/remove/reorder**, single-asset `fetch` verify, `update_project` basics (rename/style-hint/duration), font download. All follow the §6 checklist; none require pipeline changes.

---

## 8. Troubleshooting

- **Agent can't connect**: check the app log for `Narrato MCP server listening on http://127.0.0.1:<port>/mcp` (port falls back when 8765 is busy); Settings → Agent Control shows the live URL + Refresh.
- **`needs_confirmation` on render**: working as designed — approve explicitly (`confirm_render=true`).
- **Stage stuck `running`**: worker failures always write `failed` rows; if a row predates that fix, re-run or `cancel_stage` it.
- **Transcribe "model not downloaded"**: `update_transcribe_settings` with a downloaded id (it reports `downloaded`), or download from Settings → Speech-to-Text.
- **Project shows `cancelled` with pending stages**: expected after an app restart mid-run — Resume re-queues from task + staleness state.
- **Frozen app: MCP offline**: `backend.mcp` is collected via `collect_submodules('backend.mcp')` in `narrato.spec`; if the card shows Offline in production, check the log for the import warning.
- **Log hygiene**: MCP stdio workers log to stderr only (no `app_<pid>.log` per agent connection — stdout is the protocol transport). Logs older than 7 days are pruned at startup (`NARRATO_LOG_RETENTION_DAYS`, `0` disables); `NARRATO_NO_FILE_LOG=1` opts a process out of file logging entirely.
