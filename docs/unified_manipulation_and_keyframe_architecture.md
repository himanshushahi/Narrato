# Unified Manipulation & Native In-Place Keyframe Architecture

This document specifies the technical design, feature parity audit, and implementation roadmap for transitioning Remotion Canvas from an isolated "Animations Tab" model to an industry-standard **Universal Native In-Place Keyframing Architecture** (modeled after Adobe Premiere Pro, After Effects, DaVinci Resolve, and Final Cut Pro).

---

## 1. Executive Summary & Paradigm Shift

### Current Limitation: The Isolated Animation Tab
In the existing architecture, animation is cordoned off into an isolated `✨ Animations` tab:
1. **Context Fragmentation**: When a user is in `📐 Layout` tweaking **Scale**, **Rotation**, or **3D Tilt**, they can only set static numbers. To animate a punch-zoom or 3D card tilt, they must switch tabs, open a dropdown, pick the property, and type numbers detached from the visual sliders.
2. **Hidden Capabilities**: In `🎭 Filters`, powerful animatable effects like **Layer Blur** (rack focus) and **Brightness** (exposure flares) exist as static sliders, but their animation power is completely invisible to the user without switching to the animation tab.
3. **Missing Static Counterparts**: Some animatable properties (most notably `opacity`) have no static manipulation slider at all in the Layout or Filter tabs! If a user wants a layer to be permanently 40% translucent (e.g. watermark or subtle overlay), there is no GUI slider for it.
4. **Untapped Static Features**: The editor has dozens of rich manipulation features (`contrast`, `grayscale`, `sepia`, `backdropFilter`, `borderRadius`, `scaleX`, `scaleY`, `perspective`) that exist statically, but cannot be animated by the engine.

### The Target Architecture: Universal Native Keyframing
In professional NLEs (Non-Linear Editors) and motion graphics suites:
- **Every manipulation control natively carries its own Keyframe Stopwatch (⬥ / ⏱️)**.
- Activating the keyframe button directly beneath or beside the slider opens an **inline animation track** configured right at the point of manipulation.
- The `✨ Animations` tab evolves into a **Master Timeline Track Sheet** (global overview of all active tracks on the layer, exit sequencing, and timing orchestration), while day-to-day animation happens right where the feature lives.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⟳ Scale & Rotation                                                          │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Scale (Uniform)                              [ ⬥ Keyframe ]          100%   │
│ ═══════════════════════════════════════════════════════════════════════════ │
│   ▼ Active Animation Track (Remotion Spring Physics)                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ From: [ 80% ] ──────► To: [ 100% ]                                  │   │
│   │ Duration: 0.60s      Delay: 0.20s     Loop: [ None ▾ ]              │   │
│   │ Easing: [ Spring ▾ ] (Damping: 14, Stiffness: 100, Mass: 0.9)       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ Rotation                                     [ ⬥ Keyframe ]            0°   │
│ ═══════════════════════════════════════════════════════════════════════════ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Comprehensive Audit: 10 Current Animation Types vs. Static Features

The Remotion AST Animator (`frontend/src/components/video/ASTAnimator.tsx`) currently evaluates **10 animatable properties**:

