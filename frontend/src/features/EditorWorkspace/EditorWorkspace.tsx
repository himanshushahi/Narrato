import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjectStore } from '../../store/useProjectStore';
import { useEditorStore } from '../../store/useEditorStore';
import { usePlaybackStore } from '../../store/usePlaybackStore';
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

const EMPTY_ARRAY: any[] = [];

const EditorWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const selectedProject = useProjectStore((s) => s.selectedProject);
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
  // === Hooks ===
  const {
    scriptData, setScriptData,
    designData,
    manifestData, setManifestData,
    transcriptionData, setTranscriptionData,
    liveScenes, sceneTimings, reloadKey,
    loadFiles
  } = useEditorData(id);

  const [activeTimings, setActiveTimings] = useState(sceneTimings);
  useEffect(() => {
    setActiveTimings(sceneTimings);
  }, [sceneTimings]);

  const {
    tasks, queue, isRunning, targetStage, activeTaskStep, scriptChangedAlert,
    setTargetStage, setScriptChangedAlert, triggerFullPipeline,
    handleResumePipeline, handleResumeFromStage, cancelPipeline
  } = usePipeline(id, loadFiles);

  const {
    editingCard, setEditingCard, rewritePrompt, setRewritePrompt,
    rewritingSection,
    savingCardKey, sceneToDelete, localProjectSettings, isSavingSubtitles,
    scriptChangedAlert: scriptEditingAlert,
    setScriptChangedAlert: setScriptEditingAlert,
    previewAssets, uploadingSubVisual, handleUploadSubVisual, handlePreviewSubVisual,
    handleStartEdit, handleCancelEdit, handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene, setSceneToDelete,
    handleSettingsUpdate, handleSaveTranscription, handleResetTranscription
  } = useScriptEditing(
    id, scriptData, setScriptData, manifestData, setManifestData,
    transcriptionData, setTranscriptionData, loadFiles
  );

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
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const flagKey = `${sceneIdx}:${subIdx}:${flag}`;
    const currentValue = subVisualFlagValuesRef.current.get(flagKey) ?? !!manifestScene.sub_visuals[subIdx][flag];
    const newValue = !currentValue;
    subVisualFlagValuesRef.current.set(flagKey, newValue);

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    // Map timeline index → script.json section (intro / scenes / conclusion).
    const hasIntro = !!scriptDataRef.current.introduction;
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[sceneIdx - (hasIntro ? 1 : 0)];
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
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const hasIntro = !!scriptDataRef.current.introduction;
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[sceneIdx - (hasIntro ? 1 : 0)];

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
    const leftDuration = Math.max(0.2, Number((leftFrames / FPS).toFixed(2)));
    const rightDuration = Math.max(0.2, Number((origDuration - leftDuration).toFixed(2)));

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const hasIntro = !!scriptDataRef.current.introduction;
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[sceneIdx - (hasIntro ? 1 : 0)];

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
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals?.[subIdx]) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const hasIntro = !!scriptDataRef.current.introduction;
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[sceneIdx - (hasIntro ? 1 : 0)];

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
    const manifestScene = manifestDataRef.current[sceneIdx];
    if (!manifestScene?.sub_visuals || manifestScene.sub_visuals.length <= 1) return;

    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
    const manifestCopy = JSON.parse(JSON.stringify(manifestDataRef.current));

    const hasIntro = !!scriptDataRef.current.introduction;
    const sectionType = manifestScene.section_type;
    let scriptScene: any = null;
    if (sectionType === 'introduction') scriptScene = scriptCopy.introduction;
    else if (sectionType === 'conclusion') scriptScene = scriptCopy.conclusion;
    else scriptScene = scriptCopy.scenes?.[sceneIdx - (hasIntro ? 1 : 0)];

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
  const handleUpdateOverlay = useCallback(async (target: number | string, updates: Partial<GlobalOverlayItem>) => {
    if (!scriptDataRef.current || !selectedProject?.script_path) return;
    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
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
    if (!scriptDataRef.current || !selectedProject?.script_path) return;
    const scriptCopy = JSON.parse(JSON.stringify(scriptDataRef.current));
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

  // Sync scriptEditing's alert to the pipeline hook so handleResumePipeline can use it.
  // Use a ref to only propagate CHANGES — prevents a race where handleResumePipeline
  // clears the pipeline's alert but this effect re-sets it from the still-true source.
  const prevScriptEditingRef = useRef(scriptEditingAlert);
  useEffect(() => {
    if (scriptEditingAlert !== prevScriptEditingRef.current) {
      setScriptChangedAlert(scriptEditingAlert);
      prevScriptEditingRef.current = scriptEditingAlert;
    }
  }, [scriptEditingAlert, setScriptChangedAlert]);

  // Clear both alerts when the pipeline finishes — narration is now synced
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      setScriptChangedAlert(false);
      setScriptEditingAlert(false);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, setScriptChangedAlert, setScriptEditingAlert]);

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
  const activeTimingsToUse = activeTimings.length > 0 ? activeTimings : sceneTimings;
  // Derive the active scene/sub indices INSIDE the store selector so this
  // component re-renders only when the active item actually changes
  // (scene boundaries), not on every playhead frame.
  const activeSceneIdx = usePlaybackStore((s) => {
    const timings = activeTimingsToUse;
    return timings.findIndex(t => s.currentFrame >= t.start && s.currentFrame < t.end);
  });
  const activeSubIdx = usePlaybackStore((s) => {
    if (activeSceneIdx < 0) return -1;
    const timings = activeTimingsToUse;
    const subs = timings[activeSceneIdx]?.subs;
    return subs && subs.length > 0
      ? subs.findIndex(t => s.currentFrame >= t.start && s.currentFrame < t.end)
      : -1;
  });
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
        const preview = previewAssets[key];
        if (!preview) return sv;

        let updatedComposition = sv.composition;
        if (sv.composition && Array.isArray(sv.composition.children)) {
          const updatedChildren = sv.composition.children.map((layer: any) => {
            if (layer?.content && (layer.content.type === 'Image' || layer.content.type === 'Video')) {
              return {
                ...layer,
                content: {
                  ...layer.content,
                  local_path: preview.visual_path
                }
              };
            }
            return layer;
          });
          updatedComposition = { ...sv.composition, children: updatedChildren };
        }

        return {
          ...sv,
          visual_url: preview.visual_url,
          composition: updatedComposition
        };
      });
      if (type === 'scene') sceneCounter++;
      return { ...scene, sub_visuals };
    });
  }, [liveScenes, previewAssets]);

  // === Handlers ===
  const handleSeek = useCallback((frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  }, []);

  const handleOpenInspectorScript = useCallback((sceneIdx: number, subIdx: number) => {
    setInspectorTab('script');
    if (manifestDataRef.current && manifestDataRef.current[sceneIdx]) {
      const scene = manifestDataRef.current[sceneIdx];
      const hasIntro = !!scriptDataRef.current?.introduction;
      let cardKey = '';
      if (scene.section_type === 'introduction') cardKey = 'intro';
      else if (scene.section_type === 'conclusion') cardKey = 'conclusion';
      else cardKey = `scene_${sceneIdx - (hasIntro ? 1 : 0)}`;

      handleStartEdit(cardKey, 'visuals');
    }
    const timing = sceneTimings[sceneIdx];
    if (timing?.subs?.[subIdx]) {
      handleSeek(timing.subs[subIdx].start);
    } else if (timing) {
      handleSeek(timing.start);
    }
  }, [setInspectorTab, handleStartEdit, sceneTimings, handleSeek]);

  const handleSave = useCallback(() => {
    if (editingCard) {
      const idx = editingCard.key.startsWith('scene_')
        ? parseInt(editingCard.key.replace('scene_', ''))
        : undefined;
      handleSaveCard(editingCard.key === 'intro' ? 'introduction' : editingCard.key, idx);
    } else {
      const tab = useEditorStore.getState().inspectorTab;
      if (tab === 'subtitle') {
        handleSaveTranscription();
      } else if (id && scriptData && selectedProject?.script_path) {
        handleSaveCard();
      }
    }
  }, [editingCard, handleSaveCard, id, scriptData, selectedProject, handleSaveTranscription]);

  const handlePlayPause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.toggle();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handleResizeSubVisual = useCallback(async (sceneIndex: number, newRatios: number[]) => {
    if (!id || !scriptDataRef.current || !manifestDataRef.current) return;

    const sceneDuration = manifestDataRef.current[sceneIndex]?.duration || 1;

    // 1. Update scriptData locally (newRatios[i] corresponds to script sub i —
    // the timeline displays liveScenes, which are script sub-visuals in content).
    const scriptCopy = { ...scriptDataRef.current };
    const hasIntro = scriptDataRef.current.introduction ? 1 : 0;
    
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

    if (sceneIndex === 0 && hasIntro) {
      scriptCopy.introduction = { ...scriptCopy.introduction };
      scriptCopy.introduction.sub_visuals = (scriptCopy.introduction.sub_visuals || []).map(updateSv);
    } else if (sceneIndex === (scriptDataRef.current.scenes?.length || 0) + hasIntro && scriptDataRef.current.conclusion) {
      scriptCopy.conclusion = { ...scriptCopy.conclusion };
      scriptCopy.conclusion.sub_visuals = (scriptCopy.conclusion.sub_visuals || []).map(updateSv);
    } else {
      const idx = sceneIndex - hasIntro;
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

    // Mirror into scriptData
    const scriptCopy = { ...scriptDataRef.current };
    const hasIntro = scriptDataRef.current.introduction ? 1 : 0;

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
      if (idx === 0 && hasIntro) {
        scriptCopy.introduction = { ...scriptCopy.introduction };
        scriptCopy.introduction.sub_visuals = (scriptCopy.introduction.sub_visuals || []).map((sv: any) => updateSv(sv, durSec, totalExistingDur, subCount));
      } else if (idx === (scriptDataRef.current.scenes?.length || 0) + hasIntro && scriptDataRef.current.conclusion) {
        scriptCopy.conclusion = { ...scriptCopy.conclusion };
        scriptCopy.conclusion.sub_visuals = (scriptCopy.conclusion.sub_visuals || []).map((sv: any) => updateSv(sv, durSec, totalExistingDur, subCount));
      } else {
        const sIdx = idx - hasIntro;
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
    const hasIntro = scriptData?.introduction ? true : false;
    const isInt = hasIntro && timingIdx === 0;
    const isCon = timingIdx === timings.length - 1;
    if (isInt || isCon) return;
    const sceneIdx = timingIdx - (hasIntro ? 1 : 0);
    setSceneToDelete(sceneIdx);
  }, [setSceneToDelete, scriptData]);

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
    const sceneIdx = idx - (scriptData?.introduction ? 1 : 0);
    setSceneToDelete(sceneIdx);
  }, [scriptData?.introduction, setSceneToDelete]);

  const handleEditActiveVisuals = useCallback(() => {
    if (!scriptData || !sceneTimings?.length) return;
    const idx = useEditorStore.getState().selectedSceneIndex;
    const activeIdx = idx !== null ? idx : (() => {
      const cf = currentFrameRef.current;
      return sceneTimings.findIndex(t => cf >= t.start && cf < t.end);
    })();
    if (activeIdx < 0) return;
    const hasIntro = !!scriptData.introduction;
    const sceneCount = scriptData.scenes?.length || 0;
    const concIdx = (hasIntro ? 1 : 0) + sceneCount;
    let cardKey: string;
    if (hasIntro && activeIdx === 0) {
      cardKey = 'intro';
    } else if (activeIdx >= concIdx) {
      cardKey = 'conclusion';
    } else {
      const sceneIdx = activeIdx - (hasIntro ? 1 : 0);
      cardKey = `scene_${sceneIdx}`;
    }
    handleStartEdit(cardKey, 'visuals');
  }, [scriptData, sceneTimings, handleStartEdit]);

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
          projectId={id}
          isPipelineRunning={isRunning}
          activeTaskStep={activeTaskStep}
          reloadTrigger={reloadKey}
        />
        <ResizeHandle direction="vertical" target="leftPanel" side="right" min={300} />
      </div>

      {/* Center: Video Preview */}
      <div style={{ gridArea: 'main' }} className="relative">
        <VideoPreview
          playerRef={playerRef}
          liveScenes={effectiveLiveScenes || liveScenes || EMPTY_ARRAY}
          transcriptionData={transcriptionData}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          bgMusicVolume={safeProject.bg_music_volume}
          voiceoverVolume={parseFloat(localProjectSettings?.voiceover_volume || '1.0')}
          styleType={safeProject.style}
          language={safeProject.language}
          videoFormat={safeProject.video_format || 'landscape'}
          subtitleSettings={localProjectSettings}
          designSystem={designData}
          overlays={scriptData?.overlays || EMPTY_ARRAY}
          onFrameUpdate={handleFrameUpdate}
          isPipelineRunning={isRunning}
          fullscreenToggleRef={fullscreenToggleRef}
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
          activeSceneIdx={activeSceneIdx}
          activeSubIdx={activeSubIdx}
          localProjectSettings={localProjectSettings}
          projectId={id || ''}

          editingCard={editingCard}
          setEditingCard={setEditingCard}
          rewritePrompt={rewritePrompt}
          setRewritePrompt={setRewritePrompt}
          rewritingSection={rewritingSection}
          savingCardKey={savingCardKey}
          isSaving={savingCardKey !== null}
          onSaveCard={handleSaveCard}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onRewriteSection={handleRewriteSection}
          onRewriteSubVisual={handleRewriteSubVisual}
          onInsertScene={insertAndSaveNewScene}
          onSetSceneToDelete={setSceneToDelete}
          onSetScriptData={setScriptData}
          onSaveOverlays={handleSaveOverlays}
          onUploadSubVisual={handleUploadSubVisual}
          onPreviewSubVisual={handlePreviewSubVisual}
          uploadingSubVisual={uploadingSubVisual}

          tasks={tasks}
          queue={queue}
          isPipelineRunning={isRunning}
          targetStage={targetStage}
          activeTaskStep={activeTaskStep}
          scriptChangedAlert={scriptChangedAlert}
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

          onSeek={handleSeek}
        />
      </div>

      {/* Bottom Timeline */}
      <div style={{ gridArea: 'timeline' }} className="relative">
        <ResizeHandle direction="horizontal" target="timeline" side="top" />
        <Timeline
          liveScenes={liveScenes || EMPTY_ARRAY}
          sceneTimings={sceneTimings}
          overlays={scriptData?.overlays || EMPTY_ARRAY}
          transcriptionData={transcriptionData}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          onSeek={handleSeek}
          onDeleteScene={handleDeleteSceneTimeline}
          onResizeSubVisual={handleResizeSubVisual}
          onResizeScene={handleResizeScene}
          onTimingsDragUpdate={setActiveTimings}
          onToggleSubVisualAudioFlag={handleToggleSubVisualAudioFlag}
          onUpdateSubVisualTransition={handleUpdateSubVisualTransition}
          onSplitSubVisualAtFrame={handleSplitSubVisualAtFrame}
          onDuplicateSubVisual={handleDuplicateSubVisual}
          onDeleteSubVisual={handleDeleteSubVisual}
          onUpdateOverlay={handleUpdateOverlay}
          onToggleOverlayEnabled={handleToggleOverlayEnabled}
          onSelectOverlay={handleSelectOverlay}
          onOpenInspectorScript={handleOpenInspectorScript}
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
