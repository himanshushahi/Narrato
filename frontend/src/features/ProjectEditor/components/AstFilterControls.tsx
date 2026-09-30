import React, { memo, useState } from 'react';
import {
  Pipette,
  Sliders,
  RotateCcw,
  Info,
  AlertTriangle,
  Check,
  Moon,
  Film,
  Scroll,
  Zap,
  Ghost,
  CloudFog,
  Layers,
  Sparkles,
  Cpu,
  Sun,
  Contrast,
  Eye,
  Thermometer,
  Clapperboard,
  Cloud,
  Mountain,
  Focus,
  Palette,
  Eclipse,
  Flame,
  Radio,
} from 'lucide-react';
import { isSvgLookToken } from './layerCapabilities';

interface AstFilterControlsProps {
  filters?: string[];
  onChange: (filters: string[]) => void;
  /** Contextual hint for the current layer type (e.g. Particles + SVG looks). */
  typeHint?: string | null;
  /** Layer type label shown in the hint, e.g. "Particles". */
  layerTypeLabel?: string | null;
  /** When true, SVG url(#fx-*) look presets are disabled (transparent canvas). */
  disableSvgLooks?: boolean;
  /** Tooltip for the disabled SVG presets. */
  svgDisabledReason?: string | null;
  /** True when an SVG look is active while disabled — shows a remove action. */
  hasStaleSvgLooks?: boolean;
  /** Removes active SVG url(#fx-*) tokens (called from the stale banner). */
  onClearSvgLooks?: () => void;
  /** Blend-mode caption. Pass null to hide (multi-layer stacks where blend works). */
  blendHint?: string | null;
}

/** True for SVG-filter looks (emboss / sharpen / posterize / duotones / thermal). */
const isSvgLook = (filters: string[]): boolean =>
  filters.some((f) => isSvgLookToken(f));

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

export type FilterCategory = 'all' | 'cinematic' | 'creative' | 'svg';

interface FilterPresetDef {
  label: string;
  category: 'cinematic' | 'creative' | 'svg';
  icon: React.ComponentType<{ className?: string }>;
  filters: string[];
}

