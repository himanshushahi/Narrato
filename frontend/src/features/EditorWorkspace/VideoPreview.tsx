import React from 'react';
import { motion } from 'framer-motion';
import { VscPlay, VscDebugPause, VscScreenFull, VscScreenNormal, VscLoading } from 'react-icons/vsc';
import RemotionVideoPlayer, { RemotionVideoPlayerRef } from '../../components/video/RemotionVideoPlayer';
import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';

interface VideoPreviewProps {
  playerRef: React.RefObject<RemotionVideoPlayerRef | null>;
  liveScenes: any[];
  transcriptionData: any;
  audioUrl: string;
  bgMusicUrl: string;
  bgMusicVolume?: number;
  voiceoverVolume?: number;
  styleType?: string;
  language?: string;
  videoFormat?: string;
  subtitleSettings: any;
  designSystem?: any;
  onFrameUpdate: (frame: number) => void;
  isPipelineRunning?: boolean;
  pipelineProgress?: number;
  fullscreenToggleRef?: React.MutableRefObject<(() => void) | null>;
}

// Player re-renders only when its props actually change (scenes, media URLs,
// toggles) — NOT on every playhead tick. This keeps Remotion's <Player>
// untouched while the seek bar/timecode update 5x/sec.
const MemoizedRemotionPlayer = React.memo(RemotionVideoPlayer);

export const VideoPreview: React.FC<VideoPreviewProps> = React.memo(({
  playerRef, liveScenes, transcriptionData,
  audioUrl, bgMusicUrl, bgMusicVolume, voiceoverVolume, styleType, language, videoFormat, subtitleSettings,
  designSystem,
  onFrameUpdate, isPipelineRunning, pipelineProgress, fullscreenToggleRef
}) => {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const previewQuality = useEditorStore((s) => s.previewQuality);
  const setPreviewQuality = useEditorStore((s) => s.setPreviewQuality);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const [zoom, setZoom] = React.useState<'fit' | '100' | '150'>('fit');
  const [showOverlay, setShowOverlay] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const trackMuted = useEditorStore((s) => s.trackMuted);
  const trackHidden = useEditorStore((s) => s.trackHidden);

  React.useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
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
  };

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

  const formatTimestamp = (frame: number) => {
    const totalSeconds = Math.floor(frame / 30);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    const f = (frame % 30).toString().padStart(2, '0');
    return `${m}:${s}:${f}`;
  };

  // Find active scene label
  let activeSceneLabel = '';
  let offset = 0;
  for (let i = 0; i < (liveScenes || []).length; i++) {
    const scene = liveScenes[i];
    const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
    if (currentFrame >= offset && currentFrame < offset + durationFrames) {
      activeSceneLabel = scene.title || `${scene.section_type === 'introduction' ? 'Introduction' : scene.section_type === 'conclusion' ? 'Conclusion' : `Scene ${i}`}`;
      break;
    }
    offset += durationFrames;
  }

  const zoomScale = zoom === 'fit' ? 0.9 : zoom === '100' ? 0.8 : 1.35;

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

  const handleSeekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || totalFrames <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const frame = Math.round((x / rect.width) * totalFrames);
    playerRef.current.seekTo(frame);
  };

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
          {activeSceneLabel && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-600/15 text-blue-400 px-2.5 py-0.5 rounded border border-blue-600/25">
              {activeSceneLabel}
            </span>
          )}
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
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-zinc-950/50">
        <div className="flex-1 flex items-center justify-center p-6">
          <motion.div
            className="relative w-full max-w-full"
            animate={{ scale: zoomScale }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Outer monitor chrome */}
            <div className="rounded-lg overflow-hidden shadow-2xl shadow-black/60 border border-zinc-800/40 bg-black">
              {/* Inner screen bezel */}
              <div className="rounded-[3px] overflow-hidden">
                <MemoizedRemotionPlayer
                  ref={playerRef}
                  audioUrl={audioUrl}
                  bgMusicUrl={bgMusicUrl}
                  bgMusicVolume={trackMuted['music'] || trackHidden['music'] ? 0 : bgMusicVolume}
                  voiceoverVolume={trackMuted['voice'] || trackHidden['voice'] ? 0 : voiceoverVolume}
                  muteVideoAudio={!!(trackMuted['videoaudio'] || trackHidden['videoaudio'])}
                  scenes={liveScenes}
                  transcription={trackHidden['subs'] ? { segments: [] } : transcriptionData}
                  styleType={styleType}
                  language={language}
                  videoFormat={videoFormat}
                  subtitleSettings={playerSubtitleSettings}
                  designSystem={designSystem}
                  compositionScale={previewQuality === 'full' ? 1 : 0.5}
                  onFrameUpdate={onFrameUpdate}
                  onPlayStateChange={setIsPlaying}
                />
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
        <div className="px-4 py-2 w-full">
          <div
            className="relative h-2 cursor-pointer group"
            onClick={handleSeekBar}
          >
            {/* Track background */}
            <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-zinc-800/60 overflow-hidden">
              {/* Filled progress */}
              <div
                className="h-full bg-linear-to-r from-blue-600 to-cyan-500 rounded-full transition-[width] duration-75"
                style={{ width: `${totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0}%` }}
              />
            </div>
            {/* Hover target: larger invisible hit area */}
            <div className="absolute inset-0 -top-2 -bottom-2" />
            {/* Seek handle dot — visible on hover */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                left: `${totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
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
          <div className="flex items-baseline gap-[2px] px-2.5 py-1 rounded bg-zinc-900/80 border border-zinc-800/50 font-mono">
            <span className="text-sm font-bold text-white tabular-nums tracking-wider">
              {formatTimestamp(currentFrame)}
            </span>
            <span className="text-[10px] text-zinc-500 ml-2">30fps</span>
          </div>
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
