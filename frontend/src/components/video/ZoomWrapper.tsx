import React from 'react';
import { SubVisualTransform, DEFAULT_TRANSFORM } from './SubVisualTransform';

interface Props {
  transform?: SubVisualTransform;
  children: React.ReactNode;
}

/**
 * Conditionally wraps children in a CSS transform layer that applies
 * user-configured zoom and X/Y offset.
 *
 * When transform is at default values (zoom=1, offsetX=0, offsetY=0)
 * the wrapper renders children directly with zero DOM overhead.
 *
 * Lives **inside** TransitionWrapper so entrance animations compose
 * naturally on top of the base transform.
 *
 * Deliberately NOT memoized: the parents (NitishRajputComposition,
 * ParallaxImage, PanScanImage) re-render every frame and build new children
 * elements per frame, so a shallow memo never skips; a custom comparator
 * that ignored children would freeze per-frame content like the parallax
 * Img styles that ParallaxImage computes in its own render.
 */
export const ZoomWrapper: React.FC<Props> = ({ transform, children }) => {
  const t = transform ?? DEFAULT_TRANSFORM;

  // Fast path: no transform → render children directly
  if (t.zoom === 1 && t.offsetX === 0 && t.offsetY === 0) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${t.zoom}) translate3d(${t.offsetX}px, ${t.offsetY}px, 0px)`,
          transformOrigin: 'center center',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
};

