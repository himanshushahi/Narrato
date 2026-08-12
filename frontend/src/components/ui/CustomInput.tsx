import React, { InputHTMLAttributes, TextareaHTMLAttributes, useState, useEffect, useRef } from 'react';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';

interface CustomInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
}

export const CustomInput: React.FC<CustomInputProps> = React.memo(({ label, icon, className = '', type, value, onChange, onFocus, onBlur, ...props }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState(value ?? '');
  const lastReportedRef = useRef(value ?? '');

  // Keep the input in sync with external value changes (AI rewrites, resets,
  // async updates) without clobbering the user's own typing: only resync when
  // the prop value differs from the last value this input reported. The focus
  // guard is essential: a parent that transforms or debounces its updates
  // (e.g. stores parseFloat(v)) echoes a value that differs from what we
  // reported, and syncing to it while the user is typing would strip
  // characters mid-keystroke.
  useEffect(() => {
    if (!isFocused && value !== lastReportedRef.current) {
      setLocalValue(value ?? '');
      lastReportedRef.current = value ?? '';
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    lastReportedRef.current = v;
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
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState(value ?? '');
  const lastReportedRef = useRef(value ?? '');

  // Same external-sync rule as CustomInput: resync only when the prop value
  // differs from the last value this textarea reported, and never while the
  // user is typing (a transforming/debouncing parent would otherwise echo a
  // value that differs from what we reported and clobber in-flight text).
  useEffect(() => {
    if (!isFocused && value !== lastReportedRef.current) {
      setLocalValue(value ?? '');
      lastReportedRef.current = value ?? '';
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    lastReportedRef.current = v;
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
