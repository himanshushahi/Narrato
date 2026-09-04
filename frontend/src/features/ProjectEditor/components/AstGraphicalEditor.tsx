import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { BiTrashAlt, BiCopy } from 'react-icons/bi';
import { BsPlus, BsSearch, BsUpload, BsChevronDown, BsChevronRight, BsSliders } from 'react-icons/bs';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/atom-one-dark.css';
import { DynamicIcon } from '../../../components/video/DynamicIcon';
import { IconPickerModal } from './IconPickerModal';
import { AstAnimationBuilder } from './AstAnimationBuilder';
import { AstLayoutControls } from './AstLayoutControls';
import { AstFilterControls } from './AstFilterControls';
import { AstChartDataEditor } from './AstChartDataEditor';
import { AstMapLocationsEditor } from './AstMapLocationsEditor';
import { AstHtmlCodeEditor } from './AstHtmlCodeEditor';
import { AstParticlesEditor } from './AstParticlesEditor';

const SUPPORTED_FONTS = [
  {
    group: 'Clean & Modern Sans', fonts: [
      { value: 'Inter', label: 'Inter (Modern Sans)' },
      { value: 'Montserrat', label: 'Montserrat (Clean Sans)' },
      { value: 'Outfit', label: 'Outfit (Modern Tech)' },
      { value: 'Poppins', label: 'Poppins (Geometric)' },
      { value: 'Roboto', label: 'Roboto (Universal)' },
    ]
  },
  {
    group: 'Bold Headlines & Titles', fonts: [
      { value: 'Oswald', label: 'Oswald (Bold Condensed)' },
      { value: 'Anton', label: 'Anton (Impact Headline)' },
      { value: 'Bebas Neue', label: 'Bebas Neue (Tall Headline)' },
      { value: 'Space Grotesk', label: 'Space Grotesk (Cyberpunk)' },
    ]
  },
  {
    group: 'Editorial & Classic Serif', fonts: [
      { value: 'Playfair Display', label: 'Playfair Display (Editorial Serif)' },
      { value: 'Merriweather', label: 'Merriweather (Documentary Serif)' },
      { value: 'Cinzel', label: 'Cinzel (Cinematic Classic)' },
    ]
  },
  {
    group: 'Monospace & Tech HUD', fonts: [
      { value: 'Fira Code', label: 'Fira Code (Code / HUD)' },
      { value: 'JetBrains Mono', label: 'JetBrains Mono (Data)' },
    ]
  },
  {
    group: 'Hindi / Indic / CTL', fonts: [
      { value: 'Noto Sans Devanagari', label: 'Noto Sans Devanagari (Hindi)' },
      { value: 'Hind', label: 'Hind (Hindi Sans)' },
      { value: 'Mukta', label: 'Mukta (Hindi Clean)' },
      { value: 'Kalam', label: 'Kalam (Handwritten Hindi)' },
    ]
  },
];

hljs.registerLanguage('json', json);

/** Stable empty fallbacks so memoized sub-panels don't see a fresh {} / [] per tick. Frozen — never mutate. */
const EMPTY_STYLE: Record<string, any> = Object.freeze({}) as Record<string, any>;
const EMPTY_LIST: any[] = Object.freeze([] as any[]) as any[];

export interface AstLayerApi {
  updateLayer: (idx: number, field: string, val: any) => void;
  updateContent: (idx: number, field: string, val: any) => void;
  updateContentFields: (idx: number, updates: Record<string, any>) => void;
  deleteLayer: (idx: number) => void;
  duplicateLayer: (idx: number) => void;
  previewQuery: (idx: number, query: string) => void;
  toggleAdvanced: (idx: number) => void;
  setAdvancedTab: (idx: number, tab: 'layout' | 'animations' | 'filters' | 'motion') => void;
  openIconPicker: (idx: number) => void;
  changeType: (idx: number, newType: string) => void;
  selectIcon: (iconName: string) => void;
}

const MiniJsonEditorInner = ({ label, value, onChange }: { label: string; value: any; onChange: (val: any) => void }) => {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const newText = JSON.stringify(value || {}, null, 2);
      setText(prev => {
        try {
          if (JSON.stringify(JSON.parse(prev), null, 2) !== newText) {
            return newText;
          }
          return prev;
        } catch {
          return prev;
        }
      });
    } catch {
      // ignore
    }
  }, [value]);

  const handleChange = (newText: string) => {
    setText(newText);
    try {
      const parsed = JSON.parse(newText);
      setError(false);
      onChange(parsed);
    } catch (e) {
      setError(true);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</label>
        {error && <span className="text-[10px] text-red-400">Invalid JSON</span>}
      </div>
      <div className={`w-full bg-black/40 border rounded-md text-xs font-mono overflow-auto max-h-[140px] ${error ? 'border-red-500/50' : 'border-white/10 focus-within:border-amber-500/50'}`}>
        <Editor
          value={text}
          onValueChange={handleChange}
          highlight={code => hljs.highlight(code, { language: 'json' }).value}
          padding={8}
          style={{
            fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace',
            fontSize: '11px',
            minHeight: '40px',
          }}
          textareaClassName="focus:outline-none"
        />
      </div>
    </div>
  );
};

