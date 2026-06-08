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
          scenes: [],
          transcription: { language: 'hi', segments: [] },
          style: 'nitish_rajput',
          language: 'hi',
          videoFormat: 'landscape'
        } as CompositionProps}
        calculateMetadata={({ props }) => {
          const fps = (props as any).fps || 30;
          const scenes = (props as any).scenes || [];
          const totalDuration = scenes.reduce(
            (sum: number, sc: any) => sum + (sc.duration || 0),
            0
          );
          // At least 5 sec fallback, otherwise compute from total scene durations
          const totalFrames = Math.max(fps * 5, Math.ceil(totalDuration * fps));
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