| # | Animation Property | Engine Range / Units | Static Control Exists in App? | Static Control Location | Status & Gap Analysis |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | `scale` | `0.01` – `5.0` (multiplier) | **YES** | `AstLayoutControls.tsx` (Scale Uniform slider, 10%–500%) | **Parity Exists**: Direct 1:1 mapping. Ready for inline keyframe button. |
| **2** | `translateX` | `-1920` – `1920` (pixels travel) | **Partial** | `AstLayoutControls.tsx` (`left: 0%–100%`) | **Gap**: Static positioning uses `left`/`right` (box layout), while `translateX` in ASTAnimator is a pixel travel delta applied to container transform. |
| **3** | `translateY` | `-1080` – `1080` (pixels travel) | **Partial** | `AstLayoutControls.tsx` (`top`/`bottom: 0%–100%`) | **Gap**: Static positioning uses `top`/`bottom` (box layout), while `translateY` is a pixel travel delta. |
| **4** | `translateZ` | `-1000` – `1000` (pixels 3D depth) | **YES** | `AstLayoutControls.tsx` (3D Depth Z slider, -500px to +500px) | **Parity Exists**: Direct 1:1 mapping with static `translateZ`. Ready for inline keyframing. |
| **5** | `rotate` | `-360°` – `360°` (degrees 2D) | **YES** | `AstLayoutControls.tsx` (Rotation slider, -180° to +180°) | **Parity Exists**: Direct 1:1 mapping with static `rotate`. Ready for inline keyframing. |
| **6** | `rotateX` | `-90°` – `90°` (degrees 3D pitch) | **YES** | `AstLayoutControls.tsx` (Tilt X slider, -90° to +90°) | **Parity Exists**: Direct 1:1 mapping with static `rotateX`. Ready for inline keyframing. |
| **7** | `rotateY` | `-90°` – `90°` (degrees 3D yaw) | **YES** | `AstLayoutControls.tsx` (Pan Y slider, -90° to +90°) | **Parity Exists**: Direct 1:1 mapping with static `rotateY`. Ready for inline keyframing. |
| **8** | `opacity` | `0.0` – `1.0` (alpha transparency) | **NO** | *None* (only exists in `AstAnimationBuilder`) | **CRITICAL GAP**: No static `opacity` slider exists in `AstLayoutControls` or `AstFilterControls`. Must add static Opacity slider first. |
| **9** | `blur` | `0` – `50` (pixels Gaussian blur) | **YES** | `AstFilterControls.tsx` (Layer Blur slider, 0px–50px) | **Parity Exists**: Direct 1:1 mapping with `blur`. Ready for inline keyframing. |
| **10**| `brightness` | `0.1` – `2.0` (luma multiplier) | **YES** | `AstFilterControls.tsx` (Brightness slider, 10%–200%) | **Parity Exists**: Direct 1:1 mapping with `brightness`. Ready for inline keyframing. |

### Immediate Takeaways from the Audit:
1. **8 of the 10 animation properties** already have matching static manipulation sliders in `Layout` or `Filters`.
2. **`opacity` is completely missing a static slider**. Adding a static Opacity slider (0% to 100%) to `AstLayoutControls` or `AstFilterControls` completes the round-trip so opacity can be both static and animated.
3. **`translateX` / `translateY`**: In video editors, users can either animate absolute position or delta travel. Our engine applies `translateX`/`translateY` keyframes on top of the base `left`/`top` box position. The inline keyframe control can present these as "Slide In X" and "Slide In Y" travel deltas directly beside the Left/Top position coordinates.

---

## 3. Untapped Static Features in the App Exceeding Current Animations

Our app currently possesses numerous rich visual manipulation capabilities across `Layout`, `Filters`, `Masks`, and `Motion FX` that **cannot currently be animated**. Extending our animation engine to these properties will unlock broadcast-grade motion graphics:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   MANIPULATION FEATURES IN REMOTION CANVAS                  │
│                                                                             │
│  [ ALREADY ANIMATABLE (10) ]         [ RICH STATIC FEATURES (UNANIMATED) ]  │
│  • Scale (Uniform)                   • Contrast (0.5 – 2.2)                 │
│  • Rotate (2D)                       • Grayscale (0.0 – 1.0)                │
│  • RotateX (3D Tilt)                 • Sepia (0.0 – 1.0)                    │
│  • RotateY (3D Pan)                  • Backdrop Blur / Frosted Glass        │
│  • TranslateZ (3D Depth)             • Scale X & Scale Y (Split Stretch)    │
│  • TranslateX (Slide H)              • Corner Radius (Morph Rect -> Circle) │
│  • TranslateY (Slide V)              • Base Width & Height                  │
│  • Blur (Layer Content)              • Camera Perspective (FOV Dolly Zoom)  │
│  • Brightness                        • Mask Geometry (Size, X, Y Center)    │
│  • Opacity (Anim only, no static)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Breakdown of Unanimatable Static Features:

