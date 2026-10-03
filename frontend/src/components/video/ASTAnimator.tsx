import React, { useEffect, useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing, getRemotionEnvironment } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { getCameraNoise, CameraShakeType } from './CameraNoise';
import { hasSpatialMotion, SPATIAL_ANIMATION_PROPS } from './spatialMotion';
import {
  QualityMode,
  QualityPolicy,
  parseQuality,
  getMotionBlurSamples,
  shouldBypassSettledBlur,
  MOTION_BLUR_SETTLE_GRACE_FRAMES,
} from './renderQuality';

export type ASTAnimationEasing =
  | 'linear'
  | 'spring'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'bounce'
  | 'elastic'
  | 'back'
  | 'steps'
  | 'bezier';

export type ASTAnimationLoopMode = 'none' | 'loop' | 'pingpong';

export type ASTMaskShape = 'none' | 'circle' | 'ellipse' | 'inset' | 'polygon';

export type ASTMaskReveal =
  | 'none'
  | 'circle_iris'
  | 'wipe_right'
  | 'wipe_down'
  | 'split_vertical'
  | 'wipe_diagonal';

export type ASTPolygonPreset =
  | 'hexagon'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'slant_left'
  | 'slant_right'
  | 'custom';

export interface ASTLayerMask {
  shape?: ASTMaskShape;
  size?: number | string;
  rx?: number | string;
  ry?: number | string;
  x?: number | string;
  y?: number | string;
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  corner_radius?: number | string;
  polygon_preset?: ASTPolygonPreset;
  points?: string;
  reveal?: ASTMaskReveal;
  reveal_duration?: number;
  reveal_delay?: number;
  reveal_easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bounce';
  inverted?: boolean;
}

export interface ASTAnimation {
  property: 'scale' | 'opacity' | 'translateX' | 'translateY' | 'translateZ' | 'rotate' | 'rotateX' | 'rotateY' | 'blur' | 'brightness';
  from: number;
  /** Backend pydantic schema serializes the `from` alias as `from_` — accept both. */
  from_?: number;
  to: number;
  duration: number; // in seconds
  delay?: number; // in seconds (optional)
  easing: ASTAnimationEasing;
  exit?: boolean; // If true, treats this animation as an exit animation: skips until its delay, and layer unmounts when complete

  // Spring physics parameters (when easing === 'spring')
  damping?: number;
  stiffness?: number;
  mass?: number;
  overshoot_clamping?: boolean;
  overshootClamping?: boolean;

  // Easing curve parameters
  elastic_bounciness?: number;
  back_overshoot?: number;
  steps_count?: number;
  bezier_points?: [number, number, number, number];

  // Continuous motion mode
  loop_mode?: ASTAnimationLoopMode;
}

export interface ASTAnimatorProps {
  animations?: ASTAnimation[];
  exit?: boolean | number;
  motion_blur?: boolean;
  shutter_angle?: number;
  camera_shake?: CameraShakeType;
  transform_origin?: string;
  floating?: boolean;
  mask?: ASTLayerMask;
  perspective?: number | string;
  perspective_origin?: string;
  /** 'preview' (Player) uses fewer samples; defaults to auto-detect. */
  qualityMode?: QualityMode;
  /** User policy from Settings → Rendering Engine (defaults to balanced). */
  quality?: QualityPolicy | unknown;
  children: React.ReactNode;
}

interface AnimatedLayerProps {
  animations?: ASTAnimation[];
  exit?: boolean | number;
  camera_shake?: CameraShakeType;
  transform_origin?: string;
  floating?: boolean;
  mask?: ASTLayerMask;
  perspective?: number | string;
  perspective_origin?: string;
  children: React.ReactNode;
}

