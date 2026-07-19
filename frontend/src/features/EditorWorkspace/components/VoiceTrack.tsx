import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

interface VoiceTrackProps {
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  isDraggingScene: boolean;
  toggleTrackMute: (track: string) => void;
  onSeek: (frame: number) => void;
}

export const VoiceTrack: React.FC<VoiceTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, trackMuted, isDraggingScene, toggleTrackMute, onSeek
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
        const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
        const scene = liveScenes?.[idx];
        const hasNarration = scene?.text && scene.text.trim().length > 0;
        if (!hasNarration) return null;
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
