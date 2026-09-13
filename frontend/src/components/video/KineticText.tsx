import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';

export interface KineticTextProps {
  text: string;
  mode?: 'static' | 'words_stagger' | 'typewriter' | 'marker_highlight';
  font?: string;
  weight?: string | number;
  color?: string;
  highlight_color?: string;
  highlight_words?: string[];
  style?: React.CSSProperties;
  durationInFrames?: number;
}

export const KineticText: React.FC<KineticTextProps> = ({
  text,
  mode = 'static',
  font,
  weight,
  color = '#ffffff',
  highlight_color = '#facc15',
  highlight_words = [],
  style = {},
  durationInFrames = 60,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = useMemo(() => {
    return (text || '').trim().split(/\s+/);
  }, [text]);

  const cleanWordKey = (w: string) => (w || '').trim().toLowerCase().replace(/[\s.,!?;:'"()]/g, '');

  const highlightSet = useMemo(() => {
    return new Set(highlight_words.map(cleanWordKey));
  }, [highlight_words]);

  const isDevanagari = useMemo(() => {
    return /[\u0900-\u097F]/.test(text || '');
  }, [text]);

  const defaultFont = isDevanagari ? "'Noto Sans Devanagari', 'Inter', -apple-system, sans-serif" : 'Inter, -apple-system, sans-serif';

  // Base font style
  const baseFontStyle: React.CSSProperties = {
    fontFamily: font || style.fontFamily || defaultFont,
    fontWeight: weight || style.fontWeight || 'bold',
    color: color || style.color || '#ffffff',
    fontSize: style.fontSize || '64px',
    lineHeight: style.lineHeight || 1.25,
    textAlign: style.textAlign || 'center',
    letterSpacing: style.letterSpacing || 'normal',
    textShadow: style.textShadow || '0 4px 20px rgba(0,0,0,0.8)',
    ...style,
  };

  if (!text || text.trim() === '') {
    return <div style={baseFontStyle} />;
  }

  // 1. Static Mode
  if (mode === 'static' || !mode) {
    return <div style={baseFontStyle}>{text}</div>;
  }

  // 2. Typewriter Mode
  if (mode === 'typewriter') {
    const charsTotal = text.length;
    const writeDuration = Math.max(1, Math.min(charsTotal * 1.5, (durationInFrames || 60) * 0.75));
    const charsVisible = Math.floor(
      interpolate(frame, [0, writeDuration], [0, charsTotal], {
        extrapolateRight: 'clamp',
        easing: Easing.linear,
      })
    );
    const visibleText = text.slice(0, charsVisible);
    const cursorVisible = frame % 16 < 8; // Blinking cursor

    return (
      <div style={baseFontStyle}>
        <span>{visibleText}</span>
        <span style={{ opacity: cursorVisible ? 1 : 0, color: highlight_color, marginLeft: '2px', fontWeight: 900 }}>
          _
        </span>
      </div>
    );
  }

  // 3. Words Stagger Mode
  if (mode === 'words_stagger') {
    return (
      <div
        style={{
          ...baseFontStyle,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: style.justifyContent || 'center',
          alignItems: 'center',
          gap: '12px 18px',
        }}
      >
        {words.map((word, idx) => {
          const wordDelay = idx * 2.5;
          // Fix 8: settle-bail — skip spring once word entrance settled.
          const localF = frame - wordDelay;
          const wordSpr = localF > 26 ? 1 : spring({
            frame: Math.max(0, localF),
            fps,
            config: { damping: 12, stiffness: 120, mass: 0.8 },
          });

          const cleanWord = cleanWordKey(word);
          const isHighlighted = highlightSet.has(cleanWord);

          return (
            <span
              key={idx}
              style={{
                display: 'inline-block',
                opacity: wordSpr,
                transform: `scale(${wordSpr}) translateY(${(1 - wordSpr) * 20}px)`,
                color: isHighlighted ? highlight_color : color,
                textShadow: isHighlighted ? `0 0 25px ${highlight_color}88, 0 4px 20px rgba(0,0,0,0.8)` : undefined,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  // 4. Marker Highlight Mode
  if (mode === 'marker_highlight') {
    return (
      <div
        style={{
          ...baseFontStyle,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: style.justifyContent || 'center',
          alignItems: 'center',
          gap: '10px 16px',
        }}
      >
        {words.map((word, idx) => {
          const cleanWord = cleanWordKey(word);
          const isHighlighted = highlightSet.size === 0 || highlightSet.has(cleanWord);

          const sweepEnd = idx * 2 + 25;
          // Fix 8: settle-bail marker sweep.
          const sweepProgress = frame > sweepEnd ? 100 : interpolate(
            frame,
            [idx * 2 + 10, sweepEnd],
            [0, 100],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
          );

          return (
            <span
              key={idx}
              style={{
                position: 'relative',
                display: 'inline-block',
                padding: isHighlighted ? '2px 8px' : '0',
                borderRadius: '4px',
                isolation: 'isolate',
              }}
            >
              {/* Highlight sweep background */}
              {isHighlighted && (
                <span
                  style={{
                    position: 'absolute',
                    top: '15%',
                    left: 0,
                    bottom: '15%',
                    width: `${sweepProgress}%`,
                    backgroundColor: highlight_color,
                    opacity: 0.85,
                    borderRadius: '4px',
                    zIndex: 0,
                    boxShadow: `0 0 15px ${highlight_color}66`,
                  }}
                />
              )}
              <span
                style={{
                  position: 'relative',
                  zIndex: 1,
                  color: isHighlighted && sweepProgress > 50 ? '#0f172a' : color,
                }}
              >
                {word}
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  return <div style={baseFontStyle}>{text}</div>;
};