1. **`contrast`** (`AstFilterControls.tsx`):
   - Current static range: `0.5` to `2.2`.
   - Motion potential: Dramatic contrast punches synced to sound effects or explosive narrative beats.
2. **`grayscale` & `sepia`** (`AstFilterControls.tsx`):
   - Current static range: `0.0` to `1.0`.
   - Motion potential: Desaturating footage into archival black-and-white upon entering a historical segment, or colorizing archival footage into full color.
3. **`backdropFilter` (Backdrop Blur / Frosted Glass)** (`AstFilterControls.tsx`):
   - Current static range: `0px` to `30px`.
   - Motion potential: Frosted glass cards blurring background footage smoothly into focus behind text.
4. **`scaleX` & `scaleY` (Independent Stretch/Squash)** (`AstLayoutControls.tsx`):
   - Current static range: `-500%` to `+500%` with Flip H / Flip V.
   - Motion potential: Classic cartoon squash-and-stretch on bounce landings, dynamic horizontal stretch bars, and anamorphic lens distortion.
5. **`borderRadius` (Corner Rounding Morph)** (`AstLayoutControls.tsx`):
   - Current static range: `0px` to `200px` (or `50%` circle).
   - Motion potential: Morphing an angular rectangle card smoothly into a rounded pill or circular badge.
6. **`perspective` (Camera FOV Distance)** (`AstGraphicalEditor.tsx` Motion tab):
   - Current static range: `300px` (wide-angle dramatic) to `3000px` (telephoto flat).
   - Motion potential: **The Hitchcock Dolly Zoom (Vertigo effect)** — animating perspective from 300px to 2000px while counter-animating scale from 1.5 to 1.0, warping background perspective while keeping the subject anchored.
7. **`mask.size`, `mask.x`, `mask.y`** (`AstMaskControls.tsx`):
   - Currently, masks only animate through rigid presets (`circle_iris`, `wipe_right`, etc.).
   - Motion potential: Freeform keyframing of the mask center point `(x, y)` to follow moving subjects (manual spot tracking) or animating mask radius smoothly.

---

## 4. Technical Architecture: Native In-Place Keyframing

### 4.1 Component Architecture: `InlineKeyframeControl.tsx`

A clean, modular React component embedded directly inside slider headers:

```tsx
interface InlineKeyframeControlProps {
  property: ASTAnimationProperty;
  label: string;
  unit?: string;
  currentStaticValue: number;
  animations: ASTAnimation[];
  onChange: (updatedAnimations: ASTAnimation[]) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultFrom?: number;
  defaultTo?: number;
}
```

#### UI States:
1. **Inactive State**:
   - Small button `[ ⬥ Animate ]` in subtle stone-500 color.
   - Tooltip: "Add keyframe animation to [Property]".
2. **Active State (Track Exists)**:
   - Button turns glowing amber `[ ⬥ Animated ]` with active pill badge.
   - Right underneath the static slider, an expandable **Mini Keyframe Drawer** renders with:
     - **From & To inputs / mini-sliders** (defaulting `to` to current static slider value).
     - **Duration (s)** and **Delay (s)** sliders.
     - **Easing Dropdown**: Spring, Ease-Out, Ease-In-Out, Ease-In, Linear, Bounce, Elastic, Back, Steps, Bezier.
     - **Spring Physics Controls**: When Spring is selected, exposes Damping (14), Stiffness (100), Mass (0.9), and Clamp.
     - **Loop Mode**: None, Loop, Ping-Pong.
     - **Trash / Remove Button**: Cleans up that specific track from `layer.animations`.

### 4.2 State Synchronization & Schema Alignment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LAYER STATE OBJECT                             │
│                                                                             │
│  content.style = {                                                          │
│    scale: 1.15,               ◄── Edited by Static Slider in Layout Tab     │
│    rotate: -4,                                                              │
│    blur: 12                                                                 │
│  }                                                                          │
│                                                                             │
│  layer.animations = [                                                       │
│    {                                                                        │
│      property: 'scale',       ◄── Edited by Inline Keyframe in Layout Tab   │
│      from: 0.85,                  OR by Master Timeline in Animations Tab   │
│      to: 1.15,                                                              │
│      duration: 0.6,                                                         │
│      easing: 'spring'                                                       │
│    }                                                                        │
│  ]                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Zero Breaking Changes**:
  - The AST schema remains 100% identical.
  - The Remotion renderer `ASTAnimator.tsx` requires no breaking rewrites; it already reads `layer.animations`.
  - Backend validation in `backend/agent/schemas.py` and `validators.py` continues validating `ASTAnimation` objects seamlessly.
