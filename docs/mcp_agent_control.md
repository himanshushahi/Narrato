# Narrato MCP Agent Control — Architecture & Developer Guide

External coding agents (Claude Code, opencode, Cursor, Gemini CLI…) drive the full video pipeline through this **Model Context Protocol (MCP)** server: **22 tools + 1 resource + 1 prompt**, served over stdio or localhost Streamable HTTP. The server never calls an LLM and never needs an API key — the connected agent supplies all creative content (script prose, design systems, visual ASTs); the server validates and executes.

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

## 3. Tool inventory (22 tools, 1 resource, 1 prompt)

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
| `get_script` | Read back (sub-visual ASTs stripped unless `include_visuals=true`) |
| `save_design` | Persist design system (required before visuals; binds `_design_hash`) |
| `list_voice_options` | Engines + per-language Edge suggestions + clone profiles + global defaults — **so the agent asks instead of guessing** |
| `update_voice_settings` | `tts_engine/voice/speed/pitch`, `bg_music_volume` (allowlisted; resets voiceover/transcribe/render only) |
| `update_transcribe_settings` | `whisper_model/device` (validated against known + downloaded ids; reports `downloaded` flag + warning) |
| `list_skills` / `get_skill` | All 18 writing/visual guides (scriptwriter, visual-director-core, declarative-ast, …). Big skills are ~50KB: `brief=true` returns a section map first, `section="..."` (fuzzy title/subhead/number) pulls one part — never read a whole 50KB skill when a section will do |

### Mechanical stages (no LLM inside)
| Tool | What it does |
|---|---|
| `run_stage` | `generate_voiceover → transcribe → fetch_assets → render`; `wait=true` blocks, `wait=false` submits + poll; strictly serialized per project |
| `stage_status` | Poll background submissions |
| `cancel_stage` | Stop a running MCP stage at the next checkpoint |
| `get_section_timings` | True audio durations + `start_time` + word timestamps per section |
| `save_visuals` | Per-section save; `cut_index` patches ONE cut; `dry_run` validates without writing |
| `review_frame` | Contact-sheet snapshots: `render` (exact mp4 pixels) / `composition` (headless Remotion stills) / `asset` (media lineup) |

### Research & inspection
| Tool | What it does |
|---|---|
| `search_media` | Pexels/Pixabay/Wikipedia/YouTube query check **before** baking queries into cuts (keys stay server-side) |
| `web_search` | Fact research for scripts (needs app web-search key) |
| `list_project_files` / `read_project_file` | Structured disk inspection (capped text, binaries return size-only, traversal blocked) |

### Context (not tools)
- **Resource `narrato://pipeline-guide`** — canonical build order, clarify-don't-guess rules, gotchas. Agents should read this first.
- **Prompt `make_video(topic)`** — starter workflow: clarify options → build to assets → stop for review → render on approval.

---

## 4. Human review gate (render)

`run_stage(render)` is **refused without `confirm_render=true`** — in both wait modes, before any DB write — returning `needs_confirmation: true` plus instructions to summarize the build and ask the user. Default agent flow therefore ends at `fetch_assets`; the user reviews/edits in the app; only explicit approval renders. The desktop app's own render path is unaffected. Long stages should use `wait=false` + `stage_status` over HTTP to avoid client timeouts.

---

## 5. Rules agents and users must respect

