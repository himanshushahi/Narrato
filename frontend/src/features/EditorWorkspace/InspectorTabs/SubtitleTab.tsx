import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VscSymbolKeyword, VscSave, VscLoading } from 'react-icons/vsc';
import { CustomToggle } from '../../../components/ui/CustomToggle';
import { SubtitleEditor } from '../../ProjectEditor/components/SubtitleEditor';

interface SubtitleTabProps {
  transcriptionData: any;
  localProjectSettings: any;
  isSavingSubtitles: boolean;
  onSettingsUpdate: (settings: any) => void;
  onTranscriptionChange: (data: any) => void;
  onSaveTranscription: (doc?: any) => void;
  onResetTranscription: () => void;
  onPlaySegment: (frame: number) => void;
  onSeek: (frame: number) => void;
  /** Registers a synchronous flush function so Ctrl+S and TopBar Save can
   *  flush debounced subtitle edits before persisting to disk. */
  onRegisterFlush?: (flush: (() => any) | null) => void;
}

/** Trailing-edge debounce so keystrokes stay local and the workspace
 *  (preview player, timeline, InspectorPanel) only re-renders ~2-3x/sec. */
const COMMIT_DEBOUNCE_MS = 400;

export const SubtitleTab: React.FC<SubtitleTabProps> = ({
  transcriptionData, isSavingSubtitles,
  onTranscriptionChange, onSaveTranscription, onResetTranscription, onPlaySegment,
  onRegisterFlush,
}) => {
  const [advancedMode, setAdvancedMode] = useState(false);

  // ── Local draft + debounced upstream commit ──────────────────────────
  // The editor writes to `draft` synchronously (instant UI, memoized rows
  // skip untouched segments). Only the trailing edge hits the top-level
  // store, so VideoPreview/Timeline don't re-render per keystroke.
  // NOTE: dirty/sync tracking is O(1) by design — no JSON.stringify per
  // render. A full-document stringify here on every keystroke (plus another
  // on every drag tick) was the advanced-mode lag source.
  const [draft, setDraft] = useState<any>(transcriptionData ?? { segments: [] });
  const [dirty, setDirty] = useState(false);
  // Bumped on every schedule/commit so the header (pending dot, disabled
  // states) re-renders — refs alone don't trigger it.
  const [, setCommitTick] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onTranscriptionChange);
  onChangeRef.current = onTranscriptionChange;

  // Sync external changes (initial load, Reset, post-save reload) without
  // clobbering in-flight typing. Our own commits push the exact draft
  // object upstream, so a store echo with the SAME reference is ignored.
  // A genuinely new object + no pending commit means external → adopt it.
  useEffect(() => {
    if (transcriptionData && transcriptionData !== draftRef.current) {
      if (!commitTimerRef.current) {
        draftRef.current = transcriptionData;
        setDraft(transcriptionData);
        dirtyRef.current = false;
        setDirty(false);
      }
    }
  }, [transcriptionData]);

  const commitDraft = useCallback((next: any) => {
    onChangeRef.current(next);
    setCommitTick(t => t + 1);
  }, []);

  const scheduleCommit = useCallback((next: any) => {
    draftRef.current = next;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      commitDraft(draftRef.current);
    }, COMMIT_DEBOUNCE_MS);
    setCommitTick(t => t + 1);
  }, [commitDraft]);

  /** Synchronously flush any pending debounced commit. Returns the doc. */
  const commitPending = useCallback((): any => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      commitDraft(draftRef.current);
    }
    return draftRef.current;
  }, [commitDraft]);

  // Flush on unmount / tab switch so no keystroke is ever lost.
  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      commitDraft(draftRef.current);
    }
  }, [commitDraft]);

  // Register synchronous flush with EditorWorkspace for Ctrl+S / TopBar Save.
  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(commitPending);
    return () => onRegisterFlush(null);
  }, [onRegisterFlush, commitPending]);

  const handleLocalChange = useCallback((next: any) => {
    setDraft(next);
    dirtyRef.current = true;
    setDirty(true);
    scheduleCommit(next);
  }, [scheduleCommit]);

  const hasPending = commitTimerRef.current !== null;

  const handleSave = useCallback(() => {
    const flushed = commitPending();
    dirtyRef.current = false;
    setDirty(false);
    setCommitTick(t => t + 1);
    onSaveTranscription(flushed);
  }, [commitPending, onSaveTranscription]);

  const handleReset = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setCommitTick(t => t + 1);
    onResetTranscription();
  }, [onResetTranscription]);

  const segmentCount = draft?.segments?.length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
      <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-zinc-800/40">
          <VscSymbolKeyword className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Subtitles
          </h3>
          {/* Dirty indicator */}
          {dirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              title="Unsaved changes"
            />
          )}
          <div className="ml-2">
            <CustomToggle
              label="ADVANCED"
              checked={advancedMode}
              onChange={(e) => setAdvancedMode(e.target.checked)}
            />
          </div>
          {segmentCount > 0 && (
            <span className="text-[8px] text-zinc-600 ml-auto">
              {segmentCount} seg{dirty ? ' •' : ''}
            </span>
          )}
          <div className={`flex gap-2 ${segmentCount === 0 ? 'ml-auto' : ''}`}>
            <button
              onClick={handleReset}
              disabled={isSavingSubtitles || (!dirty && !hasPending)}
              title={!dirty ? 'No unsaved changes' : 'Reset to last saved state'}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-600/20 hover:bg-zinc-600/30 text-zinc-400 border border-zinc-600/20 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={isSavingSubtitles || (!dirty && !hasPending)}
              title={!dirty ? 'No unsaved changes' : 'Save subtitles (Ctrl+S)'}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isSavingSubtitles ? <VscLoading className="animate-spin text-[10px]" /> : <VscSave className="text-[10px]" />}
              {isSavingSubtitles ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* SubtitleEditor with advanced mode state passed through */}
        <SubtitleEditor
          transcription={draft}
          onChange={handleLocalChange}
          onPlaySegment={onPlaySegment}
          onSave={handleSave}
          isSaving={isSavingSubtitles}
          embedded
          advancedMode={advancedMode}
        />

        {advancedMode && (
          <p className="text-[9px] text-zinc-500 px-4 pb-3 -mt-1">
            Edit individual words. Be careful with leading/trailing spaces.
          </p>
        )}
      </div>
    </div>
  );
};
