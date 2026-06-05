import { create } from 'zustand'

export interface Project {
  id: string;
  name: string;
  prompt: string;
  status: string;
  created_at: string;
  updated_at: string;
  language: string;
  style: string;
  duration_mode: string;
  script_path?: string;
  audio_path?: string;
  transcription_path?: string;
  assets_manifest_path?: string;
  video_path?: string;
  tts_engine?: string;
  tts_voice?: string;
  tts_speed?: number;
  bg_music_path?: string;
  bg_music_volume?: number;
}

export interface Task {
  id: string;
  project_id: string;
  step: string;
  status: string;
  progress: number;
  message?: string;
  error_message?: string;
  updated_at: string;
}

export interface Settings {
  llm_provider: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  whisper_model: string;
  whisper_device: string;
  tts_engine: string;
  tts_voice: string;
  tts_speed: string;
  tts_pitch: string;
  kokoro_voice: string;
  workspace_directory: string;
  bg_music_path: string;
  bg_music_volume: string;
  pexels_api_key: string;
  use_pexels: boolean;
  use_youtube: boolean;
  youtube_download_duration: string;
  sfx_volume: string;
  render_resolution: string;
  render_concurrency: string;
  render_fps: string;
  render_crf: string;
  render_codec: string;
  render_hardware: string;
}

export interface QueueState {
  active: string | null;
  queued: string[];
}

export interface KokoroDownload {
  active: boolean;
  file: string;
  progress: number;
  status: string;
  error: string;
}

export interface WhisperDownload {
  active: boolean;
  progress: number;
  status: string;
  error: string;
}

export interface DownloadedWhisperModel {
  id: string;
  size_mb: number;
}

export interface YtdlpUpdate {
  active: boolean;
  progress: number;
  status: string; // '', 'downloading', 'completed', 'failed'
  error: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

export interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface AppStore {
  projects: Project[];
  selectedProject: Project | null;
  tasks: Record<string, Task>;
  logs: string[];
  queue: QueueState;
  activeTask: Task | null;
  settings: Settings;
  kokoroDownload: KokoroDownload;
  whisperDownload: WhisperDownload;
  downloadedWhisperModels: DownloadedWhisperModel[];
  ytdlpUpdate: YtdlpUpdate;
  toasts: Toast[];
  
  setProjects: (projects: Project[]) => void;
  setSelectedProject: (project: Project | null) => void;
  setTasks: (tasks: Record<string, Task>) => void;
  clearLogs: () => void;
  setSettings: (settings: Settings) => void;
  fetchProjects: () => Promise<void>;
  fetchProjectDetail: (projectId: string) => Promise<void>;
  fetchSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  startPipeline: (projectId: string, steps: string[]) => Promise<{ success: boolean; error?: string }>;
  resumePipeline: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  cancelPipeline: (projectId: string) => Promise<void>;
  downloadKokoro: () => Promise<void>;
  downloadWhisper: (modelSize: string) => Promise<void>;
  fetchDownloadedWhisperModels: () => Promise<void>;
  deleteWhisperModel: (id: string) => Promise<boolean>;
  updateYtdlp: () => Promise<void>;
  addToast: (message: string, type?: Toast['type'], duration?: number) => void;
  removeToast: (id: string) => void;
  confirmState: ConfirmState;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void;
  closeConfirm: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: {},
  logs: [],
  queue: {
    active: null,
    queued: []
  },
  activeTask: null,
  settings: {
    llm_provider: "openai",
    openai_api_key: "",
    openai_base_url: "https://api.openai.com/v1",
    openai_model: "gpt-4o",
    whisper_model: "base",
    whisper_device: "cpu",
    tts_engine: "edge",
    tts_voice: "hi-IN-SwaraNeural",
    tts_speed: "1.0",
    tts_pitch: "0",
    kokoro_voice: "hf_alpha",
    workspace_directory: "",
    bg_music_path: "",
    bg_music_volume: "0.15",
    pexels_api_key: "",
    use_pexels: true,
    use_youtube: true,
    youtube_download_duration: "15",
    sfx_volume: "0.20",
    render_resolution: "1080p",
    render_concurrency: "logical",
    render_fps: "30",
    render_crf: "18",
    render_codec: "h264",
    render_hardware: "cpu"
  },
  kokoroDownload: {
    active: false,
    file: "",
    progress: 0,
    status: "",
    error: ""
  },
  whisperDownload: {
    active: false,
    progress: 0,
    status: "",
    error: ""
  },
  downloadedWhisperModels: [],
  ytdlpUpdate: {
    active: false,
    progress: 0,
    status: "",
    error: ""
  },
  toasts: [],
  confirmState: { isOpen: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} },
  
  showConfirm: (title, message, onConfirm, onCancel = () => {}) => 
    set({ confirmState: { isOpen: true, title, message, onConfirm, onCancel } }),
    
  closeConfirm: () => 
    set(state => ({ confirmState: { ...state.confirmState, isOpen: false } })),

