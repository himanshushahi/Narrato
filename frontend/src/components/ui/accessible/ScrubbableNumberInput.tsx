import React, { useState, useRef, useEffect, memo, useId } from 'react';

export interface ScrubbableNumberInputProps {
  label?: string;
  ariaLabel?: string;
  hideLabel?: boolean;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}

export const ScrubbableNumberInput: React.FC<ScrubbableNumberInputProps> = memo(({
  label,
  ariaLabel,
  hideLabel = false,
  value,
  onChange,
  min = 0,
  max = 1000,
  step = 1,
  unit = '',
  disabled = false,
  className = '',
  title,
}) => {
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(value ?? 0));
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartValRef = useRef(0);

  // Sync external changes only when not actively editing
  useEffect(() => {
    if (!isEditing && !isDraggingRef.current) {
      setDraft(String(value ?? 0));
    }
  }, [value, isEditing]);

  const clamp = (val: number) => {
    let clamped = val;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    // Format precision based on step
    const decimals = step.toString().split('.')[1]?.length || 0;
    return parseFloat(clamped.toFixed(decimals));
  };

  const commitDraft = (str: string) => {
    const parsed = parseFloat(str);
    if (Number.isFinite(parsed)) {
      const next = clamp(parsed);
      onChange(next);
      setDraft(String(next));
    } else {
      setDraft(String(value ?? 0));
    }
    setIsEditing(false);
  };

  // Drag-to-scrub handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isEditing) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartValRef.current = value ?? 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const speed = e.shiftKey ? step * 5 : step;
    const rawDelta = Math.round(deltaX / 3) * speed;
    const nextVal = clamp(dragStartValRef.current + rawDelta);
    onChange(nextVal);
    setDraft(String(nextVal));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Released
      }
      isDraggingRef.current = false;
    }
  };

  // Keyboard stepping (Accessible spinbutton semantics)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const multiplier = e.shiftKey ? 10 : 1;
    const delta = step * multiplier;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const parsedDraft = parseFloat(draft);
      const currentVal = Number.isFinite(parsedDraft) ? parsedDraft : (value ?? 0);
      const next = clamp(currentVal + delta);
      onChange(next);
      setDraft(String(next));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const parsedDraft = parseFloat(draft);
      const currentVal = Number.isFinite(parsedDraft) ? parsedDraft : (value ?? 0);
      const next = clamp(currentVal - delta);
      onChange(next);
      setDraft(String(next));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft(draft);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(String(value ?? 0));
      setIsEditing(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  const showLabelRow = !hideLabel && Boolean(label && label.trim().length > 0);
  const effectiveAriaLabel = ariaLabel || label || title || 'Number input';

  return (
    <div className={`space-y-1 ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}>
      {showLabelRow && (
        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
          <label
            htmlFor={inputId}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-ew-resize hover:text-amber-300 transition-colors select-none flex items-center gap-1 touch-none"
            title="Drag left/right to scrub value, Shift for 5x speed"
          >
            <span>{label}</span>
            <span className="text-[8px] text-stone-600 font-mono">↔</span>
          </label>
          {unit && <span className="font-mono text-stone-500 lowercase">{unit}</span>}
        </div>
      )}

      <div className="flex items-center bg-zinc-950/70 border border-zinc-800 rounded-md px-2 py-1 focus-within:border-amber-500/60 focus-within:ring-1 focus-within:ring-amber-500/30 transition-all">
        <input
          id={inputId}
          role="spinbutton"
          aria-label={effectiveAriaLabel}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={`${value ?? 0}${unit ? ` ${unit}` : ''}`}
          type="text"
          value={draft}
          disabled={disabled}
          onFocus={() => setIsEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitDraft(draft)}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-xs text-stone-200 font-mono focus:outline-none"
          title={title || `${effectiveAriaLabel} (${min} - ${max}${unit}) — Enter to apply, arrow keys to step`}
        />
        {unit && (
          <span className="text-[10px] text-stone-500 font-mono ml-1 select-none pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
});

ScrubbableNumberInput.displayName = 'ScrubbableNumberInput';
