import React, { InputHTMLAttributes, useState, useEffect, useRef } from 'react';

interface CustomColorInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const CustomColorInput: React.FC<CustomColorInputProps> = React.memo(({ label, className = '', value, onChange, ...props }) => {
  const [localValue, setLocalValue] = useState(value || '#000000');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value || '#000000');
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    
    if (e.persist) {
      e.persist();
    }

    if (onChange) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        onChange(e);
      }, 100);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</label>}
      <div className="flex items-center gap-3 bg-[var(--color-brand-950)]/50 border border-slate-700/50 rounded-md px-3 py-2.5 focus-within:border-[var(--color-accent-primary)] focus-within:ring-1 focus-within:ring-[var(--color-accent-primary)] transition-all">
        <div className="relative w-5 h-5 rounded overflow-hidden shrink-0 border border-slate-600/50">
          <input
            type="color"
            className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer border-none p-0 bg-transparent"
            value={localValue}
            onChange={handleChange}
            {...props}
          />
        </div>
        <input
          type="text"
          className={`bg-transparent border-none text-xs text-slate-200 focus:outline-none w-full font-mono uppercase ${className}`}
          value={localValue}
          onChange={handleChange}
          {...props}
        />
      </div>
    </div>
  );
});
CustomColorInput.displayName = 'CustomColorInput';
