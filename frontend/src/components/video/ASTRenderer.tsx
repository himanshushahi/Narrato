import React from 'react';
import { AbsoluteFill, Img, Video } from 'remotion';
import { ASTAnimator, ASTAnimation } from './ASTAnimator';
import { DataVisualizations } from './DataVisualizations';
import { ChartRenderer, ChartDataItem } from './ChartRenderer';
import { ShapeRenderer } from './ShapeRenderer';
import { KineticText } from './KineticText';
import { LottieRenderer } from './LottieRenderer';
import { CameraShakeType } from './CameraNoise';
import { ASTErrorBoundary } from './ASTErrorBoundary';
import { getMediaUrlSync } from '../../utils/mediaUrl';

interface ASTLayerContent {
  type: 'Image' | 'Video' | 'Text' | 'Map' | 'HTML' | 'Chart' | 'Shape' | 'Lottie';
  local_path?: string;
  text?: string;
  font?: string;
  weight?: string | number;
  color?: string;
  html_content?: string;
  locations?: { name?: string; coord: [number, number] }[];
  map_style?: string;
  volume?: number;
  style?: React.CSSProperties;

  // Lottie props
  animation_data?: any;
  lottie_url?: string;
  loop?: boolean;
  playback_rate?: number;
  lottie_direction?: 'forward' | 'backward';

  // Shape props
  shape_type?: 'rectangle' | 'circle' | 'star' | 'triangle' | 'arrow' | 'polygon' | 'path' | 'icon';
  icon_name?: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  width?: number | string;
  height?: number | string;
  corner_radius?: number;
  points?: number;
  inner_radius?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward';
  angle?: number;
  preset_path?: 'route_arch' | 'horizontal_line' | 'pointer_curve' | 'corner_brackets' | 'wave_pulse' | 'circle_reticle';
  path_d?: string;
  view_box?: string;
  draw_animation?: boolean;
  glow?: boolean;

  // Chart props
  chart_type?: 'bar' | 'line' | 'pie' | 'donut' | 'progress';
  data?: ChartDataItem[];
  title?: string;

  // Kinetic Typography props
  animation_mode?: 'static' | 'words_stagger' | 'typewriter' | 'marker_highlight';
  highlight_color?: string;
  highlight_words?: string[];
}

export interface ASTLayer {
  type: 'Layer';
  z_index: number;
  content: ASTLayerContent;
  animations?: ASTAnimation[];
  motion_blur?: boolean;
  shutter_angle?: number;
  camera_shake?: CameraShakeType;
  filters?: string[];
}

// CSS properties that control layout/positioning of the layer container
const LAYOUT_PROPS = new Set([
  'width', 'height', 'top', 'left', 'right', 'bottom',
  'position', 'borderRadius', 'boxShadow', 'overflow',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'border', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight',
  'borderWidth', 'borderStyle', 'borderColor',
  'backgroundColor', 'background', 'backdropFilter', 'WebkitBackdropFilter',
]);

/**
 * Splits a content style object into layout styles (for the container div)
 * and content styles (for the media/text element inside).
 */
function splitStyles(style?: React.CSSProperties): {
  containerStyle: React.CSSProperties;
  contentStyle: React.CSSProperties;
} {
  if (!style) return { containerStyle: {}, contentStyle: {} };

  const containerStyle: Record<string, any> = {};
  const contentStyle: Record<string, any> = {};

  for (const [key, value] of Object.entries(style)) {
    if (LAYOUT_PROPS.has(key)) {
      containerStyle[key] = value;
    } else {
      contentStyle[key] = value;
    }
  }

  return { containerStyle, contentStyle };
}

/**
 * Extracts mix-blend-mode from filters array (it's a CSS property, not a filter)
 * and returns the cleaned filters string and blend mode style.
 */
function parseFilters(filters?: string[]): { filterStyle?: string; blendStyle: React.CSSProperties } {
  if (!filters || filters.length === 0) return { filterStyle: undefined, blendStyle: {} };

  const blendStyle: React.CSSProperties = {};
  const realFilters: string[] = [];

  for (const f of filters) {
    const blendMatch = f.match(/mix-blend-mode:\s*(\w+)/);
    if (blendMatch) {
      blendStyle.mixBlendMode = blendMatch[1] as any;
    } else {
      realFilters.push(f);
    }
  }

  return {
    filterStyle: realFilters.length > 0 ? realFilters.join(' ') : undefined,
    blendStyle,
  };
}

