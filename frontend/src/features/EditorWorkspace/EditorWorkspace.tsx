import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjectStore } from '../../store/useProjectStore';
import { useEditorStore } from '../../store/useEditorStore';
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

const EMPTY_ARRAY: any[] = [];

export const EditorWorkspace: React.FC = () => {
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
  // === Hooks ===
  const {
    scriptData, setScriptData,
    manifestData, setManifestData,
    transcriptionData, setTranscriptionData,
    liveScenes, sceneTimings, reloadKey,
    loadFiles
  } = useEditorData(id);

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
    previewAssets, previewingSubVisual, uploadingSubVisual, handlePreviewSubVisual, handleUploadSubVisual,
    handleStartEdit, handleCancelEdit, handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene, setSceneToDelete,
    handleSettingsUpdate, handleSaveTranscription
  } = useScriptEditing(
    id, scriptData, setScriptData, manifestData, setManifestData,
    transcriptionData, setTranscriptionData, loadFiles
  );

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
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);
  const prevScriptGenStatusRef = useRef(tasks['generate_script']?.status);
  
  useEffect(() => {
    const currentStatus = tasks['generate_script']?.status;
    if (prevScriptGenStatusRef.current === 'running' && currentStatus === 'completed') {
      setInspectorTab('script');
    }
    prevScriptGenStatusRef.current = currentStatus;
  }, [tasks, setInspectorTab]);

  // === Local state ===
  const [currentFrame, setCurrentFrame] = useState(0);
  const playerRef = useRef<any>(null);
  const fullscreenToggleRef = useRef<(() => void) | null>(null);

  // === Computed values ===
  const activeSceneIdx = sceneTimings.findIndex(t => currentFrame >= t.start && currentFrame < t.end);
  const activeSubIdx = activeSceneIdx >= 0 && sceneTimings[activeSceneIdx].subs.length > 0
    ? sceneTimings[activeSceneIdx].subs.findIndex(t => currentFrame >= t.start && currentFrame < t.end)
    : -1;
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
        return preview ? { ...sv, visual_url: preview.visual_url } : sv;
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
    if (!id || !scriptData || !manifestData) return;

    const sceneDuration = manifestData[sceneIndex]?.duration || 1;

    // 1. Update scriptData locally
    const scriptCopy = { ...scriptData };
    const hasIntro = scriptData.introduction ? 1 : 0;
    
    const updateSv = (sv: any, i: number) => ({
      ...sv, 
      duration_ratio: newRatios[i],
      duration: newRatios[i] * sceneDuration
    });

    if (sceneIndex === 0 && hasIntro) {
      scriptCopy.introduction = { ...scriptCopy.introduction };
      scriptCopy.introduction.sub_visuals = (scriptCopy.introduction.sub_visuals || []).map(updateSv);
    } else if (sceneIndex === (scriptData.scenes?.length || 0) + hasIntro && scriptData.conclusion) {
      scriptCopy.conclusion = { ...scriptCopy.conclusion };
      scriptCopy.conclusion.sub_visuals = (scriptCopy.conclusion.sub_visuals || []).map(updateSv);
    } else {
      const idx = sceneIndex - hasIntro;
      if (scriptCopy.scenes && scriptCopy.scenes[idx]) {
        scriptCopy.scenes[idx] = { ...scriptCopy.scenes[idx] };
        scriptCopy.scenes[idx].sub_visuals = (scriptCopy.scenes[idx].sub_visuals || []).map(updateSv);
      }
    }

    // 2. Update manifestData locally
    const manifestCopy = [...manifestData];
    if (manifestCopy[sceneIndex] && manifestCopy[sceneIndex].sub_visuals) {
      manifestCopy[sceneIndex].sub_visuals = manifestCopy[sceneIndex].sub_visuals.map(updateSv);
    }

    setScriptData(scriptCopy);
    setManifestData(manifestCopy);

    // 3. Persist to backend
    const result = await callApi<any>('save_project_with_cleanup', id, scriptCopy, manifestCopy);
    if (result?.success) {
      loadFiles(id);
    }
  }, [id, scriptData, manifestData, setScriptData, setManifestData, loadFiles]);

  // ── Refs for shortcut handlers that need latest state ──
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;
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
    name: '',
    style: 'standard' as const,
    language: 'en' as const,
    video_format: 'landscape' as const,
    bg_music_volume: 0.15,
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
          currentFrame={currentFrame}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          bgMusicVolume={safeProject.bg_music_volume}
          voiceoverVolume={parseFloat(localProjectSettings?.voiceover_volume || '1.0')}
          styleType={safeProject.style}
          language={safeProject.language}
          videoFormat={safeProject.video_format || 'landscape'}
          subtitleSettings={localProjectSettings}
          onFrameUpdate={setCurrentFrame}
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
          sceneTimings={sceneTimings}
          currentFrame={currentFrame}
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
          onPreviewSubVisual={handlePreviewSubVisual}
          previewingSubVisual={previewingSubVisual}
          onUploadSubVisual={handleUploadSubVisual}
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

          onSeek={handleSeek}
        />
      </div>

      {/* Bottom Timeline */}
      <div style={{ gridArea: 'timeline' }} className="relative">
        <ResizeHandle direction="horizontal" target="timeline" side="top" />
        <Timeline
          liveScenes={liveScenes || EMPTY_ARRAY}
          sceneTimings={sceneTimings}
          transcriptionData={transcriptionData}
          currentFrame={currentFrame}
          onSeek={handleSeek}
          onDeleteScene={handleDeleteSceneTimeline}
          onResizeSubVisual={handleResizeSubVisual}
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
