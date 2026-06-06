import React, { InputHTMLAttributes } from 'react';

interface CustomToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const CustomToggle: React.FC<CustomToggleProps> = ({ label, checked, className = '', ...props }) => {
  return (
    <label className={`flex items-center gap-3 cursor-pointer group w-fit bg-stone-900 border border-stone-800 rounded-full px-3 py-1.5 transition-colors hover:border-stone-700 ${className}`}>
      <span className="text-[10px] uppercase font-bold text-stone-400 select-none group-hover:text-stone-300 transition-colors">{label}</span>
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          {...props}
        />
        <div className={`block w-8 h-4 rounded-full transition-colors ${checked ? 'bg-[var(--color-accent-primary)]' : 'bg-stone-700'}`}></div>
        <div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}></div>
      </div>
    </label>
  );
};
