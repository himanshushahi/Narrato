import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  VscLayers, VscAdd, VscTrash, VscSave, VscLoading,
  VscChevronLeft, VscChevronRight, VscSparkle,
} from 'react-icons/vsc';
import { CustomInput } from '../../../components/ui/CustomInput';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { SubVisualsEditor } from '../../ProjectEditor/SubVisualsEditor';
import { formatTime } from '../../ProjectEditor/constants';
import { resolveVisualSelection, type ResolvedVisual } from '../visualSelection';

/** Read the edited section's sub-visuals array out of a script document. */
function readSectionSubs(doc: any, r: ResolvedVisual): any[] {
  if (!doc) return [];
  if (r.sectionType === 'introduction') return doc.introduction?.sub_visuals || [];
  if (r.sectionType === 'conclusion') return doc.conclusion?.sub_visuals || [];
  return doc.scenes?.[r.sceneNumber]?.sub_visuals || [];
}

/** Immutably replace the edited section's sub-visuals array in a document. */
function writeSectionSubs(doc: any, r: ResolvedVisual, fullSubs: any[]): any {
  const copy = { ...doc };
  if (r.sectionType === 'introduction') {
    copy.introduction = { ...copy.introduction, sub_visuals: fullSubs };
  } else if (r.sectionType === 'conclusion') {
    copy.conclusion = { ...copy.conclusion, sub_visuals: fullSubs };
  } else {
    copy.scenes = [...(copy.scenes || [])];
    if (copy.scenes[r.sceneNumber]) {
      copy.scenes[r.sceneNumber] = { ...copy.scenes[r.sceneNumber], sub_visuals: fullSubs };
    }
  }
  return copy;
}

/** JSON with a null fallback — identity snapshots for rewrite relocation. */
const safeJson = (v: any): string | null => {
  try { return JSON.stringify(v); } catch { return null; }
};

/** Trailing-edge delay for high-frequency visual edits (color drags, scrubs). */
const COMMIT_DEBOUNCE_MS = 150;

interface VisualsTabProps {
  scriptData: any;
  manifestData: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  activeSceneIdx: number;
  activeSubIdx: number;
  editingCard: { key: string; mode: 'script' | 'visuals' } | null;
  savingCardKey: string | null;
  rewritingSection: string | null;
  /** True while ANY AI rewrite is in flight (global Save + rewrite exclusivity). */
  isAnyRewriting: boolean;
  isSectionRewriting: (cardKey: string) => boolean;
  isSubRewriting: (cardKey: string, subIdx: number) => boolean;
  isSectionLocked: (cardKey: string) => boolean;
  /** Poison this card's in-flight rewrites (Revert path). */
  invalidateRewrites: (cardKey: string) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  onSeek: (frame: number) => void;
  onSaveCard: (cardKey?: string, index?: number, latestData?: any) => void;
  onCancelEdit: () => void;
  onStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  onSetScriptData: (data: any) => void;
  /** Registers this tab's pending-edit flusher (for Ctrl+S / TopBar saves). */
  onRegisterFlush?: (flush: (() => any) | null) => void;
  onRewriteSection: (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => Promise<any | undefined> | void;
  onRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => Promise<any | undefined>;
  onUploadSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, visualType?: string, latestData?: any, layerIdx?: number) => Promise<string | undefined>;
  onPreviewSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, query: string, latestData?: any, layerIdx?: number) => Promise<string | undefined>;
  uploadingSubVisual?: string | null;
  onDeleteLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  onDuplicateLayerSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  onDeleteCutSubVisual?: (sceneIdx: number, sectionType: string, subIdx: number) => void;
}

/**
 * Dedicated single-cut visual editor (normal-video-editor properties panel).
 * Selection (timeline cut click, asset click, script card button) drives the
 * content; edits flow through the same scriptData + save pipeline the old
 * inline visuals mode used, so no backend changes were needed.
 */
