import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';
import { shallowEqualStyles } from '../visualSelection';

/**
 * Parse a CSS value (% or px or raw number) to percent space relative to 1920x1080.
 * Mirrors AstLayoutControls and ASTRenderer layout semantics.
 */
function parsePct(
  val: any,
  fallback: number,
  isHeightAxis = false,
  baseWidth = 1920,
  baseHeight = 1080
): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim();
  if (s === '') return fallback;

  if (s.endsWith('%')) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
  }
  if (s.endsWith('px')) {
    const px = parseFloat(s);
    if (!Number.isFinite(px)) return fallback;
    const base = isHeightAxis ? baseHeight : baseWidth;
    return (px / base) * 100;
  }
  const m = s.match(/([-\d.]+)/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return fallback;
    // Numbers > 100 without units are likely raw pixel dimensions
    if (n > 100 && !s.includes('%')) {
      const base = isHeightAxis ? baseHeight : baseWidth;
      return (n / base) * 100;
    }
    return n;
  }
  return fallback;
}

function parseAspect(style: Record<string, any>): string | null {
  const raw = style.aspectRatio;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = raw
    .split('/')
    .map((p) => parseFloat(p))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 2 && parts[1] > 0) return `${parts[0]} / ${parts[1]}`;
  if (parts.length === 1 && parts[0] > 0) return `${parts[0]}`;
  return null;
}

function parseRotate(val: any): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseScaleAxis(val: any): number {
  if (typeof val === 'number' && Number.isFinite(val) && val !== 0) return val;
  if (typeof val === 'string') {
    const t = val.trim();
    const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return NaN;
}

/** Same composition rule as ASTRenderer.parseStaticTransform (container-level). */
function staticTransform(style: Record<string, any>): { transform?: string; rotateDeg: number } {
  const parts: string[] = [];
  const deg = parseRotate(style.rotate);
  if (deg !== 0) parts.push(`rotate(${deg}deg)`);
  const legacy = parseScaleAxis(style.scale);
  const sxRaw = parseScaleAxis(style.scaleX);
  const syRaw = parseScaleAxis(style.scaleY);
  const sx = Number.isFinite(sxRaw) ? sxRaw : legacy;
  const sy = Number.isFinite(syRaw) ? syRaw : legacy;
  const norm = (v: number) => {
    const mag = Math.max(0.01, Math.abs(v));
    return v < 0 ? -mag : mag;
  };
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${norm(sx)})` : `scale(${norm(sx)}, ${norm(sy)})`);
  } else if (Number.isFinite(sx) && sx !== 1) {
    parts.push(`scale(${norm(sx)}, 1)`);
  } else if (Number.isFinite(sy) && sy !== 1) {
    parts.push(`scale(1, ${norm(sy)})`);
  }
  return {
    transform: parts.length > 0 ? parts.join(' ') : undefined,
    rotateDeg: deg,
  };
}

interface Box {
  leftPct: number | null;
  rightPct: number | null;
  topPct: number | null;
  bottomPct: number | null;
  widthPct: number;
  heightPct: number | null;
  aspectRatio: string | null;
  fullscreen: boolean;
  transform?: string;
  transformOrigin?: string;
  rotateDeg: number;
  borderRadius?: string;
  zIndex: number;
  isText: boolean;
}

/** Mirror of ASTRenderer layout resolution in percent space. */
function layerToBox(layer: any): Box {
  const style: Record<string, any> = layer?.content?.style || {};
  const cType = layer?.content?.type || 'Image';
  const isText = cType === 'Text';

  const hasCustomLayout = !!(
    style.width || style.height || style.top || style.left || style.right || style.bottom || style.aspectRatio
  );

  const { transform, rotateDeg } = staticTransform(style);

  if (!hasCustomLayout) {
    return {
      leftPct: 0,
      rightPct: null,
      topPct: 0,
      bottomPct: null,
      widthPct: 100,
      heightPct: 100,
      aspectRatio: null,
      fullscreen: true,
      transform,
      transformOrigin: layer?.transform_origin,
      rotateDeg,
      borderRadius: style.borderRadius,
      zIndex: layer?.z_index ?? 0,
      isText,
    };
  }

  const aspect = parseAspect(style);
  const widthPct = parsePct(style.width, 100, false);

  const rawLeft = style.left;
  const rawRight = style.right;
  const hasLeft = rawLeft !== undefined && rawLeft !== null && String(rawLeft).trim() !== '';
  const hasRight = rawRight !== undefined && rawRight !== null && String(rawRight).trim() !== '';

  const rawTop = style.top;
  const rawBottom = (style as any).bottom;
  const hasTop = rawTop !== undefined && rawTop !== null && String(rawTop).trim() !== '';
  const hasBottom = rawBottom !== undefined && rawBottom !== null && String(rawBottom).trim() !== '';

  const rawHeight = style.height;
  const hasHeight = rawHeight !== undefined && rawHeight !== null && String(rawHeight).trim() !== '';

  let heightPct: number | null = null;
  if (aspect) {
    // When aspectRatio is locked, height must NOT be forced as a percentage —
    // the browser derives it natively via CSS aspectRatio to avoid non-square distortion.
    heightPct = null;
  } else if (hasHeight) {
    heightPct = parsePct(rawHeight, 100, true);
  } else if (isText) {
    // Kinetic text without explicit height: default to a tidy 15% lower-third box
    // so bottom-anchored text doesn't stretch 100% across the whole screen.
    heightPct = 15;
  } else if (!hasTop && hasBottom) {
    heightPct = 25;
  } else {
    heightPct = parsePct(style.height, 100, true);
  }

  return {
    leftPct: hasLeft || !hasRight ? parsePct(rawLeft, 0, false) : null,
    rightPct: !hasLeft && hasRight ? parsePct(rawRight, 0, false) : null,
    topPct: hasTop || !hasBottom ? parsePct(rawTop, 0, true) : null,
    bottomPct: !hasTop && hasBottom ? parsePct(rawBottom, 0, true) : null,
    widthPct,
    heightPct,
    aspectRatio: aspect,
    fullscreen: false,
    transform,
    transformOrigin: layer?.transform_origin,
    rotateDeg,
    borderRadius: style.borderRadius,
    zIndex: layer?.z_index ?? 0,
    isText,
  };
}

function getActiveSceneIdx(scenes: any[], frame: number): number {
  let offset = 0;
  for (let i = 0; i < (scenes || []).length; i++) {
    const dur = Math.max(30, Math.ceil(((scenes[i] as any)?.duration || 0) * 30));
    // Exclusive end — same resolver as PreviewActiveSceneBadge so the overlay
    // and the badge never disagree past the total duration.
    if (frame >= offset && frame < offset + dur) return i;
    offset += dur;
  }
  return -1;
}

const wrapIdx = (cur: number, delta: number, len: number) => {
  if (len <= 0) return 0;
  return ((cur + delta) % len + len) % len;
};

// ── P3 direct-manipulation helpers ─────────────────────────────────────

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Format a percent-space number as a style value (`"12.5%"`), rounding float noise. */
function pct(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${Object.is(r, -0) ? 0 : r}%`;
}

