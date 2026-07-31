import React, { useEffect, useRef, useState } from 'react';
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

import { EDGE_VOICE_OPTIONS, SPEED_OPTIONS, PITCH_OPTIONS } from '../../Settings/voiceConstants';

const ENGINE_TABS: Tab[] = [
  { id: 'edge', label: 'Edge-TTS (Online)' },
  { id: 'xtts', label: 'XTTS v2 (Voice Clone)' },
];

// ─── Voice Presets ───────────────────────────────────────────

interface VoicePreset {
  id: string;
  label: string;
  desc: string;
  engine: string;
  voice: string;
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
    volume: '1.0',
    color: 'from-red-800 to-red-900',
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

// Edge voices look like "hi-IN-SwaraNeural" / "en-US-AndrewNeural". Anything
// else (e.g. an XTTS reference file path leaked into tts_voice by older
// versions) is not a usable Edge voice.
const isEdgeVoiceName = (v: string): boolean => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v || '');

// ─── Component ──────────────────────────────────────────────

export const VoiceTab: React.FC<VoiceTabProps> = ({
  localProjectSettings, onSettingsUpdate
}) => {
  const globalSettings = useSettingsStore((s) => s.settings);
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const projectLanguage = selectedProject?.language || 'hi';

  // Use a ref to track latest localProjectSettings without triggering re-renders
  const localProjectSettingsRef = useRef(localProjectSettings);
  localProjectSettingsRef.current = localProjectSettings;
  const prevLangRef = useRef<string | undefined>(undefined);

  const [previewText, setPreviewText] = useState(
    projectLanguage === 'hi' ? 'यह एक परीक्षण आवाज है। नमस्ते, आप कैसे हैं?' : 'This is a test voice. Hello, how are you?'
  );

  useEffect(() => {
    setPreviewText(
      projectLanguage === 'hi' ? 'यह एक परीक्षण आवाज है। नमस्ते, आप कैसे हैं?' : 'This is a test voice. Hello, how are you?'
    );
  }, [projectLanguage]);
  const [previewAudioUrl, setPreviewAudioUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Generate XTTS presets dynamically
  const xttsPresets: VoicePreset[] = (globalSettings.xtts_profiles || []).map(p => ({
    id: p.id,
    label: p.name,
    desc: `Voice clone — ${p.language === 'hi' ? 'Hindi' : p.language === 'en' ? 'English' : p.language}`,
    engine: 'xtts',
    voice: p.id,
    speed: '1.0',
    volume: '1.0',
    color: 'from-violet-600 to-purple-700',
    lang: (p.language === 'hi' || p.language === 'en') ? p.language : 'en' as 'hi' | 'en'
  }));
  
  const allPresets = [...VOICE_PRESETS, ...xttsPresets];

// ── Auto-switch voice based on project language ──
  useEffect(() => {
    if (!selectedProject) return;

    // Run only when language explicitly changes
    if (prevLangRef.current !== undefined && prevLangRef.current === projectLanguage) {
      return;
    }
    prevLangRef.current = projectLanguage;

    // Check if the user has explicitly set ANY voice setting in the project
    let projectSettingsObj: any = {};
    try {
        if (selectedProject.project_settings) {
            projectSettingsObj = typeof selectedProject.project_settings === 'string'
                ? JSON.parse(selectedProject.project_settings)
                : selectedProject.project_settings;
        }
    } catch(e) {}

    // A tts_voice that isn't a valid Edge voice name (e.g. an XTTS reference
    // path leaked into the column by older versions) doesn't count as an
    // explicit voice choice, so the auto-fix can still correct it.
    const hasProjectSpecificVoice = !!selectedProject.tts_engine ||
                                     (!!selectedProject.tts_voice && isEdgeVoiceName(selectedProject.tts_voice)) ||
                                     !!projectSettingsObj.tts_engine ||
                                     (!!projectSettingsObj.tts_voice && isEdgeVoiceName(projectSettingsObj.tts_voice));

    if (hasProjectSpecificVoice) return;

    const pEngine = selectedProject.tts_engine || globalSettings.tts_engine || 'edge';

    let currentVoice = '';
    if (pEngine === 'edge') {
      currentVoice = globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural');
    } else if (pEngine === 'xtts') {
      // XTTS uses reference voice, no voice mismatch check needed
      return;
    }

    const isMismatch = (voice: string) => {
       if (!voice) return false;
       if (projectLanguage === 'hi') {
          if (!voice.startsWith('hi-')) return true;
       } else {
          if (voice.startsWith('hi-')) return true;
       }
       return false;
    };

    if (isMismatch(currentVoice)) {
        const updated = { ...localProjectSettingsRef.current };
        if (projectLanguage === 'hi') {
           updated.tts_voice = 'hi-IN-MadhurNeural';
        } else {
           updated.tts_voice = 'en-US-AndrewNeural';
        }
        updated.tts_engine = pEngine;
        onSettingsUpdate(updated);
    }
  }, [projectLanguage, selectedProject, globalSettings, onSettingsUpdate]);

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

  // Clear preview when settings change
  useEffect(() => {
    setPreviewAudioUrl('');
    setPreviewError('');
  }, [engine, projectVal('tts_voice'), projectVal('tts_speed'), projectVal('tts_pitch')]);


  // ── Preset handler ──
  const applyPreset = (preset: VoicePreset) => {
    const updated = { ...localProjectSettings };
    updated.tts_engine = preset.engine;
    if (preset.engine === 'edge' || preset.engine === 'xtts') {
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
      const effectiveVoice = effectiveEngine === 'xtts'
        ? (globalSettings.xtts_profiles?.find(p => p.id === (projectVal('tts_voice') || globalSettings.tts_voice))?.reference_voice || globalSettings.xtts_reference_voice || '')
        : (projectVal('tts_voice') || globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural'));
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
    if (preset.engine === 'edge' || preset.engine === 'xtts') {
      const pVoice = projectVal('tts_voice') || globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural');
      if (pVoice !== preset.voice) return false;
    }
    const pSpeed = projectVal('tts_speed') || globalSettings.tts_speed || '1.0';
    if (preset.speed && pSpeed !== preset.speed) return false;
    const pPitch = projectVal('tts_pitch') || globalSettings.tts_pitch || '0Hz';
    if (preset.pitch && pPitch !== preset.pitch) return false;
    const pVolume = projectVal('voiceover_volume') || globalSettings.voiceover_volume || '1.0';
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
                // When switching back to Edge, always set a usable Edge voice —
                // including when tts_voice holds a stale XTTS reference path.
                if (v === 'edge' && !isEdgeVoiceName(getProjectVal(updated, 'tts_voice'))) {
                  updated.tts_voice = globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural');
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
            globalValue={globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural')}
            projectValue={projectVal('tts_voice')}
            onReset={() => resetKey('tts_voice')}
          >
            <CustomSelect
              options={EDGE_VOICE_OPTIONS.filter(opt =>
                projectLanguage === 'hi' ? opt.value.startsWith('hi-') : !opt.value.startsWith('hi-')
              )}
              value={projectVal('tts_voice') || globalSettings.tts_voice || (projectLanguage === 'hi' ? 'hi-IN-MadhurNeural' : 'en-US-AndrewNeural')}
              onChange={(v) => updateKey('tts_voice', v)}
            />
          </OverrideRow>
        ) : (
          <OverrideRow
            label="XTTS Profile"
            globalValue={globalSettings.tts_voice || ''}
            projectValue={projectVal('tts_voice')}
            onReset={() => resetKey('tts_voice')}
          >
            <CustomSelect
              options={[
                { value: '', label: 'Default Reference Voice' },
                ...(globalSettings.xtts_profiles || [])
                  .filter(p => p.language === projectLanguage || projectLanguage === 'all' || !projectLanguage)
                  .map(p => ({ value: p.id, label: p.name }))
              ]}
              value={projectVal('tts_voice') || globalSettings.tts_voice || ''}
              onChange={(v) => updateKey('tts_voice', v)}
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
            max={1.0}
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
          {allPresets.filter(p => p.lang === projectLanguage).map((preset) => {
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
                  {preset.engine === 'xtts' ? 'XTTS v2' : 'Edge'}
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
                if (el) el.volume = Math.max(0, Math.min(1, parseFloat(projectVal('voiceover_volume') || '1.0')));
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
