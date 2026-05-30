import React from 'react';
import { useCurrentFrame, spring, interpolate } from 'remotion';

interface Props {
  type: 'chart' | 'map' | 'document';
  meta: any;
  durationInFrames: number;
}

export const DataVisualizations: React.FC<Props> = ({ type, meta, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Growth animation for charts and vectors
  const animProgress = spring({
    frame,
    fps: 30,
    config: { damping: 14, stiffness: 80, mass: 0.6 }
  });

  // Render Bar/Line Chart
  const renderChart = () => {
    const chartType = meta.chart_type || 'bar';
    const rawData = meta.data || [
      { label: 'A', value: 20 },
      { label: 'B', value: 50 },
      { label: 'C', value: 80 }
    ];

    // Find max value for scaling
    const maxVal = Math.max(...rawData.map((d: any) => d.value), 1);
    const chartWidth = 900;
    const chartHeight = 500;
    const barWidth = 60;
    const gap = 50;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 50
      }}>
        {/* Chart Header */}
        <h2 style={{
          fontFamily: 'Montserrat, sans-serif',
          fontWeight: 800,
          fontSize: 48,
          color: '#fbbf24',
          marginBottom: 60,
          textTransform: 'uppercase',
          letterSpacing: 2
        }}>
          {meta.title || 'Statistical Overview'}
        </h2>

        {/* Chart Grid */}
        <div style={{
          width: chartWidth,
          height: chartHeight,
          borderLeft: '4px solid #78716c',
          borderBottom: '4px solid #78716c',
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-around',
          paddingBottom: 4,
          paddingLeft: 20
        }}>
          {rawData.map((item: any, i: number) => {
            const pct = item.value / maxVal;
            const targetHeight = pct * (chartHeight - 80);
            const heightVal = targetHeight * animProgress; // Grow animation

            return (
              <div 
                key={i} 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  position: 'relative'
                }}
              >
                {/* Bar Value text */}
                <div style={{
                  fontFamily: 'Montserrat, sans-serif',
                  fontWeight: 700,
                  fontSize: 24,
                  color: '#e7e5e4',
                  marginBottom: 10,
                  opacity: animProgress
                }}>
                  {item.value}
                </div>

                {/* Animated Column Bar */}
                {chartType === 'bar' ? (
                  <div style={{
                    width: barWidth,
                    height: heightVal,
                    background: 'linear-gradient(to top, #7c2d12, #ea580c, #f97316)',
                    borderRadius: '4px 4px 0 0',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                  }} />
                ) : (
                  // Line node connector
                  <div style={{
                    position: 'absolute',
                    bottom: heightVal,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: '#ea580c',
                    border: '4px solid #fef3c7',
                    boxShadow: '0 0 10px #ea580c'
                  }} />
                )}

                {/* Axis label */}
                <div style={{
                  fontFamily: 'Montserrat, sans-serif',
                  fontWeight: 600,
                  fontSize: 20,
                  color: '#a8a29e',
                  marginTop: 20,
                  position: 'absolute',
                  bottom: -45,
                  whiteSpace: 'nowrap'
                }}>
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render Map Outline
  const renderMap = () => {
    const locations = meta.locations || [
      { name: 'Start', coord: [300, 300] },
      { name: 'End', coord: [600, 200] }
    ];

    // Compute route lines drawing progress
    const lineDraw = interpolate(frame, [15, 60], [1000, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 40
      }}>
        {/* Map Header */}
        <h2 style={{
          fontFamily: 'Montserrat, sans-serif',
          fontWeight: 800,
          fontSize: 48,
          color: '#f59e0b',
          marginBottom: 40,
          textTransform: 'uppercase',
          letterSpacing: 2
        }}>
          {meta.title || 'Geopolitical Map'}
        </h2>

        {/* SVG Vector Map Container */}
        <div style={{ position: 'relative', width: 1000, height: 600, border: '1px solid #44403c', borderRadius: 8, overflow: 'hidden', backgroundColor: '#111' }}>
          
          {/* Vintage Grid lines background */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.15 }}>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#78716c" strokeWidth="1" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Draw routes and locations */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}>
            {/* Draw Path connecting locations */}
            {locations.length > 1 && (
              <polyline
                points={locations.map((loc: any) => `${loc.coord[0]},${loc.coord[1]}`).join(' ')}
                fill="none"
                stroke="#b45309"
                strokeWidth="5"
                strokeDasharray="10 6"
                style={{
                  strokeDashoffset: lineDraw
                }}
              />
            )}

            {/* Plot glowing nodes */}
            {locations.map((loc: any, i: number) => {
              const [cx, cy] = loc.coord;
              const nodeScale = spring({
                frame: frame - i * 15,
                fps: 30,
                config: { damping: 10, stiffness: 100 }
              });

              return (
                <g key={i} style={{ opacity: nodeScale }}>
                  {/* Glowing radius */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={20}
                    fill="rgba(239, 68, 68, 0.25)"
                  />
                  {/* Outer circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={8}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {/* Text Label */}
                  <text
                    x={cx + 15}
                    y={cy + 5}
                    fill="#f5f5f4"
                    fontFamily="Montserrat, sans-serif"
                    fontWeight="700"
                    fontSize="18"
                    textAnchor="start"
                  >
                    {loc.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  // Render Archival Document / Newspaper print
  const renderDocument = () => {
    const text = meta.doc_text || 'Archival record text excerpt goes here.';
    const title = meta.title || 'THE CLASSIFIED ARCHIVES';
    const subTitle = meta.subtitle || 'Official Telegram Communication';

    // Typewriter text progress
    const charCount = text.length;
    const textProgress = Math.floor(interpolate(frame, [10, 80], [0, charCount], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    }));

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 50
      }}>
        {/* Paper Container */}
        <div style={{
          width: 850,
          backgroundColor: '#eae6df', // vintage paper tone
          border: '1px solid #dcd7cd',
          padding: 60,
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
          display: 'flex',
          flexDirection: 'column',
          color: '#292524',
          position: 'relative'
        }}>
          {/* Top header border line */}
          <div style={{
            borderBottom: '3px double #44403c',
            textAlign: 'center',
            paddingBottom: 20,
            marginBottom: 30
          }}>
            <h1 style={{
              fontFamily: 'Merriweather, serif',
              fontWeight: 700,
              fontSize: 36,
              textTransform: 'uppercase',
              letterSpacing: 2
            }}>
              {title}
            </h1>
            <p style={{
              fontFamily: 'Montserrat, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              color: '#57534e',
              textTransform: 'uppercase',
              marginTop: 5,
              letterSpacing: 1
            }}>
              {subTitle}
            </p>
          </div>

          {/* Typestate Excerpt Content */}
          <div style={{
            fontFamily: 'Merriweather, serif',
            fontSize: 22,
            lineHeight: 1.8,
            color: '#1c1917',
            textAlign: 'justify',
            textIndent: 40,
            minHeight: 250
          }}>
            {text.slice(0, textProgress)}
            <span style={{
              display: 'inline-block',
              width: 3,
              height: 22,
              backgroundColor: '#1c1917',
              marginLeft: 2,
              opacity: (frame % 10 < 5) ? 1 : 0
            }} />
          </div>

          {/* Red Classified stamp watermark */}
          <div style={{
            position: 'absolute',
            bottom: 30,
            right: 50,
            border: '4px solid #dc2626',
            color: '#dc2626',
            fontFamily: 'Montserrat, sans-serif',
            fontWeight: 800,
            fontSize: 24,
            padding: '8px 16px',
            transform: 'rotate(-12deg)',
            textTransform: 'uppercase',
            letterSpacing: 3,
            borderRadius: 4,
            opacity: 0.8
          }}>
            Classified
          </div>
        </div>
      </div>
    );
  };

  // Router to specific visual renderer
  if (type === 'map') return renderMap();
  if (type === 'document') return renderDocument();
  return renderChart();
};
