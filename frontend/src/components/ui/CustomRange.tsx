import React, { InputHTMLAttributes, useState, useEffect, useRef, useId } from 'react';

interface CustomRangeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  label?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  valueDisplay?: string | React.ReactNode;
}

/**
 * Range slider with local drag state.
 *
 * `input[type=range]` fires `onChange` per pointer tick during a drag. If the
 * parent echoes the parsed value back (e.g. `parseInt` / `parseFloat`), the
 * echo can differ mid-drag from what the thumb shows and the slider janks.
 * This component renders from local state while the user is dragging and
 * resyncs from props only when idle, so scrubbing stays at pointer speed
 * while the parent still receives every tick for live preview.
 */
export const CustomRange: React.FC<CustomRangeProps> = React.memo(({
  label,
  valueDisplay,
  className = '',
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  min,
  max,
  id: propsId,
  ...props
}) => {
  const {
    onPointerDown: propsOnPointerDown,
    onPointerUp: propsOnPointerUp,
    onPointerCancel: propsOnPointerCancel,
    onLostPointerCapture: propsOnLostPointerCapture,
    ...restProps
  } = props;
  // Normalize to string for comparison so parent number echoes (50) don't
  // mismatch our reported strings ("50") and cause redundant resyncs.
  const normalize = (v: unknown) => (v === null || v === undefined || (v as string) === '' ? '' : String(v));
  const isControlled = value !== undefined;
  const [localValue, setLocalValue] = useState<string>(() => normalize(isControlled ? value : defaultValue));
  const [isDragging, setIsDragging] = useState(false);
  const lastReportedRef = useRef<string>(normalize(isControlled ? value : defaultValue));
  const isDraggingRef = useRef(false);
  const pendingIncomingRef = useRef<string | null>(null);
  const baseId = useId();
  const inputId = propsId || `${baseId}-range`;
  const valueId = `${baseId}-value`;
  useEffect(() => {
    isDraggingRef.current = isDragging;
    // Apply any external update that arrived mid-drag once the drag ends.
    if (!isDragging && pendingIncomingRef.current !== null) {
      const pending = pendingIncomingRef.current;
      pendingIncomingRef.current = null;
      if (pending !== lastReportedRef.current) {
        setLocalValue(pending);
        lastReportedRef.current = pending;
      }
    }
  }, [isDragging]);

  useEffect(() => {
    if (!isControlled) return;
    const incoming = normalize(value);
    // Resync only on parent value changes while idle. The effect depends on
    // `value` alone (not `isDragging`) so ending a drag with a still-stale
    // parent value can't clobber the thumb and flicker when the debounce lands.
    if (!isDraggingRef.current && incoming !== lastReportedRef.current) {
      setLocalValue(incoming);
      lastReportedRef.current = incoming;
    } else if (isDraggingRef.current && incoming !== lastReportedRef.current) {
      pendingIncomingRef.current = incoming;
    }
  }, [value, isControlled]);

  // Safety net: if pointer capture was unavailable and the release happened
  // off-element, element-targeted handlers never fire — clear via window/blur.
  useEffect(() => {
    if (!isDragging) return;
    const clear = () => setIsDragging(false);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, [isDragging]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    lastReportedRef.current = v;
    // A user edit supersedes any queued external value.
    pendingIncomingRef.current = null;
    if (onChange) onChange(e);
  };

  const endDrag = () => setIsDragging(false);

  // When uncontrolled (no `value`), leave the input uncontrolled so
  // `defaultValue` keeps working. When controlled but empty, fall back to a
  // clamped min so the thumb never sits out of [min, max].
  const toNum = (n: unknown) => {
    const f = typeof n === 'number' ? n : parseFloat(String(n ?? ''));
    return Number.isFinite(f) ? f : null;
  };
  const minNum = toNum(min);
  const maxNum = toNum(max);
  const fallbackNum = minNum ?? 0;
  const clampedFallback = maxNum !== null ? Math.min(Math.max(fallbackNum, minNum ?? fallbackNum), maxNum) : (minNum ?? fallbackNum);
  const controlledValue = localValue === '' ? String(clampedFallback) : localValue;

  return (
    <div className="space-y-2 w-full">
      <div className="flex justify-between items-end">
        {label && <label htmlFor={inputId} className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}
        {valueDisplay !== undefined && <span id={valueId} aria-live="polite" className="text-[10px] text-slate-300 font-bold">{valueDisplay}</span>}
      </div>
      <div className="relative group flex items-center py-2">
        <input
          type="range"
          id={inputId}
          {...(isControlled ? { value: controlledValue } : { defaultValue })}
          aria-describedby={valueDisplay !== undefined ? valueId : undefined}
          onChange={handleChange}
          onPointerDown={(e) => {
            setIsDragging(true);
            try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
            propsOnPointerDown?.(e);
          }}
          onPointerUp={(e) => {
            endDrag();
            propsOnPointerUp?.(e);
          }}
          onPointerCancel={(e) => {
            endDrag();
            propsOnPointerCancel?.(e);
          }}
          onLostPointerCapture={(e) => {
            endDrag();
            propsOnLostPointerCapture?.(e);
          }}
          onFocus={onFocus}
          onBlur={(e) => { endDrag(); if (onBlur) onBlur(e); }}
          min={min}
          max={max}
          className={`w-full h-1.5 bg-[var(--color-brand-950)] border border-slate-700/30 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)] hover:accent-[var(--color-accent-light)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 transition-all ${className}`}
          {...restProps}
        />
      </div>
    </div>
  );
});
CustomRange.displayName = 'CustomRange';
