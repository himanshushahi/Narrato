import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscArrowLeft, VscSave, VscSettings, VscPulse, VscCheck, VscError, VscLoading, VscFlame, VscQuestion
} from 'react-icons/vsc';
import { useProjectStore } from '../../store/useProjectStore';

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
  /** Whole-document save locks while any AI rewrite is in flight. */
  isSaveLocked?: boolean;
  isPipelineRunning: boolean;
  pipelineStatusText?: string;
  hasScriptData?: boolean;
  onTriggerFullPipeline?: () => void;
}

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Ctrl+S', desc: 'Save' },
  { keys: 'Ctrl+Enter', desc: 'Run pipeline' },
  { keys: 'Ctrl+E', desc: 'Edit active scene visuals' },
  { keys: 'Ctrl+←/→', desc: 'Prev / Next sub-visual' },
  { keys: 'Ctrl+↑/↓', desc: 'Prev / Next scene' },
  { keys: 'F', desc: 'Toggle fullscreen' },
  { keys: 'Space', desc: 'Play / Pause' },
  { keys: 'Escape', desc: 'Cancel edit / Close modal' },
  { keys: '← / →', desc: 'Step frame backward / forward' },
  { keys: '↑ / ↓', desc: 'Prev / Next scene' },
  { keys: 'Delete / ⌫', desc: 'Delete scene' },
  { keys: 'Home', desc: 'Go to timeline start' },
  { keys: 'End', desc: 'Go to timeline end' },
];

export const TopBar: React.FC<TopBarProps> = ({
  onSave, isSaving, isSaveLocked, isPipelineRunning, pipelineStatusText,
  hasScriptData, onTriggerFullPipeline
}) => {
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const [showShortcuts, setShowShortcuts] = useState(false);

  React.useEffect(() => {
    if (!showShortcuts) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowShortcuts(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showShortcuts]);

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
          disabled={isSaving || isSaveLocked}
          title={isSaveLocked ? 'Save is paused while an AI rewrite is in progress' : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 hover:border-blue-600/40 text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? (
            <VscLoading className="animate-spin text-sm" />
          ) : (
            <VscSave className="text-sm" />
          )}
          Save
        </button>

        {/* Keyboard shortcuts */}
        <button
          onClick={() => setShowShortcuts(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Keyboard Shortcuts"
        >
          <VscQuestion className="text-lg" />
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

      {/* Shortcuts modal */}
      {createPortal(
        <AnimatePresence>
          {showShortcuts && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setShowShortcuts(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="bg-zinc-900 border border-zinc-800 rounded shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex sticky top-0 bg-zinc-900 items-center justify-between px-5 py-4 border-b border-zinc-800">
                  <h2 className="text-sm font-bold text-white tracking-tight">Keyboard Shortcuts</h2>
                  <button
                    onClick={() => setShowShortcuts(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <VscError className="text-base" />
                  </button>
                </div>
                <div className="p-5 space-y-1">
                  {SHORTCUTS.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-sm text-zinc-300">{s.desc}</span>
                      <kbd className="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-100 text-[11px] font-mono font-semibold border border-zinc-700/50 whitespace-nowrap">
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};
