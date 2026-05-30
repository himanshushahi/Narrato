import React, { useEffect, useState } from 'react';
import { useAppStore, Settings as SettingsType } from '../store/appStore';
import { GlassCard } from '../components/ui/GlassCard';
import { GlowButton } from '../components/ui/GlowButton';
import { AIProviderCard } from '../components/features/AIProviderCard';
import { AnimatedTabs, Tab } from '../components/ui/AnimatedTabs';
import { CustomInput } from '../components/ui/CustomInput';
import { CustomSelect, SelectOption } from '../components/ui/CustomSelect';
import { motion } from 'framer-motion';
import {
  VscSettings, VscSave, VscCloudDownload, VscLoading, VscCheck, VscServer, VscFeedback,
  VscKey, VscLink, VscSymbolClass, VscGlobe, VscPlay, VscMusic, VscFolderOpened
} from 'react-icons/vsc';
import { MdOutlineMovie } from 'react-icons/md';

export const SettingsPage: React.FC = () => {
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const fetchSettings = useAppStore((state) => state.fetchSettings);

  const kokoroDownload = useAppStore((state) => state.kokoroDownload);
  const downloadKokoro = useAppStore((state) => state.downloadKokoro);
  const whisperDownload = useAppStore((state) => state.whisperDownload);
  const downloadWhisper = useAppStore((state) => state.downloadWhisper);

  const [formData, setFormData] = useState<SettingsType>({ ...settings });
  const [saveStatus, setSaveStatus] = useState('');
  const [kokoroInstalled, setKokoroInstalled] = useState(false);
  const [whisperInstalled, setWhisperInstalled] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState(false);

  // App language state (computed locally based on voice settings)
  const [appLanguage, setAppLanguage] = useState<'hi' | 'en'>('hi');

  const [previewText, setPreviewText] = useState('नमस्ते! यह चुनी हुई आवाज का पूर्वावलोकन है।');
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Fetch settings on load
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Detect GPU availability on load
  useEffect(() => {
    const detectGPU = async () => {
      if (window.eel) {
        const available = await window.eel.check_nvidia_gpu_available()();
        setGpuAvailable(available);
      }
    };
    detectGPU();
  }, []);

  // Sync settings when loaded
  useEffect(() => {
    setFormData((prev) => {
      const updated = { ...settings };
      if (!gpuAvailable) {
        updated.whisper_device = 'cpu';
      }
      return updated;
    });

    // Detect language from default voices
    const isHindi = (settings.tts_voice?.startsWith('hi-') || settings.kokoro_voice?.startsWith('h'));
    setAppLanguage(isHindi ? 'hi' : 'en');
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
    if (window.eel) {
      const ok = await window.eel.check_kokoro_downloaded()();
      setKokoroInstalled(ok);
    }
  };

  // Check Whisper model downloads
  useEffect(() => {
    checkWhisperAssets();
  }, [formData.whisper_model, whisperDownload.status]);

  const checkWhisperAssets = async () => {
    if (window.eel) {
      const ok = await window.eel.check_whisper_downloaded(formData.whisper_model)();
      setWhisperInstalled(ok);
    }
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
        } else {
          updated.tts_voice = 'en-US-AndrewNeural';
          updated.kokoro_voice = 'af_bella';
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
    if (window.eel) {
      const path = await window.eel.browse_workspace_directory()();
      if (path) {
        setFormData(prev => ({ ...prev, workspace_directory: path }));
      }
    }
  };

  const handleBrowseBGM = async () => {
    if (window.eel) {
      const path = await window.eel.browse_bg_music_file()();
      if (path) {
        setFormData(prev => ({ ...prev, bg_music_path: path }));
      }
    }
  };

  const handlePlayPreview = async () => {
    if (!previewText.trim() || !window.eel) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewAudioUrl('');
    try {
      const voice = formData.tts_engine === 'kokoro' ? formData.kokoro_voice : formData.tts_voice;
      const res = await window.eel.generate_voice_preview(
        previewText,
        formData.tts_engine,
        voice,
        formData.tts_speed,
        formData.tts_pitch,
        appLanguage
      )();

      if (res && res.success && res.audio_path) {
        // RenderFlow Studio serves previews via /api/media
        const audioUrl = window.location.port === "5173"
          ? `http://localhost:8888/api/media?path=${encodeURIComponent(res.audio_path)}`
          : `/api/media?path=${encodeURIComponent(res.audio_path)}`;
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

  const isConnected = !!formData.openai_api_key?.trim();

  const hardwareTabs: Tab[] = [
    { id: 'cpu', label: 'CPU Engine' },
    { id: 'cuda', label: 'GPU CUDA Engine', disabled: !gpuAvailable }
  ];

  const ttsEngineTabs: Tab[] = [
    { id: 'kokoro', label: 'Kokoro (Offline)' },
    { id: 'edge', label: 'Edge-TTS (Online)' }
  ];

  const whisperModelOptions: SelectOption[] = [
    { value: 'tiny', label: 'Tiny (~75MB) - Fastest' },
    { value: 'base', label: 'Base (~140MB) - Balanced' },
    { value: 'small', label: 'Small (~460MB) - Good Accuracy' },
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

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } }
  };

  const itemVariants = {
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
                    {!kokoroInstalled && (
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
                          placeholder="Defaults to %LOCALAPPDATA%/RenderFlowStudio"
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
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider">Background Music Volume</label>
                      <span className="text-[10px] text-stone-300 font-bold">{Math.round(parseFloat(formData.bg_music_volume || '0.15') * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      name="bg_music_volume"
                      value={formData.bg_music_volume}
                      onChange={(e) => setFormData(prev => ({ ...prev, bg_music_volume: e.target.value }))}
                      className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <label className="block text-[10px] text-stone-400 font-bold uppercase tracking-wider">Sound Effects (SFX) Volume</label>
                      <span className="text-[10px] text-stone-300 font-bold">{Math.round(parseFloat(formData.sfx_volume || '0.20') * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.6"
                      step="0.01"
                      name="sfx_volume"
                      value={formData.sfx_volume}
                      onChange={(e) => setFormData(prev => ({ ...prev, sfx_volume: e.target.value }))}
                      className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]"
                    />
                  </div>
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
        </form>
      </motion.div>
    </div>
  );
};

export default SettingsPage;
