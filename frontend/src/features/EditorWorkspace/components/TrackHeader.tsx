import React from 'react';
import { VscMute, VscUnmute, VscEye, VscEyeClosed } from 'react-icons/vsc';
import { GripVertical } from 'lucide-react';
import { HEADER_WIDTH } from '../timelineConstants';

interface TrackHeaderProps {
  title: string;
  dotColorClass: string;
  trackKey: string;
  isMuted?: boolean;
  isHidden?: boolean;
  onToggleMute?: (trackKey: string) => void;
  onToggleHide?: (trackKey: string) => void;
  hoverColorClass?: string;
  badgeText?: string;
  // Drag-and-drop reordering props
  index?: number;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnter?: (e: React.DragEvent, index: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

// Fix 6+memo: sticky + box-shadow repainted on every scroll pixel; border-r
// is paint-free. Memoized since parent lanes re-render per drag tick.
export const TrackHeader: React.FC<TrackHeaderProps> = React.memo(({
  title,
  dotColorClass,
  trackKey,
  isMuted = false,
  isHidden = false,
  onToggleMute,
  onToggleHide,
  hoverColorClass = 'hover:text-blue-400',
  badgeText,
  index = 0,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragOver = false,
}) => {
  return (
    <div
      className={`sticky left-0 top-0 h-full bg-zinc-950 border-r-2 border-zinc-800 flex items-center justify-between px-2.5 z-[60] select-none cursor-grab active:cursor-grabbing ${
        isDragOver ? 'bg-cyan-950/60 ring-2 ring-inset ring-cyan-400' : ''
      }`}
      style={{ width: HEADER_WIDTH }}
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(e, index); }}
      onDragEnter={(e) => onDragEnter?.(e, index)}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop?.(e, index); }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Drag Grip Handle */}
        {onDragStart && (
          <div
            className="text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing p-0.5"
            title="Drag to reorder track position up/down"
          >
            <GripVertical className="w-3 h-3 shrink-0" />
          </div>
        )}

        {/* Sharp Square Color Indicator */}
        <span className={`w-2 h-2 rounded-none shrink-0 ${dotColorClass}`} />

        <span className="text-[10px] font-bold text-zinc-200 uppercase tracking-wider whitespace-nowrap">
          {title}
        </span>

        {badgeText && (
          <span className="text-[7.5px] px-1 py-0.2 rounded-none bg-zinc-800 text-zinc-400 font-mono shrink-0">
            {badgeText}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {onToggleHide && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleHide(trackKey); }}
            className="text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer p-1 rounded-none hover:bg-zinc-800/60"
            title={isHidden ? "Show track" : "Hide track"}
          >
            {isHidden ? <VscEyeClosed className="text-[13px]" /> : <VscEye className="text-[13px]" />}
          </button>
        )}

        {onToggleMute && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleMute(trackKey); }}
            className={`text-zinc-500 transition-colors cursor-pointer p-1 rounded-none hover:bg-zinc-800/60 ${hoverColorClass}`}
            title={isMuted ? "Unmute track" : "Mute track"}
          >
            {isMuted ? <VscMute className="text-[13px] text-red-400" /> : <VscUnmute className="text-[13px]" />}
          </button>
        )}
      </div>
    </div>
  );
});
(TrackHeader as any).displayName = 'TrackHeader';
