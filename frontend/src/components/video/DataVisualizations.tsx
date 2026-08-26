import React from 'react';
import { useCurrentFrame, interpolate, useVideoConfig } from 'remotion';
import * as d3Geo from 'd3-geo';
import * as topojson from 'topojson-client';
import worldData from './world-110m.json';
import { getLogicalCanvasSize } from './compositionScale';

const cachedWorldCountries = topojson.feature(worldData as any, worldData.objects.countries as any);

interface MapLocation {
  name?: string;
  coord: [number, number];
}

interface Props {
  locations?: MapLocation[];
  map_style?: string;
  durationInFrames: number;
}

export const DataVisualizations: React.FC<Props> = ({ locations = [], map_style = 'vintage', durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width: configWidth, height: configHeight } = useVideoConfig();
  const { width, height } = getLogicalCanvasSize(configWidth, configHeight);

  // TopoJSON to GeoJSON (memoized)
  const countries = cachedWorldCountries;

  if (!locations || locations.length === 0) {
    locations = [
      { name: 'Start', coord: [28.6139, 77.2090] }, // Delhi
      { name: 'End', coord: [51.5074, -0.1278] } // London
    ];
  }

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

  if (map_style === 'modern_dark') {
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
  } else if (map_style === 'minimal_light') {
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
  } else if (map_style === 'nautical_blue') {
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

  const startLon = locations.length > 0 ? locations[0].coord[1] : 0;
  const startLat = locations.length > 0 ? locations[0].coord[0] : 0;
  const endLon = locations.length > 1 ? locations[1].coord[1] : startLon;
  const endLat = locations.length > 1 ? locations[1].coord[0] : startLat;

  const animDuration = durationInFrames > 0 ? durationInFrames * 0.7 : 300;
  const currentLonRot = interpolate(frame, [0, animDuration], [-startLon, -endLon], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const currentLatRot = interpolate(frame, [0, animDuration], [-startLat, -endLat], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  let projection = d3Geo.geoOrthographic()
    .scale(height * 0.42)
    .translate([width / 2, height / 2])
    .rotate([currentLonRot, currentLatRot, 0]);

  const pathGenerator = d3Geo.geoPath().projection(projection);

  const routeLine = {
    type: 'LineString',
    coordinates: locations.map(loc => [loc.coord[1], loc.coord[0]])
  } as any;

  const routeLengthTotal = 1000;
  const currentRouteLength = interpolate(frame, [0, animDuration], [0, routeLengthTotal], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: theme.bg, position: 'relative' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <radialGradient id="globeShadow" cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="70%" stopColor="rgba(0,0,0,0.4)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.8)" />
          </radialGradient>
        </defs>

        <path
          d={pathGenerator({ type: 'Sphere' }) || ''}
          fill={theme.bg}
          stroke={theme.grid}
          strokeWidth="2"
        />

        <g className="graticule">
          <path
            d={pathGenerator(d3Geo.geoGraticule10()) || ''}
            fill="none"
            stroke={theme.grid}
            strokeWidth="0.5"
            strokeOpacity="0.5"
          />
        </g>

        <g className="landmass">
          <path
            d={pathGenerator(countries as any) || ''}
            fill={theme.landFill}
            stroke={theme.landStroke}
            strokeWidth="1"
          />
        </g>

        <path
          d={pathGenerator({ type: 'Sphere' }) || ''}
          fill="url(#globeShadow)"
          pointerEvents="none"
        />

        <g className="route">
          <path
            d={pathGenerator(routeLine) || ''}
            fill="none"
            stroke={theme.route}
            strokeWidth="4"
            strokeDasharray={routeLengthTotal}
            strokeDashoffset={routeLengthTotal - currentRouteLength}
            strokeLinecap="round"
          />
        </g>

        {locations.map((loc, i) => {
          const projected = projection([loc.coord[1], loc.coord[0]]);
          if (!projected) return null;
          
          const isVisible = interpolate(frame, [0, animDuration * 0.1], [0, 1], { extrapolateRight: 'clamp' });
          const [x, y] = projected;

          return (
            <g key={i} transform={`translate(${x},${y})`} style={{ opacity: isVisible }}>
              <circle r={12} fill={theme.nodeGlow} className="pulse" />
              <circle r={6} fill={theme.nodeFill} />
              {loc.name && (
                <text
                  x={15}
                  y={5}
                  fill={theme.textFill}
                  fontSize="24"
                  fontFamily="Outfit, sans-serif"
                  fontWeight="600"
                  style={{ textShadow: `0 2px 10px ${theme.bg}` }}
                >
                  {loc.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
