import React, { memo, useState, useEffect, useMemo } from 'react';
import { Trash2, Plus, Palette, Code, Sun, Zap, BarChart3, Terminal, Flame, Check } from 'lucide-react';

interface ChartDataItem {
  label: string;
  value: number;
  color?: string;
}

interface AstChartDataEditorProps {
  data?: ChartDataItem[];
  onChange: (data: ChartDataItem[]) => void;
}

const PALETTES: { label: string; icon: React.ComponentType<{ className?: string }>; colors: string[] }[] = [
  { label: 'Amber Gold', icon: Sun, colors: ['#f59e0b', '#fbbf24', '#d97706', '#fde68a', '#b45309'] },
  { label: 'Cyberpunk Neon', icon: Zap, colors: ['#06b6d4', '#ec4899', '#8b5cf6', '#10b981', '#f43f5e'] },
  { label: 'Bloomberg Blue', icon: BarChart3, colors: ['#3b82f6', '#60a5fa', '#1d4ed8', '#93c5fd', '#2563eb'] },
  { label: 'Terminal Green', icon: Terminal, colors: ['#10b981', '#34d399', '#059669', '#6ee7b7', '#047857'] },
  { label: 'Sunset Flame', icon: Flame, colors: ['#ef4444', '#f97316', '#eab308', '#dc2626', '#fb923c'] },
];

