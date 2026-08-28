import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';
import { Circle, Rect, Star, Triangle, Arrow, Polygon } from '@remotion/shapes';
import { evolvePath } from '@remotion/paths';

export interface ShapeProps {
  shape_type?: 'rectangle' | 'circle' | 'star' | 'triangle' | 'arrow' | 'polygon' | 'path';
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  points?: number;
  inner_radius?: number;
  path_d?: string;
  draw_animation?: boolean;
  glow?: boolean;
  style?: React.CSSProperties;
  durationInFrames?: number;
}

export const ShapeRenderer: React.FC<ShapeProps> = ({
  shape_type = 'rectangle',
  fill = '#f59e0b',
  stroke = '#ffffff',
  stroke_width = 2,
  radius = 50,
  points = 5,
  inner_radius = 25,
  path_d,
  draw_animation = true,
  glow = true,
  style = {},
  durationInFrames = 60,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.8 },
  });

  const drawProgress = draw_animation
    ? interpolate(frame, [0, Math.max(1, Math.min(45, durationInFrames || 60))], [0, 1], {
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
      })
    : 1;

  const glowStyle = glow
    ? {
        filter: `drop-shadow(0 0 15px ${fill || stroke || '#f59e0b'}88)`,
      }
    : {};

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        transform: `scale(${entrance})`,
        opacity: entrance,
        ...glowStyle,
        ...style,
      }}
    >
      {/* 1. Circle */}
      {shape_type === 'circle' && (
        <Circle
          radius={radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 2. Rectangle */}
      {shape_type === 'rectangle' && (
        <Rect
          width={radius * 2}
          height={radius * 1.5}
          cornerRadius={12}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 3. Star */}
      {shape_type === 'star' && (
        <Star
          points={points}
          outerRadius={radius}
          innerRadius={inner_radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 4. Triangle */}
      {shape_type === 'triangle' && (
        <Triangle
          length={radius * 2}
          direction="up"
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 5. Arrow */}
      {shape_type === 'arrow' && (
        <Arrow
          length={radius * 2.5}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 6. Polygon */}
      {shape_type === 'polygon' && (
        <Polygon
          points={points}
          radius={radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 7. Frame-Accurate SVG Path Drawing via @remotion/paths */}
      {shape_type === 'path' && (
        <svg
          viewBox="0 0 500 500"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          {(() => {
            const targetPath = path_d && path_d.trim() ? path_d : 'M 50,250 Q 250,50 450,250';
            const evolved = evolvePath(drawProgress, targetPath);
            return (
              <path
                d={targetPath}
                fill={fill || 'none'}
                stroke={stroke || '#f59e0b'}
                strokeWidth={stroke_width || 4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={evolved.strokeDasharray}
                strokeDashoffset={evolved.strokeDashoffset}
              />
            );
          })()}
        </svg>
      )}
    </div>
  );
};
