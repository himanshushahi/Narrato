import React from 'react';
import { Composition } from 'remotion';
import { NitishRajputComposition, Props as CompositionProps } from './NitishRajputComposition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NitishRajputVideo"
        component={NitishRajputComposition as React.FC<any>}
        // Fallback duration in frames (overridden by calculateMetadata when props are available)
        durationInFrames={3600} 
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          audioUrl: '',
          bgMusicUrl: '',
          bgMusicVolume: 0.15,
          musicClips: [],
          sfxClips: [],
          sfxVolume: 0.5,
          voiceoverVolume: 1.0,
          muteVideoAudio: false,
          scenes: [],
          transcription: { language: 'hi', segments: [] },
          style: 'nitish_rajput',
          language: 'hi',
          videoFormat: 'landscape',
          subtitleSettings: {},
          designSystem: null,
          overlays: [],
          fps: 30,
          qualityMode: 'export',
          quality: { motionBlur: 'balanced', glassCap: 16 },
          fontCssInline: ''
        } as CompositionProps}
        calculateMetadata={({ props }) => {
          if ((props as any).__file_server_port__) {
            window.__file_server_port__ = (props as any).__file_server_port__;
          }
          const fps = (props as any).fps || 30;
          const scenes = (props as any).scenes || [];
          // MUST match RemotionVideoPlayer + NitishRajputComposition:
          // per-scene max(30, ceil(duration * fps)) so subtitle absolute
          // times (frame/fps) land on the same sentence in preview & export.
          const totalFrames = Math.max(
            fps * 5,
            scenes.reduce(
              (sum: number, sc: any) => sum + Math.max(30, Math.ceil((sc.duration || 0) * fps)),
              0
            )
          );
          const isPortrait = (props as any).videoFormat === 'portrait';
          return {
            durationInFrames: totalFrames,
            fps: fps,
            width: isPortrait ? 1080 : 1920,
            height: isPortrait ? 1920 : 1080,
          };
        }}
      />
    </>
  );
};
