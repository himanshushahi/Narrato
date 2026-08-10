import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

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
}

export const VoiceTrack: React.FC<VoiceTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene, toggleTrackMute, onSeek,
  onToggleSubVisualAudioFlag
}) => {
  return (
    <div className="relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
      <TrackHeader
        title="Voice"
        dotColorClass="bg-emerald-500"
        trackKey="voice"
        isMuted={!!trackMuted['voice']}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-emerald-400"
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
            return (
              <div
                key={`voice-sub-${idx}-${sIdx}`}
                className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${isCut ? 'bg-red-950/40 border-red-500/50 hover:bg-red-900/40' : 'bg-gradient-to-b from-emerald-600/30 to-emerald-700/20 border-emerald-500/40 hover:from-emerald-500/40 hover:to-emerald-600/30 hover:border-emerald-400/60'}`}
                style={{
                  left: x + subX + HEADER_WIDTH,
                  width: subW,
                  ...(isCut ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.25) 0 6px, transparent 6px 12px)' } : {}),
                }}
                onClick={(e) => {
                  if (isDraggingScene) return;
                  e.stopPropagation();
                  if (onToggleSubVisualAudioFlag) onToggleSubVisualAudioFlag(idx, sIdx, 'mute_voiceover');
                  else onSeek(subTiming.start);
                }}
                title={isCut
                  ? `Voiceover cut during "${sv.visual_cue || `Layer ${sIdx + 1}`}" — click to restore`
                  : `Click to cut voiceover during "${sv.visual_cue || `Layer ${sIdx + 1}`}"`}
              >
                {subW > 30 && (
                  <span className={`text-[8px] font-bold px-1.5 leading-[22px] tracking-wide truncate block ${isCut ? 'text-red-300/90' : 'text-emerald-300/70'}`}>
                    {isCut ? 'CUT' : 'VO'}
                  </span>
                )}
              </div>
            );
          });
        }

        const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
        return (
          <div
            key={idx}
            className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${trackMuted['voice'] ? 'bg-zinc-800/30 border-zinc-700/30 opacity-50' : 'bg-gradient-to-b from-emerald-600/30 to-emerald-700/20 border-emerald-500/40 hover:from-emerald-500/40 hover:to-emerald-600/30 hover:border-emerald-400/60'}`}
            style={{ left: x + HEADER_WIDTH, width: w }}
            onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(timing.start); } }}
            title={`Voiceover - Scene ${idx}`}
          />
        );
      })}
    </div>
  );
});
VoiceTrack.displayName = 'VoiceTrack';
