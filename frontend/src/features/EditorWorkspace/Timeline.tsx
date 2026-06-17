import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { VscAdd, VscTrash, VscZoomIn, VscZoomOut } from 'react-icons/vsc';
import { formatTime } from '../../features/ProjectEditor/constants';
import { useEditorStore } from '../../store/useEditorStore';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onAddScene?: () => void;
  onDeleteScene?: (index: number) => void;
  onResizeScene?: (index: number, newDurationSeconds: number) => void;
  onReorderScene?: (fromIndex: number, toIndex: number) => void;
  readOnly?: boolean;
}

interface LocalTiming {
  start: number;
  end: number;
  subs: Array<{ start: number; end: number }>;
}

const SCENE_COLORS = [
  'from-blue-600/40 to-cyan-600/30 border-blue-500/40',
  'from-violet-600/40 to-purple-600/30 border-violet-500/40',
  'from-emerald-600/40 to-teal-600/30 border-emerald-500/40',
  'from-amber-600/40 to-orange-600/30 border-amber-500/40',
  'from-rose-600/40 to-pink-600/30 border-rose-500/40',
  'from-sky-600/40 to-indigo-600/30 border-sky-500/40',
  'from-lime-600/40 to-green-600/30 border-lime-500/40',
  'from-cyan-600/40 to-blue-600/30 border-cyan-500/40',
];

const SUBVISUAL_COLORS: Record<string, string> = {
  scene: 'from-blue-500/40 to-cyan-500/30 border-blue-500/50',
  image: 'from-sky-500/40 to-indigo-500/30 border-sky-500/50',
  portrait: 'from-purple-500/40 to-fuchsia-500/30 border-purple-500/50',
  chart: 'from-amber-500/40 to-orange-500/30 border-amber-500/50',
  map: 'from-emerald-500/40 to-green-500/30 border-emerald-500/50',
  parallax: 'from-pink-500/40 to-rose-500/30 border-pink-500/50',
  youtube: 'from-red-500/40 to-rose-500/30 border-red-500/50',
  network: 'from-teal-500/40 to-cyan-500/30 border-teal-500/50',
  document: 'from-stone-500/40 to-zinc-500/30 border-stone-500/50',
};

const SUBVISUAL_LABELS: Record<string, string> = {
  scene: '🎬',
  image: '🖼',
  portrait: '👤',
  chart: '📊',
  map: '🗺',
  parallax: '🎨',
  youtube: '▶️',
  network: '🔗',
  document: '📄',
};

const HEADER_WIDTH = 60;
const FPS = 30;
const ZOOM_MIN = 15;
const ZOOM_MAX = 240;
const HANDLE_WIDTH = 5;

