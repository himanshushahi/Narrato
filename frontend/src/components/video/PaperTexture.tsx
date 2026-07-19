import React, { useId } from 'react';

interface PaperTextureProps {
  /** Overall opacity of the texture layers (0-1). Default: 0.6 */
  opacity?: number;
  /** Mix blend mode for the texture. Default: 'multiply' */
  blendMode?: React.CSSProperties['mixBlendMode'];
  /** Intensity of sepia coloring (0-1). Default: 0.4 */
  sepiaIntensity?: number;
  /** Show grain layer. Default: true */
  showGrain?: boolean;
  /** Show edge wear/vignette. Default: true */
  showVignette?: boolean;
}

/**
 * Reusable SVG-based paper texture / grain overlay.
 * Composes four layers: paper grain noise, sepia shift, fine noise, and edge vignette.
 */
export const PaperTexture: React.FC<PaperTextureProps> = ({
  opacity = 0.6,
  blendMode = 'multiply',
  sepiaIntensity = 0.4,
  showGrain = true,
  showVignette = true,
}) => {
  const idPrefix = useId().replace(/:/g, "");
  const filterId = `paperGrain_${idPrefix}`;
  const noiseId = `fineNoise_${idPrefix}`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 5,
        mixBlendMode: blendMode,
        opacity,
      }}
    >
      {/* SVG filter definitions */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        {/* 1. Paper grain — larger organic texture */}
        <filter id={filterId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.4"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values={`0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 ${sepiaIntensity * 0.2} 0`}
          />
          <feComponentTransfer>
            <feFuncA type="linear" slope={sepiaIntensity * 0.3} />
          </feComponentTransfer>
        </filter>

        {/* 2. Fine noise — paper tooth / micro texture */}
        <filter id={noiseId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 0.06 0"
          />
        </filter>
      </svg>

      {/* Layer 1: Paper grain */}
      {showGrain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            filter: `url(#${filterId})`,
            zIndex: 1,
          }}
        />
      )}

      {/* Layer 2: Warm sepia shift */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#78350f',
          opacity: sepiaIntensity * 0.04,
          mixBlendMode: 'color-burn',
          zIndex: 2,
        }}
      />

      {/* Layer 3: Fine noise overlay */}
      {showGrain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            filter: `url(#${noiseId})`,
            mixBlendMode: 'overlay',
            zIndex: 3,
          }}
        />
      )}

      {/* Layer 4: Edge vignette / wear */}
      {showVignette && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              radial-gradient(ellipse at 0% 0%, rgba(120,53,15,0.12) 0%, transparent 40%),
              radial-gradient(ellipse at 100% 0%, rgba(120,53,15,0.10) 0%, transparent 40%),
              radial-gradient(ellipse at 0% 100%, rgba(120,53,15,0.12) 0%, transparent 40%),
              radial-gradient(ellipse at 100% 100%, rgba(120,53,15,0.10) 0%, transparent 40%),
              radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(28,25,23,0.08) 100%)
            `,
            zIndex: 4,
          }}
        />
      )}
    </div>
  );
};
