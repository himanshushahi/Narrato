import React from 'react';
import { useCurrentFrame, spring, interpolate } from 'remotion';
import * as d3Geo from 'd3-geo';
import * as topojson from 'topojson-client';
import worldData from './world-110m.json';

interface Props {
  type: 'chart' | 'map' | 'document' | 'network';
  meta: any;
  durationInFrames: number;
  subtitleSettings?: any;
}

export const DataVisualizations: React.FC<Props> = ({ type, meta, subtitleSettings }) => {
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
      { label: 'Jan', value: 20 },
      { label: 'Feb', value: 50 },
      { label: 'Mar', value: 80 },
      { label: 'Apr', value: 65 }
    ];

    const chartWidth = 1400;
    const chartHeight = 750;
    const padding = { top: 180, right: 80, bottom: 80, left: 140 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    const formatValue = (val: number) => {
      if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
      if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
      return Math.round(val);
    };

    const maxVal = Math.max(...rawData.map((d: any) => d.value), 1);

    // Bar Width and Spacing
    const barWidth = Math.min(100, (innerWidth / rawData.length) * 0.5);
    const xStep = rawData.length > 1 ? innerWidth / (rawData.length - 1) : innerWidth;

    // No zoom - static stable frame
    const zoomScale = 1;
    
    const primaryColor = subtitleSettings?.chart_primary_color || '#fbbf24';
    const textColor = subtitleSettings?.chart_text_color || '#fef3c7';

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#1c1917',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Background Vintage Vignette */}
        <div style={{
            position: 'absolute',
            inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none',
            zIndex: 10
        }} />

        <div style={{
            position: 'absolute',
            width: chartWidth,
            height: chartHeight,
            transform: `scale(${zoomScale})`,
            transformOrigin: 'center center'
        }}>
            {/* Chart Header */}
            <h2 style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 900,
              fontSize: 56,
              color: textColor,
              textAlign: 'center',
              textTransform: 'uppercase',
              letterSpacing: 4,
              textShadow: '0 4px 20px rgba(217, 119, 6, 0.5)',
              margin: 0,
              position: 'absolute',
              top: 20,
              width: '100%',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
            }}>
              {meta.title || 'Statistical Overview'}
            </h2>

            <svg width={chartWidth} height={chartHeight} style={{ overflow: 'visible' }}>
                <defs>
                    <linearGradient id="barGradientFront" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={primaryColor} />
                        <stop offset="100%" stopColor={primaryColor} stopOpacity={0.6} />
                    </linearGradient>
                    <linearGradient id="barGradientSide" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={primaryColor} stopOpacity={0.8} />
                        <stop offset="100%" stopColor={primaryColor} stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="barGradientTop" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={primaryColor} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={primaryColor} stopOpacity={0.5} />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="12" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>

                <g transform={`translate(${padding.left}, ${padding.top})`}>
                    {/* Y-Axis Grid Lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                        const y = innerHeight - (innerHeight * tick);
                        const val = maxVal * tick;
                        const drawProgress = interpolate(frame - (i*4), [0, 25], [0, innerWidth], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                        
                        return (
                            <g key={`grid-${i}`}>
                                <line
                                    x1={0} y1={y} x2={drawProgress} y2={y}
                                    stroke="#44403c" strokeWidth="2" strokeDasharray="8 8"
                                />
                                <text
                                    x={-25} y={y + 8}
                                    fill="#a8a29e" fontFamily="Montserrat, sans-serif" fontSize="22" fontWeight="700" textAnchor="end"
                                    opacity={animProgress}
                                    style={{
                                        WebkitFontSmoothing: 'antialiased',
                                        MozOsxFontSmoothing: 'grayscale',
                                    }}
                                >
                                    {formatValue(val)}
                                </text>
                            </g>
                        );
                    })}

                    {/* Chart Bars / Lines */}
                    {chartType === 'line' ? (
                        <g>
                            {/* D3 Path String Generation Manually */}
                            <path 
                                d={`M ${rawData.map((d: any, i: number) => {
                                    const x = i * xStep;
                                    const y = innerHeight - ((d.value / maxVal) * innerHeight * animProgress);
                                    return `${x},${y}`;
                                }).join(' L ')}`}
                                fill="none"
                                stroke={primaryColor}
                                strokeWidth="8"
                                filter="url(#glow)"
                            />
                            {/* Nodes */}
                            {rawData.map((d: any, i: number) => {
                                const x = i * xStep;
                                const targetY = innerHeight - ((d.value / maxVal) * innerHeight);
                                const y = innerHeight - ((d.value / maxVal) * innerHeight * animProgress);
                                const nodeAnim = spring({ frame: frame - i * 4, fps: 30, config: { damping: 12 } });
                                
                                return (
                                    <g key={`node-${i}`} transform={`translate(${x}, ${y})`} opacity={nodeAnim}>
                                        <circle r={10} fill="#fffbeb" />
                                        <circle r={20} fill="none" stroke={primaryColor} strokeWidth="4" opacity="0.8" filter="url(#glow)" />
                                        <text y={-30} fill={textColor} fontFamily="Montserrat, sans-serif" fontSize="28" fontWeight="800" textAnchor="middle"
                                            style={{
                                                WebkitFontSmoothing: 'antialiased',
                                                MozOsxFontSmoothing: 'grayscale',
                                            }}
                                        >
                                            {formatValue(d.value * animProgress)}
                                        </text>
                                        <text y={targetY - y + 50} fill="#d6d3d1" fontFamily="Montserrat, sans-serif" fontSize="22" fontWeight="700" textAnchor="middle"
                                            style={{
                                                WebkitFontSmoothing: 'antialiased',
                                                MozOsxFontSmoothing: 'grayscale',
                                            }}
                                        >
                                            {d.label}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    ) : (
                        // Faux 3D Bars
                        <g>
                            {rawData.map((d: any, i: number) => {
                                const x = (innerWidth / rawData.length) * i + (innerWidth / rawData.length - barWidth) / 2;
                                const targetH = (d.value / maxVal) * innerHeight;
                                const h = targetH * animProgress;
                                const y = innerHeight - h;
                                const depth = 20; // 3D depth thickness

                                return (
                                    <g key={`bar-${i}`}>
                                        {/* Side polygon for 3D effect */}
                                        <polygon 
                                            points={`${x+barWidth},${y} ${x+barWidth+depth},${y-depth} ${x+barWidth+depth},${innerHeight-depth} ${x+barWidth},${innerHeight}`}
                                            fill="url(#barGradientSide)"
                                        />
                                        {/* Top polygon */}
                                        <polygon 
                                            points={`${x},${y} ${x+depth},${y-depth} ${x+barWidth+depth},${y-depth} ${x+barWidth},${y}`}
                                            fill="url(#barGradientTop)"
                                        />
                                        {/* Front Face */}
                                        <rect 
                                            x={x} y={y} width={barWidth} height={h} 
                                            fill="url(#barGradientFront)"
                                            filter="url(#glow)"
                                        />
                                        
                                        {/* Value Label */}
                                        <text
                                            x={x + barWidth / 2} y={y - depth - 20}
                                            fill={textColor} fontFamily="Montserrat, sans-serif" fontSize="28" fontWeight="900" textAnchor="middle"
                                            opacity={animProgress}
                                            style={{
                                                WebkitFontSmoothing: 'antialiased',
                                                MozOsxFontSmoothing: 'grayscale',
                                            }}
                                        >
                                            {formatValue(d.value * animProgress)}
                                        </text>
                                        {/* X-Axis Label */}
                                        <text
                                            x={x + barWidth / 2} y={innerHeight + 40}
                                            fill="#d6d3d1" fontFamily="Montserrat, sans-serif" fontSize="22" fontWeight="700" textAnchor="middle"
                                            style={{
                                                WebkitFontSmoothing: 'antialiased',
                                                MozOsxFontSmoothing: 'grayscale',
                                            }}
                                        >
                                            {d.label}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    )}
                </g>
            </svg>
        </div>
      </div>
    );
  };

  // Render Map Outline
  const renderMap = () => {
    // TopoJSON to GeoJSON
    // The "countries-110m.json" from world-atlas has a "countries" object in "objects"
    const countries = topojson.feature(worldData as any, worldData.objects.countries as any);

    const locations = meta.locations || [
      { name: 'Start', coord: [28.6139, 77.2090] }, // Delhi
      { name: 'End', coord: [51.5074, -0.1278] } // London
    ];

    // Map container size
    const width = 1920;
    const height = 1080;

    // Compute bounding box for given locations to focus map
    let projection = d3Geo.geoMercator().scale(300).translate([width / 2, height / 1.5]);

    if (locations.length > 0) {
        // Create a GeoJSON FeatureCollection of our points
        const pointsFeature = {
            type: "FeatureCollection",
            features: locations.map((loc: any) => ({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [loc.coord[1], loc.coord[0]] // GeoJSON uses [longitude, latitude]!
                }
            }))
        };

        // Use fitExtent to scale and center projection around points, with padding
        projection = d3Geo.geoMercator().fitExtent([[300, 300], [width - 300, height - 300]], pointsFeature as any);
        
        // If there's only one point, the scale might be infinite, so cap it
        if (locations.length === 1) {
             const centerCoord = [locations[0].coord[1], locations[0].coord[0]];
             projection = d3Geo.geoMercator().scale(1500).center(centerCoord as any).translate([width / 2, height / 2]);
        }
    }

    const pathGenerator = d3Geo.geoPath().projection(projection);

    // Compute route lines drawing progress
    const lineDraw = interpolate(frame, [15, 90], [2000, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    
    // No zoom - static stable frame
    const zoomScale = 1;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#1c1917',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Animated Map Container */}
        <div style={{
            position: 'absolute',
            width,
            height,
            transform: `scale(${zoomScale})`,
            transformOrigin: 'center center'
        }}>
            {/* SVG Topographical Map */}
            <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
                {/* Background Ocean Color */}
                <rect width="100%" height="100%" fill="#292524" />
                
                {/* Vintage Grid lines background */}
                <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                    <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#44403c" strokeWidth="1" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Country Borders */}
                <g opacity="0.8">
                    {(countries as any).features.map((feature: any, i: number) => (
                        <path 
                            key={i} 
                            d={pathGenerator(feature) || ""} 
                            fill="#3f3f46" 
                            stroke="#57534e" 
                            strokeWidth="1.5" 
                            strokeLinejoin="round" 
                        />
                    ))}
                </g>

                {/* Draw Path connecting locations */}
                {locations.length > 1 && (
                <path
                    d={pathGenerator({
                        type: "LineString",
                        coordinates: locations.map((loc: any) => [loc.coord[1], loc.coord[0]])
                    } as any) || ""}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="5"
                    strokeDasharray="15 10"
                    style={{
                        strokeDashoffset: lineDraw
                    }}
                />
                )}

                {/* Plot glowing nodes */}
                {locations.map((loc: any, i: number) => {
                    const projected = projection([loc.coord[1], loc.coord[0]]);
                    if (!projected) return null;
                    const [cx, cy] = projected;

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
                                r={25}
                                fill="rgba(239, 68, 68, 0.3)"
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
                                y={cy + 6}
                                fill="#f5f5f4"
                                fontFamily="Montserrat, sans-serif"
                                fontWeight="800"
                                fontSize="24"
                                textAnchor="start"
                                dominantBaseline="middle"
                                style={{
                                    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                                    WebkitFontSmoothing: 'antialiased',
                                    MozOsxFontSmoothing: 'grayscale',
                                }}
                                vectorEffect="non-scaling-stroke"
                            >
                                {loc.name}
                            </text>
                        </g>
                    );
                })}
            </svg>
            
            {/* Vignette Overlay for Vintage feel */}
            <div style={{
                position: 'absolute',
                inset: 0,
                boxShadow: 'inset 0 0 150px rgba(0,0,0,0.8)',
                pointerEvents: 'none'
            }} />
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

    // Handle highlighted text if specified
    const highlightTarget = meta.highlight_text || '';
    let beforeHighlight = text;
    let highlightSegment = '';
    let afterHighlight = '';

    if (highlightTarget && text.includes(highlightTarget)) {
      const parts = text.split(highlightTarget);
      beforeHighlight = parts[0];
      highlightSegment = highlightTarget;
      afterHighlight = parts.slice(1).join(highlightTarget);
    }

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
            
            {/* Text rendering with optional highlight */}
            {highlightSegment ? (
              <>
                {beforeHighlight.slice(textProgress > 0 ? 1 : 0, Math.max(0, textProgress))}
                {textProgress > beforeHighlight.length && (
                  <span style={{
                    backgroundColor: 'rgba(251, 191, 36, 0.4)', // Amber highlighter
                    padding: '0 4px',
                    borderRadius: '2px',
                    boxShadow: '0 0 10px rgba(251, 191, 36, 0.2)'
                  }}>
                    {highlightSegment.slice(0, Math.max(0, textProgress - beforeHighlight.length))}
                  </span>
                )}
                {textProgress > beforeHighlight.length + highlightSegment.length && (
                  afterHighlight.slice(0, Math.max(0, textProgress - beforeHighlight.length - highlightSegment.length))
                )}
              </>
            ) : (
              text.slice(textProgress > 0 ? 1 : 0, textProgress)
            )}
            
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

  // Render Network / String Board
  const renderNetwork = () => {
    let rawNodes = meta.nodes || [
      { id: '1', label: 'Company A', x: 400, y: 300, type: 'entity' },
      { id: '2', label: 'Subject', x: 960, y: 540, type: 'person' },
      { id: '3', label: 'Offshore', x: 1500, y: 300, type: 'entity' },
      { id: '4', label: 'Bank', x: 960, y: 800, type: 'entity' }
    ];

    const nodes = rawNodes.map((n: any, i: number) => {
      if (n.x !== undefined && n.y !== undefined) return n;
      const angle = (i / rawNodes.length) * Math.PI * 2;
      return {
        ...n,
        x: 960 + Math.cos(angle) * 350,
        y: 540 + Math.sin(angle) * 350
      };
    });
    
    const edges = meta.edges || [
      { source: '1', target: '2' },
      { source: '2', target: '3' },
      { source: '3', target: '4' },
      { source: '2', target: '4' }
    ];

    const zoomScale = 1;

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#1c1917',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.1,
          backgroundImage: 'radial-gradient(#ffffff 2px, transparent 2px)',
          backgroundSize: '40px 40px'
        }} />
        
        <div style={{
          position: 'absolute',
          width: 1920,
          height: 1080,
          transform: `scale(${zoomScale})`
        }}>
          {/* Draw Edges */}
          <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
            {edges.map((edge: any, i: number) => {
              const sourceNode = nodes.find((n: any) => n.id === edge.source);
              const targetNode = nodes.find((n: any) => n.id === edge.target);
              if (!sourceNode || !targetNode) return null;

              const dx = targetNode.x - sourceNode.x;
              const dy = targetNode.y - sourceNode.y;
              const dist = Math.sqrt(dx * dx + dy * dy);

              const lineDraw = interpolate(
                frame - i * 15,
                [0, 30],
                [dist, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              );

              return (
                <line
                  key={`edge-${i}`}
                  x1={sourceNode.x}
                  y1={sourceNode.y}
                  x2={targetNode.x}
                  y2={targetNode.y}
                  stroke="#ef4444"
                  strokeWidth="6"
                  strokeDasharray={dist}
                  strokeDashoffset={lineDraw}
                  style={{ filter: 'drop-shadow(0px 5px 10px rgba(0,0,0,0.5))' }}
                />
              );
            })}
          </svg>

          {/* Draw Nodes */}
          {nodes.map((node: any, i: number) => {
            const nodeScale = spring({
              frame: frame - i * 10,
              fps: 30,
              config: { damping: 12, stiffness: 100 }
            });

            return (
              <div
                key={`node-${i}`}
                style={{
                  position: 'absolute',
                  left: node.x,
                  top: node.y,
                  transform: `translate(-50%, -50%) scale(${nodeScale})`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}
              >
                <div style={{
                  width: node.type === 'person' ? 140 : 100,
                  height: node.type === 'person' ? 140 : 100,
                  backgroundColor: '#f5f5f4',
                  borderRadius: node.type === 'person' ? '50%' : '12px',
                  border: '4px solid #44403c',
                  boxShadow: '0 15px 25px rgba(0,0,0,0.8)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  overflow: 'hidden'
                }}>
                  {node.image ? (
                    <img src={node.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 40, color: '#1c1917' }}>{node.label.charAt(0)}</span>
                  )}
                </div>
                {/* Pin */}
                <div style={{
                  position: 'absolute',
                  top: -15,
                  width: 20,
                  height: 20,
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.4), 0 5px 10px rgba(0,0,0,0.6)'
                }} />
                
                <div style={{
                  marginTop: 15,
                  backgroundColor: '#f5f5f4',
                  padding: '5px 15px',
                  borderRadius: 4,
                  boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
                  fontFamily: 'Montserrat, sans-serif',
                  fontWeight: 800,
                  fontSize: 20,
                  color: '#1c1917',
                  WebkitFontSmoothing: 'antialiased',
                  MozOsxFontSmoothing: 'grayscale',
                }}>
                  {node.label}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
            position: 'absolute',
            inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none'
        }} />
      </div>
    );
  };

  // Router to specific visual renderer
  if (type === 'map') return renderMap();
  if (type === 'document') return renderDocument();
  if (type === 'network') return renderNetwork();
  return renderChart();
};
