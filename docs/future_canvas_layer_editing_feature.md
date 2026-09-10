# Future: Canvas Layer Highlight + Visual Transform Editing

Status: Complete.
- **P1 (read-only highlight/selection):** Completed with geometry parity fixes on branch `feature/canvas-layer-highlight-manipulation`.
- **P2 (preview → editor routing & discoverability):** Completed on branch `feature/canvas-layer-highlight-manipulation`.
- **P3 (move & corner resize):** Completed on branch `feature/canvas-layer-highlight-manipulation`.
- **P4 (rotate, edge resize & scale mode):** Completed on branch `feature/canvas-layer-highlight-manipulation`.

Goal: click any layer in the sub-visual editor → highlight it in the preview
player; visually move / resize (box) / scale / rotate layers directly on the
preview canvas, bidirectionally synced with the
`Advanced (Layout, Animations, Filters & Motion FX)` → `Layout` tab.

Suggested order: P1 → P2 → P3 → P4 (each phase independently shippable).

Conventions (repo-learned, must follow):
- Layer model has no stable ids — everything is index-keyed (`composition.children[idx]`).
  Selection state is an index; always shift/clear it on add/delete/duplicate/AI-rewrite
  (see P1 pattern in `AstGraphicalEditor handleDeleteLayer` and `handleDuplicateLayer`,
  `VisualsTab selectCut`, `EditorWorkspace handleSelectSubVisual`, and `useEditorStore`).
- Visuals-tab edits ride the 150 ms trailing debounce (`scheduleWriteBack` /
  `commitPending` in `VisualsTab.tsx`). Canvas drags in P3/P4 must use the same path —
  local-urgent overlay state + trailing commit — never `setScriptData` per pointermove.
- Renderer parity is load-bearing: overlay geometry must strictly mirror
  `ASTRenderer.tsx` (`splitStyles`/`LAYOUT_PROPS`, `parseStaticTransform`,
  `hasCustomLayout`, aspect-lock, bottom-anchor).
- Whole-document save (`handleSaveCard` in `useScriptEditing.ts`) persists everything;
  canvas edits need no new backend — they are `content.style` edits like the sliders.
- Verify with: `npm run build` (frontend). No backend change expected.

---

## 1. Research & Component Architecture

- Layer model: `sub_visual.composition = { type: 'Sequence', children: Layer[] }`,
  `Layer = { type: 'Layer', z_index, content: { type, style: {...} }, animations,
  filters, motion_blur, ... }` (`ASTRenderer.tsx:80-91`).
- Editor write path: `AstLayoutControls onChange → api.updateContent(idx,'style') →
  triggerChange → SubVisualsEditor handleUpdate → VisualsTab handleLensChange →
  scheduleWriteBack (150 ms) → scriptData` (`AstGraphicalEditor.tsx`,
  `SubVisualsEditor.tsx`, `VisualsTab.tsx`).
- Layout fields (`AstLayoutControls.tsx`): `left/top/right/bottom/width/height` (%),
  `aspectRatio`, `borderRadius`, presets, `scale/scaleX/scaleY` (10–500 %, sign = flip),
  `rotate` (−180…180°), Flip H/V, Linked/Split. Bottom-anchored text uses `bottom%`.
- Renderer (`ASTRenderer.tsx:93-184,340-504`): `LAYOUT_PROPS` go to the absolute
  container; static transform `rotate(Xdeg) scale(sx[,sy])` on container, pivot =
  `transform_origin` else center; `aspectRatio` set ⇒ `height: undefined` (derived
  from width); media fills box via `objectFit`; fullscreen fallback `100%×100%`.
- Preview mount point: `<CanvasOverlay scenes={liveScenes} />` is mounted directly
  as a child slot inside `<RemotionVideoPlayer />` right after the `<Player />` component.
  This ensures that both the video player and the canvas overlay share the exact same
  container bounding box, aspect ratio, letterboxing, and `motion.div` zoom scale
  in both landscape (`aspect-video w-full`) and portrait (`aspect-[9/16] w-auto mx-auto max-h-[70vh]`).

---

