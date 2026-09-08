import React, { memo, useState, useEffect } from 'react';
import { BsLayoutSplit, BsSliders } from 'react-icons/bs';

interface AstLayoutControlsProps {
  style?: React.CSSProperties;
  onChange: (style: React.CSSProperties) => void;
  /** True for Image / Video layers — enables Shape helpers. Media always fills the box (cover). */
  isMedia?: boolean;
  /** Info note for Coordinates & Dimensions (resize crops rather than refits). */
  dimensionsNote?: string | null;
  /** Info note for the Transform section (rotation exposes canvas edges). */
  transformNote?: string | null;
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
      left: '8%',
      top: '60%',
      width: '84%',
      height: '22%',
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

const AstLayoutControlsInner: React.FC<AstLayoutControlsProps> = ({
  style = {},
  onChange,
  isMedia = false,
  dimensionsNote = null,
  transformNote = null,
}) => {
  const currentStyle = (style || {}) as Record<string, any>;

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
      height: `${Math.max(10, Math.min(100, autoHeightVal))}%`,
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
    // Unitless bare number: "24", "-10", etc.
    if (/^[-\d.]+$/.test(t)) {
      const num = parseFloat(t);
      if (!Number.isFinite(num) || num <= 0) {
        handleUpdate('borderRadius', undefined);
        setDraftRadius('');
        return;
      }
      const formatted = `${num}px`;
      handleUpdate('borderRadius', formatted);
      setDraftRadius(formatted);
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
      const num = parseFloat(t.slice(0, -2));
      if (!Number.isFinite(num) || num <= 0) {
        handleUpdate('borderRadius', undefined);
        setDraftRadius('');
        return;
      }
      const formatted = `${num}px`;
      handleUpdate('borderRadius', formatted);
      setDraftRadius(formatted);
      return;
    }
    // Fallback: any other valid CSS string
    handleUpdate('borderRadius', t);
    setDraftRadius(t);
  };

  // Parse static transform (Layout tab): rotate in degrees, scale as multiplier.
  // Accepts numbers (15, 1.2) or strings ('15deg', '120%') for AI-authored JSON.
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
    // slider below only produces 10–200%, Reset restores 100%.
    if (typeof val === 'number' && Number.isFinite(val) && val !== 0) return val;
    if (typeof val === 'string') {
      const t = val.trim();
      const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return 1;
  };
  const rotateVal = parseRotate(currentStyle.rotate);
  const scaleVal = parseScale(currentStyle.scale);
  const scalePct = Math.round(scaleVal * 100);
  const hasTransform = rotateVal !== 0 || scaleVal !== 1;

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
                    if (widthVal >= 95 && heightVal >= 95) {
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
          💡 Tip: On full-frame layers, corner rounding trims outer canvas corners. For visible cards, insets, or circular badges, select a Layout Preset above or resize Width &amp; Height.
        </p>
      </div>

      {/* 3. Position & Dimension Sliders */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <BsSliders size={11} />
            Coordinates & Dimensions
          </span>
          <span className="text-[9px] text-stone-500 font-mono">1920x1080 Grid</span>
        </div>
        {dimensionsNote && (
          <div className="p-2 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
            ℹ️ {dimensionsNote}
          </div>
        )}

        {/* Sliders: Left & Top/Bottom (anchor-aware: AI text layers use bottom) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Left (X)</span>
              <span className="text-amber-400 font-mono">{leftVal}%</span>
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
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                    <span>Bottom (Y)</span>
                    <span className="text-amber-400 font-mono">{bottomVal}%</span>
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
                <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                  <span>Top (Y)</span>
                  <span className="text-amber-400 font-mono">{topVal}%</span>
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

        {/* Sliders: Width & Height */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Width</span>
              <span className="text-amber-400 font-mono">{widthVal}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={widthVal}
              onChange={e => handleUpdate('width', `${e.target.value}%`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Height</span>
              <span className="text-amber-400 font-mono">
                {isHeightLocked ? `${autoHeightVal}% (Auto)` : `${heightVal}%`}
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={isHeightLocked ? Math.max(10, Math.min(100, autoHeightVal)) : heightVal}
              disabled={isHeightLocked}
              onChange={e => {
                handleApplyPreset({
                  height: `${e.target.value}%`,
                  aspectRatio: undefined,
                });
              }}
              className="w-full accent-amber-500 h-1.5 bg-black/60 rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title={isHeightLocked ? `Aspect ratio locked at ${currentStyle.aspectRatio} — Width drives both dimensions. Unlock for freeform height.` : undefined}
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
          </div>
        </div>

        {/* Quick Shape Presets — gated to Image/Video layers */}
        {isMedia && (
          <>
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
                title="Make width and height equal in pixels (perfect 1:1 square or circular avatar) — centers if fullscreen"
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
                title="Set 4:3 photo frame in pixels — centers if fullscreen"
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
                title="Set 16:9 widescreen frame in pixels — centers if fullscreen"
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
                  title="Unlock freeform width & height sliders"
                >
                  Unlock Freeform
                </button>
              )}
            </div>

            <p className="text-[9px] text-stone-500 leading-relaxed pt-2 border-t border-white/5">
              ✨ Media fills the Width × Height box edge-to-edge. Corner radius rounds the photo directly.
            </p>
          </>
        )}
      </div>

      {/* 4. Transform (Rotate & Scale) */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            ⟳ Transform (Rotate &amp; Scale)
          </span>
          {hasTransform && (
            <button
              type="button"
              onClick={() => {
                const updated = { ...currentStyle };
                delete updated.rotate;
                delete updated.scale;
                onChange(updated);
              }}
              className="text-[9px] text-stone-500 hover:text-red-400 transition-colors uppercase font-semibold cursor-pointer"
              title="Remove static rotation and scale (back to 0° / 100%)"
            >
              Reset
            </button>
          )}
        </div>
        {transformNote && (
          <div className="p-2 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
            ℹ️ {transformNote}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Rotation</span>
              <span className="text-amber-400 font-mono">{rotateVal}°</span>
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

          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Scale</span>
              <span className="text-amber-400 font-mono">{scalePct}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="200"
              step="5"
              value={Math.max(10, Math.min(200, scalePct))}
              onChange={e => handleUpdate('scale', (parseFloat(e.target.value) || 100) / 100)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
              title="Static uniform scale (100% = natural size). Composes with animation keyframes."
            />
            {scaleVal < 0 && (
              <p className="text-[9px] text-amber-300/90 leading-relaxed">
                Mirrored (negative scale from JSON) — move the slider or Reset to restore.
              </p>
            )}
          </div>
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
