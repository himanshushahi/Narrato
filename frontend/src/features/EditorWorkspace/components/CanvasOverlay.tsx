import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { shallowEqualStyles } from '../visualSelection';
import { isComplexScript } from '../../../components/video/complexScriptFonts';
import { computeClipPath, computeStaticShapeClip, hasMask } from '../../../components/video/ASTAnimator';
import { FPS } from '../timelineConstants';

/**
 * Overlay mask echo: the interactive hit-box stays the full unmasked rect
 * (clipping it would make handles outside the visible region unclickable),
 * but an inner pointer-transparent echo div carries the same clip-path the
 * renderer applies, so masked layers read as masked on the canvas.
 * Static shapes are exact; animated reveals evaluate at the playhead's
 * cut-relative frame (same math as the renderer).
 */
function getOverlayMaskClip(
  mask: any,
  currentFrame: number,
  subStartFrame: number,
): string | undefined {
  if (!hasMask(mask)) return undefined;
  const staticClip = computeStaticShapeClip(mask);
  if (staticClip) return staticClip;
  return computeClipPath(mask, Math.max(0, currentFrame - subStartFrame), FPS);
}

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

/**
 * Fast synchronous canvas text measurement.
 * Measures the exact bounding box in percent space based on text content, font size,
 * weight, and family, preventing hardcoded 100% width or 15% height boxes.
 */
let _measureCanvas: HTMLCanvasElement | null = null;

