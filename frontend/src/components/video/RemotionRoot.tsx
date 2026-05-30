import React from 'react';
import { Composition } from 'remotion';
import { NitishRajputComposition } from './NitishRajputComposition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NitishRajputVideo"
        component={NitishRajputComposition}
        // Fallback duration in frames (will be dynamically computed in the player/CLI)
        durationInFrames={3600} 
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          audioUrl: '',
          bgMusicUrl: '',
          bgMusicVolume: 0.15,
          scenes: [] as any[],
          transcription: { segments: [] } as any,
          style: 'nitish_rajput',
          language: 'hi'
        }}
      />
    </>
  );
};
