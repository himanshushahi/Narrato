import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscLoading, VscSave, VscEdit, VscTrash, VscAdd, VscSparkle,
  VscPlay, VscSymbolRuler, VscSymbolKeyword, VscEdit as VscEditIcon,
  VscLayers
} from 'react-icons/vsc';
import { CustomInput, CustomTextarea } from '../../../components/ui/CustomInput';
import { SubVisualsEditor } from '../../ProjectEditor/SubVisualsEditor';
import { SubVisualsView } from '../../ProjectEditor/SubVisualsView';
import { formatTime } from '../../ProjectEditor/constants';

interface ScriptTabProps {
  scriptData: any;
  manifestData: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  currentFrame: number;
  activeSceneIdx: number;
  activeSubIdx: number;
  editingCard: { key: string, mode: 'script' | 'visuals' } | null;
  setEditingCard: (card: { key: string, mode: 'script' | 'visuals' } | null) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  savingCardKey: string | null;
  rewritingSection: string | null;
  isSaving: boolean;
  onSeek: (frame: number) => void;
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
}

export const ScriptTab: React.FC<ScriptTabProps> = ({
  scriptData, sceneTimings, activeSceneIdx, activeSubIdx,
  editingCard, rewritePrompt, setRewritePrompt, savingCardKey, rewritingSection,
  onSeek, onSaveCard, onStartEdit, onCancelEdit, onRewriteSection, onRewriteSubVisual, onInsertScene,
  onSetSceneToDelete, onSetScriptData,
  onPreviewSubVisual, previewingSubVisual,
  onUploadSubVisual, uploadingSubVisual
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const card = containerRef.current.querySelector('[data-active-scene="true"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeSceneIdx]);

  if (!scriptData) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="w-14 h-14 mx-auto rounded-2xl bg-linear-to-br from-zinc-800/80 to-zinc-900/80 border border-zinc-700/50 flex items-center justify-center">
            <VscEditIcon className="text-2xl text-zinc-500" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-zinc-400 font-medium">No script generated</p>
            <p className="text-[10px] text-zinc-600 max-w-50 mx-auto leading-relaxed">
              Launch the pipeline from the Export tab to generate a script and start editing
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-1.5">
            <div className="h-1 w-8 rounded-full bg-zinc-800" />
            <div className="h-1 w-8 rounded-full bg-zinc-800" />
            <div className="h-1 w-8 rounded-full bg-blue-500/30" />
          </div>
        </motion.div>
      </div>
    );
  }

  const sceneCount = scriptData.scenes?.length || 0;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">

      {/* ════════════════ Introduction ════════════════ */}
      <SectionCard
        icon={<VscPlay className="text-[10px] text-zinc-500" />}
        title="Hook Introduction"
        count={sceneTimings[0] ? formatTime(sceneTimings[0].start) : undefined}
      >
        <SectionCardBody>
          {(() => {
            const introSceneIdx = 0;
            const introTimings = sceneTimings[introSceneIdx]?.subs;
            const isIntroActive = activeSceneIdx === introSceneIdx;
            const introActiveSubIdx = isIntroActive ? activeSubIdx : -1;
            const isEditing = editingCard?.key === 'intro';
            const editingMode = editingCard?.mode;

            return (
              <SceneCard
                label={isEditing ? 'Editing Introduction' : 'Hook Introduction'}
                isActive={isIntroActive}
                isEditing={isEditing}
                activeSubIdx={introActiveSubIdx}
                timings={introTimings}
                savingKey={savingCardKey === 'introduction'}
                editingMode={editingMode}
                onCardClick={() => { if (!isEditing && sceneTimings[introSceneIdx]) onSeek(sceneTimings[introSceneIdx].start); }}
                onEditScript={() => onStartEdit('intro', 'script')}
                onEditVisuals={() => onStartEdit('intro', 'visuals')}
                onSave={() => onSaveCard('introduction')}
                onCancel={onCancelEdit}
                disabled={savingCardKey !== null || rewritingSection !== null}
              >
                {isEditing ? (
                  <EditFormFields>
                    {editingMode === 'script' && (
                      <EditSection icon={<VscEditIcon className="text-[9px] text-zinc-500" />} title="Hook Text">
                        <InsetCard>
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
                        </InsetCard>
                      </EditSection>
                    )}

                    {/* Visual Cues section */}
                    {editingMode === 'visuals' && (
                      <EditSection icon={<VscLayers className="text-[9px] text-zinc-500" />} title="Visual Cues">
                        <div className="bg-zinc-900/40 rounded-lg border border-zinc-800/40">
                          <SubVisualsEditor
                            subVisuals={scriptData.introduction?.sub_visuals || []}
                            onChange={(newSubs) => {
                              const copy = { ...scriptData };
                              copy.introduction = copy.introduction || {};
                              copy.introduction.sub_visuals = newSubs;
                              onSetScriptData(copy);
                            }}
                            timings={introTimings}
                            totalDurationFrames={sceneTimings[0] ? sceneTimings[0].end - sceneTimings[0].start : 0}
                            activeIdx={introActiveSubIdx}
                            onSeek={onSeek}
                            onRewriteSubVisual={(subIdx, prompt) => onRewriteSubVisual(-1, 'introduction', subIdx, prompt)}
                            onPreviewSubVisual={onPreviewSubVisual ? (subIdx) => onPreviewSubVisual(-1, 'introduction', subIdx) : undefined}
                            previewingSubVisual={previewingSubVisual}
                            onUploadSubVisual={onUploadSubVisual ? (subIdx) => onUploadSubVisual(-1, 'introduction', subIdx) : undefined}
                            uploadingSubVisual={uploadingSubVisual}
                          />
                        </div>
                      </EditSection>
                    )}

                    <AIRewriteSection
                      prompt={rewritePrompt}
                      onPromptChange={setRewritePrompt}
                      onRewrite={() => onRewriteSection('introduction', 0)}
                      isRewriting={rewritingSection === 'intro'}
                    />
                  </EditFormFields>
                ) : (
                  <div className="space-y-2">
                    {scriptData.introduction?.hook ? (
                      <p className="text-xs text-zinc-200 leading-relaxed">{scriptData.introduction.hook}</p>
                    ) : (
                      <p className="text-xs text-zinc-600 italic">No hook written yet</p>
                    )}
                    {(scriptData.introduction?.sub_visuals?.length > 0) && (
                      <SubVisualsView
                        subVisuals={scriptData.introduction?.sub_visuals || []}
                        timings={introTimings}
                        activeIdx={introActiveSubIdx}
                        onSeek={onSeek}
                      />
                    )}
                  </div>
                )}
              </SceneCard>
            );
          })()}
        </SectionCardBody>
      </SectionCard>

      {/* ════════════════ Scenes ════════════════ */}
      <SectionCard
        icon={<VscSymbolRuler className="text-[10px] text-zinc-500" />}
        title="Scenes"
        count={sceneCount > 0 ? `${sceneCount} scene${sceneCount > 1 ? 's' : ''}` : undefined}
      >
        <SectionCardBody>
          {sceneCount > 0 ? (
            <div className="space-y-3">
              {(scriptData.scenes || []).map((scene: any, idx: number) => {
                const cardKey = `scene_${idx}`;
                const isEditing = editingCard?.key === cardKey;
                const editingMode = editingCard?.mode;
                const globalSceneIdx = idx + (scriptData.introduction ? 1 : 0);
                const timings = sceneTimings[globalSceneIdx]?.subs;
                const isActive = activeSceneIdx === globalSceneIdx;
                const activeSubIdxForScene = isActive ? activeSubIdx : -1;

                return (
                  <React.Fragment key={idx}>
                    <SceneCard
                      label={isEditing ? `Editing: Scene ${idx + 1}` : `Scene ${idx + 1}: ${scene.title || 'Untitled'}`}
                      isActive={isActive}
                      isEditing={isEditing}
                      activeSubIdx={activeSubIdxForScene}
                      timings={timings}
                      savingKey={savingCardKey === cardKey}
                      editingMode={editingMode}
                      onCardClick={() => { if (!isEditing && sceneTimings[globalSceneIdx]) onSeek(sceneTimings[globalSceneIdx].start); }}
                      onEditScript={() => onStartEdit(cardKey, 'script')}
                      onEditVisuals={() => onStartEdit(cardKey, 'visuals')}
                      onSave={() => onSaveCard(cardKey, idx)}
                      onCancel={onCancelEdit}
                      onDelete={() => onSetSceneToDelete(idx)}
                      disabled={savingCardKey !== null || rewritingSection !== null}
                    >
                      {isEditing ? (
                        <EditFormFields>
                          {editingMode === 'script' && (
                            <EditSection icon={<VscEditIcon className="text-[9px] text-zinc-500" />} title="Content">
                              <InsetCard>
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
                              </InsetCard>
                            </EditSection>
                          )}

                          {/* Visual Cues section */}
                          {editingMode === 'visuals' && (
                            <EditSection icon={<VscLayers className="text-[9px] text-zinc-500" />} title="Visual Cues">
                              <div className="bg-zinc-900/40 rounded-lg border border-zinc-800/40">
                                <SubVisualsEditor
                                  subVisuals={scene?.sub_visuals || []}
                                  onChange={(newSubs) => {
                                    const copy = { ...scriptData };
                                    if (copy.scenes?.[idx]) copy.scenes[idx].sub_visuals = newSubs;
                                    onSetScriptData(copy);
                                  }}
                                  timings={timings}
                                  totalDurationFrames={sceneTimings[globalSceneIdx] ? sceneTimings[globalSceneIdx].end - sceneTimings[globalSceneIdx].start : 0}
                                  activeIdx={activeSubIdxForScene}
                                  onSeek={onSeek}
                                  onRewriteSubVisual={(subIdx, prompt) => onRewriteSubVisual(idx, 'scenes', subIdx, prompt)}
                                  onPreviewSubVisual={onPreviewSubVisual ? (subIdx) => onPreviewSubVisual(idx, 'scenes', subIdx) : undefined}
                                  previewingSubVisual={previewingSubVisual}
                                  onUploadSubVisual={onUploadSubVisual ? (subIdx) => onUploadSubVisual(idx, 'scenes', subIdx) : undefined}
                                  uploadingSubVisual={uploadingSubVisual}
                                />
                              </div>
                            </EditSection>
                          )}

                          <AIRewriteSection
                            prompt={rewritePrompt}
                            onPromptChange={setRewritePrompt}
                            onRewrite={() => onRewriteSection('scenes', idx)}
                            isRewriting={rewritingSection === `scene_${idx}`}
                          />
                        </EditFormFields>
                      ) : (
                        <div className="space-y-2">
                          {scene.narration ? (
                            <p className="text-xs text-zinc-200 leading-relaxed">{scene.narration}</p>
                          ) : (
                            <p className="text-xs text-zinc-600 italic">No narration written yet</p>
                          )}
                          {(scene.sub_visuals?.length > 0) && (
                            <SubVisualsView
                              subVisuals={scene.sub_visuals || []}
                              timings={timings}
                              activeIdx={activeSubIdxForScene}
                              onSeek={onSeek}
                            />
                          )}
                        </div>
                      )}
                    </SceneCard>

                    {/* Insert button between scenes */}
                    {!editingCard && idx < sceneCount - 1 && (
                      <DividerInsertButton
                        onClick={() => {
                          const blankScene = {
                            scene_number: idx + 2,
                            title: "New Scene",
                            narration: "",
                            sub_visuals: [{ visual_type: "scene", visual_cue: "", transition: "fade", visual_meta: {} }]
                          };
                          onInsertScene(blankScene, idx);
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mb-2">
                <VscSymbolRuler className="text-lg text-zinc-600" />
              </div>
              <p className="text-[10px] text-zinc-500 mb-3">No scenes yet — add one to get started</p>
            </div>
          )}

          {/* Add Scene button */}
          {!editingCard && (
            <div className={sceneCount > 0 ? 'mt-3' : ''}>
              <button
                onClick={() => {
                  const lastIdx = sceneCount - 1;
                  const blankScene = {
                    scene_number: lastIdx + 2,
                    title: "New Scene",
                    narration: "",
                    sub_visuals: [{ visual_type: "scene", visual_cue: "", transition: "fade", visual_meta: {} }]
                  };
                  onInsertScene(blankScene, Math.max(0, lastIdx));
                }}
                className="w-full flex items-center justify-center gap-2.5 py-3 text-[10px] font-bold text-zinc-400 hover:text-blue-400 bg-zinc-800/30 hover:bg-blue-600/[0.07] rounded-xl border border-dashed border-zinc-700/60 hover:border-blue-600/30 transition-all cursor-pointer group"
              >
                <div className="w-5 h-5 rounded-full bg-zinc-800/60 group-hover:bg-blue-600/20 flex items-center justify-center border border-zinc-700 group-hover:border-blue-600/30 transition-all">
                  <VscAdd className="text-[9px]" />
                </div>
                Add Scene
              </button>
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* ════════════════ Conclusion ════════════════ */}
      <SectionCard
        icon={<VscSymbolKeyword className="text-[10px] text-zinc-500" />}
        title="Conclusion"
      >
        <SectionCardBody>
          {(() => {
            const concSceneIdx = (scriptData.introduction ? 1 : 0) + sceneCount;
            const concTimings = sceneTimings[concSceneIdx]?.subs;
            const isConcActive = activeSceneIdx === concSceneIdx;
            const concActiveSubIdx = isConcActive ? activeSubIdx : -1;
            const isEditing = editingCard?.key === 'conclusion';
            const editingMode = editingCard?.mode;

            return (
              <SceneCard
                label={isEditing ? 'Editing Conclusion' : 'Conclusion'}
                isActive={isConcActive}
                isEditing={isEditing}
                activeSubIdx={concActiveSubIdx}
                timings={concTimings}
                savingKey={savingCardKey === 'conclusion'}
                editingMode={editingMode}
                onCardClick={() => { if (!isEditing && sceneTimings[concSceneIdx]) onSeek(sceneTimings[concSceneIdx].start); }}
                onEditScript={() => onStartEdit('conclusion', 'script')}
                onEditVisuals={() => onStartEdit('conclusion', 'visuals')}
                onSave={() => onSaveCard('conclusion')}
                onCancel={onCancelEdit}
                disabled={savingCardKey !== null || rewritingSection !== null}
              >
                {isEditing ? (
                  <EditFormFields>
                    {editingMode === 'script' && (
                      <EditSection icon={<VscEditIcon className="text-[9px] text-zinc-500" />} title="Content">
                        <InsetCard>
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
                        </InsetCard>
                      </EditSection>
                    )}

                    {/* Visual Cues section */}
                    {editingMode === 'visuals' && (
                      <EditSection icon={<VscLayers className="text-[9px] text-zinc-500" />} title="Visual Cues">
                        <div className="bg-zinc-900/40 rounded-lg border border-zinc-800/40">
                          <SubVisualsEditor
                            subVisuals={scriptData.conclusion?.sub_visuals || []}
                            onChange={(newSubs) => {
                              const copy = { ...scriptData };
                              copy.conclusion = copy.conclusion || {};
                              copy.conclusion.sub_visuals = newSubs;
                              onSetScriptData(copy);
                            }}
                            timings={concTimings}
                            totalDurationFrames={sceneTimings[concSceneIdx] ? sceneTimings[concSceneIdx].end - sceneTimings[concSceneIdx].start : 0}
                            activeIdx={concActiveSubIdx}
                            onSeek={onSeek}
                            onRewriteSubVisual={(subIdx, prompt) => onRewriteSubVisual(-1, 'conclusion', subIdx, prompt)}
                            onPreviewSubVisual={onPreviewSubVisual ? (subIdx) => onPreviewSubVisual(-1, 'conclusion', subIdx) : undefined}
                            previewingSubVisual={previewingSubVisual}
                            onUploadSubVisual={onUploadSubVisual ? (subIdx) => onUploadSubVisual(-1, 'conclusion', subIdx) : undefined}
                            uploadingSubVisual={uploadingSubVisual}
                          />
                        </div>
                      </EditSection>
                    )}

                    <AIRewriteSection
                      prompt={rewritePrompt}
                      onPromptChange={setRewritePrompt}
                      onRewrite={() => onRewriteSection('conclusion', 0)}
                      isRewriting={rewritingSection === 'conclusion'}
                    />
                  </EditFormFields>
                ) : (
                  <div className="space-y-2">
                    {scriptData.conclusion?.summary ? (
                      <p className="text-xs text-zinc-200 leading-relaxed">{scriptData.conclusion.summary}</p>
                    ) : (
                      <p className="text-xs text-zinc-600 italic">No summary written yet</p>
                    )}
                    {scriptData.conclusion?.cta && (
                      <div className="flex items-center gap-1.5 text-xs text-blue-400 font-bold leading-relaxed">
                        <span className="w-1 h-1 rounded-full bg-blue-500 shrink-0" />
                        {scriptData.conclusion.cta}
                      </div>
                    )}
                    {(scriptData.conclusion?.sub_visuals?.length > 0) && (
                      <SubVisualsView
                        subVisuals={scriptData.conclusion?.sub_visuals || []}
                        timings={concTimings}
                        activeIdx={concActiveSubIdx}
                        onSeek={onSeek}
                      />
                    )}
                  </div>
                )}
              </SceneCard>
            );
          })()}
        </SectionCardBody>
      </SectionCard>

    </div>
  );
};

/* ══════════════════════════════════════════
   Section Card
   ══════════════════════════════════════════ */

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  count?: string;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ icon, title, count, children }) => (
  <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 overflow-hidden">
    <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-zinc-800/40">
      {icon}
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
        {title}
      </h3>
      {count && (
        <span className="text-[8px] text-zinc-600 ml-auto">{count}</span>
      )}
    </div>
    {children}
  </div>
);

const SectionCardBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-4">
    {children}
  </div>
);

/* ══════════════════════════════════════════
   Scene Card
   ══════════════════════════════════════════ */

interface SceneCardProps {
  label: string;
  isActive: boolean;
  isEditing: boolean;
  editingMode?: 'script' | 'visuals';
  activeSubIdx: number;
  timings: any[];
  savingKey: boolean;
  children: React.ReactNode;
  onCardClick: () => void;
  onEditScript: () => void;
  onEditVisuals: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}

const SceneCard: React.FC<SceneCardProps> = ({
  label, isActive, isEditing, children, savingKey,
  onCardClick, onEditScript, onEditVisuals, onSave, onCancel, onDelete, disabled
}) => (
  <motion.div
    layout
    data-active-scene={isActive ? 'true' : undefined}
    className={`relative rounded-xl border overflow-hidden transition-all ${
      isEditing
        ? 'bg-zinc-800/80 border-blue-600/60 shadow-lg shadow-blue-900/10'
        : isActive
          ? 'bg-blue-600/4 border-blue-500/30'
          : 'bg-zinc-800/40 border-zinc-700/50 hover:border-zinc-600'
    }`}
  >
    {/* Active indicator bar */}
    {isActive && !isEditing && (
      <div className="absolute left-0 top-0 bottom-0 w-0.75 bg-linear-to-b from-blue-500 to-blue-400 rounded-r-full" />
    )}

    {/* Header bar */}
    <div
      className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
        !isEditing ? 'cursor-pointer hover:bg-white/2' : ''
      } ${
        isEditing
          ? 'border-b border-blue-600/30 bg-blue-600/10'
          : isActive
            ? 'border-b border-blue-500/15'
            : 'border-b border-zinc-800/40'
      }`}
      onClick={onCardClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isActive && !isEditing && (
          <span className="flex h-2 w-2 shrink-0">
            <span className="inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        )}
        <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${
          isEditing
            ? 'text-blue-300'
            : isActive
              ? 'text-blue-400'
              : 'text-zinc-400'
        }`}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
        {isEditing ? (
          <>
            <button
              onClick={onSave}
              disabled={disabled}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer"
            >
              {savingKey ? <><VscLoading className="animate-spin text-[9px]" /> Saving...</> : <><VscSave className="text-[9px]" /> Save</>}
            </button>
            <button
              onClick={onCancel}
              disabled={disabled}
              className="text-[9px] disabled:opacity-50 disabled:cursor-not-allowed text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg border border-zinc-700/60 bg-zinc-900/50 hover:bg-zinc-800 transition-all cursor-pointer"
            >
              Cancel
            </button>
          </>
        ) : (
          <div className="flex items-center gap-0.5">
            <div className="flex bg-zinc-900/50 rounded-lg border border-zinc-800/60 overflow-hidden">
              <button
                onClick={onEditScript}
                disabled={disabled}
                className="text-[9px] flex items-center gap-1 text-zinc-400 hover:text-white px-2 py-1 hover:bg-zinc-800 transition-colors cursor-pointer border-r border-zinc-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <VscEdit className="text-[9px]" /> Script
              </button>
              <button
                onClick={onEditVisuals}
                disabled={disabled}
                className="text-[9px] flex items-center gap-1 text-zinc-400 hover:text-white px-2 py-1 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <VscLayers className="text-[9px]" /> Visuals
              </button>
            </div>
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-[9px] flex items-center justify-center text-zinc-500 hover:text-red-400 p-1.5 rounded-lg border border-transparent hover:border-red-900/50 hover:bg-red-950/30 transition-colors cursor-pointer"
              >
                <VscTrash />
              </button>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Content */}
    <div className={isEditing ? 'px-4 py-3' : 'px-4 py-3'}>
      <AnimatePresence mode="wait">
        <motion.div
          key={isEditing ? 'edit' : 'view'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  </motion.div>
);

/* ══════════════════════════════════════════
   Edit Form Fields — organized layout
   ══════════════════════════════════════════ */

const EditFormFields: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="space-y-4">
    {children}
  </div>
);

interface EditSectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

const EditSection: React.FC<EditSectionProps> = ({ icon, title, children }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        {title}
      </span>
    </div>
    {children}
  </div>
);

const InsetCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-zinc-900/40 rounded-lg border border-zinc-800/40 p-3 space-y-3">
    {children}
  </div>
);

/* ══════════════════════════════════════════
   Divider Insert Button
   ══════════════════════════════════════════ */

interface DividerInsertButtonProps {
  onClick: () => void;
}

const DividerInsertButton: React.FC<DividerInsertButtonProps> = ({ onClick }) => (
  <div className="relative flex items-center py-1">
    <div className="flex-1 border-t border-dashed border-zinc-800" />
    <button
      onClick={onClick}
      className="mx-2 shrink-0 flex items-center gap-1 px-3 py-1 text-[9px] font-bold text-zinc-500 hover:text-blue-400 hover:bg-blue-600/10 rounded-full border border-zinc-800/60 hover:border-blue-600/30 bg-zinc-900/60 backdrop-blur-sm transition-all cursor-pointer group"
    >
      <VscAdd className="text-[9px] group-hover:scale-110 transition-transform" />
      Insert Scene
    </button>
    <div className="flex-1 border-t border-dashed border-zinc-800" />
  </div>
);

/* ══════════════════════════════════════════
   AI Rewrite Section
   ══════════════════════════════════════════ */

interface AIRewriteSectionProps {
  prompt: string;
  onPromptChange: (p: string) => void;
  onRewrite: () => void;
  isRewriting?: boolean;
}

const AIRewriteSection: React.FC<AIRewriteSectionProps> = ({ prompt, onPromptChange, onRewrite, isRewriting }) => (
  <div className="border-t border-zinc-700/30 pt-3">
    <div className="flex items-center gap-1.5 mb-2">
      <VscSparkle className="text-[9px] text-zinc-500" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        AI Rewrite
      </span>
    </div>
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <input
          type="text"
          placeholder="e.g., make it more dramatic..."
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          disabled={isRewriting}
          className="w-full bg-zinc-900/80 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50"
        />
      </div>
      <button
        onClick={onRewrite}
        disabled={isRewriting || !prompt.trim()}
        className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800/80 hover:bg-blue-600/20 hover:text-blue-400 text-zinc-300 border border-zinc-700/60 hover:border-blue-600/30 rounded-lg text-[10px] font-bold transition-all shrink-0 h-9 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isRewriting ? (
          <><VscLoading className="animate-spin text-[10px]" /> Rewriting...</>
        ) : (
          <><VscSparkle className="text-[10px]" /> Rewrite</>
        )}
      </button>
    </div>
  </div>
);
