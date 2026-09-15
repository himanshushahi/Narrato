import React from 'react';
import { motion } from 'framer-motion';
import { VscPlay, VscDebugPause, VscScreenFull, VscScreenNormal, VscLoading } from 'react-icons/vsc';
import RemotionVideoPlayer, { RemotionVideoPlayerRef } from '../../components/video/RemotionVideoPlayer';
import { CanvasOverlay } from './components/CanvasOverlay';
import { MusicClip, SfxClip } from '../../components/video/NitishRajputComposition';
import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';

interface VideoPreviewProps {
  playerRef: React.RefObject<RemotionVideoPlayerRef | null>;
  liveScenes: any[];
  transcriptionData: any;
  audioUrl: string;
  bgMusicUrl: string;
  bgMusicVolume?: number;
  musicClips?: MusicClip[];
  sfxClips?: SfxClip[];
  sfxVolume?: number;
  voiceoverVolume?: number;
  styleType?: string;
  language?: string;
  videoFormat?: string;
  subtitleSettings: any;
  designSystem?: any;
  overlays?: any[];
  onFrameUpdate: (frame: number) => void;
  isPipelineRunning?: boolean;
  pipelineProgress?: number;
  fullscreenToggleRef?: React.MutableRefObject<(() => void) | null>;
  /** P2: overlay inert while the selected cut has an AI rewrite in flight. */
  canvasLocked?: boolean;
  /** P2: overlay layer click routing (ensures Visuals tab + edit session). */
  onCanvasSelectLayer?: (sceneIdx: number, subIdx: number, layerIdx: number) => void;
  /** P3: overlay drag commit — exactly one call per drag (pointer-up). */
  onCanvasStyleCommit?: (sceneIdx: number, subIdx: number, layerIdx: number, style: Record<string, any>) => void;
  /** Cut timings (frames) so the overlay can follow the playhead's cut within a scene. */
  sceneTimings?: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
}

// Player re-renders only when its props actually change (scenes, media URLs,
// toggles) — NOT on every playhead tick. This keeps Remotion's <Player>
import { useStoreWithEqualityFn } from 'zustand/traditional';

// ── Sub-components that subscribe to playback frame without re-rendering VideoPreview ──

const formatTimestamp = (frame: number) => {
  const totalSeconds = Math.floor(frame / 30);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  const f = (frame % 30).toString().padStart(2, '0');
  return `${m}:${s}:${f}`;
};

const PreviewActiveSceneBadge: React.FC<{ liveScenes: any[] }> = React.memo(({ liveScenes }) => {
  const activeSceneLabel = useStoreWithEqualityFn(
    usePlaybackStore,
    (s) => {
      let offset = 0;
      for (let i = 0; i < (liveScenes || []).length; i++) {
        const scene = liveScenes[i];
        const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
        if (s.currentFrame >= offset && s.currentFrame < offset + durationFrames) {
          return scene.title || `${scene.section_type === 'introduction' ? 'Introduction' : scene.section_type === 'conclusion' ? 'Conclusion' : `Scene ${i}`}`;
        }
        offset += durationFrames;
      }
      return '';
    },
    Object.is
  );

  if (!activeSceneLabel) return null;

  return (
    <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-600/15 text-blue-400 px-2.5 py-0.5 rounded border border-blue-600/25">
      {activeSceneLabel}
    </span>
  );
});
PreviewActiveSceneBadge.displayName = 'PreviewActiveSceneBadge';

