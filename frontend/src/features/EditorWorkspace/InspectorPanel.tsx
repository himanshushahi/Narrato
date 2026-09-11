import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscEdit, VscAccount, VscSettingsGear,
  VscExport, VscSymbolKeyword, VscLayers, VscFileMedia
} from 'react-icons/vsc';
import { ScrollableTabBar } from '../../components/ui/ScrollableTabBar';
import { useEditorStore, InspectorTab } from '../../store/useEditorStore';
import { ScriptTab } from './InspectorTabs/ScriptTab';
import { VisualsTab } from './InspectorTabs/VisualsTab';
import { SubtitleTab } from './InspectorTabs/SubtitleTab';
import { VoiceTab } from './InspectorTabs/VoiceTab';
import { OverlaysTab } from './InspectorTabs/OverlaysTab';
import { ExportTab } from './InspectorTabs/ExportTab';
import { SettingsTab } from './InspectorTabs/SettingsTab';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import { Task } from '../../store/useProjectStore';

interface InspectorPanelProps {
  scriptData: any;
  manifestData: any[];
  transcriptionData: any;
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  localProjectSettings: any;
  projectId: string;

  // Script editing props
  editingCard: { key: string; mode: "script" | "visuals"; } | null;
  setEditingCard: (card: { key: string; mode: "script" | "visuals"; } | null) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  rewritingSection: string | null;
  isAnyRewriting: boolean;
  isSectionRewriting: (cardKey: string) => boolean;
  isSubRewriting: (cardKey: string, subIdx: number) => boolean;
  isSectionLocked: (cardKey: string) => boolean;
  invalidateRewrites: (cardKey: string) => void;
  savingCardKey: string | null;
  isSaving: boolean;
  onSaveCard: (cardKey?: string, index?: number, latestData?: any) => void;
  onStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  onCancelEdit: () => void;
  onOpenVisuals: (sceneIdx: number, subIdx: number) => void;
  onRewriteSection: (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => Promise<any | undefined> | void;
  onRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => Promise<any | undefined>;
  onInsertScene: (newScene: any, afterIdx: number) => void;
  onSetSceneToDelete: (idx: number | null) => void;
  onSetScriptData: (data: any) => void;
  onSaveOverlays?: (overlays: any[]) => void;
  onUploadSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, visualType?: string, latestData?: any, layerIdx?: number) => Promise<string | undefined>;
  onPreviewSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, query: string, latestData?: any, layerIdx?: number) => Promise<string | undefined>;
  uploadingSubVisual?: string | null;
  onDeleteLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  onDuplicateLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  onMoveLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, fromIdx: number, toIdx: number) => void;
  onReorderLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, fromIdx: number, toIdx: number) => void;
  onDeleteCutSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number) => void;
  onRegisterFlush?: (flush: (() => any) | null) => void;
  onRegisterCanvasStyle?: (fn: ((layerIdx: number, style: Record<string, any>) => void) | null) => void;

  // Pipeline props
  tasks: Record<string, Task>;
  queue: { active: string | null; queued: string[] };
  isPipelineRunning: boolean;
  targetStage: string;
  activeTaskStep: Task | null;
  hasScriptData: boolean;
  onSetTargetStage: (stage: string) => void;
  onTriggerFullPipeline: () => void;
  onResumePipeline: () => void;
  onResumeFromStage: (stageId: string) => void;
  onCancelPipeline: () => void;

  // Subtitle props
  isSavingSubtitles: boolean;
  onSettingsUpdate: (settings: any) => void;
  onTranscriptionChange: (data: any) => void;
  onSaveTranscription: (doc?: any) => void;
  onResetTranscription: () => void;
  onRegisterSubtitleFlush?: (flush: (() => any) | null) => void;
  onRegisterOverlaysFlush?: (flush: (() => any) | null) => void;

  // Navigation
  onSeek: (frame: number) => void;
}

