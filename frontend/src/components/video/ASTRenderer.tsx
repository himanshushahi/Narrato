import React from 'react';
import { AbsoluteFill, Img, Video } from 'remotion';
import { ASTAnimator, ASTAnimation } from './ASTAnimator';
import { DataVisualizations } from './DataVisualizations';
import { getMediaUrlSync } from '../../utils/mediaUrl';

export interface ASTLayerContent {
  type: 'Image' | 'Video' | 'Text' | 'Map' | 'HTML';
  local_path?: string;
  text?: string;
  font?: string;
  weight?: string;
  color?: string;
  html_content?: string;
  locations?: { name?: string, coord: [number, number] }[];
  map_style?: string;
  style?: React.CSSProperties;
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

const AsyncMediaNode: React.FC<{ type: 'Image' | 'Video'; localPath: string; style?: React.CSSProperties }> = ({ type, localPath, style }) => {
  const [url, setUrl] = React.useState<string>('');

  React.useEffect(() => {
    let active = true;
    const fetchUrl = async () => {
      if (!window.__file_server_port__ && window.pywebview?.api?.get_file_server_port) {
        try {
          window.__file_server_port__ = await window.pywebview.api.get_file_server_port();
        } catch (e) {}
      } else if (!window.__file_server_port__) {
        // Wait briefly in case pywebview is slow to inject
        await new Promise(r => setTimeout(r, 500));
        if (window.pywebview?.api?.get_file_server_port) {
          try {
            window.__file_server_port__ = await window.pywebview.api.get_file_server_port();
          } catch (e) {}
        }
      }
      
      if (active) {
        setUrl(getMediaUrlSync(localPath));
      }
    };
    
    fetchUrl();
    return () => { active = false; };
  }, [localPath]);

  if (!url) return null;

  const defaultStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  const mergedStyle = { ...defaultStyle, ...style };

  if (type === 'Image') {
    return <Img src={url} style={mergedStyle} />;
  }
  return <Video src={url} style={mergedStyle} />;
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
          node = <AsyncMediaNode type={content.type} localPath={content.local_path} style={mediaStyle} />;
        } else if (content.type === 'Text') {
          // Default text: centered fullscreen. Custom style overrides positioning.
          const defaultTextStyle: React.CSSProperties = hasCustomLayout
            ? {
                color: content.color || '#fff',
                fontFamily: content.font || 'Inter, sans-serif',
                fontWeight: content.weight || 'bold',
                fontSize: '120px',
                ...innerStyle,
              }
            : {
                position: 'absolute', width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: content.color || '#fff',
                fontFamily: content.font || 'Inter, sans-serif',
                fontWeight: content.weight || 'bold',
                fontSize: '120px',
                textAlign: 'center',
                ...innerStyle,
              };
          node = (
            <div style={defaultTextStyle}>
              {content.text}
            </div>
          );
        } else if (content.type === 'Map') {
          // Duration in frames can be approximated from fps
          // The true duration in frames is passed to sequence, but we can pass an arbitrary large number or calculate it 
          // We'll calculate it safely based on the sequence duration or fallback.
          node = (
            <DataVisualizations 
              locations={content.locations} 
              map_style={content.map_style}
              durationInFrames={300} // Default since we don't pass sequence duration down here directly
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