export const Timeline: React.FC<TimelineProps> = ({
  liveScenes, sceneTimings, currentFrame, onSeek,
  onAddScene, onDeleteScene, onResizeScene, onReorderScene,
  readOnly = false
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredSceneIdx, setHoveredSceneIdx] = useState<number | null>(null);
  const [hoveredSubVisual, setHoveredSubVisual] = useState<{ scene: number; sub: number } | null>(null);

  // Zoom state (persisted to store)
  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);

  // Local timings for optimistic drag updates
  const [localTimings, setLocalTimings] = useState<LocalTiming[]>(sceneTimings);
  useEffect(() => { setLocalTimings(sceneTimings); }, [sceneTimings]);

  // Reorder drag state
  const [dragState, setDragState] = useState<{
    type: 'trim_left' | 'trim_right' | 'reorder';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
  } | null>(null);
  const dragRef = useRef<{
    type: 'trim_left' | 'trim_right' | 'reorder';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    mouseX: number;
    committed: boolean;
  } | null>(null);

  // Reorder insertion index
  const [reorderTargetIdx, setReorderTargetIdx] = useState<number | null>(null);

  // Playhead drag state
  const isDraggingPlayheadRef = useRef(false);

  const totalDuration = localTimings.length > 0 ? localTimings[localTimings.length - 1].end : 300;
  const totalWidth = Math.max((totalDuration / FPS) * timelineZoom + 100, 400);

  // Auto-scroll to playhead (disabled during drags)
  useEffect(() => {
    if (scrollRef.current && !dragRef.current && !isDraggingPlayheadRef.current) {
      const playheadX = (currentFrame / FPS) * timelineZoom;
      const containerWidth = scrollRef.current.clientWidth;
      if (playheadX > scrollRef.current.scrollLeft + containerWidth - 100 ||
          playheadX < scrollRef.current.scrollLeft + 100) {
        scrollRef.current.scrollLeft = Math.max(0, playheadX - containerWidth / 2);
      }
    }
  }, [currentFrame, timelineZoom]);

  // Global mouseup/mousemove for drag operations
  useEffect(() => {
    const handleMouseUp = () => {
      const d = dragRef.current;
      if (!d) return;
      // Bail out if this isn't a trim/reorder mouseup
      if (!d.type.startsWith('trim') && d.type !== 'reorder') return;
      dragRef.current = null;
      setDragState(null);
      setReorderTargetIdx(null);

      if (d.committed) return;
      d.committed = true;

      if (d.type === 'trim_left' || d.type === 'trim_right') {
        const newTiming = localTimings[d.sceneIdx];
        if (newTiming && onResizeScene) {
          const newDurationSec = (newTiming.end - newTiming.start) / FPS;
          // Find the actual scene index within the manifest (skip intro)
          // The sceneTimings array includes intro/scenes/conclusion, we need the scene-relative index
          const manifestSceneIndex = d.sceneIdx;
          onResizeScene(manifestSceneIndex, Math.max(1, newDurationSec));
        }
      } else if (d.type === 'reorder' && reorderTargetIdx !== null && reorderTargetIdx !== d.sceneIdx && onReorderScene) {
        onReorderScene(d.sceneIdx, reorderTargetIdx);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;

      const dx = e.clientX - d.initialMouseX;
      const frameDelta = Math.round((dx / timelineZoom) * FPS);

      if (d.type === 'trim_left') {
        setLocalTimings((prev) => {
          const next = [...prev];
          const t = { ...next[d.sceneIdx] };
          const prevEnd = d.sceneIdx > 0 ? prev[d.sceneIdx - 1].end + 1 : 0;
          const newStart = Math.max(prevEnd, d.initialStart + frameDelta);
          const minDuration = 30;
          t.start = Math.min(newStart, t.end - minDuration);
          t.start = Math.max(t.start, prevEnd);
          next[d.sceneIdx] = t;
          return next;
        });
      } else if (d.type === 'trim_right') {
        setLocalTimings((prev) => {
          const next = [...prev];
          const t = { ...next[d.sceneIdx] };
          const nextStart = d.sceneIdx < prev.length - 1 ? prev[d.sceneIdx + 1].start - 1 : Infinity;
          const minDuration = 30;
          const newEnd = Math.min(nextStart, d.initialEnd + frameDelta);
          t.end = Math.max(newEnd, t.start + minDuration);
          next[d.sceneIdx] = t;
          return next;
        });
      } else if (d.type === 'reorder') {
        // Determine where the scene should be inserted based on mouse position
        const scrollLeft = scrollRef.current?.scrollLeft || 0;
        const containerLeft = scrollRef.current?.getBoundingClientRect().left || 0;
        const mouseTimelineX = e.clientX - containerLeft + scrollLeft - HEADER_WIDTH;
        const mouseFrame = Math.max(0, (mouseTimelineX / timelineZoom) * FPS);

        // Find where the dragged scene's center would be
        let targetIdx = localTimings.findIndex((t, i) => {
          if (i === d.sceneIdx) return false;
          // Exclude intro (index 0) and conclusion (last) from reorder targets
          if (i === 0 || i === localTimings.length - 1) return false;
          return mouseFrame >= t.start && mouseFrame < t.end;
        });

        // If not over a scene, find nearest
        if (targetIdx === -1) {
          for (let i = 1; i < localTimings.length - 1; i++) {
            if (i === d.sceneIdx) continue;
            if (mouseFrame < localTimings[i].start) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx === -1 && mouseFrame >= localTimings[localTimings.length - 2].end) {
            targetIdx = localTimings.length - 1;
          }
        }

        setReorderTargetIdx(targetIdx);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [localTimings, timelineZoom, reorderTargetIdx, onResizeScene, onReorderScene]);

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current || isDraggingPlayheadRef.current) return;
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - HEADER_WIDTH;
    const frame = Math.max(0, Math.floor((x / timelineZoom) * FPS));
    onSeek(frame);
  }, [onSeek, timelineZoom]);

  const startPlayheadDrag = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingPlayheadRef.current = true;

    const getFrameFromMouse = (clientX: number) => {
      if (!scrollRef.current) return currentFrame;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = clientX - rect.left + scrollRef.current.scrollLeft - HEADER_WIDTH;
      return Math.max(0, Math.floor((x / timelineZoom) * FPS));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingPlayheadRef.current) return;
      const frame = getFrameFromMouse(e.clientX);
      onSeek(frame);
    };

    const handleMouseUp = () => {
      if (!isDraggingPlayheadRef.current) return;
      isDraggingPlayheadRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [currentFrame, onSeek, timelineZoom]);

  const startTrim = (e: React.MouseEvent, sceneIdx: number, side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const t = localTimings[sceneIdx];
    dragRef.current = {
      type: side === 'left' ? 'trim_left' : 'trim_right',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: t.start,
      initialEnd: t.end,
      mouseX: e.clientX,
      committed: false,
    };
    setDragState({
      type: side === 'left' ? 'trim_left' : 'trim_right',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: t.start,
      initialEnd: t.end,
    });
  };

  const startReorder = (e: React.MouseEvent, sceneIdx: number) => {
    e.stopPropagation();
    e.preventDefault();
    const t = localTimings[sceneIdx];
    dragRef.current = {
      type: 'reorder',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: t.start,
      initialEnd: t.end,
      mouseX: e.clientX,
      committed: false,
    };
    setDragState({
      type: 'reorder',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: t.start,
      initialEnd: t.end,
    });
  };

  const handleZoomIn = () => {
    setTimelineZoom(Math.min(ZOOM_MAX, Math.round(timelineZoom * 1.4)));
  };

  const handleZoomOut = () => {
    setTimelineZoom(Math.max(ZOOM_MIN, Math.round(timelineZoom / 1.4)));
  };

  const isDraggingScene = dragState?.type === 'reorder' || dragState?.type === 'trim_left' || dragState?.type === 'trim_right';

  const renderRuler = () => {
    const marks: React.ReactNode[] = [];
    const totalSeconds = Math.ceil(totalDuration / FPS);
    // Adaptive step based on zoom level
    const step = timelineZoom < 30 ? 10 : timelineZoom < 60 ? 5 : timelineZoom < 120 ? 2 : 1;
    for (let s = 0; s <= totalSeconds; s += step) {
      const x = s * timelineZoom;
      const isMajor = s % (step * 5) === 0;
      marks.push(
        <React.Fragment key={`ruler-${s}`}>
          <div className="absolute top-0" style={{ left: x + HEADER_WIDTH }}>
            <div className={`w-px ${isMajor ? 'h-3 bg-zinc-600' : 'h-1.5 bg-zinc-700'}`} />
            {isMajor && (
              <span className="text-[8px] font-mono text-zinc-500 absolute -translate-x-1/2 mt-1 select-none">
                {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        </React.Fragment>
      );
    }
    return marks;
  };

  const playheadX = (currentFrame / FPS) * timelineZoom + HEADER_WIDTH;

  return (
    <div className="h-full bg-zinc-950/90 border-t border-zinc-800/60 flex flex-col select-none overflow-hidden">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/40 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Timeline</span>
        {!readOnly && (
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
        )}
      </div>

      {/* Timeline tracks */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0"
        onClick={handleTimelineClick}
      >
        <div style={{ width: totalWidth, height: '100%', position: 'relative' }}>
          {/* Ruler */}
          <div className="h-6 relative border-b border-zinc-800/40 bg-zinc-950/50">
            {renderRuler()}
          </div>

          {/* Video Track with sub-visuals */}
          <div className="relative h-12 border-b border-zinc-800/30">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Video</span>
            </div>
            {localTimings.map((timing, idx) => {
              const scene = liveScenes?.[idx];
              const x = (timing.start / FPS) * timelineZoom;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
              const isActive = currentFrame >= timing.start && currentFrame < timing.end;
              const isHovered = hoveredSceneIdx === idx;
              const isReordering = dragState?.type === 'reorder' && dragState.sceneIdx === idx;
              const isTrimming = dragState && (dragState.type === 'trim_left' || dragState.type === 'trim_right') && dragState.sceneIdx === idx;
              const colorIdx = idx % SCENE_COLORS.length;
              const subVisuals = scene?.sub_visuals || [];
              const isIntroOrConclusion = scene?.section_type === 'introduction' || scene?.section_type === 'conclusion';

              // Compute sub-visual positions within this scene
              const subBlocks = timing.subs.map((sub, subIdx) => {
                const subX = ((sub.start - timing.start) / FPS) * timelineZoom;
                const subW = Math.max(4, ((sub.end - sub.start) / FPS) * timelineZoom);
                const svType = subVisuals[subIdx]?.visual_type || 'scene';
                const svColor = SUBVISUAL_COLORS[svType] || SUBVISUAL_COLORS.scene;
                const svLabel = SUBVISUAL_LABELS[svType] || '';
                const isSubActive = currentFrame >= sub.start && currentFrame < sub.end;
                const isSubHovered = hoveredSubVisual?.scene === idx && hoveredSubVisual?.sub === subIdx;
                return { subX, subW, svType, svColor, svLabel, isSubActive, isSubHovered, subIdx, subStart: sub.start };
              });

              return (
                <motion.div
                  key={idx}
                  className={`absolute top-1 rounded-md border bg-gradient-to-r ${SCENE_COLORS[colorIdx]}
                    ${isActive && !isTrimming ? 'ring-2 ring-blue-400/50 z-20' : 'z-10'}
                    ${isHovered && !isReordering && !isTrimming ? 'ring-1 ring-white/30' : ''}
                    ${isReordering ? 'ring-2 ring-blue-400/60 shadow-2xl opacity-90 scale-105 z-30' : ''}
                    ${isTrimming ? 'ring-2 ring-amber-400/60 z-20' : ''}
                    cursor-pointer overflow-hidden`}
                  style={{ left: x + HEADER_WIDTH, width: w, height: 40 }}
                  onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
                  onMouseEnter={() => setHoveredSceneIdx(idx)}
                  onMouseLeave={() => setHoveredSceneIdx(null)}
                  layout
                >
                  {/* Sub-visual blocks */}
                  {subBlocks.length > 0 ? (
                    <div className="flex h-full">
                      {subBlocks.map((sb) => (
                        <div
                          key={sb.subIdx}
                          className={`relative h-full border-r last:border-r-0 bg-gradient-to-r ${sb.svColor}
                            ${sb.isSubActive ? 'ring-1 ring-inset ring-white/40 z-10' : ''}
                            ${sb.isSubHovered ? 'brightness-125' : ''}
                            transition-all cursor-pointer`}
                          style={{ width: sb.subW, minWidth: 4 }}
                          onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(sb.subStart); } }}
                          onMouseEnter={() => setHoveredSubVisual({ scene: idx, sub: sb.subIdx })}
                          onMouseLeave={() => setHoveredSubVisual(null)}
                        >
                          {sb.subW > 16 && (
                            <span className="text-[7px] leading-[40px] px-1 block truncate opacity-70">
                              {sb.svLabel}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 px-2 h-full overflow-hidden">
                      <span className="text-[8px] font-bold text-white/90 truncate whitespace-nowrap">
                        {scene?.title || `Scene ${idx}`}
                      </span>
                      <span className="text-[7px] font-mono text-white/50 shrink-0">
                        {formatTime(timing.start)}
                      </span>
                    </div>
                  )}

                  {/* Edge trim handles */}
                  {!readOnly && isHovered && !isIntroOrConclusion && !isDraggingScene && (
                    <>
                      {/* Left handle */}
                      <div
                        className="absolute left-0 top-0 bottom-0 z-20 cursor-col-resize bg-transparent hover:bg-blue-400/40 transition-colors"
                        style={{ width: HANDLE_WIDTH }}
                        onMouseDown={(e) => startTrim(e, idx, 'left')}
                      />
                      {/* Right handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 z-20 cursor-col-resize bg-transparent hover:bg-blue-400/40 transition-colors"
                        style={{ width: HANDLE_WIDTH }}
                        onMouseDown={(e) => startTrim(e, idx, 'right')}
                      />
                    </>
                  )}

                  {/* Reorder drag handle (center area) */}
                  {!readOnly && isHovered && !isIntroOrConclusion && !isDraggingScene && (
                    <div
                      className="absolute inset-x-[6px] top-0 bottom-0 z-15 cursor-grab active:cursor-grabbing"
                      onMouseDown={(e) => startReorder(e, idx)}
                    />
                  )}

                  {/* Scene label when sub-visuals are shown */}
                  {subBlocks.length > 0 && (
                    <div className="absolute bottom-0 left-1 right-1 flex items-center justify-between pointer-events-none">
                      <span className="text-[7px] font-bold text-white/70 truncate">
                        {scene?.title || `Scene ${idx}`}
                      </span>
                    </div>
                  )}

                  {/* Hover actions (delete button) */}
                  {!readOnly && isHovered && !isIntroOrConclusion && !isDraggingScene && (
                    <div className="absolute -top-6 right-1 flex gap-0.5 z-30">
                      {onDeleteScene && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteScene(idx); }}
                          className="w-5 h-5 flex items-center justify-center rounded bg-red-600/80 text-white hover:bg-red-500"
                        >
                          <VscTrash className="text-[8px]" />
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Audio Track (single block per scene) */}
          <div className="relative h-9 border-b border-zinc-800/30">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Audio</span>
            </div>
            {localTimings.map((timing, idx) => {
              const x = (timing.start / FPS) * timelineZoom;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
              return (
                <div
                  key={idx}
                  className="absolute top-2 h-5 rounded-sm bg-emerald-600/20 border border-emerald-600/20 cursor-pointer"
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
                />
              );
            })}
          </div>

          {/* Subtitle Track (sub-visual blocks) */}
          <div className="relative h-9">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Subs</span>
            </div>
            {localTimings.map((timing, idx) => {
              const x = (timing.start / FPS) * timelineZoom;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
              const scene = liveScenes?.[idx];
              const subVisuals = scene?.sub_visuals || [];
              const subs = timing.subs || [];

              if (subs.length > 1 || (subs.length === 1 && subVisuals.length > 0)) {
                // Render individual sub-visual blocks
                return (
                  <div
                    key={idx}
                    className="absolute top-2.5 h-[15px] cursor-pointer flex"
                    style={{ left: x + HEADER_WIDTH, width: w }}
                  >
                    {subs.map((sub, subIdx) => {
                      const subW = Math.max(5, ((sub.end - sub.start) / (timing.end - timing.start)) * 100);
                      const svType = subVisuals[subIdx]?.visual_type || 'scene';
                      const svColor = SUBVISUAL_COLORS[svType] || SUBVISUAL_COLORS.scene;
                      return (
                        <div
                          key={subIdx}
                          className={`h-full bg-gradient-to-r ${svColor} border-r last:border-r-0 rounded-sm opacity-60`}
                          style={{ width: `${subW}%` }}
                          onClick={(e) => { e.stopPropagation(); onSeek(sub.start); }}
                        />
                      );
                    })}
                  </div>
                );
              }

              // Fallback: single block
              return (
                <div
                  key={idx}
                  className="absolute top-2.5 h-[15px] rounded-sm bg-purple-600/20 border border-purple-600/20 cursor-pointer"
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
                >
                  <span className="text-[6px] text-purple-400/60 px-1 leading-[15px] truncate block">Captions</span>
                </div>
              );
            })}
          </div>

          {/* Reorder insertion indicator */}
          {reorderTargetIdx !== null && dragState?.type === 'reorder' && (
            <div
              className="absolute top-6 bottom-0 w-0.5 bg-blue-400 z-40 shadow-lg shadow-blue-400/50"
              style={{
                left: reorderTargetIdx < localTimings.length
                  ? (localTimings[reorderTargetIdx]?.start / FPS) * timelineZoom + HEADER_WIDTH
                  : totalWidth - 1
              }}
            />
          )}

          {/* Empty state hint */}
          {sceneTimings.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[10px] text-zinc-600 font-medium tracking-wider">No scenes to display</p>
                <p className="text-[8px] text-zinc-700 mt-1">Generate a script or add scenes from the sidebar</p>
              </div>
            </div>
          )}

          {/* Playhead — draggable */}
          <div
            className="absolute top-0 bottom-0 z-30"
            style={{ left: playheadX }}
          >
            {/* Invisible click strip across full height for easy grabbing */}
            <div
              className="absolute inset-y-0 -translate-x-1/2 w-4 cursor-grab active:cursor-grabbing z-40"
              onMouseDown={startPlayheadDrag}
            />
            <div className="w-0.5 h-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-600 shadow-lg shadow-blue-500/50 pointer-events-none" />
            <div
              className="absolute -top-0.5 -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-sm rotate-45 shadow-md shadow-blue-500/50 cursor-grab active:cursor-grabbing z-40 hover:bg-blue-400 hover:shadow-blue-400/70 transition-all"
              onMouseDown={startPlayheadDrag}
            />
          </div>

          {/* Add scene button at end */}
          {onAddScene && (
            <div
              className="absolute top-[30px] flex items-center justify-center cursor-pointer hover:text-blue-400 text-zinc-500 transition-colors z-20"
              style={{ left: totalWidth + 10 }}
              onClick={onAddScene}
            >
              <div className="flex items-center gap-1 px-2 py-1 rounded border border-dashed border-zinc-700 hover:border-blue-600/40 text-[10px]">
                <VscAdd className="text-xs" /> Add
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
