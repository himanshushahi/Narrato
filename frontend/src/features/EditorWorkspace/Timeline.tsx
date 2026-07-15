import React, { useRef, useEffect, useState, useCallback } from 'react';

import { useEditorStore } from '../../store/useEditorStore';
import { FPS, HEADER_WIDTH } from './timelineConstants';

import { TimelineRuler } from './components/TimelineRuler';
import { TimelinePlayhead } from './components/TimelinePlayhead';
import { TimelineZoomControls } from './components/TimelineZoomControls';
import { VideoTrack } from './components/VideoTrack';
import { VoiceTrack } from './components/VoiceTrack';
import { MusicTrack } from './components/MusicTrack';
import { SubtitleTrack } from './components/SubtitleTrack';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  transcriptionData?: any;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onDeleteScene?: (index: number) => void;
  onResizeSubVisual?: (sceneIndex: number, newRatios: number[]) => void;
  readOnly?: boolean;
}

interface LocalTiming {
  start: number;
  end: number;
  subs: Array<{ start: number; end: number }>;
}

export const Timeline: React.FC<TimelineProps> = ({
  liveScenes, sceneTimings, transcriptionData, currentFrame, onSeek,
  onDeleteScene, onResizeSubVisual,
  readOnly = false
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredSceneIdx, setHoveredSceneIdx] = useState<number | null>(null);
  const [hoveredSubVisual, setHoveredSubVisual] = useState<{ scene: number; sub: number } | null>(null);

  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const trackMuted = useEditorStore((s) => s.trackMuted);
  const trackHidden = useEditorStore((s) => s.trackHidden);
  const toggleTrackMute = useEditorStore((s) => s.toggleTrackMute);
  const toggleTrackHide = useEditorStore((s) => s.toggleTrackHide);

  const [localTimings, setLocalTimings] = useState<LocalTiming[]>(sceneTimings);
  useEffect(() => { setLocalTimings(sceneTimings); }, [sceneTimings]);

  const [dragState, setDragState] = useState<{
    type: 'resize_sub_visual';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    subIdx?: number;
    initialRatios?: number[];
  } | null>(null);
  const dragRef = useRef<{
    type: 'resize_sub_visual';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    subIdx?: number;
    initialRatios?: number[];
    mouseX: number;
    committed: boolean;
  } | null>(null);

  const isDraggingPlayheadRef = useRef(false);

  const totalDuration = localTimings.length > 0 ? localTimings[localTimings.length - 1].end : 300;
  const totalW = Math.max((totalDuration / FPS) * timelineZoom + 100, 400);

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
      committed: false,
    };
    setDragState(dragRef.current);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [localTimings, liveScenes]);

  useEffect(() => {
    const handleMouseUp = () => {
      const d = dragRef.current;
      if (!d) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragRef.current = null;
      setDragState(null);
      if (d.committed) return;
      d.committed = true;

      if (d.type === 'resize_sub_visual' && onResizeSubVisual) {
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

      if (d.type === 'resize_sub_visual' && d.subIdx !== undefined && d.initialRatios) {
        const timing = localTimings[d.sceneIdx];
        const sceneDurationFrames = timing.end - timing.start;
        if (sceneDurationFrames <= 0) return;

        const scenePixelWidth = (sceneDurationFrames / FPS) * timelineZoom;
        const deltaRatio = dx / scenePixelWidth;

        setLocalTimings((prev) => {
          const next = [...prev];
          const t = { ...next[d.sceneIdx] };
          const subs = [...t.subs];

          const ratios = [...d.initialRatios!];
          const MIN_RATIO = 0.5 / (sceneDurationFrames / FPS);

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

          let currentStart = t.start;
          for (let i = 0; i < subs.length; i++) {
            const subDurFrames = Math.max(1, Math.round(ratios[i] * sceneDurationFrames));
            subs[i] = { start: currentStart, end: currentStart + subDurFrames };
            currentStart += subDurFrames;
          }
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
  }, [localTimings, timelineZoom, onResizeSubVisual]);

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

  const isDraggingScene = dragState?.type === 'resize_sub_visual';

  const handleDeleteScene = useCallback((index: number) => {
    onDeleteScene?.(index);
  }, [onDeleteScene]);

  const handleSceneHoverEnter = useCallback((idx: number) => setHoveredSceneIdx(idx), []);
  const handleSceneHoverLeave = useCallback(() => setHoveredSceneIdx(null), []);
  const handleSubHoverEnter = useCallback((scene: number, sub: number) => setHoveredSubVisual({ scene, sub }), []);
  const handleSubHoverLeave = useCallback(() => setHoveredSubVisual(null), []);

  return (
    <div className="h-full bg-zinc-950/90 border-t border-zinc-800/60 flex flex-col select-none overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/40 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Timeline</span>
        {!readOnly && <TimelineZoomControls timelineZoom={timelineZoom} setTimelineZoom={setTimelineZoom} />}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto timeline-scrollbar min-h-0"
        onClick={handleTimelineClick}
      >
        <div style={{ width: totalW, height: '100%', position: 'relative' }}>
          <div className="h-6 relative border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
            <TimelineRuler totalDuration={totalDuration} timelineZoom={timelineZoom} />
          </div>

          <VideoTrack
            localTimings={localTimings}
            liveScenes={liveScenes}
            timelineZoom={timelineZoom}
            currentFrame={currentFrame}
            hoveredSceneIdx={hoveredSceneIdx}
            hoveredSubVisual={hoveredSubVisual}
            isDraggingScene={isDraggingScene}
            readOnly={readOnly}
            onSeek={onSeek}
            onSceneHoverEnter={handleSceneHoverEnter}
            onSceneHoverLeave={handleSceneHoverLeave}
            onSubHoverEnter={handleSubHoverEnter}
            onSubHoverLeave={handleSubHoverLeave}
            onSubVisualResizeStart={startSubVisualResize}
            onDeleteScene={onDeleteScene ? handleDeleteScene : undefined}
          />

          <VoiceTrack
            localTimings={localTimings}
            liveScenes={liveScenes}
            timelineZoom={timelineZoom}
            trackMuted={trackMuted}
            isDraggingScene={isDraggingScene}
            toggleTrackMute={toggleTrackMute}
            onSeek={onSeek}
          />

          <MusicTrack
            totalDuration={totalDuration}
            timelineZoom={timelineZoom}
            trackMuted={trackMuted}
            isDraggingScene={isDraggingScene}
            toggleTrackMute={toggleTrackMute}
            onSeek={onSeek}
          />

          <SubtitleTrack
            transcriptionData={transcriptionData}
            timelineZoom={timelineZoom}
            trackHidden={trackHidden}
            toggleTrackHide={toggleTrackHide}
            onSeek={onSeek}
          />

          {sceneTimings.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[10px] text-zinc-600 font-medium tracking-wider">No scenes to display</p>
                <p className="text-[8px] text-zinc-700 mt-1">Generate a script or add scenes from the sidebar</p>
              </div>
            </div>
          )}

          <TimelinePlayhead
            currentFrame={currentFrame}
            timelineZoom={timelineZoom}
            onStartDrag={startPlayheadDrag}
          />


        </div>
      </div>
    </div>
  );
};

export default Timeline;
