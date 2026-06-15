import React from 'react';
import { VscSettingsGear, VscRefresh, VscServer } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { ProjectSettingsEditor } from '../../ProjectEditor/ProjectSettingsEditor';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { WHISPER_MODEL_OPTIONS } from '../../Settings/voiceConstants';

interface SettingsTabProps {
  localProjectSettings: any;
  onSettingsUpdate: (settings: any) => void;
}

// --- Option lists (mirrors SettingsPage globals) ---

const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p (HD)' },
  { value: '1080p', label: '1080p (FHD)' },
  { value: '1440p', label: '1440p (2K)' },
  { value: '4k', label: '4K (UHD)' },
];

const FPS_OPTIONS = [
  { value: '24', label: '24 fps (Cinematic)' },
  { value: '30', label: '30 fps (Standard)' },
  { value: '60', label: '60 fps (Smooth)' },
];

const CODEC_OPTIONS = [
  { value: 'h264', label: 'H.264 (Universal)' },
  { value: 'h265', label: 'H.265 (Better Compression)' },
  { value: 'vp8', label: 'VP8 (WebM)' },
  { value: 'vp9', label: 'VP9 (WebM HQ)' },
];

const CRF_OPTIONS = [
  { value: '18', label: '18 — High Quality' },
  { value: '23', label: '23 — Medium (Default)' },
  { value: '28', label: '28 — Lower Quality' },
];

const CONCURRENCY_OPTIONS = [
  { value: '1', label: '1 Core (Stable)' },
  { value: '2', label: '2 Cores' },
  { value: '4', label: '4 Cores' },
  { value: '8', label: '8 Cores' },
  { value: 'logical', label: 'Max Logical (Fastest)' },
  { value: 'physical', label: 'Max Physical (Recommended)' },
];

const HARDWARE_OPTIONS = [
  { value: 'cpu', label: 'CPU (Software)' },
  { value: 'cuda', label: 'GPU (CUDA NVENC)' },
];

const TIMEOUT_OPTIONS = [
  { value: '300000', label: '5 min (Default)' },
  { value: '600000', label: '10 min' },
  { value: '900000', label: '15 min' },
  { value: '1800000', label: '30 min' },
  { value: '3600000', label: '60 min' },
];

const NUMBER_STYLE_OPTIONS = [
  { value: 'plain', label: 'Plain' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'badge', label: 'Badge' },
];

const NUMBERING_FONT_OPTIONS = [
  { value: 'Montserrat, sans-serif', label: 'Montserrat (Latin)' },
  { value: 'Inter, sans-serif', label: 'Inter (Latin)' },
  { value: 'Roboto, sans-serif', label: 'Roboto (Latin)' },
  { value: 'Poppins, sans-serif', label: 'Poppins (Supports Hindi)' },
  { value: 'Hind, sans-serif', label: 'Hind (Supports Hindi)' },
  { value: 'Mukta, sans-serif', label: 'Mukta (Supports Hindi)' },
  { value: 'Kalam, sans-serif', label: 'Kalam (Supports Hindi)' },
  { value: 'Noto Sans Devanagari, sans-serif', label: 'Noto Sans Devanagari' },
  { value: 'Lato, sans-serif', label: 'Lato (Latin)' },
  { value: 'Oswald, sans-serif', label: 'Oswald (Latin)' },
  { value: 'Raleway, sans-serif', label: 'Raleway (Latin)' },
  { value: 'Anton, sans-serif', label: 'Anton (Latin)' },
  { value: 'Bebas Neue, sans-serif', label: 'Bebas Neue (Latin)' },
];

// --- Reusable override row ---

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

// --- Inline colour picker ---

const ColorInput: React.FC<{ label: string; value: string; onChange: (val: string) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
    />
    <span className="text-[10px] text-stone-500 truncate">{label}</span>
  </div>
);

// --- Helper: get nested key with dot notation or flat ---

const getProjectVal = (settings: any, key: string): string | undefined => {
  return settings[key];
};

