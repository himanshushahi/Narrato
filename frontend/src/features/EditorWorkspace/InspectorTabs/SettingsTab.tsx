import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscSettingsGear, VscRefresh, VscServer, VscSearch, VscChevronRight, VscCheck } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { SubtitleSettings } from './SubtitleSettings';
import { BrandingSettings } from './BrandingSettings';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { WHISPER_MODEL_OPTIONS } from '../../Settings/voiceConstants';

interface NumberingPreset {
  id: string;
  label: string;
  desc: string;
  number_style: string;
  font_family: string;
  title_color: string;
  description_color: string;
  number_color: string;
  number_bg_color: string;
  number_border_color: string;
  accent_color: string;
}

const NUMBERING_PRESETS: NumberingPreset[] = [
  {
    id: 'amber_glow',
    label: 'Amber Glow',
    desc: 'Warm amber — circle badge with glow',
    number_style: 'circle',
    font_family: 'Montserrat, sans-serif',
    title_color: '#fef3c7',
    description_color: '#d6d3d1',
    number_color: '#fbbf24',
    number_bg_color: 'rgba(251,191,36,0.15)',
    number_border_color: '#b45309',
    accent_color: '#f59e0b',
  },
  {
    id: 'emerald_clean',
    label: 'Emerald Clean',
    desc: 'Fresh green — square badge',
    number_style: 'square',
    font_family: 'Inter, sans-serif',
    title_color: '#ecfdf5',
    description_color: '#a7f3d0',
    number_color: '#34d399',
    number_bg_color: 'rgba(52,211,153,0.12)',
    number_border_color: '#059669',
    accent_color: '#10b981',
  },
  {
    id: 'royal_purple',
    label: 'Royal Purple',
    desc: 'Rich purple — pill badge',
    number_style: 'badge',
    font_family: 'Poppins, sans-serif',
    title_color: '#f5f3ff',
    description_color: '#c4b5fd',
    number_color: '#a78bfa',
    number_bg_color: 'rgba(167,139,250,0.15)',
    number_border_color: '#7c3aed',
    accent_color: '#8b5cf6',
  },
  {
    id: 'bold_plain',
    label: 'Bold Plain',
    desc: 'Minimal — large text, no badge',
    number_style: 'plain',
    font_family: 'Anton, sans-serif',
    title_color: '#ffffff',
    description_color: '#a1a1aa',
    number_color: '#fbbf24',
    number_bg_color: 'transparent',
    number_border_color: 'transparent',
    accent_color: '#f59e0b',
  },
  {
    id: 'ocean_blue',
    label: 'Ocean Blue',
    desc: 'Cool blue — circle badge',
    number_style: 'circle',
    font_family: 'Raleway, sans-serif',
    title_color: '#eff6ff',
    description_color: '#bfdbfe',
    number_color: '#60a5fa',
    number_bg_color: 'rgba(96,165,250,0.12)',
    number_border_color: '#2563eb',
    accent_color: '#3b82f6',
  },
  {
    id: 'rose_gold',
    label: 'Rose Gold',
    desc: 'Elegant rose — square badge',
    number_style: 'square',
    font_family: 'Lato, sans-serif',
    title_color: '#fdf2f8',
    description_color: '#fbcfe8',
    number_color: '#f472b6',
    number_bg_color: 'rgba(244,114,182,0.12)',
    number_border_color: '#db2777',
    accent_color: '#ec4899',
  },
  {
    id: 'slate_modern',
    label: 'Slate Modern',
    desc: 'Dark slate — plain style',
    number_style: 'plain',
    font_family: 'Oswald, sans-serif',
    title_color: '#f4f4f5',
    description_color: '#71717a',
    number_color: '#f4f4f5',
    number_bg_color: 'transparent',
    number_border_color: 'transparent',
    accent_color: '#a1a1aa',
  },
  {
    id: 'hindi_warm',
    label: 'Hindi Warm',
    desc: 'Warm saffron — circle badge',
    number_style: 'circle',
    font_family: 'Hind, sans-serif',
    title_color: '#fffbeb',
    description_color: '#fde68a',
    number_color: '#f97316',
    number_bg_color: 'rgba(249,115,22,0.12)',
    number_border_color: '#c2410c',
    accent_color: '#ea580c',
  },
];

interface SettingsTabProps {
  localProjectSettings: any;
  onSettingsUpdate: (settings: any) => void;
}

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

