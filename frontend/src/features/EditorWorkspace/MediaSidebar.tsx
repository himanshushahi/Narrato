import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscLayers, VscPackage, VscMusic,
  VscSearch, VscAdd, VscWarning,
  VscCheck, VscLoading, VscListFlat, VscSymbolField,
  VscRefresh, VscPlay, VscTrash,
  VscCode, VscGlobe, VscFileMedia
} from 'react-icons/vsc';
import { ScrollableTabBar } from '../../components/ui/ScrollableTabBar';
import { CustomAudioPlayer } from '../../components/ui/CustomAudioPlayer';
import { CustomRange } from '../../components/ui/CustomRange';
import { CustomToggle } from '../../components/ui/CustomToggle';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { useEditorStore, LeftPanelTab } from '../../store/useEditorStore';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { MusicClip } from '../../components/video/NitishRajputComposition';
import { callApi } from '../../utils/call-api';
import { getMediaUrlSync, getMediaThumbUrl } from '../../utils/mediaUrl';
import { formatTime } from '../../features/ProjectEditor/constants';
import { useProjectAssets, AssetEntry, AssetCategory } from './hooks/useProjectAssets';
import { useAudioWaveform } from './hooks/useAudioWaveform';
import { Scissors } from 'lucide-react';

interface MediaSidebarProps {
  scriptData: any;
  manifestData: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  onSeek?: (frame: number) => void;
  projectId?: string;
  isPipelineRunning?: boolean;
  activeTaskStep?: any;
  reloadTrigger?: number;
  musicClips?: MusicClip[];
  onUpdateMusicClips?: (clips: MusicClip[]) => Promise<boolean | void>;
  onUploadMusicClip?: (startFrame?: number) => Promise<void>;
  bgMusicVolume?: number;
  onBgMusicVolumeChange?: (vol: number) => void;
}

/** Format bytes to a human-readable string */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/** Guess if a file is a video by its extension */
const isVideoFile = (ext?: string): boolean => {
  if (!ext) return false;
  const e = ext.toLowerCase();
  return e === '.mp4' || e === '.webm' || e === '.mov' || e === '.mkv' || e === '.avi';
};

/** Guess if a file is an image by its extension */
const isImageFile = (ext?: string): boolean => {
  if (!ext) return false;
  const e = ext.toLowerCase();
  return e === '.jpg' || e === '.jpeg' || e === '.png' || e === '.webp' || e === '.gif' || e === '.svg';
};

