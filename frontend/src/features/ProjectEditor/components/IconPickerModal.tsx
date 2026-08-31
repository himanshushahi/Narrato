import { useState, useEffect } from 'react';
import { BsSearch, BsX } from 'react-icons/bs';
import { DynamicIcon } from '../../../components/video/DynamicIcon';

export interface IconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIcon: (iconName: string) => void;
  currentIcon?: string;
}

const DEFAULT_POPULAR_ICONS = [
  'trending-up', 'trending-down', 'dollar-sign', 'coins', 'wallet', 'landmark',
  'shield-alert', 'shield-check', 'shield', 'lock', 'unlock', 'gavel', 'skull', 'flame',
  'database', 'server', 'cpu', 'code', 'terminal', 'globe', 'wifi', 'zap', 'bot',
  'map-pin', 'navigation', 'compass', 'anchor', 'ship', 'plane',
  'file-text', 'newspaper', 'camera', 'video', 'mic', 'eye', 'sparkles',
  'alert-triangle', 'alert-circle', 'check-circle', 'clock', 'calendar', 'target', 'award',
  'briefcase', 'building', 'users', 'user', 'layers'
];

export const IconPickerModal = ({
  isOpen,
  onClose,
  onSelectIcon,
  currentIcon = 'trending-up',
}: IconPickerModalProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>(DEFAULT_POPULAR_ICONS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults(DEFAULT_POPULAR_ICONS);
      return;
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

  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setResults(DEFAULT_POPULAR_ICONS);
      return;
    }

    setLoading(true);
    let active = true;

    // Check pywebview bridge or HTTP API endpoint
    const pywebviewApi = (window as any).pywebview?.api;
    if (pywebviewApi?.search_lucide_icons) {
      pywebviewApi.search_lucide_icons(trimmed, 36)
        .then((res: any) => {
          if (active) {
            if (res && res.success && Array.isArray(res.data)) {
              setResults(res.data.map((item: any) => item.name || item));
            }
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });
      return () => { active = false; };
    }

    // Fallback to local file server API
    const baseUrl = (window as any).__file_server_port__ ? `http://127.0.0.1:${(window as any).__file_server_port__}` : '';
    fetch(`${baseUrl}/api/icons/search?q=${encodeURIComponent(trimmed)}&limit=36`)
      .then(res => res.json())
      .then(data => {
        if (active) {
          if (data && Array.isArray(data.icons)) {
            setResults(data.icons.map((item: any) => item.name || item));
          }
          setLoading(false);
        }
      })
      .catch(() => {
        // Fallback local filter
        if (active) {
          const filtered = DEFAULT_POPULAR_ICONS.filter(name =>
            name.toLowerCase().includes(trimmed.toLowerCase())
          );
          setResults(filtered);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [query, isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 bg-stone-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
              <DynamicIcon name="sparkles" size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-100">Lucide Vector Icon Catalog</h3>
              <p className="text-xs text-stone-400">Search keywords (e.g. "growth", "security", "dollar", "ocean")</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors cursor-pointer"
          >
            <BsX size={20} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-stone-800/80 bg-stone-950/40">
          <div className="relative flex items-center">
            <BsSearch className="absolute left-3.5 text-stone-500" size={14} />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search icons by keyword or concept..."
              className="w-full bg-stone-900 border border-stone-700/60 rounded-xl pl-9 pr-4 py-2 text-xs text-stone-200 placeholder-stone-500 focus:outline-none focus:border-amber-500/60 font-mono transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 text-stone-500 hover:text-stone-300 text-xs cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Icons Grid */}
        <div className="p-4 overflow-y-auto flex-1 max-h-[380px] grid grid-cols-4 sm:grid-cols-6 gap-2.5">
          {results.map((iconName) => {
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

          {results.length === 0 && !loading && (
            <div className="col-span-full py-12 text-center text-stone-500 text-xs">
              No matching icons found for "{query}".
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 bg-stone-900/60 flex items-center justify-between text-[11px] text-stone-500">
          <span>{results.length} icons found</span>
          <span>Click any icon to select</span>
        </div>
      </div>
    </div>
  );
};
