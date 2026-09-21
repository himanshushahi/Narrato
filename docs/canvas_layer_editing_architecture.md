# Canvas Layer Highlight & Visual Transform Editing Architecture

This document serves as the comprehensive architectural reference, implementation guide, and technical specification for the **Canvas Layer Direct Manipulation Engine** (`CanvasOverlay`) in Remotion Canvas.

---

## 1. System Overview & Architecture Goals

The Canvas Layer Editing engine provides an interactive, visual direct-manipulation surface on top of the Remotion video preview player. It bridges the gap between the low-level AST layout schema and an intuitive, Figma-like visual editing experience.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REMOTION VIDEO PREVIEW PLAYER                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Remotion <Player /> (Canvas / WebGL / Video / Audio Output)           │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ <CanvasOverlay /> (Active when paused; returns null on play)     │  │  │
│  │  │                                                                 │  │  │
│  │  │    [Lollipop 🍭 Rotate Handle]                                  │  │  │
│  │  │         │                                                       │  │  │
│  │  │    ┌────○────────────────────────┐                              │  │  │
│  │  │    │■ ◄── NW Handle    N Handle──┼■                             │  │  │
│  │  │    │                             │                              │  │  │
│  │  │    │   [Selected Layer Box]      │                              │  │  │
│  │  │    │   • Translate (Body drag)   │                              │  │  │
│  │  │    │   • Alt-Drag (Scale mode)   │                              │  │  │
│  │  │    │                             │                              │  │  │
│  │  │    │■ ◄── W Handle               │■ ◄── E Handle                │  │  │
│  │  │    └─────────────────────────────┘                              │  │  │
│  │  │     ■ SW Handle        S Handle──■   SE Handle──■               │  │  │
│  │  │                                                                 │  │  │
│  │  │    [ ‹ Cut 2 · 3 layers · L1 selected › ]                       │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ▲ │
            Bidirectional Sync    │ │  Debounced Style Commit
                                  │ ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│           INSPECTOR / AST GRAPHICAL EDITOR (Layout & Style Sliders)         │
│  [Position: Left / Top / Width / Height]  [Rotate: 0°]  [Scale: 100%]       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Capabilities
1. **Bidirectional Editor ↔ Preview Selection**:
   - Selecting any layer card in `AstGraphicalEditor.tsx` instantly highlights the layer boundary box on the preview canvas.
   - Clicking any layer directly on the video canvas selects it, expands the **Advanced (Layout, Animations, Filters & Motion FX)** panel, selects the **Layout** tab, and smooth-scrolls the layer's control card into view.
2. **Direct Visual Manipulation**:
   - **Translation (Move)**: Drag element body with 0%/50%/100% canvas alignment snapping and symmetric off-canvas support.
   - **Corner Resize**: 4 corner handles with aspect-ratio preservation and rotation-safe bottom pinning.
   - **Edge Resize**: 4 mid-edge handles (N/S/E/W) with inverse-rotation local-axis projection.
   - **Rotation**: Orbiting lollipop handle with 45° increment snapping.
   - **Scale Mode (Alt-drag)**: Alt+corner-drag scales `scaleX` and `scaleY` percentages (10% to 500%) preserving flips.
3. **Strict Renderer Parity**:
   - Overlay geometry strictly mirrors the Remotion AST rendering pipeline in `frontend/src/components/video/ASTRenderer.tsx` (handling `LAYOUT_PROPS`, `aspectRatio`, `parseStaticTransform`, `transformOrigin`, and bottom anchoring).
4. **Debounced Commit Pipeline**:
   - Interactive pointer gestures run at 60 FPS in local React state and requestAnimationFrame (rAF), committing to `scriptData` only on `pointerup` through a 150ms trailing debounce (`VisualsTab.applyCanvasStyle`), preventing state churn or video stutter.

---

## 2. Component Hierarchy & Mounting Contract

