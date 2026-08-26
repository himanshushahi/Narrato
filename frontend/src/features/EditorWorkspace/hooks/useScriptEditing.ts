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
  savingCardKey: string | null;
  sceneToDelete: number | null;
  localProjectSettings: any;
  isSavingSubtitles: boolean;
  scriptChangedAlert: boolean;
  setScriptChangedAlert: (alert: boolean) => void;
  previewAssets: Record<string, { visual_path: string; visual_url: string }>;
  uploadingSubVisual: string | null;
  handleUploadSubVisual: (sceneIdx: number, sectionType: string, subIdx: number) => Promise<void>;
  handleStartEdit: (cardKey: string, mode: 'script' | 'visuals') => void;
  handleCancelEdit: () => void;
  handleSaveCard: (cardKey?: string, index?: number) => Promise<void>;
  handleRewriteSection: (type: string, index: number) => Promise<void>;
  handleRewriteSubVisual: (sceneIdx: number, sectionType: string, subIdx: number, prompt: string) => Promise<void>;
  insertAndSaveNewScene: (newScene: any, insertAfterIdx: number) => Promise<void>;
  confirmDeleteScene: () => Promise<void>;
  setSceneToDelete: (idx: number | null) => void;
  handleSettingsUpdate: (newSettings: any) => void;
  handleSaveTranscription: () => Promise<void>;
  handleResetTranscription: () => void;
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
  const [scriptChangedAlert, setScriptChangedAlert] = useState(false);
  const [previewAssets, setPreviewAssets] = useState<Record<string, { visual_path: string; visual_url: string }>>({});
  const [uploadingSubVisual, setUploadingSubVisual] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setOriginalScriptData(JSON.parse(JSON.stringify(scriptData)));
    setOriginalManifestData(JSON.parse(JSON.stringify(manifestData)));
    setEditingCard({ key: cardKey, mode });
    setRewritePrompt('');
  }, [scriptData, manifestData]);

  const handleCancelEdit = useCallback(async () => {
    if (originalScriptData) setScriptData(originalScriptData);
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
  }, [originalScriptData, setScriptData, previewAssets, projectId]);

  const handleSettingsUpdate = useCallback((newSettings: any) => {
    setLocalProjectSettings(newSettings);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedProject?.id) {
        await updateProject(selectedProject.id, { project_settings: JSON.stringify(newSettings) });
      }
    }, 1000);
  }, [selectedProject?.id, updateProject]);

  const handleSaveCard = useCallback(async (cardKey?: string, index?: number) => {
    // Edits apply to state synchronously on every keystroke, so the closure
    // scriptData is always the latest — no flush needed before saving.
    const data = scriptData;
    if (!projectId || !data || !selectedProject?.script_path) return;

    if (cardKey) setSavingCardKey(cardKey);

    let narrationChanged = false;
    if (originalScriptData && editingCard?.mode === 'script') {
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
              if (preview.visual_path.includes('previews')) {
                const result = await callApi<any>('finalize_upload_asset', projectId, preview.visual_path, mIdx, sIdx);
                if (result?.success) {
                  finalPath = result.visual_path;
                }
              }
              return { ...lsv, visual_path: finalPath, visual_url: preview.visual_url };
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

      await callApi<any>('save_project_with_cleanup', projectId, data, liveManifest);

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
          // Skip download if this sub-visual was handled via upload/preview
          const sectionKey = liveManifest[mIdx].section_type === 'introduction' ? 'intro'
            : liveManifest[mIdx].section_type === 'conclusion' ? 'conclusion'
            : `scene_${mIdx - (liveManifest[0]?.section_type === 'introduction' ? 1 : 0)}`;
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
        addToast("Narration text updated! We recommend resuming/syncing the pipeline to regenerate voiceover and subtitles.", 'warning', 6000);
        setScriptChangedAlert(true);
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
  }, [projectId, scriptData, selectedProject, originalScriptData, originalManifestData, manifestData, loadFiles, addToast, previewAssets]);

  const handleRewriteSection = useCallback(async (type: string, index: number) => {
    const data = scriptData;
    if (!projectId || !data || !selectedProject?.script_path) return;

    const sectionKey = type === 'introduction' ? 'intro' : type === 'conclusion' ? 'conclusion' : `scene_${index}`;
    setRewritingSection(sectionKey);

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
        if (editingCard?.mode === 'visuals') {
          res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_visuals_section', projectId, index, type, data, rewritePrompt
          );
        } else {
          res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_script_section', index, type, data, rewritePrompt, selectedProject.language
          );
        }
      }

      if (res?.success && res.data) {
        const updated = { ...data };
        if (editingCard?.mode === 'visuals') {
          // Visuals rewrite only returns the sub_visuals array, we merge it into the existing scene/section
          if (type === 'introduction') updated.introduction.sub_visuals = res.data.sub_visuals || [];
          else if (type === 'conclusion') updated.conclusion.sub_visuals = res.data.sub_visuals || [];
          else updated.scenes[index].sub_visuals = res.data.sub_visuals || [];
        } else {
          // Script rewrite returns the whole section (without sub_visuals by default now)
          // We need to merge existing sub_visuals back in if this wasn't a new scene
          const newSection = res.data;
          let oldSubVisuals = [];
          if (type === 'introduction') oldSubVisuals = updated.introduction?.sub_visuals || [];
          else if (type === 'conclusion') oldSubVisuals = updated.conclusion?.sub_visuals || [];
          else if (!isNewScene) oldSubVisuals = updated.scenes[index]?.sub_visuals || [];
          
          newSection.sub_visuals = oldSubVisuals;
          
          if (type === 'introduction') updated.introduction = newSection;
          else if (type === 'conclusion') updated.conclusion = newSection;
          else updated.scenes[index] = newSection;
        }
        setScriptData(updated);

        if (isNewScene || isNewIntroduction || isNewConclusion) {
          setRewritePrompt('');
          setRewritingSection(null);
          addToast("AI content generated! Review and click Save to fetch visuals.", 'success');
        } else {
          await callApi('save_json_file', selectedProject.script_path, updated);
          setEditingCard(null);
          setRewritePrompt('');
          setRewritingSection(null);
          setScriptChangedAlert(true);
          addToast("LLM rewrite completed and saved! Click 'Sync Audio & Subtitles' or 'Resume Pipeline' to rebuild voiceover.", 'success');
        }
      } else {
        setRewritingSection(null);
        addToast("Rewrite failed: " + (res?.error || "Unknown error"), 'error');
      }
    } catch (err: any) {
      setRewritingSection(null);
      console.error(err);
      addToast("Rewrite failed: " + (err?.message || String(err)), 'error');
    }
  }, [projectId, scriptData, selectedProject, rewritePrompt, setScriptData, addToast]);

  const handleRewriteSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number, prompt: string) => {
    const data = scriptData;
    if (!projectId || !data || !selectedProject?.script_path) return;
    try {
      const res = await callApiOrThrow<{ success: boolean; data?: any; error?: string }>(
        'regenerate_sub_visual', projectId, sceneIdx, sectionType, subIdx, data, prompt, selectedProject.language
      );
      if (res?.success && res.data) {
        // Deep clone to avoid mutating React state via shared nested references
        const updated = JSON.parse(JSON.stringify(data));

        let targetSection;
        if (sectionType === 'introduction') targetSection = updated.introduction;
        else if (sectionType === 'conclusion') targetSection = updated.conclusion;
        else targetSection = updated.scenes?.[sceneIdx];

        if (targetSection && targetSection.sub_visuals) {
          targetSection.sub_visuals[subIdx] = res.data;
          setScriptData(updated);
          await callApi('save_json_file', selectedProject.script_path, updated);
          addToast("Sub-Visual updated successfully!", 'success');
        }
      } else {
        addToast("Rewrite failed: " + (res?.error || "Unknown error"), 'error');
      }
    } catch (err: any) {
      console.error(err);
      addToast("Rewrite failed: " + (err?.message || String(err)), 'error');
    }
  }, [projectId, scriptData, selectedProject, setScriptData, addToast]);

  const handleUploadSubVisual = useCallback(async (sceneIdx: number, sectionType: string, subIdx: number) => {
    const data = scriptData;
    if (!projectId || !data) return;

    const sectionKey = sectionType === 'introduction' ? 'intro'
      : sectionType === 'conclusion' ? 'conclusion'
      : `scene_${sceneIdx}`;
    const assetKey = `${sectionKey}_${subIdx}`;

    // Calculate the correct manifest index (intro is 0, scenes follow, conclusion is last)
    let manifestIdx = sceneIdx;
    if (sectionType === 'introduction') {
      manifestIdx = 0;
    } else if (sectionType === 'conclusion') {
      manifestIdx = (manifestData?.length || 1) - 1;
    } else if (sectionType === 'scenes') {
      const hasIntro = manifestData?.[0]?.section_type === 'introduction';
      manifestIdx = sceneIdx + (hasIntro ? 1 : 0);
    }

    // Read the current type from scriptData — the same live source the UI
    // renders — and normalize it (getValidVisualType) so the backend's
    // strict video/image decision matches the button the user clicked.
    // Reading from manifestData here could be stale (an unsaved type change)
    // or carry a fuzzy label that the backend rejects.
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
    const visualType = getValidVisualType(rawVisualType);

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
      } else {
        addToast("Upload failed: " + (result?.error || "Unknown error"), 'error');
      }
    } catch (err: any) {
      console.error(err);
      addToast("Upload failed: " + (err?.message || String(err)), 'error');
    } finally {
      setUploadingSubVisual(null);
    }
  }, [projectId, scriptData, manifestData, previewAssets, addToast]);

  const insertAndSaveNewScene = useCallback(async (newScene: any, insertAfterIdx: number) => {
    if (!projectId || !scriptData || !selectedProject?.script_path) return;

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
    setScriptChangedAlert(true);
  }, [projectId, scriptData, selectedProject, manifestData, setScriptData, setManifestData]);

  const confirmDeleteScene = useCallback(async () => {
    if (sceneToDelete === null || !projectId) return;
    const idx = sceneToDelete;

    // Delegate entirely to the backend delete_scene API which handles:
    // 1. Script scene removal + re-numbering
    // 2. Manifest entry removal
    // 3. Asset file cleanup + renaming to keep indices consistent
    const result = await callApi<any>('delete_scene', projectId, idx);
    if (result?.success) {
      await loadFiles(projectId);
      addToast("Scene deleted successfully! Please resume pipeline to sync audio.", 'success');
      setScriptChangedAlert(true);
    } else {
      addToast("Failed to delete scene: " + (result?.error || "Unknown error"), 'error');
    }
    setSceneToDelete(null);
  }, [sceneToDelete, projectId, loadFiles, addToast]);

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
    rewritingSection,
    savingCardKey, sceneToDelete,
    localProjectSettings, isSavingSubtitles,
    scriptChangedAlert, setScriptChangedAlert,
    previewAssets, uploadingSubVisual, handleUploadSubVisual,
    handleStartEdit, handleCancelEdit,
    handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene,
    setSceneToDelete, handleSettingsUpdate, handleSaveTranscription, handleResetTranscription,
  };
}
