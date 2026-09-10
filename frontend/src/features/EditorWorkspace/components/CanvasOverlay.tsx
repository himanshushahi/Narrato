import React, { useMemo, useEffect } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

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

/**
 * P1 read-only canvas overlay: renders hit-boxes for composition layers of the
 * selected cut on top of the Remotion player.
 * Supports landscape/portrait, aspect-ratio lock, bottom-anchored text, and rotation.
 * P2: preview → editor routing (ensures Visuals tab), AI-rewrite lockout guard,
 * and prev/next layer chip controls (+ `[` / `]` keyboard cycling).
 */
export const CanvasOverlay: React.FC<{
  scenes: any[];
  /** P2 lockout: true while an AI rewrite touches the selected cut (boxes go inert). */
  locked?: boolean;
  /** P2 routing: layer click lands in the Visuals tab for that cut. Falls back to store-only routing when absent. */
  onSelectLayer?: (sceneIdx: number, subIdx: number, layerIdx: number) => void;
}> = ({ scenes, locked, onSelectLayer }) => {
  const selectedSceneIndex = useEditorStore((s) => s.selectedSceneIndex);
  const selectedSubVisualIndex = useEditorStore((s) => s.selectedSubVisualIndex);
  const selectedLayerIndex = useEditorStore((s) => s.selectedLayerIndex);
  const setSelectedLayerIndex = useEditorStore((s) => s.setSelectedLayerIndex);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const isLocked = locked === true;

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
  // stay gated on playback and text inputs.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useEditorStore.getState();
      if (e.key === 'Escape') {
        if (isLocked) return;
        if (st.selectedLayerIndex !== null) st.setSelectedLayerIndex(null);
        return;
      }
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

  return (
    <div
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

        const posStyle: React.CSSProperties = box.fullscreen
          ? { left: 0, top: 0, width: '100%', height: '100%' }
          : {
              ...(box.leftPct !== null ? { left: `${box.leftPct}%` } : {}),
              ...(box.leftPct === null && box.rightPct !== null ? { right: `${box.rightPct}%` } : {}),
              width: `${box.widthPct}%`,
              ...(box.topPct !== null ? { top: `${box.topPct}%` } : {}),
              ...(box.topPct === null && box.bottomPct !== null ? { bottom: `${box.bottomPct}%` } : {}),
              ...(box.aspectRatio
                ? { aspectRatio: box.aspectRatio }
                : (box.heightPct !== null ? { height: `${box.heightPct}%` } : {})),
            };

        // Fullscreen layers stay behind non-fullscreen layers even when selected,
        // so smaller foreground layers are never trapped beneath them.
        const z = box.fullscreen
          ? (selected ? 15 : 10 + box.zIndex)
          : (selected ? 100 : 20 + box.zIndex);

        // Keep label badges visible inside container when box is near the top edge
        const isNearTop = box.topPct !== null && box.topPct < 4 && !box.fullscreen;
        const badgeTop = isNearTop ? 4 : -22;
        const badgeLeft = isNearTop ? 4 : 0;
        const counterRotate = box.rotateDeg ? `rotate(${-box.rotateDeg}deg)` : undefined;

        return (
          <div
            key={idx}
            onClick={(e) => {
              e.stopPropagation();
              routeToLayer(idx);
            }}
            title={`Layer ${idx + 1} · ${cType}${box.fullscreen ? ' (fullscreen)' : ''}${isLocked ? ' — AI rewriting…' : ''}`}
            style={{
              ...posStyle,
              position: 'absolute',
              pointerEvents: isLocked ? 'none' : 'auto',
              cursor: isLocked ? 'default' : 'pointer',
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
