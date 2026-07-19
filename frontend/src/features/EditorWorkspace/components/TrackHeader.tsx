import React from 'react';
import { VscMute, VscUnmute } from 'react-icons/vsc';
import { HEADER_WIDTH } from '../timelineConstants';

interface TrackHeaderProps {
  title: string;
  dotColorClass: string;
  trackKey: string;
  isMuted: boolean;
  onToggleMute: (trackKey: string) => void;
  hoverColorClass?: string;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  title,
  dotColorClass,
  trackKey,
  isMuted,
  onToggleMute,
  hoverColorClass = 'hover:text-blue-400'
}) => {
  return (
    <div
      className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-[60] backdrop-blur-md"
      style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
    >
      <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`} />
        {title}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(trackKey); }}
          className={`text-zinc-500 transition-colors cursor-pointer p-1 rounded hover:bg-zinc-800/50 ${hoverColorClass}`}
          title={isMuted ? "Unmute track" : "Mute track"}
        >
          {isMuted ? <VscMute className="text-[14px] text-red-400" /> : <VscUnmute className="text-[14px]" />}
        </button>
      </div>
    </div>
  );
};
