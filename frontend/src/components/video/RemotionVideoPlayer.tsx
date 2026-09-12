import { useMemo, forwardRef, useImperativeHandle, useRef, useEffect, Component, ReactNode } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { NitishRajputComposition, Scene, Transcription, MusicClip, SfxClip } from './NitishRajputComposition';
import { GlobalOverlayItem } from './GlobalOverlaysRenderer';
import { useSettingsStore } from '../../store/useSettingsStore';
import { parseQuality } from './renderQuality';

/**
 * Player-level safety net: a throw anywhere in the composition tree
 * (scene math, global overlays, subtitles) previously left a bare black
 * canvas. Now it surfaces the error message with a retry instead.
 */
class PlayerErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || String(error) };
  }
  componentDidCatch(error: Error) {
    console.warn('[RemotionVideoPlayer] Composition render error:', error);
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center">
        <div className="text-3xl">⚠️</div>
        <div className="text-sm font-bold text-amber-400">Preview failed to render this cut</div>
        <div className="max-w-full overflow-auto rounded bg-zinc-900 px-3 py-2 font-mono text-[11px] text-zinc-300">
          {this.state.message}
        </div>
        <button
          className="rounded bg-amber-600/20 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-600/40"
          onClick={() => this.setState({ hasError: false, message: '' })}
        >
          Retry
        </button>
      </div>
    );
  }
}

interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  musicClips?: MusicClip[];
  sfxClips?: SfxClip[];
  sfxVolume?: number;
  voiceoverVolume?: number;
  muteVideoAudio?: boolean;
  scenes: Scene[];
  transcription: Transcription;
  styleType?: string;
  language?: string;
  videoFormat?: string;
  subtitleSettings?: any;
  designSystem?: any;
  overlays?: GlobalOverlayItem[];
  /** Preview resolution scale (0.5 = 960x540, 1 = full 1920x1080). Defaults to 0.5 for fast scrubbing/playback. */
  compositionScale?: number;
  onFrameUpdate?: (frame: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  children?: React.ReactNode;
}

export interface RemotionVideoPlayerRef {
  seekTo: (frame: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  getCurrentFrame: () => number;
}

const BROWSER_MEDIA_BEHAVIOR = { mode: 'prevent-media-session' as const };

const RemotionVideoPlayer = forwardRef<RemotionVideoPlayerRef, Props>(({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  musicClips = [],
  sfxClips = [],
  sfxVolume = 0.5,
  voiceoverVolume = 1.0,
  muteVideoAudio = false,
  scenes = [],
  transcription = { segments: [] },
  styleType = 'nitish_rajput',
  language = 'hi',
  videoFormat = 'landscape',
  subtitleSettings = {},
  designSystem,
  overlays = [],
  compositionScale = 0.5,
  onFrameUpdate,
  onPlayStateChange,
  children,
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
    getCurrentFrame: () => {
      if (playerRef.current) {
        return playerRef.current.getCurrentFrame();
      }
      return 0;
    }
  }));

  const hasScenes = scenes && scenes.length > 0;

  // Use refs to avoid effect re-runs when callbacks change
  const onFrameUpdateRef = useRef(onFrameUpdate);
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  useEffect(() => {
    onFrameUpdateRef.current = onFrameUpdate;
    onPlayStateChangeRef.current = onPlayStateChange;
  });

