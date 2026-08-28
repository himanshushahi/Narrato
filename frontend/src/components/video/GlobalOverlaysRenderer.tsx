import React, { useMemo } from 'react';
import { Sequence, useCurrentFrame, useVideoConfig, spring, Img } from 'remotion';

export interface GlobalOverlayItem {
  id: string;
  type: 'watermark' | 'progress_bar' | 'chapter_pill' | 'custom_text';
  enabled: boolean;

  // Timing
  timing: 'full' | 'custom';
  from_seconds?: number;
  duration_seconds?: number;

  // Position & Manual Coordinates
  position?: 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left' | 'top_center' | 'bottom_center' | 'top' | 'bottom' | 'custom';
  nudge_x?: number;
  nudge_y?: number;
  custom_styles?: React.CSSProperties;

  // Visual styling
  opacity?: number;
  scale?: number;
  color?: string;
  bg_color?: string;
  border_color?: string;
  border_radius?: string | number;
  border_width?: number;
  padding?: string;
  glass_blur?: boolean;
  glow?: boolean;
  animation?: 'fade' | 'slide_up' | 'slide_down' | 'spring_pop' | 'none';

  // Type-specific contents
  // 1. Watermark
  logo_url?: string;
  logo_size?: number;
  channel_name?: string;
  show_verified_badge?: boolean;
  font_size?: string;
  font_weight?: string | number;

  // 2. Progress Bar
  bar_height?: number;
  track_color?: string;

  // 3. Chapter Pill
  chapter_title?: string;
  chapter_number?: string | number;

  // 4. Custom Text
  text?: string;
}

export interface GlobalOverlaysProps {
  overlays?: GlobalOverlayItem[];
  totalDurationInFrames?: number;
}

// ── Position Style Generator with Fine-Tune Nudging ───────────────────────────
const getPositionStyle = (position?: string, nudge_x: number = 0, nudge_y: number = 0): React.CSSProperties => {
  switch (position) {
    case 'top_left':
      return { position: 'absolute', top: `${36 + nudge_y}px`, left: `${44 + nudge_x}px` };
    case 'top_center':
      return { position: 'absolute', top: `${36 + nudge_y}px`, left: '50%', transform: `translateX(calc(-50% + ${nudge_x}px))` };
    case 'top_right':
      return { position: 'absolute', top: `${36 + nudge_y}px`, right: `${44 - nudge_x}px` };
    case 'bottom_left':
      return { position: 'absolute', bottom: `${48 - nudge_y}px`, left: `${44 + nudge_x}px` };
    case 'bottom_center':
      return { position: 'absolute', bottom: `${48 - nudge_y}px`, left: '50%', transform: `translateX(calc(-50% + ${nudge_x}px))` };
    case 'bottom_right':
      return { position: 'absolute', bottom: `${48 - nudge_y}px`, right: `${44 - nudge_x}px` };
    case 'top':
      return { position: 'absolute', top: `${nudge_y}px`, left: 0, width: '100%' };
    case 'bottom':
      return { position: 'absolute', bottom: `${-nudge_y}px`, left: 0, width: '100%' };
    default:
      return { position: 'absolute', top: `${36 + nudge_y}px`, right: `${44 - nudge_x}px` };
  }
};

// ── Individual Overlay Primitives ───────────────────────────────────────────

