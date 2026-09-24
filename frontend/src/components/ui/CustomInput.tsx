import React, { InputHTMLAttributes, TextareaHTMLAttributes, useState, useEffect, useRef } from 'react';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';

interface CustomInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
}

/**
 * Shared external-sync state for CustomInput/CustomTextarea: resync only when
 * the prop value differs from the last value reported, never while focused.
 * (A transforming/debouncing parent would otherwise echo a different value
 * and clobber in-flight text.)
 */
function useSyncedFieldValue<T>(value: T | undefined, defaultValue: T) {
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState(value ?? defaultValue);
  const lastReportedRef = useRef(value ?? defaultValue);

  // Keep the field in sync with external value changes (AI rewrites, resets,
  // async updates) without clobbering the user's own typing.
  useEffect(() => {
    if (!isFocused && value !== lastReportedRef.current) {
      setLocalValue(value ?? defaultValue);
      lastReportedRef.current = value ?? defaultValue;
    }
  }, [value, isFocused, defaultValue]);

  const reportChange = (v: T) => {
    setLocalValue(v);
    lastReportedRef.current = v;
  };

  return { isFocused, setIsFocused, localValue, reportChange };
}

export const CustomInput: React.FC<CustomInputProps> = React.memo(({ label, icon, className = '', type, value, onChange, onFocus, onBlur, ...props }) => {
  const [showPassword, setShowPassword] = useState(false);
  const { setIsFocused, localValue, reportChange } = useSyncedFieldValue(value, '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    reportChange(v);
    if (onChange) {
      onChange(e);
    }
  };

  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="space-y-1.5 w-full">
      {label && <label className="block text-[10px] text-stone-400/80 font-medium tracking-wide mb-1 ml-1">{label}</label>}
      <div className="relative group flex items-center">
        <input
          type={inputType}
          autoComplete={isPassword ? 'new-password' : 'off'}
          className={`w-full px-3 py-2 bg-black/20 border border-white/5 rounded-lg text-stone-200 placeholder-stone-600 focus:outline-none focus:border-amber-500/50 focus:bg-black/40 focus:shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all duration-300 text-xs ${icon ? 'pl-9' : ''} ${isPassword ? 'pr-9' : ''} hover:border-white/10 ${className}`}
          value={localValue}
          onChange={handleChange}
          onFocus={(e) => { setIsFocused(true); if (onFocus) onFocus(e); }}
          onBlur={(e) => { setIsFocused(false); if (onBlur) onBlur(e); }}
          {...props}
        />
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[var(--color-accent-primary)] transition-colors">
            {icon}
          </div>
        )}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[var(--color-accent-primary)] transition-colors"
          >
            {showPassword ? <VscEyeClosed /> : <VscEye />}
          </button>
        )}
      </div>
    </div>
  );
});
CustomInput.displayName = 'CustomInput';

interface CustomTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const CustomTextarea: React.FC<CustomTextareaProps> = React.memo(({ label, className = '', value, onChange, onFocus, onBlur, ...props }) => {
  const { setIsFocused, localValue, reportChange } = useSyncedFieldValue(value, '');

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    reportChange(v);
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div className="space-y-1.5 w-full">
      {label && <label className="block text-[10px] text-stone-400/80 font-medium tracking-wide mb-1 ml-1">{label}</label>}
      <textarea
        className={`w-full px-3 py-2.5 bg-black/20 border border-white/5 rounded-lg text-stone-200 placeholder-stone-600 focus:outline-none focus:border-amber-500/50 focus:bg-black/40 focus:shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all duration-300 text-xs leading-relaxed resize-none hover:border-white/10 scrollbar-thin scrollbar-thumb-stone-800 scrollbar-track-transparent ${className}`}
        value={localValue}
        onChange={handleChange}
        onFocus={(e) => { setIsFocused(true); if (onFocus) onFocus(e); }}
        onBlur={(e) => { setIsFocused(false); if (onBlur) onBlur(e); }}
        {...props}
      />
    </div>
  );
});
CustomTextarea.displayName = 'CustomTextarea';
