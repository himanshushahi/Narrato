import React from 'react';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';

const FPS = 30;
const HEADER_WIDTH = 110;

interface SubtitleTrackProps {
  transcriptionData: any;
  timelineZoom: number;
  trackHidden: Record<string, boolean>;
  toggleTrackHide: (track: string) => void;
  onSeek: (frame: number) => void;
}

export const SubtitleTrack: React.FC<SubtitleTrackProps> = React.memo(({
  transcriptionData, timelineZoom, trackHidden, toggleTrackHide, onSeek
}) => {
  return (
    <div className="relative h-11 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors">
      <div
        className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-[60] backdrop-blur-md"
        style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          Subs
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); toggleTrackHide('subs'); }} className="text-zinc-500 hover:text-purple-400 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50" title={trackHidden['subs'] ? "Show track" : "Hide track"}>
            {trackHidden['subs'] ? <VscEyeClosed className="text-[14px]" /> : <VscEye className="text-[14px]" />}
          </button>
        </div>
      </div>
      {!trackHidden['subs'] && (
        transcriptionData?.segments?.length > 0 ? (
          transcriptionData.segments.map((segment: any, idx: number) => {
            const startSec = segment.start;
            const endSec = segment.end;
            const x = startSec * timelineZoom;
            const w = Math.max(4, (endSec - startSec) * timelineZoom);
            return (
              <div
                key={`sub-${idx}`}
                className="absolute top-3 h-[18px] rounded-md bg-gradient-to-b from-purple-500/30 to-purple-600/20 border border-purple-500/40 hover:from-purple-400/40 hover:to-purple-500/30 hover:border-purple-400/60 cursor-pointer overflow-hidden transition-all"
                style={{ left: x + HEADER_WIDTH, width: w }}
                onClick={(e) => { e.stopPropagation(); onSeek(Math.floor(startSec * FPS)); }}
                title={`Subtitle: "${segment.text.trim()}"\nDuration: ${(endSec - startSec).toFixed(2)}s`}
              >
                {w > 20 && (
                  <span className="text-[9px] font-medium text-purple-100/90 px-1.5 leading-[16px] truncate block font-sans">
                    {segment.text.trim()}
                  </span>
                )}
              </div>
            );
          })
        ) : (
          <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none" style={{ left: HEADER_WIDTH }}>
            <span className="text-[8px] text-zinc-600 px-2 italic">No subtitles generated yet</span>
          </div>
        )
      )}
    </div>
  );
});
SubtitleTrack.displayName = 'SubtitleTrack';
