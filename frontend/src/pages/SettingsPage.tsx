import React, { useEffect, useState, useRef } from 'react';
import { useSettingsStore, Settings as SettingsType } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { AIProviderCard } from '../features/Settings/components/AIProviderCard';
import { AnimatedTabs, Tab } from '../components/ui/AnimatedTabs';
import { CustomInput } from '../components/ui/CustomInput';
import { CustomSelect, SelectOption } from '../components/ui/CustomSelect';
import { CustomRange } from '../components/ui/CustomRange';
import { motion } from 'framer-motion';
import { EDGE_VOICE_OPTIONS, SPEED_OPTIONS, PITCH_OPTIONS, WHISPER_MODEL_OPTIONS } from '../features/Settings/voiceConstants';
import {
  VscSettings, VscSave, VscCloudDownload, VscLoading, VscCheck, VscServer, VscFeedback,
  VscKey, VscLink, VscSymbolClass, VscGlobe, VscPlay, VscMusic, VscFolderOpened, VscTrash
} from 'react-icons/vsc';
import { MdOutlineMovie } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { callApi } from '../utils/call-api';
import { getMediaUrlSync } from '../utils/mediaUrl';

const GPU_ERROR_TEXT: Record<string, string> = {
  already_running: 'A download is already in progress.',
  disk_space: 'Not enough free disk space (need ~7 GB).',
  cancelled: 'Download cancelled.',
  download_failed: 'Download failed — check your connection and retry.',
  size_mismatch: 'Downloaded file was incomplete — retry.',
  extract_failed: 'Extraction failed — retry.',
};

