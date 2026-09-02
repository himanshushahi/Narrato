import React from 'react';
import { ASTAnimation } from '../../../components/video/ASTAnimator';
import { BiTrashAlt, BiPlus, BiCopy } from 'react-icons/bi';
import { BsLightningCharge } from 'react-icons/bs';

interface AstAnimationBuilderProps {
  animations?: ASTAnimation[];
  onChange: (animations: ASTAnimation[]) => void;
}

const ANIMATION_PROPERTIES: { id: ASTAnimation['property']; label: string; icon: string; unit: string; defaultFrom: number; defaultTo: number }[] = [
  { id: 'translateY', label: 'Translate Y (Vertical)', icon: '↕️', unit: 'px', defaultFrom: 45, defaultTo: 0 },
  { id: 'translateX', label: 'Translate X (Horizontal)', icon: '↔️', unit: 'px', defaultFrom: 60, defaultTo: 0 },
  { id: 'scale', label: 'Scale (Zoom Drift)', icon: '🔍', unit: 'x', defaultFrom: 0.85, defaultTo: 1.0 },
  { id: 'opacity', label: 'Opacity (Fade)', icon: '👁️', unit: '%', defaultFrom: 0, defaultTo: 1 },
  { id: 'rotate', label: 'Rotate 2D', icon: '🔄', unit: '°', defaultFrom: -10, defaultTo: 0 },
  { id: 'rotateX', label: 'Rotate X (3D Tilt)', icon: '📐', unit: '°', defaultFrom: 20, defaultTo: 0 },
  { id: 'rotateY', label: 'Rotate Y (3D Pan)', icon: '📐', unit: '°', defaultFrom: 20, defaultTo: 0 },
  { id: 'blur', label: 'Rack Focus (Blur)', icon: '🌫️', unit: 'px', defaultFrom: 10, defaultTo: 0 },
  { id: 'brightness', label: 'Brightness Flash', icon: '💡', unit: 'x', defaultFrom: 0.3, defaultTo: 1.0 },
];

const PRESETS: { label: string; icon: string; animations: ASTAnimation[] }[] = [
  {
    label: 'Spring Pop In',
    icon: '🚀',
    animations: [
      { property: 'translateY', from: 45, to: 0, duration: 0.6, delay: 0, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.4, delay: 0, easing: 'ease-out' },
    ],
  },
  {
    label: 'Parallax Drift',
    icon: '🌊',
    animations: [
      { property: 'scale', from: 1.0, to: 1.06, duration: 4.5, delay: 0, easing: 'linear' },
    ],
  },
  {
    label: '3D Card Flip',
    icon: '🔄',
    animations: [
      { property: 'rotateX', from: 20, to: 0, duration: 0.7, delay: 0, easing: 'spring' },
      { property: 'translateY', from: 40, to: 0, duration: 0.7, delay: 0, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.4, delay: 0, easing: 'ease-out' },
    ],
  },
  {
    label: 'Rack Focus In',
    icon: '🔍',
    animations: [
      { property: 'blur', from: 10, to: 0, duration: 0.6, delay: 0, easing: 'ease-out' },
      { property: 'opacity', from: 0, to: 1, duration: 0.5, delay: 0, easing: 'ease-out' },
    ],
  },
  {
    label: 'Zoom Punch',
    icon: '💥',
    animations: [
      { property: 'scale', from: 1.15, to: 1.0, duration: 0.6, delay: 0, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.35, delay: 0, easing: 'ease-out' },
    ],
  },
];