import { delayRender, continueRender, useCurrentFrame, interpolate } from 'remotion';

/**
 * Procedural ambient canvas rendered when stock media has no local path yet or is still downloading.
 * Prevents jarring black screens with high-production animated gradient meshes and vector grids.
 */
const ProceduralCanvasFallback: React.FC<{ query?: string; type: string; style?: React.CSSProperties }> = ({ query: _query, type: _type, style }) => {
  const frame = useCurrentFrame();

  const pulse = interpolate(frame % 150, [0, 75, 150], [0.18, 0.35, 0.18], { extrapolateRight: 'clamp' });
  const driftX = interpolate(frame % 360, [0, 360], [0, 50], { extrapolateRight: 'clamp' });
  const driftY = interpolate(frame % 360, [0, 360], [0, 30], { extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0e17',
        backgroundImage: `
          radial-gradient(circle at ${35 + driftX * 0.1}% ${25 + driftY * 0.1}%, rgba(14, 165, 233, ${pulse}) 0%, transparent 60%),
          radial-gradient(circle at ${75 - driftX * 0.1}% ${75 - driftY * 0.1}%, rgba(99, 102, 241, ${pulse * 0.75}) 0%, transparent 55%),
          linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 100% 100%, 64px 64px, 64px 64px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, transparent 35%, rgba(5, 7, 12, 0.85) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

const AsyncMediaNode: React.FC<{ type: 'Image' | 'Video'; localPath: string; style?: React.CSSProperties; volume?: number }> = ({ type, localPath, style, volume }) => {
  const [url, setUrl] = React.useState<string>('');
  const [handle] = React.useState(() => delayRender("Fetching Media URL"));

  React.useEffect(() => {
    let active = true;
    const fetchUrl = async () => {
      // If rendering headlessly, the port is already injected synchronously via props.
      if (!window.__file_server_port__ && window.pywebview?.api?.get_file_server_port) {
        try {
          window.__file_server_port__ = await window.pywebview.api.get_file_server_port();
        } catch (e) {}
      } else if (!window.__file_server_port__ && typeof window.pywebview !== 'undefined') {
        await new Promise(r => setTimeout(r, 500));
        if (window.pywebview?.api?.get_file_server_port) {
          try {
            window.__file_server_port__ = await window.pywebview.api.get_file_server_port();
          } catch (e) {}
        }
      }
      
      if (active) {
        setUrl(getMediaUrlSync(localPath));
        continueRender(handle);
      }
    };
    
    fetchUrl();
    return () => { active = false; };
  }, [localPath, handle]);

  if (!url) return null;

  const defaultStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  const mergedStyle = { ...defaultStyle, ...style };

  if (type === 'Image') {
    return <Img src={url} style={mergedStyle} />;
  }
  return <Video src={url} style={mergedStyle} muted={volume === 0 || volume === undefined} volume={volume ?? 0} />;
};

export const ASTRenderer: React.FC<{
  composition: { type: 'Sequence'; children: ASTLayer[] };
}> = ({ composition }) => {
  if (!composition || composition.type !== 'Sequence' || !composition.children) {
    return null;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0a09' }}>
      {composition.children.map((layer, idx) => {
        const { content, animations, filters, z_index } = layer;
        const contentStyle = (content as any).style as React.CSSProperties | undefined;
        const { containerStyle: layoutStyle, contentStyle: innerStyle } = splitStyles(contentStyle);
        const { filterStyle, blendStyle } = parseFilters(filters);

        // Check if this layer has custom positioning (not fullscreen)
        const hasCustomLayout = contentStyle && (
          contentStyle.width || contentStyle.height ||
          contentStyle.top || contentStyle.left || contentStyle.right || contentStyle.bottom
        );
        
        let node = null;
        if ((content.type === 'Image' || content.type === 'Video') && content.local_path) {
          // For positioned layers, media fills its container; for fullscreen, apply content styles directly
          const mediaStyle = hasCustomLayout
            ? { objectFit: innerStyle.objectFit || 'cover' as const }
            : innerStyle;
          node = <AsyncMediaNode type={content.type} localPath={content.local_path} style={mediaStyle} volume={content.volume} />;
        } else if (content.type === 'Image' || content.type === 'Video') {
          // Procedural fallback when local media is missing/downloading
          node = <ProceduralCanvasFallback query={(content as any).query} type={content.type} style={innerStyle} />;
        } else if (content.type === 'Text') {
          node = (
            <KineticText
              text={content.text || ''}
              mode={content.animation_mode || 'static'}
              font={content.font}
              weight={content.weight}
              color={content.color}
              highlight_color={content.highlight_color}
              highlight_words={content.highlight_words}
              style={{
                fontSize: hasCustomLayout ? (innerStyle.fontSize || '64px') : '100px',
                ...innerStyle,
              }}
            />
          );
        } else if (content.type === 'Chart') {
          node = (
            <ChartRenderer
              chart_type={content.chart_type}
              data={content.data}
              title={content.title}
              style={innerStyle}
            />
          );
        } else if (content.type === 'Shape') {
          node = (
            <ShapeRenderer
              shape_type={content.shape_type}
              icon_name={content.icon_name}
              fill={content.fill}
              stroke={content.stroke}
              stroke_width={content.stroke_width}
              radius={content.radius}
              width={content.width}
              height={content.height}
              corner_radius={content.corner_radius}
              points={content.points}
              inner_radius={content.inner_radius}
              direction={content.direction as ('up' | 'down' | 'left' | 'right') | undefined}
              angle={content.angle}
              preset_path={content.preset_path}
              path_d={content.path_d}
              view_box={content.view_box}
              draw_animation={content.draw_animation}
              glow={content.glow}
              style={innerStyle}
            />
          );
        } else if (content.type === 'Map') {
          node = (
            <DataVisualizations 
              locations={content.locations} 
              map_style={content.map_style}
              durationInFrames={300}
            />
          );
        } else if (content.type === 'Lottie') {
          node = (
            <LottieRenderer
              animation_data={content.animation_data}
              lottie_url={content.lottie_url}
              loop={content.loop}
              playback_rate={content.playback_rate}
              direction={(content.lottie_direction || content.direction) as ('forward' | 'backward') | undefined}
              style={innerStyle}
            />
          );
        } else if (content.type === 'HTML') {
          const defaultHtmlStyle: React.CSSProperties = hasCustomLayout
            ? { ...innerStyle }
            : { position: 'absolute', width: '100%', height: '100%', ...innerStyle };
          node = (
            <div style={defaultHtmlStyle} dangerouslySetInnerHTML={{ __html: content.html_content || '' }} />
          );
        }

        if (!node) return null;

        // Build the container style: positioned layers get custom layout,
        // fullscreen layers use the legacy 100%x100% default
        const containerBaseStyle: React.CSSProperties = hasCustomLayout
          ? {
              position: 'absolute',
              zIndex: z_index,
              overflow: 'hidden',
              ...layoutStyle,
            }
          : {
              width: '100%',
              height: '100%',
              position: 'absolute',
              zIndex: z_index,
            };

        const inner = (
          <div style={{
            ...containerBaseStyle,
            filter: filterStyle,
            ...blendStyle,
          }}>
            {node}
          </div>
        );

        const { motion_blur, shutter_angle, camera_shake } = layer;

        const renderedLayer = ((animations && animations.length > 0) || motion_blur || (camera_shake && camera_shake !== 'none')) ? (
          <ASTAnimator
            animations={animations}
            motion_blur={motion_blur}
            shutter_angle={shutter_angle}
            camera_shake={camera_shake}
          >
            {inner}
          </ASTAnimator>
        ) : (
          <AbsoluteFill>{inner}</AbsoluteFill>
        );

        return (
          <ASTErrorBoundary key={idx} layerType={content?.type}>
            {renderedLayer}
          </ASTErrorBoundary>
        );
      })}
    </AbsoluteFill>
  );
};

