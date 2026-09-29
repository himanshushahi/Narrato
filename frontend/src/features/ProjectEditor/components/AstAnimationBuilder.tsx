import React, { memo } from 'react';
import { ASTAnimation } from '../../../components/video/ASTAnimator';
import { BiTrashAlt, BiPlus, BiCopy } from 'react-icons/bi';
import { BsLightningCharge } from 'react-icons/bs';

interface AstAnimationBuilderProps {
  animations?: ASTAnimation[];
  onChange: (animations: ASTAnimation[]) => void;
  exit?: boolean | number;
  onExitChange?: (val: boolean | number | undefined) => void;
}

const ANIMATION_PROPERTIES: { id: ASTAnimation['property']; label: string; icon: string; unit: string; defaultFrom: number; defaultTo: number }[] = [
  { id: 'translateY', label: 'Translate Y (Vertical)', icon: '↕️', unit: 'px', defaultFrom: 45, defaultTo: 0 },
  { id: 'translateX', label: 'Translate X (Horizontal)', icon: '↔️', unit: 'px', defaultFrom: 60, defaultTo: 0 },
  { id: 'translateZ', label: 'Translate Z (3D Depth)', icon: '🪐', unit: 'px', defaultFrom: -150, defaultTo: 0 },
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
      { property: 'translateY', from: 45, to: 0, duration: 0.6, delay: 0.5, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.4, delay: 0.5, easing: 'ease-out' },
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
      { property: 'rotateX', from: 20, to: 0, duration: 0.7, delay: 0.5, easing: 'spring' },
      { property: 'translateY', from: 40, to: 0, duration: 0.7, delay: 0.5, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.4, delay: 0.5, easing: 'ease-out' },
    ],
  },
  {
    label: 'Rack Focus In',
    icon: '🔍',
    animations: [
      { property: 'blur', from: 10, to: 0, duration: 0.6, delay: 0.5, easing: 'ease-out' },
      { property: 'opacity', from: 0, to: 1, duration: 0.5, delay: 0.5, easing: 'ease-out' },
    ],
  },
  {
    label: 'Zoom Punch',
    icon: '💥',
    animations: [
      { property: 'scale', from: 1.15, to: 1.0, duration: 0.6, delay: 0.5, easing: 'spring' },
      { property: 'opacity', from: 0, to: 1, duration: 0.35, delay: 0.5, easing: 'ease-out' },
    ],
  },
  {
    label: 'Fade Out Exit',
    icon: '🚪',
    animations: [
      { property: 'opacity', from: 1, to: 0, duration: 0.4, delay: 2.0, easing: 'ease-out', exit: true },
    ],
  },
];

