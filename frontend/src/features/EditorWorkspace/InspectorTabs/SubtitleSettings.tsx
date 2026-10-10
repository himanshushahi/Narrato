import { useState } from 'react';
import { motion } from 'framer-motion';
import { CustomSelect } from '../../../components/ui/CustomSelect';

import { SubtitleStyleControls } from '../../ProjectEditor/components/SubtitleStyleControls';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { VscLoading, VscTrash, VscStarFull, VscSave, VscCheck } from 'react-icons/vsc';
import { useProjectStore } from '../../../store/useProjectStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import {
  applyPresetOverDefaults,
  extractSubtitleKeys,
  isPresetActive,
  portraitSafePreset,
  withSubtitleDefaults,
  VIRAL_PRESETS,
  type ViralPreset,
} from '../../../utils/subtitleSchema';

interface ClassicPreset {
  id: string;
  label: string;
  desc: string;
  settings: { [k: string]: any };
}

const CLASSIC_PRESETS: ClassicPreset[] = [
  {
    id: 'classic_amber',
    label: 'Classic Amber',
    desc: 'Warm amber highlight on dark text',
    settings: {
      fontFamily: 'Montserrat', fontSize: 54, wordSpacing: 18, activeColor: '#fbbf24',
      pastColor: '#d6d3d1', textTransform: 'uppercase', bottomOffset: 120,
      highlightBgColor: '#fbbf24', wordsPerScreen: 10, backgroundStyle: 'highlight',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'modern_cyan',
    label: 'Modern Cyan',
    desc: 'Clean cyan highlight, lowercase',
    settings: {
      fontFamily: 'Inter', fontSize: 48, wordSpacing: 12, activeColor: '#22d3ee',
      pastColor: '#a1a1aa', textTransform: 'none', bottomOffset: 100,
      highlightBgColor: '#22d3ee', wordsPerScreen: 8, backgroundStyle: 'highlight',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'minimal_white',
    label: 'Minimal White',
    desc: 'White text, no background bar',
    settings: {
      fontFamily: 'Roboto', fontSize: 60, wordSpacing: 10, activeColor: '#ffffff',
      pastColor: '#71717a', textTransform: 'uppercase', bottomOffset: 150,
      highlightBgColor: '#ffffff', wordsPerScreen: 6, backgroundStyle: 'none',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'elegant_gold',
    label: 'Elegant Gold',
    desc: 'Gold highlight, wide spacing',
    settings: {
      fontFamily: 'Lato', fontSize: 52, wordSpacing: 22, activeColor: '#f5b041',
      pastColor: '#a8a8a8', textTransform: 'capitalize', bottomOffset: 130,
      highlightBgColor: '#f5b041', wordsPerScreen: 10, backgroundStyle: 'highlight',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'hindi_reader',
    label: 'Hindi Reader',
    desc: 'Large text optimized for Devanagari',
    settings: {
      fontFamily: 'Hind', fontSize: 64, wordSpacing: 16, activeColor: '#facc15',
      pastColor: '#d4d4d8', textTransform: 'none', bottomOffset: 80,
      highlightBgColor: '#facc15', wordsPerScreen: 7, backgroundStyle: 'highlight',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
  {
    id: 'bold_dark',
    label: 'Bold Dark',
    desc: 'Large bold, dramatic uppercase',
    settings: {
      fontFamily: 'Anton', fontSize: 72, wordSpacing: 30, activeColor: '#a78bfa',
      pastColor: '#52525b', textTransform: 'uppercase', bottomOffset: 140,
      highlightBgColor: '#a78bfa', wordsPerScreen: 5, backgroundStyle: 'none',
      fullBgColor: 'rgba(0,0,0,0.6)',
    },
  },
];

/** Static live preview — same tokens as the renderer, one frozen moment
 *  (middle word active) so tweaks can be judged without scrubbing video.
 *  Honors layout mode, word spacing, pill padding and glow; animation is
 *  intentionally frozen (preview the motion in the player). */
const PREVIEW_WORDS = ['Viral', 'captions', 'keep', 'viewers', 'watching'];

const SubtitleLivePreview = ({ settings }: { settings: any }) => {
  const s = withSubtitleDefaults(settings);
  const pillOn = s.pillStyle === 'active';
  const activeColor = s.activeColor;
  const pillBg = s.pillBgColor || s.highlightBgColor || activeColor;
  const pillText = s.pillTextColor || activeColor;
  const glow = s.glowRadius > 0
    ? `0 0 ${Math.max(2, Math.round(s.glowRadius / 3))}px ${s.glowColor || activeColor}, 0px 2px 6px rgba(0,0,0,0.9)`
    : '0px 2px 6px rgba(0,0,0,0.9)';

  // Mirror the renderer's layouts: karaoke shows the window subset,
  // stack splits into two lines, sentence shows everything.
  let rows: string[][] = [PREVIEW_WORDS];
  let activeIdx = 2;
  if (s.layoutMode === 'karaoke') {
    const win = Math.max(3, s.karaokeWindow || 5);
    const half = Math.floor(win / 2);
    const start = PREVIEW_WORDS.length <= win ? 0 : Math.max(0, Math.min(activeIdx - half, PREVIEW_WORDS.length - win));
    rows = [PREVIEW_WORDS.slice(start, start + win)];
    activeIdx = activeIdx - start;
  } else if (s.layoutMode === 'stack') {
    rows = [PREVIEW_WORDS.slice(0, 3), PREVIEW_WORDS.slice(3)];
  }
  const gap = Math.min(14, Math.round(s.wordSpacing / 2));

  const renderWord = (w: string, globalIdx: number) => {
    const isActive = globalIdx === activeIdx;
    const isPast = globalIdx < activeIdx;
    const color = isActive ? (pillOn ? pillText : activeColor) : isPast ? s.pastColor : s.futureColor;
    return (
      <span key={`${globalIdx}-${w}`} style={{ position: 'relative', display: 'inline-block', marginRight: gap }}>
        {isPast && s.backgroundStyle === 'highlight' && (
          <span style={{
            position: 'absolute', left: -2, right: -2, bottom: 2, height: '40%',
            backgroundColor: s.highlightBgColor, opacity: 0.4, borderRadius: 2,
          }} />
        )}
        <span style={{
          fontFamily: `"${s.fontFamily}", sans-serif`,
          fontWeight: s.fontWeight,
          fontSize: Math.min(28, s.fontSize / 2),
          color,
          textTransform: s.textTransform,
          WebkitTextStroke: s.strokeWidth > 0 ? `${Math.max(1, Math.round(s.strokeWidth / 2))}px ${s.strokeColor}` : undefined,
          textShadow: isActive ? glow : '0px 2px 6px rgba(0,0,0,0.9)',
          display: 'inline-block',
          position: 'relative',
          backgroundColor: isActive && pillOn ? pillBg : 'transparent',
          padding: isActive && pillOn ? s.pillPadding : '0',
          borderRadius: isActive && pillOn ? s.pillRadius : 0,
        }}>
          {w}
        </span>
      </span>
    );
  };

  let cursor = 0;
  return (
    <div className="rounded-xl border border-zinc-800 bg-black/70 px-3 py-4 overflow-hidden">
      <div className="flex flex-col items-center gap-1" style={{ lineHeight: s.lineHeight }}>
        {rows.map((row, ri) => {
          const startIdx = cursor;
          cursor += row.length;
          return (
            <div key={ri} className="text-center">
              {row.map((w, k) => renderWord(w, startIdx + k))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const SubtitleSettings = ({ settings, onUpdate }: { settings: any; onUpdate: (newSettings: any) => void }) => {
  const [downloading, setDownloading] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const downloadFont = useProjectStore((s) => s.downloadFont);
  const addToast = useUIStore((s) => s.addToast);
  const { settings: globalSettings, saveSettings } = useSettingsStore();

  const presets = globalSettings?.subtitle_presets || [];
  const defaultPresetId = globalSettings?.default_subtitle_preset_id;
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const isPortrait = selectedProject?.video_format === 'portrait';

  const handleSavePreset = async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) { addToast('Please enter a preset name', 'error'); return; }
    const existingIndex = presets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...presets];
    const extractedSettings = extractSubtitleKeys(settings);
    if (existingIndex >= 0) {
      updatedPresets[existingIndex] = { ...updatedPresets[existingIndex], settings: extractedSettings };
      addToast(`Preset "${trimmedName}" updated!`, 'success');
    } else {
      updatedPresets.push({ id: crypto.randomUUID(), name: trimmedName, settings: extractedSettings });
      addToast(`Preset "${trimmedName}" saved!`, 'success');
    }
    await saveSettings({ ...globalSettings, subtitle_presets: updatedPresets });
    setPresetName('');
  };

  const handleLoadPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) { setPresetName(''); return; }
    const preset = presets.find((p: any) => p.id === presetId);
    if (preset) {
      // Saved presets are partial (only keys set at save time) — apply over
      // defaults so keys from a previous style can't leak through.
      onUpdate({ ...settings, ...applyPresetOverDefaults(portraitSafePreset(preset.settings, isPortrait)) });
      setPresetName(preset.name);
      addToast(`Loaded preset "${preset.name}"`, 'success');
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    await saveSettings({ ...globalSettings, subtitle_presets: presets.filter((p: any) => p.id !== presetId), default_subtitle_preset_id: defaultPresetId === presetId ? undefined : defaultPresetId });
    addToast('Preset deleted', 'info');
  };

  const handleSetDefaultPreset = async (presetId: string) => {
    const isDefault = defaultPresetId === presetId;
    await saveSettings({ ...globalSettings, default_subtitle_preset_id: isDefault ? undefined : presetId });
    addToast(isDefault ? 'Removed default preset' : 'Set as default preset', isDefault ? 'info' : 'success');
  };

  const handleFontChange = async (fontFamily: string) => {
    setSelectedPresetId('');
    onUpdate({ ...settings, fontFamily });
    if (!fontFamily) return;
    setDownloading(true);
    const res = await downloadFont(fontFamily);
    setDownloading(false);
    if (res.success && res.css_path) {
      addToast(`Font ${fontFamily} loaded`, 'success');
      const id = `font-${fontFamily.replace(/\s/g, '')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = getMediaUrlSync(res.css_path);
        document.head.appendChild(link);
      }
    } else {
      addToast(`Failed to load font: ${(res as any).error}`, 'error');
    }
  };

  const applyPresetSettings = (presetSettings: { [k: string]: any }) => {
    setSelectedPresetId('');
    // Full reset to defaults + preset (never a merge: omitted keys must not
    // inherit the previous style), with portrait-safe offsets.
    onUpdate({ ...settings, ...applyPresetOverDefaults(portraitSafePreset(presetSettings, isPortrait)) });
  };

  const renderPresetCard = (id: string, label: string, desc: string, swatch: string, presetSettings: { [k: string]: any }) => {
    const active = isPresetActive({ settings: presetSettings }, settings);
    return (
      <motion.button
        key={id}
        onClick={() => applyPresetSettings(presetSettings)}
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
            {label}
          </span>
          {active && (
            <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center shrink-0 ml-auto">
              <VscCheck className="text-[7px] text-white" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="w-3 h-3 rounded-full border border-zinc-600/50"
            style={{ backgroundColor: swatch }}
          />
          <span
            className="w-3 h-3 rounded text-[6px] font-bold flex items-center justify-center border border-zinc-600/50"
            style={{ backgroundColor: presetSettings.pastColor || '#d6d3d1', color: '#0c0a09' }}
          >T</span>
        </div>
        <p className="text-[8px] text-zinc-500">{desc}</p>
      </motion.button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Live preview */}
      <div>
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40 mb-2">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Live Preview
          </h3>
        </div>
        <SubtitleLivePreview settings={settings} />
      </div>

      {/* Viral styles */}
      <div>
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40 mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Viral Styles
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {VIRAL_PRESETS.map((preset: ViralPreset) =>
            renderPresetCard(preset.id, preset.label, preset.desc, preset.swatch, preset.settings)
          )}
        </div>
      </div>

      {/* Classic presets */}
      <div>
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40 mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Quick Presets
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CLASSIC_PRESETS.map((preset) =>
            renderPresetCard(preset.id, preset.label, preset.desc, preset.settings.activeColor || '#fbbf24', preset.settings)
          )}
        </div>
      </div>

      {/* Saved Presets */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Saved Presets</label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CustomSelect
              options={[{ value: '', label: 'Load a preset...' }, ...presets.map((p: any) => ({ value: p.id, label: p.name }))]}
              value={selectedPresetId}
              onChange={handleLoadPreset}
            />
          </div>
          <div className="flex items-center gap-1 flex-1">
            <input
              type="text"
              placeholder="Preset Name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[var(--color-accent-primary)]/50 focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 transition-colors"
            />
            <button onClick={handleSavePreset} className="p-2 bg-[var(--color-accent-primary)] cursor-pointer hover:bg-[var(--color-accent-light)] hover:text-[var(--color-brand-950)] text-white rounded-md transition-colors" title="Save current styling as preset"><VscSave /></button>
          </div>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/50">
            {presets.map((p: any) => (
              <div key={p.id} className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded pl-2 pr-1 py-1 text-xs text-zinc-300">
                <span className="truncate max-w-[120px] font-medium">{p.name}</span>
                <button onClick={() => handleSetDefaultPreset(p.id)} className={`p-1 rounded hover:bg-zinc-800 transition-colors ${defaultPresetId === p.id ? 'text-[var(--color-accent-primary)]' : 'text-zinc-500 hover:text-zinc-300'}`} title={defaultPresetId === p.id ? 'Remove as default' : 'Set as default for new projects'}><VscStarFull /></button>
                <button onClick={() => handleDeletePreset(p.id)} className="p-1 rounded hover:bg-red-900/50 hover:text-red-400 text-zinc-500 transition-colors" title="Delete preset"><VscTrash /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {downloading && <span className="text-[10px] text-amber-500 font-bold flex items-center gap-1"><VscLoading className="animate-spin text-sm" /> Downloading Font...</span>}

      <SubtitleStyleControls
        settings={settings}
        onUpdate={onUpdate}
        setSelectedPresetId={setSelectedPresetId}
        handleFontChange={handleFontChange}
      />
    </div>
  );
};
