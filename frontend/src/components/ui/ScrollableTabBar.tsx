import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedTabs, Tab } from './AnimatedTabs';
import { VscChevronLeft, VscChevronRight } from 'react-icons/vsc';

interface ScrollableTabBarProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const ScrollableTabBar: React.FC<ScrollableTabBarProps> = React.memo(({
  tabs, activeTab, onChange, className
}) => {
  const id = React.useId();
  const layoutId = `scrollable-tab-${id}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isNearEdge, setIsNearEdge] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = 160;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  // Keep scroll buttons visible while actively scrolling
  const handleScroll = useCallback(() => {
    setIsNearEdge(true);
    updateScrollState();
  }, [updateScrollState]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsNearEdge(true)}
      onMouseLeave={() => setIsNearEdge(false)}
    >
      {/* Left gradient fade + scroll button */}
      <AnimatePresence>
        {canScrollLeft && (
          <>
            {/* Gradient mask */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute left-0 top-0 bottom-0 w-12 z-10 pointer-events-none bg-gradient-to-r from-[var(--color-brand-900)]/90 to-transparent"
            />
            {/* Scroll button */}
            <motion.button
              initial={{ opacity: 0, x: -8, scale: 0.9 }}
              animate={{ opacity: isNearEdge ? 1 : 0.6, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.9 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={() => scroll('left')}
              onMouseEnter={() => setIsNearEdge(true)}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-7 h-9 flex items-center justify-center rounded-md
                bg-black/50 backdrop-blur-md
                border border-white/10
                text-zinc-400
                hover:text-white hover:bg-[var(--color-accent-primary)]/30 hover:border-[var(--color-accent-primary)]/40
                active:scale-95
                transition-colors
                shadow-lg shadow-black/30
                cursor-pointer"
            >
              <VscChevronLeft className="text-xs" />
            </motion.button>
          </>
        )}
      </AnimatePresence>

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-x-auto scrollbar-none overscroll-x-contain"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="px-2 pt-2 min-w-max">
          <AnimatedTabs
            tabs={tabs}
            activeTab={activeTab}
            onChange={onChange}
            className={className}
            layoutId={layoutId}
          />
        </div>
      </div>

      {/* Right gradient fade + scroll button */}
      <AnimatePresence>
        {canScrollRight && (
          <>
            {/* Gradient mask */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-0 bottom-0 w-12 z-10 pointer-events-none bg-gradient-to-l from-[var(--color-brand-900)]/90 to-transparent"
            />
            {/* Scroll button */}
            <motion.button
              initial={{ opacity: 0, x: 8, scale: 0.9 }}
              animate={{ opacity: isNearEdge ? 1 : 0.6, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.9 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={() => scroll('right')}
              onMouseEnter={() => setIsNearEdge(true)}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-7 h-9 flex items-center justify-center rounded-md
                bg-black/50 backdrop-blur-md
                border border-white/10
                text-zinc-400
                hover:text-white hover:bg-[var(--color-accent-primary)]/30 hover:border-[var(--color-accent-primary)]/40
                active:scale-95
                transition-colors
                shadow-lg shadow-black/30
                cursor-pointer"
            >
              <VscChevronRight className="text-xs" />
            </motion.button>
          </>
        )}
      </AnimatePresence>
    </div>
  );
});
ScrollableTabBar.displayName = 'ScrollableTabBar';
