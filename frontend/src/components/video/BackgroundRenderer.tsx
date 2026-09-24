import React, { useId } from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export type BackgroundPreset =
  | 'gradient_mesh'
  | 'grid_flow'
  | 'waves'
  | 'dots'
  | 'blueprint'
  | 'vignette_loop'
  | 'paper_grain';

export interface BackgroundRendererProps {
  preset?: BackgroundPreset | string;
  colors?: string[];
  speed?: number;
  style?: React.CSSProperties;
}

/**
 * Safely applies an alpha channel to any color (including 3-digit and 6-digit hex).
 * Prevents invalid 5-digit hex syntax like #fff88.
 * Shared by CounterRenderer — keep behavior stable when editing.
 */
export function withAlphaHex(color: string, alphaHex: string, fallbackRgb = '2, 132, 199', fallbackAlpha = 0.5): string {
  if (!color) return `rgba(${fallbackRgb}, ${fallbackAlpha})`;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `${trimmed}${alphaHex}`;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 7)}${alphaHex}`;
  }
  return trimmed;
}

/** Back-compat alias for existing BackgroundRenderer call sites. */
function withAlpha(color: string, alphaHex: string, fallbackAlpha = 0.5): string {
  return withAlphaHex(color, alphaHex, '2, 132, 199', fallbackAlpha);
}

/**
 * Normalizes preset names, handling uppercase, hyphens, and common LLM synonyms.
 */
function normalizePreset(raw?: string): BackgroundPreset {
  const p = (raw || 'gradient_mesh').trim().toLowerCase().replace(/-/g, '_');
  if (p === 'mesh' || p === 'gradient') return 'gradient_mesh';
  if (p === 'grid' || p === 'cyber_grid') return 'grid_flow';
  if (p === 'wave' || p === 'wave_flow') return 'waves';
  if (p === 'dot' || p === 'matrix') return 'dots';
  if (p === 'print' || p === 'cad') return 'blueprint';
  if (p === 'vignette' || p === 'spotlight') return 'vignette_loop';
  if (p === 'paper' || p === 'grain' || p === 'parchment') return 'paper_grain';
  if (
    p === 'gradient_mesh' ||
    p === 'grid_flow' ||
    p === 'waves' ||
    p === 'dots' ||
    p === 'blueprint' ||
    p === 'vignette_loop' ||
    p === 'paper_grain'
  ) {
    return p as BackgroundPreset;
  }
  return 'gradient_mesh';
}

export const BackgroundRenderer: React.FC<BackgroundRendererProps> = ({
  preset = 'gradient_mesh',
  colors,
  speed = 1.0,
  style,
}) => {
  const frame = useCurrentFrame();
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  const activePreset = normalizePreset(preset);

  // Defensively guard speed against null/undefined/NaN to prevent canvas math poisoning
  const safeSpeed =
    typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1.0;
  const effectiveFrame = frame * safeSpeed;

  // Default color palettes per preset if not provided
  const palette = React.useMemo(() => {
    if (colors && colors.length > 0) return colors;
    switch (activePreset) {
      case 'grid_flow':
        return ['#050811', '#0ea5e9', '#6366f1'];
      case 'waves':
        return ['#030712', '#0284c7', '#38bdf8'];
      case 'dots':
        return ['#090d16', '#38bdf8', '#818cf8'];
      case 'blueprint':
        return ['#041527', '#0284c7', '#38bdf8'];
      case 'vignette_loop':
        return ['#09090b', '#18181b', '#27272a'];
      case 'paper_grain':
        return ['#1c1917', '#292524', '#f5ebd7'];
      case 'gradient_mesh':
      default:
        return ['#0a0e17', '#0369a1', '#4338ca'];
    }
  }, [colors, activePreset]);

  const c1 = palette[0] || '#0a0e17';
  const c2 = palette[1] || '#0284c7';
  const c3 = palette[2] || '#6366f1';

  // 1. GRADIENT MESH
  if (activePreset === 'gradient_mesh') {
    const pulse = interpolate(effectiveFrame % 180, [0, 90, 180], [0.25, 0.45, 0.25]);
    const driftX1 = Math.sin((effectiveFrame / 60) * Math.PI * 0.5) * 15;
    const driftY1 = Math.cos((effectiveFrame / 70) * Math.PI * 0.5) * 12;
    const driftX2 = Math.cos((effectiveFrame / 80) * Math.PI * 0.5) * 18;
    const driftY2 = Math.sin((effectiveFrame / 65) * Math.PI * 0.5) * 14;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          backgroundImage: `
            radial-gradient(circle at ${35 + driftX1}% ${30 + driftY1}%, ${c2} 0%, transparent ${50 + pulse * 20}%),
            radial-gradient(circle at ${75 + driftX2}% ${70 + driftY2}%, ${c3} 0%, transparent ${45 + pulse * 20}%),
            radial-gradient(circle at 50% 50%, rgba(0,0,0,0.4) 0%, transparent 100%)
          `,
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, transparent 30%, rgba(0, 0, 0, 0.8) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  }

  // 2. GRID FLOW (3D Perspective / Cyber Grid)
  if (activePreset === 'grid_flow') {
    const offset = (effectiveFrame * 2.5) % 80;
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          position: 'relative',
          overflow: 'hidden',
          perspective: '600px',
          ...style,
        }}
      >
        {/* Horizon glow */}
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '10%',
            width: '80%',
            height: '20%',
            background: `radial-gradient(ellipse at center, ${withAlpha(c2, '88')} 0%, transparent 70%)`,
            filter: 'blur(20px)',
          }}
        />
        {/* Top subtle grid */}
        <div
          style={{
            position: 'absolute',
            inset: '0 0 50% 0',
            backgroundImage: `linear-gradient(${withAlpha(c2, '15')} 1px, transparent 1px), linear-gradient(90deg, ${withAlpha(c2, '15')} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            maskImage: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
          }}
        />
        {/* Flowing floor grid */}
        <div
          style={{
            position: 'absolute',
            left: '-20%',
            width: '140%',
            top: '48%',
            height: '100%',
            backgroundImage: `
              linear-gradient(${withAlpha(c2, '40')} 1px, transparent 1px),
              linear-gradient(90deg, ${withAlpha(c3, '30')} 1px, transparent 1px)
            `,
            backgroundSize: `80px 80px`,
            backgroundPosition: `0px ${offset}px`,
            transform: 'rotateX(68deg)',
            transformOrigin: 'top center',
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, transparent 85%)',
          }}
        />
      </div>
    );
  }

  // 3. WAVES (Undulating Sinusoidal Flow)
  if (activePreset === 'waves') {
    const phase1 = (effectiveFrame * 0.04) % (Math.PI * 2);
    const phase2 = (effectiveFrame * 0.06) % (Math.PI * 2);

    const gradId1 = `waveGrad1_${safeId}`;
    const gradId2 = `waveGrad2_${safeId}`;

    const generateWavePath = (phase: number, amplitude: number, yOffset: number) => {
      let d = `M 0 ${yOffset}`;
      for (let x = 0; x <= 1920; x += 120) {
        const y = yOffset + Math.sin(x * 0.003 + phase) * amplitude;
        d += ` L ${x} ${y.toFixed(1)}`;
      }
      d += ` L 1920 1080 L 0 1080 Z`;
      return d;
    };

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
      >
        <svg
          viewBox="0 0 1920 1080"
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId1} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c3} stopOpacity="0.35" />
              <stop offset="100%" stopColor={c1} stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id={gradId2} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c2} stopOpacity="0.45" />
              <stop offset="100%" stopColor={c1} stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path d={generateWavePath(phase1, 45, 650)} fill={`url(#${gradId1})`} />
          <path d={generateWavePath(phase2, 60, 720)} fill={`url(#${gradId2})`} />
        </svg>
      </div>
    );
  }

  // 4. DOTS (Scanning Sonar / Matrix Pulse)
  if (activePreset === 'dots') {
    const pulseRadius = (effectiveFrame * 5) % 1200;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
      >
        {/* Base Dot Matrix */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `radial-gradient(${withAlpha(c2, '40')} 1.5px, transparent 1.5px)`,
            backgroundSize: '32px 32px',
          }}
        />
        {/* Expanding Pulse Ring */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `${pulseRadius * 2}px`,
            height: `${pulseRadius * 2}px`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `2px solid ${withAlpha(c2, '80')}`,
            boxShadow: `0 0 30px ${withAlpha(c2, '50')}, inset 0 0 30px ${withAlpha(c2, '30')}`,
            opacity: interpolate(pulseRadius, [0, 900, 1200], [0.8, 0.4, 0]),
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  }

  // 5. BLUEPRINT (Technical CAD Architecture with Kinetic Grid Drift)
  if (activePreset === 'blueprint') {
    const majorShift = (effectiveFrame * 0.4) % 120;
    const minorShift = (effectiveFrame * 0.4) % 24;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          backgroundImage: `
            linear-gradient(${withAlpha(c2, '30')} 1px, transparent 1px),
            linear-gradient(90deg, ${withAlpha(c2, '30')} 1px, transparent 1px),
            linear-gradient(${withAlpha(c2, '12')} 1px, transparent 1px),
            linear-gradient(90deg, ${withAlpha(c2, '12')} 1px, transparent 1px)
          `,
          backgroundSize: '120px 120px, 120px 120px, 24px 24px, 24px 24px',
          backgroundPosition: `${majorShift}px ${majorShift}px, ${majorShift}px ${majorShift}px, ${minorShift}px ${minorShift}px, ${minorShift}px ${minorShift}px`,
          position: 'relative',
          overflow: 'hidden',
          ...style,
        }}
      >
        {/* Corner Registration Crosshairs */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 1920 1080"
        >
          {/* Top Left */}
          <path d="M 60 40 L 60 80 M 40 60 L 80 60" stroke={c3} strokeWidth="2" opacity="0.6" />
          {/* Top Right */}
          <path d="M 1860 40 L 1860 80 M 1840 60 L 1880 60" stroke={c3} strokeWidth="2" opacity="0.6" />
          {/* Bottom Left */}
          <path d="M 60 1000 L 60 1040 M 40 1020 L 80 1020" stroke={c3} strokeWidth="2" opacity="0.6" />
          {/* Bottom Right */}
          <path d="M 1860 1000 L 1860 1040 M 1840 1020 L 1880 1020" stroke={c3} strokeWidth="2" opacity="0.6" />
          {/* Center Coordinates */}
          <circle cx="960" cy="540" r="4" fill={c2} opacity="0.5" />
          <line x1="940" y1="540" x2="980" y2="540" stroke={c2} strokeWidth="1" opacity="0.4" />
          <line x1="960" y1="520" x2="960" y2="560" stroke={c2} strokeWidth="1" opacity="0.4" />
        </svg>
      </div>
    );
  }

  // 6. VIGNETTE LOOP (Cinematic Atmosphere Focus)
  if (activePreset === 'vignette_loop') {
    const breathe = interpolate(effectiveFrame % 150, [0, 75, 150], [0.75, 0.95, 0.75]);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          backgroundImage: `
            radial-gradient(ellipse at 50% 45%, ${c2} 0%, transparent 65%),
            radial-gradient(circle at 50% 50%, transparent 40%, #000000 100%)
          `,
          position: 'relative',
          overflow: 'hidden',
          ...style,
          opacity: (style?.opacity as number | undefined) !== undefined ? style?.opacity : breathe,
        }}
      />
    );
  }

  // 7. PAPER GRAIN (Archival Vintage Texture with Film Grain Jitter)
  if (activePreset === 'paper_grain') {
    const jitterX = Math.round((effectiveFrame * 7) % 8);
    const jitterY = Math.round((effectiveFrame * 11) % 8);
    const breathe = interpolate(effectiveFrame % 120, [0, 60, 120], [0.95, 1.0, 0.95]);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: c1,
          backgroundImage: `
            radial-gradient(circle at center, rgba(245, 235, 215, 0.08) 0%, rgba(10, 10, 10, 0.85) 100%),
            linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 8px 8px',
          backgroundPosition: `0 0, ${jitterX}px ${jitterY}px`,
          boxShadow: 'inset 0 0 100px rgba(0,0,0,0.9)',
          position: 'relative',
          overflow: 'hidden',
          ...style,
          opacity: (style?.opacity as number | undefined) !== undefined ? style?.opacity : breathe,
        }}
      />
    );
  }

  return <div style={{ width: '100%', height: '100%', backgroundColor: c1, ...style }} />;
};