/** Snap a box position so its edges/center land on canvas edges (0/100) or center (50%) within 1%. */
function snapPos(pos: number, size: number): number {
  const cands = [0, 50 - size / 2, 100 - size];
  for (const c of cands) {
    if (Math.abs(pos - c) <= 1) return Math.round(c * 100) / 100;
  }
  return pos;
}

type DragCorner = 'se' | 'sw' | 'ne' | 'nw';

/** Parse a normalized aspect string (`"16 / 9"` or `"1"`) to a w/h ratio. */
function parseAspectRatio(aspect: string | null): number | null {
  if (!aspect) return null;
  const parts = aspect
    .split('/')
    .map((p) => parseFloat(p))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 2 && parts[1] > 0) return parts[0] / parts[1];
  if (parts.length === 1 && parts[0] > 0) return parts[0];
  return null;
}

interface DragInit {
  left: number;
  top: number;
  width: number;
  height: number;
  aspect: string | null;
  useRight: boolean;
  useBottom: boolean;
  style: Record<string, any>;
}

interface DragSession {
  layerIdx: number;
  mode: 'move' | 'resize';
  corner: DragCorner | null;
  pointerId: number;
  startX: number;
  startY: number;
  rectW: number;
  rectH: number;
  init: DragInit;
  cur: { left: number; top: number; width: number; height: number };
  moved: boolean;
}

/**
 * Drag geometry in left/top percent space. Move snaps edges/center; resize
 * pins the opposite edge (west/north handles shift position). Aspect-locked
 * layers resize width-only — height stays derived. Size mirrors the Layout
 * sliders (10–100%), positions clamp to 0–100%.
 */