1. One driver per project (app queue vs MCP agent), one agent session per project.
2. Never hand-edit `script.json` / `design.json` / manifests mid-stage — use the tools (there is a dedicated tool for every mutation, including whisper settings).
3. Never restart/close the app mid-stage: `running` tasks are marked failed on startup (`pending` stages resume cleanly).
4. `update_task` on a missing row is a silent no-op — always `create_task` first (payloads already do; keep it that way).
5. Sub-visual durations must sum to the section's audio length (the validator normalizes, but gross mismatches mean mistimed visuals).
6. Image/Video queries in English; prose in the project's language; exactly one Particles layer per cut max, as last child; no chapter title cards inside cuts; ALWAYS pair entrance animations (translateY, translateX, scale, rotate) with a simultaneous opacity fade ({property: "opacity", from: 0, to: 1, ...}) so elements fade into view smoothly.
7. Variety contract (pipeline-guide §10): read ALL THREE visual skills — `visual-director-core` + `motion-graphics-designer` + `declarative-ast` (its 12 archetypes are the template library, card geometries alone are not enough). No identical layer-template more than 2 cuts in a row; ≥5 of the 9 content kinds per video; one energy moment (emphasis, camera_shake, motion_blur, FX filter, rack-focus, Particles) per section. Every `save_visuals` response carries non-blocking `variety` stats — fix flagged repetition before moving on.
8. Review is mandatory: one `review_frame(mode=composition)` pass per section with named fixes, never first-pass. Unknown transition names are remapped (reported in `normalizations`), and palette-only designs get a `warning` — both are the server telling you to aim higher.

---

## 6. Adding a new tool (checklist)

1. **Pure logic in `payloads.py`** (or a sibling module like `frames.py`/`stills.py`): validate → compute → write. Keep backend access via module attributes (`_db`) so tests can monkeypatch `backend.database.db.*`.
2. **Thin wrapper in `server.py`**: `@mcp.tool()` returning `{ok: True, …}` / `{ok: False, error: …}`. Never leak the settings table (API keys). Validate enums/paths at the boundary.
3. **Long work**: submit to `_STAGE_POOL`, respect `_project_active_stage` serialization, update task rows running → completed/failed.
4. **Images**: return `(meta_dict, Image(data=jpeg_bytes, format="jpeg"))` — v2 renders this as Text + Image blocks (see `review_frame`).
5. **Docs**: one row in §3 above, one blurb in `McpAgentCard.tsx` `TOOL_GROUPS`, and a line in the pipeline-guide if it changes the workflow.
6. **Tests in `tests/test_mcp.py`**: validation rejects, happy path persists, failure writes nothing (compare file bytes), no real DB/network/LLM (monkeypatch storage + db fns — see `_patch_storage` / `_patch_db`).
7. **Verify live**: stdio handshake + one real call (via a quick test client script), plus `tsc --noEmit` if the Settings card changed.

## 7. What else MCP *could* do (future tools)

Practical next candidates, roughly by value: environment **preflight** (whisper/model/ffmpeg/GPU present? — prevents doomed 10-minute stages), **voice preview** (audition a voice without a full voiceover run), **music/SFX** search + attach, **render settings** (fps/crf/codec/motion-blur), **scene add/remove/reorder**, single-asset `fetch` verify, `update_project` basics (rename/genre/duration), font download. All follow the §6 checklist; none require pipeline changes.

---

## 8. Troubleshooting

- **Agent can't connect**: check the app log for `Narrato MCP server listening on http://127.0.0.1:<port>/mcp` (port falls back when 8765 is busy); Settings → Agent Control shows the live URL + Refresh.
- **`needs_confirmation` on render**: working as designed — approve explicitly (`confirm_render=true`).
- **Stage stuck `running`**: worker failures always write `failed` rows; if a row predates that fix, re-run or `cancel_stage` it.
- **Transcribe "model not downloaded"**: `update_transcribe_settings` with a downloaded id (it reports `downloaded`), or download from Settings → Speech-to-Text.
- **Project shows `cancelled` with pending stages**: expected after an app restart mid-run — Resume re-queues from task + staleness state.
- **Frozen app: MCP offline**: `backend.mcp` is collected via `collect_submodules('backend.mcp')` in `narrato.spec`; if the card shows Offline in production, check the log for the import warning.
- **Log hygiene**: MCP stdio workers log to stderr only (no `app_<pid>.log` per agent connection — stdout is the protocol transport). Logs older than 7 days are pruned at startup (`NARRATO_LOG_RETENTION_DAYS`, `0` disables); `NARRATO_NO_FILE_LOG=1` opts a process out of file logging entirely.
