import React from 'react';
import { motion } from 'framer-motion';
import { VscPlay, VscDebugPause, VscScreenFull, VscLoading } from 'react-icons/vsc';
import RemotionVideoPlayer, { RemotionVideoPlayerRef } from '../../components/video/RemotionVideoPlayer';
import { useEditorStore } from '../../store/useEditorStore';

interface VideoPreviewProps {
  playerRef: React.RefObject<RemotionVideoPlayerRef | null>;
  liveScenes: any[];
  transcriptionData: any;
  currentFrame: number;
  audioUrl: string;
  bgMusicUrl: string;
  bgMusicVolume?: number;
  styleType?: string;
  language?: string;
  videoFormat?: string;
  subtitleSettings: any;
  onFrameUpdate: (frame: number) => void;
  isPipelineRunning?: boolean;
  pipelineProgress?: number;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  playerRef, liveScenes, transcriptionData, currentFrame,
  audioUrl, bgMusicUrl, bgMusicVolume, styleType, language, videoFormat, subtitleSettings,
  onFrameUpdate, isPipelineRunning, pipelineProgress
}) => {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const [zoom, setZoom] = React.useState<'fit' | '100' | '150'>('fit');
  const [showOverlay, setShowOverlay] = React.useState(false);

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

  const zoomScale = zoom === 'fit' ? 1 : zoom === '100' ? 0.9 : 1.35;

  return (
    <div
      className="h-full flex flex-col bg-black/40 relative overflow-hidden"
      onMouseEnter={() => setShowOverlay(true)}
      onMouseLeave={() => setShowOverlay(false)}
    >
      {/* Scene label badge */}
      {activeSceneLabel && (
        <div className="absolute top-3 left-3 z-20">
          <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-600/20 text-blue-400 px-2.5 py-1 rounded-md border border-blue-600/30 backdrop-blur-sm">
            {activeSceneLabel}
          </span>
        </div>
      )}

      {/* AI Generation progress overlay */}
      {isPipelineRunning && (
        <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <VscLoading className="text-3xl text-blue-400 animate-spin" />
            <p className="text-sm text-blue-300 font-bold">AI Generation in Progress</p>
            {pipelineProgress !== undefined && (
              <div className="w-48 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-blue-600 to-cyan-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${pipelineProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video player — always rendered. RemotionVideoPlayer handles empty state internally */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <motion.div
          className="relative w-full max-w-full"
          animate={{ scale: zoomScale }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-zinc-800/60">
            <RemotionVideoPlayer
              ref={playerRef}
              audioUrl={audioUrl}
              bgMusicUrl={bgMusicUrl}
              bgMusicVolume={bgMusicVolume}
              scenes={liveScenes}
              transcription={transcriptionData}
              styleType={styleType}
              language={language}
              videoFormat={videoFormat}
              subtitleSettings={subtitleSettings}
              onFrameUpdate={onFrameUpdate}
              onPlayStateChange={setIsPlaying}
            />
          </div>
        </motion.div>
      </div>

      {/* Controls overlay — always visible, fades slightly when idle */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-8"
        initial={false}
        animate={{ opacity: showOverlay ? 1 : 0.85 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {isPlaying ? <VscDebugPause className="text-sm" /> : <VscPlay className="text-sm" />}
            </button>
            <span className="text-[11px] font-mono text-zinc-300 tabular-nums">
              {formatTimestamp(currentFrame)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom('fit')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${zoom === 'fit' ? 'bg-blue-600/30 text-blue-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              Fit
            </button>
            <button
              onClick={() => setZoom('100')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${zoom === '100' ? 'bg-blue-600/30 text-blue-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              100%
            </button>
            <button
              onClick={() => setZoom('150')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${zoom === '150' ? 'bg-blue-600/30 text-blue-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              150%
            </button>
            <div className="w-px h-4 bg-zinc-700 mx-1" />
            <button className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
              <VscScreenFull className="text-xs" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
