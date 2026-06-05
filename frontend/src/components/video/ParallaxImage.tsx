import React from 'react';
import { Img } from 'remotion';

interface Props {
  backgroundUrl: string;
  foregroundUrl?: string;
  cue: string;
  durationInFrames: number;
}

export const ParallaxImage: React.FC<Props> = ({ backgroundUrl, foregroundUrl, cue, durationInFrames }) => {
  // No zoom or pan - completely static stable frame
  const roundedBgScale = 1;
  const roundedBgX = 0;
  const roundedFgScale = 1;
  const roundedFgX = 0;

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
          transform: `scale(${roundedBgScale}) translateX(${roundedBgX}px) translateZ(0)`,
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
            transform: `scale(${roundedFgScale}) translateX(${roundedFgX}px) translateZ(50px)`,
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