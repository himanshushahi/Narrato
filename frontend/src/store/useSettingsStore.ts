import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { callEel, waitForEelConnection } from '../utils/eel-bridge';

export interface SubtitlePreset {
  id: string;
  name: string;
  settings: any;
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
  subtitle_presets?: SubtitlePreset[];
  default_subtitle_preset_id?: string;
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

interface SettingsStore {
  settings: Settings;
  kokoroDownload: KokoroDownload;
  whisperDownload: WhisperDownload;
  downloadedWhisperModels: DownloadedWhisperModel[];
  ytdlpUpdate: YtdlpUpdate;

  setSettings: (settings: Settings) => void;
  fetchSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  downloadKokoro: () => Promise<void>;
  downloadWhisper: (modelSize: string) => Promise<void>;
  fetchDownloadedWhisperModels: () => Promise<void>;
  deleteWhisperModel: (id: string) => Promise<boolean>;
  updateYtdlp: () => Promise<void>;
}

/**
 * Safely call an eel function, waiting for connection if needed.
 * Returns null if eel is not available or connection fails.
 */
async function safeEelCall<T>(fnName: string, ...args: any[]): Promise<T | null> {
  return callEel<T>(fnName, ...args);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
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

  setSettings: (settings) => set({ settings }),
  
  fetchSettings: async () => {
    const data = await safeEelCall<any>('db_get_settings');
    if (data) set({ settings: data });
  },

  saveSettings: async (newSettings) => {
    await safeEelCall<void>('db_update_settings', newSettings);
    set({ settings: newSettings });
  },

  downloadKokoro: async () => {
    set({ kokoroDownload: { active: true, file: "", progress: 0, status: "started", error: "" } });
    await safeEelCall<void>('start_kokoro_download');
  },

  downloadWhisper: async (modelSize) => {
    set({ whisperDownload: { active: true, progress: 0, status: "started", error: "" } });
    await safeEelCall<void>('start_whisper_download', modelSize);
  },

  fetchDownloadedWhisperModels: async () => {
    const models = await safeEelCall<any[]>('get_downloaded_whisper_models');
    set({ downloadedWhisperModels: models || [] });
  },

  deleteWhisperModel: async (id) => {
    const res = await safeEelCall<{ success: boolean }>('delete_whisper_model', id);
    if (res?.success) {
      useUIStore.getState().addToast(`Deleted Whisper model: ${id}`, "success");
      get().fetchDownloadedWhisperModels();
      return true;
    } else {
      useUIStore.getState().addToast(`Failed to delete Whisper model: ${id}`, "error");
    }
    return false;
  },

  updateYtdlp: async () => {
    set({ ytdlpUpdate: { active: true, progress: 0, status: "started", error: "" } });
    await safeEelCall<void>('update_ytdlp');
  }
}));
