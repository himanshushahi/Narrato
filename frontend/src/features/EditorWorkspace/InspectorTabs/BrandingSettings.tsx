import { useState } from 'react';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomColorInput } from '../../../components/ui/CustomColorInput';
import { CustomCheckbox } from '../../../components/ui/CustomCheckbox';
import { VscTrash, VscStarFull, VscSave } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';

const BRANDING_KEYS = ['hide_chapter_name', 'chapter_text_color', 'chapter_border_color'];

const extractKeys = (obj: any, keys: string[]) => {
  return keys.reduce((acc: any, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
};

export const BrandingSettings = ({ settings, onUpdate }: { settings: any; onUpdate: (newSettings: any) => void }) => {
  const [brandingPresetName, setBrandingPresetName] = useState('');
  const [selectedBrandingPresetId, setSelectedBrandingPresetId] = useState('');
  const { addToast } = useUIStore();
  const { settings: globalSettings, saveSettings } = useSettingsStore();

  const brandingPresets = globalSettings?.branding_presets || [];
  const defaultBrandingPresetId = globalSettings?.default_branding_preset_id;

  const handleSaveBrandingPreset = async () => {
    const trimmedName = brandingPresetName.trim();
    if (!trimmedName) { addToast('Please enter a preset name', 'error'); return; }
    const existingIndex = brandingPresets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...brandingPresets];
    const extractedSettings = extractKeys(settings, BRANDING_KEYS);
    if (existingIndex >= 0) {
      updatedPresets[existingIndex] = { ...updatedPresets[existingIndex], settings: extractedSettings };
      addToast(`Branding Preset "${trimmedName}" updated!`, 'success');
    } else {
      updatedPresets.push({ id: crypto.randomUUID(), name: trimmedName, settings: extractedSettings });
      addToast(`Branding Preset "${trimmedName}" saved!`, 'success');
    }
    await saveSettings({ ...globalSettings, branding_presets: updatedPresets });
    setBrandingPresetName('');
  };

  const handleLoadBrandingPreset = (presetId: string) => {
    setSelectedBrandingPresetId(presetId);
    if (!presetId) { setBrandingPresetName(''); return; }
    const preset = brandingPresets.find((p: any) => p.id === presetId);
    if (preset) {
      onUpdate({ ...settings, ...preset.settings });
      setBrandingPresetName(preset.name);
      addToast(`Loaded branding preset "${preset.name}"`, 'success');
    }
  };

  const handleDeleteBrandingPreset = async (presetId: string) => {
    await saveSettings({ ...globalSettings, branding_presets: brandingPresets.filter((p: any) => p.id !== presetId), default_branding_preset_id: defaultBrandingPresetId === presetId ? undefined : defaultBrandingPresetId });
    addToast('Branding preset deleted', 'info');
  };

  const handleSetDefaultBrandingPreset = async (presetId: string) => {
    const isDefault = defaultBrandingPresetId === presetId;
    await saveSettings({ ...globalSettings, default_branding_preset_id: isDefault ? undefined : presetId });
    addToast(isDefault ? 'Removed default branding preset' : 'Set as default branding preset', isDefault ? 'info' : 'success');
  };

  const updateKey = (key: string, value: any) => {
    onUpdate({ ...settings, [key]: value });
  };

  return (
    <div className="space-y-3">
      {/* Branding Presets */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Branding Presets</label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CustomSelect
              options={[{ value: '', label: 'Load a preset...' }, ...brandingPresets.map((p: any) => ({ value: p.id, label: p.name }))]}
              value={selectedBrandingPresetId}
              onChange={handleLoadBrandingPreset}
            />
          </div>
          <div className="flex items-center gap-1 flex-1">
            <input
              type="text"
              placeholder="Preset Name..."
              value={brandingPresetName}
              onChange={(e) => setBrandingPresetName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[var(--color-accent-primary)]/50 focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 transition-colors"
            />
            <button onClick={handleSaveBrandingPreset} className="p-2 bg-[var(--color-accent-primary)] cursor-pointer hover:bg-[var(--color-accent-light)] hover:text-[var(--color-brand-950)] text-white rounded-md transition-colors" title="Save current branding as preset"><VscSave /></button>
          </div>
        </div>
        {brandingPresets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/50">
            {brandingPresets.map((p: any) => (
              <div key={p.id} className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded pl-2 pr-1 py-1 text-xs text-zinc-300">
                <span className="truncate max-w-[120px] font-medium">{p.name}</span>
                <button onClick={() => handleSetDefaultBrandingPreset(p.id)} className={`p-1 rounded hover:bg-zinc-800 transition-colors ${defaultBrandingPresetId === p.id ? 'text-[var(--color-accent-primary)]' : 'text-zinc-500 hover:text-zinc-300'}`} title={defaultBrandingPresetId === p.id ? 'Remove as default' : 'Set as default for new projects'}><VscStarFull /></button>
                <button onClick={() => handleDeleteBrandingPreset(p.id)} className="p-1 rounded hover:bg-red-900/50 hover:text-red-400 text-zinc-500 transition-colors" title="Delete preset"><VscTrash /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chapter Name */}
      <div>
        <h4 className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Chapter Name</h4>
        <div className="grid grid-cols-2 gap-4 bg-zinc-950/50 p-3 rounded border border-zinc-800/60">
          <div className="col-span-2">
            <CustomCheckbox
              label="Hide Chapter Name"
              checked={settings.hide_chapter_name === true}
              onChange={(e) => updateKey('hide_chapter_name', e.target.checked)}
            />
          </div>
          {!settings.hide_chapter_name && (
            <>
              <CustomColorInput
                label="Text Color"
                value={settings.chapter_text_color || '#d6d3d1'}
                onChange={(e) => updateKey('chapter_text_color', e.target.value)}
              />
              <CustomColorInput
                label="Border Color"
                value={settings.chapter_border_color || '#b45309'}
                onChange={(e) => updateKey('chapter_border_color', e.target.value)}
              />
            </>
          )}
        </div>
      </div>


    </div>
  );
};
