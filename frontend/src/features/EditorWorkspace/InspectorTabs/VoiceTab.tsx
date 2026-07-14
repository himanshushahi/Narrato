import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { VscAccount, VscCheck, VscPlay, VscLoading, VscRefresh, VscUnmute } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomRange } from '../../../components/ui/CustomRange';
import { AnimatedTabs, Tab } from '../../../components/ui/AnimatedTabs';
import { callApi } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

interface VoiceTabProps {
  localProjectSettings: any;
  onSettingsUpdate: (settings: any) => void;
}

// ─── Option lists ───────────────────────────────────────────

import { EDGE_VOICE_OPTIONS, KOKORO_VOICE_OPTIONS, PIPER_VOICE_OPTIONS, SPEED_OPTIONS, PITCH_OPTIONS } from '../../Settings/voiceConstants';

const ENGINE_TABS: Tab[] = [
  { id: 'edge', label: 'Edge-TTS (Online)' },
  { id: 'kokoro', label: 'Kokoro (Offline)' },
  { id: 'piper', label: 'Piper (Offline)' },
];

// ─── Voice Presets ───────────────────────────────────────────

interface VoicePreset {
  id: string;
  label: string;
  desc: string;
  engine: string;
  voice: string;
  kokoroVoice?: string;
  piperVoice?: string;
  speed?: string;
  pitch?: string;
  volume?: string;
  color: string;
  lang: 'hi' | 'en';
}