function evaluateAnimationProgress(
  anim: ASTAnimation,
  startVal: number,
  targetVal: number,
  localFrame: number,
  durationFrames: number,
  fps: number
): number {
  if (anim.easing === 'spring') {
    const damping = typeof anim.damping === 'number' && anim.damping > 0 ? anim.damping : 14;
    const stiffness = typeof anim.stiffness === 'number' && anim.stiffness > 0 ? anim.stiffness : 100;
    const mass = typeof anim.mass === 'number' && anim.mass > 0 ? anim.mass : 0.9;
    const overshootClamping = !!(anim.overshoot_clamping ?? anim.overshootClamping);

    const spr = spring({
      frame: localFrame,
      fps,
      config: { damping, stiffness, mass, overshootClamping },
      durationInFrames: durationFrames,
    });
    return startVal + (targetVal - startVal) * spr;
  }

  let easingFn = Easing.linear;
  if (anim.easing === 'ease-in') {
    easingFn = Easing.ease;
  } else if (anim.easing === 'ease-out') {
    easingFn = Easing.out(Easing.ease);
  } else if (anim.easing === 'ease-in-out') {
    easingFn = Easing.inOut(Easing.ease);
  } else if (anim.easing === 'bounce') {
    easingFn = Easing.bounce;
  } else if (anim.easing === 'elastic') {
    const bounciness = typeof anim.elastic_bounciness === 'number' && anim.elastic_bounciness > 0 ? anim.elastic_bounciness : 1.0;
    easingFn = Easing.elastic(bounciness);
  } else if (anim.easing === 'back') {
    // Default 1.7 matches the editor + backend schema default (Remotion's
    // own default is 1.70158 — the difference is imperceptible, and this
    // keeps displayed value === applied value).
    const overshoot = typeof anim.back_overshoot === 'number' && Number.isFinite(anim.back_overshoot) && anim.back_overshoot >= 0 ? anim.back_overshoot : 1.7;
    easingFn = Easing.back(overshoot);
  } else if (anim.easing === 'steps') {
    const steps = typeof anim.steps_count === 'number' && anim.steps_count > 0 ? Math.round(anim.steps_count) : 5;
    easingFn = (t: number) => (t >= 1 ? 1 : Math.floor(t * steps) / steps);
  } else if (anim.easing === 'bezier') {
    // Remotion throws when x1/x2 fall outside [0, 1] — sanitize here so a
    // bad authoring value degrades to a clamped curve instead of breaking
    // the whole layer at export. y values are intentionally unbounded.
    // Wrong-length shapes fall back to the default curve.
    const raw = anim.bezier_points;
    let pts: [number, number, number, number] = [0.16, 1.0, 0.3, 1.0];
    if (Array.isArray(raw) && raw.length === 4 && raw.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const clampX = (v: number) => Math.min(1, Math.max(0, v));
      pts = [clampX(raw[0]), raw[1], clampX(raw[2]), raw[3]];
    }
    easingFn = Easing.bezier(pts[0], pts[1], pts[2], pts[3]);
  }

  return interpolate(localFrame, [0, durationFrames], [startVal, targetVal], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
    easing: easingFn,
  });
}

function formatMaskUnit(val: number | string | undefined, defaultUnit = '%'): string {
  if (val === undefined || val === null || val === '') return `50${defaultUnit}`;
  if (typeof val === 'number') return `${val}${defaultUnit}`;
  const s = String(val).trim();
  if (/^-?[\d.]+$/.test(s)) return `${s}${defaultUnit}`;
  return s;
}

/** True when a mask config produces any clipping (static shape or reveal). */
export function hasMask(mask: ASTLayerMask | undefined | null): boolean {
  if (!mask) return false;
  if (mask.shape && mask.shape !== 'none') return true;
  return !!(mask.reveal && mask.reveal !== 'none');
}

/** True ONLY when a mask requires frame-dependent reveal animation. */
export function hasAnimatedReveal(mask: ASTLayerMask | undefined | null): boolean {
  if (!mask) return false;
  return !!(mask.reveal && mask.reveal !== 'none');
}

export function computeClipPath(
  mask: ASTLayerMask | undefined,
  frame: number,
  fps: number
): string | undefined {
  // Reveal-first combined clip (single-clip consumers such as the canvas
  // overlay echo). The animated layer itself nests shape + reveal clips so
  // a reveal animates INTO the static shape instead of discarding it.
  return computeRevealClip(mask, frame, fps) ?? computeStaticShapeClip(mask);
}

