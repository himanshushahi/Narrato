import { useState } from 'react';

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
    <div className="col-span-2 space-y-3 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">
          🗞️ Newspaper Editor
        </label>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] text-stone-500 hover:text-stone-300 bg-stone-800/50 px-2 py-0.5 rounded cursor-pointer"
        >
          {expanded ? 'Collapse' : 'Expand All'}
        </button>
      </div>

      {/* === HEADER SECTION === */}
      <div className="text-[10px] text-amber-600/80 uppercase tracking-wider font-bold border-b border-stone-800 pb-1">Header</div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Masthead Title</label>
          <input
            type="text"
            value={visualMeta?.title || ''}
            onChange={(e) => update('title', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="THE CLASSIFIED ARCHIVES"
          />
        </div>
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Subtitle</label>
          <input
            type="text"
            value={visualMeta?.subtitle || ''}
            onChange={(e) => update('subtitle', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="BREAKING NEWS"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Headline</label>
          <input
            type="text"
            value={visualMeta?.headline || ''}
            onChange={(e) => update('headline', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="Exclusive Report Uncovers..."
          />
        </div>
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Section</label>
          <select
            value={visualMeta?.section || ''}
            onChange={(e) => update('section', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
          >
            {SECTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* === CONTENT SECTION === */}
      <div className="text-[10px] text-amber-600/80 uppercase tracking-wider font-bold border-b border-stone-800 pb-1">Content</div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Source / Byline</label>
          <input
            type="text"
            value={visualMeta?.source || ''}
            onChange={(e) => update('source', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="The Associated Press"
          />
        </div>
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Date</label>
          <input
            type="text"
            value={visualMeta?.date || ''}
            onChange={(e) => update('date', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="Monday, January 15, 2024"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-stone-500 text-[10px] uppercase tracking-wider">Body Text</label>
        <textarea
          value={visualMeta?.doc_text || ''}
          onChange={(e) => update('doc_text', e.target.value)}
          className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white font-mono leading-relaxed focus:outline-none focus:border-amber-500/50 resize-y"
          placeholder="Newspaper article body text goes here..."
          rows={6}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Highlight Phrase</label>
          <input
            type="text"
            value={visualMeta?.highlight_text || ''}
            onChange={(e) => update('highlight_text', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="Phrase to amber-highlight"
          />
        </div>
        <div className="space-y-1">
          <label className="text-stone-500 text-[10px] uppercase tracking-wider">Pull Quote</label>
          <input
            type="text"
            value={visualMeta?.pull_quote || ''}
            onChange={(e) => update('pull_quote', e.target.value)}
            className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
            placeholder="Key quote to feature"
          />
        </div>
      </div>

      {/* === VISUAL SECTION === */}
      <div className="text-[10px] text-amber-600/80 uppercase tracking-wider font-bold border-b border-stone-800 pb-1">Visual</div>

      {expanded && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-stone-500 text-[10px] uppercase tracking-wider">Image URL</label>
            <input
              type="text"
              value={visualMeta?.image_url || ''}
              onChange={(e) => update('image_url', e.target.value)}
              className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-stone-500 text-[10px] uppercase tracking-wider">Image Caption</label>
            <input
              type="text"
              value={visualMeta?.image_caption || ''}
              onChange={(e) => update('image_caption', e.target.value)}
              className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
              placeholder="Caption text"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] text-stone-400 cursor-pointer">
          <input
            type="checkbox"
            checked={visualMeta?.show_image || false}
            onChange={(e) => update('show_image', e.target.checked)}
            className="accent-amber-500"
          />
          Show featured image
        </label>
        {!expanded && visualMeta?.image_url && (
          <span className="text-[10px] text-stone-600">(expand to edit URL)</span>
        )}
      </div>
    </div>
  );
};