const VOICE_PRESETS: VoicePreset[] = [
  // ═══ Edge-TTS (Online) — English ═══
  {
    id: 'deep_narration',
    label: 'Deep Narration',
    desc: 'Andrew — deep authoritative male',
    engine: 'edge',
    voice: 'en-US-AndrewNeural',
    speed: '0.8',
    pitch: '-5Hz',
    volume: '1.0',
    color: 'from-blue-600 to-indigo-700',
    lang: 'en',
  },
  {
    id: 'warm_narration',
    label: 'Warm Narration',
    desc: 'Emma — warm engaging female',
    engine: 'edge',
    voice: 'en-US-EmmaNeural',
    speed: '1.0',
    pitch: '0Hz',
    volume: '1.0',
    color: 'from-rose-600 to-pink-700',
    lang: 'en',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    desc: 'Andrew — calm authoritative',
    engine: 'edge',
    voice: 'en-US-AndrewNeural',
    speed: '0.9',
    pitch: '-5Hz',
    volume: '1.0',
    color: 'from-stone-600 to-zinc-700',
    lang: 'en',
  },
  {
    id: 'storyteller',
    label: 'Storyteller',
    desc: 'Emma — gentle expressive',
    engine: 'edge',
    voice: 'en-US-EmmaNeural',
    speed: '0.85',
    pitch: '0Hz',
    volume: '0.95',
    color: 'from-amber-600 to-yellow-700',
    lang: 'en',
  },
  {
    id: 'energetic',
    label: 'Energetic',
    desc: 'Emma — fast upbeat',
    engine: 'edge',
    voice: 'en-US-EmmaNeural',
    speed: '1.2',
    pitch: '+5Hz',
    volume: '1.0',
    color: 'from-orange-600 to-red-700',
    lang: 'en',
  },
  {
    id: 'whisper',
    label: 'Whisper (Soft)',
    desc: 'Emma — quiet intimate',
    engine: 'edge',
    voice: 'en-US-EmmaNeural',
    speed: '0.7',
    pitch: '-5Hz',
    volume: '0.6',
    color: 'from-slate-600 to-gray-700',
    lang: 'en',
  },
  {
    id: 'authoritative',
    label: 'Authoritative',
    desc: 'Andrew — firm commanding',
    engine: 'edge',
    voice: 'en-US-AndrewNeural',
    speed: '0.9',
    pitch: '0Hz',
    volume: '1.1',
    color: 'from-red-800 to-red-900',
    lang: 'en',
  },

  // ═══ Kokoro (Offline) — English ═══
  {
    id: 'adam_deep',
    label: 'Adam (Deep)',
    desc: 'Adam — deep resonant male',
    engine: 'kokoro',
    voice: 'en-US-AndrewNeural',
    kokoroVoice: 'am_adam',
    speed: '0.8',
    volume: '1.0',
    color: 'from-indigo-600 to-violet-700',
    lang: 'en',
  },
  {
    id: 'michael_cinematic',
    label: 'Michael (Cinematic)',
    desc: 'Michael — rich cinematic male',
    engine: 'kokoro',
    voice: 'en-US-AndrewNeural',
    kokoroVoice: 'am_michael',
    speed: '0.85',
    volume: '1.05',
    color: 'from-purple-600 to-fuchsia-700',
    lang: 'en',
  },
  {
    id: 'bella_soft',
    label: 'Bella (Soft)',
    desc: 'Bella — gentle soft female',
    engine: 'kokoro',
    voice: 'en-US-AndrewNeural',
    kokoroVoice: 'af_bella',
    speed: '0.9',
    volume: '0.85',
    color: 'from-violet-600 to-purple-700',
    lang: 'en',
  },
  {
    id: 'sarah_engaging',
    label: 'Sarah (Engaging)',
    desc: 'Sarah — bright engaging female',
    engine: 'kokoro',
    voice: 'en-US-EmmaNeural',
    kokoroVoice: 'af_sarah',
    speed: '1.0',
    volume: '1.0',
    color: 'from-fuchsia-600 to-pink-700',
    lang: 'en',
  },

  // ═══ Piper (Offline) — English ═══
  {
    id: 'lessac_warm',
    label: 'Lessac (Warm)',
    desc: 'US female — warm clear',
    engine: 'piper',
    voice: 'en-US-EmmaNeural',
    piperVoice: 'en_US-lessac',
    speed: '1.0',
    volume: '1.0',
    color: 'from-teal-600 to-emerald-700',
    lang: 'en',
  },
  {
    id: 'amy_soft',
    label: 'Amy (Soft)',
    desc: 'US female — soft gentle',
    engine: 'piper',
    voice: 'en-US-EmmaNeural',
    piperVoice: 'en_US-amy',
    speed: '0.9',
    volume: '0.9',
    color: 'from-pink-600 to-rose-700',
    lang: 'en',
  },
  {
    id: 'kathleen_warm',
    label: 'Kathleen (Warm)',
    desc: 'US female — warm NPR-style',
    engine: 'piper',
    voice: 'en-US-EmmaNeural',
    piperVoice: 'en_US-kathleen',
    speed: '0.95',
    volume: '0.95',
    color: 'from-rose-600 to-pink-700',
    lang: 'en',
  },
  {
    id: 'ryan_deep',
    label: 'Ryan (Deep)',
    desc: 'US male — deep smooth',
    engine: 'piper',
    voice: 'en-US-AndrewNeural',
    piperVoice: 'en_US-ryan',
    speed: '0.8',
    volume: '1.0',
    color: 'from-sky-600 to-blue-700',
    lang: 'en',
  },
  {
    id: 'joe_authoritative',
    label: 'Joe (Authoritative)',
    desc: 'US male — strong commanding',
    engine: 'piper',
    voice: 'en-US-AndrewNeural',
    piperVoice: 'en_US-joe',
    speed: '0.85',
    volume: '1.1',
    color: 'from-red-700 to-red-900',
    lang: 'en',
  },

  // ═══ Edge-TTS (Online) — Hindi ═══
  {
    id: 'hindi_professional',
    label: 'Hindi Pro',
    desc: 'Madhur — professional male',
    engine: 'edge',
    voice: 'hi-IN-MadhurNeural',
    speed: '0.8',
    pitch: '-5Hz',
    volume: '1.0',
    color: 'from-emerald-600 to-teal-700',
    lang: 'hi',
  },
  {
    id: 'swara_warm',
    label: 'Swara (Warm)',
    desc: 'Swara — warm female',
    engine: 'edge',
    voice: 'hi-IN-SwaraNeural',
    speed: '1.0',
    pitch: '0Hz',
    volume: '1.0',
    color: 'from-rose-600 to-pink-700',
    lang: 'hi',
  },
  {
    id: 'madhur_authoritative',
    label: 'Madhur (Deep)',
    desc: 'Madhur — deep authoritative',
    engine: 'edge',
    voice: 'hi-IN-MadhurNeural',
    speed: '0.9',
    pitch: '-5Hz',
    volume: '1.0',
    color: 'from-stone-600 to-zinc-700',
    lang: 'hi',
  },
  {
    id: 'swara_fast',
    label: 'Swara (Fast)',
    desc: 'Swara — upbeat energetic',
    engine: 'edge',
    voice: 'hi-IN-SwaraNeural',
    speed: '1.2',
    pitch: '+5Hz',
    volume: '1.0',
    color: 'from-orange-600 to-red-700',
    lang: 'hi',
  },

  // ═══ Kokoro (Offline) — Hindi ═══
  {
    id: 'alpha_hindi',
    label: 'Alpha (Hindi)',
    desc: 'Alpha — clear female',
    engine: 'kokoro',
    voice: 'hi-IN-SwaraNeural',
    kokoroVoice: 'hf_alpha',
    speed: '1.0',
    volume: '1.0',
    color: 'from-amber-600 to-orange-700',
    lang: 'hi',
  },
  {
    id: 'beta_hindi',
    label: 'Beta (Hindi)',
    desc: 'Beta — soft female',
    engine: 'kokoro',
    voice: 'hi-IN-SwaraNeural',
    kokoroVoice: 'hf_beta',
    speed: '0.9',
    volume: '0.9',
    color: 'from-pink-600 to-rose-700',
    lang: 'hi',
  },
  {
    id: 'omega_hindi',
    label: 'Omega (Hindi)',
    desc: 'Omega — deep male',
    engine: 'kokoro',
    voice: 'hi-IN-MadhurNeural',
    kokoroVoice: 'hm_omega',
    speed: '0.8',
    volume: '1.0',
    color: 'from-cyan-600 to-sky-700',
    lang: 'hi',
  },
  {
    id: 'psi_hindi',
    label: 'Psi (Hindi)',
    desc: 'Psi — resonant male',
    engine: 'kokoro',
    voice: 'hi-IN-MadhurNeural',
    kokoroVoice: 'hm_psi',
    speed: '0.9',
    volume: '1.0',
    color: 'from-indigo-600 to-violet-700',
    lang: 'hi',
  },

  // ═══ Piper (Offline) — Hindi ═══
  {
    id: 'priyamvada_piper',
    label: 'Priyamvada',
    desc: 'Hindi female — warm natural',
    engine: 'piper',
    voice: 'hi-IN-SwaraNeural',
    piperVoice: 'hi_IN-priyamvada',
    speed: '1.0',
    volume: '1.0',
    color: 'from-pink-600 to-rose-700',
    lang: 'hi',
  },
  {
    id: 'rohan_piper',
    label: 'Rohan',
    desc: 'Hindi male — deep calm',
    engine: 'piper',
    voice: 'hi-IN-MadhurNeural',
    piperVoice: 'hi_IN-rohan',
    speed: '0.8',
    volume: '1.0',
    color: 'from-blue-600 to-indigo-700',
    lang: 'hi',
  },
  {
    id: 'pratham_piper',
    label: 'Pratham',
    desc: 'Hindi male — authoritative',
    engine: 'piper',
    voice: 'hi-IN-MadhurNeural',
    piperVoice: 'hi_IN-pratham',
    speed: '0.85',
    volume: '1.05',
    color: 'from-slate-600 to-gray-700',
    lang: 'hi',
  },
];

