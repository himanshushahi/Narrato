import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';
import { Circle, Rect, Star, Triangle, Arrow, Polygon } from '@remotion/shapes';
import { evolvePath } from '@remotion/paths';

export type PresetPathType =
  | 'route_arch'
  | 'horizontal_line'
  | 'pointer_curve'
  | 'corner_brackets'
  | 'wave_pulse'
  | 'circle_reticle';

export interface ShapeProps {
  shape_type?: 'rectangle' | 'circle' | 'star' | 'triangle' | 'arrow' | 'polygon' | 'path';
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  width?: number | string;
  height?: number | string;
  corner_radius?: number;
  points?: number;
  inner_radius?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  angle?: number;
  preset_path?: PresetPathType;
  path_d?: string;
  view_box?: string;
  draw_animation?: boolean;
  glow?: boolean;
  style?: React.CSSProperties;
  durationInFrames?: number;
}

const PRESET_PATHS: Record<PresetPathType, string> = {
  route_arch: 'M 250 800 Q 960 250 1670 800',
  horizontal_line: 'M 150 540 L 1770 540',
  pointer_curve: 'M 350 720 C 650 720 850 520 1200 420',
  corner_brackets: 'M 200 350 L 200 250 L 300 250 M 1620 250 L 1720 250 L 1720 350 M 1720 730 L 1720 830 L 1620 830 M 300 830 L 200 830 L 200 730',
  wave_pulse: 'M 100 540 Q 300 360 500 540 T 900 540 T 1300 540 T 1700 540',
  circle_reticle: 'M 960 340 A 200 200 0 1 1 959.9 340',
};

export const ShapeRenderer: React.FC<ShapeProps> = ({
  shape_type = 'rectangle',
  fill = 'transparent',
  stroke = '#00d4ff',
  stroke_width = 2,
  radius = 50,
  width,
  height,
  corner_radius = 16,
  points = 5,
  inner_radius = 25,
  direction = 'right',
  angle = 0,
  preset_path,
  path_d,
  view_box = '0 0 1920 1080',
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

  const glowColor = stroke && stroke !== 'transparent' ? stroke : fill && fill !== 'transparent' ? fill : '#00d4ff';
  const glowStyle = glow
    ? {
        filter: `drop-shadow(0 0 18px ${glowColor}aa)`,
      }
    : {};

  const rotationTransform = angle !== 0 ? ` rotate(${angle}deg)` : '';

  // Determine path data
  const targetPath = useMemo(() => {
    if (preset_path && PRESET_PATHS[preset_path]) {
      return PRESET_PATHS[preset_path];
    }
    if (path_d && path_d.trim()) {
      return path_d.trim();
    }
    return PRESET_PATHS.route_arch;
  }, [preset_path, path_d]);

  // Safely evolve SVG path
  const pathEvolution = useMemo(() => {
    if (shape_type !== 'path') return null;
    try {
      return evolvePath(drawProgress, targetPath);
    } catch {
      return { strokeDasharray: undefined, strokeDashoffset: undefined };
    }
  }, [shape_type, drawProgress, targetPath]);

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
        transform: `scale(${entrance})${rotationTransform}`,
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

      {/* 2. Rectangle / Bounding Box (Supports % width/height or numeric) */}
      {shape_type === 'rectangle' && (
        typeof width === 'number' && typeof height === 'number' ? (
          <Rect
            width={width}
            height={height}
            cornerRadius={corner_radius}
            fill={fill}
            stroke={stroke}
            strokeWidth={stroke_width}
          />
        ) : (
          <svg
            style={{
              width: '100%',
              height: '100%',
              overflow: 'visible',
            }}
          >
            <rect
              x={stroke_width / 2}
              y={stroke_width / 2}
              width={`calc(100% - ${stroke_width}px)`}
              height={`calc(100% - ${stroke_width}px)`}
              rx={corner_radius}
              ry={corner_radius}
              fill={fill}
              stroke={stroke}
              strokeWidth={stroke_width}
            />
          </svg>
        )
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
          direction={direction === 'down' ? 'down' : direction === 'left' ? 'left' : direction === 'right' ? 'right' : 'up'}
          fill={fill}
          stroke={stroke}
          strokeWidth={stroke_width}
        />
      )}

      {/* 5. Arrow */}
      {shape_type === 'arrow' && (
        <Arrow
          length={radius * 2.5}
          direction={direction === 'up' ? 'up' : direction === 'down' ? 'down' : direction === 'left' ? 'left' : 'right'}
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
          viewBox={view_box}
          preserveAspectRatio="none"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          <path
            d={targetPath}
            fill={fill || 'none'}
            stroke={stroke || '#00d4ff'}
            strokeWidth={stroke_width || 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={pathEvolution?.strokeDasharray}
            strokeDashoffset={pathEvolution?.strokeDashoffset}
          />
        </svg>
      )}
    </div>
  );
};
