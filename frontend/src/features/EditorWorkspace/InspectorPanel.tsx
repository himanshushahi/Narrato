import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscEdit, VscAccount, VscSettingsGear,
  VscExport, VscSymbolKeyword
} from 'react-icons/vsc';
import { ScrollableTabBar } from '../../components/ui/ScrollableTabBar';
import { useEditorStore, InspectorTab } from '../../store/useEditorStore';
import { ScriptTab } from './InspectorTabs/ScriptTab';
import { SubtitleTab } from './InspectorTabs/SubtitleTab';
import { VoiceTab } from './InspectorTabs/VoiceTab';
import { ExportTab } from './InspectorTabs/ExportTab';
import { SettingsTab } from './InspectorTabs/SettingsTab';
import { Task } from '../../store/useProjectStore';

interface InspectorPanelProps {
  scriptData: any;
  manifestData: any[];
  transcriptionData: any;
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  activeSceneIdx: number;
  activeSubIdx: number;
  localProjectSettings: any;
  projectId: string;

  // Script editing props
  editingCard: { key: string; mode: "script" | "visuals"; } | null;
  setEditingCard: (card: { key: string; mode: "script" | "visuals"; } | null) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  rewritingSection: string | null;
  savingCardKey: string | null;
  isSaving: boolean;
  onSaveCard: (cardKey?: string, index?: number) => void;
  onStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  onCancelEdit: () => void;
  onRewriteSection: (type: string, index: number) => void;
  onRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string) => Promise<void>;
  onInsertScene: (newScene: any, afterIdx: number) => void;
  onSetSceneToDelete: (idx: number | null) => void;
  onSetScriptData: (data: any) => void;
  onPreviewSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number) => void;
  previewingSubVisual?: string | null;
  onUploadSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number) => void;
  uploadingSubVisual?: string | null;

  // Pipeline props
  tasks: Record<string, Task>;
  queue: { active: string | null; queued: string[] };
  isPipelineRunning: boolean;
  targetStage: string;
  activeTaskStep: Task | null;
  scriptChangedAlert: boolean;
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
  onSaveTranscription: () => void;
  onResetTranscription: () => void;

  // Navigation
  onSeek: (frame: number) => void;
}

const tabMeta: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'script', label: 'Script', icon: <VscEdit /> },
  { id: 'subtitle', label: 'Subtitle', icon: <VscSymbolKeyword /> },
  { id: 'voice', label: 'Voice', icon: <VscAccount /> },
  { id: 'settings', label: 'Settings', icon: <VscSettingsGear /> },
  { id: 'export', label: 'Export', icon: <VscExport /> },
];

export const InspectorPanel: React.FC<InspectorPanelProps> = React.memo(({
  scriptData, manifestData, transcriptionData, sceneTimings,
  activeSceneIdx, activeSubIdx, localProjectSettings, projectId,
  editingCard, setEditingCard, rewritePrompt, setRewritePrompt, rewritingSection, savingCardKey, isSaving,
  onSaveCard, onStartEdit, onCancelEdit, onRewriteSection, onRewriteSubVisual, onInsertScene,
  onSetSceneToDelete, onSetScriptData,
  onPreviewSubVisual, previewingSubVisual,
  onUploadSubVisual, uploadingSubVisual,
  tasks, queue, isPipelineRunning, targetStage, activeTaskStep, scriptChangedAlert, hasScriptData,
  onSetTargetStage, onTriggerFullPipeline, onResumePipeline, onResumeFromStage, onCancelPipeline,
  isSavingSubtitles, onSettingsUpdate, onTranscriptionChange, onSaveTranscription, onResetTranscription,
  onSeek,
}) => {
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const inspectorTab = useEditorStore((s) => s.inspectorTab);
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);

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
            savingCardKey={savingCardKey}
            isSaving={isSaving}
            onSeek={onSeek}
            onSaveCard={onSaveCard}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onRewriteSection={onRewriteSection}
            onRewriteSubVisual={onRewriteSubVisual}
            onInsertScene={onInsertScene}
            onSetSceneToDelete={onSetSceneToDelete}
            onSetScriptData={onSetScriptData}
            onPreviewSubVisual={onPreviewSubVisual}
            previewingSubVisual={previewingSubVisual}
            onUploadSubVisual={onUploadSubVisual}
            uploadingSubVisual={uploadingSubVisual}
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
          />
        );
      case 'voice':
        return (
          <VoiceTab
            localProjectSettings={localProjectSettings}
            onSettingsUpdate={onSettingsUpdate}
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
            scriptChangedAlert={scriptChangedAlert}
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