const FILTER_PRESETS: FilterPresetDef[] = [
  {
    label: 'Cinematic Dark Base',
    category: 'cinematic',
    icon: Moon,
    filters: ['brightness(0.35)', 'contrast(1.2)'],
  },
  {
    label: 'Archival Monochrome',
    category: 'cinematic',
    icon: Film,
    filters: ['grayscale(0.85)', 'contrast(1.25)', 'brightness(0.8)'],
  },
  {
    label: 'Vintage Sepia',
    category: 'cinematic',
    icon: Scroll,
    filters: ['sepia(0.65)', 'contrast(1.15)', 'brightness(0.85)'],
  },
  {
    label: 'Vibrant Tech Glow',
    category: 'cinematic',
    icon: Zap,
    filters: ['contrast(1.3)', 'brightness(1.15)'],
  },
  {
    label: 'Ghostly Overlay',
    category: 'cinematic',
    icon: Ghost,
    filters: ['mix-blend-mode: overlay'],
  },
  {
    label: 'Cinematic B-Roll Blur',
    category: 'cinematic',
    icon: CloudFog,
    filters: ['blur(12px)', 'brightness(0.75)', 'contrast(1.1)'],
  },
  {
    label: 'Frosted Glass Surface',
    category: 'cinematic',
    icon: Layers,
    filters: ['backdrop-filter: blur(16px)', 'contrast(1.05)'],
  },
  // ── 2026 FX pack: CSS-grade cinematic looks ──────────────────────────
  {
    label: 'Neon Glow Pop',
    category: 'creative',
    icon: Sparkles,
    filters: ['drop-shadow(0 0 22px rgba(255,0,200,0.75))', 'saturate(1.5)', 'contrast(1.2)'],
  },
  {
    label: 'Cyberpunk',
    category: 'creative',
    icon: Cpu,
    filters: ['hue-rotate(-35deg)', 'saturate(1.8)', 'contrast(1.25)'],
  },
  {
    label: 'Golden Hour',
    category: 'creative',
    icon: Sun,
    filters: ['sepia(0.45)', 'saturate(1.6)', 'brightness(1.05)', 'contrast(1.05)'],
  },
  {
    label: 'Bleach Bypass',
    category: 'creative',
    icon: Contrast,
    filters: ['grayscale(0.4)', 'contrast(1.5)', 'brightness(1.05)'],
  },
  {
    label: 'Night Vision',
    category: 'creative',
    icon: Eye,
    filters: ['sepia(1)', 'hue-rotate(70deg)', 'saturate(3)', 'brightness(0.9)', 'contrast(1.2)'],
  },
  {
    label: 'Thermal False-Color',
    category: 'creative',
    icon: Thermometer,
    filters: ['grayscale(1)', 'invert(1)', 'hue-rotate(190deg)', 'saturate(4)', 'contrast(1.2)'],
  },
  {
    label: 'Noir Hard',
    category: 'creative',
    icon: Clapperboard,
    filters: ['grayscale(1)', 'contrast(1.8)', 'brightness(0.95)'],
  },
  {
    label: 'Dream Blur',
    category: 'creative',
    icon: Cloud,
    filters: ['blur(1.5px)', 'brightness(1.15)', 'saturate(1.3)'],
  },
  // ── 2026 FX pack: SVG-filter looks (defs in FxFilterDefs) ────────────
  {
    label: 'Emboss Relief',
    category: 'svg',
    icon: Mountain,
    filters: ['url(#fx-emboss)'],
  },
  {
    label: 'Sharpen Footage',
    category: 'svg',
    icon: Focus,
    filters: ['url(#fx-sharpen)'],
  },
  {
    label: 'Posterize Pop',
    category: 'svg',
    icon: Palette,
    filters: ['url(#fx-posterize)', 'saturate(1.4)'],
  },
  {
    label: 'Midnight Duotone',
    category: 'svg',
    icon: Eclipse,
    filters: ['url(#fx-duotone-midnight)'],
  },
  {
    label: 'Inferno Duotone',
    category: 'svg',
    icon: Flame,
    filters: ['url(#fx-duotone-inferno)'],
  },
  {
    label: 'Thermal X-Ray',
    category: 'svg',
    icon: Radio,
    filters: ['url(#fx-thermal)'],
  },
];

