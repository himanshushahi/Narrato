import React, { memo, useState, useEffect } from 'react';
import { BsLayoutSplit, BsSliders } from 'react-icons/bs';

interface AstLayoutControlsProps {
  style?: React.CSSProperties;
  onChange: (style: React.CSSProperties) => void;
  /** True for Image / Video layers — enables Media Fit Mode (Cover/Contain) and Shape helpers. */
  isMedia?: boolean;
  /** When set, the card-surface section + glass presets are disabled (values preserved). */
  surfaceDisabledReason?: string | null;
  /** Info banner shown above the card-surface section without disabling (limited tier). */
  surfaceNote?: string | null;
  /** Info note for Coordinates & Dimensions (resize crops rather than refits). */
  dimensionsNote?: string | null;
  /** True when stale card-surface keys exist while disabled — shows a clear action. */
  hasStaleCardStyle?: boolean;
  /** Removes leftover card-surface keys (called from the disabled-section banner). */
  onClearCardStyle?: () => void;
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
      backdropFilter: undefined,
      backgroundColor: 'transparent',
      boxShadow: undefined,
      border: undefined,
    },
  },
  {
    label: 'Center Glass Card',
    icon: '🪟',
    style: {
      position: 'absolute',
      left: '15%',
      top: '16%',
      width: '70%',
      height: '66%',
      borderRadius: '20px',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6)',
      padding: '24px',
      boxSizing: 'border-box',
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
      borderRadius: '20px',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 14px 36px rgba(0, 0, 0, 0.55)',
      padding: '20px',
      boxSizing: 'border-box',
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
      borderRadius: '20px',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 14px 36px rgba(0, 0, 0, 0.55)',
      padding: '20px',
      boxSizing: 'border-box',
    },
  },
  {
    label: 'Lower Third Callout',
    icon: '📋',
    style: {
      position: 'absolute',
      left: '8%',
      top: '60%',
      width: '84%',
      height: '22%',
      borderRadius: '16px',
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(250, 204, 21, 0.3)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
      padding: '16px',
      boxSizing: 'border-box',
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
      borderRadius: '16px',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      padding: '14px',
      boxSizing: 'border-box',
    },
  },
];

const BG_PRESETS = [
  { label: 'Dark Glass (85%)', value: 'rgba(15, 23, 42, 0.85)' },
  { label: 'Deep Onyx (95%)', value: 'rgba(9, 9, 11, 0.95)' },
  { label: 'Amber Tint (80%)', value: 'rgba(30, 20, 10, 0.85)' },
  { label: 'Slate Frost (70%)', value: 'rgba(30, 41, 59, 0.70)' },
  { label: 'Transparent', value: 'transparent' },
];

const SHADOW_PRESETS = [  { label: 'None', value: 'none' },
  { label: 'Cinematic Drop', value: '0 16px 40px rgba(0, 0, 0, 0.6)' },
  { label: 'Soft Shadow', value: '0 10px 30px rgba(0, 0, 0, 0.4)' },
  { label: 'Neon Cyan Glow', value: '0 0 35px rgba(6, 182, 212, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
  { label: 'Amber Gold Glow', value: '0 0 35px rgba(245, 158, 11, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
  { label: 'Crimson Alert', value: '0 0 35px rgba(239, 68, 68, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
];

const RADIUS_PRESETS: { label: string; value: string; displaySuffix?: string }[] = [
  { label: 'Sharp', value: '0px' },
  { label: 'Subtle', value: '16px', displaySuffix: '16px' },
  { label: 'Smooth', value: '32px', displaySuffix: '32px' },
  { label: 'Round', value: '64px', displaySuffix: '64px' },
  { label: 'Pill', value: '9999px' },
  { label: 'Circle', value: '50%' },
];

/** Derive a native-picker-safe #rrggbb swatch from any CSS color string. */
const cssToSwatchHex = (val: any): string => {
  if (typeof val === 'string') {
    const v = val.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    const short = v.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const rgb = v.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgb) {
      const toHex = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
      return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
    }
  }
  return '#0f172a';
};

/** True only when the value is a plain opaque color the native picker can
 * round-trip without data loss. Gradients, `transparent`, named colors and
 * rgba() with alpha would otherwise be silently overwritten with a solid. */
const isPickerSafeSolid = (val: any): boolean => {
  if (typeof val !== 'string') return false;
  const v = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) return true;
  const m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    // rgb() or rgba() with alpha === 1 converts losslessly; anything with
    // translucency would lose its alpha in the #rrggbb picker.
    if (m[4] === undefined) return true;
    const a = parseFloat(m[4]);
    return a === 1;
  }
  return false;
};

