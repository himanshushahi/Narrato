import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { VscAdd, VscTrash, VscZoomIn, VscZoomOut, VscMute, VscUnmute, VscEye, VscEyeClosed } from 'react-icons/vsc';
import { Clapperboard, Image as ImageIcon, User, BarChart2, Map as MapIcon, Layers, MonitorPlay, Link as LinkIcon, FileText } from 'lucide-react';
import { formatTime } from '../../features/ProjectEditor/constants';
import { useEditorStore } from '../../store/useEditorStore';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  transcriptionData?: any;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onAddScene?: () => void;
  onDeleteScene?: (index: number) => void;
  onResizeScene?: (index: number, newDurationSeconds: number) => void;
  onResizeSubVisual?: (sceneIndex: number, newRatios: number[]) => void;
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

const SUBVISUAL_ICONS: Record<string, React.ElementType> = {
  scene: Clapperboard,
  image: ImageIcon,
  portrait: User,
  chart: BarChart2,
  map: MapIcon,
  parallax: Layers,
  youtube: MonitorPlay,
  network: LinkIcon,
  document: FileText,
};

const HEADER_WIDTH = 110;
const FPS = 30;
const ZOOM_MIN = 15;
const ZOOM_MAX = 240;
const HANDLE_WIDTH = 5;

