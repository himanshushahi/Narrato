import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import { formatTime } from '../../features/ProjectEditor/constants';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onAddScene?: () => void;
  onDeleteScene?: (index: number) => void;
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

const PIXELS_PER_SECOND = 60;
const HEADER_WIDTH = 60;
const FPS = 30;

export const Timeline: React.FC<TimelineProps> = ({
  liveScenes, sceneTimings, currentFrame, onSeek, onAddScene, onDeleteScene
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredSceneIdx, setHoveredSceneIdx] = useState<number | null>(null);

  const totalDuration = sceneTimings.length > 0 ? sceneTimings[sceneTimings.length - 1].end : 300;
  const totalWidth = Math.max((totalDuration / FPS) * PIXELS_PER_SECOND + 100, 400);

  // Auto-scroll to playhead
  useEffect(() => {
    if (scrollRef.current) {
      const playheadX = (currentFrame / FPS) * PIXELS_PER_SECOND;
      const containerWidth = scrollRef.current.clientWidth;
      if (playheadX > scrollRef.current.scrollLeft + containerWidth - 100 ||
          playheadX < scrollRef.current.scrollLeft + 100) {
        scrollRef.current.scrollLeft = Math.max(0, playheadX - containerWidth / 2);
      }
    }
  }, [currentFrame]);

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - HEADER_WIDTH;
    const frame = Math.max(0, Math.floor((x / PIXELS_PER_SECOND) * FPS));
    onSeek(frame);
  }, [onSeek]);

  const renderRuler = () => {
    const marks: React.ReactNode[] = [];
    const totalSeconds = Math.ceil(totalDuration / FPS);
    for (let s = 0; s <= totalSeconds; s++) {
      const x = s * PIXELS_PER_SECOND;
      const isMajor = s % 5 === 0;
      marks.push(
        <React.Fragment key={`ruler-${s}`}>
          <div
            className="absolute top-0"
            style={{ left: x + HEADER_WIDTH }}
          >
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

  const playheadX = (currentFrame / FPS) * PIXELS_PER_SECOND + HEADER_WIDTH;

  return (
    <div className="h-full bg-zinc-950/90 border-t border-zinc-800/60 flex flex-col select-none overflow-hidden">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/40 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Timeline</span>
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

          {/* Video Track */}
          <div className="relative h-9 border-b border-zinc-800/30">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Video</span>
            </div>
            {sceneTimings.map((timing, idx) => {
              const scene = liveScenes?.[idx];
              const x = (timing.start / FPS) * PIXELS_PER_SECOND;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * PIXELS_PER_SECOND);
              const isActive = currentFrame >= timing.start && currentFrame < timing.end;
              const isHovered = hoveredSceneIdx === idx;
              const colorIdx = idx % SCENE_COLORS.length;

              return (
                <motion.div
                  key={idx}
                  className={`absolute top-1 h-7 rounded-md border bg-gradient-to-r ${SCENE_COLORS[colorIdx]}
                    ${isActive ? 'ring-2 ring-blue-400/50 z-20' : 'z-10'}
                    ${isHovered ? 'ring-1 ring-white/30' : ''}
                    cursor-pointer hover:brightness-125 transition-all`}
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { e.stopPropagation(); onSeek(timing.start); }}
                  onMouseEnter={() => setHoveredSceneIdx(idx)}
                  onMouseLeave={() => setHoveredSceneIdx(null)}
                  whileHover={{ scale: 1.03 }}
                >
                  <div className="flex items-center gap-1 px-2 h-full overflow-hidden">
                    <span className="text-[8px] font-bold text-white/90 truncate whitespace-nowrap">
                      {scene?.title || `Scene ${idx + 1}`}
                    </span>
                    <span className="text-[7px] font-mono text-white/50 shrink-0">
                      {formatTime(timing.start)}
                    </span>
                  </div>
                  {/* Hover actions */}
                  {isHovered && (
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

          {/* Audio Track */}
          <div className="relative h-9 border-b border-zinc-800/30">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Audio</span>
            </div>
            {sceneTimings.map((timing, idx) => {
              const x = (timing.start / FPS) * PIXELS_PER_SECOND;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * PIXELS_PER_SECOND);
              return (
                <div
                  key={idx}
                  className="absolute top-2 h-5 rounded-sm bg-emerald-600/20 border border-emerald-600/20 cursor-pointer"
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { e.stopPropagation(); onSeek(timing.start); }}
                />
              );
            })}
          </div>

          {/* Subtitle Track */}
          <div className="relative h-9">
            <div className="absolute left-0 top-0 w-[HEADER_WIDTH] h-full bg-zinc-900/80 border-r border-zinc-800/40 flex items-center px-2 z-10">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Subs</span>
            </div>
            {sceneTimings.map((timing, idx) => {
              const x = (timing.start / FPS) * PIXELS_PER_SECOND;
              const w = Math.max(8, ((timing.end - timing.start) / FPS) * PIXELS_PER_SECOND);
              return (
                <div
                  key={idx}
                  className="absolute top-2.5 h-[15px] rounded-sm bg-purple-600/20 border border-purple-600/20 cursor-pointer"
                  style={{ left: x + HEADER_WIDTH, width: w }}
                  onClick={(e) => { e.stopPropagation(); onSeek(timing.start); }}
                >
                  <span className="text-[6px] text-purple-400/60 px-1 leading-[15px] truncate block">Captions</span>
                </div>
              );
            })}
          </div>

          {/* Empty state hint */}
          {sceneTimings.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[10px] text-zinc-600 font-medium tracking-wider">No scenes to display</p>
                <p className="text-[8px] text-zinc-700 mt-1">Generate a script or add scenes from the sidebar</p>
              </div>
            </div>
          )}

          {/* Playhead */}
          <motion.div
            className="absolute top-0 bottom-0 z-30 pointer-events-none"
            style={{ left: playheadX }}
            layout
          >
            <div className="w-0.5 h-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-600 shadow-lg shadow-blue-500/50" />
            <div className="absolute -top-0.5 -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-sm rotate-45 shadow-md shadow-blue-500/50" />
          </motion.div>

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
