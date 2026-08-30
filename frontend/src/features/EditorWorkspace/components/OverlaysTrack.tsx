import React, { useState, useCallback } from 'react';
import { VscEye, VscEyeClosed, VscLayers } from 'react-icons/vsc';
import { Droplet, Bookmark, Activity, Type } from 'lucide-react';
import { GlobalOverlayItem } from '../../../components/video/GlobalOverlaysRenderer';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { TrackHeader } from './TrackHeader';

interface OverlaysTrackProps {
  overlays: GlobalOverlayItem[];
  totalDuration: number; // in frames
  timelineZoom: number;
  trackHidden: Record<string, boolean>;
  toggleTrackHide: (track: string) => void;
  onSeek: (frame: number) => void;
  onUpdateOverlay?: (target: number | string, updates: Partial<GlobalOverlayItem>) => void;
  onToggleOverlayEnabled?: (target: number | string) => void;
  onSelectOverlay?: (overlayId: string) => void;
  readOnly?: boolean;
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

const OVERLAY_ICONS: Record<string, React.ElementType> = {
  watermark: Droplet,
  chapter_pill: Bookmark,
  progress_bar: Activity,
  custom_text: Type,
};

const OVERLAY_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  watermark: {
    bg: 'from-cyan-600/30 to-blue-600/20',
    border: 'border-cyan-500/50 hover:border-cyan-400',
    text: 'text-cyan-200',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  chapter_pill: {
    bg: 'from-amber-600/30 to-orange-600/20',
    border: 'border-amber-500/50 hover:border-amber-400',
    text: 'text-amber-200',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
  progress_bar: {
    bg: 'from-emerald-600/30 to-teal-600/20',
    border: 'border-emerald-500/50 hover:border-emerald-400',
    text: 'text-emerald-200',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
  custom_text: {
    bg: 'from-purple-600/30 to-pink-600/20',
    border: 'border-purple-500/50 hover:border-purple-400',
    text: 'text-purple-200',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
};

const getOverlayLabel = (item: GlobalOverlayItem): string => {
  switch (item.type) {
    case 'watermark':
      return item.channel_name ? `Watermark: ${item.channel_name}` : 'Watermark Logo';
    case 'chapter_pill':
      return item.chapter_title ? `Chapter: ${item.chapter_title}` : 'Chapter Pill';
    case 'progress_bar':
      return 'Progress Bar';
    case 'custom_text':
      return item.text ? `Text: "${item.text.slice(0, 20)}..."` : 'Custom Text Badge';
    default:
      return item.type;
  }
};

export const OverlaysTrack: React.FC<OverlaysTrackProps> = React.memo(({
  overlays = [],
  totalDuration,
  timelineZoom,
  trackHidden,
  toggleTrackHide,
  onSeek,
  onUpdateOverlay,
  onToggleOverlayEnabled,
  onSelectOverlay,
  readOnly = false,
  index,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragOver,
}) => {
  const totalSeconds = totalDuration / FPS;
  const isHidden = !!trackHidden['overlays'];

  // Filter out legacy banners
  const validOverlays = overlays.filter((o) => (o.type as string) !== 'banner');
  const activeCount = validOverlays.filter((o) => o.enabled !== false).length;

  const [, setDragState] = useState<{
    target: number | string;
    mode: 'move' | 'trim_left' | 'trim_right';
    initialMouseX: number;
    initialFrom: number;
    initialDuration: number;
  } | null>(null);

  const handleStartDrag = useCallback((
    e: React.MouseEvent,
    itemTarget: number | string,
    mode: 'move' | 'trim_left' | 'trim_right',
    fromSec: number,
    durSec: number
  ) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      target: itemTarget,
      mode,
      initialMouseX: e.clientX,
      initialFrom: fromSec,
      initialDuration: durSec,
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - e.clientX;
      const dSec = dx / timelineZoom;

      if (mode === 'move') {
        const newFrom = Math.max(0, Math.min(totalSeconds - durSec, Number((fromSec + dSec).toFixed(2))));
        onUpdateOverlay?.(itemTarget, { from_seconds: newFrom, duration_seconds: durSec, timing: 'custom' });
      } else if (mode === 'trim_left') {
        const proposedFrom = Math.max(0, Math.min(fromSec + durSec - 0.5, Number((fromSec + dSec).toFixed(2))));
        const proposedDur = Math.max(0.5, Number((durSec - (proposedFrom - fromSec)).toFixed(2)));
        onUpdateOverlay?.(itemTarget, { from_seconds: proposedFrom, duration_seconds: proposedDur, timing: 'custom' });
      } else if (mode === 'trim_right') {
        const proposedDur = Math.max(0.5, Math.min(totalSeconds - fromSec, Number((durSec + dSec).toFixed(2))));
        onUpdateOverlay?.(itemTarget, { from_seconds: fromSec, duration_seconds: proposedDur, timing: 'custom' });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = mode === 'move' ? 'grab' : 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [readOnly, timelineZoom, totalSeconds, onUpdateOverlay]);

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
      {/* Track Header with Drag Reorder Handle */}
      <TrackHeader
        title="Overlays"
        dotColorClass="bg-indigo-400"
        trackKey="overlays"
        isHidden={isHidden}
        onToggleHide={toggleTrackHide}
        badgeText={validOverlays.length > 0 ? `${activeCount}/${validOverlays.length}` : undefined}
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />

      {/* Track Content */}
      {!isHidden && (
        validOverlays.length > 0 ? (
          validOverlays.map((item, localIdx) => {
            const realIdx = overlays.findIndex((o) => (o.id && item.id ? o.id === item.id : o === item));
            const targetIdx = realIdx !== -1 ? realIdx : localIdx;
            const overlayTarget = item.id || targetIdx;

            const isFull = item.timing === 'full' || item.from_seconds === undefined;
            const fromSec = isFull ? 0 : (item.from_seconds || 0);
            const durSec = isFull ? totalSeconds : (item.duration_seconds || 10);
            const x = fromSec * timelineZoom;
            const w = Math.max(8, durSec * timelineZoom);

            const isEnabled = item.enabled !== false;
            const styleTheme = OVERLAY_COLORS[item.type] || OVERLAY_COLORS.watermark;
            const Icon = OVERLAY_ICONS[item.type] || VscLayers;
            const label = getOverlayLabel(item);

            return (
              <div
                key={item.id || `overlay-${targetIdx}`}
                className={`absolute top-2 h-7 rounded-none border-2 cursor-pointer transition-all shadow-sm group/overlay flex items-center justify-between px-2 overflow-hidden select-none ${
                  !isEnabled
                    ? 'bg-zinc-800/20 border-zinc-700/40 text-zinc-500 opacity-60'
                    : `bg-gradient-to-r ${styleTheme.bg} ${styleTheme.border} ${styleTheme.text}`
                }`}
                style={{
                  left: x + HEADER_WIDTH,
                  width: w,
                  zIndex: 10 + localIdx,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(Math.floor(fromSec * FPS));
                  onSelectOverlay?.(item.id);
                }}
                onMouseDown={(e) => {
                  if (!readOnly) {
                    const effectiveDur = (isFull && durSec >= totalSeconds)
                      ? (item.duration_seconds && item.duration_seconds < totalSeconds ? item.duration_seconds : Math.min(10, Math.max(3, Number((totalSeconds * 0.4).toFixed(1)))))
                      : durSec;
                    handleStartDrag(e, overlayTarget, 'move', fromSec, effectiveDur);
                  }
                }}
                title={`${label} (${isFull ? 'Full Video' : `${fromSec.toFixed(1)}s - ${(fromSec + durSec).toFixed(1)}s`})\nDrag to reposition • Handles to trim • Click to inspect`}
              >
                {/* Left Trim Handle for Custom Timing */}
                {!readOnly && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-2.5 cursor-col-resize opacity-0 group-hover/overlay:opacity-100 flex items-center justify-center bg-white/10 hover:bg-white/30 z-20"
                    onMouseDown={(e) => handleStartDrag(e, overlayTarget, 'trim_left', fromSec, durSec)}
                    title="Drag to trim start time"
                  >
                    <div className="w-0.5 h-3 bg-white/80 rounded-none" />
                  </div>
                )}

                {/* Content Label */}
                <div className="flex items-center gap-1.5 min-w-0 pr-1 pointer-events-none">
                  <Icon className="w-3 h-3 shrink-0" />
                  {w > 35 && (
                    <span className="text-[8.5px] font-semibold truncate tracking-wide">
                      {label}
                    </span>
                  )}
                  {w > 120 && isFull && (
                    <span className="text-[7px] uppercase font-bold tracking-wider px-1 py-0.2 rounded-none bg-black/60 text-zinc-300 border border-white/10">
                      Full
                    </span>
                  )}
                </div>

                {/* Enable/Disable quick toggle on hover */}
                {w > 60 && !readOnly && onToggleOverlayEnabled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleOverlayEnabled(overlayTarget);
                    }}
                    className={`shrink-0 p-0.5 rounded-none opacity-0 group-hover/overlay:opacity-100 transition-opacity hover:bg-black/40 z-30 ${
                      isEnabled ? 'text-white/90 hover:text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={isEnabled ? "Disable overlay" : "Enable overlay"}
                  >
                    {isEnabled ? <VscEye className="text-[11px]" /> : <VscEyeClosed className="text-[11px]" />}
                  </button>
                )}

                {/* Right Trim Handle for Custom Timing */}
                {!readOnly && (
                  <div
                    className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize opacity-0 group-hover/overlay:opacity-100 flex items-center justify-center bg-white/10 hover:bg-white/30 z-20"
                    onMouseDown={(e) => handleStartDrag(e, overlayTarget, 'trim_right', fromSec, durSec)}
                    title="Drag to trim duration"
                  >
                    <div className="w-0.5 h-3 bg-white/80 rounded-none" />
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="flex items-center h-full text-[9px] text-zinc-600 font-mono tracking-wider italic select-none" style={{ paddingLeft: HEADER_WIDTH + 12 }}>
            No active overlays
          </div>
        )
      )}
    </div>
  );
});

OverlaysTrack.displayName = 'OverlaysTrack';