const AstFilterControlsInner: React.FC<AstFilterControlsProps> = ({
  filters = [],
  onChange,
  typeHint = null,
  layerTypeLabel = null,
  disableSvgLooks = false,
  svgDisabledReason = null,
  hasStaleSvgLooks = false,
  onClearSvgLooks,
  blendHint = 'Blend needs a layer beneath to show — no visible change on a single opaque fullscreen layer.',
}) => {
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all');

  const isPresetActive = (presetFilters: string[]) => {
    if (!filters || filters.length === 0 || filters.length !== presetFilters.length) return false;
    return presetFilters.every(pf => filters.some(f => f.trim() === pf.trim()));
  };

  const filteredPresets = FILTER_PRESETS.filter(p => activeCategory === 'all' || p.category === activeCategory);

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

  // Parse Gaussian blur (blur(Npx)) — strip backdrop-filter tokens first:
  // `backdrop-filter: blur(16px)` contains a blur() substring but must NOT
  // drive the Layer Blur slider (that double-counts frosted glass as content
  // blur and writes back a duplicate blur() on the next slider edit).
  const filterStringNoBackdrop = filterString.replace(/(?:-webkit-)?backdrop-filter:\s*[^;]+;?/gi, ' ');
  const blurMatch = filterStringNoBackdrop.match(/blur\(\s*([\d.]+)\s*px\s*\)/i);
  const blur = blurMatch ? parseFloat(blurMatch[1]) : 0;

  // Parse Backdrop blur per-token (not on the joined string: the join of
  // `['backdrop-filter: blur(16px)', 'contrast(1.05)']` has trailing tokens
  // after the backdrop, so a $-anchored match on filterString would miss it).
  // Only a pure `blur(Npx)` backdrop is slider-owned; compound values
  // (`blur(16px) brightness(1.2)`) stay in extraTokens so slider edits never
  // drop the unmodeled functions.
  const backdropToken = (filters || []).find((f) =>
    /^(-webkit-)?backdrop-filter:\s*blur\(\s*[\d.]+\s*px\s*\)\s*;?\s*$/i.test(f.trim())
  );
  const backdropNumMatch = backdropToken
    ? backdropToken.match(/blur\(\s*([\d.]+)\s*px\s*\)/i)
    : null;
  const backdropBlur = backdropNumMatch ? parseFloat(backdropNumMatch[1]) : 0;

  // Parse mix-blend-mode
  const blendMatch = filterString.match(/mix-blend-mode:\s*([a-zA-Z-]+)/);
  const blendMode = blendMatch ? blendMatch[1] : 'normal';

  // FX tokens the sliders don't model (SVG url() looks, saturate,
  // hue-rotate, invert, drop-shadow…) survive slider edits: the
  // sliders own brightness/contrast/grayscale/sepia/blur/backdrop-filter/blend, so carry
  // everything else through untouched.
  // Anchored per-token on purpose:
  // - blur() requires px (CSS blur rejects %/unitless) so an invalid
  //   `blur(50%)` stays in extraTokens instead of being swallowed and
  //   silently dropped by updateFilters;
  // - backdrop-filter matches ONLY a pure `blur(Npx)` value so compound
  //   backdrops (`blur(16px) brightness(1.2)`) survive slider edits intact.
  const SLIDER_OWNED = /^(brightness|contrast|grayscale|sepia)\(\s*[\d.]+\s*(?:%|px)?\s*\)\s*;?$|^blur\(\s*[\d.]+\s*px\s*\)\s*;?$|^mix-blend-mode:\s*[a-zA-Z-]+\s*;?$|^(-webkit-)?backdrop-filter:\s*blur\(\s*[\d.]+\s*px\s*\)\s*;?\s*$/i;
  const extraTokens = (filters || []).filter((f) => !SLIDER_OWNED.test(f.trim()));

  const updateFilters = (newVals: {
    brightness?: number;
    contrast?: number;
    grayscale?: number;
    sepia?: number;
    blur?: number;
    backdropBlur?: number;
    blendMode?: string;
  }) => {
    const b = newVals.brightness !== undefined ? newVals.brightness : brightness;
    const c = newVals.contrast !== undefined ? newVals.contrast : contrast;
    const g = newVals.grayscale !== undefined ? newVals.grayscale : grayscale;
    const s = newVals.sepia !== undefined ? newVals.sepia : sepia;
    const bl = newVals.blur !== undefined ? newVals.blur : blur;
    const bb = newVals.backdropBlur !== undefined ? newVals.backdropBlur : backdropBlur;
    const bm = newVals.blendMode !== undefined ? newVals.blendMode : blendMode;

    const list: string[] = [];
    if (b !== 1.0) list.push(`brightness(${b.toFixed(2)})`);
    if (c !== 1.0) list.push(`contrast(${c.toFixed(2)})`);
    if (g > 0) list.push(`grayscale(${g.toFixed(2)})`);
    if (s > 0) list.push(`sepia(${s.toFixed(2)})`);
    if (bl > 0) list.push(`blur(${bl % 1 === 0 ? bl.toFixed(0) : bl.toFixed(1)}px)`);
    if (bb > 0) list.push(`backdrop-filter: blur(${bb % 1 === 0 ? bb.toFixed(0) : bb.toFixed(1)}px)`);
    if (bm && bm !== 'normal') list.push(`mix-blend-mode: ${bm}`);
    // Re-attach untouched FX tokens (SVG url() looks, drop-shadows, etc.)
    // that the sliders don't model, so grading never wipes the FX pack.
    // When the user sets a pure backdrop value, drop any compound
    // backdrop-filter token carried in extras — two backdrop-filter
    // declarations would stack confusingly (last-wins) instead of replacing.
    const isBackdropToken = (t: string) => /(?:-webkit-)?backdrop-filter:/i.test(t);
    for (const t of extraTokens) {
      if (bb > 0 && isBackdropToken(t)) continue;
      if (!list.includes(t)) list.push(t);
    }

    onChange(list);
  };

  return (
    <div className="space-y-3.5">
      {typeHint && (
        <div className="p-2.5 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>{layerTypeLabel ? <span className="font-bold">[{layerTypeLabel}] </span> : null}{typeHint}</span>
        </div>
      )}
      {disableSvgLooks && hasStaleSvgLooks && onClearSvgLooks && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] leading-relaxed text-amber-200/90 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>This layer has an active SVG look that renders empty on a transparent canvas.</span>
          </div>
          <button
            type="button"
            onClick={onClearSvgLooks}
            className="text-[10px] font-bold underline text-amber-300 hover:text-amber-100 cursor-pointer ml-5"
          >
            Remove SVG look filters
          </button>
        </div>
      )}
      {/* 1. Preset Buttons */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Pipette className="w-3 h-3 text-amber-400" />
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

        {/* Category Pills */}
        <div className="flex items-center gap-1 border-b border-white/5 pb-2">
          {(
            [
              { id: 'all', label: 'All', count: FILTER_PRESETS.length },
              { id: 'cinematic', label: 'Cinematic', count: FILTER_PRESETS.filter(p => p.category === 'cinematic').length },
              { id: 'creative', label: 'Creative FX', count: FILTER_PRESETS.filter(p => p.category === 'creative').length },
              { id: 'svg', label: 'SVG Shaders', count: FILTER_PRESETS.filter(p => p.category === 'svg').length },
            ] as const
          ).map(cat => {
            const isCatActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  isCatActive
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'bg-white/5 text-stone-400 hover:text-stone-200 hover:bg-white/10'
                }`}
              >
                <span>{cat.label}</span>
                <span className={`text-[8px] font-mono opacity-80 ${isCatActive ? 'text-black font-bold' : 'text-stone-500'}`}>
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Presets Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {filteredPresets.map((preset, pIdx) => {
            const svg = isSvgLook(preset.filters);
            const disabled = disableSvgLooks && svg;
            const Icon = preset.icon;
            const isActive = isPresetActive(preset.filters);
            return (
              <div
                key={pIdx}
                className={disabled ? 'cursor-not-allowed opacity-40' : undefined}
                title={
                  disabled
                    ? svgDisabledReason ?? 'SVG looks need opaque pixels — disabled for this transparent layer'
                    : `${preset.label}${isActive ? ' (Active - click to remove)' : ''}`
                }
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={isActive}
                  onClick={() => {
                    if (isActive) {
                      onChange([]);
                    } else {
                      onChange(preset.filters);
                    }
                  }}
                  className={`w-full h-8 px-2 py-1 border text-[10px] font-medium rounded-lg flex items-center justify-between gap-1.5 transition-all text-left ${
                    disabled
                      ? 'pointer-events-none border-white/5 bg-black/20 text-stone-500'
                      : isActive
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 ring-1 ring-amber-500/30 font-semibold'
                      : 'bg-black/40 border-white/10 hover:bg-amber-500/10 hover:border-amber-500/40 text-stone-300 hover:text-stone-100 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-400' : 'text-stone-400'}`} />
                    <span className="truncate">{preset.label}</span>
                  </div>
                  {isActive && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Visual Filter Sliders */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Sliders className="w-3 h-3 text-amber-400" />
            Color Grading Sliders
          </span>
          <span className="text-[9px] text-stone-500 font-mono">Real-time Shaders</span>
        </div>

        {/* Brightness */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Brightness</span>
            <div className="flex items-center gap-1.5">
              {brightness !== 1.0 && (
                <button
                  type="button"
                  onClick={() => updateFilters({ brightness: 1.0 })}
                  className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                  title="Reset brightness to 100%"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
              <span className="text-amber-400 font-mono">{(brightness * 100).toFixed(0)}%</span>
            </div>
          </div>
          <input
            type="range"
            aria-label="Brightness"
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
          <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
            <span>Contrast</span>
            <div className="flex items-center gap-1.5">
              {contrast !== 1.0 && (
                <button
                  type="button"
                  onClick={() => updateFilters({ contrast: 1.0 })}
                  className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                  title="Reset contrast to 100%"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
              <span className="text-amber-400 font-mono">{(contrast * 100).toFixed(0)}%</span>
            </div>
          </div>
          <input
            type="range"
            aria-label="Contrast"
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
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Grayscale</span>
              <div className="flex items-center gap-1.5">
                {grayscale !== 0.0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ grayscale: 0.0 })}
                    className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                    title="Reset grayscale to 0%"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
                <span className="text-amber-400 font-mono">{(grayscale * 100).toFixed(0)}%</span>
              </div>
            </div>
            <input
              type="range"
              aria-label="Grayscale"
              min="0"
              max="1.0"
              step="0.05"
              value={grayscale}
              onChange={e => updateFilters({ grayscale: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Sepia</span>
              <div className="flex items-center gap-1.5">
                {sepia !== 0.0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ sepia: 0.0 })}
                    className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                    title="Reset sepia to 0%"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
                <span className="text-amber-400 font-mono">{(sepia * 100).toFixed(0)}%</span>
              </div>
            </div>
            <input
              type="range"
              aria-label="Sepia"
              min="0"
              max="1.0"
              step="0.05"
              value={sepia}
              onChange={e => updateFilters({ sepia: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
        </div>

        {/* Layer Content Blur & Backdrop Blur */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span title="Applies Gaussian blur to this layer's content (0-50px)">Layer Blur</span>
              <div className="flex items-center gap-1.5">
                {blur !== 0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ blur: 0 })}
                    className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                    title="Reset blur to 0px"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
                <span className="text-amber-400 font-mono">{Number.isInteger(blur) ? `${blur}px` : `${blur.toFixed(1)}px`}</span>
              </div>
            </div>
            <input
              type="range"
              aria-label="Layer Blur in pixels"
              min="0"
              max="50"
              step="1"
              value={blur}
              onChange={e => updateFilters({ blur: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span title="Blurs content beneath this layer's bounding box (frosted glass, 0-30px)">Backdrop Blur</span>
              <div className="flex items-center gap-1.5">
                {backdropBlur !== 0 && (
                  <button
                    type="button"
                    onClick={() => updateFilters({ backdropBlur: 0 })}
                    className="text-stone-500 hover:text-amber-400 cursor-pointer p-0.5"
                    title="Reset backdrop blur to 0px"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                )}
                <span className="text-amber-400 font-mono">{Number.isInteger(backdropBlur) ? `${backdropBlur}px` : `${backdropBlur.toFixed(1)}px`}</span>
              </div>
            </div>
            <input
              type="range"
              aria-label="Backdrop Blur in pixels"
              min="0"
              max="30"
              step="1"
              value={backdropBlur}
              onChange={e => updateFilters({ backdropBlur: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
        </div>

        {(blur > 0 || backdropBlur > 0) && (
          <p className="text-[9px] text-stone-500 leading-relaxed">
            {blur > 0 && backdropBlur > 0
              ? 'Layer blur softens layer pixels; Backdrop blur frosts media underneath.'
              : blur > 0
              ? 'Softens this layer’s pixels (ideal for background B-roll or dreamy visuals).'
              : 'Frosted glass effect: blurs background layers underneath this layer.'}
          </p>
        )}

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
          {blendHint && (
            <p className="text-[9px] text-stone-500 leading-relaxed pt-1" title="Blend modes composite with layers beneath — on a single opaque fullscreen layer they have no visible effect">
              {blendHint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export const AstFilterControls = memo(AstFilterControlsInner);
AstFilterControls.displayName = 'AstFilterControls';