// ─── OverrideRow ────────────────────────────────────────────

interface OverrideRowProps {
  label: string;
  globalValue: string;
  projectValue: string;
  onReset?: () => void;
  children: React.ReactNode;
}

const OverrideRow: React.FC<OverrideRowProps> = ({
  label, globalValue, projectValue, onReset, children
}) => {
  const isOverridden = projectValue && projectValue !== globalValue;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          {label}
        </span>
        {isOverridden && onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            title="Reset to global default"
          >
            <VscRefresh className="text-[10px]" />
            Reset
          </button>
        )}
      </div>
      {children}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-zinc-600">
          Global: <span className="font-mono">{globalValue}</span>
        </span>
        {isOverridden && (
          <span className="text-[9px] text-blue-500 font-bold uppercase tracking-wider">
            Override
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Helpers ────────────────────────────────────────────────

const getProjectVal = (settings: any, key: string): string => settings?.[key] || '';

// ─── Component ──────────────────────────────────────────────

export const VoiceTab: React.FC<VoiceTabProps> = ({
  localProjectSettings, onSettingsUpdate
}) => {
  const globalSettings = useSettingsStore((s) => s.settings);
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const projectLanguage = selectedProject?.language || 'hi';

  const [previewText, setPreviewText] = useState(
    projectLanguage === 'hi' ? 'यह एक परीक्षण आवाज है। नमस्ते, आप कैसे हैं?' : 'This is a test voice. Hello, how are you?'
  );
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [piperModelReady, setPiperModelReady] = useState(true);
  const [piperDownloading, setPiperDownloading] = useState(false);
  const [availablePiperVoices, setAvailablePiperVoices] = useState<string[] | null>(null);

  // ── Merge helpers ──
  const updateKey = (key: string, value: string) => {
    onSettingsUpdate({ ...localProjectSettings, [key]: value });
  };

  const resetKey = (key: string) => {
    const updated = { ...localProjectSettings };
    delete updated[key];
    onSettingsUpdate(updated);
  };

  const projectVal = (key: string): string => getProjectVal(localProjectSettings, key);

  // Current effective engine
  const engine = projectVal('tts_engine') || globalSettings.tts_engine || 'edge';

  // Filter voice options by project language
  const isHindiLang = projectLanguage === 'hi';
  const filteredEdgeVoices = EDGE_VOICE_OPTIONS.filter(opt =>
    isHindiLang ? opt.value.startsWith('hi-') : !opt.value.startsWith('hi-')
  );
  const filteredKokoroVoices = KOKORO_VOICE_OPTIONS.filter(opt =>
    isHindiLang ? opt.value.startsWith('h') : !opt.value.startsWith('h')
  );
  const filteredPiperVoices = PIPER_VOICE_OPTIONS.filter(opt => {
    if (isHindiLang ? !opt.value.startsWith('hi') : !opt.value.startsWith('en')) return false;
    if (availablePiperVoices && !availablePiperVoices.includes(opt.value)) return false;
    return true;
  });

  // Clear preview when settings change
  useEffect(() => {
    setPreviewAudioUrl('');
    setPreviewError('');
  }, [engine, projectVal('tts_voice'), projectVal('kokoro_voice'), projectVal('piper_voice'), projectVal('tts_speed'), projectVal('tts_pitch')]);

  // ── Fetch available Piper voices from HuggingFace ──
  useEffect(() => {
    callApi<string[]>('list_piper_voices').then(list => {
      if (list && list.length > 0) setAvailablePiperVoices(list);
    }).catch(() => {});
  }, []);

  // ── Piper model check for the currently selected voice ──
  useEffect(() => {
    const checkPiper = async () => {
      const piperVoice = projectVal('piper_voice') || globalSettings.piper_voice || '';
      if (engine === 'piper' && piperVoice) {
        const ok = await callApi<boolean>('check_piper_model', piperVoice);
        setPiperModelReady(!!ok);
      } else {
        setPiperModelReady(true);
      }
    };
    checkPiper();
  }, [engine, projectVal('piper_voice'), globalSettings.piper_voice]);

  const handleDownloadPiperModel = async () => {
    const piperVoice = projectVal('piper_voice') || globalSettings.piper_voice || '';
    if (!piperVoice) return;
    setPiperDownloading(true);
    try {
      const res = await callApi<{ status: string; message?: string }>('download_piper_model', piperVoice);
      if (res?.status === 'success') {
        setPiperModelReady(true);
      }
    } finally {
      setPiperDownloading(false);
    }
  };

  // ── Preset handler ──
  const applyPreset = (preset: VoicePreset) => {
    const updated = { ...localProjectSettings };
    updated.tts_engine = preset.engine;
    if (preset.engine === 'kokoro' && preset.kokoroVoice) {
      updated.kokoro_voice = preset.kokoroVoice;
      updated.tts_voice = preset.voice;
    } else if (preset.engine === 'piper' && preset.piperVoice) {
      updated.piper_voice = preset.piperVoice;
      updated.tts_voice = preset.voice;
    } else {
      updated.tts_voice = preset.voice;
    }
    if (preset.speed) updated.tts_speed = preset.speed;
    if (preset.pitch) updated.tts_pitch = preset.pitch;
    if (preset.volume) updated.voiceover_volume = preset.volume;
    onSettingsUpdate(updated);
  };

  // ── Preview handler ──
  const handlePlayPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewAudioUrl('');

    try {
      const effectiveEngine = projectVal('tts_engine') || globalSettings.tts_engine || 'edge';
      const effectiveVoice = effectiveEngine === 'kokoro'
        ? (projectVal('kokoro_voice') || globalSettings.kokoro_voice || (isHindiLang ? 'hf_alpha' : 'af_bella'))
        : effectiveEngine === 'piper'
        ? (projectVal('piper_voice') || globalSettings.piper_voice || 'hi_IN-rohan')
        : (projectVal('tts_voice') || globalSettings.tts_voice || 'hi-IN-SwaraNeural');
      const effectiveSpeed = projectVal('tts_speed') || globalSettings.tts_speed || '1.0';
      const effectivePitch = projectVal('tts_pitch') || globalSettings.tts_pitch || '0Hz';
      const effectiveLang = selectedProject?.language || 'hi';

      const res = await callApi<{ success: boolean; audio_path?: string; error?: string }>(
        'generate_voice_preview',
        previewText,
        effectiveEngine,
        effectiveVoice,
        effectiveSpeed,
        effectivePitch,
        effectiveLang
      );

      if (res?.success && res.audio_path) {
        const audioUrl = getMediaUrlSync(res.audio_path);
        setPreviewAudioUrl(`${audioUrl}&t=${Date.now()}`);
      } else {
        setPreviewError(res?.error || 'Failed to generate voice preview.');
      }
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to connect to backend.');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Preset active detection — match ALL preset fields so multiple presets
  // sharing the same voice don't all highlight at once
  const isPresetActive = (preset: VoicePreset): boolean => {
    const pEngine = projectVal('tts_engine') || globalSettings.tts_engine || 'edge';
    if (pEngine !== preset.engine) return false;
    if (preset.engine === 'kokoro') {
      const pVoice = projectVal('kokoro_voice') || globalSettings.kokoro_voice || '';
      if (pVoice !== preset.kokoroVoice) return false;
    } else if (preset.engine === 'piper') {
      const pVoice = projectVal('piper_voice') || globalSettings.piper_voice || '';
      if (pVoice !== preset.piperVoice) return false;
    } else {
      const pVoice = projectVal('tts_voice') || globalSettings.tts_voice || '';
      if (pVoice !== preset.voice) return false;
    }
    const pSpeed = projectVal('tts_speed') || globalSettings.tts_speed || '1.0';
    if (preset.speed && pSpeed !== preset.speed) return false;
    const pPitch = projectVal('tts_pitch') || globalSettings.tts_pitch || '0Hz';
    if (preset.pitch && pPitch !== preset.pitch) return false;
    const pVolume = projectVal('voiceover_volume') || '1.0';
    if (preset.volume && pVolume !== preset.volume) return false;
    return true;
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">

      {/* ════ Voice Synthesis ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <VscAccount className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Voice Synthesis
          </h3>
          <span className="text-[8px] text-zinc-600 ml-auto">Overrides global</span>
        </div>

        {/* Engine Tabs */}
        <div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Engine
            </span>
            <AnimatedTabs
              tabs={ENGINE_TABS}
              activeTab={engine}
              onChange={(v) => {
                const updated = { ...localProjectSettings, tts_engine: v };
                if (v === 'kokoro' && !getProjectVal(updated, 'kokoro_voice')) {
                  updated.kokoro_voice = globalSettings.kokoro_voice || (isHindiLang ? 'hf_alpha' : 'af_bella');
                } else if (v === 'piper' && !getProjectVal(updated, 'piper_voice')) {
                  updated.piper_voice = globalSettings.piper_voice || (isHindiLang ? 'hi_IN-rohan' : 'en_US-lessac');
                } else if (v === 'edge' && !getProjectVal(updated, 'tts_voice')) {
                  updated.tts_voice = globalSettings.tts_voice || (isHindiLang ? 'hi-IN-SwaraNeural' : 'en-US-AndrewNeural');
                }
                onSettingsUpdate(updated);
              }}
              layoutId="voice-engine-tab"
            />
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-zinc-600">
                Global: <span className="font-mono">{globalSettings.tts_engine || 'edge'}</span>
              </span>
              {projectVal('tts_engine') && projectVal('tts_engine') !== (globalSettings.tts_engine || 'edge') && (
                <span className="text-[9px] text-blue-500 font-bold uppercase tracking-wider">Override</span>
              )}
            </div>
          </div>
        </div>

        {/* Voice Select */}
        {engine === 'edge' ? (
          <OverrideRow
            label="Voice"
            globalValue={globalSettings.tts_voice || 'hi-IN-SwaraNeural'}
            projectValue={projectVal('tts_voice')}
            onReset={() => resetKey('tts_voice')}
          >
            <CustomSelect
              options={filteredEdgeVoices}
              value={projectVal('tts_voice') || globalSettings.tts_voice || (isHindiLang ? 'hi-IN-SwaraNeural' : 'en-US-AndrewNeural')}
              onChange={(v) => updateKey('tts_voice', v)}
            />
          </OverrideRow>
        ) : engine === 'kokoro' ? (
          <OverrideRow
            label="Voice"
            globalValue={globalSettings.kokoro_voice || 'hf_alpha'}
            projectValue={projectVal('kokoro_voice')}
            onReset={() => resetKey('kokoro_voice')}
          >
            <CustomSelect
              options={filteredKokoroVoices}
              value={projectVal('kokoro_voice') || globalSettings.kokoro_voice || (isHindiLang ? 'hf_alpha' : 'af_bella')}
              onChange={(v) => updateKey('kokoro_voice', v)}
            />
          </OverrideRow>
        ) : (
          <>
            <OverrideRow
              label="Voice"
              globalValue={globalSettings.piper_voice || 'hi_IN-rohan'}
              projectValue={projectVal('piper_voice')}
              onReset={() => resetKey('piper_voice')}
            >
              <CustomSelect
                options={filteredPiperVoices}
                value={projectVal('piper_voice') || globalSettings.piper_voice || (isHindiLang ? 'hi_IN-rohan' : 'en_US-lessac')}
                onChange={(v) => updateKey('piper_voice', v)}
              />
            </OverrideRow>
            {!piperModelReady && (
              <div className="flex items-center gap-2 p-2 bg-amber-950/20 border border-amber-800/30 rounded-lg">
                <span className="text-[9px] text-amber-400 flex-1">
                  Model not downloaded. Download it now or select a different voice.
                </span>
                <button
                  onClick={handleDownloadPiperModel}
                  disabled={piperDownloading}
                  className="flex items-center gap-1 px-2 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30 rounded text-[9px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {piperDownloading ? (
                    <><VscLoading className="animate-spin text-[10px]" /> Downloading</>
                  ) : (
                    'Download'
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* Speed */}
        <OverrideRow
          label="Speed"
          globalValue={globalSettings.tts_speed || '1.0'}
          projectValue={projectVal('tts_speed')}
          onReset={() => resetKey('tts_speed')}
        >
          <CustomSelect
            options={SPEED_OPTIONS}
            value={projectVal('tts_speed') || globalSettings.tts_speed || '1.0'}
            onChange={(v) => updateKey('tts_speed', v)}
          />
        </OverrideRow>

        {/* Pitch (Edge only) */}
        {engine === 'edge' && (
          <OverrideRow
            label="Pitch"
            globalValue={globalSettings.tts_pitch || '0Hz'}
            projectValue={projectVal('tts_pitch')}
            onReset={() => resetKey('tts_pitch')}
          >
            <CustomSelect
              options={PITCH_OPTIONS}
              value={projectVal('tts_pitch') || globalSettings.tts_pitch || '0Hz'}
              onChange={(v) => updateKey('tts_pitch', v)}
            />
          </OverrideRow>
        )}

        {/* Voiceover Volume */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Voiceover Volume
            </span>
            {projectVal('voiceover_volume') && projectVal('voiceover_volume') !== (globalSettings.voiceover_volume || '1.0') && (
              <button
                onClick={() => resetKey('voiceover_volume')}
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                title="Reset to global default"
              >
                <VscRefresh className="text-[10px]" />
                Reset
              </button>
            )}
          </div>
          <CustomRange
            label=""
            min={0}
            max={1.5}
            step={0.01}
            name="voiceover_volume"
            value={projectVal('voiceover_volume') || '1.0'}
            onChange={(e) => updateKey('voiceover_volume', e.target.value)}
            valueDisplay={
              <div className="flex items-center gap-1">
                <VscUnmute className="text-[10px] text-zinc-500" />
                <span>{Math.round(parseFloat(projectVal('voiceover_volume') || '1.0') * 100)}%</span>
              </div>
            }
          />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-zinc-600">
              Global: <span className="font-mono">{globalSettings.voiceover_volume || '1.0'}</span>
            </span>
            {projectVal('voiceover_volume') && projectVal('voiceover_volume') !== (globalSettings.voiceover_volume || '1.0') && (
              <span className="text-[9px] text-blue-500 font-bold uppercase tracking-wider">Override</span>
            )}
          </div>
        </div>
      </div>

      {/* ════ Voice Presets ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <VscAccount className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Voice Presets
            <span className="ml-1.5 text-[8px] font-normal text-zinc-500 normal-case">
              · {projectLanguage === 'hi' ? 'हिन्दी' : 'English'}
            </span>
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {VOICE_PRESETS.filter(p => p.lang === projectLanguage).map((preset) => {
            const active = isPresetActive(preset);
            return (
              <motion.button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`relative flex flex-col items-start gap-0.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-600/10 border-blue-500/50'
                    : 'bg-zinc-800/40 border-zinc-700/50 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-1.5 w-full">
                  <span className={`text-[10px] font-bold ${active ? 'text-blue-300' : 'text-zinc-200'}`}>
                    {preset.label}
                  </span>
                  {active && (
                    <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0 ml-auto">
                      <VscCheck className="text-[7px] text-white" />
                    </div>
                  )}
                </div>
                <p className="text-[8px] text-zinc-500">{preset.desc}</p>
                <span className="text-[7px] uppercase tracking-wider text-zinc-600 font-bold mt-0.5">
                  {preset.engine === 'kokoro' ? 'Kokoro' : preset.engine === 'piper' ? 'Piper' : 'Edge'}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ════ Voice Preview ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <VscPlay className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Preview
          </h3>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder={projectLanguage === 'hi' ? 'पूर्वावलोकन के लिए टेक्स्ट दर्ज करें...' : 'Enter text to preview...'}
            className="flex-1 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
          <button
            onClick={handlePlayPreview}
            disabled={previewLoading || !previewText.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 hover:border-blue-600/40 rounded-lg text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
          >
            {previewLoading ? (
              <VscLoading className="animate-spin text-xs" />
            ) : (
              <VscPlay className="text-xs" />
            )}
            Preview
          </button>
        </div>

        {previewError && (
          <div className="text-[9px] text-red-400 bg-red-950/20 border border-red-900/30 rounded p-2 font-mono">
            {previewError}
          </div>
        )}

        {previewAudioUrl && !previewLoading && (
          <div className="bg-zinc-800/40 p-1.5 border border-zinc-700/50 rounded-lg">
            <audio
              src={previewAudioUrl}
              controls
              autoPlay
              className="w-full h-8 focus:outline-none opacity-85"
              ref={(el) => {
                if (el) el.volume = parseFloat(projectVal('voiceover_volume') || '1.0');
              }}
            />
          </div>
        )}
      </div>

      <p className="text-[9px] text-zinc-600 text-center">
        Change global voice defaults in Settings
      </p>
    </div>
  );
};
