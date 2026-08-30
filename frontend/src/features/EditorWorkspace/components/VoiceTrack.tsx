import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';
import { useAudioWaveform } from '../hooks/useAudioWaveform';
import { WaveformCanvas } from './WaveformCanvas';

type AudioCutFlag = 'mute_voiceover' | 'mute_bg_music';

interface VoiceTrackProps {
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  isDraggingScene: boolean;
  toggleTrackMute: (track: string) => void;
  onSeek: (frame: number) => void;
  onToggleSubVisualAudioFlag?: (sceneIdx: number, subIdx: number, flag: AudioCutFlag) => void;
  audioUrl?: string;
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

export const VoiceTrack: React.FC<VoiceTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene, toggleTrackMute, onSeek,
  onToggleSubVisualAudioFlag, audioUrl,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const { peaks, duration: audioDuration } = useAudioWaveform(audioUrl);
  const isTrackMuted = !!trackMuted['voice'];

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
        title="Voice"
        dotColorClass="bg-emerald-500"
        trackKey="voice"
        isMuted={isTrackMuted}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-emerald-400"
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />
      {localTimings.map((timing, idx) => {
        const x = (timing.start / FPS) * timelineZoom;
        const scene = liveScenes?.[idx];
        const hasNarration = scene?.text && scene.text.trim().length > 0;
        if (!hasNarration) return null;
        const subVisuals = scene?.sub_visuals || [];
        const subTimings = timing.subs || [];

        // With sub-visuals present, split the scene block into per-sub-visual
        // segments so individual sections can be cut (mute_voiceover).
        if (subVisuals.length > 0 && subTimings.length === subVisuals.length) {
          return subVisuals.map((sv: any, sIdx: number) => {
            const subTiming = subTimings[sIdx];
            if (!subTiming) return null;
            const subX = ((subTiming.start - timing.start) / FPS) * timelineZoom;
            const subW = Math.max(4, ((subTiming.end - subTiming.start) / FPS) * timelineZoom);
            const isCut = !!sv?.mute_voiceover;
            const subStartSec = subTiming.start / FPS;
            const subDurSec = (subTiming.end - subTiming.start) / FPS;

            return (
              <div
                key={`voice-sub-${idx}-${sIdx}`}
                className={`absolute top-2 h-7 rounded-none border-2 cursor-pointer transition-all shadow-sm overflow-hidden ${
                  isCut || isTrackMuted
                    ? 'bg-red-950/40 border-red-500/50 hover:bg-red-900/40'
                    : 'bg-zinc-900/90 border-emerald-500/50 hover:bg-zinc-850 hover:border-emerald-400/80'
                }`}
                style={{
                  left: x + subX + HEADER_WIDTH,
                  width: subW,
                  ...(isCut ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.2) 0 6px, transparent 6px 12px)' } : {}),
                }}
                onClick={(e) => {
                  if (isDraggingScene) return;
                  e.stopPropagation();
                  if (onToggleSubVisualAudioFlag) onToggleSubVisualAudioFlag(idx, sIdx, 'mute_voiceover');
                  else onSeek(subTiming.start);
                }}
                title={isCut
                  ? `Voiceover cut during "${sv.visual_cue || `Layer ${sIdx + 1}`}" — click to unmute`
                  : `Click to mute voiceover during "${sv.visual_cue || `Layer ${sIdx + 1}`}"`}
              >
                {/* Real Audio Waveform Rendering */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <WaveformCanvas
                    peaks={peaks}
                    totalAudioDuration={audioDuration}
                    startTime={subStartSec}
                    duration={subDurSec}
                    width={subW}
                    height={24}
                    color="#10b981"
                    isMuted={isTrackMuted}
                    isCut={isCut}
                  />
                </div>

                {/* Sub-Visual Cut Label */}
                {subW > 25 && (
                  <div className="absolute bottom-0 left-1 pointer-events-none">
                    <span className={`text-[7px] font-mono font-bold px-1 py-0.2 rounded-none ${isCut ? 'text-red-300 bg-red-950/80' : 'text-emerald-300 bg-black/60'}`}>
                      {isCut ? 'MUTED' : `VO #${sIdx + 1}`}
                    </span>
                  </div>
                )}
              </div>
            );
          });
        }

        const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
        const sceneStartSec = timing.start / FPS;
        const sceneDurSec = (timing.end - timing.start) / FPS;

        return (
          <div
            key={idx}
            className={`absolute top-2 h-7 rounded-none border-2 cursor-pointer transition-all shadow-sm overflow-hidden ${
              isTrackMuted ? 'bg-zinc-900 border-zinc-700 opacity-50' : 'bg-zinc-900 border-emerald-500/50 hover:border-emerald-400'
            }`}
            style={{ left: x + HEADER_WIDTH, width: w }}
            onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
            title={`Voiceover - Scene ${idx + 1}`}
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <WaveformCanvas
                peaks={peaks}
                totalAudioDuration={audioDuration}
                startTime={sceneStartSec}
                duration={sceneDurSec}
                width={w}
                height={24}
                color="#10b981"
                isMuted={isTrackMuted}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

VoiceTrack.displayName = 'VoiceTrack';
