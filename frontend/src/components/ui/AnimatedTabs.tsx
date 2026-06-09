import React from 'react';
import { motion } from 'framer-motion';

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface AnimatedTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
  layoutId?: string;
}

export const AnimatedTabs: React.FC<AnimatedTabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = '',
  layoutId = 'active-tab-indicator'
}) => {
  return (
    <div className={`flex space-x-1 p-1 bg-[var(--color-brand-800)]/50 border border-slate-800/50 rounded-lg backdrop-blur-md ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            type="button"
            disabled={isDisabled}
            onClick={() => {
              if (!isDisabled) {
                onChange(tab.id);
              }
            }}
            className={`relative flex cursor-pointer items-center justify-center gap-2 flex-1 px-3 py-2 text-xs font-semibold tracking-wide rounded-md transition-colors outline-none whitespace-nowrap
              ${isDisabled
                ? 'opacity-40 cursor-not-allowed text-slate-500'
                : isActive
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }
            `}
          >
            {isActive && !isDisabled && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-[var(--color-accent-primary)] border border-[var(--color-accent-hover)] rounded-md shadow-sm"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {tab.icon && <span className={isActive && !isDisabled ? 'text-white' : 'text-current'}>{tab.icon}</span>}
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};
