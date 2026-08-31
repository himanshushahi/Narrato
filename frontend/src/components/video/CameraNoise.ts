import { noise2D } from '@remotion/noise';

export type CameraShakeType = 'none' | 'handheld' | 'shockwave' | 'glitch';

export interface CameraOffset {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Computes deterministic 2D camera shake / handheld motion offsets using Remotion's Perlin noise generator.
 */
export function getCameraNoise(
  frame: number,
  type: CameraShakeType = 'none',
  seed: string = 'cam_seed'
): CameraOffset {
  if (!type || type === 'none') {
    return { x: 0, y: 0, rotation: 0 };
  }

  if (type === 'handheld') {
    // Subtle, organic documentary handheld camera drift
    const freq = 0.035;
    const amp = 4.5;
    const x = noise2D(`${seed}_x`, frame * freq, 0) * amp;
    const y = noise2D(`${seed}_y`, 0, frame * freq) * amp;
    const rotation = noise2D(`${seed}_rot`, frame * (freq * 0.7), 1) * 0.4;
    return { x, y, rotation };
  }

  if (type === 'shockwave') {
    // High-impact decaying earthquake / impact shake (first 30 frames)
    const decay = Math.max(0, 1 - frame / 30);
    if (decay <= 0) return { x: 0, y: 0, rotation: 0 };

    const freq = 0.45;
    const amp = 24 * decay;
    const x = noise2D(`${seed}_shock_x`, frame * freq, 0) * amp;
    const y = noise2D(`${seed}_shock_y`, 0, frame * freq) * amp;
    const rotation = noise2D(`${seed}_shock_rot`, frame * freq, 2) * (amp * 0.08);
    return { x, y, rotation };
  }

  if (type === 'glitch') {
    // Rapid digital jitter / stutter
    const freq = 0.8;
    const intFrame = Math.floor(frame);
    const amp = (intFrame % 8 < 3) ? 12 : 1;
    const x = noise2D(`${seed}_glitch_x`, frame * freq, 0) * amp;
    const y = noise2D(`${seed}_glitch_y`, 0, frame * freq) * (amp * 0.5);
    const rotation = (intFrame % 6 === 0) ? (noise2D(`${seed}_glitch_r`, frame, 0) * 1.5) : 0;
    return { x, y, rotation };
  }

  return { x: 0, y: 0, rotation: 0 };
}