/** Animated reveal portion of a mask (frame-dependent). */
export function computeRevealClip(
  mask: ASTLayerMask | undefined,
  frame: number,
  fps: number
): string | undefined {
  if (!mask || !mask.reveal || mask.reveal === 'none') return undefined;
  const duration = typeof mask.reveal_duration === 'number' && mask.reveal_duration > 0
    ? mask.reveal_duration
    : 0.8;
  const delay = typeof mask.reveal_delay === 'number' && mask.reveal_delay >= 0
    ? mask.reveal_delay
    : 0;
  const delayFrames = Math.max(0, Math.round(delay * fps));
  const durationFrames = Math.max(1, Math.round(duration * fps));
  const localFrame = frame - delayFrames;

  let t = 0;
  if (localFrame <= 0) {
    if (mask.inverted) return undefined;
    t = 0;
  } else if (localFrame >= durationFrames) {
    // Reveal has converged to 100% visibility — drop clip-path so the GPU
    // skips clipping shaders and React skips per-frame element cloning.
    if (!mask.inverted) return undefined;
    t = 1;
  } else {
    const rawT = localFrame / durationFrames;
    const easing = mask.reveal_easing || 'ease-out';
    if (easing === 'ease-in') {
      t = Easing.in(Easing.quad)(rawT);
    } else if (easing === 'ease-out') {
      t = Easing.out(Easing.quad)(rawT);
    } else if (easing === 'ease-in-out') {
      t = Easing.inOut(Easing.quad)(rawT);
      // NOTE: no 'spring' — overshoot past "fully revealed" is invisible
      // for a reveal (and negative insets would paint outside the box),
      // so spring is rejected at the schema/editor level. Unknown values
      // (incl. legacy 'spring') fall through to linear below.
    } else if (easing === 'bounce') {
      t = Easing.bounce(rawT);
    } else {
      t = rawT;
    }
  }

  t = Math.max(0, Math.min(1, t));
  if (mask.inverted) {
    t = 1 - t;
  }

  const cx = formatMaskUnit(mask.x, '%');
  const cy = formatMaskUnit(mask.y, '%');

  switch (mask.reveal) {
    case 'circle_iris': {
      const radius = (t * 75 * Math.SQRT2).toFixed(2);
      return `circle(${radius}% at ${cx} ${cy})`;
    }
    case 'wipe_right': {
      const rightInset = ((1 - t) * 100).toFixed(2);
      return `inset(0% ${rightInset}% 0% 0%)`;
    }
    case 'wipe_down': {
      const bottomInset = ((1 - t) * 100).toFixed(2);
      return `inset(0% 0% ${bottomInset}% 0%)`;
    }
    case 'split_vertical': {
      // Center-out curtain: the split line is vertical, halves part left/right.
      const sideInset = ((1 - t) * 50).toFixed(2);
      return `inset(0% ${sideInset}% 0% ${sideInset}%)`;
    }
    case 'wipe_diagonal': {
      // True corner-to-corner diagonal: triangle growing from the top-left
      // corner. Legs reach 200% so the corner (100%,100%) is covered at t=1
      // on any aspect ratio (x/200 + y/200 = 1 on the hypotenuse).
      const leg = (t * 200).toFixed(2);
      return `polygon(0% 0%, ${leg}% 0%, 0% ${leg}%)`;
    }
    default:
      return undefined;
  }
}