export const SettingsTab: React.FC<SettingsTabProps> = ({
  localProjectSettings, onSettingsUpdate
}) => {
  const globalSettings = useSettingsStore((s) => s.settings);
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const projectLanguage = selectedProject?.language || 'hi';

  // If the global setting is something generic, but this is a Hindi project, the smart fallback should be the Hindi model
  const effectiveGlobalWhisperModel = globalSettings.whisper_model || (projectLanguage === 'hi' ? 'collabora/faster-whisper-small-hindi' : 'base');

  // Merge helpers: update a single key in localProjectSettings
  const updateKey = (key: string, value: string) => {
    onSettingsUpdate({ ...localProjectSettings, [key]: value });
  };

  const resetKey = (key: string) => {
    const updated = { ...localProjectSettings };
    delete updated[key];
    onSettingsUpdate(updated);
  };

  const projectVal = (key: string): string => getProjectVal(localProjectSettings, key) || '';

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
      {/* ════ Speech-to-Text (Whisper) ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <VscServer className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Speech-to-Text (Whisper)
          </h3>
          <span className="text-[8px] text-zinc-600 ml-auto">Overrides global</span>
        </div>

        <OverrideRow
          label="Processing Hardware"
          globalValue={globalSettings.whisper_device || 'cpu'}
          projectValue={projectVal('whisper_device')}
          onReset={() => resetKey('whisper_device')}
        >
          <CustomSelect
            options={HARDWARE_OPTIONS}
            value={projectVal('whisper_device') || globalSettings.whisper_device || 'cpu'}
            onChange={(v) => updateKey('whisper_device', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Faster-Whisper Model Size"
          globalValue={effectiveGlobalWhisperModel}
          projectValue={projectVal('whisper_model')}
          onReset={() => resetKey('whisper_model')}
        >
          <CustomSelect
            options={WHISPER_MODEL_OPTIONS}
            value={projectVal('whisper_model') || effectiveGlobalWhisperModel}
            onChange={(v) => updateKey('whisper_model', v)}
          />
        </OverrideRow>
      </div>

      {/* ════ Rendering Engine ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <VscSettingsGear className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Rendering Engine
          </h3>
          <span className="text-[8px] text-zinc-600 ml-auto">Overrides global</span>
        </div>

        <OverrideRow
          label="Resolution"
          globalValue={globalSettings.render_resolution || '1080p'}
          projectValue={projectVal('render_resolution')}
          onReset={() => resetKey('render_resolution')}
        >
          <CustomSelect
            options={RESOLUTION_OPTIONS}
            value={projectVal('render_resolution') || globalSettings.render_resolution || '1080p'}
            onChange={(v) => updateKey('render_resolution', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Frame Rate"
          globalValue={globalSettings.render_fps || '30'}
          projectValue={projectVal('render_fps')}
          onReset={() => resetKey('render_fps')}
        >
          <CustomSelect
            options={FPS_OPTIONS}
            value={projectVal('render_fps') || globalSettings.render_fps || '30'}
            onChange={(v) => updateKey('render_fps', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Video Codec"
          globalValue={globalSettings.render_codec || 'h264'}
          projectValue={projectVal('render_codec')}
          onReset={() => resetKey('render_codec')}
        >
          <CustomSelect
            options={CODEC_OPTIONS}
            value={projectVal('render_codec') || globalSettings.render_codec || 'h264'}
            onChange={(v) => updateKey('render_codec', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Quality (CRF)"
          globalValue={globalSettings.render_crf || '18'}
          projectValue={projectVal('render_crf')}
          onReset={() => resetKey('render_crf')}
        >
          <CustomSelect
            options={CRF_OPTIONS}
            value={projectVal('render_crf') || globalSettings.render_crf || '18'}
            onChange={(v) => updateKey('render_crf', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Concurrency"
          globalValue={globalSettings.render_concurrency || 'logical'}
          projectValue={projectVal('render_concurrency')}
          onReset={() => resetKey('render_concurrency')}
        >
          <CustomSelect
            options={CONCURRENCY_OPTIONS}
            value={projectVal('render_concurrency') || globalSettings.render_concurrency || 'logical'}
            onChange={(v) => updateKey('render_concurrency', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Processing Hardware"
          globalValue={globalSettings.render_hardware || 'cpu'}
          projectValue={projectVal('render_hardware')}
          onReset={() => resetKey('render_hardware')}
        >
          <CustomSelect
            options={HARDWARE_OPTIONS}
            value={projectVal('render_hardware') || globalSettings.render_hardware || 'cpu'}
            onChange={(v) => updateKey('render_hardware', v)}
          />
        </OverrideRow>

        <OverrideRow
          label="Render Timeout"
          globalValue={globalSettings.render_timeout || '600000'}
          projectValue={projectVal('render_timeout')}
          onReset={() => resetKey('render_timeout')}
        >
          <CustomSelect
            options={TIMEOUT_OPTIONS}
            value={projectVal('render_timeout') || globalSettings.render_timeout || '600000'}
            onChange={(v) => updateKey('render_timeout', v)}
          />
        </OverrideRow>
      </div>

      {/* ════ Numbering Style ════ */}
      <div className="bg-zinc-900/60 rounded-xl p-4 border border-zinc-800/60 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40">
          <span className="text-xs text-zinc-500">🔢</span>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Numbering Style
          </h3>
          <span className="text-[8px] text-zinc-600 ml-auto">Applies to all list visuals</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <CustomSelect
            label="Number Badge Style"
            options={NUMBER_STYLE_OPTIONS}
            value={localProjectSettings.numbering_number_style || 'plain'}
            onChange={(v) => updateKey('numbering_number_style', v)}
          />
          <CustomSelect
            label="Font Family"
            options={NUMBERING_FONT_OPTIONS}
            value={localProjectSettings.numbering_font_family || 'Montserrat, sans-serif'}
            onChange={(v) => updateKey('numbering_font_family', v)}
          />
        </div>

        <div className="pt-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-2">Colours</label>
          <div className="grid grid-cols-3 gap-3">
            <ColorInput
              label="Title"
              value={localProjectSettings.numbering_title_color || '#fef3c7'}
              onChange={(v) => updateKey('numbering_title_color', v)}
            />
            <ColorInput
              label="Description"
              value={localProjectSettings.numbering_description_color || '#d6d3d1'}
              onChange={(v) => updateKey('numbering_description_color', v)}
            />
            <ColorInput
              label="Number"
              value={localProjectSettings.numbering_number_color || '#fbbf24'}
              onChange={(v) => updateKey('numbering_number_color', v)}
            />
            <ColorInput
              label="Num Background"
              value={localProjectSettings.numbering_number_bg_color || 'rgba(251,191,36,0.15)'}
              onChange={(v) => updateKey('numbering_number_bg_color', v)}
            />
            <ColorInput
              label="Num Border"
              value={localProjectSettings.numbering_number_border_color || '#b45309'}
              onChange={(v) => updateKey('numbering_number_border_color', v)}
            />
            <ColorInput
              label="Accent / Glow"
              value={localProjectSettings.numbering_accent_color || '#f59e0b'}
              onChange={(v) => updateKey('numbering_accent_color', v)}
            />
          </div>
        </div>
      </div>

      {/* ════ Subtitle Styling + Branding (existing) ════ */}
      <div>
        <ProjectSettingsEditor
          settings={localProjectSettings}
          onUpdate={onSettingsUpdate}
        />
      </div>
    </div>
  );
};
