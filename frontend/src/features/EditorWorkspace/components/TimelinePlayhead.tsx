import React, { useEffect, useRef } from 'react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

interface TimelinePlayheadProps {
  timelineZoom: number;
  onStartDrag: (e: React.MouseEvent) => void;
  /**
   * Live frame reader (player.getCurrentFrame). When provided, the playhead
   * positions itself in a rAF loop with direct DOM writes at display rate —
   * decoupled from the ~10Hz playback-store poll, so motion is smooth even
   * though badge/timecode/highlight update slower. Falls back to the store
   * when the player isn't mounted yet.
   */
  getLiveFrame?: () => number | undefined;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = React.memo(({ timelineZoom, onStartDrag, getLiveFrame }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const getterRef = useRef(getLiveFrame);
  getterRef.current = getLiveFrame;
  const zoomRef = useRef(timelineZoom);
  zoomRef.current = timelineZoom;

  // rAF positioning: one DOM transform write per display frame, zero React
  // re-renders during playback. Writes are skipped when nothing moved, so an
  // idle/paused timeline costs one cheap frame read per rAF.
  useEffect(() => {
    let raf = 0;
    let lastX = Number.NaN;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = barRef.current;
      if (!el) return;
      const live = getterRef.current?.();
      const frame = live ?? usePlaybackStore.getState().currentFrame;
      const x = (frame / FPS) * zoomRef.current;
      if (x !== lastX) {
        lastX = x;
        el.style.transform = `translateX(${x}px)`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // First-paint position (rAF overwrites from here). Read without subscribing
  // so store ticks never re-render this component — only timelineZoom changes do.
  const initialFrame = usePlaybackStore.getState().currentFrame;
  const initialX = (initialFrame / FPS) * timelineZoom;

  return (
    <div
      ref={barRef}
      className="absolute top-0 bottom-0 z-50 pointer-events-none"
      style={{ left: HEADER_WIDTH, transform: `translateX(${initialX}px)`, willChange: 'transform' }}
    >
      {/* Invisible wider grab area for easy drag */}
      <div
        className="absolute inset-y-0 -translate-x-1/2 w-4 cursor-ew-resize pointer-events-auto"
        onMouseDown={onStartDrag}
      />
      {/* Solid vertical playhead line extending through all tracks.
          No glow shadow: shadow on a per-frame translated element forced
          repaint each tick instead of a compositor-only move. */}
      <div className="w-[1.5px] h-full bg-cyan-400 opacity-95 pointer-events-none" />
      {/* Top Diamond Head on Time Ruler */}
      <div
        className="absolute top-0 -translate-x-1/2 w-[13px] h-[13px] bg-cyan-400 rounded-[2px] rotate-45 cursor-grab active:cursor-grabbing pointer-events-auto -translate-y-1.5 z-[70]"
        onMouseDown={onStartDrag}
        title="Playhead (Drag to scrub)"
      />
    </div>
  );
});

TimelinePlayhead.displayName = 'TimelinePlayhead';
