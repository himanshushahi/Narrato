import { useMemo } from 'react';
import { Sequence, Audio, useVideoConfig } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';
import { PanScanImage } from './PanScanImage';
import { ParallaxImage } from './ParallaxImage';
import { DataVisualizations } from './DataVisualizations';
import { NumberingList } from './NumberingList';
import { LowerThird } from './LowerThird';
import { TransitionWrapper } from './TransitionWrapper';
import { ZoomWrapper } from './ZoomWrapper';
import { SubVisualTransform } from './SubVisualTransform';
import { CustomHtmlVisual } from './CustomHtmlVisual';
import { calculateSubVisualTimings } from '../../utils/duration';

export interface SubVisual {
  visual_type: 'scene' | 'portrait' | 'image' | 'chart' | 'map' | 'document' | 'youtube' | 'parallax' | 'network' | 'list' | 'custom_html' | 'timeline';
  visual_cue: string;
  transition_type?: string;
  visual_url?: string;
  visual_meta?: any;
  duration?: number;
  /** User-configured zoom & pan offset applied uniformly to this sub-visual */
  transform?: SubVisualTransform;
  /** Proportional duration share within the scene (values sum to ~1.0). Set by Adjust Durations bar. */
  duration_ratio?: number;
}

export interface Scene {
  index: number;
  section_type: string;
  title: string;
  text: string;
  audio_file: string;
  audio_url: string;
  duration: number;
  sub_visuals: SubVisual[];
}

export interface TranscriptionWord {
  start: number;
  end: number;
  word: string;
}

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
}

export interface Transcription {
  language: string;
  segments: TranscriptionSegment[];
}

export interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  voiceoverVolume?: number;
  scenes: Scene[];
  transcription: Transcription;
  style?: string;
  language?: string;
  subtitleSettings?: any;
}

export interface SceneTiming {
  start: number;
  end: number;
  text: string;
}

