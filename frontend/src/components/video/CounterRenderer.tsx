import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from 'remotion';
import { withAlphaHex } from './BackgroundRenderer';

export interface CounterRendererProps {
  value?: number;
  start_value?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number; // duration in seconds
  format?: 'standard' | 'compact' | 'full' | 'currency' | 'percent' | 'none';
  title?: string;
  font?: string;
  weight?: string | number;
  color?: string;
  font_size?: number | string;
  fontSize?: number | string;
  style?: React.CSSProperties;
}

/**
 * Counter glow fallback uses a brighter cyan than BackgroundRenderer's
 * default; both go through the shared withAlphaHex helper.
 */
function withAlpha(color: string, alphaHex: string, fallbackAlpha = 0.35): string {
  return withAlphaHex(color, alphaHex, '0, 212, 255', fallbackAlpha);
}

/**
 * Formats a number according to the specified formatting rule.
 */
function formatNumber(
  val: number,
  formatRule: 'standard' | 'compact' | 'full' | 'currency' | 'percent' | 'none' = 'standard',
  decimals: number = 0
): string {
  if (!Number.isFinite(val)) return '0';

  if (formatRule === 'compact') {
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    const compactDecimals = typeof decimals === 'number' && decimals >= 0 ? decimals : 1;
    if (absVal >= 1e12) {
      return sign + (absVal / 1e12).toFixed(compactDecimals) + 'T';
    }
    if (absVal >= 1e9) {
      return sign + (absVal / 1e9).toFixed(compactDecimals) + 'B';
    }
    if (absVal >= 1e6) {
      return sign + (absVal / 1e6).toFixed(compactDecimals) + 'M';
    }
    if (absVal >= 1e3) {
      return sign + (absVal / 1e3).toFixed(compactDecimals) + 'K';
    }
    return val.toFixed(decimals);
  }

  if (
    formatRule === 'standard' ||
    formatRule === 'full' ||
    formatRule === 'currency' ||
    formatRule === 'percent'
  ) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  // 'none'
  return decimals > 0 ? val.toFixed(decimals) : Math.round(val).toString();
}

export const CounterRenderer: React.FC<CounterRendererProps> = ({
  value = 100,
  start_value = 0,
  prefix = '',
  suffix = '',
  decimals,
  duration = 1.4,
  format = 'standard',
  title,
  font,
  weight,
  color,
  font_size,
  fontSize,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Defensively parse inputs to guard against null/undefined/string values
  const safeValue =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : parseFloat(String(value ?? '')) || 0;
  const safeStartValue =
    typeof start_value === 'number' && Number.isFinite(start_value)
      ? start_value
      : parseFloat(String(start_value ?? '')) || 0;
  const safeDuration =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : 1.4;

  // Infer decimals if not specified
  const effectiveDecimals = React.useMemo(() => {
    if (typeof decimals === 'number' && Number.isFinite(decimals)) {
      return Math.max(0, Math.min(10, Math.floor(decimals)));
    }
    const str = safeValue.toString();
    if (str.includes('.')) {
      return str.split('.')[1].length;
    }
    return 0;
  }, [decimals, safeValue]);

  // Duration in frames (clamped to at least 15 frames)
  const durationInFrames = Math.max(15, Math.round(safeDuration * fps));

  // Progress 0 -> 1 with cubic ease-out
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const currentNum = safeStartValue + (safeValue - safeStartValue) * progress;
  const formattedNumber = formatNumber(currentNum, format, effectiveDecimals);

  // Subtle punch bounce when finishing
  const finishPop = spring({
    frame: Math.max(0, frame - durationInFrames + 4),
    fps,
    config: { damping: 12, stiffness: 200 },
  });
  const popScale = interpolate(finishPop, [0, 0.5, 1], [1, 1.05, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Effective typography & styling (supports both direct props and style object)
  const effectiveFont =
    font ||
    (style?.fontFamily as string) ||
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const effectiveWeight =
    weight || (style?.fontWeight as string | number) || '900';
  const effectiveColor =
    color || (style?.color as string) || '#00d4ff';
  const rawFontSize = font_size ?? fontSize ?? (style?.fontSize as string | number);
  const numericFontSize =
    typeof rawFontSize === 'number'
      ? rawFontSize
      : (parseFloat(String(rawFontSize)) || 72);
  const effectiveFontSize = `${numericFontSize}px`;
  const effectiveAlign =
    (style?.textAlign as React.CSSProperties['textAlign']) || 'center';

  // Relative typography scaling for title label based on font_size
  const titleFontSize = Math.max(10, Math.round(numericFontSize * 0.21));
  const titleMarginBottom = Math.max(4, Math.round(numericFontSize * 0.14));
  const titleLetterSpacing = Math.max(0.8, Math.round(numericFontSize * 0.02 * 10) / 10);

  // Smart prefix/suffix defaults for currency and percent formats
  const effectivePrefix = prefix || (format === 'currency' ? '$' : '');
  const effectiveSuffix = suffix || (format === 'percent' ? '%' : '');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems:
          effectiveAlign === 'left'
            ? 'flex-start'
            : effectiveAlign === 'right'
            ? 'flex-end'
            : 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: `${titleFontSize}px`,
            fontWeight: 800,
            letterSpacing: `${titleLetterSpacing}px`,
            textTransform: 'uppercase',
            color: 'rgba(248, 250, 252, 0.85)',
            marginBottom: `${titleMarginBottom}px`,
            textAlign: effectiveAlign,
            textShadow: '0 2px 10px rgba(0,0,0,0.8)',
          }}
        >
          {title}
        </div>
      )}

      <div
        style={{
          fontFamily: effectiveFont,
          fontWeight: effectiveWeight,
          color: effectiveColor,
          fontSize: effectiveFontSize,
          lineHeight: 1,
          letterSpacing: (style?.letterSpacing as string) || '-1.5px',
          fontVariantNumeric: 'tabular-nums',
          fontFeatureSettings: '"tnum"',
          textShadow: `0 0 35px ${withAlpha(effectiveColor, '55', 0.35)}, 0 10px 30px rgba(0,0,0,0.8)`,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent:
            effectiveAlign === 'left'
              ? 'flex-start'
              : effectiveAlign === 'right'
              ? 'flex-end'
              : 'center',
          transform: `scale(${popScale})`,
        }}
      >
        {effectivePrefix && (
          <span style={{ fontSize: '0.65em', opacity: 0.9, marginRight: '4px' }}>
            {effectivePrefix}
          </span>
        )}
        <span>{formattedNumber}</span>
        {effectiveSuffix && (
          <span style={{ fontSize: '0.65em', opacity: 0.9, marginLeft: '4px' }}>
            {effectiveSuffix}
          </span>
        )}
      </div>
    </div>
  );
};
