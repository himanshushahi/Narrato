import { useState } from 'react';

export const NetworkDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [jsonText, setJsonText] = useState(() => JSON.stringify({ nodes: visualMeta?.nodes || [], edges: visualMeta?.edges || [] }, null, 2));

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onChange({ ...visualMeta, nodes: parsed.nodes, edges: parsed.edges });
    } catch (e) {
      alert("Invalid JSON format");
    }
  };

  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Network Data (JSON):</label>
        <button type="button" onClick={handleSave} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">Save JSON Data</button>
      </div>
      <textarea rows={6} value={jsonText} onChange={e => setJsonText(e.target.value)} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 font-mono" placeholder="{ nodes: [], edges: [] }" />
    </div>
  );
};
