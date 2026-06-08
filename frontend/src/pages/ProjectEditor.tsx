import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectStore } from '../store/useProjectStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import RemotionVideoPlayer, { RemotionVideoPlayerRef } from '../components/video/RemotionVideoPlayer';
import { CustomInput, CustomTextarea } from '../components/ui/CustomInput';
import { SubtitleEditor } from '../features/ProjectEditor/components/SubtitleEditor';
import { AnimatedTabs } from '../components/ui/AnimatedTabs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscPlay, VscSave, VscFlame, VscArrowLeft, VscSparkle,
  VscPulse, VscCheck, VscError, VscLoading, VscCircleFilled, VscWarning,
  VscEdit, VscTrash
} from 'react-icons/vsc';

import { PIPELINE_STAGES } from '../features/ProjectEditor/constants';
import { SubVisualsEditor } from '../features/ProjectEditor/SubVisualsEditor';
import { SubVisualsView } from '../features/ProjectEditor/SubVisualsView';
import { ProjectSettingsEditor } from '../features/ProjectEditor/ProjectSettingsEditor';
import { callEel } from '../utils/eel-bridge';

export const ProjectEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const {
    selectedProject, tasks, fetchProjectDetail, startPipeline, cancelPipeline, queue, updateProject, downloadFont
  } = useProjectStore();
  const { addToast, showConfirm } = useUIStore();
  const { settings } = useSettingsStore();

  const [scriptData, setScriptData] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any[]>([]);
  const [transcriptionData, setTranscriptionData] = useState<any>({ segments: [] });
  const [loadingScript, setLoadingScript] = useState(false);
  const [editingCard, setEditingCard] = useState<string | null>(null); // 'intro', 'conclusion', or 'scene_i'
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [targetStage, setTargetStage] = useState('render');
  const [rewritingIdx, setRewritingIdx] = useState<number | null>(null);
  const [rewritingType, setRewritingType] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'script' | 'subtitles'>('script');
  const [isSavingSubtitles, setIsSavingSubtitles] = useState(false);

  const [originalScriptData, setOriginalScriptData] = useState<any>(null);
  const [originalManifestData, setOriginalManifestData] = useState<any[]>([]);
  const [scriptChangedAlert, setScriptChangedAlert] = useState(false);
  const [savingCardKey, setSavingCardKey] = useState<string | null>(null);
  const [sceneToDelete, setSceneToDelete] = useState<number | null>(null);
  const [wasActive, setWasActive] = useState(false);
  const [reloadKey] = useState(0);

  const [currentFrame, setCurrentFrame] = useState(0);
  const playerRef = useRef<RemotionVideoPlayerRef>(null);

  const getLiveScenes = React.useCallback(() => {
    if (!manifestData || !scriptData) return manifestData;

    let sceneCounter = 0;
    return manifestData.map((manifestScene: any) => {
      const type = manifestScene.section_type;
      let liveSubVisuals: any[] = [];
      let liveTitle = manifestScene.title;

      if (type === 'introduction' && scriptData?.introduction) {
        liveSubVisuals = scriptData.introduction?.sub_visuals || [];
      } else if (type === 'conclusion' && scriptData?.conclusion) {
        liveSubVisuals = scriptData.conclusion?.sub_visuals || [];
      } else if (type === 'scene' && Array.isArray(scriptData?.scenes)) {
        const currentIdx = sceneCounter;
        sceneCounter++;
        const scriptScene = scriptData.scenes[currentIdx];
        if (scriptScene) {
          liveSubVisuals = scriptScene?.sub_visuals || [];
          if (scriptScene.title !== undefined) liveTitle = scriptScene.title;
        }
      }

      const origSubVisuals = manifestScene.sub_visuals || [];

      const resolvedSubVisuals = liveSubVisuals.map((lsv: any, idx: number) => {
        const osv = origSubVisuals[idx] || {};
        const requiresNewAsset =
          lsv.visual_type !== osv.visual_type ||
          lsv.visual_cue !== osv.visual_cue ||
          JSON.stringify(lsv.visual_meta || {}) !== JSON.stringify(osv.visual_meta || {});
        const visualUrl = osv.visual_url ? `${osv.visual_url}&t=${reloadKey}` : '';
        return {
          ...osv,
          visual_type: lsv.visual_type,
          visual_cue: lsv.visual_cue,
          transition_type: lsv.transition_type,
          visual_meta: lsv.visual_meta,
          visual_url: visualUrl,
          duration: osv.duration
        };
      });

      const resolvedAudioUrl = manifestScene.audio_url ? `${manifestScene.audio_url}&t=${reloadKey}` : '';

      return {
        ...manifestScene,
        title: liveTitle,
        sub_visuals: resolvedSubVisuals,
        audio_url: resolvedAudioUrl
      };
    });
  }, [manifestData, scriptData, reloadKey]);

  const liveScenes = getLiveScenes();

  const sceneTimings = useMemo(() => {
    if (!liveScenes) return [];
    let offset = 0;
    return liveScenes.map((scene: any) => {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const start = offset;
      const end = offset + durationFrames;

      const subVisuals = scene.sub_visuals || [];
      const numSubs = subVisuals.length;

      let subs: any[] = [];
      if (numSubs > 0) {
        subs = subVisuals.map((_: any, idx: number) => {
          const baseSubDuration = Math.floor(durationFrames / numSubs);
          const subFrom = start + idx * baseSubDuration;
          const subDuration = idx === numSubs - 1
            ? durationFrames - (idx * baseSubDuration)
            : baseSubDuration;
          return { start: subFrom, end: subFrom + Math.max(1, subDuration) };
        });
      }

      offset = end;
      return { start, end, subs };
    });
  }, [liveScenes]);

  const activeSceneIdx = sceneTimings.findIndex(t => currentFrame >= t.start && currentFrame < t.end);
  const activeSubIdx = activeSceneIdx >= 0 && sceneTimings[activeSceneIdx].subs.length > 0
    ? sceneTimings[activeSceneIdx].subs.findIndex(t => currentFrame >= t.start && currentFrame < t.end)
    : -1;

  const handleSeek = (frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  };


  const handleStartEdit = (cardKey: string) => {
    setOriginalScriptData(JSON.parse(JSON.stringify(scriptData)));
    setOriginalManifestData(JSON.parse(JSON.stringify(manifestData)));
    setEditingCard(cardKey);
  };

  const handleCancelEdit = () => {
    if (originalScriptData) {
      setScriptData(originalScriptData);
    }
    setEditingCard(null);
    setOriginalScriptData(null);
    setOriginalManifestData([]);
  };

  const [localProjectSettings, setLocalProjectSettings] = useState<any>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (selectedProject?.project_settings) {
      try {
        setLocalProjectSettings(JSON.parse(selectedProject.project_settings));
      } catch (e) {
        setLocalProjectSettings({});
      }
    } else {
      setLocalProjectSettings({});
    }
  }, [selectedProject?.project_settings]);

  const handleSettingsUpdate = (newSettings: any) => {
    setLocalProjectSettings(newSettings);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedProject?.id) {
        await updateProject(selectedProject.id, { project_settings: JSON.stringify(newSettings) });
      }
    }, 1000);
  };

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

  useEffect(() => {
    if (id) {
      fetchProjectDetail(id);
      loadFiles(id);
    }
  }, [id]);

  useEffect(() => {
    if (queue.active === id) {
      setWasActive(true);
    } else if (wasActive && queue.active !== id) {
      setWasActive(false);
      loadFiles(id!);
    }
  }, [queue.active, id, wasActive]);

  const previousTasksRef = React.useRef(tasks);

  useEffect(() => {
    // Check if any critical tasks just completed to live-reload assets (Bug Fix)
    const criticalSteps = ['generate_script', 'transcribe', 'fetch_assets'];
    let shouldReload = false;

    for (const step of criticalSteps) {
      const prevStatus = previousTasksRef.current[step]?.status;
      const currStatus = tasks[step]?.status;

      if (prevStatus !== 'completed' && currStatus === 'completed') {
        shouldReload = true;
        break;
      }
    }

    if (shouldReload && id) {
      loadFiles(id);
    }

    previousTasksRef.current = tasks;
  }, [tasks, id]);

  // Read generated JSON assets from Python server static bridges
  const loadFiles = async (projId: string) => {
    setLoadingScript(true);
    try {
      const project = await callEel<any>('db_get_project', projId);
      if (project) {
        if (project.script_path) {
          const script = await callEel<any>('read_json_file', project.script_path);
          setScriptData(script);
        }
        if (project.assets_manifest_path) {
          const manifest = await callEel<any>('read_json_file', project.assets_manifest_path);
          // Transform visual_path → visual_url for the player
          // The manifest stores absolute file paths, but the Remotion player needs HTTP URLs
          // served through the Bottle media server (same pattern as audio URLs)
          const enrichedManifest = (manifest || []).map((scene: any) => {
            const enrichedSubVisuals = (scene.sub_visuals || []).map((sv: any) => ({
              ...sv,
              visual_url: sv.visual_path
                ? `/api/media?path=${encodeURIComponent(sv.visual_path)}`
                : ''
            }));

            return {
              ...scene,
              visual_url: scene.visual_path
                ? `/api/media?path=${encodeURIComponent(scene.visual_path)}`
                : '',
              sub_visuals: enrichedSubVisuals
            };
          });
          setManifestData(enrichedManifest);
          // Also reset original manifest data when loading fresh files
          setOriginalManifestData(enrichedManifest);
        }
        if (project.transcription_path) {
          const transcript = await callEel<any>('read_json_file', project.transcription_path);
          setTranscriptionData(transcript || { segments: [] });
        }
      }
    } catch (e) {
      console.error("Failed to load asset JSONs:", e);
    } finally {
      setLoadingScript(false);
      setScriptChangedAlert(false);
    }
  };

  if (!selectedProject) {
    return (
      <div className="py-20 text-center text-stone-400">
        <p>Loading project workspace...</p>
      </div>
    );
  }

  // Calculate current active pipeline progress
  const activeTaskStep = queue.active === selectedProject.id ? Object.values(tasks).find(t => t.status === 'running') : null;

  const triggerFullPipeline = async () => {
    if (!id) return;
    setScriptChangedAlert(false);
    const allSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render'];
    const targetIdx = allSteps.indexOf(targetStage);
    const steps = allSteps.slice(0, targetIdx + 1);
    await startPipeline(id, steps);
    loadFiles(id);
  };



  const hasVisualEdits = () => {
    if (!manifestData || !scriptData) return false;

    let sceneCounter = 0;
    let changed = false;

    manifestData.forEach((manifestScene: any) => {
      const type = manifestScene.section_type;
      let liveSubVisuals: any[] = [];

      if (type === 'introduction' && scriptData?.introduction) {
        liveSubVisuals = scriptData.introduction?.sub_visuals || [];
      } else if (type === 'conclusion' && scriptData?.conclusion) {
        liveSubVisuals = scriptData.conclusion?.sub_visuals || [];
      } else if (type === 'scene' && Array.isArray(scriptData?.scenes)) {
        const scriptScene = scriptData.scenes[sceneCounter];
        sceneCounter++;
        if (scriptScene) {
          liveSubVisuals = scriptScene?.sub_visuals || [];
        }
      }

      const origSubVisuals = manifestScene.sub_visuals || [];
      const relevantLiveSubVisuals = liveSubVisuals.map((lsv: any) => ({
        visual_type: lsv.visual_type,
        visual_cue: lsv.visual_cue,
        transition_type: lsv.transition_type,
        visual_meta: lsv.visual_meta
      }));
      const relevantOrigSubVisuals = origSubVisuals.map((osv: any) => ({
        visual_type: osv.visual_type,
        visual_cue: osv.visual_cue,
        transition_type: osv.transition_type,
        visual_meta: osv.visual_meta
      }));
      if (JSON.stringify(relevantLiveSubVisuals) !== JSON.stringify(relevantOrigSubVisuals)) {
        changed = true;
      }
    });

    return changed;
  };

  const canResumeFrom = (stageId: string) => {
    if (queue.active === selectedProject.id) return false;
    if (scriptChangedAlert) return false;

    const stageIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (stageIdx === -1) return false;

    const currentTargetIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    if (currentTargetIdx !== -1 && stageIdx > currentTargetIdx) {
      return false;
    }

    for (let i = 0; i < stageIdx; i++) {
      const priorStageId = PIPELINE_STAGES[i].id;
      if (tasks[priorStageId]?.status !== 'completed') {
        return false;
      }
    }
    return true;
  };

  const handleResumeFromStage = async (stageId: string) => {
    if (!id || !canResumeFrom(stageId)) return;

    const startIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (startIdx === -1) return;

    // Respect the targetStage selection
    const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    const finalEndIdx = endIdx !== -1 && endIdx >= startIdx ? endIdx : PIPELINE_STAGES.length - 1;

    const stepsToRun = PIPELINE_STAGES.slice(startIdx, finalEndIdx + 1).map(s => s.id);

    setScriptChangedAlert(false);
    try {
      const res = await startPipeline(id, stepsToRun);
      if (res.success) {
        addToast(`Resumed pipeline from: ${PIPELINE_STAGES[startIdx].title}`, 'success');
      } else {
        addToast(res.error || "Failed to start pipeline", 'error');
      }
      loadFiles(id);
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  };

  const handleResumePipeline = async () => {
    if (!id) return;

    try {
      let res;

      const allSteps = PIPELINE_STAGES.map(s => s.id);
      const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
      const limitSteps = (steps: string[]) => {
        if (endIdx === -1) return steps;
        return steps.filter(step => allSteps.indexOf(step) <= endIdx);
      };

      let stepsToRun: string[] = [];
      if (scriptChangedAlert) {
        stepsToRun = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
      } else if (hasVisualEdits()) {
        stepsToRun = limitSteps(['fetch_assets', 'render']);
      } else {
        // Find remaining steps
        const completedSteps = new Set(Object.values(tasks).filter(t => t.status === 'completed').map(t => t.step));
        let remainingSteps = allSteps.filter(s => !completedSteps.has(s));
        if (remainingSteps.length === 0) remainingSteps = ['render'];
        stepsToRun = limitSteps(remainingSteps);
      }

      if (stepsToRun.length === 0) {
        addToast("All selected stages are already completed. Select a later target stage or use the Re-run buttons.", 'warning', 5000);
        return;
      }

      res = await startPipeline(id, stepsToRun);

      setScriptChangedAlert(false);

      if (res.success) {
        addToast("Pipeline started successfully", 'success');
      } else {
        addToast(res.error || "Failed to start pipeline", 'error');
      }
      loadFiles(id);
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  };

  const confirmDeleteScene = async () => {
    if (sceneToDelete === null || !scriptData || !manifestData || !id || !selectedProject.script_path) return;
    const idx = sceneToDelete;

    const newScriptData = { ...scriptData };
    if (newScriptData.scenes) {
      newScriptData.scenes.splice(idx, 1);
    }

    // Find the corresponding scene in manifestData and remove it
    let sceneCounter = 0;
    const newManifestData = manifestData.filter((item: any) => {
      if (item.section_type === 'scene') {
        if (sceneCounter === idx) {
          sceneCounter++;
          return false; // Remove this one
        }
        sceneCounter++;
      }
      return true;
    });

    const success = await callEel<any>('save_project_with_cleanup', id, newScriptData, newManifestData);
    if (success) {
      await loadFiles(id);
      addToast("Scene deleted successfully! Please resume pipeline to sync audio.", 'success');
      setScriptChangedAlert(true);
    } else {
      addToast("Failed to delete scene.", 'error');
    }
    setSceneToDelete(null);
  };

  const handleSaveCard = async (cardKey?: string, index?: number) => {
    if (!id || !scriptData || !selectedProject.script_path) return;

    if (cardKey) {
      setSavingCardKey(cardKey);
    }

    let narrationChanged = false;
    if (originalScriptData) {
      if (cardKey === 'introduction' || cardKey === 'intro') {
        if (scriptData.introduction?.hook !== originalScriptData.introduction?.hook) {
          narrationChanged = true;
        }
      } else if (cardKey === 'conclusion') {
        if (scriptData.conclusion?.summary !== originalScriptData.conclusion?.summary ||
          scriptData.conclusion?.cta !== originalScriptData.conclusion?.cta) {
          narrationChanged = true;
        }
      } else if (index !== undefined && scriptData.scenes && originalScriptData.scenes) {
        const scene = scriptData.scenes[index];
        const origScene = originalScriptData.scenes[index];
        if (scene && origScene && scene.narration !== origScene.narration) {
          narrationChanged = true;
        }
      }
    }

    const success = await callEel<boolean>('save_json_file', selectedProject.script_path, scriptData);
    if (success) {
      // Build the full manifest with live sub_visuals from scriptData
      const buildLiveManifest = () => {
        if (!manifestData || !scriptData) return manifestData;

        let sceneCounter = 0;
        return manifestData.map((manifestScene: any) => {
          const type = manifestScene.section_type;
          let liveSubVisuals: any[] = [];

          if (type === 'introduction' && scriptData?.introduction) {
            liveSubVisuals = scriptData.introduction?.sub_visuals || [];
          } else if (type === 'conclusion' && scriptData?.conclusion) {
            liveSubVisuals = scriptData.conclusion?.sub_visuals || [];
          } else if (type === 'scene' && Array.isArray(scriptData?.scenes)) {
            const currentIdx = sceneCounter;
            sceneCounter++;
            const scriptScene = scriptData.scenes[currentIdx];
            if (scriptScene) {
              liveSubVisuals = scriptScene?.sub_visuals || [];
            }
          }

          const origSubVisuals = manifestScene.sub_visuals || [];
          const mergedSubVisuals = liveSubVisuals.map((lsv: any, idx: number) => {
            const osv = origSubVisuals[idx] || {};
            const requiresNewAsset =
              lsv.visual_type !== osv.visual_type ||
              lsv.visual_cue !== osv.visual_cue ||
              JSON.stringify(lsv.visual_meta || {}) !== JSON.stringify(osv.visual_meta || {});

            if (!requiresNewAsset) {
              return {
                ...lsv,
                visual_path: osv.visual_path,
                visual_url: osv.visual_url,
                duration: osv.duration
              };
            }
            return lsv;
          });

          return {
            ...manifestScene,
            sub_visuals: mergedSubVisuals
          };
        });
      };

      const liveManifest = buildLiveManifest();

      // Use the new save_project_with_cleanup API to save and cleanup assets
      const cleanupResult = await callEel<any>('save_project_with_cleanup', id, scriptData, liveManifest);

      if (cleanupResult) {
        console.log(`Assets cleaned: ${cleanupResult.deleted_files?.length || 0} deleted, ${cleanupResult.preserved_files?.length || 0} preserved`);
      }

      // Fetch updated assets for changed sub-visuals (only if actual edits were made)
      if (liveManifest) {
        // Compare against the original manifest state at edit time, not the current manifestData
        const originalManifest = originalManifestData.length > 0 ? originalManifestData : manifestData;

        for (let manifestIndex = 0; manifestIndex < liveManifest.length; manifestIndex++) {
          const manifestScene = liveManifest[manifestIndex];
          const liveSubVisuals = manifestScene.sub_visuals || [];
          // Match by index, not by section_type (since multiple scenes share the same section_type)
          const origScene = originalManifest[manifestIndex];
          const origSubVisuals = origScene?.sub_visuals || [];

          for (let subIdx = 0; subIdx < liveSubVisuals.length; subIdx++) {
            const liveSv = liveSubVisuals[subIdx];
            const origSv = origSubVisuals[subIdx] || {};

            // Compare only the relevant fields that trigger asset fetching
            const liveKey = JSON.stringify({
              visual_type: liveSv.visual_type,
              visual_cue: liveSv.visual_cue,
              visual_meta: liveSv.visual_meta
            });
            const origKey = JSON.stringify({
              visual_type: origSv.visual_type,
              visual_cue: origSv.visual_cue,
              visual_meta: origSv.visual_meta
            });
            const hasChanged = liveKey !== origKey;

            if (hasChanged && liveSv.visual_type && ['scene', 'image', 'portrait', 'parallax', 'youtube'].includes(liveSv.visual_type)) {
              try {
                await callEel('fetch_single_scene_asset', id, manifestIndex, subIdx, liveSv.visual_type, liveSv.visual_cue || '');
              } catch (e) {
                console.error("Failed to fetch updated sub_visual", subIdx, e);
              }
            }
          }
        }
      }

      await loadFiles(id);

      setEditingCard(null);
      setSavingCardKey(null);

      // Show appropriate toast based on what changed
      if (narrationChanged) {
        addToast("Narration text updated! We recommend resuming/syncing the pipeline to regenerate voiceover and subtitles.", 'warning', 6000);
        setScriptChangedAlert(true);
      } else if (cleanupResult?.deleted_files && cleanupResult.deleted_files.length > 0) {
        addToast(`Saved! Removed ${cleanupResult.deleted_files.length} unused asset file(s).`, 'success');
      } else {
        addToast("Project saved successfully!", 'success');
      }
    } else {
      setSavingCardKey(null);
      addToast("Failed to save script changes", 'error');
    }
  };

  const handleSaveTranscription = async () => {
    if (!id || !transcriptionData || !selectedProject.transcription_path) return;
    setIsSavingSubtitles(true);
    try {
      const success = await callEel<boolean>('save_json_file', selectedProject.transcription_path, transcriptionData);
      if (success) {
        addToast("Subtitles saved successfully!", 'success');
        // Reload files so the Remotion player gets the new data.
        loadFiles(id);
      } else {
        addToast("Failed to save subtitles", 'error');
      }
    } catch (e) {
      console.error(e);
      addToast("Failed to save subtitles", 'error');
    } finally {
      setIsSavingSubtitles(false);
    }
  };


  const handleRewriteSection = async (type: string, index: number) => {
    if (!id || !scriptData || !selectedProject.script_path) return;
    setRewritingIdx(index);
    setRewritingType(type);

    try {
      const res = await callEel<{ success: boolean; data?: any; error?: string }>('regenerate_script_section', index, type, scriptData, rewritePrompt, selectedProject.language);

      if (res?.success && res.data) {
        const updated = { ...scriptData };
        if (type === 'introduction') {
          updated.introduction = res.data;
        } else if (type === 'conclusion') {
          updated.conclusion = res.data;
        } else {
          updated.scenes[index] = res.data;
        }

        setScriptData(updated);
        await callEel('save_json_file', selectedProject.script_path, updated);
        setEditingCard(null);
        setRewritePrompt('');
        setScriptChangedAlert(true);
        addToast("LLM rewrite completed and saved! Click 'Sync Audio & Subtitles' or 'Resume Pipeline' to rebuild voiceover.", 'success');
      } else {
        addToast("Rewrite failed: " + (res?.error || "Unknown error"), 'error');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRewritingIdx(null);
      setRewritingType('');
    }
  };

  // Convert local project assets directory file paths to media streaming URLs
  const getAudioSourceUrl = () => {
    if (selectedProject.audio_path) {
      return `/api/media?path=${encodeURIComponent(selectedProject.audio_path)}&t=${reloadKey}`;
    }
    return '';
  };

  const getBGMUrl = () => {
    if (selectedProject.bg_music_path) {
      return `/api/media?path=${encodeURIComponent(selectedProject.bg_music_path)}&t=${reloadKey}`;
    }
    return '';
  };

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] z-10 relative">

      {/* Editor Sub-header */}
      <div className="bg-transparent border-b border-stone-850 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 text-stone-400 hover:text-white rounded hover:bg-stone-800 transition-colors">
            <VscArrowLeft />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white font-sans tracking-tight">{selectedProject.name}</h1>
            <p className="text-[10px] text-stone-500 font-mono mt-0.5">ID: {selectedProject.id.slice(0, 8)}... | Style: {selectedProject.style}</p>
          </div>
        </div>

        {/* Pipeline Controls */}
        <div className="flex items-center gap-3">
          {queue.active === selectedProject.id ? (
            <span className="text-xs bg-amber-600/10 text-amber-400 px-3 py-2 rounded border border-amber-600/25 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <VscPulse className="animate-spin text-sm" /> Processing...
            </span>
          ) : (
            <>
              {!selectedProject.script_path && (
                <button
                  onClick={triggerFullPipeline}
                  className="bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white px-5 py-2.5 rounded text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <VscFlame className="text-sm" /> Generate Video
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor Split Layout */}
      <div className="flex-1 flex min-h-0 bg-transparent">

        {/* Left Side: Remotion Video Player & Compiler Progress */}
        <div className="w-1/2 p-6 flex flex-col gap-6 border-r border-stone-850/50 overflow-y-auto">
          <div>
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-widest mb-3">Live Video Canvas</h2>
            <RemotionVideoPlayer
              ref={playerRef}
              audioUrl={getAudioSourceUrl()}
              bgMusicUrl={getBGMUrl()}
              bgMusicVolume={selectedProject.bg_music_volume}
              scenes={liveScenes}
              transcription={transcriptionData}
              styleType={selectedProject.style}
              language={selectedProject.language}
              videoFormat={selectedProject.video_format || 'landscape'}
              subtitleSettings={localProjectSettings}
              onFrameUpdate={setCurrentFrame}
            />
          </div>

          {/* Production Pipeline & Controls Panel */}
          <div className="bg-black/20 border border-stone-850 p-5 rounded-xl shadow-lg flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-stone-800/50 pb-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-stone-300 font-sans">
                  Production Pipeline
                </h3>
                <p className="text-[10px] text-stone-500 mt-0.5">Automated video generation workflow</p>
              </div>
              {queue.active === selectedProject.id && (
                <span className="text-[9px] bg-amber-600/10 text-amber-400 px-2 py-0.5 rounded border border-amber-600/20 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  <VscPulse className="animate-spin text-xs" />
                  Active
                </span>
              )}
            </div>

            {/* Stages List */}
            <div className="flex flex-col relative py-1">
              {PIPELINE_STAGES.map((stage, idx) => {
                const task = tasks[stage.id];
                const isRunning = queue.active === selectedProject.id && (activeTaskStep?.step === stage.id || task?.status === 'running');
                const isCompleted = task?.status === 'completed';
                const isFailed = task?.status === 'failed' || (!queue.active && task?.status === 'running');
                const isPending = task?.status === 'pending';
                const clickable = canResumeFrom(stage.id);

                let progress = 0;
                if (isRunning) {
                  progress = activeTaskStep?.progress || task?.progress || 0;
                } else if (isCompleted) {
                  progress = 100;
                }

                const message = isRunning
                  ? (activeTaskStep?.message || task?.message || 'Processing...')
                  : (isFailed ? (task?.error_message || 'Failed') : '');

                return (
                  <div
                    key={stage.id}
                    onClick={() => clickable && handleResumeFromStage(stage.id)}
                    className={`relative pl-11 pr-3 pb-5 last:pb-2 flex flex-col group/stage transition-all duration-200 py-1.5 -mx-3 rounded-lg border border-transparent ${clickable ? 'cursor-pointer hover:bg-stone-850/60 hover:border-stone-800/80 hover:shadow-sm' : ''
                      }`}
                  >
                    {/* Connecting vertical line */}
                    {idx < PIPELINE_STAGES.length - 1 && (
                      <div className={`absolute left-[21px] top-7 bottom-0 w-[2px] transition-colors duration-300 ${isCompleted ? 'bg-emerald-500/30' : 'bg-stone-850'
                        }`} />
                    )}

                    {/* Circle Status Badge */}
                    <div className="absolute left-3 top-1.5">
                      {isCompleted ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shrink-0" title="Completed">
                          <VscCheck className="text-xs" />
                        </div>
                      ) : isRunning ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0 animate-pulse" title="Running">
                          <VscLoading className="text-xs animate-spin" />
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500/10 text-red-400 border border-red-500/25 shrink-0" title="Failed">
                          <VscError className="text-xs font-bold" />
                        </div>
                      ) : isPending ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0 animate-pulse" title="Queued">
                          <VscCircleFilled className="text-[10px]" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-stone-850 text-stone-500 border border-stone-800 shrink-0" title="Pending">
                          <span className="text-[9px] font-bold font-mono">{idx + 1}</span>
                        </div>
                      )}
                    </div>

                    {/* Stage Info */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className={`text-xs font-bold font-sans transition-colors ${isRunning ? 'text-amber-400 font-extrabold' : isCompleted ? 'text-stone-300 font-bold' : isFailed ? 'text-red-400 font-bold' : 'text-stone-400 font-medium'
                          }`}>
                          {stage.title}
                        </span>
                        <span className="text-[10px] text-stone-500 mt-0.5">{stage.desc}</span>
                      </div>

                      {/* Status Text or Action Button */}
                      <div className="shrink-0 flex items-center min-w-[85px] justify-end relative h-8">
                        {clickable ? (
                          <>
                            {/* Status badge: shown by default, fades out on hover */}
                            <div className="group-hover/stage:opacity-0 transition-opacity duration-200 flex items-center justify-end">
                              <span className={`text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${isCompleted ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/10' :
                                isRunning ? 'bg-amber-500/5 text-amber-400 border-amber-500/10 animate-pulse' :
                                  isFailed ? 'bg-red-500/5 text-red-400 border-red-500/10' :
                                    isPending ? 'bg-blue-500/5 text-blue-400 border-blue-500/10' :
                                      'bg-stone-900 text-stone-600 border-stone-800/60'
                                }`}>
                                {isCompleted ? 'Done' :
                                  isRunning ? `${progress.toFixed(0)}%` :
                                    isFailed ? 'Failed' :
                                      isPending ? 'Queued' :
                                        'Waiting'}
                              </span>
                            </div>

                            {/* Resume button: hidden by default, fades in on hover */}
                            <div className="absolute right-0 opacity-0 group-hover/stage:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/stage:pointer-events-auto flex items-center justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResumeFromStage(stage.id);
                                }}
                                className="bg-amber-600 hover:bg-amber-700 text-zinc-950 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded transition-all cursor-pointer shadow-md hover:scale-105 flex items-center gap-1"
                              >
                                <VscPlay className="text-[9px]" /> {isCompleted ? 'Re-run' : 'Resume'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className={`text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${isCompleted ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/10' :
                            isRunning ? 'bg-amber-500/5 text-amber-400 border-amber-500/10 animate-pulse' :
                              isFailed ? 'bg-red-500/5 text-red-400 border-red-500/10' :
                                isPending ? 'bg-blue-500/5 text-blue-400 border-blue-500/10' :
                                  'bg-stone-900 text-stone-600 border-stone-800/60'
                            }`}>
                            {isCompleted ? 'Done' :
                              isRunning ? `${progress.toFixed(0)}%` :
                                isFailed ? 'Failed' :
                                  isPending ? 'Queued' :
                                    'Waiting'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Active Progress Bar */}
                    {isRunning && (
                      <div className="w-full bg-stone-950 h-1.5 rounded-full overflow-hidden border border-stone-800 mt-2">
                        <div
                          className="bg-gradient-to-r from-amber-600 to-orange-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}

                    {/* Message or Error Message */}
                    {message && (
                      <p className={`text-[10px] mt-1.5 leading-relaxed ${isFailed ? 'text-red-400 font-mono border border-red-500/10 bg-red-950/20 px-2 py-1 rounded' : 'text-stone-400 italic'
                        }`}>
                        {message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col gap-3 pt-3 border-t border-stone-850">
              {scriptChangedAlert && (
                <div className="bg-amber-600/10 border border-amber-600/25 p-3 rounded-lg text-[11px] text-amber-300 flex items-start gap-2 animate-pulse mb-1">
                  <VscWarning className="text-sm shrink-0 mt-0.5" />
                  <div>
                    <strong>Script narration changed!</strong> The spoken text has been updated. We recommend clicking <strong>Resume Pipeline</strong> to synchronize narrator voiceovers and subtitles.
                  </div>
                </div>
              )}

              {queue.active === selectedProject.id ? (
                <button
                  onClick={() => cancelPipeline(selectedProject.id)}
                  className="w-full bg-red-600 hover:bg-red-750 text-white py-2.5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer animate-pulse"
                >
                  <VscError className="text-sm font-bold" /> Cancel Pipeline Execution
                </button>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1.5 mb-2 px-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Target Stage (Run Until):</label>
                        <span className="text-[9px] text-amber-500/80 font-mono">{PIPELINE_STAGES.find(s => s.id === targetStage)?.title || 'All'}</span>
                      </div>
                      <div className="flex gap-1 bg-stone-900/60 p-1 rounded-lg border border-stone-800 overflow-hidden">
                        {PIPELINE_STAGES.map((stage, idx) => {
                          const targetIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
                          const isSelected = idx <= targetIdx;
                          const shortNames: Record<string, string> = {
                            'generate_script': 'Script',
                            'generate_voiceover': 'Voice',
                            'transcribe': 'Sync',
                            'fetch_assets': 'Visuals',
                            'render': 'Export'
                          };

                          return (
                            <button
                              key={stage.id}
                              type="button"
                              onClick={() => setTargetStage(stage.id)}
                              className={`flex-1 text-[9px] py-1.5 px-1 font-bold uppercase tracking-wider rounded transition-all duration-200 ${isSelected
                                ? 'bg-amber-600 text-zinc-950 shadow-sm shadow-amber-900/20'
                                : 'text-stone-500 hover:bg-stone-800 hover:text-stone-300 cursor-pointer'
                                }`}
                              title={`Stop after: ${stage.title}`}
                            >
                              {shortNames[stage.id] || stage.id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {!selectedProject.script_path ? (
                        <button
                          onClick={triggerFullPipeline}
                          className="w-full bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white py-2.5 rounded text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <VscFlame className="text-sm" /> Generate Video
                        </button>
                      ) : (
                        <button
                          onClick={handleResumePipeline}
                          className="w-full bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white py-2.5 rounded text-xs font-extrabold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                          title="Intelligently resume pipeline compilation based on your edits"
                        >
                          <VscPlay className="text-sm" /> Resume Pipeline
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-stone-500 text-center select-none leading-relaxed px-1">
                    💡 <strong>Smart Resume:</strong> Skip completed steps like Script Writing or Voiceover to save time, compute power, and API key cost.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Settings reference details */}
          <div className="bg-stone-900/30 border border-stone-800/40 p-4 rounded-lg text-xs text-stone-500 space-y-2">
            <h3 className="font-bold text-stone-400 uppercase tracking-wider text-[10px] mb-1">Canvas Specifications</h3>
            <p>• Output Format: {settings?.render_codec === 'hevc_nvenc' || settings?.render_codec === 'h265' ? 'H.265' : 'H.264'} MP4 | aspect {selectedProject.video_format === 'portrait' ? '9:16' : '16:9'} ({settings?.render_resolution === '4k' ? (selectedProject.video_format === 'portrait' ? '2160x3840' : '3840x2160') : (selectedProject.video_format === 'portrait' ? '1080x1920' : '1920x1080')}) at {settings?.render_fps || 30} fps</p>
            <p>• Visual overlay includes dust scratches and radial vignettes.</p>
            <p>• Subtitles are synced word-by-word with spring animations.</p>
          </div>
        </div>

        {/* Right Side: Interactive Script Editor & Subtitles */}
        <div className="w-1/2 flex flex-col bg-transparent">
          <div className="flex border-b border-stone-850/50 pt-4 px-6 pb-4 sticky top-0 z-10 bg-[var(--color-brand-950)]/95 backdrop-blur-sm">
            <AnimatedTabs
              tabs={[
                { id: 'script', label: 'Documentary Script' },
                { id: 'subtitles', label: 'Customization' }
              ]}
              activeTab={activeTab}
              onChange={(id) => setActiveTab(id as 'script' | 'subtitles')}
              className="w-full"
            />
          </div>

          <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
            {activeTab === 'script' && (
              <>

                {loadingScript ? (
                  <div className="py-12 text-center text-stone-500">
                    <p>Reading script details...</p>
                  </div>
                ) : !scriptData ? (
                  <div className="py-20 text-center bg-stone-900/30 border border-stone-800 rounded-lg p-6">
                    {queue.active === selectedProject.id ? (
                      <>
                        <VscLoading className="text-4xl text-amber-500 animate-spin mx-auto mb-4" />
                        <p className="text-stone-300 font-bold">Generating Script & Assets...</p>
                        <p className="text-xs text-stone-600 mt-1 max-w-xs mx-auto">Please wait while the AI writes the documentary script. This might take a minute.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-stone-400 font-bold">Pipeline assets have not been generated.</p>
                        <p className="text-xs text-stone-600 mt-1 max-w-xs mx-auto mb-5">Launch the generation pipeline from the sidebar to call LLM scripting and synthesize voiceovers.</p>

                        <div className="flex flex-col items-center gap-3">
                          <button
                            onClick={triggerFullPipeline}
                            className="bg-amber-600 cursor-pointer hover:bg-amber-700 text-zinc-950 px-5 py-2.5 rounded text-xs font-bold transition-all shadow-md inline-flex justify-center items-center gap-2 max-w-[240px] w-full"
                          >
                            <VscPlay /> Launch Pipeline
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">

                    {/* Introduction Card */}
                    {(() => {
                      const introSceneIdx = 0;
                      const introTimings = sceneTimings[introSceneIdx]?.subs;
                      const isIntroActive = activeSceneIdx === introSceneIdx;
                      const introActiveSubIdx = isIntroActive ? activeSubIdx : -1;
                      return (
                        <motion.div
                          layout
                          className={`p-5 rounded-xl border transition-all ${editingCard === 'intro' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isIntroActive ? 'bg-black/20 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.03)]' : 'bg-black/10 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${editingCard !== 'intro' ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (editingCard !== 'intro' && sceneTimings[introSceneIdx]) handleSeek(sceneTimings[introSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">0. Hook Introduction</span>
                              {isIntroActive && !editingCard && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {editingCard === 'intro' ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard('introduction')}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === 'introduction' ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit('intro')}
                                  className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {editingCard === 'intro' ? (
                              <motion.div
                                key="edit-intro"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomTextarea
                                  rows={3}
                                  value={scriptData.introduction?.hook || ''}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.introduction = copy.introduction || {};
                                    copy.introduction.hook = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scriptData.introduction?.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; copy.introduction = copy.introduction || {}; copy.introduction.sub_visuals = newSubs; setScriptData(copy); }} timings={introTimings} activeIdx={introActiveSubIdx} onSeek={handleSeek} />

                                {/* LLM Rewrite sub-section */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g., make it sound more suspenseful or dramatic..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('introduction', 0)}
                                      disabled={rewritingType === 'introduction'}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'introduction' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="view-intro"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.introduction?.hook || ''}</p>
                                <SubVisualsView subVisuals={scriptData.introduction?.sub_visuals || []} timings={introTimings} activeIdx={introActiveSubIdx} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })()}

                    {/* Scenes Map */}
                    {(scriptData.scenes || []).map((scene: any, idx: number) => {
                      const cardKey = `scene_${idx}`;
                      const isEditing = editingCard === cardKey;

                      const globalSceneIdx = idx + (scriptData.introduction ? 1 : 0);
                      const timings = sceneTimings[globalSceneIdx]?.subs;
                      const isActive = activeSceneIdx === globalSceneIdx;
                      const activeSubIdxForScene = isActive ? activeSubIdx : -1;

                      return (
                        <motion.div
                          key={idx}
                          layout
                          className={`p-5 rounded-xl border transition-all ${isEditing ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isActive ? 'bg-black/20 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.03)]' : 'bg-black/10 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${!isEditing ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (!isEditing && sceneTimings[globalSceneIdx]) handleSeek(sceneTimings[globalSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">
                                Scene {idx + 1}: {scene.title}
                              </span>
                              {isActive && !isEditing && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard(cardKey, idx)}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === cardKey ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleStartEdit(cardKey)}
                                    className="text-[10px] flex items-center gap-1 text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer transition-colors"
                                    title="Edit Scene"
                                  >
                                    <VscEdit /> Edit
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSceneToDelete(idx); }}
                                    className="text-[10px] flex items-center justify-center text-stone-500 hover:text-red-400 p-1.5 rounded border border-transparent hover:border-red-900/50 hover:bg-red-950/30 cursor-pointer transition-colors"
                                    title="Delete Scene"
                                  >
                                    <VscTrash />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {isEditing ? (
                              <motion.div
                                key={`edit-scene-${idx}`}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomInput
                                  label="Chapter Name"
                                  type="text"
                                  value={scene.title || ''}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    if (copy.scenes && copy.scenes[idx]) copy.scenes[idx].title = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <CustomTextarea
                                  rows={3}
                                  value={scene.narration}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    if (copy.scenes && copy.scenes[idx]) copy.scenes[idx].narration = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scene?.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; if (copy.scenes && copy.scenes[idx]) copy.scenes[idx].sub_visuals = newSubs; setScriptData(copy); }} timings={timings} activeIdx={activeSubIdxForScene} onSeek={handleSeek} />

                                {/* AI Rewrite controls */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g. rewrite this describing the ships blockading the port..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('scenes', idx)}
                                      disabled={rewritingType === 'scenes' && rewritingIdx === idx}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'scenes' && rewritingIdx === idx ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key={`view-scene-${idx}`}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scene.narration}</p>
                                <SubVisualsView subVisuals={scene.sub_visuals || []} timings={timings} activeIdx={activeSubIdxForScene} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}

                    {/* Conclusion Card */}
                    {(() => {
                      const concSceneIdx = (scriptData.introduction ? 1 : 0) + (scriptData.scenes?.length || 0);
                      const concTimings = sceneTimings[concSceneIdx]?.subs;
                      const isConcActive = activeSceneIdx === concSceneIdx;
                      const concActiveSubIdx = isConcActive ? activeSubIdx : -1;
                      return (
                        <motion.div
                          layout
                          className={`p-5 rounded-xl border transition-all ${editingCard === 'conclusion' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isConcActive ? 'bg-black/20 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.03)]' : 'bg-black/10 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${editingCard !== 'conclusion' ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (editingCard !== 'conclusion' && sceneTimings[concSceneIdx]) handleSeek(sceneTimings[concSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">Final Conclusion</span>
                              {isConcActive && !editingCard && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {editingCard === 'conclusion' ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard('conclusion')}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === 'conclusion' ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit('conclusion')}
                                  className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {editingCard === 'conclusion' ? (
                              <motion.div
                                key="edit-conclusion"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomTextarea
                                  label="Summary Text"
                                  rows={2}
                                  value={scriptData.conclusion?.summary || ''}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.conclusion = copy.conclusion || {};
                                    copy.conclusion.summary = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <CustomTextarea
                                  label="Call To Action (CTA)"
                                  rows={2}
                                  value={scriptData.conclusion?.cta || ''}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.conclusion = copy.conclusion || {};
                                    copy.conclusion.cta = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scriptData.conclusion?.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; copy.conclusion = copy.conclusion || {}; copy.conclusion.sub_visuals = newSubs; setScriptData(copy); }} timings={concTimings} activeIdx={concActiveSubIdx} onSeek={handleSeek} />

                                {/* AI Rewrite controls */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g. make the ending call to subscribe more witty..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('conclusion', 0)}
                                      disabled={rewritingType === 'conclusion'}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'conclusion' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="view-conclusion"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.conclusion?.summary || ''}</p>
                                <p className="text-xs text-amber-500 font-bold leading-relaxed font-sans">{scriptData.conclusion?.cta || ''}</p>
                                <SubVisualsView subVisuals={scriptData.conclusion?.sub_visuals || []} timings={concTimings} activeIdx={concActiveSubIdx} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })()}

                  </div>
                )}
              </>
            )}

            {activeTab === 'subtitles' && (
              <div className="flex-1 flex flex-col gap-6 h-full min-h-[500px]">
                <ProjectSettingsEditor
                  settings={localProjectSettings}
                  onUpdate={handleSettingsUpdate}
                />
                <div className="flex-1 min-h-[400px]">
                  <SubtitleEditor
                    transcription={transcriptionData}
                    onChange={(newTrans) => setTranscriptionData(newTrans)}
                    onPlaySegment={(frame) => handleSeek(frame)}
                    onSave={handleSaveTranscription}
                    isSaving={isSavingSubtitles}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {sceneToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-600/80"></div>
            <div className="flex items-start gap-4">
              <div className="bg-red-500/10 text-red-500 p-3 rounded-full shrink-0">
                <VscTrash className="text-xl" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-200 font-sans tracking-tight mb-2">Delete Scene?</h3>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Are you sure you want to permanently delete this scene? This will also remove any associated visual assets. This action cannot be undone.
                </p>
                <div className="flex items-center gap-3 mt-6">
                  <button
                    onClick={() => setSceneToDelete(null)}
                    className="flex-1 px-4 py-2 text-xs font-bold text-stone-300 hover:text-white bg-stone-800 hover:bg-stone-700 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteScene}
                    className="flex-1 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded shadow-sm shadow-red-900/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default ProjectEditor;
