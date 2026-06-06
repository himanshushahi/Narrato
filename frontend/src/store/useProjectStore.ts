import { create } from 'zustand';
import { useUIStore } from './useUIStore';

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
  bg_music_path?: string;
  bg_music_volume?: number;
  subtitle_settings?: string;
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

  deleteProject: async (projectId) => {
    if (window.eel) {
      await window.eel.db_delete_project(projectId)();
      get().fetchProjects();
      if (get().selectedProject?.id === projectId) {
        set({ selectedProject: null, tasks: {} });
      }
      useUIStore.getState().addToast("Project deleted successfully.", "success");
    }
  },

  updateProject: async (projectId, updates) => {
    if (window.eel) {
      const res = await window.eel.db_update_project(projectId, updates)();
      if (res.success) {
        get().fetchProjectDetail(projectId);
        return true;
      } else {
        useUIStore.getState().addToast(`Failed to update project: ${res.error}`, "error");
        return false;
      }
    }
    return false;
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

  downloadFont: async (fontFamily: string) => {
    if (window.eel) {
      return await window.eel.download_google_font(fontFamily)();
    }
    return { success: false, error: "Eel connection missing" };
  }
}));
