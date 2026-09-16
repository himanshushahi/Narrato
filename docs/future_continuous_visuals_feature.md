# Future: Continuous Visuals (Shared Background, Animated Foreground)

Status: Planned (not started).
- **Phase 0 (schema):** Optional `continuity` fields on cuts/scenes, validator allowlist.
- **Phase 1 (assets):** Deterministic background reuse within a group.
- **Phase 2 (frontend):** Link/unlink backgrounds across cuts, timeline badge.
- **Phase 3 (AI prompts):** Anchor-first generation + locked-background rewrites.
- **Phase 4 (polish):** Phase-continued drift, delay-rule relaxation, auto-suggest.

Goal: user selects a cut span (within a scene) and links it so **one locked
background anchor** (`composition.children[0]` identical query + source +
style + filters + asset) persists across the span, **transitions inside the
span are `none`/`cut`**, and **only mid/foreground layers animate**. Result is
a seamless continuous visual instead of jumpy per-cut backgrounds. Everything
is preview-first (Save persists, Revert discards), default behavior unchanged
(`varied` mode) unless the user opts in.

Suggested order: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 (each
independently shippable; Phase 2 needs Phase 0; Phase 3 needs Phase 0 + 1).

---

## 1. Research: why cuts feel broken today (reuse, don't rebuild)

- **Cuts are independent by design.** Each `sub_visual` owns its own
  `composition.children[]` (`backend/agent/schemas.py:459-498`). Bulk
  generation runs scenes in parallel with no cross-cut memory
  (`backend/pipeline/ai.py:2090-2282` — `ThreadPoolExecutor`; each scene gets
  only Topic/Genre/Narration/storyboard/design).
- **Anti-continuity is enforced.** `VARIETY RULE: never same background type
  on consecutive sub-visuals` (`ai.py:2009`,
  `skills/visual-director/SKILL.md:24`, `skills/storyboard-planner/SKILL.md:25`),
  `NEVER same layout twice` (`visual-director:67`).
- **Background = convention** (`children[0]`, `schemas.py:459-464`,
  `ASTRenderer.tsx:649-673`) — any of Image/Video/HTML/Map. No background
  id/seed is stored or passed between cuts.
- **Transitions are entrance-only, non-overlapping**
  (`NitishRajputComposition.tsx:143-273` — hard `Sequence` boundaries,
  `transFrames<=14`, `MIN_OPACITY 0.35`). Per-cut field, default `cut`
  (`schemas.py:493`, `validators.py:9-13`, edited in
  `SubVisualsEditor.tsx:303-320`).
- **Stock is non-deterministic.** Query-only contract (`ai.py:1898-1903`) →
  `_fetch_ast_layer_asset` (`assets.py:1265-1416`) searches per layer; the same
  query can resolve to different files across cuts except via stored
  `asset_url` resume.
- **Render stitches by arithmetic** (`render.py:40-96, 476-824`): global frame
  = Σ sceneFrames + Σ subFrames. Single composition object, no per-cut MP4s,
  no overlap.
- Only shared style carrier today is `design.json` palette/typography
  (`ai.py:280-385`). `visual_cue`/`visual_type` are legacy display fallbacks,
  never AI-generated.

Conventions (repo-learned, must follow):
- Layer model has no stable ids — everything is index-keyed
  (`composition.children[idx]`); background is `children[0]` by convention.
- Preview-first contract: bridge returns data, frontend applies to local
  state, user Saves to persist or Reverts to discard
  (`materialize_rewrite_previews` downloads into `assets/previews/`; Save
  promotes via `promote_preview_paths_to_assets`, Revert deletes via
  `cleanup_preview_assets`).
- Structural edits go through the VisualsTab lens (`writeImmediate` +
  `lastWrittenJsonByCardRef`) so Revert keeps working; per-layer UI maps in
  `AstGraphicalEditor` shift with the card-button path — reuse it, don't
  duplicate store writes (cf. `future_canvas_layer_editing_feature.md`).
- Rewrite flights use generation-token stale gates (`handleRewriteSubVisual`
  in `useScriptEditing.ts`).

---

## 2. Phase 0 — Schema (backward-compatible, default `varied`)