## 2. State Design

In `useEditorStore.ts` (P1 completed):

```ts
selectedLayerIndex: number | null
setSelectedLayerIndex: (idx: number | null) => void
```

- Single source of truth for editor-card highlight and overlay highlight.
- Automatically cleared whenever `selectedSceneIndex` or `selectedSubVisualIndex` changes
  in `useEditorStore.ts`, as well as on cut deletion (`VisualsTab.tsx`).
- Shifted on layer deletion and duplication in `AstGraphicalEditor.tsx`:
  - Delete `idx`: if `sel === idx` ⇒ `null`; if `sel > idx` ⇒ `sel - 1`.
  - Duplicate `idx`: if `sel === idx` ⇒ `idx + 1`; if `sel > idx` ⇒ `sel + 1`.
- Not persisted (like scene/cut selection).

---

## 3. Components & Data Flow

### 3.1 `CanvasOverlay` (`EditorWorkspace/components/CanvasOverlay.tsx`)

- Mounted inside `RemotionVideoPlayer.tsx` over the Remotion `<Player>` element.
- Resolves active scene from `usePlaybackStore.currentFrame` + scene durations.
- **Performance:** When `isPlaying` is true, returns `null` immediately. This completely
  eliminates 30–60 FPS style recalculations and virtual DOM churn during video playback.
- **Aspect Ratio Parity:** When `aspectRatio` is set, `heightPct` is kept `null` and
  `aspectRatio: box.aspectRatio` is applied as a CSS rule on the overlay box. This allows
  the browser to derive the height natively, preventing non-square distortion in 16:9 and 9:16.
- **Bottom-Anchored & Text Bounds:** Text layers without explicit height default to a
  proportional 15% lower-third box instead of blowing out to 100% of the screen.
- **Symmetric Anchoring:** Supports both `left` and `right` positioning symmetrically.
- **Hit-Testing & Layer Stacking:**
  - Fullscreen background layers are clamped to `z-index: 15` (even when selected), while
    non-fullscreen layers use `z-index: 20 + zIndex` (selected: `100`). This prevents
    fullscreen layers from trapping all clicks and locking out foreground elements.
  - An invisible backdrop (`z-index: 0`) is rendered when `selectedLayerIndex !== null` so
    clicking empty canvas space cleanly deselects the layer.
  - Global `Escape` key listener deselects the active layer.
- **Badge Clipping & Rotation:**
  - When a layer is within 4% of the top container edge, the label badge is placed inside
    (`top: 4px`) to prevent clipping by `overflow-hidden`.
  - Badges on rotated layers are counter-rotated (`rotate(${-box.rotateDeg}deg)`) so labels
    remain upright and readable.

### 3.2 Editor ↔ Preview Sync

- **Editor → Preview:** Clicking a layer card in `AstGraphicalEditor.tsx` sets `selectedLayerIndex`.
  An `internalClickRef` tracks that the selection originated in the editor so it does not
  force scroll jumps or overwrite the user's active sub-tab (e.g. Animations/Filters).
- **Preview → Editor:** Clicking a layer box on the canvas sets `selectedLayerIndex`, which
  automatically expands the Advanced section, switches to the Layout tab, and smooth-scrolls
  the layer card into view.
- **Overlay follows the playhead's cut:** Within the selected scene, the boxes always
  describe the cut under the playhead (`sceneTimings` sub-ranges, same convention as the
  timeline) — scrubbing the timeline/preview bar swaps the overlay without moving the
  editor selection. Clicking/`[`/`]`/dragging a box adopts the previewed cut; highlight,
  backdrop deselect, and chip suffix only apply while viewing the selected cut.
- **Cut Selection Auto-Seek:** When switching cuts in `VisualsTab.tsx` (`selectCut`), the
  player automatically seeks to `resolved.sceneTiming.subs[nextIdx].start` so the preview
  and overlay are always showing the active cut. Canvas adoption (`handleCanvasSelectLayer`)
  skips the seek when the playhead is already inside the target cut.

---

## 4. Phase Roadmap & Implementation Guide

