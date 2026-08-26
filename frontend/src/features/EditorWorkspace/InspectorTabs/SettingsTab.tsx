import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscSettingsGear, VscRefresh, VscServer, VscSearch, VscChevronRight } from 'react-icons/vsc';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { WHISPER_MODEL_OPTIONS } from '../../Settings/voiceConstants';



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

  const projectVal = (key: string) => localProjectSettings?.[key] || '';
  const updateKey = (key: string, val: string) => onSettingsUpdate({ ...localProjectSettings, [key]: val });
  const resetKey = (key: string) => {
    const next = { ...localProjectSettings };
    delete next[key];
    onSettingsUpdate(next);
  };

  const effectiveGlobalWhisperModel = globalSettings.whisper_model === 'turbo' && projectLanguage === 'hi' 
    ? 'collabora/faster-whisper-small-hindi' 
    : globalSettings.whisper_model;

  const normalizeModelId = (id: string) => id.split('/').pop() || id;

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['whisper', 'rendering', 'subtitles']));

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
              {!downloadedWhisperModels.some(m => normalizeModelId(m.id) === normalizeModelId(projectVal('whisper_model') || effectiveGlobalWhisperModel)) && (
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
