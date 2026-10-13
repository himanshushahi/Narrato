import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { callApi } from '../utils/call-api';

interface SubtitlePreset {
  id: string;
  name: string;
  settings: any;
}

interface XttsProfile {
  id: string;
  name: string;
  language: string;
  reference_voice: string;
}

export interface WatermarkChannelPreset {
  id: string;
  name: string;
  channel_name: string;
  logo_url?: string;
  show_verified_badge?: boolean;
}

export interface Settings {
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  openai_temperature: string;
  openai_max_tokens: string;
  openai_top_p: string;
  app_language: string; // 'hi' (Hindi) or 'en' (English) — default script language
  whisper_model: string;
  whisper_device: string;
  tts_engine: string;
  tts_voice: string;
  tts_speed: string;
  tts_pitch: string;
  xtts_reference_voice: string;
  xtts_profiles?: XttsProfile[];
  bg_music_path: string;
  bg_music_volume: string;
  pexels_api_key: string;
  pixabay_api_key: string;
  freesound_api_key: string;
  use_pexels: boolean;
  use_youtube: boolean;
  use_archive: boolean;
  youtube_download_duration: string;
  sfx_volume: string;
  render_resolution: string;
  render_concurrency: string;
  render_fps: string;
  render_crf: string;
  render_codec: string;
  render_hardware: string;
  render_timeout: string;
  render_motion_blur: string;
  render_glass_cap: string;
  subtitle_presets?: SubtitlePreset[];
  default_subtitle_preset_id?: string;
  branding_presets?: SubtitlePreset[];
  default_branding_preset_id?: string;
  watermark_channel_presets?: WatermarkChannelPreset[];
  default_watermark_channel_preset_id?: string;
  web_search_enabled: boolean;
  web_search_provider: string;
  web_search_api_key: string;
  voiceover_volume: string;

}

interface XttsDownload {
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

interface GpuRuntimeStatus {
  nvidia_driver: boolean;
  driver_version: string | null;
  driver_ok: boolean | null;
  runtime_installed: boolean;
  runtime_version: string | null;
  manifest_valid: boolean;
  has_runtime_files: boolean;
  gpu_enabled: boolean;
  active_engine: string;
}

interface GpuDownload {
  active: boolean;
  progress: number;
  status: string; // '', 'downloading', 'completed', 'failed'
  error: string;
}

interface SettingsStore {
  settings: Settings;
  gpuAvailable: boolean;
  xttsDownload: XttsDownload;
  whisperDownload: WhisperDownload;
  downloadedWhisperModels: DownloadedWhisperModel[];
  ytdlpUpdate: YtdlpUpdate;

