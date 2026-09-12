import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing, getRemotionEnvironment } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { getCameraNoise, CameraShakeType } from './CameraNoise';
import { hasSpatialMotion } from './spatialMotion';
import {
  QualityMode,
  QualityPolicy,
  parseQuality,
  getMotionBlurSamples,
  shouldBypassSettledBlur,
  MOTION_BLUR_SETTLE_GRACE_FRAMES,
} from './renderQuality';

export interface ASTAnimation {
  property: 'scale' | 'opacity' | 'translateX' | 'translateY' | 'rotate' | 'rotateX' | 'rotateY' | 'blur' | 'brightness';
  from: number;
  /** Backend pydantic schema serializes the `from` alias as `from_` — accept both. */
  from_?: number;
  to: number;
  duration: number; // in seconds
  delay?: number; // in seconds (optional)
  easing: 'linear' | 'spring' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface ASTAnimatorProps {
  animations?: ASTAnimation[];
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
  camera_shake?: CameraShakeType;
  transform_origin?: string;
  floating?: boolean;
  children: React.ReactNode;
}

const AnimatedLayer: React.FC<AnimatedLayerProps> = ({
  animations = [],
  camera_shake = 'none',
  transform_origin = 'center center',
  floating = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fix 10: quantize floating drift to every 2nd frame (sin/cos + string
  // rebuild per layer per frame was wasteful for a 4px drift).
  const qFrameFloat = floating ? Math.floor(frame / 2) * 2 : frame;
  const cameraOffset = useMemo(() => {
    return getCameraNoise(frame, camera_shake);
  }, [frame, camera_shake]);

  const style = useMemo(() => {
    const s: React.CSSProperties = { transform: '', transformOrigin: transform_origin };
    
    // 1. Compute AST keyframe & spring transforms
    for (const anim of animations) {
      // `from` is the editor contract; `from_` is what the backend LLM schema
      // serializes (pydantic alias). Accept both — otherwise AI-generated
      // motion is silently skipped and cuts render static.
      const animFrom = typeof anim.from === 'number' ? anim.from : (anim as any).from_;
      if (typeof anim.duration !== 'number' || typeof animFrom !== 'number' || typeof anim.to !== 'number') {
        continue;
      }

      const delayFrames = Math.max(0, Math.round((anim.delay || 0) * fps));
      const durationFrames = Math.max(1, Math.round(anim.duration * fps));
      let val = animFrom;

      if (anim.easing === 'spring') {
        const spr = spring({
          frame: Math.max(0, frame - delayFrames),
          fps,
          config: { damping: 14, stiffness: 100, mass: 0.9 },
          durationInFrames: durationFrames,
        });
        val = animFrom + (anim.to - animFrom) * spr;
      } else {
        // Easing curves
        let easingFn = Easing.linear;
        if (anim.easing === 'ease-in') easingFn = Easing.ease;
        else if (anim.easing === 'ease-out') easingFn = Easing.out(Easing.ease);
        else if (anim.easing === 'ease-in-out') easingFn = Easing.inOut(Easing.ease);

        val = interpolate(frame, [delayFrames, delayFrames + durationFrames], [animFrom, anim.to], {
          extrapolateRight: 'clamp',
          extrapolateLeft: 'clamp',
          easing: easingFn,
        });
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
  const alwaysMoving = floating || (camera_shake && camera_shake !== 'none');
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
  const { animations = [], motion_blur = false, camera_shake = 'none', floating = false, children } = props;
  const content = (
    <AnimatedLayer
      animations={animations}
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

