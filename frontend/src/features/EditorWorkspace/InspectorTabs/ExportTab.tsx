import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  VscPlay, VscPulse, VscCheck, VscError, VscLoading, VscWarning, VscFlame
} from 'react-icons/vsc';
import { PIPELINE_STAGES } from '../../ProjectEditor/constants';
import { Task } from '../../../store/useProjectStore';

interface ExportTabProps {
  tasks: Record<string, Task>;
  queue: { active: string | null; queued: string[] };
  isRunning: boolean;
  targetStage: string;
  activeTaskStep: Task | null;
  projectId: string;
  scriptChangedAlert: boolean;
  hasScriptData: boolean;
  onSetTargetStage: (stage: string) => void;
  onTriggerFullPipeline: () => void;
  onResumePipeline: () => void;
  onResumeFromStage: (stageId: string) => void;
  onCancelPipeline: () => void;
}

export const ExportTab: React.FC<ExportTabProps> = ({
  tasks, isRunning, targetStage, activeTaskStep,
  scriptChangedAlert, hasScriptData,
  onSetTargetStage, onTriggerFullPipeline, onResumePipeline, onResumeFromStage, onCancelPipeline
}) => {
  const [confirmStageId, setConfirmStageId] = useState<string | null>(null);

  const renderStage = (stage: typeof PIPELINE_STAGES[0], idx: number) => {
    const task = tasks[stage.id];
    const isRunningStage = isRunning && (activeTaskStep?.step === stage.id || task?.status === 'running');
    const isCompleted = task?.status === 'completed';
    const isFailed = task?.status === 'failed' || (!isRunning && task?.status === 'running');
    const isLocked = !task || task.status === 'pending' || task.status === 'waiting';

    let progress = 0;
    if (isRunningStage) progress = activeTaskStep?.progress || task?.progress || 0;
    else if (isCompleted) progress = 100;

    const message = isRunningStage
      ? (activeTaskStep?.message || task?.message || 'Processing...')
      : isFailed ? (task?.error_message || 'Failed') : '';

    const canClick = !isRunning && (isCompleted || isFailed || isLocked);

    return (
      <div
        key={stage.id}
        title={canClick ? `Click to re-run from ${stage.title}` : ''}
        className={`relative pl-9 pr-2 pb-4 last:pb-1 flex flex-col transition-all duration-200
          ${canClick ? 'cursor-pointer hover:bg-zinc-800/30 rounded-lg' : ''}`}
        onClick={() => {
          if (canClick) {
            setConfirmStageId(stage.id === confirmStageId ? null : stage.id);
          }
        }}
      >
        {/* Connecting line */}
        {idx < PIPELINE_STAGES.length - 1 && (
          <div className={`absolute left-[13px] top-4.5 bottom-0 w-0.5 transition-colors ${isCompleted ? 'bg-emerald-500/30' : 'bg-zinc-800'}`} />
        )}

        {/* Status dot */}
        <div className="absolute left-1.5 top-0">
          {isCompleted ? (
            <div className="w-[18px] h-[18px] rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <VscCheck className="text-[9px]" />
            </div>
          ) : isRunningStage ? (
            <div className="w-[18px] h-[18px] rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center animate-pulse">
              <VscLoading className="text-[9px] animate-spin" />
            </div>
          ) : isFailed ? (
            <div className="w-[18px] h-[18px] rounded-full bg-red-500/15 text-red-400 border border-red-500/30 flex items-center justify-center">
              <VscError className="text-[9px]" />
            </div>
          ) : (
            <div className="w-[18px] h-[18px] rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700 flex items-center justify-center">
              <span className="text-[8px] font-bold font-mono">{idx + 1}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex items-center justify-between">
          <div>
            <span className={`text-[10px] font-bold transition-colors ${isRunningStage ? 'text-blue-400' : isCompleted ? 'text-zinc-300' : isFailed ? 'text-red-400' : 'text-zinc-500'
              }`}>
              {stage.title}
            </span>
            <span className="text-[8px] text-zinc-600 block">{stage.desc}</span>
          </div>
          <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${isCompleted ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
            isRunningStage ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse' :
              isFailed ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                'bg-zinc-900 text-zinc-600 border-zinc-800'
            }`}>
            {isCompleted ? 'Done' : isRunningStage ? `${progress.toFixed(0)}%` : isFailed ? 'Failed' : 'Waiting'}
          </span>
        </div>

        {/* Progress bar */}
        {isRunningStage && (
          <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden border border-zinc-800 mt-1.5">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}

        {/* Error message */}
        {message && isFailed && (
          <p className="text-[9px] text-red-400 mt-1 font-mono bg-red-950/20 px-2 py-1 rounded border border-red-500/10">
            {message}
          </p>
        )}

        {/* Inline confirmation dropdown */}
        {confirmStageId === stage.id && (
          <div
            className="absolute left-1/2 -translate-x-1/2 top-8 z-20 bg-zinc-800 border border-zinc-600 shadow-2xl shadow-black/50 rounded-lg p-3 w-48"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] text-zinc-300 font-medium mb-3 leading-relaxed">
              Run from <strong>{stage.title}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmStageId(null);
                }}
                className="flex-1 text-[9px] py-1.5 cursor-pointer font-bold bg-zinc-900 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded border border-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmStageId(null);
                  onResumeFromStage(stage.id);
                }}
                className="flex-1 flex items-center cursor-pointer justify-center gap-1 text-[9px] py-1.5 font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                <VscPlay className="text-[10px]" /> Run
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
        {/* Production Pipeline */}
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Production Pipeline</h3>
              <p className="text-[8px] text-zinc-600 mt-0.5">Automated video generation workflow</p>
            </div>
            {isRunning && (
              <span className="text-[8px] bg-blue-600/15 text-blue-400 px-2 py-0.5 rounded border border-blue-600/20 font-bold uppercase tracking-wider flex items-center gap-1 animate-pulse">
                <VscPulse className="animate-spin text-[9px]" /> Active
              </span>
            )}
          </div>

          {/* Stages */}
          <div className="space-y-1">
            {PIPELINE_STAGES.map((stage, idx) => renderStage(stage, idx))}
          </div>

          {/* Script changed alert */}
          {scriptChangedAlert && (
            <div className="bg-amber-600/10 border border-amber-600/25 p-2.5 rounded-lg text-[9px] text-amber-300 flex items-start gap-2 animate-pulse">
              <VscWarning className="text-xs shrink-0 mt-0.5" />
              <span><strong>Script changed!</strong> Resume pipeline to sync voiceover.</span>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/40">
            {/* Target stage selector */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">Run Until</label>
              <div className="flex gap-1 bg-zinc-900/60 p-1 rounded-lg border border-zinc-800">
                {PIPELINE_STAGES.map((stage) => {
                  const targetIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
                  const isSelected = PIPELINE_STAGES.indexOf(stage) <= targetIdx;
                  const shortNames: Record<string, string> = {
                    generate_script: 'Script', generate_voiceover: 'Voice',
                    transcribe: 'Sync', generate_visuals: 'Visuals', fetch_assets: 'Assets', render: 'Export'
                  };
                  return (
                    <button
                      key={stage.id}
                      onClick={() => onSetTargetStage(stage.id)}
                      className={`flex-1 text-[8px] py-1.5 px-0.5 font-bold uppercase tracking-wider rounded transition-all cursor-pointer ${isSelected ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                        }`}
                    >
                      {shortNames[stage.id] || stage.id}
                    </button>
                  );
                })}
              </div>
            </div>

            {isRunning ? (
              <button
                onClick={onCancelPipeline}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5 animate-pulse cursor-pointer"
              >
                <VscError className="text-sm" /> Cancel Pipeline
              </button>
            ) : (
              <>
                {!hasScriptData ? (
                  <button
                    onClick={onTriggerFullPipeline}
                    className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white py-2.5 rounded text-[10px] font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <VscFlame className="text-sm" /> Generate Video
                  </button>
                ) : (
                  <button
                    onClick={onResumePipeline}
                    className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white py-2.5 rounded text-[10px] font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <VscPlay className="text-sm" /> Resume Pipeline
                  </button>
                )}
                <p className="text-[8px] text-zinc-600 text-center leading-relaxed">
                  Smart Resume skips completed steps to save time and API usage.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
