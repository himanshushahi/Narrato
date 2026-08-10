import React, { useRef, useEffect, useState, useCallback } from 'react';

import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { FPS, HEADER_WIDTH, MIN_SCENE_DURATION_SECONDS } from './timelineConstants';

import { TimelineRuler } from './components/TimelineRuler';
import { TimelinePlayhead } from './components/TimelinePlayhead';
import { TimelineZoomControls } from './components/TimelineZoomControls';
import { VideoTrack } from './components/VideoTrack';
import { VoiceTrack } from './components/VoiceTrack';
import { MusicTrack } from './components/MusicTrack';
import { SubtitleTrack } from './components/SubtitleTrack';
import { VideoAudioTrack } from './components/VideoAudioTrack';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  transcriptionData?: any;
  onSeek: (frame: number) => void;
  onDeleteScene?: (index: number) => void;
  onResizeSubVisual?: (sceneIndex: number, newRatios: number[]) => void;
  onResizeScene?: (sceneIndex: number, newDurationSeconds: number, nextDurationSeconds: number | null, mode: 'boundary' | 'absolute') => void;
  onTimingsDragUpdate?: (timings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>) => void;
  readOnly?: boolean;
}

interface LocalTiming {
  start: number;
  end: number;
  subs: Array<{ start: number; end: number }>;
}

