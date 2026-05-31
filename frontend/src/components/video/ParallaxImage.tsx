import React from 'react';
import { useCurrentFrame, interpolate, Img } from 'remotion';

interface Props {
  backgroundUrl: string;
  foregroundUrl?: string; // Optional: If not provided, will do a standard zoom
  cue: string;
  durationInFrames: number;
}

export const ParallaxImage: React.FC<Props> = ({ backgroundUrl, foregroundUrl, cue, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Determine direction based on cue length for variety
  const cueLength = cue.length;
  const directionSeed = cueLength % 4;

  let bgStartScale = 1.05;
  let bgEndScale = 1.15;
  let fgStartScale = 1.1;
  let fgEndScale = 1.35;

  let fgStartX = 0;
  let fgEndX = 0;
  let bgStartX = 0;
  let bgEndX = 0;

  if (directionSeed === 1) {
    // Zoom out, slightly pan left
    bgStartScale = 1.15;
    bgEndScale = 1.05;
    fgStartScale = 1.35;
    fgEndScale = 1.1;
    bgStartX = -20;
    bgEndX = 0;
    fgStartX = -40;
    fgEndX = 0;
  } else if (directionSeed === 2) {
    // Zoom in, pan right
    fgStartX = -20;
    fgEndX = 20;
    bgStartX = -10;
    bgEndX = 10;
  } else if (directionSeed === 3) {
    // Zoom in, pan left
    fgStartX = 20;
    fgEndX = -20;
    bgStartX = 10;
    bgEndX = -10;
  }

  // Background Interpolations (Moves slower)
  const bgScale = interpolate(frame, [0, durationInFrames], [bgStartScale, bgEndScale], { extrapolateRight: 'clamp' });
  const bgX = interpolate(frame, [0, durationInFrames], [bgStartX, bgEndX], { extrapolateRight: 'clamp' });
  
  // Foreground Interpolations (Moves faster, creating depth)
  const fgScale = interpolate(frame, [0, durationInFrames], [fgStartScale, fgEndScale], { extrapolateRight: 'clamp' });
  const fgX = interpolate(frame, [0, durationInFrames], [fgStartX, fgEndX], { extrapolateRight: 'clamp' });

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
      perspective: '1000px'
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
          transform: `scale(${bgScale}) translateX(${bgX}px)`,
          filter: foregroundUrl ? 'blur(2px) brightness(0.7)' : 'none' // Blur background if there is a foreground
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
            transform: `scale(${fgScale}) translateX(${fgX}px) translateZ(50px)`,
            filter: 'drop-shadow(0px 25px 40px rgba(0,0,0,0.8))' // Drop shadow creates physical separation
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
