import React from 'react';
import { VscMute, VscUnmute } from 'react-icons/vsc';
import { FPS, HEADER_WIDTH } from '../timelineConstants';

interface VideoAudioTrackProps {
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  toggleTrackMute: (track: string) => void;
  onSeek: (frame: number) => void;
}

export const VideoAudioTrack: React.FC<VideoAudioTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, trackMuted, toggleTrackMute, onSeek
}) => {
  const getValidVisualType = (type: string) => {
    if (!type) return 'scene';
    const t = String(type).toLowerCase();
    if (['ast', 'scene', 'youtube', 'image', 'video'].includes(t)) {
      if (t.includes('youtube') || t.includes('video')) return 'youtube';
      return t;
    }
    return 'ast'; // Default fallback to ast
  };

  const hasAnyVideoAudio = localTimings.some((_, idx) => {
    const scene = liveScenes?.[idx];
    const subVisuals = scene?.sub_visuals || [];
    return subVisuals.some((sv: any) => {
      const type = getValidVisualType(sv.visual_type);
      return type === 'scene' || type === 'youtube';
    });
  });

  return (
    <div className="relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
      <div
        className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-[60] backdrop-blur-md"
        style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Video Audio
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); toggleTrackMute('videoaudio'); }}
            className={`text-zinc-500 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50 ${trackMuted['videoaudio'] ? 'hover:text-amber-400' : 'hover:text-amber-400'}`}
            title={trackMuted['videoaudio'] ? "Unmute all video audio" : "Mute all video audio"}
          >
            {trackMuted['videoaudio'] ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
          </button>
        </div>
      </div>
      {localTimings.map((timing, idx) => {
        const scene = liveScenes?.[idx];
        const subVisuals = scene?.sub_visuals || [];
        const x = (timing.start / FPS) * timelineZoom;

        return subVisuals.map((sv: any, sIdx: number) => {
          const type = getValidVisualType(sv.visual_type);
          if (type !== 'scene' && type !== 'youtube') return null;
          
          const subTiming = timing.subs?.[sIdx];
          if (!subTiming) return null;
          const subX = ((subTiming.start - timing.start) / FPS) * timelineZoom;
          const subW = Math.max(4, ((subTiming.end - subTiming.start) / FPS) * timelineZoom);
          
          const vol = sv.videoVolume !== undefined ? sv.videoVolume : 0;
          const volumePct = Math.round(vol * 100);
          const isMuted = vol <= 0;

          return (
            <div
              key={`va-${idx}-${sIdx}`}
              className={`absolute top-2.5 h-6 rounded-md border cursor-pointer transition-all shadow-sm ${
                trackMuted['videoaudio'] || isMuted
                  ? 'bg-zinc-800/30 border-zinc-700/50 text-zinc-500 hover:bg-zinc-800/50'
                  : 'bg-gradient-to-b from-amber-600/30 to-amber-700/20 border-amber-500/40 hover:from-amber-500/40 hover:to-amber-600/30 hover:border-amber-400/60 text-amber-300'
              }`}
              style={{ left: x + subX + HEADER_WIDTH, width: subW }}
              onClick={(e) => { e.stopPropagation(); onSeek(subTiming.start); }}
              title={`Video Audio: ${sv.visual_cue || `Layer ${sIdx + 1}`} @ ${volumePct}% volume`}
            >
              {subW > 20 && (
                <span className={`text-[8px] font-medium px-1.5 leading-[22px] tracking-wide truncate block ${isMuted ? 'text-zinc-500' : 'text-amber-300/80'}`}>
                  {isMuted ? 'Muted' : `${volumePct}%`}
                </span>
              )}
              {subW > 8 && subW <= 20 && (
                <div className="flex items-center justify-center h-full">
                  {isMuted ? <VscMute className="text-[8px] text-zinc-500" /> : <VscUnmute className="text-[8px] text-amber-400/60" />}
                </div>
              )}
            </div>
          );
        });
      })}
      {!hasAnyVideoAudio && (
        <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none" style={{ left: HEADER_WIDTH }}>
          <span className="text-[8px] text-zinc-600 px-2 italic">No video audio enabled</span>
        </div>
      )}
    </div>
  );
});
VideoAudioTrack.displayName = 'VideoAudioTrack';