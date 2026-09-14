import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscArrowLeft, VscSave, VscSettings, VscPulse, VscCheck, VscError, VscLoading, VscFlame, VscQuestion, VscSearch
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

interface ShortcutItem {
  keys: string;
  desc: string;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Playback & Navigation',
    items: [
      { keys: 'Space', desc: 'Play / Pause preview' },
      { keys: '← / →', desc: 'Step 1 frame backward / forward' },
      { keys: '↑ / ↓', desc: 'Previous / Next scene' },
      { keys: 'Ctrl + ← / →', desc: 'Previous / Next cut (sub-visual)' },
      { keys: 'Home / End', desc: 'Jump to timeline start / end' },
      { keys: 'F', desc: 'Toggle preview fullscreen' },
    ],
  },
  {
    title: 'Timeline & Editing',
    items: [
      { keys: 'C', desc: 'Split cut at playhead' },
      { keys: 'Ctrl + E', desc: 'Edit active scene visuals' },
      { keys: 'Delete / ⌫', desc: 'Delete active scene' },
      { keys: 'Alt + Drag Boundary', desc: 'Absolute resize scene duration' },
    ],
  },
  {
    title: 'Canvas & Overlays',
    items: [
      { keys: '[ / ]', desc: 'Select previous / next layer' },
      { keys: 'Drag Corner', desc: 'Scale layer uniformly' },
      { keys: 'Alt + Drag Corner', desc: 'Freeform resize width & height' },
      { keys: 'Double-Click Layer', desc: 'Focus layer in Visuals editor' },
      { keys: 'Escape', desc: 'Deselect layer / Cancel active drag' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: 'Ctrl + S', desc: 'Save project' },
      { keys: 'Ctrl + Enter', desc: 'Run / Resume pipeline' },
      { keys: '?', desc: 'Toggle keyboard shortcuts' },
      { keys: 'Escape', desc: 'Close dialog / cancel edit' },
    ],
  },
];

export const TopBar: React.FC<TopBarProps> = ({
  onSave, isSaving, isSaveLocked, isPipelineRunning, pipelineStatusText,
  hasScriptData, onTriggerFullPipeline
}) => {
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
        setSearchQuery('');
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showShortcuts]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCategories = React.useMemo(() => {
    if (!normalizedQuery) return SHORTCUT_CATEGORIES;
    return SHORTCUT_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.desc.toLowerCase().includes(normalizedQuery) ||
          item.keys.toLowerCase().includes(normalizedQuery) ||
          cat.title.toLowerCase().includes(normalizedQuery)
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [normalizedQuery]);

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
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => {
                setShowShortcuts(false);
                setSearchQuery('');
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                      <VscQuestion className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white tracking-tight">Keyboard Shortcuts</h2>
                      <p className="text-[11px] text-zinc-400">Quick keys to navigate, edit, and manipulate canvas</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowShortcuts(false);
                      setSearchQuery('');
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="Close (Esc)"
                  >
                    <VscError className="text-base" />
                  </button>
                </div>

                {/* Search Filter */}
                <div className="px-5 pt-3 pb-2.5 border-b border-zinc-800/70 bg-zinc-950/40">
                  <div className="relative flex items-center">
                    <VscSearch className="absolute left-3 text-zinc-500 text-xs pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search shortcuts (e.g. split, layer, scale, scene)..."
                      className="w-full pl-8 pr-7 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 transition-colors"
                      autoFocus
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                        title="Clear search"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Scrollable list */}
                <div className="p-5 overflow-y-auto space-y-4 max-h-[calc(85vh-140px)]">
                  {filteredCategories.length === 0 ? (
                    <div className="py-8 text-center text-xs text-zinc-500">
                      No shortcuts matching &ldquo;{searchQuery}&rdquo;
                    </div>
                  ) : (
                    filteredCategories.map((cat) => (
                      <div key={cat.title} className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 py-1 flex items-center gap-2">
                          <span>{cat.title}</span>
                          <span className="h-px flex-1 bg-zinc-800/80" />
                        </div>
                        <div className="space-y-0.5">
                          {cat.items.map((s, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between py-1.5 px-2.5 rounded-lg hover:bg-zinc-800/40 transition-colors group"
                            >
                              <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition-colors">
                                {s.desc}
                              </span>
                              <kbd className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 text-[11px] font-mono font-medium border border-zinc-700/60 shadow-sm whitespace-nowrap">
                                {s.keys}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Footer hint */}
                <div className="px-5 py-2.5 bg-zinc-950/70 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">?</kbd> anywhere to open</span>
                  <span><kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">Esc</kbd> to close</span>
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
