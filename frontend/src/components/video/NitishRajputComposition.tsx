import { useMemo } from 'react';
import { Sequence, Audio, useVideoConfig } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';
import { PanScanImage } from './PanScanImage';
import { ParallaxImage } from './ParallaxImage';
import { DataVisualizations } from './DataVisualizations';
import { LowerThird } from './LowerThird';
import { TransitionWrapper } from './TransitionWrapper';

export interface SubVisual {
  visual_type: 'scene' | 'portrait' | 'image' | 'chart' | 'map' | 'document' | 'youtube' | 'parallax' | 'network';
  visual_cue: string;
  transition_type?: string;
  visual_url?: string;
  visual_meta?: any;
  duration?: number;
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

export interface TranscriptionSegment {
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

    if (type === 'chart' || type === 'map' || type === 'document' || type === 'network') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          {/* Base vintage texture under graphs/documents */}
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            backgroundColor: '#1c1917', 
            backgroundImage: 'radial-gradient(circle, #292524 0%, #0c0a09 100%)' 
          }} />
          <DataVisualizations type={type} meta={meta} durationInFrames={durationFrames} />
        </div>
      );
    }

    if (type === 'parallax') {
      return (
        <ParallaxImage 
          backgroundUrl={url}
          foregroundUrl={meta.foreground_url}
          cue={subVis.visual_cue}
          durationInFrames={durationFrames}
        />
      );
    }

    // Default: Image, portrait, or B-roll video. Display with pan-and-scan camera glide
    return (
      <PanScanImage 
        src={url} 
        type={type} 
        cue={subVis.visual_cue} 
        durationInFrames={durationFrames} 
      />
    );
  };

  let frameOffset = 0;

  return (
    <div style={{ flex: 1, backgroundColor: '#0c0a09', position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      {/* 1. Spoken Narration Track */}
      {audioUrl && <Audio src={audioUrl} />}

      {/* 2. Ambient Soundtrack */}
      {bgMusicUrl && (
        <Audio 
          src={bgMusicUrl} 
          volume={bgMusicVolume} 
          loop 
        />
      )}

      {/* 3. Chronological Scene Sequences */}
      {scenes.map((scene, idx) => {
        const durationFrames = Math.max(30, Math.ceil(scene.duration * 30));
        const currentOffset = frameOffset;
        frameOffset += durationFrames;

        const subVisuals = scene.sub_visuals || [];
        const numSubs = subVisuals.length;

        // Find the first lower_third in any sub_visual's visual_meta
        const lowerThirdMeta = subVisuals.find(sv => sv.visual_meta?.lower_third)?.visual_meta?.lower_third;

        return (
          <Sequence
            key={idx}
            from={currentOffset}
            durationInFrames={durationFrames}
          >
            {/* Sub-visual sequences: each gets an equal fraction of the scene duration */}
            {numSubs > 0 ? (
              subVisuals.map((subVis, subIdx) => {
                // Distribute frames equally, with last sub-visual getting any remainder
                const baseSubDuration = Math.floor(durationFrames / numSubs);
                const subFrom = subIdx * baseSubDuration;
                const subDuration = subIdx === numSubs - 1 
                  ? durationFrames - subFrom 
                  : baseSubDuration;

                return (
                  <Sequence
                    key={subIdx}
                    from={subFrom}
                    durationInFrames={Math.max(1, subDuration)}
                  >
                    <TransitionWrapper durationInFrames={Math.max(1, subDuration)} type={subVis.transition_type}>
                      {renderSubVisual(subVis, Math.max(1, subDuration))}
                    </TransitionWrapper>
                  </Sequence>
                );
              })
            ) : (
              // Fallback: no sub_visuals — show dark placeholder
              <div style={{ width: '100%', height: '100%', backgroundColor: '#0c0a09' }} />
            )}
            
            {/* Title watermark on upper corner */}
            <div style={{
              position: 'absolute',
              top: 50,
              left: 60,
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              color: '#d6d3d1',
              textTransform: 'uppercase',
              letterSpacing: 2,
              opacity: 0.6,
              borderLeft: '4px solid #b45309',
              paddingLeft: 12
            }}>
              {scene.title}
            </div>

            {/* Lower Third overlay if any sub_visual requested it */}
            {lowerThirdMeta && (
              <LowerThird 
                title={lowerThirdMeta.title}
                subtitle={lowerThirdMeta.subtitle}
                durationInFrames={durationFrames}
              />
            )}
          </Sequence>
        );
      })}

      {/* 4. Active Typographic Subtitle Overlay */}
      {transcription && transcription.segments && (
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