export const VisualsTab = React.memo(function VisualsTab({
  scriptData, manifestData, sceneTimings, activeSceneIdx, activeSubIdx,
  editingCard, savingCardKey, rewritingSection, rewritePrompt, setRewritePrompt,
  isAnyRewriting, isSectionRewriting, isSubRewriting, isSectionLocked, invalidateRewrites,
  onSeek, onSaveCard, onCancelEdit, onStartEdit, onSetScriptData,
  onRewriteSection, onRewriteSubVisual, onUploadSubVisual, onPreviewSubVisual, uploadingSubVisual,
  onDeleteLayerSubVisual, onDuplicateLayerSubVisual, onDeleteCutSubVisual,
  onRegisterFlush,
}: VisualsTabProps) {
  // Session cancel stays parent-owned (InspectorPanel/EditorWorkspace); Revert
  // restores the section baseline and stays in-tab, so this is intentionally
  // unused here beyond API stability.
  void onCancelEdit;
  const { addToast } = useUIStore();
  const selectedSceneIndex = useEditorStore((s) => s.selectedSceneIndex);
  const selectedSubVisualIndex = useEditorStore((s) => s.selectedSubVisualIndex);
  const setSelectedSubVisualIndex = useEditorStore((s) => s.setSelectedSubVisualIndex);

  const sel = selectedSceneIndex !== null && selectedSubVisualIndex !== null
    ? { sceneIdx: selectedSceneIndex, subIdx: selectedSubVisualIndex }
    : null;

  const resolved = useMemo(
    () => resolveVisualSelection(scriptData, manifestData, sceneTimings, sel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scriptData, manifestData, sceneTimings, selectedSceneIndex, selectedSubVisualIndex],
  );

  // Begin (or resume after save/cancel) a visuals edit session for the
  // selected section so save-diffing and AI regeneration work unchanged.
  // Only auto-start when no edit session exists — never hijack an in-progress
  // 'script' session (ScriptTab dirty state would be abandoned with no prompt).
  // Flush pending ticks of the previous section before switching cards.
  const onStartEditRef = useRef(onStartEdit);
  const scriptDataRef = useRef(scriptData);
  const onSetScriptDataRef = useRef(onSetScriptData);
  const resolvedRef = useRef(resolved);
  const pendingFullRef = useRef<any[] | null>(null);
  /** Section the pending array belongs to — captured at schedule time so a
   * cross-section cut switch during the debounce window can't write Scene A's
   * array into Scene B. Also stores the scenes-array length so a structural
   * insert/delete (scene shift) aborts the stale commit instead of writing
   * Scene A's cuts into shifted Scene B. */
  const pendingResolvedRef = useRef<(ResolvedVisual & { scenesLength: number }) | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Signature of the last array this tab wrote to the store per card — distinguishes
   * our own store echo from genuinely external changes (AI rewrite, timeline
   * resize, Script-tab edits) for baseline maintenance without cross-card clobbering. */
  const lastWrittenJsonByCardRef = useRef<Record<string, string>>({});
  /** Selection sub-index mirror (ref, not render closure) so lens writes use
   * the fresh section AND fresh cut together on fast switches. */
  const selSubIdxRef = useRef<number>(selectedSubVisualIndex ?? -1);
  /** AI prompt drafts per cut — the lens remounts on cut switch, so drafts
   * live here to survive navigation. Must stay above the early returns. */
  const promptDraftsRef = useRef<Record<string, string>>({});
  const loadPromptDraft = useCallback(
    (key: string) => promptDraftsRef.current[key] ?? '',
    [],
  );
  const savePromptDraft = useCallback((key: string, text: string) => {
    if (text) promptDraftsRef.current[key] = text;
    else delete promptDraftsRef.current[key];
  }, []);
  /** Bumps whenever pending is scheduled/committed/discarded so the header
   * (cut count, pending-aware view) re-renders — refs alone don't trigger it. */
  const [pendingTick, setPendingTick] = useState(0);
  useEffect(() => { onStartEditRef.current = onStartEdit; }, [onStartEdit]);
  useEffect(() => { scriptDataRef.current = scriptData; }, [scriptData]);
  useEffect(() => { onSetScriptDataRef.current = onSetScriptData; }, [onSetScriptData]);
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  useEffect(() => { selSubIdxRef.current = selectedSubVisualIndex ?? -1; }, [selectedSubVisualIndex]);
  void pendingTick;

  // ── Debounced upstream writes ─────────────────────────────────────
  // Color-picker drags and slider scrubs fire dozens of ticks per second.
  // Pushing every tick to the top-level store re-renders the whole workspace
  // (and recomputes liveScenes) inside the drag task, which is what made the
  // picker lag. The editor UI itself stays instant (AstGraphicalEditor owns
  // local composition state); only the trailing edge hits the store.
  // Structural actions (add/delete/switch/save/…) flush first via
  // commitPending(), so in-flight ticks are never lost.

  /** Synchronously push pending edits to the store. Returns the new doc. */
  const commitPending = useCallback((): any | null => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const pending = pendingFullRef.current;
    const r = pendingResolvedRef.current ?? resolvedRef.current;
    pendingFullRef.current = null;
    pendingResolvedRef.current = null;
    if (!pending || !r) return null;
    // Guard: a scene insert/delete shifted script indices mid-debounce —
    // writing by stale sceneNumber would corrupt the wrong scene. Abort.
    const liveScenesLength = scriptDataRef.current?.scenes?.length ?? 0;
    const capturedLength = (r as ResolvedVisual & { scenesLength?: number }).scenesLength;
    if (capturedLength !== undefined && capturedLength !== liveScenesLength) {
      setPendingTick(t => t + 1);
      return null;
    }
    if (r) {
      try { lastWrittenJsonByCardRef.current[r.cardKey] = JSON.stringify(pending); } catch { /* ignore */ }
    }
    const copy = writeSectionSubs(scriptDataRef.current, r, pending);
    onSetScriptDataRef.current(copy);
    setPendingTick(t => t + 1);
    return copy;
  }, []);

  const scheduleWriteBack = useCallback((fullSubs: any[]) => {
    pendingFullRef.current = fullSubs;
    // Capture the section now — resolvedRef may point at a different section
    // by the time the trailing edge fires.
    const cur = resolvedRef.current;
    pendingResolvedRef.current = cur
      ? { ...cur, scenesLength: scriptDataRef.current?.scenes?.length ?? 0 }
      : null;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      const pending = pendingFullRef.current;
      const r = pendingResolvedRef.current;
      pendingFullRef.current = null;
      pendingResolvedRef.current = null;
      if (!pending || !r) { setPendingTick(t => t + 1); return; }
      const liveScenesLength = scriptDataRef.current?.scenes?.length ?? 0;
      if (r.scenesLength !== liveScenesLength) { setPendingTick(t => t + 1); return; }
      if (r) {
        try { lastWrittenJsonByCardRef.current[r.cardKey] = JSON.stringify(pending); } catch { /* ignore */ }
      }
      onSetScriptDataRef.current(writeSectionSubs(scriptDataRef.current, r, pending));
      setPendingTick(t => t + 1);
    }, COMMIT_DEBOUNCE_MS);
    setPendingTick(t => t + 1);
  }, []);

  /** Discard pending edits without committing (Cancel path). */
  const discardPending = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    pendingFullRef.current = null;
    pendingResolvedRef.current = null;
    setPendingTick(t => t + 1);
  }, []);

  useEffect(() => {
    // Start a visuals session only when nothing is being edited. A pending
    // section switch flushes first so the old section's ticks land home.
    if (resolved && editingCard === null) {
      commitPending();
      onStartEditRef.current(resolved.cardKey, 'visuals');
    }
  }, [resolved?.cardKey, editingCard, commitPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose the flusher for external saves (Ctrl+S / TopBar) and flush any
  // in-flight drag edits on unmount (e.g. tab switch) — edits are never lost.
  // The edit session itself persists (resume after tab switch); only ticks flush.
  const onRegisterFlushRef = useRef(onRegisterFlush);
  useEffect(() => { onRegisterFlushRef.current = onRegisterFlush; }, [onRegisterFlush]);
  useEffect(() => {
    onRegisterFlushRef.current?.(() => commitPending());
    return () => {
      commitPending();
      onRegisterFlushRef.current?.(null);
    };
  }, [commitPending]);

  // Self-heal a stale sub-index (e.g. AI rewrite shrank the section, or the
  // section was emptied elsewhere): clamp into range so downstream readers of
  // the raw indices never act on a phantom cut. Empty sections stay as-is —
  // the main UI shows the "no cuts yet" + Add Cut recovery.
  const subCount = resolved?.subVisuals.length ?? 0;
  const selSubIdx = sel?.subIdx ?? -1;
  useEffect(() => {
    if (resolved && subCount > 0 && (selSubIdx < 0 || selSubIdx >= subCount)) {
      setSelectedSubVisualIndex(Math.min(Math.max(0, selSubIdx), subCount - 1));
    }
  }, [resolved?.cardKey, subCount, selSubIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Section baseline for Revert: snapshot the section's subVisuals when the
  // section is first resolved so "Revert" can restore this section cleanly,
  // without clobbering other sections or losing baseline on cut switches.
  // Refreshes on genuinely external changes (AI rewrite, timeline resize,
  // Script-tab edits): our own store echo matches lastWrittenJsonRef and is
  // ignored, anything else re-baselines so Revert never restores pre-rewrite
  // visuals. NOTE: must live above the early returns — hooks cannot run
  // conditionally.
  const sectionBaselinesRef = useRef<Record<string, any[]>>({});
  const snapshot = (subs: any[]) => { try { return JSON.parse(JSON.stringify(subs)); } catch { return [...subs]; } };
  useEffect(() => {
    if (!resolved) return;
    const key = resolved.cardKey;
    const current = resolved.subVisuals;
    if (!sectionBaselinesRef.current[key]) {
      sectionBaselinesRef.current[key] = snapshot(current);
      return;
    }
    // No in-flight own edits and current differs from both baseline and our
    // last write → external replacement (AI/timeline/script). Re-baseline.
    if (!pendingFullRef.current && !commitTimerRef.current) {
      let curJson: string | null = null;
      let baseJson: string | null = null;
      try {
        curJson = JSON.stringify(current);
        baseJson = JSON.stringify(sectionBaselinesRef.current[key]);
      } catch { return; }
      if (curJson !== baseJson && curJson !== lastWrittenJsonByCardRef.current[key]) {
        sectionBaselinesRef.current[key] = snapshot(current);
      }
    }
  }, [resolved?.cardKey, resolved?.subVisuals]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scriptData) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <VscLayers className="text-2xl text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-400 font-medium">No script generated</p>
          <p className="text-[10px] text-zinc-600 max-w-50 mx-auto leading-relaxed">
            Launch the pipeline from the Export tab to generate content first
          </p>
        </div>
      </div>
    );
  }

  if (!resolved || !sel) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <VscLayers className="text-2xl text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-400 font-medium">No cut selected</p>
          <p className="text-[10px] text-zinc-600 max-w-55 mx-auto leading-relaxed">
            Click any cut in the timeline or any asset in the sidebar to edit its visuals here
          </p>
        </div>
      </div>
    );
  }

  const actualSubIdx = sel.subIdx;
  // Pending-aware view: while debounced ticks are in flight, render from the
  // pending array so mid-window re-renders (e.g. playback-driven) can never
  // show stale data or clobber in-flight edits. Only use pending when it
  // belongs to the currently resolved section.
  const pendingForSection = pendingResolvedRef.current?.cardKey === resolved.cardKey
    ? pendingFullRef.current
    : null;
  const displaySubs = pendingForSection ?? resolved.subVisuals;
  const cutCount = displaySubs.length;
  const selectedCut = displaySubs[actualSubIdx];
  const isScene = resolved.sectionType === 'scenes';
  const handlerSceneIdx = isScene ? resolved.sceneNumber : -1;
  const saveArg: string = resolved.sectionType === 'introduction' ? 'introduction' : resolved.cardKey;
  const saveIndex: number | undefined = isScene ? resolved.sceneNumber : undefined;
  const isSaving = savingCardKey === saveArg;
  // Global gate: while ANY AI rewrite is in flight anywhere, whole-document
  // Save and every other AI rewrite are locked (save persists the whole doc
  // and wipes all baselines — it must never run mid-generation).
  const busy = savingCardKey !== null || isAnyRewriting;
  // Section-scoped gate: structural edits to THIS section (revert, add/delete
  // cut) lock while a rewrite touches it; other sections stay editable.
  const sectionLocked = resolved ? isSectionLocked(resolved.cardKey) : false;
  // Lens gate: the single-cut editor locks while a section rewrite replaces
  // this section's array, or a single-cut rewrite targets the open cut —
  // otherwise in-flight slider ticks would be silently dropped on landing.
  // Navigation (cut buttons, prev/next, timeline) stays free.
  const lensLocked = !!resolved && (isSectionRewriting(resolved.cardKey) || isSubRewriting(resolved.cardKey, actualSubIdx));
  const rewriteKey = resolved.sectionType === 'introduction' ? 'intro'
    : isScene ? `scene_${resolved.sceneNumber}` : 'conclusion';
  const isRewritingSection = rewritingSection === rewriteKey;

  /** Single-cut lens: the editor works on [cut], merge the item back. */
  const handleLensChange = (newSubs: any[]) => {
    if (newSubs.length !== 1) return;
    // Accumulate on the pending array when one exists for THIS section:
    // SubVisualsEditor's own base can lag behind during the debounce window,
    // and rebuilding from the stale section array would drop in-flight ticks.
    // Read section AND cut index from refs — both render closures can point at
    // the previous section/cut if a selection switch re-rendered late.
    const cur = resolvedRef.current;
    const subIdx = selSubIdxRef.current;
    const base = pendingResolvedRef.current?.cardKey === cur?.cardKey
      ? (pendingFullRef.current ?? cur?.subVisuals ?? [])
      : (cur?.subVisuals ?? []);
    if (subIdx < 0 || subIdx >= base.length) return;
    const prev = base[subIdx] ?? {};
    const next = newSubs[0];
    // Discrete scalar edits (transition dropdown, mute toggles) apply
    // synchronously — same tick as the timeline path — instead of riding the
    // 150ms composition-drag debounce, so the player updates instantly.
    let compositionSame = false;
    try {
      compositionSame = JSON.stringify(prev?.composition) === JSON.stringify(next?.composition);
    } catch { compositionSame = false; }
    const scalarOnly = compositionSame
      && prev?.duration === next?.duration
      && prev?.duration_ratio === next?.duration_ratio;
    if (scalarOnly) {
      const flushed = commitPending();
      const doc = flushed ?? scriptDataRef.current;
      const r = resolvedRef.current;
      if (!r) return;
      const sectionSubs = readSectionSubs(doc, r);
      if (subIdx < 0 || subIdx >= sectionSubs.length) return;
      const full = [...sectionSubs];
      full[subIdx] = next;
      try { lastWrittenJsonByCardRef.current[r.cardKey] = JSON.stringify(full); } catch { /* ignore */ }
      onSetScriptDataRef.current(writeSectionSubs(doc, r, full));
      setPendingTick(t => t + 1);
      return;
    }
    const full = [...base];
    full[subIdx] = next;
    scheduleWriteBack(full);
  };

  /** Structural write: fold pending edits in, then apply the change on top. */
  const writeImmediate = (updater: (subs: any[]) => any[]) => {
    const flushedCopy = commitPending();
    const doc = flushedCopy ?? scriptDataRef.current;
    const r = resolvedRef.current;
    if (!r) return null;
    const full = updater(readSectionSubs(doc, r));
    const copy = writeSectionSubs(doc, r, full);
    if (r) {
      try { lastWrittenJsonByCardRef.current[r.cardKey] = JSON.stringify(full); } catch { /* ignore */ }
    }
    onSetScriptDataRef.current(copy);
    return full;
  };

  /** Scale ratios proportionally to sum to 1 and derive durations. */
  const applyRatios = (subs: any[], ratios: number[]) => {
    // Prefer real timing; when timing is missing preserve existing durations
    // instead of silently rescaling the section to 3s.
    const refFrames = resolvedRef.current?.totalDurationFrames ?? 0;
    const existingTotal = subs.reduce((a, s) => a + (Number(s?.duration) || 0), 0);
    const totalSec = refFrames > 0 ? refFrames / 30 : (existingTotal > 0 ? existingTotal : 3);
    const sum = ratios.reduce((a, b) => a + b, 0);
    const safe = sum > 0 ? ratios.map((r) => r / sum) : ratios.map(() => 1 / ratios.length);
    return subs.map((s, i) => ({
      ...s,
      duration_ratio: safe[i],
      duration: Number((safe[i] * totalSec).toFixed(3)),
    }));
  };

  const handleAddCut = () => {
    const full = writeImmediate((subs) => {
      // Preserve relative timing: scale existing cuts down proportionally and
      // give the new cut an equal share, instead of snapping all to 1/N.
      const n = subs.length;
      const existing = subs.map((s) => {
        const r = Number(s?.duration_ratio);
        return Number.isFinite(r) && r > 0 ? r : 1 / Math.max(1, n);
      });
      const scale = n / (n + 1);
      const next = [
        ...subs,
        { composition: { type: 'Sequence', children: [] } },
      ];
      return applyRatios(next, [...existing.map((r) => r * scale), 1 / (n + 1)]);
    });
    if (full) setSelectedSubVisualIndex(full.length - 1);
  };

  const handleDeleteCut = () => {
    if (cutCount <= 1) return;
    const subIdx = selSubIdxRef.current;
    if (resolved) {
      withFlushDeleteCut(handlerSceneIdx, resolved.sectionType, subIdx);
    }
    const full = writeImmediate((subs) => {
      // Preserve relative timing of the survivors (renormalize proportionally)
      // instead of equalizing them.
      const kept = subs.filter((_: any, i: number) => i !== subIdx);
      const ratios = kept.map((s) => {
        const r = Number(s?.duration_ratio);
        return Number.isFinite(r) && r > 0 ? r : 1;
      });
      return applyRatios(kept, ratios);
    });
    if (full) setSelectedSubVisualIndex(Math.min(subIdx, full.length - 1));
    useEditorStore.getState().setSelectedLayerIndex(null);
  };

  const selectCut = (idx: number) => {
    if (cutCount === 0) return;
    commitPending();
    const nextIdx = Math.max(0, Math.min(cutCount - 1, idx));
    setSelectedSubVisualIndex(nextIdx);
    useEditorStore.getState().setSelectedLayerIndex(null);
    const cutTiming = (resolved?.sceneTiming as any)?.subs?.[nextIdx];
    if (cutTiming?.start !== undefined) {
      onSeek(cutTiming.start);
    }
  };

  const goCut = (delta: number) => {
    if (cutCount === 0) return;
    const next = Math.max(0, Math.min(cutCount - 1, actualSubIdx + delta));
    selectCut(next);
  };

  const handleSaveVisuals = () => {
    // Whole-document save is locked while any AI rewrite is in flight: the
    // save would persist a pre-AI doc and wipe every card baseline.
    if (isAnyRewriting) {
      addToast('Save is paused while an AI rewrite is in progress.', 'warning');
      return;
    }
    // Flush in-flight drag ticks first and hand the exact document to the
    // save pipeline so Save can never miss the last milliseconds of a drag.
    const flushed = commitPending();
    if (resolved) {
      const doc = flushed ?? scriptDataRef.current;
      sectionBaselinesRef.current[resolved.cardKey] = snapshot(readSectionSubs(doc, resolved));
      try { lastWrittenJsonByCardRef.current[resolved.cardKey] = JSON.stringify(sectionBaselinesRef.current[resolved.cardKey]); } catch { /* ignore */ }
    }
    onSaveCard(saveArg, saveIndex, flushed ?? undefined);
  };

  const handleCancelVisuals = () => {
    // Revert = restore this section's baseline, stay in the Visuals tab.
    // Idempotent: a second click is a no-op. Never kills the whole edit
    // session — with no baseline yet there is nothing to restore, just drop
    // pending ticks.
    // Poison this section's in-flight rewrites FIRST so a late LLM result
    // can't land on top of the restored baseline.
    if (resolved) invalidateRewrites(resolved.cardKey);
    discardPending();
    const baseline = resolved ? sectionBaselinesRef.current[resolved.cardKey] : null;
    if (baseline && resolved) {
      const restored = snapshot(baseline);
      const copy = writeSectionSubs(scriptDataRef.current, resolved, restored);
      try { lastWrittenJsonByCardRef.current[resolved.cardKey] = JSON.stringify(restored); } catch { /* ignore */ }
      onSetScriptDataRef.current(copy);
      if (selSubIdxRef.current >= restored.length) {
        setSelectedSubVisualIndex(Math.max(0, restored.length - 1));
      }
      addToast("Visual changes reverted to baseline.", 'info');
    }
  };

  // AI rewrites are applied straight to local state (unsaved) — this editor
  // is preview-first, so the player, timeline, and editor all show the result
  // instantly. Nothing hits the backend until Save Visuals; Revert restores
  // the pre-AI baseline. The section identity is captured BEFORE the request
  // so a section switch mid-generation still lands in the right section.
  /** Write AI-produced subs for a captured section into the store (unsaved). */
  const applyAiSubs = (r: ResolvedVisual, fullSubs: any[], baseDoc?: any) => {
    commitPending();
    const snapSubs = snapshot(fullSubs);
    const doc = writeSectionSubs(baseDoc ?? scriptDataRef.current, r, snapSubs);
    // Tag as our own write so the baseline effect ignores the echo — the
    // pre-AI baseline stays intact, keeping Revert meaningful.
    try { lastWrittenJsonByCardRef.current[r.cardKey] = JSON.stringify(snapSubs); } catch { /* ignore */ }
    onSetScriptDataRef.current(doc);
  };

  const withFlushRewriteSub = async (sceneIdx: number, sectionType: string, subIdx: number, prompt: string) => {
    const flushedPre = commitPending();
    const r = resolvedRef.current;
    if (!r) return;
    // Snapshot the origin cut BEFORE the 10–60s generation window: after the
    // await, the user may have switched cuts, edited, or (for unlocked
    // sections) restructured — the result must relocate by identity, never by
    // blind index, and never resurrect a deleted cut.
    const preBase = readSectionSubs(flushedPre ?? scriptDataRef.current, r);
    if (subIdx < 0 || subIdx >= preBase.length) return;
    const originIdx = subIdx;
    const originSnap = safeJson(preBase[subIdx]);
    const cut = await onRewriteSubVisual(sceneIdx, sectionType, subIdx, prompt, flushedPre ?? undefined);
    // undefined = backend failure OR superseded flight (hook already toasted).
    if (cut === undefined) return;
    // Flush ticks made DURING generation first, then read — reading before
    // the commit would silently drop them from the merged write below.
    const flushedPost = commitPending();
    const doc = flushedPost ?? scriptDataRef.current;
    const base = readSectionSubs(doc, r);
    let target = -1;
    if (originIdx >= 0 && originIdx < base.length && safeJson(base[originIdx]) === originSnap) {
      target = originIdx;
    } else if (originSnap !== null) {
      target = base.findIndex((s) => safeJson(s) === originSnap);
    }
    if (target === -1) {
      addToast('Cut rewrite aborted: the target cut was deleted or changed during generation.', 'warning');
      return;
    }
    const full = [...base];
    full[target] = cut;
    applyAiSubs(r, full, doc);
  };
  const withFlushUpload = (sceneIdx: number, sectionType: string, subIdx: number, visualType?: string, layerIdx?: number) => {
    const flushed = commitPending();
    return onUploadSubVisual!(sceneIdx, sectionType, subIdx, visualType, flushed ?? undefined, layerIdx);
  };
  const withFlushRewriteSection = async (type: string, index: number) => {
    const flushed = commitPending();
    const r = resolvedRef.current;
    if (!r) return;
    // Explicit 'visuals' intent — don't rely on editingCard.mode, which is
    // set in a post-render effect and races a fast open → rewrite.
    // Preview-only from the backend's view: the hook returns the AI subs
    // without saving; applied below to local state (unsaved).
    const aiSubs = await onRewriteSection(type, index, flushed ?? undefined, 'visuals');
    if (!Array.isArray(aiSubs)) return; // failed or superseded (hook toasted)
    // Flush ticks made during generation before applying, so the wholesale
    // array replace below never drops them from the merged write.
    const flushedPost = commitPending();
    applyAiSubs(r, aiSubs, flushedPost ?? undefined);
    // Count may have changed — keep the selection valid on the same card.
    if (r.cardKey === resolvedRef.current?.cardKey) {
      setSelectedSubVisualIndex(Math.min(selSubIdxRef.current, Math.max(0, aiSubs.length - 1)));
    }
  };
  const withFlushPreview = (sceneIdx: number, sectionType: string, subIdx: number, query: string, layerIdx?: number) => {
    const flushed = commitPending();
    return onPreviewSubVisual!(sceneIdx, sectionType, subIdx, query, flushed ?? undefined, layerIdx);
  };
  const withFlushDeleteLayer = (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => {
    commitPending();
    onDeleteLayerSubVisual?.(sceneIdx, sectionType, subIdx, layerIdx);
  };
  const withFlushDuplicateLayer = (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => {
    commitPending();
    onDuplicateLayerSubVisual?.(sceneIdx, sectionType, subIdx, layerIdx);
  };
  const withFlushDeleteCut = (sceneIdx: number, sectionType: string, subIdx: number) => {
    commitPending();
    onDeleteCutSubVisual?.(sceneIdx, sectionType, subIdx);
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
      {/* ── Selected cut header ─────────────────────────────────────── */}
      <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-zinc-800/40">
          <div className="flex items-center gap-2">
            <VscLayers className="text-[10px] text-zinc-500" />
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 truncate">
              {resolved.title}
            </h3>
            <span className="text-[8px] text-zinc-600 ml-auto shrink-0">
              {cutCount === 0 ? 'No cuts' : `Cut ${actualSubIdx + 1} of ${cutCount}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={() => goCut(-1)}
              disabled={actualSubIdx <= 0}
              className="p-1.5 rounded-lg border border-zinc-700/60 bg-zinc-900/50 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Previous cut"
            >
              <VscChevronLeft className="text-xs" />
            </button>
            <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
              {displaySubs.map((_: any, i: number) => (
                <button
                  key={i}
                  onClick={() => selectCut(i)}
                  className={`shrink-0 w-6 h-6 rounded-md text-[9px] font-mono font-bold border transition-colors cursor-pointer flex items-center justify-center ${
                    i === actualSubIdx
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      : 'bg-zinc-900/60 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600'
                  }`}
                  title={isSubRewriting(resolved.cardKey, i) ? `Cut ${i + 1} — AI rewriting…` : `Cut ${i + 1}`}
                >
                  {isSubRewriting(resolved.cardKey, i)
                    ? <VscLoading className="animate-spin text-[9px]" />
                    : (i + 1)}
                </button>
              ))}
            </div>
            <button
              onClick={() => goCut(1)}
              disabled={actualSubIdx >= cutCount - 1}
              className="p-1.5 rounded-lg border border-zinc-700/60 bg-zinc-900/50 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Next cut"
            >
              <VscChevronRight className="text-xs" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Save / cancel */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveVisuals}
              disabled={busy}
              title={isAnyRewriting ? 'Save is paused while an AI rewrite is in progress' : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2.5 py-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
            >
              {isSaving ? <><VscLoading className="animate-spin text-[10px]" /> Saving...</> : <><VscSave className="text-[10px]" /> Save Visuals</>}
            </button>
            <button
              onClick={handleCancelVisuals}
              disabled={savingCardKey !== null || sectionLocked}
              title={sectionLocked ? 'Revert is paused while this section rewrites' : 'Discard unsaved visual changes in this section (stays in the Visuals tab)'}
              className="px-4 py-2 text-[10px] font-bold disabled:opacity-50 disabled:cursor-not-allowed text-zinc-400 hover:text-white rounded-lg border border-zinc-700/60 bg-zinc-900/50 hover:bg-zinc-800 transition-all cursor-pointer"
            >
              Revert
            </button>
          </div>

          {/* Timing row */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
            {resolved.subTiming && (
              <button
                onClick={() => onSeek(resolved.subTiming!.start)}
                className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                title="Seek to this cut"
              >
                {formatTime(resolved.subTiming.start)} → {formatTime(resolved.subTiming.end)}
              </button>
            )}
            <span className="ml-auto text-zinc-600">
              {resolved.totalDurationFrames > 0 ? `${(resolved.totalDurationFrames / 30).toFixed(1)}s scene` : ''}
            </span>
          </div>

          {/* Single-cut editor lens */}
          {selectedCut ? (
            <div className="relative">
              <div className={lensLocked ? 'pointer-events-none opacity-60 saturate-50' : undefined}>
                <SubVisualsEditor
                  key={`${resolved.cardKey}_cut_${actualSubIdx}`}
                  subVisuals={[selectedCut]}
                  onChange={handleLensChange}
                  timings={resolved.subTiming ? [resolved.subTiming] : []}
                  totalDurationFrames={resolved.totalDurationFrames}
                  activeIdx={sel.sceneIdx === activeSceneIdx && activeSubIdx === actualSubIdx ? 0 : -1}
                  onSeek={onSeek}
                  onRewriteSubVisual={(_, prompt) => withFlushRewriteSub(handlerSceneIdx, resolved.sectionType, actualSubIdx, prompt)}
                  onUploadSubVisual={onUploadSubVisual ? (_, visualType, layerIdx) => withFlushUpload(handlerSceneIdx, resolved.sectionType, actualSubIdx, visualType, layerIdx) : undefined}
                  onPreviewSubVisual={onPreviewSubVisual ? (_, query, layerIdx) => withFlushPreview(handlerSceneIdx, resolved.sectionType, actualSubIdx, query, layerIdx) : undefined}
                  onDeleteLayer={onDeleteLayerSubVisual ? (_, layerIdx) => withFlushDeleteLayer(handlerSceneIdx, resolved.sectionType, actualSubIdx, layerIdx) : undefined}
                  onDuplicateLayer={onDuplicateLayerSubVisual ? (_, layerIdx) => withFlushDuplicateLayer(handlerSceneIdx, resolved.sectionType, actualSubIdx, layerIdx) : undefined}
                  uploadingSubVisual={uploadingSubVisual}
                  singleCut
                  cutNumber={actualSubIdx + 1}
                  aiDisabled={busy}
                  promptDraftKey={`${resolved.cardKey}:${actualSubIdx}`}
                  loadPromptDraft={loadPromptDraft}
                  savePromptDraft={savePromptDraft}
                />
              </div>
              {lensLocked && (
                <div className="absolute inset-x-0 top-0 flex justify-center pt-1 pointer-events-none">
                  <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-950/90 border border-amber-700/50 rounded-full px-2.5 py-1">
                    <VscLoading className="animate-spin text-[9px]" /> AI rewrite in progress…
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 space-y-2 border border-dashed border-zinc-700/60 rounded-xl bg-zinc-900/40">
              <p className="text-[11px] text-zinc-400 font-medium">
                {cutCount === 0 ? 'This section has no cuts yet' : 'Selected cut is out of range'}
              </p>
              <p className="text-[10px] text-zinc-600 max-w-55 mx-auto leading-relaxed">
                {cutCount === 0
                  ? 'Add a cut below to start building visuals for this section'
                  : 'Pick another cut above — the list changed while editing'}
              </p>
            </div>
          )}

          {/* Cut add/remove — section-scoped: locked only while THIS section rewrites */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddCut}
              disabled={savingCardKey !== null || sectionLocked}
              title={sectionLocked ? 'Add Cut is paused while this section rewrites' : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold text-zinc-400 hover:text-amber-400 bg-zinc-800/30 hover:bg-amber-600/[0.07] rounded-xl border border-dashed border-zinc-700/60 hover:border-amber-600/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <VscAdd className="text-[10px]" /> Add Cut
            </button>
            <button
              onClick={handleDeleteCut}
              disabled={savingCardKey !== null || sectionLocked || cutCount <= 1}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold text-zinc-500 hover:text-red-400 bg-zinc-800/30 hover:bg-red-950/30 rounded-xl border border-dashed border-zinc-700/60 hover:border-red-900/50 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={sectionLocked ? 'Delete Cut is paused while this section rewrites' : (cutCount <= 1 ? 'A section needs at least one cut' : 'Delete this cut')}
            >
              <VscTrash className="text-[10px]" /> Delete Cut
            </button>
          </div>

          {/* Section AI regenerate */}
          <div className="border-t border-zinc-700/30 pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <VscSparkle className="text-[9px] text-zinc-500" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                AI Regenerate Section Visuals
              </span>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <CustomInput
                  type="text"
                  placeholder="e.g., make all cuts cinematic drone shots..."
                  value={rewritePrompt}
                  onChange={(e) => setRewritePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy && rewritePrompt.trim()) {
                      e.preventDefault();
                      withFlushRewriteSection(resolved.sectionType, isScene ? resolved.sceneNumber : 0);
                    }
                  }}
                  disabled={busy}
                  title={isAnyRewriting && !isRewritingSection ? 'AI rewrites run one at a time — wait for the current one' : undefined}
                  className="w-full bg-zinc-900/80 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all disabled:opacity-50"
                />
              </div>
              <button
                onClick={() => withFlushRewriteSection(resolved.sectionType, isScene ? resolved.sceneNumber : 0)}
                disabled={busy || !rewritePrompt.trim()}
                title={isAnyRewriting && !isRewritingSection ? 'AI rewrites run one at a time — wait for the current one' : undefined}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800/80 hover:bg-blue-600/20 hover:text-blue-400 text-zinc-300 border border-zinc-700/60 hover:border-blue-600/30 rounded-lg text-[10px] font-bold transition-all shrink-0 h-9 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isRewritingSection ? (
                  <><VscLoading className="animate-spin text-[10px]" /> Rewriting...</>
                ) : (
                  <><VscSparkle className="text-[10px]" /> Rewrite</>
                )}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
});
VisualsTab.displayName = 'VisualsTab';
