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
  // Compositor-only movement: translateX never triggers layout, unlike left.
  // The static left offset keeps it aligned with the track headers.
  const playheadOffsetX = (currentFrame / FPS) * timelineZoom;

  return (
    <div
      className="absolute top-0 bottom-0 z-50 pointer-events-none"
      style={{ left: HEADER_WIDTH, transform: `translateX(${playheadOffsetX}px)`, willChange: 'transform' }}
    >
      {/* Invisible wider grab area for easy drag */}
      <div
        className="absolute inset-y-0 -translate-x-1/2 w-4 cursor-ew-resize pointer-events-auto"
        onMouseDown={onStartDrag}
      />
      {/* Solid vertical playhead line extending through all tracks */}
      <div className="w-[1.5px] h-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.9)] opacity-95 pointer-events-none" />
      {/* Top Diamond Head on Time Ruler */}
      <div
        className="absolute top-0 -translate-x-1/2 w-[13px] h-[13px] bg-cyan-400 rounded-[2px] rotate-45 shadow-[0_0_12px_rgba(6,182,212,1)] cursor-grab active:cursor-grabbing pointer-events-auto hover:scale-115 transition-transform -translate-y-1.5 z-[70]"
        onMouseDown={onStartDrag}
        title="Playhead (Drag to scrub)"
      />
    </div>
  );
});

TimelinePlayhead.displayName = 'TimelinePlayhead';
