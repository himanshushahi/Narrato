# Future: Canvas Layer Highlight + Visual Transform Editing

Status: In progress.
- **P1 (read-only highlight/selection):** Completed with geometry parity fixes on branch `feature/canvas-layer-highlight-manipulation`.
- **P2–P4:** Pending.

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
- **Cut Selection Auto-Seek:** When switching cuts in `VisualsTab.tsx` (`selectCut`), the
  player automatically seeks to `resolved.sceneTiming.subs[nextIdx].start` so the preview
  and overlay are always showing the active cut.

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

### P2 — Preview → Editor Routing & Discoverability
- **Routing:** Overlay click should check if `inspectorTab !== 'visuals'`; if not, switch to
  `setInspectorTab('visuals')` and call `handleOpenVisualEditor(sceneIdx, subIdx)`.
- **Lockout guards:** Disable overlay interaction when `isSectionRewriting` or `isSubRewriting`
  is true for that card/cut (`pointer-events: none`).
- **Prev / Next Layer Chip Controls:** In the bottom chip (`Cut N · M layers · Lx selected`),
  add `<` and `>` buttons to cycle layer selection via keyboard or buttons.

### P3 — Move & Corner Resize (Core Direct Manipulation)
- **Coordinate Space Math:**
  - Pointer events must attach pointer capture (`setPointerCapture`) on pointer-down.
  - Compute deltas relative to the player box rect:
    ```ts
    const rect = playerBoxRef.current.getBoundingClientRect();
    const deltaXPct = (e.clientX - startX) / rect.width * 100;
    const deltaYPct = (e.clientY - startY) / rect.height * 100;
    ```
  - **Anchor Preservation:**
    - If layer uses `bottom` (e.g. `bottomPct !== null` and `topPct === null`), moving along Y
      must update `bottom` (`newBottom = initialBottom - deltaYPct`), never switch to `top`.
    - If layer uses `right`, moving along X updates `right` (`newRight = initialRight - deltaXPct`).
  - **Aspect-Locked Corner Resize:**
    - Corner dragging updates `widthPct`.
    - Leave `height: undefined` and let CSS `aspectRatio` drive the vertical dimension.
  - **Snapping:** Snap to canvas center (50%) and edges (0%, 100%) when within 1% threshold.
  - **Commit Pipeline:** Local React state during drag + `requestAnimationFrame`; on pointer-up,
    call `updateLayer(idx, 'style', finalStyle)` to ride the 150ms debounce into `scriptData`.

### P4 — Rotate, Edge Resize & Scale Mode
- **Rotate Handle Math:**
  - Position a rotation lollipop handle at `top: -32px` centered horizontally.
  - On drag, compute angle using `Math.atan2(pointerY - centerY, pointerX - centerX)` in degrees.
  - Snap to 0°, 45°, 90°, 180° when within 3°.
  - Update `content.style.rotate = `${Math.round(deg)}deg``.
- **Edge Resize:**
  - Top/Bottom handles update height (disables `aspectRatio`).
  - Left/Right handles update width.
  - For rotated layers, transform pointer delta by the inverse rotation angle before applying:
    ```ts
    const rad = -deg * Math.PI / 180;
    const localDeltaX = deltaX * Math.cos(rad) - deltaY * Math.sin(rad);
    const localDeltaY = deltaX * Math.sin(rad) + deltaY * Math.cos(rad);
    ```
- **Scale Mode (Alt-drag):**
  - Holding `Alt` while dragging corners scales `scaleX` and `scaleY` (10%–500%) instead of
    changing box dimensions, preserving flip sign.

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
