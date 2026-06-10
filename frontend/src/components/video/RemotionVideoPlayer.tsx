import { useMemo, forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { NitishRajputComposition, Scene, Transcription } from './NitishRajputComposition';

interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  scenes: Scene[];
  transcription: Transcription;
  styleType?: string;
  language?: string;
  videoFormat?: string;
  subtitleSettings?: any;
  onFrameUpdate?: (frame: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
}

export interface RemotionVideoPlayerRef {
  seekTo: (frame: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
}

export const RemotionVideoPlayer = forwardRef<RemotionVideoPlayerRef, Props>(({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  scenes = [],
  transcription = { segments: [] },
  styleType = 'nitish_rajput',
  language = 'hi',
  videoFormat = 'landscape',
  subtitleSettings = {},
  onFrameUpdate,
  onPlayStateChange
}, ref) => {

  const playerRef = useRef<PlayerRef>(null);

  useImperativeHandle(ref, () => ({
    seekTo: (frame: number) => {
      if (playerRef.current) {
        playerRef.current.seekTo(frame);
      }
    },
    toggle: () => {
      if (playerRef.current) {
        playerRef.current.toggle();
      }
    },
    play: () => {
      if (playerRef.current) {
        playerRef.current.play();
      }
    },
    pause: () => {
      if (playerRef.current) {
        playerRef.current.pause();
      }
    },
  }));

  const hasScenes = scenes && scenes.length > 0;

  useEffect(() => {
    if (!hasScenes) return;

    let lastFrame = -1;
    let lastPlaying: boolean | null = null;
    const interval = setInterval(() => {
      if (playerRef.current) {
        const frame = playerRef.current.getCurrentFrame();
        if (frame !== lastFrame) {
          lastFrame = frame;
          onFrameUpdate?.(frame);
        }
        // Sync playing state from player to store
        const playing = playerRef.current.isPlaying();
        if (playing !== lastPlaying) {
          lastPlaying = playing;
          onPlayStateChange?.(playing);
        }
      }
    }, 200); // poll at ~5fps to prevent React render lag

    return () => clearInterval(interval);
  }, [onFrameUpdate, onPlayStateChange, hasScenes]);

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
      language,
      videoFormat,
      subtitleSettings
    };
  }, [audioUrl, bgMusicUrl, bgMusicVolume, scenes, transcription, styleType, language, videoFormat, subtitleSettings]);

  if (!scenes || scenes.length === 0) {
    return (
      <div className={`flex flex-col justify-center items-center bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 p-8 text-center ${videoFormat === 'portrait' ? 'aspect-[9/16] w-auto mx-auto max-h-[70vh]' : 'w-full aspect-video'}`}>
        <svg className="w-16 h-16 text-zinc-600 mb-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-lg font-semibold text-zinc-300">No Scenes Synthesized Yet</p>
        <p className="text-sm text-zinc-500 max-w-sm mt-1">Please start the generation pipeline from the sidebar to compile audio assets and timeline markers.</p>
      </div>
    );
  }

  return (
    <div className={`w-full bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-2xl relative ${videoFormat === 'portrait' ? 'aspect-[9/16] w-auto mx-auto max-h-[70vh]' : 'aspect-video'}`}>
      <Player
        ref={playerRef}
        component={NitishRajputComposition}
        inputProps={inputProps as any}
        durationInFrames={durationInFrames}
        fps={30}
        compositionWidth={videoFormat === 'portrait' ? 1080 : 1920}
        compositionHeight={videoFormat === 'portrait' ? 1920 : 1080}
        style={{
          width: '100%',
          height: '100%',
        }}
        controls={false}
        loop
        spaceKeyToPlayOrPause={false}
      />

      {/* Dynamic duration indicator badge */}
      <div className="absolute top-4 right-4 bg-zinc-950/80 backdrop-blur-md px-3 py-1 rounded text-xs font-mono text-zinc-300 z-20 border border-zinc-800 pointer-events-none">
        {(durationInFrames / 30).toFixed(1)}s / {((durationInFrames / 30) / 60).toFixed(2)}m
      </div>
    </div>
  );
});
export default RemotionVideoPlayer;
