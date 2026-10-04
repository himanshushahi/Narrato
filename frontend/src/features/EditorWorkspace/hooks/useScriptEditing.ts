import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../../store/useProjectStore';
import { useUIStore } from '../../../store/useUIStore';
import { callApi, callApiOrThrow } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { inferMediaType } from '../../../utils/mediaExtensions';

import { estimateTextDuration } from '../../../utils/duration';
import { setEditorDirty, markSelfSaveStart, markSelfSaveEnd } from './editorDirty';
import { getNotoFamilyForLang } from '../../../components/video/complexScriptFonts';

function isTempPreviewFile(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  if (lower.includes('asset_')) return false;
  return lower.includes('/previews/') || lower.includes('\\previews\\') || lower.includes('preview_') || lower.includes('upload_');
}

/**
 * Shared temp-preview cleanup (layer + cut eviction paths): only delete
 * physical files no surviving preview entry still references, then ask the
 * backend to remove the owned ones. Keeps the StrictMode-safe updater pure.
 */
function cleanupOwnedTempPaths(
  current: Record<string, { visual_path?: string }>,
  toCleanup: string[],
  evictedKeys: Set<string>,
  projectId: string | undefined,
): void {
  const survivingPaths = new Set(
    Object.entries(current)
      .filter(([k, v]) => !evictedKeys.has(k) && !!v?.visual_path)
      .map(([, v]) => v.visual_path as string),
  );
  const ownedCleanup = toCleanup.filter((p) => !survivingPaths.has(p));

  if (ownedCleanup.length > 0 && projectId) {
    callApi('cleanup_preview_assets', projectId, ownedCleanup).catch(() => {});
  }
}

/** Canonical section type: 'scenes' (script docs + Visuals tab) and 'scene'
 * (manifest entries) refer to the same thing. Normalize once so every
 * branch below only deals with 'scene'. */
function normalizeSectionType(t: string | undefined | null): string {
  if (!t) return '';
  const lower = String(t).toLowerCase();
  if (lower === 'scenes' || lower === 'scene') return 'scene';
  if (lower === 'intro') return 'introduction';
  return lower;
}

/** Card key used by the rewrite registry / edit snapshots. */
function rewriteCardKey(type: string, index: number): string {
  const n = normalizeSectionType(type);
  if (n === 'introduction') return 'intro';
  if (n === 'conclusion') return 'conclusion';
  return `scene_${index}`;
}

/** Stable identity for a sub-visual cut. Prefers a persistent id when the
 * pipeline provides one, otherwise falls back to content (type+cue).
 * NOTE: ids are never minted today, so duplicate type+cue keys are common
 * (empty cues, same defaults). Never use this key in a first-wins Map —
 * that broadcasts one cut across all duplicates. Always match 1:1 with a
 * used-index set, positional-first. */
function subVisualKey(sv: any): string {
  if (!sv || typeof sv !== 'object') return '';
  if (sv.id !== undefined && sv.id !== null && String(sv.id).length > 0) return `id:${String(sv.id)}`;
  const vt = String(sv.visual_type || '').toLowerCase();
  const cue = String(sv.visual_cue || '').trim();
  return `${vt}::${cue}`;
}

/** 1:1 cut matcher: positional-first, then first-unused same-key peer.
 * Positional-first keeps the common no-insert/delete save exact (and keeps
 * duplicate keys in order instead of swapping neighbors); the key search
 * only handles genuine insert/delete shifts. Returns -1 when the live cut
 * is genuinely new (edited cue / inserted cut) so callers emit a clean
 * entry and trigger a fetch instead of inheriting a neighbor's asset. */
function findUnmatchedOrigIndex(
  liveKey: string,
  liveIdx: number,
  origSubs: any[],
  used: Set<number>,
): number {
  if (
    liveIdx < origSubs.length &&
    !used.has(liveIdx) &&
    subVisualKey(origSubs[liveIdx]) === liveKey
  ) {
    return liveIdx;
  }
  return origSubs.findIndex(
    (o: any, i: number) => !used.has(i) && subVisualKey(o) === liveKey,
  );
}

interface UseScriptEditingReturn {
  editingCard: { key: string, mode: 'script' | 'visuals' } | null;
  setEditingCard: (card: { key: string, mode: 'script' | 'visuals' } | null) => void;
  rewritePrompt: string;
  setRewritePrompt: (p: string) => void;
  rewritingSection: string | null;
  /** True while ANY AI rewrite (section or single-cut) is in flight. */
  isAnyRewriting: boolean;
  /** True while a section-level rewrite for this card is in flight. */
  isSectionRewriting: (cardKey: string) => boolean;
  /** True while a single-cut rewrite for this card+cut is in flight. */
  isSubRewriting: (cardKey: string, subIdx: number) => boolean;
  /** True while a section- OR single-cut rewrite touches this card. */
  isSectionLocked: (cardKey: string) => boolean;
  /** Poison in-flight rewrites for a card (Revert path): late LLM results are discarded. */
  invalidateRewrites: (cardKey: string) => void;
  /** Poison ALL in-flight rewrites (project switch/unmount). */
  invalidateAllRewrites: () => void;
  savingCardKey: string | null;
  sceneToDelete: number | null;
  localProjectSettings: any;
  isSavingSubtitles: boolean;
  previewAssets: Record<string, { visual_path: string; visual_url: string; layerIdx?: number }>;
  uploadingSubVisual: string | null;
  handleUploadSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, overrideVisualType?: string, latestData?: any, layerIdx?: number) => Promise<string | undefined>;
  handleStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  handleCancelEdit: () => void;
  handleSaveCard: (cardKey?: string, index?: number, latestData?: any) => Promise<void>;
  handleRewriteSection: (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => Promise<any | undefined>;
  handleRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => Promise<any | undefined>;
  insertAndSaveNewScene: (newScene: any, insertAfterIdx: number) => Promise<void>;
  confirmDeleteScene: () => Promise<void>;
  setSceneToDelete: (idx: number | null) => void;
  handleSettingsUpdate: (newSettings: any) => void;
  handleSaveTranscription: (overrideDoc?: any) => Promise<void>;
  handleResetTranscription: () => void;
  handlePreviewSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, query: string, latestData?: any, layerIdx?: number, visualType?: string) => Promise<string | undefined>;
  handleDeleteLayerAsset: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  handleDuplicateLayerAsset: (sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => void;
  handleMoveLayerAsset: (sceneIdx: number, sectionType: string, subIdx: number, fromIdx: number, toIdx: number) => void;
  handleReorderLayerAsset: (sceneIdx: number, sectionType: string, subIdx: number, fromIdx: number, toIdx: number) => void;
  handleDeleteCutAsset: (sceneIdx: number, sectionType: string, subIdx: number) => void;
}