  setProjects: (projects) => set({ projects }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  setTasks: (tasks) => set({ tasks }),
  clearLogs: () => set({ logs: [] }),
  setSettings: (settings) => set({ settings }),
  addToast: (message, type = 'info', duration = 3000) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { id, message, type, duration }] }));
    
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
  
  fetchProjects: async () => {
    if (window.eel) {
      const list = await window.eel.db_get_projects()();
      set({ projects: list || [] });
    }
  },

  fetchProjectDetail: async (projectId) => {
    if (window.eel) {
      const project = await window.eel.db_get_project(projectId)();
      const tasksList = await window.eel.db_get_project_tasks(projectId)();
      
      const tasksMap: Record<string, Task> = {};
      if (tasksList) {
        tasksList.forEach(t => {
          tasksMap[t.step] = t;
        });
      }
      
      set({ selectedProject: project, tasks: tasksMap });
    }
  },

  fetchSettings: async () => {
    if (window.eel) {
      const data = await window.eel.db_get_settings()();
      if (data) set({ settings: data });
    }
  },

  saveSettings: async (newSettings) => {
    if (window.eel) {
      await window.eel.db_update_settings(newSettings)();
      set({ settings: newSettings });
    }
  },

  deleteProject: async (projectId) => {
    if (window.eel) {
      await window.eel.db_delete_project(projectId)();
      get().fetchProjects();
      if (get().selectedProject?.id === projectId) {
        set({ selectedProject: null, tasks: {} });
      }
      get().addToast("Project deleted successfully.", "success");
    }
  },

  startPipeline: async (projectId, steps) => {
    if (window.eel) {
      const res = await window.eel.start_processing_pipeline(projectId, steps)();
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Eel connection missing" };
  },

  resumePipeline: async (projectId) => {
    if (window.eel) {
      const res = await window.eel.resume_processing_pipeline(projectId)();
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Eel connection missing" };
  },

  cancelPipeline: async (projectId) => {
    if (window.eel) {
      await window.eel.cancel_processing_pipeline(projectId)();
      get().fetchProjectDetail(projectId);
    }
  },

  downloadKokoro: async () => {
    if (window.eel) {
      set({ kokoroDownload: { active: true, file: "", progress: 0, status: "started", error: "" } });
      await window.eel.start_kokoro_download()();
    }
  },

  downloadWhisper: async (modelSize) => {
    if (window.eel) {
      set({ whisperDownload: { active: true, progress: 0, status: "started", error: "" } });
      await window.eel.start_whisper_download(modelSize)();
    }
  },

  fetchDownloadedWhisperModels: async () => {
    if (window.eel) {
      const models = await window.eel.get_downloaded_whisper_models()();
      set({ downloadedWhisperModels: models || [] });
    }
  },

  deleteWhisperModel: async (id) => {
    if (window.eel) {
      const res = await window.eel.delete_whisper_model(id)();
      if (res?.success) {
        get().addToast(`Deleted Whisper model: ${id}`, "success");
        get().fetchDownloadedWhisperModels();
        return true;
      } else {
        get().addToast(`Failed to delete Whisper model: ${id}`, "error");
      }
    }
    return false;
  },

  updateYtdlp: async () => {
    if (window.eel) {
      set({ ytdlpUpdate: { active: true, progress: 0, status: "started", error: "" } });
      await window.eel.update_ytdlp()();
    }
  }
}));

export const initializeEelListeners = () => {
  if (!window.eel) {
    console.warn("Eel: window.eel is not loaded.");
    return;
  }

  // 1. Log stream listener
  window.eel.expose((msg: string) => {
    useAppStore.setState((state) => {
      const newLogs = [...state.logs, msg];
      if (newLogs.length > 500) {
        newLogs.shift();
      }
      return { logs: newLogs };
    });
  }, "on_log_stream");

  // 2. Queue and Task updates listener
  window.eel.expose((data: any) => {
    const store = useAppStore.getState();
    
    if (data.type === "queue_update") {
      useAppStore.setState({ queue: data.status });
      if (!data.status.active) {
        useAppStore.setState({ activeTask: null });
      }
      if (store.selectedProject?.id) {
        store.fetchProjectDetail(store.selectedProject.id);
      }
      store.fetchProjects();
      return;
    }

    const { project_id, step, progress, message, status } = data;
    
    if (store.queue.active === project_id) {
      useAppStore.setState({
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
    
    if (store.selectedProject?.id === project_id) {
      useAppStore.setState((state) => {
        const updatedTasks = { ...state.tasks };
        updatedTasks[step] = {
          ...updatedTasks[step],
          step,
          progress,
          message,
          status
        } as Task;
        
        if (step === "render" && status === "completed") {
          setTimeout(() => store.fetchProjectDetail(project_id), 100);
        }
        
        return { tasks: updatedTasks };
      });
    }
  }, "on_progress_update");

  // 3. Kokoro models download progress listener
  window.eel.expose((data: any) => {
    useAppStore.setState((state) => {
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

  // 4. Whisper models download progress listener
  window.eel.expose((data: any) => {
    useAppStore.setState((state) => {
      const update = { ...state.whisperDownload };
      
      if (data.status === "completed") {
        update.active = false;
        update.status = "completed";
        update.progress = 100;
        // Refresh downloaded models when download completes
        useAppStore.getState().fetchDownloadedWhisperModels();
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

  // 5. yt-dlp update progress listener
  window.eel.expose((data: any) => {
    useAppStore.setState((state) => {
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
};
