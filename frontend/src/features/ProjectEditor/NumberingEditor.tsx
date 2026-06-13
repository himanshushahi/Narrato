export const NumberingEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  // ── Meta helpers ────────────────────────────────────────────────
  const update = (field: string, val: any) => {
    onChange({ ...visualMeta, [field]: val });
  };

  return (
    <div className="col-span-2 space-y-3 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      {/* ═══════ Item Fields ═══════ */}
      <div>
        <label className="text-stone-500 text-[10px] uppercase font-bold tracking-wider block mb-1">Number</label>
        <input
          type="number" min={1} max={999}
          value={visualMeta.number ?? 1}
          onChange={(e) => update('number', parseInt(e.target.value) || 1)}
          className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
        />
      </div>

      <div>
        <label className="text-stone-500 text-[10px] uppercase font-bold tracking-wider block mb-1">Title</label>
        <input
          type="text"
          value={visualMeta.title || ''}
          onChange={(e) => update('title', e.target.value)}
          className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
          placeholder="Ganga River"
        />
      </div>

      <div>
        <label className="text-stone-500 text-[10px] uppercase font-bold tracking-wider block mb-1">Description (optional)</label>
        <input
          type="text"
          value={visualMeta.description || ''}
          onChange={(e) => update('description', e.target.value)}
          className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[10px] text-stone-300 focus:outline-none focus:border-amber-500/50"
          placeholder="The longest river in India..."
        />
      </div>

      {/* ═══════ Info text ═══════ */}
      <div className="border-t border-stone-800 pt-2">
        <p className="text-[10px] text-stone-500 italic">
          Each <strong className="text-amber-500">list</strong> sub-visual shows one item full screen.
          Styling (number style, colours, font) is managed in <strong className="text-amber-400">Settings → Numbering Style</strong>.
        </p>
      </div>
    </div>
  );
};
