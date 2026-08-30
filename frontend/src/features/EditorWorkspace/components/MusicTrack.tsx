import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';
import { useAudioWaveform } from '../hooks/useAudioWaveform';
import { WaveformCanvas } from './WaveformCanvas';

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

export const MusicTrack: React.FC<MusicTrackProps> = React.memo(({
  totalDuration, localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene,
  toggleTrackMute, onSeek, onToggleSubVisualAudioFlag, bgMusicUrl,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const { peaks, duration: audioDuration } = useAudioWaveform(bgMusicUrl);
  const isTrackMuted = !!trackMuted['music'];
  const totalSeconds = totalDuration / FPS;
  const trackWidth = Math.max(10, totalSeconds * timelineZoom);

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
        dotColorClass="bg-pink-500"
        trackKey="music"
        isMuted={isTrackMuted}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-pink-400"
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />
      {/* Full Background Music Track with Waveform */}
      <div
        className={`absolute top-2 h-7 rounded-none border-2 cursor-pointer transition-all shadow-sm overflow-hidden ${
          isTrackMuted
            ? 'bg-zinc-900 border-zinc-700 opacity-50'
            : 'bg-zinc-900/90 border-pink-500/50 hover:bg-zinc-850 hover:border-pink-400/80'
        }`}
        style={{ left: HEADER_WIDTH, width: trackWidth }}
        onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(0); } }}
        title="Background Music Track"
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <WaveformCanvas
            peaks={peaks}
            totalAudioDuration={audioDuration}
            startTime={0}
            duration={totalSeconds}
            width={trackWidth}
            height={24}
            color="#ec4899"
            isMuted={isTrackMuted}
          />
        </div>
        <div className="absolute bottom-0 left-1 pointer-events-none">
          <span className={`text-[7px] font-mono font-bold px-1 py-0.2 rounded-none ${isTrackMuted ? 'text-zinc-500 bg-black/60' : 'text-pink-300 bg-black/60'}`}>
            BGM TRACK
          </span>
        </div>
      </div>

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
              className="absolute top-2 h-7 rounded-none border-2 border-red-500/70 cursor-pointer transition-all shadow-sm bg-red-950/70 hover:bg-red-900/60 z-10"
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
                <span className="text-[7.5px] font-mono font-bold px-1.5 leading-[22px] tracking-wide truncate block text-red-300">
                  MUTED
                </span>
              )}
            </div>
          );
        });
      })}
    </div>
  );
});

MusicTrack.displayName = 'MusicTrack';
