import React, { useRef, useEffect, useState, useCallback } from 'react';

import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { FPS, HEADER_WIDTH, MIN_SCENE_DURATION_SECONDS, ZOOM_MIN, ZOOM_MAX } from './timelineConstants';

import { TimelineRuler } from './components/TimelineRuler';
import { TimelinePlayhead } from './components/TimelinePlayhead';
import { TimelineZoomControls } from './components/TimelineZoomControls';
import { VideoTrack, TRANSITION_OPTIONS } from './components/VideoTrack';
import { OverlaysTrack } from './components/OverlaysTrack';
import { VoiceTrack } from './components/VoiceTrack';
import { MusicTrack } from './components/MusicTrack';
import { SubtitleTrack } from './components/SubtitleTrack';
import { VideoAudioTrack } from './components/VideoAudioTrack';
import { GlobalOverlayItem } from '../../components/video/GlobalOverlaysRenderer';
import {
  Scissors, Copy, Trash2, VolumeX, Volume2, Music, Edit3,
  Layers, ChevronRight, Check, AlertTriangle
} from 'lucide-react';

interface TimelineProps {
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  overlays?: GlobalOverlayItem[];
  transcriptionData?: any;
  audioUrl?: string;
  bgMusicUrl?: string;
  onSeek: (frame: number) => void;
  onDeleteScene?: (index: number) => void;
  onResizeSubVisual?: (sceneIndex: number, newRatios: number[]) => void;
  onResizeScene?: (sceneIndex: number, newDurationSeconds: number, nextDurationSeconds: number | null, mode: 'boundary' | 'absolute') => void;
  onTimingsDragUpdate?: (timings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>) => void;
  onToggleSubVisualAudioFlag?: (sceneIdx: number, subIdx: number, flag: 'mute_voiceover' | 'mute_bg_music') => void;
  onUpdateSubVisualTransition?: (sceneIdx: number, subIdx: number, transition: string) => void;
  onSplitSubVisualAtFrame?: (sceneIdx: number, subIdx: number, frame: number) => void;
  onDuplicateSubVisual?: (sceneIdx: number, subIdx: number) => void;
  onDeleteSubVisual?: (sceneIdx: number, subIdx: number) => void;
  onUpdateOverlay?: (target: number | string, updates: Partial<GlobalOverlayItem>) => void;
  onToggleOverlayEnabled?: (target: number | string) => void;
  onSelectOverlay?: (overlayId: string) => void;
  onOpenInspectorScript?: (sceneIdx: number, subIdx: number) => void;
  readOnly?: boolean;
}

interface LocalTiming {
  start: number;
  end: number;
  subs: Array<{ start: number; end: number }>;
}

interface ContextMenuState {
  x: number;
  y: number;
  sceneIdx: number;
  subIdx: number;
  showTransitionsSubmenu?: boolean;
  showDeleteConfirm?: boolean;
}