### P1 — Read-Only Highlight & Selection (DONE)
- [x] `selectedLayerIndex` store integration with automatic reset on scene/cut switch.
- [x] Overlay mounting inside `RemotionVideoPlayer` container for landscape/portrait parity.
- [x] Aspect-ratio lock parity (native CSS `aspect-ratio`).
- [x] Bottom-anchored text height bounds (15% default instead of 100% blowout).
- [x] Symmetric `left` and `right` coordinate resolution.
- [x] Click backdrop and `Escape` key deselection.
- [x] Fullscreen hit-test lockout prevention.
- [x] Performance: `isPlaying` guard eliminating playback re-renders.
- [x] Layer deletion & duplication selection shift with `e.stopPropagation()` on card buttons.
- [x] Selective tab auto-open and scroll only on canvas clicks (`internalClickRef`).
- [x] Auto-seek playhead to cut start on cut selection.

### P2 — Preview → Editor Routing & Discoverability (DONE)
- [x] **Routing:** Overlay click routes into the Visuals tab via `handleCanvasSelectLayer`
  (`EditorWorkspace.tsx`) → `handleOpenVisualEditor(sceneIdx, subIdx)` for cross-cut clicks
  (select + edit session + seek), tab-flip + layer only for same-cut clicks (no seek jump).
  Store-only fallback inside `CanvasOverlay` when no callback is wired.
- [x] **Lockout guards:** `canvasLocked` (`isSectionRewriting || isSubRewriting` for the
  selected cut, same lens gate as `VisualsTab`) flows `EditorWorkspace → VideoPreview →
  CanvasOverlay`; boxes go `pointer-events: none`, backdrop hidden, chip shows
  `AI rewriting…` with disabled controls.
- [x] **Prev / Next Layer Chip Controls:** Bottom chip (`Cut N · M layers · Lx selected`)
  is a flex row with `<` / `>` wrap-around cycling through the same routing path;
  `[` / `]` keyboard cycling (skips inputs, inert while locked).

### P3 — Move & Corner Resize (DONE)
- [x] **Commit pipeline:** `VisualsTab.applyCanvasStyle` (registered via
  `onRegisterCanvasStyle`, mirroring `onRegisterFlush`) flushes pending slider
  ticks then rides the 150 ms `scheduleWriteBack` debounce — exactly one call
  per drag (pointer-up), never per pointermove. `EditorWorkspace`
  (`handleCanvasStyleCommit`) prefers the applier and falls back to a direct
  section merge only when `VisualsTab` is unmounted (unmount already flushed,
  so nothing can be clobbered). Plumbs `VisualsTab → InspectorPanel →
  EditorWorkspace → VideoPreview → CanvasOverlay`.
- [x] **Move:** body-drag on any non-fullscreen box, pointer capture (+ window
  pointer fallback if capture is lost) with rAF-coalesced local state,
  `%`-space deltas from the overlay root rect (zoom-proof). Anchor-preserving
  commit (`right`/`bottom` stay anchored, stale opposite key deleted so the box
  can never stretch). Snaps box edges/center to 0 % / 50 % / 100 % within 1 %.
  Positions clamp to 0–100 % (Layout-slider parity).
- [x] **Corner resize:** 4 handles on the selected box (hidden when locked or
  fullscreen; rotated layers resize in local axes since P4). Aspect-locked drags
  update width only and drop `height` (renderer keeps deriving it); north
  handles pin the bottom edge (height backed out from width × container aspect
  × ratio — exact and rotation-safe, incl. bottom-anchored layers). Freeform
  drags set width + height (10–100 % slider parity). All resizes normalize both
  axes to `left`/`top` so the grabbed edge is the one that moves.
- [x] **Interaction guards:** `<4 px` stays a click (shared pointerdown-select
  path with click suppression); `Escape` cancels mid-drag (and resets the
  suppression flag); pointercancel/blur/unmount drop the session without a
  partial commit. Dropped style stays visible as a `pendingCommit` override
  across the debounce window (order-independent shallow compare + 2 s backstop
  so it can never strand); stale layer indices self-heal per the index-keyed
  convention.

