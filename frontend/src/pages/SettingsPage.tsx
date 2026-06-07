import React, { useEffect, useState } from 'react';
import { useSettingsStore, Settings as SettingsType } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { AIProviderCard } from '../features/Settings/components/AIProviderCard';
import { AnimatedTabs, Tab } from '../components/ui/AnimatedTabs';
import { CustomInput } from '../components/ui/CustomInput';
import { CustomSelect, SelectOption } from '../components/ui/CustomSelect';
import { CustomRange } from '../components/ui/CustomRange';
import { motion, Variants } from 'framer-motion';
import {
  VscSettings, VscSave, VscCloudDownload, VscLoading, VscCheck, VscServer, VscFeedback,
  VscKey, VscLink, VscSymbolClass, VscGlobe, VscPlay, VscMusic, VscFolderOpened, VscTrash
} from 'react-icons/vsc';
import { MdOutlineMovie } from 'react-icons/md';
import { callEel } from '../utils/eel-bridge';

export const SettingsPage: React.FC = () => {
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const fetchSettings = useSettingsStore((state) => state.fetchSettings);

  const kokoroDownload = useSettingsStore((state) => state.kokoroDownload);
  const downloadKokoro = useSettingsStore((state) => state.downloadKokoro);
  const whisperDownload = useSettingsStore((state) => state.whisperDownload);
  const downloadWhisper = useSettingsStore((state) => state.downloadWhisper);
  const downloadedWhisperModels = useSettingsStore((state) => state.downloadedWhisperModels);
  const fetchDownloadedWhisperModels = useSettingsStore((state) => state.fetchDownloadedWhisperModels);
  const deleteWhisperModel = useSettingsStore((state) => state.deleteWhisperModel);
  const showConfirm = useUIStore((state) => state.showConfirm);
  const closeConfirm = useUIStore((state) => state.closeConfirm);
  const ytdlpUpdate = useSettingsStore((state) => state.ytdlpUpdate);
  const updateYtdlp = useSettingsStore((state) => state.updateYtdlp);

  const [formData, setFormData] = useState<SettingsType>({ ...settings });
  const [saveStatus, setSaveStatus] = useState('');
  const [kokoroInstalled, setKokoroInstalled] = useState(false);
  const [whisperInstalled, setWhisperInstalled] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState(false);

  // yt-dlp version state
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);
  const [ytdlpPath, setYtdlpPath] = useState<string | null>(null);

  // App language state (computed locally based on voice settings)
  const [appLanguage, setAppLanguage] = useState<'hi' | 'en'>('hi');

  const [previewText, setPreviewText] = useState('नमस्ते! यह चुनी हुई आवाज का पूर्वावलोकन है।');
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Fetch settings on load
  useEffect(() => {
    fetchSettings();
    fetchDownloadedWhisperModels();
  }, [fetchSettings, fetchDownloadedWhisperModels]);

  // Detect GPU availability on load
  useEffect(() => {
    const detectGPU = async () => {
      const available = await callEel<boolean>('check_nvidia_gpu_available');
      setGpuAvailable(available);
    };
    detectGPU();
  }, []);

  // Check yt-dlp version on mount and after updates
  useEffect(() => {
    const checkYtdlpVersion = async () => {
      try {
        const info = await callEel<{ installed: boolean; version?: string; path?: string }>('get_ytdlp_version');
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
    const isHindi = (settings.tts_voice?.startsWith('hi-') || settings.kokoro_voice?.startsWith('h'));
    setAppLanguage(isHindi ? 'hi' : 'en');

    setFormData(() => {
      const updated = { ...settings };
      if (!gpuAvailable) {
        updated.whisper_device = 'cpu';
        updated.render_hardware = 'cpu';
      }

      // Smart default: Upgrade legacy 'small' or 'base' to the Hindi model if the app is in Hindi
      if (isHindi && (updated.whisper_model === 'small' || updated.whisper_model === 'base')) {
        updated.whisper_model = 'collabora/faster-whisper-small-hindi';
      } else if (!isHindi && updated.whisper_model === 'collabora/faster-whisper-small-hindi') {
        updated.whisper_model = 'base';
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
  }, [formData.tts_engine, formData.tts_voice, formData.kokoro_voice, formData.tts_speed, formData.tts_pitch]);

  // Check Kokoro model downloads
  useEffect(() => {
    checkKokoroAssets();
  }, [kokoroDownload.status]);

  const checkKokoroAssets = async () => {
    const ok = await callEel<boolean>('check_kokoro_downloaded');
    setKokoroInstalled(ok);
  };

  // Check Whisper model downloads
  useEffect(() => {
    checkWhisperAssets();
  }, [formData.whisper_model, whisperDownload.status]);

  const checkWhisperAssets = async () => {
    const ok = await callEel<boolean>('check_whisper_downloaded', formData.whisper_model);
    setWhisperInstalled(ok);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => {
      const updated = { ...prev, [name]: value };
      if (name === 'app_language') {
        const lang = value as 'hi' | 'en';
        setAppLanguage(lang);
        if (lang === 'hi') {
          updated.tts_voice = 'hi-IN-SwaraNeural';
          updated.kokoro_voice = 'hf_alpha';
          updated.whisper_model = 'collabora/faster-whisper-small-hindi';
        } else {
          updated.tts_voice = 'en-US-AndrewNeural';
          updated.kokoro_voice = 'af_bella';
          updated.whisper_model = 'base';
        }
      }
      if (name === 'llm_provider') {
        if (value === 'nvidia') {
          if (!updated.openai_base_url || updated.openai_base_url === 'https://api.openai.com/v1') {
            updated.openai_base_url = 'https://integrate.api.nvidia.com/v1';
          }
          if (!updated.openai_model || updated.openai_model === 'gpt-4o') {
            updated.openai_model = 'meta/llama-3.1-8b-instruct';
          }
        } else {
          if (updated.openai_base_url === 'https://integrate.api.nvidia.com/v1') {
            updated.openai_base_url = 'https://api.openai.com/v1';
          }
          if (updated.openai_model === 'meta/llama-3.1-8b-instruct') {
            updated.openai_model = 'gpt-4o';
          }
        }
      }
      return updated;
    });
  };

  const handleBrowseWorkspace = async () => {
    const path = await callEel<string>('browse_workspace_directory');
    if (path) {
      setFormData(prev => ({ ...prev, workspace_directory: path }));
    }
  };

  const handleBrowseBGM = async () => {
    const path = await callEel<string>('browse_bg_music_file');
    if (path) {
      setFormData(prev => ({ ...prev, bg_music_path: path }));
    }
  };

  const handlePlayPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewAudioUrl('');
    try {
      const voice = formData.tts_engine === 'kokoro' ? formData.kokoro_voice : formData.tts_voice;
      const res = await callEel<{ success: boolean; audio_path?: string; error?: string }>('generate_voice_preview',
        previewText,
        formData.tts_engine,
        voice,
        formData.tts_speed,
        formData.tts_pitch,
        appLanguage
      );

      if (res?.success && res.audio_path) {
        // Narrato serves previews via /api/media
        const audioUrl = `/api/media?path=${encodeURIComponent(res.audio_path)}`;
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
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      setSaveStatus('failed');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleUpdateYtdlp = () => {
    updateYtdlp();
  };

  const isConnected = !!formData.openai_api_key?.trim();

  const hardwareTabs: Tab[] = [
    { id: 'cpu', label: 'CPU Engine' },
    { id: 'cuda', label: 'GPU CUDA Engine', disabled: !gpuAvailable }
  ];

  const renderHardwareTabs: Tab[] = [
    { id: 'cpu', label: 'CPU (Software)' },
    { id: 'cuda', label: 'GPU (CUDA NVENC)', disabled: !gpuAvailable }
  ];

  const ttsEngineTabs: Tab[] = [
    { id: 'kokoro', label: 'Kokoro (Offline)' },
    { id: 'edge', label: 'Edge-TTS (Online)' }
  ];

  const whisperModelOptions: SelectOption[] = [
    { value: 'tiny', label: 'Tiny (~75MB) - Fastest' },
    { value: 'base', label: 'Base (~140MB) - Balanced' },
    { value: 'small', label: 'Small (~460MB) - Good Accuracy' },
    { value: 'collabora/faster-whisper-small-hindi', label: 'Small Hindi (~460MB) - Best for Hindi' },
    { value: 'medium', label: 'Medium (~1.5GB) - High Accuracy' }
  ];

  const edgeVoiceOptions: SelectOption[] = [
    { value: 'en-US-AndrewNeural', label: 'English US (Andrew - Male)' },
    { value: 'en-US-EmmaNeural', label: 'English US (Emma - Female)' },
    { value: 'hi-IN-SwaraNeural', label: 'Hindi India (Swara - Female)' },
    { value: 'hi-IN-MadhurNeural', label: 'Hindi India (Madhur - Male)' }
  ];

  const edgeRateOptions: SelectOption[] = [
    { value: '0.8', label: '0.8x (Slow)' },
    { value: '1.0', label: '1.0x (Normal)' },
    { value: '1.2', label: '1.2x (Fast)' },
    { value: '1.4', label: '1.4x (Fastest)' }
  ];

  const edgePitchOptions: SelectOption[] = [
    { value: '-5Hz', label: '-5Hz (Deeper)' },
    { value: '0Hz', label: '0Hz (Default)' },
    { value: '+5Hz', label: '+5Hz (Higher)' }
  ];

  const kokoroVoiceOptions: SelectOption[] = [
    { value: 'af_bella', label: 'Bella (US Female - Soft)' },
    { value: 'af_sarah', label: 'Sarah (US Female - Engaging)' },
    { value: 'am_adam', label: 'Adam (US Male - Deep)' },
    { value: 'am_michael', label: 'Michael (US Male - Cinematic)' },
    { value: 'hf_alpha', label: 'Alpha (Hindi Female)' },
    { value: 'hf_beta', label: 'Beta (Hindi Female)' },
    { value: 'hm_omega', label: 'Omega (Hindi Male)' },
    { value: 'hm_psi', label: 'Psi (Hindi Male)' }
  ];

  const filteredEdgeVoiceOptions = edgeVoiceOptions.filter(opt =>
    appLanguage === 'hi' ? opt.value.startsWith('hi-') : !opt.value.startsWith('hi-')
  );

  const filteredKokoroVoiceOptions = kokoroVoiceOptions.filter(opt =>
    appLanguage === 'hi' ? opt.value.startsWith('h') : !opt.value.startsWith('h')
  );

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

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } }
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 relative scrollbar-thin">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-6xl mx-auto space-y-8 relative z-10"
      >
        {/* Header */}
        <motion.div variants={itemVariants} className="flex items-center justify-between border-b border-stone-800/60 pb-6">
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
        </motion.div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* AI Language Model Provider Card */}
          <motion.div variants={itemVariants}>
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
                      name="openai_api_key"
                      value={formData.openai_api_key || ''}
                      onChange={handleInputChange}
                      placeholder={formData.llm_provider === 'nvidia' ? 'nvapi-...' : 'sk-...'}
                      icon={<VscKey />}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <CustomInput
                      label="Base URL"
                      type="text"
                      name="openai_base_url"
                      value={formData.openai_base_url || ''}
                      onChange={handleInputChange}
                      placeholder={formData.llm_provider === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1'}
                      icon={<VscLink />}
                    />
                  </div>
                  <div>
                    <CustomInput
                      label="Model Name"
                      type="text"
                      name="openai_model"
                      value={formData.openai_model || ''}
                      onChange={handleInputChange}
                      placeholder={formData.llm_provider === 'nvidia' ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o'}
                      icon={<VscSymbolClass />}
                    />
                  </div>
                </div>
              </div>
            </AIProviderCard>
          </motion.div>

          {/* Localization & Default Language */}
          <motion.div variants={itemVariants}>
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
          </motion.div>

          {/* Whisper & Speech synthesis Grid */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-8">
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

                  <CustomSelect
                    label="Faster-Whisper Model Size"
                    options={whisperModelOptions}
                    value={formData.whisper_model}
                    onChange={(val) => handleSelectChange('whisper_model', val)}
                  />

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
                  <p className="text-[10px] text-amber-200/70">
                    Faster-Whisper weights are required locally on disk. Downloading models happens automatically, but you can pre-fetch them here.
                  </p>
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
                {formData.tts_engine === 'kokoro' && (
                  <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border ${kokoroInstalled
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                    : kokoroDownload.active
                      ? 'bg-blue-950/40 text-blue-400 border-blue-800/30 animate-pulse'
                      : 'bg-amber-950/40 text-amber-500 border-amber-800/30'
                    }`}>
                    {kokoroInstalled ? 'Installed' : kokoroDownload.active ? 'Downloading' : 'Missing Assets'}
                  </span>
                )}
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
                      options={filteredEdgeVoiceOptions}
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
                    <CustomSelect
                      label="Kokoro Offline Voice"
                      options={filteredKokoroVoiceOptions}
                      value={formData.kokoro_voice}
                      onChange={(val) => handleSelectChange('kokoro_voice', val)}
                    />
                    <CustomSelect
                      label="Rate/Speed"
                      options={edgeRateOptions}
                      value={formData.tts_speed}
                      onChange={(val) => handleSelectChange('tts_speed', val)}
                    />
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
                    <GlowButton
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={handlePlayPreview}
                      disabled={previewLoading || !previewText.trim() || (formData.tts_engine === 'kokoro' && !kokoroInstalled)}
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

                {/* Kokoro Download UI - appears after preview tester */}
                {formData.tts_engine === 'kokoro' && !kokoroInstalled && (
                  <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4 space-y-3">
                    <p className="text-[10px] text-amber-200/70">Kokoro models are required for offline generation. Size is ~120MB.</p>
                    {kokoroDownload.active ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-amber-400 font-medium">
                          <span>Downloading {kokoroDownload.file === 'voices' ? 'voices' : 'model'}...</span>
                          <span>{kokoroDownload.progress}%</span>
                        </div>
                        <div className="w-full bg-black/50 rounded-full h-1 border border-amber-800/20">
                          <div className="h-full bg-amber-500" style={{ width: `${kokoroDownload.progress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <GlowButton variant="secondary" size="sm" fullWidth onClick={downloadKokoro} type="button" icon={<VscCloudDownload />}>
                        Download Kokoro Assets
                      </GlowButton>
                    )}
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>

          {/* Storage and BGM Card */}
          <motion.div variants={itemVariants}>
            <GlassCard className="p-6 space-y-6">
              <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
                <VscFolderOpened className="text-base text-[var(--color-accent-primary)]" />
                Workspace & Audio Sourcing
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left side: Directory paths */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider">Workspace Folder Path</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <CustomInput
                          type="text"
                          name="workspace_directory"
                          value={formData.workspace_directory || ''}
                          onChange={handleInputChange}
                          placeholder="Defaults to %LOCALAPPDATA%/Narrato"
                        />
                      </div>
                      <GlowButton variant="secondary" size="sm" type="button" onClick={handleBrowseWorkspace} icon={<VscFolderOpened />}>
                        Browse
                      </GlowButton>
                    </div>
                  </div>

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
                        <GlowButton variant="ghost" size="sm" type="button" onClick={() => setFormData(prev => ({ ...prev, bg_music_path: '' }))}>
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
                    onChange={(e) => setFormData(prev => ({ ...prev, bg_music_volume: e.target.value }))}
                  />

                  <CustomRange
                    label="Sound Effects (SFX) Volume"
                    valueDisplay={`${Math.round(parseFloat(formData.sfx_volume || '0.20') * 100)}%`}
                    min="0"
                    max="0.6"
                    step="0.01"
                    name="sfx_volume"
                    value={formData.sfx_volume}
                    onChange={(e) => setFormData(prev => ({ ...prev, sfx_volume: e.target.value }))}
                  />
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Pexels API Key */}
          <motion.div variants={itemVariants}>
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
          </motion.div>



          {/* Rendering Engine Settings */}
          <motion.div variants={itemVariants}>
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
                </div>
              </div>
            </GlassCard>
          </motion.div>


          {/* YouTube Integration (yt-dlp) Card */}
          <motion.div variants={itemVariants}>
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
                  yt-dlp is used to fetch YouTube visuals for your documentary scenes. If YouTube downloads are failing after a YouTube update, updating yt-dlp to the latest version usually fixes it.
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
                ) : ytdlpUpdate.status === 'up_to_date' ? (
                  <div className="space-y-3">
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-medium">
                        <VscCheck className="text-sm text-emerald-400" />
                        <span>yt-dlp is already up-to-date with version {ytdlpVersion}.</span>
                      </div>
                    </div>
                    <GlowButton variant="secondary" size="sm" type="button" onClick={handleUpdateYtdlp} icon={<VscCloudDownload />}>
                      Check for Updates Again
                    </GlowButton>
                  </div>
                ) : ytdlpUpdate.status === 'completed' ? (
                  <div className="space-y-3">
                    <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-medium">
                        <VscCheck className="text-sm" />
                        <span>yt-dlp updated successfully! The new version ({ytdlpVersion}) will be used.</span>
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
          </motion.div>
        </form>
      </motion.div>
    </div>
  );
};

export default SettingsPage;
