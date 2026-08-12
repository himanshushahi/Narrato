import React from 'react';

export interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  displayValue?: string;
  onChange: (v: number) => void;
}

export const SliderField: React.FC<SliderFieldProps> = React.memo(({
  label,
  value,
  min,
  max,
  step,
  unit,
  displayValue,
  onChange,
}) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center text-xs mb-1.5">
      <label className="text-stone-400/80 font-medium tracking-wide">{label}</label>
      <span className="text-amber-500 font-mono font-bold text-[11px] bg-black/30 px-2 py-0.5 rounded border border-white/5 shadow-inner">
        {displayValue ?? `${value}${unit ?? ''}`}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all shadow-inner border border-white/5"
    />
  </div>
));
SliderField.displayName = 'SliderField';

