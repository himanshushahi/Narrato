

export const DocumentHighlightEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Document Highlight:</label>
      </div>
      <input type="text" value={visualMeta?.highlight_text || ''} onChange={e => onChange({ ...visualMeta, highlight_text: e.target.value })} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Phrase to highlight with marker" />
    </div>
  );
};
