import React from 'react';
import { VscMute, VscUnmute } from 'react-icons/vsc';

const FPS = 30;
const HEADER_WIDTH = 110;

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
      <div
        className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md"
        style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Voice
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); toggleTrackMute('voice'); }} className="text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackMuted['voice'] ? "Unmute track" : "Mute track"}>
            {trackMuted['voice'] ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
          </button>
        </div>
      </div>
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
