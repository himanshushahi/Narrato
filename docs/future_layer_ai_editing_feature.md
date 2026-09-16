# Future: AI Edit for a Specific Layer of a Sub-Visual Cut

Status: Planned (not started).
- **Phase 1 (backend):** New `ApiBridge.regenerate_sub_visual_layer` + `layer-rewriter` skill + post-checks.
- **Phase 2 (frontend):** Bridge type, `handleRewriteSubVisualLayer` flight, layer-card "AI edit" button + spinner.
- **Phase 3 (tests):** Prompt/post-check unit tests + full suite green.
- **Phase 4 (docs):** §9.12 entry in `docs/llm_calls_complete_guide.md`.

Goal: user selects one layer of one sub-visual cut (selection state already
exists), types what to change ("make this headline red and bigger", "swap this
photo to a night skyline"), and the AI rewrites **only that layer** — siblings
untouched, preview-first (Save/Revert), same as cut rewrite.

Suggested order: Phase 1 → Phase 2 → Phase 3 → Phase 4 (each independently shippable;
Phase 2 needs Phase 1; Phase 3 can start once Phase 1's signature is frozen).

Conventions (repo-learned, must follow):
- Layer model has no stable ids — everything is index-keyed
  (`composition.children[idx]`). The edit splices `children[layer_idx]` in place,
  so existing selection stays valid (cf. `future_canvas_layer_editing_feature.md`).
- Preview-first contract: bridge returns data, frontend applies to local state,
  user Saves to persist or Reverts to discard (`materialize_rewrite_previews`
  downloads into `assets/previews/`; Save promotes, Revert deletes).
- Rewrite flights use generation-token stale gates (`handleRewriteSubVisual` in
  `useScriptEditing.ts`). Layer edits reuse the pattern with key
  `${cardKey}:${subIdx}:${layerIdx}`; a section rewrite on the same card
  supersedes them.
- Tool registry stays read-only: no new agent tools — the call uses
  `BRIDGE_VISUAL_TOOLS` (11 tools), default budget 4 turns / 8 per turn.
- Manual layer style edits (`onStyleCommit`) remain for deterministic tweaks; AI
  layer edit is for semantic changes (rewrite text, swap query, restyle a card).

---

## 1. Research: what already exists (reuse, don't rebuild)

- **Layer selection:** `selectedLayerIndex` (`store/useEditorStore.ts:20`),
  `handleCanvasSelectLayer(sceneIdx, subIdx, layerIdx)`
  (`EditorWorkspace.tsx:808`), layer cards with selected state
  (`CanvasOverlay.tsx:1941`). Entry point for the UI button — no new state needed.
- **Single-cut AI rewrite (template method):** `ApiBridge.regenerate_sub_visual`
  (`backend/core/bridge.py:1752`) — skill + design + visual rules system prompt,
  narration + cut-relative word timings + duration table + neighbour layouts user
  prompt, `_call_llm_safe(..., SubVisualAST, use_tools=True,
  allowed_tools=BRIDGE_VISUAL_TOOLS)`, then normalize → delay-clamp →
  one strict queryless retry → `materialize_rewrite_previews` → return data.
  The new method clones this shape with `SubVisualAST` → `ASTLayerNode`.
- **Layer schema:** `ASTLayerNode` (`backend/agent/schemas.py:459`) — `type:
  "Layer"` wrapper + `content` + `animations`/`floating`/`motion_blur`/
  `shutter_angle`/`camera_shake`/`transform_origin`/`filters`. No new schema needed.
- **Per-layer validators** (`backend/agent/validators.py`):
  `normalize_hallucinated_sources(children)`, `sanitize_style_keys(children)`,
  plus `LayerContent` model validation (`sanitize_layer_style`). All accept
  single-element children lists.
- **Delay clamp** (`bridge.py:_clamp_cut_animation_delays`) works on a sub-visual
  dict — wrap the edited layer in its parent cut (`{composition: {children:
  [...siblings with new layer...]}, duration: cut_duration}`) and reuse as-is.
- **Preview download** (`materialize_rewrite_previews`, `assets.py:1802`)
  accepts a single dict or list — call with a synthetic single-layer cut
  `[{composition: {type: "Sequence", children: [new_layer]}, duration:
  cut_duration}]` so an Image/Video query swap previews real footage instantly.
- **Queryless check** (`bridge.py:_find_queryless_media`) mirrors
  `validators._is_queryless_media` — wrap-and-reuse for the retry gate.
- **Cut-relative timings** (`bridge.py:_get_cut_word_timings`) give delays usable
  directly as animation `delay` — same input the cut rewrite gets.

## 2. Design decisions (frozen for v1)

1. **Edit-only.** The model may change any field inside the one target layer
   (including `content.type`, e.g. Text → Chart), but may not add, delete, or
   reorder layers. Add/remove/reorder stays manual or whole-cut rewrite.
2. **Siblings are context, not output.** Prompt carries a compact sibling list
   (`[0] Video background "city night"`, … with `← EDITING THIS` marker) plus the
   full JSON of only the target layer. Full sibling JSON is withheld so the model
   can't "helpfully" rewrite them and the prompt stays small.
3. **Cut duration is invariant.** Layers carry no duration — no duration math or
   correction loop; only `delay + duration ≤ cut duration` clamping.
4. **Position invariants enforced deterministically:** last-child Particles must
   stay Particles-type; `children[0]` background should stay full-bleed. Validate
   post-hoc with one strict retry, don't rely on prompt obedience.
5. **No new agent tools, no allowlist changes.**

## 3. Phase 1 — Backend: `ApiBridge.regenerate_sub_visual_layer`

Signature (mirrors `regenerate_sub_visual` + `layer_idx`):

```python
def regenerate_sub_visual_layer(self, project_id: str, scene_idx: int,
    section_type: str, sub_idx: int, layer_idx: int, full_script: dict,
    rewrite_prompt: str, language: str = "hi") -> dict:
```

Steps:
1. **New skill** `backend/skills/layer-rewriter/SKILL.md` (`name: layer-rewriter`,
   `when_to_use`: single-layer edits), rendered with `{design_system_text}`,
   `{visual_rules}` — same inputs as `sub-visual-rewriter` plus a single-layer
   scope section (sibling list is read-only; output exactly one `Layer` node;
   `type: "Layer"` wrapper mandatory; Image/Video requires `query` + `source`;
   style allowlist reminder; delay rules against the given cut duration).
2. **User prompt:** video/scene titles + genre pacing line (`_get_genre_pacing_line`)
   + scene narration + cut-relative word timings (`_get_cut_word_timings`, fallback
   `NO_TIMINGS_FALLBACK`) + cut duration (delay-fitting bound) + compact sibling
   list with marker + full target-layer JSON + rewrite instruction + expected
   single-`Layer` shape.
3. **LLM call:** `_call_llm_safe(system, user, ASTLayerNode, use_tools=True,
   allowed_tools=BRIDGE_VISUAL_TOOLS)` (import from `agent_engine`, as the cut
   rewrite does).
4. **Post-checks, in order:** `normalize_sub_visuals_sources` on the wrapped layer
   → `ASTLayerNode.model_validate` → `sanitize_style_keys` → queryless check on
   the wrapped cut (one strict `use_tools=False` retry on failure, adopted only if
   clean) → Particles-last / background-bleed invariant check (fold into the same
   retry when possible) → delay clamp via wrapped cut → preview materialization
   via synthetic single-layer cut → return `{"success": True, "data": {"layer": …}}`.
5. **Guards first:** invalid scene/sub/layer index → `{"success": False, "error":
   ...}` before any LLM call (same style as the existing `Invalid sub visual index`).

## 4. Phase 2 — Frontend wiring

1. **`types/pywebview.d.ts`:** add `regenerate_sub_visual_layer(project_id,
   scene_idx, section_type, sub_idx, layer_idx, full_script, rewrite_prompt,
   language)`.
2. **`hooks/useScriptEditing.ts`:** add `handleRewriteSubVisualLayer`, cloned from
   `handleRewriteSubVisual` — same flight/token/stale-gate pattern with
   `subKey = ${cardKey}:${subIdx}:${layerIdx}`; on success splice the returned
   layer into `children[layerIdx]` in local script + manifest state (preview-only;
   existing Save/Revert covers persistence). A section rewrite on the same card
   supersedes it, exactly like cuts.
3. **Layer card UI:** "AI edit" button beside the selected layer (reuse the
   rewrite-prompt dialog), disabled under the same locks (`isSectionRewriting`,
   `isSubRewriting`) plus a per-layer `rewritingLayers` spinner map.

## 5. Phase 3 — Tests

- Prompt assembly: sibling summary carries the marker, target-layer full JSON
  present, siblings' full JSON absent.
- Guards: invalid indices return error with `_call_llm_json` mocked to raise on
  call (assert never called).
- Post-checks: queryless Image layer triggers exactly one strict retry and adopts
  the fixed layer; overshooting animation delay clamps to cut duration;
  Particles-last / background invariants hold.
- Registry test (`test_tools_schema_has_new_tools`) untouched — no new tools.

## 6. Phase 4 — Docs

Add §9.12 to `docs/llm_calls_complete_guide.md`: pre-loaded (layer-rewriter skill,
design, rules, narration, cut timings, sibling list, target layer) vs on-demand
(`BRIDGE_VISUAL_TOOLS`, 11), budget 4 turns / 8 per turn + 1 strict retry, schema
`ASTLayerNode`, deterministic post-checks.

## 7. Explicit non-goals (v1)

Add/delete/reorder layers; cross-layer edits ("make these two match"); editing
`transition`/`emphasis`/duration (cut-level — use existing cut rewrite); batch
multi-layer prompts.
