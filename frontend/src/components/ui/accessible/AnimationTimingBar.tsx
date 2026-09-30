import React, { useState, useRef, memo } from 'react';
import { Clock, AlertTriangle, Sparkles, LogOut, Repeat } from 'lucide-react';
import { ScrubbableNumberInput } from './ScrubbableNumberInput';

export interface AnimationTimingBarProps {
  /** Scene/cut duration in seconds (100% of the bar width). Defaults to 5.0s */
  sceneDuration?: number;
  /** Delay before animation starts (in seconds) */
  delay: number;
  /** Active animation duration (in seconds) */
  duration: number;
  /** Callback when delay or duration changes */
  onChange: (updates: { delay: number; duration: number }) => void;
  /** Whether this is an exit animation (unmounts at end) */
  isExit?: boolean;
  /** Motion cycle mode ('none' | 'loop' | 'pingpong') */
  loopMode?: 'none' | 'loop' | 'pingpong';
  /** Optional track label */
  label?: string;
  disabled?: boolean;
}

export const AnimationTimingBar: React.FC<AnimationTimingBarProps> = memo(({
  sceneDuration = 5.0,
  delay = 0,
  duration = 0.6,
  onChange,
  isExit = false,
  loopMode = 'none',
  label,
  disabled = false,
}) => {
  const safeSceneDuration = Math.max(0.5, sceneDuration || 5.0);
  const trackRef = useRef<HTMLDivElement>(null);

  // Active interaction drag states: 'delay' | 'duration' | 'body' | null
  const [dragMode, setDragMode] = useState<'delay' | 'duration' | 'body' | null>(null);
  const dragStartRef = useRef<{ clientX: number; initDelay: number; initDuration: number }>({
    clientX: 0,
    initDelay: 0,
    initDuration: 0,
  });

  // Calculate percentages (clamped to 100% for bar rendering)
  const safeDelay = Math.max(0, delay);
  const safeDuration = Math.max(0.05, duration);
  const totalAnimTime = safeDelay + safeDuration;
  const isOverflow = totalAnimTime > safeSceneDuration + 0.05;
  const overflowAmount = Math.max(0, totalAnimTime - safeSceneDuration);

  const delayPct = Math.min(100, (safeDelay / safeSceneDuration) * 100);
  const durationPct = Math.min(100 - delayPct, (safeDuration / safeSceneDuration) * 100);

  // Drag interaction handlers
  const handlePointerDown = (
    e: React.PointerEvent,
    mode: 'delay' | 'duration' | 'body'
  ) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    setDragMode(mode);
    dragStartRef.current = {
      clientX: e.clientX,
      initDelay: safeDelay,
      initDuration: safeDuration,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragMode || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const deltaPixels = e.clientX - dragStartRef.current.clientX;
    const deltaSeconds = (deltaPixels / rect.width) * safeSceneDuration;

    if (dragMode === 'delay' || dragMode === 'body') {
      // Adjust start delay without changing duration
      const newDelay = Math.max(0, Math.round((dragStartRef.current.initDelay + deltaSeconds) * 10) / 10);
      onChange({ delay: newDelay, duration: safeDuration });
    } else if (dragMode === 'duration') {
      // Adjust duration without changing delay
      const newDuration = Math.max(0.1, Math.round((dragStartRef.current.initDuration + deltaSeconds) * 10) / 10);
      onChange({ delay: safeDelay, duration: newDuration });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragMode) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture already released
      }
      setDragMode(null);
    }
  };

  // Keyboard navigation for accessible handles
  const handleKeyStep = (
    e: React.KeyboardEvent,
    type: 'delay' | 'duration'
  ) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    let newDelay = safeDelay;
    let newDuration = safeDuration;

    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (type === 'delay') newDelay = Math.min(safeSceneDuration * 2, Math.round((safeDelay + step) * 10) / 10);
      else newDuration = Math.min(safeSceneDuration * 2, Math.round((safeDuration + step) * 10) / 10);
      onChange({ delay: newDelay, duration: newDuration });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (type === 'delay') newDelay = Math.max(0, Math.round((safeDelay - step) * 10) / 10);
      else newDuration = Math.max(0.1, Math.round((safeDuration - step) * 10) / 10);
      onChange({ delay: newDelay, duration: newDuration });
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (type === 'delay') onChange({ delay: 0, duration: safeDuration });
      else onChange({ delay: safeDelay, duration: 0.1 });
    } else if (e.key === 'End') {
      e.preventDefault();
      if (type === 'delay') onChange({ delay: Math.max(0, safeSceneDuration - safeDuration), duration: safeDuration });
      else onChange({ delay: safeDelay, duration: Math.max(0.1, safeSceneDuration - safeDelay) });
    }
  };

  // Generate tick marks (every 1s, or 0.5s if scene duration < 3s)
  const tickInterval = safeSceneDuration <= 3 ? 0.5 : safeSceneDuration <= 8 ? 1.0 : 2.0;
  const tickCount = Math.floor(safeSceneDuration / tickInterval);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * tickInterval).filter(t => t <= safeSceneDuration);

  // Visual bar gradient based on animation nature
  const barGradientClass = isExit
    ? 'from-rose-500 via-rose-400 to-amber-500 text-white'
    : loopMode !== 'none'
    ? 'from-cyan-500 via-sky-400 to-indigo-500 text-white'
    : 'from-amber-500 via-amber-400 to-yellow-300 text-zinc-950 font-bold';

  return (
    <div className={`space-y-2 select-none ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Track Header & Timing Metadata */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-stone-300">
          <Clock size={11} className="text-amber-400" />
          <span>{label || 'Scene Timing'}</span>
          {isExit ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.2 bg-rose-500/15 text-rose-300 border border-rose-500/30 rounded font-semibold normal-case">
              <LogOut size={9} /> Exit
            </span>
          ) : loopMode !== 'none' ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.2 bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded font-semibold normal-case">
              <Repeat size={9} /> {loopMode === 'loop' ? 'Loop' : 'Ping-Pong'}
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.2 bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded font-semibold normal-case">
              <Sparkles size={9} /> Entrance
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] text-stone-400">
          <span>Scene: <strong className="text-stone-200">{safeSceneDuration.toFixed(1)}s</strong></span>
          {isOverflow && (
            <span className="flex items-center gap-1 text-red-400 font-bold bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/30" title={`Animation finishes ${(overflowAmount).toFixed(2)}s past the cut end`}>
              <AlertTriangle size={10} /> +{overflowAmount.toFixed(1)}s spill
            </span>
          )}
        </div>
      </div>

      {/* Visual Timeline Bar Track */}
      <div
        ref={trackRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative h-8 w-full bg-zinc-950/80 border rounded-lg overflow-hidden cursor-pointer shadow-inner touch-none ${
          isOverflow ? 'border-red-500/50' : 'border-zinc-800'
        }`}
        title={`Delay: ${safeDelay.toFixed(2)}s | Duration: ${safeDuration.toFixed(2)}s | Total: ${safeSceneDuration.toFixed(1)}s`}
      >
        {/* Tick Ruler Background */}
        <div className="absolute inset-0 flex justify-between pointer-events-none px-1">
          {ticks.map((t) => {
            const leftPct = (t / safeSceneDuration) * 100;
            return (
              <div
                key={t}
                className="absolute top-0 bottom-0 border-l border-white/5 flex flex-col justify-between py-0.5"
                style={{ left: `${leftPct}%` }}
              >
                <span className="text-[8px] font-mono text-stone-600 pl-0.5 leading-none">
                  {t.toFixed(t % 1 === 0 ? 0 : 1)}s
                </span>
                <span className="w-0.5 h-1 bg-white/10" />
              </div>
            );
          })}
        </div>

        {/* Lead-in Delay Offset (Striped Area) */}
        {delayPct > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.4),rgba(0,0,0,0.4)_4px,rgba(255,255,255,0.03)_4px,rgba(255,255,255,0.03)_8px)] flex items-center justify-end pr-1 border-r border-amber-500/40"
            style={{ width: `${delayPct}%` }}
            title={`Lead-in Delay: ${safeDelay.toFixed(2)}s`}
          >
            {delayPct > 15 && (
              <span className="text-[8px] font-mono text-stone-500 truncate select-none">
                +{safeDelay.toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {/* Active Animated Duration Bar (Draggable Body) */}
        <div
          onPointerDown={(e) => handlePointerDown(e, 'body')}
          className={`absolute top-1 bottom-1 rounded-md bg-gradient-to-r ${barGradientClass} shadow-md flex items-center justify-between px-1 cursor-grab active:cursor-grabbing group transition-shadow hover:brightness-110 touch-none`}
          style={{
            left: `${delayPct}%`,
            width: `${Math.max(2, durationPct)}%`,
          }}
        >
          {/* Left Handle: Adjust Delay */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Animation start delay"
            aria-valuemin={0}
            aria-valuemax={safeSceneDuration}
            aria-valuenow={safeDelay}
            aria-valuetext={`${safeDelay.toFixed(1)} seconds delay`}
            onPointerDown={(e) => handlePointerDown(e, 'delay')}
            onKeyDown={(e) => handleKeyStep(e, 'delay')}
            className="w-2.5 h-5 -ml-1 rounded bg-black/60 hover:bg-black/80 border border-white/40 flex items-center justify-center cursor-ew-resize opacity-80 group-hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 touch-none"
            title="Drag or use Left/Right arrows to adjust delay"
          >
            <div className="w-0.5 h-2 bg-white/80 rounded" />
          </div>

          {/* Bar Label (Duration) */}
          <span className="text-[9px] font-mono font-extrabold truncate px-1 select-none pointer-events-none">
            {safeDuration.toFixed(1)}s
          </span>

          {/* Right Handle: Adjust Duration */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Animation active duration"
            aria-valuemin={0.1}
            aria-valuemax={safeSceneDuration}
            aria-valuenow={safeDuration}
            aria-valuetext={`${safeDuration.toFixed(1)} seconds duration`}
            onPointerDown={(e) => handlePointerDown(e, 'duration')}
            onKeyDown={(e) => handleKeyStep(e, 'duration')}
            className="w-2.5 h-5 -mr-1 rounded bg-black/60 hover:bg-black/80 border border-white/40 flex items-center justify-center cursor-ew-resize opacity-80 group-hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 touch-none"
            title="Drag or use Left/Right arrows to adjust duration"
          >
            <div className="w-0.5 h-2 bg-white/80 rounded" />
          </div>
        </div>
      </div>

      {/* Synchronized Precision Inputs */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <ScrubbableNumberInput
          label="Delay (Front Gap)"
          value={safeDelay}
          min={0}
          max={safeSceneDuration}
          step={0.1}
          unit="s"
          onChange={(newDelay) => onChange({ delay: newDelay, duration: safeDuration })}
          disabled={disabled}
        />
        <ScrubbableNumberInput
          label="Duration (Active)"
          value={safeDuration}
          min={0.1}
          max={safeSceneDuration * 2}
          step={0.1}
          unit="s"
          onChange={(newDuration) => onChange({ delay: safeDelay, duration: newDuration })}
          disabled={disabled}
        />
      </div>
    </div>
  );
});

AnimationTimingBar.displayName = 'AnimationTimingBar';
