import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { callEel, waitForEelConnection } from '../utils/eel-bridge';

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
  video_format?: string;
  script_path?: string;
  audio_path?: string;
  transcription_path?: string;
  assets_manifest_path?: string;
  video_path?: string;
  tts_engine?: string;
  tts_voice?: string;
  bg_music_path?: string;
  bg_music_volume?: number;
  project_settings?: string;
  export_folder: string;
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

export interface QueueState {
  active: string | null;
  queued: string[];
}

interface ProjectStore {
  projects: Project[];
  selectedProject: Project | null;
  tasks: Record<string, Task>;
  queue: QueueState;
  activeTask: Task | null;

  setProjects: (projects: Project[]) => void;
  setSelectedProject: (project: Project | null) => void;
  setTasks: (tasks: Record<string, Task>) => void;
  fetchProjects: () => Promise<void>;
  fetchProjectDetail: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (projectId: string, updates: Partial<Project>) => Promise<boolean>;
  startPipeline: (projectId: string, steps: string[]) => Promise<{ success: boolean; error?: string }>;
  resumePipeline: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  cancelPipeline: (projectId: string) => Promise<void>;
  downloadFont: (fontFamily: string) => Promise<{ success: boolean; css_path?: string }>;
}

/**
 * Safely call an eel function, waiting for connection if needed.
 * Returns null if eel is not available or connection fails.
 */
async function safeEelCall<T>(fnName: string, ...args: any[]): Promise<T | null> {
  return callEel<T>(fnName, ...args);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: {},
  queue: {
    active: null,
    queued: []
  },
  activeTask: null,

  setProjects: (projects) => set({ projects }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  setTasks: (tasks) => set({ tasks }),

  fetchProjects: async () => {
    const result = await safeEelCall<any[]>('db_get_projects');
    if (result) {
      set({ projects: result || [] });
    }
  },

  fetchProjectDetail: async (projectId) => {
    const project = await safeEelCall<any>('db_get_project', projectId);
    if (!project) return;

    const tasksList = await safeEelCall<any[]>('db_get_project_tasks', projectId);

    const tasksMap: Record<string, Task> = {};
    if (tasksList) {
      tasksList.forEach(t => {
        tasksMap[t.step] = t;
      });
    }

    set({ selectedProject: project, tasks: tasksMap });
  },

  deleteProject: async (projectId) => {
    const result = await safeEelCall<boolean>('db_delete_project', projectId);
    if (result !== null) {
      get().fetchProjects();
      if (get().selectedProject?.id === projectId) {
        set({ selectedProject: null, tasks: {} });
      }
      useUIStore.getState().addToast("Project deleted successfully.", "success");
    } else {
      useUIStore.getState().addToast("Failed to delete project: Backend not connected", "error");
    }
  },

  updateProject: async (projectId, updates) => {
    const res = await safeEelCall<{ success: boolean; error?: string }>('db_update_project', projectId, updates);
    if (res?.success) {
      get().fetchProjectDetail(projectId);
      return true;
    } else if (res?.error) {
      useUIStore.getState().addToast(`Failed to update project: ${res.error}`, "error");
      return false;
    }
    useUIStore.getState().addToast("Failed to update project: Backend not connected", "error");
    return false;
  },

  startPipeline: async (projectId, steps) => {
    // Wait for eel connection before starting pipeline
    const connected = await waitForEelConnection(10000);
    if (!connected) {
      return { success: false, error: "Backend not connected. Please wait a moment and try again." };
    }

    const res = await safeEelCall<{ success: boolean; error?: string }>('start_processing_pipeline', projectId, steps);
    if (res) {
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Failed to start pipeline: Backend not responding" };
  },

  resumePipeline: async (projectId) => {
    const res = await safeEelCall<{ success: boolean; error?: string }>('resume_processing_pipeline', projectId);
    if (res) {
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Failed to resume pipeline: Backend not responding" };
  },

  cancelPipeline: async (projectId) => {
    await safeEelCall('cancel_processing_pipeline', projectId);
    get().fetchProjectDetail(projectId);
  },

  downloadFont: async (fontFamily: string) => {
    const result = await safeEelCall<{ success: boolean; css_path?: string }>('download_google_font', fontFamily);
    return result || { success: false, error: "Backend not connected" };
  }
}));