import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { VscAccount, VscCheck, VscPlay, VscLoading, VscRefresh, VscUnmute } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomRange } from '../../../components/ui/CustomRange';
import { AnimatedTabs, Tab } from '../../../components/ui/AnimatedTabs';
import { callApi } from '../../../utils/call-api';

interface VoiceTabProps {
  localProjectSettings: any;
  onSettingsUpdate: (settings: any) => void;
}

// ─── Option lists ───────────────────────────────────────────

import { EDGE_VOICE_OPTIONS, KOKORO_VOICE_OPTIONS, SPEED_OPTIONS, PITCH_OPTIONS } from '../../Settings/voiceConstants';

const ENGINE_TABS: Tab[] = [
  { id: 'edge', label: 'Edge-TTS (Online)' },
  { id: 'kokoro', label: 'Kokoro (Offline)' },
];

// ─── Voice Presets ───────────────────────────────────────────

interface VoicePreset {
  id: string;
  label: string;
  desc: string;
  engine: string;
  voice: string;
  kokoroVoice?: string;
  color: string;
  lang: 'hi' | 'en';
}

const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'deep_narration',
    label: 'Deep Narration',
    desc: 'US male — authoritative',
    engine: 'edge',
    voice: 'en-US-AndrewNeural',
    color: 'from-blue-600 to-indigo-700',
    lang: 'en',
  },
  {
    id: 'warm_narration',
    label: 'Warm Narration',
    desc: 'US female — engaging',
    engine: 'edge',
    voice: 'en-US-EmmaNeural',
    color: 'from-rose-600 to-pink-700',
    lang: 'en',
  },
  {
    id: 'bella_soft',
    label: 'Bella (Soft)',
    desc: 'US female — Kokoro',
    engine: 'kokoro',
    voice: 'en-US-AndrewNeural',
    kokoroVoice: 'af_bella',
    color: 'from-violet-600 to-purple-700',
    lang: 'en',
  },
  {
    id: 'sarah_engaging',
    label: 'Sarah',
    desc: 'US female — Kokoro',
    engine: 'kokoro',
    voice: 'en-US-EmmaNeural',
    kokoroVoice: 'af_sarah',
    color: 'from-fuchsia-600 to-pink-700',
    lang: 'en',
  },
  {
    id: 'hindi_professional',
    label: 'Hindi Pro',
    desc: 'Hindi male — Edge',
    engine: 'edge',
    voice: 'hi-IN-MadhurNeural',
    color: 'from-emerald-600 to-teal-700',
    lang: 'hi',
  },
  {
    id: 'swara_warm',
    label: 'Swara (Warm)',
    desc: 'Hindi female — Edge',
    engine: 'edge',
    voice: 'hi-IN-SwaraNeural',
    color: 'from-rose-600 to-pink-700',
    lang: 'hi',
  },
  {
    id: 'alpha_hindi',
    label: 'Alpha (Hindi)',
    desc: 'Hindi female — Kokoro',
    engine: 'kokoro',
    voice: 'hi-IN-SwaraNeural',
    kokoroVoice: 'hf_alpha',
    color: 'from-amber-600 to-orange-700',
    lang: 'hi',
  },
  {
    id: 'omega_hindi',
    label: 'Omega (Hindi)',
    desc: 'Hindi male — Kokoro',
    engine: 'kokoro',
    voice: 'hi-IN-MadhurNeural',
    kokoroVoice: 'hm_omega',
    color: 'from-cyan-600 to-sky-700',
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

  const [previewText, setPreviewText] = useState('');
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

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

  // Clear preview when settings change
  useEffect(() => {
    setPreviewAudioUrl('');
    setPreviewError('');
  }, [engine, projectVal('tts_voice'), projectVal('kokoro_voice'), projectVal('tts_speed'), projectVal('tts_pitch')]);

  // ── Preset handler ──
  const applyPreset = (preset: VoicePreset) => {
    const updated = { ...localProjectSettings };
    updated.tts_engine = preset.engine;
    if (preset.engine === 'kokoro' && preset.kokoroVoice) {
      updated.kokoro_voice = preset.kokoroVoice;
      // Also set tts_voice to a corresponding default for preview
      updated.tts_voice = preset.voice;
    } else {
      updated.tts_voice = preset.voice;
    }
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
        ? (projectVal('kokoro_voice') || globalSettings.kokoro_voice || 'af_bella')
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
        setPreviewAudioUrl(`/api/media?path=${encodeURIComponent(res.audio_path)}&t=${Date.now()}`);
      } else {
        setPreviewError(res?.error || 'Failed to generate voice preview.');
      }
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to connect to backend.');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Preset active detection
  const isPresetActive = (preset: VoicePreset): boolean => {
    const pEngine = projectVal('tts_engine') || globalSettings.tts_engine || 'edge';
    if (pEngine !== preset.engine) return false;
    if (preset.engine === 'kokoro') {
      const pVoice = projectVal('kokoro_voice') || globalSettings.kokoro_voice || '';
      return pVoice === preset.kokoroVoice;
    }
    const pVoice = projectVal('tts_voice') || globalSettings.tts_voice || '';
    return pVoice === preset.voice;
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
              onChange={(v) => updateKey('tts_engine', v)}
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
        ) : (
          <OverrideRow
            label="Voice"
            globalValue={globalSettings.kokoro_voice || 'hf_alpha'}
            projectValue={projectVal('kokoro_voice')}
            onReset={() => resetKey('kokoro_voice')}
          >
            <CustomSelect
              options={filteredKokoroVoices}
              value={projectVal('kokoro_voice') || globalSettings.kokoro_voice || 'af_bella'}
              onChange={(v) => updateKey('kokoro_voice', v)}
            />
          </OverrideRow>
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
            {projectVal('voiceover_volume') && projectVal('voiceover_volume') !== '1.0' && (
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
            max={1}
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
              Global: <span className="font-mono">1.0</span>
            </span>
            {projectVal('voiceover_volume') && projectVal('voiceover_volume') !== '1.0' && (
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
                  {preset.engine === 'kokoro' ? 'Kokoro' : 'Edge'}
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
