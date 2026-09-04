import React, { useEffect, useRef } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export type ParticlePreset =
  | 'confetti'
  | 'embers'
  | 'dust'
  | 'money_rain'
  | 'snow'
  | 'stars';

export interface ParticlesRendererProps {
  preset?: ParticlePreset;
  /** Particle count (10–300). */
  count?: number;
  /** Override palette (hex). Defaults to the preset palette. */
  colors?: string[];
  /** Particle size range in px at 1080p. */
  size?: [number, number];
  /** Global speed multiplier. */
  speed?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'outward' | 'twinkle';
  opacity?: number;
  style?: React.CSSProperties;
}

interface PresetDefaults {
  colors: string[];
  count: number;
  size: [number, number];
  speed: number;
  direction: NonNullable<ParticlesRendererProps['direction']>;
  shape: 'rect' | 'circle';
  glow: boolean;
}

export const PARTICLE_PRESETS: Record<ParticlePreset, PresetDefaults> = {
  confetti: {
    colors: ['#ff477e', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f1fa8c'],
    count: 120, size: [8, 18], speed: 1, direction: 'down', shape: 'rect', glow: false,
  },
  embers: {
    colors: ['#ffdd66', '#ff9933', '#ff5511', '#ffcc00'],
    count: 70, size: [3, 9], speed: 1, direction: 'up', shape: 'circle', glow: true,
  },
  dust: {
    colors: ['#ffffff', '#e8e8f0'],
    count: 60, size: [2, 6], speed: 0.35, direction: 'right', shape: 'circle', glow: false,
  },
  money_rain: {
    colors: ['#22c55e', '#4ade80', '#86efac', '#facc15'],
    count: 90, size: [14, 26], speed: 1.1, direction: 'down', shape: 'rect', glow: false,
  },
  snow: {
    colors: ['#ffffff', '#dbeafe'],
    count: 150, size: [3, 10], speed: 0.8, direction: 'down', shape: 'circle', glow: false,
  },
  stars: {
    colors: ['#ffffff', '#bfdbfe', '#fef9c3'],
    count: 120, size: [2, 6], speed: 0.5, direction: 'twinkle', shape: 'circle', glow: true,
  },
};

/** Deterministic PRNG — particle fields must be a pure function of (index)
 * so preview scrubbing and headless export render identical frames. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const LOOP_FRAMES = 240;

export const ParticlesRenderer: React.FC<ParticlesRendererProps> = ({
  preset = 'confetti',
  count,
  colors,
  size,
  speed,
  direction,
  opacity = 0.9,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const def = PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.confetti;
  const n = Math.max(0, Math.min(300, Math.round(count ?? def.count)));
  const palette = colors && colors.length > 0 ? colors : def.colors;
  const [sizeMin, sizeMax] = size ?? def.size;
  const spd = (speed ?? 1) * def.speed;
  const dir = direction ?? def.direction;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (n === 0) return;

    const margin = 60;
    if (def.glow) ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < n; i++) {
      const rng = mulberry32(i * 7919 + 13);
      const x0 = rng() * W;
      const y0 = rng() * H;
      const sz = sizeMin + rng() * Math.max(0, sizeMax - sizeMin);
      const color = palette[Math.floor(rng() * palette.length) % palette.length];
      const speedVar = 0.6 + rng() * 0.8;
      const phase = rng();
      const swayAmp = 20 + rng() * 60;
      const swayFreq = 0.5 + rng() * 1.5;
      const rotSpeed = (rng() - 0.5) * 0.25;

      const p = (((frame * spd * speedVar) / 2 + phase * LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
      const envelope = Math.sin(p * Math.PI); // fade in/out across the loop
      let x = x0;
      let y = y0;
      let alpha = opacity * (0.35 + 0.65 * envelope);

      if (dir === 'down') {
        y = (y0 + p * (H + margin * 2)) % (H + margin * 2) - margin;
        x = x0 + Math.sin((p * swayFreq + phase) * TAU) * swayAmp;
      } else if (dir === 'up') {
        y = (y0 - p * (H + margin * 2)) % (H + margin * 2);
        if (y < -margin) y += H + margin * 2;
        x = x0 + Math.sin((p * swayFreq + phase) * TAU) * swayAmp;
      } else if (dir === 'left') {
        x = (x0 - p * (W + margin * 2)) % (W + margin * 2);
        if (x < -margin) x += W + margin * 2;
        y = y0 + Math.sin((p * swayFreq + phase) * TAU) * (swayAmp * 0.5);
      } else if (dir === 'right') {
        x = (x0 + p * (W + margin * 2)) % (W + margin * 2) - margin;
        y = y0 + Math.sin((p * swayFreq + phase) * TAU) * (swayAmp * 0.5);
      } else if (dir === 'outward') {
        const ang = phase * TAU;
        const r = p * Math.max(W, H) * 0.6;
        x = W / 2 + Math.cos(ang) * r;
        y = H / 2 + Math.sin(ang) * r;
        alpha = opacity * (1 - p);
      } else {
        // twinkle — fixed starfield, oscillating alpha
        alpha = opacity * (0.25 + 0.75 * Math.abs(Math.sin((frame * spd * 0.05 + phase * 4) * Math.PI)));
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = color;
      if (def.shape === 'rect') {
        const w = sz;
        const h = sz * (0.45 + (i % 5) * 0.12);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(phase * TAU + frame * rotSpeed * 0.1);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, sz / 2), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }, [frame, W, H, n, palette, sizeMin, sizeMax, spd, dir, opacity, def.glow, def.shape]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: '100%', height: '100%', pointerEvents: 'none', ...style }}
    />
  );
};
