import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  VscTrash, VscLayers
} from 'react-icons/vsc';
import { Volume2, VolumeX, Split, Sparkles, Check } from 'lucide-react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';
import { useAudioWaveform } from '../hooks/useAudioWaveform';
import { WaveformCanvas } from './WaveformCanvas';
import { SfxClip } from '../../../components/video/NitishRajputComposition';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';

interface SfxTrackProps {
  totalDuration: number;
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  toggleTrackMute: (track: string) => void;
  bgMusicUrl?: string;
  sfxClips?: SfxClip[];
  onUpdateSfxClips?: (clips: SfxClip[]) => Promise<boolean | void>;
  onUploadSfxClip?: (startFrame?: number) => Promise<void>;
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

// ── Single Interactive SFX Clip Block ─────────────────────────────────────────
const SfxClipBlock: React.FC<{
  clip: SfxClip;
  timelineZoom: number;
  isTrackMuted: boolean;
  isSelected: boolean;
  isDraggingRef: React.MutableRefObject<boolean>;
  onSelect: (id: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, clipId: string, audioDuration?: number) => void;
  onStartDrag: (e: React.MouseEvent, clip: SfxClip, mode: 'move' | 'trim_left' | 'trim_right' | 'fade_in' | 'fade_out') => void;
}> = React.memo(({
  clip, timelineZoom, isTrackMuted, isSelected, isDraggingRef, onSelect, onOpenContextMenu, onStartDrag
}) => {
  const { peaks, duration: audioDuration } = useAudioWaveform(clip.audio_url);
  const startSec = (clip.start_frame || 0) / FPS;
  const durSec = Math.max(0.1, (clip.duration_frames || 30) / FPS);
  const x = startSec * timelineZoom + HEADER_WIDTH;
  const w = Math.max(14, durSec * timelineZoom);
  const isMuted = isTrackMuted || !!clip.is_muted;

  const fadeInPx = Math.min(w / 2, ((clip.fade_in_seconds || 0) / durSec) * w);
  const fadeOutPx = Math.min(w / 2, ((clip.fade_out_seconds || 0) / durSec) * w);

  return (
    <div
      className={`absolute top-1.5 h-8 rounded-none border-2 cursor-grab active:cursor-grabbing transition-colors shadow-sm select-none group/clip overflow-hidden ${
        isSelected
          ? 'ring-2 ring-amber-400 bg-amber-950/60 border-amber-400 z-20 shadow-amber-500/20'
          : isMuted
          ? 'bg-zinc-900/90 border-zinc-700 opacity-60 z-10'
          : 'bg-zinc-900/95 border-amber-500/60 hover:border-amber-400 z-10'
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
      title={`${clip.name || 'SFX Clip'} (${durSec.toFixed(1)}s)`}
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
          color={isSelected ? '#fbbf24' : '#f59e0b'}
          isMuted={isMuted}
          loop={!!clip.loop}
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
          isSelected ? 'text-amber-200 bg-amber-900/80' : isMuted ? 'text-zinc-400 bg-black/70' : 'text-amber-300 bg-black/70'
        }`}>
          {clip.name || 'SFX'}
        </span>
        {w > 65 && (
          <span className="text-[7px] font-mono text-zinc-300 bg-black/60 px-1">
            {durSec.toFixed(1)}s
          </span>
        )}
        {!!clip.loop && w > 100 && (
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
        <div className="w-[2px] h-full bg-amber-400 shadow-sm" />
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
        <div className="w-[2px] h-full bg-amber-400 shadow-sm" />
      </div>

      {/* Draggable Top-Left Fade In Handle (oversized hitbox, small visual) */}
      <div
        className="absolute top-0 w-5 h-5 z-30 cursor-crosshair opacity-0 group-hover/clip:opacity-100 flex items-start justify-start transition-opacity"
        style={{ left: Math.max(6, fadeInPx - 3) }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'fade_in');
        }}
        title={`Fade In: ${(clip.fade_in_seconds || 0).toFixed(1)}s (Drag horizontally to adjust)`}
      >
        <div className="w-2 h-2 rounded-none bg-amber-300 border border-amber-600 shadow" />
      </div>

      {/* Draggable Top-Right Fade Out Handle (oversized hitbox, small visual) */}
      <div
        className="absolute top-0 w-5 h-5 z-30 cursor-crosshair opacity-0 group-hover/clip:opacity-100 flex items-start justify-end transition-opacity"
        style={{ right: Math.max(6, fadeOutPx - 3) }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartDrag(e, clip, 'fade_out');
        }}
        title={`Fade Out: ${(clip.fade_out_seconds || 0).toFixed(1)}s (Drag horizontally to adjust)`}
      >
        <div className="w-2 h-2 rounded-none bg-amber-300 border border-amber-600 shadow" />
      </div>
    </div>
  );
});
SfxClipBlock.displayName = 'SfxClipBlock';

