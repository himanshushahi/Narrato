import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  children: React.ReactNode;
  durationInFrames: number;
}

export const TransitionWrapper: React.FC<Props> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The transition effect: 
  // Fast blur slide in from the right for the first 10 frames
  // And a slight scale up

  const entrance = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 150, mass: 0.5 }
  });

  const translateX = interpolate(entrance, [0, 1], [100, 0]);
  const blur = interpolate(entrance, [0, 1], [20, 0]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      transform: `translateX(${translateX}%)`,
      filter: `blur(${blur}px)`,
      overflow: 'hidden',
      position: 'relative'
    }}>
      {children}
    </div>
  );
};
