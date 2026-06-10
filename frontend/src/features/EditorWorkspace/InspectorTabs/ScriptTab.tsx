import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscLoading, VscSave, VscEdit, VscTrash, VscAdd, VscSparkle } from 'react-icons/vsc';
import { CustomInput, CustomTextarea } from '../../../components/ui/CustomInput';
import { SubVisualsEditor } from '../../ProjectEditor/SubVisualsEditor';
import { SubVisualsView } from '../../ProjectEditor/SubVisualsView';

interface ScriptTabProps {
  scriptData: any;
  manifestData: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  currentFrame: number;
  activeSceneIdx: number;
  activeSubIdx: number;
  editingCard: string | null;
  setEditingCard: (key: string | null) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  savingCardKey: string | null;
  rewritingSection: string | null;
  isSaving: boolean;
  onSeek: (frame: number) => void;
  onSaveCard: (cardKey?: string, index?: number) => void;
  onStartEdit: (cardKey: string) => void;
  onCancelEdit: () => void;
  onRewriteSection: (type: string, index: number) => void;
  onInsertScene: (newScene: any, afterIdx: number) => void;
  onSetSceneToDelete: (idx: number | null) => void;
  onSetScriptData: (data: any) => void;
}

export const ScriptTab: React.FC<ScriptTabProps> = ({
  scriptData, sceneTimings, activeSceneIdx, activeSubIdx,
  editingCard, rewritePrompt, setRewritePrompt, savingCardKey, rewritingSection,
  onSeek, onSaveCard, onStartEdit, onCancelEdit, onRewriteSection, onInsertScene,
  onSetSceneToDelete, onSetScriptData
}) => {
  if (!scriptData) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
            <VscEdit className="text-xl text-zinc-600" />
          </div>
          <p className="text-sm text-zinc-500 font-medium">No script generated</p>
          <p className="text-[10px] text-zinc-600">Launch the pipeline from the Export tab to generate a script</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
      {/* Introduction */}
      {(() => {
        const introSceneIdx = 0;
        const introTimings = sceneTimings[introSceneIdx]?.subs;
        const isIntroActive = activeSceneIdx === introSceneIdx;
        const introActiveSubIdx = isIntroActive ? activeSubIdx : -1;
        const isEditing = editingCard === 'intro';

        return (
          <SceneCard
            label="Hook Introduction"
            isActive={isIntroActive}
            isEditing={isEditing}
            activeSubIdx={introActiveSubIdx}
            timings={introTimings}
            savingKey={savingCardKey === 'introduction'}
            onCardClick={() => { if (!isEditing && sceneTimings[introSceneIdx]) onSeek(sceneTimings[introSceneIdx].start); }}
            onEdit={() => onStartEdit('intro')}
            onSave={() => onSaveCard('introduction')}
            onCancel={onCancelEdit}
            disabled={savingCardKey !== null}
          >
            {isEditing ? (
              <div className="space-y-3">
                <CustomTextarea
                  rows={3}
                  placeholder="Write an engaging hook..."
                  value={scriptData.introduction?.hook || ''}
                  onChange={(e) => {
                    const copy = { ...scriptData };
                    copy.introduction = copy.introduction || {};
                    copy.introduction.hook = e.target.value;
                    onSetScriptData(copy);
                  }}
                />
                <SubVisualsEditor
                  subVisuals={scriptData.introduction?.sub_visuals || []}
                  onChange={(newSubs) => {
                    const copy = { ...scriptData };
                    copy.introduction = copy.introduction || {};
                    copy.introduction.sub_visuals = newSubs;
                    onSetScriptData(copy);
                  }}
                  timings={introTimings}
                  activeIdx={introActiveSubIdx}
                  onSeek={onSeek}
                />
                <AIRewriteSection
                  prompt={rewritePrompt}
                  onPromptChange={setRewritePrompt}
                  onRewrite={() => onRewriteSection('introduction', 0)}
                  isRewriting={rewritingSection === 'intro'}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-zinc-200 leading-relaxed">{scriptData.introduction?.hook || ''}</p>
                <SubVisualsView
                  subVisuals={scriptData.introduction?.sub_visuals || []}
                  timings={introTimings}
                  activeIdx={introActiveSubIdx}
                  onSeek={onSeek}
                />
              </div>
            )}
          </SceneCard>
        );
      })()}

      {/* Scenes */}
      {(scriptData.scenes || []).map((scene: any, idx: number) => {
        const cardKey = `scene_${idx}`;
        const isEditing = editingCard === cardKey;
        const globalSceneIdx = idx + (scriptData.introduction ? 1 : 0);
        const timings = sceneTimings[globalSceneIdx]?.subs;
        const isActive = activeSceneIdx === globalSceneIdx;
        const activeSubIdxForScene = isActive ? activeSubIdx : -1;

        return (
          <React.Fragment key={idx}>
            <SceneCard
              label={`Scene ${idx + 1}: ${scene.title}`}
              isActive={isActive}
              isEditing={isEditing}
              activeSubIdx={activeSubIdxForScene}
              timings={timings}
              savingKey={savingCardKey === cardKey}
              onCardClick={() => { if (!isEditing && sceneTimings[globalSceneIdx]) onSeek(sceneTimings[globalSceneIdx].start); }}
              onEdit={() => onStartEdit(cardKey)}
              onSave={() => onSaveCard(cardKey, idx)}
              onCancel={onCancelEdit}
              onDelete={() => onSetSceneToDelete(idx)}
              disabled={savingCardKey !== null}
            >
              {isEditing ? (
                <div className="space-y-3">
                  <CustomInput
                    label="Chapter Name"
                    type="text"
                    value={scene.title || ''}
                    onChange={(e) => {
                      const copy = { ...scriptData };
                      if (copy.scenes?.[idx]) copy.scenes[idx].title = e.target.value;
                      onSetScriptData(copy);
                    }}
                  />
                  <CustomTextarea
                    rows={3}
                    placeholder="Write the narration for this scene..."
                    value={scene.narration}
                    onChange={(e) => {
                      const copy = { ...scriptData };
                      if (copy.scenes?.[idx]) copy.scenes[idx].narration = e.target.value;
                      onSetScriptData(copy);
                    }}
                  />
                  <SubVisualsEditor
                    subVisuals={scene?.sub_visuals || []}
                    onChange={(newSubs) => {
                      const copy = { ...scriptData };
                      if (copy.scenes?.[idx]) copy.scenes[idx].sub_visuals = newSubs;
                      onSetScriptData(copy);
                    }}
                    timings={timings}
                    activeIdx={activeSubIdxForScene}
                    onSeek={onSeek}
                  />
                  <AIRewriteSection
                    prompt={rewritePrompt}
                    onPromptChange={setRewritePrompt}
                    onRewrite={() => onRewriteSection('scenes', idx)}
                    isRewriting={rewritingSection === `scene_${idx}`}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-200 leading-relaxed">{scene.narration}</p>
                  <SubVisualsView
                    subVisuals={scene.sub_visuals || []}
                    timings={timings}
                    activeIdx={activeSubIdxForScene}
                    onSeek={onSeek}
                  />
                </div>
              )}
            </SceneCard>

            {/* Insert button between scenes */}
            {!editingCard && (
              <button
                onClick={() => {
                  const blankScene = {
                    scene_number: idx + 2,
                    title: "New Scene",
                    narration: "",
                    sub_visuals: [{ visual_type: "scene", visual_cue: "", transition: "fade", visual_meta: {} }]
                  };
                  onInsertScene(blankScene, idx);
                }}
                className="w-full flex items-center justify-center gap-1 py-1 text-zinc-600 hover:text-blue-400 hover:bg-zinc-800/30 rounded-lg border border-dashed border-transparent hover:border-blue-600/30 text-[10px] transition-all"
              >
                <VscAdd className="text-sm" /> Insert Scene Here
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* Add Scene button */}
      {!editingCard && (
        <button
          onClick={() => {
            const lastIdx = (scriptData.scenes?.length || 1) - 1;
            const blankScene = {
              scene_number: lastIdx + 2,
              title: "New Scene",
              narration: "",
              sub_visuals: [{ visual_type: "scene", visual_cue: "", transition: "fade", visual_meta: {} }]
            };
            onInsertScene(blankScene, lastIdx);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-zinc-400 hover:text-blue-400 border border-dashed border-zinc-700 hover:border-blue-600/40 rounded-xl text-[10px] font-bold transition-all"
        >
          <VscAdd className="text-sm" /> Add Scene
        </button>
      )}

      {/* Conclusion */}
      {(() => {
        const concSceneIdx = (scriptData.introduction ? 1 : 0) + (scriptData.scenes?.length || 0);
        const concTimings = sceneTimings[concSceneIdx]?.subs;
        const isConcActive = activeSceneIdx === concSceneIdx;
        const concActiveSubIdx = isConcActive ? activeSubIdx : -1;
        const isEditing = editingCard === 'conclusion';

        return (
          <SceneCard
            label="Conclusion"
            isActive={isConcActive}
            isEditing={isEditing}
            activeSubIdx={concActiveSubIdx}
            timings={concTimings}
            savingKey={savingCardKey === 'conclusion'}
            onCardClick={() => { if (!isEditing && sceneTimings[concSceneIdx]) onSeek(sceneTimings[concSceneIdx].start); }}
            onEdit={() => onStartEdit('conclusion')}
            onSave={() => onSaveCard('conclusion')}
            onCancel={onCancelEdit}
            disabled={savingCardKey !== null}
          >
            {isEditing ? (
              <div className="space-y-3">
                <CustomTextarea
                  label="Summary Text"
                  rows={2}
                  value={scriptData.conclusion?.summary || ''}
                  onChange={(e) => {
                    const copy = { ...scriptData };
                    copy.conclusion = copy.conclusion || {};
                    copy.conclusion.summary = e.target.value;
                    onSetScriptData(copy);
                  }}
                />
                <CustomTextarea
                  label="Call To Action (CTA)"
                  rows={2}
                  value={scriptData.conclusion?.cta || ''}
                  onChange={(e) => {
                    const copy = { ...scriptData };
                    copy.conclusion = copy.conclusion || {};
                    copy.conclusion.cta = e.target.value;
                    onSetScriptData(copy);
                  }}
                />
                <SubVisualsEditor
                  subVisuals={scriptData.conclusion?.sub_visuals || []}
                  onChange={(newSubs) => {
                    const copy = { ...scriptData };
                    copy.conclusion = copy.conclusion || {};
                    copy.conclusion.sub_visuals = newSubs;
                    onSetScriptData(copy);
                  }}
                  timings={concTimings}
                  activeIdx={concActiveSubIdx}
                  onSeek={onSeek}
                />
                <AIRewriteSection
                  prompt={rewritePrompt}
                  onPromptChange={setRewritePrompt}
                  onRewrite={() => onRewriteSection('conclusion', 0)}
                  isRewriting={rewritingSection === 'conclusion'}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-zinc-200 leading-relaxed">{scriptData.conclusion?.summary || ''}</p>
                {scriptData.conclusion?.cta && (
                  <p className="text-xs text-blue-400 font-bold leading-relaxed">{scriptData.conclusion.cta}</p>
                )}
                <SubVisualsView
                  subVisuals={scriptData.conclusion?.sub_visuals || []}
                  timings={concTimings}
                  activeIdx={concActiveSubIdx}
                  onSeek={onSeek}
                />
              </div>
            )}
          </SceneCard>
        );
      })()}
    </div>
  );
};

/* ====== Sub-components ====== */

interface SceneCardProps {
  label: string;
  isActive: boolean;
  isEditing: boolean;
  activeSubIdx: number;
  timings: any[];
  savingKey: boolean;
  children: React.ReactNode;
  onCardClick: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}

const SceneCard: React.FC<SceneCardProps> = ({
  label, isActive, isEditing, children, savingKey,
  onCardClick, onEdit, onSave, onCancel, onDelete, disabled
}) => (
  <motion.div
    layout
    className={`p-4 rounded-xl border transition-all ${
      isEditing
        ? 'bg-zinc-900 border-blue-600/60 shadow-lg shadow-blue-900/10'
        : isActive
          ? 'bg-black/20 border-blue-500/30'
          : 'bg-black/10 border-zinc-800 hover:border-zinc-700'
    }`}
  >
    <div
      className={`flex justify-between items-center mb-3 ${!isEditing ? 'cursor-pointer hover:opacity-80' : ''}`}
      onClick={onCardClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
          {label}
        </span>
        {isActive && !isEditing && (
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        )}
      </div>
      <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
        {isEditing ? (
          <>
            <button
              onClick={onSave}
              disabled={disabled}
              className="flex items-center gap-1 bg-blue-600 disabled:opacity-50 text-white px-2.5 py-1 rounded text-[9px] font-bold"
            >
              {savingKey ? <><VscLoading className="animate-spin text-[9px]" /> Saving...</> : <><VscSave /> Save</>}
            </button>
            <button
              onClick={onCancel}
              disabled={disabled}
              className="text-[9px] disabled:opacity-50 text-zinc-400 hover:text-white px-2 py-1 rounded border border-zinc-800 bg-zinc-950/30"
            >
              Cancel
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="text-[9px] flex items-center gap-1 text-zinc-400 hover:text-white px-2 py-1 rounded border border-zinc-800 bg-zinc-950/30 transition-colors"
            >
              <VscEdit /> Edit
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-[9px] flex items-center justify-center text-zinc-500 hover:text-red-400 p-1.5 rounded border border-transparent hover:border-red-900/50 hover:bg-red-950/30 transition-colors"
              >
                <VscTrash />
              </button>
            )}
          </div>
        )}
      </div>
    </div>

    <AnimatePresence mode="wait">
      <motion.div
        key={isEditing ? 'edit' : 'view'}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  </motion.div>
);

interface AIRewriteSectionProps {
  prompt: string;
  onPromptChange: (p: string) => void;
  onRewrite: () => void;
  isRewriting?: boolean;
}

const AIRewriteSection: React.FC<AIRewriteSectionProps> = ({ prompt, onPromptChange, onRewrite, isRewriting }) => (
  <div className="border-t border-zinc-800/80 pt-3 mt-2">
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <CustomInput
          label="AI Prompt Rewrite"
          type="text"
          placeholder="e.g., make it more dramatic..."
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={isRewriting}
        />
      </div>
      <button
        onClick={onRewrite}
        disabled={isRewriting}
        className="bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-300 border border-zinc-700 px-3 py-2.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 shrink-0 h-[42px] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isRewriting ? <><VscLoading className="animate-spin" /> Rewriting...</> : <><VscSparkle /> AI Rewrite</>}
      </button>
    </div>
  </div>
);
