import React, { memo } from 'react';
import { PARTICLE_PRESETS, ParticlePreset } from '../../../components/video/ParticlesRenderer';

interface AstParticlesEditorProps {
  preset?: string;
  count?: number;
  size?: [number, number];
  speed?: number;
  opacity?: number;
  direction?: string;
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
  onChange,
}) => {
  const def = PARTICLE_PRESETS[(preset as ParticlePreset)] ?? PARTICLE_PRESETS.confetti;
  const effCount = count ?? def.count;
  const [sizeMin, sizeMax] = size ?? def.size;
  const effSpeed = speed ?? 1;
  const effDirection = direction ?? def.direction;

  const applyPreset = (p: ParticlePreset) => {
    const d = PARTICLE_PRESETS[p];
    onChange({
      particle_preset: p,
      particle_count: d.count,
      particle_size: [...d.size],
      particle_speed: 1,
      particle_opacity: 0.9,
      particle_direction: d.direction,
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
      </div>
    </div>
  );
};

export const AstParticlesEditor = memo(AstParticlesEditorInner);
AstParticlesEditor.displayName = 'AstParticlesEditor';
