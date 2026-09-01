import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getLogicalCanvasSize } from './compositionScale';

const PAPER_TEXTURE_DATA_URI = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.08 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>'
)}")`;

export const PaperOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const { width: configWidth, height: configHeight } = useVideoConfig();
  // Visuals are authored in 1080p logical pixels; fast preview uses a reduced
  // canvas, so positions must span the logical canvas for identical framing.
  const { width, height } = getLogicalCanvasSize(configWidth, configHeight);

  // Subtle film dust particles with smooth floating movement
  const renderDustParticles = () => {
    const particles = [];
    const count = 3;

    for (let i = 0; i < count; i++) {
      const t = (frame + i * 150) * 0.02;
      const x = ((Math.sin(t * 0.7 + i) * 0.5 + 0.5) * width) % width;
      const y = ((Math.cos(t * 0.5 + i * 2) * 0.5 + 0.5) * height) % height;
      const size = 2 + (i % 2);
      const opacity = 0.06 + Math.sin(t * 1.5 + i) * 0.03;

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
            backgroundColor: '#d6d3d1',
            opacity,
            pointerEvents: 'none',
          }}
        />
      );
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
      {/* 2. Low-opacity paper texture blending overlay (GPU-accelerated seamless tile) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: PAPER_TEXTURE_DATA_URI,
        backgroundRepeat: 'repeat',
        backgroundSize: '200px 200px',
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
