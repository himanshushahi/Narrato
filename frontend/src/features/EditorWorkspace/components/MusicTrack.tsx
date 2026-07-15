import React from 'react';
import { VscMute, VscUnmute } from 'react-icons/vsc';

const FPS = 30;
const HEADER_WIDTH = 110;

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
      <div
        className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md"
        style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Music
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); toggleTrackMute('music'); }} className="text-zinc-500 hover:text-blue-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackMuted['music'] ? "Unmute track" : "Mute track"}>
            {trackMuted['music'] ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
          </button>
        </div>
      </div>
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
