import { useProjectStore } from './useProjectStore';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';
import { eelConnection, waitForEelConnection } from '../utils/eel-bridge';

/**
 * Initialize Eel listeners and start connection monitoring.
 *
 * This function:
 * 1. Registers JS callbacks that Python can call (on_log_stream, on_progress_update, etc.)
 * 2. Starts automatic reconnection monitoring if the WebSocket isn't ready
 *
 * The connection monitor will retry connecting to the Python backend with
 * exponential backoff if the WebSocket fails to connect on first launch.
 */
export const initializeEelListeners = () => {
  if (!window.eel) {
    console.warn("Eel: window.eel is not loaded. Backend may not be running.");
    return;
  }

  // Register callback: on_log_stream - receives log messages from Python
  window.eel.expose((msg: string) => {
    useUIStore.getState().addLog(msg);
  }, "on_log_stream");

  // Register callback: on_progress_update - receives pipeline progress updates
  window.eel.expose((data: any) => {
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

    const { project_id, step, progress, message, status } = data;

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
          status
        } as any;

        if (step === "render" && status === "completed") {
          setTimeout(() => projectStore.fetchProjectDetail(project_id), 100);
        }

        return { tasks: updatedTasks };
      });
    }
  }, "on_progress_update");

  // Register callback: on_kokoro_download_progress - TTS model download
  window.eel.expose((data: any) => {
    useSettingsStore.setState((state) => {
      const update = { ...state.kokoroDownload };
      if (data.status === "completed") {
        update.active = false;
        update.status = "completed";
        update.progress = 100;
      } else if (data.status === "failed") {
        update.active = false;
        update.status = "failed";
        update.error = data.error || "Download failed";
      } else {
        update.file = data.file;
        update.progress = Math.round(data.progress || 0);
        update.status = "downloading";
      }
      return { kokoroDownload: update };
    });
  }, "on_kokoro_download_progress");

  // Register callback: on_whisper_download_progress - Whisper model download
  window.eel.expose((data: any) => {
    useSettingsStore.setState((state) => {
      const update = { ...state.whisperDownload };
      if (data.status === "completed") {
        update.active = false;
        update.status = "completed";
        update.progress = 100;
        useSettingsStore.getState().fetchDownloadedWhisperModels();
      } else if (data.status === "failed") {
        update.active = false;
        update.status = "failed";
        update.error = data.error || "Download failed";
      } else {
        update.progress = Math.round(data.progress || 0);
        update.status = "downloading";
      }
      return { whisperDownload: update };
    });
  }, "on_whisper_download_progress");

  // Register callback: on_ytdlp_update_progress - yt-dlp updater
  window.eel.expose((data: any) => {
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
  }, "on_ytdlp_update_progress");

  console.log("Eel Zustand bridge listeners registered.");

  // Start connection monitoring for automatic reconnection
  // This ensures that if the WebSocket failed to connect on first launch,
  // it will automatically retry until the Python backend is ready
  eelConnection.subscribe((state) => {
    if (state.isConnected) {
      console.log("[EelListeners] Backend connection confirmed");
    } else if (state.error) {
      console.warn("[EelListeners] Connection issue:", state.error);
    }
  });
};