function computeDrag(
  init: DragInit,
  mode: 'move' | 'resize',
  corner: DragCorner | null,
  dxPct: number,
  dyPct: number
): { left: number; top: number; width: number; height: number } {
  if (mode === 'move') {
    return {
      left: clampN(snapPos(init.left + dxPct, init.width), 0, 100),
      top: clampN(snapPos(init.top + dyPct, init.height), 0, 100),
      width: init.width,
      height: init.height,
    };
  }
  const east = corner === 'se' || corner === 'ne';
  const south = corner === 'se' || corner === 'sw';
  if (init.aspect) {
    const width = clampN(init.width + (east ? dxPct : -dxPct), 10, 100);
    // Height scales linearly with width (fixed ratio, fixed container), so
    // north handles pin the bottom edge instead of growing the box downward.
    const height = init.width > 0 ? (init.height * width) / init.width : init.height;
    return {
      left: clampN(east ? init.left : init.left + init.width - width, 0, 100),
      top: south ? init.top : clampN(init.top + init.height - height, 0, 100),
      width,
      height,
    };
  }
  const width = clampN(init.width + (east ? dxPct : -dxPct), 10, 100);
  const height = clampN(init.height + (south ? dyPct : -dyPct), 10, 100);
  return {
    left: clampN(east ? init.left : init.left + init.width - width, 0, 100),
    top: clampN(south ? init.top : init.top + init.height - height, 0, 100),
    width,
    height,
  };
}

/**
 * Build the committed `content.style`: move preserves the author's anchor
 * (right/bottom vs left/top) while deleting any stale opposite key so the box
 * can never stretch between both. Resize sets explicit bounds and always
 * normalizes both axes to left/top — an east-handle drag on a right-anchored
 * layer must move the grabbed edge, not the opposite one. Aspect-locked
 * commits drop `height` so the renderer/overlay keep deriving it from width.
 */
function commitStyleFromDrag(
  init: DragInit,
  cur: { left: number; top: number; width: number; height: number },
  mode: 'move' | 'resize'
): Record<string, any> {
  const s: Record<string, any> = { ...init.style };
  if (mode === 'move') {
    if (init.useRight) {
      s.right = pct(clampN(100 - cur.left - cur.width, 0, 100));
      delete s.left;
    } else {
      s.left = pct(cur.left);
      delete s.right;
    }
    if (init.useBottom) {
      s.bottom = pct(clampN(100 - cur.top - cur.height, 0, 100));
      delete (s as any).top;
    } else {
      s.top = pct(cur.top);
      delete (s as any).bottom;
    }
    return s;
  }
  s.left = pct(cur.left);
  delete s.right;
  s.top = pct(cur.top);
  delete (s as any).bottom;
  s.width = pct(cur.width);
  if (init.aspect) delete s.height;
  else s.height = pct(cur.height);
  return s;
}

/**
 * P1 read-only canvas overlay: renders hit-boxes for composition layers of the
 * selected cut on top of the Remotion player.
 * Supports landscape/portrait, aspect-ratio lock, bottom-anchored text, and rotation.
 * P2: preview → editor routing (ensures Visuals tab), AI-rewrite lockout guard,
 * and prev/next layer chip controls (+ `[` / `]` keyboard cycling).
 * P3: direct manipulation — body-drag move (anchor-preserving + snap) and
 * corner-handle resize (aspect-aware), committed once per drag through the
 * VisualsTab lens debounce.
 */
