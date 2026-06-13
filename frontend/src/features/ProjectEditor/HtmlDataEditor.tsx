import { useState } from 'react';
import { useUIStore } from '../../store/useUIStore';

export const HtmlDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [html, setHtml] = useState(() => visualMeta?.html || '');
  const [css, setCss] = useState(() => visualMeta?.css || '');
  const { addToast } = useUIStore();

  const handleSave = () => {
    onChange({ ...visualMeta, html, css });
    addToast("HTML & CSS saved to scene", "success");
  };

  return (
    <div className="col-span-2 space-y-4 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Raw HTML</label>
        <button type="button" onClick={handleSave} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">Apply Changes</button>
      </div>
      <textarea 
        rows={8} 
        value={html} 
        onChange={e => setHtml(e.target.value)} 
        className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 font-mono" 
        placeholder='<div class="my-box">Hello World</div>' 
      />

      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Raw CSS</label>
      </div>
      <textarea 
        rows={8} 
        value={css} 
        onChange={e => setCss(e.target.value)} 
        className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 font-mono" 
        placeholder='.my-box { background: red; }' 
      />
    </div>
  );
};
