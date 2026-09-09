import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';

export interface ChartDataItem {
  label: string;
  value: number;
  color?: string;
}

export interface ChartProps {
  chart_type?: 'bar' | 'line' | 'pie' | 'donut' | 'progress';
  data?: ChartDataItem[];
  title?: string;
  style?: React.CSSProperties;
  durationInFrames?: number;
  /** Title font size px (default 28). */
  title_size?: number;
  /** Bar corner radius px (default 10). */
  bar_radius?: number;
  /** Bar gap px (default 16). */
  bar_gap?: number;
  /** Bar max width px (default 90). */
  bar_max_width?: number;
  /** Neon glow on bars/fills (default true). */
  bar_glow?: boolean;
}

const DEFAULT_PALETTE = ['#00d4ff', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#3b82f6', '#f97316'];

export const ChartRenderer: React.FC<ChartProps> = ({
  chart_type = 'bar',
  data = [],
  title,
  style = {},
  durationInFrames = 90,
  title_size,
  bar_radius,
  bar_gap,
  bar_max_width,
  bar_glow,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Null-safe normalization (hand-edited JSON can carry explicit nulls,
  // which bypass destructuring defaults and would render as "nullpx").
  const safeTitleSize = Math.max(0, title_size ?? 28);
  const safeBarRadius = Math.max(0, bar_radius ?? 10);
  const safeBarGap = Math.max(0, bar_gap ?? 16);
  const safeBarMaxWidth = Math.max(0, bar_max_width ?? 90);
  const safeBarGlow = bar_glow ?? true;

  // Normalize fallback data if none supplied
  const items = useMemo(() => {
    if (data && data.length > 0) return data;
    return [
      { label: 'Q1', value: 35, color: '#00d4ff' },
      { label: 'Q2', value: 58, color: '#38bdf8' },
      { label: 'Q3', value: 82, color: '#10b981' },
      { label: 'Q4', value: 95, color: '#f59e0b' },
    ];
  }, [data]);

  const primaryColor = style.color || '#00d4ff';

  const maxValue = useMemo(() => {
    const max = Math.max(...items.map((d) => d.value), 1);
    return max * 1.15; // 15% headroom
  }, [items]);

  const totalValue = useMemo(() => {
    return items.reduce((acc, d) => acc + Math.max(0, d.value), 0) || 1;
  }, [items]);

  // Overall entrance spring
  const entranceSpr = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 0.9 },
    durationInFrames: Math.min(45, durationInFrames),
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px',
        boxSizing: 'border-box',
        backgroundColor: 'transparent',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: `${safeTitleSize}px`,
            fontWeight: 800,
            color: '#ffffff',
            marginBottom: '20px',
            letterSpacing: '1px',
            textAlign: 'center',
            opacity: entranceSpr,
            transform: `translateY(${(1 - entranceSpr) * -20}px)`,
            textShadow: '0 4px 16px rgba(0,0,0,0.8)',
          }}
        >
          {title}
        </div>
      )}

      <div style={{ width: '100%', flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {chart_type === 'bar' && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: `${safeBarGap}px`, paddingBottom: '32px' }}>
            {items.map((item, idx) => {
              const itemDelay = idx * 4;
              const barSpring = spring({
                frame: Math.max(0, frame - itemDelay),
                fps,
                config: { damping: 12, stiffness: 100, mass: 0.8 },
                durationInFrames: Math.min(40, durationInFrames),
              });

              const targetHeightPercent = (item.value / maxValue) * 100;
              const currentHeightPercent = targetHeightPercent * barSpring;
              const color = item.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
              const displayVal = Math.round(item.value * barSpring);

              return (
                <div key={idx} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', position: 'relative' }}>
                  {/* Value badge */}
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color: '#ffffff',
                      marginBottom: '8px',
                      opacity: barSpring,
                      transform: `scale(${barSpring})`,
                      textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {displayVal}
                  </div>
                  {/* Bar pillar with neon gradient and top cap */}
                  <div
                    style={{
                      width: '100%',
                      maxWidth: `${safeBarMaxWidth}px`,
                      height: `${currentHeightPercent}%`,
                      background: `linear-gradient(to top, ${color}33, ${color})`,
                      borderRadius: `${safeBarRadius}px ${safeBarRadius}px 4px 4px`,
                      boxShadow: safeBarGlow ? `0 0 25px ${color}66, 0 8px 20px rgba(0,0,0,0.5)` : '0 8px 20px rgba(0,0,0,0.5)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      borderBottom: 'none',
                    }}
                  />
                  {/* X-axis label */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-28px',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: 'rgba(255,255,255,0.9)',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      opacity: entranceSpr,
                    }}
                  >
                    {item.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {chart_type === 'line' && (
          <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 800 400" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id={`lineGrad_${primaryColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primaryColor} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={primaryColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Draw points & path */}
              {(() => {
                const padding = 60;
                const width = 800 - padding * 2;
                const height = 400 - padding * 2;
                const step = items.length > 1 ? width / (items.length - 1) : width;

                const points = items.map((d, i) => {
                  const x = padding + i * step;
                  const y = padding + height - (d.value / maxValue) * height;
                  return { x, y, label: d.label, value: d.value };
                });

                const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
                const areaD = `${pathD} L ${points[points.length - 1].x} ${400 - padding} L ${points[0].x} ${400 - padding} Z`;

                const animProgress = interpolate(frame, [0, Math.max(1, Math.min(50, durationInFrames || 90))], [0, 1], {
                  extrapolateRight: 'clamp',
                  easing: Easing.out(Easing.cubic),
                });

                return (
                  <>
                    {/* Area fill */}
                    <path d={areaD} fill={`url(#lineGrad_${primaryColor.replace('#', '')})`} opacity={animProgress * 0.85} />
                    {/* Stroke line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={primaryColor}
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray="2000"
                      strokeDashoffset={2000 * (1 - animProgress)}
                      style={{ filter: `drop-shadow(0 0 12px ${primaryColor}aa)` }}
                    />
                    {/* Node points */}
                    {points.map((p, i) => {
                      const pointDelay = (i / points.length) * 35;
                      const ptSpr = spring({
                        frame: Math.max(0, frame - pointDelay),
                        fps,
                        config: { damping: 10, stiffness: 120 },
                      });
                      return (
                        <g key={i} opacity={ptSpr} transform={`translate(0, ${(1 - ptSpr) * 10})`}>
                          <circle cx={p.x} cy={p.y} r="8" fill="#ffffff" stroke={primaryColor} strokeWidth="4" style={{ filter: `drop-shadow(0 0 8px ${primaryColor})` }} />
                          <text x={p.x} y={p.y - 16} fill="#ffffff" fontSize="18" fontWeight="800" textAnchor="middle" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                            {p.value}
                          </text>
                          <text x={p.x} y={400 - padding + 28} fill="rgba(255,255,255,0.8)" fontSize="16" fontWeight="700" textAnchor="middle">
                            {p.label}
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          </div>
        )}

        {(chart_type === 'donut' || chart_type === 'pie') && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '32px' }}>
            <div style={{ width: '240px', height: '240px', position: 'relative' }}>
              <svg viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                {(() => {
                  let accumulatedPercent = 0;
                  const isPie = chart_type === 'pie';
                  const radius = isPie ? 45 : 70;
                  const strokeWidth = isPie ? 90 : 30;
                  const circumference = 2 * Math.PI * radius;

                  return items.map((item, idx) => {
                    const slicePercent = Math.max(0, item.value) / totalValue;
                    const strokeDasharray = `${circumference * slicePercent} ${circumference * (1 - slicePercent)}`;
                    const strokeDashoffset = -circumference * accumulatedPercent;
                    accumulatedPercent += slicePercent;

                    const anim = spring({
                      frame: Math.max(0, frame - idx * 5),
                      fps,
                      config: { damping: 14, stiffness: 90 },
                    });

                    const color = item.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];

                    return (
                      <circle
                        key={idx}
                        cx="100"
                        cy="100"
                        r={radius}
                        fill="transparent"
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        opacity={anim}
                        style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}
                      />
                    );
                  });
                })()}
              </svg>

              {chart_type === 'donut' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: '26px', fontWeight: 900, color: '#ffffff', textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
                    {totalValue > 100 ? `${Math.round(totalValue)}` : '100%'}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Total
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {items.map((item, idx) => {
                const color = item.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
                const pct = Math.round((item.value / totalValue) * 100);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: entranceSpr }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '4px', backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                    <div style={{ fontSize: '17px', fontWeight: 700, color: '#ffffff' }}>{item.label}</div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>({pct}%)</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {chart_type === 'progress' && (
          <div style={{ width: '90%', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {items.map((item, idx) => {
              const progressSpring = spring({
                frame: Math.max(0, frame - idx * 6),
                fps,
                config: { damping: 14, stiffness: 90 },
              });
              const val = Math.min(100, Math.round(item.value * progressSpring));
              const color = item.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];

              return (
                <div key={idx} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '19px', fontWeight: 700, color: '#ffffff' }}>{item.label}</span>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: color, fontFamily: 'monospace' }}>{val}%</span>
                  </div>
                  <div style={{ width: '100%', height: '16px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
                    <div
                      style={{
                        width: `${val}%`,
                        height: '100%',
                        background: `linear-gradient(to right, ${color}88, ${color})`,
                        borderRadius: '8px',
                        boxShadow: safeBarGlow ? `0 0 16px ${color}aa` : undefined,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
