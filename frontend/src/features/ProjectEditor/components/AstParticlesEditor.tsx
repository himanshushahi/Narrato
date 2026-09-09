import React, { memo } from 'react';
import { PARTICLE_PRESETS, ParticlePreset } from '../../../components/video/ParticlesRenderer';

interface AstParticlesEditorProps {
  preset?: string;
  count?: number;
  size?: [number, number];
  speed?: number;
  opacity?: number;
  direction?: string;
  colors?: string[];
  onChange: (updates: Record<string, any>) => void;
}

const PRESET_META: { value: ParticlePreset; label: string; icon: string; hint: string }[] = [
  { value: 'confetti', label: 'Confetti', icon: '🎉', hint: 'Celebrations, wins' },
  { value: 'embers', label: 'Embers', icon: '🔥', hint: 'Fire, energy, crisis' },
  { value: 'dust', label: 'Dust', icon: '✨', hint: 'Ambient depth' },
  { value: 'money_rain', label: 'Money Rain', icon: '💸', hint: 'Finance, profits' },
  { value: 'snow', label: 'Snow', icon: '❄️', hint: 'Winter, calm' },
  { value: 'stars', label: 'Stars', icon: '🌟', hint: 'Night, dreams' },
];

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}> = ({ label, value, min, max, step, format, onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
      <span>{label}</span>
      <span className="text-amber-400 font-mono">{format(value)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
    />
  </div>
);

const AstParticlesEditorInner: React.FC<AstParticlesEditorProps> = ({
  preset = 'confetti',
  count,
  size,
  speed,
  opacity = 0.9,
  direction,
  colors,
  onChange,
}) => {
  const def = PARTICLE_PRESETS[(preset as ParticlePreset)] ?? PARTICLE_PRESETS.confetti;
  const effCount = count ?? def.count;
  const [sizeMin, sizeMax] = size ?? def.size;
  const effSpeed = speed ?? 1;
  const effDirection = direction ?? def.direction;
  const effColors = colors && colors.length > 0 ? colors : def.colors;
  const isCustomPalette = !!colors && colors.length > 0;

  const applyPreset = (p: ParticlePreset) => {
    const d = PARTICLE_PRESETS[p];
    onChange({
      particle_preset: p,
      particle_count: d.count,
      particle_size: [...d.size],
      particle_speed: 1,
      particle_opacity: 0.9,
      particle_direction: d.direction,
      particle_colors: undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
          ✨ Particle Preset
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {PRESET_META.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => applyPreset(p.value)}
              title={p.hint}
              className={`px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer ${
                preset === p.value
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-black/40 border-white/10 hover:border-amber-500/40 text-stone-300 hover:text-amber-300'
              }`}
            >
              <div className="text-lg leading-none">{p.icon}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider mt-1">{p.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3">
        <Slider label="Count" value={effCount} min={10} max={300} step={5}
          format={(v) => `${v.toFixed(0)}`} onChange={(v) => onChange({ particle_count: Math.round(v) })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Min Size" value={sizeMin} min={1} max={40} step={1}
            format={(v) => `${v.toFixed(0)}px`} onChange={(v) => onChange({ particle_size: [v, Math.max(v, sizeMax)] })} />
          <Slider label="Max Size" value={sizeMax} min={1} max={60} step={1}
            format={(v) => `${v.toFixed(0)}px`} onChange={(v) => onChange({ particle_size: [Math.min(sizeMin, v), v] })} />
        </div>
        <Slider label="Speed" value={effSpeed} min={0.1} max={3} step={0.1}
          format={(v) => `${v.toFixed(1)}x`} onChange={(v) => onChange({ particle_speed: v })} />
        <Slider label="Opacity" value={opacity} min={0.05} max={1} step={0.05}
          format={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => onChange({ particle_opacity: v })} />
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Direction</label>
          <select
            className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
            value={effDirection}
            onChange={(e) => onChange({ particle_direction: e.target.value })}
          >
            <option value="down">Fall Down</option>
            <option value="up">Rise Up</option>
            <option value="left">Drift Left</option>
            <option value="right">Drift Right</option>
            <option value="outward">Burst Outward</option>
            <option value="twinkle">Twinkle In Place</option>
          </select>
        </div>
        <div className="space-y-1.5 pt-1 border-t border-white/5">
          <div className="flex items-center justify-between">
            <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
              Palette {isCustomPalette ? '(Custom)' : '(Preset)'}
            </label>
            {isCustomPalette ? (
              <button
                type="button"
                onClick={() => onChange({ particle_colors: undefined })}
                className="text-[9px] text-stone-500 hover:text-red-400 transition-colors uppercase font-semibold cursor-pointer"
                title="Revert to preset palette"
              >
                Reset
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onChange({ particle_colors: [...def.colors] })}
                className="text-[9px] text-stone-500 hover:text-amber-300 transition-colors uppercase font-semibold cursor-pointer"
                title="Override preset palette with custom colors"
              >
                Customize
              </button>
            )}
          </div>
          {isCustomPalette ? (
            <div className="space-y-1.5">
              {effColors.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-black/60 border border-white/10 rounded px-1.5 py-1">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#ffffff'}
                    onChange={e => {
                      const next = [...effColors];
                      next[i] = e.target.value;
                      onChange({ particle_colors: next });
                    }}
                    className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                  />
                  <input
                    type="text"
                    value={c}
                    onChange={e => {
                      const next = [...effColors];
                      next[i] = e.target.value;
                      onChange({ particle_colors: next });
                    }}
                    className="w-full bg-transparent text-[11px] text-stone-200 focus:outline-none font-mono"
                    placeholder="#ffffff"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = effColors.filter((_, j) => j !== i);
                      onChange({ particle_colors: next.length > 0 ? next : undefined });
                    }}
                    className="text-[10px] text-stone-500 hover:text-red-400 transition-colors cursor-pointer shrink-0 px-1"
                    title="Remove color"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => onChange({ particle_colors: [...effColors, '#ffffff'] })}
                className="w-full py-1 text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-amber-500/10 border border-white/10 hover:border-amber-500/30 text-stone-400 hover:text-amber-300 rounded transition-colors cursor-pointer"
              >
                + Add Color
              </button>
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {effColors.map((c, i) => (
                <div key={i} title={c} className="w-5 h-5 rounded border border-white/20" style={{ backgroundColor: c }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AstParticlesEditor = memo(AstParticlesEditorInner);
AstParticlesEditor.displayName = 'AstParticlesEditor';