const AstLayoutControlsInner: React.FC<AstLayoutControlsProps> = ({
  style = {},
  onChange,
  isMedia = false,
  surfaceDisabledReason = null,
  surfaceNote = null,
  dimensionsNote = null,
  hasStaleCardStyle = false,
  onClearCardStyle,
  transformNote = null,
}) => {
  const currentStyle = (style || {}) as Record<string, any>;

  const handleUpdate = (field: string, val: any) => {
    const updated = { ...currentStyle };
    if (val === undefined || val === '') {
      delete updated[field];
      if (field === 'backgroundColor' || field === 'background') {
        delete updated.backgroundColor;
        delete updated.background;
      }
    } else if (field === 'backgroundColor' || field === 'background') {
      // Route complex paint (gradient / image) to `background` and plain
      // colors to `backgroundColor` so pasting a gradient can't be stored as
      // an invalid backgroundColor while deleting the valid background.
      const s = String(val);
      if (/gradient\s*\(/i.test(s) || /url\s*\(/i.test(s)) {
        updated.background = val;
        delete updated.backgroundColor;
      } else {
        updated[field] = val;
        if (field === 'backgroundColor') delete updated.background;
        else delete updated.backgroundColor;
      }
    } else {
      updated[field] = val;
    }
    onChange(updated);
  };

  const handleApplyPreset = (presetStyle: Record<string, any>) => {
    // Keep background/backgroundColor mutually exclusive (same rule as
    // handleUpdate) so a preset can't leave both keys set with a stale
    // gradient winning over the preset's solid.
    const merged = { ...currentStyle, ...presetStyle };
    for (const [k, v] of Object.entries(presetStyle)) {
      if (v === undefined) {
        delete (merged as any)[k];
      }
    }
    if ('backgroundColor' in presetStyle) delete merged.background;
    if ('background' in presetStyle) delete merged.backgroundColor;
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

  // Extract blur value from backdropFilter (e.g. "blur(20px)" -> 20)
  const blurMatch = (currentStyle.backdropFilter || currentStyle.WebkitBackdropFilter || '').match(/blur\((\d+)px\)/);
  const blurVal = blurMatch ? parseInt(blurMatch[1], 10) : 0;

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
          objectFit: currentStyle.objectFit || 'cover',
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

  // Parse border: "1px solid rgba(...)"
  const borderMatch = (currentStyle.border || '').match(/(\d+)px\s+([a-zA-Z]+)\s+(.+)/);
  const borderWidth = borderMatch ? parseInt(borderMatch[1], 10) : (currentStyle.border ? 1 : 0);
  const borderStyle = borderMatch ? borderMatch[2] : (currentStyle.border ? 'solid' : 'solid');
  const borderColor = borderMatch ? borderMatch[3] : 'rgba(255, 255, 255, 0.15)';

  const updateBorder = (w: number, s: string, c: string) => {
    if (w === 0 || s === 'none') {
      handleUpdate('border', undefined);
    } else {
      handleUpdate('border', `${w}px ${s} ${c}`);
    }
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
          Position & Card Layout Presets
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {LAYOUT_PRESETS.map((preset) => {
            const isFullscreen = preset.label === 'Fullscreen';
            const presetDisabled = !!surfaceDisabledReason && !isFullscreen;
            const btn = (
            <button
              type="button"
              disabled={presetDisabled}
              onClick={() => handleApplyPreset(preset.style)}
              className={`w-full px-2.5 py-1.5 bg-black/40 border text-[10px] font-bold rounded-lg flex items-center gap-2 text-left truncate transition-colors ${presetDisabled ? 'opacity-40 border-white/5 text-stone-500 pointer-events-none' : 'hover:bg-amber-500/15 border-white/10 hover:border-amber-500/40 text-stone-300 hover:text-amber-300 cursor-pointer'}`}
            >
              <span>{preset.icon}</span>
              <span className="truncate">{preset.label}</span>
            </button>
            );
            // Wrapper owns the tooltip: native `title` on a `disabled` button
            // never fires in Chromium (disabled controls swallow mouse events).
            return (
              <div
                key={preset.label}
                className={presetDisabled ? 'cursor-not-allowed' : undefined}
                title={presetDisabled ? surfaceDisabledReason ?? undefined : preset.label}
              >
                {btn}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Position & Dimension Sliders */}
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

        {/* Sliders: Left & Top */}
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
              onChange={e => handleUpdate('left', `${e.target.value}%`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

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
              onChange={e => handleUpdate('top', `${e.target.value}%`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
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
                {currentStyle.aspectRatio ? `${currentStyle.aspectRatio} (Auto)` : `${heightVal}%`}
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={heightVal}
              onChange={e => {
                handleApplyPreset({
                  height: `${e.target.value}%`,
                  aspectRatio: undefined,
                });
              }}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
              title={currentStyle.aspectRatio ? `Aspect ratio locked at ${currentStyle.aspectRatio} — drag to unlock custom height` : undefined}
            />
          </div>
        </div>

        {/* Quick Shape Presets & Media Fit Mode — gated to Image/Video layers */}
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

            <div className="space-y-1.5 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                <span>Media Fit Mode (Image / Video Scaling)</span>
                <span className="text-amber-400 font-mono">{currentStyle.objectFit || 'cover'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleUpdate('objectFit', 'cover')}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    (currentStyle.objectFit || 'cover') === 'cover'
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                      : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
                  }`}
                  title="Fills the entire card shape from edge to edge — rounded corners shape the image directly without empty letterboxing"
                >
                  <span>🖼️</span>
                  <span>Cover (Fill Card)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdate('objectFit', 'contain')}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    currentStyle.objectFit === 'contain'
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                      : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
                  }`}
                  title="Scales image to fit completely inside the card without cropping (leaves empty space if card aspect ratio differs)"
                >
                  <span>📐</span>
                  <span>Contain (Full Image)</span>
                </button>
              </div>
              <p className="text-[9px] text-stone-500 leading-relaxed">
                {(currentStyle.objectFit || 'cover') === 'cover'
                  ? '✨ Cover: The image fills the entire card edge-to-edge. Corner radius directly rounds the photo!'
                  : 'ℹ️ Contain: Fits the full photo without cropping. If the card has a different shape (e.g. tall rectangle), the photo sits in the center with letterboxing. Switch to Cover or adjust Width & Height to round the photo itself.'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* 3. Transform (Rotate & Scale) */}
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

      {/* 4. Card Surface & Glassmorphism */}
      {surfaceDisabledReason ? (
        <div
          className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] leading-relaxed text-amber-200/90 space-y-1.5"
          title={surfaceDisabledReason}
        >
          <div>⚠️ {surfaceDisabledReason}</div>
          {hasStaleCardStyle && onClearCardStyle && (
            <button
              type="button"
              onClick={onClearCardStyle}
              className="text-[10px] font-bold underline text-amber-300 hover:text-amber-100 cursor-pointer"
            >
              Remove leftover card background &amp; borders
            </button>
          )}
        </div>
      ) : surfaceNote ? (
        <div className="p-2.5 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
          ℹ️ {surfaceNote}
        </div>
      ) : null}
      <fieldset
        disabled={!!surfaceDisabledReason}
        title={surfaceDisabledReason ?? undefined}
        className={`p-3 bg-black/40 border border-white/10 rounded-xl space-y-3 ${surfaceDisabledReason ? 'opacity-50' : ''}`}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
          Card Surface & Glassmorphism
        </div>

        {/* Background Presets */}
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Background Style</label>
          <div className="flex flex-wrap gap-1">
            {BG_PRESETS.map((bg, bIdx) => (
              <button
                key={bIdx}
                type="button"
                onClick={() => handleUpdate('backgroundColor', bg.value)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium border transition-colors cursor-pointer ${
                  currentStyle.backgroundColor === bg.value
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                    : 'bg-black/50 border-white/10 text-stone-400 hover:text-stone-200'
                }`}
              >
                {bg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Background Custom Input + Color Pick */}
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Custom Background CSS</label>
          <div className="flex items-center gap-1.5 bg-black/60 border border-white/10 rounded px-2 py-1 focus-within:border-amber-500/50">
            {(() => {
              const rawBg = currentStyle.backgroundColor || currentStyle.background || '';
              const pickerSafe = isPickerSafeSolid(rawBg);
              return (
                <input
                  type="color"
                  value={pickerSafe ? cssToSwatchHex(rawBg) : '#0f172a'}
                  onChange={e => handleUpdate('backgroundColor', e.target.value)}
                  disabled={!pickerSafe && rawBg !== ''}
                  className={`w-4 h-4 rounded bg-transparent border-0 p-0 shrink-0 ${pickerSafe || rawBg === '' ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                  title={pickerSafe || rawBg === '' ? 'Pick background color' : 'Color picker disabled for gradients / transparent / named colors — edit the CSS text instead'}
                />
              );
            })()}
            <input
              type="text"
              className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
              value={currentStyle.backgroundColor || currentStyle.background || ''}
              onChange={e => handleUpdate('backgroundColor', e.target.value)}
              placeholder="rgba(15, 23, 42, 0.85)"
            />
          </div>
        </div>

        {/* Glass Blur Slider */}
        <div className="space-y-1 pt-1">
          <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Glass Blur (Backdrop)</span>
            <span className="text-amber-400 font-mono">{blurVal}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="2"
            value={blurVal}
            onChange={e => {
              const b = parseInt(e.target.value, 10);
              handleUpdate('backdropFilter', b > 0 ? `blur(${b}px)` : undefined);
            }}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
          />
        </div>

        {/* Corner Radius Controls */}
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Corner Radius / Rounding</span>
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
                        objectFit: currentStyle.objectFit || 'cover',
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
                      objectFit: currentStyle.objectFit || 'cover',
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
                    objectFit: currentStyle.objectFit || 'cover',
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

        {/* Border Controls */}
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Card Border</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <label className="text-[9px] text-stone-500 uppercase font-semibold block">Width</label>
              <select
                className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2 py-1 focus:outline-none cursor-pointer"
                value={borderWidth}
                onChange={e => updateBorder(parseInt(e.target.value, 10), borderStyle, borderColor)}
              >
                <option value={0}>None (0px)</option>
                <option value={1}>1px</option>
                <option value={2}>2px</option>
                <option value={3}>3px</option>
                <option value={4}>4px</option>
              </select>
            </div>

            <div className="space-y-0.5">
              <label className="text-[9px] text-stone-500 uppercase font-semibold block">Style</label>
              <select
                className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2 py-1 focus:outline-none cursor-pointer"
                value={borderStyle}
                onChange={e => updateBorder(borderWidth > 0 ? borderWidth : 1, e.target.value, borderColor)}
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>

            <div className="space-y-0.5">
              <label className="text-[9px] text-stone-500 uppercase font-semibold block">Color</label>
              <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5">
                <input
                  type="color"
                  value={borderColor.startsWith('#') && borderColor.length === 7 ? borderColor : '#ffffff'}
                  onChange={e => updateBorder(borderWidth > 0 ? borderWidth : 1, borderStyle, e.target.value)}
                  className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                />
                <input
                  type="text"
                  value={borderColor}
                  onChange={e => updateBorder(borderWidth > 0 ? borderWidth : 1, borderStyle, e.target.value)}
                  className="w-full bg-transparent text-[10px] text-stone-200 font-mono focus:outline-none truncate"
                  placeholder="#fff"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Box Shadow & Glow Presets */}
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between">
            <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Shadow & Bloom Presets</label>
          </div>
          <select
            className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
            value={currentStyle.boxShadow || 'none'}
            onChange={e => handleUpdate('boxShadow', e.target.value === 'none' ? undefined : e.target.value)}
          >
            {SHADOW_PRESETS.map((sh, sIdx) => (
              <option key={sIdx} value={sh.value}>
                {sh.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
    </div>
  );
};

export const AstLayoutControls = memo(AstLayoutControlsInner);
AstLayoutControls.displayName = 'AstLayoutControls';
