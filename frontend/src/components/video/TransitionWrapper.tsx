import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  children: React.ReactNode;
  durationInFrames: number;
  type?: string;
}

/**
 * Snap a value to the nearest pixel boundary to eliminate sub-pixel jitter.
 */
const snapToPixel = (v: number) => Math.round(v);

/**
 * Round blur to 1 decimal place; below a threshold, set to 0 to skip
 * the filter altogether (avoids a GPU re-composite for no visual gain).
 */
const safeBlur = (v: number) => {
  const rounded = Math.round(v * 10) / 10;
  return rounded < 0.05 ? 0 : rounded;
};

export const TransitionWrapper: React.FC<Props> = ({
  children,
  type = 'subtle_slide',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ─── base layer: GPU-composited, isolated stacking context ───────────────
  const baseStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    // Force the element onto its own compositor layer once, up-front.
    // Using translate3d(0,0,0) instead of willChange avoids the browser
    // promoting/demoting the layer mid-animation (a primary flicker cause).
    transform: 'translate3d(0,0,0)',
    // Isolate this stacking context so filter changes don't repaint siblings.
    isolation: 'isolate',
    // backfaceVisibility hidden prevents "flash of back face" on scale flips.
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
  };

  if (type === 'none') {
    return <div style={baseStyle}>{children}</div>;
  }

  // ─── shared spring ────────────────────────────────────────────────────────
  // Higher damping → less overshoot → no post-entry jitter.
  // Lower mass   → faster settle → avoids long tail of micro-movements.
  const entrance = spring({
    frame,
    fps,
    config: { damping: 28, stiffness: 120, mass: 0.25 },
  });

  let motionStyle: React.CSSProperties = {};

  switch (type) {
    // ── fade ────────────────────────────────────────────────────────────────
    case 'fade': {
      // Use a spring-based opacity instead of linear interpolate to avoid
      // the abrupt stop at frame 15 that looks like a flicker.
      const opacity = interpolate(entrance, [0, 1], [0, 1], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      });
      motionStyle = { opacity };
      break;
    }

    // ── zoom in ─────────────────────────────────────────────────────────────
    case 'zoom_in': {
      const scale = interpolate(entrance, [0, 1], [1.08, 1], {
        extrapolateRight: 'clamp',
      });
      // Combine with translate3d so the element is already layer-promoted.
      motionStyle = { transform: `translate3d(0,0,0) scale(${scale})` };
      break;
    }

    // ── zoom out ─────────────────────────────────────────────────────────────
    case 'zoom_out': {
      const scale = interpolate(entrance, [0, 1], [0.92, 1], {
        extrapolateRight: 'clamp',
      });
      motionStyle = { transform: `translate3d(0,0,0) scale(${scale})` };
      break;
    }

    // ── slide left ───────────────────────────────────────────────────────────
    case 'slide_left': {
      const tx = snapToPixel(interpolate(entrance, [0, 1], [100, 0], {
        extrapolateRight: 'clamp',
      }));
      motionStyle = { transform: `translate3d(${tx}%,0,0)` };
      break;
    }

    // ── slide right ──────────────────────────────────────────────────────────
    case 'slide_right': {
      const tx = snapToPixel(interpolate(entrance, [0, 1], [-100, 0], {
        extrapolateRight: 'clamp',
      }));
      motionStyle = { transform: `translate3d(${tx}%,0,0)` };
      break;
    }

    // ── slide up ─────────────────────────────────────────────────────────────
    case 'slide_up': {
      const ty = snapToPixel(interpolate(entrance, [0, 1], [100, 0], {
        extrapolateRight: 'clamp',
      }));
      motionStyle = { transform: `translate3d(0,${ty}%,0)` };
      break;
    }

    // ── slide down ───────────────────────────────────────────────────────────
    case 'slide_down': {
      const ty = snapToPixel(interpolate(entrance, [0, 1], [-100, 0], {
        extrapolateRight: 'clamp',
      }));
      motionStyle = { transform: `translate3d(0,${ty}%,0)` };
      break;
    }

    // ── glitch ───────────────────────────────────────────────────────────────
    case 'glitch': {
      // Glitch must be rendered on a SEPARATE child layer so the filter
      // only re-composites that child, not the parent (stops flicker bleed).
      // We also clamp to integer pixels to prevent sub-pixel shimmer.
      const glitchX = Math.round(
        interpolate(
          frame,
          [0, 2, 4, 6, 8, 10, 12, 15],
          [0, 14, -14, 7, -7, 3, -3, 0],
          { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
        )
      );
      const glitchBlur = safeBlur(
        interpolate(frame, [0, 5, 10, 15], [4, 1.5, 0.5, 0], {
          extrapolateRight: 'clamp',
          extrapolateLeft: 'clamp',
        })
      );
      const hue = glitchX * 3;
      const filterStr =
        glitchBlur > 0
          ? `blur(${glitchBlur}px) hue-rotate(${hue}deg) contrast(1.2)`
          : `hue-rotate(${hue}deg) contrast(1.2)`;

      return (
        <div style={baseStyle}>
          {/* Inner wrapper carries the animated filter so the outer layer
              stays on the compositor and never triggers a full repaint. */}
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `translate3d(${glitchX}px,0,0)`,
              filter: filterStr,
              willChange: 'transform, filter',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {children}
          </div>
        </div>
      );
    }

    // ── subtle_slide (default) ────────────────────────────────────────────────
    default: {
      const tx = snapToPixel(interpolate(entrance, [0, 1], [12, 0], {
        extrapolateRight: 'clamp',
      }));
      const blur = safeBlur(interpolate(entrance, [0, 1], [6, 0], {
        extrapolateRight: 'clamp',
      }));

      // KEY: keep transform and filter on an inner child so the outer
      // layer (translate3d(0,0,0)) stays on the GPU and never re-promotes.
      // Changing filter on the same element as the layer-promotion trigger
      // forces a compositor layer swap — the #1 cause of flicker.
      return (
        <div style={baseStyle}>
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `translate3d(${tx}%,0,0)`,
              filter: blur > 0 ? `blur(${blur}px)` : undefined,
              willChange: blur > 0 ? 'transform, filter' : 'transform',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {children}
          </div>
        </div>
      );
    }
  }

  return (
    <div style={{ ...baseStyle, ...motionStyle }}>
      {children}
    </div>
  );
};