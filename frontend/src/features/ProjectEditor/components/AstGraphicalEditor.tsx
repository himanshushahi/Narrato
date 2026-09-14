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
import { normalizeLayerKind, getLayerCapability, getMotionState, isSvgLookToken, getStyleKeySupport, BLOCKED_STYLE_HINTS } from './layerCapabilities';
import { useEditorStore } from '../../../store/useEditorStore';
import { inferMediaType, isImageFile, isVideoFile } from '../../../utils/mediaExtensions';

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
  moveLayer: (idx: number, dir: -1 | 1) => void;
  reorderLayer: (from: number, to: number) => void;
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
  onDeleteLayer,
  onDuplicateLayer,
  onMoveLayer,
  onReorderLayer,
  uploadingSubVisual
}: {
  initialValue: any;
  onChange: (val: any) => void;
  onUploadSubVisual?: (visualType?: string, layerIdx?: number) => Promise<string | undefined> | void;
  onPreviewSubVisual?: (query: string, layerIdx?: number, visualType?: string) => Promise<string | undefined> | void;
  onDeleteLayer?: (layerIdx: number) => void;
  onDuplicateLayer?: (layerIdx: number) => void;
  onMoveLayer?: (fromIdx: number, toIdx: number) => void;
  onReorderLayer?: (fromIdx: number, toIdx: number) => void;
  uploadingSubVisual?: string | null;
}) => {
  // New layers must be manipulable on the canvas immediately. A layer with
  // no content.style resolves to fullscreen in layerToBox (CanvasOverlay +
  // ASTRenderer), and fullscreen boxes are select-only by design
  // (draggable = showHandles = !box.fullscreen). Query-less Image/Video also
  // renders as a fallback and would be dropped by backend sanitize.
  // Default to a centered HTML card so handles appear on first select.
  const DEFAULT_NEW_LAYER_STYLE = {
    position: 'absolute',
    left: '15%',
    top: '20%',
    width: '70%',
    height: '50%',
    borderRadius: '20px',
  };
  const DEFAULT_NEW_LAYER_HTML =
    "<div style='width:100%;height:100%;background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);border-radius:20px;border:1px solid rgba(255,255,255,0.12);'></div>";
  const hasLayoutBox = (style: any) => !!(
    style && (style.width || style.height || style.top || style.left || style.right || style.bottom || style.aspectRatio)
  );
  const isBrokenFullscreenMedia = (layer: any) => {
    const content = layer?.content;
    if (!content || (content.type !== 'Image' && content.type !== 'Video')) return false;
    if (hasLayoutBox(content.style)) return false;
    const query = content.query;
    const hasQuery = typeof query === 'string' ? query.trim() !== '' : !!query;
    const localPath = content.local_path;
    const hasAsset = typeof localPath === 'string' ? localPath.trim() !== '' : !!localPath;
    return !hasQuery && !hasAsset;
  };
  const repairBrokenLayers = (comp: any) => {
    if (!comp || typeof comp !== 'object' || !Array.isArray(comp.children)) return comp;
    let changed = false;
    const children = comp.children.map((l: any) => {
      if (isBrokenFullscreenMedia(l)) {
        changed = true;
        return { ...l, content: { ...l.content, style: { ...DEFAULT_NEW_LAYER_STYLE } } };
      }
      return l;
    });
    return changed ? { ...comp, children } : comp;
  };
  // Repair broken fullscreen media with a default positioned box so handles appear.
  const normalizeComp = (comp: any) => repairBrokenLayers(comp);

  const [composition, setComposition] = useState(() => {
    if (!initialValue || !initialValue.type) {
      return { type: 'Sequence', children: [] };
    }
    return normalizeComp(initialValue);
  });

  const [previewingIdx, setPreviewingIdx] = useState<number | null>(null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<Record<number, string | null>>({});
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<number, boolean>>({});
  const [advancedTab, setAdvancedTab] = useState<Record<number, 'layout' | 'animations' | 'filters' | 'motion'>>({});
  const [iconPickerIdx, setIconPickerIdx] = useState<number | null>(null);
  // Card collapse (reorder mode): true = header-only compact row for easy dragging.
  // Default expanded (false) so existing editing flow is unchanged.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // Text-shadow "Custom CSS…" editor open per layer. Needed because picking
  // Custom from an active preset writes back the identical string — a purely
  // value-derived select would snap back to the preset and never open.
  const [customShadowOpen, setCustomShadowOpen] = useState<Record<number, boolean>>({});
  // Drag-over target for drop indicator during HTML5 reorder drags.
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Shared canvas selection (preview overlay <-> editor). Clicking a layer card
  // selects it for the preview highlight; clicking a preview box selects +
  // scrolls to the card here (effect below).
  const selectedLayerIndex = useEditorStore((s) => s.selectedLayerIndex);
  const internalClickRef = useRef<number | null>(null);

  // When selection arrives from the preview overlay, reveal the card: expand
  // Advanced + jump to Layout tab + scroll into view. Clicks originated from inside
  // this editor skip the jump/scroll to preserve the user's active sub-tab.
  useEffect(() => {
    if (selectedLayerIndex === null || selectedLayerIndex === undefined) return;
    if (internalClickRef.current === selectedLayerIndex) {
      internalClickRef.current = null;
      return;
    }
    internalClickRef.current = null;
    setExpandedAdvanced((prev) => (prev[selectedLayerIndex] ? prev : { ...prev, [selectedLayerIndex]: true }));
    setAdvancedTab((prev) => (prev[selectedLayerIndex] ? prev : { ...prev, [selectedLayerIndex]: 'layout' }));
    // Un-collapse the card so canvas selection is always visible.
    setCollapsed((prev) => (prev[selectedLayerIndex] ? { ...prev, [selectedLayerIndex]: false } : prev));
    // Reveal without smooth scrolling: `behavior: 'smooth'` runs a main-thread
    // animation that janks rapid selection changes (canvas clicks, `[`/`]`
    // cycling) and fights the user's own scroll. `block: 'nearest'` already
    // no-ops when the card is visible, so this only jumps when needed.
    requestAnimationFrame(() => {
      document.querySelector(`[data-layer-idx="${selectedLayerIndex}"]`)?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    });
  }, [selectedLayerIndex]);

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

  // Latest-value refs so every mutator below reads current state even when
  // called through the stable api object (memoized panels, async handlers).
  // Synced in effects/events only — never during render (concurrent-mode tear).
  const compositionRef = useRef(composition);
  const onChangeRef = useRef(onChange);
  const onPreviewRef = useRef(onPreviewSubVisual);
  const onDeleteLayerRef = useRef(onDeleteLayer);
  const onDuplicateLayerRef = useRef(onDuplicateLayer);
  const onMoveLayerRef = useRef(onMoveLayer);
  const onReorderLayerRef = useRef(onReorderLayer);
  const iconPickerIdxRef = useRef(iconPickerIdx);
  useEffect(() => { compositionRef.current = composition; }, [composition]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onPreviewRef.current = onPreviewSubVisual; }, [onPreviewSubVisual]);
  useEffect(() => { onDeleteLayerRef.current = onDeleteLayer; }, [onDeleteLayer]);
  useEffect(() => { onDuplicateLayerRef.current = onDuplicateLayer; }, [onDuplicateLayer]);
  useEffect(() => { onMoveLayerRef.current = onMoveLayer; }, [onMoveLayer]);
  useEffect(() => { onReorderLayerRef.current = onReorderLayer; }, [onReorderLayer]);
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
    const repaired = normalizeComp(initialValue);
    if (repaired !== initialValue) {
      triggerChange(repaired);
    } else {
      setComposition(repaired);
    }
  }, [initialValue]);

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
    // Order-based stacking: appended = top (foreground).
    // HTML default with a positioned box so the new layer is manipulable on
    // the canvas immediately (no-style layers are fullscreen select-only).
    const newIdx = newComp.children.length;
    newComp.children.push({
      type: 'Layer',
      content: { type: 'HTML', html_content: DEFAULT_NEW_LAYER_HTML, style: { ...DEFAULT_NEW_LAYER_STYLE } }
    });
    triggerChange(newComp);
    // Reveal the new card and select it on the canvas so handles show at once.
    internalClickRef.current = newIdx;
    setExpandedAdvanced((prev) => ({ ...prev, [newIdx]: true }));
    setAdvancedTab((prev) => ({ ...prev, [newIdx]: 'layout' }));
    try {
      useEditorStore.getState().setSelectedLayerIndex(newIdx);
    } catch { /* store unavailable in isolation */ }
    requestAnimationFrame(() => {
      document.querySelector(`[data-layer-idx="${newIdx}"]`)?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    });
  };

  const remapIndexMap = (prev: Record<number, any>, map: (i: number) => number | null) => {
    const next: Record<number, any> = {};
    for (const [k, v] of Object.entries(prev)) {
      const ni = map(Number(k));
      if (ni !== null) next[ni] = v;
    }
    return next;
  };

  const handleMoveLayer = (idx: number, dir: -1 | 1) => {
    const kids = [...(compositionRef.current.children || [])];
    const j = idx + dir;
    if (idx < 0 || j < 0 || idx >= kids.length || j >= kids.length) return;
    onMoveLayerRef.current?.(idx, j);
    const newComp = { ...compositionRef.current };
    const next = [...kids];
    const [moved] = next.splice(idx, 1);
    next.splice(j, 0, moved);
    newComp.children = next;
    const map = (i: number) => (i === idx ? j : i === j ? idx : i);
    setExpandedAdvanced(prev => remapIndexMap(prev, map));
    setAdvancedTab(prev => remapIndexMap(prev, map));
    setCollapsed(prev => remapIndexMap(prev, map));
    setMediaError(prev => remapIndexMap(prev, map));
    setCustomShadowOpen(prev => remapIndexMap(prev, map));
    setPreviewingIdx(prev => (prev === null ? null : map(prev) ?? prev));
    setUploadingIdx(prev => (prev === null ? null : map(prev) ?? prev));
    setIconPickerIdx(prev => (prev === null ? null : map(prev) ?? prev));
    try {
      // Mark as internal so the selection effect doesn't auto-expand the card.
      internalClickRef.current = j;
      const sel = useEditorStore.getState().selectedLayerIndex;
      if (sel !== null && sel !== undefined) {
        useEditorStore.getState().setSelectedLayerIndex(map(sel) ?? sel);
      } else {
        useEditorStore.getState().setSelectedLayerIndex(j);
      }
    } catch { /* store unavailable in isolation */ }
    triggerChange(newComp);
  };

  const handleReorderLayer = (from: number, to: number) => {
    const kids = [...(compositionRef.current.children || [])];
    if (from === to || from < 0 || to < 0 || from >= kids.length || to >= kids.length) return;
    onReorderLayerRef.current?.(from, to);
    const newComp = { ...compositionRef.current };
    const next = [...kids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    newComp.children = next;
    const map = (i: number) => {
      if (i === from) return to;
      if (from < to) return i > from && i <= to ? i - 1 : i;
      return i >= to && i < from ? i + 1 : i;
    };
    setExpandedAdvanced(prev => remapIndexMap(prev, map));
    setAdvancedTab(prev => remapIndexMap(prev, map));
    setCollapsed(prev => remapIndexMap(prev, map));
    setMediaError(prev => remapIndexMap(prev, map));
    setCustomShadowOpen(prev => remapIndexMap(prev, map));
    setPreviewingIdx(prev => (prev === null ? null : map(prev)));
    setUploadingIdx(prev => (prev === null ? null : map(prev)));
    setIconPickerIdx(prev => (prev === null ? null : map(prev)));
    try {
      // Mark as internal so the selection effect doesn't auto-expand the card.
      internalClickRef.current = to;
      const sel = useEditorStore.getState().selectedLayerIndex;
      if (sel !== null && sel !== undefined) {
        useEditorStore.getState().setSelectedLayerIndex(map(sel));
      } else {
        useEditorStore.getState().setSelectedLayerIndex(to);
      }
    } catch { /* store unavailable in isolation */ }
    setDragOverIdx(null);
    triggerChange(newComp);
  };

  const handleDeleteLayer = (idx: number) => {
    onDeleteLayerRef.current?.(idx);
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.splice(idx, 1);
    setPreviewingIdx(prev => (prev === null ? null : prev === idx ? null : prev > idx ? prev - 1 : prev));
    setUploadingIdx(prev => (prev === null ? null : prev === idx ? null : prev > idx ? prev - 1 : prev));
    setIconPickerIdx(prev => (prev === null ? null : prev === idx ? null : prev > idx ? prev - 1 : prev));
    // Keep canvas selection valid across delete (same shift pattern as above).
    try {
      const sel = useEditorStore.getState().selectedLayerIndex;
      if (sel !== null && sel !== undefined) {
        useEditorStore.getState().setSelectedLayerIndex(sel === idx ? null : sel > idx ? sel - 1 : sel);
      }
    } catch { /* store unavailable in isolation */ }
    setExpandedAdvanced(prev => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
    setAdvancedTab(prev => {
      const next: Record<number, any> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
    setCollapsed(prev => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
    setMediaError(prev => {
      const next: Record<number, string | null> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
    setCustomShadowOpen(prev => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
    triggerChange(newComp);
  };

  const handleDuplicateLayer = (idx: number) => {
    onDuplicateLayerRef.current?.(idx);
    const newComp = { ...compositionRef.current };
    newComp.children = newComp.children ? [...newComp.children] : [];
    const clone = JSON.parse(JSON.stringify(newComp.children[idx]));
    // Order-based stacking: duplicate lands directly above original.
    newComp.children.splice(idx + 1, 0, clone);
    setPreviewingIdx(prev => (prev === null ? null : prev > idx ? prev + 1 : prev));
    setUploadingIdx(prev => (prev === null ? null : prev > idx ? prev + 1 : prev));
    setIconPickerIdx(prev => (prev === null ? null : prev > idx ? prev + 1 : prev));
    // Shift selection across duplicate (+1 for elements after the duplicated index).
    try {
      const sel = useEditorStore.getState().selectedLayerIndex;
      if (sel !== null && sel !== undefined) {
        useEditorStore.getState().setSelectedLayerIndex(sel === idx ? idx + 1 : sel > idx ? sel + 1 : sel);
      }
    } catch { /* store unavailable in isolation */ }
    setExpandedAdvanced(prev => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i <= idx) next[i] = v;
        else next[i + 1] = v;
      }
      return next;
    });
    setAdvancedTab(prev => {
      const next: Record<number, any> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i <= idx) next[i] = v;
        else next[i + 1] = v;
      }
      return next;
    });
    setCollapsed(prev => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i <= idx) next[i] = v;
        else next[i + 1] = v;
      }
      return next;
    });
    setMediaError(prev => {
      const next: Record<number, string | null> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i <= idx) next[i] = v;
        else next[i + 1] = v;
      }
      return next;
    });
    triggerChange(newComp);
  };

  const handlePreviewQuery = async (idx: number, queryToSearch: string) => {
    if (!queryToSearch || !onPreviewRef.current) return;
    const currentLayer = compositionRef.current?.children?.[idx];
    const currentType = currentLayer?.content?.type || 'Image';
    const isMediaLayer = currentType === 'Image' || currentType === 'Video';
    const vType = currentType === 'Video' ? 'video' : 'image';
    setPreviewingIdx(idx);
    setMediaError(prev => ({ ...prev, [idx]: null }));
    try {
      const p = await onPreviewRef.current(queryToSearch, idx, vType);
      if (p) {
        // STRICT: reject mismatched preview instead of silently flipping type.
        // Non-media layers (Text/Shape/...) may adopt either type explicitly.
        if (isMediaLayer) {
          const ok = currentType === 'Video' ? isVideoFile(p) : isImageFile(p);
          if (!ok) {
            const msg = currentType === 'Video'
              ? `Preview returned an image but this layer is Video — rejected. Change layer type to Image first.`
              : `Preview returned a video but this layer is Image — rejected. Change layer type to Video first.`;
            console.warn(`[AstGraphicalEditor] ${msg} path=${p}`);
            setMediaError(prev => ({ ...prev, [idx]: msg }));
            return;
          }
          updateContent(idx, 'local_path', p);
        } else {
          const newType = inferMediaType(p, currentType);
          updateContentFields(idx, { local_path: p, type: newType });
        }
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

  const toggleCollapse = (idx: number) => {
    setCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const collapseAll = () => {
    const count = (compositionRef.current.children || []).length;
    const next: Record<number, boolean> = {};
    for (let i = 0; i < count; i++) next[i] = true;
    setCollapsed(next);
  };

  const expandAll = () => {
    setCollapsed({});
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
    moveLayer: (idx, dir) => handleMoveLayer(idx, dir),
    reorderLayer: (from, to) => handleReorderLayer(from, to),
    previewQuery: (idx, query) => { void handlePreviewQuery(idx, query); },
    toggleAdvanced: (idx) => toggleAdvanced(idx),
    setAdvancedTab: (idx, tab) => setAdvancedTab(prev => ({ ...prev, [idx]: tab })),
    openIconPicker: (idx) => { iconPickerIdxRef.current = idx; setIconPickerIdx(idx); },
    changeType: (idx, newType) => {
      setMediaError(prev => ({ ...prev, [idx]: null }));
      const comp = compositionRef.current;
      const copy = { ...comp };
      copy.children = [...(copy.children || [])];
      const oldLayer = copy.children[idx] || {};
      const newContent = { ...(oldLayer.content || {}), type: newType };
      if (newType !== 'HTML' && oldLayer.content?.type === 'HTML') {
        delete newContent.html_content;
      }
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
  const dragFromRef = useRef<number | null>(null);

  return (
    <div className="space-y-3 w-full min-w-0">
      {layers.length > 1 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            {layers.length} layers · bottom = background, top = foreground
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={collapseAll}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors cursor-pointer"
              title="Collapse all to compact rows for easy drag-reorder"
            >Collapse all</button>
            <button
              type="button"
              onClick={expandAll}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors cursor-pointer"
              title="Expand all layer editors"
            >Expand all</button>
          </div>
        </div>
      )}
      {/* Photoshop-style: top of stack at top of panel. Data stays children[0]=bottom;
          only display order is reversed. All handlers keep using the real idx. */}
      {[...layers.keys()].reverse().map((idx: number) => {
        const layer = layers[idx];
        const content = (layer as any).content || {};
        const cType = content.type || 'Image';
        const isAdvancedOpen = !!expandedAdvanced[idx];
        const isCollapsed = !!collapsed[idx];
        const layerKind = normalizeLayerKind(cType);
        const layerCap = getLayerCapability(layerKind);
        // Phase 3: flag style keys with no visual editor (blocked = outside
        // the validator allowlist, e.g. legacy `transform`; advanced =
        // renders but has no control yet). Derived from data — clears itself
        // when fixed. Lottie `src` is content-level but equally invisible.
        const styleSupport = getStyleKeySupport(layerKind, (content as any).style);
        const blockedKeys = [...styleSupport.blocked];
        if (cType === 'Lottie' && typeof (content as any).src === 'string' && (content as any).src.trim() !== '') {
          blockedKeys.push('src');
        }
        const keyIssueCount = blockedKeys.length + styleSupport.advanced.length;
        const motionState = getMotionState({
          motionBlur: !!layer.motion_blur,
          animations: layer.animations || [],
          floating: !!layer.floating,
          cameraShake: layer.camera_shake,
        });

        return (
          <div
            // Index-bound key: layers have no stable ids. Keep the layer shell
            // stable across in-place type switches (Image<->Video share a branch)
            // so focus and per-layer drafts survive; type-specific sub-panels
            // are different component types and remount on their own.
            key={idx}
            data-layer-idx={idx}
            onClick={() => {
              internalClickRef.current = idx;
              useEditorStore.getState().setSelectedLayerIndex(idx);
            }}
            onDragOver={(e) => { if (dragFromRef.current !== null && dragFromRef.current !== idx) { e.preventDefault(); setDragOverIdx(idx); } }}
            onDragLeave={() => { setDragOverIdx(prev => (prev === idx ? null : prev)); }}
            onDrop={(e) => { e.preventDefault(); setDragOverIdx(null); const from = dragFromRef.current; dragFromRef.current = null; if (from !== null && from !== idx) handleReorderLayer(from, idx); }}
            className={`p-3 bg-zinc-900/70 border rounded-xl ${isCollapsed ? 'space-y-0' : 'space-y-3'} relative group/layer transition-all shadow-sm w-full min-w-0 cursor-pointer ${dragOverIdx === idx ? 'border-sky-400/70 shadow-[0_0_18px_rgba(56,189,248,0.25)]' : selectedLayerIndex === idx ? 'border-amber-500/60 shadow-[0_0_18px_rgba(245,158,11,0.12)]' : 'border-zinc-800/90 hover:border-zinc-700/80'}`}
          >
            {/* Header: Collapse toggle, Layer Title, Order controls, and Action Buttons */}
            <div className={`flex items-center justify-between gap-2 ${isCollapsed ? '' : 'pb-2 border-b border-white/5'}`}>
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(idx); }}
                  className="p-1 text-stone-400 hover:text-amber-400 transition-colors cursor-pointer shrink-0"
                  title={isCollapsed ? 'Expand layer editor' : 'Collapse to compact row for drag-reorder'}
                >
                  {isCollapsed
                    ? <BsChevronRight size={12} />
                    : <BsChevronDown size={12} />}
                </button>
                <span
                  draggable
                  onDragStart={(e) => { dragFromRef.current = idx; try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* WebView2 may throw */ } e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(null); const from = dragFromRef.current; dragFromRef.current = null; if (from !== null && from !== idx) handleReorderLayer(from, idx); }}
                  onDragEnd={() => { dragFromRef.current = null; setDragOverIdx(null); }}
                  onClick={(e) => e.stopPropagation()}
                  title="Drag to reorder (bottom=background, top=foreground)"
                  className="text-stone-500 hover:text-amber-400 cursor-grab active:cursor-grabbing shrink-0 px-0.5 select-none"
                >⋮⋮</span>
                <span className="text-xs font-bold text-amber-400 shrink-0 whitespace-nowrap">Layer {idx + 1}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-500 shrink-0">
                  {idx === 0 ? '· bottom' : idx === layers.length - 1 ? '· top' : ''}
                </span>
                <span className="text-[10px] font-semibold text-stone-300 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap">{cType}</span>
                {keyIssueCount > 0 && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap border ${
                      blockedKeys.length > 0
                        ? 'text-red-400 bg-red-500/10 border-red-500/30'
                        : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                    }`}
                    title={[
                      blockedKeys.length > 0 ? `Unsupported keys (stripped by validator): ${blockedKeys.join(', ')}` : null,
                      styleSupport.advanced.length > 0 ? `Advanced keys (no visual editor): ${styleSupport.advanced.join(', ')}` : null,
                    ].filter(Boolean).join(' · ')}
                  >
                    {blockedKeys.length > 0 ? `⛔ unsupported${keyIssueCount > 1 ? ` ×${keyIssueCount}` : ''}` : `⚠ advanced${styleSupport.advanced.length > 1 ? ` ×${styleSupport.advanced.length}` : ''}`}
                  </span>
                )}
                {isCollapsed && (
                  <span className="text-[11px] text-stone-500 truncate min-w-0">
                    {(content.text || content.query || content.html_content || content.chart_type || content.shape_type || content.icon_name || '')
                      .toString().replace(/<[^>]*>/g, '').slice(0, 40)}
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={(e) => { e.stopPropagation(); handleMoveLayer(idx, -1); }}
                    className="px-1.5 py-0.5 text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-30 text-xs"
                    title="Move down (toward background)"
                  >↓</button>
                  <button
                    type="button"
                    disabled={idx === layers.length - 1}
                    onClick={(e) => { e.stopPropagation(); handleMoveLayer(idx, 1); }}
                    className="px-1.5 py-0.5 text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-30 text-xs"
                    title="Move up (toward foreground)"
                  >↑</button>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicateLayer(idx);
                  }}
                  className="p-1.5 text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 rounded-md transition-colors cursor-pointer shrink-0"
                  title="Duplicate Layer"
                >
                  <BiCopy size={13} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLayer(idx);
                  }}
                  className="p-1.5 text-red-400/80 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md transition-colors cursor-pointer shrink-0"
                  title="Delete Layer"
                >
                  <BiTrashAlt size={13} />
                </button>
              </div>
            </div>

            {!isCollapsed && (
            <>
            {keyIssueCount > 0 && (
              <div className={`rounded-lg border px-2.5 py-2 space-y-1 text-[11px] leading-relaxed ${
                blockedKeys.length > 0
                  ? 'bg-red-500/10 border-red-500/30 text-red-200/90'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200/90'
              }`}>
                {blockedKeys.map((k) => (
                  <div key={`blocked-${k}`}>
                    ⛔ <code className="font-mono font-bold">{k}</code>
                    {BLOCKED_STYLE_HINTS[k] ? ` — ${BLOCKED_STYLE_HINTS[k]}` : ' — unsupported (stripped by the validator).'}
                  </div>
                ))}
                {styleSupport.advanced.map((k) => (
                  <div key={`adv-${k}`}>
                    ⚠ <code className="font-mono font-bold">{k}</code> — renders, but has no visual editor yet.
                  </div>
                ))}
              </div>
            )}
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
                          disabled={uploadingIdx !== null || uploadingSubVisual !== null}
                          onClick={async () => {
                            setUploadingIdx(idx);
                            setMediaError(prev => ({ ...prev, [idx]: null }));
                            try {
                              const p = await onUploadSubVisual(cType === 'Image' ? 'image' : cType === 'Video' ? 'video' : 'ast', idx);
                              if (p) {
                                // STRICT: Image layers accept images only, Video layers videos only.
                                // Never silently flip content.type — reject with an inline error.
                                const isMediaLayer = cType === 'Image' || cType === 'Video';
                                if (isMediaLayer) {
                                  const ok = cType === 'Video' ? isVideoFile(p) : isImageFile(p);
                                  if (!ok) {
                                    const msg = cType === 'Video'
                                      ? `That file is an image — Video layer rejected it. Change layer type to Image first.`
                                      : `That file is a video — Image layer rejected it. Change layer type to Video first.`;
                                    console.warn(`[AstGraphicalEditor] ${msg} path=${p}`);
                                    setMediaError(prev => ({ ...prev, [idx]: msg }));
                                    return;
                                  }
                                  updateContentFields(idx, { local_path: p, source: 'upload' });
                                } else {
                                  const newType = inferMediaType(p, cType);
                                  const extra = newType === 'Video' ? { volume: 0 } : {};
                                  updateContentFields(idx, { local_path: p, source: 'upload', type: newType, ...extra });
                                }
                              }
                            } finally {
                              setUploadingIdx(null);
                            }
                          }}
                          className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[10px] uppercase font-bold rounded-md flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                          title="Upload media file"
                        >
                          {uploadingIdx === idx ? <div className="w-2.5 h-2.5 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : <BsUpload size={10} />}
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
                  {mediaError[idx] && (
                    <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5">
                      {mediaError[idx]}
                    </p>
                  )}
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

                {/* Object Fit (how media fills its layout box) */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Object Fit</label>
                  <select
                    className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    value={content.style?.objectFit || 'cover'}
                    onChange={e => api.updateContent(idx, 'style', { ...(content.style || {}), objectFit: e.target.value })}
                  >
                    <option value="cover">Cover (fill box, crop edges)</option>
                    <option value="contain">Contain (fit inside, letterbox)</option>
                    <option value="fill">Fill (stretch to box)</option>
                  </select>
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
                      <option value="typewriter">Typewriter (Caret)</option>
                      <option value="marker_highlight">Marker Highlight</option>
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

                {(content.animation_mode === 'marker_highlight' || content.animation_mode === 'words_stagger') && (
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

                {/* Font Size: slider + exact entry. Stored as `style.fontSize`
                    ("180px") — the same key the renderer and overlay already
                    read. Empty exact-entry clears the key (renderer default). */}
                {(() => {
                  const st = ((content.style || {}) as Record<string, any>);
                  const rawFs = st.fontSize;
                  const parsedFs = typeof rawFs === 'number' ? rawFs : parseFloat(String(rawFs ?? ''));
                  const fontPx = Number.isFinite(parsedFs) && (parsedFs as number) > 0
                    ? Math.round(parsedFs as number)
                    : null;
                  // Effective default mirrors the renderer (64px with custom
                  // layout, 100px free text) so the label never lies.
                  const hasLayout = ['width', 'height', 'top', 'left', 'right', 'bottom', 'aspectRatio']
                    .some((k) => st[k] !== undefined && st[k] !== null && String(st[k]).trim() !== '');
                  const effectiveFs = fontPx ?? (hasLayout ? 64 : 100);
                  const writeFs = (val: string) => {
                    const v = parseFloat(val);
                    if (!Number.isFinite(v) || v <= 0) {
                      const next = { ...(content.style || {}) } as Record<string, any>;
                      delete next.fontSize;
                      updateContentFields(idx, { style: next });
                    } else {
                      const n = Math.max(8, Math.min(500, Math.round(v)));
                      updateContentFields(idx, { style: { ...(content.style || {}), fontSize: `${n}px` } });
                    }
                  };
                  return (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        <span>Font Size</span>
                        <span className="text-amber-400 font-mono">
                          {fontPx !== null ? `${fontPx}px` : `${effectiveFs}px (Auto)`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="12"
                          max="320"
                          step="1"
                          value={Math.max(12, Math.min(320, effectiveFs))}
                          onChange={e => writeFs(e.target.value)}
                          className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded"
                          title="Text size in px (composition space). Clearing the exact value restores the renderer default."
                        />
                        <input
                          type="number"
                          min="8"
                          max="500"
                          value={fontPx ?? ''}
                          placeholder={String(effectiveFs)}
                          onChange={e => writeFs(e.target.value)}
                          className="w-16 bg-black/60 border border-white/10 text-stone-200 text-xs font-mono rounded px-1.5 py-0.5 text-center focus:outline-none focus:border-amber-500/50"
                          title="Exact size in px — clear to restore the renderer default"
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* Advanced Typography: Line Height, Letter Spacing.
                    Stored as style.lineHeight (number) / style.letterSpacing
                    ("Npx") — both read by the renderer AND the overlay
                    estimator, so boxes stay truthful. Empty clears the key. */}
                <div className="grid grid-cols-2 gap-2.5">
                  {(() => {
                    const st = ((content.style || {}) as Record<string, any>);
                    const rawLh = typeof st.lineHeight === 'number' ? st.lineHeight : parseFloat(String(st.lineHeight ?? ''));
                    const lh = Number.isFinite(rawLh) && (rawLh as number) > 0 ? (rawLh as number) : null;
                    const effLh = lh ?? 1.25;
                    const writeLh = (val: string) => {
                      const v = parseFloat(val);
                      if (!Number.isFinite(v) || v <= 0) {
                        const next = { ...(content.style || {}) } as Record<string, any>;
                        delete next.lineHeight;
                        updateContentFields(idx, { style: next });
                      } else {
                        const n = Math.max(0.5, Math.min(3, Math.round(v * 100) / 100));
                        updateContentFields(idx, { style: { ...(content.style || {}), lineHeight: n } });
                      }
                    };
                    return (
                      <div className="space-y-1 min-w-0">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-stone-400">
                          <span>Line Height</span>
                          <span className="text-amber-400 font-mono">
                            {lh !== null ? lh.toFixed(2) : `${effLh.toFixed(2)} (Auto)`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="1"
                            max="2"
                            step="0.05"
                            value={Math.max(1, Math.min(2, effLh))}
                            onChange={e => writeLh(e.target.value)}
                            className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded min-w-0"
                            title="Line spacing multiplier (multi-line text box height)"
                          />
                          <input
                            type="number"
                            min="0.5"
                            max="3"
                            step="0.05"
                            value={lh ?? ''}
                            placeholder={effLh.toFixed(2)}
                            onChange={e => writeLh(e.target.value)}
                            className="w-14 bg-black/60 border border-white/10 text-stone-200 text-xs font-mono rounded px-1 py-0.5 text-center focus:outline-none focus:border-amber-500/50 shrink-0"
                            title="Exact line-height multiplier — clear for renderer default"
                          />
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const st = ((content.style || {}) as Record<string, any>);
                    const rawLs = st.letterSpacing;
                    const parsedLs = typeof rawLs === 'number' ? rawLs : parseFloat(String(rawLs ?? ''));
                    const ls = Number.isFinite(parsedLs) ? Math.round(parsedLs * 10) / 10 : null;
                    const writeLs = (val: string) => {
                      const v = parseFloat(val);
                      if (!val.trim() || !Number.isFinite(v)) {
                        const next = { ...(content.style || {}) } as Record<string, any>;
                        delete next.letterSpacing;
                        updateContentFields(idx, { style: next });
                      } else {
                        const n = Math.max(-10, Math.min(60, Math.round(v * 10) / 10));
                        updateContentFields(idx, { style: { ...(content.style || {}), letterSpacing: `${n}px` } });
                      }
                    };
                    return (
                      <div className="space-y-1 min-w-0">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-stone-400">
                          <span>Spacing</span>
                          <span className="text-amber-400 font-mono">
                            {ls !== null ? `${ls}px` : '0px (Auto)'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="-2"
                            max="24"
                            step="0.5"
                            value={Math.max(-2, Math.min(24, ls ?? 0))}
                            onChange={e => writeLs(e.target.value)}
                            className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-black/60 rounded min-w-0"
                            title="Letter spacing in px (tracking)"
                          />
                          <input
                            type="number"
                            min="-10"
                            max="60"
                            step="0.5"
                            value={ls ?? ''}
                            placeholder="0"
                            onChange={e => writeLs(e.target.value)}
                            className="w-14 bg-black/60 border border-white/10 text-stone-200 text-xs font-mono rounded px-1 py-0.5 text-center focus:outline-none focus:border-amber-500/50 shrink-0"
                            title="Exact letter-spacing in px — clear for normal"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Typography Attributes: Weight, Color, Alignment & Style */}
                <div className="grid grid-cols-2 gap-2">
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

                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Style</label>
                    <select
                      className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-1.5 py-1 focus:outline-none cursor-pointer font-medium"
                      value={(content.style as any)?.fontStyle || 'normal'}
                      onChange={e => {
                        if (e.target.value === 'normal') {
                          const next = { ...(content.style || {}) } as Record<string, any>;
                          delete next.fontStyle;
                          updateContentFields(idx, { style: next });
                        } else {
                          updateContentFields(idx, { style: { ...(content.style || {}), fontStyle: e.target.value } });
                        }
                      }}
                    >
                      <option value="normal">Normal</option>
                      <option value="italic">Italic</option>
                    </select>
                  </div>
                </div>

                {/* Text Shadow: presets + custom CSS. Stored as `style.textShadow`
                    (renderer default when unset). Picking "Custom CSS…" pins the
                    current effective value into the key so it can be edited. */}
                {(() => {
                  const st = ((content.style || {}) as Record<string, any>);
                  const CUSTOM = '__custom__';
                  const PRESETS: { label: string; value: string }[] = [
                    { label: 'Soft Shadow (Default)', value: '' },
                    { label: 'None (Off)', value: 'none' },
                    { label: 'Strong Drop', value: '0 6px 30px rgba(0,0,0,0.9)' },
                    { label: 'Neon Cyan Glow', value: '0 0 40px rgba(0, 212, 255, 0.8), 0 0 80px rgba(0, 212, 255, 0.5)' },
                    { label: 'Neon Amber Glow', value: '0 0 30px rgba(250,204,21,0.8), 0 4px 20px rgba(0,0,0,0.8)' },
                  ];
                  const raw = typeof st.textShadow === 'string' ? st.textShadow.trim() : '';
                  const customOpen = !!customShadowOpen[idx];
                  const selVal = customOpen
                    ? CUSTOM
                    : (PRESETS.some((p) => p.value === raw) ? raw : (raw ? CUSTOM : ''));
                  const closeCustom = () => {
                    setCustomShadowOpen((prev) => {
                      if (!prev[idx]) return prev;
                      const next = { ...prev };
                      delete next[idx];
                      return next;
                    });
                  };
                  return (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Text Shadow</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer font-medium"
                        value={selVal}
                        onChange={e => {
                          const v = e.target.value;
                          if (v === CUSTOM) {
                            // Open the editor on the current effective value
                            // (preset string becomes the editable starting
                            // point; Default seeds the renderer default).
                            setCustomShadowOpen((prev) => ({ ...prev, [idx]: true }));
                            if (!raw) {
                              updateContentFields(idx, { style: { ...(content.style || {}), textShadow: '0 4px 20px rgba(0,0,0,0.8)' } });
                            }
                            return;
                          }
                          closeCustom();
                          if (v === '') {
                            const next = { ...(content.style || {}) } as Record<string, any>;
                            delete next.textShadow;
                            updateContentFields(idx, { style: next });
                          } else {
                            updateContentFields(idx, { style: { ...(content.style || {}), textShadow: v } });
                          }
                        }}
                      >
                        {PRESETS.map((p) => (
                          <option key={p.label} value={p.value} className="bg-zinc-950 text-stone-200 font-normal">
                            {p.label}
                          </option>
                        ))}
                        <option value={CUSTOM} className="bg-zinc-950 text-stone-200 font-normal">Custom CSS…</option>
                      </select>
                      {selVal === CUSTOM && (
                        <input
                          type="text"
                          className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 font-mono"
                          value={typeof st.textShadow === 'string' ? st.textShadow : ''}
                          onChange={e => {
                            const v = e.target.value;
                            if (!v.trim()) {
                              closeCustom();
                              const next = { ...(content.style || {}) } as Record<string, any>;
                              delete next.textShadow;
                              updateContentFields(idx, { style: next });
                            } else {
                              updateContentFields(idx, { style: { ...(content.style || {}), textShadow: v } });
                            }
                          }}
                          placeholder="e.g. 0 4px 20px rgba(0,0,0,0.8)"
                          spellCheck={false}
                        />
                      )}
                    </div>
                  );
                })()}
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

                {/* Chart Theme Overrides */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Title Size (px)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.title_size ?? ''}
                      onChange={e => updateContent(idx, 'title_size', e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined)}
                      placeholder="28"
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Bar Radius (px)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.bar_radius ?? ''}
                      onChange={e => updateContent(idx, 'bar_radius', e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined)}
                      placeholder="10"
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Bar Gap (px)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.bar_gap ?? ''}
                      onChange={e => updateContent(idx, 'bar_gap', e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined)}
                      placeholder="16"
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Bar Max W (px)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                      value={content.bar_max_width ?? ''}
                      onChange={e => updateContent(idx, 'bar_max_width', e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined)}
                      placeholder="90"
                    />
                  </div>
                </div>
                {/* Accent Color: drives the chart primary color (line stroke,
                    pie/donut fills fallback). Stored as style.color; empty
                    restores the renderer default (#00d4ff). */}
                <div className="space-y-1 min-w-0">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Accent Color</label>
                  <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50 min-w-0">
                    <input
                      type="color"
                      value={((content.style as any)?.color?.startsWith('#') && (content.style as any)?.color.length === 7) ? (content.style as any).color : '#00d4ff'}
                      onChange={e => updateContentFields(idx, { style: { ...(content.style || {}), color: e.target.value } })}
                      className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                    />
                    <input
                      type="text"
                      className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
                      value={(content.style as any)?.color || ''}
                      onChange={e => {
                        if (!e.target.value.trim()) {
                          const next = { ...(content.style || {}) } as Record<string, any>;
                          delete next.color;
                          updateContentFields(idx, { style: next });
                        } else {
                          updateContentFields(idx, { style: { ...(content.style || {}), color: e.target.value } });
                        }
                      }}
                      placeholder="#00d4ff"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={content.bar_glow !== false}
                    onChange={e => updateContent(idx, 'bar_glow', e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer"
                  />
                  Neon Bar Glow
                </label>
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
                    colors={content.particle_colors}
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

                {content.shape_type === 'rectangle' && (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-3 gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Width (px)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                        value={content.width ?? ''}
                        onChange={e => updateContent(idx, 'width', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="auto"
                      />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Height (px)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                        value={content.height ?? ''}
                        onChange={e => updateContent(idx, 'height', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="auto"
                      />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Corner R (px)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                        value={content.corner_radius ?? 16}
                        onChange={e => updateContent(idx, 'corner_radius', parseFloat(e.target.value) || 0)}
                        placeholder="16"
                      />
                    </div>
                    </div>
                    <p className="text-[9px] text-stone-500">Set both Width + Height for fixed size, else fills layer.</p>
                  </div>
                )}

                {(content.shape_type === 'arrow' || content.shape_type === 'triangle') && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Direction</label>
                      <select
                        className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                        value={content.direction || (content.shape_type === 'arrow' ? 'right' : 'up')}
                        onChange={e => updateContent(idx, 'direction', e.target.value)}
                      >
                        <option value="up">Up</option>
                        <option value="down">Down</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                    <div className="space-y-1 min-w-0">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Angle (deg)</label>
                      <input
                        type="number"
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                        value={content.angle ?? ''}
                        onChange={e => updateContent(idx, 'angle', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="0"
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
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1 min-w-0">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Path Preset</label>
                        <select
                          className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                          value={content.preset_path || ''}
                          onChange={e => updateContent(idx, 'preset_path', e.target.value || undefined)}
                        >
                          <option value="">Custom (path_d below)</option>
                          <option value="route_arch">Route Arch (maps/trajectories)</option>
                          <option value="horizontal_line">Horizontal Line (dividers)</option>
                          <option value="pointer_curve">Pointer Curve (callouts)</option>
                          <option value="corner_brackets">Corner Brackets (HUD frame)</option>
                          <option value="wave_pulse">Wave Pulse (waveform)</option>
                          <option value="circle_reticle">Circle Reticle (target)</option>
                        </select>
                      </div>
                      <div className="space-y-1 min-w-0">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">View Box</label>
                        <input
                          type="text"
                          className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
                          value={content.view_box || ''}
                          onChange={e => updateContent(idx, 'view_box', e.target.value || undefined)}
                          placeholder="0 0 1920 1080"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">SVG Path Data (d attribute)</label>
                      <textarea
                        className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 font-mono focus:outline-none focus:border-amber-500/50 min-h-[50px]"
                        value={content.path_d || ''}
                        onChange={e => updateContent(idx, 'path_d', e.target.value)}
                        placeholder="M 10,50 Q 50,10 90,50..."
                      />
                    </div>
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

                  {/* Tab 1: Layout */}
                  {(!advancedTab[idx] || advancedTab[idx] === 'layout') && (
                    <AstLayoutControls
                      style={content.style || EMPTY_STYLE}
                      onChange={layerCallbacks[idx].onStyleChange}
                      isMedia={layerKind === 'Image' || layerKind === 'Video'}
                      dimensionsNote={layerCap.dimensionsNote ?? null}
                      transformNote={layerCap.transformNote ?? null}
                    />
                  )}

                  {/* Tab 2: Animations (universal — wrapper transform applies to every type) */}
                  {advancedTab[idx] === 'animations' && (
                    <div className="space-y-2.5">
                      {layerKind === 'Text' && content.animation_mode && content.animation_mode !== 'static' && (
                        <div className="p-2.5 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
                          ℹ️ This text already animates internally ({content.animation_mode}). Layer keyframes stack on top — prefer one system to avoid double-transform timing clashes.
                        </div>
                      )}
                      {(layerKind === 'Particles' || layerKind === 'Map') && (
                        <div className="p-2.5 bg-sky-500/10 border border-sky-500/25 rounded-lg text-[10px] leading-relaxed text-sky-200/90">
                          ℹ️ [{layerKind}] is a full-frame canvas — 3D tilt (rotateX/Y) or large slides rotate the whole canvas and expose rectangular clipping edges. Opacity/scale keyframes are safest here.
                        </div>
                      )}
                      <AstAnimationBuilder
                        animations={layer.animations || EMPTY_LIST}
                        onChange={layerCallbacks[idx].onAnimationsChange}
                      />
                    </div>
                  )}

                  {/* Tab 3: Filters */}
                  {advancedTab[idx] === 'filters' && (
                    <AstFilterControls
                      filters={layer.filters || EMPTY_LIST}
                      onChange={layerCallbacks[idx].onFiltersChange}
                      typeHint={layerCap.filterNote ?? null}
                      layerTypeLabel={layerKind}
                      disableSvgLooks={layerCap.disableSvgLooks ?? false}
                      svgDisabledReason={layerCap.filterNote ?? null}
                      hasStaleSvgLooks={
                        !!layerCap.disableSvgLooks &&
                        (layer.filters || []).some((f: string) => isSvgLookToken(f))
                      }
                      onClearSvgLooks={() => {
                        const next = (layer.filters || []).filter(
                          (f: string) => !isSvgLookToken(f),
                        );
                        api.updateLayer(idx, 'filters', next);
                      }}
                      blendHint={
                        layers.length <= 1 || idx === 0
                          ? 'Blend needs a layer beneath to show — no visible change on a single opaque fullscreen layer.'
                          : null
                      }
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

                        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 cursor-pointer p-2 bg-black/50 border border-white/5 rounded-lg hover:border-amber-500/30 transition-colors" title={layer.motion_blur && !motionState.hasMotion ? 'Motion Blur is a no-op on this static layer — add an animation, floating or camera shake first (values are preserved)' : 'Physical shutter blur for moving layers'}>
                          <input
                            type="checkbox"
                            checked={!!layer.motion_blur}
                            onChange={e => updateLayer(idx, 'motion_blur', e.target.checked)}
                            className="rounded accent-amber-500 cursor-pointer"
                          />
                          <span>💨 Motion Blur</span>
                        </label>
                      </div>

                      {layer.motion_blur && !motionState.hasMotion && (
                        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] leading-relaxed text-amber-200/90">
                          ⚠️ Blur is armed but this [{layerKind}] layer is static — the renderer bypasses shutter blur without animations, floating or shake. Add a keyframe to activate it.
                        </div>
                      )}

                      {/* Shutter Angle Slider — always visible so the disabled reason is discoverable */}
                      <div
                        className={`space-y-1 p-2.5 bg-black/50 border border-white/5 rounded-lg ${motionState.shutterDisabled ? 'opacity-60' : ''}`}
                        title={motionState.shutterReason ?? undefined}
                      >
                        <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-stone-400">
                          <span>Shutter Angle (Motion Blur Spread)</span>
                          <span className="text-amber-400 font-mono">{layer.shutter_angle ?? 180}°</span>
                        </div>
                        <div title={motionState.shutterReason ?? undefined}>
                          <input
                            type="range"
                            min="45"
                            max="360"
                            step="45"
                            value={layer.shutter_angle ?? 180}
                            disabled={motionState.shutterDisabled}
                            onChange={e => updateLayer(idx, 'shutter_angle', parseInt(e.target.value, 10))}
                            className="w-full accent-amber-500 h-1.5 bg-black/60 rounded disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          />
                        </div>
                        <div className="flex justify-between text-[8px] text-stone-500 font-mono">
                          <span>90° (Crisp)</span>
                          <span>180° (Cinematic 24fps)</span>
                          <span>360° (Dreamy)</span>
                        </div>
                        {motionState.shutterReason && (
                          <p className="text-[9px] text-stone-500 leading-relaxed">{motionState.shutterReason}</p>
                        )}
                      </div>

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
                      <div className="space-y-1" title={!motionState.hasMotion ? 'Anchor point only matters with scale/rotate animations, floating or camera shake — no visible change on a static layer' : 'Pivot point for scale/rotate transforms'}>
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
            </>
            )}
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
