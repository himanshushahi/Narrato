import React, { useRef, useState, useCallback, useEffect, useMemo, useDeferredValue } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { useProjectStore } from '../../store/useProjectStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { useUIStore } from '../../store/useUIStore';
import { useEditorData } from './hooks/useEditorData';
import { usePipeline } from './hooks/usePipeline';
import { useScriptEditing } from './hooks/useScriptEditing';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ResizeHandle } from './components/ResizeHandle';
import { callApi } from '../../utils/call-api';
import { getMediaUrlSync } from '../../utils/mediaUrl';

import { TopBar } from './TopBar';
import { MediaSidebar } from './MediaSidebar';
import { VideoPreview } from './VideoPreview';
import { Timeline } from './Timeline';
import { InspectorPanel } from './InspectorPanel';
import { GlobalOverlayItem } from '../../components/video/GlobalOverlaysRenderer';
import { FPS } from './timelineConstants';
import { manifestToScriptSceneIndex, resolveVisualSelection, shallowEqualStyles } from './visualSelection';
import { readSectionSubs, writeSectionSubs } from './InspectorTabs/VisualsTab';

const EMPTY_ARRAY: any[] = [];

const EditorWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const sfxMasterVolume = useSettingsStore((s) => parseFloat(s.settings.sfx_volume || '0.5') || 0.5);
  const [projectReady, setProjectReady] = useState(false);

  // Mark project as ready when selectedProject is set from the store
  useEffect(() => {
    if (selectedProject && selectedProject.id === id && selectedProject.id !== 'fallback') {
      setProjectReady(true);
    }
  }, [selectedProject, id]);

  // Timeout: if backend doesn't respond within 8s, set a fallback project so the layout keeps rendering
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const current = useProjectStore.getState().selectedProject;
      // Don't overwrite if a real project was already loaded
      if (current && current.id !== 'fallback') return;
      const fallback: import('../../store/useProjectStore').Project = {
        id: id || 'fallback',
        name: 'Untitled Project',
        prompt: '',
        status: 'idle',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        language: 'en',
        style: 'standard',
        duration_mode: 'auto',
        video_format: 'landscape',
        export_folder: '',
      };
      useProjectStore.getState().setSelectedProject(fallback);
    }, 8000);
    return () => clearTimeout(timer);
  }, [id]);

  // Editor store state
  const leftPanelWidth = useEditorStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);
  // Single shallow-compared subscription for the canvas lock inputs: two
  // separate selectors would re-render this entire workspace (preview,
  // timeline, inspector) on every cut navigation.
  const canvasSel = useStoreWithEqualityFn(
    useEditorStore,
    (s) => ({ scene: s.selectedSceneIndex, sub: s.selectedSubVisualIndex }),
    shallow,
  );
  const canvasSceneIdx = canvasSel.scene;
  const canvasSubIdx = canvasSel.sub;
  const updateProject = useProjectStore((s) => s.updateProject);

  // === Hooks ===
  const {
    scriptData, setScriptData,
    designData,
    manifestData, setManifestData,
    transcriptionData, setTranscriptionData,
    liveScenes, sceneTimings, reloadKey,
    musicClips, updateMusicClips,
    sfxClips, updateSfxClips,
    loadFiles
  } = useEditorData(id);

  const handleUploadMusicClip = useCallback(async (startFrame?: number) => {
    if (!id) return;
    try {
      const res = await callApi<{ success: boolean; clip?: any; clips?: any[]; error?: string }>('upload_music_clip', id, startFrame);
      if (res && res.success) {
        await loadFiles(id);
        if (res.clip?.id) {
          useEditorStore.getState().setSelectedMusicClipId(res.clip.id);
          useEditorStore.getState().setLeftPanelTab('music');
        }
      }
    } catch (e) {
      console.error('Failed to upload music clip:', e);
    }
  }, [id, loadFiles]);

  const handleBgMusicVolumeChange = useCallback(async (vol: number) => {
    if (!id) return;
    await updateProject(id, { bg_music_volume: vol });
  }, [id, updateProject]);

  const handleUploadSfxClip = useCallback(async (startFrame?: number) => {
    if (!id) return;
    try {
      const res = await callApi<{ success: boolean; clip?: any; clips?: any[]; error?: string }>('upload_sfx_clip', id, startFrame);
      if (res && res.success) {
        await loadFiles(id);
        if (res.clip?.id) {
          useEditorStore.getState().setSelectedSfxClipId(res.clip.id);
          useEditorStore.getState().setLeftPanelTab('sfx');
        }
      }
    } catch (e) {
      console.error('Failed to upload sfx clip:', e);
    }
  }, [id, loadFiles]);

  const [activeTimings, setActiveTimings] = useState(sceneTimings);
  useEffect(() => {
    setActiveTimings(sceneTimings);
  }, [sceneTimings]);

  const {
    tasks, queue, isRunning, targetStage, activeTaskStep,
    setTargetStage, triggerFullPipeline,
    handleResumePipeline, handleResumeFromStage, cancelPipeline
  } = usePipeline(id, loadFiles);

  const {
    editingCard, setEditingCard, rewritePrompt, setRewritePrompt,
    rewritingSection, isAnyRewriting, isSectionRewriting, isSubRewriting, isSectionLocked,
    invalidateRewrites, invalidateAllRewrites,
    savingCardKey, sceneToDelete, localProjectSettings, isSavingSubtitles,
    previewAssets, uploadingSubVisual, handleUploadSubVisual, handlePreviewSubVisual,
    handleDeleteLayerAsset, handleDuplicateLayerAsset, handleMoveLayerAsset, handleReorderLayerAsset, handleDeleteCutAsset,
    handleStartEdit, handleCancelEdit, handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene, setSceneToDelete,
    handleSettingsUpdate, handleSaveTranscription, handleResetTranscription
  } = useScriptEditing(
    id, scriptData, setScriptData, manifestData, setManifestData,
    transcriptionData, setTranscriptionData, loadFiles
  );

  // Poison any in-flight AI rewrites on project switch so late LLM results
  // can never land in the newly opened project.
  useEffect(() => {
    invalidateAllRewrites();
  }, [id, invalidateAllRewrites]);

  // Latest-state refs: handlers read these instead of render-time closures so
  // consecutive operations (toggle → resize in quick succession) always see the
  // most recent data, even before React re-renders.
  const scriptDataRef = useRef(scriptData);
  scriptDataRef.current = scriptData;
  const manifestDataRef = useRef(manifestData);
  manifestDataRef.current = manifestData;

  // Serialized save queue: whole-document saves run one after another so a
  // slower earlier save can't land after a newer one and overwrite it
  // (last-write-wins data loss).
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSave = useCallback((saveFn: () => Promise<unknown>) => {
    const next = saveQueueRef.current.then(saveFn, saveFn);
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  // ── Rewrite section locks (timeline guards) ───────────────────────────
  // Ref mirrors keep the timeline write-handlers referentially stable while
  // always reading the latest rewrite registry.
  const isSectionLockedRef = useRef(isSectionLocked);
  isSectionLockedRef.current = isSectionLocked;
  const isAnyRewritingRef = useRef(isAnyRewriting);
  isAnyRewritingRef.current = isAnyRewriting;

  /** Manifest scene index → Visuals-tab card key (intro / scene_N / conclusion). */
  const cardKeyForScene = useCallback((sceneIdx: number): string | null => {
    const m = manifestDataRef.current?.[sceneIdx];
    if (!m) return null;
    if (m.section_type === 'introduction') return 'intro';
    if (m.section_type === 'conclusion') return 'conclusion';
    return `scene_${manifestToScriptSceneIndex(manifestDataRef.current, sceneIdx)}`;
  }, []);

  /**
   * Block timeline writes that would shift or wipe a section with an AI
   * rewrite in flight (split/duplicate/delete/resize, plus index-positional
   * scalar toggles). Guards live at the handler level so ruler drags,
   * boundary handles, hotkeys, and context menus are all sealed in one stroke.
   * Navigation (selection, seeking) is never blocked.
   */
  const requireSectionUnlocked = useCallback((sceneIdx: number, action: string): boolean => {
    const key = cardKeyForScene(sceneIdx);
    if (key && isSectionLockedRef.current(key)) {
      useUIStore.getState().addToast(
        `${action} is paused while this section's AI rewrite is in progress.`,
        'warning',
      );
      return false;
    }
    return true;
  }, [cardKeyForScene]);

  // Toggle a per-sub-visual audio cut flag (mute_voiceover / mute_bg_music) from
  // the timeline. Updates script.json (source of truth) and the assets manifest
  // (export source) in place, preserving visual_path/visual_url on the manifest.
  // Ref tracks the latest flag value per sub-visual so rapid consecutive clicks
  // toggle correctly before React re-renders (double-click race).
  const subVisualFlagValuesRef = useRef(new Map<string, boolean>());
  useEffect(() => {
    subVisualFlagValuesRef.current.clear();
  }, [manifestData]);

  const handleToggleSubVisualAudioFlag = useCallback(async (sceneIdx: number, subIdx: number, flag: 'mute_voiceover' | 'mute_bg_music') => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current || !selectedProject?.script_path) return;
    if (!requireSectionUnlocked(sceneIdx, 'Audio toggle')) return;
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const flagKey = `${sceneIdx}:${subIdx}:${flag}`;
    const currentValue = subVisualFlagValuesRef.current.get(flagKey) ?? !!manifestScene.sub_visuals[subIdx][flag];
    const newValue = !currentValue;
    subVisualFlagValuesRef.current.set(flagKey, newValue);

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    // Map timeline index → script.json section (intro / scenes / conclusion).
    // Scene index counts 'scene' manifest entries (same convention as
    // resolveVisualSelection) so stale intro presence can't shift it.
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[manifestToScriptSceneIndex(manifestDataRef.current, sceneIdx)];
    if (Array.isArray(scriptScene?.sub_visuals) && scriptScene.sub_visuals.length > 0) {
      const scriptSubs = scriptScene.sub_visuals;
      // Removed unused updateSv
      let scriptIdx = subIdx;
      // Fall back to same index if content match fails (same fallback as liveScenes)
      if (scriptIdx === -1 && subIdx < scriptSubs.length) scriptIdx = subIdx;
      if (scriptIdx !== -1) {
        scriptSubs[scriptIdx] = { ...scriptSubs[scriptIdx], [flag]: newValue };
      }
    }
    manifestCopy[sceneIdx].sub_visuals[subIdx] = { ...manifestCopy[sceneIdx].sub_visuals[subIdx], [flag]: newValue };

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
      await enqueueSave(() => callApi('save_project_with_cleanup', id, scriptCopy, manifestCopy));
    } catch (e) {
      console.error('Failed to persist audio cut flag:', e);
    }
  }, [id, selectedProject, enqueueSave, setScriptData, setManifestData]);

  // ── Timeline: Update Sub-Visual Transition ─────────────────────────────────
  const handleUpdateSubVisualTransition = useCallback(async (sceneIdx: number, subIdx: number, transition: string) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current || !selectedProject?.script_path) return;
    if (!requireSectionUnlocked(sceneIdx, 'Transition change')) return;
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[manifestToScriptSceneIndex(manifestDataRef.current, sceneIdx)];

    if (Array.isArray(scriptScene?.sub_visuals) && scriptScene.sub_visuals[subIdx]) {
      scriptScene.sub_visuals[subIdx].transition = transition;
    }
    if (manifestCopy[sceneIdx]?.sub_visuals?.[subIdx]) {
      manifestCopy[sceneIdx].sub_visuals[subIdx].transition = transition;
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
      await enqueueSave(() => callApi('save_project_with_cleanup', id, scriptCopy, manifestCopy));
    } catch (e) {
      console.error('Failed to persist transition:', e);
    }
  }, [id, selectedProject, enqueueSave, setScriptData, setManifestData]);

  // ── Timeline: Split Sub-Visual at Playhead ─────────────────────────────────
  const handleSplitSubVisualAtFrame = useCallback(async (sceneIdx: number, subIdx: number, frame: number) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current || !selectedProject?.script_path) return;
    if (!requireSectionUnlocked(sceneIdx, 'Split cut')) return;
    const manifestScene = manifestDataRef.current[sceneIdx];
    const timing = sceneTimings[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx] || !timing?.subs?.[subIdx]) return;

    const subTiming = timing.subs[subIdx];
    const currentSubStart = subTiming.start;
    const currentSubEnd = subTiming.end;
    const totalSubFrames = currentSubEnd - currentSubStart;
    if (totalSubFrames <= FPS) return;

    const leftFrames = frame - currentSubStart;
    const rightFrames = currentSubEnd - frame;
    if (leftFrames < 0.5 * FPS || rightFrames < 0.5 * FPS) return;

    const origDuration = manifestScene.sub_visuals?.[subIdx]?.duration ?? Number(((currentSubEnd - currentSubStart) / FPS).toFixed(2));
    const leftDuration = Math.max(0.2, Math.min(Math.max(0.2, origDuration - 0.2), Number((leftFrames / FPS).toFixed(2))));
    const rightDuration = Math.max(0.2, Number((origDuration - leftDuration).toFixed(2)));

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') {
      scriptScene = scriptCopy.introduction;
    } else if (sectionType === 'conclusion') {
      scriptScene = scriptCopy.conclusion;
    } else {
      const sceneNumber = manifestDataRef.current.slice(0, sceneIdx).filter((m: any) => m.section_type === 'scene').length;
      scriptScene = scriptCopy.scenes?.[sceneNumber];
    }

    // Ensure scriptScene has sub_visuals matching manifestScene
    if (scriptScene && !Array.isArray(scriptScene.sub_visuals) && Array.isArray(manifestScene.sub_visuals)) {
      scriptScene.sub_visuals = JSON.parse(JSON.stringify(manifestScene.sub_visuals));
    }

    if (Array.isArray(scriptScene?.sub_visuals) && scriptScene.sub_visuals[subIdx]) {
      const origSub = scriptScene.sub_visuals[subIdx];
      const leftSub = { ...origSub, duration: leftDuration };
      const rightSub = JSON.parse(JSON.stringify({ ...origSub, duration: rightDuration }));
      scriptScene.sub_visuals.splice(subIdx, 1, leftSub, rightSub);
    }

    if (Array.isArray(manifestCopy[sceneIdx]?.sub_visuals) && manifestCopy[sceneIdx].sub_visuals[subIdx]) {
      const origManSub = manifestCopy[sceneIdx].sub_visuals[subIdx];
      const leftManSub = { ...origManSub, duration: leftDuration };
      const rightManSub = JSON.parse(JSON.stringify({ ...origManSub, duration: rightDuration }));
      manifestCopy[sceneIdx].sub_visuals.splice(subIdx, 1, leftManSub, rightManSub);
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
      await enqueueSave(() => callApi('save_project_with_cleanup', id, scriptCopy, manifestCopy));
    } catch (e) {
      console.error('Failed to persist split sub-visual:', e);
    }
  }, [id, selectedProject, sceneTimings, enqueueSave, setScriptData, setManifestData]);

  // ── Timeline: Duplicate Sub-Visual Cut ─────────────────────────────────────
  const handleDuplicateSubVisual = useCallback(async (sceneIdx: number, subIdx: number) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current || !selectedProject?.script_path) return;
    if (!requireSectionUnlocked(sceneIdx, 'Duplicate cut')) return;
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') {
      scriptScene = scriptCopy.introduction;
    } else if (sectionType === 'conclusion') {
      scriptScene = scriptCopy.conclusion;
    } else {
      const sceneNumber = manifestDataRef.current.slice(0, sceneIdx).filter((m: any) => m.section_type === 'scene').length;
      scriptScene = scriptCopy.scenes?.[sceneNumber];
    }

    // Ensure scriptScene has sub_visuals matching manifestScene
    if (scriptScene && !Array.isArray(scriptScene.sub_visuals) && Array.isArray(manifestScene.sub_visuals)) {
      scriptScene.sub_visuals = JSON.parse(JSON.stringify(manifestScene.sub_visuals));
    }

    const origManSub = manifestCopy[sceneIdx]?.sub_visuals?.[subIdx];
    const origDur = origManSub?.duration || 2;
    const leftDur = Math.max(0.2, Number((origDur / 2).toFixed(2)));
    const rightDur = Math.max(0.2, Number((origDur - leftDur).toFixed(2)));

    if (Array.isArray(scriptScene?.sub_visuals) && scriptScene.sub_visuals[subIdx]) {
      const origSub = scriptScene.sub_visuals[subIdx];
      origSub.duration = leftDur;
      const cloneSub = JSON.parse(JSON.stringify({ ...origSub, duration: rightDur }));
      scriptScene.sub_visuals.splice(subIdx + 1, 0, cloneSub);
    }

    if (Array.isArray(manifestCopy[sceneIdx]?.sub_visuals) && manifestCopy[sceneIdx].sub_visuals[subIdx]) {
      origManSub.duration = leftDur;
      const cloneManSub = JSON.parse(JSON.stringify({ ...origManSub, duration: rightDur }));
      manifestCopy[sceneIdx].sub_visuals.splice(subIdx + 1, 0, cloneManSub);
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
      await enqueueSave(() => callApi('save_project_with_cleanup', id, scriptCopy, manifestCopy));
    } catch (e) {
      console.error('Failed to persist duplicated sub-visual:', e);
    }
  }, [id, selectedProject, enqueueSave, setScriptData, setManifestData]);

  // ── Timeline: Delete Sub-Visual Cut ───────────────────────────────────────
  const handleDeleteSubVisual = useCallback(async (sceneIdx: number, subIdx: number) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current || !selectedProject?.script_path) return;
    if (!requireSectionUnlocked(sceneIdx, 'Delete cut')) return;
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals || manifestScene.sub_visuals.length <= 1) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[manifestToScriptSceneIndex(manifestDataRef.current, sceneIdx)];

    // Ensure scriptScene has sub_visuals matching manifestScene
    if (scriptScene && !Array.isArray(scriptScene.sub_visuals) && Array.isArray(manifestScene.sub_visuals)) {
      scriptScene.sub_visuals = JSON.parse(JSON.stringify(manifestScene.sub_visuals));
    }

    const origManSub = manifestCopy[sceneIdx]?.sub_visuals?.[subIdx];
    const origScriptSub = scriptScene?.sub_visuals?.[subIdx];
    const removedDur = Number((origManSub?.duration ?? origScriptSub?.duration ?? 2));

    if (Array.isArray(scriptScene?.sub_visuals) && scriptScene.sub_visuals.length > 1) {
      scriptScene.sub_visuals.splice(subIdx, 1);
      const remainingIdx = Math.min(subIdx, scriptScene.sub_visuals.length - 1);
      scriptScene.sub_visuals[remainingIdx].duration = Number(((scriptScene.sub_visuals[remainingIdx].duration || 2) + removedDur).toFixed(2));
    }

    if (Array.isArray(manifestCopy[sceneIdx]?.sub_visuals) && manifestCopy[sceneIdx].sub_visuals.length > 1) {
      manifestCopy[sceneIdx].sub_visuals.splice(subIdx, 1);
      const remainingIdx = Math.min(subIdx, manifestCopy[sceneIdx].sub_visuals.length - 1);
      manifestCopy[sceneIdx].sub_visuals[remainingIdx].duration = Number(((manifestCopy[sceneIdx].sub_visuals[remainingIdx].duration || 2) + removedDur).toFixed(2));
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
      await enqueueSave(() => callApi('save_project_with_cleanup', id, scriptCopy, manifestCopy));
    } catch (e) {
      console.error('Failed to persist deleted sub-visual:', e);
    }
  }, [id, selectedProject, enqueueSave, setScriptData, setManifestData]);

  // ── Timeline: Overlays Management ─────────────────────────────────────────
  // Flusher for debounced Overlays-tab edits (registered by OverlaysTab;
  // null when another tab is active). Lets Ctrl+S / TopBar saves and
  // Timeline interactions flush in-flight slider/keystroke ticks.
  const overlaysFlushRef = useRef<((persist?: boolean) => any) | null>(null);
  const handleRegisterOverlaysFlush = useCallback((flush: ((persist?: boolean) => any) | null) => {
    overlaysFlushRef.current = flush;
  }, []);

  const handleUpdateOverlay = useCallback(async (target: number | string, updates: Partial<GlobalOverlayItem>) => {
    // Merge (don't re-read): the flush pushes state without persisting, so
    // the ref below is still pre-flush — building on it would drop the
    // flushed keystrokes in the save that follows.
    const flushed = overlaysFlushRef.current?.(false) as GlobalOverlayItem[] | null | undefined;
    const base = scriptDataRef.current;
    if (!base || !selectedProject?.script_path) return;
    const scriptCopy = JSON.parse(JSON.stringify(flushed ? { ...base, overlays: flushed } : base));
    if (!Array.isArray(scriptCopy.overlays)) return;

    const idx = typeof target === 'string'
      ? scriptCopy.overlays.findIndex((o: any) => o.id === target)
      : target;

    if (idx === -1 || !scriptCopy.overlays[idx]) return;

    scriptCopy.overlays[idx] = { ...scriptCopy.overlays[idx], ...updates };
    setScriptData(scriptCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
    } catch (e) {
      console.error('Failed to persist overlay updates:', e);
    }
  }, [selectedProject, enqueueSave, setScriptData]);

  const handleToggleOverlayEnabled = useCallback(async (target: number | string) => {
    const flushed = overlaysFlushRef.current?.(false) as GlobalOverlayItem[] | null | undefined;
    const base = scriptDataRef.current;
    if (!base || !selectedProject?.script_path) return;
    const scriptCopy = JSON.parse(JSON.stringify(flushed ? { ...base, overlays: flushed } : base));
    if (!Array.isArray(scriptCopy.overlays)) return;

    const idx = typeof target === 'string'
      ? scriptCopy.overlays.findIndex((o: any) => o.id === target)
      : target;

    if (idx === -1 || !scriptCopy.overlays[idx]) return;

    scriptCopy.overlays[idx].enabled = scriptCopy.overlays[idx].enabled === false;
    setScriptData(scriptCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
    } catch (e) {
      console.error('Failed to persist overlay toggle:', e);
    }
  }, [selectedProject, enqueueSave, setScriptData]);

  const handleSaveOverlays = useCallback(async (newOverlays: GlobalOverlayItem[]) => {
    if (!scriptDataRef.current || !selectedProject?.script_path) return;
    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    scriptCopy.overlays = newOverlays;
    setScriptData(scriptCopy);

    try {
      await enqueueSave(() => callApi('save_json_file', selectedProject.script_path, scriptCopy));
    } catch (e) {
      console.error('Failed to auto-save overlays:', e);
    }
  }, [selectedProject, enqueueSave, setScriptData]);

  const handleSelectOverlay = useCallback((_overlayId: string) => {
    setInspectorTab('overlays');
  }, [setInspectorTab]);

  // Auto-switch to Script tab when script generation finishes
  const prevScriptGenStatusRef = useRef(tasks['generate_script']?.status);
  
  useEffect(() => {
    const currentStatus = tasks['generate_script']?.status;
    if (prevScriptGenStatusRef.current === 'running' && currentStatus === 'completed') {
      setInspectorTab('script');
    }
    prevScriptGenStatusRef.current = currentStatus;
  }, [tasks, setInspectorTab]);

  // === Playback (playhead lives in a store so per-frame updates don't
  // re-render the whole workspace) ===
  const playerRef = useRef<any>(null);
  const fullscreenToggleRef = useRef<(() => void) | null>(null);
  const currentFrameRef = useRef(0);
  useEffect(() => {
    const unsub = usePlaybackStore.subscribe((s) => { currentFrameRef.current = s.currentFrame; });
    return unsub;
  }, []);

  const handleFrameUpdate = useCallback((frame: number) => {
    usePlaybackStore.getState().setCurrentFrame(frame);
  }, []);

  // === Computed values ===
  const hasScriptData = !!scriptData;
  const isLoading = !selectedProject || !projectReady;

  // Merge preview asset overrides into liveScenes so the player shows
  // in-progress visuals before they are saved.
  const effectiveLiveScenes = useMemo(() => {
    if (!liveScenes || Object.keys(previewAssets).length === 0) return liveScenes;
    let sceneCounter = 0;
    return liveScenes.map((scene: any) => {
      const type = scene.section_type;
      const sub_visuals = (scene.sub_visuals || []).map((sv: any, sIdx: number) => {
        let key: string;
        if (type === 'introduction') {
          key = `intro_${sIdx}`;
        } else if (type === 'conclusion') {
          key = `conclusion_${sIdx}`;
        } else {
          key = `scene_${sceneCounter}_${sIdx}`;
        }
        const cutPreview = previewAssets[key];

        let updatedComposition = sv.composition;
        if (sv.composition && Array.isArray(sv.composition.children)) {
          let layerChanged = false;
          const mediaLayers = sv.composition.children.filter((l: any) => l?.content?.type === 'Image' || l?.content?.type === 'Video');
          const updatedChildren = sv.composition.children.map((layer: any, lIdx: number) => {
            if (!layer?.content) return layer;
            const isMedia = layer.content.type === 'Image' || layer.content.type === 'Video';
            const layerKey = `${key}_${lIdx}`;
            const layerPreview = previewAssets[layerKey];
            const isBlankNewLayer = !layer.content.local_path && (!layer.content.query || !layer.content.query.trim());

            // 1. Explicit layer-specific preview (guard: never apply to blank newly-added layers)
            if (layerPreview?.visual_path && !isBlankNewLayer) {
              layerChanged = true;
              return {
                ...layer,
                content: {
                  ...layer.content,
                  local_path: layerPreview.visual_path
                }
              };
            }

            // 2. Cut-level preview fallback: only applies if this layer explicitly matches,
            // or if it already had this preview path, or if this is the only media layer in the cut (and not a blank newly added layer)
            const isSingleMediaLayer = mediaLayers.length === 1 && isMedia;
            const isTargetLayer = isMedia && !isBlankNewLayer && (
              cutPreview?.layerIdx !== undefined
                ? cutPreview.layerIdx === lIdx
                : (layer.content.local_path === cutPreview?.visual_path || isSingleMediaLayer)
            );

            if (cutPreview?.visual_path && isTargetLayer) {
              layerChanged = true;
              return {
                ...layer,
                content: {
                  ...layer.content,
                  local_path: cutPreview.visual_path
                }
              };
            }

            return layer;
          });

          if (layerChanged) {
            updatedComposition = { ...sv.composition, children: updatedChildren };
          }
        }

        if (cutPreview) {
          return {
            ...sv,
            visual_url: cutPreview.visual_url,
            composition: updatedComposition
          };
        }

        return updatedComposition !== sv.composition
          ? { ...sv, composition: updatedComposition }
          : sv;
      });
      if (type === 'scene') sceneCounter++;
      return { ...scene, sub_visuals };
    });
  }, [liveScenes, previewAssets]);

  // Deferred scenes for the heavy consumers (video player, timeline).
  // Every keystroke/slider tick in the inspector creates a new scenes array;
  // without this, the Remotion <Player> re-renders synchronously inside the
  // same task as the keystroke and typing feels laggy. The deferred value
  // keeps its previous reference while the user is typing so the memoized
  // player/timeline skip, then catches up once input pauses. The inspector
  // itself keeps the urgent (synchronous) value so editors never show stale
  // text. Selection/playhead stay responsive — they live in zustand stores.
  const deferredLiveScenes = useDeferredValue(effectiveLiveScenes);
  // Fix 13: stabilize overlays by content — previously every JSON.clone save
  // gave overlays a new ref (even when unchanged), invalidating Player
  // inputProps useMemo and re-rendering the composition on unrelated edits.
  // liveScenes already has sameTimings stabilization + deferred value;
  // overlays gets the same treatment here (overlays are small, stringify ok).
  const rawOverlays = (scriptData as any)?.overlays || EMPTY_ARRAY;
  const overlaysRef = useRef<any[]>(rawOverlays);
  const overlaysKey = (() => {
    try {
      return JSON.stringify(rawOverlays);
    } catch {
      return null;
    }
  })();
  const prevOverlaysKeyRef = useRef<string | null>(null);
  if (overlaysKey !== prevOverlaysKeyRef.current) {
    prevOverlaysKeyRef.current = overlaysKey;
    overlaysRef.current = rawOverlays;
  }
  const stableOverlays = overlaysRef.current;
  const deferredOverlays = useDeferredValue(stableOverlays);

  // === Handlers ===
  const handleSeek = useCallback((frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  }, []);
  // Live frame reader for the rAF playhead: reads the player directly at
  // display rate without touching React state. Stable ref so the memoized
  // Timeline/Playhead never re-render because of it.
  const getLiveFrame = useCallback((): number | undefined => {
    const f = playerRef.current?.getCurrentFrame?.();
    return typeof f === 'number' ? f : undefined;
  }, []);
  // Fix 5: stable callback — inline async arrow broke MediaSidebar memo on
  // every workspace render (including urgent keystrokes).
  const handleRefreshSfx = useCallback(async () => {
    if (id) await loadFiles(id);
  }, [id, loadFiles]);
  // Flusher for debounced Visuals-tab edits (registered by VisualsTab itself;
  // null when another tab is active). Lets Ctrl+S / TopBar saves include
  // in-flight color-drag / slider ticks.
  const visualsFlushRef = useRef<(() => any) | null>(null);
  const handleRegisterVisualsFlush = useCallback((flush: (() => any) | null) => {
    visualsFlushRef.current = flush;
  }, []);
  // P3 canvas-style applier (registered by VisualsTab; null when another tab
  // is active). Single-style commits ride the lens debounce — see VisualsTab.
  const canvasStyleApplierRef = useRef<((layerIdx: number, style: Record<string, any>) => void) | null>(null);
  const handleRegisterCanvasStyle = useCallback((fn: ((layerIdx: number, style: Record<string, any>) => void) | null) => {
    canvasStyleApplierRef.current = fn;
  }, []);
  // Flusher for debounced Subtitle-tab edits (registered by SubtitleTab itself;
  // null when another tab is active). Lets Ctrl+S / TopBar saves include
  // in-flight debounced subtitle edits without waiting for the 400ms timer.
  const subtitleFlushRef = useRef<(() => any) | null>(null);
  const handleRegisterSubtitleFlush = useCallback((flush: (() => any) | null) => {
    subtitleFlushRef.current = flush;
  }, []);

  // ── Visuals editor: silent selection (timeline cut click, asset click) ──
  // Flush in-flight debounced ticks first so a cross-section switch can't
  // race the trailing write / stale the Revert snapshot.
  const handleSelectSubVisual = useCallback((sceneIdx: number, subIdx: number) => {
    visualsFlushRef.current?.();
    const st = useEditorStore.getState();
    st.setSelectedSceneIndex(sceneIdx);
    st.setSelectedSubVisualIndex(subIdx);
    st.setSelectedLayerIndex(null);
  }, []);

  // ── Visuals editor: select + snapshot + open the Visuals tab ──────────────
  // (Timeline "Edit in Inspector" and keyboard shortcut route here.)
  // The tab switch is conditional: stale/deleted indices resolve to nothing,
  // and switching anyway would strand editingCard on the previous section
  // while the tab shows "No cut selected".
  const handleOpenVisualEditor = useCallback((sceneIdx: number, subIdx: number) => {
    const manifestScene = manifestDataRef.current?.[sceneIdx];
    if (!manifestScene) return;
    const sectionType = manifestScene.section_type;
    let cardKey = '';
    let sectionExists = false;
    const doc = scriptDataRef.current;
    if (sectionType === 'introduction') {
      cardKey = 'intro';
      sectionExists = !!doc?.introduction;
    } else if (sectionType === 'conclusion') {
      cardKey = 'conclusion';
      sectionExists = !!doc?.conclusion;
    } else if (sectionType === 'scene') {
      // Single source of truth with resolveVisualSelection: count 'scene'
      // entries in the manifest so stale intro presence can't shift indices.
      const scriptIdx = manifestToScriptSceneIndex(manifestDataRef.current, sceneIdx);
      if (doc?.scenes?.[scriptIdx] === undefined) return;
      cardKey = `scene_${scriptIdx}`;
      sectionExists = true;
    } else {
      return;
    }
    if (!sectionExists || !cardKey) return;
    handleSelectSubVisual(sceneIdx, subIdx);
    handleStartEdit(cardKey, 'visuals');
    setInspectorTab('visuals');
    const timing = sceneTimings[sceneIdx];
    if (timing?.subs?.[subIdx]) {
      handleSeek(timing.subs[subIdx].start);
    } else if (timing) {
      handleSeek(timing.start);
    }
  }, [handleSelectSubVisual, handleStartEdit, setInspectorTab, sceneTimings, handleSeek]);

  // ── P2 canvas overlay: lockout + routing ─────────────────────────────
  // Lockout: overlay boxes go inert (pointer-events: none) while an AI
  // rewrite touches the selected cut — same lens gate as VisualsTab
  // (isSectionRewriting || isSubRewriting). Navigation/seek stays free.
  const canvasLocked = useMemo(() => {
    if (canvasSceneIdx === null || canvasSceneIdx === undefined) return false;
    if (canvasSubIdx === null || canvasSubIdx === undefined) return false;
    const key = cardKeyForScene(canvasSceneIdx);
    if (!key) return false;
    return isSectionRewriting(key) || isSubRewriting(key, canvasSubIdx);
  }, [canvasSceneIdx, canvasSubIdx, cardKeyForScene, isSectionRewriting, isSubRewriting]);

  // Routing: overlay layer click lands in the Visuals tab for that cut.
  // Same-cut clicks ensure an active visuals edit session and flip the tab
  // + layer (no seek jump); cross-cut clicks ride handleOpenVisualEditor
  // (select + edit session + seek).
  // Flush in-flight debounced writes first so pending slider ticks land cleanly.
  const handleCanvasSelectLayer = useCallback((sceneIdx: number, subIdx: number, layerIdx: number) => {
    // Defense in depth: the overlay already blocks selection while locked,
    // but any direct/future caller lands here too — never flip tabs or start
    // an edit session under an in-flight rewrite for the target cut.
    const lockKey = cardKeyForScene(sceneIdx);
    if (lockKey && (isSectionRewriting(lockKey) || isSubRewriting(lockKey, subIdx))) return;
    // Playhead already inside the target cut (e.g. a box click after scrubbing
    // the preview): adopt the cut silently instead of yanking the playhead
    // back to the cut start like a timeline cut click would.
    const cf = usePlaybackStore.getState().currentFrame;
    const targetTiming = sceneTimings[sceneIdx]?.subs?.[subIdx];
    if (targetTiming && cf >= targetTiming.start && cf < targetTiming.end) {
      visualsFlushRef.current?.();
      handleSelectSubVisual(sceneIdx, subIdx);
      const adoptKey = cardKeyForScene(sceneIdx);
      if (adoptKey) {
        handleStartEdit(adoptKey, 'visuals');
      }
      const updated = useEditorStore.getState();
      if (updated.inspectorTab !== 'visuals') updated.setInspectorTab('visuals');
      updated.setSelectedLayerIndex(layerIdx);
      return;
    }
    visualsFlushRef.current?.();
    const st = useEditorStore.getState();
    if (st.selectedSceneIndex === sceneIdx && st.selectedSubVisualIndex === subIdx) {
      const cardKey = cardKeyForScene(sceneIdx);
      if (cardKey) {
        handleStartEdit(cardKey, 'visuals');
      }
      if (st.inspectorTab !== 'visuals') st.setInspectorTab('visuals');
      st.setSelectedLayerIndex(layerIdx);
      return;
    }
    handleOpenVisualEditor(sceneIdx, subIdx);
    const updated = useEditorStore.getState();
    if (updated.selectedSceneIndex === sceneIdx && updated.selectedSubVisualIndex === subIdx) {
      updated.setSelectedLayerIndex(layerIdx);
    }
  }, [handleOpenVisualEditor, handleSelectSubVisual, cardKeyForScene, handleStartEdit, isSectionRewriting, isSubRewriting, sceneTimings]);

  // P3 canvas drag commit: exactly one call per drag (pointer-up). Prefers the
  // registered VisualsTab applier (flushes pending ticks, rides the 150 ms
  // lens debounce). Falls back to a direct section merge only when the applier
  // is unregistered (VisualsTab unmounted ⇒ its unmount already flushed, so no
  // pending ticks can be clobbered).
  const handleCanvasStyleCommit = useCallback((sceneIdx: number, subIdx: number, layerIdx: number, style: Record<string, any>) => {
    const lockKey = cardKeyForScene(sceneIdx);
    if (lockKey && (isSectionRewriting(lockKey) || isSubRewriting(lockKey, subIdx))) return;
    const applier = canvasStyleApplierRef.current;
    if (applier) {
      applier(layerIdx, style);
      return;
    }
    const flushed = visualsFlushRef.current?.();
    const doc = flushed ?? scriptDataRef.current;
    const r = resolveVisualSelection(doc, manifestDataRef.current, sceneTimings, { sceneIdx, subIdx });
    if (!r) return;
    const subs = readSectionSubs(doc, r);
    if (subIdx < 0 || subIdx >= subs.length) return;
    const cut = subs[subIdx] ?? {};
    const kids = cut?.composition?.children ?? [];
    if (layerIdx < 0 || layerIdx >= kids.length) return;
    if (shallowEqualStyles(kids[layerIdx]?.content?.style ?? {}, style)) return;
    const composition = { ...(cut.composition || { type: 'Sequence' }) };
    composition.children = kids.map((l: any, i: number) =>
      i === layerIdx ? { ...l, content: { ...(l?.content || {}), style } } : l);
    const full = [...subs];
    full[subIdx] = { ...cut, composition };
    setScriptData(writeSectionSubs(doc, r, full));
  }, [cardKeyForScene, isSectionRewriting, isSubRewriting, sceneTimings, setScriptData]);

  const handleSave = useCallback(() => {
    // Whole-document save is locked while ANY AI rewrite is in flight: it
    // would persist a pre-AI doc and wipe every card baseline. Covers Ctrl+S,
    // the TopBar button, and every tab's Save (they all route here except
    // VisualsTab/ScriptTab direct saves, which carry their own guards).
    if (isAnyRewritingRef.current) {
      useUIStore.getState().addToast('Save is paused while an AI rewrite is in progress.', 'warning');
      return;
    }
    const tab = useEditorStore.getState().inspectorTab;
    // Exclusive + serialized: a dirty card save ends with loadFiles() which
    // re-reads transcription_path from disk, so it must never run
    // concurrently with handleSaveTranscription (stale-subtitle clobber).
    // Card saves go through the save queue; transcription follows the card
    // instead of racing it.
    if (editingCard) {
      // Flush debounced Visuals-tab ticks first (color drags, scrubs) and
      // hand the exact document to the save pipeline.
      const flushed = visualsFlushRef.current?.();
      // Same for Overlays-tab trailing ticks — an edit session can stay open
      // while the user types in the Overlays tab, so merge here instead of
      // dropping the last 250ms of overlay input. persist=false: the flush
      // updates state only, this card save is the single disk write.
      const flushedOverlays = overlaysFlushRef.current?.(false) as GlobalOverlayItem[] | null | undefined;
      let latest: any = flushed ?? undefined;
      if (flushedOverlays) {
        latest = { ...((flushed as any) ?? scriptDataRef.current), overlays: flushedOverlays };
      }
      const idx = editingCard.key.startsWith('scene_')
        ? parseInt(editingCard.key.replace('scene_', ''))
        : undefined;
      void enqueueSave(() => handleSaveCard(editingCard.key === 'intro' ? 'introduction' : editingCard.key, idx, latest))
        .then(() => {
          if (useEditorStore.getState().inspectorTab === 'subtitle') {
            const flushedSub = subtitleFlushRef.current?.();
            return handleSaveTranscription(flushedSub ?? undefined);
          }
          return undefined;
        });
    } else if (tab === 'subtitle') {
      const flushedSub = subtitleFlushRef.current?.();
      void enqueueSave(() => handleSaveTranscription(flushedSub ?? undefined));
    } else if (id && scriptData && selectedProject?.script_path) {
      // Overlays tab keeps a 250ms trailing draft — flush it so Ctrl+S
      // persists a document with the latest keystrokes and triggers feedback.
      // persist=false: state only, the card save below is the single write.
      const flushedOverlays = overlaysFlushRef.current?.(false) as GlobalOverlayItem[] | null | undefined;
      const docToSave = (tab === 'overlays' && flushedOverlays)
        ? { ...scriptDataRef.current, overlays: flushedOverlays }
        : undefined;
      void enqueueSave(() => handleSaveCard(undefined, undefined, docToSave));
    }
  }, [editingCard, handleSaveCard, id, scriptData, selectedProject, handleSaveTranscription, enqueueSave]);

  const handlePlayPause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.toggle();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handleResizeSubVisual = useCallback(async (sceneIndex: number, newRatios: number[]) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current) return;
    if (!requireSectionUnlocked(sceneIndex, 'Cut resize')) return;

    const sceneDuration = manifestDataRef.current[sceneIndex]?.duration || 1;

    // 1. Update scriptData locally (newRatios[i] corresponds to script sub i —
    // the timeline displays liveScenes, which are script sub-visuals in content).
    // Section is driven by the manifest entry's section_type (same convention
    // as resolveVisualSelection) so a stale intro on either side can't shift
    // the scene index.
    const scriptCopy = { ...scriptDataRef.current };

    const updateSv = (sv: any, i: number) => {
      const ratio = typeof newRatios[i] === 'number' && !isNaN(newRatios[i])
        ? newRatios[i]
        : sv.duration_ratio;
      return {
        ...sv,
        duration_ratio: ratio,
        duration: ratio * sceneDuration
      };
    };

    const resizeSection = manifestDataRef.current[sceneIndex]?.section_type;
    if (resizeSection === 'introduction' && scriptCopy.introduction) {
      scriptCopy.introduction = { ...scriptCopy.introduction };
      scriptCopy.introduction.sub_visuals = (scriptCopy.introduction.sub_visuals || []).map(updateSv);
    } else if (resizeSection === 'conclusion' && scriptCopy.conclusion) {
      scriptCopy.conclusion = { ...scriptCopy.conclusion };
      scriptCopy.conclusion.sub_visuals = (scriptCopy.conclusion.sub_visuals || []).map(updateSv);
    } else if (resizeSection === 'scene') {
      const idx = manifestToScriptSceneIndex(manifestDataRef.current, sceneIndex);
      if (scriptCopy.scenes && scriptCopy.scenes[idx]) {
        scriptCopy.scenes = [...scriptCopy.scenes];
        scriptCopy.scenes[idx] = { ...scriptCopy.scenes[idx] };
        scriptCopy.scenes[idx].sub_visuals = (scriptCopy.scenes[idx].sub_visuals || []).map(updateSv);
      }
    }

    // 2. Update manifestData locally — match each manifest sub-visual by index
    const manifestCopy = [...manifestDataRef.current];
    if (manifestCopy[sceneIndex]?.sub_visuals) {
      manifestCopy[sceneIndex].sub_visuals = manifestCopy[sceneIndex].sub_visuals.map((sv: any, i: number) => {
        if (i >= newRatios.length) return sv;
        const ratio = typeof newRatios[i] === 'number' && !isNaN(newRatios[i])
          ? newRatios[i]
          : sv.duration_ratio;
        return { ...sv, duration_ratio: ratio, duration: ratio * sceneDuration };
      });
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    // 3. Persist to backend (serialized with other saves)
    try {
      const result = await enqueueSave(() => callApi<any>('save_project_with_cleanup', id, scriptCopy, manifestCopy)) as any;
      if (result?.success) {
        loadFiles(id);
      }
    } catch (e) {
      console.error('Failed to persist sub-visual duration ratios:', e);
    }
  }, [id, enqueueSave, setScriptData, setManifestData, loadFiles]);

  const handleResizeScene = useCallback(async (
    sceneIndex: number, newDurationSeconds: number, nextDurationSeconds: number | null, mode: 'boundary' | 'absolute'
  ) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current) return;
    if (!requireSectionUnlocked(sceneIndex, 'Scene resize')) return;
    // Boundary drags rewrite the NEXT scene's timings too — both must be free.
    if (mode === 'boundary' && nextDurationSeconds !== null
      && !requireSectionUnlocked(sceneIndex + 1, 'Scene resize')) return;

    const manifestCopy = [...manifestDataRef.current];

    const scaleSubVisuals = (scene: any, durSec: number) => {
      if (!scene.sub_visuals) return scene;
      const totalExistingDur = scene.sub_visuals.reduce((sum: number, sv: any) => sum + (typeof sv.duration === 'number' ? sv.duration : 0), 0);
      const subs = scene.sub_visuals.map((sv: any) => {
        const ratio = typeof sv.duration_ratio === 'number' && !isNaN(sv.duration_ratio)
          ? sv.duration_ratio
          : totalExistingDur > 0
            ? (typeof sv.duration === 'number' ? sv.duration : 0) / totalExistingDur
            : 1 / (scene.sub_visuals.length || 1);
        return { ...sv, duration: ratio * durSec, duration_ratio: ratio };
      });
      return { ...scene, sub_visuals: subs };
    };

    // Update scene at sceneIndex
    manifestCopy[sceneIndex] = scaleSubVisuals(
      { ...manifestCopy[sceneIndex], duration: Math.max(2, newDurationSeconds) },
      Math.max(2, newDurationSeconds)
    );

    // Update next scene for boundary mode
    if (mode === 'boundary' && nextDurationSeconds !== null && sceneIndex + 1 < manifestCopy.length) {
      manifestCopy[sceneIndex + 1] = scaleSubVisuals(
        { ...manifestCopy[sceneIndex + 1], duration: Math.max(2, nextDurationSeconds) },
        Math.max(2, nextDurationSeconds)
      );
    }

    // Mirror into scriptData — section driven by the manifest entry's
    // section_type (same convention as resolveVisualSelection).
    const scriptCopy = { ...scriptDataRef.current };

    const updateSv = (sv: any, durSec: number, totalExistingDur: number, subCount: number) => {
      const ratio = typeof sv.duration_ratio === 'number' && !isNaN(sv.duration_ratio)
        ? sv.duration_ratio
        : totalExistingDur > 0
          ? (typeof sv.duration === 'number' ? sv.duration : 0) / totalExistingDur
          : 1 / (subCount || 1);
      return { ...sv, duration: ratio * durSec, duration_ratio: ratio };
    };

    const updateSceneInScript = (idx: number, durSec: number) => {
      const subs = manifestCopy[idx]?.sub_visuals || [];
      const subCount = subs.length || 1;
      const totalExistingDur = subs.reduce((sum: number, sv: any) => sum + (typeof sv.duration === 'number' ? sv.duration : 0), 0);
      const sectionType = manifestCopy[idx]?.section_type;
      if (sectionType === 'introduction' && scriptCopy.introduction) {
        scriptCopy.introduction = { ...scriptCopy.introduction };
        scriptCopy.introduction.sub_visuals = (scriptCopy.introduction.sub_visuals || []).map((sv: any) => updateSv(sv, durSec, totalExistingDur, subCount));
      } else if (sectionType === 'conclusion' && scriptCopy.conclusion) {
        scriptCopy.conclusion = { ...scriptCopy.conclusion };
        scriptCopy.conclusion.sub_visuals = (scriptCopy.conclusion.sub_visuals || []).map((sv: any) => updateSv(sv, durSec, totalExistingDur, subCount));
      } else if (sectionType === 'scene') {
        const sIdx = manifestToScriptSceneIndex(manifestCopy, idx);
        if (scriptCopy.scenes && scriptCopy.scenes[sIdx]) {
          scriptCopy.scenes = [...scriptCopy.scenes];
          scriptCopy.scenes[sIdx] = { ...scriptCopy.scenes[sIdx] };
          scriptCopy.scenes[sIdx].sub_visuals = (scriptCopy.scenes[sIdx].sub_visuals || []).map((sv: any) => updateSv(sv, durSec, totalExistingDur, subCount));
        }
      }
    };

    updateSceneInScript(sceneIndex, newDurationSeconds);
    if (mode === 'boundary' && nextDurationSeconds !== null) {
      updateSceneInScript(sceneIndex + 1, nextDurationSeconds);
    }

    setManifestData(manifestCopy);
    setScriptData(scriptCopy);

    try {
      const result = await enqueueSave(() => callApi<any>('save_project_with_cleanup', id, scriptCopy, manifestCopy)) as any;
      if (result?.success) {
        loadFiles(id);
      }
    } catch (e) {
      console.error('Failed to persist scene duration resize:', e);
    }
  }, [id, enqueueSave, setScriptData, setManifestData, loadFiles]);

  // ── Refs for shortcut handlers that need latest state ──
  const sceneTimingsRef = useRef(sceneTimings);
  sceneTimingsRef.current = sceneTimings;
  const totalFrames = useMemo(
    () => sceneTimings?.[sceneTimings.length - 1]?.end ?? 0,
    [sceneTimings]
  );
  const totalFramesRef = useRef(totalFrames);
  totalFramesRef.current = totalFrames;

  // ── Shortcut handlers ──
  const handleEscape = useCallback(() => {
    if (editingCard) {
      handleCancelEdit();
    } else if (sceneToDelete !== null) {
      setSceneToDelete(null);
    }
  }, [editingCard, handleCancelEdit, sceneToDelete, setSceneToDelete]);

  const handleDelete = useCallback(() => {
    const timings = sceneTimingsRef.current;
    if (!timings?.length) return;
    const cf = currentFrameRef.current;
    const timingIdx = timings.findIndex(t => cf >= t.start && cf < t.end);
    if (timingIdx < 0) return;
    // Timeline order mirrors the manifest — read intro and conclusion presence
    // from the manifest, not scriptData, so a stale side can't shift the index.
    const manifest = manifestDataRef.current;
    const hasIntro = manifest?.[0]?.section_type === 'introduction';
    const hasCon = manifest?.[manifest.length - 1]?.section_type === 'conclusion';
    const isInt = hasIntro && timingIdx === 0;
    const isCon = hasCon && timingIdx === timings.length - 1;
    if (isInt || isCon) return;
    // Opening the delete confirmation while either section rewrites would
    // shift scene indices under the in-flight generation (confirm is guarded
    // too — this just avoids the dead-end modal).
    if (!requireSectionUnlocked(timingIdx, 'Scene delete')) return;
    const sceneIdx = manifestToScriptSceneIndex(manifest, timingIdx);
    if (sceneIdx >= 0) {
      setSceneToDelete(sceneIdx);
    } else {
      setSceneToDelete(timingIdx - (hasIntro ? 1 : 0));
    }
  }, [setSceneToDelete]);

  const handleSeekRelative = useCallback((delta: number) => {
    handleSeek(Math.max(0, Math.min(totalFramesRef.current, currentFrameRef.current + delta)));
  }, [handleSeek]);

  const handlePrevScene = useCallback(() => {
    const timings = sceneTimingsRef.current;
    if (!timings?.length) return;
    const cf = currentFrameRef.current;
    let idx = timings.findIndex(t => cf >= t.start && cf < t.end);
    if (idx > 0) handleSeek(timings[idx - 1].start);
  }, [handleSeek]);

  const handleNextScene = useCallback(() => {
    const timings = sceneTimingsRef.current;
    if (!timings?.length) return;
    const cf = currentFrameRef.current;
    let idx = timings.findIndex(t => cf >= t.start && cf < t.end);
    if (idx >= 0 && idx < timings.length - 1) handleSeek(timings[idx + 1].start);
  }, [handleSeek]);

  const handlePrevSubVisual = useCallback(() => {
    const timings = sceneTimingsRef.current;
    if (!timings?.length) return;
    const cf = currentFrameRef.current;
    const sceneIdx = timings.findIndex(t => cf >= t.start && cf < t.end);
    if (sceneIdx < 0) return;
    const subs = timings[sceneIdx].subs;
    if (subs?.length) {
      const subIdx = subs.findIndex(s => cf >= s.start && cf < s.end);
      if (subIdx > 0) {
        handleSeek(subs[subIdx - 1].start);
        return;
      }
    }
    if (sceneIdx > 0) {
      const prevSubs = timings[sceneIdx - 1].subs;
      if (prevSubs?.length) handleSeek(prevSubs[prevSubs.length - 1].start);
    }
  }, [handleSeek]);

  const handleNextSubVisual = useCallback(() => {
    const timings = sceneTimingsRef.current;
    if (!timings?.length) return;
    const cf = currentFrameRef.current;
    const sceneIdx = timings.findIndex(t => cf >= t.start && cf < t.end);
    if (sceneIdx < 0) return;
    const subs = timings[sceneIdx].subs;
    if (subs?.length) {
      const subIdx = subs.findIndex(s => cf >= s.start && cf < s.end);
      if (subIdx >= 0 && subIdx < subs.length - 1) {
        handleSeek(subs[subIdx + 1].start);
        return;
      }
    }
    if (sceneIdx < timings.length - 1) {
      const nextSubs = timings[sceneIdx + 1].subs;
      if (nextSubs?.length) handleSeek(nextSubs[0].start);
    }
  }, [handleSeek]);

  const handleGoToStart = useCallback(() => {
    handleSeek(0);
  }, [handleSeek]);

  const handleGoToEnd = useCallback(() => {
    handleSeek(totalFramesRef.current);
  }, [handleSeek]);

  const handleRunPipeline = useCallback(() => {
    useEditorStore.getState().setInspectorTab('export');
    if (!isRunning) {
      handleResumePipeline();
    }
  }, [handleResumePipeline, isRunning]);

  const handleFullscreenToggle = useCallback(() => {
    fullscreenToggleRef.current?.();
  }, []);

  const handleDeleteSceneTimeline = useCallback((idx: number) => {
    if (!requireSectionUnlocked(idx, 'Scene delete')) return;
    const manifest = manifestDataRef.current;
    const sceneIdx = manifestToScriptSceneIndex(manifest, idx);
    if (sceneIdx >= 0) {
      setSceneToDelete(sceneIdx);
    } else {
      const hasIntro = manifest?.[0]?.section_type === 'introduction' || !!scriptDataRef.current?.introduction;
      setSceneToDelete(idx - (hasIntro ? 1 : 0));
    }
  }, [setSceneToDelete]);

  const handleEditActiveVisuals = useCallback(() => {
    if (!scriptData || !sceneTimings?.length) return;
    const idx = useEditorStore.getState().selectedSceneIndex;
    const activeIdx = idx !== null ? idx : (() => {
      const cf = currentFrameRef.current;
      return sceneTimings.findIndex(t => cf >= t.start && cf < t.end);
    })();
    if (activeIdx < 0) return;
    const subs = sceneTimings[activeIdx]?.subs || [];
    const cf = currentFrameRef.current;
    let subIdx = subs.findIndex(s => cf >= s.start && cf < s.end);
    if (subIdx < 0) subIdx = 0;
    handleOpenVisualEditor(activeIdx, subIdx);
  }, [scriptData, sceneTimings, handleOpenVisualEditor]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSave: handleSave,
    onPlayPause: handlePlayPause,
    onUndo: () => {},
    onEscape: handleEscape,
    onDelete: handleDelete,
    onSeekRelative: handleSeekRelative,
    onPrevScene: handlePrevScene,
    onNextScene: handleNextScene,
    onPrevSubVisual: handlePrevSubVisual,
    onNextSubVisual: handleNextSubVisual,
    onGoToStart: handleGoToStart,
    onGoToEnd: handleGoToEnd,
    onRunPipeline: handleRunPipeline,
    onFullscreenToggle: handleFullscreenToggle,
    onEditVisuals: handleEditActiveVisuals,
  });

  const audioUrl = selectedProject?.audio_path 
    ? `${getMediaUrlSync(selectedProject.audio_path)}&t=${reloadKey}`
    : '';
  const bgMusicUrl = selectedProject?.bg_music_path
    ? `${getMediaUrlSync(selectedProject.bg_music_path)}&t=${reloadKey}`
    : '';

  // Safe defaults for when selectedProject is null
  const safeProject = selectedProject || {
    id: '',
    name: '',
    prompt: '',
    status: 'idle',
    created_at: '',
    updated_at: '',
    style: 'standard' as const,
    language: 'en' as const,
    duration_mode: 'medium' as const,
    video_format: 'landscape' as const,
    bg_music_volume: 0.15,
    tts_engine: undefined as string | undefined,
    tts_voice: undefined as string | undefined,
    project_settings: undefined as string | undefined,
    audio_path: undefined as string | undefined,
    bg_music_path: undefined as string | undefined,
    script_path: undefined as string | undefined,
    transcription_path: undefined as string | undefined,
    assets_manifest_path: undefined as string | undefined,
    video_path: undefined as string | undefined,
    export_folder: '',
  };

  return (
    <div
      className="h-screen w-screen bg-zinc-950 overflow-hidden relative"
      style={{
        display: 'grid',
        gridTemplateColumns: `${leftPanelWidth}px 1fr ${rightPanelWidth}px`,
        gridTemplateRows: `56px minmax(0, 1fr) ${timelineHeight}px`,
        gridTemplateAreas: `
          "topbar  topbar  topbar"
          "sidebar main    inspector"
          "timeline timeline timeline"
        `,
      }}
    >
      {/* Top Bar */}
      <div style={{ gridArea: 'topbar' }}>
        <TopBar
          onSave={handleSave}
          isSaving={savingCardKey !== null}
          isSaveLocked={isAnyRewriting}
          isPipelineRunning={isRunning}
          pipelineStatusText={activeTaskStep?.message}
          hasScriptData={hasScriptData}
          onTriggerFullPipeline={triggerFullPipeline}
        />
      </div>

      {/* Media Sidebar */}
      <div style={{ gridArea: 'sidebar' }} className="relative overflow-y-auto bg-zinc-950/80">
        <MediaSidebar
          scriptData={scriptData}
          manifestData={manifestData}
          sceneTimings={sceneTimings}
          onSeek={handleSeek}
          onSelectSubVisual={handleSelectSubVisual}
          projectId={id}
          isPipelineRunning={isRunning}
          activeTaskStep={activeTaskStep}
          reloadTrigger={reloadKey}
          musicClips={musicClips}
          onUpdateMusicClips={updateMusicClips}
          onUploadMusicClip={handleUploadMusicClip}
          bgMusicVolume={safeProject.bg_music_volume}
          onBgMusicVolumeChange={handleBgMusicVolumeChange}
          sfxClips={sfxClips}
          onUpdateSfxClips={updateSfxClips}
          onUploadSfxClip={handleUploadSfxClip}
          onRefreshSfx={handleRefreshSfx}
        />
        <ResizeHandle direction="vertical" target="leftPanel" side="right" min={300} />
      </div>

      {/* Center: Video Preview */}
      <div style={{ gridArea: 'main' }} className="relative">
        <VideoPreview
          playerRef={playerRef}
          liveScenes={deferredLiveScenes || EMPTY_ARRAY}
          transcriptionData={transcriptionData}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          bgMusicVolume={safeProject.bg_music_volume}
          musicClips={musicClips}
          sfxClips={sfxClips}
          sfxVolume={sfxMasterVolume}
          voiceoverVolume={parseFloat(localProjectSettings?.voiceover_volume || '1.0')}
          styleType={safeProject.style}
          language={safeProject.language}
          videoFormat={safeProject.video_format || 'landscape'}
          subtitleSettings={localProjectSettings}
          designSystem={designData}
          overlays={deferredOverlays}
          onFrameUpdate={handleFrameUpdate}
          isPipelineRunning={isRunning}
          fullscreenToggleRef={fullscreenToggleRef}
          canvasLocked={canvasLocked}
          onCanvasSelectLayer={handleCanvasSelectLayer}
          onCanvasStyleCommit={handleCanvasStyleCommit}
          sceneTimings={sceneTimings}
        />
      </div>

      {/* Inspector Panel */}
      <div style={{ gridArea: 'inspector' }} className="relative overflow-y-auto bg-zinc-950/80">
        <ResizeHandle direction="vertical" target="rightPanel" side="left" min={350} />
        <InspectorPanel
          scriptData={scriptData}
          manifestData={manifestData}
          transcriptionData={transcriptionData}
          sceneTimings={activeTimings}
          localProjectSettings={localProjectSettings}
          projectId={id || ''}

          editingCard={editingCard}
          setEditingCard={setEditingCard}
          rewritePrompt={rewritePrompt}
          setRewritePrompt={setRewritePrompt}
          rewritingSection={rewritingSection}
          isAnyRewriting={isAnyRewriting}
          isSectionRewriting={isSectionRewriting}
          isSubRewriting={isSubRewriting}
          isSectionLocked={isSectionLocked}
          invalidateRewrites={invalidateRewrites}
          savingCardKey={savingCardKey}
          isSaving={savingCardKey !== null}
          onSaveCard={handleSaveCard}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onOpenVisuals={handleOpenVisualEditor}
          onRewriteSection={handleRewriteSection}
          onRewriteSubVisual={handleRewriteSubVisual}
          onInsertScene={insertAndSaveNewScene}
          onSetSceneToDelete={setSceneToDelete}
          onSetScriptData={setScriptData}
          onSaveOverlays={handleSaveOverlays}
          onUploadSubVisual={handleUploadSubVisual}
          onPreviewSubVisual={handlePreviewSubVisual}
          uploadingSubVisual={uploadingSubVisual}
          onDeleteLayerSubVisual={handleDeleteLayerAsset}
          onDuplicateLayerSubVisual={handleDuplicateLayerAsset}
          onMoveLayerSubVisual={handleMoveLayerAsset}
          onReorderLayerSubVisual={handleReorderLayerAsset}
          onDeleteCutSubVisual={handleDeleteCutAsset}
          onRegisterFlush={handleRegisterVisualsFlush}
          onRegisterCanvasStyle={handleRegisterCanvasStyle}

          tasks={tasks}
          queue={queue}
          isPipelineRunning={isRunning}
          targetStage={targetStage}
          activeTaskStep={activeTaskStep}
          hasScriptData={hasScriptData}
          onSetTargetStage={setTargetStage}
          onTriggerFullPipeline={triggerFullPipeline}
          onResumePipeline={handleResumePipeline}
          onResumeFromStage={handleResumeFromStage}
          onCancelPipeline={cancelPipeline}

          isSavingSubtitles={isSavingSubtitles}
          onSettingsUpdate={handleSettingsUpdate}
          onTranscriptionChange={setTranscriptionData}
          onSaveTranscription={handleSaveTranscription}
          onResetTranscription={handleResetTranscription}
          onRegisterSubtitleFlush={handleRegisterSubtitleFlush}
          onRegisterOverlaysFlush={handleRegisterOverlaysFlush}

          onSeek={handleSeek}
        />
      </div>

      {/* Bottom Timeline */}
      <div style={{ gridArea: 'timeline' }} className="relative">
        <ResizeHandle direction="horizontal" target="timeline" side="top" />
        <Timeline
          liveScenes={deferredLiveScenes || EMPTY_ARRAY}
          sceneTimings={sceneTimings}
          getLiveFrame={getLiveFrame}
          overlays={deferredOverlays}
          transcriptionData={transcriptionData}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          musicClips={musicClips}
          onUpdateMusicClips={updateMusicClips}
          onUploadMusicClip={handleUploadMusicClip}
          sfxClips={sfxClips}
          onUpdateSfxClips={updateSfxClips}
          onUploadSfxClip={handleUploadSfxClip}
          onSeek={handleSeek}
          onDeleteScene={handleDeleteSceneTimeline}
          onResizeSubVisual={handleResizeSubVisual}
          onResizeScene={handleResizeScene}
          onTimingsDragUpdate={setActiveTimings}
          onToggleSubVisualAudioFlag={handleToggleSubVisualAudioFlag}
          onSelectSubVisual={handleSelectSubVisual}
          onUpdateSubVisualTransition={handleUpdateSubVisualTransition}
          onSplitSubVisualAtFrame={handleSplitSubVisualAtFrame}
          onDuplicateSubVisual={handleDuplicateSubVisual}
          onDeleteSubVisual={handleDeleteSubVisual}
          onUpdateOverlay={handleUpdateOverlay}
          onToggleOverlayEnabled={handleToggleOverlayEnabled}
          onSelectOverlay={handleSelectOverlay}
          onOpenInspectorScript={handleOpenVisualEditor}
        />
      </div>

      {/* Delete scene modal */}
      {sceneToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4">
            <div className="flex items-start gap-4">
              <div className="bg-red-500/10 text-red-500 p-3 rounded-full shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-200 mb-2">Delete Scene?</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Are you sure you want to permanently delete this scene? This action cannot be undone.
                </p>
                <div className="flex items-center gap-3 mt-6">
                  <button
                    onClick={() => setSceneToDelete(null)}
                    className="flex-1 px-4 py-2 text-xs font-bold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteScene}
                    className="flex-1 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay — sits on top of the fully rendered grid, never unmounts it */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center"
          >
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center animate-pulse">
                <div className="w-5 h-5 rounded-full border-2 border-zinc-600 border-t-transparent animate-spin" />
              </div>
              <p className="text-sm text-zinc-400 font-medium">Loading project workspace...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EditorWorkspace;
