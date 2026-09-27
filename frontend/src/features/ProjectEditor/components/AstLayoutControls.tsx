import React, { memo, useState, useEffect } from 'react';
import { BsLayoutSplit, BsSliders } from 'react-icons/bs';
import { useProjectStore } from '../../../store/useProjectStore';

interface AstLayoutControlsProps {
  style?: React.CSSProperties;
  onChange: (style: React.CSSProperties) => void;
  /** True for Image / Video layers — enables Shape helpers. Media always fills the box (cover). */
  isMedia?: boolean;
  /** Info note for Coordinates & Dimensions (resize crops rather than refits). */
  dimensionsNote?: string | null;
  /** Info note for the Transform section (rotation exposes canvas edges). */
  transformNote?: string | null;
  /** LayerBox SOT v1: Map/Particles are full-frame canvases — sliders would
   * only crop. When true the position/size UI locks to Fullscreen. */
  fullscreenLocked?: boolean;
}

const LAYOUT_PRESETS: { label: string; icon: string; style: Record<string, any> }[] = [
  {
    label: 'Fullscreen',
    icon: '🔲',
    style: {
      position: 'absolute',
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%',
      borderRadius: '0px',
    },
  },
  {
    label: 'Center Card',
    icon: '🪟',
    style: {
      position: 'absolute',
      left: '15%',
      top: '16%',
      width: '70%',
      height: '66%',
    },
  },
  {
    label: 'Left Split (42%)',
    icon: '🌓',
    style: {
      position: 'absolute',
      left: '6%',
      top: '16%',
      width: '42%',
      height: '66%',
    },
  },
  {
    label: 'Right Split (42%)',
    icon: '🌗',
    style: {
      position: 'absolute',
      left: '52%',
      top: '16%',
      width: '42%',
      height: '66%',
    },
  },
  {
    label: 'Lower Third',
    icon: '📋',
    style: {
      position: 'absolute',
      bottom: '18%',
      left: '6%',
      width: '88%',
      // No height — text auto-sizes vertically from content.
    },
  },
  {
    label: 'Top Header Banner',
    icon: '📌',
    style: {
      position: 'absolute',
      left: '8%',
      top: '8%',
      width: '84%',
      height: '16%',
    },
  },
];

const RADIUS_PRESETS: { label: string; value: string; displaySuffix?: string }[] = [
  { label: 'Sharp', value: '0px' },
  { label: 'Subtle', value: '16px', displaySuffix: '16px' },
  { label: 'Smooth', value: '32px', displaySuffix: '32px' },
  { label: 'Round', value: '64px', displaySuffix: '64px' },
  { label: 'Pill', value: '9999px' },
  { label: 'Circle', value: '50%' },
];

/**
 * Free-typed %/px input paired with a slider. Sliders are int-only with
 * fixed ranges (0–100 position, 10–100 size) — this input reaches the rest
 * of the LayerBox value space: decimals (`30.71%`), negatives (`-10%` for
 * off-canvas bleed), and px passthrough (normalized to % by the validator
 * with the correct orientation grid). Draft-only while typing (no cursor
 * jump); commits on Enter/blur; invalid input reverts.
 */
const PctInputInner: React.FC<{
  /** Raw current style value (`30.71%`, `200px`, `30`) or '' when unset. */
  display: string;
  placeholder?: string;
  onCommit: (val: string) => void;
  title?: string;
  disabled?: boolean;
}> = ({ display, placeholder, onCommit, title, disabled }) => {
  const [draft, setDraft] = useState<string>(display);
  useEffect(() => { setDraft(display); }, [display]);
  const commit = (val: string) => {
    const t = val.trim();
    if (!t) { setDraft(display); return; }
    // Strict numeric shapes only: rejects "1.2.3", "...", "-..%" etc.
    // parseFloat("1.2.3") === 1.2 would otherwise commit a typo as "1.2%".
    const BARE_RE = /^-?(\d+\.?\d*|\.\d+)$/;
    const PCT_RE = /^-?(\d+\.?\d*|\.\d+)%$/;
    const PX_RE = /^-?(\d+\.?\d*|\.\d+)px$/;
    if (BARE_RE.test(t)) {
      const n = parseFloat(t);
      if (!Number.isFinite(n)) { setDraft(display); return; }
      onCommit(`${n}%`);
      return;
    }
    if (PCT_RE.test(t) || PX_RE.test(t)) {
      const n = parseFloat(t);
      if (!Number.isFinite(n)) { setDraft(display); return; }
      onCommit(t);
      return;
    }
    setDraft(display);
  };
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commit(draft);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setDraft(display);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-16 bg-black/60 border border-white/10 text-amber-400 text-[10px] font-mono rounded px-1.5 py-0.5 text-right focus:outline-none focus:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
      title={title ?? 'Type a % value (e.g. 30.71%), px, or bare number — Enter to apply, Esc to revert'}
    />
  );
};

