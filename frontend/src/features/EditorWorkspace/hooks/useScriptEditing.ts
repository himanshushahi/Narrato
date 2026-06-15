import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../../../store/useProjectStore';
import { useUIStore } from '../../../store/useUIStore';
import { callEel, callEelOrThrow } from '../../../utils/eel-bridge';

import { estimateTextDuration } from '../../../utils/duration';

export interface UseScriptEditingReturn {
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
  const { addToast } = useUIStore();

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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localProjectSettings from selectedProject.project_settings
  useEffect(() => {
    if (selectedProject?.project_settings) {
      try {
        setLocalProjectSettings(JSON.parse(selectedProject.project_settings));
      } catch {
        setLocalProjectSettings({});
      }
    } else {
      setLocalProjectSettings({});
    }
  }, [selectedProject?.project_settings]);

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
            link.href = `/api/media?path=${encodeURIComponent(res.css_path)}`;
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

  const handleCancelEdit = useCallback(() => {
    if (originalScriptData) setScriptData(originalScriptData);
    setEditingCard(null);
    setOriginalScriptData(null);
    setOriginalManifestData([]);
    setRewritePrompt('');
  }, [originalScriptData, setScriptData]);

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
    if (!projectId || !scriptData || !selectedProject?.script_path) return;

    if (cardKey) setSavingCardKey(cardKey);

    let narrationChanged = false;
    if (originalScriptData && editingCard?.mode === 'script') {
      if (cardKey === 'introduction' || cardKey === 'intro') {
        if (scriptData.introduction?.hook !== originalScriptData.introduction?.hook) narrationChanged = true;
      } else if (cardKey === 'conclusion') {
        if (scriptData.conclusion?.summary !== originalScriptData.conclusion?.summary ||
          scriptData.conclusion?.cta !== originalScriptData.conclusion?.cta) narrationChanged = true;
      } else if (index !== undefined && scriptData.scenes && originalScriptData.scenes) {
        if (scriptData.scenes[index]?.narration !== originalScriptData.scenes[index]?.narration) narrationChanged = true;
      }
    }

