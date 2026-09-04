import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as LucideIcons from 'lucide-react';
import { BsSearch, BsX } from 'react-icons/bs';
import { DynamicIcon } from '../../../components/video/DynamicIcon';

export interface IconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIcon: (iconName: string) => void;
  currentIcon?: string;
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Dynamically extract all exact unique Lucide icon names from the library
 * (ignoring duplicate 'Lucide...' prefixes and '...Icon' suffix aliases)
 */
const MASTER_ICON_REGISTRY: string[] = (() => {
  const names = new Set<string>();
  const ignore = new Set(['Icon', 'LucideIcon', 'createLucideIcon', 'default', 'icons']);
  for (const key of Object.keys(LucideIcons)) {
    if (
      /^[A-Z]/.test(key) &&
      !key.startsWith('Lucide') &&
      !key.endsWith('Icon') &&
      !ignore.has(key)
    ) {
      const val = (LucideIcons as any)[key];
      if (val && (typeof val === 'function' || typeof val === 'object')) {
        const kebab = toKebabCase(key);
        names.add(kebab);
      }
    }
  }
  return Array.from(names).sort();
})();

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  finance: ['dollar', 'coin', 'wallet', 'bank', 'credit', 'percent', 'receipt', 'piggy', 'scale', 'trending', 'chart', 'calculator', 'currency', 'vault'],
  security: ['shield', 'lock', 'unlock', 'key', 'fingerprint', 'gavel', 'siren', 'skull', 'flame', 'bomb', 'biohazard', 'radiation', 'alert', 'eye', 'crosshair', 'target', 'sword', 'axe', 'badge', 'spy', 'guard'],
  tech: ['database', 'server', 'cpu', 'code', 'terminal', 'globe', 'wifi', 'radio', 'cable', 'activity', 'zap', 'bot', 'binary', 'cloud', 'hard-drive', 'usb', 'bluetooth', 'laptop', 'monitor', 'smartphone', 'tablet', 'network', 'router', 'chip', 'qr-code', 'barcode', 'satellite', 'binary'],
  logistics: ['map', 'pin', 'navigation', 'compass', 'anchor', 'ship', 'plane', 'truck', 'car', 'bike', 'bus', 'train', 'package', 'container', 'box', 'luggage', 'fuel', 'road', 'ticket', 'rocket', 'navigation'],
  media: ['file', 'folder', 'newspaper', 'camera', 'video', 'mic', 'music', 'sparkles', 'play', 'pause', 'film', 'volume', 'image', 'headphones', 'clapperboard', 'radio', 'disc', 'tv', 'palette', 'wand', 'brush', 'speaker'],
  science: ['heart', 'pulse', 'atom', 'dna', 'flask', 'stethoscope', 'syringe', 'pill', 'thermometer', 'brain', 'microscope', 'test-tube', 'bed', 'cross', 'bone', 'activity', 'radiation'],
  nature: ['sun', 'moon', 'cloud', 'wind', 'rain', 'snowflake', 'flame', 'droplet', 'tree', 'flower', 'leaf', 'mountain', 'waves', 'fish', 'bird', 'cat', 'dog', 'bug', 'sunrise', 'sunset', 'sprout', 'feather'],
  ui: ['arrow', 'chevron', 'plus', 'minus', 'x', 'check', 'search', 'settings', 'menu', 'layers', 'sliders', 'filter', 'more', 'copy', 'trash', 'edit', 'share', 'download', 'upload', 'refresh', 'external-link', 'star', 'bookmark', 'user', 'users', 'grid', 'layout', 'bell'],
};

const CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: 'all', label: 'All Icons', icon: '✨' },
  { id: 'finance', label: 'Finance & Crypto', icon: '💰' },
  { id: 'security', label: 'Security & Law', icon: '🛡️' },
  { id: 'tech', label: 'Tech & Hardware', icon: '⚡' },
  { id: 'logistics', label: 'Travel & Logistics', icon: '🌍' },
  { id: 'media', label: 'Media & Arts', icon: '📰' },
  { id: 'science', label: 'Science & Health', icon: '🧬' },
  { id: 'nature', label: 'Nature & Climate', icon: '🌿' },
  { id: 'ui', label: 'UI & Controls', icon: '🎯' },
];

const INITIAL_PAGE_SIZE = 72;