const NumberColorInput: React.FC<{ label: string; value: string; onChange: (val: string) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2.5 bg-zinc-950/50 border border-zinc-800 rounded-md px-3 py-2 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/30 transition-all">
    <div className="relative w-4 h-4 rounded overflow-hidden shrink-0 border border-zinc-700">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute -top-2 -left-2 w-8 h-8 cursor-pointer border-none p-0 bg-transparent"
      />
    </div>
    <span className="text-xs text-zinc-400 truncate">{label}</span>
  </div>
);

const OverrideRow: React.FC<{
  label: string;
  globalValue: string;
  projectValue: string;
  onReset?: () => void;
  children: React.ReactNode;
}> = ({ label, globalValue, projectValue, onReset, children }) => {
  const isOverridden = projectValue && projectValue !== globalValue;

  return (
    <div className="space-y-1.5 bg-zinc-950/30 rounded-lg p-3 border border-zinc-800/40">
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
      <div className="flex items-center gap-2 pt-0.5">
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

const getProjectVal = (settings: any, key: string): string | undefined => {
  return settings[key];
};

type SectionField = {
  id: string;
  label: string;
  keywords: string[];
};

type SectionDef = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  fields: SectionField[];
};

const SECTION_DEFS: SectionDef[] = [
  {
    id: 'whisper',
    title: 'Speech-to-Text (Whisper)',
    icon: VscServer,
    keywords: ['whisper', 'speech', 'text', 'stt', 'transcription', 'model', 'hardware', 'device'],
    fields: [
      { id: 'whisper_device', label: 'Processing Hardware', keywords: ['gpu', 'cpu', 'cuda', 'device', 'hardware'] },
      { id: 'whisper_model', label: 'Faster-Whisper Model Size', keywords: ['model', 'size', 'download', 'weights'] },
    ],
  },
  {
    id: 'rendering',
    title: 'Rendering Engine',
    icon: VscSettingsGear as React.ComponentType<{ className?: string }>,
    keywords: ['render', 'rendering', 'engine', 'video', 'output', 'resolution', 'fps', 'codec', 'quality'],
    fields: [
      { id: 'render_resolution', label: 'Resolution', keywords: ['resolution', 'hd', 'fhd', '2k', '4k', 'size'] },
      { id: 'render_fps', label: 'Frame Rate', keywords: ['fps', 'frame', 'rate', 'smooth', 'cinematic'] },
      { id: 'render_codec', label: 'Video Codec', keywords: ['codec', 'h264', 'h265', 'vp8', 'vp9', 'compression'] },
      { id: 'render_crf', label: 'Quality (CRF)', keywords: ['quality', 'crf', 'compression'] },
      { id: 'render_concurrency', label: 'Concurrency', keywords: ['concurrency', 'core', 'cpu', 'threads', 'parallel'] },
      { id: 'render_hardware', label: 'Processing Hardware', keywords: ['gpu', 'cpu', 'cuda', 'hardware', 'nvenc'] },
      { id: 'render_timeout', label: 'Render Timeout', keywords: ['timeout', 'time', 'limit', 'max'] },
    ],
  },
  {
    id: 'numbering',
    title: 'Numbering Style',
    icon: () => <span className="text-xs text-zinc-500">#</span>,
    keywords: ['numbering', 'number', 'list', 'style', 'font', 'color', 'badge'],
    fields: [
      { id: 'numbering_number_style', label: 'Number Badge Style', keywords: ['badge', 'style', 'circle', 'square', 'plain'] },
      { id: 'numbering_font_family', label: 'Font Family', keywords: ['font', 'family', 'typography', 'text'] },
      { id: 'numbering_title_color', label: 'Title Colour', keywords: ['title', 'color', 'colour'] },
      { id: 'numbering_description_color', label: 'Description Colour', keywords: ['description', 'color', 'colour'] },
      { id: 'numbering_number_color', label: 'Number Colour', keywords: ['number', 'color', 'colour', 'digit'] },
      { id: 'numbering_number_bg_color', label: 'Number Background', keywords: ['number', 'background', 'bg', 'color'] },
      { id: 'numbering_number_border_color', label: 'Number Border', keywords: ['number', 'border', 'color'] },
      { id: 'numbering_accent_color', label: 'Accent / Glow', keywords: ['accent', 'glow', 'color'] },
    ],
  },
  {
    id: 'timeline',
    title: 'Timeline Tracker',
    icon: () => <span className="text-xs text-zinc-500">T</span>,
    keywords: ['timeline', 'tracker', 'history', 'event', 'color', 'font'],
    fields: [
      { id: 'timeline_primary_color', label: 'Primary Colour', keywords: ['timeline', 'color', 'primary'] },
      { id: 'timeline_title_font_size', label: 'Title Font Size', keywords: ['timeline', 'title', 'font', 'size'] },
      { id: 'timeline_title_x', label: 'Title X Position', keywords: ['timeline', 'title', 'x', 'horizontal', 'position'] },
      { id: 'timeline_title_y', label: 'Title Y Position', keywords: ['timeline', 'title', 'y', 'vertical', 'position'] },
    ],
  },
  {
    id: 'subtitles',
    title: 'Subtitle Styling',
    icon: () => <span className="text-xs text-zinc-500">CC</span>,
    keywords: ['subtitle', 'caption', 'text', 'preset', 'font', 'highlight', 'color'],
    fields: [
      { id: 'fontFamily', label: 'Font Family', keywords: ['font', 'family', 'typography'] },
      { id: 'fontSize', label: 'Font Size', keywords: ['font', 'size', 'text'] },
      { id: 'activeColor', label: 'Active Highlight Color', keywords: ['color', 'highlight', 'active'] },
      { id: 'pastColor', label: 'Past Text Color', keywords: ['color', 'inactive', 'past'] },
    ],
  },
  {
    id: 'branding',
    title: 'Global Branding',
    icon: () => <span className="text-xs text-zinc-500">B</span>,
    keywords: ['branding', 'chapter', 'lower third', 'chart', 'color', 'preset'],
    fields: [
      { id: 'chapter_name', label: 'Chapter Name', keywords: ['chapter', 'hide', 'color'] },
      { id: 'lower_third', label: 'Lower Third', keywords: ['lower', 'third', 'position', 'color'] },
      { id: 'chart', label: 'Animated Charts', keywords: ['chart', 'graph', 'color'] },
    ],
  },
];

function matchesSection(section: SectionDef, query: string): boolean {
  const q = query.toLowerCase();
  if (section.title.toLowerCase().includes(q)) return true;
  if (section.keywords.some(k => k.toLowerCase().includes(q))) return true;
  return section.fields.some(f => matchesField(f, q));
}

function matchesField(field: SectionField, q: string): boolean {
  if (field.label.toLowerCase().includes(q)) return true;
  if (field.keywords.some(k => k.toLowerCase().includes(q))) return true;
  return false;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  localProjectSettings, onSettingsUpdate
}) => {
  const globalSettings = useSettingsStore((s) => s.settings);
  const downloadedWhisperModels = useSettingsStore((s) => s.downloadedWhisperModels);
  const fetchDownloadedWhisperModels = useSettingsStore((s) => s.fetchDownloadedWhisperModels);
  const selectedProject = useProjectStore((s) => s.selectedProject);

  React.useEffect(() => {
    fetchDownloadedWhisperModels();
  }, [fetchDownloadedWhisperModels]);
  const projectLanguage = selectedProject?.language || 'hi';

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['whisper', 'rendering', 'numbering', 'subtitles', 'branding', 'timeline']));

  const effectiveGlobalWhisperModel = globalSettings.whisper_model || (projectLanguage === 'hi' ? 'collabora/faster-whisper-small-hindi' : 'base');

  const updateKey = (key: string, value: string) => {
    onSettingsUpdate({ ...localProjectSettings, [key]: value });
  };

  const resetKey = (key: string) => {
    const updated = { ...localProjectSettings };
    delete updated[key];
    onSettingsUpdate(updated);
  };

  const projectVal = (key: string): string => getProjectVal(localProjectSettings, key) || '';

  const isNumberingPresetActive = (preset: NumberingPreset): boolean => {
    const pStyle = projectVal('numbering_number_style') || 'plain';
    if (pStyle !== preset.number_style) return false;
    const pFont = projectVal('numbering_font_family') || 'Montserrat, sans-serif';
    if (pFont !== preset.font_family) return false;
    if ((projectVal('numbering_title_color') || '#fef3c7') !== preset.title_color) return false;
    if ((projectVal('numbering_description_color') || '#d6d3d1') !== preset.description_color) return false;
    if ((projectVal('numbering_number_color') || '#fbbf24') !== preset.number_color) return false;
    if ((projectVal('numbering_number_bg_color') || 'rgba(251,191,36,0.15)') !== preset.number_bg_color) return false;
    if ((projectVal('numbering_number_border_color') || '#b45309') !== preset.number_border_color) return false;
    if ((projectVal('numbering_accent_color') || '#f59e0b') !== preset.accent_color) return false;
    return true;
  };

  const applyNumberingPreset = (preset: NumberingPreset) => {
    onSettingsUpdate({
      ...localProjectSettings,
      numbering_number_style: preset.number_style,
      numbering_font_family: preset.font_family,
      numbering_title_color: preset.title_color,
      numbering_description_color: preset.description_color,
      numbering_number_color: preset.number_color,
      numbering_number_bg_color: preset.number_bg_color,
      numbering_number_border_color: preset.number_border_color,
      numbering_accent_color: preset.accent_color,
    });
  };

  const visibleSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTION_DEFS;
    return SECTION_DEFS.filter(s => matchesSection(s, searchQuery));
  }, [searchQuery]);

  const toggleSection = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2.5">
      {/* Search bar */}
      <div className="relative">
        <VscSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search settings..."
          className="w-full h-9 pl-9 pr-3 rounded-xl bg-zinc-900/80 border border-zinc-800/50 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
        />
      </div>

      {/* Whisper section */}
      {visibleSections.some(s => s.id === 'whisper') && (
        <CollapsibleSection
          id="whisper"
          title="Speech-to-Text (Whisper)"
          icon={<VscServer className="text-sm text-zinc-500" />}
          collapsed={collapsedSections.has('whisper')}
          onToggle={toggleSection}
        >
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
            <div className="space-y-1">
              <CustomSelect
                options={WHISPER_MODEL_OPTIONS}
                value={projectVal('whisper_model') || effectiveGlobalWhisperModel}
                onChange={(v) => updateKey('whisper_model', v)}
              />
              {!downloadedWhisperModels.some(m => m.id === (projectVal('whisper_model') || effectiveGlobalWhisperModel)) && (
                <div className="text-[9px] text-amber-500 font-medium px-1">
                  This model is not downloaded. You can download it from the Global Settings page.
                </div>
              )}
            </div>
          </OverrideRow>
        </CollapsibleSection>
      )}

      {/* Rendering Engine section */}
      {visibleSections.some(s => s.id === 'rendering') && (
        <CollapsibleSection
          id="rendering"
          title="Rendering Engine"
          icon={<VscSettingsGear className="text-sm text-zinc-500" />}
          collapsed={collapsedSections.has('rendering')}
          onToggle={toggleSection}
        >
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
        </CollapsibleSection>
      )}

      {/* Numbering Style section */}
      {visibleSections.some(s => s.id === 'numbering') && (
        <CollapsibleSection
          id="numbering"
          title="Numbering Style"
          icon={<span className="text-sm text-zinc-500 font-semibold">#</span>}
          collapsed={collapsedSections.has('numbering')}
          onToggle={toggleSection}
        >
          <div>
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-800/40 mb-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                Presets
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {NUMBERING_PRESETS.map((preset) => {
                const active = isNumberingPresetActive(preset);
                return (
                  <motion.button
                    key={preset.id}
                    onClick={() => applyNumberingPreset(preset)}
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
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className="w-3 h-3 rounded-full border border-zinc-600/50"
                        style={{ backgroundColor: preset.number_color }}
                      />
                      <span
                        className="w-3 h-3 rounded-full border border-zinc-600/50"
                        style={{ backgroundColor: preset.accent_color }}
                      />
                      <span
                        className="w-3 h-3 rounded-full border border-zinc-600/50"
                        style={{ backgroundColor: preset.title_color }}
                      />
                    </div>
                    <p className="text-[8px] text-zinc-500">{preset.desc}</p>
                  </motion.button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="pt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-2.5">Colours</span>
            <div className="grid grid-cols-3 gap-2">
              <NumberColorInput
                label="Title"
                value={localProjectSettings.numbering_title_color || '#fef3c7'}
                onChange={(v) => updateKey('numbering_title_color', v)}
              />
              <NumberColorInput
                label="Description"
                value={localProjectSettings.numbering_description_color || '#d6d3d1'}
                onChange={(v) => updateKey('numbering_description_color', v)}
              />
              <NumberColorInput
                label="Number"
                value={localProjectSettings.numbering_number_color || '#fbbf24'}
                onChange={(v) => updateKey('numbering_number_color', v)}
              />
              <NumberColorInput
                label="Num Background"
                value={localProjectSettings.numbering_number_bg_color || 'rgba(251,191,36,0.15)'}
                onChange={(v) => updateKey('numbering_number_bg_color', v)}
              />
              <NumberColorInput
                label="Num Border"
                value={localProjectSettings.numbering_number_border_color || '#b45309'}
                onChange={(v) => updateKey('numbering_number_border_color', v)}
              />
              <NumberColorInput
                label="Accent / Glow"
                value={localProjectSettings.numbering_accent_color || '#f59e0b'}
                onChange={(v) => updateKey('numbering_accent_color', v)}
              />
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Timeline Tracker section */}
      {visibleSections.some(s => s.id === 'timeline') && (
        <CollapsibleSection
          id="timeline"
          title="Timeline Tracker"
          icon={<span className="text-sm text-zinc-500 font-semibold">T</span>}
          collapsed={collapsedSections.has('timeline')}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberColorInput
                label="Primary Colour"
                value={localProjectSettings.timeline_primary_color || '#06b6d4'}
                onChange={(v) => updateKey('timeline_primary_color', v)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-zinc-300">Title Font Size</label>
                <span className="text-xs text-amber-500 font-mono">
                  {localProjectSettings.timeline_title_font_size || 48}px
                </span>
              </div>
              <input
                type="range"
                min="24"
                max="96"
                step="2"
                value={localProjectSettings.timeline_title_font_size || 48}
                onChange={(e) => updateKey('timeline_title_font_size', e.target.value)}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-zinc-300">Title X</label>
                  <span className="text-xs text-amber-500 font-mono">
                    {localProjectSettings.timeline_title_x !== undefined ? localProjectSettings.timeline_title_x : 80}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="400"
                  step="5"
                  value={localProjectSettings.timeline_title_x !== undefined ? localProjectSettings.timeline_title_x : 80}
                  onChange={(e) => updateKey('timeline_title_x', e.target.value)}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-zinc-300">Title Y</label>
                  <span className="text-xs text-amber-500 font-mono">
                    {localProjectSettings.timeline_title_y !== undefined ? localProjectSettings.timeline_title_y : 120}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="400"
                  step="5"
                  value={localProjectSettings.timeline_title_y !== undefined ? localProjectSettings.timeline_title_y : 120}
                  onChange={(e) => updateKey('timeline_title_y', e.target.value)}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Subtitle Styling section */}
      {visibleSections.some(s => s.id === 'subtitles') && (
        <CollapsibleSection
          id="subtitles"
          title="Subtitle Styling"
          icon={<span className="text-sm text-zinc-500 font-semibold">CC</span>}
          collapsed={collapsedSections.has('subtitles')}
          onToggle={toggleSection}
        >
          <SubtitleSettings
            settings={localProjectSettings}
            onUpdate={onSettingsUpdate}
          />
        </CollapsibleSection>
      )}

      {/* Global Branding section */}
      {visibleSections.some(s => s.id === 'branding') && (
        <CollapsibleSection
          id="branding"
          title="Global Branding"
          icon={<span className="text-sm text-zinc-500 font-semibold">B</span>}
          collapsed={collapsedSections.has('branding')}
          onToggle={toggleSection}
        >
          <BrandingSettings
            settings={localProjectSettings}
            onUpdate={onSettingsUpdate}
          />
        </CollapsibleSection>
      )}

      {/* Empty state */}
      {visibleSections.length === 0 && searchQuery.trim() && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <VscSearch className="text-2xl mb-3 opacity-40" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">No settings found</p>
          <p className="text-[10px] text-zinc-700 mt-1">Try a different search term</p>
        </div>
      )}
    </div>
  );
};

function CollapsibleSection({
  id,
  title,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors cursor-pointer group"
      >
        <div className="w-6 h-6 rounded-md bg-zinc-800/80 flex items-center justify-center group-hover:bg-zinc-700/80 transition-colors">
          {icon}
        </div>
        <h3 className="text-xs font-semibold text-zinc-200 flex-1 text-left">
          {title}
        </h3>
        <motion.span
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.2 }}
          className="text-zinc-600 group-hover:text-zinc-400 transition-colors"
        >
          <VscChevronRight className="text-sm" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key={`${id}-content`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
