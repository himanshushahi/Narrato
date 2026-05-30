import React from 'react';
import { Sequence, Audio, useVideoConfig } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';
import { PanScanImage } from './PanScanImage';
import { DataVisualizations } from './DataVisualizations';

export interface Scene {
  index: number;
  section_type: string;
  title: string;
  text: string;
  audio_file: string;
  audio_url: string;
  duration: number;
  visual_type: 'scene' | 'portrait' | 'image' | 'chart' | 'map' | 'document';
  visual_cue: string;
  visual_url?: string;
  visual_meta?: any;
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

interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  scenes: Scene[];
  transcription: Transcription;
  style?: string;
  language?: string;
}

export const NitishRajputComposition: React.FC<Props> = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  scenes = [],
  transcription = { segments: [] },
  style = 'nitish_rajput'
}) => {
  const { width, height } = useVideoConfig();

  // Helper to render segment specific visual layers
  const renderSceneVisual = (scene: Scene, durationFrames: number) => {
    const type = scene.visual_type;
    const url = scene.visual_url || '';
    const meta = scene.visual_meta || {};

    if (type === 'chart' || type === 'map' || type === 'document') {
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

    // Default: Image, portrait, or B-roll video. Display with pan-and-scan camera glide
    return (
      <PanScanImage 
        src={url} 
        type={type} 
        cue={scene.visual_cue} 
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

        return (
          <Sequence
            key={idx}
            from={currentOffset}
            durationInFrames={durationFrames}
          >
            {renderSceneVisual(scene, durationFrames)}
            
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
          </Sequence>
        );
      })}

      {/* 4. Active Typographic Subtitle Overlay */}
      {transcription && transcription.segments && (
        <KineticSubtitles 
          transcription={transcription} 
          styleType={style} 
        />
      )}

      {/* 5. Paper Overlay Layer */}
      <PaperOverlay />
    </div>
  );
};