const AstChartDataEditorInner: React.FC<AstChartDataEditorProps> = ({
  data = [],
  onChange,
}) => {
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(data, null, 2));

  const maxValue = useMemo(() => {
    return data.reduce((max, d) => Math.max(max, Math.abs(d.value) || 0), 1);
  }, [data]);

  // Keep Raw JSON in sync with external updates (palette/preset/sync) while
  // open — same pattern as MiniJsonEditor. Skip while the text is invalid
  // JSON being typed so drafts aren't clobbered.
  useEffect(() => {
    try {
      const newText = JSON.stringify(data, null, 2);
      setJsonText(prev => {
        try {
          if (JSON.stringify(JSON.parse(prev), null, 2) !== newText) return newText;
          return prev;
        } catch {
          return prev;
        }
      });
    } catch {
      // ignore
    }
  }, [data]);

  const handleUpdateItem = (idx: number, field: keyof ChartDataItem, val: any) => {
    const updated = [...data];
    updated[idx] = { ...updated[idx], [field]: val };
    onChange(updated);
  };

  const handleAddItem = () => {
    const defaultColors = ['#f59e0b', '#06b6d4', '#10b981', '#ec4899', '#8b5cf6', '#3b82f6'];
    const nextColor = defaultColors[data.length % defaultColors.length];
    const newItem: ChartDataItem = {
      label: `Item ${data.length + 1}`,
      value: 50,
      color: nextColor,
    };
    onChange([...data, newItem]);
  };

  const handleDeleteItem = (idx: number) => {
    onChange(data.filter((_, i) => i !== idx));
  };

  const handleApplyPalette = (colors: string[]) => {
    const updated = data.map((item, idx) => ({
      ...item,
      color: colors[idx % colors.length],
    }));
    onChange(updated);
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        onChange(parsed);
      }
    } catch {
      // Invalid JSON
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Header & Controls */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <Palette className="w-3 h-3 text-amber-400" />
          Chart Data Points ({data.length})
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setJsonText(JSON.stringify(data, null, 2));
              setShowJson(!showJson);
            }}
            className="text-[9px] text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Code className="w-3 h-3" />
            {showJson ? 'GUI Table' : 'Raw JSON'}
          </button>
          <button
            type="button"
            onClick={handleAddItem}
            className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" /> Add Point
          </button>
        </div>
      </div>

      {/* Color Palette Themes */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">Color Palette Themes</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
          {PALETTES.map((pal, pIdx) => {
            const Icon = pal.icon;
            const isPalActive =
              data.length > 0 &&
              data.every(
                (item, i) => item.color?.toLowerCase() === pal.colors[i % pal.colors.length].toLowerCase()
              );
            return (
              <button
                key={pIdx}
                type="button"
                aria-pressed={isPalActive}
                onClick={() => handleApplyPalette(pal.colors)}
                className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                  isPalActive
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 ring-1 ring-amber-500/30'
                    : 'bg-black/40 border-white/10 hover:border-amber-500/40 hover:bg-amber-500/10 text-stone-300'
                }`}
                title={`Apply ${pal.label} theme (${pal.colors.join(', ')})`}
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Icon className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="text-[10px] font-semibold truncate">{pal.label}</span>
                  </div>
                  {isPalActive && <Check className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  {pal.colors.map((c, cIdx) => (
                    <span
                      key={cIdx}
                      className="w-2 h-2 rounded-full border border-black/50 shadow-sm shrink-0"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {showJson ? (
        <textarea
          value={jsonText}
          onChange={e => handleJsonChange(e.target.value)}
          className="w-full bg-black/60 border border-white/10 rounded-md p-2 text-xs font-mono text-stone-200 min-h-[120px] focus:outline-none focus:border-amber-500/50"
        />
      ) : (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5">
          {data.length === 0 ? (
            <div className="p-3 bg-black/20 border border-white/5 rounded-lg text-center text-stone-500 text-[11px] italic">
              No data points. Click "+ Add Point" above to add values.
            </div>
          ) : (
            data.map((item, idx) => {
              const itemColor = item.color || '#f59e0b';
              const proportion = Math.min(100, Math.max(3, (Math.abs(item.value || 0) / maxValue) * 100));
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 bg-black/40 border border-white/10 rounded-lg hover:border-white/20 transition-all relative overflow-hidden"
                >
                  {/* Subtle proportional indicator bar along the bottom of the card */}
                  <div
                    className="absolute bottom-0 left-0 h-0.5 opacity-60 rounded transition-all"
                    style={{ width: `${proportion}%`, backgroundColor: itemColor }}
                  />

                  <span className="text-[10px] font-mono font-bold text-amber-400/70 w-4 shrink-0 text-center">
                    {idx + 1}
                  </span>

                  {/* Label Input */}
                  <input
                    type="text"
                    aria-label={`Data point ${idx + 1} label`}
                    placeholder="Label (e.g. 2024)"
                    value={item.label || ''}
                    onChange={e => handleUpdateItem(idx, 'label', e.target.value)}
                    className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-medium"
                  />

                  {/* Value Input */}
                  <input
                    type="number"
                    step="any"
                    aria-label={`Data point ${idx + 1} value`}
                    placeholder="Value"
                    value={item.value ?? 0}
                    onChange={e => handleUpdateItem(idx, 'value', parseFloat(e.target.value) || 0)}
                    className="w-20 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono text-right"
                  />

                  {/* Color Swatch & Hex */}
                  <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
                    <input
                      type="color"
                      aria-label={`Data point ${idx + 1} color picker`}
                      value={item.color?.startsWith('#') && item.color.length === 7 ? item.color : '#f59e0b'}
                      onChange={e => handleUpdateItem(idx, 'color', e.target.value)}
                      className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                    />
                    <input
                      type="text"
                      aria-label={`Data point ${idx + 1} color hex`}
                      value={item.color || ''}
                      onChange={e => handleUpdateItem(idx, 'color', e.target.value)}
                      placeholder="#f59e0b"
                      className="w-14 bg-transparent text-[10px] text-stone-300 font-mono focus:outline-none"
                    />
                  </div>

                  {/* Delete Button */}
                  <button
                    type="button"
                    aria-label={`Delete data point ${idx + 1}`}
                    onClick={() => handleDeleteItem(idx)}
                    className="p-1 text-stone-500 hover:text-red-400 bg-white/5 hover:bg-red-500/10 rounded transition-colors cursor-pointer shrink-0"
                    title="Delete data point"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export const AstChartDataEditor = memo(AstChartDataEditorInner);
AstChartDataEditor.displayName = 'AstChartDataEditor';