export const AstAnimationBuilder: React.FC<AstAnimationBuilderProps> = ({
  animations = [],
  onChange,
}) => {
  const handleAddAnimation = (property: ASTAnimation['property'] = 'translateY') => {
    const propMeta = ANIMATION_PROPERTIES.find(p => p.id === property);
    const newAnim: ASTAnimation = {
      property,
      from: propMeta?.defaultFrom ?? 0,
      to: propMeta?.defaultTo ?? 1,
      duration: 0.6,
      delay: 0,
      easing: 'spring',
    };
    onChange([...animations, newAnim]);
  };

  const handleUpdate = (index: number, field: keyof ASTAnimation, val: any) => {
    const updated = [...animations];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  const handleDelete = (index: number) => {
    onChange(animations.filter((_, i) => i !== index));
  };

  const handleDuplicate = (index: number) => {
    const clone = JSON.parse(JSON.stringify(animations[index]));
    const updated = [...animations];
    updated.splice(index + 1, 0, clone);
    onChange(updated);
  };

  const handleApplyPreset = (presetAnims: ASTAnimation[]) => {
    onChange(JSON.parse(JSON.stringify(presetAnims)));
  };

  return (
    <div className="space-y-3.5">
      {/* 1. Animation Presets */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
            <BsLightningCharge size={11} />
            Animation Presets
          </label>
          {animations.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[9px] text-stone-500 hover:text-red-400 transition-colors uppercase font-semibold cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset, pIdx) => (
            <button
              key={pIdx}
              type="button"
              onClick={() => handleApplyPreset(preset.animations)}
              className="px-2.5 py-1.5 bg-black/40 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/40 text-[10px] font-bold rounded-lg text-stone-300 hover:text-amber-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{preset.icon}</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Keyframes List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
            Active Keyframe Tracks ({animations.length})
          </label>
          <button
            type="button"
            onClick={() => handleAddAnimation()}
            className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <BiPlus size={12} /> Add Keyframe
          </button>
        </div>

        {animations.length === 0 ? (
          <div className="p-3 bg-black/20 border border-white/5 rounded-lg text-center text-stone-500 text-[11px] italic">
            No active animations. Choose a preset above or click "+ Add Keyframe".
          </div>
        ) : (
          animations.map((anim, idx) => {
            const propMeta = ANIMATION_PROPERTIES.find(p => p.id === anim.property);
            const unit = propMeta?.unit || '';

            return (
              <div
                key={idx}
                className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-2.5 relative group/item hover:border-white/20 transition-all"
              >
                {/* Row 1: Property Selector, Duplicate & Delete */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-mono font-bold text-amber-400/80 shrink-0">
                      Track #{idx + 1}
                    </span>
                    <select
                      className="bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2 py-1 focus:outline-none focus:border-amber-500/50 cursor-pointer flex-1 font-semibold"
                      value={anim.property}
                      onChange={e => {
                        const newProp = e.target.value as ASTAnimation['property'];
                        const meta = ANIMATION_PROPERTIES.find(p => p.id === newProp);
                        const updated = [...animations];
                        updated[idx] = {
                          ...updated[idx],
                          property: newProp,
                          from: meta?.defaultFrom ?? 0,
                          to: meta?.defaultTo ?? 1,
                        };
                        onChange(updated);
                      }}
                    >
                      {ANIMATION_PROPERTIES.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.icon} {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDuplicate(idx)}
                      className="p-1 text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 rounded transition-colors cursor-pointer"
                      title="Duplicate Keyframe Track"
                    >
                      <BiCopy size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(idx)}
                      className="p-1 text-stone-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                      title="Remove Keyframe"
                    >
                      <BiTrashAlt size={12} />
                    </button>
                  </div>
                </div>

                {/* Row 2: Value Range (From -> To) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                      <span>From (Start)</span>
                      <span className="text-stone-500 font-mono">{unit}</span>
                    </div>
                    <input
                      type="number"
                      step="any"
                      className="w-full bg-black/60 border border-white/10 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none font-mono"
                      value={anim.from}
                      onChange={e => handleUpdate(idx, 'from', parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                      <span>To (Target)</span>
                      <span className="text-stone-500 font-mono">{unit}</span>
                    </div>
                    <input
                      type="number"
                      step="any"
                      className="w-full bg-black/60 border border-white/10 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none font-mono"
                      value={anim.to}
                      onChange={e => handleUpdate(idx, 'to', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* Row 3: Timing & Physics Easing */}
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/5">
                  <div className="space-y-0.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Duration</label>
                    <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono"
                        value={anim.duration}
                        onChange={e => handleUpdate(idx, 'duration', parseFloat(e.target.value) || 0.5)}
                      />
                      <span className="text-[9px] text-stone-500 font-mono">s</span>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Delay</label>
                    <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono"
                        value={anim.delay ?? 0}
                        onChange={e => handleUpdate(idx, 'delay', parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-[9px] text-stone-500 font-mono">s</span>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Curve</label>
                    <select
                      className="w-full bg-black/60 border border-white/10 text-[11px] text-stone-200 rounded px-1.5 py-1 focus:outline-none cursor-pointer font-medium"
                      value={anim.easing || 'spring'}
                      onChange={e => handleUpdate(idx, 'easing', e.target.value as any)}
                    >
                      <option value="spring">Spring Physics</option>
                      <option value="ease-out">Ease Out</option>
                      <option value="ease-in-out">Ease In-Out</option>
                      <option value="ease-in">Ease In</option>
                      <option value="linear">Linear Drift</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
