import { useState } from 'react';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomColorInput } from '../../../components/ui/CustomColorInput';
import { CustomCheckbox } from '../../../components/ui/CustomCheckbox';
import { CustomRange } from '../../../components/ui/CustomRange';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { VscLoading, VscTrash, VscStarFull, VscSave } from 'react-icons/vsc';
import { useProjectStore } from '../../../store/useProjectStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';

const SUBTITLE_KEYS = ['fontFamily', 'fontSize', 'wordSpacing', 'activeColor', 'pastColor', 'textTransform', 'bottomOffset', 'showBackgroundHighlight', 'highlightBgColor'];

const extractKeys = (obj: any, keys: string[]) => {
  return keys.reduce((acc: any, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
};

export const SubtitleSettings = ({ settings, onUpdate }: { settings: any; onUpdate: (newSettings: any) => void }) => {
  const [downloading, setDownloading] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const { downloadFont } = useProjectStore();
  const { addToast } = useUIStore();
  const { settings: globalSettings, saveSettings } = useSettingsStore();

  const presets = globalSettings?.subtitle_presets || [];
  const defaultPresetId = globalSettings?.default_subtitle_preset_id;

  const handleSavePreset = async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) { addToast('Please enter a preset name', 'error'); return; }
    const existingIndex = presets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...presets];
    const extractedSettings = extractKeys(settings, SUBTITLE_KEYS);
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
      onUpdate({ ...settings, ...preset.settings });
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

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Presets</label>
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

      <div className="grid grid-cols-2 gap-4">
        <CustomSelect
          label="Font Family"
          options={[
            { value: 'Montserrat', label: 'Montserrat (Latin)' },
            { value: 'Inter', label: 'Inter (Latin)' },
            { value: 'Roboto', label: 'Roboto (Latin)' },
            { value: 'Poppins', label: 'Poppins (Supports Hindi)' },
            { value: 'Hind', label: 'Hind (Supports Hindi)' },
            { value: 'Mukta', label: 'Mukta (Supports Hindi)' },
            { value: 'Kalam', label: 'Kalam (Supports Hindi)' },
            { value: 'Noto Sans Devanagari', label: 'Noto Sans Devanagari' },
            { value: 'Lato', label: 'Lato (Latin)' },
            { value: 'Oswald', label: 'Oswald (Latin)' },
            { value: 'Raleway', label: 'Raleway (Latin)' },
            { value: 'Anton', label: 'Anton (Latin)' },
            { value: 'Bebas Neue', label: 'Bebas Neue (Latin)' },
          ]}
          value={settings.fontFamily || 'Montserrat'}
          onChange={handleFontChange}
        />
        <CustomRange
          label="Font Size"
          min="20" max="150"
          value={settings.fontSize !== undefined ? settings.fontSize : 54}
          valueDisplay={`${settings.fontSize !== undefined ? settings.fontSize : 54}px`}
          onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, fontSize: parseInt(e.target.value) || 54 }); }}
        />
        <CustomRange
          label="Word Spacing"
          min="0" max="50"
          value={settings.wordSpacing !== undefined ? settings.wordSpacing : 18}
          valueDisplay={`${settings.wordSpacing !== undefined ? settings.wordSpacing : 18}px`}
          onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, wordSpacing: parseInt(e.target.value) }); }}
        />
        <CustomColorInput
          label="Active Highlight Color"
          value={settings.activeColor || '#fbbf24'}
          onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, activeColor: e.target.value }); }}
        />
        <CustomColorInput
          label="Past/Inactive Text Color"
          value={settings.pastColor || '#d6d3d1'}
          onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, pastColor: e.target.value }); }}
        />
        <CustomSelect
          label="Text Transform"
          options={[
            { value: 'uppercase', label: 'UPPERCASE' },
            { value: 'lowercase', label: 'lowercase' },
            { value: 'capitalize', label: 'Capitalize' },
            { value: 'none', label: 'Normal' },
          ]}
          value={settings.textTransform || 'uppercase'}
          onChange={(val) => { setSelectedPresetId(''); onUpdate({ ...settings, textTransform: val }); }}
        />
        <CustomRange
          label="Y Position (px from bottom)"
          min="0" max="1500"
          value={settings.bottomOffset !== undefined ? settings.bottomOffset : 120}
          valueDisplay={`${settings.bottomOffset !== undefined ? settings.bottomOffset : 120}px`}
          onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, bottomOffset: parseInt(e.target.value) || 0 }); }}
        />
        <div className="flex flex-col gap-1.5 justify-center mt-2 col-span-2">
          <CustomCheckbox
            label="Show Read Text Background Highlight"
            checked={settings.showBackgroundHighlight !== false}
            onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, showBackgroundHighlight: e.target.checked }); }}
          />
        </div>
        {settings.showBackgroundHighlight !== false && (
          <div className="flex flex-col gap-1.5 col-span-2">
            <div className="max-w-[50%]">
              <CustomColorInput
                label="Background Highlight Color"
                value={settings.highlightBgColor || settings.activeColor || '#fbbf24'}
                onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, highlightBgColor: e.target.value }); }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