const PreviewSeekBar: React.FC<{
  totalFrames: number;
  onSeek: (frame: number) => void;
  getLiveFrame: () => number | undefined;
}> = React.memo(({ totalFrames, onSeek, getLiveFrame }) => {
  const fillRef = React.useRef<HTMLDivElement>(null);
  const dotRef = React.useRef<HTMLDivElement>(null);
  const getterRef = React.useRef(getLiveFrame);
  getterRef.current = getLiveFrame;
  const totalRef = React.useRef(totalFrames);
  totalRef.current = totalFrames;

  // rAF fill: direct width/left writes at display rate, no store
  // subscription — the bar glides instead of stepping at the ~10Hz store
  // poll. Skips writes when the percent hasn't visibly moved.
  React.useEffect(() => {
    let raf = 0;
    let lastPct = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const total = totalRef.current;
      if (total <= 0) return;
      const live = getterRef.current?.();
      const frame = live ?? usePlaybackStore.getState().currentFrame;
      const pct = (frame / total) * 100;
      if (Math.abs(pct - lastPct) < 0.05) return;
      lastPct = pct;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (dotRef.current) dotRef.current.style.left = `${pct}%`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalFrames <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const frame = Math.round((x / rect.width) * totalFrames);
    onSeek(frame);
  };

  return (
    <div className="px-4 py-2 w-full">
      <div
        className="relative h-2 cursor-pointer group"
        onClick={handleClick}
      >
        {/* Track background */}
        <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-zinc-800/60 overflow-hidden">
          {/* Filled progress */}
          <div
            ref={fillRef}
            className="h-full bg-linear-to-r from-blue-600 to-cyan-500 rounded-full"
          />
        </div>
        {/* Hover target: larger invisible hit area */}
        <div className="absolute inset-0 -top-2 -bottom-2" />
        {/* Seek handle dot — visible on hover */}
        <div
          ref={dotRef}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        />
      </div>
    </div>
  );
});
PreviewSeekBar.displayName = 'PreviewSeekBar';

const PreviewTimecode: React.FC = React.memo(() => {
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  return (
    <div className="flex items-baseline gap-[2px] px-2.5 py-1 rounded bg-zinc-900/80 border border-zinc-800/50 font-mono">
      <span className="text-sm font-bold text-white tabular-nums tracking-wider">
        {formatTimestamp(currentFrame)}
      </span>
      <span className="text-[10px] text-zinc-500 ml-2">30fps</span>
    </div>
  );
});
PreviewTimecode.displayName = 'PreviewTimecode';

// Player re-renders only when its props actually change (scenes, media URLs,
// toggles) — NOT on every playhead tick. This keeps Remotion's <Player>
// untouched while the seek bar/timecode update 5x/sec.
const MemoizedRemotionPlayer = React.memo(RemotionVideoPlayer);

export const VideoPreview: React.FC<VideoPreviewProps> = React.memo(({
  playerRef, liveScenes, transcriptionData,
  audioUrl, bgMusicUrl, bgMusicVolume, musicClips = [], sfxClips = [], sfxVolume = 0.5, voiceoverVolume, styleType, language, videoFormat, subtitleSettings,
  designSystem, overlays = [],
  onFrameUpdate, isPipelineRunning, pipelineProgress, fullscreenToggleRef,
  canvasLocked, onCanvasSelectLayer, onCanvasStyleCommit, sceneTimings
}) => {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const previewQuality = useEditorStore((s) => s.previewQuality);
  const setPreviewQuality = useEditorStore((s) => s.setPreviewQuality);
  const [zoom, setZoom] = React.useState<'fit' | '100' | '150'>('fit');
  const [showOverlay, setShowOverlay] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Composition pixel size backing the % overlay math (px-authored styles
  // resolve against composition space, which scales with preview quality).
  const isPortraitFormat = (videoFormat || 'landscape') === 'portrait';
  const compositionSize = React.useMemo(() => {
    const s = previewQuality === 'full' ? 1 : 0.5;
    return {
      w: Math.round((isPortraitFormat ? 1080 : 1920) * s),
      h: Math.round((isPortraitFormat ? 1920 : 1080) * s),
    };
  }, [isPortraitFormat, previewQuality]);
  const trackMuted = useEditorStore((s) => s.trackMuted);
  const trackHidden = useEditorStore((s) => s.trackHidden);

  React.useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // fullscreen may be denied or unavailable — silently no-op
    }
  }, []);

  React.useEffect(() => {
    if (fullscreenToggleRef) {
      fullscreenToggleRef.current = toggleFullscreen;
    }
  }, [fullscreenToggleRef, toggleFullscreen]);

  // Restore playhead seamlessly when quality toggle remounts the player.
  // The new Player may not be ready immediately, so retry the seek until it
  // sticks (or ~1s elapses), and only resume playback if still playing — a
  // pause during the restore window is respected.
  React.useEffect(() => {
    const frameToSeek = usePlaybackStore.getState().currentFrame;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (++attempts > 20) {
        window.clearInterval(timer);
        return;
      }
      try {
        const player = playerRef.current;
        if (!player) return;
        player.seekTo(frameToSeek);
        if (useEditorStore.getState().isPlaying) player.play();
        if (player.getCurrentFrame() === frameToSeek) {
          window.clearInterval(timer);
        }
      } catch {
        // Player is still re-initializing after the quality remount — retry
        // on the next tick. Without this guard a throw would escape the tick
        // before the attempt cap increments and leak the interval forever.
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [previewQuality, playerRef]);

  const togglePlay = () => {
    if (playerRef.current) {
      playerRef.current.toggle();
      setIsPlaying(!isPlaying);
    }
  };

  const zoomScale = zoom === 'fit' ? 1 : zoom === '100' ? 0.9 : 1.5;

  // Stable object identity so the memoized Player skips re-renders.
  const playerSubtitleSettings = React.useMemo(
    () => ({ ...subtitleSettings, hide_subtitles: trackHidden['subs'] }),
    [subtitleSettings, trackHidden['subs']]
  );

  // Compute total duration in frames from live scenes (matches RemotionVideoPlayer logic)
  const totalFrames = React.useMemo(() => {
    if (!liveScenes || liveScenes.length === 0) return 150;
    const totalDuration = liveScenes.reduce((acc, s) => acc + (s.duration || 0), 0);
    return Math.max(150, Math.ceil(totalDuration * 30));
  }, [liveScenes]);

  const handleSeekFromBar = React.useCallback((frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  }, [playerRef]);

  // Live frame reader for the rAF seek bar (display-rate, no React state).
  // playerRef object identity is stable, so this callback is too.
  const getLiveFrame = React.useCallback((): number | undefined => {
    const f = playerRef.current?.getCurrentFrame?.();
    return typeof f === 'number' ? f : undefined;
  }, [playerRef]);

  // Memoize the overlay element: it is passed as `children` to the memoized
  // player, and an inline element would be a new reference on every
  // VideoPreview render — defeating the memo and re-rendering Remotion's
  // <Player> on unrelated updates (play toggles, mute switches, etc).
  const canvasOverlay = React.useMemo(
    () => (
      <CanvasOverlay
        scenes={liveScenes}
        locked={canvasLocked}
        onSelectLayer={onCanvasSelectLayer}
        onStyleCommit={onCanvasStyleCommit}
        sceneTimings={sceneTimings}
        compositionSize={compositionSize}
      />
    ),
    [liveScenes, canvasLocked, onCanvasSelectLayer, onCanvasStyleCommit, sceneTimings, compositionSize]
  );

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col relative overflow-hidden select-none"
      onMouseEnter={() => setShowOverlay(true)}
      onMouseLeave={() => setShowOverlay(false)}
    >
      {/* ███ Header bar — always visible ███ */}
      <div className="shrink-0 h-9 flex items-center justify-between px-4 border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-sm">
        {/* Left — viewport label */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500/80" />
          <span className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase">
            Preview
          </span>
        </div>

        {/* Right — scene badge + settings */}
        <div className="flex items-center gap-3">
          <PreviewActiveSceneBadge liveScenes={liveScenes} />
        </div>
      </div>

      {/* ███ AI Generation progress overlay ███ */}
      {isPipelineRunning && (
        <div className="absolute inset-0 z-30 bg-black/70 backdrop-blur-md flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
              <VscLoading className="text-2xl text-blue-400 animate-spin" />
            </div>
            <p className="text-sm font-bold text-blue-300/90">AI Generation in Progress</p>
            {pipelineProgress !== undefined && (
              <div className="w-52 h-1.5 bg-zinc-800/80 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-linear-to-r from-blue-600 to-cyan-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${pipelineProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ███ Video player area — monitor bezel ███ */}
      <div
        className={`flex-1 flex items-center justify-center min-h-0 min-w-0 bg-zinc-950/50 ${zoom === '150' ? 'overflow-auto' : 'overflow-hidden'}`}
        style={{ containerType: 'size' }}
      >
        <div className="flex-1 self-stretch min-h-0 min-w-0 flex items-center justify-center p-2">
          <motion.div
            className={
              isPortraitFormat
                ? 'relative aspect-[9/16] max-w-full max-h-full mx-auto origin-center'
                : 'relative aspect-video max-w-full max-h-full mx-auto origin-center'
            }
            style={{
              width: isPortraitFormat
                ? 'min(100%, calc((100cqh - 16px) * 9 / 16))'
                : 'min(100%, calc((100cqh - 16px) * 16 / 9))',
            }}
            animate={{ scale: zoomScale }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Outer monitor chrome */}
            <div className="rounded-lg overflow-hidden shadow-2xl shadow-black/60 border border-zinc-800/40 bg-black">
              {/* Inner screen bezel — relative so the canvas overlay aligns with the player */}
              <div className="relative rounded-[3px] overflow-hidden">
                <MemoizedRemotionPlayer
                  ref={playerRef}
                  audioUrl={audioUrl}
                  bgMusicUrl={bgMusicUrl}
                  bgMusicVolume={trackMuted['music'] || trackHidden['music'] ? 0 : bgMusicVolume}
                  musicClips={trackMuted['music'] || trackHidden['music'] ? [] : musicClips}
                  sfxClips={trackMuted['sfx'] || trackHidden['sfx'] ? [] : sfxClips}
                  sfxVolume={sfxVolume}
                  voiceoverVolume={trackMuted['voice'] || trackHidden['voice'] ? 0 : voiceoverVolume}
                  muteVideoAudio={!!(trackMuted['videoaudio'] || trackHidden['videoaudio'])}
                  scenes={liveScenes}
                  transcription={trackHidden['subs'] ? { segments: [] } : transcriptionData}
                  styleType={styleType}
                  language={language}
                  videoFormat={videoFormat}
                  subtitleSettings={playerSubtitleSettings}
                  designSystem={designSystem}
                  overlays={trackHidden['overlays'] ? [] : overlays}
                  compositionScale={previewQuality === 'full' ? 1 : 0.5}
                  onFrameUpdate={onFrameUpdate}
                  onPlayStateChange={setIsPlaying}
                >
                  {canvasOverlay}
                </MemoizedRemotionPlayer>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ███ Seek bar — above controls, fades with overlay ███ */}
      <motion.div
        className="relative shrink-0"
        initial={false}
        animate={{ opacity: showOverlay ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <PreviewSeekBar totalFrames={totalFrames} onSeek={handleSeekFromBar} getLiveFrame={getLiveFrame} />
      </motion.div>

      {/* ███ Bottom controls bar ███ */}
      <motion.div
        className="shrink-0 h-11 flex items-center justify-between px-4 border-t border-zinc-800/60 bg-zinc-950/95"
        initial={false}
        animate={{ opacity: showOverlay ? 1 : 0.85 }}
        transition={{ duration: 0.2 }}
      >
        {/* Left: Play/Pause + Timecode */}
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/15 text-white transition-all active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <VscDebugPause className="text-sm" /> : <VscPlay className="text-sm" />}
          </button>

          {/* Timecode — like professional editors */}
          <PreviewTimecode />
        </div>

        {/* Right: Zoom controls + Fullscreen */}
        <div className="flex items-center gap-1.5">
          {/* Zoom dropdown-style controls */}
          <div className="flex items-center rounded-md border border-zinc-800/50 bg-zinc-900/60 overflow-hidden">
            <button
              onClick={() => setZoom('fit')}
              className={`px-2.5 h-7 text-[10px] font-semibold transition-colors cursor-pointer ${
                zoom === 'fit'
                  ? 'bg-blue-600/30 text-blue-400 border-r border-zinc-800/50'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border-r border-zinc-800/30'
              }`}
            >
              Fit
            </button>
            <button
              onClick={() => setZoom('100')}
              className={`px-2.5 h-7 text-[10px] font-semibold transition-colors cursor-pointer ${
                zoom === '100'
                  ? 'bg-blue-600/30 text-blue-400 border-r border-zinc-800/50'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border-r border-zinc-800/30'
              }`}
            >
              100%
            </button>
            <button
              onClick={() => setZoom('150')}
              className={`px-2.5 h-7 text-[10px] font-semibold transition-colors cursor-pointer ${
                zoom === '150'
                  ? 'bg-blue-600/30 text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              150%
            </button>
          </div>

          <div className="w-px h-5 bg-zinc-800/50 mx-0.5" />

          {/* Preview resolution toggle */}
          <div className="flex items-center rounded-md border border-zinc-800/50 bg-zinc-900/60 overflow-hidden">
            <button
              onClick={() => setPreviewQuality('fast')}
              className={`px-2.5 h-7 text-[10px] font-semibold transition-colors cursor-pointer ${
                previewQuality === 'fast'
                  ? 'bg-amber-600/30 text-amber-400 border-r border-zinc-800/50'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border-r border-zinc-800/30'
              }`}
              title="Fast preview (960x540) — 75% less GPU load"
            >
              Fast
            </button>
            <button
              onClick={() => setPreviewQuality('full')}
              className={`px-2.5 h-7 text-[10px] font-semibold transition-colors cursor-pointer ${
                previewQuality === 'full'
                  ? 'bg-amber-600/30 text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
              }`}
              title="Full preview (1920x1080)"
            >
              Full
            </button>
          </div>

          <div className="w-px h-5 bg-zinc-800/50 mx-0.5" />

          <button
            onClick={toggleFullscreen}
            className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {isFullscreen ? <VscScreenNormal className="text-xs" /> : <VscScreenFull className="text-xs" />}
          </button>
        </div>
      </motion.div>
    </div>
  );
});