const tabMeta: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'script', label: 'Script', icon: <VscEdit /> },
  { id: 'visuals', label: 'Visuals', icon: <VscFileMedia /> },
  { id: 'overlays', label: 'Overlays', icon: <VscLayers /> },
  { id: 'subtitle', label: 'Subtitle', icon: <VscSymbolKeyword /> },
  { id: 'voice', label: 'Voice', icon: <VscAccount /> },
  { id: 'settings', label: 'Settings', icon: <VscSettingsGear /> },
  { id: 'export', label: 'Export', icon: <VscExport /> },
];

export const InspectorPanel: React.FC<InspectorPanelProps> = React.memo(({
  scriptData, manifestData, transcriptionData, sceneTimings,
  localProjectSettings, projectId,
  editingCard, setEditingCard, rewritePrompt, setRewritePrompt, rewritingSection, savingCardKey, isSaving,
  isAnyRewriting, isSectionRewriting, isSubRewriting, isSectionLocked, invalidateRewrites,
  onSaveCard, onStartEdit, onCancelEdit, onOpenVisuals, onRewriteSection, onRewriteSubVisual, onInsertScene,
  onSetSceneToDelete,   onSetScriptData, onSaveOverlays,
  onUploadSubVisual, onPreviewSubVisual, uploadingSubVisual,
  onDeleteLayerSubVisual, onDuplicateLayerSubVisual, onMoveLayerSubVisual, onReorderLayerSubVisual, onDeleteCutSubVisual, onRegisterFlush, onRegisterCanvasStyle,
  tasks, queue, isPipelineRunning, targetStage, activeTaskStep, hasScriptData,
  onSetTargetStage, onTriggerFullPipeline, onResumePipeline, onResumeFromStage, onCancelPipeline,
  isSavingSubtitles, onSettingsUpdate, onTranscriptionChange, onSaveTranscription, onResetTranscription,
  onRegisterSubtitleFlush,
  onRegisterOverlaysFlush,
  onSeek,
}) => {
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const inspectorTab = useEditorStore((s) => s.inspectorTab);
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);

  // Subscribe to active scene/sub index with equality check so InspectorPanel
  // only updates when scene/sub boundaries actually change.
  const [activeSceneIdx, activeSubIdx] = useStoreWithEqualityFn(
    usePlaybackStore,
    (s) => {
      const sceneIdx = sceneTimings.findIndex(t => s.currentFrame >= t.start && s.currentFrame < t.end);
      let subIdx = -1;
      if (sceneIdx !== -1) {
        const subs = sceneTimings[sceneIdx]?.subs;
        if (subs && subs.length > 0) {
          subIdx = subs.findIndex(x => s.currentFrame >= x.start && s.currentFrame < x.end);
        }
      }
      return [sceneIdx, subIdx] as const;
    },
    (a, b) => a[0] === b[0] && a[1] === b[1]
  );

  const renderTabContent = () => {
    switch (inspectorTab) {
      case 'script':
        return (
          <ScriptTab
            scriptData={scriptData}
            manifestData={manifestData}
            sceneTimings={sceneTimings}
            activeSceneIdx={activeSceneIdx}
            activeSubIdx={activeSubIdx}
            editingCard={editingCard}
            setEditingCard={setEditingCard}
            rewritePrompt={rewritePrompt}
            setRewritePrompt={setRewritePrompt}
            rewritingSection={rewritingSection}
            isAnyRewriting={isAnyRewriting}
            savingCardKey={savingCardKey}
            isSaving={isSaving}
            onSeek={onSeek}
            onSaveCard={onSaveCard}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onOpenVisuals={onOpenVisuals}
            onRewriteSection={onRewriteSection}
            onInsertScene={onInsertScene}
            onSetSceneToDelete={onSetSceneToDelete}
            onSetScriptData={onSetScriptData}
          />
        );
      case 'visuals':
        return (
          <VisualsTab
            scriptData={scriptData}
            manifestData={manifestData}
            sceneTimings={sceneTimings}
            activeSceneIdx={activeSceneIdx}
            activeSubIdx={activeSubIdx}
            editingCard={editingCard}
            savingCardKey={savingCardKey}
            rewritingSection={rewritingSection}
            isAnyRewriting={isAnyRewriting}
            isSectionRewriting={isSectionRewriting}
            isSubRewriting={isSubRewriting}
            isSectionLocked={isSectionLocked}
            invalidateRewrites={invalidateRewrites}
            rewritePrompt={rewritePrompt}
            setRewritePrompt={setRewritePrompt}
            onSeek={onSeek}
            onSaveCard={onSaveCard}
            onCancelEdit={onCancelEdit}
            onStartEdit={onStartEdit}
            onSetScriptData={onSetScriptData}
            onRewriteSection={onRewriteSection}
            onRewriteSubVisual={onRewriteSubVisual}
            onUploadSubVisual={onUploadSubVisual}
            onPreviewSubVisual={onPreviewSubVisual}
            uploadingSubVisual={uploadingSubVisual}
            onDeleteLayerSubVisual={onDeleteLayerSubVisual}
            onDuplicateLayerSubVisual={onDuplicateLayerSubVisual}
            onMoveLayerSubVisual={onMoveLayerSubVisual}
            onReorderLayerSubVisual={onReorderLayerSubVisual}
            onDeleteCutSubVisual={onDeleteCutSubVisual}
            onRegisterFlush={onRegisterFlush}
            onRegisterCanvasStyle={onRegisterCanvasStyle}
          />
        );
      case 'subtitle':
        return (
          <SubtitleTab
            transcriptionData={transcriptionData}
            localProjectSettings={localProjectSettings}
            isSavingSubtitles={isSavingSubtitles}
            onSettingsUpdate={onSettingsUpdate}
            onTranscriptionChange={onTranscriptionChange}
            onSaveTranscription={onSaveTranscription}
            onResetTranscription={onResetTranscription}
            onPlaySegment={onSeek}
            onSeek={onSeek}
            onRegisterFlush={onRegisterSubtitleFlush}
          />
        );
      case 'voice':
        return (
          <VoiceTab
            localProjectSettings={localProjectSettings}
            onSettingsUpdate={onSettingsUpdate}
          />
        );
      case 'overlays':
        return (
          <OverlaysTab
            scriptData={scriptData}
            projectId={projectId}
            onSetScriptData={onSetScriptData}
            onSaveOverlays={onSaveOverlays}
            onRegisterFlush={onRegisterOverlaysFlush}
          />
        );
      case 'export':
        return (
          <ExportTab
            tasks={tasks}
            queue={queue}
            isRunning={isPipelineRunning}
            targetStage={targetStage}
            activeTaskStep={activeTaskStep}
            projectId={projectId}
            hasScriptData={hasScriptData}
            onSetTargetStage={onSetTargetStage}
            onTriggerFullPipeline={onTriggerFullPipeline}
            onResumePipeline={onResumePipeline}
            onResumeFromStage={onResumeFromStage}
            onCancelPipeline={onCancelPipeline}
          />
        );
      case 'settings':
        return (
          <SettingsTab
            localProjectSettings={localProjectSettings}
            onSettingsUpdate={onSettingsUpdate}
          />
        );
    }
  };

  return (
    <div className="h-full bg-zinc-950/80 border-l border-zinc-800/60 flex flex-col overflow-x-hidden" style={{ width: rightPanelWidth }}>
      {/* Tab bar — scrollable with hover-reveal buttons */}
      <ScrollableTabBar
        tabs={tabMeta.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={inspectorTab}
        onChange={(id) => setInspectorTab(id as InspectorTab)}
      />

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={inspectorTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
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
InspectorPanel.displayName = 'InspectorPanel';
