import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  VscTrash, VscLayers
} from 'react-icons/vsc';
import { Volume2, VolumeX, Split, Sparkles, Check } from 'lucide-react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';
import { useAudioWaveform } from '../hooks/useAudioWaveform';
import { WaveformCanvas } from './WaveformCanvas';
import { MusicClip } from '../../../components/video/NitishRajputComposition';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

type AudioCutFlag = 'mute_voiceover' | 'mute_bg_music';

interface MusicTrackProps {
  totalDuration: number;
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  isDraggingScene: boolean;
  toggleTrackMute: (track: string) => void;
  onSeek: (frame: number) => void;
  onToggleSubVisualAudioFlag?: (sceneIdx: number, subIdx: number, flag: AudioCutFlag) => void;
  bgMusicUrl?: string;
  musicClips?: MusicClip[];
  onUpdateMusicClips?: (clips: MusicClip[]) => Promise<boolean | void>;
  onUploadMusicClip?: (startFrame?: number) => Promise<void>;
  // Drag reordering props
  index?: number;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnter?: (e: React.DragEvent, index: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

interface ActiveClipContextMenu {
  clipId: string;
  x: number;
  y: number;
  audioDuration?: number;
  showFadeInSubmenu?: boolean;
  showFadeOutSubmenu?: boolean;
}

// ── Single Interactive Music Clip Block ─────────────────────────────────────────
const MusicClipBlock: React.FC<{
  clip: MusicClip;
  timelineZoom: number;
  isTrackMuted: boolean;
  isSelected: boolean;
  isDraggingRef: React.MutableRefObject<boolean>;
  onSelect: (id: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, clipId: string, audioDuration?: number) => void;
  onStartDrag: (e: React.MouseEvent, clip: MusicClip, mode: 'move' | 'trim_left' | 'trim_right' | 'fade_in' | 'fade_out') => void;
}> = React.memo(({
  clip, timelineZoom, isTrackMuted, isSelected, isDraggingRef, onSelect, onOpenContextMenu, onStartDrag
}) => {
  const { peaks, duration: audioDuration } = useAudioWaveform(clip.audio_url);
  const startSec = (clip.start_frame || 0) / FPS;
  const durSec = Math.max(0.5, (clip.duration_frames || 30) / FPS);
  const x = startSec * timelineZoom + HEADER_WIDTH;
  const w = Math.max(14, durSec * timelineZoom);
  const isMuted = isTrackMuted || !!clip.is_muted;

  const fadeInPx = Math.min(w / 2, ((clip.fade_in_seconds || 0) / durSec) * w);
  const fadeOutPx = Math.min(w / 2, ((clip.fade_out_seconds || 0) / durSec) * w);

  return (
    <div
      className={`absolute top-1.5 h-8 rounded-none border-2 cursor-pointer transition-colors shadow-sm select-none group/clip overflow-hidden ${
        isSelected
          ? 'ring-2 ring-indigo-400 bg-indigo-950/60 border-indigo-400 z-20 shadow-indigo-500/20'
          : isMuted
          ? 'bg-zinc-900/90 border-zinc-700 opacity-60 z-10'
          : 'bg-zinc-900/95 border-indigo-500/60 hover:border-indigo-400 z-10'
      }`}
      style={{ left: x, width: w }}
      onClick={(e) => {
        e.stopPropagation();
        if (isDraggingRef.current) return;
        onSelect(clip.id);
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.button === 0 && !e.altKey && !e.shiftKey) {
          onStartDrag(e, clip, 'move');
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(clip.id);
        onOpenContextMenu(e, clip.id, audioDuration);
      }}
      title={`${clip.name || 'Music Clip'} (${durSec.toFixed(1)}s)`}
    >
      {/* Waveform Canvas Layer */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <WaveformCanvas
          peaks={peaks}
          totalAudioDuration={audioDuration}
          startTime={clip.source_start_seconds || 0}
          duration={durSec}
          width={w}
          height={28}
          color={isSelected ? '#818cf8' : '#6366f1'}
          isMuted={isMuted}
          loop={clip.loop !== false}
          fadeInDuration={clip.fade_in_seconds || 0}
          fadeOutDuration={clip.fade_out_seconds || 0}
        />
      </div>

      {/* Visual Fade-in triangle shape */}
      {fadeInPx > 2 && (
        <div
          className="absolute left-0 top-0 bottom-0 pointer-events-none bg-linear-to-r from-black/60 to-transparent"
          style={{ width: fadeInPx }}
        />
      )}

      {/* Visual Fade-out triangle shape */}
      {fadeOutPx > 2 && (
        <div
          className="absolute right-0 top-0 bottom-0 pointer-events-none bg-linear-to-l from-black/60 to-transparent"
          style={{ width: fadeOutPx }}
        />
      )}

      {/* Clip Title & Badges */}
      <div className="absolute top-0.5 left-1.5 flex items-center gap-1 pointer-events-none z-10 max-w-[calc(100%-16px)]">
        <span className={`text-[7.5px] font-mono font-bold px-1 py-0.2 rounded-none truncate ${
          isSelected ? 'text-indigo-200 bg-indigo-900/80' : isMuted ? 'text-zinc-400 bg-black/70' : 'text-indigo-300 bg-black/70'
        }`}>
          {clip.name || 'BGM'}
        </span>
        {w > 65 && (
          <span className="text-[7px] font-mono text-zinc-300 bg-black/60 px-1">
            {durSec.toFixed(1)}s
          </span>
        )}
        {clip.loop !== false && w > 100 && (
          <span className="text-[6.5px] font-mono text-cyan-300 bg-cyan-950/80 border border-cyan-500/30 px-0.8">
            LOOP
          </span>
        )}
      </div>

      {/* Left In-Point Trim Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2.5 z-30 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 flex items-center justify-center transition-opacity"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'trim_left');
        }}
        title="Drag to trim audio start in-point"
      >
        <div className="w-[2px] h-full bg-indigo-400 shadow-sm" />
      </div>

      {/* Right Out-Point Trim Handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2.5 z-30 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 flex items-center justify-center transition-opacity"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'trim_right');
        }}
        title="Drag to trim clip duration"
      >
        <div className="w-[2px] h-full bg-indigo-400 shadow-sm" />
      </div>

      {/* Draggable Top-Left Fade In Handle */}
      <div
        className="absolute top-0 w-3 h-3 z-30 cursor-crosshair opacity-0 group-hover/clip:opacity-100 flex items-start justify-start transition-opacity"
        style={{ left: Math.max(6, fadeInPx - 3) }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'fade_in');
        }}
        title={`Fade In: ${(clip.fade_in_seconds || 0).toFixed(1)}s (Drag horizontally to adjust)`}
      >
        <div className="w-2 h-2 rounded-none bg-indigo-300 border border-indigo-600 shadow" />
      </div>

      {/* Draggable Top-Right Fade Out Handle */}
      <div
        className="absolute top-0 w-3 h-3 z-30 cursor-crosshair opacity-0 group-hover/clip:opacity-100 flex items-start justify-end transition-opacity"
        style={{ right: Math.max(6, fadeOutPx - 3) }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'fade_out');
        }}
        title={`Fade Out: ${(clip.fade_out_seconds || 0).toFixed(1)}s (Drag horizontally to adjust)`}
      >
        <div className="w-2 h-2 rounded-none bg-indigo-300 border border-indigo-600 shadow" />
      </div>
    </div>
  );
});
MusicClipBlock.displayName = 'MusicClipBlock';

