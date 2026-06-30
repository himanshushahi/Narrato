import { useState } from 'react';
import { VscLoading, VscSparkle } from 'react-icons/vsc';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { callApi } from '../../utils/call-api';
import { useUIStore } from '../../store/useUIStore';

export const ChartDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [loading, setLoading] = useState(false);
  const { addToast } = useUIStore();
  const prompt = visualMeta?.chart_prompt || '';
  const data = visualMeta?.data || [];

  const handleFetch = async () => {
    if (!prompt) return;
    setLoading(true);
    try {
      const res = await callApi<{ success: boolean; data?: any; title?: string; chart_type?: string; error?: string }>('generate_chart_data_api', prompt);
      if (res?.success && res.data) {
        onChange({
          ...visualMeta,
          data: res.data,
          title: res.title || prompt.toUpperCase(),
          chart_type: res.chart_type || 'bar',
          chart_prompt: prompt
        });
      } else {
        addToast(`Failed to generate data: ${res?.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Error generating chart data.', 'error');
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
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => onChange({ ...visualMeta, chart_prompt: e.target.value })}
            placeholder="e.g. GDP of top 5 countries..."
            className="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
            onKeyDown={(e) => { if (e.key === 'Enter') handleFetch(); }}
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={loading || !prompt}
            className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 disabled:opacity-50 px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 transition-all duration-300 flex items-center gap-1 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
          >
            {loading ? <VscLoading className="animate-spin text-xs" /> : <VscSparkle className="text-xs" />} Generate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5 mt-2">
        <div className="space-y-1.5">
          <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Chart Title</label>
          <input
            type="text"
            value={visualMeta.title || ''}
            onChange={(e) => onChange({ ...visualMeta, title: e.target.value })}
            placeholder="e.g. Statistical Overview"
            className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all duration-300"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-stone-400/80 font-medium tracking-wide mb-1 ml-1 text-[10px]">Chart Type</label>
          <CustomSelect
            options={[
              { value: 'bar', label: 'Bar Chart' },
              { value: 'line', label: 'Line Chart' },
              { value: 'pie', label: 'Pie Chart' },
            ]}
            value={visualMeta.chart_type || 'bar'}
            onChange={(val) => onChange({ ...visualMeta, chart_type: val })}
          />
        </div>
      </div>

      <div className="border-t border-white/5 pt-4 mt-4">
        <div className="flex justify-between items-center text-xs mb-3">
          <label className="text-stone-400/80 font-medium tracking-wide">Data Source</label>
          <button type="button" onClick={addDataRow} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md text-stone-300 transition-colors">
            + Add Row
          </button>
        </div>
        {data.length > 0 ? (
          <div className="space-y-2 pr-2">
            {data.map((row: any, idx: number) => (
              <div key={idx} className="flex gap-2 items-center bg-black/10 p-1 rounded-lg border border-white/5">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateDataRow(idx, 'label', e.target.value)}
                  className="flex-1 bg-black/20 border border-transparent hover:border-white/10 rounded-md px-3 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all"
                  placeholder="Label"
                />
                <input
                  type="number"
                  step="any"
                  value={row.value}
                  onChange={(e) => updateDataRow(idx, 'value', e.target.value)}
                  className="w-24 bg-black/20 border border-transparent hover:border-white/10 rounded-md px-3 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all text-right"
                  placeholder="Value"
                />
                <button type="button" onClick={() => removeDataRow(idx)} className="text-red-400/50 hover:text-red-400 px-2 py-1.5 text-xs transition-colors rounded hover:bg-red-500/10">✕</button>
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