The Canvas Overlay is mounted in [`frontend/src/features/EditorWorkspace/VideoPreview.tsx`](file:///d:/Real-Life-Projects/remotion_canvas/frontend/src/features/EditorWorkspace/VideoPreview.tsx) alongside [`RemotionVideoPlayer.tsx`](file:///d:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/RemotionVideoPlayer.tsx).

### Mount Point Architecture
```tsx
<div className="relative w-full h-full flex items-center justify-center overflow-hidden">
  <motion.div style={{ scale: zoomScale }}>
    <RemotionVideoPlayer
      ref={playerRef}
      compositionWidth={compositionSize.width}
      compositionHeight={compositionSize.height}
      ...
    />
    <CanvasOverlay
      scenes={liveScenes}
      activeCut={activeCut}
      onCommitStyle={handleCanvasStyleCommit}
      onSelectLayer={handleCanvasSelectLayer}
      locked={isRewritingActive}
    />
  </motion.div>
</div>
```

### Critical Container Contracts
- **Shared Bounding Box**: Both `<RemotionVideoPlayer />` and `<CanvasOverlay />` reside inside the exact same `motion.div` zoom container, ensuring that canvas coordinates match video pixels under 100%, Fit, or 150%+ zoom.
- **Orientation & Aspect Parity**:
  - **Landscape (16:9)**: Container adopts `aspect-video w-full`.
  - **Portrait (9:16)**: Container adopts `aspect-[9/16] w-full max-w-[39.375vh]` so the height always fits the viewport without breaking the 9:16 aspect ratio or introducing letterboxing desynchronization.
- **Playback Guard (Zero CPU/GPU Overhead During Play)**:
  When `usePlaybackStore.isPlaying === true`, `CanvasOverlay` returns `null` immediately. This completely eliminates 30–60 FPS style recalculations and virtual DOM churn during video playback.

---

## 3. Data Model & Conventions

### Index-Keyed Layer Identity
In the Remotion Canvas AST schema, layers do **not** have persistent unique IDs; they are strictly index-keyed within the cut's sequence:
```json
{
  "type": "Sequence",
  "children": [
    { "type": "Layer", "content": { "type": "Background", "style": { ... } } },
    { "type": "Layer", "content": { "type": "Text", "style": { ... } } }
  ]
}
```

### Selection State Rules
Selection state is stored in `useEditorStore.ts`:
```typescript
selectedLayerIndex: number | null
setSelectedLayerIndex: (idx: number | null) => void
```
1. **Clear on Scope Change**: `selectedLayerIndex` is automatically reset to `null` whenever `selectedSceneIndex` or `selectedSubVisualIndex` changes, as well as on cut deletion.
2. **Index Shift on Mutation**:
   - **Delete Layer `idx`**: If `selectedLayerIndex === idx`, reset to `null`; if `selectedLayerIndex > idx`, decrement by 1.
   - **Duplicate Layer `idx`**: If `selectedLayerIndex === idx`, select new copy (`idx + 1`); if `selectedLayerIndex > idx`, increment by 1.
3. **Transient UI State**: `selectedLayerIndex` is purely interactive runtime state and is never persisted to `project.json` or `script.json`.

---

## 4. Coordinate System & Renderer Parity

To ensure that the overlay bounding box matches the underlying rendered layer to the exact pixel, [`CanvasOverlay.tsx`](file:///d:/Real-Life-Projects/remotion_canvas/frontend/src/features/EditorWorkspace/components/CanvasOverlay.tsx) implements strict parity with `ASTRenderer.tsx`:

### Layout Property Parsing
| Property | AST / Style Format | Overlay Interpretation |
|---|---|---|
| **`left` / `top` / `right` / `bottom`** | String `%`, `px`, or raw number | Resolved to container percent space using `baseWidth` and `baseHeight`. Symmetrically supports `right` and `bottom` anchored layers. |
| **`width` / `height`** | String `%` (10%–100%) or `px` | Clamped to valid dimension space. |
| **`aspectRatio`** | String `"16/9"`, `"1/1"`, `"4/5"`, etc. | When present, `height` is left `undefined` and CSS `aspectRatio: box.aspectRatio` is applied, letting the browser derive exact height without distortion in 16:9 or 9:16. |
| **`bottom` Text Fallback** | Subtitle/headline text with `bottom` | Text layers without explicit height default to a proportional 15% lower-third box instead of expanding to 100% fullscreen. |
| **`rotate`** | String `"Ndeg"` or number | `parseRotate` extracts degrees; static transform applies `rotate(Ndeg)` with pivot at `transformOrigin` (defaulting to `center`). |
| **`scaleX` / `scaleY`** | Number (e.g. 1.0, -1.0) or `"%"` | Scale factors normalized and formatted as `scale(sx, sy)`. Negative values preserve flip orientation. |

### Hit-Testing & Layer Stacking
- **Fullscreen Background Clamping**: Fullscreen background layers (`children[0]` or `width/height: 100%`) are clamped to `z-index: 15`. Foreground layers are assigned `z-index: 20 + layerIndex` (and selected layer gets `z-index: 100`). This ensures background elements never intercept pointer clicks aimed at foreground cards or text.
- **Click-Out Backdrop**: An invisible backdrop (`z-index: 0`) is mounted when `selectedLayerIndex !== null` so clicking empty canvas space cleanly deselects the layer.
- **Keyboard Deselection**: Pressing `Escape` deselects the active layer and cancels any in-progress drag operation.

---

## 5. Interactive Manipulation Modes

### 5.1 Translation (Move)
- **Initiation**: Pointer-down on any selected, non-fullscreen box body.
- **Delta Calculation**: Pointer movement runs in `%`-space relative to the overlay container root bounding rect (`clientX / rootRect.width * 100`).
- **Anchor Preservation**: If the layer is authored with `right` or `bottom`, movement updates the existing anchor key and cleans up conflicting opposite keys (`left`/`top`) to prevent box stretching.
- **Snapping Guides**: Center and edges snap to `0%`, `50%`, and `100%` canvas bounds when within a 1% threshold.
- **Off-Canvas Freedom**: Layers can be dragged partially or fully off-canvas (essential for slide-in animation starts).

### 5.2 Corner Resizing
- **Handles**: 4 corner handles (`NW`, `NE`, `SW`, `SE`).
- **Aspect-Locked Resize**: When `aspectRatio` is defined:
  - Dragging updates `width` only and leaves `height` undefined.
  - North handles calculate height delta from width $\times$ container aspect $\times$ ratio, pinning the bottom edge cleanly.
- **Freeform Resize**: When unconstrained, dragging adjusts both `width` and `height` (10%–100% slider parity).

### 5.3 Edge Resizing
- **Handles**: 4 mid-edge handles (`N`, `S`, `E`, `W`).
- **Local-Axis Coordinate Projection**: On rotated layers, mouse screen deltas are transformed through the inverse rotation matrix so the dragged edge strictly follows the handle's local axis.
- **Aspect Unlock on N/S Drag**: Dragging the top (N) or bottom (S) handle switches the layer from aspect-locked to freeform mode, matching the behavior of the Layout tab's Unlock toggle.

### 5.4 Rotation (Lollipop Handle)
- **Handle**: Orbiting lollipop handle positioned above the box top edge.
- **Orbit Parity**: The handle stem rotates rigidly with the box transform (`rotate(Ndeg)`), avoiding visual detachment.
- **Angle Tracking**: Calculated via $\text{atan2}(Y - Y_{\text{center}}, X - X_{\text{center}})$ relative to the layer's layout center.
- **Angle Snapping**: Snaps to multiples of 45° within a 3° snap tolerance.
- **Deadband Clicks**: Clicking the lollipop handle without moving the mouse does not dirty the document or trigger a style commit.

### 5.5 Scale Mode (Alt-Drag)
- **Modifier Key**: Holding `Alt` while dragging any corner handle switches into Scale mode.
- **Behavior**: Adjusts `content.style.scaleX` and `content.style.scaleY` (10%–500%) instead of dimensions.
- **Flip Preservation**: Preserves the negative sign if the layer was flipped horizontally or vertically.
- **Counter-Scaling Handles**: Selection handles apply inverse scaling so they remain uniformly grabbable even when the layer is scaled up 400% or down to 20%.

---

## 6. Commit & Persistence Lifecycle

```
[User Pointer Gesture]
         │
         ▼
[requestAnimationFrame Local State Update] (60 FPS local overlay bounds)
         │
         ▼
[pendingCommit Shallow Override] (Immediate visual feedback across debounce)
         │
         ▼
[User Releases Pointer (pointerup)]
         │
         ▼
[VisualsTab.applyCanvasStyle()]
         │
         ▼
[150ms Trailing Debounce (scheduleWriteBack)]
         │
         ▼
[Merged into scriptData Document State]
         │
         ▼
[Disk Persistence via Whole-Document Save (Ctrl+S / Save Button)]
```

### Safety & Lockout Guards
1. **AI Rewrite Lockout**:
   When AI is actively rewriting the active section or cut (`isSectionRewriting || isSubRewriting`), `CanvasOverlay` enters a locked state:
   - Overlay boxes disable pointer events (`pointer-events: none`).
   - Bottom status chip displays `AI rewriting…`.
   - Interaction backdrop is hidden.
2. **Gesture Session Capture**:
   Drag sessions capture the active `sceneIndex`, `subVisualIndex`, and `layerIndex` at `pointerdown`. If a tab change or selection switch occurs mid-drag, the pending commit is discarded to prevent miswriting into the wrong layer.
3. **Click Suppression**:
   Pointer movements of less than 4px are treated as clicks (triggering layer selection) rather than micro-drags, preventing accidental layout shifts.

---

## 7. Edge Cases & Verification Test Matrix

When updating canvas interactions or layout styles, verify against this matrix:

| Scenario | Test Procedure | Expected Result |
|---|---|---|
| **Orientation Parity** | Toggle between Landscape (16:9) and Portrait (9:16) | Overlay box aligns exactly with video frame without horizontal offset or letterbox drift. |
| **Preview Quality Scaling** | Toggle between Fast Preview (0.5x) and Full Quality (1.0x) | Coordinates and selection box size remain identical regardless of compositionScale. |
| **Zoom Parity** | Test Fit, 100%, 150% Zoom | Overlay scales smoothly with `motion.div` zoom without boundary drift. |
| **Rotated Layer Resize** | Drag East handle on a layer with `rotate: '45deg'` | Opposite edge stays pinned; box expands strictly along its local axis; handle tracks cursor. |
| **Aspect Edge Unlock** | Drag North handle on media with `aspectRatio: '16/9'` | Height updates smoothly in real time; aspect ratio lock releases cleanly on drop. |
| **Alt-Scale Aspect** | Alt + corner drag on 1:1 square media | Layer scales uniformly (`scaleX === scaleY`), preserving square proportion. |
| **Lollipop Handle Click** | Click rotate lollipop without dragging | No style commit occurs; layer stays selected without dirtying the document. |
| **Off-Canvas Drag** | Drag a box out past each of the four canvas edges | Box exits symmetrically on all sides; Layout tab preserves value while display-clamping. |
| **Playback Performance** | Start playback with a layer selected | Overlay unmounts immediately during playback; zero frame drops or style churn. |
| **Persistence** | Trigger Card Save (`Ctrl+S` or Save button) | Values persist to disk and reload identically on app restart. |
