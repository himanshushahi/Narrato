import React from 'react';
import { AbsoluteFill, Img, Video } from 'remotion';
import { ASTAnimator, ASTAnimation } from './ASTAnimator';
import { DataVisualizations } from './DataVisualizations';
import { ChartRenderer, ChartDataItem } from './ChartRenderer';
import { ShapeRenderer } from './ShapeRenderer';
import { KineticText } from './KineticText';
import { LottieRenderer } from './LottieRenderer';
import { ParticlesRenderer, ParticlePreset } from './ParticlesRenderer';
import { CameraShakeType } from './CameraNoise';
import { ASTErrorBoundary } from './ASTErrorBoundary';
import { FxFilterDefs } from './FxFilterDefs';
import { getMediaUrlSync } from '../../utils/mediaUrl';
import { inferMediaType } from '../../utils/mediaExtensions';

interface ASTLayerContent {
  type: 'Image' | 'Video' | 'Text' | 'Map' | 'HTML' | 'Chart' | 'Shape' | 'Lottie' | 'Particles';
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
  title_size?: number;
  bar_radius?: number;
  bar_gap?: number;
  bar_max_width?: number;
  bar_glow?: boolean;

  // Kinetic Typography props
  animation_mode?: 'static' | 'words_stagger' | 'typewriter' | 'marker_highlight';
  highlight_color?: string;
  highlight_words?: string[];

  // Particles props
  particle_preset?: ParticlePreset;
  particle_count?: number;
  particle_colors?: string[];
  particle_size?: [number, number];
  particle_speed?: number;
  particle_direction?: 'up' | 'down' | 'left' | 'right' | 'outward' | 'twinkle';
  particle_opacity?: number;
}

export interface ASTLayer {
  type: 'Layer';
  z_index: number;
  content: ASTLayerContent;
  animations?: ASTAnimation[];
  motion_blur?: boolean;
  shutter_angle?: number;
  camera_shake?: CameraShakeType;
  transform_origin?: string;
  floating?: boolean;
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
  // Static transform (Layout tab): consumed below into a `transform` string —
  // never spread raw (would double-apply as CSS individual properties).
  'rotate', 'scale', 'scaleX', 'scaleY',
  'aspectRatio',
]);

/**
 * Static rotate/scale from the Layout tab (`content.style.rotate` in degrees,
 * `content.style.scale` as a uniform multiplier, `scaleX`/`scaleY` per axis).
 * Per-axis values win over legacy uniform `scale` when present. Applied on the
 * layer *container*, separate from ASTAnimator's animated transform wrapper
 * so the two compose instead of clobbering each other.
 */
