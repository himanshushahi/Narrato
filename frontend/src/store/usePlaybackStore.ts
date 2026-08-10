import { create } from 'zustand';

interface PlaybackStore {
  /** Current playhead frame of the preview player (updated ~5x/sec while playing). */
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
}

/**
 * Playhead position lives outside React state so frame updates only
 * re-render the components that subscribe (playhead, seek bar, active
 * scene highlight) instead of the whole editor workspace.
 */
export const usePlaybackStore = create<PlaybackStore>((set) => ({
  currentFrame: 0,
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
}));
