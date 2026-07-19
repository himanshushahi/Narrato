import React from 'react';

import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

interface MusicTrackProps {
  totalDuration: number;
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  isDraggingScene: boolean;
  toggleTrackMute: (track: string) => void;
  onSeek: (frame: number) => void;
}

export const MusicTrack: React.FC<MusicTrackProps> = React.memo(({
  totalDuration, timelineZoom, trackMuted, isDraggingScene, toggleTrackMute, onSeek
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
    </div>
  );
});
MusicTrack.displayName = 'MusicTrack';
