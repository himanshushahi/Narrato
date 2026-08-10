import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

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
}

export const MusicTrack: React.FC<MusicTrackProps> = React.memo(({
  totalDuration, localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene,
  toggleTrackMute, onSeek, onToggleSubVisualAudioFlag
}) => {
  return (
    <div className="relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
      <TrackHeader
        title="Music"
        dotColorClass="bg-blue-500"
        trackKey="music"
        isMuted={!!trackMuted['music']}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-blue-400"
      />
      <div
        className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${trackMuted['music'] ? 'bg-zinc-800/30 border-zinc-700/30 opacity-50' : 'bg-gradient-to-b from-blue-600/30 to-blue-700/20 border-blue-500/40 hover:from-blue-500/40 hover:to-blue-600/30 hover:border-blue-400/60'}`}
        style={{ left: HEADER_WIDTH, width: Math.max(10, (totalDuration / FPS) * timelineZoom) }}
        onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(0); } }}
        title="Background Music Track"
      >
        <span className={`text-[8px] font-medium px-2 leading-[22px] tracking-wide truncate block ${trackMuted['music'] ? 'text-zinc-500' : 'text-blue-300/80'}`}>Background Music</span>
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
              className="absolute top-2.5 h-6 rounded-md border border-red-500/50 cursor-pointer transition-all shadow-sm bg-red-950/40 hover:bg-red-900/40"
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
              title={`Music cut during "${sv.visual_cue || `Layer ${sIdx + 1}`}" — click to restore`}
            >
              {subW > 34 && (
                <span className="text-[8px] font-bold px-1.5 leading-[22px] tracking-wide truncate block text-red-300/90">MUSIC CUT</span>
              )}
            </div>
          );
        });
      })}
    </div>
  );
});
MusicTrack.displayName = 'MusicTrack';
