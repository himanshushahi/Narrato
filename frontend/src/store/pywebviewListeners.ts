import { useProjectStore } from './useProjectStore';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';

export const initializePywebviewListeners = () => {
  if (!window.pywebview || typeof window.pywebview?.api?.db_get_projects !== 'function') {
    window.addEventListener('pywebviewready', () => {
      initializePywebviewListeners();
    }, { once: true });
    return;
  }

  window.onLogStream = (msg: string) => {
    useUIStore.getState().addLog(msg);
  };

  window.onProgressUpdate = (data: any) => {
    const projectStore = useProjectStore.getState();

    if (data.type === "queue_update") {
      useProjectStore.setState({ queue: data.status });
      if (!data.status.active) {
        useProjectStore.setState({ activeTask: null });
      }
      if (projectStore.selectedProject?.id) {
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
        } as any
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
        } as any;

        if (step === "render" && status === "completed") {
          setTimeout(() => projectStore.fetchProjectDetail(project_id), 100);
        }

        return { tasks: updatedTasks };
      });
    }
  };

  const handleDownloadProgress = (data: any, stateKey: 'kokoroDownload' | 'whisperDownload', onComplete?: () => void) => {
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

  window.onKokoroDownloadProgress = (data: any) => {
    handleDownloadProgress(data, 'kokoroDownload');
  };

  window.onWhisperDownloadProgress = (data: any) => {
    handleDownloadProgress(data, 'whisperDownload', () => {
      useSettingsStore.getState().fetchDownloadedWhisperModels();
    });
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
    window.pywebview.api.get_file_server_port().then((port: number) => {
      (window as any).__file_server_port__ = port;
    }).catch(console.error);
  }
};
