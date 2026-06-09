import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useProjectStore } from '../../store/useProjectStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useEditorData } from './hooks/useEditorData';
import { usePipeline } from './hooks/usePipeline';
import { useScriptEditing } from './hooks/useScriptEditing';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ResizeHandle } from './components/ResizeHandle';

import { TopBar } from './TopBar';
import { MediaSidebar } from './MediaSidebar';
import { VideoPreview } from './VideoPreview';
import { Timeline } from './Timeline';
import { InspectorPanel } from './InspectorPanel';

export const EditorWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const updateProject = useProjectStore((s) => s.updateProject);
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
        style: 'documentary',
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
  const setSelectedSceneIndex = useEditorStore((s) => s.setSelectedSceneIndex);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCommandPaletteOpen = useEditorStore((s) => s.setCommandPaletteOpen);

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
    setTargetStage, triggerFullPipeline,
    handleResumePipeline, cancelPipeline
  } = usePipeline(id, scriptData, manifestData, loadFiles);

  const {
    editingCard, setEditingCard, rewritePrompt, setRewritePrompt,
    savingCardKey, sceneToDelete, localProjectSettings, isSavingSubtitles,
    handleStartEdit, handleCancelEdit, handleSaveCard, handleRewriteSection,
    insertAndSaveNewScene, confirmDeleteScene, setSceneToDelete,
    handleSettingsUpdate, handleSaveTranscription
  } = useScriptEditing(
    id, scriptData, setScriptData, manifestData, setManifestData,
    transcriptionData, setTranscriptionData, loadFiles
  );

  // === Local state ===
  const [currentFrame, setCurrentFrame] = useState(0);
  const playerRef = useRef<any>(null);

  // === Computed values ===
  const activeSceneIdx = sceneTimings.findIndex(t => currentFrame >= t.start && currentFrame < t.end);
  const activeSubIdx = activeSceneIdx >= 0 && sceneTimings[activeSceneIdx].subs.length > 0
    ? sceneTimings[activeSceneIdx].subs.findIndex(t => currentFrame >= t.start && currentFrame < t.end)
    : -1;
  const hasScriptData = !!scriptData;
  const isLoading = !selectedProject || !projectReady;

  // === Handlers ===
  const handleSeek = useCallback((frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  }, []);

  const handleSave = useCallback(() => {
    if (editingCard) {
      const idx = editingCard.startsWith('scene_')
        ? parseInt(editingCard.replace('scene_', ''))
        : undefined;
      handleSaveCard(editingCard === 'intro' ? 'introduction' : editingCard, idx);
    } else {
      if (id && scriptData && selectedProject?.script_path) {
        handleSaveCard();
      }
    }
  }, [editingCard, handleSaveCard, id, scriptData, selectedProject]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handleAddScene = useCallback(() => {
    const lastIdx = (scriptData?.scenes?.length || 1) - 1;
    const blankScene = {
      scene_number: lastIdx + 2,
      title: "New Scene",
      narration: "",
      sub_visuals: [{ visual_type: "scene", visual_cue: "", transition: "fade", visual_meta: {} }]
    };
    insertAndSaveNewScene(blankScene, lastIdx);
  }, [scriptData, insertAndSaveNewScene]);

  const handleStyleChange = useCallback((style: string) => {
    if (id) {
      updateProject(id, { style });
    }
  }, [id, updateProject]);

  const handleVoiceChange = useCallback((engine: string, voice: string) => {
    if (id) {
      updateProject(id, { tts_engine: engine, tts_voice: voice });
    }
  }, [id, updateProject]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSave: handleSave,
    onPlayPause: handlePlayPause,
    onUndo: () => {},
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
  });

  // Delete scene modal handler
  useEffect(() => {
    if (sceneToDelete !== null) {
      confirmDeleteScene();
    }
  }, [sceneToDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  const audioUrl = selectedProject?.audio_path
    ? `/api/media?path=${encodeURIComponent(selectedProject.audio_path)}&t=${reloadKey}`
    : '';
  const bgMusicUrl = selectedProject?.bg_music_path
    ? `/api/media?path=${encodeURIComponent(selectedProject.bg_music_path)}&t=${reloadKey}`
    : '';

  // Safe defaults for when selectedProject is null
  const safeProject = selectedProject || {
    name: '',
    style: 'documentary' as const,
    language: 'en' as const,
    video_format: 'landscape' as const,
    bg_music_volume: 0.15,
    tts_engine: undefined,
    tts_voice: undefined,
  };

  return (
    <div
      className="h-screen w-screen bg-zinc-950 overflow-hidden relative"
      style={{
        display: 'grid',
        gridTemplateColumns: `${leftPanelWidth}px 1fr ${rightPanelWidth}px`,
        gridTemplateRows: `56px 1fr ${timelineHeight}px`,
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
      <div style={{ gridArea: 'sidebar' }} className="relative overflow-y-auto">
        <MediaSidebar
          scriptData={scriptData}
          sceneTimings={sceneTimings}
          onSeek={handleSeek}
          onAddScene={handleAddScene}
        />
        <ResizeHandle direction="vertical" target="leftPanel" side="right" />
      </div>

      {/* Center: Video Preview */}
      <div style={{ gridArea: 'main' }} className="relative">
        <VideoPreview
          playerRef={playerRef}
          liveScenes={liveScenes || []}
          transcriptionData={transcriptionData}
          currentFrame={currentFrame}
          audioUrl={audioUrl}
          bgMusicUrl={bgMusicUrl}
          bgMusicVolume={safeProject.bg_music_volume}
          styleType={safeProject.style}
          language={safeProject.language}
          videoFormat={safeProject.video_format || 'landscape'}
          subtitleSettings={localProjectSettings}
          onFrameUpdate={setCurrentFrame}
          isPipelineRunning={isRunning}
        />
      </div>

      {/* Inspector Panel */}
      <div style={{ gridArea: 'inspector' }} className="relative overflow-y-auto">
        <ResizeHandle direction="vertical" target="rightPanel" side="left" />
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
          savingCardKey={savingCardKey}
          isSaving={savingCardKey !== null}
          onSaveCard={handleSaveCard}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onRewriteSection={handleRewriteSection}
          onInsertScene={insertAndSaveNewScene}
          onSetSceneToDelete={setSceneToDelete}
          onSetScriptData={setScriptData}

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
          onCancelPipeline={cancelPipeline}

          isSavingSubtitles={isSavingSubtitles}
          onSettingsUpdate={handleSettingsUpdate}
          onTranscriptionChange={setTranscriptionData}
          onSaveTranscription={handleSaveTranscription}

          selectedStyle={safeProject.style}
          onStyleChange={handleStyleChange}
          ttsEngine={safeProject.tts_engine}
          ttsVoice={safeProject.tts_voice}
          onVoiceChange={handleVoiceChange}

          onSeek={handleSeek}
        />
      </div>

      {/* Bottom Timeline */}
      <div style={{ gridArea: 'timeline' }} className="relative">
        <ResizeHandle direction="horizontal" target="timeline" side="top" />
        <Timeline
          liveScenes={liveScenes || []}
          sceneTimings={sceneTimings}
          currentFrame={currentFrame}
          onSeek={handleSeek}
          onAddScene={handleAddScene}
          onDeleteScene={(idx) => {
            const globalIdx = (scriptData?.introduction ? 1 : 0) + idx;
            setSelectedSceneIndex(globalIdx);
            setSceneToDelete(idx);
          }}
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
