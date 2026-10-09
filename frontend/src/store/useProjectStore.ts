import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { callApi } from '../utils/call-api';

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
  music_clips?: string | any[];
  sfx_clips?: string | any[];
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
  error_code?: string;
  updated_at: string;
}

interface QueueState {
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
  // Equality signatures: dedupe consecutive identical pulls so focus
  // refetches and tick-adjacent pulls don't churn identities + re-renders.
  _projectsSig: string;
  _detailSig: string;
  fetchProjects: () => Promise<void>;
  fetchProjectDetail: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (projectId: string, updates: Partial<Project>) => Promise<boolean>;
  startPipeline: (projectId: string, steps: string[]) => Promise<{ success: boolean; error?: string; error_code?: string; retryable?: boolean }>;
  resumePipeline: (projectId: string, steps: string[]) => Promise<{ success: boolean; error?: string; error_code?: string; retryable?: boolean }>;
  cancelPipeline: (projectId: string) => Promise<void>;
  downloadFont: (fontFamily: string) => Promise<{ success: boolean; css_path?: string }>;
}

/**
 * Safely call a pywebview API function.
 * Returns null if API is not available or call fails.
 */
async function safeApiCall<T>(fnName: string, ...args: any[]): Promise<T | null> {
  return callApi<T>(fnName, ...args);
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
  _projectsSig: '',
  _detailSig: '',

  fetchProjects: async () => {
    const result = await safeApiCall<any[]>('db_get_projects');
    if (result) {
      // get_all_projects is ORDER BY created_at DESC — serialization order
      // is stable, so identical pulls compare equal and skip the set.
      const sig = JSON.stringify(result);
      if (sig !== get()._projectsSig) {
        set({ projects: result || [], _projectsSig: sig });
      }
    }
  },

  fetchProjectDetail: async (projectId) => {
    const project = await safeApiCall<any>('db_get_project', projectId);
    if (!project) return;

    const tasksList = await safeApiCall<any[]>('db_get_project_tasks', projectId);

    const tasksMap: Record<string, Task> = {};
    if (tasksList) {
      tasksList.forEach(t => {
        tasksMap[t.step] = t;
      });
    }

    // Tasks have no DB ordering — compare via sorted steps.
    const sig = JSON.stringify([project, Object.keys(tasksMap).sort().map((k) => tasksMap[k])]);
    if (sig === get()._detailSig && get().selectedProject?.id === projectId) return;
    set({ selectedProject: project, tasks: tasksMap, _detailSig: sig });
  },

  deleteProject: async (projectId) => {
    const result = await safeApiCall<boolean>('db_delete_project', projectId);
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
    const res = await safeApiCall<{ success: boolean; error?: string }>('db_update_project', projectId, updates);
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
    const res = await safeApiCall<{ success: boolean; error?: string }>('start_processing_pipeline', projectId, steps);
    if (res) {
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Failed to start pipeline: Backend not responding" };
  },

  resumePipeline: async (projectId, steps) => {
    const res = await safeApiCall<{ success: boolean; error?: string }>('resume_processing_pipeline', projectId, steps);
    if (res) {
      get().fetchProjectDetail(projectId);
      return res;
    }
    return { success: false, error: "Failed to resume pipeline: Backend not responding" };
  },

  cancelPipeline: async (projectId) => {
    await safeApiCall('cancel_processing_pipeline', projectId);
    get().fetchProjectDetail(projectId);
  },

  downloadFont: async (fontFamily: string) => {
    const result = await safeApiCall<{ success: boolean; css_path?: string }>('download_google_font', fontFamily);
    return result || { success: false, error: "Backend not connected" };
  }
}));