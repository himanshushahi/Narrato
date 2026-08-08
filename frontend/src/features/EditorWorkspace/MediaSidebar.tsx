import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscLayers, VscPackage, VscMusic,
  VscSearch, VscAdd, VscWarning,
  VscCheck, VscLoading, VscListFlat, VscSymbolField,
  VscRefresh, VscPlay, VscTrash
} from 'react-icons/vsc';
import { ScrollableTabBar } from '../../components/ui/ScrollableTabBar';
import { CustomAudioPlayer } from '../../components/ui/CustomAudioPlayer';
import { useEditorStore, LeftPanelTab } from '../../store/useEditorStore';
import { useProjectStore } from '../../store/useProjectStore';
import { callApi } from '../../utils/call-api';
import { getMediaUrlSync } from '../../utils/mediaUrl';
import { formatTime } from '../../features/ProjectEditor/constants';
import { useProjectAssets, AssetEntry } from './hooks/useProjectAssets';

interface MediaSidebarProps {
  scriptData: any;
  manifestData: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  onSeek?: (frame: number) => void;
  projectId?: string;
  isPipelineRunning?: boolean;
  activeTaskStep?: any;
  reloadTrigger?: number;
}

/** Format bytes to a human-readable string */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/** Visual type to display label mapping */
const VISUAL_TYPE_LABELS: Record<string, string> = {
  youtube: 'YouTube Clip',
  scene: 'Stock Video',
  image: 'Stock Photo',
  portrait: 'Stock Photo',
  parallax: 'Parallax Image',
  map: 'Map Data',
  document: 'Document',
  network: 'Network Diagram',
  thread: 'Social Chat',
  device_mockup: 'Device Mockup',
};

/** Guess if a file is a video by its extension */
const isVideoFile = (ext?: string): boolean => ext === '.mp4' || ext === '.webm';

/** Guess if a file is an image by its extension */
const isImageFile = (ext?: string): boolean =>
  ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp';

/** Returns a display icon and label for a given file extension */
const fileTypeBadge = (ext: string): { icon: React.ReactNode; label: string; color: string } => {
  if (isVideoFile(ext)) return { icon: <VscPlay />, label: 'MP4', color: 'text-blue-400 bg-blue-500/10' };
  if (isImageFile(ext)) return { icon: <VscPackage />, label: ext.replace('.', '').toUpperCase(), color: 'text-amber-400 bg-amber-500/10' };
  return { icon: <VscPackage />, label: (ext || 'FILE').replace('.', '').toUpperCase(), color: 'text-zinc-400 bg-zinc-500/10' };
};