### P4 — Rotate, Edge Resize & Scale Mode (DONE)
- [x] **Rotate handle:** lollipop above the selected box (orbits rigidly with it —
  no counter-rotation, so the stem never detaches; lifted clear of the North
  handle hitbox). Angle from `atan2(pointer − center)` around the layout center
  with grab-offset capture (no jump on grab), normalized to −180…180°, snapped
  to 45° multiples within 3°, committed as `content.style.rotate = "Ndeg"`.
  Deadbanded clicks never dirty the doc; shared rAF tick keeps spins smooth.
  Live transform preview during the spin; same single-commit lens pipeline +
  `pendingCommit` bridge.
- [x] **Edge resize:** N/S/E/W mid-edge handles (single-axis, same clamps;
  rotation-aware cursors). N/S go freeform and release the aspect lock (like
  the Layout tab's Unlock, with live freeform preview mid-drag); E/W keep it
  width-only. Deltas run through the inverse rotation for rotated layers, and
  the stationary edge re-pins through the world transform (rotation + mirror),
  so opposite edges never swing and handles track the cursor.
- [x] **Scale mode (Alt-drag):** Alt+corner-drag scales `scaleX`/`scaleY`
  (10–500 %) instead of dimensions — sign-preserving (flip-safe, handle
  directions unmirror), uniform on aspect-locked media (dominant drag axis),
  legacy `scale` deleted exactly like the sliders. Toggleable mid-drag
  (Figma-style). Handles counter-scale so they stay grabbable at extremes;
  live transform preview, same commit pipeline.
- [x] **Commit safety:** sessions capture cut identity at dragstart; a
  mid-gesture selection change voids the commit instead of miswriting.

---

## 5. Edge Cases & Manual Test Matrix

Run this matrix after each phase:

| Dimension | Test Case | Expected Result |
|---|---|---|
| **Orientation** | Landscape (`1920×1080`) vs Portrait (`1080×1920`) | Overlay box aligns exactly with video frame without horizontal offset or letterbox drift. |
| **Quality** | Fast Preview (`0.5x`) vs Full Quality (`1.0x`) | Box coordinates remain identical regardless of compositionScale. |
| **Zoom** | Fit, 100%, 150% Zoom | Overlay scales smoothly with `motion.div` zoom without boundary separation. |
| **Bottom Anchor** | Text with `bottom: 15%`, no explicit height | Box wraps lower-third text (~15% height) without extending above canvas. |
| **Aspect Lock** | Media with `aspectRatio: '1/1'`, `width: 50%` | Square box matches rendered media in both landscape and portrait. |
| **Rotation** | Layer with `rotate: '45deg'` or `180deg'` | Box rotates with element; label badge counter-rotates to stay upright. |
| **Stacking** | Fullscreen background + small foreground logo | Clicking logo selects logo; clicking empty space deselects; fullscreen does not trap clicks. |
| **Playback** | Video playing at 30 FPS | Overlay unmounts during playback; zero frame drops or style churn. |
| **Persistence** | Card save (`Ctrl+S` or Save button) | Values committed to `scriptData` and disk cleanly. |
| **Rotated Resize** | Drag East handle on a layer with `rotate: 45deg` | Opposite edge stays pinned in screen space; box grows along its local axis without drifting; handle tracks the cursor. |
| **Aspect Edge Unlock** | Drag North handle on media with `aspectRatio: '16/9'` | Box height updates smoothly in real time during the drag; aspect releases on drop and the Layout tab shows freeform height. |
| **Alt-Scale Aspect** | Alt + corner drag on 1:1 square media | Layer scales uniformly (`scaleX === scaleY`), preserving square proportion. |
| **Lollipop Click** | Click rotate lollipop without dragging | No style commit occurs; layer stays selected without dirtying the document. |
| **Lollipop Visual** | Rotate layer to 90° or 180° | Lollipop stem stays attached and perpendicular to the box's top edge. |
| **Flipped Resize** | Drag East handle on a layer with negative `scaleX` | Grabbed (screen-east) edge follows the cursor outward; box grows instead of shrinking. |
