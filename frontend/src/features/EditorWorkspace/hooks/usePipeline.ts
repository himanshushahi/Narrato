import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useProjectStore, Task } from '../../../store/useProjectStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorStore } from '../../../store/useEditorStore';
import { PIPELINE_STAGES } from '../../ProjectEditor/constants';



interface UsePipelineReturn {
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
  loadFiles: (projId: string) => Promise<void>
): UsePipelineReturn {
  const { tasks, queue, startPipeline, cancelPipeline, selectedProject, updateProject } = useProjectStore();
  const { addToast } = useUIStore();

  const [targetStage, setTargetStageState] = useState('fetch_assets');

  // Initialize targetStage from project settings
  useEffect(() => {
    if (selectedProject?.project_settings) {
      try {
        const settings = JSON.parse(selectedProject.project_settings);
        if (settings.targetStage) {
          setTargetStageState((prev) => prev !== settings.targetStage ? settings.targetStage : prev);
        }
      } catch (e) {
        // ignore
      }
    }
  }, [selectedProject?.project_settings]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTargetStage = useCallback((stage: string) => {
    setTargetStageState(stage);
    if (selectedProject?.id) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        let settings: any = {};
        try {
          const currentProj = useProjectStore.getState().selectedProject;
          if (currentProj?.project_settings) {
            settings = JSON.parse(currentProj.project_settings);
          }
        } catch (e) {}
        settings.targetStage = stage;
        await updateProject(selectedProject.id, { project_settings: JSON.stringify(settings) });
      }, 500);
    }
  }, [selectedProject?.id, updateProject]);
  const [wasActive, setWasActive] = useState(false);
  const [scriptChangedAlert, setScriptChangedAlert] = useState(false);
  const previousTasksRef = useRef(tasks);
  const hasMountedRef = useRef(false);

  const isRunning = queue.active === projectId || (projectId ? queue.queued.includes(projectId) : false);

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



  // Reload on critical task completion (skip initial mount to avoid redundant loadFiles)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousTasksRef.current = tasks;
      return;
    }

    const criticalSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'generate_visuals', 'fetch_assets'];
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

  // Helper: persist current track visibility overrides into project_settings
  // before starting a pipeline run that includes the 'render' step.
  const syncTrackOverrides = useCallback(async (steps: string[]): Promise<boolean> => {
    if (!projectId || !steps.includes('render')) return true;

    const overrides = useEditorStore.getState().getRenderTrackOverrides();
    const warnings: string[] = [];
    if (overrides.render_mute_voice) warnings.push('Voiceover is muted — exported video will have no narration');
    if (overrides.render_mute_music) warnings.push('Background music is muted — exported video will have no music');
    if (overrides.render_mute_video_audio) warnings.push('Video audio is muted — exported video will not include audio from video clips');
    if (overrides.render_hide_subtitles) warnings.push('Subtitles are hidden — exported video will have no subtitles');

    if (warnings.length > 0) {
      for (const w of warnings) {
        addToast(`⚠️ ${w}`, 'warning', 6000);
      }
    }

    // Merge overrides into project_settings
    let settings: any = {};
    try {
      const currentProj = useProjectStore.getState().selectedProject;
      if (currentProj?.project_settings) {
        settings = JSON.parse(currentProj.project_settings);
      }
    } catch (e) { /* ignore */ }
    settings.render_mute_voice = overrides.render_mute_voice;
    settings.render_mute_music = overrides.render_mute_music;
    settings.render_mute_video_audio = overrides.render_mute_video_audio;
    settings.render_hide_subtitles = overrides.render_hide_subtitles;
    await updateProject(projectId, { project_settings: JSON.stringify(settings) });
    return true;
  }, [projectId, addToast, updateProject]);

  const triggerFullPipeline = useCallback(async () => {
    if (!projectId) return;
    setScriptChangedAlert(false);
    const allSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'generate_visuals', 'fetch_assets', 'render'];
    const targetIdx = allSteps.indexOf(targetStage);
    const steps = allSteps.slice(0, targetIdx + 1);
    await syncTrackOverrides(steps);
    const res = await startPipeline(projectId, steps);
    if (res?.success) {
      useEditorStore.getState().setAudioChangedAlert(false);
      loadFiles(projectId);
    }
  }, [projectId, targetStage, startPipeline, loadFiles, syncTrackOverrides]);



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
    if (!projectId) return;
    if (!canResumeFrom(stageId)) {
      addToast("Cannot start from this stage. Previous stages must be completed first.", 'warning', 4000);
      return;
    }
    if (isRunning) {
      addToast("Pipeline is already running. Please wait for it to complete before resuming.", 'warning', 4000);
      return;
    }
    const startIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (startIdx === -1) return;

    const allSteps = PIPELINE_STAGES.map(s => s.id);
    const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    const finalEndIdx = endIdx !== -1 && endIdx >= startIdx ? endIdx : PIPELINE_STAGES.length - 1;

    const stepsToRun = allSteps.slice(startIdx, finalEndIdx + 1);

    if (stepsToRun.length === 0) {
      addToast("All selected stages are already completed.", 'warning', 5000);
      return;
    }

    setScriptChangedAlert(false);
    await syncTrackOverrides(stepsToRun);
    const res = await startPipeline(projectId, stepsToRun);
    if (res?.success) {
      useEditorStore.getState().setAudioChangedAlert(false);
      addToast(`Resumed pipeline from: ${PIPELINE_STAGES[startIdx].title}`, 'success');
      loadFiles(projectId);
    } else {
      addToast(res?.error || "Failed to start pipeline", 'error');
    }
  }, [projectId, targetStage, startPipeline, addToast, loadFiles, isRunning, canResumeFrom, syncTrackOverrides]);

  const handleResumePipeline = useCallback(async () => {
    if (!projectId) return;
    if (isRunning) {
      addToast("Pipeline is already running. Please wait for it to complete before resuming.", 'warning', 4000);
      return;
    }
    try {
      const allSteps = PIPELINE_STAGES.map(s => s.id);
      const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
      const stepsToRun = endIdx === -1 ? allSteps : allSteps.slice(0, endIdx + 1);

      // Smart Resume: persist track visibility overrides to project settings
      await syncTrackOverrides(stepsToRun);

      // We simply pass the allowed range of steps to the backend. The backend evaluates staleness.
      const res = await useProjectStore.getState().resumePipeline(projectId, stepsToRun);
      setScriptChangedAlert(false);
      if (res?.success) {
        useEditorStore.getState().setAudioChangedAlert(false);
        addToast("Pipeline started successfully", 'success');
        loadFiles(projectId);
      } else {
        addToast(res?.error || "Failed to start pipeline", 'error');
      }
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  }, [projectId, targetStage, addToast, loadFiles, isRunning, syncTrackOverrides]);

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
