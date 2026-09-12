import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';
import { shallowEqualStyles } from '../visualSelection';

/**
 * Parse a CSS value (% or px or raw number) to percent space.
 * px/raw-pixel values resolve against composition space (which scales with
 * preview quality and differs per orientation) — never a hardcoded 1920x1080.
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

/** Mirror of ASTRenderer layout resolution in percent space. Order-based stacking: orderIdx=array index (0=bottom). */
function layerToBox(layer: any, baseWidth = 1920, baseHeight = 1080, orderIdx = 0): Box {
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
      zIndex: orderIdx,
      isText,
    };
  }

  const aspect = parseAspect(style);
  const widthPct = parsePct(style.width, 100, false, baseWidth, baseHeight);

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
    heightPct = parsePct(rawHeight, 100, true, baseWidth, baseHeight);
  } else if (isText) {
    // Kinetic text without explicit height: default to a tidy 15% lower-third box
    // so bottom-anchored text doesn't stretch 100% across the whole screen.
    heightPct = 15;
  } else if (!hasTop && hasBottom) {
    heightPct = 25;
  } else {
    heightPct = parsePct(style.height, 100, true, baseWidth, baseHeight);
  }

  return {
    leftPct: hasLeft || !hasRight ? parsePct(rawLeft, 0, false, baseWidth, baseHeight) : null,
    rightPct: !hasLeft && hasRight ? parsePct(rawRight, 0, false, baseWidth, baseHeight) : null,
    topPct: hasTop || !hasBottom ? parsePct(rawTop, 0, true, baseWidth, baseHeight) : null,
    bottomPct: !hasTop && hasBottom ? parsePct(rawBottom, 0, true, baseWidth, baseHeight) : null,
    widthPct,
    heightPct,
    aspectRatio: aspect,
    fullscreen: false,
    transform,
    transformOrigin: layer?.transform_origin,
    rotateDeg,
    borderRadius: style.borderRadius,
    zIndex: orderIdx,
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

export type CanvasSceneTimings = Array<{
  start: number;
  end: number;
  subs: Array<{ start: number; end: number }>;
}>;

/**
 * Cut under the playhead within a scene (frame space, exclusive end — same
 * convention as the timeline and InspectorPanel). Returns -1 when unknown so
 * callers fall back to the selected cut.
 */
function getPlayheadSubIdx(
  sceneTimings: CanvasSceneTimings | undefined,
  sceneIdx: number,
  frame: number
): number {
  const subs = sceneTimings?.[sceneIdx]?.subs;
  if (!subs || subs.length === 0) return -1;
  return subs.findIndex((s) => frame >= s.start && frame < s.end);
}

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
type EdgeDir = 'n' | 's' | 'e' | 'w';
type DragMode = 'move' | 'corner' | 'edge';

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

/**
 * Resolve a box's top-left + rendered height in left/top percent space.
 * Aspect-locked layers derive height from width (never from the style), backed
 * out via the container aspect — exact, rotation-safe, and correct for
 * bottom-anchored layers (whose top is derived from bottom + height).
 */
function boxTopLeft(box: Box, rectW: number, rectH: number): { left: number; top: number; height: number } {
  let height: number;
  if (box.aspectRatio) {
    const ratio = parseAspectRatio(box.aspectRatio);
    height =
      ratio && ratio > 0 && rectW > 0 && rectH > 0
        ? (box.widthPct * (rectW / rectH)) / ratio
        : (box.heightPct ?? 15);
  } else {
    height = box.heightPct ?? 15;
  }
  const left = box.leftPct !== null ? box.leftPct : 100 - (box.rightPct ?? 0) - box.widthPct;
  const top = box.topPct !== null ? box.topPct : 100 - (box.bottomPct ?? 0) - height;
  return { left, top, height };
}

/**
 * P4: map a screen-space pointer delta into a rotated layer's local axes
 * (inverse rotation). Deltas stay in pixels — the caller converts per-axis to
 * percent space afterwards, which keeps landscape/portrait correct.
 */
function toLocalDelta(dx: number, dy: number, deg: number): { x: number; y: number } {
  const rad = (-deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * Re-pin the stationary edge after a rotated/resized gesture. computeDrag pins
 * the opposite edge in *layout* numbers, but CSS transforms (rotate about the
 * layout center, mirror flips) move it in world space — so the layout-center
 * shift is re-expressed through the world transform (px units for %
 * anisotropy). Without this the pinned edge swings and the grabbed handle
 * slips off the cursor. Exact for rotate-only/flip-only; near-exact combined.
 */
function pinOppositeEdge(
  init: DragInit,
  cur: { left: number; top: number; width: number; height: number },
  rotDeg: number,
  flipX: boolean,
  flipY: boolean,
  rectW: number,
  rectH: number
): { left: number; top: number; width: number; height: number } {
  if ((!rotDeg && !flipX && !flipY) || rectW <= 0 || rectH <= 0) return cur;
  const dxPct = cur.left + cur.width / 2 - (init.left + init.width / 2);
  const dyPct = cur.top + cur.height / 2 - (init.top + init.height / 2);
  if (!dxPct && !dyPct) return cur;
  // World transform order mirrors CSS (scale first, then rotate).
  const fx = flipX ? -((dxPct / 100) * rectW) : ((dxPct / 100) * rectW);
  const fy = flipY ? -((dyPct / 100) * rectH) : ((dyPct / 100) * rectH);
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const wxPx = fx * cos - fy * sin;
  const wyPx = fx * sin + fy * cos;
  const dxPx = (dxPct / 100) * rectW;
  const dyPx = (dyPct / 100) * rectH;
  return {
    ...cur,
    left: cur.left + ((wxPx - dxPx) / rectW) * 100,
    top: cur.top + ((wyPx - dyPx) / rectH) * 100,
  };
}

/** P4: normalize degrees to [-180, 180]. */
function norm180(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

/** P4: snap rotation to 45° multiples within 3° (wrap-aware for ±180). */
function snapRotate(deg: number): number {
  const snaps = [0, 45, 90, 135, 180, -135, -90, -45];
  for (const s of snaps) {
    const d = Math.abs(((deg - s + 540) % 360) - 180);
    if (d <= 3) return s;
  }
  return deg;
}

/**
 * P4: counter-scale for overlay handles so they stay grabbable when the layer
 * itself is scaled 10–500% (handles are DOM children of the scaled box).
 * Magnitude-only (never mirrors) and clamped — borders/badges intentionally
 * keep scaling as live feedback.
 */
function handleInverseScale(style: Record<string, any>): string | undefined {
  const numOr = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);
  const legacy = numOr(parseScaleAxis(style.scale), 1);
  const sx = Math.abs(numOr(parseScaleAxis(style.scaleX), legacy));
  const sy = Math.abs(numOr(parseScaleAxis(style.scaleY), legacy));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const ix = sx > 0 ? clampN(1 / sx, 0.5, 2) : 1;
  const iy = sy > 0 ? clampN(1 / sy, 0.5, 2) : 1;
  if (ix === 1 && iy === 1) return undefined;
  return `scale(${r2(ix)}, ${r2(iy)})`;
}

/** P4: edge-resize cursor rotated with the layer (static cursors lie at 90°). */
function edgeCursor(dir: EdgeDir, rotDeg: number): string {
  if (!rotDeg) return dir === 'n' || dir === 's' ? 'ns-resize' : 'ew-resize';
  const base = dir === 'e' ? 0 : dir === 's' ? 90 : dir === 'w' ? 180 : 270;
  const m = (((base + rotDeg) % 180) + 180) % 180;
  return m <= 45 || m >= 135 ? 'ew-resize' : 'ns-resize';
}

/** P4: corner-resize cursor rotated with the layer. */
function cornerCursor(c: DragCorner, rotDeg: number): string {
  if (!rotDeg) return c === 'se' || c === 'nw' ? 'nwse-resize' : 'nesw-resize';
  const base = c === 'se' ? 45 : c === 'sw' ? 135 : c === 'ne' ? -45 : -135;
  const m = (((base + rotDeg) % 180) + 180) % 180;
  return Math.abs(m - 45) <= 45 ? 'nwse-resize' : 'nesw-resize';
}

interface DragInit {
  left: number;
  top: number;
  width: number;
  height: number;
  aspect: string | null;
  /** P4 edge N/S on an aspect-locked layer: height goes freeform, aspect drops on commit. */
  dropAspect: boolean;
  useRight: boolean;
  useBottom: boolean;
  style: Record<string, any>;
}

interface DragSession {
  layerIdx: number;
  /** Cut identity at dragstart — a mid-gesture selection change voids the commit. */
  sceneIdx: number;
  subIdx: number;
  mode: DragMode;
  corner: DragCorner | null;
  edge: EdgeDir | null;
  /** P4 Alt-drag on corners: scale multipliers instead of dimensions. */
  scaleMode: boolean;
  /** P4 layer rotation at dragstart — resizes run in local axes when nonzero. */
  rotDeg: number;
  /** P4 mirror flips at dragstart — handle directions unmirror when set. */
  flipX: boolean;
  flipY: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  rectW: number;
  rectH: number;
  init: DragInit;
  cur: { left: number; top: number; width: number; height: number };
  /** Live non-geometric preview (scale multipliers) applied over the style. */
  preview: Record<string, any> | null;
  moved: boolean;
}

/** P4 rotate gesture session (pointer angle around the box center). */
interface RotateSession {
  layerIdx: number;
  /** Cut identity at dragstart — a mid-gesture selection change voids the commit. */
  sceneIdx: number;
  subIdx: number;
  pointerId: number;
  startX: number;
  startY: number;
  cx: number;
  cy: number;
  /** Grab offset (pointer angle − layer rotation) so the box never jumps. */
  offset: number;
  style: Record<string, any>;
  moved: boolean;
}

/**
 * Drag geometry in left/top percent space. Move snaps edges/center and may
 * leave the canvas on any side (symmetric bounds: fully out in every
 * direction, e.g. slide-in offsets); resize pins the opposite edge (corners)
 * or axis (edges). Aspect-locked layers resize width-only with bottom-edge
 * pinning for north handles — N/S edge handles instead unlock via
 * `dropAspect` (freeform path). Size mirrors the Layout sliders (10–100%).
 */
function computeDrag(
  init: DragInit,
  mode: DragMode,
  corner: DragCorner | null,
  edge: EdgeDir | null,
  dxPct: number,
  dyPct: number
): { left: number; top: number; width: number; height: number } {
  if (mode === 'move') {
    return {
      left: clampN(snapPos(init.left + dxPct, init.width), -init.width, 100),
      top: clampN(snapPos(init.top + dyPct, init.height), -init.height, 100),
      width: init.width,
      height: init.height,
    };
  }
  const east = mode === 'edge' ? edge === 'e' : corner === 'se' || corner === 'ne';
  const west = mode === 'edge' ? edge === 'w' : corner === 'sw' || corner === 'nw';
  const south = mode === 'edge' ? edge === 's' : corner === 'se' || corner === 'sw';
  const north = mode === 'edge' ? edge === 'n' : corner === 'ne' || corner === 'nw';
  if (init.aspect) {
    const width = clampN(init.width + (east ? dxPct : -dxPct), 10, 100);
    // Height scales linearly with width (fixed ratio, fixed container), so
    // north handles pin the bottom edge instead of growing the box downward.
    const height = init.width > 0 ? (init.height * width) / init.width : init.height;
    return {
      left: clampN(east || (!west && !east) ? init.left : init.left + init.width - width, -width, 100),
      top: south || (!north && !south) ? init.top : clampN(init.top + init.height - height, -height, 100),
      width,
      height,
    };
  }
  const width = east || west ? clampN(init.width + (east ? dxPct : -dxPct), 10, 100) : init.width;
  const height = south || north ? clampN(init.height + (south ? dyPct : -dyPct), 10, 100) : init.height;
  return {
    left: clampN(west ? init.left + init.width - width : init.left, -width, 100),
    top: clampN(north ? init.top + init.height - height : init.top, -height, 100),
    width,
    height,
  };
}

/** P4 Alt-drag scale factors from raw (unclamped) corner deltas. */
function scaleFactors(
  init: DragInit,
  corner: DragCorner | null,
  dxPct: number,
  dyPct: number
): { fx: number; fy: number } {
  const east = corner === 'se' || corner === 'ne';
  const south = corner === 'se' || corner === 'sw';
  const rawW = init.width + (east ? dxPct : -dxPct);
  const rawH = init.height + (south ? dyPct : -dyPct);
  const fx = init.width > 0 ? rawW / init.width : 1;
  const fy = init.height > 0 ? rawH / init.height : 1;
  if (init.aspect) {
    // Aspect-locked media scales uniformly — follow the dominant drag
    // direction so a corner pull can never squish the layer.
    const f = Math.abs(dxPct) >= Math.abs(dyPct) ? fx : fy;
    return { fx: f, fy: f };
  }
  return { fx, fy };
}

/** P4: scale multipliers from factors — sign-preserving (flip), 10–500%. */
function scaleValues(style: Record<string, any>, fx: number, fy: number): { scaleX: number; scaleY: number } {
  const numOr = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);
  const legacy = numOr(parseScaleAxis(style.scale), 1);
  const ox = numOr(parseScaleAxis(style.scaleX), legacy);
  const oy = numOr(parseScaleAxis(style.scaleY), legacy);
  const round2 = (v: number) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
  };
  return {
    scaleX: round2((ox < 0 ? -1 : 1) * clampN(Math.abs(ox) * fx, 0.1, 5)),
    scaleY: round2((oy < 0 ? -1 : 1) * clampN(Math.abs(oy) * fy, 0.1, 5)),
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
  mode: DragMode
): Record<string, any> {
  const s: Record<string, any> = { ...init.style };
  if (mode === 'move') {
    // Off-canvas positions pass through unclamped (what you drag is what you
    // get) — the Layout sliders display-clamp to 0–100 but preserve the value.
    if (init.useRight) {
      s.right = pct(100 - cur.left - cur.width);
      delete s.left;
    } else {
      s.left = pct(cur.left);
      delete s.right;
    }
    if (init.useBottom) {
      s.bottom = pct(100 - cur.top - cur.height);
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
  // P4 N/S edge handles go freeform — the aspect lock is released like the
  // Layout tab's Unlock does (explicit height wins from here on).
  if (init.dropAspect) delete s.aspectRatio;
  return s;
}

/**
 * P4: client point → percent-space deltas for a drag session. Resizes run
 * through the layer's local axes when rotated, then unmirror for flip signs
 * (moves stay screen-space — the grab point must track the cursor).
 * Module-scope (no component closure) so gesture callbacks stay referentially
 * stable across renders.
 */
function sessionDeltas(s: DragSession, clientX: number, clientY: number) {
  let dxPx = clientX - s.startX;
  let dyPx = clientY - s.startY;
  if (s.rotDeg !== 0 && s.mode !== 'move') {
    const local = toLocalDelta(dxPx, dyPx, s.rotDeg);
    dxPx = local.x;
    dyPx = local.y;
  }
  if (s.mode !== 'move') {
    if (s.flipX) dxPx = -dxPx;
    if (s.flipY) dyPx = -dyPx;
  }
  return { dxPct: (dxPx / s.rectW) * 100, dyPct: (dyPx / s.rectH) * 100 };
}

/** P4 Alt-corner scale preview/commit values (sign-preserving, 10–500%). */
function sessionScale(s: DragSession, dxPct: number, dyPct: number) {
  const { fx, fy } = scaleFactors(s.init, s.corner, dxPct, dyPct);
  return scaleValues(s.init.style, fx, fy);
}

/** P4: pointer position around the box center → snapped rotation degrees. */
function rotateDegFor(r: RotateSession, clientX: number, clientY: number) {
  const pointer = (Math.atan2(clientY - r.cy, clientX - r.cx) * 180) / Math.PI;
  return Math.round(snapRotate(norm180(pointer - r.offset)));
}

interface LayerBoxProps {
  layer: any;
  idx: number;
  box: Box;
  compW: number;
  compH: number;
  selected: boolean;
  locked: boolean;
  /** Live geometric drag state for THIS layer only (null for all others). */
  liveDrag: { left: number; top: number; width: number; height: number } | null;
  /** Live non-geometric preview (Alt-scale multipliers) for this layer. */
  liveScale: Record<string, any> | null;
  /** Live rotate degrees for this layer. */
  liveRotateDeg: number | null;
  /** Dropped-style override rendered during the commit debounce window. */
  pendingStyle: Record<string, any> | null;
  /** True while this layer is being dragged or rotated. */
  gesturingThis: boolean;
  /** True when the N/S-edge aspect unlock preview applies to this layer. */
  aspectUnlocking: boolean;
  suppressRef: React.MutableRefObject<boolean>;
  onSelect: (layerIdx: number) => void;
  onBeginDrag: (
    e: React.PointerEvent,
    layerIdx: number,
    box: Box,
    layer: any,
    mode: DragMode,
    dir: DragCorner | EdgeDir | null
  ) => void;
  onMove: (e: React.PointerEvent) => void;
  onEndDrag: (e: React.PointerEvent, commit: boolean) => void;
  onBeginRotate: (e: React.PointerEvent, layerIdx: number, box: Box, layer: any) => void;
  onRotateMove: (e: React.PointerEvent) => void;
  onEndRotate: (e: React.PointerEvent, commit: boolean) => void;
}

/**
 * One layer hit-box. Memoized so per-frame parent updates (playhead ticks at
 * ~20 Hz, drag previews at 60 Hz) only re-render the layer whose props
 * actually changed — previously every tick reconciled every box and its
 * handles, which is what made scrubbing/dragging feel laggy.
 */
const LayerBox: React.FC<LayerBoxProps> = React.memo(({
  layer, idx, box, compW, compH, selected, locked,
  liveDrag, liveScale, liveRotateDeg, pendingStyle, gesturingThis,
  aspectUnlocking, suppressRef,
  onSelect, onBeginDrag, onMove, onEndDrag, onBeginRotate, onRotateMove, onEndRotate,
}) => {
  const cType = layer?.content?.type || 'Image';
  const baseStyle: Record<string, any> = layer?.content?.style || {};

  // Live overrides: geometric drag session wins; else non-geometric
  // previews (Alt-scale multipliers, rotate degrees) and the dropped-style
  // override (debounce window) recompute through layerToBox; else the
  // committed box.
  const effBox: Box = useMemo(() => {
    if (liveDrag) {
      // Aspect-locked layers keep deriving height from width — except N/S
      // edge drags, which unlock mid-gesture and render the live freeform
      // height instead of the stale derived one.
      const keepAspect = !!box.aspectRatio && !aspectUnlocking;
      return {
        ...box,
        leftPct: liveDrag.left,
        rightPct: null,
        topPct: liveDrag.top,
        bottomPct: null,
        widthPct: liveDrag.width,
        heightPct: keepAspect ? null : liveDrag.height,
        aspectRatio: keepAspect ? box.aspectRatio : null,
      };
    }
    if (liveScale ?? (liveRotateDeg !== null)) {
      const liveStyle: Record<string, any> =
        liveScale ?? { rotate: `${liveRotateDeg as number}deg` };
      return layerToBox(
        { ...layer, content: { ...(layer?.content || {}), style: { ...baseStyle, ...liveStyle } } },
        compW,
        compH,
        idx
      );
    }
    if (pendingStyle) {
      return layerToBox(
        { ...layer, content: { ...(layer?.content || {}), style: pendingStyle } },
        compW,
        compH,
        idx
      );
    }
    return box;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, liveDrag, liveScale, liveRotateDeg, pendingStyle, aspectUnlocking, compW, compH, layer]);

  const posStyle: React.CSSProperties = useMemo(() => {
    if (effBox.fullscreen) return { left: 0, top: 0, width: '100%', height: '100%' };
    return {
      ...(effBox.leftPct !== null ? { left: `${effBox.leftPct}%` } : {}),
      ...(effBox.leftPct === null && effBox.rightPct !== null ? { right: `${effBox.rightPct}%` } : {}),
      width: `${effBox.widthPct}%`,
      ...(effBox.topPct !== null ? { top: `${effBox.topPct}%` } : {}),
      ...(effBox.topPct === null && effBox.bottomPct !== null ? { bottom: `${effBox.bottomPct}%` } : {}),
      ...(effBox.aspectRatio
        ? { aspectRatio: effBox.aspectRatio }
        : effBox.heightPct !== null
          ? { height: `${effBox.heightPct}%` }
          : {}),
    };
  }, [effBox]);

  // Fullscreen layers stay behind non-fullscreen layers even when selected,
  // so smaller foreground layers are never trapped beneath them.
  const z = box.fullscreen
    ? (selected ? 15 : 10 + box.zIndex)
    : (selected ? 100 : 20 + box.zIndex);

  // Keep label badges visible inside container when box is near the top edge
  const isNearTop = effBox.topPct !== null && effBox.topPct < 4 && !effBox.fullscreen;
  const badgeTop = isNearTop ? 4 : -22;
  const badgeLeft = isNearTop ? 4 : 0;
  // Effective rotation drives the badge counter-rotation (live during spins)
  const effRotateDeg = liveRotateDeg ?? effBox.rotateDeg;
  const counterRotate = effRotateDeg ? `rotate(${-effRotateDeg}deg)` : undefined;
  // Handles counter-scale against the layer's own scale so they stay
  // grabbable at 10–500% (badges/borders keep scaling as feedback).
  const mergedScaleStyle = liveScale ?? pendingStyle ?? baseStyle;
  const invHandles = handleInverseScale(mergedScaleStyle);

  // P3: body drag moves (anchor-preserving commit). Fullscreen layers
  // are select-only — a 100×100 box has no position to drag.
  // P4: corners work rotated too (local axes); edges do single-axis;
  // the lollipop spins.
  const draggable = !box.fullscreen && !locked;
  const showHandles = selected && !box.fullscreen && !locked;

  const handleBoxDown = useCallback((e: React.PointerEvent) => {
    onBeginDrag(e, idx, box, layer, 'move', null);
  }, [onBeginDrag, idx, box, layer]);
  const handleBoxUp = useCallback((e: React.PointerEvent) => {
    onEndDrag(e, true);
  }, [onEndDrag]);
  const handleBoxCancel = useCallback((e: React.PointerEvent) => {
    onEndDrag(e, false);
  }, [onEndDrag]);
  const handleBoxClick = useCallback((e: React.MouseEvent) => {
    // Pointerdown already selected (drag path suppresses this);
    // this is the backstop for select-only boxes (fullscreen).
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    e.stopPropagation();
    onSelect(idx);
  }, [onSelect, idx, suppressRef]);
  const makeHandleDown = useCallback((mode: DragMode, dir: DragCorner | EdgeDir) => (e: React.PointerEvent) => {
    onBeginDrag(e, idx, box, layer, mode, dir);
  }, [onBeginDrag, idx, box, layer]);
  const handleRotateDown = useCallback((e: React.PointerEvent) => {
    onBeginRotate(e, idx, box, layer);
  }, [onBeginRotate, idx, box, layer]);
  const handleRotateUp = useCallback((e: React.PointerEvent) => {
    onEndRotate(e, true);
  }, [onEndRotate]);
  const handleRotateCancel = useCallback((e: React.PointerEvent) => {
    onEndRotate(e, false);
  }, [onEndRotate]);
  const consumeClick = useCallback((e: React.MouseEvent) => {
    // Consume the suppressed compat click of the drag gesture
    // (and stop it reaching the box backstop below).
    e.stopPropagation();
    suppressRef.current = false;
  }, [suppressRef]);

  const cornerDown = useMemo(() => ({
    se: makeHandleDown('corner', 'se'),
    sw: makeHandleDown('corner', 'sw'),
    ne: makeHandleDown('corner', 'ne'),
    nw: makeHandleDown('corner', 'nw'),
  }), [makeHandleDown]);
  const edgeDown = useMemo(() => ({
    n: makeHandleDown('edge', 'n'),
    s: makeHandleDown('edge', 's'),
    e: makeHandleDown('edge', 'e'),
    w: makeHandleDown('edge', 'w'),
  }), [makeHandleDown]);

  return (
    <div
      onPointerDown={handleBoxDown}
      onPointerMove={onMove}
      onPointerUp={handleBoxUp}
      onPointerCancel={handleBoxCancel}
      onClick={handleBoxClick}
      title={`Layer ${idx + 1} · ${cType}${box.fullscreen ? ' (fullscreen)' : ''}${locked ? ' — AI rewriting…' : ''}`}
      style={{
        ...posStyle,
        position: 'absolute',
        pointerEvents: locked ? 'none' : 'auto',
        cursor: locked ? 'default' : gesturingThis ? 'grabbing' : draggable ? 'move' : 'pointer',
        touchAction: draggable ? 'none' : undefined,
        zIndex: z,
        borderRadius: box.borderRadius || 2,
        transform: effBox.transform,
        transformOrigin: effBox.transformOrigin || 'center',
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
      {/* P3/P4 corner resize handles (aspect-aware; rotated layers resize
          in local axes). Hold Alt to scale multipliers instead. */}
      {showHandles &&
        (['se', 'sw', 'ne', 'nw'] as DragCorner[]).map((c) => (
          <div
            key={c}
            onPointerDown={cornerDown[c]}
            onPointerMove={onMove}
            onPointerUp={handleBoxUp}
            onPointerCancel={handleBoxCancel}
            onClick={consumeClick}
            title={
              box.aspectRatio
                ? 'Resize (aspect locked — width drives height; Alt: scale)'
                : 'Resize corner (Alt: scale)'
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
              cursor: cornerCursor(c, effRotateDeg),
              transform: invHandles,
              zIndex: 1,
              touchAction: 'none',
            }}
          />
        ))}
      {/* P4 edge resize handles (N/S unlock aspect; rotated use local axes). */}
      {showHandles &&
        (['n', 's', 'e', 'w'] as EdgeDir[]).map((d) => (
          <div
            key={d}
            onPointerDown={edgeDown[d]}
            onPointerMove={onMove}
            onPointerUp={handleBoxUp}
            onPointerCancel={handleBoxCancel}
            onClick={consumeClick}
            title={
              d === 'n' || d === 's'
                ? box.aspectRatio
                  ? 'Adjust height (unlocks aspect ratio)'
                  : 'Adjust height'
                : box.aspectRatio
                  ? 'Adjust width (aspect locked)'
                  : 'Adjust width'
            }
            style={{
              position: 'absolute',
              width: d === 'n' || d === 's' ? 14 : 10,
              height: d === 'n' || d === 's' ? 10 : 14,
              left: d === 'n' || d === 's' ? '50%' : d === 'w' ? -5 : undefined,
              right: d === 'e' ? -5 : undefined,
              top: d === 'e' || d === 'w' ? '50%' : d === 'n' ? -5 : undefined,
              bottom: d === 's' ? -5 : undefined,
              marginLeft: d === 'n' || d === 's' ? -7 : undefined,
              marginTop: d === 'e' || d === 'w' ? -7 : undefined,
              borderRadius: 2,
              background: 'rgba(245,158,11,0.95)',
              border: '1px solid rgba(0,0,0,0.6)',
              cursor: edgeCursor(d, effRotateDeg),
              transform: invHandles,
              zIndex: 1,
              touchAction: 'none',
            }}
          />
        ))}
      {/* P4 rotate lollipop — orbits with the box (no counter-rotation:
          the knob is symmetric and the stem must stay glued to the top
          edge). Lifted clear of the North handle's hitbox. */}
      {showHandles && (
        <div
          onPointerDown={handleRotateDown}
          onPointerMove={onRotateMove}
          onPointerUp={handleRotateUp}
          onPointerCancel={handleRotateCancel}
          onClick={consumeClick}
          title="Rotate — drag to spin (snaps to 45°)"
          style={{
            position: 'absolute',
            left: '50%',
            top: -38,
            width: 16,
            height: 30,
            marginLeft: -8,
            cursor: 'grab',
            transform: invHandles,
            zIndex: 2,
            touchAction: 'none',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'rgba(245,158,11,0.95)',
                border: '1px solid rgba(0,0,0,0.6)',
              }}
            />
            <div style={{ width: 1, height: 15, background: 'rgba(245,158,11,0.7)' }} />
          </div>
        </div>
      )}
    </div>
  );
});
LayerBox.displayName = 'LayerBox';

/**
 * P1 read-only canvas overlay: renders hit-boxes for composition layers of the
 * selected cut on top of the Remotion player.
 * Supports landscape/portrait, aspect-ratio lock, bottom-anchored text, and rotation.
 * P2: preview → editor routing (ensures Visuals tab), AI-rewrite lockout guard,
 * and prev/next layer chip controls (+ `[` / `]` keyboard cycling).
 * P3: direct manipulation — body-drag move (anchor-preserving + snap) and
 * corner-handle resize (aspect-aware), committed once per drag through the
 * VisualsTab lens debounce.
 * P4: rotate lollipop (snap to 45°), edge handles (N/S unlock aspect),
 * Alt-corner scale mode (sign-preserving 10–500%), rotated-layer local axes.
 */
export const CanvasOverlay: React.FC<{
  scenes: any[];
  /** P2 lockout: true while an AI rewrite touches the selected cut (boxes go inert). */
  locked?: boolean;
  /** P2 routing: layer click lands in the Visuals tab for that cut. Falls back to store-only routing when absent. */
  onSelectLayer?: (sceneIdx: number, subIdx: number, layerIdx: number) => void;
  /** P3 drag commit: exactly one call per drag (pointer-up) with the final `content.style`. */
  onStyleCommit?: (sceneIdx: number, subIdx: number, layerIdx: number, style: Record<string, any>) => void;
  /** Cut timings (frames) so the overlay follows the playhead's cut within a scene. */
  sceneTimings?: CanvasSceneTimings;
  /** Composition pixel size backing px→% resolution (scales with quality/orientation). */
  compositionSize?: { w: number; h: number };
}> = ({ scenes, locked, onSelectLayer, onStyleCommit, sceneTimings, compositionSize }) => {
  const selectedSceneIndex = useEditorStore((s) => s.selectedSceneIndex);
  const selectedSubVisualIndex = useEditorStore((s) => s.selectedSubVisualIndex);
  const selectedLayerIndex = useEditorStore((s) => s.selectedLayerIndex);
  const setSelectedLayerIndex = useEditorStore((s) => s.setSelectedLayerIndex);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const isLocked = locked === true;
  const compW = compositionSize?.w ?? 1920;
  const compH = compositionSize?.h ?? 1080;

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
  const finishDragRef = useRef<(e: React.PointerEvent, commit: boolean) => void>(() => {});
  // P4 rotate gesture: live degree preview + handler-live session.
  const [rotatePreview, setRotatePreview] = useState<{ layerIdx: number; deg: number } | null>(null);
  const rotateRef = useRef<RotateSession | null>(null);
  const rotateMoveRef = useRef<{ x: number; y: number } | null>(null);
  const handleRotateMoveRef = useRef<(e: React.PointerEvent) => void>(() => {});
  const handleRotateEndRef = useRef<(e: React.PointerEvent, commit: boolean) => void>(() => {});

  // Prop mirrors: gesture callbacks and global listeners stay referentially
  // stable while always reading the latest values, so window listeners
  // register once and memoized children never re-render from callback churn.
  const lockedRef = useRef(isLocked);
  const sceneTimingsRef = useRef(sceneTimings);
  const scenesRef = useRef(scenes);
  const onSelectLayerRef = useRef(onSelectLayer);
  const onStyleCommitRef = useRef(onStyleCommit);
  useEffect(() => { lockedRef.current = isLocked; }, [isLocked]);
  useEffect(() => { sceneTimingsRef.current = sceneTimings; }, [sceneTimings]);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { onSelectLayerRef.current = onSelectLayer; }, [onSelectLayer]);
  useEffect(() => { onStyleCommitRef.current = onStyleCommit; }, [onStyleCommit]);

  // Route a layer click into the Visuals tab. Targets the playhead's cut
  // (the boxes on screen), not necessarily the selected cut — scrubbing the
  // playhead never moves the selection, but clicking a box adopts the
  // previewed cut. Prefers the parent callback (select + edit session +
  // conditional seek); falls back to store-only routing when standalone.
  // Stable identity (refs + getState only) so memoized boxes don't re-render
  // when the parent does.
  const routeToLayer = useCallback((layerIdx: number) => {
    if (lockedRef.current) return;
    const st = useEditorStore.getState();
    const selScene = st.selectedSceneIndex;
    const selSub = st.selectedSubVisualIndex;
    if (selScene === null || selScene === undefined) return;
    if (selSub === null || selSub === undefined) return;
    const frame = usePlaybackStore.getState().currentFrame;
    const playheadSub = getPlayheadSubIdx(sceneTimingsRef.current, selScene, frame);
    const targetSub = playheadSub >= 0 ? playheadSub : selSub;
    const cb = onSelectLayerRef.current;
    if (cb) {
      cb(selScene, targetSub, layerIdx);
      return;
    }
    if (st.inspectorTab !== 'visuals') st.setInspectorTab('visuals');
    // Sub-set clears the layer in the store — order matters.
    if (targetSub !== st.selectedSubVisualIndex) st.setSelectedSubVisualIndex(targetSub);
    useEditorStore.getState().setSelectedLayerIndex(layerIdx);
  }, []);

  // Deselect on Escape; cycle layer selection with `[` / `]`.
  // Runs before any early return so hook order stays constant. Reads live
  // selection via getState + refs (never render-scope values) and registers
  // exactly once — re-registering on every scenes change churned
  // add/removeEventListener on each keystroke/slider tick while capturing a
  // stale large scenes array in the closure. Escape matches P1 semantics
  // (works even while playing or in inputs) but is inert while locked so all
  // deselect paths agree; `[`/`]` stay gated on playback and text inputs.
  // Escape mid-drag cancels the drag.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useEditorStore.getState();
      if (e.key === 'Escape') {
        if (dragRef.current || rotateRef.current) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
          dragRef.current = null;
          moveRef.current = null;
          rotateRef.current = null;
          rotateMoveRef.current = null;
          suppressClickRef.current = false;
          setDrag(null);
          setRotatePreview(null);
          return;
        }
        if (lockedRef.current) return;
        if (st.selectedLayerIndex !== null) st.setSelectedLayerIndex(null);
        return;
      }
      if (dragRef.current || rotateRef.current) return; // no layer cycling mid-gesture
      if (st.isPlaying) return;

      // Do not hijack hotkeys while typing in inputs, textareas, selects, or editable areas
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      if (e.key !== '[' && e.key !== ']') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (lockedRef.current) return;
      const sceneIdx = st.selectedSceneIndex;
      const selSubIdx = st.selectedSubVisualIndex;
      if (sceneIdx === null || sceneIdx === undefined) return;
      if (selSubIdx === null || selSubIdx === undefined) return;

      // Only cycle when the playhead is currently displaying this scene's overlay
      const frame = usePlaybackStore.getState().currentFrame;
      const liveScenes = scenesRef.current;
      if (getActiveSceneIdx(liveScenes, frame) !== sceneIdx) return;

      // Cycle the previewed cut's layers (adopts the cut on selection, like clicks)
      const playheadSub = getPlayheadSubIdx(sceneTimingsRef.current, sceneIdx, frame);
      const subIdx = playheadSub >= 0 ? playheadSub : selSubIdx;
      const kids: any[] = liveScenes?.[sceneIdx]?.sub_visuals?.[subIdx]?.composition?.children || [];
      if (kids.length === 0) return;
      const delta = e.key === ']' ? 1 : -1;
      const cur = st.selectedLayerIndex ?? (delta > 0 ? -1 : 0);
      const next = wrapIdx(cur, delta, kids.length);
      e.preventDefault();
      const cb = onSelectLayerRef.current;
      if (cb) {
        cb(sceneIdx, subIdx, next);
      } else {
        if (st.inspectorTab !== 'visuals') st.setInspectorTab('visuals');
        if (subIdx !== st.selectedSubVisualIndex) st.setSelectedSubVisualIndex(subIdx);
        useEditorStore.getState().setSelectedLayerIndex(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // P4: Alt toggles scale mode mid-corner-drag (Figma-style). The geometric
  // preview resets on switch so dimensions and multipliers never mix; the
  // drop commits in whichever mode is active. preventDefault only fires while
  // a corner session is live (blocks browser menu focus on Alt).
  useEffect(() => {
    const flip = (e: KeyboardEvent, want: boolean) => {
      if (e.key !== 'Alt') return;
      const s = dragRef.current;
      if (!s || s.mode !== 'corner') return;
      if (s.scaleMode === want) return;
      if (want) e.preventDefault();
      const updated: DragSession = {
        ...s,
        scaleMode: want,
        cur: { left: s.init.left, top: s.init.top, width: s.init.width, height: s.init.height },
        preview: null,
        moved: true,
      };
      dragRef.current = updated;
      setDrag({ ...updated });
    };
    const onDown = (e: KeyboardEvent) => flip(e, true);
    const onUp = (e: KeyboardEvent) => flip(e, false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

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
      rotateRef.current = null;
      rotateMoveRef.current = null;
      suppressClickRef.current = false;
      setDrag(null);
      setRotatePreview(null);
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, []);

  // Capture-loss fallback: if setPointerCapture throws, the element-level
  // handlers go deaf outside the 10 px handles and mouse-up is lost. Window
  // listeners cover any live gesture (drag or rotate); every path funnels
  // through the session refs, so double-fire with the element handlers no-ops.
  const gestureActive = drag !== null || rotatePreview !== null;
  useEffect(() => {
    if (!gestureActive) return;
    const compat = (e: PointerEvent) => e as unknown as React.PointerEvent;
    const onMove = (e: PointerEvent) => {
      handlePointerMoveRef.current(compat(e));
      handleRotateMoveRef.current(compat(e));
    };
    const onUp = (e: PointerEvent) => {
      finishDragRef.current(compat(e), true);
      handleRotateEndRef.current(compat(e), true);
    };
    const onCancel = (e: PointerEvent) => {
      finishDragRef.current(compat(e), false);
      handleRotateEndRef.current(compat(e), false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [gestureActive]);

  // Narrow re-trigger for the commit bridge below: only the committed
  // layer's style matters, not the whole scenes tree. Serializing one flat
  // style record per render is trivial; depending on `scenes` re-armed the
  // backstop timer and re-ran the comparison on every unrelated keystroke.
  const pendingCatchupKey = pendingCommit
    ? JSON.stringify(
        scenes?.[pendingCommit.sceneIdx]?.sub_visuals?.[pendingCommit.subIdx]
          ?.composition?.children?.[pendingCommit.layerIdx]?.content?.style ?? null
      )
    : null;

  // P3 commit bridge: clear the dropped-style override once scriptData catches
  // up (order-independent shallow compare — key order can shift across
  // save/load round-trips) or the preview/selection moves off its cut.
  // A timeout backstop guarantees the override can never strand a layer's
  // rendered geometry.
  useEffect(() => {
    if (!pendingCommit) return;
    const st = useEditorStore.getState();
    if (st.selectedSceneIndex !== pendingCommit.sceneIdx) {
      setPendingCommit(null);
      return;
    }
    const frame = usePlaybackStore.getState().currentFrame;
    const playheadSub = st.selectedSceneIndex !== null && st.selectedSceneIndex !== undefined
      ? getPlayheadSubIdx(sceneTimingsRef.current, st.selectedSceneIndex, frame)
      : -1;
    const viewingSub = playheadSub >= 0 ? playheadSub : st.selectedSubVisualIndex;
    if (viewingSub !== pendingCommit.subIdx) {
      setPendingCommit(null);
      return;
    }
    const curStyle = scenesRef.current?.[pendingCommit.sceneIdx]?.sub_visuals?.[pendingCommit.subIdx]
      ?.composition?.children?.[pendingCommit.layerIdx]?.content?.style;
    if (shallowEqualStyles(curStyle ?? {}, pendingCommit.style)) {
      setPendingCommit(null);
      return;
    }
    const t = window.setTimeout(() => setPendingCommit(null), 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommit, pendingCatchupKey]);

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
    // Tolerate sel === kids.length as a pending add: AstGraphicalEditor sets
    // selection to the new index immediately, while scenes (liveScenes) arrive
    // via the trailing write-back debounce. Clearing on >= would wipe the
    // highlight before the new box exists. Delete/AI-shrink paths shift/null
    // explicitly, and UI masks out-of-range via hasValidSelection anyway.
    if (sel > kids.length) st.setSelectedLayerIndex(null);
  }, [scenes, selectedSceneIndex, selectedSubVisualIndex, selectedLayerIndex]);

  // NOTE: All hooks must run unconditionally before any early return.
  // Previously useMemo(activeSceneIdx) sat after `if (isPlaying) return null`,
  // so toggling play / clicking preview changed the hook count and React threw
  // "Rendered fewer hooks than expected" inside <CanvasOverlay>.
  // Active scene resolution
  const activeSceneIdx = useMemo(() => {
    return getActiveSceneIdx(scenes, currentFrame);
  }, [scenes, currentFrame]);

  // Boxes describe the cut under the playhead — scrubbing the timeline or
  // preview bar swaps the overlay without moving the editor selection (the
  // selection only adopts the previewed cut on click/cycle/drag). Falls back
  // to the selected cut when timings are unavailable.
  const playheadSubIdx =
    selectedSceneIndex !== null &&
    selectedSceneIndex !== undefined &&
    selectedSceneIndex === activeSceneIdx
      ? getPlayheadSubIdx(sceneTimings, selectedSceneIndex, currentFrame)
      : -1;

  // Committed box geometry for the displayed cut, memoized so playhead ticks
  // and drag previews (which don't touch committed data) reuse the previous
  // array — per-layer memoization in <LayerBox> then skips every untouched
  // box instead of reconciling the whole overlay each frame.
  const view = useMemo(() => {
    if (selectedSceneIndex === null || selectedSceneIndex === undefined) return null;
    if (selectedSubVisualIndex === null || selectedSubVisualIndex === undefined) return null;
    if (selectedSceneIndex !== activeSceneIdx) return null;
    const scene = scenes[selectedSceneIndex];
    const subVisuals: any[] = scene?.sub_visuals || [];
    if (selectedSubVisualIndex < 0 || selectedSubVisualIndex >= subVisuals.length) return null;
    const displaySubIdx =
      playheadSubIdx >= 0 && playheadSubIdx < subVisuals.length
        ? playheadSubIdx
        : selectedSubVisualIndex;
    const children: any[] = subVisuals[displaySubIdx]?.composition?.children || [];
    if (children.length === 0) return null;
    // Paint order = children array order (children[0]=bottom).
    const source = children.map((layer, idx) => ({ layer, idx }));
    const ordered = source.map(({ layer, idx }, orderIdx) => ({ layer, idx, box: layerToBox(layer, compW, compH, orderIdx) }));
    return {
      displaySubIdx,
      isViewingSelectedCut: displaySubIdx === selectedSubVisualIndex,
      children,
      ordered,
    };
  }, [scenes, selectedSceneIndex, selectedSubVisualIndex, activeSceneIdx, playheadSubIdx, compW, compH]);

  // ── P3/P4 direct manipulation ─────────────────────────────────────
  // Pointerdown selects immediately (click and drag share one path; the
  // follow-up click is suppressed) and opens a drag session. A <4 px nudge
  // stays a click; beyond that the box follows the pointer with rAF
  // coalescing. Pointer-up commits exactly once via onStyleCommit, which
  // rides the VisualsTab 150 ms debounce — never a per-move store write.
  // P4: `edge` handles do single-axis resizes (N/S unlock aspect),
  // Alt+corner scales multipliers instead of dimensions, and rotated layers
  // resize in local axes via the inverse rotation.
  // Stable identity (refs + getState only) so memoized boxes keep their
  // handlers across parent renders — recreating them per render would
  // defeat <LayerBox>'s memo on every playhead tick.
  const beginDrag = useCallback((
    e: React.PointerEvent,
    layerIdx: number,
    box: Box,
    layer: any,
    mode: DragMode,
    dir: DragCorner | EdgeDir | null
  ) => {
    if (lockedRef.current || useEditorStore.getState().isPlaying) return;
    if (box.fullscreen) return;
    e.stopPropagation();
    // NOTE: no preventDefault here — suppressing the compat click would strand
    // suppressClickRef when the gesture ends without one (pointercancel/blur).
    // Text selection is already off via `select-none` on the preview root.
    suppressClickRef.current = true;
    routeToLayer(layerIdx);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const style: Record<string, any> = { ...(layer?.content?.style || {}) };
    const { left, top, height } = boxTopLeft(box, rect.width, rect.height);
    const scaleMode = mode === 'corner' && e.altKey;
    const edge = mode === 'edge' ? (dir as EdgeDir) : null;
    const corner = mode === 'corner' ? (dir as DragCorner) : null;
    const dropAspect = mode === 'edge' && (edge === 'n' || edge === 's') && !!box.aspectRatio;
    const numOr = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);
    const legacyScale = numOr(parseScaleAxis(style.scale), 1);
    // Cut identity AFTER routing (pointerdown adopts the previewed cut) —
    // a mid-gesture selection change voids the commit at pointer-up.
    const st0 = useEditorStore.getState();
    const session: DragSession = {
      layerIdx,
      sceneIdx: st0.selectedSceneIndex ?? -1,
      subIdx: st0.selectedSubVisualIndex ?? -1,
      mode, corner, edge, scaleMode, rotDeg: box.rotateDeg,
      flipX: numOr(parseScaleAxis(style.scaleX), legacyScale) < 0,
      flipY: numOr(parseScaleAxis(style.scaleY), legacyScale) < 0,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      rectW: rect.width, rectH: rect.height,
      init: {
        left, top, width: box.widthPct, height,
        aspect: dropAspect ? null : box.aspectRatio,
        dropAspect,
        useRight: box.leftPct === null && box.rightPct !== null,
        useBottom: box.topPct === null && box.bottomPct !== null,
        style,
      },
      cur: { left, top, width: box.widthPct, height },
      preview: null,
      moved: false,
    };
    dragRef.current = session;
    setDrag(session);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* capture unavailable — window fallback covers the gesture */ }
  }, [routeToLayer]);

  // Shared rAF tick: coalesces high-frequency pointermove streams (gaming
  // mice run 500–1000 Hz; the window fallback can double-deliver) into one
  // state update per frame for both drag and rotate gestures.
  const scheduleTick = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const cur = dragRef.current;
      const m = moveRef.current;
      if (cur && m) {
        const { dxPct, dyPct } = sessionDeltas(cur, m.x, m.y);
        let next = cur.cur;
        let preview: Record<string, any> | null = null;
        if (cur.scaleMode && cur.mode === 'corner') {
          const { scaleX, scaleY } = sessionScale(cur, dxPct, dyPct);
          preview = { scaleX, scaleY };
        } else {
          const raw = computeDrag(cur.init, cur.mode, cur.corner, cur.edge, dxPct, dyPct);
          // Moves track the cursor raw; resizes re-pin the stationary edge
          // through the world transform when rotated/mirrored.
          next =
            cur.mode !== 'move' && (cur.rotDeg !== 0 || cur.flipX || cur.flipY)
              ? pinOppositeEdge(cur.init, raw, cur.rotDeg, cur.flipX, cur.flipY, cur.rectW, cur.rectH)
              : raw;
        }
        const updated: DragSession = { ...cur, cur: next, preview, moved: true };
        dragRef.current = updated;
        setDrag(updated);
      }
      const r = rotateRef.current;
      const rm = rotateMoveRef.current;
      if (r && rm) {
        setRotatePreview({ layerIdx: r.layerIdx, deg: rotateDegFor(r, rm.x, rm.y) });
      }
    });
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < 4 && !s.moved) return;
    moveRef.current = { x: e.clientX, y: e.clientY };
    scheduleTick();
  }, [scheduleTick]);

  const handleDragEnd = useCallback((e: React.PointerEvent, commit: boolean) => {
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
    const { dxPct, dyPct } = sessionDeltas(s, e.clientX, e.clientY);
    let style: Record<string, any>;
    if (s.scaleMode && s.mode === 'corner') {
      // P4 Alt-drag: multipliers replace dimensions. Legacy `scale` is split
      // exactly like the Layout sliders (deleted, not undefined — undefined
      // would linger in key order and strand the commit bridge).
      const { scaleX, scaleY } = sessionScale(s, dxPct, dyPct);
      style = { ...s.init.style, scaleX, scaleY };
      delete style.scale;
    } else {
      const raw = computeDrag(s.init, s.mode, s.corner, s.edge, dxPct, dyPct);
      const final =
        s.mode !== 'move' && (s.rotDeg !== 0 || s.flipX || s.flipY)
          ? pinOppositeEdge(s.init, raw, s.rotDeg, s.flipX, s.flipY, s.rectW, s.rectH)
          : raw;
      style = commitStyleFromDrag(s.init, final, s.mode);
    }
    const st = useEditorStore.getState();
    const sceneIdx = st.selectedSceneIndex;
    const subIdx = st.selectedSubVisualIndex;
    if (sceneIdx === null || sceneIdx === undefined || subIdx === null || subIdx === undefined) return;
    // The selection moved mid-gesture (multi-input contortion): the stored
    // layer index may address another cut — void the commit, never miswrite.
    if (sceneIdx !== s.sceneIdx || subIdx !== s.subIdx) {
      suppressClickRef.current = false;
      return;
    }
    setPendingCommit({ sceneIdx, subIdx, layerIdx: s.layerIdx, style });
    onStyleCommitRef.current?.(sceneIdx, subIdx, s.layerIdx, style);
  }, []);

  // ── P4 rotate ─────────────────────────────────────────────────────
  // Lollipop drag: rotation follows the pointer around the box's layout
  // center (the default transform pivot; custom transform_origin pivots will
  // be approximately right). Snaps to 45° multiples within 3°.
  const beginRotate = useCallback((e: React.PointerEvent, layerIdx: number, box: Box, layer: any) => {
    if (lockedRef.current || useEditorStore.getState().isPlaying) return;
    if (box.fullscreen) return;
    e.stopPropagation();
    suppressClickRef.current = true;
    routeToLayer(layerIdx);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const { left, top, height } = boxTopLeft(box, rect.width, rect.height);
    const cx = rect.left + ((left + box.widthPct / 2) / 100) * rect.width;
    const cy = rect.top + ((top + height / 2) / 100) * rect.height;
    const grab = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    rotateRef.current = {
      layerIdx,
      sceneIdx: useEditorStore.getState().selectedSceneIndex ?? -1,
      subIdx: useEditorStore.getState().selectedSubVisualIndex ?? -1,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      cx, cy,
      offset: grab - box.rotateDeg,
      style: { ...(layer?.content?.style || {}) },
      moved: false,
    };
    setRotatePreview({ layerIdx, deg: Math.round(box.rotateDeg) });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* window fallback covers the gesture */ }
  }, [routeToLayer]);

  const handleRotateMove = useCallback((e: React.PointerEvent) => {
    const r = rotateRef.current;
    if (!r || e.pointerId !== r.pointerId) return;
    // Deadband mirrors the drag path — a plain lollipop click must not dirty
    // the document (the no-op guard below would also catch it, belt first).
    if (Math.hypot(e.clientX - r.startX, e.clientY - r.startY) < 4 && !r.moved) return;
    r.moved = true;
    rotateMoveRef.current = { x: e.clientX, y: e.clientY };
    scheduleTick();
  }, [scheduleTick]);

  const handleRotateEnd = useCallback((e: React.PointerEvent, commit: boolean) => {
    const r = rotateRef.current;
    if (!r || e.pointerId !== r.pointerId) return;
    rotateRef.current = null;
    rotateMoveRef.current = null;
    setRotatePreview(null);
    if (!commit) {
      suppressClickRef.current = false;
      return;
    }
    if (!r.moved) return; // plain click — selection already applied on pointerdown
    const deg = rotateDegFor(r, e.clientX, e.clientY);
    const style = { ...r.style, rotate: `${deg}deg` };
    const st = useEditorStore.getState();
    const sceneIdx = st.selectedSceneIndex;
    const subIdx = st.selectedSubVisualIndex;
    if (sceneIdx === null || sceneIdx === undefined || subIdx === null || subIdx === undefined) return;
    if (sceneIdx !== r.sceneIdx || subIdx !== r.subIdx) {
      suppressClickRef.current = false;
      return;
    }
    setPendingCommit({ sceneIdx, subIdx, layerIdx: r.layerIdx, style });
    onStyleCommitRef.current?.(sceneIdx, subIdx, r.layerIdx, style);
  }, []);

  // Mirror stable handlers for the window fallback above (same discipline as
  // EditorWorkspace's latest-state refs: the callbacks themselves never go
  // stale because they read refs/getState, so the assignment is idempotent).
  handlePointerMoveRef.current = handlePointerMove;
  finishDragRef.current = handleDragEnd;
  handleRotateMoveRef.current = handleRotateMove;
  handleRotateEndRef.current = handleRotateEnd;

  // ── Early returns AFTER all hooks (hook order must stay constant) ──
  // Performance: hide overlay entirely while video is playing.
  // Eliminates 30–60 FPS style churn and allows full GPU bandwidth for playback.
  if (isPlaying) return null;

  // A cut must be open in the Visuals tab, and the playhead must be inside
  // that scene — otherwise the boxes would describe a cut the player isn't showing.
  if (!view) return null;

  // The stored layer index belongs to the selected cut — only meaningful
  // while viewing that cut. On a scrubbed cut the overlay shows boxes without
  // highlight until a click/cycle adopts it.
  const hasValidSelection =
    view.isViewingSelectedCut &&
    selectedLayerIndex !== null &&
    selectedLayerIndex !== undefined &&
    selectedLayerIndex >= 0 &&
    selectedLayerIndex < view.children.length;

  // P2 chip cycling: wraps around the previewed cut's layers, routes through
  // the same Visuals-tab path as a box click so the editor card follows the canvas.
  const cycleLayer = (delta: number) => {
    if (isLocked || view.children.length === 0) return;
    const cur = view.isViewingSelectedCut
      ? (selectedLayerIndex ?? (delta > 0 ? -1 : 0))
      : (delta > 0 ? -1 : 0);
    routeToLayer(wrapIdx(cur, delta, view.children.length));
  };

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

      {view.ordered.map(({ layer, idx, box }) => {
        // Live overrides are per-layer: only the gesturing/dropped layer gets
        // non-null props, so memoized siblings skip the re-render entirely.
        const liveSession = drag && drag.layerIdx === idx ? drag : null;
        return (
          <LayerBox
            key={idx}
            layer={layer}
            idx={idx}
            box={box}
            compW={compW}
            compH={compH}
            selected={view.isViewingSelectedCut && selectedLayerIndex === idx}
            locked={isLocked}
            liveDrag={liveSession && !liveSession.scaleMode ? liveSession.cur : null}
            liveScale={liveSession?.preview ?? null}
            liveRotateDeg={
              rotatePreview && rotatePreview.layerIdx === idx ? rotatePreview.deg : null
            }
            pendingStyle={
              !liveSession &&
              !(rotatePreview && rotatePreview.layerIdx === idx) &&
              pendingCommit !== null &&
              pendingCommit.sceneIdx === selectedSceneIndex &&
              pendingCommit.subIdx === view.displaySubIdx &&
              pendingCommit.layerIdx === idx
                ? pendingCommit.style
                : null
            }
            gesturingThis={
              (drag !== null && drag.layerIdx === idx) ||
              (rotatePreview !== null && rotatePreview.layerIdx === idx)
            }
            aspectUnlocking={!!liveSession?.init.dropAspect}
            suppressRef={suppressClickRef}
            onSelect={routeToLayer}
            onBeginDrag={beginDrag}
            onMove={handlePointerMove}
            onEndDrag={handleDragEnd}
            onBeginRotate={beginRotate}
            onRotateMove={handleRotateMove}
            onEndRotate={handleRotateEnd}
          />
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
          disabled={isLocked || view.children.length === 0}
          title="Previous layer ([)"
          aria-label="Previous layer"
          className="hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors disabled:hover:bg-transparent text-amber-400 disabled:text-amber-400/40 select-none"
          style={{
            padding: '0 6px',
            borderRadius: 6,
            cursor: isLocked || view.children.length === 0 ? 'not-allowed' : 'pointer',
            opacity: isLocked || view.children.length === 0 ? 0.4 : 1,
            background: 'transparent',
            border: 'none',
          }}
        >
          {'<'}
        </button>
        <span style={{ padding: '0 4px', whiteSpace: 'nowrap' }}>
          {`Cut ${view.displaySubIdx + 1} · ${view.children.length} layer${view.children.length === 1 ? '' : 's'}${
            hasValidSelection ? ` · L${selectedLayerIndex + 1} selected` : ''
          }${isLocked ? ' · AI rewriting…' : ''}`}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cycleLayer(1);
          }}
          disabled={isLocked || view.children.length === 0}
          title="Next layer (])"
          aria-label="Next layer"
          className="hover:bg-amber-500/20 active:bg-amber-500/30 transition-colors disabled:hover:bg-transparent text-amber-400 disabled:text-amber-400/40 select-none"
          style={{
            padding: '0 6px',
            borderRadius: 6,
            cursor: isLocked || view.children.length === 0 ? 'not-allowed' : 'pointer',
            opacity: isLocked || view.children.length === 0 ? 0.4 : 1,
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
