import React from 'react';
import { Img, useCurrentFrame, interpolate } from 'remotion';

interface Props {
  backgroundUrl: string;
  foregroundUrl?: string;
  cue: string;
  durationInFrames: number;
}

export const ParallaxImage: React.FC<Props> = ({ backgroundUrl, foregroundUrl, cue, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Create smooth, subtle animation for background and foreground
  // Create dynamic and noticeable animation for background and foreground
  // Background scales up and pans slowly
  const bgScale = interpolate(frame, [0, durationInFrames], [1.1, 1.25], { extrapolateRight: 'clamp' });
  const bgX = interpolate(frame, [0, durationInFrames], [-40, 40], { extrapolateRight: 'clamp' });
  const bgY = interpolate(frame, [0, durationInFrames], [-20, 20], { extrapolateRight: 'clamp' });
  
  // Foreground scales up faster and pans in the opposite direction to create strong parallax depth
  const fgScale = interpolate(frame, [0, durationInFrames], [1.15, 1.4], { extrapolateRight: 'clamp' });
  const fgX = interpolate(frame, [0, durationInFrames], [50, -50], { extrapolateRight: 'clamp' });
  const fgY = interpolate(frame, [0, durationInFrames], [25, -25], { extrapolateRight: 'clamp' });

  const roundedBgScale = Number(bgScale.toFixed(3));
  const roundedBgX = Number(bgX.toFixed(2));
  const roundedBgY = Number(bgY.toFixed(2));
  const roundedFgScale = Number(fgScale.toFixed(3));
  const roundedFgX = Number(fgX.toFixed(2));
  const roundedFgY = Number(fgY.toFixed(2));

  // If no image is provided, fallback to standard polaroid from PanScan
  if (!backgroundUrl) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#141414',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div style={{ color: '#fff' }}>Missing Image for Parallax</div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Background Layer */}
      <Img
        src={backgroundUrl}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${roundedBgScale}) translate3d(${roundedBgX}px, ${roundedBgY}px, 0)`,
          willChange: 'transform',
          transformOrigin: 'center center',
          filter: foregroundUrl ? 'blur(2px) brightness(0.7)' : 'none',
        }}
      />

      {/* Foreground Layer (Cutout Subject) */}
      {foregroundUrl && (
        <Img
          src={foregroundUrl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: `scale(${roundedFgScale}) translate3d(${roundedFgX}px, ${roundedFgY}px, 50px)`,
            willChange: 'transform',
            transformOrigin: 'center center',
            filter: 'drop-shadow(0px 25px 40px rgba(0,0,0,0.8))',
          }}
        />
      )}

      {/* Subtle Vignette Overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        boxShadow: 'inset 0 0 150px rgba(0,0,0,0.8)',
        pointerEvents: 'none'
      }} />
    </div>
  );
};