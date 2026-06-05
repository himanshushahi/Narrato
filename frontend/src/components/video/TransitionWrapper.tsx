import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  children: React.ReactNode;
  durationInFrames: number;
}

export const TransitionWrapper: React.FC<Props> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle documentary-style transition - gentle fade with minimal movement
  const entrance = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 100, mass: 0.3 }
  });

  // Reduced from 100% to 15% for subtle slide
  const translateX = interpolate(entrance, [0, 1], [15, 0]);
  // Reduced from 20px to 8px for subtle blur
  const blur = interpolate(entrance, [0, 1], [8, 0]);

  // Round values to prevent subpixel flickering
  const roundedTranslateX = Math.round(translateX * 10) / 10;
  const roundedBlur = Math.round(blur * 10) / 10;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      transform: `translateX(${roundedTranslateX}%) translateZ(0)`,
      filter: `blur(${roundedBlur}px)`,
      overflow: 'hidden',
      position: 'relative',
      willChange: 'transform, filter',
      backfaceVisibility: 'hidden',
    }}>
      {children}
    </div>
  );
};