  // Frame pump: rAF loop (display-synced, auto-pauses in hidden tabs)
  // driving two consumers at different rates —
  // - the timeline playhead + seek bar read the player directly in their own
  //   rAF loops (60fps, zero React renders),
  // - this loop notifies the playback store at ~10Hz for badge / timecode /
  //   scene highlight, with immediate emission on seeks (frame jump > 3) and
  //   on play/pause transitions (never drop the frame the player stopped on).
  useEffect(() => {
    if (!hasScenes) return;

    let raf = 0;
    let lastFrame = -1;
    let lastPlaying: boolean | null = null;
    let lastNotify = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const player = playerRef.current;
      if (!player) return;
      const isPlaying = player.isPlaying();
      if (isPlaying !== lastPlaying) {
        lastPlaying = isPlaying;
        if (onPlayStateChangeRef.current) {
          onPlayStateChangeRef.current(isPlaying);
        }
        const frame = player.getCurrentFrame();
        lastFrame = frame;
        lastNotify = performance.now();
        if (onFrameUpdateRef.current) {
          onFrameUpdateRef.current(frame);
        }
        return;
      }
      const now = performance.now();
      const frame = player.getCurrentFrame();
      if (frame === lastFrame) {
        lastNotify = now;
        return;
      }
      // Seeks jump many frames (>6 ≈ two throttle windows of 30fps
      // playback): emit immediately so highlight/badge catch up within a
      // frame instead of waiting out the 100ms throttle.
      const jumped = Math.abs(frame - lastFrame) > 6;
      if (!jumped && now - lastNotify < 100) return;
      lastFrame = frame;
      lastNotify = now;
      if (onFrameUpdateRef.current) {
        onFrameUpdateRef.current(frame);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [hasScenes]);

  const durationInFrames = useMemo(() => {
    if (!scenes || scenes.length === 0) return 300;
    return scenes.reduce((acc, scene) => {
      return acc + Math.max(30, Math.ceil((scene.duration || 0) * 30));
    }, 0);
  }, [scenes]);

  // Fast preview renders the composition canvas at compositionScale resolution
  // (0.5 => 960x540) while the composition scales its 1080p layout to fill it —
  // identical visual output at a fraction of the GPU rasterization load.
  const baseWidth = videoFormat === 'portrait' ? 1080 : 1920;
  const baseHeight = videoFormat === 'portrait' ? 1920 : 1080;
  const compWidth = Math.round(baseWidth * compositionScale);
  const compHeight = Math.round(baseHeight * compositionScale);

  // Preview quality: per-project overrides (subtitleSettings carries
  // localProjectSettings) win over global Settings — same precedence as
  // backend render.py (project_settings.get(...) or get_setting(...)).
  const renderMotionBlur = useSettingsStore((s) => (s.settings as any).render_motion_blur);
  const renderGlassCap = useSettingsStore((s) => (s.settings as any).render_glass_cap);

  const inputProps = useMemo(() => {
    const proj = (subtitleSettings ?? {}) as any;
    // NOTE: unset project keys arrive as '' — use || (not ??) so they fall
    // through to global Settings instead of parsing '' as glassCap 0.
    const quality = parseQuality({
      motionBlur: proj.render_motion_blur || renderMotionBlur,
      glassCap: proj.render_glass_cap || renderGlassCap,
    });
    return {
      audioUrl,
      bgMusicUrl,
      bgMusicVolume,
      musicClips,
      sfxClips,
      sfxVolume,
      voiceoverVolume,
      muteVideoAudio,
      scenes,
      transcription,
      style: styleType,
      language,
      videoFormat,
      subtitleSettings,
      designSystem,
      overlays,
      // Preview path: policy from Settings; cheap samples + capped glass in
      // balanced mode so scrubbing glass-heavy scenes stays interactive.
      qualityMode: 'preview' as const,
      quality,
    };
  }, [audioUrl, bgMusicUrl, bgMusicVolume, musicClips, sfxClips, sfxVolume, voiceoverVolume, muteVideoAudio, scenes, transcription, styleType, language, videoFormat, subtitleSettings, designSystem, overlays, renderMotionBlur, renderGlassCap]);

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
    // Portrait stays width-driven like landscape (height always derives from
    // the ratio, so it can never break): `w-full` capped so the 9:16 height
    // fits the viewport (70vh tall → 39.375vh wide). A bare `w-full` +
    // `max-h` cap lets width win and silently breaks aspect-ratio, letterboxing
    // the video inside a wide box that the % overlay can never match.
    <div className={`bg-black rounded-lg overflow-hidden border border-zinc-800 shadow-2xl relative ${videoFormat === 'portrait' ? 'aspect-[9/16] w-full max-w-[39.375vh] mx-auto' : 'aspect-video w-full'}`}>
      <PlayerErrorBoundary resetKey={`${scenes?.length ?? 0}:${durationInFrames}:${videoFormat}`}>
      <Player
        ref={playerRef}
        component={NitishRajputComposition}
        inputProps={inputProps as any}
        durationInFrames={durationInFrames}
        fps={30}
        compositionWidth={compWidth}
        compositionHeight={compHeight}
        style={{
          width: '100%',
          height: '100%',
        }}
        controls={false}
        loop={false}
        spaceKeyToPlayOrPause={false}
        browserMediaControlsBehavior={BROWSER_MEDIA_BEHAVIOR}
        renderLoading={() => (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
          </div>
        )}
      />
      </PlayerErrorBoundary>

      {children}

      <div className="absolute top-4 right-4 bg-zinc-950/80 backdrop-blur-md px-3 py-1 rounded text-xs font-mono text-zinc-300 z-20 border border-zinc-800 pointer-events-none">
        {(durationInFrames / 30).toFixed(1)}s / {((durationInFrames / 30) / 60).toFixed(2)}m
      </div>
    </div>
  );
});
export default RemotionVideoPlayer;
