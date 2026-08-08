import React from 'react';
import { useCurrentFrame, spring, interpolate, useVideoConfig, Img } from 'remotion';
import * as d3Geo from 'd3-geo';
import * as topojson from 'topojson-client';
import worldData from './world-110m.json';

interface Props {
  type: 'map' | 'document' | 'network';
  meta: any;
  durationInFrames: number;
}

export const DataVisualizations: React.FC<Props> = ({ type, meta, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const renderMap = () => {
    // TopoJSON to GeoJSON
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

    // Determine Start and End coordinates (coord[0] = Lat, coord[1] = Lon)
    const startLon = locations.length > 0 ? locations[0].coord[1] : 0;
    const startLat = locations.length > 0 ? locations[0].coord[0] : 0;
    const endLon = locations.length > 1 ? locations[1].coord[1] : startLon;
    const endLat = locations.length > 1 ? locations[1].coord[0] : startLat;

    // Animate rotation over the duration of the frame
    // We negative the coordinates to center them on the screen
    const animDuration = durationInFrames > 0 ? durationInFrames * 0.7 : 300;
    const currentLonRot = interpolate(frame, [0, animDuration], [-startLon, -endLon], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
    const currentLatRot = interpolate(frame, [0, animDuration], [-startLat, -endLat], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

    // 3D Globe Projection
    let projection = d3Geo.geoOrthographic()
      .scale(height * 0.42)
      .translate([width / 2, height / 2])
      .rotate([currentLonRot, currentLatRot, 0]);

    const pathGenerator = d3Geo.geoPath().projection(projection);

    // Compute route lines drawing progress
    const lineDraw = interpolate(frame, [15, 90], [2000, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    
    const zoomScale = 1;
    const sphere = { type: "Sphere" };
    const graticule = d3Geo.geoGraticule10();

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
        <div style={{
            position: 'absolute',
            width,
            height,
            transform: `scale(${zoomScale})`,
            transformOrigin: 'center center'
        }}>
            <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
                {/* SVG Filters for Glow */}
                <defs>
                  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="15" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                  <filter id="atmosphere">
                    <feGaussianBlur stdDeviation="30" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Background Ocean/Space */}
                <rect width="100%" height="100%" fill="#1c1917" />
                
                {/* Atmosphere Glow */}
                <path 
                    d={pathGenerator(sphere as any) || ""} 
                    fill={theme.bg} 
                    stroke={theme.route} 
                    strokeWidth="15" 
                    opacity="0.15"
                    filter="url(#atmosphere)" 
                />

                {/* Ocean / Sphere Fill */}
                <path 
                    d={pathGenerator(sphere as any) || ""} 
                    fill={theme.bg} 
                    stroke={theme.landStroke}
                    strokeWidth="2" 
                />

                {/* Graticule (Grid lines) */}
                <path 
                    d={pathGenerator(graticule as any) || ""} 
                    fill="none" 
                    stroke={theme.grid} 
                    strokeWidth="1" 
                    opacity="0.5" 
                />

                {/* Country Borders */}
                <g opacity={mapStyle === 'minimal_light' ? "1" : "0.9"}>
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
                    filter="url(#glow)"
                />
                )}

                {/* Plot glowing nodes */}
                {locations.map((loc: any, i: number) => {
                    // Make sure node is not behind the globe (hidden)
                    const isVisible = d3Geo.geoDistance([currentLonRot * -1, currentLatRot * -1], [loc.coord[1], loc.coord[0]]) < Math.PI / 2 + 0.1;

                    const projected = projection([loc.coord[1], loc.coord[0]]);
                    if (!projected) return null;
                    const [cx, cy] = projected;

                    const nodeScale = spring({
                        frame: frame - i * 15,
                        fps: 30,
                        config: { damping: 10, stiffness: 100 }
                    });

                    return (
                        <g key={i} style={{ opacity: isVisible ? nodeScale : 0, transition: 'opacity 0.2s' }}>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={25}
                                fill={theme.nodeGlow}
                                filter="url(#glow)"
                            />
                            <circle
                                cx={cx}
                                cy={cy}
                                r={8}
                                fill={theme.nodeFill}
                                stroke={mapStyle === 'minimal_light' ? '#ffffff' : theme.bg}
                                strokeWidth="2"
                            />
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
    const imageScale = meta.image_scale ?? 100;
    const newspaperTheme = meta.newspaper_theme || 'modern';

    const isVintage = newspaperTheme === 'vintage';
    const outerBg = isVintage ? '#d4c5a9' : '#f3f4f6';
    const paperBg = isVintage ? '#f2e6c9' : '#fdfbf7';
    const paperBorder = isVintage ? '#b8a88a' : '#e5e5e5';
    const textColor = isVintage ? '#2c1810' : '#111827';
    const accentColor = isVintage ? '#8b6914' : '#000';
    const dividerColor = isVintage ? '#5c3d2e' : '#000';

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
        backgroundColor: outerBg,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* --- Crisp Newspaper Container --- */}
        <div style={{
          width: 'min(95%, 1200px)',
          minHeight: 800,
          maxHeight: '96%',
          overflow: 'hidden',
          backgroundColor: paperBg,
          border: `1px solid ${paperBorder}`,
          boxShadow: '0 20px 40px rgba(0,0,0,0.1), 0 5px 15px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
          color: textColor,
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
              color: accentColor,
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
            borderTop: `4px solid ${dividerColor}`,
            borderBottom: `2px solid ${dividerColor}`,
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
                color: accentColor,
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
              <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: `${imageScale}%`,
                  height: 450 * (imageScale / 100),
                  maxHeight: 450 * (imageScale / 100),
                  backgroundColor: isVintage ? '#d4c5a9' : '#e5e7eb',
                  border: `1px solid ${isVintage ? '#b8a88a' : '#d1d5db'}`,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {imageUrl ? (
                    <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(100%) contrast(1.1)' }} />
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
                borderTop: `2px solid ${dividerColor}`,
                borderBottom: `1px solid ${paperBorder}`,
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
  return null;
};
