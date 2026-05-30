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
    // If real news data is fetched, we use it, otherwise fallback to old behavior
    const text = meta.doc_text || 'Archival record text excerpt goes here.';
    const title = meta.title || 'THE CLASSIFIED ARCHIVES'; // Masthead
    const subTitle = meta.subtitle || 'BREAKING NEWS';
    const headline = meta.headline || 'Exclusive Report Uncovers Hidden Details';
    const source = meta.source || 'The Associated Press';

    // Typewriter text progress
    const charCount = text.length;
    // Slow down the typing so it fits the frame better, or scale dynamically
    const textProgress = Math.floor(interpolate(frame, [10, 120], [0, charCount], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    }));

    // Current Date formatting
    const today = new Date();
    const dateStr = meta.date || today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 50,
        boxSizing: 'border-box'
      }}>
        {/* Newspaper Paper Container */}
        <div style={{
          width: 1400,
          minHeight: 850,
          backgroundColor: '#f4f0e6', // Vintage newspaper tone
          border: '1px solid #dcd7cd',
          padding: '40px 60px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.85), inset 0 0 100px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
          color: '#1c1917',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Masthead */}
          <div style={{
            textAlign: 'center',
            paddingBottom: 10,
            marginBottom: 10
          }}>
            <h1 style={{
              fontFamily: 'Merriweather, serif',
              fontWeight: 800,
              fontSize: 64,
              textTransform: 'uppercase',
              letterSpacing: 2,
              margin: 0,
              color: '#0c0a09'
            }}>
              {title}
            </h1>
          </div>

          {/* Newspaper Info Bar (Date, Issue, Volume) */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: '3px double #292524',
            borderBottom: '1px solid #292524',
            padding: '8px 10px',
            marginBottom: 30,
            fontFamily: 'Montserrat, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            color: '#44403c',
            textTransform: 'uppercase',
            letterSpacing: 1
          }}>
            <span>Vol. XCIII... No. 31,520</span>
            <span>{dateStr}</span>
            <span>SPECIAL EDITION</span>
          </div>

          {/* Headline */}
          <div style={{ marginBottom: 25, textAlign: 'center' }}>
            <h2 style={{
              fontFamily: 'Merriweather, serif',
              fontWeight: 700,
              fontSize: 42,
              lineHeight: 1.2,
              color: '#0c0a09',
              margin: 0
            }}>
              {headline}
            </h2>
            <p style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 700,
              fontSize: 16,
              color: '#57534e',
              marginTop: 15,
              textTransform: 'uppercase',
              letterSpacing: 1
            }}>
              By {source} | {subTitle}
            </p>
          </div>
          
          <hr style={{ border: 'none', borderTop: '1px solid #a8a29e', marginBottom: 25 }} />

          {/* Multi-column Body Content */}
          <div style={{
            fontFamily: 'Merriweather, serif',
            fontSize: 20,
            lineHeight: 1.8,
            color: '#1c1917',
            textAlign: 'justify',
            columnCount: 3,
            columnGap: 40,
            columnRule: '1px solid #dcd7cd',
            whiteSpace: 'pre-wrap',
            flex: 1
          }}>
            {/* Drop Cap for first letter, if typed */}
            {textProgress > 0 && (
              <span style={{
                float: 'left',
                fontSize: 68,
                lineHeight: 0.8,
                paddingTop: 8,
                paddingRight: 8,
                paddingLeft: 3,
                fontWeight: 700,
                color: '#0c0a09'
              }}>
                {text.charAt(0)}
              </span>
            )}
            
            {text.slice(textProgress > 0 ? 1 : 0, textProgress)}
            <span style={{
              display: 'inline-block',
              width: 3,
              height: 20,
              backgroundColor: '#1c1917',
              marginLeft: 2,
              verticalAlign: 'bottom',
              opacity: (frame % 15 < 7) ? 1 : 0
            }} />
          </div>

          {/* Faded edge overlay to simulate paper edges */}
          <div style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: 'inset 0 0 60px rgba(0,0,0,0.1)'
          }} />
        </div>
      </div>
    );
  };

  // Router to specific visual renderer
  if (type === 'map') return renderMap();
  if (type === 'document') return renderDocument();
  return renderChart();
};
