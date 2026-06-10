import React from 'react';
import { Link } from 'react-router-dom';
import {
  VscArrowLeft, VscSave, VscSettings, VscPulse, VscCheck, VscError, VscLoading, VscExport, VscFlame
} from 'react-icons/vsc';
import { useProjectStore } from '../../store/useProjectStore';
import { useEditorStore } from '../../store/useEditorStore';

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  idle: {
    label: 'Idle', color: 'text-stone-400 border-stone-700 bg-stone-900/50',
    icon: <span className="w-2 h-2 rounded-full bg-stone-500" />
  },
  generating: {
    label: 'Generating', color: 'text-amber-400 border-amber-600/30 bg-amber-600/10',
    icon: <VscPulse className="animate-pulse text-amber-400" />
  },
  editing: {
    label: 'Editing', color: 'text-blue-400 border-blue-600/30 bg-blue-600/10',
    icon: <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
  },
  completed: {
    label: 'Completed', color: 'text-emerald-400 border-emerald-600/30 bg-emerald-600/10',
    icon: <VscCheck className="text-emerald-400" />
  },
  failed: {
    label: 'Failed', color: 'text-red-400 border-red-600/30 bg-red-600/10',
    icon: <VscError className="text-red-400" />
  },
};

interface TopBarProps {
  onSave: () => void;
  isSaving?: boolean;
  isPipelineRunning: boolean;
  pipelineStatusText?: string;
  hasScriptData?: boolean;
  onTriggerFullPipeline?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onSave, isSaving, isPipelineRunning, pipelineStatusText,
  hasScriptData, onTriggerFullPipeline
}) => {
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);

  const deriveStatus = () => {
    if (isPipelineRunning) return 'generating';
    if (selectedProject?.video_path) return 'completed';
    if (selectedProject?.script_path) return 'editing';
    return 'idle';
  };

  const status = deriveStatus();
  const config = statusConfig[status];
  const projectName = selectedProject?.name || 'Untitled Project';
  const projectId = selectedProject?.id || '';

  return (
    <div className="h-14 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/60 flex items-center justify-between px-4 select-none">
      {/* Left section */}
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Back to Library"
        >
          <VscArrowLeft className="text-lg" />
        </Link>

        <div className="w-px h-6 bg-zinc-800" />

        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-sm font-bold text-white font-sans tracking-tight leading-tight">
              {projectName}
            </h1>
            {projectId && (
              <p className="text-[9px] text-zinc-600 font-mono leading-tight">
                ID: {projectId.slice(0, 8)}...
              </p>
            )}
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${config.color}`}>
            {config.icon}
            {isPipelineRunning ? (pipelineStatusText || config.label) : config.label}
          </div>
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Pipeline quick actions (like old ProjectEditor header) */}
        {isPipelineRunning ? (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/10 text-amber-400 border border-amber-600/25 text-[11px] font-bold uppercase tracking-wider animate-pulse">
            <VscPulse className="animate-spin text-sm" /> Processing...
          </span>
        ) : (
          <>
            {!hasScriptData && onTriggerFullPipeline && (
              <button
                onClick={onTriggerFullPipeline}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800 text-white text-[11px] font-bold transition-all shadow-md cursor-pointer"
              >
                <VscFlame className="text-sm" /> Generate Video
              </button>
            )}
          </>
        )}

        {/* Save button */}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 hover:border-blue-600/40 text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? (
            <VscLoading className="animate-spin text-sm" />
          ) : (
            <VscSave className="text-sm" />
          )}
          Save
        </button>

        {/* Export button */}
        <button
          onClick={() => setInspectorTab('export')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/20 hover:border-emerald-600/40 text-[11px] font-bold transition-all cursor-pointer"
        >
          <VscExport className="text-sm" />
          Export
        </button>

        <div className="w-px h-6 bg-zinc-800" />

        {/* Settings */}
        <Link
          to="/settings"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Settings"
        >
          <VscSettings className="text-lg" />
        </Link>

      </div>
    </div>
  );
};
