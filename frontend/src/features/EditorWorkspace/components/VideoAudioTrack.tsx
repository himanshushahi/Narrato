import React from 'react';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

interface VideoAudioTrackProps {
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  trackMuted: Record<string, boolean>;
  toggleTrackMute: (track: string) => void;
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

export const VideoAudioTrack: React.FC<VideoAudioTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, trackMuted, toggleTrackMute, onSeek,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  const getValidVisualType = (type: string) => {
    if (!type) return 'scene';
    const t = String(type).toLowerCase();
    if (['ast', 'scene', 'youtube', 'image', 'video'].includes(t)) {
      if (t.includes('youtube') || t.includes('video')) return 'youtube';
      return t;
    }
    return 'ast';
  };

  const isTrackMuted = !!trackMuted['videoaudio'];

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
        title="Vid Audio"
        dotColorClass="bg-amber-500"
        trackKey="videoaudio"
        isMuted={isTrackMuted}
        onToggleMute={toggleTrackMute}
        hoverColorClass="hover:text-amber-400"
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />
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

          return (
            <div
              key={`video-audio-${idx}-${sIdx}`}
              className={`absolute top-2 h-7 rounded-none border-2 cursor-pointer transition-colors shadow-sm flex items-center justify-between px-2 overflow-hidden ${
                isTrackMuted
                  ? 'bg-zinc-900 border-zinc-700 opacity-50'
                  : 'bg-zinc-900/90 border-amber-500/50 hover:bg-zinc-850 hover:border-amber-400/80 text-amber-300'
              }`}
              style={{ left: x + subX + HEADER_WIDTH, width: subW }}
              onClick={(e) => { e.stopPropagation(); onSeek(subTiming.start); }}
              title={`Video Audio - Cut #${sIdx + 1}`}
            >
              {subW > 25 && (
                <span className="text-[7.5px] font-mono font-bold truncate">
                  AUDIO #{sIdx + 1}
                </span>
              )}
            </div>
          );
        });
      })}
    </div>
  );
});

VideoAudioTrack.displayName = 'VideoAudioTrack';