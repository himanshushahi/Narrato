import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CustomSelect } from '../../components/ui/CustomSelect';

const SECTION_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'National', label: 'National' },
  { value: 'International', label: 'International' },
  { value: 'Business', label: 'Business' },
  { value: 'Technology', label: 'Technology' },
  { value: 'Science', label: 'Science' },
  { value: 'Politics', label: 'Politics' },
  { value: 'Opinion', label: 'Opinion' },
  { value: 'Culture', label: 'Culture' },
  { value: 'Sports', label: 'Sports' },
];

interface NewspaperEditorProps {
  visualMeta: any;
  onChange: (newMeta: any) => void;
}

export const NewspaperEditor = ({ visualMeta, onChange }: NewspaperEditorProps) => {
  const [expanded, setExpanded] = useState(false);

  const update = (key: string, value: any) => {
    onChange({ ...visualMeta, [key]: value });
  };

  return (
    <div className="col-span-2 space-y-5 mt-3 pt-3 border-t border-white/5">
      <div className="flex justify-between items-center">
        <label className="text-stone-400/80 font-medium tracking-wide text-xs">
          🗞️ Newspaper Editor
        </label>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md text-stone-300 transition-colors cursor-pointer"
        >
          {expanded ? 'Collapse' : 'Expand All'}
        </button>
      </div>

      {/* === HEADER SECTION === */}
      <div className="space-y-3">
        <div className="text-[10px] text-amber-500/80 uppercase tracking-wider font-bold border-b border-white/5 pb-1">Header</div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Masthead Title</label>
            <input
              type="text"
              value={visualMeta?.title || ''}
              onChange={(e) => update('title', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="THE CLASSIFIED ARCHIVES"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Subtitle</label>
            <input
              type="text"
              value={visualMeta?.subtitle || ''}
              onChange={(e) => update('subtitle', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="BREAKING NEWS"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Headline</label>
            <input
              type="text"
              value={visualMeta?.headline || ''}
              onChange={(e) => update('headline', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="Exclusive Report Uncovers..."
            />
          </div>
          <div className="flex-1">
            <CustomSelect
              label="Section"
              options={SECTION_OPTIONS}
              value={visualMeta?.section || ''}
              onChange={(val) => update('section', val)}
            />
          </div>
        </div>
      </div>

      {/* === CONTENT SECTION === */}
      <div className="space-y-3">
        <div className="text-[10px] text-amber-500/80 uppercase tracking-wider font-bold border-b border-white/5 pb-1">Content</div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Source / Byline</label>
            <input
              type="text"
              value={visualMeta?.source || ''}
              onChange={(e) => update('source', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="The Associated Press"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Date</label>
            <input
              type="text"
              value={visualMeta?.date || ''}
              onChange={(e) => update('date', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="Monday, January 15, 2024"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Body Text</label>
          <textarea
            value={visualMeta?.doc_text || ''}
            onChange={(e) => update('doc_text', e.target.value)}
            className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] text-white font-mono leading-relaxed focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300 resize-y custom-scrollbar"
            placeholder="Newspaper article body text goes here..."
            rows={6}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Highlight Phrase</label>
            <input
              type="text"
              value={visualMeta?.highlight_text || ''}
              onChange={(e) => update('highlight_text', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="Phrase to amber-highlight"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Pull Quote</label>
            <input
              type="text"
              value={visualMeta?.pull_quote || ''}
              onChange={(e) => update('pull_quote', e.target.value)}
              className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
              placeholder="Key quote to feature"
            />
          </div>
        </div>
      </div>

      {/* === VISUAL SECTION === */}
      <div className="space-y-3">
        <div className="text-[10px] text-amber-500/80 uppercase tracking-wider font-bold border-b border-white/5 pb-1">Visual</div>

        <div className="space-y-1.5">
          <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Newspaper Theme</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => update('newspaper_theme', 'modern')}
              className={`flex-1 text-[11px] px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                (visualMeta?.newspaper_theme || 'modern') === 'modern'
                  ? 'bg-stone-200 text-stone-900 border-stone-300 font-semibold'
                  : 'bg-black/20 text-stone-400 border-white/10 hover:border-stone-500'
              }`}
            >
              Modern
            </button>
            <button
              type="button"
              onClick={() => update('newspaper_theme', 'vintage')}
              className={`flex-1 text-[11px] px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                visualMeta?.newspaper_theme === 'vintage'
                  ? 'bg-amber-200 text-amber-900 border-amber-400 font-semibold'
                  : 'bg-black/20 text-stone-400 border-white/10 hover:border-amber-500'
              }`}
            >
              Vintage
            </button>
          </div>
        </div>

        <AnimatePresence>
          {(expanded || visualMeta?.show_image) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-4 pb-1 pt-1">
                <div className="space-y-1.5">
                  <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Image URL</label>
                  <input
                    type="text"
                    value={visualMeta?.image_url || ''}
                    onChange={(e) => update('image_url', e.target.value)}
                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Image Caption</label>
                  <input
                    type="text"
                    value={visualMeta?.image_caption || ''}
                    onChange={(e) => update('image_caption', e.target.value)}
                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
                    placeholder="Caption text"
                  />
                </div>
              </div>
              <div className="pb-2">
                <div className="space-y-1.5">
                  <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Image Scale</label>
                  <div className="flex items-center gap-3 px-1">
                    <input
                      type="range"
                      min={25}
                      max={100}
                      step={5}
                      value={visualMeta?.image_scale ?? 100}
                      onChange={(e) => update('image_scale', Number(e.target.value))}
                      className="flex-1 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-stone-500 w-8 text-right">{visualMeta?.image_scale ?? 100}%</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-stone-400 cursor-pointer hover:text-stone-300 transition-colors">
            <input
              type="checkbox"
              checked={visualMeta?.show_image || false}
              onChange={(e) => update('show_image', e.target.checked)}
              className="w-3.5 h-3.5 rounded border-white/10 bg-black/20 accent-amber-500 cursor-pointer"
            />
            Show featured image
          </label>
          {!expanded && !visualMeta?.show_image && visualMeta?.image_url && (
            <span className="text-[10px] text-stone-600">(expand to edit URL)</span>
          )}
        </div>
      </div>
    </div>
  );
};