export const Timeline: React.FC<TimelineProps> = React.memo(({
  liveScenes,
  sceneTimings,
  overlays = [],
  transcriptionData,
  audioUrl,
  bgMusicUrl,
  onSeek,
  onDeleteScene,
  onResizeSubVisual,
  onResizeScene,
  onTimingsDragUpdate,
  onToggleSubVisualAudioFlag,
  onUpdateSubVisualTransition,
  onSplitSubVisualAtFrame,
  onDuplicateSubVisual,
  onDeleteSubVisual,
  onUpdateOverlay,
  onToggleOverlayEnabled,
  onSelectOverlay,
  onOpenInspectorScript,
  readOnly = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const timelineZoom = useEditorStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const trackMuted = useEditorStore((s) => s.trackMuted);
  const trackHidden = useEditorStore((s) => s.trackHidden);
  const trackOrder = useEditorStore((s) => s.trackOrder);
  const setTrackOrder = useEditorStore((s) => s.setTrackOrder);
  const toggleTrackMute = useEditorStore((s) => s.toggleTrackMute);
  const toggleTrackHide = useEditorStore((s) => s.toggleTrackHide);

  // Drag-and-drop track reordering state
  const [draggingTrackIdx, setDraggingTrackIdx] = useState<number | null>(null);
  const [dragOverTrackIdx, setDragOverTrackIdx] = useState<number | null>(null);

  const handleTrackDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggingTrackIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleTrackDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverTrackIdx !== index) {
      setDragOverTrackIdx(index);
    }
  }, [dragOverTrackIdx]);

  const handleTrackDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggingTrackIdx === null || draggingTrackIdx === dropIndex) {
      setDraggingTrackIdx(null);
      setDragOverTrackIdx(null);
      return;
    }

    const newOrder = [...trackOrder];
    const [removed] = newOrder.splice(draggingTrackIdx, 1);
    newOrder.splice(dropIndex, 0, removed);
    setTrackOrder(newOrder);

    setDraggingTrackIdx(null);
    setDragOverTrackIdx(null);
  }, [draggingTrackIdx, trackOrder, setTrackOrder]);

  const handleTrackDragEnd = useCallback(() => {
    setDraggingTrackIdx(null);
    setDragOverTrackIdx(null);
  }, []);

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
    initialLeftFrames?: number;
    initialRightFrames?: number;
    initialTotalFrames?: number;
    mouseX: number;
    committed: boolean;
  };
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const isDraggingPlayheadRef = useRef(false);

  const totalDuration = localTimings.length > 0 ? localTimings[localTimings.length - 1].end : 300;
  const totalW = Math.max((totalDuration / FPS) * timelineZoom + 100, 400);

  // Dismiss context menu immediately on any click or pointerdown outside the menu
  useEffect(() => {
    const handleGlobalPointerDown = (e: MouseEvent) => {
      const menuEl = document.getElementById('timeline-context-menu');
      if (menuEl && !menuEl.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown);
    return () => window.removeEventListener('pointerdown', handleGlobalPointerDown);
  }, []);

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

  // ── Snapping Helper ────────────────────────────────────────────────────────
  const snapThresholdPixels = 8;
  const findSnappedFrame = useCallback((rawFrame: number): number => {
    const rawX = (rawFrame / FPS) * timelineZoom;
    let closestFrame = rawFrame;
    let minDiff = Infinity;

    // Check scene boundaries & sub-visual cut boundaries
    for (const scene of localTimings) {
      const snapPoints = [scene.start, scene.end];
      if (scene.subs) {
        for (const sub of scene.subs) {
          snapPoints.push(sub.start, sub.end);
        }
      }

      for (const pt of snapPoints) {
        const ptX = (pt / FPS) * timelineZoom;
        const diff = Math.abs(rawX - ptX);
        if (diff <= snapThresholdPixels && diff < minDiff) {
          minDiff = diff;
          closestFrame = pt;
        }
      }
    }

    return closestFrame;
  }, [localTimings, timelineZoom]);

  // ── Fit Timeline to Container ─────────────────────────────────────────────
  const handleFitTimeline = useCallback(() => {
    if (!scrollRef.current || totalDuration <= 0) return;
    const availableWidth = scrollRef.current.clientWidth - HEADER_WIDTH - 40;
    if (availableWidth <= 0) return;
    const optimalZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(availableWidth / (totalDuration / FPS))));
    setTimelineZoom(optimalZoom);
  }, [totalDuration, setTimelineZoom]);

  // ── Split at Playhead Helper ─────────────────────────────────────────────
  const getCanSplitAtFrame = useCallback((frame: number) => {
    const timings = localTimingsRef.current;
    const sceneIdx = timings.findIndex(t => frame >= t.start && frame < t.end);
    if (sceneIdx === -1) return null;
    const timing = timings[sceneIdx];
    if (!timing || !timing.subs) return null;
    const subIdx = timing.subs.findIndex(x => frame >= x.start && frame < x.end);
    if (subIdx === -1) return null;
    const sub = timing.subs[subIdx];
    const frameOffsetStart = frame - sub.start;
    const frameOffsetEnd = sub.end - frame;
    const canSplit = frameOffsetStart >= 0.5 * FPS && frameOffsetEnd >= 0.5 * FPS;
    return { sceneIdx, subIdx, sub, canSplit };
  }, []);

  const handleSplitAtPlayhead = useCallback(() => {
    const frame = usePlaybackStore.getState().currentFrame;
    const splitInfo = getCanSplitAtFrame(frame);
    if (!splitInfo?.canSplit || !onSplitSubVisualAtFrame) return;
    onSplitSubVisualAtFrame(splitInfo.sceneIdx, splitInfo.subIdx, frame);
  }, [getCanSplitAtFrame, onSplitSubVisualAtFrame]);

  // Keyboard shortcut 'C' to split cut
  useEffect(() => {
    if (readOnly) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const frame = usePlaybackStore.getState().currentFrame;
        const splitInfo = getCanSplitAtFrame(frame);
        if (splitInfo?.canSplit) {
          e.preventDefault();
          handleSplitAtPlayhead();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, getCanSplitAtFrame, handleSplitAtPlayhead]);

  // ── Sub-Visual Resizing ───────────────────────────────────────────────────
  const startSubVisualResize = useCallback((e: React.MouseEvent, sceneIdx: number, subIdx: number) => {
    e.stopPropagation();
    const timing = localTimings[sceneIdx];
    if (!timing) return;
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
  }, [localTimings]);

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

          const leftRatio = ratios[d.subIdx!];
          const rightRatio = ratios[d.subIdx! + 1];
          const combined = leftRatio + rightRatio;

          let newLeft = Math.max(MIN_RATIO, Math.min(combined - MIN_RATIO, leftRatio + deltaRatio));
          let newRight = combined - newLeft;

          ratios[d.subIdx!] = newLeft;
          ratios[d.subIdx! + 1] = newRight;

          let currentFrame = t.start;
          t.subs = subs.map((_, i) => {
            const dur = Math.round(ratios[i] * sceneDurationFrames);
            const start = currentFrame;
            const end = (i === subs.length - 1) ? t.end : start + dur;
            currentFrame = end;
            return { start, end };
          });

          next[d.sceneIdx] = t;
          return next;
        });
      } else if (d.type === 'resize_scene_boundary') {
        const deltaFrames = Math.round((dx / timelineZoom) * FPS);
        const minFrames = Math.round(MIN_SCENE_DURATION_SECONDS * FPS);

        const leftOrig = d.initialLeftFrames!;
        const rightOrig = d.initialRightFrames!;
        const total = leftOrig + rightOrig;

        let newLeft = Math.max(minFrames, Math.min(total - minFrames, leftOrig + deltaFrames));

        setLocalTimings((prev) => {
          const next = [...prev];
          const left = { ...next[d.sceneIdx] };
          const right = { ...next[d.sceneIdx + 1] };

          const boundary = d.initialStart + newLeft;
          left.end = boundary;
          right.start = boundary;

          const scaleSubs = (scene: LocalTiming, origFrames: number) => {
            if (!scene.subs || scene.subs.length === 0) return [];
            const dur = scene.end - scene.start;
            let cur = scene.start;
            return scene.subs.map((s, i) => {
              const origSubDur = s.end - s.start;
              const ratio = origFrames > 0 ? origSubDur / origFrames : 1 / scene.subs.length;
              const subDur = Math.round(ratio * dur);
              const start = cur;
              const end = (i === scene.subs.length - 1) ? scene.end : start + subDur;
              cur = end;
              return { start, end };
            });
          };

          left.subs = scaleSubs(left, leftOrig);
          right.subs = scaleSubs(right, rightOrig);

          next[d.sceneIdx] = left;
          next[d.sceneIdx + 1] = right;
          return next;
        });
      } else if (d.type === 'resize_scene_absolute') {
        const deltaFrames = Math.round((dx / timelineZoom) * FPS);
        const minFrames = Math.round(MIN_SCENE_DURATION_SECONDS * FPS);
        const newTotal = Math.max(minFrames, d.initialTotalFrames! + deltaFrames);
        const frameDiff = newTotal - d.initialTotalFrames!;

        setLocalTimings((prev) => {
          const next = [...prev];
          let offset = 0;
          return next.map((t, idx) => {
            const current = { ...t };
            if (idx === d.sceneIdx) {
              current.end = current.start + newTotal;
              const origDur = d.initialTotalFrames!;
              const newDur = newTotal;
              let cur = current.start;
              current.subs = (current.subs || []).map((s, i) => {
                const origSubDur = s.end - s.start;
                const ratio = origDur > 0 ? origSubDur / origDur : 1 / current.subs.length;
                const subDur = Math.round(ratio * newDur);
                const start = cur;
                const end = (i === current.subs.length - 1) ? current.end : start + subDur;
                cur = end;
                return { start, end };
              });
              offset = frameDiff;
            } else if (idx > d.sceneIdx) {
              current.start += offset;
              current.end += offset;
              current.subs = (current.subs || []).map(s => ({
                start: s.start + offset,
                end: s.end + offset,
              }));
            }
            return current;
          });
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

  // ── Timeline Click to Seek ────────────────────────────────────────────────
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (dragRef.current || isDraggingPlayheadRef.current) return;
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - HEADER_WIDTH;
    const rawFrame = Math.max(0, Math.floor((x / timelineZoom) * FPS));
    const snappedFrame = findSnappedFrame(rawFrame);
    onSeek(snappedFrame);
  }, [onSeek, timelineZoom, findSnappedFrame]);

  // ── Playhead Scrubbing with Snapping ──────────────────────────────────────
  const startPlayheadDrag = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingPlayheadRef.current = true;

    const getFrameFromMouse = (clientX: number) => {
      if (!scrollRef.current) return usePlaybackStore.getState().currentFrame;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = clientX - rect.left + scrollRef.current.scrollLeft - HEADER_WIDTH;
      const raw = Math.max(0, Math.floor((x / timelineZoom) * FPS));
      return findSnappedFrame(raw);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingPlayheadRef.current) return;
      const frame = getFrameFromMouse(moveEvent.clientX);
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
  }, [onSeek, timelineZoom, findSnappedFrame]);

  const isDraggingScene = dragState?.type === 'resize_sub_visual' || dragState?.type === 'resize_scene_boundary' || dragState?.type === 'resize_scene_absolute';

  const handleDeleteScene = useCallback((index: number) => {
    onDeleteScene?.(index);
  }, [onDeleteScene]);

  const handleOpenContextMenu = useCallback((e: React.MouseEvent, sceneIdx: number, subIdx: number) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      sceneIdx,
      subIdx,
      showTransitionsSubmenu: false,
    });
  }, []);

  const activeTargetSubVisual = contextMenu ? liveScenes?.[contextMenu.sceneIdx]?.sub_visuals?.[contextMenu.subIdx] : null;

  return (
    <div className="h-full bg-zinc-950/90 border-t border-zinc-800/60 flex flex-col select-none overflow-hidden relative">
      {/* Timeline Toolbar Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/40 shrink-0 bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Timeline</span>
          <span className="text-[9px] font-mono text-zinc-500">
            {((totalDuration / FPS) || 0).toFixed(1)}s Total
          </span>
        </div>
        {!readOnly && (
          <TimelineZoomControls
            timelineZoom={timelineZoom}
            setTimelineZoom={setTimelineZoom}
            onFitTimeline={handleFitTimeline}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            localTimings={localTimings}
          />
        )}
      </div>

      {/* Timeline Main Scrollable View */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto timeline-scrollbar min-h-0 relative"
        onClick={handleTimelineClick}
      >
        <div style={{ width: totalW, minHeight: '100%', height: 'max-content', position: 'relative' }}>
          {/* Time Ruler */}
          <div className="h-6 relative border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="sticky left-0 top-0 bottom-0 bg-zinc-950/90 border-r border-zinc-800/60 z-[60] backdrop-blur-md float-left h-full" style={{ width: HEADER_WIDTH }} />
            <TimelineRuler totalDuration={totalDuration} timelineZoom={timelineZoom} />
          </div>

          {/* Dynamic Reorderable Tracks */}
          {trackOrder.map((trackId, index) => {
            const isDragOver = dragOverTrackIdx === index;

            switch (trackId) {
              case 'video':
                return (
                  <VideoTrack
                    key="video"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    localTimings={localTimings}
                    liveScenes={liveScenes}
                    timelineZoom={timelineZoom}
                    isDraggingScene={isDraggingScene}
                    readOnly={readOnly}
                    onSeek={onSeek}
                    onSubVisualResizeStart={startSubVisualResize}
                    onSceneBoundaryResizeStart={startSceneBoundaryResize}
                    onSceneAbsoluteResizeStart={startSceneAbsoluteResize}
                    onDeleteScene={onDeleteScene ? handleDeleteScene : undefined}
                    onUpdateSubVisualTransition={onUpdateSubVisualTransition}
                    onOpenContextMenu={handleOpenContextMenu}
                  />
                );

              case 'overlays':
                return (
                  <OverlaysTrack
                    key="overlays"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    overlays={overlays}
                    totalDuration={totalDuration}
                    timelineZoom={timelineZoom}
                    trackHidden={trackHidden}
                    toggleTrackHide={toggleTrackHide}
                    onSeek={onSeek}
                    onUpdateOverlay={onUpdateOverlay}
                    onToggleOverlayEnabled={onToggleOverlayEnabled}
                    onSelectOverlay={onSelectOverlay}
                    readOnly={readOnly}
                  />
                );

              case 'subs':
                return (
                  <SubtitleTrack
                    key="subs"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    transcriptionData={transcriptionData}
                    timelineZoom={timelineZoom}
                    trackHidden={trackHidden}
                    toggleTrackHide={toggleTrackHide}
                    onSeek={onSeek}
                  />
                );

              case 'voice':
                return (
                  <VoiceTrack
                    key="voice"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    localTimings={localTimings}
                    liveScenes={liveScenes}
                    timelineZoom={timelineZoom}
                    trackMuted={trackMuted}
                    isDraggingScene={isDraggingScene}
                    toggleTrackMute={toggleTrackMute}
                    onSeek={onSeek}
                    onToggleSubVisualAudioFlag={onToggleSubVisualAudioFlag}
                    audioUrl={audioUrl}
                  />
                );

              case 'music':
                return (
                  <MusicTrack
                    key="music"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    totalDuration={totalDuration}
                    localTimings={localTimings}
                    liveScenes={liveScenes}
                    timelineZoom={timelineZoom}
                    trackMuted={trackMuted}
                    isDraggingScene={isDraggingScene}
                    toggleTrackMute={toggleTrackMute}
                    onSeek={onSeek}
                    onToggleSubVisualAudioFlag={onToggleSubVisualAudioFlag}
                    bgMusicUrl={bgMusicUrl}
                  />
                );

              case 'videoaudio':
                return (
                  <VideoAudioTrack
                    key="videoaudio"
                    index={index}
                    isDragOver={isDragOver}
                    onDragStart={handleTrackDragStart}
                    onDragOver={handleTrackDragOver}
                    onDrop={handleTrackDrop}
                    onDragEnd={handleTrackDragEnd}
                    localTimings={localTimings}
                    liveScenes={liveScenes}
                    timelineZoom={timelineZoom}
                    trackMuted={trackMuted}
                    toggleTrackMute={toggleTrackMute}
                    onSeek={onSeek}
                  />
                );

              default:
                return null;
            }
          })}

          {sceneTimings.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[10px] text-zinc-600 font-medium tracking-wider">No scenes to display</p>
                <p className="text-[8px] text-zinc-700 mt-1">Generate a script or add scenes from the sidebar</p>
              </div>
            </div>
          )}

          {/* Playhead Scrub Line spanning all tracks */}
          <TimelinePlayhead
            timelineZoom={timelineZoom}
            onStartDrag={startPlayheadDrag}
          />
        </div>
      </div>

      {/* ── Context Menu Popover ──────────────────────────────────────────── */}
      {contextMenu && (
        <div
          id="timeline-context-menu"
          key={`${contextMenu.sceneIdx}-${contextMenu.subIdx}-${contextMenu.x}-${contextMenu.y}`}
          className="fixed z-[9999] w-56 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1.5 space-y-0.5 text-xs text-zinc-200"
          style={{
            top: Math.max(10, Math.min(window.innerHeight - 320, contextMenu.y)),
            left: Math.max(10, Math.min(window.innerWidth - 250, contextMenu.x)),
            transition: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
            <span>Cut Actions (Scene {contextMenu.sceneIdx + 1} : #{contextMenu.subIdx + 1})</span>
          </div>

          {/* Split at Playhead */}
          {(() => {
            const splitInfo = contextMenu ? getCanSplitAtFrame(usePlaybackStore.getState().currentFrame) : null;
            const canSplit = !!splitInfo?.canSplit;
            return (
              <button
                type="button"
                disabled={!canSplit}
                onClick={() => {
                  handleSplitAtPlayhead();
                  setContextMenu(null);
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left transition-colors cursor-pointer ${
                  canSplit ? 'hover:bg-zinc-800 text-zinc-200' : 'opacity-40 cursor-not-allowed text-zinc-500'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 text-amber-400" />
                <div className="flex-1">
                  <div>Split Cut at Playhead</div>
                  <div className="text-[8px] text-zinc-500">Shortcut: C</div>
                </div>
              </button>
            );
          })()}

          {/* Duplicate Cut */}
          {onDuplicateSubVisual && (
            <button
              type="button"
              onClick={() => {
                onDuplicateSubVisual(contextMenu.sceneIdx, contextMenu.subIdx);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
              <span>Duplicate Cut</span>
            </button>
          )}

          {/* Change Transition Submenu */}
          <div className="relative group/trans">
            <button
              type="button"
              onClick={() => setContextMenu(prev => prev ? {
                ...prev,
                showTransitionsSubmenu: !prev.showTransitionsSubmenu,
                showDeleteConfirm: false,
              } : null)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-none text-left hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                <span>Change Transition</span>
              </div>
              <ChevronRight className="w-3 h-3 text-zinc-500" />
            </button>

            {/* Nested Transitions Submenu */}
            {contextMenu.showTransitionsSubmenu && (
              <div
                className={`absolute z-[300] w-48 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1 space-y-0.5 max-h-56 overflow-y-auto ${
                  contextMenu.x + 230 + 195 > window.innerWidth
                    ? 'right-full mr-1 top-0'
                    : 'left-full ml-1 top-0'
                }`}
              >
                {TRANSITION_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isCurrent = activeTargetSubVisual?.transition === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onUpdateSubVisualTransition?.(contextMenu.sceneIdx, contextMenu.subIdx, opt.id);
                        setContextMenu(null);
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded-none text-left text-[11px] transition-colors cursor-pointer ${
                        isCurrent ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3 h-3 text-zinc-400" />
                        <span>{opt.label}</span>
                      </div>
                      {isCurrent && <Check className="w-3 h-3 text-cyan-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="h-px bg-zinc-800 my-1" />

          {/* Toggle Voiceover Mute */}
          {onToggleSubVisualAudioFlag && (
            <button
              type="button"
              onClick={() => {
                onToggleSubVisualAudioFlag(contextMenu.sceneIdx, contextMenu.subIdx, 'mute_voiceover');
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
            >
              {activeTargetSubVisual?.mute_voiceover ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Unmute Voiceover</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-red-400" />
                  <span>Mute Voiceover for this Cut</span>
                </>
              )}
            </button>
          )}

          {/* Toggle Music Mute */}
          {onToggleSubVisualAudioFlag && (
            <button
              type="button"
              onClick={() => {
                onToggleSubVisualAudioFlag(contextMenu.sceneIdx, contextMenu.subIdx, 'mute_bg_music');
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
            >
              <Music className="w-3.5 h-3.5 text-pink-400" />
              <span>{activeTargetSubVisual?.mute_bg_music ? 'Unmute BG Music' : 'Mute BG Music for this Cut'}</span>
            </button>
          )}

          {/* Edit in Inspector */}
          {onOpenInspectorScript && (
            <button
              type="button"
              onClick={() => {
                onOpenInspectorScript(contextMenu.sceneIdx, contextMenu.subIdx);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover:bg-zinc-800 text-zinc-200 transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 text-blue-400" />
              <span>Edit in Inspector</span>
            </button>
          )}

          {/* Delete Sub-Visual Cut Submenu */}
          {onDeleteSubVisual && (() => {
            const currentScene = liveScenes?.[contextMenu.sceneIdx];
            const subVisualsCount = currentScene?.sub_visuals?.length || localTimings[contextMenu.sceneIdx]?.subs?.length || 1;
            const isOnlySubVisual = subVisualsCount <= 1;

            return (
              <>
                <div className="h-px bg-zinc-800 my-1" />
                <div className="relative group/delete">
                  <button
                    type="button"
                    disabled={isOnlySubVisual}
                    onClick={() => {
                      if (!isOnlySubVisual) {
                        setContextMenu(prev => prev ? {
                          ...prev,
                          showDeleteConfirm: !prev.showDeleteConfirm,
                          showTransitionsSubmenu: false,
                        } : null);
                      }
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-none text-left transition-colors cursor-pointer ${
                      isOnlySubVisual
                        ? 'opacity-40 cursor-not-allowed text-zinc-500'
                        : 'hover:bg-red-500/20 text-red-400'
                    }`}
                    title={isOnlySubVisual ? "Cannot delete the only cut in this scene" : "Delete this sub-visual cut"}
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Sub-Visual Cut</span>
                    </div>
                    {isOnlySubVisual ? (
                      <span className="text-[7.5px] text-zinc-500 font-mono">Min 1</span>
                    ) : (
                      <ChevronRight className="w-3 h-3 text-red-400" />
                    )}
                  </button>

                  {/* Nested Delete Confirmation Submenu */}
                  {contextMenu.showDeleteConfirm && !isOnlySubVisual && (
                    <div
                      className={`absolute z-[300] w-52 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1.5 space-y-1.5 select-none ${
                        contextMenu.x + 230 + 210 > window.innerWidth
                          ? 'right-full mr-1 top-0'
                          : 'left-full ml-1 top-0'
                      }`}
                    >
                      <div className="flex items-start gap-1.5 text-red-300 font-bold text-[10px] leading-tight px-1 pt-0.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.2" />
                        <div>
                          <div>Delete Cut #{contextMenu.subIdx + 1}?</div>
                          <div className="text-[8px] font-normal text-zinc-400 mt-0.5">
                            Duration merges into adjacent cut.
                          </div>
                        </div>
                      </div>

                      <div className="pt-1 border-t border-zinc-800">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteSubVisual(contextMenu.sceneIdx, contextMenu.subIdx);
                            setContextMenu(null);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] rounded-none cursor-pointer shadow transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Confirm Delete</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
});

Timeline.displayName = 'Timeline';