export const SettingsPage: React.FC = () => {
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const fetchSettings = useSettingsStore((state) => state.fetchSettings);

  const xttsDownload = useSettingsStore((state) => state.xttsDownload);
  const downloadXtts = useSettingsStore((state) => state.downloadXtts);
  const whisperDownload = useSettingsStore((state) => state.whisperDownload);
  const downloadWhisper = useSettingsStore((state) => state.downloadWhisper);
  const downloadedWhisperModels = useSettingsStore((state) => state.downloadedWhisperModels);
  const fetchDownloadedWhisperModels = useSettingsStore((state) => state.fetchDownloadedWhisperModels);
  const deleteWhisperModel = useSettingsStore((state) => state.deleteWhisperModel);
  const showConfirm = useUIStore((state) => state.showConfirm);
  const closeConfirm = useUIStore((state) => state.closeConfirm);
  const ytdlpUpdate = useSettingsStore((state) => state.ytdlpUpdate);
  const updateYtdlp = useSettingsStore((state) => state.updateYtdlp);
  const gpuRuntime = useSettingsStore((state) => state.gpuRuntime);
  const gpuDownload = useSettingsStore((state) => state.gpuDownload);
  const fetchGpuStatus = useSettingsStore((state) => state.fetchGpuStatus);
  const downloadGpuRuntime = useSettingsStore((state) => state.downloadGpuRuntime);
  const cancelGpuDownload = useSettingsStore((state) => state.cancelGpuDownload);
  const removeGpuRuntime = useSettingsStore((state) => state.removeGpuRuntime);
  const setGpuEnabled = useSettingsStore((state) => state.setGpuEnabled);

  const [formData, setFormData] = useState<SettingsType>({ ...settings });
  const [saveStatus, setSaveStatus] = useState('');
  const [xttsInstalled, setXttsInstalled] = useState(false);
  const [whisperInstalled, setWhisperInstalled] = useState(false);
  const gpuAvailable = useSettingsStore((state) => state.gpuAvailable);


  // yt-dlp version state
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);
  const [ytdlpPath, setYtdlpPath] = useState<string | null>(null);

  // HF Test States
  const [hfTestPrompt, setHfTestPrompt] = useState('A futuristic city skyline');
  const [hfTestFormat, setHfTestFormat] = useState('portrait');
  const [hfTestImage, setHfTestImage] = useState('');
  const [isHfTesting, setIsHfTesting] = useState(false);

  // App language state (computed locally based on voice settings)
  const [appLanguage, setAppLanguage] = useState<'hi' | 'en'>('hi');

  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSaveStatusTimer = () => { if (saveStatusTimerRef.current) { clearTimeout(saveStatusTimerRef.current); saveStatusTimerRef.current = null; } };

  const [previewText, setPreviewText] = useState('नमस्ते! यह चुनी हुई आवाज का पूर्वावलोकन है।');
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [newProfileName, setNewProfileName] = useState('');

  // Fetch settings on load
  useEffect(() => {
    fetchSettings();
    fetchDownloadedWhisperModels();
    fetchGpuStatus();
  }, [fetchSettings, fetchDownloadedWhisperModels, fetchGpuStatus]);

  // Check yt-dlp version on mount and after updates
  useEffect(() => {
    const checkYtdlpVersion = async () => {
      try {
        const info = await callApi<{ installed: boolean; version?: string; path?: string }>('get_ytdlp_version');
        setYtdlpInstalled(info?.installed || false);
        setYtdlpVersion(info?.version || null);
        setYtdlpPath(info?.path || null);
      } catch {
        setYtdlpInstalled(false);
        setYtdlpVersion(null);
        setYtdlpPath(null);
      }
    };
    checkYtdlpVersion();
  }, [ytdlpUpdate.status]);

  // Sync settings when loaded
  useEffect(() => {
    const isHindi = (settings.tts_voice?.startsWith('hi-'));
    setAppLanguage(isHindi ? 'hi' : 'en');

    setFormData(() => {
      const updated = { ...settings };
      if (!gpuAvailable) {
        updated.whisper_device = 'cpu';
        updated.render_hardware = 'cpu';
      }

      // Smart default: Upgrade legacy 'small', 'base' or 'turbo' to the Hindi model if the app is in Hindi
      if (isHindi && (updated.whisper_model === 'small' || updated.whisper_model === 'base' || updated.whisper_model === 'turbo')) {
        updated.whisper_model = 'collabora/faster-whisper-small-hindi';
      } else if (!isHindi && updated.whisper_model === 'collabora/faster-whisper-small-hindi') {
        updated.whisper_model = 'turbo';
      }

      return updated;
    });
  }, [settings, gpuAvailable]);

  // Sync preview text language
  useEffect(() => {
    setPreviewText(appLanguage === 'hi'
      ? 'नमस्ते! यह चुनी हुई आवाज का पूर्वावलोकन है।'
      : 'Hello! This is a preview of the selected voice.'
    );
  }, [appLanguage]);

  // Clear preview URL and errors when voice options change
  useEffect(() => {
    setPreviewAudioUrl('');
    setPreviewError('');
  }, [formData.tts_engine, formData.tts_voice, formData.tts_speed, formData.tts_pitch, formData.xtts_reference_voice]);

  // Check XTTS model downloads
  useEffect(() => {
    checkXttsAssets();
  }, [xttsDownload.status]);

  const checkXttsAssets = async () => {
    const ok = await callApi<boolean>('check_xtts_downloaded');
    setXttsInstalled(!!ok);
  };
  const handleTestHfModel = async () => {
    if (!window.pywebview) return;
    const apiKey = formData.huggingface_api_key;
    const model = formData.huggingface_model || "black-forest-labs/FLUX.1-schnell";
    const provider = formData.huggingface_provider || "auto";
    if (!apiKey) {
      useUIStore.getState().addToast("Please enter a Hugging Face API Key first", "warning");
      return;
    }
    
    setIsHfTesting(true);
    setHfTestImage('');
    try {
      const res = await window.pywebview.api.test_huggingface_model(apiKey, model, provider, hfTestPrompt, hfTestFormat);
      if (res && res.success && res.image) {
        setHfTestImage(res.image);
        useUIStore.getState().addToast("Image generated successfully!", "success");
      } else {
        useUIStore.getState().addToast(res?.error || "Failed to generate image", "error");
      }
    } catch (e: any) {
      useUIStore.getState().addToast(e.message || "Failed to test model", "error");
    } finally {
      setIsHfTesting(false);
    }
  };



  // Check Whisper model downloads
  useEffect(() => {
    checkWhisperAssets();
  }, [formData.whisper_model, whisperDownload.status]);

  const checkWhisperAssets = async () => {
    const ok = await callApi<boolean>('check_whisper_downloaded', formData.whisper_model);
    setWhisperInstalled(!!ok);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: SettingsType) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev: SettingsType) => {
      const updated = { ...prev, [name]: value };
      if (name === 'app_language') {
        const lang = value as 'hi' | 'en';
        setAppLanguage(lang);
        if (updated.tts_engine === 'xtts') {
          // Keep the XTTS profile only if it matches the new language,
          // otherwise clear it so the filtered dropdown isn't stale.
          const current = (updated.xtts_profiles || []).find((p: any) => p.id === updated.tts_voice);
          if (!current || current.language !== lang) {
            updated.tts_voice = '';
          }
        } else {
          updated.tts_voice = lang === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural';
        }
        if (lang === 'hi') {
          updated.whisper_model = 'collabora/faster-whisper-small-hindi';
        } else {
          updated.whisper_model = 'turbo';
        }
      }
      // Removed legacy llm_provider overwrite logic
      return updated;
    });
  };

  const handleBrowseBGM = async () => {
    const path = await callApi<string>('browse_bg_music_file');
    if (path) {
      setFormData((prev: SettingsType) => ({ ...prev, bg_music_path: path }));
      // Immediately persist so the DB matches the file in assets/ — prevents
      // orphaned files if the user refreshes before clicking "Save Preferences".
      await saveSettings({ ...formData, bg_music_path: path });
    }
  };

  const handlePlayPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewAudioUrl('');
    try {
      let voice = formData.tts_voice;
      if (formData.tts_engine === 'xtts') {
        const profile = formData.xtts_profiles?.find((p: any) => p.id === formData.tts_voice);
        voice = profile?.reference_voice || formData.xtts_reference_voice || '';
      }
      const res = await callApi<{ success: boolean; audio_path?: string; error?: string }>('generate_voice_preview',
        previewText,
        formData.tts_engine,
        voice,
        formData.tts_speed,
        formData.tts_pitch,
        appLanguage
      );

      if (res?.success && res.audio_path) {
        // Narrato serves previews via /api/media (or local file server in prod)
        const audioUrl = getMediaUrlSync(res.audio_path);
        setPreviewAudioUrl(`${audioUrl}&t=${Date.now()}`);
      } else {
        setPreviewError(res?.error || 'Failed to generate voice preview.');
      }
    } catch (err: any) {
      console.error("Preview generation failed", err);
      setPreviewError(err?.message || 'Failed to connect to the backend server.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      await saveSettings(formData);
      setSaveStatus('success');
      clearSaveStatusTimer();
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      setSaveStatus('failed');
      clearSaveStatusTimer();
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleUpdateYtdlp = () => {
    updateYtdlp();
  };

  const isConnected = formData.llm_provider === 'nvidia' 
    ? !!formData.nvidia_api_key?.trim() 
    : !!formData.openai_api_key?.trim();
  const isNvidia = formData.llm_provider === 'nvidia';

  const hardwareTabs: Tab[] = [
    { id: 'cpu', label: 'CPU Engine' },
    { id: 'cuda', label: 'GPU CUDA Engine', disabled: !gpuAvailable }
  ];

  const renderHardwareTabs: Tab[] = [
    { id: 'cpu', label: 'CPU (Software)' },
    { id: 'cuda', label: 'GPU (CUDA NVENC)', disabled: !gpuAvailable }
  ];

  const ttsEngineTabs: Tab[] = [
    { id: 'edge', label: 'Edge-TTS (Online)' },
    { id: 'xtts', label: 'XTTS v2 (Voice Clone)' }
  ];

  const edgeVoiceOptions = EDGE_VOICE_OPTIONS;
  const edgeRateOptions = SPEED_OPTIONS;
  const edgePitchOptions = PITCH_OPTIONS;

  const renderResolutionOptions: SelectOption[] = [
    { value: '720p', label: '720p (HD - Fast Render)' },
    { value: '1080p', label: '1080p (FHD - Recommended)' },
    { value: '1440p', label: '1440p (2K - High Quality)' },
    { value: '4k', label: '4K (UHD - Slowest Render)' }
  ];

  const renderConcurrencyOptions: SelectOption[] = [
    { value: '1', label: '1 Core (Slow & Stable)' },
    { value: '2', label: '2 Cores' },
    { value: '4', label: '4 Cores' },
    { value: '8', label: '8 Cores' },
    { value: 'logical', label: 'Max Logical Cores (Fastest)' },
    { value: 'physical', label: 'Max Physical Cores (Recommended)' }
  ];

  const renderFpsOptions: SelectOption[] = [
    { value: '24', label: '24 FPS (Cinematic)' },
    { value: '30', label: '30 FPS (Standard)' },
    { value: '60', label: '60 FPS (Smooth)' }
  ];

  const renderCodecOptions: SelectOption[] = [
    { value: 'h264', label: 'H.264 (Universal - Recommended)' },
    { value: 'h265', label: 'H.265 (Better Compression)' },
    { value: 'vp8', label: 'VP8 (WebM)' },
    { value: 'vp9', label: 'VP9 (WebM HQ)' }
  ];

  const renderCrfOptions: SelectOption[] = [
    { value: '18', label: 'High Quality (CRF 18)' },
    { value: '23', label: 'Medium Quality (CRF 23 - Default)' },
    { value: '28', label: 'Lower Quality (CRF 28 - Smallest)' }
  ];

  const renderTimeoutOptions: SelectOption[] = [
    { value: '300000', label: '5 min (Default)' },
    { value: '600000', label: '10 min' },
    { value: '900000', label: '15 min' },
    { value: '1800000', label: '30 min' },
    { value: '3600000', label: '60 min' },
  ];



  return (
    <div className="flex-1 overflow-y-auto p-8 relative scrollbar-thin">
      <div
        className="max-w-6xl mx-auto space-y-8 relative z-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800/60 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <VscSettings className="text-2xl text-[var(--color-accent-primary)]" />
              <h1 className="text-2xl font-black text-white tracking-tight">System <span className="text-gradient-accent">Preferences</span></h1>
            </div>
            <p className="text-xs text-stone-400 font-medium">Configure LLM keys, speech engines, and local workspace directories.</p>
          </div>
          <GlowButton
            onClick={handleSubmit}
            disabled={saveStatus === 'saving'}
            icon={saveStatus === 'saving' ? <VscLoading className="animate-spin" /> : <VscSave />}
          >
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'success' ? 'Saved!' : 'Save Preferences'}
          </GlowButton>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* AI Language Model Provider Card */}
          <div>
            <AIProviderCard
              title="AI Language Model Provider"
              provider={formData.llm_provider === 'nvidia' ? 'Nvidia NIM' : 'OpenAI Compatible Endpoint'}
              isConnected={isConnected}
            >
              <div className="space-y-6">
                <div className="flex justify-start">
                  <AnimatedTabs
                    tabs={[
                      { id: 'openai', label: 'OpenAI Compatible' },
                      { id: 'nvidia', label: 'Nvidia NIM' }
                    ]}
                    activeTab={formData.llm_provider || 'openai'}
                    onChange={(tabId) => handleSelectChange('llm_provider', tabId)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-3">
                    <CustomInput
                      label="API Authorization Key"
                      type="password"
                      name={isNvidia ? "nvidia_api_key" : "openai_api_key"}
                      value={isNvidia ? formData.nvidia_api_key || '' : formData.openai_api_key || ''}
                      onChange={handleInputChange}
                      placeholder={isNvidia ? 'nvapi-...' : 'sk-...'}
                      icon={<VscKey />}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <CustomInput
                      label="Base URL"
                      type="text"
                      name={isNvidia ? "nvidia_base_url" : "openai_base_url"}
                      value={isNvidia ? formData.nvidia_base_url || '' : formData.openai_base_url || ''}
                      onChange={handleInputChange}
                      placeholder={isNvidia ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1'}
                      icon={<VscLink />}
                    />
                  </div>
                  <div>
                    <CustomInput
                      label="Model Name"
                      type="text"
                      name={isNvidia ? "nvidia_model" : "openai_model"}
                      value={isNvidia ? formData.nvidia_model || '' : formData.openai_model || ''}
                      onChange={handleInputChange}
                      placeholder={isNvidia ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o'}
                      icon={<VscSymbolClass />}
                    />
                  </div>
                </div>

                <div className="bg-black/15 p-4 rounded-md border border-stone-850">
                  <h3 className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-4">Hyperparameters</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <CustomRange
                      label="Temperature"
                      valueDisplay={parseFloat(isNvidia ? formData.nvidia_temperature || '0.7' : formData.openai_temperature || '0.7').toFixed(2)}
                      min="0"
                      max="2"
                      step="0.05"
                      name={isNvidia ? "nvidia_temperature" : "openai_temperature"}
                      value={isNvidia ? formData.nvidia_temperature : formData.openai_temperature}
                      onChange={handleInputChange}
                    />
                    <CustomRange
                      label="Top P"
                      valueDisplay={parseFloat(isNvidia ? formData.nvidia_top_p || '1.0' : formData.openai_top_p || '1.0').toFixed(2)}
                      min="0"
                      max="1"
                      step="0.05"
                      name={isNvidia ? "nvidia_top_p" : "openai_top_p"}
                      value={isNvidia ? formData.nvidia_top_p : formData.openai_top_p}
                      onChange={handleInputChange}
                    />
                    <CustomInput
                      label="Max Tokens"
                      type="number"
                      name={isNvidia ? "nvidia_max_tokens" : "openai_max_tokens"}
                      value={isNvidia ? formData.nvidia_max_tokens : formData.openai_max_tokens}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
              </div>
            </AIProviderCard>
          </div>

          {/* HuggingFace Image Generation Card */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <BsStars className="text-base text-[var(--color-accent-primary)]" />
                Hugging Face Image Generation
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CustomInput
                  label="Hugging Face API Key"
                  type="password"
                  name="huggingface_api_key"
                  value={formData.huggingface_api_key || ''}
                  onChange={handleInputChange}
                  placeholder="hf_..."
                  icon={<VscKey />}
                />
                <CustomInput
                  label="Default Model Name"
                  type="text"
                  name="huggingface_model"
                  value={formData.huggingface_model || ''}
                  onChange={handleInputChange}
                  placeholder="black-forest-labs/FLUX.1-schnell"
                  icon={<VscSymbolClass />}
                />
                <CustomSelect
                  label="Inference Provider"
                  options={[
                    { value: 'auto', label: 'Auto (Default)' },
                    { value: 'black-forest-labs', label: 'Black Forest Labs' },
                    { value: 'cerebras', label: 'Cerebras' },
                    { value: 'clarifai', label: 'Clarifai' },
                    { value: 'cohere', label: 'Cohere' },
                    { value: 'deepinfra', label: 'DeepInfra' },
                    { value: 'fal-ai', label: 'Fal.ai' },
                    { value: 'featherless-ai', label: 'Featherless AI' },
                    { value: 'fireworks-ai', label: 'Fireworks AI' },
                    { value: 'groq', label: 'Groq' },
                    { value: 'hf-inference', label: 'HF Inference Endpoints' },
                    { value: 'hyperbolic', label: 'Hyperbolic' },
                    { value: 'nebius', label: 'Nebius' },
                    { value: 'novita', label: 'Novita' },
                    { value: 'nscale', label: 'Nscale' },
                    { value: 'nvidia', label: 'NVIDIA' },
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'ovhcloud', label: 'OVHcloud' },
                    { value: 'publicai', label: 'PublicAI' },
                    { value: 'replicate', label: 'Replicate' },
                    { value: 'sambanova', label: 'SambaNova' },
                    { value: 'scaleway', label: 'Scaleway' },
                    { value: 'together', label: 'Together AI' },
                    { value: 'wavespeed', label: 'Wavespeed' },
                    { value: 'zai-org', label: 'ZAI Org' }
                  ]}
                  value={formData.huggingface_provider || 'auto'}
                  onChange={(val) => handleSelectChange('huggingface_provider', val)}
                />
              </div>
              <div className="text-[10px] text-stone-400">
                This is used for generating AI Images when using the "AI Generated Image" visual type. Leave Model Name blank to use the prompt's specified model or the backend default. Set Inference Provider to "Auto" to let Hugging Face choose, or force a specific provider.
              </div>
              
              <div className="mt-4 pt-6 border-t border-stone-800/50">
                <h3 className="text-xs font-semibold text-stone-300 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <VscSymbolClass className="text-[var(--color-accent-primary)]" />
                  Test Image Generation
                </h3>
                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="flex-1 space-y-4">
                    <CustomInput
                      label="Test Prompt"
                      type="text"
                      name="hfTestPrompt"
                      value={hfTestPrompt}
                      onChange={(e) => setHfTestPrompt(e.target.value)}
                      placeholder="A futuristic city skyline..."
                    />
                    <CustomSelect
                      label="Aspect Ratio"
                      options={[
                        { value: 'portrait', label: 'Portrait (9:16)' },
                        { value: 'landscape', label: 'Landscape (16:9)' }
                      ]}
                      value={hfTestFormat}
                      onChange={(val) => setHfTestFormat(val)}
                    />
                    <button
                      type="button"
                      onClick={handleTestHfModel}
                      disabled={isHfTesting || !formData.huggingface_api_key}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-sm transition-colors border border-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isHfTesting ? (
                        <div className="w-4 h-4 border-2 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <BsStars className="text-[var(--color-accent-primary)]" />
                      )}
                      {isHfTesting ? 'Generating Preview...' : 'Test Generation'}
                    </button>
                  </div>
                  
                  <div className="flex-[1.5] bg-black/40 border border-stone-800/50 rounded-lg overflow-hidden flex flex-col items-center justify-center min-h-[250px] relative">
                    {hfTestImage ? (
                      <img src={hfTestImage} alt="Generated Test" className="object-contain max-h-[350px] max-w-full" />
                    ) : (
                      <div className="text-stone-600 text-xs flex flex-col items-center gap-3">
                        <VscSymbolClass className="text-3xl opacity-30" />
                        <span>Preview will appear here</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Localization & Default Language */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscGlobe className="text-base text-[var(--color-accent-primary)]" />
                Localization & Accent
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <CustomSelect
                  label="Default Script Language"
                  options={[
                    { value: 'hi', label: 'Hindi (हिन्दी)' },
                    { value: 'en', label: 'English' }
                  ]}
                  value={appLanguage}
                  onChange={(val) => handleSelectChange('app_language', val)}
                />
                <div className="text-xs text-stone-400 flex items-center bg-black/20 p-4 rounded-md border border-stone-800/40">
                  Selecting a default language changes the available voice synthesizers below. Hindi targets localized Hindi voices while English targets US/UK voices.
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Whisper & Speech synthesis Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Speech to text */}
            <GlassCard className="p-6 space-y-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                    <VscServer className="text-base text-[var(--color-accent-primary)]" />
                    Speech-to-Text (Whisper)
                  </h2>
                  <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border ${whisperInstalled
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                    : whisperDownload.active
                      ? 'bg-blue-950/40 text-blue-400 border-blue-800/30 animate-pulse'
                      : 'bg-amber-950/40 text-amber-500 border-amber-800/30'
                    }`}>
                    {whisperInstalled ? 'Installed' : whisperDownload.active ? 'Downloading' : 'Missing Assets'}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-1.5">Processing Hardware</label>
                    <AnimatedTabs
                      tabs={hardwareTabs}
                      activeTab={formData.whisper_device}
                      onChange={(id) => handleSelectChange('whisper_device', id)}
                      layoutId="settings-whisper-device-tab"
                    />
                  </div>

                  <div className="space-y-1">
                    <CustomSelect
                      label="Faster-Whisper Model Size"
                      options={WHISPER_MODEL_OPTIONS}
                      value={formData.whisper_model}
                      onChange={(val) => handleSelectChange('whisper_model', val)}
                    />
                    {!whisperInstalled && (
                      <div className="text-[10px] text-amber-500 font-medium px-1">
                        This model is not downloaded. You can download it below.
                      </div>
                    )}
                  </div>

                  {/* Downloaded Models List */}
                  {downloadedWhisperModels.length > 0 && (
                    <div className="mt-4 bg-black/20 rounded-lg border border-stone-800/40 p-3">
                      <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-2">Downloaded Models</label>
                      <div className="space-y-2">
                        {downloadedWhisperModels.map(model => (
                          <div key={model.id} className="flex items-center justify-between bg-black/40 rounded p-2 border border-stone-800/50">
                            <div className="flex flex-col">
                              <span className="text-xs text-stone-300 font-mono">{model.id}</span>
                              <span className="text-[10px] text-stone-500">{model.size_mb} MB</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                showConfirm(
                                  "Delete Whisper Model",
                                  `Are you sure you want to delete the model '${model.id}'? This will free up ${model.size_mb} MB of disk space.`,
                                  () => {
                                    deleteWhisperModel(model.id);
                                    closeConfirm();
                                  }
                                );
                              }}
                              className="text-rose-500/70 hover:text-rose-400 p-1.5 cursor-pointer rounded hover:bg-rose-500/10 transition-colors"
                              title="Delete model"
                            >
                              <VscTrash />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!whisperInstalled && (
                <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4 mt-6 space-y-3">
                  {whisperDownload.active ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-amber-400 font-medium">
                        <span>Downloading model...</span>
                        <span>{whisperDownload.progress}%</span>
                      </div>
                      <div className="w-full bg-black/50 rounded-full h-1 border border-amber-800/20">
                        <div className="h-full bg-amber-500" style={{ width: `${whisperDownload.progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <GlowButton variant="secondary" size="sm" fullWidth onClick={() => downloadWhisper(formData.whisper_model)} type="button" icon={<VscCloudDownload />}>
                      Download Model Weights
                    </GlowButton>
                  )}
                </div>
              )}
            </GlassCard>

            {/* Voice Synthesis */}
            <GlassCard className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                  <VscFeedback className="text-base text-[var(--color-accent-primary)]" />
                  Voice Synthesis (TTS)
                </h2>
                
                <div className="flex items-center gap-2">
                  {formData.tts_engine === 'xtts' && xttsInstalled && (
                    <button
                      type="button"
                      onClick={() => {
                        showConfirm("Delete XTTS Model", "Are you sure you want to delete the XTTS v2 model (~1.8GB)? You will need to download it again to use offline voice cloning.", async () => {
                          const res = await callApi<{ success: boolean; message?: string; error?: string }>('delete_xtts_model');
                          if (res?.success) {
                            setXttsInstalled(false);
                            useUIStore.getState().addToast('XTTS model deleted successfully.', 'success');
                          } else {
                            useUIStore.getState().addToast(res?.error || 'Failed to delete model.', 'error');
                          }
                        });
                      }}
                      className="text-rose-500/70 hover:text-rose-400 p-1 cursor-pointer rounded hover:bg-rose-500/10 transition-colors"
                      title="Delete XTTS Model"
                    >
                      <VscTrash className="text-lg" />
                    </button>
                  )}

                  {formData.tts_engine === 'xtts' && (
                    <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border ${xttsInstalled
                      ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                      : xttsDownload.active
                        ? 'bg-blue-950/40 text-blue-400 border-blue-800/30 animate-pulse'
                        : 'bg-amber-950/40 text-amber-500 border-amber-800/30'
                      }`}>
                      {xttsInstalled ? 'Installed' : xttsDownload.active ? 'Downloading' : 'Missing Assets'}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-1.5">Synthesis Engine</label>
                  <AnimatedTabs
                    tabs={ttsEngineTabs}
                    activeTab={formData.tts_engine}
                    onChange={(id) => handleSelectChange('tts_engine', id)}
                    layoutId="settings-tts-engine-tab"
                  />
                </div>

                {formData.tts_engine === 'edge' ? (
                  <div className="space-y-4">
                    <CustomSelect
                      label="Edge Cloud Voice"
                      options={edgeVoiceOptions.filter(opt =>
                        appLanguage === 'hi' ? opt.value.startsWith('hi-') : !opt.value.startsWith('hi-')
                      )}
                      value={formData.tts_voice}
                      onChange={(val) => handleSelectChange('tts_voice', val)}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <CustomSelect
                        label="Rate/Speed"
                        options={edgeRateOptions}
                        value={formData.tts_speed}
                        onChange={(val) => handleSelectChange('tts_speed', val)}
                      />
                      <CustomSelect
                        label="Voice Pitch"
                        options={edgePitchOptions}
                        value={formData.tts_pitch}
                        onChange={(val) => handleSelectChange('tts_pitch', val)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* XTTS Voice dropdown — mirrors Edge voice selection */}
                    <CustomSelect
                      label="XTTS Voice (Clone Profile)"
                      options={[
                        { value: '', label: 'Default Reference Voice (Bundled)' },
                        ...(formData.xtts_profiles || [])
                          .filter((p: any) => p.language === appLanguage || p.id === formData.tts_voice)
                          .map((p: any) => ({
                            value: p.id,
                            label: p.language === 'hi' ? `${p.name} (Hindi)` : p.language === 'en' ? `${p.name} (English)` : p.name
                          }))
                      ]}
                      value={formData.tts_voice}
                      onChange={(val) => handleSelectChange('tts_voice', val)}
                    />
                    {formData.tts_voice && (
                      <div className="text-[10px] text-stone-400 px-1">
                        Projects without a specific voice will use{' '}
                        <span className="text-stone-200 font-semibold">
                          {formData.xtts_profiles?.find((p: any) => p.id === formData.tts_voice)?.name || 'Default Reference Voice'}
                        </span>
                        .
                      </div>
                    )}
                    <CustomSelect
                      label="Rate/Speed"
                      options={edgeRateOptions}
                      value={formData.tts_speed}
                      onChange={(val) => handleSelectChange('tts_speed', val)}
                    />

                    {/* XTTS Profile Manager */}
                    <div className="space-y-3 pt-2 border-t border-stone-800/50">
                      <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider">Voice Profiles (XTTS)</label>
                      
                      {/* Profile List */}
                      {formData.xtts_profiles && formData.xtts_profiles.length > 0 && (
                        <div className="space-y-2">
                          {formData.xtts_profiles.map((profile) => (
                            <div key={profile.id} className="flex items-center justify-between bg-black/30 rounded p-2 border border-stone-800/40">
                              <div>
                                <div className="text-xs font-semibold text-stone-200">{profile.name}</div>
                                <div className="text-[10px] text-stone-500 uppercase tracking-wider">{profile.language === 'hi' ? 'Hindi' : profile.language === 'en' ? 'English' : profile.language}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = formData.xtts_profiles!.filter(p => p.id !== profile.id);
                                  setFormData(prev => ({
                                    ...prev,
                                    xtts_profiles: updated,
                                    tts_voice: prev.tts_voice === profile.id ? '' : prev.tts_voice
                                  }));
                                }}
                                className="text-rose-500/70 hover:text-rose-400 p-1.5 cursor-pointer rounded hover:bg-rose-500/10 transition-colors"
                              >
                                <VscTrash />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add New Profile Form */}
                      <div className="bg-black/20 p-3 rounded border border-stone-800/30 space-y-3">
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Add New Profile</div>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <CustomInput
                              type="text"
                              placeholder="Profile Name (e.g. My Voice Clone)"
                              value={newProfileName}
                              onChange={(e) => setNewProfileName(e.target.value)}
                            />
                          </div>
                          <div className="flex items-center text-[10px] text-zinc-500 font-medium px-2 uppercase tracking-wider border border-zinc-800/60 rounded bg-black/40">
                            Lang: {appLanguage === 'hi' ? 'Hindi' : 'English'}
                          </div>
                        </div>
                        <GlowButton variant="secondary" size="sm" type="button" fullWidth icon={<VscFolderOpened />} onClick={async () => {
                          if (!newProfileName.trim()) {
                            useUIStore.getState().addToast('Please enter a profile name first.', 'error');
                            return;
                          }
                          const res = await callApi<{ success: boolean; path?: string; filename?: string; error?: string }>('upload_reference_voice');
                          if (res?.success && res.path) {
                            const newProfile = {
                              id: 'xtts_prof_' + Math.random().toString(36).substr(2, 9),
                              name: newProfileName,
                              language: appLanguage,
                              reference_voice: res.path
                            };
                            setFormData(prev => ({
                              ...prev,
                              xtts_profiles: [...(prev.xtts_profiles || []), newProfile]
                            }));
                            setNewProfileName('');
                            useUIStore.getState().addToast(`Profile added: ${res.filename}`, 'success');
                          } else if (res?.error && res.error !== 'No file selected.') {
                            useUIStore.getState().addToast(res.error, 'error');
                          }
                        }}>
                          Upload Audio (.wav) & Save Profile
                        </GlowButton>
                      </div>
                      <p className="text-[9px] text-stone-500">Upload a 6–15 second clear voice clip (.wav) for voice cloning.</p>
                    </div>
                  </div>
                )}

                <hr className="border-stone-800/50 my-2" />

                {/* Voice Preview Tester */}
                <div className="space-y-3">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <CustomInput
                        label="Test Synthesis Output"
                        value={previewText}
                        onChange={(e) => setPreviewText(e.target.value)}
                        placeholder="Enter text to preview..."
                        className="text-xs"
                      />
                    </div>
                    {formData.tts_engine === 'xtts' && (
                      <div className="flex items-center gap-2 text-[10px] text-stone-500 px-1 pb-1">
                        <VscFeedback className="text-xs text-[var(--color-accent-primary)]" />
                        Preview uses the XTTS voice selected above.
                      </div>
                    )}
                    <GlowButton
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={handlePlayPreview}
                      disabled={previewLoading || !previewText.trim() || (formData.tts_engine === 'xtts' && !xttsInstalled)}
                      icon={previewLoading ? <VscLoading className="animate-spin" /> : <VscPlay />}
                    >
                      {previewLoading ? 'Testing...' : 'Preview'}
                    </GlowButton>
                  </div>

                  {previewError && (
                    <div className="text-[10px] text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded p-2.5 font-mono">
                      {previewError}
                    </div>
                  )}

                  {previewAudioUrl && !previewLoading && (
                    <div className="bg-black/20 p-1.5 border border-stone-850 rounded flex items-center justify-between">
                      <audio
                        src={previewAudioUrl}
                        controls
                        autoPlay
                        className="w-full h-7 focus:outline-none opacity-85"
                      />
                    </div>
                  )}
                </div>

                {/* XTTS Download UI */}
                {formData.tts_engine === 'xtts' && !xttsInstalled && (
                  <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4 space-y-3">
                    <p className="text-[10px] text-amber-200/70">XTTS v2 model is required for offline voice cloning. Size is ~1.8GB. A CUDA GPU is recommended.</p>
                    {xttsDownload.active ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-amber-400 font-medium">
                          <span>Downloading {xttsDownload.file || 'model'}...</span>
                          <span>{xttsDownload.progress}%</span>
                        </div>
                        <div className="w-full bg-black/50 rounded-full h-1 border border-amber-800/20">
                          <div className="h-full bg-amber-500" style={{ width: `${xttsDownload.progress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <GlowButton variant="secondary" size="sm" fullWidth onClick={downloadXtts} type="button" icon={<VscCloudDownload />}>
                        Download XTTS v2 Model
                      </GlowButton>
                    )}
                  </div>
                )}
              </div>
            </GlassCard>
          </div>

          {/* GPU Acceleration */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                  <VscServer className="text-base text-[var(--color-accent-primary)]" />
                  GPU Acceleration
                </h2>
                <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border ${gpuRuntime?.active_engine === 'cuda'
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                  : gpuRuntime?.runtime_installed
                    ? 'bg-blue-950/40 text-blue-400 border-blue-800/30'
                    : 'bg-stone-950/40 text-stone-400 border-stone-800/30'
                  }`}>
                  {gpuRuntime?.active_engine === 'cuda' ? 'GPU Active' : gpuRuntime?.runtime_installed ? 'Installed (CPU)' : 'CPU Only'}
                </span>
              </div>

              <div className="space-y-3 text-xs text-stone-400">
                <p className="leading-relaxed">
                  Voice cloning (XTTS) runs on the CPU by default. If your PC has an NVIDIA GPU, you can
                  download the CUDA runtime (~2.6 GB) once and get several times faster voice generation.
                </p>

                {gpuRuntime?.nvidia_driver ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-medium">
                      <span className="text-emerald-400">NVIDIA GPU detected{gpuRuntime.driver_version ? ` — driver ${gpuRuntime.driver_version}` : ''}</span>
                      {gpuRuntime.driver_ok === false && (
                        <span className="text-amber-400">Driver too old for CUDA 12.6</span>
                      )}
                    </div>
                    {gpuRuntime.runtime_installed && (
                      <div className="flex justify-between text-[10px] font-medium">
                        <span className="text-blue-400">GPU runtime v{gpuRuntime.runtime_version}</span>
                        {gpuRuntime.gpu_enabled
                          ? <span className="text-emerald-400">Enabled — restart to activate</span>
                          : <span className="text-stone-500">Disabled</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-stone-500">No NVIDIA GPU detected on this PC.</p>
                )}
              </div>

              <div className="space-y-3">
                {gpuDownload.active ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] text-blue-400 font-medium">
                      <span>Downloading GPU runtime...</span>
                      <span>{gpuDownload.progress}%</span>
                    </div>
                    <div className="w-full bg-black/50 rounded-full h-1 border border-blue-800/20">
                      <div className="h-full bg-blue-500" style={{ width: `${gpuDownload.progress}%` }} />
                    </div>
                    <GlowButton variant="secondary" size="sm" fullWidth type="button" onClick={cancelGpuDownload} icon={<VscTrash />}>
                      Cancel
                    </GlowButton>
                  </div>
                ) : gpuDownload.status === 'failed' ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-rose-400">{GPU_ERROR_TEXT[gpuDownload.error] || gpuDownload.error || 'Download failed.'}</p>
                    <div className="flex gap-2">
                      <GlowButton variant="secondary" size="sm" fullWidth type="button" onClick={downloadGpuRuntime} icon={<VscCloudDownload />}>
                        Retry Download
                      </GlowButton>
                      {gpuRuntime?.has_runtime_files && (
                        <GlowButton variant="secondary" size="sm" type="button"
                          onClick={() => showConfirm('Remove GPU Support', 'Remove the downloaded files (~2.6 GB)? You can download them again anytime.', async () => { await removeGpuRuntime(); closeConfirm(); })}
                          icon={<VscTrash />}>
                          Remove
                        </GlowButton>
                      )}
                    </div>
                  </div>
                ) : gpuRuntime?.nvidia_driver && !gpuRuntime.runtime_installed ? (
                  <GlowButton variant="secondary" size="sm" fullWidth type="button" onClick={downloadGpuRuntime} icon={<VscCloudDownload />}>
                    Download GPU Support (2.6 GB)
                  </GlowButton>
                ) : gpuRuntime?.runtime_installed ? (
                  <div className="flex gap-2">
                    <GlowButton variant="secondary" size="sm" fullWidth type="button"
                      onClick={() => setGpuEnabled(!gpuRuntime.gpu_enabled)}
                      icon={gpuRuntime.gpu_enabled ? <VscCheck /> : <VscPlay />}>
                      {gpuRuntime.gpu_enabled ? 'Disable GPU' : 'Enable GPU (restart required)'}
                    </GlowButton>
                    <GlowButton variant="secondary" size="sm" type="button"
                      onClick={() => showConfirm('Remove GPU Support', 'Remove the downloaded GPU runtime (~2.6 GB)? You can download it again anytime.', async () => { await removeGpuRuntime(); closeConfirm(); })}
                      icon={<VscTrash />}>
                      Remove
                    </GlowButton>
                  </div>
                ) : null}
              </div>
            </GlassCard>
          </div>

          {/* Storage and BGM Card */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscFolderOpened className="text-base text-[var(--color-accent-primary)]" />
                Workspace & Audio Sourcing
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left side: Directory paths */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider">Default Background Music track</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <CustomInput
                          type="text"
                          name="bg_music_path"
                          value={formData.bg_music_path || ''}
                          onChange={handleInputChange}
                          placeholder="Select custom background music..."
                        />
                      </div>
                      <GlowButton variant="secondary" size="sm" type="button" onClick={handleBrowseBGM} icon={<VscFolderOpened />}>
                        Browse
                      </GlowButton>
                      {formData.bg_music_path && (
                        <GlowButton variant="ghost" size="sm" type="button" onClick={async () => {
                          const res = await callApi<{ success: boolean }>('clear_bg_music');
                          if (res?.success) {
                            const cleared = { ...formData, bg_music_path: '' };
                            setFormData(cleared);
                            await saveSettings(cleared);
                            setSaveStatus('success');
                            setTimeout(() => setSaveStatus(''), 2000);
                          }
                        }}>
                          Clear
                        </GlowButton>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side: Vol and Sfx sliders */}
                <div className="space-y-4 bg-black/15 p-4 rounded-md border border-stone-850">
                  <CustomRange
                    label="Background Music Volume"
                    valueDisplay={`${Math.round(parseFloat(formData.bg_music_volume || '0.15') * 100)}%`}
                    min="0"
                    max="0.5"
                    step="0.01"
                    name="bg_music_volume"
                    value={formData.bg_music_volume}
                    onChange={(e) => setFormData((prev: SettingsType) => ({ ...prev, bg_music_volume: e.target.value }))}
                  />

                  <CustomRange
                    label="Sound Effects (SFX) Volume"
                    valueDisplay={`${Math.round(parseFloat(formData.sfx_volume || '0.20') * 100)}%`}
                    min="0"
                    max="0.6"
                    step="0.01"
                    name="sfx_volume"
                    value={formData.sfx_volume}
                    onChange={(e) => setFormData((prev: SettingsType) => ({ ...prev, sfx_volume: e.target.value }))}
                  />
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Pexels API Key */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscMusic className="text-base text-[var(--color-accent-primary)]" />
                Pexels Stock Overlays
              </h2>
              <div className="space-y-4">
                <p className="text-xs text-stone-400">
                  Configure your Pexels authorization key to download matching stock photos and B-roll video assets automatically when visual type layers are selected.
                </p>
                <CustomInput
                  label="Pexels Authorization Key"
                  type="password"
                  name="pexels_api_key"
                  value={formData.pexels_api_key || ''}
                  onChange={handleInputChange}
                  placeholder="Enter Pexels API Key..."
                  icon={<VscKey />}
                />
              </div>
            </GlassCard>
          </div>

          {/* Web Search Integration (LangSearch) */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="flex items-center gap-3 text-sm font-bold text-stone-200 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscGlobe className="text-base text-[var(--color-accent-primary)]" />
                Web Search Integration (LangSearch)
              </h2>
              <div className="space-y-4">
                <p className="text-xs text-stone-400">
                  LangSearch provides real-time web context to the AI scriptwriter for current/trending topics.
                  Enable it below and enter your API key from <strong>langsearch.com/dashboard</strong>.
                </p>
                <div className="flex items-center gap-3 bg-black/20 p-3 rounded-md border border-stone-800/40">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="web_search_enabled"
                      checked={formData.web_search_enabled}
                      onChange={(e) => setFormData(prev => ({ ...prev, web_search_enabled: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-stone-200 font-medium">Enable Web Search for Script Generation</span>
                  </label>
                </div>
                <CustomInput
                  label="LangSearch API Key"
                  type="password"
                  name="web_search_api_key"
                  value={formData.web_search_api_key || ''}
                  onChange={handleInputChange}
                  placeholder="lsk-..."
                  icon={<VscKey />}
                />
                <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-3">
                  <p className="text-[10px] text-blue-300/80">
                    Get your API key at <strong>langsearch.com/dashboard</strong>. The key is stored locally
                    and only used to fetch search results for script generation context.
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Rendering Engine Settings */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscPlay className="text-base text-[var(--color-accent-primary)]" />
                Rendering Engine (Remotion)
              </h2>
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-1.5">Processing Hardware</label>
                  <AnimatedTabs
                    tabs={renderHardwareTabs}
                    activeTab={formData.render_hardware || 'cpu'}
                    onChange={(id) => handleSelectChange('render_hardware', id)}
                    layoutId="settings-render-hardware-tab"
                  />
                  {formData.render_hardware === 'cuda' && (
                    <p className="mt-2 text-xs text-amber-200/80 bg-amber-950/20 border border-amber-800/30 p-2 rounded">
                      Ensure your system supports NVENC. Using CUDA speeds up both frame rendering and video stitching.
                    </p>
                  )}
                </div>

                <p className="text-xs text-stone-400">
                  Configure output settings for your final video compilations. Higher resolutions and frame rates will significantly increase rendering times.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <CustomSelect
                    label="Output Resolution"
                    options={renderResolutionOptions}
                    value={formData.render_resolution || '1080p'}
                    onChange={(val) => handleSelectChange('render_resolution', val)}
                  />
                  <CustomSelect
                    label="Frame Rate (FPS)"
                    options={renderFpsOptions}
                    value={formData.render_fps || '30'}
                    onChange={(val) => handleSelectChange('render_fps', val)}
                  />
                  <CustomSelect
                    label="CPU Concurrency"
                    options={renderConcurrencyOptions}
                    value={formData.render_concurrency || 'logical'}
                    onChange={(val) => handleSelectChange('render_concurrency', val)}
                  />
                  <CustomSelect
                    label="Video Codec"
                    options={renderCodecOptions}
                    value={formData.render_codec || 'h264'}
                    onChange={(val) => handleSelectChange('render_codec', val)}
                  />
                  <CustomSelect
                    label="Video Quality (CRF)"
                    options={renderCrfOptions}
                    value={formData.render_crf || '18'}
                    onChange={(val) => handleSelectChange('render_crf', val)}
                  />
                  <CustomSelect
                    label="Render Timeout"
                    options={renderTimeoutOptions}
                    value={formData.render_timeout || '600000'}
                    onChange={(val) => handleSelectChange('render_timeout', val)}
                  />
                </div>
              </div>
            </GlassCard>
          </div>


          {/* YouTube Integration (yt-dlp) Card */}
          <div>
            <GlassCard className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                  <MdOutlineMovie className="text-base text-[var(--color-accent-primary)]" />
                  YouTube Integration (yt-dlp)
                </h2>
                <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border ${ytdlpInstalled
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                  : 'bg-amber-950/40 text-amber-500 border-amber-800/30'
                  }`}>
                  {ytdlpInstalled ? `Installed v${ytdlpVersion}` : 'Not Found'}
                </span>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-stone-400">
                  yt-dlp is used to fetch YouTube visuals for your video scenes. If YouTube downloads are failing after a YouTube update, updating yt-dlp to the latest version usually fixes it.
                </p>

                {ytdlpInstalled && ytdlpPath && (
                  <div className="bg-black/20 p-3 rounded-md border border-stone-800/40 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Version</span>
                      <span className="text-xs text-stone-200 font-mono">{ytdlpVersion}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Path</span>
                      <span className="text-[10px] text-stone-400 font-mono truncate">{ytdlpPath}</span>
                    </div>
                  </div>
                )}

                {/* Update progress or button */}
                {ytdlpUpdate.active ? (
                  ytdlpUpdate.status === 'checking' ? (
                    <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-4 flex items-center gap-3">
                      <VscLoading className="animate-spin text-blue-400 text-base" />
                      <span className="text-xs text-blue-400 font-medium">Checking for latest version...</span>
                    </div>
                  ) : (
                    <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-4 space-y-3">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-blue-400 font-medium">
                          <span>Downloading latest yt-dlp...</span>
                          <span>{ytdlpUpdate.progress}%</span>
                        </div>
                        <div className="w-full bg-black/50 rounded-full h-1.5 border border-blue-800/20 overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                            initial={{ width: 0 }}
                            animate={{ width: `${ytdlpUpdate.progress}%` }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                ) : (ytdlpUpdate.status === 'up_to_date' || ytdlpUpdate.status === 'completed') ? (
                  <div className="space-y-3">
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-medium">
                        <VscCheck className="text-sm text-emerald-400" />
                        <span>
                          {ytdlpUpdate.status === 'up_to_date'
                            ? `yt-dlp is already up-to-date with version ${ytdlpVersion}.`
                            : `yt-dlp updated successfully! The new version (${ytdlpVersion}) will be used.`}
                        </span>
                      </div>
                    </div>
                    <GlowButton variant="secondary" size="sm" type="button" onClick={handleUpdateYtdlp} icon={<VscCloudDownload />}>
                      Check for Updates Again
                    </GlowButton>
                  </div>
                ) : ytdlpUpdate.status === 'failed' ? (
                  <div className="space-y-3">
                    <div className="text-[10px] text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded p-3 font-mono">
                      Update failed: {ytdlpUpdate.error}
                    </div>
                    <GlowButton variant="secondary" size="sm" type="button" onClick={handleUpdateYtdlp} icon={<VscCloudDownload />}>
                      Retry Update
                    </GlowButton>
                  </div>
                ) : (
                  <GlowButton variant="secondary" size="sm" type="button" onClick={handleUpdateYtdlp} icon={<VscCloudDownload />}>
                    {ytdlpInstalled ? 'Update yt-dlp to Latest' : 'Download yt-dlp'}
                  </GlowButton>
                )}
              </div>
            </GlassCard>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsPage;
