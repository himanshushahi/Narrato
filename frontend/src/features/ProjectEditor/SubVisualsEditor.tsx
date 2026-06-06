import { CustomInput } from '../../components/ui/CustomInput';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { MapLocationsEditor } from './MapLocationsEditor';
import { ChartDataEditor } from './ChartDataEditor';
import { DocumentHighlightEditor } from './DocumentHighlightEditor';
import { NetworkDataEditor } from './NetworkDataEditor';
import { LowerThirdEditor } from './LowerThirdEditor';
import { VISUAL_TYPE_OPTIONS, TRANSITION_TYPE_OPTIONS, formatTime, getDefaultMetaForType } from './constants';

export const SubVisualsEditor = ({ subVisuals, onChange, timings, activeIdx, onSeek }: { subVisuals: any[], onChange: (newSubs: any[]) => void, timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void }) => {
  const handleUpdate = (idx: number, field: string, val: any) => {
    const copy = [...subVisuals];
    if (field === 'visual_type' && copy[idx][field] === val) {
      return;
    }
    copy[idx][field] = val;
    if (field === 'visual_type') {
      copy[idx].visual_meta = getDefaultMetaForType(val, copy[idx].visual_meta);
    }
    onChange(copy);
  };

  const handleUpdateMeta = (idx: number, newMeta: any) => {
    const copy = [...subVisuals];
    copy[idx].visual_meta = newMeta;
    onChange(copy);
  };

  const handleAdd = () => {
    onChange([...subVisuals, { visual_type: 'scene', visual_cue: '', visual_meta: {} }]);
  };

  const handleRemove = (idx: number) => {
    onChange(subVisuals.filter((_: any, i: number) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Sub-Visuals (Cuts)</label>
        <button type="button" onClick={handleAdd} className="text-[10px] bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 px-2 py-1 rounded">+ Add Sub-Visual</button>
      </div>
      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <div key={idx}
            onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
            className={`bg-stone-900/60 p-3 rounded border space-y-3 relative cursor-pointer transition-colors ${isActive ? 'border-amber-500/60 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-stone-800 hover:border-stone-700'}`}>
            <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(idx); }} className="absolute top-2 right-2 text-red-500 hover:text-red-400 text-xs px-2 py-1 bg-red-500/10 rounded">Remove</button>
            <div className="flex items-center gap-2 mb-1">
              <div className={`text-xs font-bold ${isActive ? 'text-amber-400' : 'text-stone-500'}`}>Sub-Visual {idx + 1}</div>
              {timing && (
                <div className="text-[9px] font-mono bg-stone-950 px-1.5 py-0.5 rounded text-stone-400 border border-stone-800">
                  [{formatTime(timing.start)} - {formatTime(timing.end)}]
                </div>
              )}
              {isActive && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
            </div>
            <div className="grid grid-cols-2 gap-3" onClick={e => e.stopPropagation()}>
              <CustomInput label="Visual Cue Keyword" type="text" value={sv.visual_cue || ''} onChange={(e) => handleUpdate(idx, 'visual_cue', e.target.value)} />
              <div className="flex gap-2">
                <div className="w-1/2">
                  <CustomSelect label="Layer Type" options={VISUAL_TYPE_OPTIONS} value={sv.visual_type || 'scene'} onChange={(val) => handleUpdate(idx, 'visual_type', val)} />
                </div>
                <div className="w-1/2">
                  <CustomSelect label="Transition" options={TRANSITION_TYPE_OPTIONS} value={sv.transition_type || 'subtle_slide'} onChange={(val) => handleUpdate(idx, 'transition_type', val)} />
                </div>
              </div>

              {sv.visual_type === 'youtube' && (
                <div className="col-span-2 space-y-4 mt-2 bg-stone-950/60 p-3.5 rounded-lg border border-stone-800">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-stone-400 font-bold uppercase tracking-wider">Start Offset (Skip Intro):</label>
                      <span className="text-[var(--color-accent-light)] font-mono font-bold">{sv.visual_meta?.start_offset !== undefined ? sv.visual_meta.start_offset : 15}s</span>
                    </div>
                    <input type="range" min="0" max="120" step="1" value={sv.visual_meta?.start_offset !== undefined ? sv.visual_meta.start_offset : 15} onChange={(e) => handleUpdateMeta(idx, { ...sv.visual_meta, start_offset: parseInt(e.target.value) })} className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-stone-400 font-bold uppercase tracking-wider">Clip Duration:</label>
                      <span className="text-[var(--color-accent-light)] font-mono font-bold">{sv.visual_meta?.duration !== undefined ? sv.visual_meta.duration : 15}s</span>
                    </div>
                    <input type="range" min="5" max="60" step="1" value={sv.visual_meta?.duration !== undefined ? sv.visual_meta.duration : 15} onChange={(e) => handleUpdateMeta(idx, { ...sv.visual_meta, duration: parseInt(e.target.value) })} className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]" />
                  </div>
                </div>
              )}

              {sv.visual_type === 'map' && (
                <MapLocationsEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'chart' && (
                <ChartDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'document' && (
                <DocumentHighlightEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'network' && (
                <NetworkDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              <LowerThirdEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />

            </div>
          </div>
        )
      })}
      {subVisuals.length === 0 && <p className="text-xs text-stone-500 italic">No sub-visuals. A default black screen will be shown.</p>}
    </div>
  );
};

