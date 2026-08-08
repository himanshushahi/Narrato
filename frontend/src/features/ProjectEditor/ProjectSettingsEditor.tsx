import { useState } from 'react';

import { CustomSelect } from '../../components/ui/CustomSelect';
import { CustomColorInput } from '../../components/ui/CustomColorInput';
import { CustomCheckbox } from '../../components/ui/CustomCheckbox';
import { SubtitleStyleControls } from './components/SubtitleStyleControls';
import { getMediaUrlSync } from '../../utils/mediaUrl';
import { VscLoading, VscTrash, VscStarFull, VscSave } from 'react-icons/vsc';
import { useProjectStore } from '../../store/useProjectStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';

const SUBTITLE_KEYS = ['fontFamily', 'fontSize', 'wordSpacing', 'activeColor', 'pastColor', 'textTransform', 'bottomOffset', 'showBackgroundHighlight', 'highlightBgColor', 'wordsPerScreen', 'activeAnimation'];
const BRANDING_KEYS = ['hide_chapter_name', 'chapter_text_color', 'chapter_border_color'];

const extractKeys = (obj: any, keys: string[]) => {
  return keys.reduce((acc: any, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
};

export const ProjectSettingsEditor = ({ settings, onUpdate }: { settings: any, onUpdate: (newSettings: any) => void }) => {
  const [downloading, setDownloading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [brandingPresetName, setBrandingPresetName] = useState("");
  const [selectedBrandingPresetId, setSelectedBrandingPresetId] = useState("");
  const { downloadFont } = useProjectStore();
  const { addToast } = useUIStore();
  const { settings: globalSettings, saveSettings } = useSettingsStore();

  const presets = globalSettings?.subtitle_presets || [];
  const defaultPresetId = globalSettings?.default_subtitle_preset_id;
  const brandingPresets = globalSettings?.branding_presets || [];
  const defaultBrandingPresetId = globalSettings?.default_branding_preset_id;

  const handleSavePreset = async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      addToast("Please enter a preset name", "error");
      return;
    }

    const existingIndex = presets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...presets];
    const extractedSettings = extractKeys(settings, SUBTITLE_KEYS);

    if (existingIndex >= 0) {
      updatedPresets[existingIndex] = {
        ...updatedPresets[existingIndex],
        settings: extractedSettings
      };
      addToast(`Preset "${trimmedName}" updated!`, "success");
    } else {
      updatedPresets.push({
        id: crypto.randomUUID(),
        name: trimmedName,
        settings: extractedSettings
      });
      addToast(`Preset "${trimmedName}" saved!`, "success");
    }

    await saveSettings({
      ...globalSettings,
      subtitle_presets: updatedPresets
    });
    setPresetName("");
  };

  const handleSaveBrandingPreset = async () => {
    const trimmedName = brandingPresetName.trim();
    if (!trimmedName) {
      addToast("Please enter a preset name", "error");
      return;
    }

    const existingIndex = brandingPresets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...brandingPresets];
    const extractedSettings = extractKeys(settings, BRANDING_KEYS);

    if (existingIndex >= 0) {
      updatedPresets[existingIndex] = {
        ...updatedPresets[existingIndex],
        settings: extractedSettings
      };
      addToast(`Branding Preset "${trimmedName}" updated!`, "success");
    } else {
      updatedPresets.push({
        id: crypto.randomUUID(),
        name: trimmedName,
        settings: extractedSettings
      });
      addToast(`Branding Preset "${trimmedName}" saved!`, "success");
    }

    await saveSettings({
      ...globalSettings,
      branding_presets: updatedPresets
    });
    setBrandingPresetName("");
  };

  const handleLoadPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setPresetName("");
      return;
    }
    const preset = presets.find((p: any) => p.id === presetId);
    if (preset) {
      onUpdate({ ...settings, ...preset.settings });
      setPresetName(preset.name);
      addToast(`Loaded preset "${preset.name}"`, "success");
    }
  };

  const handleLoadBrandingPreset = (presetId: string) => {
    setSelectedBrandingPresetId(presetId);
    if (!presetId) {
      setBrandingPresetName("");
      return;
    }
    const preset = brandingPresets.find((p: any) => p.id === presetId);
    if (preset) {
      onUpdate({ ...settings, ...preset.settings });
      setBrandingPresetName(preset.name);
      addToast(`Loaded branding preset "${preset.name}"`, "success");
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    const updatedPresets = presets.filter((p: any) => p.id !== presetId);
    const isDefault = defaultPresetId === presetId;

    await saveSettings({
      ...globalSettings,
      subtitle_presets: updatedPresets,
      default_subtitle_preset_id: isDefault ? undefined : defaultPresetId
    });
    addToast("Preset deleted", "info");
  };

  const handleDeleteBrandingPreset = async (presetId: string) => {
    const updatedPresets = brandingPresets.filter((p: any) => p.id !== presetId);
    const isDefault = defaultBrandingPresetId === presetId;

    await saveSettings({
      ...globalSettings,
      branding_presets: updatedPresets,
      default_branding_preset_id: isDefault ? undefined : defaultBrandingPresetId
    });
    addToast("Branding preset deleted", "info");
  };

  const handleSetDefaultPreset = async (presetId: string) => {
    const isCurrentlyDefault = defaultPresetId === presetId;
    await saveSettings({
      ...globalSettings,
      default_subtitle_preset_id: isCurrentlyDefault ? undefined : presetId
    });
    if (!isCurrentlyDefault) {
      addToast("Set as default preset", "success");
    } else {
      addToast("Removed default preset", "info");
    }
  };

  const handleSetDefaultBrandingPreset = async (presetId: string) => {
    const isCurrentlyDefault = defaultBrandingPresetId === presetId;
    await saveSettings({
      ...globalSettings,
      default_branding_preset_id: isCurrentlyDefault ? undefined : presetId
    });
    if (!isCurrentlyDefault) {
      addToast("Set as default branding preset", "success");
    } else {
      addToast("Removed default branding preset", "info");
    }
  };

  const handleFontChange = async (fontFamily: string) => {
    setSelectedPresetId("");
    onUpdate({ ...settings, fontFamily });
    if (!fontFamily) return;
    setDownloading(true);
    const res = await downloadFont(fontFamily);
    setDownloading(false);
    if (res.success && res.css_path) {
      addToast(`Font ${fontFamily} loaded`, "success");
      const id = `font-${fontFamily.replace(/\s/g, '')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = getMediaUrlSync(res.css_path);
        document.head.appendChild(link);
      }
    } else {
      addToast(`Failed to load font: ${(res as any).error}`, "error");
    }
  };

  return (
    <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800/60 space-y-3">
      <div className="flex items-center justify-between pb-1 border-b border-zinc-800/40">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Subtitle Styling</h3>
        {downloading && <span className="text-[10px] text-amber-500 font-bold flex items-center gap-1"><VscLoading className="animate-spin text-sm" /> Downloading Font...</span>}
      </div>

      {/* PRESETS SECTION */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Presets</label>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CustomSelect
              options={[
                { value: '', label: 'Load a preset...' },
                ...presets.map((p: any) => ({ value: p.id, label: p.name }))
              ]}
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
            <button
              onClick={handleSavePreset}
              className="p-2 bg-[var(--color-accent-primary)] cursor-pointer hover:bg-[var(--color-accent-light)] hover:text-[var(--color-brand-950)] text-white rounded-md transition-colors"
              title="Save current styling as preset"
            >
              <VscSave />
            </button>
          </div>
        </div>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/50">
            {presets.map((p: any) => (
              <div key={p.id} className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded pl-2 pr-1 py-1 text-xs text-zinc-300">
                <span className="truncate max-w-[120px] font-medium">{p.name}</span>
                <button
                  onClick={() => handleSetDefaultPreset(p.id)}
                  className={`p-1 rounded hover:bg-zinc-800 transition-colors ${defaultPresetId === p.id ? 'text-[var(--color-accent-primary)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title={defaultPresetId === p.id ? "Remove as default" : "Set as default for new projects"}
                >
                  <VscStarFull />
                </button>
                <button
                  onClick={() => handleDeletePreset(p.id)}
                  className="p-1 rounded hover:bg-red-900/50 hover:text-red-400 text-zinc-500 transition-colors"
                  title="Delete preset"
                >
                  <VscTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <SubtitleStyleControls
        settings={settings}
        onUpdate={onUpdate}
        setSelectedPresetId={setSelectedPresetId}
        handleFontChange={handleFontChange}
      />

      <hr className="border-zinc-800" />

      {/* GLOBAL BRANDING SECTION */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-3">Global Branding</h3>

        {/* BRANDING PRESETS SECTION */}
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Branding Presets</label>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <CustomSelect
                options={[
                  { value: '', label: 'Load a preset...' },
                  ...brandingPresets.map((p: any) => ({ value: p.id, label: p.name }))
                ]}
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
              <button
                onClick={handleSaveBrandingPreset}
                className="p-2 bg-[var(--color-accent-primary)] cursor-pointer hover:bg-[var(--color-accent-light)] hover:text-[var(--color-brand-950)] text-white rounded-md transition-colors"
                title="Save current branding as preset"
              >
                <VscSave />
              </button>
            </div>
          </div>

          {brandingPresets.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/50">
              {brandingPresets.map((p: any) => (
                <div key={p.id} className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded pl-2 pr-1 py-1 text-xs text-zinc-300">
                  <span className="truncate max-w-[120px] font-medium">{p.name}</span>
                  <button
                    onClick={() => handleSetDefaultBrandingPreset(p.id)}
                    className={`p-1 rounded hover:bg-zinc-800 transition-colors ${defaultBrandingPresetId === p.id ? 'text-[var(--color-accent-primary)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={defaultBrandingPresetId === p.id ? "Remove as default" : "Set as default for new projects"}
                  >
                    <VscStarFull />
                  </button>
                  <button
                    onClick={() => handleDeleteBrandingPreset(p.id)}
                    className="p-1 rounded hover:bg-red-900/50 hover:text-red-400 text-zinc-500 transition-colors"
                    title="Delete preset"
                  >
                    <VscTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <h4 className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Chapter Name</h4>
            <div className="grid grid-cols-2 gap-4 bg-zinc-950/50 p-3 rounded border border-zinc-800/60">
              <div className="col-span-2">
                <CustomCheckbox
                  label="Hide Chapter Name"
                  checked={settings.hide_chapter_name === true}
                  onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, hide_chapter_name: e.target.checked }) }}
                />
              </div>
              {!settings.hide_chapter_name && (
                <>
                  <CustomColorInput
                    label="Text Color"
                    value={settings.chapter_text_color || '#d6d3d1'}
                    onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, chapter_text_color: e.target.value }) }}
                  />
                  <CustomColorInput
                    label="Border Color"
                    value={settings.chapter_border_color || '#b45309'}
                    onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, chapter_border_color: e.target.value }) }}
                  />
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
