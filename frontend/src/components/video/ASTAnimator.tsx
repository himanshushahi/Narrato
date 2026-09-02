import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { getCameraNoise, CameraShakeType } from './CameraNoise';

export interface ASTAnimation {
  property: 'scale' | 'opacity' | 'translateX' | 'translateY' | 'rotate' | 'rotateX' | 'rotateY' | 'blur' | 'brightness';
  from: number;
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

  const cameraOffset = useMemo(() => {
    return getCameraNoise(frame, camera_shake);
  }, [frame, camera_shake]);

  const style = useMemo(() => {
    const s: React.CSSProperties = { transform: '', transformOrigin: transform_origin };
    
    // 1. Compute AST keyframe & spring transforms
    for (const anim of animations) {
      if (typeof anim.duration !== 'number' || typeof anim.from !== 'number' || typeof anim.to !== 'number') {
        continue;
      }
      
      const delayFrames = Math.max(0, Math.round((anim.delay || 0) * fps));
      const durationFrames = Math.max(1, Math.round(anim.duration * fps));
      let val = anim.from;
      
      if (anim.easing === 'spring') {
        const spr = spring({
          frame: Math.max(0, frame - delayFrames),
          fps,
          config: { damping: 14, stiffness: 100, mass: 0.9 },
          durationInFrames: durationFrames,
        });
        val = anim.from + (anim.to - anim.from) * spr;
      } else {
        // Easing curves
        let easingFn = Easing.linear;
        if (anim.easing === 'ease-in') easingFn = Easing.ease;
        else if (anim.easing === 'ease-out') easingFn = Easing.out(Easing.ease);
        else if (anim.easing === 'ease-in-out') easingFn = Easing.inOut(Easing.ease);

        val = interpolate(frame, [delayFrames, delayFrames + durationFrames], [anim.from, anim.to], {
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

    // Optional organic harmonic floating drift
    if (floating) {
      const floatY = Math.sin(frame * 0.05) * 4;
      const floatX = Math.cos(frame * 0.035) * 2.5;
      s.transform += ` translate3d(${floatX}px, ${floatY}px, 0)`;
    }

    // 2. Apply procedural camera noise offset if active
    if (cameraOffset.x !== 0 || cameraOffset.y !== 0) {
      s.transform += ` translate(${cameraOffset.x}px, ${cameraOffset.y}px)`;
    }
    if (cameraOffset.rotation !== 0) {
      s.transform += ` rotate(${cameraOffset.rotation}deg)`;
    }
    
    return s;
  }, [animations, cameraOffset, floating, frame, fps, transform_origin]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', ...style }}>
      {children}
    </div>
  );
};

export const ASTAnimator: React.FC<ASTAnimatorProps> = ({
  animations = [],
  motion_blur = false,
  shutter_angle = 180,
  camera_shake = 'none',
  transform_origin,
  children,
}) => {
  const content = (
    <AnimatedLayer
      animations={animations}
      camera_shake={camera_shake}
      transform_origin={transform_origin}
    >
      {children}
    </AnimatedLayer>
  );

  if (motion_blur) {
    const safeShutterAngle = typeof shutter_angle === 'number' && Number.isFinite(shutter_angle)
      ? Math.max(0, Math.min(360, shutter_angle))
      : 180;

    return (
      <CameraMotionBlur shutterAngle={safeShutterAngle} samples={5}>
        {content}
      </CameraMotionBlur>
    );
  }

  return content;
};

