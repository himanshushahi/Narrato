import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { callEel } from '../utils/eel-bridge';

interface SubtitlePreset {
  id: string;
  name: string;
  settings: any;
}

export interface Settings {
  llm_provider: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  openai_temperature: string;
  openai_max_tokens: string;
  openai_top_p: string;
  nvidia_api_key: string;
  nvidia_base_url: string;
  nvidia_model: string;
  nvidia_temperature: string;
  nvidia_max_tokens: string;
  nvidia_top_p: string;
  whisper_model: string;
  whisper_device: string;
  tts_engine: string;
  tts_voice: string;
  tts_speed: string;
  tts_pitch: string;
  kokoro_voice: string;
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
  render_timeout: string;
  subtitle_presets?: SubtitlePreset[];
  default_subtitle_preset_id?: string;
  branding_presets?: SubtitlePreset[];
  default_branding_preset_id?: string;
  web_search_enabled: boolean;
  web_search_provider: string;
  web_search_api_key: string;
}

interface KokoroDownload {
  active: boolean;
  file: string;
  progress: number;
  status: string;
  error: string;
}

interface WhisperDownload {
  active: boolean;
  progress: number;
  status: string;
  error: string;
}

interface DownloadedWhisperModel {
  id: string;
  size_mb: number;
}

interface YtdlpUpdate {
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
    openai_temperature: "0.7",
    openai_max_tokens: "4096",
    openai_top_p: "1.0",
    nvidia_api_key: "",
    nvidia_base_url: "https://integrate.api.nvidia.com/v1",
    nvidia_model: "meta/llama-3.1-8b-instruct",
    nvidia_temperature: "0.7",
    nvidia_max_tokens: "4096",
    nvidia_top_p: "1.0",
    whisper_model: "base",
    whisper_device: "cpu",
    tts_engine: "edge",
    tts_voice: "hi-IN-SwaraNeural",
    tts_speed: "1.0",
    tts_pitch: "0",
    kokoro_voice: "hf_alpha",
    bg_music_path: "",
    bg_music_volume: "0.15",
    pexels_api_key: "",
    use_pexels: true,
    use_youtube: true,
    youtube_download_duration: "15",
    sfx_volume: "0.20",
    web_search_enabled: false,
    web_search_provider: "langsearch",
    web_search_api_key: "",
    render_resolution: "1080p",
    render_concurrency: "logical",
    render_fps: "30",
    render_crf: "23",
    render_codec: "h264",
    render_hardware: "cpu",
    render_timeout: "600000"
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
