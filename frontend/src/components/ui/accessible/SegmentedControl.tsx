import React, { memo, useRef } from 'react';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (val: T) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export const SegmentedControl = memo(<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  disabled = false,
  className = '',
}: SegmentedControlProps<T>) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (disabled || !options || options.length === 0) return;
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = options.length - 1;
    }

    if (nextIndex !== currentIndex) {
      onChange(options[nextIndex].value);
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[nextIndex]?.focus();
    }
  };

  const hasSelection = options.some(opt => opt.value === value);

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block select-none">
          {label}
        </span>
      )}
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={label || 'Select option'}
        className={`flex items-center gap-0.5 p-0.5 bg-zinc-950/80 border border-zinc-800 rounded-lg ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        {options.map((opt, idx) => {
          const isSelected = opt.value === value;
          const isFocusable = isSelected || (!hasSelection && idx === 0);
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isFocusable ? 0 : -1}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              title={opt.hint || opt.label}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md font-bold transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${
                size === 'sm' ? 'py-1 px-1.5 text-[10px]' : 'py-1.5 px-2.5 text-xs'
              } ${
                isSelected
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {opt.icon && <span className="shrink-0">{opt.icon}</span>}
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}) as <T extends string>(props: SegmentedControlProps<T>) => React.ReactElement;

(SegmentedControl as any).displayName = 'SegmentedControl';
