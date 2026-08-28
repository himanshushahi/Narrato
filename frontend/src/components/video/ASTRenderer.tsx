import React from 'react';
import { AbsoluteFill, Img, Video } from 'remotion';
import { ASTAnimator, ASTAnimation } from './ASTAnimator';
import { DataVisualizations } from './DataVisualizations';
import { ChartRenderer, ChartDataItem } from './ChartRenderer';
import { CounterRenderer } from './CounterRenderer';
import { MockupRenderer } from './MockupRenderer';
import { TimelineRenderer, TimelineEvent } from './TimelineRenderer';
import { ShapeRenderer } from './ShapeRenderer';
import { KineticText } from './KineticText';
import { getMediaUrlSync } from '../../utils/mediaUrl';

interface ASTLayerContent {
  type: 'Image' | 'Video' | 'Text' | 'Map' | 'HTML' | 'Chart' | 'Counter' | 'Mockup' | 'Timeline' | 'Shape';
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

  // Shape props
  shape_type?: 'rectangle' | 'circle' | 'star' | 'triangle' | 'arrow' | 'polygon' | 'path';
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  points?: number;
  inner_radius?: number;
  path_d?: string;
  draw_animation?: boolean;
  glow?: boolean;

  // Chart props
  chart_type?: 'bar' | 'line' | 'pie' | 'donut' | 'progress';
  data?: ChartDataItem[];
  title?: string;

  // Counter props
  from?: number;
  to?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: string;

  // Mockup props
  preset?: 'social_post' | 'newspaper' | 'browser' | 'document' | 'phone';
  headline?: string;
  author?: string;
  handle?: string;
  avatar_url?: string;
  date?: string;
  body?: string;
  badge?: string;
  image_url?: string;

  // Timeline props
  events?: TimelineEvent[];

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

import { delayRender, continueRender } from 'remotion';

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
        } else if (content.type === 'Counter') {
          node = (
            <CounterRenderer
              from={content.from}
              to={content.to ?? 100}
              prefix={content.prefix}
              suffix={content.suffix}
              decimals={content.decimals}
              label={content.label}
              color={content.color}
              style={innerStyle}
            />
          );
        } else if (content.type === 'Mockup') {
          node = (
            <MockupRenderer
              preset={content.preset}
              headline={content.headline}
              author={content.author}
              handle={content.handle}
              avatar_url={content.avatar_url}
              date={content.date}
              body={content.body}
              badge={content.badge}
              image_url={content.image_url}
              style={innerStyle}
            />
          );
        } else if (content.type === 'Timeline') {
          node = (
            <TimelineRenderer
              events={content.events}
              title={content.title}
              style={innerStyle}
            />
          );
        } else if (content.type === 'Shape') {
          node = (
            <ShapeRenderer
              shape_type={content.shape_type}
              fill={content.fill}
              stroke={content.stroke}
              stroke_width={content.stroke_width}
              radius={content.radius}
              points={content.points}
              inner_radius={content.inner_radius}
              path_d={content.path_d}
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

        if (animations && animations.length > 0) {
          return <ASTAnimator key={idx} animations={animations}>{inner}</ASTAnimator>;
        }

        return <AbsoluteFill key={idx}>{inner}</AbsoluteFill>;
      })}
    </AbsoluteFill>
  );
};