/** Static shape portion of a mask (frame-independent). */
export function computeStaticShapeClip(
  mask: ASTLayerMask | undefined
): string | undefined {
  if (!mask || !mask.shape || mask.shape === 'none') return undefined;
  switch (mask.shape) {
    case 'circle': {
      const size = formatMaskUnit(mask.size ?? 50, '%');
      const cx = formatMaskUnit(mask.x ?? 50, '%');
      const cy = formatMaskUnit(mask.y ?? 50, '%');
      return `circle(${size} at ${cx} ${cy})`;
    }
    case 'ellipse': {
      const rx = formatMaskUnit(mask.rx ?? 50, '%');
      const ry = formatMaskUnit(mask.ry ?? 35, '%');
      const cx = formatMaskUnit(mask.x ?? 50, '%');
      const cy = formatMaskUnit(mask.y ?? 50, '%');
      return `ellipse(${rx} ${ry} at ${cx} ${cy})`;
    }
    case 'inset': {
      const top = formatMaskUnit(mask.top ?? 0, '%');
      const right = formatMaskUnit(mask.right ?? 0, '%');
      const bottom = formatMaskUnit(mask.bottom ?? 0, '%');
      const left = formatMaskUnit(mask.left ?? 0, '%');
      const radius = mask.corner_radius ? ` round ${formatMaskUnit(mask.corner_radius, 'px')}` : '';
      return `inset(${top} ${right} ${bottom} ${left}${radius})`;
    }
    case 'polygon': {
      const preset = mask.polygon_preset || 'hexagon';
      if (preset === 'triangle') {
        return 'polygon(50% 0%, 100% 100%, 0% 100%)';
      } else if (preset === 'diamond') {
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      } else if (preset === 'hexagon') {
        return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      } else if (preset === 'star') {
        return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
      } else if (preset === 'slant_left') {
        return 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)';
      } else if (preset === 'slant_right') {
        return 'polygon(0% 0%, 85% 0%, 100% 100%, 15% 100%)';
      } else if (preset === 'custom') {
        // Custom points are author intent — never substitute a different
        // geometry. Missing/blank points mean no clip (warn, don't hexagon).
        const pts = typeof mask.points === 'string' ? mask.points.trim() : '';
        if (pts) {
          return `polygon(${mask.points})`;
        }
        console.warn('[AST] mask polygon preset=custom without points — skipping clip');
        return undefined;
      }
      return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    }
    default:
      return undefined;
  }
}

// Shared exit-tail thresholds (single source of truth for the renderer;
// the backend geometry/timing linters and the editor mirror these values):
// opacity/brightness ~0 and scale ~0 read as hidden; a translate ending
// >=600px off its rest position reads as slid off-screen on 1080p canvas.
export const EXIT_LIKE_OPACITY_MAX = 0.05;
export const EXIT_LIKE_SCALE_MAX = 0.01;
export const EXIT_LIKE_BRIGHTNESS_MAX = 0.05;
export const EXIT_LIKE_TRANSLATE_PX = 600;

/**
 * Exit-intent heuristic shared with the backend geometry linter: a track
 * only counts as an exit tail when it animates toward a hidden end state.
 * Entrance-only tracks (opacity ends at 1) must never trigger an early
 * unmount. Slide-out exits (translate ending far off-screen) and
 * brightness flashes to black count; blur/rotate never hide a layer.
 */
export function isExitLikeAnimation(a: ASTAnimation | null | undefined): boolean {
  if (!a || typeof a.to !== 'number') return false;
  if ((a.loop_mode === 'loop' || a.loop_mode === 'pingpong') && !(a as any).exit) {
    return false;
  }
  if (a.property === 'opacity') return a.to <= EXIT_LIKE_OPACITY_MAX;
  if (a.property === 'scale') return a.to <= EXIT_LIKE_SCALE_MAX;
  if (a.property === 'brightness') return a.to <= EXIT_LIKE_BRIGHTNESS_MAX;
  if (a.property === 'translateX' || a.property === 'translateY') {
    return Math.abs(a.to) >= EXIT_LIKE_TRANSLATE_PX;
  }
  return false;
}

