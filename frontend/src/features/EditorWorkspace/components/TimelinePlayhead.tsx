import React from 'react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

interface TimelinePlayheadProps {
  timelineZoom: number;
  onStartDrag: (e: React.MouseEvent) => void;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = React.memo(({ timelineZoom, onStartDrag }) => {
  // Only the playhead subscribes to per-frame updates — the rest of the
  // timeline no longer re-renders on every tick.
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const playheadX = (currentFrame / FPS) * timelineZoom + HEADER_WIDTH;

  return (
    <div className="absolute top-0 bottom-0 z-50 pointer-events-none" style={{ left: playheadX }}>
      <div
        className="absolute inset-y-0 -translate-x-1/2 w-4 cursor-grab active:cursor-grabbing pointer-events-auto"
        onMouseDown={onStartDrag}
      />
      <div className="w-px h-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)] opacity-90" />
      <div
        className="absolute -top-1 -translate-x-1/2 w-[11px] h-[11px] bg-cyan-400 rounded-sm rotate-45 shadow-[0_0_10px_rgba(6,182,212,0.8)] cursor-grab active:cursor-grabbing pointer-events-auto hover:scale-110 transition-transform"
        onMouseDown={onStartDrag}
      />
    </div>
  );
});
TimelinePlayhead.displayName = 'TimelinePlayhead';