export const Timeline: React.FC<TimelineProps> = React.memo(({
  liveScenes,
  sceneTimings,
  transcriptionData,
  onSeek,
  onDeleteScene,
  onResizeSubVisual,
  onResizeScene,
  onTimingsDragUpdate,
  readOnly = false,
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
  const localTimingsRef = useRef(localTimings);
  localTimingsRef.current = localTimings;

  const [, setTimingsVersion] = useState(0);
  useEffect(() => {
    setTimingsVersion(v => v + 1);
    setLocalTimings(sceneTimings);
  }, [sceneTimings]);

  useEffect(() => {
    if (onTimingsDragUpdate) {
      onTimingsDragUpdate(localTimings);
    }
  }, [localTimings, onTimingsDragUpdate]);

  type DragState = {
    type: 'resize_sub_visual' | 'resize_scene_boundary' | 'resize_scene_absolute';
    sceneIdx: number;
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    subIdx?: number;
    initialRatios?: number[];
    /** For scene boundary: initial duration of left scene in frames */
    initialLeftFrames?: number;
    /** For scene boundary: initial duration of right scene in frames */
    initialRightFrames?: number;
    /** For scene absolute: initial total duration in frames */
    initialTotalFrames?: number;
    mouseX: number;
    committed: boolean;
  };
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const isDraggingPlayheadRef = useRef(false);

  const totalDuration = localTimings.length > 0 ? localTimings[localTimings.length - 1].end : 300;
  const totalW = Math.max((totalDuration / FPS) * timelineZoom + 100, 400);

  // Follow the playhead while scrubbing — imperative scroll, no re-render.
  const timelineZoomRef = useRef(timelineZoom);
  timelineZoomRef.current = timelineZoom;
  useEffect(() => {
    const unsub = usePlaybackStore.subscribe((s, prev) => {
      if (s.currentFrame === prev.currentFrame) return;
      if (scrollRef.current && !dragRef.current && !isDraggingPlayheadRef.current) {
        const playheadX = (s.currentFrame / FPS) * timelineZoomRef.current;
        const containerWidth = scrollRef.current.clientWidth;
        if (playheadX > scrollRef.current.scrollLeft + containerWidth - 100 ||
            playheadX < scrollRef.current.scrollLeft + 100) {
          scrollRef.current.scrollLeft = Math.max(0, playheadX - containerWidth / 2);
        }
      }
    });
    return unsub;
  }, []);

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

  const startSceneBoundaryResize = useCallback((e: React.MouseEvent, sceneIdx: number) => {
    e.stopPropagation();
    if (sceneIdx >= localTimings.length - 1) return;

    const leftFrames = localTimings[sceneIdx].end - localTimings[sceneIdx].start;
    const rightFrames = localTimings[sceneIdx + 1].end - localTimings[sceneIdx + 1].start;

    dragRef.current = {
      type: 'resize_scene_boundary',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: localTimings[sceneIdx].start,
      initialEnd: localTimings[sceneIdx].end,
      initialLeftFrames: leftFrames,
      initialRightFrames: rightFrames,
      mouseX: e.clientX,
      committed: false,
    };
    setDragState(dragRef.current);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [localTimings]);

  const startSceneAbsoluteResize = useCallback((e: React.MouseEvent, sceneIdx: number) => {
    e.stopPropagation();

    const totalFrames = localTimings[sceneIdx].end - localTimings[sceneIdx].start;

    dragRef.current = {
      type: 'resize_scene_absolute',
      sceneIdx,
      initialMouseX: e.clientX,
      initialStart: localTimings[sceneIdx].start,
      initialEnd: localTimings[sceneIdx].end,
      initialTotalFrames: totalFrames,
      mouseX: e.clientX,
      committed: false,
    };
    setDragState(dragRef.current);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [localTimings]);

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
        const timing = localTimingsRef.current[d.sceneIdx];
        const sceneDuration = timing.end - timing.start;
        if (sceneDuration > 0) {
          const newRatios = timing.subs.map(sub => (sub.end - sub.start) / sceneDuration);
          onResizeSubVisual(d.sceneIdx, newRatios);
        }
      } else if (d.type === 'resize_scene_boundary' && onResizeScene) {
        const timings = localTimingsRef.current;
        const leftTiming = timings[d.sceneIdx];
        const rightTiming = timings[d.sceneIdx + 1];
        if (leftTiming && rightTiming) {
          const newLeftDur = (leftTiming.end - leftTiming.start) / FPS;
          const newRightDur = (rightTiming.end - rightTiming.start) / FPS;
          onResizeScene(d.sceneIdx, newLeftDur, newRightDur, 'boundary');
        }
      } else if (d.type === 'resize_scene_absolute' && onResizeScene) {
        const timings = localTimingsRef.current;
        const timing = timings[d.sceneIdx];
        if (timing) {
          const newDur = (timing.end - timing.start) / FPS;
          onResizeScene(d.sceneIdx, newDur, null, 'absolute');
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
      } else if (d.type === 'resize_scene_boundary') {
        const leftIdx = d.sceneIdx;
        const rightIdx = leftIdx + 1;
        const initialLeftFrames = d.initialLeftFrames!;
        const initialRightFrames = d.initialRightFrames!;
        const pairTotalFrames = initialLeftFrames + initialRightFrames;

        setLocalTimings((prev) => {
          const next = [...prev];
          const leftTiming = next[leftIdx];
          const rightTiming = next[rightIdx];
          if (!leftTiming || !rightTiming) return prev;

          const minFrames = Math.max(1, MIN_SCENE_DURATION_SECONDS * FPS);
          // Compute delta relative to the initial left scene pixel width
          const initialLeftPixelWidth = (initialLeftFrames / FPS) * timelineZoom;
          const deltaFrames = initialLeftPixelWidth > 0 ? Math.round((dx / initialLeftPixelWidth) * initialLeftFrames) : 0;

          let newLeftFrames = Math.max(minFrames, Math.min(initialLeftFrames + deltaFrames, pairTotalFrames - minFrames));
          let newRightFrames = pairTotalFrames - newLeftFrames;

          // Recompute sub-visual timings within each scene
          const buildSubs = (timing: LocalTiming, initDurFrames: number, newDurFrames: number) => {
            const ratios = timing.subs.map(s => (s.end - s.start) / Math.max(1, initDurFrames));
            const subs = [...timing.subs];
            let currentStart = timing.start;
            for (let i = 0; i < subs.length; i++) {
              const subDurFrames = Math.max(1, Math.round(ratios[i] * newDurFrames));
              subs[i] = { start: currentStart, end: currentStart + subDurFrames };
              currentStart += subDurFrames;
            }
            if (subs.length > 0) subs[subs.length - 1].end = timing.start + newDurFrames;
            return subs;
          };

          next[leftIdx] = {
            ...leftTiming,
            end: leftTiming.start + newLeftFrames,
            subs: buildSubs(leftTiming, initialLeftFrames, newLeftFrames),
          };
          next[rightIdx] = {
            ...rightTiming,
            start: next[leftIdx].end,
            end: next[leftIdx].end + newRightFrames,
            subs: buildSubs(rightTiming, initialRightFrames, newRightFrames),
          };

          // Shift all subsequent scenes
          const shift = next[rightIdx].end - rightTiming.end;
          for (let i = rightIdx + 1; i < next.length; i++) {
            next[i] = {
              ...next[i],
              start: next[i].start + shift,
              end: next[i].end + shift,
            };
          }

          return next;
        });
      } else if (d.type === 'resize_scene_absolute') {
        const minFrames = Math.max(1, MIN_SCENE_DURATION_SECONDS * FPS);
        const sceneIdx = d.sceneIdx;
        const initialTotalFrames = d.initialTotalFrames!;

        setLocalTimings((prev) => {
          const next = [...prev];
          const timing = next[sceneIdx];
          if (!timing) return prev;

          const initialPixelWidth = (initialTotalFrames / FPS) * timelineZoom;
          const deltaFrames = initialPixelWidth > 0 ? Math.round((dx / initialPixelWidth) * initialTotalFrames) : 0;

          const ratios = timing.subs.map(s => (s.end - s.start) / Math.max(1, timing.end - timing.start));
          const newDurFrames = Math.max(minFrames, initialTotalFrames + deltaFrames);

          // Rebuild sub-visuals with new duration
          let currentStart = timing.start;
          const subs = timing.subs.map((_, i) => {
            const subDurFrames = Math.max(1, Math.round(ratios[i] * newDurFrames));
            const sub = { start: currentStart, end: currentStart + subDurFrames };
            currentStart += subDurFrames;
            return sub;
          });
          if (subs.length > 0) subs[subs.length - 1].end = timing.start + newDurFrames;

          const newEnd = timing.start + newDurFrames;
          const shift = newEnd - timing.end;

          next[sceneIdx] = { ...timing, end: newEnd, subs };

          // Shift all subsequent scenes
          for (let i = sceneIdx + 1; i < next.length; i++) {
            next[i] = {
              ...next[i],
              start: next[i].start + shift,
              end: next[i].end + shift,
            };
          }

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
  }, [dragState, timelineZoom, onResizeSubVisual, onResizeScene]);

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
      if (!scrollRef.current) return usePlaybackStore.getState().currentFrame;
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
  }, [onSeek, timelineZoom]);

  const isDraggingScene = dragState?.type === 'resize_sub_visual' || dragState?.type === 'resize_scene_boundary' || dragState?.type === 'resize_scene_absolute';

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
            <div className="sticky left-0 top-0 bottom-0 w-[110px] bg-zinc-950/90 border-r border-zinc-800/60 z-[60] backdrop-blur-md float-left h-full" />
            <TimelineRuler totalDuration={totalDuration} timelineZoom={timelineZoom} />
          </div>

          <VideoTrack
            localTimings={localTimings}
            liveScenes={liveScenes}
            timelineZoom={timelineZoom}
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
            onSceneBoundaryResizeStart={startSceneBoundaryResize}
            onSceneAbsoluteResizeStart={startSceneAbsoluteResize}
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

          <VideoAudioTrack
            localTimings={localTimings}
            liveScenes={liveScenes}
            timelineZoom={timelineZoom}
            trackMuted={trackMuted}
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
            timelineZoom={timelineZoom}
            onStartDrag={startPlayheadDrag}
          />


        </div>
      </div>
    </div>
  );
});

Timeline.displayName = 'Timeline';

export default Timeline;