export function useScriptEditing(
  projectId: string | undefined,
  scriptData: any,
  setScriptData: (data: any) => void,
  manifestData: any[],
  setManifestData: (data: any[]) => void,
  transcriptionData: any,
  _setTranscriptionData: (data: any) => void,
  loadFiles: (projId: string) => Promise<{ script: any; manifest: any[] }>
): UseScriptEditingReturn {
  // Fix 4: granular selectors — whole-store sub re-ran this hook on every
  // tasks/queue/logs/toasts change.
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const downloadFont = useProjectStore((s) => s.downloadFont);
  const addToast = useUIStore((s) => s.addToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const [editingCard, setEditingCard] = useState<{ key: string, mode: 'script' | 'visuals' } | null>(null);
  // Publish edit-session state cross-hook: while a card is being edited the
  // user may hold unsaved changes, so useEditorData defers live agent file
  // reloads (instead of clobbering them) until the session closes.
  useEffect(() => {
    setEditorDirty(editingCard !== null);
  }, [editingCard]);
  // Unmount-only reset (separate effect: folding this into the effect above
  // would publish false on every card switch and flush deferred reloads
  // mid-edit). Without it, unmounting mid-edit sticks dirty=true forever.
  useEffect(() => () => { setEditorDirty(false); }, []);
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [originalScriptData, setOriginalScriptData] = useState<any>(null);
  const [originalManifestData, setOriginalManifestData] = useState<any[]>([]);
  const [savingCardKey, setSavingCardKey] = useState<string | null>(null);
  const [sceneToDelete, setSceneToDelete] = useState<number | null>(null);
  const [localProjectSettings, setLocalProjectSettings] = useState<any>({});
  const [isSavingSubtitles, setIsSavingSubtitles] = useState(false);
  const [rewritingSection, setRewritingSection] = useState<string | null>(null);
  const [previewAssets, setPreviewAssets] = useState<Record<string, { visual_path: string; visual_url: string; layerIdx?: number }>>({});
  const previewAssetsRef = useRef(previewAssets);
  useEffect(() => { previewAssetsRef.current = previewAssets; }, [previewAssets]);
  /** Duplicated layers share one physical temp file until re-rendered — never
   * delete a temp path while a surviving (non-evicted) entry still points at it. */
  const isPreviewPathShared = (path: string, excludeKeys: string[]): boolean =>
    Object.entries(previewAssetsRef.current).some(
      ([k, v]) => !excludeKeys.includes(k) && v?.visual_path === path,
    );
  const [uploadingSubVisual, setUploadingSubVisual] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest script doc by ref so flushed Visuals-tab edits can be forwarded
  // synchronously (setState is async; render-closure scriptData would be stale
  // within the ~150ms debounce window).
  const scriptDataRef = useRef(scriptData);
  scriptDataRef.current = scriptData;
  const manifestDataRef = useRef(manifestData);
  manifestDataRef.current = manifestData;
  const editingCardRef = useRef(editingCard);
  editingCardRef.current = editingCard;
  const originalScriptDataRef = useRef(originalScriptData);
  originalScriptDataRef.current = originalScriptData;
  /** Per-card pre-edit snapshots (script + manifest) for per-card cancel. */
  const originalByCardRef = useRef<Record<string, any>>({});
  const originalManifestByCardRef = useRef<Record<string, any>>({});

  // ── Rewrite concurrency registry ────────────────────────────────────
  // AI generations are slow (10–60s) and the user keeps editing meanwhile.
  // Every rewrite flight captures (per-card generation, global epoch,
  // project id). A completion whose generation no longer matches, whose
  // epoch was bumped by a project switch, or whose project differs from the
  // currently open project is discarded instead of landing on a
  // moved/deleted cut, clobbering newer work, or leaking into a new project.
  // NOTE: the epoch is the critical piece — reset-in-place of the per-card
  // map alone would restart tokens at 1 and let an old project's result pass
  // the stale check in the new project.
  const rewriteGenRef = useRef<Record<string, number>>({});
  /** Global epoch bumped by invalidateAllRewrites (project switch/unmount). */
  const rewriteEpochRef = useRef(0);
  /** Project that owns the current registry — stale flights carry the old id. */
  const projectIdRef = useRef<string | undefined>(projectId);
  projectIdRef.current = projectId;
  /** Per-cut flight metadata (epoch + project) parallel to rewritingSubs UI state. */
  const subFlightMetaRef = useRef<Record<string, { token: number; epoch: number; projectId: string | undefined; cardGen: number }>>({});
  /** Per-cut generation registry keyed by `${cardKey}:${subIdx}` — two cut
   * rewrites on the same card must NOT invalidate each other, so cuts get
   * their own counter instead of sharing the per-card one. */
  const subGenRef = useRef<Record<string, number>>({});
  /** Whole-doc save ownership (not a plain boolean): a save from project A
   * must never block project B after a switch — B steals the lock and A's
   * tail aborts via its project/epoch stale gates. Same-project overlap is
   * still rejected. Released only by its owner (identity compare). */
  const saveOwnerRef = useRef<{ projectId: string | undefined; epoch: number } | null>(null);
  /** True while a save owned by this project+epoch holds the lock. */
  const isSaveActiveFor = (pid: string | undefined): boolean => {
    const o = saveOwnerRef.current;
    return !!o && o.projectId === pid && o.epoch === rewriteEpochRef.current;
  };
  /** Stashed revert for convergence: if a Revert lands while a whole-doc
   * persist holds the save mutex, the in-flight write can no longer be
   * stopped — the revert point is stashed here so the saver converges disk
   * back to it instead of leaving pre-revert bytes that resurrect on reload.
   * Both sides of the revert are kept: React state updates are async, so at
   * convergence time the live refs may still hold the PRE-revert doc (use the
   * stash) or may already include post-revert edits (use the live refs). */
  const pendingRevertWriteRef = useRef<{
    projectId: string; preDoc: any; preManifest: any; postDoc: any; postManifest: any;
  } | null>(null);
  /** Pick the convergence target for a stashed revert: the stashed post-doc
   * when the live refs never moved past the revert (React hadn't flushed),
   * otherwise the live refs (they contain the revert plus any later edits —
   * converging to the stash there would wipe those edits). Content-addressed,
   * so no separate revision counter is needed. */
  const resolveConvergeDocs = (projectId: string): { doc: any; manifest: any } | null => {
    const stashed = pendingRevertWriteRef.current;
    if (!stashed || stashed.projectId !== projectId) {
      return null;
    }
    try {
      const liveSig = JSON.stringify({ d: scriptDataRef.current, m: manifestDataRef.current });
      const preSig = JSON.stringify({ d: stashed.preDoc, m: stashed.preManifest });
      if (liveSig === preSig) {
        return { doc: stashed.postDoc, manifest: stashed.postManifest };
      }
      return { doc: scriptDataRef.current, manifest: manifestDataRef.current };
    } catch {
      // Unserializable edge — the stash is the known-good revert point.
      return { doc: stashed.postDoc, manifest: stashed.postManifest };
    }
  };
  /** Best-effort content signature for change detection (synchronous read —
   * no effect-timing hazard: signatures are compared at decision points). */
  const safeDocSig = (v: any): string => {
    try {
      return JSON.stringify(v) ?? '';
    } catch {
      return '';
    }
  };
  /** Structural mutation lock: scene insert/delete hold this across their
   * async save so AI rewrites (index-sensitive) can't start mid-mutation. */
  const structureMutationRef = useRef(false);
  /** Monotonic save revision — a slower earlier save never overwrites newer state. */
  const saveRevisionRef = useRef(0);
  /** Active single-cut flights: `${cardKey}:${subIdx}` → token (state for UI). */
  const [rewritingSubs, setRewritingSubs] = useState<Record<string, number>>({});
  const rewritingSubsRef = useRef(rewritingSubs);
  useEffect(() => { rewritingSubsRef.current = rewritingSubs; }, [rewritingSubs]);
  /** Active section flight. Section rewrites are single-flight globally: a new
   * section rewrite while any rewrite is in flight is rejected (see
   * handleRewriteSection guard) so sectionTokenRef only ever tracks one. */
  const sectionTokenRef = useRef<{ key: string; token: number; epoch: number; projectId: string | undefined } | null>(null);

  const bumpRewriteGen = (cardKey: string): number => {
    const next = (rewriteGenRef.current[cardKey] ?? 0) + 1;
    rewriteGenRef.current[cardKey] = next;
    return next;
  };

  /** A flight is stale when its epoch was superseded by a project switch,
   * its per-card generation was superseded by a newer rewrite/revert, or it
   * belongs to a different project than the one currently open. */
  const isFlightStale = (
    cardKey: string,
    flight: { token: number; epoch: number; projectId: string | undefined },
  ): boolean => {
    if (flight.epoch !== rewriteEpochRef.current) return true;
    if (flight.projectId !== projectIdRef.current) return true;
    if (rewriteGenRef.current[cardKey] !== flight.token) return true;
    return false;
  };

  /** A cut flight is stale when its epoch/project was superseded, its own
   * per-cut generation was superseded, or a section-level rewrite/revert on
   * the same card landed after it started (cardGen moved). */
  const isSubFlightStale = (
    cardKey: string,
    subKey: string,
    flight: { token: number; epoch: number; projectId: string | undefined; cardGen: number },
  ): boolean => {
    if (flight.epoch !== rewriteEpochRef.current) return true;
    if (flight.projectId !== projectIdRef.current) return true;
    if ((subGenRef.current[subKey] ?? -1) !== flight.token) return true;
    if ((rewriteGenRef.current[cardKey] ?? 0) !== flight.cardGen) return true;
    return false;
  };

  /** Poison in-flight rewrites for a card — late results self-discard. */
  const invalidateRewrites = useCallback((cardKey: string) => {
    bumpRewriteGen(cardKey);
    // Drop per-cut flight metadata + per-cut generations for this card
    // alongside UI state.
    for (const k of Object.keys(subFlightMetaRef.current)) {
      if (k === cardKey || k.startsWith(`${cardKey}:`)) {
        delete subFlightMetaRef.current[k];
        delete subGenRef.current[k];
      }
    }
    setRewritingSubs((prev) => {
      const prefix = `${cardKey}:`;
      let changed = false;
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k === cardKey || k.startsWith(prefix)) { changed = true; continue; }
        next[k] = v;
      }
      return changed ? next : prev;
    });
    if (sectionTokenRef.current?.key === cardKey) {
      sectionTokenRef.current = null;
      setRewritingSection(null);
    }
  }, []);

  /** Poison ALL in-flight rewrites — project switch / unmount. Bumps the
   * global epoch so tokens minted before the switch can never equal tokens
   * minted after it, even when the per-card counter restarts at 1. */
  const invalidateAllRewrites = useCallback(() => {
    rewriteEpochRef.current += 1;
    rewriteGenRef.current = {};
    subGenRef.current = {};
    subFlightMetaRef.current = {};
    sectionTokenRef.current = null;
    setRewritingSection(null);
    setRewritingSubs({});
  }, []);

  const isSectionRewriting = useCallback(
    (cardKey: string) => rewritingSection === cardKey,
    [rewritingSection],
  );
  const isSubRewriting = useCallback(
    (cardKey: string, subIdx: number) => rewritingSubs[`${cardKey}:${subIdx}`] !== undefined,
    [rewritingSubs],
  );
  const isSectionLocked = useCallback(
    (cardKey: string) => {
      if (rewritingSection === cardKey) return true;
      const prefix = `${cardKey}:`;
      return Object.keys(rewritingSubs).some((k) => k === cardKey || k.startsWith(prefix));
    },
    [rewritingSection, rewritingSubs],
  );
  const isAnyRewriting = rewritingSection !== null || Object.keys(rewritingSubs).length > 0;

  // Self-contained project-switch guard: the parent also invalidates on id
  // change, but the hook must not depend on that — any mount with a new
  // projectId poisons flights minted under the old project.
  const prevProjIdRef = useRef<string | undefined>(projectId);
  useEffect(() => {
    if (prevProjIdRef.current !== undefined && prevProjIdRef.current !== projectId) {
      invalidateAllRewrites();
      // Full transient edit-session reset: per-card snapshots carry no
      // project identity, so a carried-over editingCard/baseline would let
      // Cancel/Save in the new project operate on the old project's bytes.
      // Transient per-project UI (positional preview keys, upload spinner,
      // pending delete target) must never carry over either.
      setEditingCard(null);
      setOriginalScriptData(null);
      setOriginalManifestData([]);
      originalByCardRef.current = {};
      originalManifestByCardRef.current = {};
      setRewritePrompt('');
      setSavingCardKey(null);
      setSceneToDelete(null);
      pendingRevertWriteRef.current = null;
      setPreviewAssets({});
      setUploadingSubVisual(null);
    }
    prevProjIdRef.current = projectId;
  }, [projectId, invalidateAllRewrites]);

  // Sync localProjectSettings from selectedProject.project_settings,
  // falling back to project column values as base defaults.
  useEffect(() => {
    let base: any = {};
    if (selectedProject) {
      if (selectedProject.tts_engine) base.tts_engine = selectedProject.tts_engine;
      if (selectedProject.tts_voice) base.tts_voice = selectedProject.tts_voice;
      if (selectedProject.language) base.language = selectedProject.language;
    }
    if (selectedProject?.project_settings) {
      try {
        const parsed = JSON.parse(selectedProject.project_settings);
        base = { ...base, ...parsed };
      } catch {
        /* keep base only */
      }
    }
    setLocalProjectSettings(base);
  }, [selectedProject?.project_settings, selectedProject?.id]);

  // Font loading effect
  useEffect(() => {
    if (localProjectSettings.fontFamily) {
      downloadFont(localProjectSettings.fontFamily).then(res => {
        if (res.success && res.css_path) {
          const id = `font-${localProjectSettings.fontFamily.replace(/\s/g, '')}`;
          if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = getMediaUrlSync(res.css_path);
            document.head.appendChild(link);
          }
        }
      }).catch(() => { /* offline — preview falls back to system fonts */ });
    }
  }, [localProjectSettings.fontFamily, downloadFont]);

  // Complex-script font guarantee: KineticText asks for the Noto family by
  // name ('Noto Sans Devanagari', ...) but nothing loads it unless the user
  // picked a font above — Text layers fell back to system fonts with
  // different metrics. Ensure the project language's Noto family on open.
  const settingsLanguage = (localProjectSettings as any).language;
  useEffect(() => {
    const noto = getNotoFamilyForLang(
      selectedProject?.language || settingsLanguage
    );
    if (!noto || noto === localProjectSettings.fontFamily) return;
    downloadFont(noto).then(res => {
      if (res.success && res.css_path) {
        const id = `font-${noto.replace(/\s/g, '')}`;
        if (!document.getElementById(id)) {
          const link = document.createElement('link');
          link.id = id;
          link.rel = 'stylesheet';
          link.href = getMediaUrlSync(res.css_path);
          document.head.appendChild(link);
        }
      }
    }).catch(() => { /* offline — preview falls back to system fonts */ });
  }, [selectedProject?.id, selectedProject?.language, settingsLanguage, localProjectSettings.fontFamily, downloadFont]);

  const handleStartEdit = useCallback((cardKey: string, mode: 'script' | 'visuals') => {
    // Per-card snapshots: switching from dirty Scene A to Scene B snapshots B
    // without touching A's baseline, so cancelling B restores only B and A
    // stays dirty (a session-wide whole-doc snapshot coupled the cards —
    // cancelling B reverted A too).
    const snap = JSON.parse(JSON.stringify(scriptDataRef.current));
    const snapManifest = JSON.parse(JSON.stringify(manifestDataRef.current));
    if (!originalByCardRef.current[cardKey]) {
      originalByCardRef.current[cardKey] = snap;
      originalManifestByCardRef.current[cardKey] = snapManifest;
    }
    // Active card's snapshot drives narration-diffing in handleSaveCard.
    setOriginalScriptData(originalByCardRef.current[cardKey]);
    setOriginalManifestData(originalManifestByCardRef.current[cardKey]);
    if (editingCardRef.current?.key !== cardKey || editingCardRef.current?.mode !== mode) {
      setEditingCard({ key: cardKey, mode });
      setRewritePrompt('');
    }
  }, []);

  /** Copy one card's section from a snapshot doc into a live doc clone. */
  const restoreCardSection = (liveDoc: any, snapshotDoc: any, cardKey: string) => {
    if (cardKey === 'intro' || cardKey === 'introduction') {
      if (snapshotDoc?.introduction) liveDoc.introduction = JSON.parse(JSON.stringify(snapshotDoc.introduction));
      else delete liveDoc.introduction;
    } else if (cardKey === 'conclusion') {
      if (snapshotDoc?.conclusion) liveDoc.conclusion = JSON.parse(JSON.stringify(snapshotDoc.conclusion));
      else delete liveDoc.conclusion;
    } else if (cardKey.startsWith('scene_')) {
      const idx = parseInt(cardKey.replace('scene_', ''), 10);
      if (Number.isInteger(idx) && snapshotDoc?.scenes?.[idx] !== undefined && Array.isArray(liveDoc?.scenes)) {
        liveDoc.scenes[idx] = JSON.parse(JSON.stringify(snapshotDoc.scenes[idx]));
      }
    }
    return liveDoc;
  };

  /** Copy one card's manifest section from a snapshot manifest into a live clone. */
  const restoreManifestSection = (liveManifest: any[], snapshotManifest: any[], cardKey: string) => {
    const next = [...liveManifest];
    if (cardKey === 'intro' || cardKey === 'introduction') {
      const liveIdx = next.findIndex((m: any) => m?.section_type === 'introduction');
      const snapEntry = (snapshotManifest || []).find((m: any) => m?.section_type === 'introduction');
      if (liveIdx !== -1 && snapEntry) next[liveIdx] = JSON.parse(JSON.stringify(snapEntry));
      return next;
    }
    if (cardKey === 'conclusion') {
      const liveIdx = next.map((m: any) => m?.section_type).lastIndexOf('conclusion');
      const snapIdx = (snapshotManifest || []).map((m: any) => m?.section_type).lastIndexOf('conclusion');
      if (liveIdx !== -1 && snapIdx !== -1) next[liveIdx] = JSON.parse(JSON.stringify(snapshotManifest[snapIdx]));
      return next;
    }
    if (cardKey.startsWith('scene_')) {
      const idx = parseInt(cardKey.replace('scene_', ''), 10);
      if (!Number.isInteger(idx)) return next;
      let liveSeen = -1;
      let livePos = -1;
      next.forEach((m: any, i: number) => {
        if (m?.section_type === 'scene') { liveSeen++; if (liveSeen === idx) livePos = i; }
      });
      let snapSeen = -1;
      let snapEntry: any = null;
      (snapshotManifest || []).forEach((m: any) => {
        if (m?.section_type === 'scene') { snapSeen++; if (snapSeen === idx) snapEntry = m; }
      });
      if (livePos !== -1 && snapEntry) next[livePos] = JSON.parse(JSON.stringify(snapEntry));
      return next;
    }
    return next;
  };

  const handleCancelEdit = useCallback(async () => {
    // Per-card revert: restore only the active card's section, never the
    // whole document, so unrelated dirty cards survive.
    const key = editingCardRef.current?.key;
    // Capture identity: the preview-cleanup await below can span a project
    // switch, and the old cancel must not clear the new project's previews.
    const cancelProjectId = projectId;
    const cancelEpoch = rewriteEpochRef.current;
    // Poison this card's in-flight rewrites first so a late LLM result can't
    // land on top of the restored baseline ("revert didn't work").
    if (key) invalidateRewrites(key);
    const snap = key ? originalByCardRef.current[key] : null;
    const snapManifest = key ? originalManifestByCardRef.current[key] : null;
    if (key && snap) {
      const merged = restoreCardSection(
        JSON.parse(JSON.stringify(scriptDataRef.current)),
        snap,
        key,
      );
      setScriptData(merged);
      let restoredManifest: any[] | null = null;
      if (snapManifest) {
        try {
          restoredManifest = restoreManifestSection(
            JSON.parse(JSON.stringify(manifestDataRef.current)),
            snapManifest,
            key,
          );
          setManifestData(restoredManifest);
        } catch { /* script restore already succeeded; manifest best-effort */ }
      }
      delete originalByCardRef.current[key];
      delete originalManifestByCardRef.current[key];
      // A whole-doc persist for THIS project holding the lock may already be
      // writing (or about to publish) the pre-revert doc — stash both sides
      // of the revert so the saver converges correctly (see
      // pendingRevertWriteRef). A lock owned by another project will abort
      // via stale gates and never touches our doc: no stash needed.
      if (cancelProjectId && isSaveActiveFor(cancelProjectId)) {
        try {
          pendingRevertWriteRef.current = {
            projectId: cancelProjectId,
            preDoc: JSON.parse(JSON.stringify(scriptDataRef.current)),
            preManifest: JSON.parse(JSON.stringify(manifestDataRef.current)),
            postDoc: JSON.parse(JSON.stringify(merged)),
            postManifest: restoredManifest
              ? JSON.parse(JSON.stringify(restoredManifest))
              : JSON.parse(JSON.stringify(manifestDataRef.current)),
          };
        } catch { /* stash best-effort; stale gates still protect the UI */ }
      }
    }
    setEditingCard(null);
    setOriginalScriptData(null);
    setOriginalManifestData([]);
    setRewritePrompt('');

    // Cleanup preview assets on cancel — best-effort (temp paths only).
    // Never clear another project's previews if a switch landed mid-cleanup.
    const previewPaths = Object.values(previewAssetsRef.current)
      .filter((a): a is { visual_path: string; visual_url: string } => !!a.visual_path && isTempPreviewFile(a.visual_path))
      .map(a => a.visual_path);
    if (previewPaths.length > 0 && projectId) {
      try {
        await callApi('cleanup_preview_assets', projectId, previewPaths);
      } catch (e) { /* best-effort */ }
    }
    if (cancelProjectId !== projectIdRef.current || cancelEpoch !== rewriteEpochRef.current) return;
    setPreviewAssets({});
  }, [setScriptData, setManifestData, projectId, invalidateRewrites]);

  const handleSettingsUpdate = useCallback((newSettings: any) => {
    setLocalProjectSettings(newSettings);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedProject?.id) {
        await updateProject(selectedProject.id, { project_settings: JSON.stringify(newSettings) });
      }
    }, 1000);
  }, [selectedProject?.id, updateProject]);

  const handleSaveCard = useCallback(async (cardKey?: string, index?: number, latestData?: any) => {
    // Edits apply to state synchronously on every keystroke except the Visuals
    // tab, which debounces high-frequency ticks. Read the ref so Save never
    // misses a trailing commit (setState is async; the render closure would be
    // pre-flush). Callers pass the just-flushed document as latestData when
    // they have it.
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data || !selectedProject?.script_path) return;
    // Internal save lock: EditorWorkspace serializes most saves via
    // enqueueSave, but direct tab saves can still overlap. Never run two
    // whole-document saves for the SAME project concurrently — the slower
    // earlier save would land last and overwrite newer work. A lock owned by
    // a different project/epoch is stale (its tail will abort) and is stolen.
    // Whole-document saves race structural scene edits (insert/delete
    // reindex every later scene): never run a save on a stale structure or
    // start one mid-mutation — either direction can overwrite the other.
    if (structureMutationRef.current) {
      addToast('Structural edit in progress — please save after it finishes.', 'warning');
      return;
    }
    if (isSaveActiveFor(projectId)) {
      addToast('Save already in progress — please wait a moment and retry.', 'warning');
      return;
    }
    const saveOwner = { projectId, epoch: rewriteEpochRef.current };
    saveOwnerRef.current = saveOwner;
    // Own-save quiet window: the card stays open (dirty) for the whole save,
    // so any files-changed event landing mid-save is our own echo — the save
    // tail reconciles via loadFiles, no toast needed (see editorDirty).
    // Scoped to this project: never suppress another project's events.
    markSelfSaveStart(projectId);
    const saveRevision = ++saveRevisionRef.current;
    // Project identity for this save: revision alone can't detect a project
    // switch mid-save (no second save bumps it), so every state mutation
    // after an await below also validates project + epoch.
    const saveProjectId = projectId;
    const saveEpoch = rewriteEpochRef.current;
    const isSaveStale = (): boolean =>
      saveProjectId !== projectIdRef.current || saveEpoch !== rewriteEpochRef.current;
    // Clone-on-write target for finalized compositions (see below). Saves use
    // `working ?? data` so the live state object is never mutated in place.
    let working: any | null = null;

    try {
    if (cardKey) setSavingCardKey(cardKey);

    let narrationChanged = false;
    if (originalScriptData && editingCardRef.current?.mode === 'script') {
      if (cardKey === 'introduction' || cardKey === 'intro') {
        if (data.introduction?.hook !== originalScriptData.introduction?.hook) narrationChanged = true;
      } else if (cardKey === 'conclusion') {
        if (data.conclusion?.summary !== originalScriptData.conclusion?.summary ||
          data.conclusion?.cta !== originalScriptData.conclusion?.cta) narrationChanged = true;
      } else if (index !== undefined && data.scenes && originalScriptData.scenes) {
        if (data.scenes[index]?.narration !== originalScriptData.scenes[index]?.narration) narrationChanged = true;
      }
    }

    const success = await callApi<boolean>('save_json_file', selectedProject.script_path, data);
    // Project switch during the write above: disk already holds this
    // project's doc (correct target), but the UI now belongs to the new
    // project — touch nothing further.
    if (isSaveStale()) return;
    if (success) {
      // Build live manifest
      // NOTE: sceneCounter is only valid during the synchronous map phase
      // below. Each per-scene callback awaits (finalize calls), so any read
      // of sceneCounter AFTER an await sees the fully-incremented total, not
      // this scene's index. Per-callback logic must use the synchronously
      // captured currentSceneIdx instead.
      let sceneCounter = 0;
      const liveManifest = await Promise.all(manifestData.map(async (manifestScene: any, mIdx: number) => {
        const type = manifestScene.section_type;
        let liveSubVisuals: any[] = [];
        let assetKeyPrefix: string;
        let currentSceneIdx = -1;
        if (type === 'introduction' && data?.introduction) {
          liveSubVisuals = data.introduction?.sub_visuals || [];
          assetKeyPrefix = 'intro';
        } else if (type === 'conclusion' && data?.conclusion) {
          liveSubVisuals = data.conclusion?.sub_visuals || [];
          assetKeyPrefix = 'conclusion';
        } else if (type === 'scene' && Array.isArray(data?.scenes)) {
          currentSceneIdx = sceneCounter++;
          const scriptScene = data.scenes[currentSceneIdx];
          if (scriptScene) liveSubVisuals = scriptScene?.sub_visuals || [];
          assetKeyPrefix = `scene_${currentSceneIdx}`;
        } else {
          assetKeyPrefix = '';
        }

        const origSubVisuals = manifestScene.sub_visuals || [];
        // Match by content (type+cue) rather than by index,
        // so inserted/deleted sub-visuals don't shift existing assets
        const matchedIndices = new Set<number>();
        const ensureWorking = () => {
          if (!working) working = JSON.parse(JSON.stringify(data));
          return working;
        };
        const mergedSubVisuals = await Promise.all(liveSubVisuals.map(async (lsv: any, sIdx: number) => {
          let updatedComposition = lsv.composition;
          let cutVisualPath: string | undefined = undefined;
          let cutVisualUrl: string | undefined = undefined;

          if (assetKeyPrefix) {
            const cutAssetKey = `${assetKeyPrefix}_${sIdx}`;
            const cutPreview = previewAssets[cutAssetKey];

            // 1. Cut-level fallback: for single-asset legacy cuts or cut-level previews.
            // Reserve this cut's own orig entry (positional-first) so the
            // matcher below can't hand this cut's old asset to a neighbor.
            // Key-first reservation swaps neighbors when duplicate keys share
            // one cue (all empty cues collapse to one key).
            if (cutPreview?.visual_path) {
              const lsvKeyForPreview = subVisualKey(liveSubVisuals[sIdx]);
              let origIdx = findUnmatchedOrigIndex(
                lsvKeyForPreview,
                sIdx,
                origSubVisuals,
                matchedIndices,
              );
              if (origIdx === -1) {
                origIdx = origSubVisuals.findIndex((_: any, i: number) =>
                  !matchedIndices.has(i)
                );
              }
              if (origIdx !== -1) matchedIndices.add(origIdx);

              let finalCutPath = cutPreview.visual_path;
              if (finalCutPath.includes('previews') || finalCutPath.includes('preview_') || finalCutPath.includes('upload_')) {
                const result = await callApi<any>('finalize_upload_asset', projectId, cutPreview.visual_path, mIdx, sIdx, -1);
                if (result?.success && result.visual_path) {
                  finalCutPath = result.visual_path;
                } else {
                  console.warn(`[useScriptEditing] finalize cut preview failed for ${assetKeyPrefix}_${sIdx}:`, result?.error || 'unknown error', cutPreview.visual_path);
                }
              }
              cutVisualPath = finalCutPath;
              cutVisualUrl = cutPreview.visual_url;
            }

            // 2. Process multi-layer AST composition: finalize every layer independently!
            if (updatedComposition && Array.isArray(updatedComposition.children)) {
              let compositionChanged = false;
              const mediaLayers = updatedComposition.children.filter((l: any) => l?.content?.type === 'Image' || l?.content?.type === 'Video');
              const updatedChildren = await Promise.all(updatedComposition.children.map(async (layer: any, lIdx: number) => {
                if (!layer?.content) return layer;
                const isMedia = layer.content.type === 'Image' || layer.content.type === 'Video';
                const layerAssetKey = `${assetKeyPrefix}_${sIdx}_${lIdx}`;
                const layerPreview = previewAssets[layerAssetKey];

                const isBlankNewLayer = !layer.content.local_path && (!layer.content.query || !layer.content.query.trim());
                const isSingleMediaLayer = mediaLayers.length === 1 && isMedia;
                // If a cut-level preview was already finalized for a single-media-layer cut, reuse finalCutPath to avoid writing two copies on disk.
                // Guard: blank newly-added layers must never inherit a stale layerPreview or cutPreview.
                const previewForLayer = (!isBlankNewLayer && layerPreview) || (
                  cutPreview?.visual_path && isMedia && !isBlankNewLayer && (
                    cutPreview.layerIdx === lIdx ||
                    layer.content.local_path === cutPreview.visual_path ||
                    (cutPreview.layerIdx === undefined && isSingleMediaLayer)
                  )
                    ? (cutVisualPath ? { visual_path: cutVisualPath, visual_url: cutVisualUrl } : cutPreview)
                    : undefined
                );

                let currentPath = previewForLayer?.visual_path || layer.content.local_path;
                if (isMedia && currentPath && (currentPath.includes('previews') || currentPath.includes('preview_') || currentPath.includes('upload_'))) {
                  const result = await callApi<any>('finalize_upload_asset', projectId, currentPath, mIdx, sIdx, lIdx);
                  if (result?.success && result.visual_path) {
                    currentPath = result.visual_path;
                  } else {
                    console.warn(`[useScriptEditing] finalize layer failed for ${layerAssetKey}:`, result?.error || 'unknown error', currentPath);
                  }
                }

                // STRICT: save only persists local_path changes. Never silently
                // flip content.type here — uploads/previews are validated at the
                // editor (AstGraphicalEditor) and at the backend dialog. A
                // mismatch here means legacy/manual-JSON data: keep the declared
                // type so the change is visible, let ASTRenderer's display-time
                // effectiveType handle playback without mutating user data.
                if (isMedia && currentPath) {
                  const sniffed = inferMediaType(currentPath, layer.content.type);
                  if (sniffed !== layer.content.type) {
                    console.warn(
                      `[useScriptEditing] type mismatch kept as '${layer.content.type}' (file looks like '${sniffed}'): ${currentPath}. ` +
                      `Change the layer type instead of relying on auto-flip.`
                    );
                  }
                }

                if (currentPath && currentPath !== layer.content.local_path) {
                  compositionChanged = true;
                  return {
                    ...layer,
                    content: {
                      ...layer.content,
                      local_path: currentPath
                    }
                  };
                }
                return layer;
              }));

              if (compositionChanged) {
                updatedComposition = { ...updatedComposition, children: updatedChildren };
              }
            }
          }

          // Propagate updated composition to working document
          if (updatedComposition !== lsv.composition) {
            const doc = ensureWorking();
            if (type === 'introduction' && doc?.introduction?.sub_visuals?.[sIdx]) {
              doc.introduction.sub_visuals[sIdx] = { ...doc.introduction.sub_visuals[sIdx], composition: updatedComposition };
            } else if (type === 'conclusion' && doc?.conclusion?.sub_visuals?.[sIdx]) {
              doc.conclusion.sub_visuals[sIdx] = { ...doc.conclusion.sub_visuals[sIdx], composition: updatedComposition };
            } else if (type === 'scene' && Array.isArray(doc?.scenes)) {
              if (currentSceneIdx >= 0 && doc.scenes[currentSceneIdx]?.sub_visuals?.[sIdx]) {
                doc.scenes[currentSceneIdx].sub_visuals[sIdx] = { ...doc.scenes[currentSceneIdx].sub_visuals[sIdx], composition: updatedComposition };
              }
            }
          }

          if (cutVisualPath) {
            return { ...lsv, composition: updatedComposition, visual_path: cutVisualPath, visual_url: cutVisualUrl };
          }

          // Match 1:1 positional-first, then by stable content key (id
          // preferred, else type+cue). Positional-first keeps the common
          // no-insert/delete save exact and keeps duplicate keys in order;
          // the key search only handles genuine insert/delete shifts. An
          // edited cue, inserted cut, or deleted cut finds no peer (-1) and
          // must NOT inherit a neighbor's asset; unmatched cuts fall through
          // to the clean-entry path below so fetch_single_scene_asset fires.
          const lsvKey = subVisualKey(lsv);
          const matchIdx = findUnmatchedOrigIndex(
            lsvKey,
            sIdx,
            origSubVisuals,
            matchedIndices,
          );
          if (matchIdx !== -1) {
            matchedIndices.add(matchIdx);
            const match = origSubVisuals[matchIdx];
            return {
                ...lsv,
                visual_path: match.visual_path,
                visual_url: match.visual_url,
                composition: updatedComposition || match.composition
            };
          }
          // New or changed sub-visual — strip any stale visual_path/visual_url
          // that scriptData may have carried over from a previous pipeline run,
          // so the manifest is clean and fetch_single_scene_asset is always triggered.
          return { ...lsv, composition: updatedComposition, visual_path: undefined, visual_url: undefined };
        }));

        const sceneText = type === 'introduction' ? data?.introduction?.hook
          : type === 'conclusion' ? data?.conclusion?.summary
            : (currentSceneIdx >= 0 ? data?.scenes?.[currentSceneIdx]?.narration : undefined);
        const sceneDuration = manifestScene.duration > 0 ? manifestScene.duration : estimateTextDuration(sceneText);

        return { ...manifestScene, duration: sceneDuration, sub_visuals: mergedSubVisuals };
      }));

      // Final persistence MUST start from the latest editor state, never the
      // entry snapshot: asset finalization above can take seconds while the
      // user keeps typing. Merge finalized compositions from `working` into
      // the latest doc, then persist that. Disk can never regress to `data`.
      const patchSubs = (liveSubs: any[] | undefined, savedSubs: any[] | undefined) => {
        if (!Array.isArray(liveSubs)) return liveSubs;
        if (!Array.isArray(savedSubs)) return liveSubs;
        // `working` and the latest doc share ancestry (finalization takes
        // seconds while the user types), so the common no-insert/delete case
        // is positional: same length → same order → index graft. A first-wins
        // Map keyed by type+cue broadcasts one cut's composition across every
        // duplicate key (empty cues are all identical) — that is the
        // edit-one-cut → all-cuts-duplicated bug. Only when lengths diverge
        // (insert/delete mid-save) fall back to 1:1 key matching with a used
        // set so duplicates distribute instead of broadcasting.
        if (liveSubs.length === savedSubs.length) {
          return liveSubs.map((live: any, i: number) =>
            savedSubs[i]?.composition !== undefined
              ? { ...live, composition: savedSubs[i].composition }
              : live,
          );
        }
        const usedSaved = new Set<number>();
        return liveSubs.map((live: any, liveIdx: number) => {
          const found = findUnmatchedOrigIndex(
            subVisualKey(live),
            liveIdx,
            savedSubs,
            usedSaved,
          );
          if (found !== -1) {
            usedSaved.add(found);
            return savedSubs[found]?.composition !== undefined
              ? { ...live, composition: savedSubs[found].composition }
              : live;
          }
          return live;
        });
      };
      const latestForSave = JSON.parse(JSON.stringify(scriptDataRef.current));
      let finalData: any = latestForSave;
      if (working) {
        try {
          if (working.introduction && finalData.introduction) {
            finalData.introduction = {
              ...finalData.introduction,
              sub_visuals: patchSubs(finalData.introduction.sub_visuals, working.introduction.sub_visuals),
            };
          }
          if (working.conclusion && finalData.conclusion) {
            finalData.conclusion = {
              ...finalData.conclusion,
              sub_visuals: patchSubs(finalData.conclusion.sub_visuals, working.conclusion.sub_visuals),
            };
          }
          if (Array.isArray(working.scenes) && Array.isArray(finalData.scenes)) {
            // Index mapping is only safe when no structural scene edit
            // (insert/delete) happened mid-save. When lengths diverge, fall
            // back to title-anchored matching; unmatched scenes keep their
            // live composition (safer to refetch than to misattribute).
            if (working.scenes.length === finalData.scenes.length) {
              finalData.scenes = finalData.scenes.map((liveScene: any, i: number) => (
                working.scenes[i]
                  ? { ...liveScene, sub_visuals: patchSubs(liveScene.sub_visuals, working.scenes[i].sub_visuals) }
                  : liveScene
              ));
            } else {
              // Lengths diverged mid-save (scene insert/delete raced the
              // save). Title-anchored 1:1 matching with a used set so
              // duplicate titles distribute in order instead of broadcasting
              // the first match across every same-titled scene (the scene-level
              // variant of the first-cut-duplication bug). Unmatched scenes
              // keep their live composition (safer to refetch than to
              // misattribute).
              const usedScenes = new Set<number>();
              finalData.scenes = finalData.scenes.map((liveScene: any) => {
                const liveTitle = String(liveScene?.title ?? '');
                const found = working.scenes.findIndex(
                  (ws: any, i: number) =>
                    !usedScenes.has(i) && String(ws?.title ?? '') === liveTitle && liveTitle !== '',
                );
                if (found === -1) return liveScene;
                usedScenes.add(found);
                return { ...liveScene, sub_visuals: patchSubs(liveScene.sub_visuals, working.scenes[found].sub_visuals) };
              });
            }
          }
        } catch { finalData = working; }
      }
      // Rebase the manifest text/duration onto the final doc so a narration
      // edit typed mid-save isn't persisted with a stale duration. Asset
      // fields (visual_path/url/composition) carry over by content key;
      // unmatched (new/edited/inserted) cuts fall back to clean entries that
      // trigger a fetch instead of inheriting a neighbor's asset by index.
      const rebasedManifest = liveManifest.map((m: any, mIdx: number) => {
        const mType = normalizeSectionType(m?.section_type);
        let sceneCounterForText = 0;
        for (let k = 0; k < mIdx; k++) {
          if (normalizeSectionType(liveManifest[k]?.section_type) === 'scene') sceneCounterForText++;
        }
        const finalText = mType === 'introduction' ? finalData?.introduction?.hook
          : mType === 'conclusion' ? finalData?.conclusion?.summary
          : (finalData?.scenes?.[sceneCounterForText]?.narration as string | undefined);
        const finalSubs: any[] = mType === 'introduction'
          ? (finalData?.introduction?.sub_visuals || [])
          : mType === 'conclusion'
            ? (finalData?.conclusion?.sub_visuals || [])
            : (finalData?.scenes?.[sceneCounterForText]?.sub_visuals || []);
        const savedSubs: any[] = Array.isArray(m?.sub_visuals) ? m.sub_visuals : [];
        const usedSaved = new Set<number>();
        const mergedSubs = finalSubs.map((fs: any, fsIdx: number) => {
          const found = findUnmatchedOrigIndex(
            subVisualKey(fs),
            fsIdx,
            savedSubs,
            usedSaved,
          );
          if (found !== -1) {
            usedSaved.add(found);
            const saved = savedSubs[found];
            return { ...fs, visual_path: saved.visual_path, visual_url: saved.visual_url, composition: saved.composition ?? fs.composition };
          }
          return { ...fs, visual_path: undefined, visual_url: undefined };
        });
        const duration = typeof m?.duration === 'number' && m.duration > 0 ? m.duration : estimateTextDuration(finalText);
        return { ...m, text: finalText ?? m.text, duration, sub_visuals: mergedSubs };
      });

      // A newer save may have started (and finished) while we were awaiting
      // finalization — never let this older revision land last. A project
      // switch is equally terminal: revision alone can't see it.
      // Snapshot signatures: everything below (persist, fetch × N, loadFiles)
      // spans long awaits during which the user keeps editing. The doc must
      // never be reloaded/published from this snapshot once the live refs
      // moved past it — that is the remaining data-loss race.
      const snapDocSig = safeDocSig(scriptDataRef.current);
      const snapManSig = safeDocSig(manifestDataRef.current);
      const docMovedSinceSnapshot = (): boolean => {
        try {
          return safeDocSig(scriptDataRef.current) !== snapDocSig
            || safeDocSig(manifestDataRef.current) !== snapManSig;
        } catch {
          return true;
        }
      };
      // Revert-convergence tail (shared by the pre- and post-fetch
      // checkpoints): converge disk to the revert point (or newer live state)
      // and publish it — never loadFiles()/finalData over it. Returns true
      // when the caller must return (converged, loudly or not).
      const convergeTail = async (): Promise<boolean> => {
        const docs = (!isSaveStale() && pendingRevertWriteRef.current?.projectId === saveProjectId)
          ? resolveConvergeDocs(saveProjectId)
          : null;
        if (!docs) return false;
        let ok = false;
        try {
          const convergeRes = await callApi<any>(
            'save_project_with_cleanup', saveProjectId, docs.doc, docs.manifest,
          );
          ok = !convergeRes || convergeRes.success !== false;
        } catch (convergeErr) {
          console.error('Save revert-convergence persist failed:', convergeErr);
        }
        if (!ok) {
          // UI is already reverted; disk is not provably converged. Keep the
          // stash for the next Save, keep baselines, and do NOT publish
          // finalData over the reverted UI.
          addToast('Reverted locally, but disk sync failed — press Save to retry.', 'warning', 8000);
          return true;
        }
        pendingRevertWriteRef.current = null;
        try {
          setScriptData(JSON.parse(JSON.stringify(docs.doc)));
        } catch {
          setScriptData(docs.doc);
        }
        try {
          setManifestData(JSON.parse(JSON.stringify(docs.manifest)));
        } catch {
          setManifestData(docs.manifest);
        }
        // Disk == converged UI: baselines are stale. Preview wipe is skipped
        // (the Revert owned it; the closure snapshot predates it). editingCard
        // is left alone — the user may already be editing elsewhere.
        originalByCardRef.current = {};
        originalManifestByCardRef.current = {};
        setRewritePrompt('');
        addToast("Project saved successfully!", 'success');
        return true;
      };
      // Soft landing for "user edited after our snapshot": disk holds the
      // snapshot, the UI is newer — keep the UI, keep dirty state, and say so.
      const softLandTail = (): void => {
        addToast('Project saved — newer edits arrived during saving and were kept. Press Save again to persist them.', 'warning', 8000);
      };
      if (saveRevision !== saveRevisionRef.current || isSaveStale()) return;
      const saveResult = await callApi<any>('save_project_with_cleanup', projectId, finalData, rebasedManifest);
      // The persist await above can span a project switch — publishing the
      // old project's manifest snapshot, promoted paths, or follow-up
      // downloads into the new project must not happen.
      if (saveRevision !== saveRevisionRef.current || isSaveStale()) return;
      // Convergence owns the tail and must run BEFORE loadFiles (which would
      // rewrite the refs resolveConvergeDocs depends on and clobber newer UI).
      if (await convergeTail()) return;
      if (docMovedSinceSnapshot()) {
        softLandTail();
        return;
      }
      // Keep the in-memory manifest snapshot in sync with what was persisted.
      for (let i = 0; i < liveManifest.length && i < rebasedManifest.length; i++) {
        liveManifest[i] = rebasedManifest[i];
      }

      // The backend promotes transient previews/ refs into assets/ during the
      // save (in its own copy) and returns the src -> dest mapping. Mirror
      // that mapping into the local `working` / `liveManifest` snapshots
      // BEFORE patchCompositions below — otherwise the patch writes stale
      // previews/ local_paths back into React state, reverting the just-saved
      // promoted paths while the preview files are being deleted.
      const promotedMap = saveResult?.promoted_assets;
      if (promotedMap && typeof promotedMap === 'object' && Object.keys(promotedMap).length > 0) {
        const rewritePromotedRefs = (node: any): void => {
          if (Array.isArray(node)) {
            node.forEach(rewritePromotedRefs);
            return;
          }
          if (node && typeof node === 'object') {
            for (const key of ['local_path', 'visual_path']) {
              const v = (node as any)[key];
              if (typeof v === 'string' && typeof promotedMap[v] === 'string') {
                (node as any)[key] = promotedMap[v];
              }
            }
            for (const v of Object.values(node)) rewritePromotedRefs(v);
          }
        };
        if (working) rewritePromotedRefs(working);
        rewritePromotedRefs(finalData);
        rewritePromotedRefs(liveManifest);
      }

      // Fetch assets only for genuinely new/changed sub-visuals
      const origManifest = originalManifestData && originalManifestData.length > 0 ? originalManifestData : manifestData;
      let assetDownloadFailures = 0;
      // Build set of (manifestIdx, subIdx) that already have a file from upload/preview
      const handledFromPreview = new Set<string>();
      for (const [key, value] of Object.entries(previewAssets)) {
        if (value?.visual_path) {
          handledFromPreview.add(key);
        }
      }
      // Iterate what was actually persisted (rebasedManifest — liveManifest
      // was synced to it above) so a cut added to finalData mid-save can't
      // miss its fetch via a stale snapshot.
      for (let mIdx = 0; mIdx < rebasedManifest.length; mIdx++) {
        const liveSubs = rebasedManifest[mIdx].sub_visuals || [];
        const origSubs = origManifest[mIdx]?.sub_visuals || [];
        const matchedOrigIndices = new Set<number>();
        for (let sIdx = 0; sIdx < liveSubs.length; sIdx++) {
          // Skip download if this sub-visual was handled via upload/preview.
          // Count 'scene' entries before mIdx (same convention as
          // manifestToScriptSceneIndex) so a missing/stale intro can't shift
          // scene_N keys.
          let scriptIdxForKey = 0;
          for (let k = 0; k < mIdx; k++) {
            if (rebasedManifest[k]?.section_type === 'scene') scriptIdxForKey++;
          }
          const sectionKey = rebasedManifest[mIdx].section_type === 'introduction' ? 'intro'
            : rebasedManifest[mIdx].section_type === 'conclusion' ? 'conclusion'
            : `scene_${scriptIdxForKey}`;
          const assetKey = `${sectionKey}_${sIdx}`;
          const isHandled = handledFromPreview.has(assetKey) || Array.from(handledFromPreview).some(k => k.startsWith(`${assetKey}_`));
          if (isHandled) {
            continue;
          }
          const liveKey = subVisualKey(liveSubs[sIdx]);
          // Positional-first 1:1 match. A cue edit/insert/delete that finds
          // no unmatched peer is genuinely new and must download.
          const origMatch = findUnmatchedOrigIndex(
            liveKey,
            sIdx,
            origSubs,
            matchedOrigIndices,
          );
          if (origMatch === -1) {
            try {
              const result = await callApi<any>('fetch_single_scene_asset', projectId, mIdx, sIdx);
              if (!result?.success) {
                assetDownloadFailures++;
                console.warn(`Asset download failed for [${mIdx}:${sIdx}]: ${result?.error || 'Unknown error'}`);
              }
            } catch (e) {
              assetDownloadFailures++;
              console.error("Failed to fetch asset", sIdx, e);
            }
          } else {
            matchedOrigIndices.add(origMatch);
          }
        }
      }

      // Re-check after the long fetch loop: a revert or fresh edits may have
      // landed during it. Convergence first (it needs the pre-loadFiles refs
      // and must publish instead of loadFiles), then the moved soft-land —
      // loadFiles must never run once the doc moved past our snapshot.
      if (saveRevision !== saveRevisionRef.current || isSaveStale()) return;
      if (await convergeTail()) return;
      if (docMovedSinceSnapshot()) {
        softLandTail();
        return;
      }
      // loadFiles(projectId) reloads THIS save's project into shared state —
      // never fire it after a switch; it would clobber the new project.
      const reloaded = await loadFiles(projectId);
      // The final gate before publishing: setScriptData, baseline resets,
      // setEditingCard(null), and preview cleanup all belong to the saved
      // project and to the unchanged-since-snapshot doc — never to whatever
      // project is open now, and never over newer edits.
      if (saveRevision !== saveRevisionRef.current || isSaveStale()) return;
      if (docMovedSinceSnapshot()) {
        // loadFiles() just pulled this save's disk state into shared state:
        // an idle editor's refs converge to exactly what was reloaded, which
        // legitimately differs from the pre-save snapshot (promoted asset
        // paths, freshly downloaded visuals). That reload landing is NOT a
        // user edit. Only soft-land when live matches NEITHER the snapshot
        // NOR the reloaded disk state — that combination is genuine mid-save
        // typing. (If the reload hasn't re-rendered yet, live still equals
        // the snapshot and this passes the same way.)
        const liveDocSig = safeDocSig(scriptDataRef.current);
        const liveManSig = safeDocSig(manifestDataRef.current);
        const diskDocSig = safeDocSig(reloaded?.script);
        const diskManSig = safeDocSig(reloaded?.manifest);
        const docSettled = liveDocSig === snapDocSig || liveDocSig === diskDocSig;
        const manSettled = liveManSig === snapManSig || liveManSig === diskManSig;
        if (!docSettled || !manSettled) {
          softLandTail();
          return;
        }
      }
      // finalData already IS the latest doc plus finalized compositions, so
      // the script state sync is a direct write (with promoted paths already
      // mirrored). Manifest state is deliberately NOT overwritten here:
      // fetch_single_scene_asset calls above wrote fresh visual_path entries
      // to disk and loadFiles() just reloaded them — clobbering with the
      // pre-fetch liveManifest would wipe newly downloaded assets from the UI.
      // Reachable only when the doc is provably unchanged since the snapshot.
      try {
        setScriptData(JSON.parse(JSON.stringify(finalData)));
      } catch {
        setScriptData(finalData);
      }
      // Whole document persisted — all per-card baselines are now stale.
      originalByCardRef.current = {};
      originalManifestByCardRef.current = {};
      setEditingCard(null);
      setSavingCardKey(null);
      setRewritePrompt('');

      // Cleanup preview assets after save — best-effort (temp paths only).
      // Reachable only on the clean full path (converge/soft-land return
      // earlier with their own preview handling), so the closure snapshot is
      // current here.
      const savedPreviewPaths = Object.values(previewAssets)
        .filter((a): a is { visual_path: string; visual_url: string } => !!a.visual_path && isTempPreviewFile(a.visual_path))
        .map(a => a.visual_path);
      if (savedPreviewPaths.length > 0 && projectId) {
        callApi('cleanup_preview_assets', projectId, savedPreviewPaths).catch(() => {});
      }
      setPreviewAssets({});

      const isNewSceneSave = index !== undefined && !originalScriptData;
      const contentChanged = narrationChanged || isNewSceneSave;
      if (contentChanged) {
        addToast("Narration text updated!", 'success');
      } else {
        addToast("Project saved successfully!", 'success');
      }

      if (assetDownloadFailures > 0) {
        addToast(`${assetDownloadFailures} sub-visual(s) failed to download. Old visuals preserved as fallback.`, 'warning', 6000);
      }
    } else {
      setSavingCardKey(null);
      addToast("Failed to save script changes", 'error');
    }
    } catch (e) {
      console.error('handleSaveCard failed:', e);
      addToast("Failed to save script changes", 'error');
    } finally {
      // The spinner is cleared for our own revision and the lock released
      // only if still ours (a new project may have stolen it) — a throw
      // anywhere above must never leave the editor permanently locked.
      // Always close the self-save quiet window, even on early stale returns.
      markSelfSaveEnd(projectId);
      if (saveRevision === saveRevisionRef.current) {
        setSavingCardKey(null);
      }
      if (saveOwnerRef.current === saveOwner) {
        saveOwnerRef.current = null;
      }
    }
  }, [projectId, selectedProject, originalScriptData, originalManifestData, manifestData, loadFiles, addToast, previewAssets, setScriptData, setManifestData]);

  const handleRewriteSection = useCallback(async (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data || !selectedProject?.script_path) return;
    const normalizedType = normalizeSectionType(type);
    // Explicit intent wins: the Visuals tab passes 'visuals' so a fast
    // open → rewrite can't race the post-render effect that sets
    // editingCard.mode.
    const effectiveMode = modeOverride ?? editingCardRef.current?.mode;

    const cardKey = rewriteCardKey(type, index);
    const sectionKey = cardKey;
    // Single-flight guard: a section rewrite replaces whole arrays, so it
    // must never run concurrently with any other rewrite. Per-cut rewrites
    // on other cards may run concurrently with each other (guarded per-card).
    if (sectionTokenRef.current || Object.keys(rewritingSubsRef.current).length > 0 || structureMutationRef.current) {
      addToast('Another AI operation is already running — wait for it to finish.', 'warning');
      return undefined;
    }
    // Generation + epoch + project: a newer rewrite, a Revert, or a project
    // switch invalidates this flight and its completion self-discards.
    const token = bumpRewriteGen(cardKey);
    const flight = { token, epoch: rewriteEpochRef.current, projectId };
    sectionTokenRef.current = { key: sectionKey, ...flight };
    setRewritingSection(sectionKey);
    const clearOwnEntry = () => {
      if (sectionTokenRef.current?.key === sectionKey && sectionTokenRef.current?.token === token
        && sectionTokenRef.current?.epoch === flight.epoch
        && sectionTokenRef.current?.projectId === flight.projectId) {
        sectionTokenRef.current = null;
        setRewritingSection(null);
      }
    };

    try {
      let res;
      const isNewScene = normalizedType === 'scene' && data.scenes?.[index] &&
        (!data.scenes[index].narration || data.scenes[index].narration.trim() === '');
      const isNewIntroduction = normalizedType === 'introduction' &&
        (!data.introduction?.hook || data.introduction?.hook.trim() === '');
      const isNewConclusion = normalizedType === 'conclusion' &&
        (!data.conclusion?.summary || data.conclusion?.summary.trim() === '');

      if (isNewScene) {
        res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
          'add_scene_with_ai', data,
          rewritePrompt || `Create content for ${data.scenes[index].title || 'this scene'}`,
          selectedProject.language
        );
      } else {
        if (effectiveMode === 'visuals') {
          res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_visuals_section', projectId, index, normalizedType, data, rewritePrompt
          );
        } else {
          res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_script_section', index, normalizedType, data, rewritePrompt, selectedProject.language
          );
        }
      }

      // Stale gate: superseded by a newer rewrite, a Revert, or project switch.
      if (isFlightStale(cardKey, flight)) {
        addToast('Discarded stale AI result — a newer rewrite, revert, or project switch superseded it.', 'info');
        return undefined;
      }

      if (res?.success && res.data) {
        const isVisualsRewrite = effectiveMode === 'visuals' && !isNewScene;
        if (isVisualsRewrite) {
          // Preview-only: hand the AI sub_visuals back to the caller (Visuals
          // tab) WITHOUT touching scriptData or disk. The tab applies them to
          // local state (visible instantly in player/timeline/editor); the
          // user then Saves to persist or Reverts to discard.
          setRewritePrompt('');
          addToast("AI visuals applied — review in the player, then Save or Revert.", 'success');
          return res.data.sub_visuals || [];
        } else {
          // Script rewrite returns the whole section (without sub_visuals by default now)
          // We need to merge existing sub_visuals back in if this wasn't a new scene
          const newSection = res.data;
          // Merge into the LATEST doc — not the pre-flight snapshot — so edits
          // made anywhere (including other sections) during the 30–60s
          // generation window survive instead of being whole-doc clobbered.
          const latest = JSON.parse(JSON.stringify(scriptDataRef.current));
          let oldSubVisuals = [];
          if (normalizedType === 'introduction') oldSubVisuals = latest.introduction?.sub_visuals || [];
          else if (normalizedType === 'conclusion') oldSubVisuals = latest.conclusion?.sub_visuals || [];
          else if (!isNewScene) oldSubVisuals = latest.scenes?.[index]?.sub_visuals || [];

          newSection.sub_visuals = oldSubVisuals;

          if (normalizedType === 'introduction') latest.introduction = newSection;
          else if (normalizedType === 'conclusion') latest.conclusion = newSection;
          else if (Array.isArray(latest.scenes) && (latest.scenes[index] !== undefined || isNewScene)) {
            latest.scenes[index] = newSection;
          }
          // Optimistic publish (synchronous with the stale gate above — no
          // await in between, so a project switch cannot interleave before
          // these land; a switch during the persist await below is caught by
          // the second stale gate, and the new project's load overwrites).
          // Deferred publish would hide the AI result for the persist
          // round-trip with no safety gain, so script + manifest stay paired.
          setScriptData(latest);

          if (isNewScene || isNewIntroduction || isNewConclusion) {
            setRewritePrompt('');
            addToast("AI content generated! Review and click Save to fetch visuals.", 'success');
          } else {
            // Single atomic persist: save_project_with_cleanup writes the
            // script itself, so no separate save_json_file first — one disk
            // write keeps script + manifest (text/duration) in sync. The
            // persist serializes on the shared save mutex: without it an AI
            // auto-save and a manual Save interleave two whole-doc writes.
            let aiPersistOk = false;
            // Whole-doc persist lock, held across the stale-gated write-back
            // below so revert convergence can't interleave a third write.
            let aiPersistHeld = false;
            let aiOwner: { projectId: string | undefined; epoch: number } | null = null;
            try {
              const nextManifest = JSON.parse(JSON.stringify(manifestDataRef.current));
              const newText = normalizedType === 'introduction'
                ? (newSection.hook as string | undefined)
                : normalizedType === 'conclusion'
                  ? (newSection.summary as string | undefined)
                  : (newSection.narration as string | undefined);
              const newDuration = estimateTextDuration(newText);
              if (normalizedType === 'introduction') {
                const mi = nextManifest.findIndex((m: any) => m?.section_type === 'introduction');
                if (mi !== -1) nextManifest[mi] = { ...nextManifest[mi], text: newText ?? nextManifest[mi].text, duration: newDuration };
              } else if (normalizedType === 'conclusion') {
                const mi = nextManifest.map((m: any) => m?.section_type).lastIndexOf('conclusion');
                if (mi !== -1) nextManifest[mi] = { ...nextManifest[mi], text: newText ?? nextManifest[mi].text, duration: newDuration };
              } else {
                let seen = -1;
                for (let mi = 0; mi < nextManifest.length; mi++) {
                  if (nextManifest[mi]?.section_type === 'scene') {
                    seen++;
                    if (seen === index) {
                      nextManifest[mi] = { ...nextManifest[mi], text: newText ?? nextManifest[mi].text, duration: newDuration };
                      break;
                    }
                  }
                }
              }
              // Paired with the optimistic setScriptData above (same atomic
              // block — see note there). Moved-after-persist would split
              // script/manifest publishing with no safety gain.
              setManifestData(nextManifest);
              if (isSaveActiveFor(projectId) || structureMutationRef.current) {
                // A manual save (or structural write) owns the disk right
                // now — never stack a second whole-doc write. The AI result
                // is already visible optimistically; the user persists it
                // with Save. No disk write happened, so no revert
                // convergence is owed below.
                addToast("AI rewrite ready — another save is running, press Save to persist it.", 'warning');
              } else {
                aiOwner = { projectId, epoch: rewriteEpochRef.current };
                saveOwnerRef.current = aiOwner;
                aiPersistHeld = true;
                // AI auto-persist is a whole-doc writer like handleSaveCard:
                // mark the same quiet window so its echo never toasts while
                // the user holds another card dirty.
                markSelfSaveStart(projectId);
                try {
                  const persistRes = await callApi<any>('save_project_with_cleanup', projectId, latest, nextManifest);
                  if (persistRes && persistRes.success === false) throw new Error(persistRes.error || 'AI persist failed');
                  aiPersistOk = true;
                } catch (persistErr) {
                  console.error('AI rewrite persist failed:', persistErr);
                  addToast("Rewrite generated but persist failed — review and Save manually.", 'warning');
                }
                // Second stale gate: the persist await above can take seconds.
                // Project switch → discard (the new project's load owns the UI).
                // Same-project stale (Revert / superseding rewrite) → our just
                // persisted AI version is on disk while the UI moved on: while
                // still holding the mutex, converge disk back to the current UI
                // state. Frontend-only convergence cannot cover a backend crash
                // between the two writes — that needs server-side conditional
                // writes — but it closes the normal revert-during-persist race.
                const switchedProject =
                  flight.projectId !== projectIdRef.current || flight.epoch !== rewriteEpochRef.current;
                if (switchedProject) {
                  return undefined;
                }
                if (isFlightStale(cardKey, flight)) {
                  // Convergence target: the stashed revert point when the
                  // live refs never flushed past the revert, else the live
                  // refs (revert + any later edits). Never blindly either.
                  const converge = resolveConvergeDocs(flight.projectId) ?? {
                    doc: scriptDataRef.current, manifest: manifestDataRef.current,
                  };
                  let converged = false;
                  try {
                    const convergeRes = await callApi<any>(
                      'save_project_with_cleanup',
                      flight.projectId,
                      JSON.parse(JSON.stringify(converge.doc)),
                      JSON.parse(JSON.stringify(converge.manifest)),
                    );
                    converged = !convergeRes || convergeRes.success !== false;
                  } catch (convergeErr) {
                    console.error('AI revert-convergence persist failed:', convergeErr);
                  }
                  if (!converged) {
                    // Disk may still hold the AI version while the UI shows
                    // the revert — say so loudly and keep the stash so the
                    // next manual Save retries convergence. Baselines are
                    // left alone: nothing is safely persisted.
                    addToast('Revert applied locally, but disk sync failed — press Save to retry.', 'warning', 8000);
                    return undefined;
                  }
                  // Disk now matches the converged UI. Drop only this
                  // flight's baseline — never touch editingCard, other
                  // cards' baselines, or success toasts: the user may already
                  // be editing elsewhere.
                  delete originalByCardRef.current[cardKey];
                  delete originalManifestByCardRef.current[cardKey];
                  pendingRevertWriteRef.current = null;
                  return undefined;
                }
              }
            } finally {
              if (aiPersistHeld) {
                if (saveOwnerRef.current === aiOwner) {
                  saveOwnerRef.current = null;
                }
                aiPersistHeld = false;
                // Covers the primary persist and the revert-convergence write
                // above — both are whole-doc writes under this mutex.
                markSelfSaveEnd(projectId);
              }
            }
            // The pre-edit baseline is consumed only by a successful auto-save —
            // a later Cancel must not resurrect pre-AI content, but a failed
            // persist must keep the baseline so Cancel can still revert.
            if (aiPersistOk) {
              delete originalByCardRef.current[cardKey];
              delete originalManifestByCardRef.current[cardKey];
              setOriginalScriptData(null);
              setOriginalManifestData([]);
              setEditingCard(null);
              setRewritePrompt('');
              addToast("LLM rewrite completed and saved!", 'success');
            }
          }
        }
      } else {
        addToast("Rewrite failed: " + (res?.error || "Unknown error"), 'error');
      }
    } catch (err: any) {
      console.error(err);
      addToast("Rewrite failed: " + (err?.message || String(err)), 'error');
    } finally {
      clearOwnEntry();
    }
  }, [projectId, selectedProject, rewritePrompt, setScriptData, setManifestData, setEditingCard, setOriginalScriptData, setOriginalManifestData, addToast]);

  const handleRewriteSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data || !selectedProject?.script_path) return undefined;
    const normalizedSubType = normalizeSectionType(sectionType);
    // Register the flight: drives the cut-badge spinner + section locks, and
    // mints a generation token so a superseding rewrite/revert discards this
    // result instead of landing it on a moved cut.
    const cardKey = normalizedSubType === 'introduction' ? 'intro'
      : normalizedSubType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    // Never run a cut rewrite under an active section rewrite on the same
    // card — the section replace would drop it on landing.
    if (sectionTokenRef.current?.key === cardKey || structureMutationRef.current) {
      addToast('This section is being rewritten — wait for it to finish.', 'warning');
      return undefined;
    }
    const subKey = `${cardKey}:${subIdx}`;
    // Per-cut generation: concurrent cuts on the same card coexist; a
    // section-level rewrite/revert bumps the card gen and stale-gates every
    // cut via the captured cardGen snapshot below.
    const token = (subGenRef.current[subKey] ?? 0) + 1;
    subGenRef.current[subKey] = token;
    const flight = { token, epoch: rewriteEpochRef.current, projectId, cardGen: rewriteGenRef.current[cardKey] ?? 0 };
    subFlightMetaRef.current[subKey] = flight;
    setRewritingSubs((prev) => ({ ...prev, [subKey]: token }));
    try {
      const res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
        'regenerate_sub_visual', projectId, sceneIdx, normalizedSubType, subIdx, data, prompt, selectedProject.language
      );
      // Stale gate: superseded by a newer cut rewrite, a section
      // rewrite/revert on this card, or a project switch.
      if (isSubFlightStale(cardKey, subKey, flight)) {
        addToast('Discarded stale AI cut — a newer rewrite, revert, or project switch superseded it.', 'info');
        return undefined;
      }
      if (res?.success && res.data) {
        // Preview-only: return the AI cut WITHOUT touching scriptData or
        // disk. The caller applies it to local state (visible instantly in
        // player/timeline/editor); the user then Saves to persist or Reverts
        // to discard.
        addToast("AI visuals applied — review in the player, then Save or Revert.", 'success');
        return res.data;
      } else {
        addToast("Rewrite failed: " + (res?.error || "Unknown error"), 'error');
        return undefined;
      }
    } catch (err: any) {
      console.error(err);
      addToast("Rewrite failed: " + (err?.message || String(err)), 'error');
      return undefined;
    } finally {
      // Clear only our own entry — ownership is decided by the meta record
      // (token + epoch + project), never by the numeric token alone: after a
      // project switch the new project's flight can reuse token number 1 for
      // the same subKey, and the old flight must not stomp its spinner.
      const meta = subFlightMetaRef.current[subKey];
      const owns = !!meta
        && meta.token === token
        && meta.epoch === flight.epoch
        && meta.projectId === flight.projectId
        && (rewriteGenRef.current[cardKey] ?? 0) === flight.cardGen;
      // A newer cut rewrite on the same subKey replaces the meta entry, so
      // `owns === false` there too — the newer flight owns cleanup.
      if (owns) {
        delete subFlightMetaRef.current[subKey];
        setRewritingSubs((prev) => {
          if (prev[subKey] !== token) return prev;
          const next = { ...prev };
          delete next[subKey];
          return next;
        });
      }
    }
  }, [projectId, selectedProject, addToast]);

  const handleUploadSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, overrideVisualType?: string, latestData?: any, layerIdx?: number) => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data) return undefined;
    const normalizedUploadType = normalizeSectionType(sectionType);

    const sectionKey = normalizedUploadType === 'introduction' ? 'intro'
      : normalizedUploadType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const assetKey = layerIdx !== undefined ? `${sectionKey}_${subIdx}_${layerIdx}` : `${sectionKey}_${subIdx}`;

    // Calculate the correct manifest index (intro is 0, scenes follow, conclusion is last).
    // Locate the nth 'scene' entry so intro presence/divergence can't shift it.
    let manifestIdx = sceneIdx;
    if (normalizedUploadType === 'introduction') {
      manifestIdx = 0;
    } else if (normalizedUploadType === 'conclusion') {
      manifestIdx = (manifestData?.length || 1) - 1;
    } else if (normalizedUploadType === 'scene') {
      let seen = -1;
      let found = -1;
      (manifestData || []).forEach((m: any, i: number) => {
        if (m?.section_type === 'scene') {
          seen++;
          if (seen === sceneIdx && found === -1) found = i;
        }
      });
      // No positional fallback: on a diverged/stale manifest the old
      // `sceneIdx + hasIntro` guess uploads to the WRONG scene. Abort loudly.
      if (found === -1) {
        addToast(`Upload aborted: scene ${sceneIdx} not found in manifest (stale manifest?)`, 'error');
        return undefined;
      }
      manifestIdx = found;
    }

    let rawVisualType = '';
    if (normalizedUploadType === 'introduction') {
      rawVisualType = data.introduction?.sub_visuals?.[subIdx]?.visual_type || '';
    } else if (normalizedUploadType === 'conclusion') {
      rawVisualType = data.conclusion?.sub_visuals?.[subIdx]?.visual_type || '';
    } else {
      rawVisualType = data.scenes?.[sceneIdx]?.sub_visuals?.[subIdx]?.visual_type || '';
    }
    const getValidVisualType = (type: string) => {
      if (!type) return 'scene';
      const t = String(type).toLowerCase();
      // Exact matches only: 'video' (upload file dialog: video-only) and
      // 'youtube' (stock/URL pipeline) are distinct backends — never collapse
      // one into the other.
      if (t === 'ast' || t === 'scene' || t === 'youtube' || t === 'image' || t === 'video') {
        return t;
      }
      return 'ast'; // Default fallback
    };
    
    // If AstGraphicalEditor passed an explicit override (e.g. "image" or "video") based on the layer type, use it!
    const visualType = overrideVisualType || getValidVisualType(rawVisualType);

    // Project identity: the upload await below can span a project switch —
    // publishing the old project's preview into the new project must not happen.
    // Epoch included: an A → B → A round-trip reuses the id but bumps the epoch.
    const uploadProjectId = projectId;
    const uploadEpoch = rewriteEpochRef.current;
    const isUploadStale = (): boolean =>
      uploadProjectId !== projectIdRef.current || uploadEpoch !== rewriteEpochRef.current;
    setUploadingSubVisual(assetKey);
    try {
      const result = await callApi<{ success: boolean; visual_path?: string; error?: string }>(
        'upload_sub_visual_media', projectId, manifestIdx, subIdx, visualType
      );
      if (isUploadStale()) return undefined;
      if (result?.success && result.visual_path) {
        const vPath: string = result.visual_path;
        const visualUrl = `${getMediaUrlSync(vPath)}&t=${Date.now()}`;
        // Re-uploading over an existing preview orphans the replaced file
        // (videos can be hundreds of MB) — delete it right away, best-effort.
        // Skipped when another entry still references it (duplicated layer).
        const existing = previewAssets[assetKey];
        if (existing?.visual_path && existing.visual_path !== vPath && isTempPreviewFile(existing.visual_path)
          && !isPreviewPathShared(existing.visual_path, [assetKey])) {
          callApi('cleanup_preview_assets', projectId, [existing.visual_path]).catch(() => {});
        }
        setPreviewAssets(prev => ({
          ...prev,
          [assetKey]: { visual_path: vPath, visual_url: visualUrl, layerIdx }
        }));
        addToast("Media uploaded successfully!", 'success');
        return vPath;
      } else {
        addToast("Upload failed: " + (result?.error || "Unknown error"), 'error');
        return undefined;
      }
    } catch (err: any) {
      console.error(err);
      if (isUploadStale()) return undefined;
      addToast("Upload failed: " + (err?.message || String(err)), 'error');
      return undefined;
    } finally {
      // The new project owns this state after a switch — never clear what
      // may now be its own spinner.
      if (!isUploadStale()) setUploadingSubVisual(null);
    }
  }, [projectId, selectedProject, addToast, manifestData, previewAssets]);
  
  const handlePreviewSubVisual = useCallback(async (
    sceneIdx: number,
    sectionType: string,
    subIdx: number,
    query: string,
    _latestData?: any,
    layerIdx?: number,
    visualType?: string,
    source?: string,
    imageType?: string
  ) => {
    if (!projectId) return undefined;
    // Same project-identity rule as uploads: the download await can span a
    // switch, and the old project's preview must not land in the new one.
    // Epoch included for the A → B → A round-trip.
    const previewProjectId = projectId;
    const previewEpoch = rewriteEpochRef.current;
    const isPreviewStale = (): boolean =>
      previewProjectId !== projectIdRef.current || previewEpoch !== rewriteEpochRef.current;
    const normalizedPreviewType = normalizeSectionType(sectionType);
    const sectionKey = normalizedPreviewType === 'introduction' ? 'intro'
      : normalizedPreviewType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const assetKey = layerIdx !== undefined ? `${sectionKey}_${subIdx}_${layerIdx}` : `${sectionKey}_${subIdx}`;

    try {
      const result = await callApi<{ success: boolean; visual_path?: string; error?: string }>(
        'preview_asset_download', projectId, query, visualType || 'image', source || 'pexels', imageType || 'all'
      );
      if (isPreviewStale()) return undefined;
      if (result?.success && result.visual_path) {
        const vPath: string = result.visual_path;
        const visualUrl = `${getMediaUrlSync(vPath)}&t=${Date.now()}`;

        const existing = previewAssetsRef.current[assetKey];
        if (existing?.visual_path && existing.visual_path !== vPath && isTempPreviewFile(existing.visual_path) && projectId
          && !isPreviewPathShared(existing.visual_path, [assetKey])) {
          callApi('cleanup_preview_assets', projectId, [existing.visual_path]).catch(() => {});
        }
        
        setPreviewAssets(prev => ({
          ...prev,
          [assetKey]: { visual_path: vPath, visual_url: visualUrl, layerIdx }
        }));
        addToast("Preview downloaded successfully!", 'success');
        return vPath;
      } else {
        addToast("Preview failed: " + (result?.error || "Unknown error"), 'error');
        return undefined;
      }
    } catch (err: any) {
      console.error(err);
      if (isPreviewStale()) return undefined;
      addToast("Preview failed: " + (err?.message || String(err)), 'error');
      return undefined;
    }
  }, [projectId, addToast]);

  /**
   * Evict preview asset for a deleted layer, clean up its temporary file,
   * and shift down subsequent layer keys (> layerIdx).
   * Note: Whole-scene insert/delete shifts scene_N prefixes and triggers a full reload/save.
   */
  const handleDeleteLayerAsset = useCallback((sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => {
    const normalizedLayerType = normalizeSectionType(sectionType);
    const sectionKey = normalizedLayerType === 'introduction' ? 'intro'
      : normalizedLayerType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const prefix = `${sectionKey}_${subIdx}_`;

    // 1. Identify paths to cleanup outside updater (pure updater for StrictMode)
    const current = previewAssetsRef.current;
    const toCleanup: string[] = [];
    const targetKey = `${prefix}${layerIdx}`;
    const cutKey = `${sectionKey}_${subIdx}`;
    if (current[targetKey]?.visual_path && isTempPreviewFile(current[targetKey].visual_path)) {
      toCleanup.push(current[targetKey].visual_path);
    }
    const cutPreview = current[cutKey];
    if (cutPreview?.layerIdx === layerIdx && cutPreview.visual_path && isTempPreviewFile(cutPreview.visual_path)) {
      toCleanup.push(cutPreview.visual_path);
    }
    // A duplicated layer shares one physical temp file until re-rendered —
    // only delete paths no surviving entry still references. The cut entry
    // counts as surviving unless it is itself evicted below.
    const cutEvicted = (current[cutKey]?.layerIdx === layerIdx);
    const evictedKeys = new Set(cutEvicted ? [targetKey, cutKey] : [targetKey]);
    cleanupOwnedTempPaths(current, toCleanup, evictedKeys, projectId);

    // 2. Pure state transition
    setPreviewAssets(prev => {
      const next: typeof prev = {};

      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(prefix)) {
          const lIdx = parseInt(k.slice(prefix.length), 10);
          if (!isNaN(lIdx)) {
            if (lIdx === layerIdx) {
              continue; // Evict
            } else if (lIdx > layerIdx) {
              const newKey = `${prefix}${lIdx - 1}`;
              next[newKey] = { ...v, layerIdx: lIdx - 1 };
              continue; // Shift down
            }
          }
        } else if (k === `${sectionKey}_${subIdx}`) {
          // Cut-level preview
          if (v.layerIdx === layerIdx) {
            continue; // Evict
          } else if (v.layerIdx !== undefined && v.layerIdx > layerIdx) {
            next[k] = { ...v, layerIdx: v.layerIdx - 1 };
            continue;
          }
        }
        next[k] = v;
      }

      return next;
    });
  }, [projectId]);

  /**
   * When a layer is duplicated at layerIdx, shift up keys for layers > layerIdx
   * and duplicate the preview entry at layerIdx + 1 if the source layer had one.
   */
  const handleDuplicateLayerAsset = useCallback((sceneIdx: number, sectionType: string, subIdx: number, layerIdx: number) => {
    const normalizedDupType = normalizeSectionType(sectionType);
    const sectionKey = normalizedDupType === 'introduction' ? 'intro'
      : normalizedDupType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const prefix = `${sectionKey}_${subIdx}_`;

    setPreviewAssets(prev => {
      const next: typeof prev = {};
      const sourceKey = `${prefix}${layerIdx}`;
      const sourcePreview = prev[sourceKey];

      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(prefix)) {
          const lIdx = parseInt(k.slice(prefix.length), 10);
          if (!isNaN(lIdx)) {
            if (lIdx <= layerIdx) {
              next[k] = v;
            } else {
              next[`${prefix}${lIdx + 1}`] = { ...v, layerIdx: lIdx + 1 };
            }
            continue;
          }
        } else if (k === `${sectionKey}_${subIdx}`) {
          if (v.layerIdx !== undefined && v.layerIdx > layerIdx) {
            next[k] = { ...v, layerIdx: v.layerIdx + 1 };
            continue;
          }
        }
        next[k] = v;
      }

      if (sourcePreview) {
        next[`${prefix}${layerIdx + 1}`] = { ...sourcePreview, layerIdx: layerIdx + 1 };
      }

      return next;
    });
  }, []);

  /**
   * When a layer moves from one index to another within the same cut,
   * re-key layer preview entries so cached assets follow their layer.
   * Pure index permutation — no file cleanup (no assets evicted).
   */
  const handleMoveLayerAsset = useCallback((sceneIdx: number, sectionType: string, subIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const normalizedType = normalizeSectionType(sectionType);
    const sectionKey = normalizedType === 'introduction' ? 'intro'
      : normalizedType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const prefix = `${sectionKey}_${subIdx}_`;
    const cutKey = `${sectionKey}_${subIdx}`;

    setPreviewAssets(prev => {
      const next: typeof prev = {};
      const remap = (i: number) => {
        if (i === fromIdx) return toIdx;
        if (fromIdx < toIdx) return i > fromIdx && i <= toIdx ? i - 1 : i;
        return i >= toIdx && i < fromIdx ? i + 1 : i;
      };
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(prefix)) {
          const lIdx = parseInt(k.slice(prefix.length), 10);
          if (!isNaN(lIdx)) {
            const nIdx = remap(lIdx);
            next[`${prefix}${nIdx}`] = { ...v, layerIdx: nIdx };
            continue;
          }
        } else if (k === cutKey) {
          if (v.layerIdx !== undefined) {
            next[k] = { ...v, layerIdx: remap(v.layerIdx) };
            continue;
          }
        }
        next[k] = v;
      }
      return next;
    });
  }, []);

  /**
   * When a cut is deleted at subIdx, evict its cut and layer previews (with cleanup),
   * and shift down subsequent cut keys (> subIdx).
   */
  const handleDeleteCutAsset = useCallback((sceneIdx: number, sectionType: string, subIdx: number) => {
    const normalizedCutType = normalizeSectionType(sectionType);
    const sectionKey = normalizedCutType === 'introduction' ? 'intro'
      : normalizedCutType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const cutPrefix = `${sectionKey}_`;

    // 1. Identify paths to cleanup outside updater (pure updater for StrictMode)
    const current = previewAssetsRef.current;
    const toCleanup: string[] = [];
    const evictedCutKeys = new Set<string>();
    for (const [k, v] of Object.entries(current)) {
      if (k.startsWith(cutPrefix)) {
        const rest = k.slice(cutPrefix.length);
        const parts = rest.split('_');
        const sIdx = parseInt(parts[0], 10);
        if (sIdx === subIdx && v.visual_path && isTempPreviewFile(v.visual_path)) {
          toCleanup.push(v.visual_path);
          evictedCutKeys.add(k);
        }
      }
    }
    // Duplicated cuts/layers can share one physical temp file — only delete
    // paths no surviving entry still references.
    cleanupOwnedTempPaths(current, toCleanup, evictedCutKeys, projectId);

    // 2. Pure state transition
    setPreviewAssets(prev => {
      const next: typeof prev = {};

      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(cutPrefix)) {
          next[k] = v;
          continue;
        }

        const rest = k.slice(cutPrefix.length); // e.g. "0" or "0_1"
        const parts = rest.split('_');
        const sIdx = parseInt(parts[0], 10);
        if (isNaN(sIdx)) {
          next[k] = v;
          continue;
        }

        if (sIdx === subIdx) {
          continue; // Evict
        } else if (sIdx > subIdx) {
          const newRest = [sIdx - 1, ...parts.slice(1)].join('_');
          next[`${cutPrefix}${newRest}`] = v;
          continue; // Shift cut index down
        }

        next[k] = v;
      }

      return next;
    });
  }, [projectId]);


  const insertAndSaveNewScene = useCallback(async (newScene: any, insertAfterIdx: number) => {
    if (!projectId || !scriptData || !selectedProject?.script_path) return;
    // Scene inserts shift every later scene's index — an in-flight rewrite
    // would land on the wrong section. Locked until rewrites settle. A
    // whole-document save for this project in flight is equally incompatible
    // (both write the full doc — last-writer-wins would drop one side's changes).
    if (isAnyRewriting || structureMutationRef.current || isSaveActiveFor(projectId)) {
      addToast('Scene insert is paused while another operation is in progress.', 'warning');
      return;
    }
    structureMutationRef.current = true;

    const insertPosition = insertAfterIdx >= 0 ? insertAfterIdx + 1 : (scriptData.scenes?.length || 0);
    const newScriptData = { ...scriptData };
    const scenesCopy = [...(newScriptData.scenes || [])];
    newScene.scene_number = insertPosition + 1;
    scenesCopy.splice(insertPosition, 0, newScene);
    for (let i = insertPosition + 1; i < scenesCopy.length; i++) {
      scenesCopy[i].scene_number = i + 1;
    }
    newScriptData.scenes = scenesCopy;

    const initialDuration = estimateTextDuration(newScene.narration);
    const newManifestEntry = {
      section_type: "scene", title: newScene.title || "New Scene",
      text: newScene.narration || "", duration: initialDuration,
      audio_path: "", audio_file: "", audio_url: "",
      sub_visuals: (newScene.sub_visuals || []).map((sv: any) => ({
        visual_type: sv.visual_type || "scene", visual_cue: sv.visual_cue || "",
        transition_type: sv.transition_type || sv.transition || "cut",
        exit_transition: sv.exit_transition || "none",
        visual_meta: sv.visual_meta || {}, visual_path: "", visual_url: ""
      }))
    };

    let manifestInsertIdx = manifestData ? manifestData.length : 0;
    let sceneIdx = 0;
    if (manifestData) {
      for (let i = 1; i < manifestData.length; i++) {
        if (manifestData[i].section_type === 'scene') {
          if (sceneIdx === insertPosition) { manifestInsertIdx = i; break; }
          sceneIdx++;
        }
      }
      if (manifestInsertIdx === manifestData.length) {
        for (let i = manifestData.length - 1; i >= 0; i--) {
          if (manifestData[i].section_type === 'scene') { manifestInsertIdx = i + 1; break; }
        }
        // Fallback: if no scene entries exist yet (e.g. fresh project with intro+conclusion),
        // insert before the last entry (conclusion) rather than appending after it
        if (manifestInsertIdx === manifestData.length) {
          manifestInsertIdx = Math.max(1, manifestData.length - 1);
        }
      }
    }

    const newManifestData = manifestData ? [...manifestData] : [];
    newManifestData.splice(manifestInsertIdx, 0, newManifestEntry);

    try {
      // Persist first — only publish to React state on success so disk and
      // UI can't diverge on a failed write. Identity + epoch: an A → B → A
      // round-trip during the await must not publish A's scene into A' state.
      const insertProjectId = projectId;
      const insertEpoch = rewriteEpochRef.current;
      const res = await callApi<any>('save_project_with_cleanup', projectId, newScriptData, newManifestData);
      if (insertProjectId !== projectIdRef.current || insertEpoch !== rewriteEpochRef.current) return;
      if (res && res.success === false) throw new Error(res.error || 'Failed to save inserted scene');
      setScriptData(newScriptData);
      setManifestData(newManifestData);
      // Positional preview keys (scene_0_0, …) shift on insert — drop them
      // rather than showing a neighbor's preview on the wrong scene.
      setPreviewAssets({});
      setEditingCard({ key: `scene_${insertPosition}`, mode: 'script' });
    } catch (e) {
      console.error('insertAndSaveNewScene failed:', e);
      addToast('Failed to insert scene — disk write failed, nothing was changed.', 'error');
    } finally {
      structureMutationRef.current = false;
    }
  }, [projectId, scriptData, selectedProject, manifestData, setScriptData, setManifestData, isAnyRewriting, addToast]);

  const confirmDeleteScene = useCallback(async () => {
    if (sceneToDelete === null || !projectId) return;
    // Scene deletes shift every later scene's index — an in-flight rewrite
    // would land on the wrong section. Locked until rewrites settle. A
    // whole-document save for this project in flight is equally incompatible.
    if (isAnyRewriting || structureMutationRef.current || isSaveActiveFor(projectId)) {
      addToast('Scene delete is paused while another operation is in progress.', 'warning');
      return;
    }
    structureMutationRef.current = true;
    const idx = sceneToDelete;
    const deleteProjectId = projectId;
    const deleteEpoch = rewriteEpochRef.current;
    // Keystrokes typed during the delete await live only in UI state;
    // loadFiles below (structural truth wins) can clobber them — detect and say so.
    const deleteDocSig = safeDocSig(scriptDataRef.current);
    const deleteManSig = safeDocSig(manifestDataRef.current);

    try {
      // Delegate entirely to the backend delete_scene API which handles:
      // 1. Script scene removal + re-numbering
      // 2. Manifest entry removal
      // 3. Asset file cleanup + renaming to keep indices consistent
      const result = await callApi<any>('delete_scene', projectId, idx);
      if (result?.success) {
        // Never publish the old project's reload into a new project if a
        // switch happened during the delete await (epoch covers A → B → A).
        if (deleteProjectId !== projectIdRef.current || deleteEpoch !== rewriteEpochRef.current) return;
        const typedDuringDelete = (() => {
          try {
            return safeDocSig(scriptDataRef.current) !== deleteDocSig
              || safeDocSig(manifestDataRef.current) !== deleteManSig;
          } catch {
            return false;
          }
        })();
        await loadFiles(deleteProjectId);
        // Positional preview keys shift on delete — drop them rather than
        // showing a neighbor's preview on the wrong scene.
        setPreviewAssets({});
        if (typedDuringDelete) {
          addToast("Scene deleted — edits typed during deletion were not kept. Please re-enter them.", 'warning', 8000);
        } else {
          addToast("Scene deleted successfully!", 'success');
        }
      } else {
        addToast("Failed to delete scene: " + (result?.error || "Unknown error"), 'error');
      }
    } finally {
      structureMutationRef.current = false;
    }
    setSceneToDelete(null);
  }, [sceneToDelete, projectId, loadFiles, addToast, isAnyRewriting]);

  const handleSaveTranscription = useCallback(async (overrideDoc?: any) => {
    const doc = overrideDoc ?? transcriptionData;
    if (!projectId || !doc || !selectedProject?.transcription_path) return;
    // Same project-identity rule as every other async publish: the save await
    // can span a project switch, and project A's doc/reload must not land in B.
    const subtitleProjectId = projectId;
    const subtitleEpoch = rewriteEpochRef.current;
    setIsSavingSubtitles(true);
    try {
      const success = await callApi<boolean>('save_json_file', selectedProject.transcription_path, doc);
      if (subtitleProjectId !== projectIdRef.current || subtitleEpoch !== rewriteEpochRef.current) return;
      if (success) {
        // Keep local state in sync when the caller flushed a newer draft
        // than the hook's closed-over transcriptionData.
        if (overrideDoc) _setTranscriptionData(overrideDoc);
        addToast("Subtitles saved successfully!", 'success');
        loadFiles(subtitleProjectId);
      } else {
        addToast("Failed to save subtitles", 'error');
      }
    } catch (e) {
      console.error(e);
      if (subtitleProjectId !== projectIdRef.current || subtitleEpoch !== rewriteEpochRef.current) return;
      addToast("Failed to save subtitles", 'error');
    } finally {
      // Another project owns the indicator after a switch — never clear it.
      if (subtitleProjectId === projectIdRef.current && subtitleEpoch === rewriteEpochRef.current) {
        setIsSavingSubtitles(false);
      }
    }
  }, [projectId, transcriptionData, selectedProject, loadFiles, addToast, _setTranscriptionData]);

  const handleResetTranscription = useCallback(() => {
    if (!projectId || !selectedProject?.transcription_path) return;
    // Capture identity now: the read await resolves later, potentially after
    // a project switch, and project A's transcript must not land in B.
    const resetProjectId = projectId;
    const resetEpoch = rewriteEpochRef.current;
    const resetPath = selectedProject.transcription_path;

    showConfirm(
      "Reset Subtitles",
      "Reset subtitles to last saved state? Unsaved changes will be lost.",
      async () => {
        try {
          const transcript = await callApi<any>('read_json_file', resetPath!);
          if (resetProjectId !== projectIdRef.current || resetEpoch !== rewriteEpochRef.current) return;
          _setTranscriptionData(transcript || { segments: [] });
          addToast("Subtitles reset to last saved state", 'success');
        } catch (e) {
          console.error(e);
          if (resetProjectId !== projectIdRef.current || resetEpoch !== rewriteEpochRef.current) return;
          addToast("Failed to reset subtitles", 'error');
        }
      }
    );
  }, [projectId, selectedProject, _setTranscriptionData, addToast, showConfirm]);

  return {
    editingCard, setEditingCard,
    rewritePrompt, setRewritePrompt,
    rewritingSection, isAnyRewriting,
    isSectionRewriting, isSubRewriting, isSectionLocked,
    invalidateRewrites, invalidateAllRewrites,
    savingCardKey, sceneToDelete,
    localProjectSettings, isSavingSubtitles,
    previewAssets, uploadingSubVisual, handleUploadSubVisual, handlePreviewSubVisual,
    handleDeleteLayerAsset, handleDuplicateLayerAsset, handleMoveLayerAsset, handleReorderLayerAsset: handleMoveLayerAsset, handleDeleteCutAsset,
    handleStartEdit, handleCancelEdit,
    handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene,
    setSceneToDelete, handleSettingsUpdate, handleSaveTranscription, handleResetTranscription,
  };
}
