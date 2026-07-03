import { useEffect } from 'react';
import { formatTime } from './constants';

export const SubVisualsView = ({ subVisuals, timings, activeIdx, onSeek }: { subVisuals: any[], timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void }) => {
  useEffect(() => {
    if (activeIdx === undefined || activeIdx < 0) return;
    const el = document.querySelector('[data-view-active-sub="true"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIdx]);

  return (
    <div className="flex flex-col gap-2 border-t border-stone-800/40 pt-2">
      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <div key={idx}
            data-view-active-sub={isActive ? 'true' : undefined}
            onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
            className={`flex flex-col gap-1 text-[10px] font-mono px-2 py-1.5 rounded cursor-pointer transition-colors ${isActive ? 'bg-amber-900/20 text-amber-100 border border-amber-500/30' : 'bg-stone-900/30 text-stone-500 hover:bg-stone-800/50 border border-transparent'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-4 ${isActive ? 'text-amber-400' : 'text-stone-600'}`}>{idx + 1}.</span>
              {timing && (
                <span className="bg-stone-950/80 px-1 rounded text-stone-400 border border-stone-800/60">
                  {formatTime(timing.start)}
                </span>
              )}
              <span>Layer: <strong className={isActive ? 'text-amber-300 capitalize' : 'text-stone-300 capitalize'}>{sv.visual_type === 'custom_html' ? 'Html' : sv.visual_type}</strong></span>
            </div>
            <div className="pl-6 flex items-center gap-2">
              <span>Cue: <strong className={isActive ? 'text-amber-200' : 'text-stone-300'}>{sv.visual_cue}</strong></span>
              {isActive && <span className="ml-auto text-[9px] text-amber-500 bg-amber-500/10 px-1 rounded animate-pulse">Playing</span>}
            </div>
          </div>
        )
      })}
    </div>
  );
};