function parseStaticTransform(layoutStyle: Record<string, any>): string | undefined {
  const parts: string[] = [];

  const rawRotate = layoutStyle.rotate;
  const deg =
    typeof rawRotate === 'number'
      ? rawRotate
      : typeof rawRotate === 'string'
        ? parseFloat(rawRotate)
        : NaN;
  if (Number.isFinite(deg) && deg !== 0) {
    parts.push(`rotate(${deg}deg)`);
  }

  const parseAxis = (raw: any): number => {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw !== 0) return raw;
    if (typeof raw === 'string') {
      const t = raw.trim();
      const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return NaN;
  };
  // Legacy uniform scale is the fallback for axes the panel hasn't split yet.
  const legacy = parseAxis(layoutStyle.scale);
  const sxRaw = parseAxis(layoutStyle.scaleX);
  const syRaw = parseAxis(layoutStyle.scaleY);
  const sx = Number.isFinite(sxRaw) ? sxRaw : legacy;
  const sy = Number.isFinite(syRaw) ? syRaw : legacy;
  const norm = (v: number): number => {
    const mag = Math.max(0.01, Math.abs(v));
    return v < 0 ? -mag : mag;
  };
  // Negative scale mirrors (flip) — preserve the sign, clamp magnitude only.
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    if (sx !== 1 || sy !== 1) {
      parts.push(sx === sy ? `scale(${norm(sx)})` : `scale(${norm(sx)}, ${norm(sy)})`);
    }
  } else if (Number.isFinite(sx) && sx !== 1) {
    parts.push(`scale(${norm(sx)}, 1)`);
  } else if (Number.isFinite(sy) && sy !== 1) {
    parts.push(`scale(1, ${norm(sy)})`);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

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
 * Normalizes raw borderRadius strings or numbers to valid CSS values (e.g. 24 -> '24px').
 * Strips zero-forms to undefined so empty/reset styles don't leave dead styling.
 */
function normalizeBorderRadius(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? `${val}px` : undefined;
  }
  const s = String(val).trim();
  if (!s || s === '0' || s === '0px' || s === '0%') return undefined;
  if (/^[-\d.]+$/.test(s)) {
    const num = parseFloat(s);
    return Number.isFinite(num) && num > 0 ? `${num}px` : undefined;
  }
  if (s.endsWith('px')) {
    const num = parseFloat(s.slice(0, -2));
    return Number.isFinite(num) && num > 0 ? `${num}px` : undefined;
  }
  if (s.endsWith('%')) {
    const num = parseFloat(s.slice(0, -1));
    return Number.isFinite(num) && num > 0 ? `${Math.min(50, num)}%` : undefined;
  }
  return s;
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

import { useCurrentFrame, interpolate, getRemotionEnvironment } from 'remotion';
import { QualityMode, QualityPolicy, parseQuality, getGlassBlurCap, optimizeBackdropFilter } from './renderQuality';

/**
 * Procedural ambient canvas rendered when stock media has no local path yet or is still downloading.
 * Prevents jarring black screens with high-production animated gradient meshes and vector grids.
 */
const ProceduralCanvasFallback: React.FC<{ query?: string; type: string; style?: React.CSSProperties }> = ({ query: _query, type: _type, style }) => {
  const frame = useCurrentFrame();

  // Quantize to every 2nd frame: halves style-string churn / repaints with no
  // visible difference on a slow ambient gradient.
  const qFrame = Math.floor(frame / 2) * 2;
  const pulse = interpolate(qFrame % 150, [0, 75, 150], [0.18, 0.35, 0.18], { extrapolateRight: 'clamp' });
  const driftX = interpolate(qFrame % 360, [0, 360], [0, 50], { extrapolateRight: 'clamp' });
  const driftY = interpolate(qFrame % 360, [0, 360], [0, 30], { extrapolateRight: 'clamp' });

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

const MediaNode: React.FC<{
  type: 'Image' | 'Video';
  localPath: string;
  style?: React.CSSProperties;
  volume?: number;
  loop?: boolean;
  query?: string;
}> = ({ type, localPath, style, volume, loop = false, query }) => {
  const url = getMediaUrlSync(localPath);
  // Failure cascade for unplayable media (missing file, 404, zero-byte,
  // unknown codec): Video falls back to <Img> (rescues legacy layers whose
  // declared type mismatches the real file), and ANY terminal <Img> failure
  // falls back to the procedural canvas — so a dead asset degrades to an
  // animated gradient instead of a broken-image glyph or black cut.
  // Display-only fallbacks: never mutate layer data. Reset on path change so
  // a fixed path recovers instead of sticking on a fallback forever.
  const [videoFailed, setVideoFailed] = React.useState(false);
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => { setVideoFailed(false); setImgFailed(false); }, [localPath]);
  // Empty URL means the asset was never downloaded (provider returned 0
  // results, API key missing, download failed, etc.). Degrade to the
  // animated procedural canvas instead of rendering nothing (invisible).
  if (!url) {
    return <ProceduralCanvasFallback query={query} type={type} style={{ width: '100%', height: '100%', objectFit: 'cover' as const, ...style }} />;
  }

  const defaultStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  const mergedStyle = { ...defaultStyle, ...style };

  // Display-only sniffing (no data mutation): if a legacy layer has
  // type='Video' but the file is an image, or type='Image' but the file is a
  // video, pick the true format to avoid FFmpegDemuxer errors / broken <img>.
  // New mismatches cannot be created — the editor rejects them strictly.
  const effectiveType = videoFailed ? 'Image' : inferMediaType(localPath, type);

  if (effectiveType === 'Image') {
    if (imgFailed) {
      return <ProceduralCanvasFallback query={query} type={type} style={mergedStyle} />;
    }
    return (
      <Img
        src={url}
        style={mergedStyle}
        onError={(e) => {
          console.warn(`[ASTRenderer] Image load error on ${localPath}, falling back to procedural canvas:`, e);
          setImgFailed(true);
        }}
      />
    );
  }

  return (
    <Video
      src={url}
      style={mergedStyle}
      muted={volume === 0 || volume === undefined}
      volume={volume ?? 0}
      loop={loop}
      onError={(e) => {
        console.warn(`[ASTRenderer] Video playback error on ${localPath}, falling back to <Img>:`, e);
        setVideoFailed(true);
      }}
    />
  );
};

export const ASTRenderer: React.FC<{
  composition: { type: 'Sequence'; children: ASTLayer[] };
  qualityMode?: QualityMode;
  quality?: QualityPolicy | unknown;
}> = ({ composition, qualityMode, quality: qualityInput }) => {
  if (!composition || composition.type !== 'Sequence' || !composition.children) {
    return null;
  }
  const policy = parseQuality(qualityInput);
  const mode: QualityMode =
    qualityMode ?? (getRemotionEnvironment().isRendering ? 'export' : 'preview');
  const glassCap = getGlassBlurCap(mode, policy);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0a09' }}>
      {/* 2026 FX pack: static SVG filter defs referenced via url(#fx-*) tokens
          in layer `filters` arrays. Rendered once per composition. */}
      <FxFilterDefs />
      {composition.children.map((layer, idx) => {
        const { content, animations, filters, z_index } = layer;
        const contentStyle = (content as any).style as React.CSSProperties | undefined;
        const { containerStyle: layoutStyle, contentStyle: innerStyle } = splitStyles(contentStyle);
        const { filterStyle, blendStyle } = parseFilters(filters);

        // Check if this layer has custom positioning (not fullscreen)
        const hasCustomLayout = contentStyle && (
          contentStyle.width || contentStyle.height ||
          contentStyle.top || contentStyle.left || contentStyle.right || contentStyle.bottom ||
          (contentStyle as any).aspectRatio
        );
        
        let node = null;
        const effectiveRadius = normalizeBorderRadius(layoutStyle.borderRadius || innerStyle.borderRadius);
        if ((content.type === 'Image' || content.type === 'Video') && content.local_path) {
          // For positioned layers, media fills its container; for fullscreen, apply content styles directly
          const mediaStyle: React.CSSProperties = hasCustomLayout
            ? {
                objectFit: innerStyle.objectFit || ('cover' as const),
                ...(effectiveRadius ? { borderRadius: effectiveRadius } : null),
              }
            : {
                ...innerStyle,
                ...(effectiveRadius ? { borderRadius: effectiveRadius } : null),
              };
          node = <MediaNode type={content.type} localPath={content.local_path} style={mediaStyle} volume={content.volume} loop={content.loop} query={(content as any).query} />;
        } else if (content.type === 'Image' || content.type === 'Video') {
          // Procedural fallback when local media is missing/downloading
          node = (
            <ProceduralCanvasFallback
              query={(content as any).query}
              type={content.type}
              style={{
                ...innerStyle,
                ...(effectiveRadius ? { borderRadius: effectiveRadius } : null),
              }}
            />
          );
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
              title_size={content.title_size}
              bar_radius={content.bar_radius}
              bar_gap={content.bar_gap}
              bar_max_width={content.bar_max_width}
              bar_glow={content.bar_glow}
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
        } else if (content.type === 'Particles') {
          node = (
            <ParticlesRenderer
              preset={content.particle_preset || 'confetti'}
              count={content.particle_count}
              colors={content.particle_colors}
              size={content.particle_size as [number, number] | undefined}
              speed={content.particle_speed}
              direction={content.particle_direction}
              opacity={content.particle_opacity}
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

        const { motion_blur, shutter_angle, camera_shake, transform_origin, floating } = layer as any;

        // Static transform (Layout tab) applies to every layer — positioned or
        // fullscreen — on the container, independent of animated transforms.
        const staticTransform = parseStaticTransform(layoutStyle as Record<string, any>);
        // Strip raw rotate/scale/scaleX/scaleY/borderRadius so they never leak
        // as CSS individual properties alongside the composed transform below.
        const { rotate: _rot, scale: _scl, scaleX: _sx, scaleY: _sy, borderRadius: _br, ...layoutRest } = layoutStyle as Record<string, any>;

        const hasRadius = !!effectiveRadius;
        const effectiveOverflow = layoutRest.overflow || (hasCustomLayout || hasRadius ? 'hidden' : undefined);

        // Build the container style: positioned layers get custom layout,
        // fullscreen layers use the legacy 100%x100% default with layout styling preserved
        const containerBaseStyle: React.CSSProperties = hasCustomLayout
          ? {
              position: 'absolute',
              zIndex: z_index,
              ...layoutRest,
              ...(layoutRest.aspectRatio ? { height: undefined } : {}),
              ...(effectiveRadius ? { borderRadius: effectiveRadius } : {}),
              overflow: effectiveOverflow,
            }
          : {
              width: '100%',
              height: '100%',
              position: 'absolute',
              zIndex: z_index,
              ...layoutRest,
              // Strip padding & boxSizing on fullscreen branch so stale card padding doesn't inset full frame
              padding: undefined,
              boxSizing: undefined,
              ...(layoutRest.aspectRatio ? { height: undefined } : {}),
              ...(effectiveRadius ? { borderRadius: effectiveRadius } : {}),
              ...(effectiveOverflow ? { overflow: effectiveOverflow } : {}),
            };

        // Clamp expensive backdrop-blur radii to the Settings cap and isolate
        // the layer so Chromium's backdrop readback stays local.
        const optimizedBackdrop =
          typeof layoutStyle.backdropFilter === 'string'
            ? optimizeBackdropFilter(layoutStyle.backdropFilter, glassCap)
            : layoutStyle.backdropFilter;
        const optimizedWebkitBackdrop =
          typeof (layoutStyle as any).WebkitBackdropFilter === 'string'
            ? optimizeBackdropFilter((layoutStyle as any).WebkitBackdropFilter as string, glassCap)
            : (layoutStyle as any).WebkitBackdropFilter;
        const hasGlass = !!optimizedBackdrop || !!optimizedWebkitBackdrop;
        // Compose static Layout transform with the glass compositor hack —
        // a single `transform` key so neither overwrites the other.
        const containerTransform = [staticTransform, hasGlass ? 'translateZ(0)' : null]
          .filter(Boolean)
          .join(' ') || undefined;

        const inner = (
          <div style={{
            ...containerBaseStyle,
            ...(optimizedBackdrop !== (layoutStyle as any).backdropFilter
              ? { backdropFilter: optimizedBackdrop }
              : null),
            ...(optimizedWebkitBackdrop !== (layoutStyle as any).WebkitBackdropFilter
              ? { WebkitBackdropFilter: optimizedWebkitBackdrop }
              : null),
            filter: filterStyle,
            // Isolation + own compositor layer confines the backdrop-blur
            // readback instead of re-rasterizing overlapping siblings.
            ...(hasGlass ? { isolation: 'isolate' as const } : null),
            ...(containerTransform ? { transform: containerTransform } : null),
            // Honor the Motion FX anchor for static rotation when set.
            ...(containerTransform && transform_origin ? { transformOrigin: transform_origin } : null),
            ...blendStyle,
          }}>
            {node}
          </div>
        );

        const renderedLayer = ((animations && animations.length > 0) || motion_blur || (camera_shake && camera_shake !== 'none') || !!transform_origin || !!floating) ? (
          <ASTAnimator
            animations={animations}
            motion_blur={motion_blur}
            shutter_angle={shutter_angle}
            camera_shake={camera_shake}
            transform_origin={transform_origin}
            floating={floating}
            qualityMode={mode}
            quality={policy}
          >
            {inner}
          </ASTAnimator>
        ) : (
          <AbsoluteFill>{inner}</AbsoluteFill>
        );

        return (
          <ASTErrorBoundary
            key={idx}
            layerType={content?.type}
            fallback={
              <ProceduralCanvasFallback
                query={(content as any)?.query}
                type={content?.type}
                style={{ width: '100%', height: '100%' }}
              />
            }
          >
            {renderedLayer}
          </ASTErrorBoundary>
        );
      })}
    </AbsoluteFill>
  );
};

