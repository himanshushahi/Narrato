import React, { InputHTMLAttributes } from 'react';

interface CustomRangeProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  valueDisplay?: string | React.ReactNode;
}

export const CustomRange: React.FC<CustomRangeProps> = ({ 
  label, 
  valueDisplay, 
  className = '', 
  ...props 
}) => {
  return (
    <div className="space-y-2 w-full">
      <div className="flex justify-between items-end">
        {label && <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}
        {valueDisplay !== undefined && <span className="text-[10px] text-slate-300 font-bold">{valueDisplay}</span>}
      </div>
      <div className="relative group flex items-center py-2">
        <input
          type="range"
          className={`w-full h-1.5 bg-[var(--color-brand-950)] border border-slate-700/30 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)] hover:accent-[var(--color-accent-light)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 transition-all ${className}`}
          {...props}
        />
      </div>
    </div>
  );
};
