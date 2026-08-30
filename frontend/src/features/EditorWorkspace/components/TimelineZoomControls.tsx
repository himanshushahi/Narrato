import React from 'react';
import { VscZoomIn, VscZoomOut } from 'react-icons/vsc';
import { Scissors, Maximize2 } from 'lucide-react';
import { ZOOM_MIN, ZOOM_MAX } from '../timelineConstants';

interface TimelineZoomControlsProps {
  timelineZoom: number;
  setTimelineZoom: (zoom: number) => void;
  onFitTimeline?: () => void;
  onSplitAtPlayhead?: () => void;
  canSplit?: boolean;
}

export const TimelineZoomControls: React.FC<TimelineZoomControlsProps> = React.memo(({
  timelineZoom,
  setTimelineZoom,
  onFitTimeline,
  onSplitAtPlayhead,
  canSplit = false,
}) => {
  const handleZoomIn = () => setTimelineZoom(Math.min(ZOOM_MAX, Math.round(timelineZoom * 1.4)));
  const handleZoomOut = () => setTimelineZoom(Math.max(ZOOM_MIN, Math.round(timelineZoom / 1.4)));

  return (
    <div className="flex items-center gap-3">
      {/* Quick Split Action Button */}
      {onSplitAtPlayhead && (
        <button
          type="button"
          onClick={onSplitAtPlayhead}
          disabled={!canSplit}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
            canSplit
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 hover:border-amber-400/50 shadow-sm'
              : 'bg-zinc-800/40 text-zinc-600 border border-zinc-800 cursor-not-allowed opacity-50'
          }`}
          title={canSplit ? "Split current cut at playhead position (Shortcut: C)" : "Position playhead inside a cut to split"}
        >
          <Scissors className="w-3 h-3" />
          <span>Split [C]</span>
        </button>
      )}

      {/* Fit to Screen Button */}
      {onFitTimeline && (
        <button
          type="button"
          onClick={onFitTimeline}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 text-[9px] font-mono cursor-pointer transition-colors"
          title="Fit entire timeline to screen width"
        >
          <Maximize2 className="w-2.5 h-2.5" />
          <span>Fit</span>
        </button>
      )}

      <div className="h-3 w-px bg-zinc-800" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors cursor-pointer"
          title="Zoom out"
        >
          <VscZoomOut className="text-xs" />
        </button>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          value={timelineZoom}
          onChange={(e) => setTimelineZoom(Number(e.target.value))}
          className="w-16 h-1 accent-cyan-400 bg-zinc-800 rounded cursor-pointer"
          title="Timeline zoom"
        />
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors cursor-pointer"
          title="Zoom in"
        >
          <VscZoomIn className="text-xs" />
        </button>
        <span className="text-[9px] font-mono text-zinc-500 w-9 text-right">{timelineZoom}px/s</span>
      </div>
    </div>
  );
});

TimelineZoomControls.displayName = 'TimelineZoomControls';
