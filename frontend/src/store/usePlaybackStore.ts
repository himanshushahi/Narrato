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
export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  currentFrame: 0,
  // Equality guard: seeks/polls often repeat the current frame (quality
  // restore loop, 50ms player poll, timeline re-seeks). Skipping the set
  // avoids notifying unfiltered subscribers on every repeat.
  setCurrentFrame: (frame) => {
    if (get().currentFrame !== frame) set({ currentFrame: frame });
  },
}));
