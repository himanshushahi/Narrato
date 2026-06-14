import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useProjectStore, Task } from '../../../store/useProjectStore';
import { useUIStore } from '../../../store/useUIStore';
import { PIPELINE_STAGES } from '../../ProjectEditor/constants';

/** Compute SHA-256 hash of script narration for change detection */
const computeScriptContentHash = async (scriptData: any): Promise<string> => {
  if (!scriptData) return '';

  const parts: string[] = [];
  const intro = scriptData.introduction || {};
  parts.push(`intro:${intro.hook || ''}`);

  const scenes = scriptData.scenes || [];
  for (let i = 0; i < scenes.length; i++) {
    parts.push(`scene_${i}:${scenes[i].narration || ''}`);
  }

  const conclusion = scriptData.conclusion || {};
  parts.push(`conclusion:${(conclusion.summary || '') + (conclusion.cta || '')}`);

  const contentStr = parts.join('\n');
  const encoder = new TextEncoder();
  const data = encoder.encode(contentStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export interface UsePipelineReturn {
  tasks: Record<string, Task>;
  queue: { active: string | null; queued: string[] };
  isRunning: boolean;
  targetStage: string;
  activeTaskStep: Task | null;
  scriptChangedAlert: boolean;
  setTargetStage: (stage: string) => void;
  triggerFullPipeline: () => Promise<void>;
  handleResumeFromStage: (stageId: string) => Promise<void>;
  handleResumePipeline: () => Promise<void>;
  cancelPipeline: () => void;
  setScriptChangedAlert: (alert: boolean) => void;
}

export function usePipeline(
  projectId: string | undefined,
  scriptData: any,
  manifestData: any[],
  loadFiles: (projId: string) => Promise<void>
): UsePipelineReturn {
  const { tasks, queue, startPipeline, cancelPipeline } = useProjectStore();
  const { addToast } = useUIStore();

  const [targetStage, setTargetStage] = useState('render');
  const [wasActive, setWasActive] = useState(false);
  const [scriptChangedAlert, setScriptChangedAlert] = useState(false);
  const storedContentHashRef = useRef<string>('');
  const storedVoiceoverEngineRef = useRef<string>('');
  const storedVoiceoverVoiceRef = useRef<string>('');
  const storedVoiceoverSpeedRef = useRef<string>('');
  const storedVoiceoverPitchRef = useRef<string>('');
  const previousTasksRef = useRef(tasks);
  const hasMountedRef = useRef(false);

  const isRunning = queue.active === projectId;

  const activeTaskStep = useMemo(() => {
    if (!isRunning) return null;
    return Object.values(tasks).find(t => t.status === 'running') || null;
  }, [isRunning, tasks]);

  // Monitor pipeline completion
  useEffect(() => {
    if (queue.active === projectId) {
      setWasActive(true);
    } else if (wasActive && queue.active !== projectId) {
      setWasActive(false);
      if (projectId) loadFiles(projectId);
    }
  }, [queue.active, projectId, wasActive, loadFiles]);

  // Extract stored content hash from manifest
  useEffect(() => {
    if (manifestData?.[0]?._content_hash) {
      storedContentHashRef.current = manifestData[0]._content_hash;
    }
  }, [manifestData]);

  // Extract stored voiceover settings from manifest
  useEffect(() => {
    if (manifestData?.[0]?._voiceover_engine !== undefined) {
      storedVoiceoverEngineRef.current = manifestData[0]._voiceover_engine;
      storedVoiceoverVoiceRef.current = manifestData[0]._voiceover_voice ?? '';
      storedVoiceoverSpeedRef.current = String(manifestData[0]._voiceover_speed ?? '');
      storedVoiceoverPitchRef.current = String(manifestData[0]._voiceover_pitch ?? '');
    }
  }, [manifestData]);

  // Reload on critical task completion (skip initial mount to avoid redundant loadFiles)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousTasksRef.current = tasks;
      return;
    }

    const criticalSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets'];
    let shouldReload = false;
    for (const step of criticalSteps) {
      const prevStatus = previousTasksRef.current[step]?.status;
      const currStatus = tasks[step]?.status;
      if (prevStatus !== 'completed' && currStatus === 'completed') {
        shouldReload = true;
        break;
      }
    }
    if (shouldReload && projectId) {
      loadFiles(projectId);
    }
    previousTasksRef.current = tasks;
  }, [tasks, projectId, loadFiles]);

  const triggerFullPipeline = useCallback(async () => {
    if (!projectId) return;
    setScriptChangedAlert(false);
    const allSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render'];
    const targetIdx = allSteps.indexOf(targetStage);
    const steps = allSteps.slice(0, targetIdx + 1);
    const res = await startPipeline(projectId, steps);
    if (res?.success) {
      loadFiles(projectId);
    }
  }, [projectId, targetStage, startPipeline, loadFiles]);

  const hasVisualEdits = useCallback(() => {
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
        if (scriptScene) liveSubVisuals = scriptScene?.sub_visuals || [];
      }
      const origSubVisuals = manifestScene.sub_visuals || [];
      const relevantLive = liveSubVisuals.map((lsv: any) => ({ visual_type: lsv.visual_type, visual_cue: lsv.visual_cue }));
      const relevantOrig = origSubVisuals.map((osv: any) => ({ visual_type: osv.visual_type, visual_cue: osv.visual_cue }));
      if (JSON.stringify(relevantLive) !== JSON.stringify(relevantOrig)) changed = true;
    });
    return changed;
  }, [manifestData, scriptData]);

  /** Detect changes to voiceover settings (tts_engine, tts_voice, etc.) that aren't
   * captured by the narration text hash. Only fires when the manifest has stored
   * settings to compare against (otherwise it's a pre-existing voiceover).
   *
   * IMPORTANT: voice resolution must match the backend's chain:
   *   project_settings.tts_voice → selectedProject.tts_voice → language default
   * The DB column (selectedProject.tts_voice) may have a hardcoded default like
   * 'hi-IN-SwaraNeural' that doesn't match what the backend resolved. To prevent
   * false positives, we check project_settings FIRST (user-explicit choice), then
   * the DB column, then fall back to '' (language defaults cannot be matched by
   * the frontend alone — the backend writes the resolved voice back to the column
   * during generate_voiceover so subsequent comparisons are accurate). */
  const voiceoverSettingsChanged = useCallback(() => {
    const stored = storedVoiceoverEngineRef.current;
    if (!stored || !manifestData?.[0]?._voiceover_engine) return false;

    const selectedProject = useProjectStore.getState().selectedProject;
    if (!selectedProject) return false;

    let projectSettings: Record<string, any> = {};
    try {
      if (selectedProject.project_settings) {
        projectSettings = JSON.parse(selectedProject.project_settings);
      }
    } catch { /* ignore parse errors */ }

    // Resolve engine: project_settings → DB column → default 'edge'
    const currentEngine = projectSettings.tts_engine || selectedProject.tts_engine || 'edge';
    const currentSpeed = String(projectSettings.tts_speed ?? '1.0');
    const currentPitch = String(projectSettings.tts_pitch ?? '0');

    // Resolve voice matching backend chain: project_settings → DB column → ''
    // (language default is handled by the backend writing the resolved voice back)
    let currentVoice = '';
    if (currentEngine === 'kokoro') {
      currentVoice = projectSettings.kokoro_voice || '';
    } else {
      currentVoice = projectSettings.tts_voice || selectedProject.tts_voice || '';
    }

    return (
      currentEngine !== storedVoiceoverEngineRef.current ||
      currentVoice !== storedVoiceoverVoiceRef.current ||
      currentSpeed !== storedVoiceoverSpeedRef.current ||
      currentPitch !== storedVoiceoverPitchRef.current
    );
  }, [manifestData]);

  const canResumeFrom = useCallback((stageId: string) => {
    const stageIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (stageIdx === -1) return false;
    const currentTargetIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    if (currentTargetIdx !== -1 && stageIdx > currentTargetIdx) return false;
    for (let i = 0; i < stageIdx; i++) {
      if (tasks[PIPELINE_STAGES[i].id]?.status !== 'completed') return false;
    }
    return true;
  }, [targetStage, tasks]);

  const handleResumeFromStage = useCallback(async (stageId: string) => {
    if (!projectId || !canResumeFrom(stageId)) return;
    if (isRunning) {
      addToast("Pipeline is already running. Please wait for it to complete before resuming.", 'warning', 4000);
      return;
    }
    const startIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (startIdx === -1) return;

    const allSteps = PIPELINE_STAGES.map(s => s.id);
    const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    const finalEndIdx = endIdx !== -1 && endIdx >= startIdx ? endIdx : PIPELINE_STAGES.length - 1;

    // Apply the same smart detection cascade as handleResumePipeline
    // to determine which stages need re-running. Then merge with the
    // forced start point.
    const limitSteps = (steps: string[]) => {
      if (endIdx === -1) return steps;
      return steps.filter(step => allSteps.indexOf(step) <= endIdx);
    };

    let smartSteps: string[] = [];

    if (scriptChangedAlert) {
      smartSteps = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
    } else {
      const manifestSceneCount = manifestData?.filter((m: any) => m.section_type === 'scene').length || 0;
      const scriptSceneCount = scriptData?.scenes?.length || 0;
      const sceneCountChanged = manifestSceneCount !== scriptSceneCount;
      const currentHash = await computeScriptContentHash(scriptData);
      const hashChanged = !!storedContentHashRef.current && storedContentHashRef.current !== currentHash;

      if (sceneCountChanged || hashChanged) {
        smartSteps = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
      } else if (voiceoverSettingsChanged()) {
        smartSteps = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
      } else if (hasVisualEdits()) {
        smartSteps = limitSteps(['fetch_assets', 'render']);
      } else {
        const completedSteps = new Set(Object.values(tasks).filter(t => t.status === 'completed').map(t => t.step));
        let remainingSteps = allSteps.filter(s => !completedSteps.has(s));
        if (remainingSteps.length === 0) remainingSteps = ['render'];
        smartSteps = limitSteps(remainingSteps);
      }
    }

    // Step 1: Force-include the selected stage + all downstream (dependent) stages.
    // In a linear pipeline, forcing a stage invalidates everything that consumes
    // its output, so all downstream stages must re-run.
    // Step 2: Merge with smart detection results that are at/after the selected stage.
    const forcedRange = allSteps.slice(startIdx, finalEndIdx + 1);
    const filteredSmart = smartSteps.filter(s => allSteps.indexOf(s) >= startIdx);
    const stepsToRun = Array.from(new Set([...forcedRange, ...filteredSmart]))
      .sort((a, b) => allSteps.indexOf(a) - allSteps.indexOf(b));

    if (stepsToRun.length === 0) {
      addToast("All selected stages are already completed.", 'warning', 5000);
      return;
    }

    setScriptChangedAlert(false);
    const res = await startPipeline(projectId, stepsToRun);
    if (res?.success) {
      addToast(`Resumed pipeline from: ${PIPELINE_STAGES[startIdx].title}`, 'success');
    } else {
      addToast(res?.error || "Failed to start pipeline", 'error');
    }
    loadFiles(projectId);
  }, [projectId, targetStage, scriptChangedAlert, manifestData, scriptData, tasks, hasVisualEdits, voiceoverSettingsChanged, startPipeline, addToast, loadFiles, isRunning, canResumeFrom]);

  const handleResumePipeline = useCallback(async () => {
    if (!projectId) return;
    if (isRunning) {
      addToast("Pipeline is already running. Please wait for it to complete before resuming.", 'warning', 4000);
      return;
    }
    try {
      const allSteps = PIPELINE_STAGES.map(s => s.id);
      const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
      const limitSteps = (steps: string[]) => {
        if (endIdx === -1) return steps;
        return steps.filter(step => allSteps.indexOf(step) <= endIdx);
      };

      let stepsToRun: string[] = [];

      if (scriptChangedAlert) {
        stepsToRun = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
      } else {
        const manifestSceneCount = manifestData?.filter((m: any) => m.section_type === 'scene').length || 0;
        const scriptSceneCount = scriptData?.scenes?.length || 0;
        const sceneCountChanged = manifestSceneCount !== scriptSceneCount;

        const currentHash = await computeScriptContentHash(scriptData);
        const hashChanged = !!storedContentHashRef.current && storedContentHashRef.current !== currentHash;

        if (sceneCountChanged || hashChanged) {
          stepsToRun = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
        } else if (voiceoverSettingsChanged()) {
          stepsToRun = limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']);
        } else if (hasVisualEdits()) {
          stepsToRun = limitSteps(['fetch_assets', 'render']);
        } else {
          const completedSteps = new Set(Object.values(tasks).filter(t => t.status === 'completed').map(t => t.step));
          let remainingSteps = allSteps.filter(s => !completedSteps.has(s));
          if (remainingSteps.length === 0) remainingSteps = ['render'];
          stepsToRun = limitSteps(remainingSteps);
        }
      }

      if (stepsToRun.length === 0) {
        addToast("All selected stages are already completed. Select a later target stage or use the Re-run buttons.", 'warning', 5000);
        return;
      }

      const res = await startPipeline(projectId, stepsToRun);
      setScriptChangedAlert(false);
      if (res?.success) {
        addToast("Pipeline started successfully", 'success');
      } else {
        addToast(res?.error || "Failed to start pipeline", 'error');
      }
      loadFiles(projectId);
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  }, [projectId, targetStage, scriptChangedAlert, manifestData, scriptData, tasks, hasVisualEdits, voiceoverSettingsChanged, startPipeline, addToast, loadFiles, isRunning]);

  const cancelPipelineAction = useCallback(() => {
    if (projectId) cancelPipeline(projectId);
  }, [projectId, cancelPipeline]);

  return {
    tasks, queue, isRunning, targetStage, activeTaskStep, scriptChangedAlert,
    setTargetStage, setScriptChangedAlert,
    triggerFullPipeline, handleResumeFromStage, handleResumePipeline,
    cancelPipeline: cancelPipelineAction,
  };
}
