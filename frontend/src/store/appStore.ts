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
  sfx_volume: string;
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
    sfx_volume: "0.20"
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

  setProjects: (projects) => set({ projects }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  setTasks: (tasks) => set({ tasks }),
  clearLogs: () => set({ logs: [] }),
  setSettings: (settings) => set({ settings }),
  
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

  console.log("Eel Zustand bridge listeners registered.");
};