- `backend/agent/schemas.py:489-498` `SubVisualAST`: add optional
  `continuity?: {group: str, bg_lock: bool}`. Scene level: optional
  `continuity_groups?: [{id, cut_range: [start, end], anchor: {query, source,
  image_type?, style?, filters?, brightness?}}]`.
- `backend/agent/validators.py:389-432` `validate_sub_visuals` +
  `normalize_transition`: allowlist the new keys (don't strip); inside a
  locked group coerce non-`none`/`cut` transitions to `none` with warning.
- Frontend types mirror the new keys; `readSectionSubs`/`writeSectionSubs`
  (`VisualsTab.tsx:14-35`) carry them untouched.
- Default: no groups → current `varied` behavior, zero migration.

## 3. Phase 1 — Deterministic background reuse (no prompt change)

- `backend/pipeline/assets.py:_fetch_ast_layer_asset:1265-1416`: before
  searching, if the cut belongs to a continuity group whose anchor already
  resolved `local_path`/`asset_url`, copy it (same
  `_save_asset_url_to_layer` path `asset_{seg}_{sub}_{layer}.ext`) instead of
  re-searching stock. This alone fixes rotation jitter.
- `bridge.py: regenerate_sub_visual:1752-1915`:
  `normalize_sub_visuals_sources` (`validators.py:192-211`) must **not**
  strip `local_path` for a locked `children[0]`.
- Tests: same-query → same file within group; unlink restores independent
  fetch; validator keeps anchor keys.

## 4. Phase 2 — Editor link/unlink (user control)

- `SubVisualsEditor.tsx:296-321` cut toolbar: `Link backgrounds across cuts`
  (span picker) / `Unlink`. Action: copy `children[0]` JSON from first cut
  across the span, set `transition='none'` inside the span (keep exit
  transition on the last cut), set `continuity.group`.
- `VisualsTab.tsx:416-473` lens: structural write via `writeImmediate`
  (updates `lastWrittenJsonByCardRef`) so Revert works; extend the
  `withFlush*` asset helper pattern for anchor bookkeeping.
- `VideoTrack.tsx:27-41,286` + `Timeline.tsx:965-1017`: linked-span badge
  (e.g. 🔗) + context-menu link/unlink.
- All preview-only (`onSetScriptData`); Save via existing `handleSaveCard`;
  global Cancel restores pre-link snapshot.

## 5. Phase 3 — AI prompt changes (anchor-first generation)

- `backend/pipeline/ai.py:1992-2047` `visuals_system_prompt` +
  `skills/visual-director/SKILL.md:18-24` + `storyboard-planner:25`: add a
  continuity clause — when a `continuity_group` is present, `children[0]`
  MUST reuse the anchor verbatim (same type/query/source/style), background
  gets phase-continued drift, exactly one foreground hero animates,
  transitions inside the group are `none`.
- `ai.py:2182-2222` Stage-1/2: storyboard marks spans (same location/topic
  соседние beats); Stage-2 emits the anchor once and cuts reference it.
- `visual-rewriter` / `sub-visual-rewriter` skills: forbid changing a locked
  `children[0]`; single-cut rewrite receives anchor + neighbors and must
  differ everywhere *except* the background.

## 6. Phase 4 — Polish (optional, later)

- Phase-continued drift: `scale 1.0→1.06` over the whole group duration with
  per-cut offsets (MVP restarts drift per cut — near-seamless with `none`).
- Foreground `delay` rule: inside groups allow `delay>=0` (today `>=0.5`
  exists to hide entrances under transitions — no transition, no wait).
- Auto-suggest: heuristic (same entities/location across соседние beats)
  proposes groups; user confirms.

## 7. Explicitly not doing

- True overlapping crossfades via `@remotion/transitions` (installed but
  unused — `docs/future_visuals_roadmap.md:158`): heavier stitching change,
  unnecessary for background-lock continuity.
- Character/palette embeddings or video-diffusion backgrounds: no such infra
  exists (grep `pollinat|diffusion|replicate` = zero hits); stock +
  procedural only.

## 8. Verification (when implemented)

Link 3 cuts → identical `children[0]` JSON + same `local_path` file,
`transition:none` inside, seamless preview, Revert restores, Save persists,
unlink restores variety, middle-cut rewrite preserves the anchor.
