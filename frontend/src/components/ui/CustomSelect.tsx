import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscChevronDown, VscCheck } from 'react-icons/vsc';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  icon?: React.ReactNode;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  label,
  options,
  value,
  onChange,
  className = '',
  icon
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      // If space below is less than 260px (height of dropdown with margins) 
      // and there's more space above, open upwards.
      if (spaceBelow < 260 && spaceAbove > spaceBelow) {
        setDropdownDirection('up');
      } else {
        setDropdownDirection('down');
      }
    }
  }, [isOpen]);

  return (
    <div className={`space-y-1.5 w-full relative ${isOpen ? 'z-50' : 'z-10'}`} ref={containerRef}>
      {label && <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}

      <div className="relative cursor-pointer">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full cursor-pointer flex items-center justify-between px-4 py-2.5 bg-[var(--color-brand-950)]/50 border ${isOpen ? 'border-[var(--color-accent-primary)] ring-1 ring-[var(--color-accent-primary)]' : 'border-slate-700/50'} rounded-md text-slate-200 focus:outline-none transition-all text-sm group ${className}`}
        >
          <div className="flex items-center gap-3 truncate">
            {icon && <span className="text-slate-500 group-hover:text-[var(--color-accent-primary)] transition-colors">{icon}</span>}
            <span className="truncate font-medium">{selectedOption?.label || 'Select an option...'}</span>
          </div>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-slate-500 ml-2 shrink-0"
          >
            <VscChevronDown />
          </motion.div>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: dropdownDirection === 'up' ? 10 : -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: dropdownDirection === 'up' ? 10 : -10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className={`absolute  z-50 w-full left-0 bg-[var(--color-brand-900)] border border-slate-700 shadow-2xl rounded-md overflow-hidden backdrop-blur-xl ${dropdownDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
                }`}
            >
              <div className="max-h-60  overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                {options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                      className={`w-full cursor-pointer flex items-center justify-between px-3 py-2.5 rounded-sm text-sm text-left transition-colors ${isSelected
                        ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-light)] font-bold'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white font-medium'
                        }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <VscCheck className="text-[var(--color-accent-primary)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
