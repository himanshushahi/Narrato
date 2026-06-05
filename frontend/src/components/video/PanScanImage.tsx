import React from 'react';
import { Img, Video } from 'remotion';

interface Props {
  src: string;
  type: string;
  cue: string;
  durationInFrames: number;
}

export const PanScanImage: React.FC<Props> = ({ src, type, cue, durationInFrames }) => {
  // No zoom or pan - completely static stable frame
  const roundedScale = 1;
  const roundedX = 0;
  const roundedY = 0;

  const transformStyle = {
    transform: `scale(${roundedScale}) translate3d(${roundedX}px, ${roundedY}px, 0)`,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
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
          transform: `rotate(0deg) scale(${roundedScale * 0.9})`,
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
          muted={true}
          volume={0}
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