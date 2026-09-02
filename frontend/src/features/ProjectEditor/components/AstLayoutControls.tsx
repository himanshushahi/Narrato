import React from 'react';
import { BsLayoutSplit, BsSliders } from 'react-icons/bs';

interface AstLayoutControlsProps {
  style?: React.CSSProperties;
  onChange: (style: React.CSSProperties) => void;
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
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
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
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
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
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
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
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(250, 204, 21, 0.3)',
      boxShadow: '0 15px 40px rgba(0, 0, 0, 0.6)',
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
      backdropFilter: 'blur(16px)',
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

const SHADOW_PRESETS = [
  { label: 'None', value: 'none' },
  { label: 'Cinematic Drop', value: '0 25px 60px rgba(0, 0, 0, 0.7)' },
  { label: 'Soft Shadow', value: '0 10px 30px rgba(0, 0, 0, 0.4)' },
  { label: 'Neon Cyan Glow', value: '0 0 35px rgba(6, 182, 212, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
  { label: 'Amber Gold Glow', value: '0 0 35px rgba(245, 158, 11, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
  { label: 'Crimson Alert', value: '0 0 35px rgba(239, 68, 68, 0.4), 0 10px 40px rgba(0, 0, 0, 0.6)' },
];

export const AstLayoutControls: React.FC<AstLayoutControlsProps> = ({
  style = {},
  onChange,
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
    onChange({ ...currentStyle, ...presetStyle });
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

  return (
    <div className="space-y-3.5">
      {/* 1. Layout Presets */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
          <BsLayoutSplit size={11} />
          Position & Card Layout Presets
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {LAYOUT_PRESETS.map((preset, pIdx) => (
            <button
              key={pIdx}
              type="button"
              onClick={() => handleApplyPreset(preset.style)}
              className="px-2.5 py-1.5 bg-black/40 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/40 text-[10px] font-bold rounded-lg text-stone-300 hover:text-amber-300 transition-colors flex items-center gap-2 cursor-pointer text-left truncate"
            >
              <span>{preset.icon}</span>
              <span className="truncate">{preset.label}</span>
            </button>
          ))}
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
              <span className="text-amber-400 font-mono">{heightVal}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={heightVal}
              onChange={e => handleUpdate('height', `${e.target.value}%`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
        </div>
      </div>

      {/* 3. Card Surface & Glassmorphism */}
      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
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
          <input
            type="text"
            className="w-full bg-black/60 border border-white/10 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono"
            value={currentStyle.backgroundColor || currentStyle.background || ''}
            onChange={e => handleUpdate('backgroundColor', e.target.value)}
            placeholder="rgba(15, 23, 42, 0.85)"
          />
        </div>

        {/* Sliders: Glass Blur & Corner Radius */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Glass Blur</span>
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

          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
              <span>Corner Radius</span>
              <span className="text-amber-400 font-mono">{radiusVal}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="36"
              step="2"
              value={radiusVal}
              onChange={e => handleUpdate('borderRadius', `${e.target.value}px`)}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
            />
          </div>
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
      </div>
    </div>
  );
};