export const Timeline: React.FC<TimelineProps> = ({
  liveScenes, sceneTimings, transcriptionData, currentFrame, onSeek,
  onAddScene, onDeleteScene, onResizeScene, onResizeSubVisual, onReorderScene,
  readOnly = false
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredSceneIdx, setHoveredSceneIdx] = useState<number | null>(null);
  const [hoveredSubVisual, setHoveredSubVisual] = useState<{ scene: number; sub: number } | null>(null);

  // Zoom state (persisted to store)
  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const trackMuted = useEditorStore((s) => s.trackMuted);
  const trackHidden = useEditorStore((s) => s.trackHidden);
  const toggleTrackMute = useEditorStore((s) => s.toggleTrackMute);
  const toggleTrackHide = useEditorStore((s) => s.toggleTrackHide);

  // Local timings for optimistic drag updates
  const [localTimings, setLocalTimings] = useState<LocalTiming[]>(sceneTimings);
  useEffect(() => { setLocalTimings(sceneTimings); }, [sceneTimings]);

  // Reorder drag state
  const [dragState, setDragState] = useState<{
    type: 'trim_left' | 'trim_right' | 'reorder' | 'resize_sub_visual';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    subIdx?: number;
    initialRatios?: number[];
  } | null>(null);
  const dragRef = useRef<{
    type: 'trim_left' | 'trim_right' | 'reorder' | 'resize_sub_visual';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    subIdx?: number;
    initialRatios?: number[];
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

  const startSubVisualResize = useCallback((e: React.MouseEvent, sceneIdx: number, subIdx: number) => {
    e.stopPropagation();
    if (!scrollRef.current) return;
    
    const scene = liveScenes?.[sceneIdx];
    if (!scene) return;
    
    // Compute current ratios based on durations
    const timing = localTimings[sceneIdx];
    const sceneDuration = timing.end - timing.start;
    if (sceneDuration <= 0) return;
    
    const initialRatios = timing.subs.map(sub => (sub.end - sub.start) / sceneDuration);

    dragRef.current = {
      type: 'resize_sub_visual',
      sceneIdx,
      subIdx,
      initialMouseX: e.clientX,
      initialStart: 0,
      initialEnd: 0,
      initialRatios,
      mouseX: e.clientX,
      committed: false
    };
    setDragState(dragRef.current);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [localTimings, liveScenes]);

  // Global mouseup/mousemove for drag operations
  useEffect(() => {
    const handleMouseUp = () => {
      const d = dragRef.current;
      if (!d) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragRef.current = null;
      setDragState(null);
      setReorderTargetIdx(null);

      if (d.committed) return;
      d.committed = true;

      if (d.type === 'trim_left' || d.type === 'trim_right') {
        const t = localTimings[d.sceneIdx];
        if (onResizeScene) {
          const newDur = (t.end - t.start) / FPS;
          onResizeScene(d.sceneIdx, newDur);
        }
      } else if (d.type === 'reorder' && reorderTargetIdx !== null && reorderTargetIdx !== d.sceneIdx && onReorderScene) {
        onReorderScene(d.sceneIdx, reorderTargetIdx);
      } else if (d.type === 'resize_sub_visual' && onResizeSubVisual) {
        // Compute new ratios directly from localTimings
        const timing = localTimings[d.sceneIdx];
        const sceneDuration = timing.end - timing.start;
        if (sceneDuration > 0) {
          const newRatios = timing.subs.map(sub => (sub.end - sub.start) / sceneDuration);
          onResizeSubVisual(d.sceneIdx, newRatios);
        }
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
      } else if (d.type === 'resize_sub_visual' && d.subIdx !== undefined && d.initialRatios) {
        const timing = localTimings[d.sceneIdx];
        const sceneDurationFrames = timing.end - timing.start;
        if (sceneDurationFrames <= 0) return;
        
        // Calculate the ratio change based on pixel movement
        // total width of scene = (sceneDurationFrames / FPS) * timelineZoom
        const scenePixelWidth = (sceneDurationFrames / FPS) * timelineZoom;
        const deltaRatio = dx / scenePixelWidth;
        
        setLocalTimings((prev) => {
          const next = [...prev];
          const t = { ...next[d.sceneIdx] };
          const subs = [...t.subs];
          
          const ratios = [...d.initialRatios!];
          const MIN_RATIO = 0.5 / (sceneDurationFrames / FPS); // Minimum 0.5 seconds
          
          let sumBefore = 0;
          for (let i = 0; i < d.subIdx!; i++) sumBefore += ratios[i];
          
          let newSplitRatio = sumBefore + ratios[d.subIdx!] + deltaRatio;
          
          const leftBound = sumBefore + MIN_RATIO;
          const rightBound = sumBefore + ratios[d.subIdx!] + ratios[d.subIdx! + 1] - MIN_RATIO;
          
          newSplitRatio = Math.max(leftBound, Math.min(newSplitRatio, rightBound));
          
          const newLeftRatio = newSplitRatio - sumBefore;
          const newRightRatio = (ratios[d.subIdx!] + ratios[d.subIdx! + 1]) - newLeftRatio;
          
          ratios[d.subIdx!] = newLeftRatio;
          ratios[d.subIdx! + 1] = newRightRatio;
          
          // Recompute sub frames
          let currentStart = t.start;
          for (let i = 0; i < subs.length; i++) {
            const subDurFrames = Math.max(1, Math.round(ratios[i] * sceneDurationFrames));
            subs[i] = { start: currentStart, end: currentStart + subDurFrames };
            currentStart += subDurFrames;
          }
          // Ensure the last sub ends exactly at the scene's end
          subs[subs.length - 1].end = t.end;
          
          t.subs = subs;
          next[d.sceneIdx] = t;
          return next;
        });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [localTimings, timelineZoom, reorderTargetIdx, onResizeScene, onReorderScene, onResizeSubVisual]);

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

  const isDraggingScene = dragState?.type === 'reorder' || dragState?.type === 'trim_left' || dragState?.type === 'trim_right' || dragState?.type === 'resize_sub_visual';

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
          <div className="h-6 relative border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
            {renderRuler()}
          </div>

          {/* Video Track with sub-visuals */}
          <div className="relative h-14 border-b border-zinc-800/40 bg-zinc-900/10 hover:bg-zinc-900/30 transition-colors">
            <div className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md shadow-[4px_0_15px_rgba(0,0,0,0.5)]" style={{ width: HEADER_WIDTH }}>
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                Video
              </span>
              <div className="flex items-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); toggleTrackHide('video'); }} className="text-zinc-500 hover:text-cyan-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackHidden['video'] ? "Show track" : "Hide track"}>
                  {trackHidden['video'] ? <VscEyeClosed className="text-[14px]" /> : <VscEye className="text-[14px]" />}
                </button>
              </div>
            </div>
            {!trackHidden['video'] && localTimings.map((timing, idx) => {
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
                const isSubActive = currentFrame >= sub.start && currentFrame < sub.end;
                const isSubHovered = hoveredSubVisual?.scene === idx && hoveredSubVisual?.sub === subIdx;
                const IconComponent = SUBVISUAL_ICONS[svType] || Clapperboard;
                return { subX, subW, svType, svColor, isSubActive, isSubHovered, subIdx, subStart: sub.start, IconComponent };
              });

              return (
                <motion.div
                  key={idx}
                  className={`absolute top-2 rounded-md border bg-gradient-to-r ${SCENE_COLORS[colorIdx]}
                    ${isActive && !isTrimming ? 'ring-2 ring-cyan-400/60 z-20 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'z-10 shadow-md'}
                    ${isHovered && !isReordering && !isTrimming ? 'ring-1 ring-white/40 brightness-110' : ''}
                    ${isReordering ? 'ring-2 ring-blue-400/80 shadow-2xl opacity-90 scale-[1.02] z-30' : ''}
                    ${isTrimming ? 'ring-2 ring-amber-400/80 z-20 bg-amber-900/20' : ''}
                    cursor-pointer overflow-hidden transition-all duration-200 ease-out`}
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
                          className={`relative h-full border-r border-zinc-950/30 last:border-r-0 bg-gradient-to-r ${sb.svColor}
                            ${sb.isSubActive ? 'ring-1 ring-inset ring-white/40 z-10' : ''}
                            ${sb.isSubHovered ? 'brightness-125' : ''}
                            transition-all cursor-pointer group/sub`}
                          style={{ width: sb.subW, minWidth: 4 }}
                          onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(sb.subStart); } }}
                          onMouseEnter={() => setHoveredSubVisual({ scene: idx, sub: sb.subIdx })}
                          onMouseLeave={() => setHoveredSubVisual(null)}
                        >
                          {sb.subW > 16 && (
                            <div className="absolute inset-0 flex items-center gap-1.5 px-2 overflow-hidden opacity-70">
                              <sb.IconComponent className="w-[10px] h-[10px] shrink-0" />
                              {sb.subW > 40 && <span className="text-[8px] font-medium tracking-wide capitalize truncate">{sb.svType}</span>}
                            </div>
                          )}
                          
                          {/* Sub-visual resize handle (except for the last one) */}
                          {!readOnly && !isDraggingScene && sb.subIdx < subBlocks.length - 1 && (
                            <div 
                              className="absolute right-0 top-0 bottom-0 w-2 translate-x-1/2 z-20 cursor-col-resize flex justify-center opacity-0 group-hover/sub:opacity-100 transition-opacity"
                              onMouseDown={(e) => startSubVisualResize(e, idx, sb.subIdx)}
                            >
                              <div className="w-[2px] h-full bg-cyan-400" />
                            </div>
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

          {/* Voiceover Track */}
          <div className="relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
            <div className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md shadow-[4px_0_15px_rgba(0,0,0,0.5)]" style={{ width: HEADER_WIDTH }}>
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                Voice
              </span>
              <div className="flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); toggleTrackMute('voice'); }} className="text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackMuted['voice'] ? "Unmute track" : "Mute track"}>
                  {trackMuted['voice'] ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
                </button>
              </div>
            </div>
            {localTimings.map((timing, idx) => {
              const x = (timing.start / FPS) * timelineZoom;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
              const scene = liveScenes?.[idx];
              // Don't render voice block if scene has no narration text
              const hasNarration = scene?.text && scene.text.trim().length > 0;
              if (!hasNarration) return null;
              return (
                <div
                  key={idx}
                  className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${trackMuted['voice'] ? 'bg-zinc-800/30 border-zinc-700/30 opacity-50' : 'bg-gradient-to-b from-emerald-600/30 to-emerald-700/20 border-emerald-500/40 hover:from-emerald-500/40 hover:to-emerald-600/30 hover:border-emerald-400/60 shadow-[0_0_10px_rgba(16,185,129,0.1)]'}`}
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
                  title={`Voiceover - Scene ${idx}`}
                />
              );
            })}
          </div>

          {/* Music Track */}
          <div className="relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
            <div className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md shadow-[4px_0_15px_rgba(0,0,0,0.5)]" style={{ width: HEADER_WIDTH }}>
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                Music
              </span>
              <div className="flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); toggleTrackMute('music'); }} className="text-zinc-500 hover:text-blue-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackMuted['music'] ? "Unmute track" : "Mute track"}>
                  {trackMuted['music'] ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
                </button>
              </div>
            </div>
            <div
              className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${trackMuted['music'] ? 'bg-zinc-800/30 border-zinc-700/30 opacity-50' : 'bg-gradient-to-b from-blue-600/30 to-blue-700/20 border-blue-500/40 hover:from-blue-500/40 hover:to-blue-600/30 hover:border-blue-400/60 shadow-[0_0_10px_rgba(59,130,246,0.1)]'}`}
              style={{ left: HEADER_WIDTH, width: Math.max(10, (totalDuration / FPS) * timelineZoom) }}
              onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(0); } }}
              title="Background Music Track"
            >
              <span className={`text-[8px] font-medium px-2 leading-[22px] tracking-wide truncate block ${trackMuted['music'] ? 'text-zinc-500' : 'text-blue-300/80'}`}>Background Music</span>
            </div>
          </div>

          {/* Subtitle Track */}
          <div className="relative h-11 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
            <div className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md shadow-[4px_0_15px_rgba(0,0,0,0.5)]" style={{ width: HEADER_WIDTH }}>
              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
                Subs
              </span>
              <div className="flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); toggleTrackHide('subs'); }} className="text-zinc-500 hover:text-purple-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackHidden['subs'] ? "Show track" : "Hide track"}>
                  {trackHidden['subs'] ? <VscEyeClosed className="text-[14px]" /> : <VscEye className="text-[14px]" />}
                </button>
              </div>
            </div>
            {!trackHidden['subs'] && (
              transcriptionData?.segments?.length > 0 ? (
                transcriptionData.segments.map((segment: any, idx: number) => {
                  const startSec = segment.start;
                  const endSec = segment.end;
                  const x = startSec * timelineZoom;
                  const w = Math.max(4, (endSec - startSec) * timelineZoom);
                  return (
                    <div
                      key={`sub-${idx}`}
                      className="absolute top-3 h-[18px] rounded-md bg-gradient-to-b from-purple-500/30 to-purple-600/20 border border-purple-500/40 hover:from-purple-400/40 hover:to-purple-500/30 hover:border-purple-400/60 cursor-pointer overflow-hidden transition-all shadow-[0_0_10px_rgba(168,85,247,0.1)]"
                      style={{ left: x + HEADER_WIDTH, width: w }}
                      onClick={(e) => { e.stopPropagation(); onSeek(Math.floor(startSec * FPS)); }}
                      title={`Subtitle: "${segment.text.trim()}"\nDuration: ${(endSec - startSec).toFixed(2)}s`}
                    >
                      {w > 20 && (
                        <span className="text-[9px] font-medium text-purple-100/90 px-1.5 leading-[16px] truncate block font-sans">
                          {segment.text.trim()}
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none" style={{ left: HEADER_WIDTH }}>
                   <span className="text-[8px] text-zinc-600 px-2 italic">No subtitles generated yet</span>
                </div>
              )
            )}
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
            className="absolute top-0 bottom-0 z-50 pointer-events-none"
            style={{ left: playheadX }}
          >
            {/* Invisible click strip across full height for easy grabbing */}
            <div
              className="absolute inset-y-0 -translate-x-1/2 w-4 cursor-grab active:cursor-grabbing pointer-events-auto"
              onMouseDown={startPlayheadDrag}
            />
            <div className="w-px h-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)] opacity-90" />
            <div
              className="absolute -top-1 -translate-x-1/2 w-[11px] h-[11px] bg-cyan-400 rounded-sm rotate-45 shadow-[0_0_10px_rgba(6,182,212,0.8)] cursor-grab active:cursor-grabbing pointer-events-auto hover:scale-110 transition-transform"
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
