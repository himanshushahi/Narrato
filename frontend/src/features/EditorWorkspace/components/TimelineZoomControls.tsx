import React from 'react';
import { VscZoomIn, VscZoomOut } from 'react-icons/vsc';
import { ZOOM_MIN, ZOOM_MAX } from '../timelineConstants';

interface TimelineZoomControlsProps {
  timelineZoom: number;
  setTimelineZoom: (zoom: number) => void;
}

export const TimelineZoomControls: React.FC<TimelineZoomControlsProps> = React.memo(({ timelineZoom, setTimelineZoom }) => {
  const handleZoomIn = () => setTimelineZoom(Math.min(ZOOM_MAX, Math.round(timelineZoom * 1.4)));
  const handleZoomOut = () => setTimelineZoom(Math.max(ZOOM_MIN, Math.round(timelineZoom / 1.4)));

  return (
    <div className="flex items-center gap-2">
      <button
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
        className="w-16 h-1 accent-[var(--color-accent-primary)] cursor-pointer"
        title="Timeline zoom"
      />
      <button
        onClick={handleZoomIn}
        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors cursor-pointer"
        title="Zoom in"
      >
        <VscZoomIn className="text-xs" />
      </button>
      <span className="text-[9px] font-mono text-zinc-600 w-10 text-right">{timelineZoom}px/s</span>
    </div>
  );
});
TimelineZoomControls.displayName = 'TimelineZoomControls';
