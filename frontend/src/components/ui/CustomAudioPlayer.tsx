import React, { useRef, useState, useEffect, useCallback } from 'react';
import { VscPlay, VscLoading } from 'react-icons/vsc';

const PauseIcon: React.FC = () => (
  <span className="flex items-center gap-[2px]">
    <span className="w-[2.5px] h-2.5 bg-current rounded-[1px]" />
    <span className="w-[2.5px] h-2.5 bg-current rounded-[1px]" />
  </span>
);

interface CustomAudioPlayerProps {
  /** URL of the audio file to play */
  src: string;
  /** Volume level 0–1 */
  volume: number;
}

/** Format seconds to m:ss display */
const formatSeconds = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Minimal custom audio player with play/pause, seek bar, and time display.
 * Replaces the native <audio controls> element for consistent dark-themed styling.
 */
export const CustomAudioPlayer: React.FC<CustomAudioPlayerProps> = ({ src, volume }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Manage Audio instance lifecycle (new instance per src change)
  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audio.volume = Math.max(0, Math.min(1, volume));

    const onLoad = () => {
      setDuration(audio.duration);
      setIsReady(true);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      audio.currentTime = 0;
      setCurrentTime(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoad);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoad);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audioRef.current = null;
    };
  }, [src]);

  // Sync volume from parent in real time
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, [volume]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isReady]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !isReady || !duration) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const seekTime = (x / rect.width) * duration;

      audio.currentTime = seekTime;
      setCurrentTime(seekTime);
    },
    [isReady, duration],
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 w-full">
      {/* Play / Pause button */}
      <button
        onClick={togglePlayPause}
        disabled={!isReady}
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/40 text-zinc-300 hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {!isReady ? (
          <VscLoading className="text-xs animate-spin" />
        ) : isPlaying ? (
          <PauseIcon />
        ) : (
          <VscPlay className="text-xs ml-px" />
        )}
      </button>

      {/* Seek bar — clickable progress track */}
      <div
        className="flex-1 h-1.5 bg-zinc-800 rounded-full cursor-pointer group relative"
        onClick={handleSeek}
        role="slider"
        aria-label="Audio seek"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        <div
          className="h-full bg-linear-to-r from-blue-500 to-cyan-400 rounded-full transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        />
        {/* Hover dim overlay */}
        <div className="absolute inset-0 rounded-full group-hover:bg-white/[0.04] transition-colors pointer-events-none" />
      </div>

      {/* Time display */}
      <span className="text-[9px] font-mono text-zinc-500 shrink-0 tabular-nums w-[5.5rem] text-right">
        {isReady
          ? `${formatSeconds(currentTime)} / ${formatSeconds(duration)}`
          : '--:-- / --:--'}
      </span>
    </div>
  );
};
