import React from 'react';
import { useCurrentFrame, interpolate, Img, Video } from 'remotion';

interface Props {
  src: string;
  type: string;
  cue: string;
  durationInFrames: number;
}

export const PanScanImage: React.FC<Props> = ({ src, type, cue, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Create alternating pan directions based on the length of the visual cue
  const cueLength = cue.length;
  const directionSeed = cueLength % 4;

  let startX = -20;
  let endX = 20;
  let startY = -10;
  let endY = 10;
  let startScale = 1.05;
  let endScale = 1.25;

  if (directionSeed === 1) {
    // Zoom out, pan left
    startX = 30;
    endX = -30;
    startY = -10;
    endY = 10;
    startScale = 1.3;
    endScale = 1.05;
  } else if (directionSeed === 2) {
    // Zoom in, pan up-right
    startX = -40;
    endX = 20;
    startY = 20;
    endY = -20;
    startScale = 1.08;
    endScale = 1.28;
  } else if (directionSeed === 3) {
    // Zoom in, pan down-left
    startX = 20;
    endX = -20;
    startY = -20;
    endY = 20;
    startScale = 1.05;
    endScale = 1.2;
  }

  // Linear interpolations for transform coordinates
  const scale = interpolate(frame, [0, durationInFrames], [startScale, endScale], {
    extrapolateRight: 'clamp'
  });
  const x = interpolate(frame, [0, durationInFrames], [startX, endX], {
    extrapolateRight: 'clamp'
  });
  const y = interpolate(frame, [0, durationInFrames], [startY, endY], {
    extrapolateRight: 'clamp'
  });

  const transformStyle = {
    transform: `scale(${scale}) translate3d(${x}px, ${y}px, 0)`,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  };

  // If no stock asset is downloaded, render a gorgeous vintage polaroid card with the text cue
  if (!src) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#141414',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        {/* Background paper gradient */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, #242424 0%, #0a0a0a 100%)',
          opacity: 0.8
        }} />

        {/* Vintage card */}
        <div style={{
          position: 'relative',
          width: 700,
          backgroundColor: '#eae6df',
          padding: '30px 30px 80px 30px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
          borderRadius: 4,
          border: '1px solid #dcd7cd',
          transform: `rotate(${directionSeed - 2}deg) scale(${scale * 0.9})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          {/* Card inner photo placeholder */}
          <div style={{
            width: '100%',
            height: 400,
            backgroundColor: '#121212',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
            border: '1px solid #d0cbc0'
          }}>
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#44403c" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          
          {/* Card text snippet caption */}
          <div style={{
            marginTop: 35,
            width: '100%',
            fontFamily: 'Merriweather, serif',
            fontSize: 24,
            fontWeight: 700,
            color: '#292524',
            textAlign: 'center',
            borderBottom: '1px dashed #a8a29e',
            paddingBottom: 15,
            letterSpacing: 0.5
          }}>
            {cue}
          </div>
        </div>
      </div>
    );
  }

  const cleanSrc = src.split('&t=')[0].split('?t=')[0];
  const isVideo = cleanSrc.toLowerCase().includes('.mp4') || cleanSrc.toLowerCase().includes('.webm');

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {isVideo ? (
        <Video 
          src={src} 
          style={transformStyle}
          muted
          startFrom={0}
          loop
        />
      ) : (
        <Img 
          src={src} 
          style={transformStyle}
        />
      )}
    </div>
  );
};