export const MusicTrack: React.FC<MusicTrackProps> = React.memo(({
  totalDuration, localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene,
  toggleTrackMute, onSeek, onToggleSubVisualAudioFlag, bgMusicUrl, musicClips = [],
  onUpdateMusicClips, onUploadMusicClip: _onUploadMusicClip,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const isTrackMuted = !!trackMuted['music'];
  const selectedMusicClipId = useEditorStore((s) => s.selectedMusicClipId);
  const setSelectedMusicClipId = useEditorStore((s) => s.setSelectedMusicClipId);
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);

  const [activeContextMenu, setActiveContextMenu] = useState<ActiveClipContextMenu | null>(null);
  const [localClipsOverride, setLocalClipsOverride] = useState<MusicClip[] | null>(null);

  // Synchronize effective clips: if musicClips is empty but legacy bgMusicUrl exists, synthesize 1 clip
  const computedClips = useMemo<MusicClip[]>(() => {
    if (musicClips && musicClips.length > 0) return musicClips;
    if (bgMusicUrl) {
      return [{
        id: 'default_bgm',
        name: bgMusicUrl.split(/[/\\]/).pop() || 'Background Music',
        audio_path: bgMusicUrl,
        audio_url: bgMusicUrl,
        start_frame: 0,
        duration_frames: Math.max(30, totalDuration),
        source_start_seconds: 0,
        volume: 0.2,
        loop: true,
        fade_in_seconds: 0.5,
        fade_out_seconds: 1.0,
        is_muted: false,
      }];
    }
    return [];
  }, [musicClips, bgMusicUrl, totalDuration]);

  const effectiveClips = localClipsOverride || computedClips;
  const effectiveClipsRef = useRef(effectiveClips);
  effectiveClipsRef.current = effectiveClips;
  const isDraggingRef = useRef(false);

  // Sync / clear local override whenever new props arrive
  useEffect(() => {
    setLocalClipsOverride(null);
  }, [musicClips]);

  // Global dismiss context menu on pointer down outside
  useEffect(() => {
    const handleGlobalDown = (e: MouseEvent) => {
      const el = document.getElementById('music-clip-context-menu');
      if (el && !el.contains(e.target as Node)) {
        setActiveContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handleGlobalDown);
    return () => window.removeEventListener('pointerdown', handleGlobalDown);
  }, []);

  const handleSelectClip = useCallback((id: string) => {
    setSelectedMusicClipId(id);
    setLeftPanelTab('music');
  }, [setSelectedMusicClipId, setLeftPanelTab]);

  const handleOpenContextMenu = useCallback((e: React.MouseEvent, clipId: string, audioDuration?: number) => {
    const menuWidth = 220;
    const menuHeight = 280;
    const x = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, e.clientX));
    const y = e.clientY + menuHeight > window.innerHeight
      ? Math.max(10, e.clientY - menuHeight)
      : Math.max(10, e.clientY);
    setActiveContextMenu({
      clipId,
      audioDuration,
      x,
      y,
    });
  }, []);

  // ── Drag & Resize Engine for Music Clips ────────────────────────────────────
  const handleStartDrag = useCallback((
    e: React.MouseEvent,
    clip: MusicClip,
    mode: 'move' | 'trim_left' | 'trim_right' | 'fade_in' | 'fade_out'
  ) => {
    e.stopPropagation();
    const startMouseX = e.clientX;
    const initialStartFrame = clip.start_frame || 0;
    const initialDurationFrames = clip.duration_frames || 30;
    const initialSrcStartSec = clip.source_start_seconds || 0;
    const initialFadeInSec = clip.fade_in_seconds || 0;
    const initialFadeOutSec = clip.fade_out_seconds || 0;

    let latestClips = effectiveClipsRef.current;
    let didMove = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startMouseX;
      if (Math.abs(deltaX) > 2) {
        didMove = true;
        isDraggingRef.current = true;
      }
      const deltaFrames = Math.round((deltaX / timelineZoom) * FPS);
      const deltaSec = deltaX / timelineZoom;

      const baseList = effectiveClipsRef.current;
      const updated = baseList.map((c: MusicClip) => {
        if (c.id !== clip.id) return c;

        if (mode === 'move') {
          const newStart = Math.max(0, initialStartFrame + deltaFrames);
          return { ...c, start_frame: newStart };
        } else if (mode === 'trim_right') {
          let maxDur = Infinity;
          if (c.loop === false && c.source_duration_seconds && c.source_duration_seconds > 0) {
            maxDur = Math.max(15, Math.round((c.source_duration_seconds - initialSrcStartSec) * FPS));
          }
          const newDur = Math.max(15, Math.min(maxDur, initialDurationFrames + deltaFrames));
          return { ...c, duration_frames: newDur };
        } else if (mode === 'trim_left') {
          const minDeltaFrames = -Math.min(initialStartFrame, Math.round(initialSrcStartSec * FPS));
          const maxDeltaFrames = initialDurationFrames - 15;
          const clampedDelta = Math.max(minDeltaFrames, Math.min(maxDeltaFrames, deltaFrames));
          const newStart = initialStartFrame + clampedDelta;
          const newDur = initialDurationFrames - clampedDelta;
          const newSrcStart = Math.max(0, initialSrcStartSec + (clampedDelta / FPS));
          return {
            ...c,
            start_frame: newStart,
            duration_frames: newDur,
            source_start_seconds: Number(newSrcStart.toFixed(3)),
          };
        } else if (mode === 'fade_in') {
          const maxFade = (initialDurationFrames / FPS) / 2;
          const newFadeIn = Math.max(0, Math.min(maxFade, initialFadeInSec + deltaSec));
          return { ...c, fade_in_seconds: Number(newFadeIn.toFixed(2)) };
        } else if (mode === 'fade_out') {
          const maxFade = (initialDurationFrames / FPS) / 2;
          const newFadeOut = Math.max(0, Math.min(maxFade, initialFadeOutSec - deltaSec));
          return { ...c, fade_out_seconds: Number(newFadeOut.toFixed(2)) };
        }
        return c;
      });

      latestClips = updated;
      setLocalClipsOverride(updated);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (didMove && latestClips) {
        // Keep optimistic state locked until new props arrive
        setLocalClipsOverride(latestClips);
        onUpdateMusicClips?.(latestClips);
      }
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 100);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [timelineZoom, onUpdateMusicClips]);

  // ── Split at Playhead ───────────────────────────────────────────────────────
  const handleSplitClip = useCallback((clipId: string) => {
    const playheadFrame = usePlaybackStore.getState().currentFrame;
    const currentList = effectiveClipsRef.current;
    const clipIndex = currentList.findIndex((c: MusicClip) => c.id === clipId);
    if (clipIndex === -1) return;

    const target = currentList[clipIndex];
    if (playheadFrame <= target.start_frame + 10 || playheadFrame >= target.start_frame + target.duration_frames - 10) {
      return;
    }

    const firstDuration = playheadFrame - target.start_frame;
    const secondDuration = target.duration_frames - firstDuration;
    const srcDur = target.source_duration_seconds;
    let secondSrcStart = (target.source_start_seconds || 0) + (firstDuration / FPS);
    if (srcDur && srcDur > 0) {
      secondSrcStart = secondSrcStart % srcDur;
    }

    const clip1: MusicClip = {
      ...target,
      duration_frames: firstDuration,
      fade_out_seconds: Math.min(target.fade_out_seconds || 0.5, (firstDuration / FPS) / 2),
    };

    const clip2: MusicClip = {
      ...target,
      id: `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      start_frame: playheadFrame,
      duration_frames: secondDuration,
      source_start_seconds: secondSrcStart,
      fade_in_seconds: Math.min(target.fade_in_seconds || 0.5, (secondDuration / FPS) / 2),
    };

    const nextClips = [...currentList];
    nextClips.splice(clipIndex, 1, clip1, clip2);
    setLocalClipsOverride(nextClips);
    onUpdateMusicClips?.(nextClips);
    setSelectedMusicClipId(clip2.id);
    setActiveContextMenu(null);
  }, [onUpdateMusicClips, setSelectedMusicClipId]);

  // ── Duplicate Clip ──────────────────────────────────────────────────────────
  const handleDuplicateClip = useCallback((clipId: string) => {
    const currentList = effectiveClipsRef.current;
    const target = currentList.find((c: MusicClip) => c.id === clipId);
    if (!target) return;

    const newClip: MusicClip = {
      ...target,
      id: `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      start_frame: target.start_frame + target.duration_frames,
    };

    const nextClips = [...currentList, newClip];
    setLocalClipsOverride(nextClips);
    onUpdateMusicClips?.(nextClips);
    setSelectedMusicClipId(newClip.id);
    setActiveContextMenu(null);
  }, [onUpdateMusicClips, setSelectedMusicClipId]);

  // ── Delete Clip ─────────────────────────────────────────────────────────────
  const handleDeleteClip = useCallback((clipId: string) => {
    const currentList = effectiveClipsRef.current;
    const nextClips = currentList.filter((c: MusicClip) => c.id !== clipId);
    setLocalClipsOverride(nextClips);
    onUpdateMusicClips?.(nextClips);
    if (selectedMusicClipId === clipId) {
      setSelectedMusicClipId(nextClips[0]?.id || null);
    }
    setActiveContextMenu(null);
  }, [onUpdateMusicClips, selectedMusicClipId, setSelectedMusicClipId]);

  // ── Update Single Clip Param ────────────────────────────────────────────────
  const handlePatchClip = useCallback((clipId: string, patch: Partial<MusicClip>) => {
    const currentList = effectiveClipsRef.current;
    const nextClips = currentList.map((c: MusicClip) => (c.id === clipId ? { ...c, ...patch } : c));
    setLocalClipsOverride(nextClips);
    onUpdateMusicClips?.(nextClips);
    setActiveContextMenu(null);
  }, [onUpdateMusicClips]);

  const targetClip = activeContextMenu ? effectiveClips.find((c) => c.id === activeContextMenu.clipId) : null;

  return (
    <div
      className={`relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors ${
        isDragOver ? 'bg-cyan-950/40 ring-2 ring-inset ring-cyan-400' : ''
      }`}
      onDragOver={(e) => { e.preventDefault(); if (index !== undefined) onDragOver?.(e, index); }}
      onDragEnter={(e) => { if (index !== undefined) onDragEnter?.(e, index); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); if (index !== undefined) onDrop?.(e, index); }}
    >
      <TrackHeader
        title="Music"
        dotColorClass="bg-indigo-500"
        trackKey="music"
        isMuted={isTrackMuted}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-indigo-400"
        badgeText={effectiveClips.length > 0 ? `${effectiveClips.length}` : undefined}
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />

      {/* Render all Music Clips */}
      {effectiveClips.map((clip) => (
        <MusicClipBlock
          key={clip.id}
          clip={clip}
          timelineZoom={timelineZoom}
          isTrackMuted={isTrackMuted}
          isSelected={selectedMusicClipId === clip.id}
          isDraggingRef={isDraggingRef}
          onSelect={handleSelectClip}
          onOpenContextMenu={handleOpenContextMenu}
          onStartDrag={handleStartDrag}
        />
      ))}

      {/* Per-sub-visual cut segments: striped overlay where mute_bg_music is on */}
      {localTimings.map((timing, idx) => {
        const scene = liveScenes?.[idx];
        const subVisuals = scene?.sub_visuals || [];
        return subVisuals.map((sv: any, sIdx: number) => {
          if (!sv?.mute_bg_music) return null;
          const subTiming = timing.subs?.[sIdx];
          if (!subTiming) return null;
          const subX = ((subTiming.start / FPS) * timelineZoom) + HEADER_WIDTH;
          const subW = Math.max(4, ((subTiming.end - subTiming.start) / FPS) * timelineZoom);
          return (
            <div
              key={`music-cut-${idx}-${sIdx}`}
              className="absolute top-1.5 h-8 rounded-none border-2 border-red-500/70 cursor-pointer transition-all shadow-sm bg-red-950/70 hover:bg-red-900/60 z-20"
              style={{
                left: subX,
                width: subW,
                backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.25) 0 6px, transparent 6px 12px)',
              }}
              onClick={(e) => {
                if (isDraggingScene) return;
                e.stopPropagation();
                if (onToggleSubVisualAudioFlag) onToggleSubVisualAudioFlag(idx, sIdx, 'mute_bg_music');
                else onSeek(subTiming.start);
              }}
              title={`Music cut during "${sv.visual_cue || `Layer ${sIdx + 1}`}" — click to unmute`}
            >
              {subW > 34 && (
                <span className="text-[7.5px] font-mono font-bold px-1.5 leading-[26px] tracking-wide truncate block text-red-300">
                  MUTED
                </span>
              )}
            </div>
          );
        });
      })}

      {/* Floating High-Z Context Menu for Music Clip */}
      {activeContextMenu && targetClip && (
        <div
          id="music-clip-context-menu"
          className="fixed z-[9999] w-52 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1.5 space-y-0.5 text-xs select-none pointer-events-auto"
          style={{ top: activeContextMenu.y, left: activeContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-indigo-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
            <span className="truncate max-w-[140px]">{targetClip.name || 'Music Clip'}</span>
            <button onClick={() => setActiveContextMenu(null)} className="text-zinc-500 hover:text-white p-0.5 cursor-pointer">
              ✕
            </button>
          </div>

          {/* Split at Playhead */}
          <button
            type="button"
            onClick={() => handleSplitClip(targetClip.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Split className="w-3.5 h-3.5 text-cyan-400" />
            <span>Split at Playhead</span>
          </button>

          {/* Duplicate Clip */}
          <button
            type="button"
            onClick={() => handleDuplicateClip(targetClip.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <VscLayers className="w-3.5 h-3.5 text-purple-400" />
            <span>Duplicate Clip</span>
          </button>

          {/* Toggle Loop */}
          <button
            type="button"
            onClick={() => {
              const newLoop = targetClip.loop === false ? true : false;
              const patch: Partial<MusicClip> = { loop: newLoop };
              if (!newLoop) {
                const srcDur = targetClip.source_duration_seconds || activeContextMenu.audioDuration;
                if (srcDur && srcDur > 0) {
                  const maxFrames = Math.max(15, Math.round((srcDur - (targetClip.source_start_seconds || 0)) * FPS));
                  if ((targetClip.duration_frames || 0) > maxFrames) {
                    patch.duration_frames = maxFrames;
                  }
                }
              }
              handlePatchClip(targetClip.id, patch);
            }}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-none text-left text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Seamless Loop</span>
            </div>
            {targetClip.loop !== false && <Check className="w-3 h-3 text-cyan-400" />}
          </button>

          {/* Toggle Mute */}
          <button
            type="button"
            onClick={() => handlePatchClip(targetClip.id, { is_muted: !targetClip.is_muted })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {targetClip.is_muted ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-red-400" />}
            <span>{targetClip.is_muted ? 'Unmute Clip' : 'Mute Clip'}</span>
          </button>

          <div className="h-px bg-zinc-800 my-1" />

          {/* Fade In Presets */}
          <div className="px-2 py-1 text-[8px] font-bold text-zinc-500 uppercase">Fade In</div>
          <div className="grid grid-cols-4 gap-1 px-1">
            {[0, 0.5, 1, 2].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handlePatchClip(targetClip.id, { fade_in_seconds: f })}
                className={`px-1 py-0.5 text-[8px] font-mono border text-center cursor-pointer ${
                  targetClip.fade_in_seconds === f
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 font-bold'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                }`}
              >
                {f}s
              </button>
            ))}
          </div>

          {/* Fade Out Presets */}
          <div className="px-2 py-1 text-[8px] font-bold text-zinc-500 uppercase mt-1">Fade Out</div>
          <div className="grid grid-cols-4 gap-1 px-1">
            {[0, 0.5, 1, 2].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handlePatchClip(targetClip.id, { fade_out_seconds: f })}
                className={`px-1 py-0.5 text-[8px] font-mono border text-center cursor-pointer ${
                  targetClip.fade_out_seconds === f
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 font-bold'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                }`}
              >
                {f}s
              </button>
            ))}
          </div>

          <div className="h-px bg-zinc-800 my-1" />

          {/* Delete Clip */}
          <button
            type="button"
            onClick={() => handleDeleteClip(targetClip.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <VscTrash className="w-3.5 h-3.5" />
            <span>Delete Music Clip</span>
          </button>
        </div>
      )}
    </div>
  );
});

MusicTrack.displayName = 'MusicTrack';