export const MediaSidebar: React.FC<MediaSidebarProps> = React.memo(({
  scriptData, manifestData, sceneTimings, onSeek,
  projectId, activeTaskStep, reloadTrigger = 0,
}) => {
  const leftPanelWidth = useEditorStore((s) => s.leftPanelWidth);
  const leftPanelTab = useEditorStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);

  const scenes = scriptData?.scenes || [];
  const hasIntro = !!scriptData?.introduction;
  const hasConclusion = !!scriptData?.conclusion;

  // ---- Assets tab state ----
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [assetSearch, setAssetSearch] = useState('');

  // ---- Scenes tab state ----
  const [sceneSearch, setSceneSearch] = useState('');

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
    totalDownloadable,
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

  // Track baseline (committed) bg_music values to detect reverts
  const baselinePathRef = useRef('');
  const baselineVolumeRef = useRef(0.15);
  const baselineInitRef = useRef(false);
  const audioChangedAlert = useEditorStore((s) => s.audioChangedAlert);
  const prevAudioAlertRef = useRef(audioChangedAlert);
  useEffect(() => {
    if (!baselineInitRef.current && selectedProject?.bg_music_path !== undefined) {
      baselinePathRef.current = bgMusicPath;
      baselineVolumeRef.current = localVolume;
      baselineInitRef.current = true;
    }
    if (prevAudioAlertRef.current === true && audioChangedAlert === false) {
      baselinePathRef.current = bgMusicPath;
      baselineVolumeRef.current = localVolume;
    }
    prevAudioAlertRef.current = audioChangedAlert;
  }, [audioChangedAlert, bgMusicPath, localVolume, selectedProject?.bg_music_path]);
  const bgMusicUrl = bgMusicPath 
    ? `${getMediaUrlSync(bgMusicPath)}&t=${reloadTrigger}` 
    : '';
  const bgMusicFilename = bgMusicPath ? bgMusicPath.split(/[/\\]/).pop() || 'Unknown' : '';
  const bgMusicExt = bgMusicPath ? (bgMusicPath.split('.').pop() || '').toLowerCase() : '';

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
        const project = useProjectStore.getState().selectedProject;
        const isReverted =
          (project?.bg_music_path || '') === baselinePathRef.current &&
          (project?.bg_music_volume ?? 0.15) === baselineVolumeRef.current;
        useEditorStore.getState().setAudioChangedAlert(!isReverted);
      }
    } catch (e) {
      console.error('Failed to upload bg music:', e);
    } finally {
      setUploading(false);
    }
  }, [projectId, fetchProjectDetail]);

  const handleRemoveMusic = useCallback(async () => {
    if (!projectId) return;
    await updateProject(projectId, { bg_music_path: '' });
    const isReverted = '' === baselinePathRef.current;
    useEditorStore.getState().setAudioChangedAlert(!isReverted);
  }, [projectId, updateProject]);

  const handleVolumeSave = useCallback(async () => {
    if (!projectId) return;
    await updateProject(projectId, { bg_music_volume: localVolume });
    const project = useProjectStore.getState().selectedProject;
    const currentPath = project?.bg_music_path || '';
    const isReverted = localVolume === baselineVolumeRef.current && currentPath === baselinePathRef.current;
    useEditorStore.getState().setAudioChangedAlert(!isReverted);
  }, [projectId, localVolume, updateProject]);

  // Filter & sort assets
  const filteredAssets = useMemo(() => {
    let list = assets;
    if (assetSearch.trim()) {
      const q = assetSearch.toLowerCase();
      list = list.filter(
        (a) =>
          a.sceneTitle.toLowerCase().includes(q) ||
          a.visualCue.toLowerCase().includes(q) ||
          a.visualType.toLowerCase().includes(q) ||
          a.visualPath?.toLowerCase().includes(q),
      );
    }
    // Sort by scene index, then sub index
    return [...list].sort((a, b) => a.sceneIndex - b.sceneIndex || a.subIndex - b.subIndex);
  }, [assets, assetSearch]);

  // ---- Tab config with dynamic labels ----
  const tabConfig = useMemo(() => {
    const assetsLabel = 'Assets';
    return [
      { id: 'scenes' as LeftPanelTab, label: 'Scenes', icon: <VscLayers /> },
      { id: 'assets' as LeftPanelTab, label: assetsLabel, icon: <VscPackage /> },
      { id: 'music' as LeftPanelTab, label: 'Music', icon: <VscMusic /> },
    ];
  }, [totalDownloadable, downloadedCount]);

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
                number={item.number}
                title={item.title}
                subtitle={item.subtitle}
                timing={sceneTimings[item.sceneIndex]}
                onClick={() => onSeek?.(sceneTimings[item.sceneIndex]?.start || 0)}
              />
            ))
          )
        ) : (
          <>
            {/* Introduction */}
            {hasIntro && (
              <SceneListItem
                number="0"
                title="Introduction"
                subtitle="Hook"
                timing={sceneTimings[0]}
                onClick={() => onSeek?.(sceneTimings[0]?.start || 0)}
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
                    number={String(idx + 1)}
                    title={scene.title || `Scene ${idx + 1}`}
                    subtitle={scene.narration ? scene.narration.slice(0, 60) + (scene.narration.length > 60 ? '...' : '') : 'No narration'}
                    timing={timing}
                    onClick={() => onSeek?.(timing?.start || 0)}
                  />
                );
              })
            )}

            {/* Conclusion */}
            {hasConclusion && (
              <SceneListItem
                number={String(scenes.length + 1)}
                title="Conclusion"
                subtitle="Summary & CTA"
                timing={sceneTimings[sceneTimings.length - 1]}
                onClick={() => onSeek?.(sceneTimings[sceneTimings.length - 1]?.start || 0)}
              />
            )}

          </>
        )}
      </div>
    </div>
  );

  // ---- Assets Tab ----

  const handleAssetClick = (asset: any) => {
    if (asset.timing && onSeek && !asset.isProgrammatic) {
      onSeek(asset.timing.start);
    }
  };

  const renderAssetsTab = () => (
    <div className="flex flex-col h-full">
      {/* Search + toolbar */}
      <div className="px-3 py-2.5 border-b border-zinc-800/40 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Assets</h3>
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
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/40">
          <VscSearch className="text-zinc-500 text-xs shrink-0" />
          <input
            type="text"
            placeholder="Search assets..."
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
        <div className="flex items-center justify-between">
          <div className="text-[9px] text-zinc-500">
            {totalDownloadable > 0 ? (
              <span>
                <span className="text-zinc-300">{totalDownloadable} Items</span>
                <span className="text-zinc-600"> &middot; </span>
                <span className="text-zinc-400">{formatFileSize(totalSize)}</span>
              </span>
            ) : (
              <span className="text-zinc-600">No assets</span>
            )}
          </div>
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
            searchActive={assetSearch.trim().length > 0}
            hasManifest={manifestData.length > 0}
            isFetching={isFetchingAssets}
          />
        ) : viewMode === 'list' ? (
          <div className="p-2 space-y-1">
            {filteredAssets.map((asset) => (
              <AssetListItem
                key={asset.key}
                asset={asset}
                isFetching={isFetchingAssets}
                onClick={() => handleAssetClick(asset)}
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
                onClick={() => handleAssetClick(asset)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderMusicTab = () => {
    if (!bgMusicPath) {
      return (
        <div className="flex flex-col h-full p-4 text-center">
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
              <VscMusic className="text-xl text-zinc-500" />
            </div>
            <p className="text-xs text-zinc-300 font-medium mb-1">No Background Music</p>
            <p className="text-[9px] text-zinc-600 mb-4 max-w-40 leading-relaxed">
              Upload a soundtrack to enhance your video
            </p>
            <button
              onClick={handleUploadMusic}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-600/25 rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

    const fileBadge = bgMusicExt ? fileTypeBadge('.' + bgMusicExt) : null;

    return (
      <div className="flex flex-col h-full p-3 space-y-2.5">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 shrink-0 rounded-md flex items-center justify-center ${fileBadge?.color || 'bg-zinc-800/50'}`}>
              {fileBadge?.icon || <VscMusic className="text-sm text-zinc-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-zinc-200 truncate">{bgMusicFilename}</p>
              <p className="text-[9px] text-zinc-500 font-mono mt-0.5">
                {fileBadge?.label || bgMusicExt.toUpperCase() || 'AUDIO'}
              </p>
            </div>
          </div>

          <div className="border-t border-zinc-800/40 pt-2.5">
            <CustomAudioPlayer src={bgMusicUrl} volume={localVolume} />
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-zinc-400">Volume</span>
            <span className="text-[9px] font-mono text-zinc-500">{Math.round(localVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={localVolume}
            onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
            onMouseUp={handleVolumeSave}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') handleVolumeSave();
            }}
            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
              [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-900
              [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleUploadMusic}
            disabled={uploading}
            className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <VscLoading className="text-xs animate-spin" />
            ) : (
              <VscRefresh />
            )}
            Replace
          </button>
          <button
            onClick={handleRemoveMusic}
            className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
          >
            <VscTrash /> Remove
          </button>
        </div>
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
        tabs={tabConfig.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={leftPanelTab}
        onChange={(id) => setLeftPanelTab(id as LeftPanelTab)}
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

const AssetThumbnail: React.FC<{
  asset: AssetEntry;
  isFetching: boolean;
  size?: 'small' | 'large';
}> = ({ asset, isFetching, size = 'small' }) => {
  const hasFile = asset.fileExists && !asset.isProgrammatic;
  const ext = asset.extension || (asset.visualPath ? '.' + asset.visualPath.split('.').pop() : '');

  if (hasFile && isImageFile(ext) && asset.visualUrl) {
    return (
      <img
        src={asset.visualUrl}
        alt={asset.visualCue || ''}
        className="w-full h-full object-cover"
        loading="lazy"
        draggable={false}
      />
    );
  }

  if (hasFile && isVideoFile(ext) && asset.visualUrl) {
    const playCircleClass = size === 'small' ? 'w-4 h-4' : 'w-8 h-8';
    const playIconClass = size === 'small' ? 'text-[7px] ml-px' : 'text-sm ml-0.5';

    return (
      <div className="relative w-full h-full">
        <video
          src={asset.visualUrl}
          className="w-full h-full object-cover"
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.currentTime = Math.min(0.5, v.duration / 2);
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={`${playCircleClass} rounded-full bg-black/50 flex items-center justify-center`}>
            <VscPlay className={`text-blue-300 ${playIconClass}`} />
          </div>
        </div>
      </div>
    );
  }

  if (hasFile) {
    const badge = fileTypeBadge(ext as string);
    const iconClass = size === 'small' ? 'text-[10px]' : 'text-lg';
    const labelClass = size === 'small' ? 'text-[6px] mt-0.5' : 'text-[9px] mt-1';

    return (
      <div className={`w-full h-full flex flex-col items-center justify-center ${badge.color}`}>
        <span className={iconClass}>{badge.icon}</span>
        <span className={`font-bold leading-none uppercase ${labelClass}`}>{badge.label}</span>
      </div>
    );
  }

  const defaultIconClass = size === 'small' ? 'text-zinc-600 text-sm' : 'text-zinc-600 text-lg';
  const loadingClass = size === 'small' ? 'text-zinc-600 text-xs animate-spin' : 'text-blue-500 text-lg animate-spin';

  return (
    <div className="flex flex-col items-center justify-center w-full h-full text-zinc-600">
      {asset.isProgrammatic ? (
        <>
          {size === 'large' && <VscSymbolField className="text-lg" />}
          <span className={`font-bold uppercase ${size === 'small' ? 'text-[9px] text-purple-500/60' : 'text-[7px] mt-1 font-normal'}`}>
            {size === 'small' ? 'Gen' : 'Generated'}
          </span>
        </>
      ) : isFetching ? (
        <VscLoading className={loadingClass} />
      ) : (
        <VscPackage className={defaultIconClass} />
      )}
    </div>
  );
};

const getAssetContainerClasses = (hasFile: boolean, isProgrammatic: boolean, isGrid: boolean) => {
  const baseClasses = isGrid
    ? 'relative rounded-lg overflow-hidden border transition-all cursor-pointer group'
    : 'flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer group';
  
  const stateClasses = hasFile
    ? (isGrid ? 'bg-zinc-900/30 border-zinc-800/40 hover:border-blue-600/40' : 'bg-zinc-900/30 border-zinc-800/40 hover:bg-zinc-800/40 hover:border-zinc-700/50')
    : isProgrammatic
      ? 'bg-zinc-900/10 border-zinc-800/20 opacity-50 cursor-default'
      : 'bg-zinc-900/10 border-zinc-800/20';

  return `${baseClasses} ${stateClasses}`;
};

/** Single asset item in list view */
const AssetListItem: React.FC<{
  asset: AssetEntry;
  isFetching: boolean;
  onClick: () => void;
}> = React.memo(({ asset, isFetching, onClick }) => {
  const hasFile = asset.fileExists && !asset.isProgrammatic;

  return (
    <div
      onClick={onClick}
      className={getAssetContainerClasses(hasFile, !!asset.isProgrammatic, false)}
    >
      <div className="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-zinc-800/80 border border-zinc-700/40 flex items-center justify-center">
        <AssetThumbnail asset={asset} isFetching={isFetching} size="small" />
      </div>

      <div className="flex-1 min-w-0 self-center">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-200 truncate">
            {asset.sceneTitle}
          </span>
          <span className="text-[8px] text-zinc-600 font-mono shrink-0">
            #{asset.sceneIndex}-{asset.subIndex}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[8px] text-zinc-500 capitalize truncate">
            {VISUAL_TYPE_LABELS[asset.visualType] || asset.visualType}
          </span>
          {hasFile && (
            <>
              <span className="text-zinc-700 text-[8px]">&middot;</span>
              <span className="text-[8px] text-zinc-500 font-mono">{formatFileSize(asset.fileSize || 0)}</span>
            </>
          )}
        </div>
        {asset.visualCue && (
          <p className="text-[8px] text-zinc-600 truncate mt-0.5">
            Cue: {asset.visualCue}
          </p>
        )}
      </div>

      <div className="shrink-0 self-center">
        {hasFile ? (
          <span className="flex items-center gap-0.5 text-[8px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full">
            <VscCheck className="text-[7px]" /> OK
          </span>
        ) : asset.isProgrammatic ? (
          <span className="text-[8px] text-purple-500/50 bg-purple-500/10 px-1.5 py-0.5 rounded-full">
            Gen.
          </span>
        ) : isFetching ? (
          <span className="text-[8px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full animate-pulse">
            DL
          </span>
        ) : (
          <span className="text-[8px] text-zinc-600 bg-zinc-800/50 px-1.5 py-0.5 rounded-full">
            Pend.
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
  onClick: () => void;
}> = React.memo(({ asset, isFetching, onClick }) => {
  const hasFile = asset.fileExists && !asset.isProgrammatic;

  return (
    <div
      onClick={onClick}
      className={getAssetContainerClasses(hasFile, !!asset.isProgrammatic, true)}
    >
      {/* Thumbnail area — image preview for photos, video poster for videos */}
      <div className="aspect-video bg-zinc-800/60 flex items-center justify-center overflow-hidden relative">
        <AssetThumbnail asset={asset} isFetching={isFetching} size="large" />
      </div>

      <div className="px-2 py-1.5 space-y-0.5">
        <p className="text-[9px] font-medium text-zinc-200 truncate leading-snug">
          {asset.sceneTitle}
        </p>
        <p className="text-[7px] text-zinc-500 truncate">
          #{asset.sceneIndex}-{asset.subIndex}
          {hasFile && <> &middot; {formatFileSize(asset.fileSize || 0)}</>}
        </p>
      </div>
    </div>
  );
});

/* ============================================================
   Scene List Item (unchanged from original)
   ============================================================ */

interface SceneListItemProps {
  number: string;
  title: string;
  subtitle: string;
  timing?: { start: number; end: number };
  onClick: () => void;
}

const SceneListItem: React.FC<SceneListItemProps> = React.memo(({ number, title, subtitle, timing, onClick }) => (
  <div
    onClick={onClick}
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