export const NitishRajputComposition = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  voiceoverVolume = 1.0,
  scenes = [],
  transcription = { language: '', segments: [] },
  style = 'nitish_rajput',
  subtitleSettings = {}
}: Props) => {
  useVideoConfig();

  // Build scene timing lookup (cumulative start/end times) for subtitle gap-filling
  const sceneTimings: SceneTiming[] = useMemo(() => {
    let offset = 0;
    return scenes.map(scene => {
      const start = offset;
      const end = offset + (scene.duration || 0);
      offset = end;
      return { start, end, text: scene.text };
    });
  }, [scenes]);

  // Helper to render a single sub-visual's content
  const renderSubVisual = (subVis: SubVisual, durationFrames: number) => {
    const type = subVis.visual_type;
    const url = subVis.visual_url || '';
    const meta = subVis.visual_meta || {};
    const transform = subVis.transform;

    if (type === 'chart' || type === 'map' || type === 'document' || type === 'network' || type === 'timeline') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          {/* ZoomWrapper wraps both background and visualization — they scale together */}
          <ZoomWrapper transform={transform}>
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: '#1c1917',
                backgroundImage: 'radial-gradient(circle, #292524 0%, #0c0a09 100%)'
              }} />
              <DataVisualizations type={type} meta={meta} durationInFrames={durationFrames} subtitleSettings={subtitleSettings} />
            </div>
          </ZoomWrapper>
          {/* Vignette overlay stays OUTSIDE ZoomWrapper so it never scales with camera zoom — same pattern as ParallaxImage */}
          <div style={{
            position: 'absolute', inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none', zIndex: 10
          }} />
        </div>
      );
    }

    if (type === 'parallax') {
      return (
        <ParallaxImage
          backgroundUrl={url}
          foregroundUrl={meta.foreground_url}
          meta={meta.parallax || meta}
          cue={subVis.visual_cue}
          durationInFrames={durationFrames}
          transform={transform}
        />
      );
    }

    if (type === 'list') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: '#1c1917',
                backgroundImage: 'radial-gradient(circle, #292524 0%, #0c0a09 100%)'
              }} />
              <NumberingList meta={meta} durationInFrames={durationFrames} subtitleSettings={subtitleSettings} cue={subVis.visual_cue} />
            </div>
          </ZoomWrapper>
          <div style={{
            position: 'absolute', inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none', zIndex: 10
          }} />
        </div>
      );
    }

    if (type === 'custom_html') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <CustomHtmlVisual meta={meta} />
          </ZoomWrapper>
        </div>
      );
    }

    // Default: Image, portrait, or B-roll video. Display with pan-and-scan camera glide
    return (
      <PanScanImage
        src={url}
        type={type}
        cue={subVis.visual_cue}
        durationInFrames={durationFrames}
        transform={transform}
      />
    );
  };

  let frameOffset = 0;

  return (
    <div style={{ flex: 1, backgroundColor: '#0c0a09', position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      {/* 1. Spoken Narration Track */}
      {audioUrl && <Audio src={audioUrl} volume={Math.max(0, Math.min(1, voiceoverVolume))} pauseWhenBuffering />}

      {/* 2. Ambient Soundtrack */}
      {bgMusicUrl && (
        <Audio 
          src={bgMusicUrl} 
          volume={Math.max(0, Math.min(1, bgMusicVolume))} 
          loop 
          pauseWhenBuffering
        />
      )}

      {/* 3. Chronological Scene Sequences */}
      {scenes.map((scene, idx) => {
        const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
        const currentOffset = frameOffset;
        frameOffset += durationFrames;

        const subVisuals = scene.sub_visuals || [];
        const numSubs = subVisuals.length;

        return (
          <Sequence
            key={idx}
            from={currentOffset}
            durationInFrames={durationFrames}
          >
            {/* Sub-visual sequences: each gets duration based on duration_ratio */}
            {numSubs > 0 ? (() => {
              const timings = calculateSubVisualTimings(subVisuals, durationFrames, 0);

              return subVisuals.map((subVis, subIdx) => {
                const timing = timings[subIdx];
                const subFrom = timing.start;
                const subDuration = timing.end - timing.start;
                
                const ltMeta = subVis.visual_meta?.lower_third;

                return (
                  <Sequence
                    key={subIdx}
                    from={subFrom}
                    durationInFrames={Math.max(1, subDuration)}
                  >
                    <TransitionWrapper durationInFrames={Math.max(1, subDuration)} type={subVis.transition_type}>
                      {renderSubVisual(subVis, Math.max(1, subDuration))}
                    </TransitionWrapper>
                    {ltMeta && (
                      <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }}>
                        <LowerThird 
                          title={ltMeta.title}
                          subtitle={ltMeta.subtitle}
                          durationInFrames={Math.max(1, subDuration)}
                          positionX={subtitleSettings?.lower_third_x !== undefined ? subtitleSettings.lower_third_x : 5}
                          positionY={subtitleSettings?.lower_third_y !== undefined ? subtitleSettings.lower_third_y : 15}
                          primaryColor={subtitleSettings?.lower_third_primary_color || '#fbbf24'}
                          titleColor={subtitleSettings?.lower_third_title_color || '#fef3c7'}
                          subtitleColor={subtitleSettings?.lower_third_subtitle_color || '#d6d3d1'}
                          titleFontSize={subtitleSettings?.lower_third_title_font_size !== undefined ? subtitleSettings.lower_third_title_font_size : 42}
                        />
                      </div>
                    )}
                  </Sequence>
                );
              });
            })() : (
              // Fallback: no sub_visuals — show dark placeholder
              <div style={{ width: '100%', height: '100%', backgroundColor: '#0c0a09' }} />
            )}
            
            {/* Title watermark on upper corner */}
            {!subtitleSettings?.hide_chapter_name && scene.title && (
              <div style={{
                position: 'absolute',
                top: 50,
                left: 60,
                fontFamily: 'Montserrat, sans-serif',
                fontWeight: 800,
                fontSize: 24,
                color: subtitleSettings?.chapter_text_color || '#d6d3d1',
                textTransform: 'uppercase',
                letterSpacing: 2,
                opacity: 0.6,
                borderLeft: `4px solid ${subtitleSettings?.chapter_border_color || '#b45309'}`,
                paddingLeft: 12
              }}>
                {scene.title}
              </div>
            )}
          </Sequence>
        );
      })}

      {/* 4. Active Typographic Subtitle Overlay */}
      {!subtitleSettings?.hide_subtitles && transcription && transcription.segments && (
        <KineticSubtitles 
          transcription={transcription} 
          sceneTimings={sceneTimings}
          styleType={style} 
          subtitleSettings={subtitleSettings}
        />
      )}

      {/* 5. Paper Overlay Layer */}
      <PaperOverlay />
    </div>
  );
};