const MiniJsonEditor = memo(MiniJsonEditorInner);
(MiniJsonEditor as any).displayName = 'MiniJsonEditor';

export const AstGraphicalEditor = ({
  initialValue,
  onChange,
  onUploadSubVisual,
  onPreviewSubVisual,
  uploadingSubVisual
}: {
  initialValue: any;
  onChange: (val: any) => void;
  onUploadSubVisual?: (visualType?: string) => Promise<string | undefined> | void;
  onPreviewSubVisual?: (query: string) => Promise<string | undefined> | void;
  uploadingSubVisual?: string | null;
}) => {
  const [composition, setComposition] = useState(() => {
    if (!initialValue || !initialValue.type) {
      return { type: 'Sequence', children: [] };
    }
    return initialValue;
  });

  const [previewingIdx, setPreviewingIdx] = useState<number | null>(null);
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<number, boolean>>({});
  const [advancedTab, setAdvancedTab] = useState<Record<number, 'layout' | 'animations' | 'filters' | 'motion'>>({});
  const [iconPickerIdx, setIconPickerIdx] = useState<number | null>(null);

  // Identity of the last composition we sent upstream. Parent propagation is
  // synchronous in the common path, so our own echo arrives with this exact
  // reference — skip it in O(1). Upstream clones (history snapshot, JSON
  // round-trip, `|| {}` fallback) arrive with a new reference but identical
  // content — skip those via a JSON signature so in-progress drafts survive.
  // The stringify runs only when initialValue identity changes (echo/external),
  // never per keystroke/drag tick.
  const lastSentRef = useRef<any>(null);
  const lastSentJsonRef = useRef<string | null>(null);
  const safeStringify = (v: any): string | null => {
    try {
      const s = JSON.stringify(v ?? null);
      // Cap signature size: huge embedded Lottie JSON shouldn't be re-hashed
      // on every echo; fall back to reference check in that case.
      return s.length > 500000 ? null : s;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!initialValue) return;
    if (initialValue === lastSentRef.current) return;
    // Own echo, just cloned upstream: adopt the new reference, keep local draft.
    if (lastSentJsonRef.current !== null) {
      const incomingJson = safeStringify(initialValue);
      if (incomingJson !== null && incomingJson === lastSentJsonRef.current) {
        lastSentRef.current = initialValue;
        return;
      }
    }
    // No-op when the parent is already showing what we render.
    const incomingStr = safeStringify(initialValue);
    const currentStr = safeStringify(compositionRef.current);
    if (incomingStr !== null && currentStr !== null && incomingStr === currentStr) {
      lastSentRef.current = initialValue;
      return;
    }
    setComposition(initialValue);
  }, [initialValue]);

  // Latest-value refs so every mutator below reads current state even when
  // called through the stable api object (memoized panels, async handlers).
  // Synced in effects/events only — never during render (concurrent-mode tear).
  const compositionRef = useRef(composition);
  const onChangeRef = useRef(onChange);
  const onPreviewRef = useRef(onPreviewSubVisual);
  const iconPickerIdxRef = useRef(iconPickerIdx);
  useEffect(() => { compositionRef.current = composition; }, [composition]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onPreviewRef.current = onPreviewSubVisual; }, [onPreviewSubVisual]);
  useEffect(() => { iconPickerIdxRef.current = iconPickerIdx; }, [iconPickerIdx]);

  const triggerChange = (newComp: any) => {
    lastSentRef.current = newComp;
    lastSentJsonRef.current = safeStringify(newComp);
    // Update the ref synchronously: rapid consecutive edits in the same tick
    // (color drag, slider scrub, batched field updates) must build on the
    // latest composition instead of the last *rendered* one, or earlier ticks
    // get overwritten and keystrokes/drag frames are lost.
    compositionRef.current = newComp;
    setComposition(newComp);
    onChangeRef.current(newComp);
  };

  const updateLayer = (idx: number, field: string, val: any) => {
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children[idx] = { ...newComp.children[idx], [field]: val };
    triggerChange(newComp);
  };

  const updateContentFields = (idx: number, updates: Record<string, any>) => {
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    const content = { ...(newComp.children[idx]?.content || {}), ...updates };
    newComp.children[idx] = { ...newComp.children[idx], content };
    triggerChange(newComp);
  };

  const updateContent = (idx: number, field: string, val: any) => {
    updateContentFields(idx, { [field]: val });
  };

  const handleAddLayer = () => {
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.push({
      type: 'Layer',
      z_index: newComp.children.length > 0 ? (newComp.children[newComp.children.length - 1].z_index || 0) + 5 : 0,
      content: { type: 'Image', query: '', source: 'pexels' }
    });
    triggerChange(newComp);
  };

  const handleDeleteLayer = (idx: number) => {
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.splice(idx, 1);
    triggerChange(newComp);
  };

  const handleDuplicateLayer = (idx: number) => {
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    const clone = JSON.parse(JSON.stringify(newComp.children[idx]));
    clone.z_index = (clone.z_index || 0) + 1;
    newComp.children.splice(idx + 1, 0, clone);
    triggerChange(newComp);
  };

  const handlePreviewQuery = async (idx: number, queryToSearch: string) => {
    if (!queryToSearch || !onPreviewRef.current) return;
    setPreviewingIdx(idx);
    try {
      const p = await onPreviewRef.current(queryToSearch);
      if (p) {
        updateContent(idx, 'local_path', p);
      }
    } catch (e) {
      console.error('Preview error:', e);
    } finally {
      setPreviewingIdx(null);
    }
  };

  const toggleAdvanced = (idx: number) => {
    setExpandedAdvanced(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Stable per-layer API for memoized children: every function reads latest
  // state through refs, so identities never churn across ticks and sibling
  // layers memo-skip while one layer is edited.
  const api: AstLayerApi = useMemo(() => ({
    updateLayer: (idx, field, val) => updateLayer(idx, field, val),
    updateContent: (idx, field, val) => updateContent(idx, field, val),
    updateContentFields: (idx, updates) => updateContentFields(idx, updates),
    deleteLayer: (idx) => handleDeleteLayer(idx),
    duplicateLayer: (idx) => handleDuplicateLayer(idx),
    previewQuery: (idx, query) => { void handlePreviewQuery(idx, query); },
    toggleAdvanced: (idx) => toggleAdvanced(idx),
    setAdvancedTab: (idx, tab) => setAdvancedTab(prev => ({ ...prev, [idx]: tab })),
    openIconPicker: (idx) => { iconPickerIdxRef.current = idx; setIconPickerIdx(idx); },
    changeType: (idx, newType) => {
      const comp = compositionRef.current;
      const copy = { ...comp };
      copy.children = [...(copy.children || [])];
      const oldLayer = copy.children[idx] || {};
      const newContent = { ...(oldLayer.content || {}), type: newType };
      if (newType === 'Video') {
        newContent.volume = 0;
      }
      if (newType === 'Particles') {
        newContent.particle_preset = newContent.particle_preset || 'confetti';
        newContent.particle_count = newContent.particle_count ?? 100;
        newContent.particle_opacity = newContent.particle_opacity ?? 0.9;
      }
      copy.children[idx] = { ...oldLayer, content: newContent };
      triggerChange(copy);
    },
    selectIcon: (iconName) => {
      const pickIdx = iconPickerIdxRef.current;
      if (pickIdx === null) return;
      const currentContent = compositionRef.current.children?.[pickIdx]?.content || {};
      updateContentFields(pickIdx, {
        type: 'Shape',
        shape_type: 'icon',
        icon_name: iconName,
        stroke: currentContent.stroke || currentContent.fill || '#00d4ff',
        stroke_width: currentContent.stroke_width ?? 2,
        radius: currentContent.radius ?? 50,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Per-layer stable sub-panel callbacks (index-bound once; api never changes).
  // Rebuilt only when the layer count changes (add/remove/duplicate).
  const layerCallbacks = useMemo(() => {
    const count = (composition.children || []).length;
    return Array.from({ length: count }, (_, idx) => ({
      onStyleChange: (val: any) => api.updateContent(idx, 'style', val),
      onAnimationsChange: (val: any) => api.updateLayer(idx, 'animations', val),
      onFiltersChange: (val: any) => api.updateLayer(idx, 'filters', val),
      onChartDataChange: (val: any) => api.updateContent(idx, 'data', val),
      onParticlesChange: (updates: Record<string, any>) => api.updateContentFields(idx, updates),
      onHtmlChange: (val: string) => api.updateContent(idx, 'html_content', val),
      onLocationsChange: (val: any) => api.updateContent(idx, 'locations', val),
      onAnimationDataChange: (val: any) => api.updateContent(idx, 'animation_data', val),
      onPreviewQuery: (query: string) => api.previewQuery(idx, query),
    }));
  }, [api, (composition.children || []).length]);

  const layers = composition.children || [];

  return (
    <div className="space-y-3 w-full min-w-0">
      {layers.map((layer: any, idx: number) => {
        const content = layer.content || {};
        const cType = content.type || 'Image';
        const isAdvancedOpen = !!expandedAdvanced[idx];

        return (
          <div
            // Index-bound key: layers have no stable ids. Keep the layer shell
            // stable across in-place type switches (Image<->Video share a branch)
            // so focus and per-layer drafts survive; type-specific sub-panels
            // are different component types and remount on their own.
            key={idx}
            className="p-3 bg-zinc-900/70 border border-zinc-800/90 rounded-xl space-y-3 relative group/layer hover:border-zinc-700/80 transition-all shadow-sm w-full min-w-0"
          >
            {/* Header: Layer Title, Z-Index, and Action Buttons */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-amber-400 shrink-0 whitespace-nowrap">Layer {idx + 1}</span>
                <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded-md border border-white/10 focus-within:border-amber-500/50 shrink-0">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase whitespace-nowrap">Z:</span>
                  <input
                    type="number"
                    className="bg-transparent w-9 text-xs text-stone-200 focus:outline-none text-center font-mono"
                    value={layer.z_index ?? 0}
                    onChange={e => updateLayer(idx, 'z_index', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDuplicateLayer(idx)}
                  className="p-1.5 text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 rounded-md transition-colors cursor-pointer shrink-0"
                  title="Duplicate Layer"
                >
                  <BiCopy size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLayer(idx)}
                  className="p-1.5 text-red-400/80 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md transition-colors cursor-pointer shrink-0"
                  title="Delete Layer"
                >
                  <BiTrashAlt size={13} />
                </button>
              </div>
            </div>

            {/* Content Type Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block whitespace-nowrap">Type</label>
              <select
                className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                value={cType}
                onChange={e => api.changeType(idx, e.target.value)}
              >
                <option value="Image">Image</option>
                <option value="Video">Video</option>
                <option value="Text">Text (Kinetic)</option>
                <option value="Chart">Chart (Bar/Line/Pie)</option>
                <option value="Shape">Shape / Vector (Native)</option>
                <option value="Lottie">Lottie (Vector Animation)</option>
                <option value="Particles">Particles (Confetti/Embers…)</option>
                <option value="HTML">HTML / SVG (Custom)</option>
                <option value="Map">Map</option>
              </select>
            </div>

            {/* Dynamic Content Fields for Image and Video */}
            {(cType === 'Image' || cType === 'Video') && (
              <div className="space-y-2.5">
                {/* Search Query + Action Buttons */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 shrink-0 whitespace-nowrap">Query / Search</label>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={previewingIdx === idx || content.source === 'upload'}
                        onClick={() => handlePreviewQuery(idx, content.query || '')}
                        className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[10px] uppercase font-bold rounded-md flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                        title="Search stock preview"
                      >
                        {previewingIdx === idx ? <div className="w-2.5 h-2.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" /> : <BsSearch size={10} />}
                        <span>Preview</span>
                      </button>
                      {onUploadSubVisual && (
                        <button
                          type="button"
                          disabled={uploadingSubVisual !== null}
                          onClick={async () => {
                            const p = await onUploadSubVisual(cType === 'Image' ? 'image' : cType === 'Video' ? 'video' : 'ast');
                            if (p) {
                              updateContentFields(idx, { local_path: p, source: 'upload' });
                            }
                          }}
                          className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[10px] uppercase font-bold rounded-md flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                          title="Upload media file"
                        >
                          {uploadingSubVisual !== null ? <div className="w-2.5 h-2.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : <BsUpload size={10} />}
                          <span>Upload</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 transition-colors"
                    value={content.query || ''}
                    onChange={e => updateContent(idx, 'query', e.target.value)}
                    placeholder="e.g. cinematic cityscape, futuristic neon..."
                  />
                </div>

                {/* Source & Image Type in a clean grid */}
                <div className={`grid gap-2 ${content.source === 'pixabay' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Source</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                      value={content.source || 'pexels'}
                      onChange={e => updateContent(idx, 'source', e.target.value)}
                    >
                      <option value="upload">Upload / Local</option>
                      <option value="pexels">Pexels</option>
                      <option value="pixabay">Pixabay</option>
                      {cType !== 'Video' && <option value="wikipedia">Wikipedia</option>}
                      {cType !== 'Image' && <option value="youtube">YouTube</option>}
                    </select>
                  </div>

                  {content.source === 'pixabay' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Image Type</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                        value={content.image_type || 'all'}
                        onChange={e => updateContent(idx, 'image_type', e.target.value)}
                      >
                        <option value="all">All</option>
                        <option value="photo">Photo</option>
                        <option value="illustration">Illustration</option>
                        <option value="vector">Vector</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Video Volume & Playback Controls */}
                {cType === 'Video' && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor={`vol-${idx}`} className="text-[10px] font-bold uppercase tracking-wider text-stone-400 w-24 shrink-0 whitespace-nowrap">
                        Volume: {Math.round((content.volume ?? 0) * 100)}%
                      </label>
                      <input
                        type="range"
                        id={`vol-${idx}`}
                        min="0"
                        max="1"
                        step="0.05"
                        value={content.volume ?? 0}
                        onChange={e => updateContent(idx, 'volume', parseFloat(e.target.value))}
                        className="flex-1 accent-amber-500 bg-black/40 h-1.5 rounded-lg cursor-pointer appearance-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={content.loop === true}
                          onChange={e => updateContent(idx, 'loop', e.target.checked)}
                          className="rounded accent-amber-500 cursor-pointer"
                        />
                        Loop Video (Unchecked = Freeze on Last Frame)
                      </label>
                    </div>
                  </div>
                )}

                {/* YouTube Start & Duration */}
                {content.source === 'youtube' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">YT Start (s)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-mono"
                        value={content.yt_start_offset ?? ''}
                        onChange={e => updateContent(idx, 'yt_start_offset', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="15"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">YT Dur (s)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-mono"
                        value={content.yt_duration ?? ''}
                        onChange={e => updateContent(idx, 'yt_duration', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="10"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dynamic Content Fields for Text */}
            {cType === 'Text' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Text Content</label>
                  <textarea
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-2 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 min-h-[54px] resize-none leading-relaxed"
                    value={content.text || ''}
                    onChange={e => updateContent(idx, 'text', e.target.value)}
                    placeholder="Enter headline or text message..."
                  />
                </div>

                {/* Animation Mode & Highlight Color */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Animation Mode</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                      value={content.animation_mode || 'static'}
                      onChange={e => updateContent(idx, 'animation_mode', e.target.value)}
                    >
                      <option value="static">Static Text</option>
                      <option value="words_stagger">Words Stagger (Pop-in)</option>
                      <option value="character_stagger">Letter Stagger (Cinematic Blur)</option>
                      <option value="typewriter">Typewriter (Caret)</option>
                      <option value="marker_highlight">Marker Highlight</option>
                      <option value="counter">Number Counter (Ticker)</option>
                    </select>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Highlight Color</label>
                    <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50 min-w-0">
                      <input
                        type="color"
                        value={content.highlight_color?.startsWith('#') && content.highlight_color.length === 7 ? content.highlight_color : '#facc15'}
                        onChange={e => updateContent(idx, 'highlight_color', e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                      />
                      <input
                        type="text"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
                        value={content.highlight_color || ''}
                        onChange={e => updateContent(idx, 'highlight_color', e.target.value)}
                        placeholder="#facc15"
                      />
                    </div>
                  </div>
                </div>

                {content.animation_mode === 'marker_highlight' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Highlight Words (comma separated)</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50"
                      value={Array.isArray(content.highlight_words) ? content.highlight_words.join(', ') : ''}
                      onChange={e => {
                        const words = e.target.value.split(',').map((w: string) => w.trim()).filter(Boolean);
                        updateContent(idx, 'highlight_words', words);
                      }}
                      placeholder="e.g. 240 MILLION DOLLARS, DISAPPEAR"
                    />
                  </div>
                )}

                {/* Font Family Dropdown */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Font Family</label>
                    {content.font && !SUPPORTED_FONTS.some(g => g.fonts.some(f => f.value === content.font)) && (
                      <span className="text-[9px] text-amber-400 font-mono">Custom Font</span>
                    )}
                  </div>
                  <select
                    className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                    value={content.font || 'Inter'}
                    onChange={e => updateContent(idx, 'font', e.target.value)}
                  >
                    {SUPPORTED_FONTS.map((group, gIdx) => (
                      <optgroup key={gIdx} label={group.group} className="bg-zinc-900 text-stone-300 font-bold">
                        {group.fonts.map((f, fIdx) => (
                          <option key={fIdx} value={f.value} className="bg-zinc-950 text-stone-200 font-normal">
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Typography Attributes: Weight, Color & Alignment */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Weight</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-1.5 py-1 focus:outline-none cursor-pointer font-medium"
                      value={content.weight || '700'}
                      onChange={e => updateContent(idx, 'weight', e.target.value)}
                    >
                      <option value="400">400 (Regular)</option>
                      <option value="500">500 (Medium)</option>
                      <option value="600">600 (SemiBold)</option>
                      <option value="700">700 (Bold)</option>
                      <option value="800">800 (ExtraBold)</option>
                      <option value="900">900 (Black)</option>
                    </select>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Text Color</label>
                    <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-md px-1.5 py-1 focus-within:border-amber-500/50 min-w-0">
                      <input
                        type="color"
                        value={content.color?.startsWith('#') && content.color.length === 7 ? content.color : '#ffffff'}
                        onChange={e => updateContent(idx, 'color', e.target.value)}
                        className="w-3.5 h-3.5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                      />
                      <input
                        type="text"
                        className="w-full bg-transparent text-[11px] text-stone-200 focus:outline-none font-mono min-w-0"
                        value={content.color || ''}
                        onChange={e => updateContent(idx, 'color', e.target.value)}
                        placeholder="#ffffff"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Align</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-1.5 py-1 focus:outline-none cursor-pointer font-medium"
                      value={content.style?.textAlign || 'center'}
                      onChange={e => updateContentFields(idx, { style: { ...(content.style || {}), textAlign: e.target.value } })}
                    >
                      <option value="center">Center</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic Content Fields for Chart */}
            {cType === 'Chart' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Chart Type</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                      value={content.chart_type || 'bar'}
                      onChange={e => updateContent(idx, 'chart_type', e.target.value)}
                    >
                      <option value="bar">Bar Chart</option>
                      <option value="line">Line Graph</option>
                      <option value="pie">Pie Chart</option>
                      <option value="donut">Donut Chart</option>
                      <option value="progress">Progress Bars</option>
                    </select>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Title (Optional)</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono"
                      value={content.title || ''}
                      onChange={e => updateContent(idx, 'title', e.target.value)}
                      placeholder="e.g. Market Share 2024"
                    />
                  </div>
                </div>

                {/* Visual Chart Data Points Table */}
                <div className="w-full">
                  <AstChartDataEditor
                    data={content.data || EMPTY_LIST}
                    onChange={layerCallbacks[idx].onChartDataChange}
                  />
                </div>
              </div>
            )}

            {/* Dynamic Content Fields for Particles */}
            {cType === 'Particles' && (
              <div className="space-y-2.5">
                <div className="w-full">
                  <AstParticlesEditor
                    preset={content.particle_preset || 'confetti'}
                    count={content.particle_count}
                    size={content.particle_size}
                    speed={content.particle_speed}
                    opacity={content.particle_opacity ?? 0.9}
                    direction={content.particle_direction}
                    onChange={layerCallbacks[idx].onParticlesChange}
                  />
                </div>
              </div>
            )}

            {/* Dynamic Content Fields for Shape */}
            {cType === 'Shape' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Shape Type</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                      value={content.shape_type || 'rectangle'}
                      onChange={e => updateContent(idx, 'shape_type', e.target.value)}
                    >
                      <option value="rectangle">Rectangle (Rounded)</option>
                      <option value="circle">Circle</option>
                      <option value="star">Star (Badge)</option>
                      <option value="triangle">Triangle</option>
                      <option value="arrow">Arrow</option>
                      <option value="polygon">Polygon</option>
                      <option value="path">SVG Path (Animated Draw)</option>
                      <option value="icon">Lucide Vector Icon</option>
                    </select>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Size / Radius</label>
                    <input
                      type="number"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.radius ?? 50}
                      onChange={e => updateContent(idx, 'radius', parseFloat(e.target.value) || 50)}
                      placeholder="50"
                    />
                  </div>
                </div>

                {content.shape_type === 'icon' && (
                  <div className="space-y-1.5 p-2.5 bg-black/30 border border-white/5 rounded-lg">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Lucide Icon Name</label>
                      <button
                        type="button"
                        onClick={() => setIconPickerIdx(idx)}
                        className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 rounded transition-colors cursor-pointer"
                      >
                        Browse Icons...
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center shrink-0">
                        <DynamicIcon name={content.icon_name || 'sparkles'} size={20} color={content.stroke || content.fill || '#00d4ff'} />
                      </div>
                      <input
                        type="text"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono"
                        value={content.icon_name || ''}
                        onChange={e => updateContent(idx, 'icon_name', e.target.value)}
                        placeholder="e.g. trending-up, shield-alert"
                      />
                    </div>
                  </div>
                )}

                {(content.shape_type === 'star' || content.shape_type === 'polygon') && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Points / Sides</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                        value={content.points ?? 5}
                        onChange={e => updateContent(idx, 'points', parseInt(e.target.value) || 5)}
                        placeholder="5"
                      />
                    </div>
                    {content.shape_type === 'star' && (
                      <div className="space-y-1 min-w-0">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Inner Radius</label>
                        <input
                          type="number"
                          className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                          value={content.inner_radius ?? 25}
                          onChange={e => updateContent(idx, 'inner_radius', parseFloat(e.target.value) || 25)}
                          placeholder="25"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Fill Color</label>
                    <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50 min-w-0">
                      <input
                        type="color"
                        value={content.fill?.startsWith('#') && content.fill.length === 7 ? content.fill : '#f59e0b'}
                        onChange={e => updateContent(idx, 'fill', e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                      />
                      <input
                        type="text"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
                        value={content.fill || ''}
                        onChange={e => updateContent(idx, 'fill', e.target.value)}
                        placeholder="#f59e0b"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Stroke Color</label>
                    <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50 min-w-0">
                      <input
                        type="color"
                        value={content.stroke?.startsWith('#') && content.stroke.length === 7 ? content.stroke : '#ffffff'}
                        onChange={e => updateContent(idx, 'stroke', e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                      />
                      <input
                        type="text"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
                        value={content.stroke || ''}
                        onChange={e => updateContent(idx, 'stroke', e.target.value)}
                        placeholder="#ffffff"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Stroke Width</label>
                    <input
                      type="number"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.stroke_width ?? 2}
                      onChange={e => updateContent(idx, 'stroke_width', parseInt(e.target.value) || 0)}
                      placeholder="2"
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-4">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={content.glow !== false}
                        onChange={e => updateContent(idx, 'glow', e.target.checked)}
                        className="rounded accent-amber-500 cursor-pointer"
                      />
                      Glow
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={content.draw_animation !== false}
                        onChange={e => updateContent(idx, 'draw_animation', e.target.checked)}
                        className="rounded accent-amber-500 cursor-pointer"
                      />
                      Draw Anim
                    </label>
                  </div>
                </div>

                {content.shape_type === 'path' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">SVG Path Data (d attribute)</label>
                    <textarea
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 font-mono focus:outline-none focus:border-amber-500/50 min-h-[50px]"
                      value={content.path_d || ''}
                      onChange={e => updateContent(idx, 'path_d', e.target.value)}
                      placeholder="M 10,50 Q 50,10 90,50..."
                    />
                  </div>
                )}
              </div>
            )}

            {/* Dynamic Content Fields for Lottie */}
            {cType === 'Lottie' && (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Lottie URL / Path</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono"
                    value={content.lottie_url || ''}
                    onChange={e => updateContent(idx, 'lottie_url', e.target.value)}
                    placeholder="https://assets.lottiefiles.com/... or local JSON path"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Speed</label>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.playback_rate ?? 1}
                      onChange={e => updateContent(idx, 'playback_rate', parseFloat(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Direction</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1 focus:outline-none cursor-pointer"
                      value={content.direction || 'forward'}
                      onChange={e => updateContent(idx, 'direction', e.target.value)}
                    >
                      <option value="forward">Forward</option>
                      <option value="backward">Backward</option>
                    </select>
                  </div>
                  <div className="flex items-center pt-4">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={content.loop !== false}
                        onChange={e => updateContent(idx, 'loop', e.target.checked)}
                        className="rounded accent-amber-500 cursor-pointer"
                      />
                      Loop
                    </label>
                  </div>
                </div>

                <div className="w-full">
                  <MiniJsonEditor label="Raw Animation Data (JSON Override)" value={content.animation_data || EMPTY_STYLE} onChange={layerCallbacks[idx].onAnimationDataChange} />
                </div>
              </div>
            )}

            {/* Dynamic Content Fields for HTML */}
            {cType === 'HTML' && (
              <div className="w-full">
                <AstHtmlCodeEditor
                  value={content.html_content || ''}
                  onChange={layerCallbacks[idx].onHtmlChange}
                />
              </div>
            )}

            {/* Dynamic Content Fields for Map */}
            {cType === 'Map' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Map Style</label>
                  <select
                    className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                    value={content.map_style || 'modern_dark'}
                    onChange={e => updateContent(idx, 'map_style', e.target.value)}
                  >
                    <option value="modern_dark">Modern Dark (Cyan & Slate)</option>
                    <option value="vintage">Vintage (Warm Amber)</option>
                    <option value="minimal_light">Minimal Light (Clean White)</option>
                    <option value="nautical_blue">Nautical Blue (Ocean & Gold)</option>
                  </select>
                </div>
                <div className="w-full">
                  <AstMapLocationsEditor
                    locations={content.locations || EMPTY_LIST}
                    onChange={layerCallbacks[idx].onLocationsChange}
                  />
                </div>
              </div>
            )}

            {/* Collapsible Advanced: Styling, Animations, Motion Blur, Floating & Camera Noise */}
            <div className="pt-2.5 border-t border-white/5">
              <button
                type="button"
                onClick={() => toggleAdvanced(idx)}
                className="w-full flex items-center justify-start gap-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <BsSliders size={11} className="text-amber-400" />
                  Advanced (Layout, Animations, Filters & Motion FX)
                </span>
                {isAdvancedOpen
                  ? <BsChevronDown size={11} className="ml-auto shrink-0" />
                  : <BsChevronRight size={11} className="ml-auto shrink-0" />}
              </button>

              {isAdvancedOpen && (
                <div className="space-y-3.5 pt-3">
                  {/* 4-Tab Segmented Bar */}
                  <div className="grid grid-cols-4 gap-1 p-1 bg-black/60 border border-white/10 rounded-lg">
                    {[
                      { id: 'layout', label: 'Layout', icon: '🪟' },
                      { id: 'animations', label: 'Animations', icon: '🚀' },
                      { id: 'filters', label: 'Filters', icon: '🎨' },
                      { id: 'motion', label: 'Motion FX', icon: '🎥' },
                    ].map(tab => {
                      const active = (advancedTab[idx] || 'layout') === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setAdvancedTab(prev => ({ ...prev, [idx]: tab.id as any }))}
                          className={`py-1 text-[10px] font-bold rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer truncate ${active
                              ? 'bg-amber-500 text-black shadow-sm font-extrabold'
                              : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                            }`}
                        >
                          <span>{tab.icon}</span>
                          <span className="truncate">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Tab 1: Layout & Cards */}
                  {(!advancedTab[idx] || advancedTab[idx] === 'layout') && (
                    <AstLayoutControls
                      style={content.style || EMPTY_STYLE}
                      onChange={layerCallbacks[idx].onStyleChange}
                    />
                  )}

                  {/* Tab 2: Animations */}
                  {advancedTab[idx] === 'animations' && (
                    <AstAnimationBuilder
                      animations={layer.animations || EMPTY_LIST}
                      onChange={layerCallbacks[idx].onAnimationsChange}
                    />
                  )}

                  {/* Tab 3: Filters */}
                  {advancedTab[idx] === 'filters' && (
                    <AstFilterControls
                      filters={layer.filters || EMPTY_LIST}
                      onChange={layerCallbacks[idx].onFiltersChange}
                    />
                  )}

                  {/* Tab 4: Motion & Camera FX */}
                  {advancedTab[idx] === 'motion' && (
                    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-3.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                        Motion Physics & Camera Dynamics
                      </div>

                      {/* Harmonic Floating & Motion Blur Toggles */}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer p-2 bg-black/50 border border-white/5 rounded-lg hover:border-amber-500/30 transition-colors">
                          <input
                            type="checkbox"
                            checked={!!layer.floating}
                            onChange={e => updateLayer(idx, 'floating', e.target.checked)}
                            className="rounded accent-amber-500 cursor-pointer"
                          />
                          <span>🌊 Harmonic Floating</span>
                        </label>

                        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer p-2 bg-black/50 border border-white/5 rounded-lg hover:border-amber-500/30 transition-colors">
                          <input
                            type="checkbox"
                            checked={!!layer.motion_blur}
                            onChange={e => updateLayer(idx, 'motion_blur', e.target.checked)}
                            className="rounded accent-amber-500 cursor-pointer"
                          />
                          <span>💨 Motion Blur</span>
                        </label>
                      </div>

                      {/* Shutter Angle Slider when motion blur is enabled */}
                      {layer.motion_blur && (
                        <div className="space-y-1 p-2.5 bg-black/50 border border-white/5 rounded-lg">
                          <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                            <span>Shutter Angle (Motion Blur Spread)</span>
                            <span className="text-amber-400 font-mono">{layer.shutter_angle ?? 180}°</span>
                          </div>
                          <input
                            type="range"
                            min="45"
                            max="360"
                            step="45"
                            value={layer.shutter_angle ?? 180}
                            onChange={e => updateLayer(idx, 'shutter_angle', parseInt(e.target.value, 10))}
                            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                          />
                          <div className="flex justify-between text-[8px] text-stone-500 font-mono">
                            <span>90° (Crisp)</span>
                            <span>180° (Cinematic 24fps)</span>
                            <span>360° (Dreamy)</span>
                          </div>
                        </div>
                      )}

                      {/* Camera Shake */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Camera Shake / Jitter</label>
                        <select
                          className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                          value={layer.camera_shake || 'none'}
                          onChange={e => updateLayer(idx, 'camera_shake', e.target.value)}
                        >
                          <option value="none">None (Rock Solid)</option>
                          <option value="handheld">Handheld Organic Drift</option>
                          <option value="shockwave">Earthquake Shockwave</option>
                          <option value="glitch">Glitch Jitter</option>
                        </select>
                      </div>

                      {/* Transform Origin Anchor Selection */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">Transform Origin (Anchor Point)</label>
                        <select
                          className="w-full bg-black/60 border border-white/10 text-xs text-stone-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                          value={layer.transform_origin || 'center center'}
                          onChange={e => updateLayer(idx, 'transform_origin', e.target.value)}
                        >
                          <option value="center center">Center Center (Default)</option>
                          <option value="top left">Top Left</option>
                          <option value="top center">Top Center</option>
                          <option value="top right">Top Right</option>
                          <option value="bottom left">Bottom Left</option>
                          <option value="bottom center">Bottom Center</option>
                          <option value="bottom right">Bottom Right</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Add New Layer Button */}
      <button
        type="button"
        onClick={handleAddLayer}
        className="w-full py-2.5 text-xs font-bold uppercase tracking-wider bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 border-dashed rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
      >
        <BsPlus size={16} /> Add Layer
      </button>

      {/* Lucide Icon Picker Modal */}
      <IconPickerModal
        isOpen={iconPickerIdx !== null}
        onClose={() => { iconPickerIdxRef.current = null; setIconPickerIdx(null); }}
        onSelectIcon={(iconName) => {
          if (iconPickerIdx !== null) {
            const currentContent = composition.children?.[iconPickerIdx]?.content || {};
            updateContentFields(iconPickerIdx, {
              type: 'Shape',
              shape_type: 'icon',
              icon_name: iconName,
              stroke: currentContent.stroke || currentContent.fill || '#00d4ff',
              stroke_width: currentContent.stroke_width ?? 2,
              radius: currentContent.radius ?? 50,
            });
          }
        }}
        currentIcon={iconPickerIdx !== null ? (composition.children?.[iconPickerIdx]?.content?.icon_name || 'trending-up') : undefined}
      />
    </div>
  );
};