const AnimatedLayer: React.FC<AnimatedLayerProps> = ({
  animations = [],
  exit,
  camera_shake = 'none',
  transform_origin = 'center center',
  floating = false,
  mask,
  perspective,
  perspective_origin,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Compute exit frame cutoff (if configured on layer or on any individual animation track)
  const exitFrame = useMemo(() => {
    if (typeof exit === 'number' && Number.isFinite(exit)) {
      return Math.max(0, Math.round(exit * fps));
    }

    const explicitExitAnims = animations.filter((a) => a && (a as any).exit === true);
    if (explicitExitAnims.length > 0) {
      let maxEnd = 0;
      for (const a of explicitExitAnims) {
        if (typeof a.duration === 'number') {
          const delayFrames = Math.max(0, Math.round((a.delay || 0) * fps));
          const durationFrames = Math.max(1, Math.round(a.duration * fps));
          maxEnd = Math.max(maxEnd, delayFrames + durationFrames);
        }
      }
      return maxEnd;
    }

    if (exit === true && animations.length > 0) {
      // Loop/pingpong tracks are infinite by definition — their `duration`
      // is a cycle length, not an end time — so they must not contribute to
      // the unmount cutoff. If every track loops, there is no finite end:
      // persist the layer for the full cut (return null).
      //
      // BUG FIX (foreground vanishes leaving background-only cut): an
      // entrance-only layer (e.g. Spring Pop In: opacity 0->1 @0.5s) with a
      // stray layer-level `exit: true` used to unmount at max(delay+duration)
      // (~1.1s), hiding the foreground for the rest of the cut. `exit: true`
      // means "remove me", not "play entrance then stay" — so without an
      // explicit exit tail it must persist. Only honor the cutoff when at
      // least one finite track actually heads toward hidden (see
      // isExitLikeAnimation); otherwise persist for the full cut (return
      // null). The cutoff is the end of the exit tail itself (matching the
      // backend linter) — not the end of unrelated drifts — so overlap
      // checks and the renderer agree on when the layer vacates.
      // (No console.warn here: this runs per render incl. headless export.
      // Stray-flag warnings live in the editor + timing linter.)
      let tailEnd = 0;
      let exitLikeTracks = 0;
      for (const a of animations) {
        if (typeof a?.duration !== 'number') {
          continue;
        }
        if (!isExitLikeAnimation(a)) {
          continue;
        }
        const delayFrames = Math.max(0, Math.round((a.delay || 0) * fps));
        const durationFrames = Math.max(1, Math.round(a.duration * fps));
        tailEnd = Math.max(tailEnd, delayFrames + durationFrames);
        exitLikeTracks += 1;
      }
      if (exitLikeTracks === 0) {
        // Entrance-only + exit:true is almost always a stray flag (AI or
        // "After Motion" misclick): persisting avoids the background-only cut.
        return null;
      }
      return tailEnd;
    }

    return null;
  }, [exit, animations, fps]);

  // Authoring-mistake warnings (dev preview only, as an effect so headless
  // export stays log-clean). NOTE on renderer semantics: opacity tracks are
  // last-win (`s.opacity =`), but spatial/filter tracks ACCUMULATE (`+=` on
  // the transform/filter string) — so duplicate same-prop delays on spatial
  // props double-apply instead of overriding, and chained spatial phases do
  // not hand off. Only opacity chains are checked for from-mismatch here.
  useEffect(() => {
    if (import.meta.env.PROD) return;
    if (typeof console === 'undefined' || !animations || animations.length < 2) return;
    try {
      const seen = new Map<string, number>();
      for (let i = 0; i < animations.length; i++) {
        const a = animations[i] as any;
        if (!a || typeof a.property !== 'string') continue;
        const delayKey = Number(a.delay || 0).toFixed(2);
        const key = `${a.property}@${delayKey}`;
        if (seen.has(key)) {
          const stacking = a.property !== 'opacity'
            ? 'spatial/filter tracks accumulate (+=), so both apply at once (usually unintended)'
            : 'the later track wins for opacity';
          console.warn(
            `[AST] duplicate ${a.property} tracks at delay ${delayKey}s ` +
            `(tracks #${(seen.get(key) ?? 0) + 1} and #${i + 1}): ${stacking} — ` +
            `stagger delays or remove one.`
          );
        } else {
          seen.set(key, i);
        }
      }
      // Opacity chains are last-win: a chained track starting away from the
      // previous end value visibly jumps at its delay.
      let lastOpacityTo: number | null = null;
      for (let i = 0; i < animations.length; i++) {
        const a = animations[i] as any;
        if (!a || a.property !== 'opacity') continue;
        const fromVal = typeof a.from === 'number' ? a.from : a.from_;
        if (typeof fromVal !== 'number' || typeof a.to !== 'number') continue;
        if (lastOpacityTo !== null && Math.abs(lastOpacityTo - fromVal) > 0.011
            && !(a.exit === true)) {
          console.warn(
            `[AST] chained opacity track #${i + 1} starts at ${fromVal} ` +
            `but previous ends at ${lastOpacityTo} — expect a visible jump at delay ${Number(a.delay || 0)}s.`
          );
        }
        lastOpacityTo = a.to;
      }
    } catch {
      /* warnings must never break rendering */
    }
  }, [animations]);

  // Fix 10: quantize floating drift to every 2nd frame (sin/cos + string
  // rebuild per layer per frame was wasteful for a 4px drift).
  const qFrameFloat = floating ? Math.floor(frame / 2) * 2 : frame;
  const cameraOffset = useMemo(() => {
    return getCameraNoise(frame, camera_shake);
  }, [frame, camera_shake]);

  const style = useMemo(() => {
    const s: React.CSSProperties = { transform: '', transformOrigin: transform_origin };
    
    // 1. Compute AST keyframe & spring transforms
    for (let i = 0; i < animations.length; i++) {
      const anim = animations[i];
      // `from` is the editor contract; `from_` is what the backend LLM schema
      // serializes (pydantic alias). Accept both — otherwise AI-generated
      // motion is silently skipped and cuts render static.
      const animFrom = typeof anim.from === 'number' ? anim.from : (anim as any).from_;
      if (typeof anim.duration !== 'number' || typeof animFrom !== 'number' || typeof anim.to !== 'number') {
        continue;
      }

      const delayFrames = Math.max(0, Math.round((anim.delay || 0) * fps));
      const durationFrames = Math.max(1, Math.round(anim.duration * fps));

      // Check if this animation track is an exit or subsequent phase on the same property:
      // 1) Explicitly flagged with anim.exit === true
      // 2) Or preceded by an earlier animation track on the same property with an earlier delay
      const hasEarlierTrackOnSameProp = animations.slice(0, i).some(
        (prev) => prev.property === anim.property && (prev.delay || 0) < (anim.delay || 0)
      );
      const isExitPhase = anim.exit === true || hasEarlierTrackOnSameProp;

      // If it's an exit or secondary animation track, do not clamp/apply before its delay starts.
      // Otherwise `extrapolateLeft: 'clamp'` clobbers preceding entrance animations at frame 0.
      if (isExitPhase && frame < delayFrames) {
        continue;
      }

      let val = animFrom;
      const loopMode = anim.loop_mode;

      if (loopMode === 'loop' && !anim.exit) {
        if (frame >= delayFrames) {
          const elapsed = frame - delayFrames;
          const cycleFrame = elapsed % durationFrames;
          val = evaluateAnimationProgress(anim, animFrom, anim.to, cycleFrame, durationFrames, fps);
        }
      } else if (loopMode === 'pingpong' && !anim.exit) {
        if (frame >= delayFrames) {
          const elapsed = frame - delayFrames;
          const cycleLength = durationFrames * 2;
          const cycleFrame = elapsed % cycleLength;
          if (cycleFrame < durationFrames) {
            val = evaluateAnimationProgress(anim, animFrom, anim.to, cycleFrame, durationFrames, fps);
          } else {
            const reverseFrame = cycleFrame - durationFrames;
            val = evaluateAnimationProgress(anim, anim.to, animFrom, reverseFrame, durationFrames, fps);
          }
        }
      } else {
        const localF = Math.max(0, frame - delayFrames);
        val = evaluateAnimationProgress(anim, animFrom, anim.to, localF, durationFrames, fps);
      }

      if (anim.property === 'opacity') {
        s.opacity = Math.max(0, Math.min(1, val));
      } else if (anim.property === 'scale') {
        s.transform += ` scale(${val})`;
      } else if (anim.property === 'translateX') {
        s.transform += ` translateX(${val}px)`;
      } else if (anim.property === 'translateY') {
        s.transform += ` translateY(${val}px)`;
      } else if (anim.property === 'rotate') {
        s.transform += ` rotate(${val}deg)`;
      } else if (anim.property === 'rotateX') {
        s.transform += ` rotateX(${val}deg)`;
      } else if (anim.property === 'rotateY') {
        s.transform += ` rotateY(${val}deg)`;
      } else if (anim.property === 'translateZ') {
        s.transform += ` translateZ(${val}px)`;
      } else if (anim.property === 'blur') {
        s.filter = `${s.filter || ''} blur(${Math.max(0, val)}px)`.trim();
      } else if (anim.property === 'brightness') {
        s.filter = `${s.filter || ''} brightness(${Math.max(0, val)})`.trim();
      }
    }

    // Optional organic harmonic floating drift (quantized, see above)
    if (floating) {
      const floatY = Math.sin(qFrameFloat * 0.05) * 4;
      const floatX = Math.cos(qFrameFloat * 0.035) * 2.5;
      s.transform += ` translate3d(${floatX.toFixed(2)}px, ${floatY.toFixed(2)}px, 0)`;
    }

    // 2. Apply procedural camera noise offset if active
    if (cameraOffset.x !== 0 || cameraOffset.y !== 0) {
      s.transform += ` translate(${cameraOffset.x}px, ${cameraOffset.y}px)`;
    }
    if (cameraOffset.rotation !== 0) {
      s.transform += ` rotate(${cameraOffset.rotation}deg)`;
    }

    // 3. Perspective and 3D depth context
    const has3D = (animations || []).some(
      (a) => a && (a.property === 'rotateX' || a.property === 'rotateY' || a.property === 'translateZ')
    ) || perspective !== undefined;

    if (has3D) {
      s.transformStyle = 'preserve-3d';
      const persVal = typeof perspective === 'number' ? `${perspective}px` : (perspective || '1000px');
      const curTransform = s.transform || '';
      if (!curTransform.includes('perspective')) {
        s.transform = `perspective(${persVal}) ${curTransform}`.trim();
      }
      // The perspective() FUNCTION above gives the wrapper's OWN animated
      // transform its depth — but CSS perspective-origin only affects the
      // perspective PROPERTY (never the function). Set the property too so it
      // projects *children* (the static container's transform) with the
      // vanishing point honored; the static container skips its own
      // perspective() when this shared camera is active (see ASTRenderer).
      s.perspective = persVal;
      if (perspective_origin) {
        s.perspectiveOrigin = perspective_origin;
      }
    }
    
    return s;
  }, [animations, cameraOffset, floating, frame, qFrameFloat, fps, transform_origin, perspective, perspective_origin]);

  // Mask clips: apply static shape and animated reveal directly to the layer's
  // container box (children) so percentage coordinates resolve against the layer's
  // own width and height rather than the composition canvas (1920x1080).
  const shapeClip = useMemo(() => computeStaticShapeClip(mask), [mask]);
  const revealClip = useMemo(
    () => computeRevealClip(mask, frame, fps),
    [mask, frame, fps]
  );

  // If exit cutoff has been reached, unmount the layer completely so it doesn't linger
  if (exitFrame !== null && frame >= exitFrame) {
    return null;
  }

  const content = useMemo(() => {
    if (!shapeClip && !revealClip) {
      return children;
    }

    if (!React.isValidElement(children)) {
      if (shapeClip && revealClip) {
        return (
          <div style={{ width: '100%', height: '100%', clipPath: shapeClip, WebkitClipPath: shapeClip }}>
            <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, clipPath: revealClip, WebkitClipPath: revealClip }}>
              {children}
            </div>
          </div>
        );
      }
      const clip = shapeClip || revealClip;
      return (
        <div style={{ width: '100%', height: '100%', clipPath: clip, WebkitClipPath: clip }}>
          {children}
        </div>
      );
    }

    const childElement = children as React.ReactElement<{ style?: React.CSSProperties; children?: React.ReactNode }>;
    const existingStyle = childElement.props.style || {};

    if (shapeClip && revealClip) {
      // Static shape on the layer container, animated reveal on an inner wrapper around layer contents
      const wrappedChildren = (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            inset: 0,
            clipPath: revealClip,
            WebkitClipPath: revealClip,
          }}
        >
          {childElement.props.children}
        </div>
      );
      return React.cloneElement(
        childElement,
        {
          style: {
            ...existingStyle,
            clipPath: shapeClip,
            WebkitClipPath: shapeClip,
          },
        },
        wrappedChildren
      );
    }

    const clip = shapeClip || revealClip;
    return React.cloneElement(childElement, {
      style: {
        ...existingStyle,
        clipPath: clip,
        WebkitClipPath: clip,
      },
    });
  }, [children, shapeClip, revealClip]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', ...style }}>
      {content}
    </div>
  );
};

