import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';

export interface TimelineEvent {
  year_or_date: string;
  title: string;
  description?: string;
}

export interface TimelineProps {
  events?: TimelineEvent[];
  title?: string;
  style?: React.CSSProperties;
  durationInFrames?: number;
}

export const TimelineRenderer: React.FC<TimelineProps> = ({
  events = [],
  title,
  style = {},
  durationInFrames = 90,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const items = events.length > 0 ? events : [
    { year_or_date: '1995', title: 'The Genesis', description: 'Initial breakthrough and discovery' },
    { year_or_date: '2008', title: 'Global Disruption', description: 'Financial shockwave impacts industry' },
    { year_or_date: '2024', title: 'The Modern Era', description: 'Widespread adoption and AI integration' },
  ];

  // Overall timeline draw progress
  const lineProgress = interpolate(frame, [0, Math.max(1, Math.min(50, durationInFrames || 90))], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const headerSpr = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        boxSizing: 'border-box',
        backgroundColor: 'transparent',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: '32px',
            fontWeight: 900,
            color: '#ffffff',
            marginBottom: '36px',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            textAlign: 'center',
            opacity: headerSpr,
            transform: `translateY(${(1 - headerSpr) * -20}px)`,
            textShadow: '0 4px 20px rgba(0,0,0,0.8)',
          }}
        >
          {title}
        </div>
      )}

      {/* Horizontal / Vertical responsive layout */}
      <div style={{ width: '100%', maxWidth: '900px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        {/* Background track line */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '5%',
            width: '90%',
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            zIndex: 1,
          }}
        />

        {/* Animated active line */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '5%',
            width: `${90 * lineProgress}%`,
            height: '4px',
            backgroundColor: '#f59e0b',
            boxShadow: '0 0 16px #f59e0b',
            zIndex: 2,
          }}
        />

        {/* Milestone nodes */}
        {items.map((item, idx) => {
          const nodeDelay = (idx / items.length) * 35;
          const nodeSpr = spring({
            frame: Math.max(0, frame - nodeDelay),
            fps,
            config: { damping: 10, stiffness: 120 },
          });

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                zIndex: 3,
                flex: 1,
                padding: '0 12px',
                opacity: nodeSpr,
                transform: `scale(${nodeSpr}) translateY(${(1 - nodeSpr) * 15}px)`,
              }}
            >
              {/* Glowing circle badge */}
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: '#0f172a',
                  border: '3px solid #f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 20px rgba(245, 158, 11, 0.5)',
                  marginBottom: '16px',
                }}
              >
                <div style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              </div>

              {/* Year / Date */}
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 900,
                  color: '#f59e0b',
                  fontFamily: 'monospace',
                  marginBottom: '6px',
                  textShadow: '0 0 10px rgba(245,158,11,0.4)',
                }}
              >
                {item.year_or_date}
              </div>

              {/* Title */}
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#ffffff', marginBottom: '4px', lineHeight: 1.2 }}>
                {item.title}
              </div>

              {/* Description */}
              {item.description && (
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.4, maxWidth: '200px' }}>
                  {item.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