export const CanvasOverlay: React.FC<{
  scenes: any[];
  /** P2 lockout: true while an AI rewrite touches the selected cut (boxes go inert). */
  locked?: boolean;
  /** P2 routing: layer click lands in the Visuals tab for that cut. Falls back to store-only routing when absent. */
  onSelectLayer?: (sceneIdx: number, subIdx: number, layerIdx: number) => void;
  /** P3 drag commit: exactly one call per drag (pointer-up) with the final `content.style`. */
  onStyleCommit?: (sceneIdx: number, subIdx: number, layerIdx: number, style: Record<string, any>) => void;
}> = ({ scenes, locked, onSelectLayer, onStyleCommit }) => {
  const selectedSceneIndex = useEditorStore((s) => s.selectedSceneIndex);
  const selectedSubVisualIndex = useEditorStore((s) => s.selectedSubVisualIndex);
  const selectedLayerIndex = useEditorStore((s) => s.selectedLayerIndex);
  const setSelectedLayerIndex = useEditorStore((s) => s.setSelectedLayerIndex);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const isLocked = locked === true;

  // P3 drag state: `drag` renders the live box; `dragRef` is the handler-live
  // session (refs are never written during render). `pendingCommit` keeps the
  // dropped style visible across the 150 ms debounce window so the box never
  // snaps back before scriptData catches up.
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [pendingCommit, setPendingCommit] = useState<{
    sceneIdx: number; subIdx: number; layerIdx: number;
    style: Record<string, any>;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const moveRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const suppressClickRef = useRef(false);
  // Capture-loss fallback (see effect below): render closures are mirrored
  // here so window listeners always call the latest handlers.
  const handlePointerMoveRef = useRef<(e: React.PointerEvent) => void>(() => {});
  const finishDragRef = useRef<(commit: boolean) => (e: React.PointerEvent) => void>(() => () => {});

  // Route a layer click into the Visuals tab. Prefers the parent callback
  // (select + edit session + conditional seek); falls back to store-only
  // routing (tab flip + layer) when the overlay is used standalone.
  const routeToLayer = (layerIdx: number) => {
    if (isLocked) return;
    if (selectedSceneIndex === null || selectedSceneIndex === undefined) return;
    if (selectedSubVisualIndex === null || selectedSubVisualIndex === undefined) return;
    if (onSelectLayer) {
      onSelectLayer(selectedSceneIndex, selectedSubVisualIndex, layerIdx);
      return;
    }
    const st = useEditorStore.getState();
    if (st.inspectorTab !== 'visuals') st.setInspectorTab('visuals');
    st.setSelectedLayerIndex(layerIdx);
  };

  // Deselect on Escape; cycle layer selection with `[` / `]`.
  // Runs before any early return so hook order stays constant. Reads live
  // selection via getState + props (never render-scope children) for the same
  // reason. Escape matches P1 semantics (works even while playing or in
  // inputs) but is inert while locked so all deselect paths agree; `[`/`]`
  // stay gated on playback and text inputs. Escape mid-drag cancels the drag.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useEditorStore.getState();
      if (e.key === 'Escape') {
        if (dragRef.current) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
          dragRef.current = null;
          moveRef.current = null;
          suppressClickRef.current = false;
          setDrag(null);
          return;
        }
        if (isLocked) return;
        if (st.selectedLayerIndex !== null) st.setSelectedLayerIndex(null);
        return;
      }
      if (dragRef.current) return; // no layer cycling mid-drag
      if (st.isPlaying) return;

      // Do not hijack hotkeys while typing in inputs, textareas, selects, or editable areas
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      if (e.key !== '[' && e.key !== ']') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (isLocked) return;
      const sceneIdx = st.selectedSceneIndex;
      const subIdx = st.selectedSubVisualIndex;
      if (sceneIdx === null || sceneIdx === undefined) return;
      if (subIdx === null || subIdx === undefined) return;

      // Only cycle when the playhead is currently displaying this scene's overlay
      const frame = usePlaybackStore.getState().currentFrame;
      if (getActiveSceneIdx(scenes, frame) !== sceneIdx) return;

      const kids: any[] = scenes?.[sceneIdx]?.sub_visuals?.[subIdx]?.composition?.children || [];
      if (kids.length === 0) return;
      const delta = e.key === ']' ? 1 : -1;
      const cur = st.selectedLayerIndex ?? (delta > 0 ? -1 : 0);
      const next = wrapIdx(cur, delta, kids.length);
      e.preventDefault();
      if (onSelectLayer) {
        onSelectLayer(sceneIdx, subIdx, next);
      } else {
        if (st.inspectorTab !== 'visuals') st.setInspectorTab('visuals');
        st.setSelectedLayerIndex(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scenes, isLocked, onSelectLayer]);

  // Orphaned-drag guard: playback/cut switches unmount the boxes mid-gesture
  // (capture dies with the node), and blur can strand a session with no
  // pointerup ever arriving. Drop the session silently — never commit a
  // partial drag.
  useEffect(() => {
    const cancel = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      dragRef.current = null;
      moveRef.current = null;
      suppressClickRef.current = false;
      setDrag(null);
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, []);

  // Capture-loss fallback: if setPointerCapture throws, the element-level
  // handlers go deaf outside the 10 px handle and mouse-up is lost. Window
  // listeners cover the gesture while a session is live; every path funnels
  // through dragRef, so double-fire with the element handlers no-ops.
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const compat = (e: PointerEvent) => e as unknown as React.PointerEvent;
    const onMove = (e: PointerEvent) => handlePointerMoveRef.current(compat(e));
    const onUp = (e: PointerEvent) => finishDragRef.current(true)(compat(e));
    const onCancel = (e: PointerEvent) => finishDragRef.current(false)(compat(e));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragActive]);

  // P3 commit bridge: clear the dropped-style override once scriptData catches
  // up (order-independent shallow compare — key order can shift across
  // save/load round-trips) or the selection moves on. A timeout backstop
  // guarantees the override can never strand a layer's rendered geometry.
  useEffect(() => {
    if (!pendingCommit) return;
    const st = useEditorStore.getState();
    if (st.selectedSceneIndex !== pendingCommit.sceneIdx || st.selectedSubVisualIndex !== pendingCommit.subIdx) {
      setPendingCommit(null);
      return;
    }
    const curStyle = scenes?.[pendingCommit.sceneIdx]?.sub_visuals?.[pendingCommit.subIdx]
      ?.composition?.children?.[pendingCommit.layerIdx]?.content?.style;
    if (shallowEqualStyles(curStyle ?? {}, pendingCommit.style)) {
      setPendingCommit(null);
      return;
    }
    const t = window.setTimeout(() => setPendingCommit(null), 2000);
    return () => window.clearTimeout(t);
  }, [scenes, pendingCommit]);

  // Self-heal a stale layer index (e.g. an AI rewrite shrank the cut's layer
  // count): clear it instead of merely masking it in the UI, so the editor
  // card highlight can't stick to a phantom layer after the lock lifts.
  // Guarded on the entry existing so transient empty liveScenes can't wipe a
  // valid pending selection.
  useEffect(() => {
    const st = useEditorStore.getState();
    const sel = st.selectedLayerIndex;
    if (sel === null || sel === undefined || sel < 0) return;
    const sceneIdx = st.selectedSceneIndex;
    const subIdx = st.selectedSubVisualIndex;
    if (sceneIdx === null || sceneIdx === undefined) return;
    if (subIdx === null || subIdx === undefined) return;
    const entry = scenes?.[sceneIdx]?.sub_visuals?.[subIdx];
    if (!entry) return;
    const kids: any[] = entry?.composition?.children || [];
    if (sel >= kids.length) st.setSelectedLayerIndex(null);
  }, [scenes, selectedSceneIndex, selectedSubVisualIndex, selectedLayerIndex]);

  // NOTE: All hooks must run unconditionally before any early return.
  // Previously useMemo(activeSceneIdx) sat after `if (isPlaying) return null`,
  // so toggling play / clicking preview changed the hook count and React threw
  // "Rendered fewer hooks than expected" inside <CanvasOverlay>.
  // Active scene resolution
  const activeSceneIdx = useMemo(() => {
    return getActiveSceneIdx(scenes, currentFrame);
  }, [scenes, currentFrame]);

  // Performance: Hide overlay entirely while video is playing.
  // Eliminates 30–60 FPS style churn and allows full GPU bandwidth for playback.
  if (isPlaying) return null;

  // Only the selected cut gets boxes, and only while the playhead is inside
  // that scene — otherwise the boxes would describe a cut the player isn't showing.
  if (selectedSceneIndex === null || selectedSceneIndex === undefined) return null;
  if (selectedSubVisualIndex === null || selectedSubVisualIndex === undefined) return null;
  if (selectedSceneIndex !== activeSceneIdx) return null;

  const scene = scenes[selectedSceneIndex];
  const subVisuals: any[] = scene?.sub_visuals || [];
  if (selectedSubVisualIndex < 0 || selectedSubVisualIndex >= subVisuals.length) return null;
  const children: any[] = subVisuals[selectedSubVisualIndex]?.composition?.children || [];
  if (children.length === 0) return null;

  // Paint order: background layers first, non-fullscreen on top.
  const ordered = children
    .map((layer, idx) => ({ layer, idx }))
    .sort((a, b) => (a.layer?.z_index ?? 0) - (b.layer?.z_index ?? 0));

  const hasValidSelection =
    selectedLayerIndex !== null &&
    selectedLayerIndex !== undefined &&
    selectedLayerIndex >= 0 &&
    selectedLayerIndex < children.length;

  // P2 chip cycling: wraps around the cut's layers, routes through the same
  // Visuals-tab path as a box click so the editor card follows the canvas.
  const cycleLayer = (delta: number) => {
    if (isLocked || children.length === 0) return;
    const cur = selectedLayerIndex ?? (delta > 0 ? -1 : 0);
    routeToLayer(wrapIdx(cur, delta, children.length));
  };

  // ── P3 direct manipulation ──────────────────────────────────────────
  // Pointerdown selects immediately (click and drag share one path; the
  // follow-up click is suppressed) and opens a drag session. A <4 px nudge
  // stays a click; beyond that the box follows the pointer with rAF
  // coalescing. Pointer-up commits exactly once via onStyleCommit, which
  // rides the VisualsTab 150 ms debounce — never a per-move store write.
  const beginDrag = (
    e: React.PointerEvent,
    layerIdx: number,
    box: Box,
    layer: any,
    mode: 'move' | 'resize',
    corner: DragCorner | null
  ) => {
    if (isLocked || isPlaying) return;
    if (box.fullscreen) return;
    if (mode === 'resize' && box.rotateDeg !== 0) return; // P4 owns rotated resize
    e.stopPropagation();
    // NOTE: no preventDefault here — suppressing the compat click would strand
    // suppressClickRef when the gesture ends without one (pointercancel/blur).
    // Text selection is already off via `select-none` on the preview root.
    suppressClickRef.current = true;
    routeToLayer(layerIdx);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const style: Record<string, any> = { ...(layer?.content?.style || {}) };
    // Resolve the rendered height in % space. Aspect-locked layers derive it
    // from width (never from the style), so back it out via the container
    // aspect — exact, rotation-safe, and correct for bottom-anchored layers
    // (whose top is derived from bottom + height below).
    let height: number;
    if (box.aspectRatio) {
      const ratio = parseAspectRatio(box.aspectRatio);
      height =
        ratio && ratio > 0
          ? (box.widthPct * (rect.width / rect.height)) / ratio
          : (box.heightPct ?? 15);
    } else {
      height = box.heightPct ?? 15;
    }
    const left = box.leftPct !== null ? box.leftPct : 100 - (box.rightPct ?? 0) - box.widthPct;
    const top = box.topPct !== null ? box.topPct : 100 - (box.bottomPct ?? 0) - height;
    const session: DragSession = {
      layerIdx, mode, corner, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      rectW: rect.width, rectH: rect.height,
      init: {
        left, top, width: box.widthPct, height,
        aspect: box.aspectRatio,
        useRight: box.leftPct === null && box.rightPct !== null,
        useBottom: box.topPct === null && box.bottomPct !== null,
        style,
      },
      cur: { left, top, width: box.widthPct, height },
      moved: false,
    };
    dragRef.current = session;
    setDrag(session);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable — drag still tracks while inside */ }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < 4 && !s.moved) return;
    moveRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const cur = dragRef.current;
      const m = moveRef.current;
      if (!cur || !m) return;
      const next = computeDrag(
        cur.init, cur.mode, cur.corner,
        ((m.x - cur.startX) / cur.rectW) * 100,
        ((m.y - cur.startY) / cur.rectH) * 100
      );
      const updated: DragSession = { ...cur, cur: next, moved: true };
      dragRef.current = updated;
      setDrag(updated);
    });
  };

  const finishDrag = (commit: boolean) => (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    dragRef.current = null;
    moveRef.current = null;
    setDrag(null);
    // Cancelled gestures fire no click — reset the suppress flag here so it
    // can't leak into the next gesture's backstop click.
    if (!commit) {
      suppressClickRef.current = false;
      return;
    }
    if (!s.moved) return; // plain click — selection already applied on pointerdown
    const final = computeDrag(
      s.init, s.mode, s.corner,
      ((e.clientX - s.startX) / s.rectW) * 100,
      ((e.clientY - s.startY) / s.rectH) * 100
    );
    const style = commitStyleFromDrag(s.init, final, s.mode);
    const st = useEditorStore.getState();
    const sceneIdx = st.selectedSceneIndex;
    const subIdx = st.selectedSubVisualIndex;
    if (sceneIdx === null || sceneIdx === undefined || subIdx === null || subIdx === undefined) return;
    setPendingCommit({ sceneIdx, subIdx, layerIdx: s.layerIdx, style });
    onStyleCommit?.(sceneIdx, subIdx, s.layerIdx, style);
  };

  // Mirror render closures for the window fallback above (same discipline as
  // EditorWorkspace's latest-state refs: handlers read these, never stale
  // render scope, when the gesture outlives the element).
  handlePointerMoveRef.current = handlePointerMove;
  finishDragRef.current = finishDrag;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: 'none' }}
    >
      {/* Backdrop: Clicking empty canvas space deselects the current layer */}
      {hasValidSelection && !isLocked && (
        <div
          className="absolute inset-0 z-0 cursor-default"
          style={{ pointerEvents: 'auto' }}
          onClick={() => setSelectedLayerIndex(null)}
        />
      )}

      {ordered.map(({ layer, idx }) => {
        const box = layerToBox(layer);
        const selected = selectedLayerIndex === idx;
        const cType = layer?.content?.type || 'Image';

        // P3 live geometry: active drag session wins; else the dropped-style
        // override (debounce window); else the committed box.
        const liveDrag = drag && drag.layerIdx === idx ? drag.cur : null;
        const pendingStyle: Record<string, any> | null =
          !liveDrag &&
          pendingCommit !== null &&
          pendingCommit.sceneIdx === selectedSceneIndex &&
          pendingCommit.subIdx === selectedSubVisualIndex &&
          pendingCommit.layerIdx === idx
            ? pendingCommit.style
            : null;
        const effBox: Box = liveDrag
          ? {
              ...box,
              leftPct: liveDrag.left,
              rightPct: null,
              topPct: liveDrag.top,
              bottomPct: null,
              widthPct: liveDrag.width,
              heightPct: box.aspectRatio ? null : liveDrag.height,
            }
          : pendingStyle
            ? layerToBox({ ...layer, content: { ...(layer?.content || {}), style: pendingStyle } })
            : box;

        const posStyle: React.CSSProperties = effBox.fullscreen
          ? { left: 0, top: 0, width: '100%', height: '100%' }
          : {
              ...(effBox.leftPct !== null ? { left: `${effBox.leftPct}%` } : {}),
              ...(effBox.leftPct === null && effBox.rightPct !== null ? { right: `${effBox.rightPct}%` } : {}),
              width: `${effBox.widthPct}%`,
              ...(effBox.topPct !== null ? { top: `${effBox.topPct}%` } : {}),
              ...(effBox.topPct === null && effBox.bottomPct !== null ? { bottom: `${effBox.bottomPct}%` } : {}),
              ...(effBox.aspectRatio
                ? { aspectRatio: effBox.aspectRatio }
                : (effBox.heightPct !== null ? { height: `${effBox.heightPct}%` } : {})),
            };

        // Fullscreen layers stay behind non-fullscreen layers even when selected,
        // so smaller foreground layers are never trapped beneath them.
        const z = box.fullscreen
          ? (selected ? 15 : 10 + box.zIndex)
          : (selected ? 100 : 20 + box.zIndex);

        // Keep label badges visible inside container when box is near the top edge
        const isNearTop = effBox.topPct !== null && effBox.topPct < 4 && !effBox.fullscreen;
        const badgeTop = isNearTop ? 4 : -22;
        const badgeLeft = isNearTop ? 4 : 0;
        const counterRotate = box.rotateDeg ? `rotate(${-box.rotateDeg}deg)` : undefined;

        // P3: body drag moves (anchor-preserving commit). Fullscreen layers
        // are select-only — a 100×100 box has no position to drag.
        const draggable = !box.fullscreen && !isLocked;
        const draggingThis = drag !== null && drag.layerIdx === idx;
        const showHandles = selected && !box.fullscreen && !isLocked && box.rotateDeg === 0;

        return (
          <div
            key={idx}
            onPointerDown={(e) => beginDrag(e, idx, box, layer, 'move', null)}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag(true)}
            onPointerCancel={finishDrag(false)}
            onClick={(e) => {
              // Pointerdown already selected (drag path suppresses this);
              // this is the backstop for select-only boxes (fullscreen).
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              e.stopPropagation();
              routeToLayer(idx);
            }}
            title={`Layer ${idx + 1} · ${cType}${box.fullscreen ? ' (fullscreen)' : ''}${isLocked ? ' — AI rewriting…' : ''}`}
            style={{
              ...posStyle,
              position: 'absolute',
              pointerEvents: isLocked ? 'none' : 'auto',
              cursor: isLocked ? 'default' : draggingThis ? 'grabbing' : draggable ? 'move' : 'pointer',
              touchAction: draggable ? 'none' : undefined,
              zIndex: z,
              borderRadius: box.borderRadius || 2,
              transform: box.transform,
              transformOrigin: box.transformOrigin || 'center',
            }}
            className={`group/box transition-colors ${
              selected
                ? 'border-2 border-amber-500 bg-amber-500/10 shadow-[0_0_14px_rgba(245,158,11,0.25)]'
                : 'border border-dashed border-transparent hover:border-amber-500/70 hover:bg-amber-500/5'
            }`}
          >
            <span
              style={{
                position: 'absolute',
                top: badgeTop,
                left: badgeLeft,
                pointerEvents: 'none',
                fontSize: 10,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                padding: '1px 6px',
                borderRadius: 6,
                background: selected ? 'rgba(245,158,11,0.95)' : 'rgba(0,0,0,0.75)',
                color: selected ? '#000' : '#fcd34d',
                opacity: selected ? 1 : 0,
                transform: counterRotate,
                transformOrigin: 'top left',
              }}
              className="group-hover/box:opacity-100 transition-opacity"
            >
              {`L${idx + 1} · ${cType}`}
            </span>
            {/* P3 corner resize handles (aspect-aware; hidden when rotated — P4). */}
            {showHandles &&
              (['se', 'sw', 'ne', 'nw'] as DragCorner[]).map((c) => (
                <div
                  key={c}
                  onPointerDown={(e) => beginDrag(e, idx, box, layer, 'resize', c)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishDrag(true)}
                  onPointerCancel={finishDrag(false)}
                  onClick={(e) => {
                    // Consume the suppressed compat click of the drag gesture
                    // (and stop it reaching the box backstop below).
                    e.stopPropagation();
                    suppressClickRef.current = false;
                  }}
                  title={
                    box.aspectRatio
                      ? 'Resize (aspect locked — width drives height)'
                      : 'Resize corner'
                  }
                  style={{
                    position: 'absolute',
                    width: 10,
                    height: 10,
                    left: c === 'sw' || c === 'nw' ? -5 : undefined,
                    right: c === 'se' || c === 'ne' ? -5 : undefined,
                    top: c === 'ne' || c === 'nw' ? -5 : undefined,
                    bottom: c === 'se' || c === 'sw' ? -5 : undefined,
                    borderRadius: 2,
                    background: 'rgba(245,158,11,0.95)',
                    border: '1px solid rgba(0,0,0,0.6)',
                    cursor: c === 'se' || c === 'nw' ? 'nwse-resize' : 'nesw-resize',
                    zIndex: 1,
                    touchAction: 'none',
                  }}
                />
              ))}
          </div>
        );
      })}

      {/* Selected Cut Info Chip + P2 prev/next layer controls */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 4px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.75)',
          color: '#fcd34d',
          border: '1px solid rgba(245,158,11,0.35)',
          zIndex: 110,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cycleLayer(-1);
          }}
          disabled={isLocked || children.length === 0}
          title="Previous layer ([)"
          aria-label="Previous layer"
          className="hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors disabled:hover:bg-transparent text-amber-400 disabled:text-amber-400/40 select-none"
          style={{
            padding: '0 6px',
            borderRadius: 6,
            cursor: isLocked || children.length === 0 ? 'not-allowed' : 'pointer',
            opacity: isLocked || children.length === 0 ? 0.4 : 1,
            background: 'transparent',
            border: 'none',
          }}
        >
          {'<'}
        </button>
        <span style={{ padding: '0 4px', whiteSpace: 'nowrap' }}>
          {`Cut ${selectedSubVisualIndex + 1} · ${children.length} layer${children.length === 1 ? '' : 's'}${
            hasValidSelection ? ` · L${selectedLayerIndex + 1} selected` : ''
          }${isLocked ? ' · AI rewriting…' : ''}`}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cycleLayer(1);
          }}
          disabled={isLocked || children.length === 0}
          title="Next layer (])"
          aria-label="Next layer"
          className="hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors disabled:hover:bg-transparent text-amber-400 disabled:text-amber-400/40 select-none"
          style={{
            padding: '0 6px',
            borderRadius: 6,
            cursor: isLocked || children.length === 0 ? 'not-allowed' : 'pointer',
            opacity: isLocked || children.length === 0 ? 0.4 : 1,
            background: 'transparent',
            border: 'none',
          }}
        >
          {'>'}
        </button>
      </div>
    </div>
  );
};
