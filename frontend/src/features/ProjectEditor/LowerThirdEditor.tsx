

export const LowerThirdEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const lowerThird = visualMeta?.lower_third || { title: '', subtitle: '' };

  const handleUpdate = (field: string, val: string) => {
    if (!val && field === 'title') {
      const copy = { ...visualMeta };
      delete copy.lower_third;
      onChange(copy);
      return;
    }
    onChange({ ...visualMeta, lower_third: { ...lowerThird, [field]: val } });
  };

  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/40 p-3 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Universal Lower Third:</label>
      </div>
      <div className="flex gap-2">
        <input type="text" value={lowerThird.title} onChange={e => handleUpdate('title', e.target.value)} className="w-1/2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Title (e.g. Person Name)" />
        <input type="text" value={lowerThird.subtitle} onChange={e => handleUpdate('subtitle', e.target.value)} className="w-1/2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Subtitle (e.g. Profession)" />
      </div>
    </div>
  );
};
