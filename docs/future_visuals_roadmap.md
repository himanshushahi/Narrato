# Future Visuals Roadmap (Tier 2 + Tier 3)

Status: Tier 1 shipped (`feat(visuals)` — 2026 FX pack, Particles layer, punch-in emphasis).
This doc is the implementation backlog for the remaining tiers. Suggested order:
T2.2 → T2.3 → T2.1 → T3.1 → T3.2 → T3.3 → T3.4 (cheap wins first, 3D when it can
get full attention, vertical reach before SFX polish).

Conventions every tier must follow (learned from Tier 1):
- New AST content types: extend `LayerContent` Literal in `backend/agent/schemas.py`,
  add a renderer branch in `frontend/src/components/video/ASTRenderer.tsx`, a
  `Ast<Name>Editor.tsx` panel wired into `AstGraphicalEditor.tsx` (type option +
  defaults in `changeType` + per-layer callbacks), a `VideoTrack.tsx` badge, and
  docs in `backend/skills/declarative-ast/SKILL.md`.
- Sync ALL skill copies: `visual-director`, `editor-qa`, `motion-graphics-designer`
  (+ `storyboard-planner` examples where relevant), `pipeline/ai.py` prompt strings,
  and `pipeline/genres.py` `primitive_weights`.
- Sub-visual-level fields (like `emphasis`): add to `SubVisualAST` schema AND to the
  `validate_sub_visuals` allowlist in `backend/agent/validators.py` (it rebuilds
  entries), AND to the `liveScenes` mapping in `useEditorData.ts` (it allowlists
  script fields — otherwise unsaved edits stay invisible until Save).
- Asset pipeline (`pipeline/assets.py`) only fetches Image/Video — procedural layers
  (no query/file) pass through untouched; no change needed for canvas/SVG/CSS layers.
- Verify with: `npx tsc --noEmit` (frontend), `pytest tests/ -q` (backend).

---

## Tier 2 — New layer types

### T2.1 — True 3D (`@remotion/three` + React Three Fiber)
- New AST node `Three3D` with 4–5 curated presets: spinning globe, 3D bar chart on a
  floor, rotating product/mockup shot, extruded 3D title, orbiting coins.
- Props: `three_preset`, `three_config` (colors, speed, angle), quality-gated
  (export render time rises — reuse the Settings motion-blur/quality toggle pattern).
- Editor: preset picker + minimal sliders (rotation speed, tilt, color).
- Skill rules: 3D only for hero beats (1 per scene max), never behind kinetic text.

### T2.2 — Animated Backgrounds layer
- New `Background` node: animated gradient mesh, moving grid, wave lines,
  dot-matrix, dark stock-loop with overlay. Pure CSS/canvas (see Tier 1
  `ProceduralCanvasFallback` / `ParticlesRenderer` patterns).
- Presets: `gradient_mesh`, `grid_flow`, `waves`, `dots`, `vignette_loop`.
- Kills black-screen empty cuts; teach `visual-rewriter` skill to always include one.
- Cheapest Tier 2 item — recommended first.

### T2.3 — Callouts + Lower-Thirds preset library
- ~10 insertable composed presets from existing Shape + Text primitives (no new
  renderer): tracking arrow + label, "VS" badge, stat popup, quote card, CTA end-card.
- Insertable as a new cut OR as an overlay; editor UI = preset gallery +
  text/color fields; skill docs for AI placement (safe areas above subtitles).

---

## Tier 3 — Editing workflow

### T3.1 — Vertical 9:16 auto-reframe (do first in this tier)
- Add portrait + square to the format setting; safe-zone guides in preview;
  auto center-crop/scale-offset wrapper over absolute-positioned comps.
- Doubles distribution surface (Shorts/Reels/TikTok).

### T3.2 — Sound-effects layer
- Built-in SFX pack (whoosh/pop/click/riser); auto-attach whoosh on transitions,
  pop on chart bars; timeline SFX lane with volume; reuse FFmpeg mix path.
- No backend schema change needed (design as overlay-adjacent feature).

### T3.3 — Brand kit
- Per-project fonts/palette/logo/outro + one-click "Apply brand" recolor across cuts.
- Builds on `design.json` tokens; mostly UI + recolor pass.

### T3.4 — Beat-sync + music intelligence
- Beat detection → timeline markers → one-click "cut on beats" (split sub-visuals
  at transients) + auto-ducking voiceover under music.

---

## Deliberately out of scope
- Full keyframe graph editor (After Effects clone): fights the AI-first AST model;
  presets + emphasis cover ~90% of the value.
- Real-time collaboration/comments: infra-heavy, zero visual payoff.
- Cloud/Lambda rendering: only if the local GPU queue bottlenecks.
