import React, { InputHTMLAttributes } from 'react';
import { VscCheck } from 'react-icons/vsc';

interface CustomCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const CustomCheckbox: React.FC<CustomCheckboxProps> = ({ label, checked, className = '', ...props }) => {
  return (
    <label className={`flex items-center gap-2.5 cursor-pointer group w-fit ${className}`}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          {...props}
        />
        <div className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${checked ? 'bg-[var(--color-accent-primary)] border-[var(--color-accent-primary)]' : 'bg-[var(--color-brand-950)]/50 border-slate-600 group-hover:border-slate-500'}`}>
          {checked && <VscCheck className="text-white text-[12px] stroke-[1px]" />}
        </div>
      </div>
      <span className="text-sm text-slate-300 font-medium select-none group-hover:text-white transition-colors">{label}</span>
    </label>
  );
};
