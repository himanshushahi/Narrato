import React, { InputHTMLAttributes, useState, useEffect, useRef } from 'react';

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
  onChange,
  onFocus,
  onBlur,
  min,
  ...props
}) => {
  // Normalize to string for comparison so parent number echoes (50) don't
  // mismatch our reported strings ("50") and cause redundant resyncs.
  const normalize = (v: unknown) => (v === null || v === undefined || (v as string) === '' ? '' : String(v));
  const [localValue, setLocalValue] = useState<string>(() => normalize(value));
  const [isDragging, setIsDragging] = useState(false);
  const lastReportedRef = useRef<string>(normalize(value));
  const isDraggingRef = useRef(false);
  isDraggingRef.current = isDragging;

  useEffect(() => {
    const incoming = normalize(value);
    // Resync only on parent value changes while idle. The effect depends on
    // `value` alone (not `isDragging`) so ending a drag with a still-stale
    // parent value can't clobber the thumb and flicker when the debounce lands.
    if (!isDraggingRef.current && incoming !== lastReportedRef.current) {
      setLocalValue(incoming);
      lastReportedRef.current = incoming;
    }
  }, [value]);

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
    if (onChange) onChange(e);
  };

  return (
    <div className="space-y-2 w-full">
      <div className="flex justify-between items-end">
        {label && <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}
        {valueDisplay !== undefined && <span className="text-[10px] text-slate-300 font-bold">{valueDisplay}</span>}
      </div>
      <div className="relative group flex items-center py-2">
        <input
          type="range"
          value={localValue === '' ? (min ?? 0) : localValue}
          onChange={handleChange}
          onPointerDown={(e) => {
            setIsDragging(true);
            try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerCancel={() => setIsDragging(false)}
          onLostPointerCapture={() => setIsDragging(false)}
          onFocus={onFocus}
          onBlur={(e) => { setIsDragging(false); if (onBlur) onBlur(e); }}
          min={min}
          className={`w-full h-1.5 bg-[var(--color-brand-950)] border border-slate-700/30 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)] hover:accent-[var(--color-accent-light)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 transition-all ${className}`}
          {...props}
        />
      </div>
    </div>
  );
});
CustomRange.displayName = 'CustomRange';