const PctInput = memo(PctInputInner);
PctInput.displayName = 'PctInput';

const AstLayoutControlsInner: React.FC<AstLayoutControlsProps> = ({
  style = {},
  onChange,
  isMedia = false,
  dimensionsNote = null,
  transformNote = null,
  fullscreenLocked = false,
}) => {
  const currentStyle = (style || {}) as Record<string, any>;
  // Orientation-aware grid label — values are %-correct on every format.
  const projectFormat = useProjectStore((s) => s.selectedProject?.video_format);
  const gridLabel = projectFormat === 'portrait' ? '1080x1920 Grid' : projectFormat === 'square' ? '1080x1080 Grid' : '1920x1080 Grid';

  // LayerBox SOT v1: full-frame canvas types lock the whole Layout tab to
  // fullscreen. A stray positioned box would only crop the canvas (renderer
  // forces fullscreen anyway), and canvas rotation just exposes background
  // corners — so sliders are replaced by a status + reset control.
  if (fullscreenLocked) {
    const st = currentStyle;
    const isFullscreen = (st.width === '100%' || st.width === 100 || !st.width)
      && (st.height === '100%' || st.height === 100 || !st.height)
      && !st.left && !st.top && !(st as any).right && !(st as any).bottom;
    const resetFullscreen = () => {
      const next: Record<string, any> = { ...st };
      delete next.left; delete next.top;
      delete (next as any).right; delete (next as any).bottom;
      delete next.borderRadius; delete next.aspectRatio;
      next.width = '100%'; next.height = '100%';
      onChange(next);
    };
    return (
      <div className="space-y-3.5">
        <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            🖥️ Fullscreen Canvas
          </span>
          <p className="text-[10px] text-stone-400 leading-relaxed">
            This layer renders full-frame — position and size are locked to fullscreen.
            {dimensionsNote ? ` ${dimensionsNote}` : ''}
          </p>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${isFullscreen
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
              {isFullscreen ? '● Fullscreen' : '● Stray box (cropped)'}
            </span>
            {!isFullscreen && (
              <button
                type="button"
                onClick={resetFullscreen}
                className="px-2 py-0.5 bg-amber-500 text-black font-bold text-[10px] rounded hover:bg-amber-400 cursor-pointer"
              >
                Reset to Fullscreen
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const handleUpdate = (field: string, val: any) => {
    const updated = { ...currentStyle };
    if (val === undefined || val === '') {
      delete updated[field];
    } else {
      updated[field] = val;
    }
    onChange(updated);
  };

  const handleApplyPreset = (presetStyle: Record<string, any>) => {
    const merged = { ...currentStyle, ...presetStyle };
    for (const [k, v] of Object.entries(presetStyle)) {
      if (v === undefined) {
        delete (merged as any)[k];
      }
    }
    onChange(merged);
  };

  // Helper: parse percentage or pixel number
  const parseNum = (val: any, fallback = 0): number => {
    if (typeof val === 'number') return val;
    if (!val) return fallback;
    const match = val.toString().match(/([-\d.]+)/);
    return match ? parseFloat(match[1]) : fallback;
  };

  const leftVal = parseNum(currentStyle.left, 0);
  const topVal = parseNum(currentStyle.top, 0);
  const widthVal = parseNum(currentStyle.width, 100);
  const heightVal = parseNum(currentStyle.height, 100);

  // When aspectRatio is locked the renderer drops `height` and derives it
  // from width (ASTRenderer container sets height: undefined). The Height
  // slider must reflect that derived value — never the stale fallback —
  // or the first drag jumps and feels like a Y move instead of a resize.
  const aspectParts = typeof currentStyle.aspectRatio === 'string'
    ? currentStyle.aspectRatio.split('/').map((p: string) => parseFloat(p)).filter((n: number) => Number.isFinite(n) && n > 0)
    : [];
  const aspectRatioNum = aspectParts.length === 2 ? aspectParts[0] / aspectParts[1] : aspectParts.length === 1 ? aspectParts[0] : null;
  const autoHeightVal = aspectRatioNum ? Math.round(widthVal / aspectRatioNum) : heightVal;
  const isHeightLocked = !!currentStyle.aspectRatio && !!aspectRatioNum;
  const unlockHeight = () => {
    handleApplyPreset({
      height: `${Math.max(5, Math.min(100, autoHeightVal))}%`,
      aspectRatio: undefined,
    });
  };

  // Extract borderRadius value (e.g. "20px" or 20 -> 20)
  const radiusVal = parseNum(currentStyle.borderRadius, 0);
  const rawRadius =
    currentStyle.borderRadius !== undefined &&
    currentStyle.borderRadius !== null &&
    String(currentStyle.borderRadius).trim() !== ''
      ? String(currentStyle.borderRadius)
      : '0px';

  const isPercentRadius = rawRadius.trim().endsWith('%');

  // Local text input draft for corner radius to allow fluid typing without cursor jump
  const [draftRadius, setDraftRadius] = useState<string>(
    rawRadius === '0px' ? '' : rawRadius
  );

  useEffect(() => {
    setDraftRadius(rawRadius === '0px' ? '' : rawRadius);
  }, [rawRadius]);

  const commitRadius = (val: string) => {
    const t = val.trim();
    if (!t || t === '0' || t === '0px' || t === '0%') {
      handleUpdate('borderRadius', undefined);
      setDraftRadius('');
      return;
    }
    // Shared positive-number commit for the unitless and px branches.
    const commitPositivePx = (num: number) => {
      if (!Number.isFinite(num) || num <= 0) {
        handleUpdate('borderRadius', undefined);
        setDraftRadius('');
        return;
      }
      const formatted = `${num}px`;
      handleUpdate('borderRadius', formatted);
      setDraftRadius(formatted);
    };
    // Unitless bare number: "24", "-10", etc.
    if (/^[-\d.]+$/.test(t)) {
      commitPositivePx(parseFloat(t));
      return;
    }
    // Ends with %
    if (t.endsWith('%')) {
      const num = parseFloat(t.slice(0, -1));
      if (!Number.isFinite(num) || num <= 0) {
        handleApplyPreset({ borderRadius: undefined });
        setDraftRadius('');
        return;
      }
      const clamped = Math.min(50, num);
      const formatted = `${clamped}%`;
      if (clamped === 50 && isMedia) {
        handleApplyPreset({
          borderRadius: '50%',
          aspectRatio: '1 / 1',
          height: undefined,
        });
      } else {
        handleUpdate('borderRadius', formatted);
      }
      setDraftRadius(formatted);
      return;
    }
    // Ends with px
    if (t.endsWith('px')) {
      commitPositivePx(parseFloat(t.slice(0, -2)));
      return;
    }
    // Fallback: any other valid CSS string
    handleUpdate('borderRadius', t);
    setDraftRadius(t);
  };

  // Parse static transform (Layout tab): rotate in degrees, scale as multiplier.
  // Accepts numbers (15, 1.2) or strings ('15deg', '120%') for AI-authored JSON.
  // CapCut-style model: per-axis scaleX/scaleY win over legacy uniform `scale`;
  // first split edit normalizes legacy `scale` into both axes (deleted after).
  const parseRotate = (val: any): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const n = parseFloat(val);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const parseScale = (val: any): number => {
    // Negative scale mirrors (flip) — surfaced from AI-authored JSON; the
    // sliders below only produce 10–200%, Reset restores 100%.
    if (typeof val === 'number' && Number.isFinite(val) && val !== 0) return val;
    if (typeof val === 'string') {
      const t = val.trim();
      const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return 1;
  };
  const rotateVal = parseRotate(currentStyle.rotate);
  const legacyScale = parseScale(currentStyle.scale);
  const scaleXVal = currentStyle.scaleX !== undefined && currentStyle.scaleX !== null && String(currentStyle.scaleX).trim() !== ''
    ? parseScale(currentStyle.scaleX) : legacyScale;
  const scaleYVal = currentStyle.scaleY !== undefined && currentStyle.scaleY !== null && String(currentStyle.scaleY).trim() !== ''
    ? parseScale(currentStyle.scaleY) : legacyScale;
  const signX = scaleXVal < 0 ? -1 : 1;
  const signY = scaleYVal < 0 ? -1 : 1;
  const scaleXMag = Math.round(Math.abs(scaleXVal) * 100);
  const scaleYMag = Math.round(Math.abs(scaleYVal) * 100);
  // Uniform-link toggle (CapCut link icon behavior). Per-panel intent state;
  // defaults to linked when magnitudes match, or split if layer has asymmetric scaling.
  const [scaleLinked, setScaleLinked] = useState(() => scaleXMag === scaleYMag);

  // Auto-split if scales become asymmetric
  useEffect(() => {
    if (scaleXMag !== scaleYMag) {
      setScaleLinked(false);
    }
  }, [scaleXMag, scaleYMag]);

  const writeUniformScale = (pct: number) => {
    const val = (pct || 100) / 100;
    handleApplyPreset({
      scaleX: signX * val,
      scaleY: signY * val,
      scale: undefined,
    });
  };
  const hasTransform = rotateVal !== 0 || scaleXVal !== 1 || scaleYVal !== 1;

  return (
    <div className="space-y-3.5">
      {/* 1. Layout Presets */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
          <BsLayoutSplit size={11} />
          Position Presets
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.label}
              onClick={() => handleApplyPreset({ ...preset.style, bottom: undefined, right: undefined })}
              className="w-full px-2.5 py-1.5 bg-black/40 border text-[10px] font-bold rounded-lg flex items-center gap-2 text-left truncate transition-colors hover:bg-amber-500/15 border-white/10 hover:border-amber-500/40 text-stone-300 hover:text-amber-300 cursor-pointer"
            >
              <span>{preset.icon}</span>
              <span className="truncate">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Corner Radius / Rounding */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
          <span className="text-amber-400">Corner Radius / Rounding</span>
          <span className="text-amber-400 font-mono">{rawRadius}</span>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap gap-1">
          {RADIUS_PRESETS.map(p => {
            const isActive =
              rawRadius === p.value ||
              (p.value.endsWith('px') &&
                radiusVal === parseNum(p.value, -1) &&
                !rawRadius.includes('%'));
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  if (p.value === '0px') {
                    handleApplyPreset({ borderRadius: undefined });
                    setDraftRadius('');
                  } else if (p.label === 'Circle') {
                    // Circle preset: A circle mathematically requires 1:1 aspect ratio!
                    // On non-square video canvases (9:16 or 16:9), equal percentages or
                    // unequal dimensions result in an oval/ellipse. Setting aspectRatio: '1 / 1'
                    // forces exact equal pixel width & height.
                    const updates: Record<string, any> = {
                      borderRadius: '50%',
                      aspectRatio: '1 / 1',
                      height: undefined,
                    };
                    if (widthVal >= 95) {
                      updates.left = '30%';
                      updates.top = '30%';
                      updates.width = '40%';
                    }
                    handleApplyPreset(updates);
                    setDraftRadius('50%');
                  } else {
                    handleUpdate('borderRadius', p.value);
                    setDraftRadius(p.value);
                  }
                }}
                className={`px-2 py-0.5 rounded text-[9px] font-medium border transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                    : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
                }`}
              >
                {p.label}
                {p.displaySuffix ? ` (${p.displaySuffix})` : ''}
              </button>
            );
          })}
        </div>

        {/* Slider & Custom Input */}
        <div className="flex items-center gap-2 pt-0.5">
          <input
            type="range"
            min="0"
            max={isPercentRadius ? 50 : 200}
            step={isPercentRadius ? 1 : 2}
            value={isPercentRadius ? Math.min(50, Math.max(0, radiusVal)) : Math.min(200, Math.max(0, radiusVal))}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isFinite(v) || v <= 0) {
                handleApplyPreset({ borderRadius: undefined });
                setDraftRadius('');
              } else if (isPercentRadius) {
                const formatted = `${v}%`;
                if (v === 50 && isMedia) {
                  handleApplyPreset({
                    borderRadius: '50%',
                    aspectRatio: '1 / 1',
                    height: undefined,
                  });
                } else {
                  handleUpdate('borderRadius', formatted);
                }
                setDraftRadius(formatted);
              } else {
                const formatted = `${v}px`;
                handleUpdate('borderRadius', formatted);
                setDraftRadius(formatted);
              }
            }}
            className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            title={
              isPercentRadius
                ? 'Corner Radius slider (0 to 50%)'
                : radiusVal > 200
                  ? `Pill mode active (${rawRadius}) — slider adjusts up to 200px`
                  : 'Corner Radius slider (0 to 200px)'
            }
          />
          <input
            type="text"
            value={draftRadius}
            placeholder="0px"
            onChange={e => {
              // Draft-only on keystroke: never commit mid-typing (prevents cursor jump, 2px4, -px)
              setDraftRadius(e.target.value);
            }}
            onBlur={() => commitRadius(draftRadius)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                commitRadius(draftRadius);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-16 bg-black/60 border border-white/10 text-stone-200 text-xs font-mono rounded px-1.5 py-0.5 text-center focus:outline-none focus:border-amber-500/50"
            title="Direct CSS corner radius (e.g. 24, 24px, 50%, 9999px) — press Enter or click away to apply"
          />
        </div>

        {rawRadius === '50%' && !currentStyle.aspectRatio && isMedia && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] leading-relaxed text-amber-200/90 flex items-center justify-between gap-2">
            <span>⚠️ 50% radius on a rectangle creates an oval. Lock 1:1 aspect ratio to make it a perfect circle.</span>
            <button
              type="button"
              onClick={() => {
                handleApplyPreset({
                  aspectRatio: '1 / 1',
                  height: undefined,
                });
              }}
              className="px-2 py-0.5 bg-amber-500 text-black font-bold text-[9px] rounded hover:bg-amber-400 cursor-pointer shrink-0"
            >
              Make 1:1 Circle
            </button>
          </div>
        )}

        <p className="text-[9px] text-stone-500 leading-relaxed">
          💡 Tip: On full-frame layers, corner rounding trims outer canvas corners. For visible cards, insets, or circular badges, select a Layout Preset above or use Scale below.
        </p>
      </div>

      {/* 3. Position & Base Box Size (box = layout; Scale below = emphasis/zoom) */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <BsSliders size={11} />
            Position &amp; Box Size
          </span>
          <span className="text-[9px] text-stone-500 font-mono">{gridLabel}</span>
        </div>
        {dimensionsNote && (
          <div className="p-2 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
            ℹ️ {dimensionsNote}
          </div>
        )}

        {/* Sliders: Left & Top/Bottom (anchor-aware: AI text layers use bottom) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Left (X)</span>
              <PctInput
                display={currentStyle.left !== undefined && currentStyle.left !== null ? String(currentStyle.left) : ''}
                placeholder={`${leftVal}%`}
                onCommit={v => handleApplyPreset({ left: v, right: undefined })}
                title="Left edge — % (decimals/negatives allowed), px, or bare number. Writes left, clears right anchor."
              />
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={leftVal}
              onChange={e => handleApplyPreset({ left: `${e.target.value}%`, right: undefined })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

          {(() => {
            const rawTop = currentStyle.top;
            const rawBottom = (currentStyle as any).bottom;
            const hasTop = rawTop !== undefined && rawTop !== null && String(rawTop).trim() !== '';
            const hasBottom = rawBottom !== undefined && rawBottom !== null && String(rawBottom).trim() !== '';
            if (hasBottom && !hasTop) {
              const bottomVal = parseNum(rawBottom, 18);
              return (
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
                    <span>Bottom (Y)</span>
                    <PctInput
                      display={rawBottom !== undefined && rawBottom !== null ? String(rawBottom) : ''}
                      placeholder={`${bottomVal}%`}
                      onCommit={v => handleApplyPreset({ bottom: v })}
                      title="Bottom anchor — % (decimals/negatives allowed), px, or bare number. Height grows upward from this edge."
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.max(0, Math.min(100, bottomVal))}
                    onChange={e => handleApplyPreset({ bottom: `${e.target.value}%` })}
                    className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                    title="Bottom-anchored layer (AI text) — Height grows upward from this edge"
                  />
                </div>
              );
            }
            return (
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
                  <span>Top (Y)</span>
                  <PctInput
                    display={currentStyle.top !== undefined && currentStyle.top !== null ? String(currentStyle.top) : ''}
                    placeholder={`${topVal}%`}
                    onCommit={v => handleApplyPreset({ top: v, bottom: undefined })}
                    title="Top edge — % (decimals/negatives allowed), px, or bare number. Writes top, clears bottom anchor."
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={topVal}
                  onChange={e => handleApplyPreset({ top: `${e.target.value}%`, bottom: undefined })}
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                />
              </div>
            );
          })()}
        </div>

        {/* Sliders: Width & Height (base box — layout, not zoom) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Width</span>
              <PctInput
                display={currentStyle.width !== undefined && currentStyle.width !== null ? String(currentStyle.width) : ''}
                placeholder={`${widthVal}%`}
                onCommit={v => handleUpdate('width', v)}
                title="Base box width — % with decimals (e.g. 38.58%), px, or bare number. Slider covers 5–100% (backend floor)."
              />
            </div>
            <input
              type="range"
              min="5"
              max="100"
              value={widthVal}
              onChange={e => handleUpdate('width', `${e.target.value}%`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
              title="Base box width — layout size. Use Scale below for zoom/emphasis."
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Height</span>
              <PctInput
                display={isHeightLocked
                  ? `${autoHeightVal}%`
                  : (currentStyle.height !== undefined && currentStyle.height !== null ? String(currentStyle.height) : '')}
                placeholder={isHeightLocked ? 'Auto' : `${heightVal}%`}
                disabled={isHeightLocked}
                onCommit={v => handleApplyPreset({ height: v, aspectRatio: undefined })}
                title={isHeightLocked ? 'Aspect locked — Width drives height. Unlock for freeform height.' : 'Base box height — % with decimals, px, or bare number. Slider covers 5–100% (backend floor).'}
              />
            </div>
            <input
              type="range"
              min="5"
              max="100"
              value={isHeightLocked ? Math.max(5, Math.min(100, autoHeightVal)) : heightVal}
              disabled={isHeightLocked}
              onChange={e => {
                handleApplyPreset({
                  height: `${e.target.value}%`,
                  aspectRatio: undefined,
                });
              }}
              className="w-full accent-amber-500 h-1.5 bg-black/60 rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title={isHeightLocked ? `Aspect ratio locked at ${currentStyle.aspectRatio} — Width drives both dimensions. Unlock for freeform height.` : 'Base box height — layout size. Use Scale below for zoom/emphasis.'}
            />
            {isHeightLocked && (
              <button
                type="button"
                onClick={unlockHeight}
                className="px-1.5 py-0.5 rounded text-[9px] bg-black/50 border border-white/10 text-stone-500 hover:text-red-400 cursor-pointer"
                title="Unlock freeform height (starts at the current Auto value so nothing jumps)"
              >
                Unlock Freeform Height
              </button>
            )}
          </div>
        </div>

        {/* Quick Shape Presets — gated to Image/Video layers */}
        {isMedia && (
          <div className="flex items-center gap-1 pt-1 flex-wrap">
            <span className="text-[9px] text-stone-500 uppercase font-semibold">Shape:</span>
            <button
              type="button"
              onClick={() => {
                if (widthVal >= 95 && heightVal >= 95) {
                  handleApplyPreset({
                    left: '30%',
                    top: '30%',
                    width: '40%',
                    height: undefined,
                    aspectRatio: '1 / 1',
                  });
                } else {
                  handleApplyPreset({
                    aspectRatio: '1 / 1',
                    height: undefined,
                  });
                }
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors cursor-pointer ${
                currentStyle.aspectRatio === '1 / 1' || currentStyle.aspectRatio === '1'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
              }`}
              title="Square base box (required for a perfect Circle) — centers if fullscreen"
            >
              1:1 Square
            </button>
            <button
              type="button"
              onClick={() => {
                if (widthVal >= 95 && heightVal >= 95) {
                  handleApplyPreset({
                    left: '25%',
                    top: '25%',
                    width: '50%',
                    height: undefined,
                    aspectRatio: '4 / 3',
                  });
                } else {
                  handleApplyPreset({
                    aspectRatio: '4 / 3',
                    height: undefined,
                  });
                }
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors cursor-pointer ${
                currentStyle.aspectRatio === '4 / 3'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
              }`}
              title="4:3 photo frame base box — centers if fullscreen"
            >
              4:3 Photo
            </button>
            <button
              type="button"
              onClick={() => {
                if (widthVal >= 95 && heightVal >= 95) {
                  handleApplyPreset({
                    left: '10%',
                    top: '25%',
                    width: '80%',
                    height: undefined,
                    aspectRatio: '16 / 9',
                  });
                } else {
                  handleApplyPreset({
                    aspectRatio: '16 / 9',
                    height: undefined,
                  });
                }
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors cursor-pointer ${
                currentStyle.aspectRatio === '16 / 9'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
              }`}
              title="16:9 widescreen base box — centers if fullscreen"
            >
              16:9 Cinema
            </button>
            {currentStyle.aspectRatio && (
              <button
                type="button"
                onClick={() => {
                  handleApplyPreset({
                    aspectRatio: undefined,
                    height: `${widthVal}%`,
                  });
                }}
                className="px-1.5 py-0.5 rounded text-[9px] bg-black/50 border border-white/10 text-stone-500 hover:text-red-400 cursor-pointer"
                title="Unlock freeform width & height"
              >
                Unlock Freeform
              </button>
            )}
          </div>
        )}

        {(() => {
          const rawBottom = (currentStyle as any).bottom;
          const rawTop = currentStyle.top;
          const anchoredBottom =
            rawBottom !== undefined && rawBottom !== null && String(rawBottom).trim() !== '' &&
            (rawTop === undefined || rawTop === null || String(rawTop).trim() === '');
          return anchoredBottom ? (
            <p className="text-[9px] text-stone-500 leading-relaxed">
              Anchored to bottom — Height grows upward from the Bottom edge.
            </p>
          ) : null;
        })()}
        {isMedia && (
          <p className="text-[9px] text-stone-500 leading-relaxed">
            ✨ Media fills its box edge-to-edge. Corner radius rounds the photo directly.
          </p>
        )}
      </div>

      {/* 4. Scale (CapCut-style zoom/emphasis) & Rotation */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <p className="text-[9px] text-stone-500 leading-relaxed">
          Zoom on top of the base box above — 100% = box size. Box wrong? Fix Width/Height first.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            ⟳ Scale &amp; Rotation
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                handleApplyPreset({ scaleX: -scaleXVal, scale: undefined });
              }}
              className={`text-[9px] font-medium px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                signX < 0
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
              }`}
              title={signX < 0 ? 'Horizontal mirror active — click to unflip' : 'Flip horizontally (mirror left/right)'}
            >
              ↔ Flip H
            </button>
            <button
              type="button"
              onClick={() => {
                handleApplyPreset({ scaleY: -scaleYVal, scale: undefined });
              }}
              className={`text-[9px] font-medium px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                signY < 0
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                  : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
              }`}
              title={signY < 0 ? 'Vertical mirror active — click to unflip' : 'Flip vertically (mirror upside down)'}
            >
              ↕ Flip V
            </button>
            <button
              type="button"
              onClick={() => {
                if (!scaleLinked) {
                  // Re-link: collapse to X magnitude so nothing jumps.
                  handleApplyPreset({
                    scaleX: scaleXVal,
                    scaleY: signY * Math.abs(scaleXVal),
                    scale: undefined,
                  });
                }
                setScaleLinked(v => !v);
              }}
              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                scaleLinked
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-black/50 border-white/10 text-stone-500 hover:text-stone-300'
              }`}
              title={scaleLinked ? 'Uniform scale linked — X and Y move together (CapCut link ON)' : 'Uniform scale unlinked — X and Y move independently (CapCut link OFF)'}
            >
              {scaleLinked ? '🔗 Linked' : '⛓️‍💥 Split'}
            </button>
            {hasTransform && (
              <button
                type="button"
                onClick={() => {
                  const updated = { ...currentStyle };
                  delete updated.rotate;
                  delete updated.scale;
                  delete updated.scaleX;
                  delete updated.scaleY;
                  setScaleLinked(true);
                  onChange(updated);
                }}
                className="text-[9px] text-stone-500 hover:text-red-400 transition-colors uppercase font-semibold cursor-pointer ml-0.5"
                title="Remove static rotation and scale (back to 0° / 100%)"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        {transformNote && (
          <div className="p-2 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
            ℹ️ {transformNote}
          </div>
        )}

        {/* Scale Controls: 1 column if linked, 2 columns if split */}
        {scaleLinked ? (
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span className="flex items-center gap-1.5">
                Scale (Uniform)
                {(signX < 0 || signY < 0) && (
                  <span className="text-[8px] text-amber-300 font-semibold px-1 py-0.2 bg-amber-500/10 border border-amber-500/30 rounded">
                    {signX < 0 && signY < 0 ? 'Flipped H+V' : signX < 0 ? 'Flipped H' : 'Flipped V'}
                  </span>
                )}
              </span>
              <span className="text-amber-400 font-mono">{scaleXMag}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="500"
              step="5"
              value={Math.max(10, Math.min(500, scaleXMag))}
              onChange={e => {
                const pct = parseFloat(e.target.value) || 100;
                writeUniformScale(pct);
              }}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
              title="Uniform scale (100% = natural size). Composes with animation keyframes."
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                <span className="flex items-center gap-1">
                  Scale X
                  {signX < 0 && <span className="text-[8px] text-amber-300 font-semibold">(Flip)</span>}
                </span>
                <span className="text-amber-400 font-mono">{signX < 0 ? `-${scaleXMag}%` : `${scaleXMag}%`}</span>
              </div>
              <input
                type="range"
                min="10"
                max="500"
                step="5"
                value={Math.max(10, Math.min(500, scaleXMag))}
                onChange={e => {
                  const pct = parseFloat(e.target.value) || 100;
                  handleApplyPreset({ scaleX: (signX * pct) / 100, scale: undefined });
                }}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                title="Horizontal scale (100% = natural size). Composes with animation keyframes."
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                <span className="flex items-center gap-1">
                  Scale Y
                  {signY < 0 && <span className="text-[8px] text-amber-300 font-semibold">(Flip)</span>}
                </span>
                <span className="text-amber-400 font-mono">{signY < 0 ? `-${scaleYMag}%` : `${scaleYMag}%`}</span>
              </div>
              <input
                type="range"
                min="10"
                max="500"
                step="5"
                value={Math.max(10, Math.min(500, scaleYMag))}
                onChange={e => {
                  const pct = parseFloat(e.target.value) || 100;
                  handleApplyPreset({ scaleY: (signY * pct) / 100, scale: undefined });
                }}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                title="Vertical scale (100% = natural size). Composes with animation keyframes."
              />
            </div>
          </div>
        )}

        {/* Rotation Control: Dedicated full-width row */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Rotation</span>
            <div className="flex items-center gap-1.5">
              {rotateVal !== 0 && (
                <button
                  type="button"
                  onClick={() => handleUpdate('rotate', 0)}
                  className="text-[8px] text-stone-500 hover:text-amber-300 transition-colors uppercase font-semibold cursor-pointer"
                  title="Reset rotation to 0°"
                >
                  Reset 0°
                </button>
              )}
              <span className="text-amber-400 font-mono">{rotateVal}°</span>
            </div>
          </div>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={Math.max(-180, Math.min(180, rotateVal))}
            onChange={e => handleUpdate('rotate', parseFloat(e.target.value) || 0)}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            title="Static 2D rotation in degrees (pivot: Motion FX anchor when set, else center)"
          />
        </div>

        <p className="text-[9px] text-stone-500 leading-relaxed">
          Static transform on the layer container — composes with Animations keyframes. Pivot: Motion FX → Transform Origin when set, else center.
        </p>
      </div>

    </div>
  );
};

export const AstLayoutControls = memo(AstLayoutControlsInner);
AstLayoutControls.displayName = 'AstLayoutControls';
