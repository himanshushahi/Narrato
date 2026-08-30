import React, { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

export interface ASTAnimation {
  property: 'scale' | 'opacity' | 'translateX' | 'translateY' | 'rotate' | 'rotateX' | 'rotateY';
  from: number;
  to: number;
  duration: number; // in seconds
  delay?: number; // in seconds (optional)
  easing: 'linear' | 'spring' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export const ASTAnimator: React.FC<{
  animations: ASTAnimation[];
  children: React.ReactNode;
}> = ({ animations, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const style = useMemo(() => {
    const s: React.CSSProperties = { transform: '', transformOrigin: 'center center' };
    
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
        s.opacity = val;
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
      }
    }
    
    return s;
  }, [animations, frame, fps]);

  return <div style={{ width: '100%', height: '100%', position: 'absolute', ...style }}>{children}</div>;
};
