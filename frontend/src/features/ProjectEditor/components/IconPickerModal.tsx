import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BsSearch, BsX } from 'react-icons/bs';
import { DynamicIcon } from '../../../components/video/DynamicIcon';

export interface IconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectIcon: (iconName: string) => void;
  currentIcon?: string;
}

export interface LucideIconEntry {
  name: string;
  category: 'finance' | 'security' | 'tech' | 'geo' | 'media' | 'status' | 'business' | 'social' | 'ui';
  tags: string[];
}

export const ALL_LUCIDE_ICONS: LucideIconEntry[] = [
  // Finance, Economy, Crypto & Growth
  { name: 'trending-up', category: 'finance', tags: ['growth', 'profit', 'bull', 'stock', 'increase', 'rise', 'market', 'success', 'chart', 'metrics'] },
  { name: 'trending-down', category: 'finance', tags: ['loss', 'drop', 'bear', 'crash', 'decrease', 'fall', 'decline', 'recession', 'bankruptcy'] },
  { name: 'dollar-sign', category: 'finance', tags: ['money', 'currency', 'cash', 'wealth', 'usd', 'cost', 'price', 'revenue', 'capital'] },
  { name: 'coins', category: 'finance', tags: ['crypto', 'tokens', 'gold', 'change', 'savings', 'investment', 'bitcoin'] },
  { name: 'wallet', category: 'finance', tags: ['money', 'funds', 'balance', 'crypto-wallet', 'payment', 'bank'] },
  { name: 'banknote', category: 'finance', tags: ['cash', 'paper-money', 'currency', 'bill', 'payment'] },
  { name: 'landmark', category: 'finance', tags: ['bank', 'institution', 'federal', 'government', 'treasury', 'central-bank'] },
  { name: 'credit-card', category: 'finance', tags: ['payment', 'visa', 'mastercard', 'charge', 'debit', 'transaction', 'swipe'] },
  { name: 'scale', category: 'finance', tags: ['balance', 'justice', 'law', 'comparison', 'weigh', 'equality', 'court'] },
  { name: 'piggy-bank', category: 'finance', tags: ['savings', 'deposit', 'investment', 'accumulate'] },
  { name: 'percent', category: 'finance', tags: ['percentage', 'discount', 'interest', 'rate', 'inflation', 'tax'] },
  { name: 'receipt', category: 'finance', tags: ['bill', 'invoice', 'proof', 'accounting', 'statement'] },

  // Security, Law, Defense & Investigation
  { name: 'shield-alert', category: 'security', tags: ['threat', 'breach', 'warning', 'cyberattack', 'danger', 'vulnerability', 'hack'] },
  { name: 'shield-check', category: 'security', tags: ['safe', 'verified', 'protected', 'secure', 'passed', 'compliance'] },
  { name: 'shield', category: 'security', tags: ['armor', 'defense', 'protection', 'guard', 'security'] },
  { name: 'lock', category: 'security', tags: ['private', 'encrypted', 'confidential', 'secure', 'locked', 'classified'] },
  { name: 'unlock', category: 'security', tags: ['leak', 'decrypted', 'exposed', 'open', 'unlocked', 'breached'] },
  { name: 'key', category: 'security', tags: ['access', 'credential', 'auth', 'crypto-key', 'secret', 'password'] },
  { name: 'fingerprint', category: 'security', tags: ['biometrics', 'identity', 'forensics', 'evidence', 'dna'] },
  { name: 'gavel', category: 'security', tags: ['court', 'judge', 'ruling', 'lawsuit', 'verdict', 'trial', 'legal', 'justice'] },
  { name: 'siren', category: 'security', tags: ['police', 'alarm', 'emergency', 'raid', 'alert', 'danger'] },
  { name: 'skull', category: 'security', tags: ['fatal', 'toxic', 'poison', 'lethal', 'piracy', 'death', 'danger'] },
  { name: 'flame', category: 'security', tags: ['fire', 'burn', 'destruction', 'hot', 'trending', 'crisis'] },
  { name: 'bomb', category: 'security', tags: ['explosion', 'blast', 'attack', 'terror', 'critical'] },
  { name: 'biohazard', category: 'security', tags: ['virus', 'pathogen', 'biological', 'infection', 'epidemic'] },
  { name: 'radiation', category: 'security', tags: ['nuclear', 'atomic', 'fallout', 'reactor', 'radioactive'] },

  // Tech, Data, Cloud & Engineering
  { name: 'database', category: 'tech', tags: ['storage', 'data', 'records', 'sql', 'warehouse', 'leak', 'archive'] },
  { name: 'server', category: 'tech', tags: ['infrastructure', 'datacenter', 'hosting', 'cloud', 'backend', 'hardware'] },
  { name: 'cpu', category: 'tech', tags: ['processor', 'chip', 'semiconductor', 'silicon', 'hardware', 'ai-chip', 'nvidia'] },
  { name: 'code', category: 'tech', tags: ['software', 'programming', 'developer', 'script', 'algorithm', 'source'] },
  { name: 'terminal', category: 'tech', tags: ['cli', 'console', 'command', 'bash', 'hack', 'prompt'] },
  { name: 'globe', category: 'tech', tags: ['world', 'global', 'internet', 'network', 'worldwide', 'earth', 'international'] },
  { name: 'wifi', category: 'tech', tags: ['wireless', 'signal', 'internet', 'broadband', 'connectivity'] },
  { name: 'radio', category: 'tech', tags: ['broadcast', 'frequency', 'telecom', 'signal', 'transmission'] },
  { name: 'cable', category: 'tech', tags: ['wire', 'fiber', 'submarine', 'optical', 'connection', 'infrastructure'] },
  { name: 'activity', category: 'tech', tags: ['pulse', 'heartbeat', 'monitoring', 'traffic', 'telemetry', 'frequency'] },
  { name: 'zap', category: 'tech', tags: ['electricity', 'power', 'energy', 'instant', 'lightning', 'speed', 'fast'] },
  { name: 'bot', category: 'tech', tags: ['ai', 'robot', 'automation', 'llm', 'agent', 'synthetic'] },
  { name: 'binary', category: 'tech', tags: ['data', 'bits', 'code', 'digital', 'machine'] },

  // Geography, Maritime & Logistics
  { name: 'map-pin', category: 'geo', tags: ['location', 'place', 'city', 'target', 'coordinate', 'gps', 'destination'] },
  { name: 'navigation', category: 'geo', tags: ['route', 'compass', 'direction', 'gps', 'travel', 'waypoint'] },
  { name: 'compass', category: 'geo', tags: ['direction', 'orientation', 'north', 'maritime', 'navigation'] },
  { name: 'anchor', category: 'geo', tags: ['ship', 'ocean', 'maritime', 'seabed', 'port', 'vessel', 'naval'] },
  { name: 'ship', category: 'geo', tags: ['vessel', 'cargo', 'tanker', 'container', 'freight', 'maritime', 'ocean'] },
  { name: 'plane', category: 'geo', tags: ['flight', 'aviation', 'travel', 'international', 'airline', 'transport'] },
  { name: 'truck', category: 'geo', tags: ['transport', 'delivery', 'shipping', 'supply-chain', 'cargo'] },
  { name: 'package', category: 'geo', tags: ['box', 'cargo', 'goods', 'shipping', 'container', 'delivery'] },
  { name: 'container', category: 'geo', tags: ['freight', 'intermodal', 'shipping', 'trade', 'cargo'] },

  // Media, Document & Journalism
  { name: 'file-text', category: 'media', tags: ['document', 'memo', 'report', 'paper', 'contract', 'dossier', 'leak'] },
  { name: 'folder', category: 'media', tags: ['directory', 'classified', 'archive', 'collection', 'files'] },
  { name: 'newspaper', category: 'media', tags: ['press', 'journalism', 'headline', 'news', 'investigation', 'article'] },
  { name: 'camera', category: 'media', tags: ['photo', 'footage', 'surveillance', 'evidence', 'record', 'lens'] },
  { name: 'video', category: 'media', tags: ['film', 'clip', 'footage', 'broadcast', 'stream', 'cctv'] },
  { name: 'mic', category: 'media', tags: ['audio', 'voice', 'podcast', 'interview', 'wiretap', 'recording'] },
  { name: 'eye', category: 'media', tags: ['surveillance', 'vision', 'watch', 'view', 'witness', 'look', 'spy'] },
  { name: 'eye-off', category: 'media', tags: ['covert', 'hidden', 'secret', 'invisible', 'blindspot', 'censored'] },
  { name: 'sparkles', category: 'media', tags: ['ai', 'magic', 'highlight', 'new', 'special', 'effect', 'clean'] },

  // Alerts, Status & General Icons
  { name: 'alert-triangle', category: 'status', tags: ['warning', 'caution', 'alert', 'issue', 'problem', 'danger'] },
  { name: 'alert-circle', category: 'status', tags: ['error', 'info', 'notice', 'attention', 'alert'] },
  { name: 'alert-octagon', category: 'status', tags: ['stop', 'critical', 'halt', 'emergency', 'danger'] },
  { name: 'check-circle', category: 'status', tags: ['success', 'approved', 'verified', 'done', 'resolved', 'completed'] },
  { name: 'check', category: 'status', tags: ['tick', 'confirm', 'yes', 'correct', 'true'] },
  { name: 'x-circle', category: 'status', tags: ['error', 'fail', 'rejected', 'cancel', 'wrong', 'denied'] },
  { name: 'clock', category: 'status', tags: ['time', 'delay', 'history', 'duration', 'timeline', 'schedule', 'chronological'] },
  { name: 'calendar', category: 'status', tags: ['date', 'year', 'event', 'milestone', 'schedule'] },
  { name: 'target', category: 'status', tags: ['goal', 'objective', 'aim', 'crosshair', 'hit', 'mission'] },
  { name: 'crosshair', category: 'status', tags: ['aim', 'focus', 'sniper', 'locate', 'target', 'tracking'] },
  { name: 'award', category: 'status', tags: ['trophy', 'prize', 'medal', 'achievement', 'victory', 'winner'] },
  { name: 'briefcase', category: 'business', tags: ['business', 'corporate', 'executive', 'job', 'company', 'career'] },
  { name: 'building', category: 'business', tags: ['headquarters', 'company', 'corporation', 'office', 'bank', 'firm'] },
  { name: 'users', category: 'social', tags: ['people', 'crowd', 'population', 'team', 'network', 'community', 'public'] },
  { name: 'user', category: 'social', tags: ['person', 'individual', 'ceo', 'whistleblower', 'founder', 'suspect'] },
  { name: 'search', category: 'ui', tags: ['find', 'investigate', 'explore', 'query', 'lookup', 'zoom', 'magnifier'] },
  { name: 'layers', category: 'ui', tags: ['stack', 'depth', 'composite', 'structure', 'multi-layer', 'hierarchy'] },
  { name: 'refresh-cw', category: 'ui', tags: ['sync', 'reload', 'update', 'loop', 'cycle', 'rotate'] },
  { name: 'arrow-up-right', category: 'ui', tags: ['external', 'growth', 'jump', 'link', 'surge'] },
  { name: 'arrow-down-right', category: 'ui', tags: ['drop', 'plunge', 'collapse', 'decline'] },
  { name: 'help-circle', category: 'ui', tags: ['question', 'mystery', 'unsolved', 'inquiry', 'doubt'] },
];

const CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '✨' },
  { id: 'finance', label: 'Finance', icon: '💰' },
  { id: 'security', label: 'Security & Law', icon: '🛡️' },
  { id: 'tech', label: 'Tech & Cloud', icon: '⚡' },
  { id: 'geo', label: 'Geo & Shipping', icon: '🌍' },
  { id: 'media', label: 'Media & Docs', icon: '📰' },
  { id: 'status', label: 'Status & Badges', icon: '🎯' },
];

export const IconPickerModal = ({
  isOpen,
  onClose,
  onSelectIcon,
  currentIcon = 'trending-up',
}: IconPickerModalProps) => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActiveCategory('all');
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

  // Fast in-memory semantic search & category filtering
  const filteredIcons = useMemo(() => {
    const q = query.toLowerCase().trim();
    return ALL_LUCIDE_ICONS.filter(icon => {
      // Category filter
      if (activeCategory !== 'all') {
        if (activeCategory === 'status') {
          if (!['status', 'business', 'social', 'ui'].includes(icon.category)) return false;
        } else if (icon.category !== activeCategory) {
          return false;
        }
      }

      // Query filter (exact match, token match, or tag match)
      if (!q) return true;
      if (icon.name.toLowerCase().includes(q)) return true;
      if (icon.tags.some(tag => tag.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query, activeCategory]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] relative z-[10000]"
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
              <p className="text-xs text-stone-400">
                {ALL_LUCIDE_ICONS.length} production vector icons ready for Remotion rendering
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

        {/* Search Bar */}
        <div className="p-4 border-b border-stone-800/80 bg-stone-950/40 space-y-2.5">
          <div className="relative flex items-center">
            <BsSearch className="absolute left-3.5 text-stone-500" size={14} />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search icons (e.g. 'profit', 'cyberattack', 'dollar', 'ocean', 'ship')..."
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

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 flex items-center gap-1 border ${
                  activeCategory === cat.id
                    ? 'bg-amber-500 text-black border-amber-500 shadow-sm'
                    : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Icons Grid */}
        <div className="p-4 overflow-y-auto flex-1 max-h-[380px] grid grid-cols-4 sm:grid-cols-6 gap-2.5">
          {filteredIcons.map((icon) => {
            const isSelected = currentIcon === icon.name;
            return (
              <button
                key={icon.name}
                type="button"
                onClick={() => {
                  onSelectIcon(icon.name);
                  onClose();
                }}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all cursor-pointer group ${
                  isSelected
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm'
                    : 'bg-stone-950/40 border-stone-800/80 hover:border-amber-500/40 hover:bg-stone-800/60 text-stone-300'
                }`}
                title={`${icon.name} (${icon.tags.join(', ')})`}
              >
                <div className="w-8 h-8 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <DynamicIcon name={icon.name} size={24} color={isSelected ? '#f59e0b' : '#00d4ff'} />
                </div>
                <span className="text-[10px] font-mono text-stone-400 group-hover:text-stone-200 truncate w-full text-center mt-2">
                  {icon.name}
                </span>
              </button>
            );
          })}

          {filteredIcons.length === 0 && (
            <div className="col-span-full py-12 text-center text-stone-500 text-xs">
              No matching icons found for "{query}".
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 bg-stone-900/60 flex items-center justify-between text-[11px] text-stone-500">
          <span>{filteredIcons.length} of {ALL_LUCIDE_ICONS.length} icons available</span>
          <span>Click any icon to apply directly to Remotion player</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