const WatermarkComponent: React.FC<{ item: GlobalOverlayItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = item.animation === 'none' ? 1 : spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 0.8 },
  });

  const logoInitial = ((item.channel_name || '').trim().charAt(0) || 'C').toUpperCase();
  const logoSize = item.logo_size || 34;
  const borderRadius = item.border_radius !== undefined ? item.border_radius : '9999px';
  const borderWidth = item.border_width !== undefined ? item.border_width : 1;
  const borderColor = item.border_color || 'rgba(255, 255, 255, 0.15)';
  const blurValue = item.glass_blur !== false ? '16px' : '0px';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        backgroundColor: item.bg_color || 'rgba(15, 23, 42, 0.7)',
        backdropFilter: blurValue !== '0px' ? `blur(${blurValue})` : undefined,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: borderRadius,
        padding: item.padding || (item.logo_url && !item.channel_name ? '8px' : '6px 16px 6px 8px'),
        boxShadow: item.glow !== false ? '0 8px 32px rgba(0, 0, 0, 0.5)' : undefined,
        opacity: (item.opacity ?? 0.85) * entrance,
        transform: `scale(${(item.scale ?? 1) * entrance})`,
        pointerEvents: 'none',
        ...item.custom_styles,
      }}
    >
      {item.logo_url ? (
        <div
          style={{
            width: `${logoSize}px`,
            height: `${logoSize}px`,
            borderRadius: borderRadius === '9999px' ? '50%' : '6px',
            overflow: 'hidden',
            border: '1.5px solid rgba(255,255,255,0.25)',
            flexShrink: 0,
          }}
        >
          <Img src={item.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : item.channel_name ? (
        <div
          style={{
            width: `${logoSize}px`,
            height: `${logoSize}px`,
            borderRadius: borderRadius === '9999px' ? '50%' : '6px',
            backgroundColor: item.color || '#f59e0b',
            color: '#0f172a',
            fontWeight: 900,
            fontSize: `${Math.round(logoSize * 0.45)}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {logoInitial}
        </div>
      ) : null}

      {item.channel_name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span
            style={{
              fontSize: item.font_size || '15px',
              fontWeight: item.font_weight || 800,
              color: item.color || '#ffffff',
              letterSpacing: '0.3px',
            }}
          >
            {item.channel_name}
          </span>
          {item.show_verified_badge !== false && (
            <span
              style={{
                backgroundColor: '#38bdf8',
                color: '#0f172a',
                fontSize: '9px',
                fontWeight: 900,
                padding: '1px 4px',
                borderRadius: '4px',
              }}
            >
              ✓
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const ProgressBarComponent: React.FC<{ item: GlobalOverlayItem; totalFrames: number }> = ({ item, totalFrames }) => {
  const frame = useCurrentFrame();
  const progressPercent = totalFrames > 0 ? Math.min(100, Math.max(0, (frame / totalFrames) * 100)) : 0;
  const barColor = item.color || '#f59e0b';
  const barHeight = item.bar_height || 4;

  return (
    <div
      style={{
        width: '100%',
        height: `${barHeight}px`,
        backgroundColor: item.track_color || item.bg_color || 'rgba(255, 255, 255, 0.1)',
        position: 'relative',
        overflow: 'hidden',
        opacity: item.opacity ?? 0.9,
        pointerEvents: 'none',
        ...item.custom_styles,
      }}
    >
      <div
        style={{
          width: `${progressPercent}%`,
          height: '100%',
          backgroundColor: barColor,
          boxShadow: item.glow !== false ? `0 0 14px ${barColor}` : undefined,
          borderRadius: '0 2px 2px 0',
          transition: 'none',
        }}
      />
    </div>
  );
};

const ChapterPillComponent: React.FC<{ item: GlobalOverlayItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = item.animation === 'none' ? 1 : spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const borderRadius = item.border_radius !== undefined ? item.border_radius : '8px';
  const borderColor = item.border_color || 'rgba(255, 255, 255, 0.15)';
  const borderWidth = item.border_width !== undefined ? item.border_width : 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: item.bg_color || 'rgba(0, 0, 0, 0.75)',
        backdropFilter: item.glass_blur !== false ? 'blur(16px)' : undefined,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: borderRadius,
        padding: item.padding || '6px 14px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        opacity: (item.opacity ?? 0.9) * entrance,
        transform: `translateY(${(1 - entrance) * -15}px) scale(${item.scale ?? 1})`,
        pointerEvents: 'none',
        ...item.custom_styles,
      }}
    >
      {item.chapter_number !== undefined && (
        <span style={{ fontSize: '11px', fontWeight: 900, color: item.color || '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px' }}>
          CHAPTER {item.chapter_number}
        </span>
      )}
      {item.chapter_number !== undefined && item.chapter_title && (
        <span style={{ width: '3px', height: '12px', backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: '2px' }} />
      )}
      {item.chapter_title && (
        <span style={{ fontSize: item.font_size || '13px', fontWeight: 700, color: '#ffffff' }}>
          {item.chapter_title}
        </span>
      )}
    </div>
  );
};

const CustomTextComponent: React.FC<{ item: GlobalOverlayItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = item.animation === 'none' ? 1 : spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90 },
  });

  return (
    <div
      style={{
        fontSize: item.font_size || '18px',
        fontWeight: item.font_weight || 800,
        color: item.color || '#ffffff',
        backgroundColor: item.bg_color || 'transparent',
        padding: item.padding || '0',
        borderRadius: item.border_radius || '0',
        opacity: (item.opacity ?? 1) * entrance,
        transform: `scale(${(item.scale ?? 1) * entrance})`,
        textShadow: '0 4px 16px rgba(0,0,0,0.8)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        ...item.custom_styles,
      }}
    >
      {item.text}
    </div>
  );
};

// ── Master Global Overlays Renderer ─────────────────────────────────────────

export const GlobalOverlaysRenderer: React.FC<GlobalOverlaysProps> = ({
  overlays = [],
  totalDurationInFrames = 300,
}) => {
  const { fps } = useVideoConfig();

  const activeOverlays = useMemo(() => {
    return (overlays || []).filter((item) => item.enabled !== false);
  }, [overlays]);

  if (!activeOverlays || activeOverlays.length === 0) {
    return null;
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 95, pointerEvents: 'none', overflow: 'hidden' }}>
      {activeOverlays.map((item) => {
        const isFull = item.timing === 'full' || !item.timing;
        const fromFrame = isFull ? 0 : Math.round((item.from_seconds || 0) * fps);
        const durationFrames = isFull
          ? totalDurationInFrames
          : Math.max(1, Math.min(totalDurationInFrames - fromFrame, Math.round((item.duration_seconds || 10) * fps)));

        const positionStyle = getPositionStyle(item.position, item.nudge_x || 0, item.nudge_y || 0);

        return (
          <Sequence key={item.id} from={fromFrame} durationInFrames={durationFrames}>
            <div style={positionStyle}>
              {item.type === 'watermark' && <WatermarkComponent item={item} />}
              {item.type === 'progress_bar' && (
                <ProgressBarComponent item={item} totalFrames={totalDurationInFrames} />
              )}
              {item.type === 'chapter_pill' && <ChapterPillComponent item={item} />}
              {item.type === 'custom_text' && <CustomTextComponent item={item} />}
            </div>
          </Sequence>
        );
      })}
    </div>
  );
};