// Fix 10: BlurGate owns the ONLY outer useCurrentFrame, so static /
// non-blur layers never pay a second 30Hz subscription (previously both
// ASTAnimator and AnimatedLayer subscribed per layer).
const BlurGate: React.FC<ASTAnimatorProps> = ({
  animations = [],
  shutter_angle = 180,
  camera_shake = 'none',
  floating = false,
  qualityMode,
  quality: qualityInput,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const policy = parseQuality(qualityInput);
  const mode: QualityMode =
    qualityMode ?? (getRemotionEnvironment().isRendering ? 'export' : 'preview');
  const samples = getMotionBlurSamples(mode, policy);
  if (samples <= 0) return <>{children}</>;
  const hasMotion = hasSpatialMotion(animations, floating, camera_shake);
  if (!hasMotion) return <>{children}</>;
  // Only *spatial* loops keep a layer perpetually moving: an opacity
  // pingpong renders spatially identical subframes, so it must not defeat
  // the settled-blur bypass on its own.
  const hasLoopingMotion = (animations || []).some(
    (a) => a && a.loop_mode && a.loop_mode !== 'none' && !a.exit
      && SPATIAL_ANIMATION_PROPS.has(String(a.property ?? ''))
  );
  const alwaysMoving = floating || (camera_shake && camera_shake !== 'none') || hasLoopingMotion;
  if (shouldBypassSettledBlur(policy) && !alwaysMoving && animations && animations.length > 0) {
    let windowEnd = 0;
    let windowStart = Number.POSITIVE_INFINITY;
    for (const anim of animations) {
      if (typeof anim.duration !== 'number') continue;
      const delayFrames = Math.max(0, Math.round((anim.delay || 0) * fps));
      const durationFrames = Math.max(1, Math.round(anim.duration * fps));
      windowStart = Math.min(windowStart, delayFrames);
      windowEnd = Math.max(windowEnd, delayFrames + durationFrames);
    }
    if (
      Number.isFinite(windowStart) &&
      (frame < windowStart - 2 || frame > windowEnd + MOTION_BLUR_SETTLE_GRACE_FRAMES)
    ) {
      return <>{children}</>;
    }
  }
  const safeShutterAngle = typeof shutter_angle === 'number' && Number.isFinite(shutter_angle)
    ? Math.max(0, Math.min(360, shutter_angle))
    : 180;
  return (
    <CameraMotionBlur shutterAngle={safeShutterAngle} samples={samples}>
      {children}
    </CameraMotionBlur>
  );
};

export const ASTAnimator: React.FC<ASTAnimatorProps> = (props) => {
  const { animations = [], motion_blur = false, camera_shake = 'none', floating = false, exit, mask, perspective, perspective_origin, children } = props;
  const content = (
    <AnimatedLayer
      animations={animations}
      exit={exit}
      camera_shake={camera_shake}
      transform_origin={props.transform_origin}
      floating={floating}
      mask={mask}
      perspective={perspective}
      perspective_origin={perspective_origin}
    >
      {children}
    </AnimatedLayer>
  );
  // Fast path: no second useCurrentFrame subscription for the common case.
  if (!motion_blur) return content;
  if (!hasSpatialMotion(animations, floating, camera_shake)) return content;
  const policy = parseQuality(props.quality);
  const mode: QualityMode =
    props.qualityMode ?? (getRemotionEnvironment().isRendering ? 'export' : 'preview');
  if (getMotionBlurSamples(mode, policy) <= 0) return content;
  return <BlurGate {...props}>{content}</BlurGate>;
};