function estimateTextDims(
  text: string,
  fontSizeVal: any,
  fontFamily: string,
  fontWeight: string | number,
  baseWidth = 1920,
  baseHeight = 1080,
  opts?: { lineHeight?: unknown; letterSpacing?: unknown }
): { widthPct: number; heightPct: number } {
  if (!text || !text.trim()) {
    return { widthPct: 30, heightPct: 10 };
  }
  const cleanText = text.trim();
  const fs = typeof fontSizeVal === 'number' && Number.isFinite(fontSizeVal)
    ? fontSizeVal
    : parseFloat(String(fontSizeVal)) || 64;
  // Mirror the renderer's KineticText defaults so the estimated box matches
  // the glyphs (lineHeight 1.25 Latin, 1.6 complex-script + 0.08em vertical
  // padding; letterSpacing normal = 0).
  const lhRaw = typeof opts?.lineHeight === 'number' ? opts.lineHeight : parseFloat(String(opts?.lineHeight ?? ''));
  const lhDefault = isComplexScript(cleanText) ? 1.6 : 1.25;
  const lh = Number.isFinite(lhRaw) && (lhRaw as number) > 0
    ? Math.min(3, Math.max(0.5, lhRaw as number))
    : lhDefault;
  const lsRaw = typeof opts?.letterSpacing === 'number' ? opts.letterSpacing : parseFloat(String(opts?.letterSpacing ?? ''));
  const ls = Number.isFinite(lsRaw) ? Math.min(60, Math.max(-10, lsRaw as number)) : 0;

  if (typeof document !== 'undefined') {
    if (!_measureCanvas) {
      _measureCanvas = document.createElement('canvas');
    }
    const ctx = _measureCanvas.getContext('2d');
    if (ctx) {
      ctx.font = `${fontWeight || 'bold'} ${fs}px ${fontFamily || 'Inter, sans-serif'}`;
      // Letter-spacing widens every advance the same way CSS does.
      try {
        (ctx as any).letterSpacing = `${ls}px`;
      } catch { /* older canvas implementations ignore it */ }
      const lines = cleanText.split('\n');
      let maxLineWidth = 0;
      for (const line of lines) {
        const metrics = ctx.measureText(line);
        if (metrics.width > maxLineWidth) {
          maxLineWidth = metrics.width;
        }
      }
      try {
        (ctx as any).letterSpacing = '0px';
      } catch { /* no-op */ }
      // Add comfortable padding (24px horizontal, 16px vertical) plus the
      // renderer's 0.08em breathing room for complex scripts (matras).
      const scriptPad = isComplexScript(cleanText) ? fs * 0.16 : 0;
      const totalWidthPx = maxLineWidth + 24;
      const lineHeightPx = fs * lh;
      const totalHeightPx = lines.length * lineHeightPx + 16 + scriptPad;

      const widthPct = clampN((totalWidthPx / baseWidth) * 100, 8, 98);
      const heightPct = clampN((totalHeightPx / baseHeight) * 100, 5, 90);
      return {
        widthPct: Math.round(widthPct * 100) / 100,
        heightPct: Math.round(heightPct * 100) / 100,
      };
    }
  }

  // Fallback if canvas is unavailable
  const approxWidth = cleanText.length * (fs * 0.55) + 24;
  const widthPct = clampN((approxWidth / baseWidth) * 100, 10, 95);
  const heightPct = clampN(((fs * 1.4) / baseHeight) * 100, 6, 80);
  return {
    widthPct: Math.round(widthPct * 100) / 100,
    heightPct: Math.round(heightPct * 100) / 100,
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
function layerToBox(
  layer: any,
  baseWidth = 1920,
  baseHeight = 1080,
  orderIdx = 0,
  measuredDomRect?: { left: number; top: number; width: number; height: number } | null
): Box {
  const style: Record<string, any> = layer?.content?.style || {};
  const cType = layer?.content?.type || 'Image';
  const isText = cType === 'Text';

  const hasCustomLayout = !!(
    style.width || style.height || style.top || style.left || style.right || style.bottom || style.aspectRatio
  );

  const { transform, rotateDeg } = staticTransform(style);

  // LayerBox SOT v1 mirror of ASTRenderer: Map/Particles are full-frame
  // canvases — a stray positioned box would only crop at render time, so the
  // overlay treats them as fullscreen (select-only) until Reset to Fullscreen
  // clears the stray keys via the Layout tab.
  const isFullFrameCanvas = cType === 'Map' || cType === 'Particles' || cType === 'Background';

  // TEXT LAYERS MUST NEVER BE FULLSCREEN!
  // Text layers are content-driven typography and must always display interactive handles.
  if ((!hasCustomLayout && !isText) || isFullFrameCanvas) {
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

  const rawLeft = style.left;
  const rawRight = style.right;
  const hasLeft = rawLeft !== undefined && rawLeft !== null && String(rawLeft).trim() !== '';
  const hasRight = rawRight !== undefined && rawRight !== null && String(rawRight).trim() !== '';

  const rawTop = style.top;
  const rawBottom = (style as any).bottom;
  const hasTop = rawTop !== undefined && rawTop !== null && String(rawTop).trim() !== '';
  const hasBottom = rawBottom !== undefined && rawBottom !== null && String(rawBottom).trim() !== '';

  const rawWidth = style.width;
  const hasWidth = rawWidth !== undefined && rawWidth !== null && String(rawWidth).trim() !== '';
  const rawHeight = style.height;
  const hasHeight = rawHeight !== undefined && rawHeight !== null && String(rawHeight).trim() !== '';

  // Smart text metrics calculation
  let textDims: { widthPct: number; heightPct: number } | null = null;
  if (isText) {
    textDims = estimateTextDims(
      layer?.content?.text || '',
      style.fontSize || '64px',
      layer?.content?.font || style.fontFamily || 'Inter, sans-serif',
      layer?.content?.weight || style.fontWeight || 'bold',
      baseWidth,
      baseHeight,
      { lineHeight: style.lineHeight, letterSpacing: style.letterSpacing }
    );
  }

  let widthPct: number;
  if (hasWidth) {
    widthPct = parsePct(rawWidth, 100, false, baseWidth, baseHeight);
  } else if (isText) {
    // If live DOM measurement from player is available, use it; otherwise canvas estimation
    widthPct = measuredDomRect && measuredDomRect.width > 0
      ? measuredDomRect.width
      : textDims!.widthPct;
  } else {
    widthPct = parsePct(style.width, 100, false, baseWidth, baseHeight);
  }

  let heightPct: number | null = null;
  if (aspect) {
    // When aspectRatio is locked, height must NOT be forced as a percentage —
    // the browser derives it natively via CSS aspectRatio to avoid non-square distortion.
    heightPct = null;
  } else if (hasHeight) {
    heightPct = parsePct(rawHeight, 100, true, baseWidth, baseHeight);
  } else if (isText) {
    // Text layers auto-size — use DOM measurement or content estimation.
    // This covers the LOWER_THIRD_FILL pattern (bottom-anchored, no height).
    heightPct = measuredDomRect && measuredDomRect.height > 0
      ? measuredDomRect.height
      : textDims!.heightPct;
  } else if (!hasTop && hasBottom) {
    // Non-text bottom-anchored layer without explicit height — reasonable default.
    heightPct = 25;
  } else {
    heightPct = parsePct(style.height, 100, true, baseWidth, baseHeight);
  }

  // Left position: if not set and is text, center or align according to textAlign
  let leftPct: number | null = null;
  let rightPct: number | null = null;
  if (hasLeft || (!isText && !hasRight)) {
    leftPct = parsePct(rawLeft, 0, false, baseWidth, baseHeight);
  } else if (hasRight) {
    rightPct = parsePct(rawRight, 0, false, baseWidth, baseHeight);
  } else if (isText) {
    if (measuredDomRect && Number.isFinite(measuredDomRect.left) && measuredDomRect.left >= 0) {
      leftPct = measuredDomRect.left;
    } else {
      const align = style.textAlign || 'center';
      if (align === 'left') {
        leftPct = 10;
      } else if (align === 'right') {
        rightPct = 10;
      } else {
        leftPct = Math.max(0, Math.round(((100 - widthPct) / 2) * 100) / 100);
      }
    }
  }

  // Top position: if not set and is text, center or place sensibly
  let topPct: number | null = null;
  let bottomPct: number | null = null;
  if (hasTop || (!isText && !hasBottom)) {
    topPct = parsePct(rawTop, 0, true, baseWidth, baseHeight);
  } else if (hasBottom) {
    bottomPct = parsePct(rawBottom, 0, true, baseWidth, baseHeight);
  } else if (isText) {
    if (measuredDomRect && Number.isFinite(measuredDomRect.top) && measuredDomRect.top >= 0) {
      topPct = measuredDomRect.top;
    } else {
      const h = heightPct ?? 15;
      topPct = Math.max(0, Math.round(((100 - h) / 2) * 100) / 100);
    }
  }

  return {
    leftPct,
    rightPct,
    topPct,
    bottomPct,
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

function getActiveSceneIdx(scenes: any[], frame: number, fps: number = 30): number {
  let offset = 0;
  for (let i = 0; i < (scenes || []).length; i++) {
    const dur = Math.max(30, Math.ceil(((scenes[i] as any)?.duration || 0) * fps));
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

/**
 * Layer-to-layer snap: align the moving box's left/center/right to any
 * reference line (canvas edges/center + sibling edges/centers).
 * Each ref implies three candidate positions (ref, ref-size/2, ref-size);
 * the closest candidate within `threshold` wins. Matched refs are returned
 * so the overlay can draw guide lines exactly where alignment happened.
 */
const SNAP_THRESHOLD_PCT = 1; // legacy snapPos used 1%; keep single constant
const EMPTY_GUIDES: { v: number[]; h: number[] } = { v: [], h: [] };

/** px-consistent snap threshold: 8px at any preview size, clamped to [0.5, 1]%. */
function pxSnapThreshold(rectLen: number, px = 8): number {
  if (!Number.isFinite(rectLen) || rectLen <= 0) return SNAP_THRESHOLD_PCT;
  return clampN((px / rectLen) * 100, 0.5, SNAP_THRESHOLD_PCT);
}

function guidesEqual(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}

/** Canvas refs (0/50/100) vs sibling refs — solid amber vs dashed sky. */
function isCanvasRef(v: number): boolean {
  return v === 0 || v === 50 || v === 100 || Math.abs(v) < 0.02 || Math.abs(v - 50) < 0.02 || Math.abs(v - 100) < 0.02;
}

function snapAxis(
  pos: number,
  size: number,
  refs: number[],
  threshold = SNAP_THRESHOLD_PCT
): { pos: number; guides: number[] } {
  let best = pos;
  let bestDist = threshold + 1e-9;
  let guides: number[] = [];
  for (const r of refs) {
    const cands = [r, r - size / 2, r - size];
    for (const c of cands) {
      const d = Math.abs(pos - c);
      if (d <= threshold && d < bestDist - 1e-9) {
        best = c;
        bestDist = d;
        guides = [r];
      } else if (d <= threshold && Math.abs(c - best) < 1e-9) {
        // Same snapped position reached via another ref — draw both.
        // (Compares candidate positions, not distances, so a midway point
        // between two different lines never draws a line it didn't snap to.)
        if (!guides.some((g) => Math.abs(g - r) < 1e-9)) guides.push(r);
      }
    }
  }
  return { pos: Math.round(best * 100) / 100, guides };
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
 * Collect snap reference lines for a move gesture: canvas 0/50/100 plus
 * every visible non-fullscreen sibling's left/center/right (xs) and
 * top/center/bottom (ys), resolved to left/top percent space via boxTopLeft
 * (aspect-locked heights included). The dragged layer itself is excluded.
 * Rotated siblings are excluded: their layout box doesn't match visible
 * bounds, so a layout-space line would mislead.
 */
function buildSnapTargets(
  ordered: Array<{ idx: number; box: Box; hidden?: boolean }>,
  excludeIdx: number,
  rectW: number,
  rectH: number
): { xs: number[]; ys: number[] } {
  const xs: number[] = [0, 50, 100];
  const ys: number[] = [0, 50, 100];
  for (const o of ordered) {
    if (o.idx === excludeIdx || o.hidden || o.box.fullscreen) continue;
    if (Math.abs(o.box.rotateDeg) > 0.01) continue;
    const { left, top, height } = boxTopLeft(o.box, rectW, rectH);
    const w = o.box.widthPct;
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    xs.push(left, left + w / 2, left + w);
    ys.push(top, top + height / 2, top + height);
  }
  const dedupe = (arr: number[]) => {
    const out: number[] = [];
    for (const v of arr) {
      if (!Number.isFinite(v)) continue;
      if (!out.some((e) => Math.abs(e - v) < 0.01)) out.push(Math.round(v * 100) / 100);
    }
    return out;
  };
  return { xs: dedupe(xs), ys: dedupe(ys) };
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
 * Resize helper: snap a moving edge to the closest ref within threshold.
 * Returns the snapped edge position + matched ref (for the guide line),
 * or null when nothing is close enough.
 */
function snapMovingEdge(
  edge: number,
  refs: number[],
  threshold: number
): { pos: number; guide: number } | null {
  let best: number | null = null;
  let bestGuide = 0;
  let bestDist = threshold + 1e-9;
  for (const r of refs) {
    const d = Math.abs(edge - r);
    if (d <= threshold && d < bestDist - 1e-9) {
      best = r;
      bestGuide = r;
      bestDist = d;
    }
  }
  if (best === null) return null;
  return { pos: Math.round(best * 100) / 100, guide: Math.round(bestGuide * 100) / 100 };
}

/**
 * Rotate snap: sibling layer angles first (within 3°, wrap-aware), then the
 * 45°-multiple base snaps. Returns the degree to use + what it snapped to
 * so the overlay can show an indicator (base vs sibling).
 */
function snapRotateLayer(
  deg: number,
  extraAngles: number[] = []
): { deg: number; snapped: boolean; sibling: boolean; matched: number | null } {
  const n = norm180(deg);
  for (const a of extraAngles) {
    if (!Number.isFinite(a)) continue;
    const d = Math.abs(((n - norm180(a) + 540) % 360) - 180);
    if (d <= 3) {
      const m = Math.round(norm180(a));
      return { deg: m, snapped: true, sibling: true, matched: m };
    }
  }
  const base = snapRotate(n);
  if (base !== n) {
    return { deg: Math.round(base), snapped: true, sibling: false, matched: Math.round(base) };
  }
  // No snap — still normalize rounding.
  return { deg: Math.round(n), snapped: false, sibling: false, matched: null };
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
  /** Backend size floor — 2% Shape, 5% everything else (schemas._clamp_percent). */
  minSize: number;
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
  /** Move-gesture snap lines (canvas + siblings) captured at dragstart. */
  snapXs: number[];
  snapYs: number[];
  /** px-consistent per-axis thresholds captured at dragstart. */
  snapTx: number;
  snapTy: number;
  /** Currently matched guide lines (subset of snapXs/snapYs), for rendering. */
  guides: { v: number[]; h: number[] };
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
  /** Sibling layer angles captured at dragstart for layer-aware rotate snap. */
  snapAngles: number[];
}

/**
 * Drag geometry in left/top percent space. Move snaps edges/center against
 * canvas + sibling reference lines (see buildSnapTargets) and may
 * leave the canvas on any side (symmetric bounds: fully out in every
 * direction, e.g. slide-in offsets); resize pins the opposite edge (corners)
 * or axis (edges). Aspect-locked layers resize width-only with bottom-edge
 * pinning for north handles — N/S edge handles instead unlock via
 * `dropAspect` (freeform path). Ranges mirror the backend save authority
 * (schemas._clamp_percent): sizes 5–100%, positions −20–100% — what you
 * drag is what survives the save.
 * Pass snapXs/snapYs for layer-aware move snapping; omit (or empty) to fall
 * back to the legacy canvas-only snapPos.
 */
function computeDrag(
  init: DragInit,
  mode: DragMode,
  corner: DragCorner | null,
  edge: EdgeDir | null,
  dxPct: number,
  dyPct: number,
  snap?: { xs: number[]; ys: number[]; tx?: number; ty?: number }
): { left: number; top: number; width: number; height: number; guides: { v: number[]; h: number[] } } {
  if (mode === 'move') {
    const rawLeft = init.left + dxPct;
    const rawTop = init.top + dyPct;
    let guides: { v: number[]; h: number[] } = EMPTY_GUIDES;
    let left: number;
    let top: number;
    if (snap && (snap.xs.length > 0 || snap.ys.length > 0)) {
      const tx = snap.tx ?? SNAP_THRESHOLD_PCT;
      const ty = snap.ty ?? SNAP_THRESHOLD_PCT;
      const sx = snapAxis(rawLeft, init.width, snap.xs.length ? snap.xs : [0, 50, 100], tx);
      const sy = snapAxis(rawTop, init.height, snap.ys.length ? snap.ys : [0, 50, 100], ty);
      left = clampN(sx.pos, -20, 100);
      top = clampN(sy.pos, -20, 100);
      guides = (sx.guides.length === 0 && sy.guides.length === 0)
        ? EMPTY_GUIDES
        : { v: sx.guides, h: sy.guides };
    } else {
      left = clampN(snapPos(rawLeft, init.width), -20, 100);
      top = clampN(snapPos(rawTop, init.height), -20, 100);
    }
    return { left, top, width: init.width, height: init.height, guides };
  }
  const east = mode === 'edge' ? edge === 'e' : corner === 'se' || corner === 'ne';
  const west = mode === 'edge' ? edge === 'w' : corner === 'sw' || corner === 'nw';
  const south = mode === 'edge' ? edge === 's' : corner === 'se' || corner === 'sw';
  const north = mode === 'edge' ? edge === 'n' : corner === 'ne' || corner === 'nw';
  const tx = snap?.tx ?? SNAP_THRESHOLD_PCT;
  const ty = snap?.ty ?? SNAP_THRESHOLD_PCT;
  const xs = snap && snap.xs.length ? snap.xs : [0, 50, 100];
  const ys = snap && snap.ys.length ? snap.ys : [0, 50, 100];
  if (init.aspect) {
    const floor = init.minSize ?? 5;
    let width = clampN(init.width + (east ? dxPct : -dxPct), floor, 100);
    // Aspect width snap: grabbed vertical edge (right for E, left for W)
    // lands on a sibling/canvas ref; height follows the locked ratio.
    let guideV: number[] = [];
    let guideH: number[] = [];
    if (snap && (east || west)) {
      const movingRight = east ? init.left + width : null;
      const fixedRight = init.left + init.width;
      const movingLeft = !east && west ? fixedRight - width : null;
      const hitV = movingRight !== null
        ? snapMovingEdge(movingRight, xs, tx)
        : movingLeft !== null
          ? snapMovingEdge(movingLeft, xs, tx)
          : null;
      if (hitV) {
        const snappedW = movingRight !== null
          ? hitV.pos - init.left
          : fixedRight - hitV.pos;
        if (snappedW >= floor && snappedW <= 100) {
          width = Math.round(snappedW * 100) / 100;
          guideV = [hitV.guide];
        }
      }
    }
    // Height scales linearly with width (fixed ratio, fixed container), so
    // north handles pin the bottom edge instead of growing the box downward.
    // Clamped to the backend range — tall ratios must not preview past 100%.
    let height = init.width > 0
      ? clampN((init.height * width) / init.width, floor, 100) : init.height;
    // Aspect height fallback: N/S handle with no width snap — solve width so
    // the horizontal moving edge lands on a ref.
    if (snap && guideV.length === 0 && (south || north) && init.width > 0 && init.height > 0) {
      const movingBottom = south && !north ? init.top + height : null;
      const fixedBottom = init.top + init.height;
      const movingTop = !south && north ? fixedBottom - height : null;
      const hitH = movingBottom !== null
        ? snapMovingEdge(movingBottom, ys, ty)
        : movingTop !== null
          ? snapMovingEdge(movingTop, ys, ty)
          : null;
      if (hitH) {
        const snappedH = movingBottom !== null ? hitH.pos - init.top : fixedBottom - hitH.pos;
        if (snappedH >= floor && snappedH <= 100) {
          const solvedW = (snappedH * init.width) / init.height;
          if (solvedW >= floor && solvedW <= 100) {
            width = Math.round(solvedW * 100) / 100;
            height = Math.round(snappedH * 100) / 100;
            guideH = [hitH.guide];
          }
        }
      }
    }
    return {
      left: clampN(east || (!west && !east) ? init.left : init.left + init.width - width, -20, 100),
      top: south || (!north && !south) ? init.top : clampN(init.top + init.height - height, -20, 100),
      width,
      height,
      guides: (guideV.length === 0 && guideH.length === 0) ? EMPTY_GUIDES : { v: guideV, h: guideH },
    };
  }
  const floor = init.minSize ?? 5;
  let width = east || west ? clampN(init.width + (east ? dxPct : -dxPct), floor, 100) : init.width;
  let height = south || north ? clampN(init.height + (south ? dyPct : -dyPct), floor, 100) : init.height;
  let left = west ? init.left + init.width - width : init.left;
  let top = north ? init.top + init.height - height : init.top;
  // Freeform resize snap: each moving edge lands on sibling/canvas refs.
  let guideV: number[] = [];
  let guideH: number[] = [];
  if (snap) {
    if (east && !west) {
      const hit = snapMovingEdge(left + width, xs, tx);
      if (hit) {
        const w = hit.pos - left;
        if (w >= floor && w <= 100) { width = Math.round(w * 100) / 100; guideV = [hit.guide]; }
      }
    } else if (west && !east) {
      const fixedRight = init.left + init.width;
      const hit = snapMovingEdge(fixedRight - width, xs, tx);
      if (hit) {
        const w = fixedRight - hit.pos;
        if (w >= floor && w <= 100) { width = Math.round(w * 100) / 100; left = hit.pos; guideV = [hit.guide]; }
      }
    }
    if (south && !north) {
      const hit = snapMovingEdge(top + height, ys, ty);
      if (hit) {
        const h = hit.pos - top;
        if (h >= floor && h <= 100) { height = Math.round(h * 100) / 100; guideH = [hit.guide]; }
      }
    } else if (north && !south) {
      const fixedBottom = init.top + init.height;
      const hit = snapMovingEdge(fixedBottom - height, ys, ty);
      if (hit) {
        const h = fixedBottom - hit.pos;
        if (h >= floor && h <= 100) { height = Math.round(h * 100) / 100; top = hit.pos; guideH = [hit.guide]; }
      }
    }
  }
  return {
    left: clampN(left, -20, 100),
    top: clampN(top, -20, 100),
    width,
    height,
    guides: (guideV.length === 0 && guideH.length === 0) ? EMPTY_GUIDES : { v: guideV, h: guideH },
  };
}

/** P4 Corner drag scale factors from raw (unclamped) corner deltas. */
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
  // Uniform scaling by default: pick the dominant axis delta so corner pulls
  // preserve aspect ratio and never squish or distort text or media.
  const f = Math.abs(dxPct) >= Math.abs(dyPct) ? fx : fy;
  return { fx: f, fy: f };
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
  return snapRotateLayer(norm180(pointer - r.offset), r.snapAngles);
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
  /** Renderer-identical mask clip echo (undefined when unmasked). */
  maskClip?: string;
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
  liveDrag, liveScale, liveRotateDeg, pendingStyle, maskClip, gesturingThis,
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
  const isNearTop = effBox.topPct !== null && effBox.topPct < 6 && !effBox.fullscreen;
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
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (locked) return;
    e.stopPropagation();
    onSelect(idx);
    const st = useEditorStore.getState();
    if (st.inspectorTab !== 'visuals') {
      st.setInspectorTab('visuals');
    }
  }, [locked, onSelect, idx]);
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
      onDoubleClick={handleDoubleClick}
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
          ? 'border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_16px_rgba(245,158,11,0.35)] ring-1 ring-amber-400/40'
          : 'border border-dashed border-white/25 hover:border-amber-400/80 hover:bg-amber-400/5'
      }`}
    >
      {/* Mask echo: same clip-path the renderer applies, on a
          pointer-transparent inner div. The interactive box keeps the full
          rect (clipping it would make outside handles unclickable). */}
      {maskClip && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            clipPath: maskClip,
            WebkitClipPath: maskClip,
            background: selected ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.08)',
            borderRadius: 'inherit',
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          top: badgeTop,
          left: badgeLeft,
          pointerEvents: 'none',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          padding: '2px 8px',
          borderRadius: 999,
          background: selected ? '#f59e0b' : 'rgba(9,9,11,0.85)',
          color: selected ? '#09090b' : '#fcd34d',
          border: selected ? '1px solid #fbbf24' : '1px solid rgba(245,158,11,0.45)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          opacity: selected ? 1 : 0,
          transform: counterRotate,
          transformOrigin: 'top left',
        }}
        className="group-hover/box:opacity-100 transition-opacity"
      >
        {`L${idx + 1} · ${cType}${maskClip ? ' · ✂️ masked' : ''}`}
      </span>
      {/* P3/P4 corner scale handles (aspect-preserving uniform scale).
          Corner drag directly manipulates scale; hold Alt for dimension resizing.
          22px expanded hitbox ensures effortless, reliable grabbing. */}
      {showHandles &&
        (['se', 'sw', 'ne', 'nw'] as DragCorner[]).map((c) => (
          <div
            key={c}
            onPointerDown={cornerDown[c]}
            onPointerMove={onMove}
            onPointerUp={handleBoxUp}
            onPointerCancel={handleBoxCancel}
            onClick={consumeClick}
            title="Scale element (Alt: resize box dimensions)"
            style={{
              position: 'absolute',
              width: 22,
              height: 22,
              left: c === 'sw' || c === 'nw' ? -11 : undefined,
              right: c === 'se' || c === 'ne' ? -11 : undefined,
              top: c === 'ne' || c === 'nw' ? -11 : undefined,
              bottom: c === 'se' || c === 'sw' ? -11 : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: cornerCursor(c, effRotateDeg),
              transform: invHandles,
              zIndex: 10,
              touchAction: 'none',
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: 'rgba(245,158,11,0.95)',
                border: '1px solid rgba(0,0,0,0.6)',
                boxShadow: '0 0 4px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        ))}
      {/* P4 edge resize handles (N/S unlock aspect; rotated use local axes).
          24px expanded hitbox ensures easy edge grabbing. */}
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
              width: d === 'n' || d === 's' ? 24 : 18,
              height: d === 'n' || d === 's' ? 18 : 24,
              left: d === 'n' || d === 's' ? '50%' : d === 'w' ? -9 : undefined,
              right: d === 'e' ? -9 : undefined,
              top: d === 'e' || d === 'w' ? '50%' : d === 'n' ? -9 : undefined,
              bottom: d === 's' ? -9 : undefined,
              marginLeft: d === 'n' || d === 's' ? -12 : undefined,
              marginTop: d === 'e' || d === 'w' ? -12 : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: edgeCursor(d, effRotateDeg),
              transform: invHandles,
              zIndex: 9,
              touchAction: 'none',
            }}
          >
            <div
              style={{
                width: d === 'n' || d === 's' ? 14 : 8,
                height: d === 'n' || d === 's' ? 8 : 14,
                borderRadius: 2,
                background: 'rgba(245,158,11,0.95)',
                border: '1px solid rgba(0,0,0,0.6)',
                boxShadow: '0 0 4px rgba(0,0,0,0.5)',
              }}
            />
          </div>
        ))}
      {/* P4 rotate lollipop — orbits with the box. Lifted clear of North handle.
          Inverts to bottom edge when near top edge of canvas to prevent clipping. */}
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
            top: isNearTop ? undefined : -38,
            bottom: isNearTop ? -38 : undefined,
            width: 16,
            height: 30,
            marginLeft: -8,
            cursor: 'grab',
            transform: invHandles,
            zIndex: 12,
            touchAction: 'none',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: isNearTop ? 'column-reverse' : 'column',
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
                boxShadow: '0 0 4px rgba(0,0,0,0.5)',
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
  /** Playback fps — must match the Player so scene resolving agrees with it. */
  fps?: number;
}> = ({ scenes, locked, onSelectLayer, onStyleCommit, sceneTimings, compositionSize, fps = 30 }) => {
  const selectedSceneIndex = useEditorStore((s) => s.selectedSceneIndex);
  const selectedSubVisualIndex = useEditorStore((s) => s.selectedSubVisualIndex);
  const selectedLayerIndex = useEditorStore((s) => s.selectedLayerIndex);
  const setSelectedLayerIndex = useEditorStore((s) => s.setSelectedLayerIndex);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // Optimization: while playing, the canvas overlay is hidden (returns null on line 1926).
  // Bailing out via equality function avoids waking up CanvasOverlay during playback.
  // When paused or scrubbing, it updates to s.currentFrame so handles follow the playhead.
  const currentFrame = useStoreWithEqualityFn(
    usePlaybackStore,
    (s) => s.currentFrame,
    (a, b) => (isPlaying ? true : a === b)
  );

  // Active scene resolution
  const activeSceneIdx = useMemo(() => {
    return getActiveSceneIdx(scenes, currentFrame, fps);
  }, [scenes, currentFrame, fps]);

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

  const isLocked = locked === true;
  const compW = compositionSize?.w ?? 1920;
  const compH = compositionSize?.h ?? 1080;
  const isPortrait = compH > compW;

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
  const [rotatePreview, setRotatePreview] = useState<{ layerIdx: number; deg: number; snapped: boolean; sibling: boolean; matched: number | null } | null>(null);
  const rotateRef = useRef<RotateSession | null>(null);
  const rotateMoveRef = useRef<{ x: number; y: number } | null>(null);
  const handleRotateMoveRef = useRef<(e: React.PointerEvent) => void>(() => {});
  const handleRotateEndRef = useRef<(e: React.PointerEvent, commit: boolean) => void>(() => {});

  // Live DOM measurement from Remotion Player DOM:
  // Measures the exact rendered bounding box of layers (especially kinetic text).
  const [domRects, setDomRects] = useState<Record<number, { left: number; top: number; width: number; height: number }>>({});

  const measure = useCallback(() => {
    if (useEditorStore.getState().isPlaying) return;
    if (!rootRef.current) return;
    const root = rootRef.current;
    const parent = root.parentElement;
    if (!parent) return;

    const rootRect = root.getBoundingClientRect();
    if (rootRect.width <= 0 || rootRect.height <= 0) return;

    const newRects: Record<number, { left: number; top: number; width: number; height: number }> = {};
    const layerEls = parent.querySelectorAll<HTMLElement>('[data-ast-layer-idx]');
    layerEls.forEach((el) => {
      const idxAttr = el.getAttribute('data-ast-layer-idx');
      if (idxAttr === null) return;
      const idx = parseInt(idxAttr, 10);
      if (isNaN(idx)) return;

      const isTextLayer = el.getAttribute('data-ast-layer-type') === 'Text';
      const targetNode = isTextLayer ? (el.querySelector<HTMLElement>('[data-kinetic-text]') || el) : el;
      const targetRect = targetNode.getBoundingClientRect();

      const left = ((targetRect.left - rootRect.left) / rootRect.width) * 100;
      const top = ((targetRect.top - rootRect.top) / rootRect.height) * 100;
      const width = (targetRect.width / rootRect.width) * 100;
      const height = (targetRect.height / rootRect.height) * 100;

      if (width > 0 && height > 0) {
        newRects[idx] = {
          left: Math.round(left * 100) / 100,
          top: Math.round(top * 100) / 100,
          width: Math.round(width * 100) / 100,
          height: Math.round(height * 100) / 100,
        };
      }
    });

    setDomRects((prev) => {
      const prevKeys = Object.keys(prev);
      const newKeys = Object.keys(newRects);
      if (prevKeys.length !== newKeys.length) return newRects;
      for (const k of newKeys) {
        const p = prev[Number(k)];
        const n = newRects[Number(k)];
        if (
          !p ||
          Math.abs(p.left - n.left) > 0.5 ||
          Math.abs(p.top - n.top) > 0.5 ||
          Math.abs(p.width - n.width) > 0.5 ||
          Math.abs(p.height - n.height) > 0.5
        ) {
          return newRects;
        }
      }
      return prev;
    });
  }, []);

  // Primary measure effect: executes when playback pauses, when cuts switch,
  // or when scene selection / layer composition changes.
  useEffect(() => {
    if (!rootRef.current || isPlaying) return;
    measure();
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
  }, [scenes, selectedSceneIndex, selectedSubVisualIndex, playheadSubIdx, isPlaying, measure]);

  // Debounced measurement when scrubbing frames while paused: keeps scrubbing fluid
  // at 60fps without synchronous layout reflow on each frame, while updating rects once settled.
  useEffect(() => {
    if (isPlaying) return;
    const t = setTimeout(measure, 80);
    return () => clearTimeout(t);
  }, [currentFrame, isPlaying, measure]);

  // Prop mirrors: gesture callbacks and global listeners stay referentially
  // stable while always reading the latest values, so window listeners
  // register once and memoized children never re-render from callback churn.
  const lockedRef = useRef(isLocked);
  const sceneTimingsRef = useRef(sceneTimings);
  const scenesRef = useRef(scenes);
  const fpsRef = useRef(fps);
  const onSelectLayerRef = useRef(onSelectLayer);
  const onStyleCommitRef = useRef(onStyleCommit);
  // Live sibling boxes for layer-aware snapping (beginDrag reads via ref so
  // the stable callback never captures a stale `view` closure).
  const orderedRef = useRef<Array<{ idx: number; box: Box; hidden?: boolean }>>([]);
  useEffect(() => { lockedRef.current = isLocked; }, [isLocked]);
  useEffect(() => { sceneTimingsRef.current = sceneTimings; }, [sceneTimings]);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
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
      if (getActiveSceneIdx(liveScenes, frame, fpsRef.current) !== sceneIdx) return;

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
      const targetScaleMode = !want;
      if (s.scaleMode === targetScaleMode) return;
      if (want) e.preventDefault();
      const updated: DragSession = {
        ...s,
        scaleMode: targetScaleMode,
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

  // NOTE: activeSceneIdx and playheadSubIdx are hoisted above to drive DOM measurement

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
    const ordered = source.map(({ layer, idx }, orderIdx) => ({
      layer,
      idx,
      box: layerToBox(layer, compW, compH, orderIdx, domRects[idx]),
    }));
    return {
      displaySubIdx,
      isViewingSelectedCut: displaySubIdx === selectedSubVisualIndex,
      children,
      ordered,
      cutTotal: subVisuals.length,
      sceneBadge: scene.section_type === 'introduction'
        ? 'INTRO'
        : scene.section_type === 'conclusion'
          ? 'OUTRO'
          : `SCENE ${scenes.slice(0, selectedSceneIndex + 1).filter((s: any) => s?.section_type === 'scene').length}`,
      sceneTitle: scene.title
        || (scene.section_type === 'introduction' ? 'Introduction'
          : scene.section_type === 'conclusion' ? 'Conclusion' : ''),
      sceneTotal: scenes.filter((s: any) => s?.section_type === 'scene').length,
      isSceneSection: scene.section_type !== 'introduction' && scene.section_type !== 'conclusion',
    };
  }, [scenes, selectedSceneIndex, selectedSubVisualIndex, activeSceneIdx, playheadSubIdx, compW, compH, domRects]);

  // Keep sibling geometry fresh for beginDrag's snap-target builder (ref so
  // the stable drag callback never captures a stale `view` closure).
  useEffect(() => {
    orderedRef.current = (view?.ordered ?? []).map((o: any) => ({
      idx: o.idx,
      box: o.box,
      hidden: (o.layer as any)?.visible === false,
    }));
  }, [view]);

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
    const scaleMode = mode === 'corner' ? !e.altKey : false;
    const edge = mode === 'edge' ? (dir as EdgeDir) : null;
    const corner = mode === 'corner' ? (dir as DragCorner) : null;
    const dropAspect = mode === 'edge' && (edge === 'n' || edge === 's') && !!box.aspectRatio;
    const numOr = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);
    const legacyScale = numOr(parseScaleAxis(style.scale), 1);
    // Cut identity AFTER routing (pointerdown adopts the previewed cut) —
    // a mid-gesture selection change voids the commit at pointer-up.
    const st0 = useEditorStore.getState();
    // Sibling snap lines for move + resize gestures (canvas + other layers).
    // Alt-scale (multipliers) ignores them — no layout edge moves there.
    const { xs: snapXs, ys: snapYs } =
      !scaleMode
        ? buildSnapTargets(orderedRef.current, layerIdx, rect.width, rect.height)
        : { xs: [] as number[], ys: [] as number[] };
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
        minSize: layer?.content?.type === 'Shape' ? 2 : 5,
      },
      cur: { left, top, width: box.widthPct, height },
      preview: null,
      moved: false,
      snapXs,
      snapYs,
      snapTx: pxSnapThreshold(rect.width),
      snapTy: pxSnapThreshold(rect.height),
      guides: EMPTY_GUIDES,
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
        let guides = cur.guides;
        let preview: Record<string, any> | null = null;
        if (cur.scaleMode && cur.mode === 'corner') {
          const { scaleX, scaleY } = sessionScale(cur, dxPct, dyPct);
          preview = { scaleX, scaleY };
          const prev = cur.preview;
          const samePreview = !!prev
            && Math.abs((prev.scaleX ?? 0) - scaleX) < 1e-9
            && Math.abs((prev.scaleY ?? 0) - scaleY) < 1e-9;
          if (samePreview) return; // no visible change — skip re-render
        } else {
          const raw = computeDrag(cur.init, cur.mode, cur.corner, cur.edge, dxPct, dyPct, { xs: cur.snapXs, ys: cur.snapYs, tx: cur.snapTx, ty: cur.snapTy });
          guides = raw.guides;
          // Moves track the cursor raw; resizes re-pin the stationary edge
          // through the world transform when rotated/mirrored.
          next =
            cur.mode !== 'move' && (cur.rotDeg !== 0 || cur.flipX || cur.flipY)
              ? pinOppositeEdge(cur.init, raw, cur.rotDeg, cur.flipX, cur.flipY, cur.rectW, cur.rectH)
              : raw;
          // Bail out when the rounded geometry and guides are unchanged —
          // high-Hz mice otherwise re-render the overlay every pointermove.
          const sameGeom = Math.abs(next.left - cur.cur.left) < 1e-9
            && Math.abs(next.top - cur.cur.top) < 1e-9
            && Math.abs(next.width - cur.cur.width) < 1e-9
            && Math.abs(next.height - cur.cur.height) < 1e-9;
          if (sameGeom && guidesEqual(guides.v, cur.guides.v) && guidesEqual(guides.h, cur.guides.h)) return;
        }
        const updated: DragSession = { ...cur, cur: next, preview, moved: true, guides };
        dragRef.current = updated;
        setDrag(updated);
      }
      const r = rotateRef.current;
      const rm = rotateMoveRef.current;
      if (r && rm) {
        const s = rotateDegFor(r, rm.x, rm.y);
        setRotatePreview((prev) => {
          if (prev && prev.layerIdx === r.layerIdx && prev.deg === s.deg
            && prev.snapped === s.snapped && prev.sibling === s.sibling) return prev;
          return { layerIdx: r.layerIdx, deg: s.deg, snapped: s.snapped, sibling: s.sibling, matched: s.matched };
        });
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
      const raw = computeDrag(s.init, s.mode, s.corner, s.edge, dxPct, dyPct, { xs: s.snapXs, ys: s.snapYs, tx: s.snapTx, ty: s.snapTy });
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
  // be approximately right). Snaps to 45° multiples + sibling layer angles
  // within 3° (sibling-first, wrap-aware).
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
    // Sibling angles for layer-aware rotate snap (exclude self/fullscreen/hidden).
    const snapAngles: number[] = [];
    for (const o of orderedRef.current) {
      if (o.idx === layerIdx || o.hidden || o.box.fullscreen) continue;
      if (Number.isFinite(o.box.rotateDeg)) snapAngles.push(norm180(o.box.rotateDeg));
    }
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
      snapAngles,
    };
    setRotatePreview({ layerIdx, deg: Math.round(box.rotateDeg), snapped: false, sibling: false, matched: null });
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
    const { deg } = rotateDegFor(r, e.clientX, e.clientY);
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

      {/* Live snap guides: move + resize (canvas amber solid, sibling sky dashed), above boxes.
          Alt-scale sets no guides — multipliers have no layout edge to align. */}
      {drag && !drag.scaleMode && drag.guides.v.map((x) => {
        const canvas = isCanvasRef(x);
        return (
          <div
            key={`v-${x}`}
            className="absolute top-0 bottom-0 pointer-events-none z-[120]"
            style={{
              left: `${x}%`,
              width: canvas ? 1 : 0,
              borderLeft: canvas ? undefined : '1px dashed rgba(56, 189, 248, 0.9)',
              backgroundColor: canvas ? 'rgba(245, 158, 11, 0.9)' : undefined,
              boxShadow: canvas
                ? '0 0 8px rgba(245, 158, 11, 0.75)'
                : '0 0 8px rgba(56, 189, 248, 0.6)',
            }}
          />
        );
      })}
      {drag && !drag.scaleMode && drag.guides.h.map((y) => {
        const canvas = isCanvasRef(y);
        return (
          <div
            key={`h-${y}`}
            className="absolute left-0 right-0 pointer-events-none z-[120]"
            style={{
              top: `${y}%`,
              height: canvas ? 1 : 0,
              borderTop: canvas ? undefined : '1px dashed rgba(56, 189, 248, 0.9)',
              backgroundColor: canvas ? 'rgba(245, 158, 11, 0.9)' : undefined,
              boxShadow: canvas
                ? '0 0 8px rgba(245, 158, 11, 0.75)'
                : '0 0 8px rgba(56, 189, 248, 0.6)',
            }}
          />
        );
      })}

      {/* Rotate snap indicator: base 45° (amber) vs sibling angle (sky) */}
      {rotatePreview?.snapped && (
        <div
          className="absolute left-1/2 top-2 z-[120] pointer-events-none -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold tabular-nums"
          style={{
            background: rotatePreview.sibling ? 'rgba(56, 189, 248, 0.95)' : 'rgba(245, 158, 11, 0.95)',
            color: '#09090b',
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          }}
        >
          {`${rotatePreview.deg}°${rotatePreview.sibling ? ' · layer' : ''}`}
        </div>
      )}

      {view.ordered.map(({ layer, idx, box }) => {
        if ((layer as any)?.visible === false) return null;
        // Live overrides are per-layer: only the gesturing/dropped layer gets
        // non-null props, so memoized siblings skip the re-render entirely.
        const liveSession = drag && drag.layerIdx === idx ? drag : null;
        // Mask echo clip (string prop — memoized siblings skip unless their
        // own clip changes; only an actively-revealing layer re-renders).
        const subStartFrame =
          sceneTimings?.[selectedSceneIndex as number]?.subs?.[view.displaySubIdx]?.start ?? 0;
        const maskClip = getOverlayMaskClip((layer as any)?.mask, currentFrame, subStartFrame);
        return (
          <LayerBox
            key={idx}
            layer={layer}
            idx={idx}
            box={box}
            maskClip={maskClip}
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
        className={`absolute left-2 bottom-2 z-[110] pointer-events-auto w-fit whitespace-nowrap flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-xl bg-zinc-950/85 backdrop-blur-md border border-zinc-700/60 shadow-lg shadow-black/40 origin-bottom-left transition-transform ${
          isPortrait ? 'scale-[0.80]' : 'scale-100'
        }`}
      >
        <span
          className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-px text-[10px] font-extrabold tracking-wider text-amber-300"
          title={view.isSceneSection ? `${view.sceneBadge} of ${view.sceneTotal}` : view.sceneBadge}
        >
          {view.sceneBadge}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-zinc-400 tabular-nums">
          Cut {view.displaySubIdx + 1}/{view.cutTotal}
        </span>
        {!isPortrait && (
          <span className="shrink-0 hidden sm:inline text-[9px] font-semibold text-zinc-500">
            {view.children.length} layer{view.children.length === 1 ? '' : 's'}
          </span>
        )}
        {hasValidSelection && (
          <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-px text-[9px] font-extrabold text-black tabular-nums">
            L{selectedLayerIndex + 1}
          </span>
        )}
        {isLocked && (
          <span className="shrink-0 text-[9px] font-bold text-amber-400/80">
            AI rewriting…
          </span>
        )}
        <div className="shrink-0 flex items-center gap-0.5">
          <div className="w-px h-3.5 bg-zinc-700/60 mr-0.5" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleLayer(-1);
            }}
            disabled={isLocked || view.children.length === 0}
            title="Previous layer ([)"
            aria-label="Previous layer"
            className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold text-amber-400 bg-transparent border-none cursor-pointer transition-colors hover:bg-amber-500/20 active:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent select-none"
          >
            {'‹'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleLayer(1);
            }}
            disabled={isLocked || view.children.length === 0}
            title="Next layer (])"
            aria-label="Next layer"
            className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold text-amber-400 bg-transparent border-none cursor-pointer transition-colors hover:bg-amber-500/20 active:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent select-none"
          >
            {'›'}
          </button>
        </div>
      </div>
    </div>
  );
};
