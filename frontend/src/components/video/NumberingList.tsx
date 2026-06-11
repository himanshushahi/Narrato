import React from 'react';
import { useCurrentFrame, spring, interpolate } from 'remotion';

interface Props {
  meta: any;
  durationInFrames: number;
  subtitleSettings?: any;
  cue?: string;
}

/**
 * Full-screen numbered item display — ONE item per sub-visual.
 *
 * Shows a single rank number + title full screen with spring entrance.
 * For a "top 5" ranking you'd use multiple list sub-visuals in sequence,
 * each showing one item with its own duration and transition.
 *
 * Styling (number style, colours, font) is read from project-wide
 * subtitleSettings (stored in DB), with per-item meta as fallback,
 * then hardcoded defaults.
 */
export const NumberingList: React.FC<Props> = ({ meta, subtitleSettings }) => {
  const frame = useCurrentFrame();

  const number = meta?.number ?? 1;
  const title = meta?.title || '';
  const description = meta?.description || '';
  const icon = meta?.icon || '';

  // ── Styling: project settings → meta fallback → hardcoded defaults ──
  const ss = subtitleSettings || {};

  const numberStyle = ss.numbering_number_style || meta?.number_style || 'plain';
  const fontFamily = ss.numbering_font_family || meta?.font_family || 'Montserrat, sans-serif';

  const titleColor = ss.numbering_title_color || meta?.title_color || '#fef3c7';
  const descColor = ss.numbering_description_color || meta?.description_color || '#d6d3d1';
  const numColor = ss.numbering_number_color || meta?.number_color || '#fbbf24';
  const numBg = ss.numbering_number_bg_color || meta?.number_bg_color || 'rgba(251,191,36,0.15)';
  const numBorder = ss.numbering_number_border_color || meta?.number_border_color || '#b45309';
  const accentColor = ss.numbering_accent_color || meta?.accent_color || '#f59e0b';

  // ── Entrance animation (spring) ──────────────────────────────
  const entrance = spring({
    frame,
    fps: 30,
    config: { damping: 12, stiffness: 100, mass: 0.6 },
  });
  const opacity = interpolate(entrance, [0, 0.25], [0, 1], { extrapolateLeft: 'clamp' });
  const scale = interpolate(entrance, [0, 0.4, 1], [0.85, 1.05, 1], { extrapolateLeft: 'clamp' });

  // Number entrance (slightly delayed bounce)
  const numSpring = spring({
    frame: Math.max(0, frame - 4),
    fps: 30,
    config: { damping: 8, stiffness: 150, mass: 0.4 },
  });
  const numScale = interpolate(numSpring, [0, 1], [2, 1], { extrapolateLeft: 'clamp' });
  const numOpacity = interpolate(numSpring, [0, 0.3], [0, 1], { extrapolateLeft: 'clamp' });

  // Title entrance (slides up slightly)
  const titleSpring = spring({
    frame: Math.max(0, frame - 8),
    fps: 30,
    config: { damping: 14, stiffness: 80, mass: 0.5 },
  });
  const titleSlide = interpolate(titleSpring, [0, 1], [30, 0], { extrapolateLeft: 'clamp' });
  const titleOpacity = interpolate(titleSpring, [0, 0.3], [0, 1], { extrapolateLeft: 'clamp' });

  // ── Number badge ─────────────────────────────────────────────
  const renderBadge = () => {
    const base: React.CSSProperties = {
      fontFamily,
      fontWeight: 900,
      color: numColor,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: numOpacity,
      transform: `scale(${numScale})`,
    };

    switch (numberStyle) {
      case 'circle':
        return (
          <div style={{...base, width: 220, height: 220, borderRadius: '50%', backgroundColor: numBg, border: `4px solid ${numBorder}`, fontSize: 100, boxShadow: `0 0 80px ${accentColor}33`}}>
            {String(number)}
          </div>
        );
      case 'square':
        return (
          <div style={{...base, width: 200, height: 200, borderRadius: 24, backgroundColor: numBg, border: `4px solid ${numBorder}`, fontSize: 90, boxShadow: `0 0 80px ${accentColor}33`}}>
            {String(number)}
          </div>
        );
      case 'badge':
        return (
          <div style={{...base, minWidth: 160, height: 80, borderRadius: 40, padding: '0 40px', backgroundColor: numBorder, fontSize: 52, color: '#0c0a09', boxShadow: `0 0 60px ${accentColor}44`}}>
            {String(number)}
          </div>
        );
      default: /* plain */
        return (
          <div style={{...base, fontSize: 180, lineHeight: 1, textShadow: `0 0 100px ${accentColor}44`}}>
            {String(number)}
          </div>
        );
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 80px',
        boxSizing: 'border-box',
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      {icon && (
        <div style={{ fontSize: 80, marginBottom: 24, lineHeight: 1, opacity: numOpacity, transform: `scale(${numScale})` }}>
          {icon}
        </div>
      )}

      {renderBadge()}

      {title && (
        <div
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: 56,
            color: titleColor,
            textAlign: 'center',
            lineHeight: 1.15,
            marginTop: 32,
            maxWidth: '90%',
            textShadow: '0 4px 30px rgba(0,0,0,0.5)',
            opacity: titleOpacity,
            transform: `translateY(${titleSlide}px)`,
          }}
        >
          {title}
        </div>
      )}

      {description && (
        <div
          style={{
            fontFamily,
            fontWeight: 400,
            fontSize: 24,
            color: descColor,
            textAlign: 'center',
            lineHeight: 1.4,
            marginTop: 16,
            maxWidth: '75%',
            opacity: titleOpacity,
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
};
