import { useProjectStore, Task } from './useProjectStore';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';

export const initializePywebviewListeners = async () => {
  if (!window.pywebview || typeof window.pywebview?.api?.db_get_projects !== 'function') {
    window.addEventListener('pywebviewready', () => {
      initializePywebviewListeners();
    }, { once: true });
    return;
  }

  window.onAgentActivity = (entry: any) => {
    useUIStore.getState().addAgentActivity(entry);
  };

  window.onLogStream = (msg: string) => {
    useUIStore.getState().addLog(msg);
  };

  window.onShowToast = (message: string, type: string) => {
    useUIStore.getState().addToast(message, type as 'success' | 'error' | 'info' | 'warning');
  };

  window.onProgressUpdate = (data: any) => {
    const projectStore = useProjectStore.getState();

    if (data.type === "queue_update") {
      useProjectStore.setState({ queue: data.status });
      if (!data.status.active) {
        useProjectStore.setState({ activeTask: null });
      }
      // Fix 13: throttle detail refetch — previously every queue event did
      // full db_get_project + task map, thrashing selectedProject ref and
      // cascading to TopBar/ExportTab/useScriptEditing. Only refetch on
      // active-task transitions (start/finish), at most once per 2s.
      const now = Date.now();
      const last = (window as any).__lastQueueDetailFetch || 0;
      const activeChanged =
        (data.status.active && !projectStore.queue.active) ||
        (!data.status.active && projectStore.queue.active);
      if (projectStore.selectedProject?.id && (activeChanged || now - last > 2000)) {
        (window as any).__lastQueueDetailFetch = now;
        projectStore.fetchProjectDetail(projectStore.selectedProject.id);
      }
      projectStore.fetchProjects();
      return;
    }

    const { project_id, step, progress, message, status, error_message } = data;

    if (projectStore.queue.active === project_id) {
      useProjectStore.setState({
        activeTask: {
          id: `${project_id}_${step}`,
          project_id,
          step,
          progress,
          message,
          status,
          updated_at: new Date().toISOString()
        } as Task
      });
    }

    if (projectStore.selectedProject?.id === project_id) {
      useProjectStore.setState((state) => {
        const updatedTasks = { ...state.tasks };
        updatedTasks[step] = {
          ...updatedTasks[step],
          step,
          progress,
          message,
          status,
          error_message
        } as Task;

        if (status === "completed") {
          setTimeout(() => projectStore.fetchProjectDetail(project_id), 100);
        }

        return { tasks: updatedTasks };
      });
    }
  };

  // Live agent updates: the MCP server thread and the in-app chat agent
  // both mutate projects through backend/mcp/server.py, which pushes one
  // of these per successful mutation (save_*, create/delete, stage
  // start/progress/completion). UI-initiated actions already refetch
  // explicitly, so this handler only needs the agent-driven side.
  //
  // Store refetches are coalesced: a burst of agent saves (script + design
  // + visuals batch) settles into one list + one detail pull per 500ms
  // quiet window instead of a fetch storm.
  let projectEventTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingListFetch = false;
  const pendingDetailIds = new Set<string>();
  const pendingTickIds = new Set<string>();
  let lastDetailFetchAt = 0;
  const pendingDeletedIds = new Set<string>();
  const flushProjectEvents = () => {
    projectEventTimer = null;
    const projectStore = useProjectStore.getState();
    if (pendingListFetch) {
      pendingListFetch = false;
      projectStore.fetchProjects();
    }
    const hashMatch = window.location.hash.match(/#\/editor\/([^/?#]+)/);
    const routeProjectId = hashMatch ? decodeURIComponent(hashMatch[1]) : null;
    const currentOpenId = projectStore.selectedProject?.id || routeProjectId;
    if (currentOpenId && pendingDeletedIds.has(currentOpenId)) {
      // The open project is gone — leave /editor/:id (a HashRouter route)
      // for the dashboard instead of showing a ghost editor.
      useProjectStore.setState({ selectedProject: null, tasks: {} });
      useUIStore.getState().addToast('This project was deleted.', 'warning');
      window.location.hash = '#/';
    }
    pendingDeletedIds.clear();
    const openId = projectStore.selectedProject?.id || routeProjectId;
    if (openId) {
      if (pendingDetailIds.has(openId)) {
        lastDetailFetchAt = Date.now();
        projectStore.fetchProjectDetail(openId);
      } else if (pendingTickIds.has(openId) && Date.now() - lastDetailFetchAt > 10000) {
        // Mid-stage progress tick: no status transition, no file change —
        // a 10s-throttled detail pull keeps bars moving without churning
        // the store on every tick.
        lastDetailFetchAt = Date.now();
        projectStore.fetchProjectDetail(openId);
      }
    }
    pendingDetailIds.clear();
    pendingTickIds.clear();
  };
  const scheduleProjectFlush = () => {
    if (projectEventTimer) clearTimeout(projectEventTimer);
    projectEventTimer = setTimeout(flushProjectEvents, 500);
  };

  window.onProjectEvent = (evt: any) => {
    if (!evt || typeof evt !== 'object') return;

    if (evt.type === 'projects_changed') {
      // Create or delete: the dashboard list is stale.
      pendingListFetch = true;
      if (evt.action === 'deleted' && evt.project_id) {
        pendingDeletedIds.add(evt.project_id);
      }
      scheduleProjectFlush();
      return;
    }

    if (evt.type === 'project_updated' && evt.project_id) {
      if (evt.progress_tick) {
        // Throttled mid-stage tick: no list refetch, no file reload —
        // the flush downgrades it to a 10s-throttled detail pull.
        pendingTickIds.add(evt.project_id);
        scheduleProjectFlush();
        return;
      }
      // Row + detail/tasks refresh (status chips, ExportTab task list).
      pendingListFetch = true;
      pendingDetailIds.add(evt.project_id);
      scheduleProjectFlush();
      // Status-only ticks (stage start/progress) carry no file changes —
      // skip the file reload; only real content mutations re-read files.
      if (evt.files_changed === false) return;
      // File contents (script/design/manifest/transcript) live in
      // useEditorData, not the store — the open editor reloads them
      // (dirty-guarded + debounced there).
      window.dispatchEvent(new CustomEvent('narrato:project-files-changed', {
        detail: { project_id: evt.project_id },
      }));
    }
  };

  const handleDownloadProgress = (data: any, stateKey: 'xttsDownload' | 'whisperDownload' | 'gpuDownload', onComplete?: () => void) => {
    useSettingsStore.setState((state) => {
      const update = { ...(state as any)[stateKey] };
      if (data.status === "completed") {
        update.active = false;
        update.status = "completed";
        update.progress = 100;
        if (onComplete) onComplete();
      } else if (data.status === "failed") {
        update.active = false;
        update.status = "failed";
        update.error = data.error || "Download failed";
      } else {
        if (data.file) update.file = data.file;
        update.progress = Math.round(data.progress || 0);
        update.status = "downloading";
      }
      return { [stateKey]: update } as any;
    });
  };

  window.onOmniVoiceDownloadProgress = (data: any) => {
    handleDownloadProgress(data, 'xttsDownload');
  };

  window.onWhisperDownloadProgress = (data: any) => {
    handleDownloadProgress(data, 'whisperDownload', () => {
      useSettingsStore.getState().fetchDownloadedWhisperModels();
    });
  };

  window.onGpuDownloadProgress = (data: any) => {
    handleDownloadProgress(data, 'gpuDownload', () => {
      useSettingsStore.getState().fetchGpuStatus();
    });
    if (data.status === 'failed') {
      useSettingsStore.getState().fetchGpuStatus();
    }
  };

  window.gpu_disabled = (message: string) => {
    useUIStore.getState().addToast(message, 'warning');
  };

  window.onYtdlpUpdateProgress = (data: any) => {
    useSettingsStore.setState((state) => {
      const update = { ...state.ytdlpUpdate };
      if (data.status === "completed") {
        update.active = false;
        update.status = "completed";
        update.progress = 100;
      } else if (data.status === "failed") {
        update.active = false;
        update.status = "failed";
        update.error = data.error || "Update failed";
      } else if (data.status === "checking") {
        update.active = true;
        update.status = "checking";
        update.progress = 0;
      } else if (data.status === "up_to_date") {
        update.active = false;
        update.status = "up_to_date";
        update.progress = 100;
      } else {
        update.active = true;
        update.progress = Math.round(data.progress || 0);
        update.status = "downloading";
      }
      return { ytdlpUpdate: update };
    });
  };

  console.log("Pywebview Zustand bridge listeners registered.");

  // Initialize data now that pywebview is ready
  useProjectStore.getState().fetchProjects();
  useSettingsStore.getState().fetchSettings();
  useSettingsStore.getState().checkGpuAvailability();
  
  if (typeof window.pywebview?.api?.get_file_server_port === 'function') {
    try {
      const port = await window.pywebview.api.get_file_server_port();
      (window as any).__file_server_port__ = port;
    } catch (error) {
      console.error(error);
    }
  }

  if (typeof window.pywebview?.api?.get_agent_activity === 'function') {
    window.pywebview.api.get_agent_activity().then((activity: any[]) => {
      // History is newest-first; append oldest -> newest so the feed renders
      // in the same order as live events (newest at the top).
      activity.slice().reverse().forEach((entry) => useUIStore.getState().addAgentActivity(entry));
    }).catch(console.error);
  }
};