    const success = await callEel<boolean>('save_json_file', selectedProject.script_path, scriptData);
    if (success) {
      // Build live manifest
      let sceneCounter = 0;
      const liveManifest = manifestData.map((manifestScene: any) => {
        const type = manifestScene.section_type;
        let liveSubVisuals: any[] = [];
        if (type === 'introduction' && scriptData?.introduction) {
          liveSubVisuals = scriptData.introduction?.sub_visuals || [];
        } else if (type === 'conclusion' && scriptData?.conclusion) {
          liveSubVisuals = scriptData.conclusion?.sub_visuals || [];
        } else if (type === 'scene' && Array.isArray(scriptData?.scenes)) {
          const currentIdx = sceneCounter++;
          const scriptScene = scriptData.scenes[currentIdx];
          if (scriptScene) liveSubVisuals = scriptScene?.sub_visuals || [];
        }

        const origSubVisuals = manifestScene.sub_visuals || [];
        // Match by content (type+cue) rather than by index,
        // so inserted/deleted sub-visuals don't shift existing assets
        const matchedIndices = new Set<number>();
        const mergedSubVisuals = liveSubVisuals.map((lsv: any) => {
          const matchIdx = origSubVisuals.findIndex((osv: any, i: number) =>
            !matchedIndices.has(i) &&
            osv.visual_type === lsv.visual_type &&
            osv.visual_cue === lsv.visual_cue
          );
          if (matchIdx !== -1) {
            matchedIndices.add(matchIdx);
            const match = origSubVisuals[matchIdx];
            return { ...lsv, visual_path: match.visual_path, visual_url: match.visual_url };
          }
          return lsv; // New or changed sub-visual — no existing asset to carry over
        });

        const sceneText = type === 'introduction' ? scriptData?.introduction?.hook
          : type === 'conclusion' ? scriptData?.conclusion?.summary
            : scriptData?.scenes?.[sceneCounter - 1]?.narration;
        const sceneDuration = manifestScene.duration > 0 ? manifestScene.duration : estimateTextDuration(sceneText);

        return { ...manifestScene, duration: sceneDuration, sub_visuals: mergedSubVisuals };
      });

      await callEel<any>('save_project_with_cleanup', projectId, scriptData, liveManifest);

      // Fetch assets only for genuinely new/changed sub-visuals
      const origManifest = originalManifestData.length > 0 ? originalManifestData : manifestData;
      for (let mIdx = 0; mIdx < liveManifest.length; mIdx++) {
        const liveSubs = liveManifest[mIdx].sub_visuals || [];
        const origSubs = origManifest[mIdx]?.sub_visuals || [];
        const matchedOrigIndices = new Set<number>();
        for (let sIdx = 0; sIdx < liveSubs.length; sIdx++) {
          const lsv = liveSubs[sIdx];
          const origMatch = origSubs.findIndex((osv: any, i: number) =>
            !matchedOrigIndices.has(i) &&
            osv.visual_type === lsv.visual_type &&
            osv.visual_cue === lsv.visual_cue &&
            osv.visual_path
          );
          if (origMatch === -1 && lsv.visual_type && ['scene', 'image', 'portrait', 'parallax', 'youtube'].includes(lsv.visual_type)) {
            try {
              await callEel('fetch_single_scene_asset', projectId, mIdx, sIdx, lsv.visual_type, lsv.visual_cue || '');
            } catch (e) { console.error("Failed to fetch asset", sIdx, e); }
          } else if (origMatch !== -1) {
            matchedOrigIndices.add(origMatch);
          }
        }
      }

      await loadFiles(projectId);
      setEditingCard(null);
      setSavingCardKey(null);
      setRewritePrompt('');

      const isNewSceneSave = index !== undefined && !originalScriptData;
      const contentChanged = narrationChanged || isNewSceneSave;
      if (contentChanged) {
        addToast("Narration text updated! We recommend resuming/syncing the pipeline to regenerate voiceover and subtitles.", 'warning', 6000);
        setScriptChangedAlert(true);
      } else {
        addToast("Project saved successfully!", 'success');
      }
    } else {
      setSavingCardKey(null);
      addToast("Failed to save script changes", 'error');
    }
  }, [projectId, scriptData, selectedProject, originalScriptData, originalManifestData, manifestData, loadFiles, addToast]);

  const handleRewriteSection = useCallback(async (type: string, index: number) => {
    if (!projectId || !scriptData || !selectedProject?.script_path) return;

    const sectionKey = type === 'introduction' ? 'intro' : type === 'conclusion' ? 'conclusion' : `scene_${index}`;
    setRewritingSection(sectionKey);

    try {
      let res;
      const isNewScene = type === 'scenes' && scriptData.scenes?.[index] &&
        (!scriptData.scenes[index].narration || scriptData.scenes[index].narration.trim() === '');
      const isNewIntroduction = type === 'introduction' &&
        (!scriptData.introduction?.hook || scriptData.introduction?.hook.trim() === '');
      const isNewConclusion = type === 'conclusion' &&
        (!scriptData.conclusion?.summary || scriptData.conclusion?.summary.trim() === '');

      if (isNewScene) {
        res = await callEelOrThrow<{ success: boolean; data?: any; error?: string }>(
          'add_scene_with_ai', scriptData,
          rewritePrompt || `Create content for ${scriptData.scenes[index].title || 'this scene'}`,
          selectedProject.language
        );
      } else {
        if (editingCard?.mode === 'visuals') {
          res = await callEelOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_visuals_section', index, type, scriptData, rewritePrompt
          );
        } else {
          res = await callEelOrThrow<{ success: boolean; data?: any; error?: string }>(
            'regenerate_script_section', index, type, scriptData, rewritePrompt, selectedProject.language
          );
        }
      }

      if (res?.success && res.data) {
        const updated = { ...scriptData };
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
          await callEel('save_json_file', selectedProject.script_path, updated);
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
    if (!projectId || !scriptData || !selectedProject?.script_path) return;
    try {
      const res = await callEelOrThrow<{ success: boolean; data?: any; error?: string }>(
        'regenerate_sub_visual', sceneIdx, sectionType, subIdx, scriptData, prompt, selectedProject.language
      );
      if (res?.success && res.data) {
        const updated = { ...scriptData };
        
        let targetSection;
        if (sectionType === 'introduction') targetSection = updated.introduction;
        else if (sectionType === 'conclusion') targetSection = updated.conclusion;
        else targetSection = updated.scenes?.[sceneIdx];

        if (targetSection && targetSection.sub_visuals) {
          targetSection.sub_visuals[subIdx] = res.data;
          setScriptData(updated);
          await callEel('save_json_file', selectedProject.script_path, updated);
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
      }
    }

    const newManifestData = manifestData ? [...manifestData] : [];
    newManifestData.splice(manifestInsertIdx, 0, newManifestEntry);
    setManifestData(newManifestData);

    await callEel<any>('save_project_with_cleanup', projectId, newScriptData, newManifestData);
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
    const result = await callEel<any>('delete_scene', projectId, idx);
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
      const success = await callEel<boolean>('save_json_file', selectedProject.transcription_path, transcriptionData);
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

  return {
    editingCard, setEditingCard,
    rewritePrompt, setRewritePrompt,
    rewritingSection,
    savingCardKey, sceneToDelete,
    localProjectSettings, isSavingSubtitles,
    scriptChangedAlert, setScriptChangedAlert,
    handleStartEdit, handleCancelEdit,
    handleSaveCard, handleRewriteSection, handleRewriteSubVisual,
    insertAndSaveNewScene, confirmDeleteScene,
    setSceneToDelete, handleSettingsUpdate, handleSaveTranscription,
  };
}