  setSettings: (settings: Settings) => void;
  fetchSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  checkGpuAvailability: () => Promise<void>;
  downloadXtts: () => Promise<void>;
  downloadWhisper: (modelSize: string) => Promise<void>;
  fetchDownloadedWhisperModels: () => Promise<void>;
  deleteWhisperModel: (id: string) => Promise<boolean>;
  updateYtdlp: () => Promise<void>;
  gpuRuntime: GpuRuntimeStatus | null;
  gpuDownload: GpuDownload;
  fetchGpuStatus: () => Promise<void>;
  downloadGpuRuntime: () => Promise<void>;
  cancelGpuDownload: () => Promise<void>;
  removeGpuRuntime: () => Promise<void>;
  setGpuEnabled: (enabled: boolean) => Promise<void>;
}

/**
 * Safely call a pywebview API function.
 * Returns null if API is not available or call fails.
 */
async function safeApiCall<T>(fnName: string, ...args: any[]): Promise<T | null> {
  return callApi<T>(fnName, ...args);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {
    openai_api_key: "",
    openai_base_url: "https://api.openai.com/v1",
    openai_model: "gpt-4o",
    openai_temperature: "0.7",
    openai_max_tokens: "4096",
    openai_top_p: "1.0",
    app_language: "hi",
    whisper_model: "turbo",
    whisper_device: "cpu",
    tts_engine: "edge",
    tts_voice: "hi-IN-MadhurNeural",
    tts_speed: "1.0",
    tts_pitch: "0",
    xtts_reference_voice: "",
    bg_music_path: "",
    bg_music_volume: "0.15",
    pexels_api_key: "",
    pixabay_api_key: "",
    freesound_api_key: "",
    use_pexels: true,
    use_youtube: true,
    use_archive: true,
    youtube_download_duration: "15",
    sfx_volume: "0.5",
    web_search_enabled: false,
    web_search_provider: "langsearch",
    web_search_api_key: "",
    render_resolution: "1080p",
    render_concurrency: "75%",
    render_fps: "30",
    render_crf: "23",
    render_codec: "h264",
    render_hardware: "cpu",
    render_timeout: "600000",
    render_motion_blur: "balanced",
    render_glass_cap: "16",
    voiceover_volume: "1.0",

  },
  gpuAvailable: false,
  xttsDownload: {
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
  gpuRuntime: null,
  gpuDownload: {
    active: false,
    progress: 0,
    status: "",
    error: ""
  },

  setSettings: (settings) => set({ settings }),
  
  fetchSettings: async () => {
    const data = await safeApiCall<any>('db_get_settings');
    if (data) {
      // Backfill app_language for DBs created before the key existed.
      // Prefer the persisted value; otherwise derive from the saved voice so
      // existing users keep their language instead of flipping to default.
      if (!data.app_language) {
        const voice: string = data.tts_voice || '';
        if (voice.startsWith('hi-')) {
          data.app_language = 'hi';
        } else if (voice.startsWith('en-')) {
          data.app_language = 'en';
        } else {
          const profiles: any[] = data.xtts_profiles || [];
          const current = profiles.find((p) => p.id === voice);
          if (current?.language === 'hi' || current?.language === 'en') {
            data.app_language = current.language;
          } else if (typeof data.whisper_model === 'string' && data.whisper_model.toLowerCase().includes('hindi')) {
            data.app_language = 'hi';
          } else {
            data.app_language = 'hi';
          }
        }
      }
      set({ settings: data });
    }
  },

  saveSettings: async (newSettings) => {
    await safeApiCall<void>('db_update_settings', newSettings);
    set({ settings: newSettings });
  },

  checkGpuAvailability: async () => {
    const available = await safeApiCall<boolean>('check_nvidia_gpu_available');
    set({ gpuAvailable: !!available });
  },

  downloadXtts: async () => {
    set({ xttsDownload: { active: true, file: "", progress: 0, status: "started", error: "" } });
    await safeApiCall<void>('start_omnivoice_download');
  },

  downloadWhisper: async (modelSize) => {
    set({ whisperDownload: { active: true, progress: 0, status: "started", error: "" } });
    await safeApiCall<void>('start_whisper_download', modelSize);
  },

  fetchGpuStatus: async () => {
    const data = await safeApiCall<GpuRuntimeStatus>('gpu_status');
    if (data) set({ gpuRuntime: data });
  },

  downloadGpuRuntime: async () => {
    set({ gpuDownload: { active: true, progress: 0, status: "started", error: "" } });
    await safeApiCall<void>('gpu_download_start');
  },

  cancelGpuDownload: async () => {
    await safeApiCall<void>('gpu_download_cancel');
  },

  removeGpuRuntime: async () => {
    await safeApiCall<void>('gpu_remove_runtime');
    await get().fetchGpuStatus();
  },

  setGpuEnabled: async (enabled: boolean) => {
    await safeApiCall<void>('gpu_set_enabled', enabled);
    await get().fetchGpuStatus();
  },

  fetchDownloadedWhisperModels: async () => {
    const models = await safeApiCall<any[]>('get_downloaded_whisper_models');
    set({ downloadedWhisperModels: models || [] });
  },

  deleteWhisperModel: async (id) => {
    const res = await safeApiCall<{ success: boolean }>('delete_whisper_model', id);
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
    await safeApiCall<void>('update_ytdlp');
  }
}));
