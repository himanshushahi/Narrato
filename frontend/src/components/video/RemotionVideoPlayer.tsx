import React, { useMemo } from 'react';
import { Player } from '@remotion/player';
import { NitishRajputComposition, Scene, Transcription } from './NitishRajputComposition';

interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  scenes: Scene[];
  transcription: Transcription;
  styleType?: string;
  language?: string;
}

export const RemotionVideoPlayer: React.FC<Props> = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  scenes = [],
  transcription = { segments: [] },
  styleType = 'nitish_rajput',
  language = 'hi'
}) => {

  // Dynamically compute the total duration of the video based on segment synthesis times
  const durationInFrames = useMemo(() => {
    if (!scenes || scenes.length === 0) {
      return 150; // default 5 seconds fallback
    }
    const totalDuration = scenes.reduce((acc, scene) => acc + (scene.duration || 0), 0);
    return Math.max(150, Math.ceil(totalDuration * 30)); // 30fps
  }, [scenes]);

  const inputProps = useMemo(() => {
    return {
      audioUrl,
      bgMusicUrl,
      bgMusicVolume,
      scenes,
      transcription,
      style: styleType,
      language
    };
  }, [audioUrl, bgMusicUrl, bgMusicVolume, scenes, transcription, styleType, language]);

  if (!scenes || scenes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col justify-center items-center bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 p-8 text-center">
        <svg className="w-16 h-16 text-zinc-600 mb-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-lg font-semibold text-zinc-300">No Scenes Synthesized Yet</p>
        <p className="text-sm text-zinc-500 max-w-sm mt-1">Please start the generation pipeline from the sidebar to compile audio assets and timeline markers.</p>
      </div>
    );
  }

  return (
    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-2xl relative">
      <Player
        component={NitishRajputComposition}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        fps={30}
        compositionWidth={1920}
        compositionHeight={1080}
        style={{
          width: '100%',
          height: '100%',
        }}
        controls
        loop
      />
      
      {/* Dynamic duration indicator badge */}
      <div className="absolute top-4 right-4 bg-zinc-950/80 backdrop-blur-md px-3 py-1 rounded text-xs font-mono text-zinc-300 z-20 border border-zinc-800 pointer-events-none">
        {(durationInFrames / 30).toFixed(1)}s / {((durationInFrames / 30) / 60).toFixed(2)}m
      </div>
    </div>
  );
};
export default RemotionVideoPlayer;
