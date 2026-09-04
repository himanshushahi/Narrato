import React, { InputHTMLAttributes, useState, useEffect, useRef, useId } from 'react';

interface CustomColorInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Color + hex-text input.
 *
 * - Local state updates synchronously so dragging the picker or typing hex
 *   is always instant (no waiting on parent re-renders).
 * - External `value` resyncs only when it differs from the last value this
 *   input reported AND the user is not actively interacting with it — so a
 *   parent echo (debounced store write, AI rewrite, reset) can't clobber an
 *   in-flight drag/keystroke.
 * - Forwards the real React change event so e.target.name / type etc. stay
 *   intact (React 17+ has no event pooling).
 * - The native picker only round-trips opaque #rrggbb. For rgba()/transparent/
 *   gradient/named colors the picker is disabled so picking can't silently
 *   destroy alpha (e.g. rgba(0,0,0,0.6) → opaque black) — edit the text instead.
 */
const isPickerSafeSolid = (val: unknown): boolean => {
  if (typeof val !== 'string') return false;
  const v = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) return true;
  const m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    if (m[4] === undefined) return true;
    return parseFloat(m[4]) === 1;
  }
  return false;
};
export const CustomColorInput: React.FC<CustomColorInputProps> = React.memo(({ label, className = '', value, onChange, onFocus, onBlur, disabled, id: propsId, name: propsName, ...props }) => {
  const normalize = (v: unknown) => (typeof v === 'string' ? v : '#000000');
  const [localValue, setLocalValue] = useState(() => normalize(value));
  const [isFocused, setIsFocused] = useState(false);
  const lastReportedRef = useRef(normalize(value));
  const isFocusedRef = useRef(false);
  const pendingIncomingRef = useRef<string | null>(null);
  const baseId = useId();
  const textId = propsId || `${baseId}-text`;
  const pickerId = `${baseId}-picker`;
  useEffect(() => {
    isFocusedRef.current = isFocused;
    // Apply any external update that arrived while focused once interaction ends.
    if (!isFocused && pendingIncomingRef.current !== null) {
      const pending = pendingIncomingRef.current;
      pendingIncomingRef.current = null;
      if (pending !== lastReportedRef.current) {
        setLocalValue(pending);
        lastReportedRef.current = pending;
      }
    }
  }, [isFocused]);

  useEffect(() => {
    const incoming = normalize(value);
    // Resync only on parent value changes while idle — not on the blur
    // transition itself — so a blur before the 150ms parent debounce lands
    // can't transiently restore the stale value and flicker.
    if (!isFocusedRef.current && incoming !== lastReportedRef.current) {
      setLocalValue(incoming);
      lastReportedRef.current = incoming;
    } else if (isFocusedRef.current && incoming !== lastReportedRef.current) {
      // Remember it so blur can apply it instead of dropping it forever.
      pendingIncomingRef.current = incoming;
    }
  }, [value]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    lastReportedRef.current = newValue;
    // A focused edit supersedes any queued external value.
    pendingIncomingRef.current = null;
    // Forward the real React event so e.target.name / type / nativeEvent etc.
    // stay intact (old debounced code did this; React 17+ has no event pooling).
    if (onChange) onChange(e);
  };

  // Native color pickers only emit valid #rrggbb; derive the swatch from any
  // opaque solid (short hex, rgb()) so an in-progress hex string ("#ff")
  // falls back without crashing, and #fff / rgb(255,255,255) don't show black.
  const toSwatchHex = (val: unknown): string | null => {
    if (typeof val !== 'string') return null;
    const v = val.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    const short = v.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (m && (m[4] === undefined || parseFloat(m[4]) === 1)) {
      const toHex = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
      return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
    }
    return null;
  };
  const swatchValue = toSwatchHex(localValue) ?? '#000000';
  const pickerSafe = isPickerSafeSolid(localValue) || localValue === '' || localValue === '#000000';
  const pickerDisabled = (disabled ?? false) || (!pickerSafe && localValue !== '');

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && <label htmlFor={textId} className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</label>}
      <div className="flex items-center gap-3 bg-[var(--color-brand-950)]/50 border border-slate-700/50 rounded-md px-3 py-2.5 focus-within:border-[var(--color-accent-primary)] focus-within:ring-1 focus-within:ring-[var(--color-accent-primary)] transition-all">
        <span
          className="relative w-5 h-5 rounded overflow-hidden shrink-0 border border-slate-600/50 inline-block"
          title={pickerDisabled && !disabled ? `Picker disabled for ${localValue} — edit the text instead` : (toSwatchHex(localValue) === null ? `No picker preview for ${localValue}` : undefined)}
        >
          <input
            type="color"
            id={pickerId}
            name={propsName ? `${propsName}-picker` : undefined}
            className={`absolute -top-2 -left-2 w-10 h-10 border-none p-0 bg-transparent ${pickerDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            value={swatchValue}
            onChange={handleChange}
            disabled={pickerDisabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
            aria-label={label ? `${label} picker` : 'Color picker'}
          />
        </span>
        <input
          type="text"
          id={textId}
          name={propsName}
          className={`bg-transparent border-none text-xs text-slate-200 focus:outline-none w-full font-mono uppercase ${className}`}
          value={localValue}
          onChange={handleChange}
          disabled={disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-label={label ? `${label} hex value` : 'Color value'}
          spellCheck={false}
          autoComplete="off"
          {...props}
        />
      </div>
    </div>
  );
});
CustomColorInput.displayName = 'CustomColorInput';