/** Returns a display icon and label for a given file extension */
const fileTypeBadge = (ext: string, category?: string): { icon: React.ReactNode; label: string; color: string } => {
  if (category === 'video' || isVideoFile(ext)) return { icon: <VscPlay />, label: 'MP4', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
  if (category === 'image' || isImageFile(ext)) return { icon: <VscFileMedia />, label: (ext.replace('.', '') || 'IMG').toUpperCase(), color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  if (category === 'html' || ext === '.html') return { icon: <VscCode />, label: 'HTML', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' };
  if (category === 'map' || ext === '.geo') return { icon: <VscGlobe />, label: 'MAP', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' };
  if (category === 'audio' || ext === '.mp3' || ext === '.wav') return { icon: <VscMusic />, label: 'AUDIO', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  return { icon: <VscPackage />, label: (ext || 'FILE').replace('.', '').toUpperCase(), color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' };
};

const SelectedMusicClipCard: React.FC<{
  selectedClip: MusicClip;
  effectiveMusicClips: MusicClip[];
  localVolume: number;
  onPatchSelectedClip: (patch: Partial<MusicClip>) => void;
  onDeleteClip: (id: string) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateClip: () => void;
  onSelectClipId: (id: string) => void;
}> = ({
  selectedClip,
  effectiveMusicClips,
  localVolume,
  onPatchSelectedClip,
  onDeleteClip,
  onSplitAtPlayhead,
  onDuplicateClip,
  onSelectClipId,
}) => {
  const { duration: audioDuration } = useAudioWaveform(selectedClip?.audio_url);

  // Local draft: sliders/toggles update instantly (no backend roundtrip per
  // tick); the merged patch is committed through a trailing debounce. The
  // draft auto-clears once the parent prop catches up with it.
  const [draft, setDraft] = useState<{ id: string; patch: Partial<MusicClip> } | null>(null);
  let activeDraft = draft;
  if (draft) {
    if (draft.id !== selectedClip.id) {
      activeDraft = null;
    } else {
      const caughtUp = Object.entries(draft.patch).every(([k, v]) => (selectedClip as any)[k] === v);
      if (caughtUp) activeDraft = null;
    }
  }
  if (activeDraft !== draft) setDraft(activeDraft);
  const shown = activeDraft ? { ...selectedClip, ...activeDraft.patch } as MusicClip : selectedClip;

  const patchRef = useRef(onPatchSelectedClip);
  patchRef.current = onPatchSelectedClip;
  const selectedClipRef = useRef(selectedClip);
  selectedClipRef.current = selectedClip;
  const commitPatch = useCallback((patch: Partial<MusicClip>) => patchRef.current(patch), []);
  const schedulePatch = useDebouncedCommit<MusicClip>(commitPatch);

  const updateDraft = useCallback((patch: Partial<MusicClip>) => {
    const baseId = selectedClipRef.current?.id;
    if (!baseId) return;
    setDraft((prev) => {
      if (prev && prev.id === baseId) return { id: prev.id, patch: { ...prev.patch, ...patch } };
      return { id: baseId, patch: { ...patch } };
    });
    schedulePatch(patch);
  }, [schedulePatch]);

  return (
    <div className="bg-zinc-900/50 border border-blue-500/30 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
            <VscMusic className="text-blue-400 text-xs" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-zinc-100 truncate">{selectedClip.name || 'Selected Music'}</p>
            <p className="text-[9px] text-zinc-500 font-mono">
              {formatTime(selectedClip.start_frame || 0)} → {formatTime((selectedClip.start_frame || 0) + (selectedClip.duration_frames || 30))}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSplitAtPlayhead}
            className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-cyan-300 hover:text-white rounded cursor-pointer"
            title="Split at playhead"
          >
            <Scissors className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDuplicateClip}
            className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-purple-300 hover:text-white rounded cursor-pointer"
            title="Duplicate clip"
          >
            <VscLayers className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteClip(selectedClip.id)}
            className="p-1.5 bg-zinc-800/80 hover:bg-red-900/60 text-red-400 hover:text-red-200 rounded cursor-pointer"
            title="Delete clip"
          >
            <VscTrash className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Audio Preview Player */}
      {selectedClip.audio_url && (
        <div className="pt-0.5">
          <CustomAudioPlayer src={selectedClip.audio_url} volume={shown.volume ?? localVolume} />
        </div>
      )}

      {/* Clip Selector if multiple clips */}
      {effectiveMusicClips.length > 1 && (
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-400 font-medium">Select Clip</label>
          <CustomSelect
            value={selectedClip.id}
            onChange={(val) => onSelectClipId(val)}
            options={effectiveMusicClips.map((c, i) => ({
              value: c.id,
              label: `${i + 1}. ${c.name || 'Clip'} (${((c.duration_frames || 30) / 30).toFixed(1)}s)`,
            }))}
          />
        </div>
      )}

      {/* Clip Volume */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-400 font-medium">Clip Volume</span>
          <span className="font-mono text-blue-300 font-bold">{Math.round((shown.volume ?? 0.2) * 100)}%</span>
        </div>
        <CustomRange
          min={0}
          max={1.5}
          step={0.02}
          value={shown.volume ?? 0.2}
          onChange={(e) => updateDraft({ volume: parseFloat(e.target.value) })}
        />
      </div>

      {/* Fade In */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-400 font-medium">Fade In Duration</span>
          <span className="font-mono text-blue-300 font-bold">{(shown.fade_in_seconds || 0).toFixed(1)}s</span>
        </div>
        <CustomRange
          min={0}
          max={5.0}
          step={0.1}
          value={shown.fade_in_seconds || 0}
          onChange={(e) => updateDraft({ fade_in_seconds: parseFloat(e.target.value) })}
        />
      </div>

      {/* Fade Out */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-400 font-medium">Fade Out Duration</span>
          <span className="font-mono text-blue-300 font-bold">{(shown.fade_out_seconds || 0).toFixed(1)}s</span>
        </div>
        <CustomRange
          min={0}
          max={5.0}
          step={0.1}
          value={shown.fade_out_seconds || 0}
          onChange={(e) => updateDraft({ fade_out_seconds: parseFloat(e.target.value) })}
        />
      </div>

      {/* Audio In-Point Trim */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-400 font-medium">Audio In-Point (Trim Start)</span>
          <span className="font-mono text-blue-300 font-bold">{(shown.source_start_seconds || 0).toFixed(1)}s</span>
        </div>
        <CustomRange
          min={0}
          max={60}
          step={0.5}
          value={shown.source_start_seconds || 0}
          onChange={(e) => updateDraft({ source_start_seconds: parseFloat(e.target.value) })}
        />
      </div>

      {/* Toggles */}
      <div className="pt-2 border-t border-zinc-800/60 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold text-zinc-200">Seamless Looping</div>
            <div className="text-[8.5px] text-zinc-500">Repeats audio if clip is longer than source file</div>
          </div>
          <CustomToggle
            label="Loop"
            checked={shown.loop !== false}
            onChange={(e) => {
              const newLoop = e.target.checked;
              const patch: Partial<MusicClip> = { loop: newLoop };
              if (!newLoop) {
                const srcDur = selectedClip.source_duration_seconds || audioDuration;
                if (srcDur && srcDur > 0) {
                  const maxFrames = Math.max(15, Math.round((srcDur - (selectedClip.source_start_seconds || 0)) * 30));
                  if ((selectedClip.duration_frames || 0) > maxFrames) {
                    patch.duration_frames = maxFrames;
                  }
                }
              }
              updateDraft(patch);
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold text-zinc-200">Mute Clip</div>
            <div className="text-[8.5px] text-zinc-500">Mutes this specific clip</div>
          </div>
          <CustomToggle
            label="Muted"
            checked={!!shown.is_muted}
            onChange={(e) => updateDraft({ is_muted: e.target.checked })}
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   Re-render performance helpers
   ============================================================ */

/**
 * Batches rapid slider/input patches into a single trailing commit.
 * Sliders stay locally controlled (buttery thumb) while the expensive
 * backend persist + full-workspace re-render fires at most once per delay
 * window. Flushes any pending patch on unmount so no edit is lost.
 */
const COMMIT_DEBOUNCE_MS = 450;

function useDebouncedCommit<T extends object>(
  commit: (patch: Partial<T>) => void,
  delay: number = COMMIT_DEBOUNCE_MS,
) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Partial<T> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) commitRef.current(p);
  }, []);

  const schedule = useCallback((patch: Partial<T>) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delay);
  }, [delay, flush]);

  // Flush on unmount (e.g. tab switch mid-drag) so edits aren't lost.
  useEffect(() => () => { flush(); }, [flush]);

  return schedule;
}

/** Master music volume slider: locally controlled thumb, debounced persist. */
const MasterVolumeControl: React.FC<{
  value: number;
  onCommit: (v: number) => void;
}> = React.memo(({ value, onCommit }) => {
  const [draft, setDraft] = useState<number | null>(null);
  // Drop the draft once the parent prop catches up with it.
  let activeDraft = draft;
  if (draft !== null && draft === value) activeDraft = null;
  if (activeDraft !== draft) setDraft(activeDraft);
  const shown = activeDraft ?? value;

  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const commit = useCallback((patch: Partial<{ volume: number }>) => {
    if (patch.volume !== undefined) commitRef.current(patch.volume);
  }, []);
  const schedule = useDebouncedCommit<{ volume: number }>(commit);

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-400 font-medium">Master Music Volume</span>
        <span className="font-mono text-blue-300 font-bold">{Math.round(shown * 100)}%</span>
      </div>
      <CustomRange
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setDraft(v);
          schedule({ volume: v });
        }}
      />
    </div>
  );
});
MasterVolumeControl.displayName = 'MasterVolumeControl';

/** Single row in the "Timeline Music Clips" overview — memoized. */
const MusicClipRow: React.FC<{
  clip: MusicClip;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onSeekClip: (startFrame: number) => void;
}> = React.memo(({ clip, index, isSelected, onSelect, onDelete, onSeekClip }) => (
  <div
    onClick={() => { onSelect(clip.id); onSeekClip(clip.start_frame || 0); }}
    className={`flex items-center justify-between p-2 rounded border text-[11px] cursor-pointer transition-colors ${
      isSelected
        ? 'bg-blue-950/40 border-blue-500/50 text-blue-200'
        : 'bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
    }`}
  >
    <div className="flex items-center gap-2 overflow-hidden">
      <span className="font-mono text-[9px] text-blue-400 font-bold shrink-0">#{index + 1}</span>
      <span className="truncate max-w-[130px]">{clip.name || 'Clip'}</span>
    </div>
    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[9px] text-zinc-400">
      <span>{((clip.duration_frames || 30) / 30).toFixed(1)}s</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(clip.id); }}
        className="text-zinc-500 hover:text-red-400 p-1 cursor-pointer"
        title="Delete"
      >
        <VscTrash className="w-3 h-3" />
      </button>
    </div>
  </div>
));
MusicClipRow.displayName = 'MusicClipRow';

