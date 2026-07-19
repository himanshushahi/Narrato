import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

export const CustomSelect: React.FC<CustomSelectProps> = React.memo(({
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

  const [rect, setRect] = useState<DOMRect | null>(null);

  const updateRect = () => {
    if (containerRef.current) {
      setRect(containerRef.current.getBoundingClientRect());
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Don't close if clicking inside the portal dropdown
      if (
        (containerRef.current && containerRef.current.contains(e.target as Node)) ||
        (e.target as Element).closest('.custom-select-dropdown')
      ) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateRect();
      window.addEventListener('scroll', updateRect, true);
      window.addEventListener('resize', updateRect);
      return () => {
        window.removeEventListener('scroll', updateRect, true);
        window.removeEventListener('resize', updateRect);
      };
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && rect) {
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
  }, [isOpen, rect]);

  return (
    <div className={`space-y-1.5 w-full relative ${isOpen ? 'z-50' : 'z-10'}`} ref={containerRef}>
      {label && <label className="block text-[10px] text-stone-400/80 font-medium tracking-wide mb-1 ml-1">{label}</label>}

      <div className="relative cursor-pointer">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full cursor-pointer flex items-center justify-between px-3 py-2 bg-black/20 border ${isOpen ? 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)] bg-black/40' : 'border-white/5 hover:border-white/10'} rounded-lg text-stone-200 focus:outline-none transition-all duration-300 text-xs group ${className}`}
        >
          <div className="flex items-center gap-3 truncate">
            {icon && <span className="text-slate-500 group-hover:text-[var(--color-accent-primary)] transition-colors">{icon}</span>}
            <span className="truncate font-medium">{selectedOption?.label || 'Select an option...'}</span>
          </div>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className={`ml-2 shrink-0 transition-colors duration-300 ${isOpen ? 'text-amber-500' : 'text-stone-500 group-hover:text-stone-400'}`}
          >
            <VscChevronDown />
          </motion.div>
        </button>

        {createPortal(
          <AnimatePresence>
            {isOpen && rect && (
              <motion.div
                initial={{ opacity: 0, y: dropdownDirection === 'up' ? 10 : -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: dropdownDirection === 'up' ? 10 : -10, scale: 0.95 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: 'fixed',
                  top: dropdownDirection === 'down' ? rect.bottom + 8 : undefined,
                  bottom: dropdownDirection === 'up' ? window.innerHeight - rect.top + 8 : undefined,
                  left: rect.left,
                  width: rect.width,
                  zIndex: 99999,
                }}
                className="custom-select-dropdown bg-stone-950/90 border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-lg overflow-hidden backdrop-blur-xl"
              >
                <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
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
                        className={`w-full cursor-pointer flex items-center justify-between px-3 py-2 rounded-md text-xs text-left transition-colors duration-200 ${isSelected
                          ? 'bg-amber-500/20 text-amber-400 font-bold'
                          : 'text-stone-300 hover:bg-white/5 hover:text-white font-medium'
                          }`}
                      >
                        <span className="truncate">{opt.label}</span>
                        {isSelected && <VscCheck className="text-amber-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>
    </div>
  );
});
CustomSelect.displayName = 'CustomSelect';