- **Bi-Directional Coherence**:
  - Editing an animation track inline inside `AstLayoutControls.tsx` updates `layer.animations`.
  - Viewing the `✨ Animations` tab reflects that track instantly.
  - Modifying or deleting it in the `✨ Animations` tab updates the inline control instantly.

---

## 5. Phased Implementation Roadmap

### Phase 1: Feature Parity & Missing Static Controls
- [ ] **Add Static Opacity Slider**:
  - Add `opacity` (0.0 to 1.0 / 0% to 100%) to `AstLayoutControls.tsx` and `AstFilterControls.tsx`.
  - Update `UNIVERSAL_STYLE_KEYS` in `backend/agent/schemas.py` to allow static `opacity`.
  - Update `ASTRenderer.tsx` to apply static `style.opacity`.
- [ ] **Standardize Position Offsets**:
  - Document and expose intuitive "Slide In / Out" delta keyframes relative to the layer's `left`/`top` box position.

### Phase 2: Create Reusable `InlineKeyframeControl`
- [ ] Build `frontend/src/features/ProjectEditor/components/InlineKeyframeControl.tsx`:
  - Toggle button with active status indicators.
  - Expandable mini-drawer with `from`, `to`, `duration`, `delay`, `easing`, and `loop_mode`.
  - Integration with Remotion spring physics presets and Bézier curve inputs.

### Phase 3: Embed Native Keyframing in Existing Advanced Tabs
- [ ] **Layout Tab (`AstLayoutControls.tsx`)**:
  - Embed inline keyframing for:
    - `scale` (Uniform Scale)
    - `rotate` (2D Rotation)
    - `rotateX` (3D Tilt X)
    - `rotateY` (3D Pan Y)
    - `translateZ` (3D Depth Z)
    - `translateX` & `translateY` (Slide In X/Y)
    - `opacity` (Layer Opacity)
- [ ] **Filters Tab (`AstFilterControls.tsx`)**:
  - Embed inline keyframing for:
    - `blur` (Layer Content Blur / Rack Focus)
    - `brightness` (Exposure Flash / Luma Fade)

### Phase 4: Expand Remotion Animator to Unanimatable Features
- [ ] Extend `ASTAnimator.tsx` to animate:
  - `contrast` (0.5 to 2.2)
  - `grayscale` (0.0 to 1.0)
  - `sepia` (0.0 to 1.0)
  - `scaleX` & `scaleY` (Independent horizontal/vertical stretch)
  - `borderRadius` (Shape morphing)
  - `backdropFilter` (Frosted glass opacity)
- [ ] Add matching schema properties to `AnimationProperty` in `backend/agent/schemas.py`.
- [ ] Embed inline keyframe controls for these new properties in their respective tabs.

### Phase 5: Transform Animations Tab into Master Timeline Track Sheet
- [ ] Evolve `AstAnimationBuilder.tsx`:
  - Show a consolidated multi-track overview of all animated properties on the layer.
  - Provide a visual timing timeline bar showing start delays, durations, and layer exit timestamps.
  - Include batch timing actions (e.g. "Shift All +0.3s", "Scale All Durations 1.2x").

---

## 6. Verification and Acceptance Criteria
1. **Compilation**: `npx tsc --noEmit` and `npm run build` pass with 0 errors.
2. **Backend Integrity**: All 377+ pytest tests pass with 100% success rate.
3. **No Redundant Tabs**: Users can animate any supported property directly from the tab where that property is configured without switching tabs.
4. **Master Inspector Consistency**: Changes made inline immediately reflect in the master Animations inspector and vice versa.
