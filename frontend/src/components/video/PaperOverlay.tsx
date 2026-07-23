import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export const PaperOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Create 6 random moving film dust particles / scratch elements
  // We use the frame index modulo operations to randomly snap them on and off screen
  const renderDustParticles = () => {
    const seed = Math.sin(frame) * 10000;
    const isVisible = (frame % 3) === 0; // only visible on some frames for flicker effect
    if (!isVisible) return null;

    const particles = [];
    const count = 4;

    for (let i = 0; i < count; i++) {
      // Semi-random coordinates based on math sin triggers
      const x = Math.abs(Math.sin(seed + i * 45)) * width;
      const y = Math.abs(Math.cos(seed - i * 15)) * height;
      const size = Math.abs(Math.sin(seed * 2 + i)) * 4 + 1; // 1px to 5px
      const opacity = Math.abs(Math.cos(seed * 3 - i)) * 0.4 + 0.1;

      // Sometimes draw a vertical scratch hair
      const isHair = (i === 1) && (frame % 11 === 0);
      
      if (isHair) {
        const hairLength = Math.abs(Math.sin(seed)) * 120 + 40;
        particles.push(
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 1.5,
              height: hairLength,
              backgroundColor: '#d6d3d1',
              opacity: 0.15,
              transform: `rotate(${Math.sin(seed) * 30}deg)`,
              pointerEvents: 'none'
            }}
          />
        );
      } else {
        particles.push(
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: '#a8a29e',
              opacity: opacity,
              pointerEvents: 'none'
            }}
          />
        );
      }
    }

    return particles;
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      width: '100%',
      height: '100%',
      zIndex: 10
    }}>
      {/* 2. Low-opacity paper texture blending overlay */}
      {/* We use an inline SVG noise filter for GPU accelerated film grain */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <filter id="noiseFilter">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency="0.65" 
            numOctaves="3" 
            stitchTiles="stitch" 
          />
          <feColorMatrix type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.08 0" />
        </filter>
      </svg>
      <div style={{
        position: 'absolute',
        inset: 0,
        filter: 'url(#noiseFilter)',
        mixBlendMode: 'overlay',
        zIndex: 3
      }} />

      {/* 3. Vintage sepia tint overlay (creates a warm archival look) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#78350f',
        opacity: 0.02,
        mixBlendMode: 'color-burn',
        zIndex: 4
      }} />

      {/* 4. Film Dust and hair scratches layers */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
        {renderDustParticles()}
      </div>
    </div>
  );
};