const AstAnimationBuilderInner: React.FC<AstAnimationBuilderProps> = ({
  animations = [],
  onChange,
  exit,
  onExitChange,
}) => {
  const handleAddAnimation = (property: ASTAnimation['property'] = 'translateY') => {
    const propMeta = ANIMATION_PROPERTIES.find(p => p.id === property);
    const newAnim: ASTAnimation = {
      property,
      from: propMeta?.defaultFrom ?? 0,
      to: propMeta?.defaultTo ?? 1,
      duration: 0.6,
      delay: 0.5,
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

                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      className="flex items-center gap-1 cursor-pointer text-[10px] text-stone-400 hover:text-amber-400 select-none shrink-0"
                      title="Mark as exit animation: stays idle until its delay starts, and unmounts layer once finished."
                    >
                      <input
                        type="checkbox"
                        checked={!!anim.exit}
                        onChange={e => handleUpdate(idx, 'exit', e.target.checked || undefined)}
                        className="rounded bg-black/60 border-white/20 text-amber-500 focus:ring-0 cursor-pointer w-3 h-3"
                      />
                      <span>🚪 Exit</span>
                    </label>
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
                      value={(anim as any).from ?? (anim as any).from_ ?? 0}
                      onChange={e => {
                        // Self-heal backend-serialized `from_` into the editor `from` contract.
                        const v = parseFloat(e.target.value) || 0;
                        const updated = [...animations];
                        const next: any = { ...updated[idx], from: v };
                        delete next.from_;
                        updated[idx] = next;
                        onChange(updated);
                      }}
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
                    <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block" title="Seconds from cut start. Cut transitions run ~0.5s — keep entrances at 0.5+ or they play hidden under the transition. Sync to the spoken word when possible.">Delay</label>
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
                      <option value="bounce">Bounce</option>
                      <option value="elastic">Elastic Overshoot</option>
                      <option value="back">Anticipation Wind-Up</option>
                      <option value="steps">Stepped Frames</option>
                      <option value="bezier">Cubic Bézier</option>
                    </select>
                  </div>
                </div>

                {/* Row 4: Continuous Motion (Loop Mode) */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 shrink-0">
                    Motion Cycle
                  </label>
                  <div className="flex items-center gap-1">
                    {(['none', 'loop', 'pingpong'] as const).map(mode => {
                      const active = (anim.loop_mode || 'none') === mode;
                      const label = mode === 'none' ? 'One-Shot' : mode === 'loop' ? '🔁 Loop' : '🏓 Ping-Pong';
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleUpdate(idx, 'loop_mode', mode === 'none' ? undefined : mode)}
                          className={`px-2 py-0.5 text-[9px] rounded border font-semibold transition-colors cursor-pointer ${
                            active
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                              : 'bg-black/40 border-white/10 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Curve-specific manual parameters */}
                {anim.easing === 'spring' && (
                  <div className="p-2 bg-black/50 border border-white/5 rounded-lg space-y-1.5">
                    <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-amber-400/90">
                      <span>Spring Physics Controls</span>
                      <span className="text-[8px] text-stone-500 font-mono">Damping / Stiffness / Mass</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                          <span>Damp</span>
                          <span className="text-amber-400">{anim.damping ?? 14}</span>
                        </div>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={anim.damping ?? 14}
                          onChange={e => handleUpdate(idx, 'damping', parseFloat(e.target.value) || 14)}
                          className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                          title="Damping (bounciness friction: lower = bouncier, higher = stiffer)"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                          <span>Stiff</span>
                          <span className="text-amber-400">{anim.stiffness ?? 100}</span>
                        </div>
                        <input
                          type="number"
                          min="1"
                          max="500"
                          step="5"
                          value={anim.stiffness ?? 100}
                          onChange={e => handleUpdate(idx, 'stiffness', parseFloat(e.target.value) || 100)}
                          className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                          title="Stiffness (tension/snap speed: higher = faster snap)"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                          <span>Mass</span>
                          <span className="text-amber-400">{anim.mass ?? 0.9}</span>
                        </div>
                        <input
                          type="number"
                          min="0.1"
                          max="10"
                          step="0.1"
                          value={anim.mass ?? 0.9}
                          onChange={e => handleUpdate(idx, 'mass', parseFloat(e.target.value) || 0.9)}
                          className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                          title="Mass (weight/inertia: higher = heavier overshoot)"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 pt-0.5 text-[9px] text-stone-400 hover:text-stone-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!(anim.overshoot_clamping ?? anim.overshootClamping)}
                        onChange={e => handleUpdate(idx, 'overshoot_clamping', e.target.checked || undefined)}
                        className="rounded bg-black/60 border-white/20 text-amber-500 focus:ring-0 cursor-pointer w-3 h-3"
                      />
                      <span>Overshoot Clamping (stop at target value)</span>
                    </label>
                  </div>
                )}

                {anim.easing === 'elastic' && (
                  <div className="p-2 bg-black/50 border border-white/5 rounded-lg space-y-1">
                    <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                      <span>Elastic Bounciness</span>
                      <span className="text-amber-400">{anim.elastic_bounciness ?? 1.0}</span>
                    </div>
                    <input
                      type="number"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={anim.elastic_bounciness ?? 1.0}
                      onChange={e => handleUpdate(idx, 'elastic_bounciness', parseFloat(e.target.value) || 1.0)}
                      className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                    />
                  </div>
                )}

                {anim.easing === 'back' && (
                  <div className="p-2 bg-black/50 border border-white/5 rounded-lg space-y-1">
                    <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                      <span>Anticipation Overshoot Factor</span>
                      <span className="text-amber-400">{anim.back_overshoot ?? 1.7}</span>
                    </div>
                    <input
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={anim.back_overshoot ?? 1.7}
                      onChange={e => handleUpdate(idx, 'back_overshoot', parseFloat(e.target.value) || 1.7)}
                      className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                    />
                  </div>
                )}

                {anim.easing === 'steps' && (
                  <div className="p-2 bg-black/50 border border-white/5 rounded-lg space-y-1">
                    <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                      <span>Discrete Steps Count</span>
                      <span className="text-amber-400">{anim.steps_count ?? 5}</span>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      step="1"
                      value={anim.steps_count ?? 5}
                      onChange={e => handleUpdate(idx, 'steps_count', parseInt(e.target.value, 10) || 5)}
                      className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-stone-200 font-mono focus:outline-none"
                    />
                  </div>
                )}

                {anim.easing === 'bezier' && (
                  <div className="p-2 bg-black/50 border border-white/5 rounded-lg space-y-1">
                    <div className="flex justify-between text-[8px] text-stone-400 font-mono">
                      <span>Cubic Bézier Points [X1, Y1, X2, Y2]</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {([0, 1, 2, 3] as const).map(pIdx => {
                        const pts = anim.bezier_points || [0.16, 1.0, 0.3, 1.0];
                        const labels = ['X1', 'Y1', 'X2', 'Y2'];
                        // Remotion throws when X1/X2 leave [0, 1] — constrain
                        // at the input so a typo can't break the whole layer.
                        const isX = pIdx % 2 === 0;
                        return (
                          <div key={pIdx} className="space-y-0.5">
                            <span className="text-[7px] text-stone-500 font-mono block text-center">{labels[pIdx]}</span>
                            <input
                              type="number"
                              step="0.05"
                              min={isX ? 0 : undefined}
                              max={isX ? 1 : undefined}
                              value={pts[pIdx] ?? (pIdx % 2 === 1 ? 1 : 0.2)}
                              onChange={e => {
                                const nextPts = [...pts] as [number, number, number, number];
                                let v = parseFloat(e.target.value);
                                if (!Number.isFinite(v)) v = 0;
                                if (isX) v = Math.min(1, Math.max(0, v));
                                nextPts[pIdx] = v;
                                handleUpdate(idx, 'bezier_points', nextPts);
                              }}
                              className="w-full bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[10px] text-stone-200 font-mono text-center focus:outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 3. Layer Exit Behavior (Unmounts layer before cut finishes) */}
      {onExitChange && (
        <div className="p-3 bg-black/30 border border-white/10 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
              🚪 Layer Exit Behavior
            </label>
            <span className="text-[9px] text-stone-500 font-mono">
              {exit === true ? 'Exit after motion' : typeof exit === 'number' ? `Exit at ${exit}s` : 'Persist full cut (default)'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => onExitChange(undefined)}
              className={`px-2 py-1 text-[10px] rounded border transition-colors cursor-pointer text-center ${exit === undefined || exit === false ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold' : 'bg-black/40 border-white/10 text-stone-400 hover:text-stone-200 font-medium'}`}
              title="Layer stays visible for the entire duration of this cut"
            >
              Full Cut
            </button>
            <button
              type="button"
              onClick={() => onExitChange(true)}
              className={`px-2 py-1 text-[10px] rounded border transition-colors cursor-pointer text-center ${exit === true ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold' : 'bg-black/40 border-white/10 text-stone-400 hover:text-stone-200 font-medium'}`}
              title="Layer unmounts cleanly once its animation timeline ends"
            >
              After Motion
            </button>
            <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-0.5">
              <input
                type="number"
                step="0.1"
                min="0.1"
                placeholder="Sec"
                className="w-full bg-transparent text-[10px] text-stone-200 focus:outline-none font-mono"
                value={typeof exit === 'number' ? exit : ''}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  onExitChange(Number.isFinite(v) && v > 0 ? v : undefined);
                }}
              />
              <span className="text-[9px] text-stone-500 font-mono">s</span>
            </div>
          </div>
          {exit === true && animations.some(a => a && (a.loop_mode === 'loop' || a.loop_mode === 'pingpong') && !a.exit) && (
            <div className="text-[9px] text-amber-400/90 font-mono px-0.5">
              ⚠️ Looping tracks never end — exit timing uses the finite tracks only (pure-loop layers persist the full cut).
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const AstAnimationBuilder = memo(AstAnimationBuilderInner);
AstAnimationBuilder.displayName = 'AstAnimationBuilder';
