import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  children: React.ReactNode;
  durationInFrames: number;
  type?: string;
}

export const TransitionWrapper: React.FC<Props> = ({ children, durationInFrames, type = 'subtle_slide' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (type === 'none') {
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    );
  }

  const entrance = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 100, mass: 0.3 }
  });

  let style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    willChange: 'transform, filter, opacity',
    backfaceVisibility: 'hidden',
  };

  if (type === 'fade') {
    const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
    style.opacity = opacity;
  } else if (type === 'zoom_in') {
    const scale = interpolate(entrance, [0, 1], [1.1, 1]);
    style.transform = `scale(${scale})`;
  } else if (type === 'slide_left') {
    const translateX = interpolate(entrance, [0, 1], [100, 0]);
    style.transform = `translateX(${translateX}%)`;
  } else if (type === 'slide_right') {
    const translateX = interpolate(entrance, [0, 1], [-100, 0]);
    style.transform = `translateX(${translateX}%)`;
  } else {
    // subtle_slide (default)
    const translateX = interpolate(entrance, [0, 1], [15, 0]);
    const blur = interpolate(entrance, [0, 1], [8, 0]);
    
    const roundedTranslateX = Math.round(translateX * 10) / 10;
    const roundedBlur = Math.round(blur * 10) / 10;
    
    style.transform = `translateX(${roundedTranslateX}%) translateZ(0)`;
    style.filter = `blur(${roundedBlur}px)`;
  }

  return (
    <div style={style}>
      {children}
    </div>
  );
};
