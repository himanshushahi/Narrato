import React from 'react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

interface SubtitleTrackProps {
  transcriptionData: any;
  timelineZoom: number;
  trackHidden: Record<string, boolean>;
  toggleTrackHide: (track: string) => void;
  onSeek: (frame: number) => void;
  // Drag reordering props
  index?: number;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnter?: (e: React.DragEvent, index: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

export const SubtitleTrack: React.FC<SubtitleTrackProps> = React.memo(({
  transcriptionData, timelineZoom, trackHidden, toggleTrackHide, onSeek,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const isHidden = !!trackHidden['subs'];
  const segments = transcriptionData?.segments || [];

  return (
    <div
      className={`relative h-11 border-b border-zinc-800/40 bg-zinc-900/5 hover:bg-zinc-900/20 transition-colors ${
        isDragOver ? 'bg-cyan-950/40 ring-2 ring-inset ring-cyan-400' : ''
      }`}
      onDragOver={(e) => { e.preventDefault(); if (index !== undefined) onDragOver?.(e, index); }}
      onDragEnter={(e) => { if (index !== undefined) onDragEnter?.(e, index); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); if (index !== undefined) onDrop?.(e, index); }}
    >
      <TrackHeader
        title="Subs"
        dotColorClass="bg-purple-500"
        trackKey="subs"
        isHidden={isHidden}
        onToggleHide={toggleTrackHide}
        badgeText={segments.length > 0 ? `${segments.length}` : undefined}
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />
      {!isHidden && (
        segments.length > 0 ? (
          segments.map((segment: any, idx: number) => {
            const startSec = segment.start;
            const endSec = segment.end;
            const x = startSec * timelineZoom;
            const w = Math.max(6, (endSec - startSec) * timelineZoom);
            return (
              <div
                key={`sub-${idx}`}
                className="absolute top-2 h-7 rounded-none bg-gradient-to-b from-purple-600/30 to-purple-700/20 border-2 border-purple-500/50 hover:from-purple-500/40 hover:to-purple-600/30 hover:border-purple-400/80 cursor-pointer overflow-hidden transition-all shadow-sm"
                style={{ left: x + HEADER_WIDTH, width: w }}
                onClick={(e) => { e.stopPropagation(); onSeek(Math.floor(startSec * FPS)); }}
                title={`Subtitle: "${segment.text.trim()}"\nDuration: ${(endSec - startSec).toFixed(2)}s`}
              >
                {w > 18 && (
                  <span className="text-[8.5px] font-medium text-purple-100/90 px-1.5 leading-[22px] truncate block font-sans">
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
