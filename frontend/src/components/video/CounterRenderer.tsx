import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';

export interface CounterProps {
  from?: number;
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: string;
  color?: string;
  style?: React.CSSProperties;
  durationInFrames?: number;
}

export const CounterRenderer: React.FC<CounterProps> = ({
  from = 0,
  to = 100,
  prefix = '',
  suffix = '',
  decimals = 0,
  label,
  color = '#f59e0b',
  style = {},
  durationInFrames = 60,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const counterSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80, mass: 1 },
    durationInFrames: Math.max(1, Math.min(60, durationInFrames || 60)),
  });

  const safeDecimals = Math.max(0, Math.min(20, decimals || 0));
  const currentValue = from + (to - from) * counterSpring;
  const formattedNumber = currentValue.toLocaleString(undefined, {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  });

  // Entrance bounce
  const entranceSpring = spring({
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
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        transform: `scale(${entranceSpring})`,
        opacity: entranceSpring,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          gap: '4px',
          fontFamily: style.fontFamily || 'Inter, -apple-system, sans-serif',
          fontWeight: 900,
          lineHeight: 1,
          color: color,
          textShadow: `0 0 30px ${color}66, 0 4px 20px rgba(0,0,0,0.8)`,
        }}
      >
        {prefix && (
          <span style={{ fontSize: '0.6em', opacity: 0.9, marginRight: '4px', fontWeight: 700 }}>
            {prefix}
          </span>
        )}
        <span style={{ fontSize: style.fontSize || '96px', fontVariantNumeric: 'tabular-nums' }}>
          {formattedNumber}
        </span>
        {suffix && (
          <span style={{ fontSize: '0.6em', opacity: 0.9, marginLeft: '4px', fontWeight: 700 }}>
            {suffix}
          </span>
        )}
      </div>

      {label && (
        <div
          style={{
            marginTop: '16px',
            fontSize: '24px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            textAlign: 'center',
            opacity: interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            transform: `translateY(${interpolate(frame, [10, 30], [15, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })}px)`,
            textShadow: '0 2px 10px rgba(0,0,0,0.7)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};
