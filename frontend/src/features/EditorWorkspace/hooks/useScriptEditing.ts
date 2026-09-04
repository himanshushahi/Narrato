import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../../store/useProjectStore';
import { useUIStore } from '../../../store/useUIStore';
import { callApi, callApiOrThrow } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

import { estimateTextDuration } from '../../../utils/duration';

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
  previewAssets: Record<string, { visual_path: string; visual_url: string }>;
  uploadingSubVisual: string | null;
  handleUploadSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, overrideVisualType?: string, latestData?: any) => Promise<string | undefined>;
  handleStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  handleCancelEdit: () => void;
  handleSaveCard: (cardKey?: string, index?: number, latestData?: any) => Promise<void>;
  handleRewriteSection: (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => Promise<any | undefined>;
  handleRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => Promise<any | undefined>;
  insertAndSaveNewScene: (newScene: any, insertAfterIdx: number) => Promise<void>;
  confirmDeleteScene: () => Promise<void>;
  setSceneToDelete: (idx: number | null) => void;
  handleSettingsUpdate: (newSettings: any) => void;
  handleSaveTranscription: () => Promise<void>;
  handleResetTranscription: () => void;
  handlePreviewSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, query: string, latestData?: any) => Promise<string | undefined>;
}

export function useScriptEditing(
  projectId: string | undefined,
  scriptData: any,
  setScriptData: (data: any) => void,
  manifestData: any[],
  setManifestData: (data: any[]) => void,
  transcriptionData: any,
  _setTranscriptionData: (data: any) => void,
  loadFiles: (projId: string) => Promise<void>
): UseScriptEditingReturn {
  const { selectedProject, updateProject, downloadFont } = useProjectStore();
  const { addToast, showConfirm } = useUIStore();

  const [editingCard, setEditingCard] = useState<{ key: string, mode: 'script' | 'visuals' } | null>(null);
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [originalScriptData, setOriginalScriptData] = useState<any>(null);
  const [originalManifestData, setOriginalManifestData] = useState<any[]>([]);
  const [savingCardKey, setSavingCardKey] = useState<string | null>(null);
  const [sceneToDelete, setSceneToDelete] = useState<number | null>(null);
  const [localProjectSettings, setLocalProjectSettings] = useState<any>({});
  const [isSavingSubtitles, setIsSavingSubtitles] = useState(false);
  const [rewritingSection, setRewritingSection] = useState<string | null>(null);
  const [previewAssets, setPreviewAssets] = useState<Record<string, { visual_path: string; visual_url: string }>>({});
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
  // Every rewrite flight carries a per-card generation token: starting a new
  // rewrite, reverting, or switching projects bumps the generation, and a
  // completion whose token no longer matches is discarded instead of landing
  // on a moved/deleted cut or clobbering newer work.
  const rewriteGenRef = useRef<Record<string, number>>({});
  /** Active single-cut flights: `${cardKey}:${subIdx}` → token (state for UI). */
  const [rewritingSubs, setRewritingSubs] = useState<Record<string, number>>({});
  /** Active section flight (single-flight under global exclusivity). */
  const sectionTokenRef = useRef<{ key: string; token: number } | null>(null);

  const bumpRewriteGen = (cardKey: string): number => {
    const next = (rewriteGenRef.current[cardKey] ?? 0) + 1;
    rewriteGenRef.current[cardKey] = next;
    return next;
  };

  /** Poison in-flight rewrites for a card — late results self-discard. */
  const invalidateRewrites = useCallback((cardKey: string) => {
    bumpRewriteGen(cardKey);
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

  /** Poison ALL in-flight rewrites — project switch / unmount. */
  const invalidateAllRewrites = useCallback(() => {
    rewriteGenRef.current = {};
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
      });
    }
  }, [localProjectSettings.fontFamily, downloadFont]);

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

  const handleCancelEdit = useCallback(async () => {
    // Per-card revert: restore only the active card's section, never the
    // whole document, so unrelated dirty cards survive.
    const key = editingCardRef.current?.key;
    // Poison this card's in-flight rewrites first so a late LLM result can't
    // land on top of the restored baseline ("revert didn't work").
    if (key) invalidateRewrites(key);
    const snap = key ? originalByCardRef.current[key] : null;
    if (key && snap) {
      const merged = restoreCardSection(
        JSON.parse(JSON.stringify(scriptDataRef.current)),
        snap,
        key,
      );
      setScriptData(merged);
      delete originalByCardRef.current[key];
      delete originalManifestByCardRef.current[key];
    }
    setEditingCard(null);
    setOriginalScriptData(null);
    setOriginalManifestData([]);
    setRewritePrompt('');

    // Cleanup preview assets on cancel — best-effort
    const previewPaths = Object.values(previewAssets)
      .filter((a): a is { visual_path: string; visual_url: string } => !!a.visual_path)
      .map(a => a.visual_path);
    if (previewPaths.length > 0 && projectId) {
      try {
        await callApi('cleanup_preview_assets', projectId, previewPaths);
      } catch (e) { /* best-effort */ }
    }
    setPreviewAssets({});
  }, [setScriptData, previewAssets, projectId, invalidateRewrites]);

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
    // Clone-on-write target for finalized compositions (see below). Saves use
    // `working ?? data` so the live state object is never mutated in place.
    let working: any | null = null;

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
    if (success) {
      // Build live manifest
      let sceneCounter = 0;
      const liveManifest = await Promise.all(manifestData.map(async (manifestScene: any, mIdx: number) => {
        const type = manifestScene.section_type;
        let liveSubVisuals: any[] = [];
        let assetKeyPrefix: string;
        if (type === 'introduction' && data?.introduction) {
          liveSubVisuals = data.introduction?.sub_visuals || [];
          assetKeyPrefix = 'intro';
        } else if (type === 'conclusion' && data?.conclusion) {
          liveSubVisuals = data.conclusion?.sub_visuals || [];
          assetKeyPrefix = 'conclusion';
        } else if (type === 'scene' && Array.isArray(data?.scenes)) {
          const currentIdx = sceneCounter++;
          const scriptScene = data.scenes[currentIdx];
          if (scriptScene) liveSubVisuals = scriptScene?.sub_visuals || [];
          assetKeyPrefix = `scene_${currentIdx}`;
        } else {
          assetKeyPrefix = '';
        }

        const origSubVisuals = manifestScene.sub_visuals || [];
        // Match by content (type+cue) rather than by index,
        // so inserted/deleted sub-visuals don't shift existing assets
        const matchedIndices = new Set<number>();
        const mergedSubVisuals = await Promise.all(liveSubVisuals.map(async (lsv: any, sIdx: number) => {
          // Check if a preview/upload asset exists for this position FIRST
          // so manual uploads take priority over original manifest assets
          if (assetKeyPrefix) {
            const assetKey = `${assetKeyPrefix}_${sIdx}`;
            const preview = previewAssets[assetKey];
            if (preview?.visual_path) {
              // Mark the matching original manifest entry as consumed so
              // subsequent sub-visuals with the same type+cue don't match it.
              const origIdx = origSubVisuals.findIndex((_: any, i: number) =>
                !matchedIndices.has(i)
              );
              if (origIdx !== -1) matchedIndices.add(origIdx);

              let finalPath = preview.visual_path;
              if (preview.visual_path.includes('previews') || preview.visual_path.includes('preview_') || preview.visual_path.includes('upload_')) {
                const result = await callApi<any>('finalize_upload_asset', projectId, preview.visual_path, mIdx, sIdx);
                if (result?.success && result.visual_path) {
                  finalPath = result.visual_path;
                }
              }

              // Update AST composition media layers to point to finalPath
              let updatedComposition = lsv.composition;
              if (updatedComposition && Array.isArray(updatedComposition.children)) {
                const updatedChildren = updatedComposition.children.map((layer: any) => {
                  if (layer?.content && (layer.content.local_path === preview.visual_path || layer.content.type === 'Image' || layer.content.type === 'Video')) {
                    return {
                      ...layer,
                      content: {
                        ...layer.content,
                        local_path: finalPath
                      }
                    };
                  }
                  return layer;
                });
                updatedComposition = { ...updatedComposition, children: updatedChildren };
              }

              // Propagate the finalized composition back into the saved doc
              // without mutating live React state in place: `data` may be
              // scriptDataRef.current (or the just-flushed object already
              // handed to setScriptData), so clone-on-first-write and sync
              // the clone back to state below.
              const targetDoc = working ?? data;
              const ensureWorking = () => {
                if (!working) working = JSON.parse(JSON.stringify(data));
                return working;
              };
              if (type === 'introduction' && targetDoc?.introduction?.sub_visuals?.[sIdx]) {
                const doc = ensureWorking();
                doc.introduction.sub_visuals[sIdx] = { ...doc.introduction.sub_visuals[sIdx], composition: updatedComposition };
              } else if (type === 'conclusion' && targetDoc?.conclusion?.sub_visuals?.[sIdx]) {
                const doc = ensureWorking();
                doc.conclusion.sub_visuals[sIdx] = { ...doc.conclusion.sub_visuals[sIdx], composition: updatedComposition };
              } else if (type === 'scene' && Array.isArray(targetDoc?.scenes)) {
                const currentSceneIdx = sceneCounter - 1;
                if (targetDoc.scenes[currentSceneIdx]?.sub_visuals?.[sIdx]) {
                  const doc = ensureWorking();
                  doc.scenes[currentSceneIdx].sub_visuals[sIdx] = { ...doc.scenes[currentSceneIdx].sub_visuals[sIdx], composition: updatedComposition };
                }
              }

              return { ...lsv, composition: updatedComposition, visual_path: finalPath, visual_url: preview.visual_url };
            }
          }
          const matchIdx = sIdx < origSubVisuals.length ? sIdx : -1;
          if (matchIdx !== -1) {
            matchedIndices.add(matchIdx);
            const match = origSubVisuals[matchIdx];
            return { 
                ...lsv, 
                visual_path: match.visual_path, 
                visual_url: match.visual_url,
                composition: lsv.composition || match.composition 
            };
          }
          // New or changed sub-visual — strip any stale visual_path/visual_url
          // that scriptData may have carried over from a previous pipeline run,
          // so the manifest is clean and fetch_single_scene_asset is always triggered.
          return { ...lsv, visual_path: undefined, visual_url: undefined };
        }));

        const sceneText = type === 'introduction' ? data?.introduction?.hook
          : type === 'conclusion' ? data?.conclusion?.summary
            : data?.scenes?.[sceneCounter - 1]?.narration;
        const sceneDuration = manifestScene.duration > 0 ? manifestScene.duration : estimateTextDuration(sceneText);

        return { ...manifestScene, duration: sceneDuration, sub_visuals: mergedSubVisuals };
      }));

      await callApi<any>('save_project_with_cleanup', projectId, working ?? data, liveManifest);

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
      for (let mIdx = 0; mIdx < liveManifest.length; mIdx++) {
        const liveSubs = liveManifest[mIdx].sub_visuals || [];
        const origSubs = origManifest[mIdx]?.sub_visuals || [];
        const matchedOrigIndices = new Set<number>();
        for (let sIdx = 0; sIdx < liveSubs.length; sIdx++) {
          // Skip download if this sub-visual was handled via upload/preview.
          // Count 'scene' entries before mIdx (same convention as
          // manifestToScriptSceneIndex) so a missing/stale intro can't shift
          // scene_N keys.
          let scriptIdxForKey = 0;
          for (let k = 0; k < mIdx; k++) {
            if (liveManifest[k]?.section_type === 'scene') scriptIdxForKey++;
          }
          const sectionKey = liveManifest[mIdx].section_type === 'introduction' ? 'intro'
            : liveManifest[mIdx].section_type === 'conclusion' ? 'conclusion'
            : `scene_${scriptIdxForKey}`;
          const assetKey = `${sectionKey}_${sIdx}`;
          if (handledFromPreview.has(assetKey)) {
            continue;
          }
          const origMatch = sIdx < origSubs.length ? sIdx : -1;
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

      await loadFiles(projectId);
      // Sync finalized compositions back to state WITHOUT clobbering edits
      // typed during the long save: patch only `composition` objects from the
      // save snapshot into the latest doc instead of replacing the whole doc
      // (classic save-while-typing data loss).
      if (working) {
        try {
          const latest = JSON.parse(JSON.stringify(scriptDataRef.current));
          const patchCompositions = (liveSubs: any[] | undefined, savedSubs: any[] | undefined) => {
            if (!Array.isArray(liveSubs) || !Array.isArray(savedSubs)) return liveSubs;
            return liveSubs.map((live: any, i: number) => (
              savedSubs[i]?.composition !== undefined
                ? { ...live, composition: savedSubs[i].composition }
                : live
            ));
          };
          if (working.introduction && latest.introduction) {
            latest.introduction = {
              ...latest.introduction,
              sub_visuals: patchCompositions(latest.introduction.sub_visuals, working.introduction.sub_visuals),
            };
          }
          if (working.conclusion && latest.conclusion) {
            latest.conclusion = {
              ...latest.conclusion,
              sub_visuals: patchCompositions(latest.conclusion.sub_visuals, working.conclusion.sub_visuals),
            };
          }
          if (Array.isArray(working.scenes) && Array.isArray(latest.scenes)) {
            latest.scenes = latest.scenes.map((liveScene: any, i: number) => (
              working.scenes[i]
                ? { ...liveScene, sub_visuals: patchCompositions(liveScene.sub_visuals, working.scenes[i].sub_visuals) }
                : liveScene
            ));
          }
          setScriptData(latest);
        } catch {
          setScriptData(working);
        }
      }
      // Whole document persisted — all per-card baselines are now stale.
      originalByCardRef.current = {};
      originalManifestByCardRef.current = {};
      setEditingCard(null);
      setSavingCardKey(null);
      setRewritePrompt('');

      // Cleanup preview assets after save — best-effort
      const savedPreviewPaths = Object.values(previewAssets)
        .filter((a): a is { visual_path: string; visual_url: string } => !!a.visual_path)
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
  }, [projectId, selectedProject, originalScriptData, originalManifestData, manifestData, loadFiles, addToast, previewAssets, setScriptData]);

  const handleRewriteSection = useCallback(async (type: string, index: number, latestData?: any, modeOverride?: 'script' | 'visuals') => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data || !selectedProject?.script_path) return;
    // Explicit intent wins: the Visuals tab passes 'visuals' so a fast
    // open → rewrite can't race the post-render effect that sets
    // editingCard.mode.
    const effectiveMode = modeOverride ?? editingCardRef.current?.mode;

    const cardKey = type === 'introduction' ? 'intro' : type === 'conclusion' ? 'conclusion' : `scene_${index}`;
    const sectionKey = cardKey;
    // Generation token: a newer rewrite, a Revert, or a project switch bumps
    // this card's generation and this flight's completion self-discards.
    const token = bumpRewriteGen(cardKey);
    sectionTokenRef.current = { key: sectionKey, token };
    setRewritingSection(sectionKey);
    const clearOwnEntry = () => {
      if (sectionTokenRef.current?.key === sectionKey && sectionTokenRef.current?.token === token) {
        sectionTokenRef.current = null;
        setRewritingSection(null);
      }
    };

    try {
      let res;
      const isNewScene = type === 'scenes' && data.scenes?.[index] &&
        (!data.scenes[index].narration || data.scenes[index].narration.trim() === '');
      const isNewIntroduction = type === 'introduction' &&
        (!data.introduction?.hook || data.introduction?.hook.trim() === '');
      const isNewConclusion = type === 'conclusion' &&
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
            'regenerate_visuals_section', projectId, index, type, data, rewritePrompt
          );
        } else {
          res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_script_section', index, type, data, rewritePrompt, selectedProject.language
          );
        }
      }

      // Stale gate: superseded by a newer rewrite, a Revert, or project switch.
      if (rewriteGenRef.current[cardKey] !== token) {
        addToast('Discarded stale AI result — a newer rewrite or revert superseded it.', 'info');
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
          if (type === 'introduction') oldSubVisuals = latest.introduction?.sub_visuals || [];
          else if (type === 'conclusion') oldSubVisuals = latest.conclusion?.sub_visuals || [];
          else if (!isNewScene) oldSubVisuals = latest.scenes?.[index]?.sub_visuals || [];

          newSection.sub_visuals = oldSubVisuals;

          if (type === 'introduction') latest.introduction = newSection;
          else if (type === 'conclusion') latest.conclusion = newSection;
          else if (Array.isArray(latest.scenes) && (latest.scenes[index] !== undefined || isNewScene)) {
            latest.scenes[index] = newSection;
          }
          setScriptData(latest);

          if (isNewScene || isNewIntroduction || isNewConclusion) {
            setRewritePrompt('');
            addToast("AI content generated! Review and click Save to fetch visuals.", 'success');
          } else {
            await callApi('save_json_file', selectedProject.script_path, latest);
            setEditingCard(null);
            setRewritePrompt('');
            addToast("LLM rewrite completed and saved!", 'success');
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
  }, [projectId, selectedProject, rewritePrompt, setScriptData, addToast]);

  const handleRewriteSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, prompt: string, latestData?: any) => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data || !selectedProject?.script_path) return undefined;
    // Register the flight: drives the cut-badge spinner + section locks, and
    // mints a generation token so a superseding rewrite/revert discards this
    // result instead of landing it on a moved cut.
    const cardKey = sectionType === 'introduction' ? 'intro'
      : sectionType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const subKey = `${cardKey}:${subIdx}`;
    const token = bumpRewriteGen(cardKey);
    setRewritingSubs((prev) => ({ ...prev, [subKey]: token }));
    try {
      const res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
        'regenerate_sub_visual', projectId, sceneIdx, sectionType, subIdx, data, prompt, selectedProject.language
      );
      // Stale gate: superseded by a newer rewrite, a Revert, or project switch.
      if (rewriteGenRef.current[cardKey] !== token) {
        addToast('Discarded stale AI cut — a newer rewrite or revert superseded it.', 'info');
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
      // Clear only our own entry — a newer flight may have replaced it.
      setRewritingSubs((prev) => {
        if (prev[subKey] !== token) return prev;
        const next = { ...prev };
        delete next[subKey];
        return next;
      });
    }
  }, [projectId, selectedProject, addToast]);

  const handleUploadSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, overrideVisualType?: string, latestData?: any) => {
    const data = latestData ?? scriptDataRef.current;
    if (!projectId || !data) return undefined;

    const sectionKey = sectionType === 'introduction' ? 'intro'
      : sectionType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const assetKey = `${sectionKey}_${subIdx}`;

    // Calculate the correct manifest index (intro is 0, scenes follow, conclusion is last).
    // Locate the nth 'scene' entry so intro presence/divergence can't shift it.
    let manifestIdx = sceneIdx;
    if (sectionType === 'introduction') {
      manifestIdx = 0;
    } else if (sectionType === 'conclusion') {
      manifestIdx = (manifestData?.length || 1) - 1;
    } else if (sectionType === 'scenes' || sectionType === 'scene') {
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
    if (sectionType === 'introduction') {
      rawVisualType = data.introduction?.sub_visuals?.[subIdx]?.visual_type || '';
    } else if (sectionType === 'conclusion') {
      rawVisualType = data.conclusion?.sub_visuals?.[subIdx]?.visual_type || '';
    } else {
      rawVisualType = data.scenes?.[sceneIdx]?.sub_visuals?.[subIdx]?.visual_type || '';
    }
    const getValidVisualType = (type: string) => {
      if (!type) return 'scene';
      const t = String(type).toLowerCase();
      if (['ast', 'scene', 'youtube', 'image', 'video'].includes(t)) {
        if (t.includes('youtube') || t.includes('video')) return 'youtube';
        return t;
      }
      return 'ast'; // Default fallback
    };
    
    // If AstGraphicalEditor passed an explicit override (e.g. "image" or "video") based on the layer type, use it!
    const visualType = overrideVisualType || getValidVisualType(rawVisualType);

    setUploadingSubVisual(assetKey);
    try {
      const result = await callApi<{ success: boolean; visual_path?: string; error?: string }>(
        'upload_sub_visual_media', projectId, manifestIdx, subIdx, visualType
      );
      if (result?.success && result.visual_path) {
        const vPath: string = result.visual_path;
        const visualUrl = `${getMediaUrlSync(vPath)}&t=${Date.now()}`;
        // Re-uploading over an existing preview orphans the replaced file
        // (videos can be hundreds of MB) — delete it right away, best-effort.
        const existing = previewAssets[assetKey];
        if (existing?.visual_path && existing.visual_path !== vPath) {
          callApi('cleanup_preview_assets', projectId, [existing.visual_path]).catch(() => {});
        }
        setPreviewAssets(prev => ({
          ...prev,
          [assetKey]: { visual_path: vPath, visual_url: visualUrl }
        }));
        addToast("Media uploaded successfully!", 'success');
        return vPath;
      } else {
        addToast("Upload failed: " + (result?.error || "Unknown error"), 'error');
        return undefined;
      }
    } catch (err: any) {
      console.error(err);
      addToast("Upload failed: " + (err?.message || String(err)), 'error');
      return undefined;
    } finally {
      setUploadingSubVisual(null);
    }
  }, [projectId, selectedProject, addToast, manifestData, previewAssets]);
  
  const handlePreviewSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, query: string, _latestData?: any) => {
    if (!projectId) return undefined;

    const sectionKey = sectionType === 'introduction' ? 'intro'
      : sectionType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const assetKey = `${sectionKey}_${subIdx}`;

    try {
      const result = await callApi<{ success: boolean; visual_path?: string; error?: string }>(
        'preview_asset_download', projectId, query
      );
      if (result?.success && result.visual_path) {
        const vPath: string = result.visual_path;
        const visualUrl = `${getMediaUrlSync(vPath)}&t=${Date.now()}`;
        
        setPreviewAssets(prev => {
          const existing = prev[assetKey];
          if (existing?.visual_path && existing.visual_path !== vPath) {
            callApi('cleanup_preview_assets', projectId, [existing.visual_path]).catch(() => {});
          }
          return {
            ...prev,
            [assetKey]: { visual_path: vPath, visual_url: visualUrl }
          };
        });
        addToast("Preview downloaded successfully!", 'success');
        return vPath;
      } else {
        addToast("Preview failed: " + (result?.error || "Unknown error"), 'error');
        return undefined;
      }
    } catch (err: any) {
      console.error(err);
      addToast("Preview failed: " + (err?.message || String(err)), 'error');
      return undefined;
    }
  }, [projectId, addToast]);


  const insertAndSaveNewScene = useCallback(async (newScene: any, insertAfterIdx: number) => {
    if (!projectId || !scriptData || !selectedProject?.script_path) return;
    // Scene inserts shift every later scene's index — an in-flight rewrite
    // would land on the wrong section. Locked until rewrites settle.
    if (isAnyRewriting) {
      addToast('Scene insert is paused while an AI rewrite is in progress.', 'warning');
      return;
    }

    const insertPosition = insertAfterIdx >= 0 ? insertAfterIdx + 1 : (scriptData.scenes?.length || 0);
    const newScriptData = { ...scriptData };
    const scenesCopy = [...(newScriptData.scenes || [])];
    newScene.scene_number = insertPosition + 1;
    scenesCopy.splice(insertPosition, 0, newScene);
    for (let i = insertPosition + 1; i < scenesCopy.length; i++) {
      scenesCopy[i].scene_number = i + 1;
    }
    newScriptData.scenes = scenesCopy;
    setScriptData(newScriptData);

    const initialDuration = estimateTextDuration(newScene.narration);
    const newManifestEntry = {
      section_type: "scene", title: newScene.title || "New Scene",
      text: newScene.narration || "", duration: initialDuration,
      audio_path: "", audio_file: "", audio_url: "",
      sub_visuals: (newScene.sub_visuals || []).map((sv: any) => ({
        visual_type: sv.visual_type || "scene", visual_cue: sv.visual_cue || "",
        transition_type: sv.transition_type || sv.transition || "subtle_slide",
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
    setManifestData(newManifestData);

    await callApi<any>('save_project_with_cleanup', projectId, newScriptData, newManifestData);
    setEditingCard({ key: `scene_${insertPosition}`, mode: 'script' });
  }, [projectId, scriptData, selectedProject, manifestData, setScriptData, setManifestData, isAnyRewriting, addToast]);

  const confirmDeleteScene = useCallback(async () => {
    if (sceneToDelete === null || !projectId) return;
    // Scene deletes shift every later scene's index — an in-flight rewrite
    // would land on the wrong section. Locked until rewrites settle.
    if (isAnyRewriting) {
      addToast('Scene delete is paused while an AI rewrite is in progress.', 'warning');
      return;
    }
    const idx = sceneToDelete;

    // Delegate entirely to the backend delete_scene API which handles:
    // 1. Script scene removal + re-numbering
    // 2. Manifest entry removal
    // 3. Asset file cleanup + renaming to keep indices consistent
    const result = await callApi<any>('delete_scene', projectId, idx);
    if (result?.success) {
      await loadFiles(projectId);
      addToast("Scene deleted successfully!", 'success');
    } else {
      addToast("Failed to delete scene: " + (result?.error || "Unknown error"), 'error');
    }
    setSceneToDelete(null);
  }, [sceneToDelete, projectId, loadFiles, addToast, isAnyRewriting]);

  const handleSaveTranscription = useCallback(async () => {
    if (!projectId || !transcriptionData || !selectedProject?.transcription_path) return;
    setIsSavingSubtitles(true);
    try {
      const success = await callApi<boolean>('save_json_file', selectedProject.transcription_path, transcriptionData);
      if (success) {
        addToast("Subtitles saved successfully!", 'success');
        loadFiles(projectId);
      } else {
        addToast("Failed to save subtitles", 'error');
      }
    } catch (e) {
      console.error(e);
      addToast("Failed to save subtitles", 'error');
    } finally {
      setIsSavingSubtitles(false);
    }
  }, [projectId, transcriptionData, selectedProject, loadFiles, addToast]);

  const handleResetTranscription = useCallback(() => {
    if (!projectId || !selectedProject?.transcription_path) return;
    
    showConfirm(
      "Reset Subtitles",
      "Reset subtitles to last saved state? Unsaved changes will be lost.",
      async () => {
        try {
          const transcript = await callApi<any>('read_json_file', selectedProject.transcription_path!);
          _setTranscriptionData(transcript || { segments: [] });
          addToast("Subtitles reset to last saved state", 'success');
        } catch (e) {
          console.error(e);
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
    handleStartEdit, handleCancelEdit,
    handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene,
    setSceneToDelete, handleSettingsUpdate, handleSaveTranscription, handleResetTranscription,
  };
}
