import React, { useMemo } from 'react';
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

export interface ASTAnimation {
  property: 'scale' | 'opacity' | 'translateX' | 'translateY' | 'rotate' | 'rotateX' | 'rotateY' | 'blur' | 'brightness';
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

const AnimatedLayer: React.FC<AnimatedLayerProps> = ({
  animations = [],
  exit,
  camera_shake = 'none',
  transform_origin = 'center center',
  floating = false,
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
      let maxEnd = 0;
      let finiteTracks = 0;
      for (const a of animations) {
        if (a && (a.loop_mode === 'loop' || a.loop_mode === 'pingpong') && !(a as any).exit) {
          continue;
        }
        if (typeof a.duration === 'number') {
          const delayFrames = Math.max(0, Math.round((a.delay || 0) * fps));
          const durationFrames = Math.max(1, Math.round(a.duration * fps));
          maxEnd = Math.max(maxEnd, delayFrames + durationFrames);
          finiteTracks += 1;
        }
      }
      if (finiteTracks === 0) {
        return null;
      }
      return maxEnd;
    }

    return null;
  }, [exit, animations, fps]);

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
    
    return s;
  }, [animations, cameraOffset, floating, frame, qFrameFloat, fps, transform_origin]);

  // If exit cutoff has been reached, unmount the layer completely so it doesn't linger
  if (exitFrame !== null && frame >= exitFrame) {
    return null;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', ...style }}>
      {children}
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
  const { animations = [], motion_blur = false, camera_shake = 'none', floating = false, exit, children } = props;
  const content = (
    <AnimatedLayer
      animations={animations}
      exit={exit}
      camera_shake={camera_shake}
      transform_origin={props.transform_origin}
      floating={floating}
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

