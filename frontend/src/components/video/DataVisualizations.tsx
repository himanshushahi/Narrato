import React from 'react';
import { useCurrentFrame, spring, interpolate, useVideoConfig, Img } from 'remotion';
import * as d3Geo from 'd3-geo';
import * as d3Shape from 'd3-shape';
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
  const { width, height } = useVideoConfig();

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

    const chartWidth = width * 0.85;
    const chartHeight = height * 0.65;
    const padding = { top: chartHeight * 0.28, right: chartWidth * 0.05, bottom: chartHeight * 0.15, left: chartWidth * 0.1 };
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
    const isMulticolor = subtitleSettings?.chart_multicolor === true;
    const titleFontSize = subtitleSettings?.chart_title_font_size !== undefined ? subtitleSettings.chart_title_font_size : 56;
    const labelFontSize = subtitleSettings?.chart_label_font_size !== undefined ? subtitleSettings.chart_label_font_size : 28;
    const axisFontSize = Math.max(12, Math.round(labelFontSize * 22 / 28));
    const colors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6'];
    const getColor = (i: number) => isMulticolor ? colors[i % colors.length] : primaryColor;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: subtitleSettings?.chart_bg_color || '#1c1917',
        position: 'relative',
        overflow: 'hidden'
      }}>
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
              fontSize: titleFontSize,
              color: textColor,
              textAlign: 'center',
              textTransform: 'uppercase',
              letterSpacing: 4,
              textShadow: '0 4px 20px rgba(217, 119, 6, 0.5)',
              margin: 0,
              position: 'absolute',
              top: -20,
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
                    {isMulticolor && colors.map((c, i) => (
                        <React.Fragment key={`grad-${i}`}>
                            <linearGradient id={`barGradientFront-${i}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={c} />
                                <stop offset="100%" stopColor={c} stopOpacity={0.6} />
                            </linearGradient>
                            <linearGradient id={`barGradientSide-${i}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={c} stopOpacity={0.8} />
                                <stop offset="100%" stopColor={c} stopOpacity={0.3} />
                            </linearGradient>
                            <linearGradient id={`barGradientTop-${i}`} x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor={c} stopOpacity={0.9} />
                                <stop offset="100%" stopColor={c} stopOpacity={0.5} />
                            </linearGradient>
                        </React.Fragment>
                    ))}
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="12" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>

                {chartType === 'pie' ? (
                  <g transform={`translate(${padding.left + innerWidth / 2}, ${padding.top + innerHeight / 2})`}>
                      {(() => {
                          const pieGenerator = d3Shape.pie<any>().value(d => d.value).sort(null);
                          const pieData = pieGenerator(rawData);
                          const radius = Math.min(innerWidth, innerHeight) / 2;
                          const arcGenerator = d3Shape.arc<any>().innerRadius(0).outerRadius(radius);
                          
                          return pieData.map((d, i) => {
                              const sliceAnim = interpolate(animProgress, [0, 1], [0, d.endAngle - d.startAngle]);
                              const currentArc = d3Shape.arc<any>()
                                  .innerRadius(0)
                                  .outerRadius(radius * (0.5 + animProgress * 0.5)) // pop out effect
                                  .startAngle(d.startAngle)
                                  .endAngle(d.startAngle + sliceAnim);

                              const centroid = arcGenerator.centroid(d);
                              
                              return (
                                  <g key={`pie-${i}`}>
                                      <path 
                                          d={currentArc(d as any) || ""} 
                                          fill={getColor(i)} 
                                          stroke="#1c1917" 
                                          strokeWidth="6" 
                                          filter="url(#glow)"
                                      />
                                      {animProgress > 0.5 && (
                                        <>
                                          <text
                                              transform={`translate(${centroid[0] * 1.35}, ${centroid[1] * 1.35})`}
                                              fill={textColor} fontFamily="Montserrat, sans-serif" fontSize={labelFontSize} fontWeight="900" textAnchor="middle"
                                              opacity={(animProgress - 0.5) * 2}
                                              style={{ textShadow: '0px 4px 12px rgba(0,0,0,0.9)', WebkitFontSmoothing: 'antialiased' }}
                                          >
                                              {formatValue(d.data.value)}
                                          </text>
                                          <text
                                              transform={`translate(${centroid[0] * 1.35}, ${centroid[1] * 1.35 + 40})`}
                                              fill="#f5f5f4" fontFamily="Montserrat, sans-serif" fontSize={axisFontSize} fontWeight="700" textAnchor="middle"
                                              opacity={(animProgress - 0.5) * 2}
                                              style={{ textShadow: '0px 4px 12px rgba(0,0,0,0.9)', WebkitFontSmoothing: 'antialiased' }}
                                          >
                                              {d.data.label}
                                          </text>
                                        </>
                                      )}
                                  </g>
                              );
                          });
                      })()}
                  </g>
                ) : (
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
                                    fill="#a8a29e" fontFamily="Montserrat, sans-serif" fontSize={axisFontSize} fontWeight="700" textAnchor="end"
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
                                stroke={isMulticolor ? colors[0] : primaryColor}
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
                                        <circle r={20} fill="none" stroke={getColor(i)} strokeWidth="4" opacity="0.8" filter="url(#glow)" />
                                        <text y={-30} fill={textColor} fontFamily="Montserrat, sans-serif" fontSize={labelFontSize} fontWeight="800" textAnchor="middle"
                                            style={{
                                                WebkitFontSmoothing: 'antialiased',
                                                MozOsxFontSmoothing: 'grayscale',
                                            }}
                                        >
                                            {formatValue(d.value * animProgress)}
                                        </text>
                                        <text y={targetY - y + 50} fill="#d6d3d1" fontFamily="Montserrat, sans-serif" fontSize={axisFontSize} fontWeight="700" textAnchor="middle"
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
                                            fill={isMulticolor ? `url(#barGradientSide-${i % colors.length})` : "url(#barGradientSide)"}
                                        />
                                        {/* Top polygon */}
                                        <polygon 
                                            points={`${x},${y} ${x+depth},${y-depth} ${x+barWidth+depth},${y-depth} ${x+barWidth},${y}`}
                                            fill={isMulticolor ? `url(#barGradientTop-${i % colors.length})` : "url(#barGradientTop)"}
                                        />
                                        {/* Front Face */}
                                        <rect 
                                            x={x} y={y} width={barWidth} height={h} 
                                            fill={isMulticolor ? `url(#barGradientFront-${i % colors.length})` : "url(#barGradientFront)"}
                                            filter="url(#glow)"
                                        />
                                        
                                        {/* Value Label */}
                                        <text
                                            x={x + barWidth / 2} y={y - depth - 20}
                                            fill={textColor} fontFamily="Montserrat, sans-serif" fontSize={labelFontSize} fontWeight="900" textAnchor="middle"
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
                                            fill="#d6d3d1" fontFamily="Montserrat, sans-serif" fontSize={axisFontSize} fontWeight="700" textAnchor="middle"
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
                )}
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

    const mapStyle = meta.map_style || 'vintage';

    let theme = {
      bg: '#292524',
      grid: '#44403c',
      landFill: '#3f3f46',
      landStroke: '#57534e',
      route: '#f59e0b',
      nodeFill: '#ef4444',
      nodeGlow: 'rgba(239, 68, 68, 0.3)',
      textFill: '#f5f5f4'
    };

    if (mapStyle === 'modern_dark') {
      theme = {
        bg: '#0f172a',
        grid: '#1e293b',
        landFill: '#020617',
        landStroke: '#334155',
        route: '#06b6d4',
        nodeFill: '#0ea5e9',
        nodeGlow: 'rgba(6, 182, 212, 0.4)',
        textFill: '#f8fafc'
      };
    } else if (mapStyle === 'minimal_light') {
      theme = {
        bg: '#f8fafc',
        grid: '#e2e8f0',
        landFill: '#e2e8f0',
        landStroke: '#94a3b8',
        route: '#ef4444',
        nodeFill: '#b91c1c',
        nodeGlow: 'rgba(239, 68, 68, 0.2)',
        textFill: '#0f172a'
      };
    } else if (mapStyle === 'nautical_blue') {
      theme = {
        bg: '#083344',
        grid: '#164e63',
        landFill: '#0e7490',
        landStroke: '#0891b2',
        route: '#ffffff',
        nodeFill: '#fde047',
        nodeGlow: 'rgba(253, 224, 71, 0.4)',
        textFill: '#ffffff'
      };
    }

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
                <rect width="100%" height="100%" fill={theme.bg} />
                
                {/* Vintage Grid lines background */}
                <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                    <path d="M 60 0 L 0 0 0 60" fill="none" stroke={theme.grid} strokeWidth="1" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Country Borders */}
                <g opacity={mapStyle === 'minimal_light' ? "1" : "0.8"}>
                    {(countries as any).features.map((feature: any, i: number) => (
                        <path 
                            key={i} 
                            d={pathGenerator(feature) || ""} 
                            fill={theme.landFill} 
                            stroke={theme.landStroke} 
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
                    stroke={theme.route}
                    strokeWidth={mapStyle === 'minimal_light' ? "6" : "5"}
                    strokeDasharray={mapStyle === 'nautical_blue' ? "5 10" : "15 10"}
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
                                fill={theme.nodeGlow}
                            />
                            {/* Outer circle */}
                            <circle
                                cx={cx}
                                cy={cy}
                                r={8}
                                fill={theme.nodeFill}
                                stroke={mapStyle === 'minimal_light' ? '#ffffff' : theme.bg}
                                strokeWidth="2"
                            />
                            {/* Text Label */}
                            <text
                                x={cx + 15}
                                y={cy + 6}
                                fill={theme.textFill}
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
        </div>


      </div>
    );
  };

  // Render crisp, clean, modern newspaper document
  const renderDocument = () => {
    const text = meta.doc_text || 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
    const title = meta.title || 'DAILY NEWS';
    const subTitle = meta.subtitle || 'BREAKING NEWS';
    const headline = meta.headline || 'Your headline';
    const source = meta.source || 'Associated Press';
    const section = meta.section || 'Business - Politics - Editorial - World - City life';
    const pullQuote = meta.pull_quote || '';
    const showImage = meta.show_image || false;
    const imageUrl = meta.image_url || '';
    const imageCaption = meta.image_caption || '';

    // Fast typewriter text progress
    const charCount = text.length;
    const textProgress = Math.floor(interpolate(frame, [15, 60], [0, charCount], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    }));

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

    // ---- Fast-paced Animation values ----
    const entranceScale = spring({ frame, fps: 30, config: { damping: 14, stiffness: 120 } });
    const slideUp = interpolate(frame, [0, 15], [100, 0], { extrapolateRight: 'clamp' });
    const contentOpacity = interpolate(frame, [10, 20], [0, 1], { extrapolateRight: 'clamp' });
    const inkScale = interpolate(frame, [15, 25], [1.1, 1.0], { extrapolateRight: 'clamp' });

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 40,
        boxSizing: 'border-box',
        backgroundColor: '#f3f4f6', // Clean light gray background
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* --- Crisp Newspaper Container --- */}
        <div style={{
          width: 'min(95%, 1200px)',
          minHeight: 800,
          maxHeight: '96%',
          overflow: 'hidden',
          backgroundColor: '#fdfbf7', // Off-white clean paper color
          border: '1px solid #e5e5e5',
          boxShadow: '0 20px 40px rgba(0,0,0,0.1), 0 5px 15px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
          color: '#111827',
          padding: '40px 48px',
          position: 'relative',
          transform: `scale(${entranceScale}) translateY(${slideUp}px)`,
        }}>

          {/* Masthead Row */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            paddingBottom: 16,
            opacity: contentOpacity 
          }}>
            <h1 style={{
              fontFamily: "'Playfair Display', 'Times New Roman', serif",
              fontWeight: 900,
              fontSize: 72,
              textTransform: 'uppercase',
              letterSpacing: -1,
              margin: 0,
              color: '#000',
              lineHeight: 1
            }}>
              {title}
            </h1>
            <div style={{
              textAlign: 'right',
              fontFamily: "'Times New Roman', serif",
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              marginLeft: 24
            }}>
              <div>{dateStr}</div>
              <div>SPORTS p.32</div>
              <div>WEATHER p.4</div>
            </div>
          </div>

          {/* Top Divider with Sections */}
          <div style={{
            borderTop: '4px solid #000',
            borderBottom: '2px solid #000',
            padding: '6px 0',
            marginBottom: 24,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: "'Times New Roman', serif",
            fontSize: 14,
            fontWeight: 600,
            opacity: contentOpacity
          }}>
            <div>{section}</div>
            <div>50 cents</div>
          </div>

          {/* Main Layout: 1 Column (Full Width) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            opacity: contentOpacity,
            padding: '0 20px'
          }}>
            <div style={{ transform: `scale(${inkScale})`, transformOrigin: 'top center', marginBottom: 20 }}>
              <h2 style={{
                fontFamily: "'Playfair Display', 'Times New Roman', serif",
                fontWeight: 900,
                fontSize: 64,
                lineHeight: 1.1,
                color: '#000',
                margin: '0 0 12px 0',
                textAlign: 'center'
              }}>
                {headline}
              </h2>
              <div style={{
                fontFamily: "'Times New Roman', serif",
                fontSize: 16,
                fontWeight: 600,
                color: '#555',
                textAlign: 'center',
                textTransform: 'uppercase'
              }}>
                By {source} | {subTitle}
              </div>
            </div>

            {/* Image Area */}
            {showImage && (
              <div style={{ marginBottom: 28 }}>
                <div style={{
                  width: '100%',
                  maxHeight: 450,
                  backgroundColor: '#e5e7eb',
                  border: '1px solid #d1d5db',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {imageUrl ? (
                    <Img src={imageUrl} style={{ width: '100%', maxHeight: 450, objectFit: 'contain', filter: 'grayscale(100%) contrast(1.1)' }} />
                  ) : (
                    <div style={{ color: '#9ca3af', fontFamily: 'sans-serif', fontSize: 14 }}>[ IMAGE PLACEHOLDER ]</div>
                  )}
                </div>
                {imageCaption && (
                  <div style={{ marginTop: 8, fontFamily: "'Times New Roman', serif", fontSize: 13, fontStyle: 'italic', color: '#666' }}>
                    {imageCaption}
                  </div>
                )}
              </div>
            )}

            {/* Main Text Content */}
            <div style={{
              fontFamily: "'Times New Roman', serif",
              fontSize: 22,
              lineHeight: 1.6,
              color: '#111',
              textAlign: 'left',
              padding: '0 24px',
              position: 'relative'
            }}>
              
              {/* Invisible Layout Placeholder (Allocates height from frame 0) */}
              <div style={{ opacity: 0, pointerEvents: 'none' }}>
                <span style={{
                  fontSize: 64,
                  lineHeight: 1,
                  paddingRight: 6,
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 900,
                  verticalAlign: 'baseline',
                }}>
                  {text.charAt(0)}
                </span>
                {highlightSegment ? (
                  <>
                    {beforeHighlight.slice(1)}
                    <span style={{ padding: '0 2px' }}>{highlightSegment}</span>
                    {afterHighlight}
                  </>
                ) : (
                  text.slice(1)
                )}
              </div>

              {/* Animated Typed Overlay */}
              <div style={{ position: 'absolute', top: 0, left: 24, right: 24 }}>
                {textProgress > 0 && (
                  <span style={{
                    fontSize: 64,
                    lineHeight: 1,
                    paddingRight: 6,
                    fontFamily: "'Playfair Display', serif",
                    fontWeight: 900,
                    verticalAlign: 'baseline',
                  }}>
                    {text.charAt(0)}
                  </span>
                )}
                
                {/* Highlighted Text Logic */}
                {highlightSegment ? (
                  <>
                    {beforeHighlight.slice(textProgress > 0 ? 1 : 0, Math.max(0, textProgress))}
                    {textProgress > beforeHighlight.length && (
                      <span style={{
                        backgroundColor: '#fef08a', // Fast crisp yellow highlight
                        padding: '0 2px',
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
              </div>
            </div>
            
            {/* Pull Quote */}
            {pullQuote && (
              <div style={{
                marginTop: 36,
                padding: '24px 40px',
                borderTop: '2px solid #000',
                borderBottom: '1px solid #ccc',
                fontFamily: "'Playfair Display', serif",
                fontSize: 32,
                fontStyle: 'italic',
                fontWeight: 700,
                color: '#333',
                textAlign: 'center',
                opacity: textProgress > text.length * 0.5 ? 1 : 0,
              }}>
                "{pullQuote}"
              </div>
            )}
          </div>
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
        x: (width / 2) + Math.cos(angle) * (Math.min(width, height) * 0.35),
        y: (height / 2) + Math.sin(angle) * (Math.min(width, height) * 0.35)
      };
    });
    
    const edges = meta.edges || [
      { source: '1', target: '2' },
      { source: '2', target: '3' },
      { source: '3', target: '4' },
      { source: '2', target: '4' }
    ];

    const zoomScale = 1;
    const theme = meta.theme || 'conspiracy_board';
    
    const themeStyles = {
      conspiracy_board: {
        bgCol: '#1c1917',
        bgStyle: 'radial-gradient(#ffffff 2px, transparent 2px)',
        bgSize: '40px 40px',
        bgOpacity: 0.1,
        lineCol: '#ef4444',
        lineGlow: 'drop-shadow(0px 5px 10px rgba(0,0,0,0.5))',
        nodeBg: '#f5f5f4',
        nodeBorder: '#44403c',
        nodeText: '#1c1917',
        pinCol: '#ef4444',
        nodeShadow: '0 15px 25px rgba(0,0,0,0.8)'
      },
      corporate: {
        bgCol: '#ffffff',
        bgStyle: 'radial-gradient(#94a3b8 2px, transparent 2px)',
        bgSize: '30px 30px',
        bgOpacity: 0.15,
        lineCol: '#3b82f6',
        lineGlow: 'none',
        nodeBg: '#ffffff',
        nodeBorder: '#e2e8f0',
        nodeText: '#1e293b',
        pinCol: 'transparent',
        nodeShadow: '0 4px 15px rgba(0,0,0,0.05)'
      },
      cyberpunk: {
        bgCol: '#000000',
        bgStyle: 'linear-gradient(0deg, transparent 24%, rgba(16, 185, 129, .1) 25%, rgba(16, 185, 129, .1) 26%, transparent 27%, transparent 74%, rgba(16, 185, 129, .1) 75%, rgba(16, 185, 129, .1) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(16, 185, 129, .1) 25%, rgba(16, 185, 129, .1) 26%, transparent 27%, transparent 74%, rgba(16, 185, 129, .1) 75%, rgba(16, 185, 129, .1) 76%, transparent 77%, transparent)',
        bgSize: '50px 50px',
        bgOpacity: 0.8,
        lineCol: '#10b981',
        lineGlow: 'drop-shadow(0px 0px 8px #10b981)',
        nodeBg: '#022c22',
        nodeBorder: '#10b981',
        nodeText: '#34d399',
        pinCol: 'transparent',
        nodeShadow: '0 0 20px rgba(16, 185, 129, 0.4)'
      }
    };

    const s = themeStyles[theme as keyof typeof themeStyles] || themeStyles.conspiracy_board;

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: s.bgCol,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: s.bgOpacity,
          backgroundImage: s.bgStyle,
          backgroundSize: s.bgSize
        }} />
        
        <div style={{
          position: 'absolute',
          width: width,
          height: height,
          transform: `scale(${zoomScale})`
        }}>
          {/* Draw Edges */}
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
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
                  stroke={s.lineCol}
                  strokeWidth="6"
                  strokeDasharray={dist}
                  strokeDashoffset={lineDraw}
                  style={{ filter: s.lineGlow }}
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
                  backgroundColor: s.nodeBg,
                  borderRadius: node.type === 'person' ? '50%' : '12px',
                  border: `4px solid ${s.nodeBorder}`,
                  boxShadow: s.nodeShadow,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  overflow: 'hidden'
                }}>
                  {node.image ? (
                    <Img src={node.image} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 40, color: s.nodeText, fontWeight: 'bold' }}>{node.label.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                {/* Pin */}
                {s.pinCol !== 'transparent' && (
                  <div style={{
                    position: 'absolute',
                    top: -15,
                    width: 20,
                    height: 20,
                    backgroundColor: s.pinCol,
                    borderRadius: '50%',
                    boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.4), 0 5px 10px rgba(0,0,0,0.6)'
                  }} />
                )}
                
                {/* Label */}
                <div style={{
                  marginTop: 15,
                  padding: '8px 16px',
                  backgroundColor: s.nodeBg,
                  border: `2px solid ${s.nodeBorder}`,
                  borderRadius: 6,
                  color: s.nodeText,
                  fontFamily: 'Montserrat, sans-serif',
                  fontWeight: 700,
                  fontSize: 22,
                  boxShadow: s.nodeShadow
                }}>
                  {node.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Router to specific visual renderer
  if (type === 'map') return renderMap();
  if (type === 'document') return renderDocument();
  if (type === 'network') return renderNetwork();
  return renderChart();
};
