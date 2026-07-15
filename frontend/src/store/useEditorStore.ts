import { create } from 'zustand';

export type LeftPanelTab = 'scenes' | 'assets' | 'music';
export type InspectorTab = 'script' | 'subtitle' | 'voice' | 'export' | 'settings';

interface EditorStore {
  // Panel dimensions (resizable like VS Code)
  leftPanelWidth: number;
  rightPanelWidth: number;
  timelineHeight: number;

  // Active tabs
  leftPanelTab: LeftPanelTab;
  inspectorTab: InspectorTab;

  // Selection
  selectedSceneIndex: number | null;
  selectedSubVisualIndex: number | null;

  // Command palette
  commandPaletteOpen: boolean;

  // Video playback
  isPlaying: boolean;

  // Timeline zoom (pixels per second)
  timelineZoom: number;

  // Track visibility and mute states
  trackMuted: Record<string, boolean>;
  trackHidden: Record<string, boolean>;

  // Actions
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setSelectedSceneIndex: (idx: number | null) => void;
  setSelectedSubVisualIndex: (idx: number | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setTimelineZoom: (zoom: number) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackHide: (trackId: string) => void;
}

const STORAGE_KEY = 'narrato_editor_layout';

// Load synchronously is not possible with pywebview, so we will hydrate asynchronously.
let saveTimeout: any = null;

const saveLayout = async (state: Partial<EditorStore>) => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      if (window.pywebview) {
        const prefs = await window.pywebview.api.get_prefs();
        prefs[STORAGE_KEY] = JSON.stringify({
          leftPanelWidth: state.leftPanelWidth,
          rightPanelWidth: state.rightPanelWidth,
          timelineHeight: state.timelineHeight,
          leftPanelTab: state.leftPanelTab,
          inspectorTab: state.inspectorTab,
          timelineZoom: state.timelineZoom,
          trackMuted: state.trackMuted,
          trackHidden: state.trackHidden,
        });
        await window.pywebview.api.save_prefs(prefs);
      }
    } catch { /* ignore */ }
  }, 1000); // debounce save
};

const defaults = {
  leftPanelWidth: 300,
  rightPanelWidth: 380,
  timelineHeight: 200,
  leftPanelTab: 'scenes' as LeftPanelTab,
  inspectorTab: 'script' as InspectorTab,
  timelineZoom: 15,
  trackMuted: {} as Record<string, boolean>,
  trackHidden: {} as Record<string, boolean>,
};

let persisted: Partial<EditorStore> = {};
try {
  const prefs = (window as any).__INITIAL_PREFS__ || {};
  if (prefs[STORAGE_KEY]) {
    persisted = JSON.parse(prefs[STORAGE_KEY]);
  }
} catch { /* ignore */ }

export const useEditorStore = create<EditorStore>((set) => ({
  // State
  leftPanelWidth: persisted.leftPanelWidth ?? defaults.leftPanelWidth,
  rightPanelWidth: persisted.rightPanelWidth ?? defaults.rightPanelWidth,
  timelineHeight: persisted.timelineHeight ?? defaults.timelineHeight,
  leftPanelTab: persisted.leftPanelTab ?? defaults.leftPanelTab,
  inspectorTab: persisted.inspectorTab ?? defaults.inspectorTab,
  selectedSceneIndex: null,
  selectedSubVisualIndex: null,
  commandPaletteOpen: false,
  isPlaying: false,
  timelineZoom: persisted.timelineZoom ?? defaults.timelineZoom,
  trackMuted: persisted.trackMuted ?? defaults.trackMuted,
  trackHidden: persisted.trackHidden ?? defaults.trackHidden,

  // Actions
  setLeftPanelWidth: (w) => set((s) => { const next = { ...s, leftPanelWidth: w }; saveLayout(next); return next; }),
  setRightPanelWidth: (w) => set((s) => { const next = { ...s, rightPanelWidth: w }; saveLayout(next); return next; }),
  setTimelineHeight: (h) => set((s) => { const next = { ...s, timelineHeight: h }; saveLayout(next); return next; }),
  setLeftPanelTab: (tab) => set((s) => { const next = { ...s, leftPanelTab: tab }; saveLayout(next); return next; }),
  setInspectorTab: (tab) => set((s) => { const next = { ...s, inspectorTab: tab }; saveLayout(next); return next; }),
  setSelectedSceneIndex: (idx) => set({ selectedSceneIndex: idx }),
  setSelectedSubVisualIndex: (idx) => set({ selectedSubVisualIndex: idx }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setTimelineZoom: (zoom) => set((s) => { const next = { ...s, timelineZoom: zoom }; saveLayout(next); return next; }),
  toggleTrackMute: (trackId) => set((s) => {
    const next = { ...s, trackMuted: { ...s.trackMuted, [trackId]: !s.trackMuted[trackId] } };
    saveLayout(next);
    return next;
  }),
  toggleTrackHide: (trackId) => set((s) => {
    const next = { ...s, trackHidden: { ...s.trackHidden, [trackId]: !s.trackHidden[trackId] } };
    saveLayout(next);
    return next;
  }),
}));
