import React, { useMemo } from 'react';
import { Img, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

// ─── easing helper ──────────────────────────────────────────────
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ─── Props ───────────────────────────────────────────────────────
interface ParallaxMeta {
  /** Overall parallax intensity 0–100 (default 70) */
  strength?: number;
  /** Camera path preset: 'ken-burns' | 'dolly' | 'orbit' | 'crane' | 'float' */
  camera_path?: string;
  /** Background zoom range (e.g. 1.0–1.3, default 1.1–1.25) */
  bg_zoom_min?: number;
  bg_zoom_max?: number;
  /** Foreground zoom range (e.g. 1.0–1.5, default 1.0–1.25) */
  fg_zoom_min?: number;
  fg_zoom_max?: number;
  /** Background blur in px (default 3) */
  bg_blur?: number;
  /** Horizontal drift in px (default 30) */
  drift_x?: number;
  /** Vertical drift in px (default 15) */
  drift_y?: number;
  /** Y-axis rotation range in degrees (default 3) */
  rotate_y?: number;
  /** Z-translation depth separation in px (default 80) */
  depth_z?: number;
  /** Foreground brightness adjustment (default 1.0) */
  fg_brightness?: number;
}

interface Props {
  backgroundUrl: string;
  foregroundUrl?: string;
  meta?: ParallaxMeta;
  /** Visual cue / search text — currently unused by render, but passed through for data completeness */
  cue?: string;
  durationInFrames: number;
}

// ─── defaults ────────────────────────────────────────────────────
const DEFAULTS: Required<ParallaxMeta> = {
  strength: 70,
  camera_path: 'orbit',
  bg_zoom_min: 1.1,
  bg_zoom_max: 1.25,
  fg_zoom_min: 1.0,
  fg_zoom_max: 1.25,
  bg_blur: 1,
  drift_x: 30,
  drift_y: 15,
  rotate_y: 3,
  depth_z: 80,
  fg_brightness: 1.0,
};

// ─── Component ───────────────────────────────────────────────────
export const ParallaxImage: React.FC<Props> = ({
  backgroundUrl,
  foregroundUrl,
  meta: rawMeta,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Merge with defaults
  const m = useMemo<Required<ParallaxMeta>>(() => {
    const r = rawMeta ?? {};
    return {
      strength: r.strength ?? DEFAULTS.strength,
      camera_path: r.camera_path ?? DEFAULTS.camera_path,
      bg_zoom_min: r.bg_zoom_min ?? DEFAULTS.bg_zoom_min,
      bg_zoom_max: r.bg_zoom_max ?? DEFAULTS.bg_zoom_max,
      fg_zoom_min: r.fg_zoom_min ?? DEFAULTS.fg_zoom_min,
      fg_zoom_max: r.fg_zoom_max ?? DEFAULTS.fg_zoom_max,
      bg_blur: r.bg_blur ?? DEFAULTS.bg_blur,
      drift_x: r.drift_x ?? DEFAULTS.drift_x,
      drift_y: r.drift_y ?? DEFAULTS.drift_y,
      rotate_y: r.rotate_y ?? DEFAULTS.rotate_y,
      depth_z: r.depth_z ?? DEFAULTS.depth_z,
      fg_brightness: r.fg_brightness ?? DEFAULTS.fg_brightness,
    };
  }, [rawMeta]);

  const str = m.strength / 100; // 0–1 normalised

  // ── smooth normalised progress (eased) ───────────────────
  const rawProgress = durationInFrames > 1
    ? frame / (durationInFrames - 1)
    : 0;
  const easedProgress = easeInOutCubic(Math.min(rawProgress, 1));

  // ── spring for entrance bounce (first 20 frames) ─────────
  const entranceBounce = spring({
    frame: Math.min(frame, 20),
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.6 },
  });

  // ── per‑preset paths ────────────────────────────────────
  const preset = m.camera_path;

  const calcTransform = (layer: 'bg' | 'mg' | 'fg') => {
    const isBg = layer === 'bg';
    const isMg = layer === 'mg';
    const isFg = layer === 'fg';

    // Depth factor: bg=0.0, mg=0.5, fg=1.0
    const depth = isBg ? 0 : isMg ? 0.5 : 1.0;

    // Scale — bg scales UP (moves into frame), fg scales less or stays
    const scaleMin = isBg ? m.bg_zoom_min : m.fg_zoom_min;
    const scaleMax = isBg ? m.bg_zoom_max : m.fg_zoom_max;
    const scaleRange = (scaleMax - scaleMin) * (1 - depth * 0.3);
    const scale = interpolate(
      easedProgress,
      [0, 1],
      [scaleMin, scaleMin + scaleRange],
      { extrapolateRight: 'clamp' },
    );

    // ── camera path ────────────────────────────
    let x = 0;
    let y = 0;
    let rotY = 0;
    const dX = m.drift_x * str;
    const dY = m.drift_y * str;

    if (preset === 'ken-burns') {
      // Classic slow pan from one side to the other
      x = interpolate(easedProgress, [0, 1], [-dX, dX], { extrapolateRight: 'clamp' });
      y = interpolate(easedProgress, [0, 1], [-dY * 0.5, dY * 0.5], { extrapolateRight: 'clamp' });
      rotY = interpolate(easedProgress, [0, 1], [-1, 1], { extrapolateRight: 'clamp' }) * m.rotate_y * 0.3;
    } else if (preset === 'dolly') {
      // Push inward — mostly scale, slight drift
      x = Math.sin(rawProgress * Math.PI * 0.8) * dX * 0.3;
      y = Math.cos(rawProgress * Math.PI * 0.6) * dY * 0.3;
      rotY = 0;
    } else if (preset === 'orbit') {
      // Circular orbital path around subject
      x = Math.sin(rawProgress * Math.PI * 2) * dX * (0.5 + depth * 0.5);
      y = Math.cos(rawProgress * Math.PI * 2) * dY * (0.5 + depth * 0.3);
      rotY = Math.sin(rawProgress * Math.PI * 2) * m.rotate_y * (0.3 + depth * 0.7);
    } else if (preset === 'crane') {
      // Ascending camera — moves up, tilts down
      x = Math.sin(rawProgress * Math.PI) * dX * 0.4;
      y = interpolate(easedProgress, [0, 1], [dY * 0.5, -dY], { extrapolateRight: 'clamp' });
      rotY = interpolate(easedProgress, [0, 1], [1, -2], { extrapolateRight: 'clamp' }) * m.rotate_y * 0.4;
    } else {
      // 'float' — gentle sine wave drift
      const phase = isFg ? Math.PI * 0.5 : 0;
      const amp = 0.4 + depth * 0.6;
      x = Math.sin(rawProgress * Math.PI * 1.5 + phase) * dX * amp;
      y = Math.cos(rawProgress * Math.PI * 1.2 + phase) * dY * amp * 0.6;
      rotY = Math.sin(rawProgress * Math.PI * 1.2 + phase) * m.rotate_y * amp;
    }

    // Foreground + midground get amplified movement for stronger parallax
    const ampMul = isBg ? 1 : isMg ? 1.07 : 1.15;

    return {
      scale: scale * (0.98 + entranceBounce * 0.02),
      x: x * ampMul,
      y: y * ampMul,
      rotY: rotY * ampMul,
    };
  };

  const bg = calcTransform('bg');
  const fg = foregroundUrl ? calcTransform('fg') : null;
  const mg = foregroundUrl ? calcTransform('mg') : null;

  // ── fallback ──────────────────────────────────────────────
  if (!backgroundUrl) {
    return (
      <div style={{
        width: '100%', height: '100%',
        backgroundColor: '#141414',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
      }}>
        <div style={{ color: '#fff' }}>Missing Image for Parallax</div>
      </div>
    );
  }

  // ── inline style helpers ─────────────────────────────────
  const imgStyle = (
    transform: { scale: number; x: number; y: number; rotY: number },
    zIndex: number,
    depthZ: number,
    extra: React.CSSProperties = {},
  ): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    transform: `
      scale(${transform.scale.toFixed(3)})
      translate3d(${transform.x.toFixed(1)}px, ${transform.y.toFixed(1)}px, ${depthZ}px)
      rotateY(${transform.rotY.toFixed(1)}deg)
    `,
    willChange: 'transform',
    transformOrigin: 'center center',
    zIndex,
    ...extra,
  });

  return (
    <div style={{
      width: '100%', height: '100%',
      overflow: 'hidden', position: 'relative',
      perspective: '1200px',
    }}>
      {/* ── 1. Background layer ──────────────────────────────── */}
      <Img
        src={backgroundUrl}
        style={imgStyle(bg, 0, 0, {
          filter: `blur(${m.bg_blur}px) brightness(${foregroundUrl ? 0.7 : 1})`,
        })}
      />

      {/* ── 2. Midground — only when a foreground exists ────── */}
      {mg && foregroundUrl && (
        <Img
          src={backgroundUrl}
          style={imgStyle(mg, 5, m.depth_z * 0.5, {
            filter: `blur(${m.bg_blur * 0.3}px) brightness(0.85)`,
            opacity: 0.6,
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 80%)',
          })}
        />
      )}

      {/* ── 3. Foreground subject (cutout) ──────────────────── */}
      {fg && foregroundUrl && (
        <Img
          src={foregroundUrl}
          style={imgStyle(fg, 10, m.depth_z, {
            objectFit: 'contain',
            filter: `
              brightness(${m.fg_brightness})
              drop-shadow(0px 20px 40px rgba(0,0,0,0.7))
            `,
          })}
        />
      )}

      {/* ── 4. Vignette overlay ─────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 20,
        boxShadow: 'inset 0 0 150px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
      }} />

      {/* ── 5. Subtle grain texture overlay for depth ────────── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 21,
        opacity: 0.06,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        backgroundSize: '256px 256px',
        pointerEvents: 'none',
        mixBlendMode: 'overlay',
      }} />
    </div>
  );
};