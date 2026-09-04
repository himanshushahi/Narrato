import React, { memo } from 'react';
import { BsEyedropper, BsSliders } from 'react-icons/bs';

interface AstFilterControlsProps {
  filters?: string[];
  onChange: (filters: string[]) => void;
}

const BLEND_MODES: { value: string; label: string; group: string }[] = [
  { value: 'normal', label: 'Normal (Standard)', group: 'Standard' },
  { value: 'overlay', label: 'Overlay (High Contrast Film)', group: 'Contrast' },
  { value: 'screen', label: 'Screen (Luma Glow)', group: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge (Vibrant Glow)', group: 'Lighten' },
  { value: 'multiply', label: 'Multiply (Darken)', group: 'Darken' },
  { value: 'color-burn', label: 'Color Burn (Deep Shadows)', group: 'Darken' },
  { value: 'soft-light', label: 'Soft Light (Subtle Tint)', group: 'Contrast' },
  { value: 'hard-light', label: 'Hard Light (Dramatic)', group: 'Contrast' },
  { value: 'difference', label: 'Difference (Invert FX)', group: 'Inversion' },
  { value: 'luminosity', label: 'Luminosity (Luma Only)', group: 'Color' },
];

const FILTER_PRESETS: { label: string; icon: string; filters: string[] }[] = [
  {
    label: 'Cinematic Dark Base',
    icon: '🌑',
    filters: ['brightness(0.35)', 'contrast(1.2)'],
  },
  {
    label: 'Archival Monochrome',
    icon: '🎞️',
    filters: ['grayscale(0.85)', 'contrast(1.25)', 'brightness(0.8)'],
  },
  {
    label: 'Vintage Sepia',
    icon: '📜',
    filters: ['sepia(0.65)', 'contrast(1.15)', 'brightness(0.85)'],
  },
  {
    label: 'Vibrant Tech Glow',
    icon: '⚡',
    filters: ['contrast(1.3)', 'brightness(1.15)'],
  },
  {
    label: 'Ghostly Overlay',
    icon: '👻',
    filters: ['mix-blend-mode: overlay'],
  },
  // ── 2026 FX pack: CSS-grade cinematic looks ──────────────────────────
  {
    label: 'Neon Glow Pop',
    icon: '🌆',
    filters: ['drop-shadow(0 0 22px rgba(255,0,200,0.75))', 'saturate(1.5)', 'contrast(1.2)'],
  },
  {
    label: 'Cyberpunk',
    icon: '🤖',
    filters: ['hue-rotate(-35deg)', 'saturate(1.8)', 'contrast(1.25)'],
  },
  {
    label: 'Golden Hour',
    icon: '🌅',
    filters: ['sepia(0.45)', 'saturate(1.6)', 'brightness(1.05)', 'contrast(1.05)'],
  },
  {
    label: 'Bleach Bypass',
    icon: '🥋',
    filters: ['grayscale(0.4)', 'contrast(1.5)', 'brightness(1.05)'],
  },
  {
    label: 'Night Vision',
    icon: '🌙',
    filters: ['sepia(1)', 'hue-rotate(70deg)', 'saturate(3)', 'brightness(0.9)', 'contrast(1.2)'],
  },
  {
    label: 'Thermal False-Color',
    icon: '🌡️',
    filters: ['grayscale(1)', 'invert(1)', 'hue-rotate(190deg)', 'saturate(4)', 'contrast(1.2)'],
  },
  {
    label: 'Noir Hard',
    icon: '🎬',
    filters: ['grayscale(1)', 'contrast(1.8)', 'brightness(0.95)'],
  },
  {
    label: 'Dream Blur',
    icon: '☁️',
    filters: ['blur(1.5px)', 'brightness(1.15)', 'saturate(1.3)'],
  },
  // ── 2026 FX pack: SVG-filter looks (defs in FxFilterDefs) ────────────
  {
    label: 'Emboss Relief',
    icon: '🗿',
    filters: ['url(#fx-emboss)'],
  },
  {
    label: 'Sharpen Footage',
    icon: '🔍',
    filters: ['url(#fx-sharpen)'],
  },
  {
    label: 'Posterize Pop',
    icon: '🎨',
    filters: ['url(#fx-posterize)', 'saturate(1.4)'],
  },
  {
    label: 'Midnight Duotone',
    icon: '🌌',
    filters: ['url(#fx-duotone-midnight)'],
  },
  {
    label: 'Inferno Duotone',
    icon: '🔥',
    filters: ['url(#fx-duotone-inferno)'],
  },
  {
    label: 'Thermal X-Ray',
    icon: '📡',
    filters: ['url(#fx-thermal)'],
  },
];

const AstFilterControlsInner: React.FC<AstFilterControlsProps> = ({
  filters = [],
  onChange,
}) => {
  // Parse individual filter values from filters array
  const filterString = (filters || []).join(' ');

  const getFilterValue = (name: string, defaultVal: number): number => {
    const reg = new RegExp(`${name}\\(([\\d.]+)(?:%|px)?\\)`);
    const match = filterString.match(reg);
    if (match) {
      const val = parseFloat(match[1]);
      if (filterString.includes(`${name}(${match[1]}%)`)) {
        return val / 100;
      }
      return val;
    }
    return defaultVal;
  };

  const brightness = getFilterValue('brightness', 1.0);
  const contrast = getFilterValue('contrast', 1.0);
  const grayscale = getFilterValue('grayscale', 0.0);
  const sepia = getFilterValue('sepia', 0.0);

  // Parse mix-blend-mode
  const blendMatch = filterString.match(/mix-blend-mode:\s*([a-zA-Z-]+)/);
  const blendMode = blendMatch ? blendMatch[1] : 'normal';

  // FX tokens the sliders don't model (SVG url() looks, saturate,
  // hue-rotate, invert, blur, drop-shadow…) survive slider edits: the
  // sliders only own brightness/contrast/grayscale/sepia/blend, so carry
  // everything else through untouched.
  const SLIDER_OWNED = /^(brightness|contrast|grayscale|sepia)\([\d.]+(?:%|px)?\)$|^mix-blend-mode:/;
  const extraTokens = (filters || []).filter((f) => !SLIDER_OWNED.test(f.trim()));

  const updateFilters = (newVals: {
    brightness?: number;
    contrast?: number;
    grayscale?: number;
    sepia?: number;
    blendMode?: string;
  }) => {
    const b = newVals.brightness !== undefined ? newVals.brightness : brightness;
    const c = newVals.contrast !== undefined ? newVals.contrast : contrast;
    const g = newVals.grayscale !== undefined ? newVals.grayscale : grayscale;
    const s = newVals.sepia !== undefined ? newVals.sepia : sepia;
    const bm = newVals.blendMode !== undefined ? newVals.blendMode : blendMode;

    const list: string[] = [];
    if (b !== 1.0) list.push(`brightness(${b.toFixed(2)})`);
    if (c !== 1.0) list.push(`contrast(${c.toFixed(2)})`);
    if (g > 0) list.push(`grayscale(${g.toFixed(2)})`);
    if (s > 0) list.push(`sepia(${s.toFixed(2)})`);
    if (bm && bm !== 'normal') list.push(`mix-blend-mode: ${bm}`);
    // Re-attach untouched FX tokens (SVG url() looks, drop-shadows, etc.)
    // that the sliders don't model, so grading never wipes the FX pack.
    for (const t of extraTokens) {
      if (!list.includes(t)) list.push(t);
    }

    onChange(list);
  };

  return (
    <div className="space-y-3.5">
      {/* 1. Preset Buttons */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <BsEyedropper size={11} />
            Color Grading & Filter Presets
          </label>
          {filters.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[9px] text-stone-500 hover:text-red-400 transition-colors uppercase font-semibold cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_PRESETS.map((preset, pIdx) => (
            <button
              key={pIdx}
              type="button"
              onClick={() => onChange(preset.filters)}
              className="px-2.5 py-1.5 bg-black/40 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/40 text-[10px] font-bold rounded-lg text-stone-300 hover:text-amber-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{preset.icon}</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Visual Filter Sliders */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <BsSliders size={11} />
            Color Grading Sliders
          </span>
          <span className="text-[9px] text-stone-500 font-mono">Real-time Shaders</span>
        </div>

        {/* Brightness */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Brightness</span>
            <span className="text-amber-400 font-mono">{(brightness * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="2.0"
            step="0.05"
            value={brightness}
            onChange={e => updateFilters({ brightness: parseFloat(e.target.value) })}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
          />
        </div>

        {/* Contrast */}
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Contrast</span>
            <span className="text-amber-400 font-mono">{(contrast * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.2"
            step="0.05"
            value={contrast}
            onChange={e => updateFilters({ contrast: parseFloat(e.target.value) })}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
          />
        </div>

        {/* Grayscale & Sepia */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Grayscale</span>
              <span className="text-amber-400 font-mono">{(grayscale * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.05"
              value={grayscale}
              onChange={e => updateFilters({ grayscale: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Sepia</span>
              <span className="text-amber-400 font-mono">{(sepia * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1.0"
              step="0.05"
              value={sepia}
              onChange={e => updateFilters({ sepia: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
        </div>

        {/* Mix Blend Mode */}
        <div className="space-y-1 pt-2 border-t border-white/5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Mix Blend Mode</label>
          <select
            className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
            value={blendMode}
            onChange={e => updateFilters({ blendMode: e.target.value })}
          >
            {BLEND_MODES.map((bm, idx) => (
              <option key={idx} value={bm.value}>
                {bm.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export const AstFilterControls = memo(AstFilterControlsInner);
AstFilterControls.displayName = 'AstFilterControls';