export const IconPickerModal = ({
  isOpen,
  onClose,
  onSelectIcon,
  currentIcon = 'trending-up',
}: IconPickerModalProps) => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [displayLimit, setDisplayLimit] = useState(INITIAL_PAGE_SIZE);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActiveCategory('all');
      setDisplayLimit(INITIAL_PAGE_SIZE);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fast in-memory filter across all ~1,500+ Lucide icons
  const filteredIcons = useMemo(() => {
    const q = query.toLowerCase().trim();
    const catKeywords = activeCategory !== 'all' ? CATEGORY_KEYWORDS[activeCategory] || [] : null;

    return MASTER_ICON_REGISTRY.filter(name => {
      // Category filter
      if (catKeywords) {
        const matchesCategory = catKeywords.some(kw => name.includes(kw));
        if (!matchesCategory) return false;
      }

      // Query filter
      if (!q) return true;
      if (name.includes(q)) return true;

      // Match multi-word query tokens (e.g. "arrow up" -> "arrow-up")
      const tokens = q.split(/[\s-_]+/);
      return tokens.every(tok => name.includes(tok));
    });
  }, [query, activeCategory]);

  const visibleIcons = filteredIcons.slice(0, displayLimit);
  const hasMore = displayLimit < filteredIcons.length;

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] relative z-[10000]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 bg-stone-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
              <DynamicIcon name="sparkles" size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-100 flex items-center gap-2">
                <span>Lucide Vector Icon Catalog</span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-mono font-normal">
                  {MASTER_ICON_REGISTRY.length}+ Icons
                </span>
              </h3>
              <p className="text-xs text-stone-400">
                Complete official library available for Remotion canvas & AI generation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors cursor-pointer"
          >
            <BsX size={20} />
          </button>
        </div>

        {/* Search Bar & Categories */}
        <div className="p-4 border-b border-stone-800/80 bg-stone-950/40 space-y-2.5">
          <div className="relative flex items-center">
            <BsSearch className="absolute left-3.5 text-stone-500" size={14} />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setDisplayLimit(INITIAL_PAGE_SIZE);
              }}
              placeholder="Search 1,500+ vector icons (e.g. 'brain', 'rocket', 'dollar', 'atom', 'car', 'chart')..."
              className="w-full bg-stone-900 border border-stone-700/60 rounded-xl pl-9 pr-4 py-2 text-xs text-stone-200 placeholder-stone-500 focus:outline-none focus:border-amber-500/60 font-mono transition-colors"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setDisplayLimit(INITIAL_PAGE_SIZE);
                }}
                className="absolute right-3 text-stone-500 hover:text-stone-300 text-xs cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  setDisplayLimit(INITIAL_PAGE_SIZE);
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 flex items-center gap-1 border ${
                  activeCategory === cat.id
                    ? 'bg-amber-500 text-black border-amber-500 shadow-sm font-extrabold'
                    : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Icons Grid with 60fps Windowed Display */}
        <div className="p-4 overflow-y-auto flex-1 max-h-[400px] space-y-3">
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
            {visibleIcons.map((iconName) => {
              const isSelected = currentIcon === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => {
                    onSelectIcon(iconName);
                    onClose();
                  }}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all cursor-pointer group ${
                    isSelected
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm'
                      : 'bg-stone-950/40 border-stone-800/80 hover:border-amber-500/40 hover:bg-stone-800/60 text-stone-300'
                  }`}
                  title={iconName}
                >
                  <div className="w-8 h-8 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <DynamicIcon name={iconName} size={24} color={isSelected ? '#f59e0b' : '#00d4ff'} />
                  </div>
                  <span className="text-[10px] font-mono text-stone-400 group-hover:text-stone-200 truncate w-full text-center mt-2">
                    {iconName}
                  </span>
                </button>
              );
            })}
          </div>

          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setDisplayLimit(prev => prev + 72)}
                className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
              >
                Load More Icons ({filteredIcons.length - displayLimit} remaining)
              </button>
            </div>
          )}

          {filteredIcons.length === 0 && (
            <div className="py-12 text-center text-stone-500 text-xs">
              No matching icons found for "{query}".
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 bg-stone-900/60 flex items-center justify-between text-[11px] text-stone-500">
          <span>{filteredIcons.length} of {MASTER_ICON_REGISTRY.length} icons available</span>
          <span>Click any icon to apply directly to Remotion player</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
