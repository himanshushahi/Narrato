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

  const getLayerIconAndLabel = (content: any) => {
    const type = content?.type || 'Image';
    switch (type) {
      case 'Video':
        return { icon: '🎬', label: content?.query ? `Video: ${content.query}` : 'Video' };
      case 'Image':
        return { icon: '🖼️', label: content?.query ? `Image: ${content.query}` : 'Image' };
      case 'Chart':
        return { icon: '📊', label: `Chart: ${content?.chart_type || 'bar'}` };
      case 'Shape':
        return { icon: '🔷', label: content?.shape_type === 'icon' ? `Icon: ${content?.icon_name || 'icon'}` : `Shape: ${content?.shape_type || 'rect'}` };
      case 'Text':
        return { icon: '✨', label: content?.text ? `"${content.text.slice(0, 18)}${content.text.length > 18 ? '...' : ''}"` : 'Text' };
      case 'Lottie':
        return { icon: '🎭', label: 'Lottie' };
      case 'HTML':
        return { icon: '🌐', label: 'HTML/SVG' };
      case 'Map':
        return { icon: '🗺️', label: `Map: ${content?.map_style || 'dark'}` };
      default:
        return { icon: '📄', label: type };
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-stone-800/40 pt-2">
      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];
        const layers = sv?.composition?.children || [];
        const transition = sv?.transition && sv.transition !== 'cut' ? sv.transition.replace('_', ' ') : null;

        return (
          <div key={idx}
            data-view-active-sub={isActive ? 'true' : undefined}
            onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
            className={`flex flex-col gap-1.5 text-[10px] font-mono p-2 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-amber-950/25 text-amber-100 border border-amber-500/40 shadow-sm' : 'bg-stone-900/40 text-stone-400 hover:bg-stone-800/60 border border-white/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`font-bold ${isActive ? 'text-amber-400' : 'text-stone-500'}`}>Cut {idx + 1}</span>
                {timing && (
                  <span className="bg-stone-950/80 px-1.5 py-0.5 rounded text-stone-400 border border-stone-800/60 text-[9px]">
                    {formatTime(timing.start)} - {formatTime(timing.end)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {transition && (
                  <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold">
                    ⚡ {transition}
                  </span>
                )}
                {sv.mute_voiceover && (
                  <span className="bg-red-500/15 text-red-400 px-1 rounded text-[9px] font-bold">
                    🎙️ Muted
                  </span>
                )}
                {sv.mute_bg_music && (
                  <span className="bg-blue-500/15 text-blue-400 px-1 rounded text-[9px] font-bold">
                    🎵 Music Off
                  </span>
                )}
                {isActive && (
                  <span className="ml-1 text-[9px] text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded font-bold animate-pulse">
                    Playing
                  </span>
                )}
              </div>
            </div>

            {/* Layer Summary Chips */}
            <div className="flex flex-wrap gap-1 pt-1">
              {layers.length === 0 ? (
                <span className="text-stone-600 italic text-[9px]">Empty composition</span>
              ) : (
                layers.map((layer: any, lIdx: number) => {
                  const meta = getLayerIconAndLabel(layer?.content);
                  return (
                    <span
                      key={lIdx}
                      className="bg-black/50 border border-white/10 px-1.5 py-0.5 rounded text-[9px] text-stone-300 flex items-center gap-1 truncate max-w-[200px]"
                      title={meta.label}
                    >
                      <span>{meta.icon}</span>
                      <span className="truncate">{meta.label}</span>
                    </span>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

