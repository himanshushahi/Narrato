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
    <div className="col-span-2 space-y-4 mt-3 pt-3 border-t border-white/5">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw HTML</label>
        <button type="button" onClick={handleSave} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md text-stone-300 transition-colors">Apply Changes</button>
      </div>
      <textarea 
        rows={8} 
        value={html} 
        onChange={e => setHtml(e.target.value)} 
        className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all font-mono custom-scrollbar" 
        placeholder='<div class="my-box">Hello World</div>' 
      />

      <div className="flex justify-between items-center text-xs mb-1 pt-2">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw CSS</label>
      </div>
      <textarea 
        rows={8} 
        value={css} 
        onChange={e => setCss(e.target.value)} 
        className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all font-mono custom-scrollbar" 
        placeholder='.my-box { background: red; }' 
      />
    </div>
  );
};