export const MediaSidebar: React.FC<MediaSidebarProps> = React.memo(({
  scriptData, manifestData, sceneTimings, onSeek,
  projectId, activeTaskStep, reloadTrigger = 0,
  musicClips = [], onUpdateMusicClips, onUploadMusicClip, bgMusicVolume, onBgMusicVolumeChange
}) => {
  const leftPanelWidth = useEditorStore((s) => s.leftPanelWidth);
  const leftPanelTab = useEditorStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);
  const selectedMusicClipId = useEditorStore((s) => s.selectedMusicClipId);
  const setSelectedMusicClipId = useEditorStore((s) => s.setSelectedMusicClipId);

  const scenes = scriptData?.scenes || [];
  const hasIntro = !!scriptData?.introduction;
  const hasConclusion = !!scriptData?.conclusion;

  // ---- Assets tab state ----
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('all');

  // ---- Scenes tab state ----
  const [sceneSearch, setSceneSearch] = useState('');

  // Stable sceneTimings ref so seek callbacks don't churn when the parent
  // re-renders (keeps memoized list items skipped).
  const sceneTimingsRef = useRef(sceneTimings);
  sceneTimingsRef.current = sceneTimings;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  /** Stable per-scene seek handler (index into sceneTimings). */
  const handleSceneSelect = useCallback((sceneIndex: number) => {
    onSeekRef.current?.(sceneTimingsRef.current[sceneIndex]?.start || 0);
  }, []);

  /** Stable asset seek handler passed by reference to memoized rows. */
  const handleAssetClick = useCallback((asset: AssetEntry) => {
    if (asset.timing) {
      onSeekRef.current?.(asset.timing.start);
    }
  }, []);

  const handleTabChange = useCallback((id: string) => {
    setLeftPanelTab(id as LeftPanelTab);
  }, [setLeftPanelTab]);

  /** Filtered scene items for the scenes tab */
  const filteredScenes = useMemo(() => {
    const q = sceneSearch.trim().toLowerCase();
    if (!q) return null; // null = no filtering, show everything

    const results: Array<{
      type: 'intro' | 'scene' | 'conclusion';
      number: string;
      title: string;
      subtitle: string;
      sceneIndex: number;
    }> = [];

    // Check introduction
    if (hasIntro) {
      const introText = [
        'introduction', '0',
        scriptData?.introduction?.hook || '',
      ].join(' ').toLowerCase();
      if (introText.includes(q)) {
        results.push({
          type: 'intro',
          number: '0',
          title: 'Introduction',
          subtitle: scriptData?.introduction?.hook?.slice(0, 60) || 'Hook',
          sceneIndex: 0,
        });
      }
    }

    // Check scenes
    (scenes || []).forEach((scene: any, idx: number) => {
      const sceneText = [
        String(idx + 1), scene.title || '', scene.narration || '',
      ].join(' ').toLowerCase();
      if (sceneText.includes(q)) {
        results.push({
          type: 'scene',
          number: String(idx + 1),
          title: scene.title || `Scene ${idx + 1}`,
          subtitle: scene.narration
            ? scene.narration.slice(0, 60) + (scene.narration.length > 60 ? '...' : '')
            : 'No narration',
          sceneIndex: (hasIntro ? 1 : 0) + idx,
        });
      }
    });

    // Check conclusion
    if (hasConclusion) {
      const concText = [
        'conclusion', String(scenes.length + 1),
        scriptData?.conclusion?.summary || '',
        scriptData?.conclusion?.cta || '',
      ].join(' ').toLowerCase();
      if (concText.includes(q)) {
        results.push({
          type: 'conclusion',
          number: String(scenes.length + 1),
          title: 'Conclusion',
          subtitle: 'Summary & CTA',
          sceneIndex: sceneTimings.length - 1,
        });
      }
    }

    return results;
  }, [sceneSearch, hasIntro, hasConclusion, scenes, scriptData, sceneTimings]);

  // Derive scene titles from scriptData
  const sceneTitles = useMemo(() => {
    const titles: string[] = [];
    if (hasIntro) titles.push('Introduction');
    (scenes || []).forEach((s: any) => titles.push(s.title || 'Untitled'));
    if (hasConclusion) titles.push('Conclusion');
    return titles;
  }, [scriptData, hasIntro, hasConclusion]);

  const isFetchingAssets = activeTaskStep?.step === 'fetch_assets' && activeTaskStep?.status === 'running';

  const {
    assets,
    totalSize,
    downloadedCount,
    pendingCount,
    categoryCounts,
    isScanning,
    refresh,
  } = useProjectAssets(projectId, manifestData, sceneTimings, sceneTitles, reloadTrigger, isFetchingAssets);

  // ---- Music tab state ----
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const fetchProjectDetail = useProjectStore((s) => s.fetchProjectDetail);
  const [uploading, setUploading] = useState(false);
  const [localVolume, setLocalVolume] = useState<number>(
    selectedProject?.bg_music_volume ?? 0.15,
  );

  const bgMusicPath = selectedProject?.bg_music_path || '';

  const bgMusicUrl = bgMusicPath
    ? `${getMediaUrlSync(bgMusicPath)}&t=${reloadTrigger}`
    : '';
  const bgMusicFilename = bgMusicPath ? bgMusicPath.split(/[/\\]/).pop() || 'Unknown' : '';

  // Keep localVolume in sync when project data reloads
  useEffect(() => {
    if (selectedProject?.bg_music_volume !== undefined) {
      setLocalVolume(selectedProject.bg_music_volume);
    }
  }, [selectedProject?.bg_music_volume]);

  const handleUploadMusic = useCallback(async () => {
    if (!projectId) return;
    setUploading(true);
    try {
      const result = await callApi<{ success: boolean }>('upload_project_bg_music', projectId);
      if (result?.success) {
        await fetchProjectDetail(projectId);
      }
    } catch (e) {
      console.error('Failed to upload bg music:', e);
    } finally {
      setUploading(false);
    }
  }, [projectId, fetchProjectDetail]);

  /** Master volume commit with explicit value (debounced slider calls this). */
  const handleMasterVolumeCommit = useCallback((v: number) => {
    setLocalVolume(v);
    if (onBgMusicVolumeChange) {
      onBgMusicVolumeChange(v);
    } else if (projectId) {
      updateProject(projectId, { bg_music_volume: v });
    }
  }, [onBgMusicVolumeChange, projectId, updateProject]);

  // ---- Derived music-clip list (hoisted so row callbacks stay stable) ----
  const totalTimelineFrames = sceneTimings.length > 0 ? sceneTimings[sceneTimings.length - 1].end : 300;
  const hasMusicClips = !!musicClips && musicClips.length > 0;
  const isClipsExplicitlyConfigured = selectedProject?.music_clips !== undefined && selectedProject?.music_clips !== null;
  const hasLegacyMusic = !isClipsExplicitlyConfigured && !!bgMusicPath;

  const effectiveMusicClips: MusicClip[] = useMemo(() => {
    if (hasMusicClips) return musicClips;
    if (hasLegacyMusic) {
      return [{
        id: 'default_bgm',
        name: bgMusicFilename || 'Background Music',
        audio_path: bgMusicPath,
        audio_url: bgMusicUrl,
        start_frame: 0,
        duration_frames: Math.max(30, totalTimelineFrames),
        source_start_seconds: 0,
        volume: localVolume,
        loop: true,
        fade_in_seconds: 0.5,
        fade_out_seconds: 1.0,
        is_muted: false,
      }];
    }
    return [];
  }, [hasMusicClips, musicClips, hasLegacyMusic, bgMusicPath, bgMusicUrl, bgMusicFilename, localVolume, totalTimelineFrames]);

  const selectedClip = effectiveMusicClips.find((c) => c.id === selectedMusicClipId) || effectiveMusicClips[0];

  const effectiveClipsRef = useRef(effectiveMusicClips);
  effectiveClipsRef.current = effectiveMusicClips;
  const onUpdateMusicClipsRef = useRef(onUpdateMusicClips);
  onUpdateMusicClipsRef.current = onUpdateMusicClips;

  const handleSelectClipId = useCallback((id: string) => {
    setSelectedMusicClipId(id);
  }, [setSelectedMusicClipId]);

  const handleDeleteMusicClip = useCallback((id: string) => {
    const updated = effectiveClipsRef.current.filter((c) => c.id !== id);
    onUpdateMusicClipsRef.current?.(updated);
    if (useEditorStore.getState().selectedMusicClipId === id) {
      setSelectedMusicClipId(updated[0]?.id || null);
    }
  }, [setSelectedMusicClipId]);

  const handleSeekClip = useCallback((startFrame: number) => {
    onSeekRef.current?.(startFrame || 0);
  }, []);

  // Filter & sort assets
  const filteredAssets = useMemo(() => {
    let list = assets;

    // Filter by selected category
    if (selectedCategory !== 'all') {
      list = list.filter((a) => a.category === selectedCategory);
    }

    // Filter by search query
    if (assetSearch.trim()) {
      const q = assetSearch.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.sceneTitle.toLowerCase().includes(q) ||
          (a.filename && a.filename.toLowerCase().includes(q)) ||
          (a.source && a.source.toLowerCase().includes(q)) ||
          (a.assetType && a.assetType.toLowerCase().includes(q)) ||
          (a.extraDetails && a.extraDetails.toLowerCase().includes(q))
      );
    }

    // Sort by scene index, then sub index, then layer index
    return [...list].sort((a, b) => {
      if (a.sceneIndex !== b.sceneIndex) return a.sceneIndex - b.sceneIndex;
      if (a.subIndex !== b.subIndex) return a.subIndex - b.subIndex;
      return (a.layerIndex ?? 0) - (b.layerIndex ?? 0);
    });
  }, [assets, selectedCategory, assetSearch]);

  // ---- Tab config with dynamic labels ----
  const tabConfig = useMemo(() => {
    const assetsLabel = `Assets (${assets.length})`;
    return [
      { id: 'scenes' as LeftPanelTab, label: 'Scenes', icon: <VscLayers /> },
      { id: 'assets' as LeftPanelTab, label: assetsLabel, icon: <VscPackage /> },
      { id: 'music' as LeftPanelTab, label: 'Music', icon: <VscMusic /> },
    ];
  }, [assets.length]);

  // Stable tabs array for the memoized tab bar (avoids re-render per parent render).
  const scrollTabs = useMemo(
    () => tabConfig.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
    [tabConfig],
  );

  // ---- Tab renderers ----

  const renderScenesTab = () => (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-zinc-800/40 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Scenes</h3>
          <span className="text-[9px] font-mono text-zinc-600">{scenes.length + (hasIntro ? 1 : 0) + (hasConclusion ? 1 : 0)} items</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/40">
          <VscSearch className="text-zinc-500 text-xs shrink-0" />
          <input
            type="text"
            placeholder="Search scenes..."
            value={sceneSearch}
            onChange={(e) => setSceneSearch(e.target.value)}
            className="bg-transparent text-[11px] text-zinc-300 placeholder-zinc-600 outline-none w-full"
          />
          {sceneSearch && (
            <button
              onClick={() => setSceneSearch('')}
              className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0 cursor-pointer"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
        {sceneSearch.trim() ? (
          /* ---- Search results ---- */
          filteredScenes!.length === 0 ? (
            <div className="text-center py-8 px-4">
              <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
                <VscSearch className="text-lg text-zinc-600" />
              </div>
              <p className="text-xs text-zinc-500">No scenes match <span className="text-zinc-400 font-mono">"{sceneSearch}"</span></p>
              <button
                onClick={() => setSceneSearch('')}
                className="mt-3 text-[10px] text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                Clear search
              </button>
            </div>
          ) : (
            filteredScenes!.map((item) => (
              <SceneListItem
                key={`${item.type}-${item.sceneIndex}`}
                index={item.sceneIndex}
                number={item.number}
                title={item.title}
                subtitle={item.subtitle}
                timing={sceneTimings[item.sceneIndex]}
                onSelect={handleSceneSelect}
              />
            ))
          )
        ) : (
          <>
            {/* Introduction */}
            {hasIntro && (
              <SceneListItem
                index={0}
                number="0"
                title="Introduction"
                subtitle="Hook"
                timing={sceneTimings[0]}
                onSelect={handleSceneSelect}
              />
            )}

            {/* Scenes */}
            {scenes.length === 0 ? (
              <div className="text-center py-8 px-4">
                <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
                  <VscLayers className="text-lg text-zinc-600" />
                </div>
                <p className="text-xs text-zinc-500">No scenes created</p>
              </div>
            ) : (
              scenes.map((scene: any, idx: number) => {
                const globalIdx = (hasIntro ? 1 : 0) + idx;
                const timing = sceneTimings[globalIdx];
                return (
                  <SceneListItem
                    key={idx}
                    index={globalIdx}
                    number={String(idx + 1)}
                    title={scene.title || `Scene ${idx + 1}`}
                    subtitle={scene.narration ? scene.narration.slice(0, 60) + (scene.narration.length > 60 ? '...' : '') : 'No narration'}
                    timing={timing}
                    onSelect={handleSceneSelect}
                  />
                );
              })
            )}

            {/* Conclusion */}
            {hasConclusion && (
              <SceneListItem
                index={sceneTimings.length - 1}
                number={String(scenes.length + 1)}
                title="Conclusion"
                subtitle="Summary & CTA"
                timing={sceneTimings[sceneTimings.length - 1]}
                onSelect={handleSceneSelect}
              />
            )}

          </>
        )}
      </div>
    </div>
  );

  // ---- Assets Tab ----

  const renderAssetsTab = () => (
    <div className="flex flex-col h-full">
      {/* Search + toolbar */}
      <div className="px-3 py-2.5 border-b border-zinc-800/40 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Project Assets</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1 rounded text-[10px] transition-colors cursor-pointer ${viewMode === 'list'
                ? 'text-blue-400 bg-blue-600/20'
                : 'text-zinc-600 hover:text-zinc-400'
                }`}
              title="List view"
            >
              <VscListFlat />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded text-[10px] transition-colors cursor-pointer ${viewMode === 'grid'
                ? 'text-blue-400 bg-blue-600/20'
                : 'text-zinc-600 hover:text-zinc-400'
                }`}
              title="Grid view"
            >
              <VscSymbolField />
            </button>
            <button
              onClick={refresh}
              disabled={isScanning}
              className={`p-1 rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer ${isScanning ? 'animate-spin pointer-events-none' : ''
                }`}
              title="Refresh assets from disk"
            >
              <VscRefresh />
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/40">
          <VscSearch className="text-zinc-500 text-xs shrink-0" />
          <input
            type="text"
            placeholder="Search prompt, scene, format..."
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
            className="bg-transparent text-[11px] text-zinc-300 placeholder-zinc-600 outline-none w-full"
          />
          {assetSearch && (
            <button
              onClick={() => setAssetSearch('')}
              className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0 cursor-pointer"
            >
              &times;
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'all'
              ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
              : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
              }`}
          >
            All <span className="opacity-70 font-mono text-[9px]">({categoryCounts.all})</span>
          </button>

          {categoryCounts.video > 0 && (
            <button
              onClick={() => setSelectedCategory('video')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'video'
                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
                }`}
            >
              <VscPlay className="text-[10px] text-blue-400 shrink-0" />
              Videos <span className="opacity-70 font-mono text-[9px]">({categoryCounts.video})</span>
            </button>
          )}

          {categoryCounts.image > 0 && (
            <button
              onClick={() => setSelectedCategory('image')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'image'
                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
                }`}
            >
              <VscFileMedia className="text-[10px] text-amber-400 shrink-0" />
              Images <span className="opacity-70 font-mono text-[9px]">({categoryCounts.image})</span>
            </button>
          )}

          {categoryCounts.html > 0 && (
            <button
              onClick={() => setSelectedCategory('html')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'html'
                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
                }`}
            >
              <VscCode className="text-[10px] text-purple-400 shrink-0" />
              Canvas <span className="opacity-70 font-mono text-[9px]">({categoryCounts.html})</span>
            </button>
          )}

          {categoryCounts.map > 0 && (
            <button
              onClick={() => setSelectedCategory('map')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'map'
                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
                }`}
            >
              <VscGlobe className="text-[10px] text-cyan-400 shrink-0" />
              Maps <span className="opacity-70 font-mono text-[9px]">({categoryCounts.map})</span>
            </button>
          )}

          {categoryCounts.audio > 0 && (
            <button
              onClick={() => setSelectedCategory('audio')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer shrink-0 border select-none ${selectedCategory === 'audio'
                ? 'bg-blue-600 border-blue-500 text-white shadow-xs'
                : 'bg-zinc-900/80 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-700/60'
                }`}
            >
              <VscMusic className="text-[10px] text-emerald-400 shrink-0" />
              Audio <span className="opacity-70 font-mono text-[9px]">({categoryCounts.audio})</span>
            </button>
          )}
        </div>

        {/* Stats summary */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="text-[9px] text-zinc-500">
            {assets.length > 0 ? (
              <span>
                <span className="text-zinc-300 font-medium">{filteredAssets.length}</span>
                {filteredAssets.length !== assets.length && (
                  <span className="text-zinc-500"> of {assets.length}</span>
                )}
                <span> Assets</span>
                <span className="text-zinc-600"> &middot; </span>
                <span className="text-zinc-400 font-mono">{formatFileSize(totalSize)}</span>
              </span>
            ) : (
              <span className="text-zinc-600">No assets</span>
            )}
          </div>
          {downloadedCount > 0 && (
            <span className="text-[8px] text-green-400/90 font-mono bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
              {downloadedCount} Ready
            </span>
          )}
        </div>
      </div>

      {/* Download progress banner */}
      <DownloadProgressBanner
        isFetching={isFetchingAssets}
        progress={activeTaskStep?.progress}
        message={activeTaskStep?.message}
        downloadedCount={downloadedCount}
        pendingCount={pendingCount}
      />

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {filteredAssets.length === 0 ? (
          <AssetsEmptyState
            searchActive={assetSearch.trim().length > 0 || selectedCategory !== 'all'}
            hasManifest={manifestData.length > 0}
            isFetching={isFetchingAssets}
          />
        ) : viewMode === 'list' ? (
          <div className="p-2 space-y-1.5">
            {filteredAssets.map((asset) => (
              <AssetListItem
                key={asset.key}
                asset={asset}
                isFetching={isFetchingAssets}
                onSelect={handleAssetClick}
              />
            ))}
          </div>
        ) : (
          <div className="p-2 grid grid-cols-2 gap-2">
            {filteredAssets.map((asset) => (
              <AssetGridItem
                key={asset.key}
                asset={asset}
                isFetching={isFetchingAssets}
                onSelect={handleAssetClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderMusicTab = () => {
    if (effectiveMusicClips.length === 0) {
      return (
        <div className="flex flex-col h-full p-4 text-center">
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
              <VscMusic className="text-xl text-zinc-500" />
            </div>
            <p className="text-xs text-zinc-300 font-medium mb-1">No Background Music</p>
            <p className="text-[9px] text-zinc-600 mb-4 max-w-40 leading-relaxed">
              Upload audio tracks to the background music timeline
            </p>
            <button
              onClick={() => onUploadMusicClip ? onUploadMusicClip(0) : handleUploadMusic()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <VscLoading className="text-xs animate-spin" />
              ) : (
                <VscAdd className="text-xs" />
              )}
              {uploading ? 'Uploading...' : 'Upload Music'}
            </button>
          </div>
        </div>
      );
    }

    const handlePatchSelectedClip = (patch: Partial<MusicClip>) => {
      if (!selectedClip) return;
      const updated = effectiveMusicClips.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c));
      onUpdateMusicClips?.(updated);
    };

    const handleSplitAtPlayhead = () => {
      if (!selectedClip) return;
      const playheadFrame = usePlaybackStore.getState().currentFrame;
      if (playheadFrame <= selectedClip.start_frame + 10 || playheadFrame >= selectedClip.start_frame + selectedClip.duration_frames - 10) {
        return;
      }

      const firstDuration = playheadFrame - selectedClip.start_frame;
      const secondDuration = selectedClip.duration_frames - firstDuration;
      const srcDur = selectedClip.source_duration_seconds;
      let secondSrcStart = (selectedClip.source_start_seconds || 0) + (firstDuration / 30);
      if (srcDur && srcDur > 0) {
        secondSrcStart = secondSrcStart % srcDur;
      }

      const clip1: MusicClip = {
        ...selectedClip,
        duration_frames: firstDuration,
        fade_out_seconds: Math.min(selectedClip.fade_out_seconds || 0.5, (firstDuration / 30) / 2),
      };

      const clip2: MusicClip = {
        ...selectedClip,
        id: `mc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        start_frame: playheadFrame,
        duration_frames: secondDuration,
        source_start_seconds: secondSrcStart,
        fade_in_seconds: Math.min(selectedClip.fade_in_seconds || 0.5, (secondDuration / 30) / 2),
      };

      const idx = effectiveMusicClips.findIndex((c) => c.id === selectedClip.id);
      if (idx === -1) return;
      const nextClips = [...effectiveMusicClips];
      nextClips.splice(idx, 1, clip1, clip2);
      onUpdateMusicClips?.(nextClips);
      setSelectedMusicClipId(clip2.id);
    };

    const handleDuplicateClip = () => {
      if (!selectedClip) return;
      const newClip: MusicClip = {
        ...selectedClip,
        id: `mc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        start_frame: selectedClip.start_frame + selectedClip.duration_frames,
      };
      onUpdateMusicClips?.([...effectiveMusicClips, newClip]);
      setSelectedMusicClipId(newClip.id);
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto p-3 space-y-3">
        {/* Master Background Music Volume Header */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <VscMusic className="text-blue-400 text-sm" />
              <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wide">Background Music</span>
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={async () => {
                const currentF = usePlaybackStore.getState().currentFrame;
                if (onUploadMusicClip) {
                  await onUploadMusicClip(currentF);
                } else {
                  handleUploadMusic();
                }
              }}
              className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] font-bold transition-all cursor-pointer shadow disabled:opacity-50"
            >
              <VscAdd className="text-xs" />
              <span>Add Track</span>
            </button>
          </div>

          <div className="space-y-1 pt-1">
            <MasterVolumeControl
              value={bgMusicVolume ?? localVolume}
              onCommit={handleMasterVolumeCommit}
            />
          </div>
        </div>

        {/* Selected Music Clip Card & Controls */}
        {selectedClip && (
          <SelectedMusicClipCard
            selectedClip={selectedClip}
            effectiveMusicClips={effectiveMusicClips}
            localVolume={localVolume}
            onPatchSelectedClip={handlePatchSelectedClip}
            onDeleteClip={handleDeleteMusicClip}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onDuplicateClip={handleDuplicateClip}
            onSelectClipId={handleSelectClipId}
          />
        )}

        {/* All Music Clips Overview */}
        {effectiveMusicClips.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              Timeline Music Clips ({effectiveMusicClips.length})
            </div>
            <div className="space-y-1">
              {effectiveMusicClips.map((c, i) => (
                <MusicClipRow
                  key={c.id}
                  clip={c}
                  index={i}
                  isSelected={selectedClip?.id === c.id}
                  onSelect={handleSelectClipId}
                  onDelete={handleDeleteMusicClip}
                  onSeekClip={handleSeekClip}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTabContent = () => {
    switch (leftPanelTab) {
      case 'scenes': return renderScenesTab();
      case 'assets': return renderAssetsTab();
      case 'music': return renderMusicTab();
    }
  };

  return (
    <div className="h-full bg-zinc-950/80 border-r border-zinc-800/60 flex flex-col overflow-x-hidden" style={{ width: leftPanelWidth }}>
      {/* Tab bar — scrollable with hover-reveal buttons */}
      <ScrollableTabBar
        tabs={scrollTabs}
        activeTab={leftPanelTab}
        onChange={handleTabChange}
      />

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={leftPanelTab}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col h-full min-h-0"
          >
            {renderTabContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
});

/* ============================================================
   Assets Sub-components
   ============================================================ */

/** Banner shown during the fetch_assets pipeline step */
const DownloadProgressBanner: React.FC<{
  isFetching: boolean;
  progress?: number;
  message?: string;
  downloadedCount: number;
  pendingCount: number;
}> = React.memo(({ isFetching, progress, message }) => {
  if (!isFetching) return null;

  const pct = Math.round(progress ?? 0);

  return (
    <div className="px-3 py-2.5 bg-blue-950/30 border-b border-blue-900/40">
      <div className="flex items-center gap-2 mb-1.5">
        <VscLoading className="text-blue-400 text-xs animate-spin shrink-0" />
        <span className="text-[10px] text-blue-300 font-medium truncate">
          {message || 'Downloading visual assets...'}
        </span>
      </div>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-linear-to-r from-blue-500 to-cyan-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-blue-400/70">{pct}%</span>
      </div>
    </div>
  );
});

/** Empty state for assets tab */
const AssetsEmptyState: React.FC<{
  searchActive: boolean;
  hasManifest: boolean;
  isFetching: boolean;
}> = ({ searchActive, hasManifest, isFetching }) => {
  if (isFetching) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <VscLoading className="text-xl text-blue-500 animate-spin mb-3" />
        <p className="text-xs text-zinc-400 font-medium">Fetching assets...</p>
        <p className="text-[9px] text-zinc-600 mt-1">Assets will appear here as they download</p>
      </div>
    );
  }

  if (searchActive) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <VscSearch className="text-lg text-zinc-600 mb-3" />
        <p className="text-xs text-zinc-500 font-medium">No assets match your search</p>
        <p className="text-[9px] text-zinc-600 mt-1">Try a different search term</p>
      </div>
    );
  }

  if (!hasManifest) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
          <VscPackage className="text-2xl text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-400 font-medium mb-1">No Assets Yet</p>
        <p className="text-[10px] text-zinc-600 mb-4 max-w-45 leading-relaxed">
          Generate a script and run the pipeline to download visual assets.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
        <VscWarning className="text-xl text-zinc-600" />
      </div>
      <p className="text-xs text-zinc-500 font-medium">No downloadable assets found</p>
      <p className="text-[9px] text-zinc-600 mt-1">All sub-visuals may be programmatic (maps, documents, etc.)</p>
    </div>
  );
};

// Video posters are generated asynchronously by the file server (ffmpeg);
// retry the thumb URL with a cache-buster until the real thumbnail is
// served. Images are generated synchronously and never need this.
// Video posters are generated asynchronously by the file server (ffmpeg);
// retry the thumb URL with a cache-buster until the real thumbnail is served.
const THUMB_RETRY_DELAY_MS = 2500;
const THUMB_MAX_RETRIES = 6;

const AssetThumbnail: React.FC<{
  asset: AssetEntry;
  isFetching: boolean;
  size?: 'small' | 'large';
}> = ({ asset, isFetching, size = 'small' }) => {
  const [videoHovered, setVideoHovered] = useState(false);
  const ext = asset.extension || (asset.filePath ? '.' + asset.filePath.split('.').pop() : '');
  const isVideo = asset.category === 'video' || isVideoFile(ext);
  const isImage = asset.category === 'image' || isImageFile(ext);
  const isHtml = asset.category === 'html' || ext === '.html';
  const isMap = asset.category === 'map' || ext === '.geo';
  const isAudio = asset.category === 'audio' || ext === '.mp3' || ext === '.wav';

  const [thumbAttempt, setThumbAttempt] = useState(0);
  useEffect(() => {
    if (thumbAttempt >= THUMB_MAX_RETRIES) return;
    if (!isVideo) return;
    const t = setTimeout(() => setThumbAttempt((a) => a + 1), THUMB_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [thumbAttempt, isVideo]);

  // Show loading spinner when asset is actively being downloaded
  if (!asset.fileExists && isFetching && (isVideo || isImage)) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-blue-950/20 text-blue-400 p-1">
        <VscLoading className={size === 'small' ? 'text-xs animate-spin' : 'text-base animate-spin'} />
        {size === 'large' && <span className="text-[7px] mt-1 font-mono text-blue-300">Downloading...</span>}
      </div>
    );
  }

  // 1. Video Asset with file
  if (isVideo && (asset.filePath || asset.mediaUrl)) {
    const thumbSrc =
      (getMediaThumbUrl(asset.filePath) + (asset.lastModified ? `&v=${asset.lastModified}` : '')) +
      `&r=${thumbAttempt}`;
    const playCircleClass = size === 'small' ? 'w-4 h-4' : 'w-7 h-7';
    const playIconClass = size === 'small' ? 'text-[7px] ml-px' : 'text-xs ml-0.5';

    return (
      <div
        className="relative w-full h-full bg-zinc-900 overflow-hidden"
        onMouseEnter={() => setVideoHovered(true)}
        onMouseLeave={() => setVideoHovered(false)}
      >
        <img
          src={thumbSrc}
          alt={asset.title || 'Video'}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
          onError={(e) => {
            // If thumb fails, show video element poster or fallback
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        {videoHovered && asset.mediaUrl && (
          <video
            src={asset.mediaUrl}
            className="absolute inset-0 w-full h-full object-cover"
            preload="metadata"
            muted
            playsInline
            autoPlay
            loop
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 group-hover:bg-black/10 transition-colors">
          <div className={`${playCircleClass} rounded-full bg-black/60 border border-white/20 flex items-center justify-center shadow-md`}>
            <VscPlay className={`text-blue-300 ${playIconClass}`} />
          </div>
        </div>
      </div>
    );
  }

  // 2. Image Asset with file
  if (isImage && (asset.filePath || asset.mediaUrl)) {
    const thumbSrc =
      getMediaThumbUrl(asset.filePath) || asset.mediaUrl;

    return (
      <div className="relative w-full h-full bg-zinc-900 overflow-hidden">
        <img
          src={thumbSrc}
          alt={asset.title || 'Image'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          draggable={false}
        />
      </div>
    );
  }

  // 3. HTML / Custom Canvas Animation
  if (isHtml) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-linear-to-br from-purple-950/60 to-indigo-950/40 border border-purple-800/30 text-purple-300 p-1">
        <VscCode className={size === 'small' ? 'text-sm' : 'text-xl'} />
        <span className={`font-bold tracking-wider uppercase font-mono ${size === 'small' ? 'text-[6px] mt-0.5 text-purple-400/80' : 'text-[8px] mt-1 text-purple-300'}`}>
          {size === 'small' ? 'Code' : 'Canvas Code'}
        </span>
      </div>
    );
  }

  // 4. 3D Map Route Animation
  if (isMap) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-linear-to-br from-cyan-950/60 to-teal-950/40 border border-cyan-800/30 text-cyan-300 p-1">
        <VscGlobe className={size === 'small' ? 'text-sm' : 'text-xl'} />
        <span className={`font-bold tracking-wider uppercase font-mono ${size === 'small' ? 'text-[6px] mt-0.5 text-cyan-400/80' : 'text-[8px] mt-1 text-cyan-300'}`}>
          {size === 'small' ? 'Map' : '3D Route'}
        </span>
      </div>
    );
  }

  // 5. Audio File
  if (isAudio) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-linear-to-br from-emerald-950/60 to-teal-950/40 border border-emerald-800/30 text-emerald-300 p-1">
        <VscMusic className={size === 'small' ? 'text-sm' : 'text-xl'} />
        <span className={`font-bold tracking-wider uppercase font-mono ${size === 'small' ? 'text-[6px] mt-0.5 text-emerald-400/80' : 'text-[8px] mt-1 text-emerald-300'}`}>
          Audio
        </span>
      </div>
    );
  }

  // Fallback icon
  const badge = fileTypeBadge(ext, asset.category);
  const iconClass = size === 'small' ? 'text-[10px]' : 'text-lg';
  const labelClass = size === 'small' ? 'text-[6px] mt-0.5' : 'text-[9px] mt-1';

  return (
    <div className={`w-full h-full flex flex-col items-center justify-center ${badge.color}`}>
      <span className={iconClass}>{badge.icon}</span>
      <span className={`font-bold leading-none uppercase ${labelClass}`}>{badge.label}</span>
    </div>
  );
};

const getAssetContainerClasses = (hasFile: boolean, isProgrammatic: boolean, isGrid: boolean) => {
  const baseClasses = isGrid
    ? 'relative rounded-lg overflow-hidden border transition-all cursor-pointer group hover:shadow-md'
    : 'flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer group hover:shadow-xs';

  const stateClasses = hasFile || isProgrammatic
    ? (isGrid
      ? 'bg-zinc-900/40 border-zinc-800/50 hover:border-blue-500/50 hover:bg-zinc-800/50'
      : 'bg-zinc-900/40 border-zinc-800/50 hover:bg-zinc-800/60 hover:border-zinc-700/60')
    : 'bg-zinc-900/20 border-zinc-800/30 opacity-70';

  return `${baseClasses} ${stateClasses}`;
};

/** Browser-level virtualization */
const assetContainerStyle = (isGrid: boolean) => ({
  contentVisibility: 'auto' as const,
  containIntrinsicSize: isGrid ? 'auto 150px' : 'auto 68px',
});

/** Single asset item in list view */
const AssetListItem: React.FC<{
  asset: AssetEntry;
  isFetching: boolean;
  onSelect: (asset: AssetEntry) => void;
}> = React.memo(({ asset, isFetching, onSelect }) => {
  const badge = fileTypeBadge(asset.extension || '', asset.category);
  const isInteractive = asset.category === 'html' || asset.category === 'map';

  return (
    <div
      onClick={() => onSelect(asset)}
      className={getAssetContainerClasses(asset.fileExists, asset.isProgrammatic, false)}
      style={assetContainerStyle(false)}
      title="Click to seek in video player"
    >
      {/* Thumbnail */}
      <div className="w-11 h-11 shrink-0 rounded-md overflow-hidden bg-zinc-900 border border-zinc-700/50 flex items-center justify-center">
        <AssetThumbnail asset={asset} isFetching={isFetching} size="small" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 self-center">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] font-medium text-zinc-100 truncate group-hover:text-blue-300 transition-colors">
            {asset.title || 'Untitled Asset'}
          </span>
          <span className="text-[8px] text-zinc-500 font-mono shrink-0 bg-zinc-800/60 px-1 py-0.5 rounded">
            #{asset.sceneIndex + 1}{asset.subIndex !== undefined ? `.${asset.subIndex + 1}` : ''}{asset.layerIndex !== undefined ? `-${asset.layerIndex}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Format / Type badge */}
          <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded border leading-none ${badge.color}`}>
            {badge.label}
          </span>

          {/* Source badge */}
          {asset.source && (
            <span className="text-[8px] text-zinc-400 bg-zinc-800/70 px-1.5 py-0.5 rounded border border-zinc-700/40">
              {asset.source}
            </span>
          )}

          {/* Scene Title */}
          <span className="text-[8px] text-zinc-400 truncate max-w-28">
            {asset.sceneTitle}
          </span>

          {/* File size if available */}
          {asset.fileSize ? (
            <>
              <span className="text-zinc-700 text-[8px]">&middot;</span>
              <span className="text-[8px] text-zinc-400 font-mono">{formatFileSize(asset.fileSize)}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Status Pill */}
      <div className="shrink-0 self-center">
        {asset.fileExists && !asset.isProgrammatic ? (
          <span className="flex items-center gap-0.5 text-[8px] font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-full">
            <VscCheck className="text-[7px]" /> Ready
          </span>
        ) : isInteractive ? (
          <span className="text-[8px] font-medium text-purple-300 bg-purple-500/15 border border-purple-500/25 px-1.5 py-0.5 rounded-full">
            AST Code
          </span>
        ) : isFetching ? (
          <span className="text-[8px] font-medium text-blue-400 bg-blue-500/15 border border-blue-500/25 px-1.5 py-0.5 rounded-full animate-pulse">
            DL
          </span>
        ) : (
          <span className="text-[8px] text-zinc-500 bg-zinc-800/60 border border-zinc-700/40 px-1.5 py-0.5 rounded-full">
            Pending
          </span>
        )}
      </div>
    </div>
  );
});

/** Single asset item in grid view */
const AssetGridItem: React.FC<{
  asset: AssetEntry;
  isFetching: boolean;
  onSelect: (asset: AssetEntry) => void;
}> = React.memo(({ asset, isFetching, onSelect }) => {
  const badge = fileTypeBadge(asset.extension || '', asset.category);

  return (
    <div
      onClick={() => onSelect(asset)}
      className={getAssetContainerClasses(asset.fileExists, asset.isProgrammatic, true)}
      style={assetContainerStyle(true)}
      title="Click to seek in video player"
    >
      {/* Thumbnail area */}
      <div className="aspect-video bg-zinc-900 flex items-center justify-center overflow-hidden relative">
        <AssetThumbnail asset={asset} isFetching={isFetching} size="large" />

        {/* Top-left format tag */}
        <div className="absolute top-[1px] left-1 z-10">
          <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded backdrop-blur-md shadow-xs leading-none ${badge.color}`}>
            {badge.label}
          </span>
        </div>

        {/* Top-right source tag */}
        {asset.source && (
          <div className="absolute top-[1px] right-1 z-10">
            <span className="text-[7px] font-medium text-zinc-300 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded border border-white/10 shadow-xs">
              {asset.source}
            </span>
          </div>
        )}
      </div>

      {/* Caption info */}
      <div className="px-2 py-1.5 space-y-1 bg-zinc-950/40">
        <p className="text-[9px] font-medium text-zinc-100 truncate group-hover:text-blue-300 transition-colors">
          {asset.title || 'Untitled Asset'}
        </p>
        <div className="flex items-center justify-between text-[8px] text-zinc-500">
          <span className="truncate">
            Scene {asset.sceneIndex + 1}{asset.subIndex !== undefined ? ` • Sub ${asset.subIndex + 1}` : ''}
          </span>
          {asset.fileSize ? (
            <span className="font-mono text-zinc-400 shrink-0">{formatFileSize(asset.fileSize)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/* ============================================================
   Scene List Item (unchanged from original)
   ============================================================ */

interface SceneListItemProps {
  index: number;
  number: string;
  title: string;
  subtitle: string;
  timing?: { start: number; end: number };
  onSelect: (sceneIndex: number) => void;
}

const SceneListItem: React.FC<SceneListItemProps> = React.memo(({ index, number, title, subtitle, timing, onSelect }) => (
  <div
    onClick={() => onSelect(index)}
    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800/30 border border-transparent hover:border-zinc-700/50 cursor-pointer transition-all group"
  >
    <div className="w-6 h-6 rounded-md bg-blue-600/20 border border-blue-600/25 flex items-center justify-center shrink-0">
      <span className="text-[9px] font-bold text-blue-400">{number}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-200 truncate">{title}</span>
        {timing && (
          <span className="text-[8px] font-mono text-zinc-600 shrink-0">{formatTime(timing.start)}</span>
        )}
      </div>
      <p className="text-[9px] text-zinc-500 truncate leading-snug">{subtitle}</p>
    </div>
  </div>
));

