import React, { useRef, useEffect } from 'react';
import { VscZoomIn, VscZoomOut } from 'react-icons/vsc';
import { Scissors, Maximize2 } from 'lucide-react';
import { ZOOM_MIN, ZOOM_MAX, FPS } from '../timelineConstants';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

interface TimelineZoomControlsProps {
  timelineZoom: number;
  setTimelineZoom: (zoom: number) => void;
  onFitTimeline?: () => void;
  onSplitAtPlayhead?: () => void;
  localTimings?: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  canSplit?: boolean;
}

export const TimelineZoomControls: React.FC<TimelineZoomControlsProps> = React.memo(({
  timelineZoom,
  setTimelineZoom,
  onFitTimeline,
  onSplitAtPlayhead,
  localTimings,
  canSplit: canSplitProp,
}) => {
  const storeCanSplit = useStoreWithEqualityFn(
    usePlaybackStore,
    (s) => {
      if (!localTimings || localTimings.length === 0) return false;
      const frame = s.currentFrame;
      const sceneIdx = localTimings.findIndex(t => frame >= t.start && frame < t.end);
      if (sceneIdx === -1) return false;
      const timing = localTimings[sceneIdx];
      if (!timing || !timing.subs) return false;
      const subIdx = timing.subs.findIndex(x => frame >= x.start && frame < x.end);
      if (subIdx === -1) return false;
      const sub = timing.subs[subIdx];
      const frameOffsetStart = frame - sub.start;
      const frameOffsetEnd = sub.end - frame;
      return frameOffsetStart >= 0.5 * FPS && frameOffsetEnd >= 0.5 * FPS;
    },
    Object.is
  );

  const canSplit = localTimings !== undefined ? storeCanSplit : (canSplitProp ?? false);

  // Zoom slider fires per mousemove (often several per frame). Coalesce to
  // one store update per frame — NOT a debounce: every value is applied,
  // same-frame, final value exact, so zoom never desyncs from the slider.
  const zoomRaf = useRef(0);
  const pendingZoom = useRef<number | null>(null);
  const scheduleZoom = (z: number) => {
    pendingZoom.current = z;
    if (zoomRaf.current) return;
    zoomRaf.current = requestAnimationFrame(() => {
      zoomRaf.current = 0;
      const v = pendingZoom.current;
      pendingZoom.current = null;
      if (v !== null) setTimelineZoom(v);
    });
  };
  useEffect(() => () => {
    cancelAnimationFrame(zoomRaf.current);
    zoomRaf.current = 0;
    if (pendingZoom.current !== null) {
      setTimelineZoom(pendingZoom.current);
      pendingZoom.current = null;
    }
  }, [setTimelineZoom]);

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
          onChange={(e) => scheduleZoom(Number(e.target.value))}
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
