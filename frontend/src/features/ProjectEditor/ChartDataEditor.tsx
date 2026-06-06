import { useState } from 'react';
import { VscLoading, VscSparkle } from 'react-icons/vsc';

export const ChartDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [loading, setLoading] = useState(false);
  const prompt = visualMeta?.chart_prompt || '';
  const data = visualMeta?.data || [];

  const handleFetch = async () => {
    if (!prompt) return;
    setLoading(true);
    try {
      if (window.eel) {
        const res = await window.eel.generate_chart_data_api(prompt)();
        if (res.success && res.data) {
          onChange({
            ...visualMeta,
            data: res.data,
            title: res.title || prompt.toUpperCase(),
            chart_type: res.chart_type || 'bar',
            chart_prompt: prompt
          });
        } else {
          alert(`Failed to generate data: ${res.error}`);
        }
      }
    } catch (e) {
      console.error(e);
      alert('Error generating chart data.');
    } finally {
      setLoading(false);
    }
  };

  const updateDataRow = (index: number, field: 'label' | 'value', val: string) => {
    const newData = [...data];
    if (field === 'label') newData[index].label = val;
    if (field === 'value') newData[index].value = parseFloat(val) || 0;
    onChange({ ...visualMeta, data: newData });
  };

  const removeDataRow = (index: number) => {
    const newData = data.filter((_: any, i: number) => i !== index);
    onChange({ ...visualMeta, data: newData });
  };

  const addDataRow = () => {
    const newData = [...data, { label: 'New', value: 0 }];
    onChange({ ...visualMeta, data: newData });
  };

  return (
    <div className="col-span-2 space-y-4 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div>
        <div className="flex justify-between items-center text-xs mb-2">
          <label className="text-stone-400 font-bold uppercase tracking-wider">✨ AI Data Generator:</label>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={prompt}
            onChange={(e) => onChange({ ...visualMeta, chart_prompt: e.target.value })}
            placeholder="e.g. Top 10 most populated countries in 2024"
            className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={loading || !prompt}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-zinc-950 px-3 py-1.5 rounded text-[11px] font-bold shrink-0 transition-colors flex items-center gap-1"
          >
            {loading ? <VscLoading className="animate-spin text-xs" /> : <VscSparkle className="text-xs" />} Generate
          </button>
        </div>
      </div>

      <div className="border-t border-stone-800 pt-3">
        <div className="flex justify-between items-center text-xs mb-2">
          <label className="text-stone-400 font-bold uppercase tracking-wider">Manual Editor:</label>
          <button type="button" onClick={addDataRow} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">
            + Add Row
          </button>
        </div>
        {data.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {data.map((row: any, idx: number) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateDataRow(idx, 'label', e.target.value)}
                  className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
                  placeholder="Label"
                />
                <input
                  type="number"
                  step="any"
                  value={row.value}
                  onChange={(e) => updateDataRow(idx, 'value', e.target.value)}
                  className="w-24 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
                  placeholder="Value"
                />
                <button type="button" onClick={() => removeDataRow(idx)} className="text-red-400 hover:text-red-300 px-1.5 py-1 text-xs">✕</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-stone-500 italic">No data yet. Generate with AI or add manually.</p>
        )}
      </div>
    </div>
  );
};