export const SfxTrack: React.FC<SfxTrackProps> = React.memo(({
  totalDuration, timelineZoom, trackMuted,
  toggleTrackMute, bgMusicUrl, sfxClips = [],
  onUpdateSfxClips, onUploadSfxClip,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const isTrackMuted = !!trackMuted['sfx'];
  const selectedSfxClipId = useEditorStore((s) => s.selectedSfxClipId);
  const setSelectedSfxClipId = useEditorStore((s) => s.setSelectedSfxClipId);
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);

  const [activeContextMenu, setActiveContextMenu] = useState<ActiveClipContextMenu | null>(null);
  const [localClipsOverride, setLocalClipsOverride] = useState<SfxClip[] | null>(null);

  // SFX has no legacy fallback — empty means empty
  const computedClips = useMemo<SfxClip[]>(() => {
    return sfxClips && sfxClips.length > 0 ? sfxClips : [];
  }, [sfxClips]);
  void bgMusicUrl;
  void totalDuration;

  const effectiveClips = localClipsOverride || computedClips;
  const effectiveClipsRef = useRef(effectiveClips);
  effectiveClipsRef.current = effectiveClips;
  const isDraggingRef = useRef(false);

  // Sync / clear local override whenever new props arrive
  useEffect(() => {
    setLocalClipsOverride(null);
  }, [sfxClips]);

  // Global dismiss context menu on pointer down outside
  useEffect(() => {
    const handleGlobalDown = (e: MouseEvent) => {
      const el = document.getElementById('sfx-clip-context-menu');
      if (el && !el.contains(e.target as Node)) {
        setActiveContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handleGlobalDown);
    return () => window.removeEventListener('pointerdown', handleGlobalDown);
  }, []);

  const handleSelectClip = useCallback((id: string) => {
    setSelectedSfxClipId(id);
    setLeftPanelTab('sfx');
  }, [setSelectedSfxClipId, setLeftPanelTab]);

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

  // ── Drag & Resize Engine for SFX Clips ────────────────────────────────────
  const handleStartDrag = useCallback((
    e: React.MouseEvent,
    clip: SfxClip,
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

    // Coalesce mousemove bursts to one state update per frame — a 100Hz
    // mouse otherwise re-renders the lane and repaints canvases per tick.
    let rafPending = 0;
    let lastEvent: MouseEvent | null = null;

    const applyDrag = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startMouseX;
      if (Math.abs(deltaX) > 2) {
        didMove = true;
        isDraggingRef.current = true;
      }
      const deltaFrames = Math.round((deltaX / timelineZoom) * FPS);
      const deltaSec = deltaX / timelineZoom;

      const baseList = effectiveClipsRef.current;
      const updated = baseList.map((c: SfxClip) => {
        if (c.id !== clip.id) return c;

        if (mode === 'move') {
          const newStart = Math.max(0, initialStartFrame + deltaFrames);
          return { ...c, start_frame: newStart };
        } else if (mode === 'trim_right') {
          let maxDur = Infinity;
          if (!c.loop && c.source_duration_seconds && c.source_duration_seconds > 0) {
            maxDur = Math.max(3, Math.round((c.source_duration_seconds - initialSrcStartSec) * FPS));
          }
          const newDur = Math.max(3, Math.min(maxDur, initialDurationFrames + deltaFrames));
          return { ...c, duration_frames: newDur };
        } else if (mode === 'trim_left') {
          const minDeltaFrames = -Math.min(initialStartFrame, Math.round(initialSrcStartSec * FPS));
          const maxDeltaFrames = initialDurationFrames - 3;
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
      lastEvent = moveEvent;
      if (!rafPending) {
        rafPending = requestAnimationFrame(() => {
          rafPending = 0;
          if (lastEvent) {
            const ev = lastEvent;
            lastEvent = null;
            applyDrag(ev);
          }
        });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Flush the final position synchronously so the commit sees it.
      if (rafPending) {
        cancelAnimationFrame(rafPending);
        rafPending = 0;
      }
      if (lastEvent) {
        const ev = lastEvent;
        lastEvent = null;
        applyDrag(ev);
      }
      if (didMove && latestClips) {
        // Keep optimistic state locked until new props arrive
        setLocalClipsOverride(latestClips);
        onUpdateSfxClips?.(latestClips);
      }
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 100);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [timelineZoom, onUpdateSfxClips]);

  // ── Split at Playhead ───────────────────────────────────────────────────────
  const handleSplitClip = useCallback((clipId: string) => {
    const playheadFrame = usePlaybackStore.getState().currentFrame;
    const currentList = effectiveClipsRef.current;
    const clipIndex = currentList.findIndex((c: SfxClip) => c.id === clipId);
    if (clipIndex === -1) return;

    const target = currentList[clipIndex];
    if (playheadFrame <= target.start_frame + 10 || playheadFrame >= target.start_frame + target.duration_frames - 10) {
      return;
    }

    const firstDuration = playheadFrame - target.start_frame;
    let secondDuration = target.duration_frames - firstDuration;
    const srcDur = target.source_duration_seconds;
    let secondSrcStart = (target.source_start_seconds || 0) + (firstDuration / FPS);
    if (srcDur && srcDur > 0) {
      if (target.loop) {
        secondSrcStart = secondSrcStart % srcDur;
      } else {
        // One-shot: clamp to remaining source instead of wrapping.
        const remaining = srcDur - secondSrcStart;
        if (remaining <= 0) return;
        secondDuration = Math.min(secondDuration, Math.max(1, Math.floor(remaining * FPS)));
      }
    }

    const clip1: SfxClip = {
      ...target,
      duration_frames: firstDuration,
      fade_out_seconds: Math.min(target.fade_out_seconds ?? 0, (firstDuration / FPS) / 2),
    };

    const clip2: SfxClip = {
      ...target,
      id: `sfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      start_frame: playheadFrame,
      duration_frames: secondDuration,
      source_start_seconds: secondSrcStart,
      fade_in_seconds: Math.min(target.fade_in_seconds ?? 0, (secondDuration / FPS) / 2),
    };

    const nextClips = [...currentList];
    nextClips.splice(clipIndex, 1, clip1, clip2);
    setLocalClipsOverride(nextClips);
    onUpdateSfxClips?.(nextClips);
    setSelectedSfxClipId(clip2.id);
    setActiveContextMenu(null);
  }, [onUpdateSfxClips, setSelectedSfxClipId]);

  // ── Duplicate Clip ──────────────────────────────────────────────────────────
  const handleDuplicateClip = useCallback((clipId: string) => {
    const currentList = effectiveClipsRef.current;
    const target = currentList.find((c: SfxClip) => c.id === clipId);
    if (!target) return;

    const newClip: SfxClip = {
      ...target,
      id: `sfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      start_frame: target.start_frame + target.duration_frames,
    };

    const nextClips = [...currentList, newClip];
    setLocalClipsOverride(nextClips);
    onUpdateSfxClips?.(nextClips);
    setSelectedSfxClipId(newClip.id);
    setActiveContextMenu(null);
  }, [onUpdateSfxClips, setSelectedSfxClipId]);

  // ── Delete Clip ─────────────────────────────────────────────────────────────
  const handleDeleteClip = useCallback((clipId: string) => {
    const currentList = effectiveClipsRef.current;
    const nextClips = currentList.filter((c: SfxClip) => c.id !== clipId);
    setLocalClipsOverride(nextClips);
    onUpdateSfxClips?.(nextClips);
    if (selectedSfxClipId === clipId) {
      setSelectedSfxClipId(nextClips[0]?.id || null);
    }
    setActiveContextMenu(null);
  }, [onUpdateSfxClips, selectedSfxClipId, setSelectedSfxClipId]);

  // ── Update Single Clip Param ────────────────────────────────────────────────
  const handlePatchClip = useCallback((clipId: string, patch: Partial<SfxClip>) => {
    const currentList = effectiveClipsRef.current;
    const nextClips = currentList.map((c: SfxClip) => (c.id === clipId ? { ...c, ...patch } : c));
    setLocalClipsOverride(nextClips);
    onUpdateSfxClips?.(nextClips);
    setActiveContextMenu(null);
  }, [onUpdateSfxClips]);

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
      onDoubleClick={(e) => {
        // Double-click empty lane space to upload an SFX file at that frame.
        if (e.target !== e.currentTarget || !onUploadSfxClip) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frame = Math.max(0, Math.round(((e.clientX - rect.left - HEADER_WIDTH) / timelineZoom) * FPS));
        onUploadSfxClip(frame);
      }}
      title="Double-click empty space to upload SFX here"
    >
      <TrackHeader
        title="SFX"
        dotColorClass="bg-amber-500"
        trackKey="sfx"
        isMuted={isTrackMuted}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-amber-400"
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

      {/* Render all SFX Clips */}
      {effectiveClips.map((clip) => (
        <SfxClipBlock
          key={clip.id}
          clip={clip}
          timelineZoom={timelineZoom}
          isTrackMuted={isTrackMuted}
          isSelected={selectedSfxClipId === clip.id}
          isDraggingRef={isDraggingRef}
          onSelect={handleSelectClip}
          onOpenContextMenu={handleOpenContextMenu}
          onStartDrag={handleStartDrag}
        />
      ))}

      {/* Empty-lane hint (pointer-events-none so double-click upload still lands) */}
      {effectiveClips.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-mono text-zinc-700 border border-dashed border-zinc-800 rounded-none px-2 py-0.5 ml-40">
            Double-click to upload SFX
          </span>
        </div>
      )}

      {/* Floating High-Z Context Menu for SFX Clip */}
      {activeContextMenu && targetClip && (
        <div
          id="sfx-clip-context-menu"
          className="fixed z-[9999] w-52 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1.5 space-y-0.5 text-xs select-none pointer-events-auto"
          style={{ top: activeContextMenu.y, left: activeContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400 border-b border-zinc-800 mb-1">
            <span className="truncate max-w-[140px] block">{targetClip.name || 'SFX Clip'}</span>
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

          {/* Toggle Loop (SFX are one-shots unless explicitly looped) */}
          <button
            type="button"
            onClick={() => {
              const newLoop = !targetClip.loop;
              const patch: Partial<SfxClip> = { loop: newLoop };
              if (!newLoop) {
                const srcDur = targetClip.source_duration_seconds || activeContextMenu.audioDuration;
                if (srcDur && srcDur > 0) {
                  const maxFrames = Math.max(3, Math.round((srcDur - (targetClip.source_start_seconds || 0)) * FPS));
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
            {!!targetClip.loop && <Check className="w-3 h-3 text-amber-400" />}
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

          {/* Fade In Presets (clamped to half the clip length so short SFX survive the export mix) */}
          <div className="px-2 py-1 text-[8px] font-bold text-zinc-500 uppercase">Fade In</div>
          <div className="grid grid-cols-4 gap-1 px-1">
            {[0, 0.5, 1, 2].map((f) => {
              const target = Math.min(f, Math.max(0.1, (targetClip.duration_frames || 30) / FPS) / 2);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => handlePatchClip(targetClip.id, { fade_in_seconds: target })}
                  className={`px-1 py-0.5 text-[8px] font-mono border text-center cursor-pointer ${
                    targetClip.fade_in_seconds === target
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  {f}s
                </button>
              );
            })}
          </div>

          {/* Fade Out Presets */}
          <div className="px-2 py-1 text-[8px] font-bold text-zinc-500 uppercase mt-1">Fade Out</div>
          <div className="grid grid-cols-4 gap-1 px-1">
            {[0, 0.5, 1, 2].map((f) => {
              const target = Math.min(f, Math.max(0.1, (targetClip.duration_frames || 30) / FPS) / 2);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => handlePatchClip(targetClip.id, { fade_out_seconds: target })}
                  className={`px-1 py-0.5 text-[8px] font-mono border text-center cursor-pointer ${
                    targetClip.fade_out_seconds === target
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  {f}s
                </button>
              );
            })}
          </div>

          <div className="h-px bg-zinc-800 my-1" />

          {/* Delete Clip */}
          <button
            type="button"
            onClick={() => handleDeleteClip(targetClip.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <VscTrash className="w-3.5 h-3.5" />
            <span>Delete SFX Clip</span>
          </button>
        </div>
      )}
    </div>
  );
});

SfxTrack.displayName = 'SfxTrack';

