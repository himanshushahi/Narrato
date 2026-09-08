import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscLayers,
  VscAdd,
  VscTrash,
  VscLoading,
  VscEye,
  VscEyeClosed,
  VscCopy,
  VscChevronDown,
  VscChevronRight,
  VscCloudUpload,
  VscClose,
} from 'react-icons/vsc';
import { GlobalOverlayItem } from '../../../components/video/GlobalOverlaysRenderer';
import { callApi } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

interface OverlaysTabProps {
  scriptData: any;
  projectId?: string;
  onSetScriptData: (data: any) => void;
  onSaveOverlays?: (overlays: GlobalOverlayItem[]) => void;
  /** Registers a synchronous flush so Ctrl+S / TopBar Save never miss trailing ticks. */
  onRegisterFlush?: (flush: (() => any) | null) => void;
}

/** Trailing-edge debounce so keystrokes/slider ticks stay local and the
 *  workspace (player, timeline, liveScenes recompute) only updates ~4x/sec. */
const COMMIT_DEBOUNCE_MS = 250;

const POSITION_OPTIONS = [
  { value: 'top_right', label: 'Top Right' },
  { value: 'top_left', label: 'Top Left' },
  { value: 'bottom_right', label: 'Bottom Right' },
  { value: 'bottom_left', label: 'Bottom Left' },
  { value: 'top_center', label: 'Top Center' },
  { value: 'bottom_center', label: 'Bottom Center' },
  { value: 'top', label: 'Top Edge (Full Width)' },
  { value: 'bottom', label: 'Bottom Edge (Full Width)' },
];

const ANIMATION_OPTIONS = [
  { value: 'fade', label: 'Fade In' },
  { value: 'slide_up', label: 'Slide Up' },
  { value: 'slide_down', label: 'Slide Down' },
  { value: 'spring_pop', label: 'Spring Pop' },
  { value: 'none', label: 'None (Instant)' },
];

const RADIUS_OPTIONS = [
  { value: '9999px', label: 'Pill / Capsule' },
  { value: '16px', label: 'Rounded Large (16px)' },
  { value: '8px', label: 'Rounded Small (8px)' },
  { value: '0px', label: 'Sharp Rectangle' },
];

/** Derive a native-picker-safe #rrggbb swatch from any CSS color string. */
const cssToSwatchHex = (val: any, fallback = '#ffffff'): string => {
  if (typeof val === 'string') {
    const v = val.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    const hex8 = v.match(/^#([0-9a-fA-F]{6})[0-9a-fA-F]{2}$/);
    if (hex8) return `#${hex8[1]}`;
    const short = v.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const hex4 = v.match(/^#([0-9a-fA-F]{3})[0-9a-fA-F]$/);
    if (hex4) {
      const [r, g, b] = hex4[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    const rgb = v.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgb) {
      const toHex = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
      return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
    }
  }
  return fallback;
};

/** Alpha channel of a CSS color (1 when opaque/unparsable). */
const cssAlpha = (val: any): number => {
  if (typeof val === 'string') {
    const v = val.trim();
    const hex8 = v.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/);
    if (hex8) {
      return Math.round((parseInt(hex8[1], 16) / 255) * 100) / 100;
    }
    const hex4 = v.match(/^#[0-9a-fA-F]{3}([0-9a-fA-F])$/);
    if (hex4) {
      return Math.round((parseInt(hex4[1] + hex4[1], 16) / 255) * 100) / 100;
    }
    const m = v.match(/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*([\d.]+)\s*\)$/i);
    if (m) {
      const a = parseFloat(m[1]);
      if (Number.isFinite(a)) return Math.max(0, Math.min(1, a));
    }
  }
  return 1;
};

/** Picker change → hex, preserving the field's existing translucency. */
const pickColor = (current: any, hex: string): string => {
  const a = cssAlpha(current);
  if (a >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Honest tooltip: transparent/empty can't be represented by the swatch. */
const pickerTitle = (current: any, label: string): string => {
  if (typeof current !== 'string' || current.trim() === '') {
    return `${label}: currently empty — picking sets an opaque color`;
  }
  if (current.trim().toLowerCase() === 'transparent') {
    return `${label}: currently transparent — picking sets an opaque color (clear the text to go back)`;
  }
  const a = cssAlpha(current);
  return a < 1
    ? `Picker keeps current ${Math.round(a * 100)}% opacity — edit text for exact alpha`
    : label;
};

/** Cheap content signature for echo detection (arrays are tiny). */
const safeJson = (v: any): string | null => {
  try { return JSON.stringify(v ?? null); } catch { return null; }
};

const isBanner = (item: any): boolean => (item?.type as string) === 'banner';

export const OverlaysTab: React.FC<OverlaysTabProps> = ({
  scriptData,
  projectId,
  onSetScriptData,
  onSaveOverlays,
  onRegisterFlush,
}) => {
  // Filter out any legacy banner entries if they existed
  const rawOverlays: GlobalOverlayItem[] = scriptData?.overlays || [];
  const initialOverlays = rawOverlays.filter((item) => (item.type as string) !== 'banner');
  const [expandedId, setExpandedId] = useState<string | null>(initialOverlays[0]?.id || null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadIdRef = useRef<string | null>(null);

  // ── Local draft + debounced upstream commit ──────────────────────────
  // Every keystroke/slider tick used to call onSetScriptData synchronously,
  // re-rendering the whole workspace (liveScenes recompute, Player, Timeline)
  // per keystroke. Now inputs write to `draft` (tab-local render only) and a
  // trailing edge pushes ONE update upstream. Same pattern as SubtitleTab.
  const [draft, setDraft] = useState<GlobalOverlayItem[]>(initialOverlays);
  const draftRef = useRef(draft);
  // Last raw array adopted from props or pushed upstream — reference check
  // distinguishes our own echo (ignore) from external changes (adopt).
  const baseRawRef = useRef<GlobalOverlayItem[] | null>(rawOverlays);
  // Content signature: the parent deep-clones on unrelated edits, so identity
  // alone can't recognize our echo — compare contents, adopt only on real change.
  const lastJsonRef = useRef<string | null>(safeJson(initialOverlays));
  const expandedIdRef = useRef<string | null>(initialOverlays[0]?.id || null);
  const setExpanded = useCallback((id: string | null) => {
    expandedIdRef.current = id;
    setExpandedId(id);
  }, []);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptDataRef = useRef(scriptData);
  scriptDataRef.current = scriptData;
  const onSetScriptDataRef = useRef(onSetScriptData);
  onSetScriptDataRef.current = onSetScriptData;
  const onSaveOverlaysRef = useRef(onSaveOverlays);
  onSaveOverlaysRef.current = onSaveOverlays;

  // Adopt external changes (project load, save reload, other-tab edits)
  // without clobbering in-flight typing — pending timer means our newer
  // draft wins. Content-compare: the parent deep-clones the doc on every
  // edit, so a new identity with identical contents must not reset the draft
  // (extra render + focus loss risk). Stale expandedId is re-validated here.
  useEffect(() => {
    const raw: GlobalOverlayItem[] = scriptData?.overlays || [];
    if (commitTimerRef.current) return;
    const filtered = raw.filter((item) => !isBanner(item));
    const json = safeJson(filtered);
    if (raw === baseRawRef.current || json === lastJsonRef.current) {
      baseRawRef.current = raw;
      return;
    }
    baseRawRef.current = raw;
    lastJsonRef.current = json;
    draftRef.current = filtered;
    setDraft(filtered);
    if (expandedIdRef.current && !filtered.some((o) => o.id === expandedIdRef.current)) {
      setExpanded(filtered[0]?.id ?? null);
    }
  }, [scriptData, setExpanded]);

  /** Push the draft upstream. Banner entries (hidden from the editor) ride
   *  along untouched so saving while this tab is open never deletes them.
   *  persist=false updates state only — save pipelines persist themselves.
   *  Returns the full upstream array (banners included) for save merges. */
  const pushUpstream = useCallback((next: GlobalOverlayItem[], persist: boolean) => {
    const doc = scriptDataRef.current;
    const banners = ((doc as any)?.overlays || []).filter(isBanner);
    const out = banners.length > 0
      ? [...next, ...banners.filter((b: any) => !next.some((n) => n.id === b.id))]
      : next;
    baseRawRef.current = out;
    lastJsonRef.current = safeJson(next);
    onSetScriptDataRef.current({ ...doc, overlays: out });
    if (persist) onSaveOverlaysRef.current?.(out);
    return out;
  }, []);

  /** Push the draft upstream (state + disk) — single debounced exit point. */
  const commitDraft = useCallback((next: GlobalOverlayItem[]) => {
    return pushUpstream(next, true);
  }, [pushUpstream]);

  /** Synchronously flush any pending commit. Returns the full upstream array
   *  (banners included) only when a pending timer actually fired (null =
   *  nothing outstanding), so callers never mistake "no edits" for edits. */
  const commitPending = useCallback((persist: boolean = true): GlobalOverlayItem[] | null => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      return pushUpstream(draftRef.current, persist);
    }
    return null;
  }, [pushUpstream]);

  // Flush on unmount / tab switch so no tick is ever lost.
  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      commitDraft(draftRef.current);
    }
  }, [commitDraft]);

  // Ctrl+S / TopBar Save flush hookup (mirrors SubtitleTab/VisualsTab).
  useEffect(() => {
    if (!onRegisterFlush) return;
    onRegisterFlush(commitPending);
    return () => onRegisterFlush(null);
  }, [onRegisterFlush, commitPending]);

  const overlays = draft;

  /** High-frequency inputs (text / number / sliders / color): draft + debounce. */
  const handleUpdateItem = useCallback((index: number, field: keyof GlobalOverlayItem, value: any) => {
    const base = draftRef.current;
    if (index < 0 || index >= base.length) return;
    const next = [...base];
    next[index] = { ...next[index], [field]: value };
    draftRef.current = next;
    setDraft(next);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      commitDraft(draftRef.current);
    }, COMMIT_DEBOUNCE_MS);
  }, [commitDraft]);

  /** Discrete one-shot actions (eye-toggle / add / duplicate / delete / uploads):
   *  fold pending ticks in, then commit synchronously. Plain selects and
   *  checkboxes stay on the debounced path — the draft updates instantly so
   *  dependent UI (e.g. custom-time sub-form) reacts at once; only preview +
   *  disk trail by 250ms. */
  const commitImmediate = useCallback((next: GlobalOverlayItem[]) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    draftRef.current = next;
    setDraft(next);
    commitDraft(next);
    return next;
  }, [commitDraft]);

  // Film grain defaults ON via the legacy PaperOverlay fallback while no
  // film_grain item exists (see NitishRajputComposition). It is surfaced as
  // a virtual row below — no phantom writes; Customize/Disable materialize
  // a real item. Deleting that item restores the default-on state.

  const handleToggleEnabled = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const base = draftRef.current;
    if (index < 0 || index >= base.length) return;
    const next = [...base];
    next[index] = {
      ...next[index],
      enabled: next[index].enabled === false ? true : false,
    };
    commitImmediate(next);
  }, [commitImmediate]);

  const handleDelete = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const base = draftRef.current;
    const target = base[index];
    const remaining = base.filter((_, i) => i !== index);
    if (target && expandedIdRef.current === target.id) {
      setExpanded(remaining[0]?.id ?? null);
    }
    commitImmediate(remaining);
  }, [commitImmediate, setExpanded]);

  const handleDuplicate = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const base = draftRef.current;
    if (index < 0 || index >= base.length) return;
    const item = base[index];
    const duplicate: GlobalOverlayItem = {
      ...item,
      id: `${item.type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    };
    commitImmediate([...base.slice(0, index + 1), duplicate, ...base.slice(index + 1)]);
    setExpanded(duplicate.id);
  }, [commitImmediate, setExpanded]);

  // ── Image Upload Handling (Native Dialog + Web Input Fallback) ─────────────
  // Async upload landing after unmount/tab-switch is harmless: the unmount
  // flush only fires when a debounce timer is pending, and uploads commit
  // immediately (no pending timer), so ordering is preserved.
  const setLogoUrl = useCallback((index: number, logoUrl: string) => {
    const base = draftRef.current;
    if (index < 0 || index >= base.length) return;
    const next = [...base];
    next[index] = { ...next[index], logo_url: logoUrl };
    commitImmediate(next);
  }, [commitImmediate]);

  const handleUploadImage = async (index: number) => {
    const item = draftRef.current[index];
    if (!item) return;
    activeUploadIdRef.current = item.id;
    setUploadingId(item.id);

    try {
      if (projectId) {
        const res = await callApi<{ success: boolean; asset_path?: string; error?: string }>(
          'upload_overlay_asset',
          projectId
        );
        if (res?.success && res.asset_path) {
          const curIdx = draftRef.current.findIndex((o) => o.id === item.id);
          if (curIdx !== -1) {
            setLogoUrl(curIdx, res.asset_path);
          }
          activeUploadIdRef.current = null;
          setUploadingId(null);
          return;
        }
      }
    } catch {
      // Fallback to web file picker
    }
    fileInputRef.current?.click();
    setUploadingId(null);
  };

  const handleHtmlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = activeUploadIdRef.current;
    // Consume immediately — the async onload below captured targetId, so a
    // stale ref can never leak into a later upload.
    activeUploadIdRef.current = null;
    if (!file || !targetId) return;

    const initialIdx = draftRef.current.findIndex((o) => o.id === targetId);
    if (initialIdx === -1) return;

    try {
      setUploadingId(targetId);
      const reader = new FileReader();
      reader.onload = async () => {
        if (typeof reader.result === 'string') {
          let savedPath = reader.result;
          if (projectId) {
            try {
              const res = await callApi<{ success: boolean; asset_path?: string; error?: string }>(
                'save_uploaded_overlay_data',
                projectId,
                reader.result,
                file.name
              );
              if (res?.success && res.asset_path) {
                savedPath = res.asset_path;
              }
            } catch (err) {
              console.warn('[OverlaysTab] Failed to save overlay image to disk, falling back to data URL:', err);
            }
          }
          const next = [...draftRef.current];
          const resolvedIdx = next.findIndex((o) => o.id === targetId);
          if (resolvedIdx === -1) {
            // Target deleted while the file picker was open — drop the upload.
            setUploadingId(null);
            return;
          }
          next[resolvedIdx] = { ...next[resolvedIdx], logo_url: savedPath };
          commitImmediate(next);
        }
        setUploadingId(null);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingId(null);
    } finally {
      e.target.value = '';
    }
  };

  const handleAddOverlay = (type: GlobalOverlayItem['type']) => {
    let newItem: GlobalOverlayItem;
    const uid = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    switch (type) {
      case 'watermark':
        newItem = {
          id: uid,
          type: 'watermark',
          enabled: true,
          timing: 'full',
          position: 'top_right',
          opacity: 0.85,
          scale: 1,
          logo_size: 34,
          channel_name: '@ChannelHandle',
          show_verified_badge: true,
          color: '#ffffff',
          bg_color: 'rgba(15, 23, 42, 0.7)',
          border_color: 'rgba(255, 255, 255, 0.15)',
          border_radius: '9999px',
          border_width: 1,
          font_size: '15px',
          font_weight: 800,
          animation: 'fade',
          glass_blur: true,
          glow: true,
          nudge_x: 0,
          nudge_y: 0,
        };
        break;
      case 'progress_bar':
        newItem = {
          id: uid,
          type: 'progress_bar',
          enabled: true,
          timing: 'full',
          position: 'top',
          bar_height: 4,
          color: '#f59e0b',
          track_color: 'rgba(255, 255, 255, 0.1)',
          glow: true,
          opacity: 0.9,
          nudge_y: 0,
        };
        break;
      case 'chapter_pill':
        newItem = {
          id: uid,
          type: 'chapter_pill',
          enabled: true,
          timing: 'custom',
          from_seconds: 0,
          duration_seconds: 30,
          position: 'top_left',
          chapter_number: 1,
          chapter_title: 'The Background',
          color: '#f59e0b',
          bg_color: 'rgba(0, 0, 0, 0.75)',
          border_color: 'rgba(255, 255, 255, 0.15)',
          border_radius: '8px',
          border_width: 1,
          opacity: 0.9,
          scale: 1,
          animation: 'spring_pop',
          glass_blur: true,
          nudge_x: 0,
          nudge_y: 0,
        };
        break;
      case 'custom_text':
        newItem = {
          id: uid,
          type: 'custom_text',
          enabled: true,
          timing: 'full',
          position: 'bottom_right',
          text: 'CONFIDENTIAL DOSSIER',
          color: '#ef4444',
          bg_color: 'transparent',
          font_size: '14px',
          font_weight: 900,
          opacity: 0.85,
          scale: 1,
          animation: 'fade',
          nudge_x: 0,
          nudge_y: 0,
        };
        break;
      case 'film_grain':
        newItem = {
          id: uid,
          type: 'film_grain',
          enabled: true,
          timing: 'full',
          opacity: 1,
          grain_enabled: true,
          sepia_enabled: true,
          dust_enabled: true,
          grain_opacity: 0.8,
          sepia_opacity: 0.02,
        } as GlobalOverlayItem;
        break;
    }

    const next = [...draftRef.current, newItem];
    commitImmediate(next);
    setExpanded(newItem.id);
  };

  /** Materialize the default-on film grain as a real item (customize vs off). */
  const handleMaterializeGrain = (enabled: boolean) => {
    const uid = `film_grain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newItem: GlobalOverlayItem = {
      id: uid,
      type: 'film_grain',
      enabled,
      timing: 'full',
      opacity: 1,
      grain_enabled: true,
      sepia_enabled: true,
      dust_enabled: true,
      grain_opacity: 0.8,
      sepia_opacity: 0.02,
    } as GlobalOverlayItem;
    const next = [...draftRef.current, newItem];
    commitImmediate(next);
    if (enabled) setExpanded(newItem.id);
  };

  const hasFilmGrainItem = draft.some((o) => o?.type === 'film_grain');

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
      {/* Hidden browser file input for upload fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleHtmlFileChange}
        className="hidden"
      />

      {/* ── Top Header & Action Bar ── */}
      <div className="bg-zinc-900/70 rounded-xl border border-zinc-800/60 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VscLayers className="text-amber-500 text-sm" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              Global Overlays & Branding
            </h3>
            <span className="text-[10px] bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/20">
              {overlays.length}
            </span>
          </div>

          <span className="text-[10px] text-zinc-500 font-medium">
            Changes auto-saved
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Add, scale, recolor, or remove full-video watermarks, progress bars, chapter pills, and film grain with live preview. Scene/cut visuals are edited in the Visuals tab — overlays here are manual-only (AI has no access).
        </p>

        {/* Add Preset Buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            onClick={() => handleAddOverlay('watermark')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-200 text-[10px] font-semibold border border-zinc-700/40 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <VscAdd className="text-amber-400 text-xs" /> Watermark
          </button>
          <button
            onClick={() => handleAddOverlay('progress_bar')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-200 text-[10px] font-semibold border border-zinc-700/40 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <VscAdd className="text-amber-400 text-xs" /> Progress Bar
          </button>
          <button
            onClick={() => handleAddOverlay('chapter_pill')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-200 text-[10px] font-semibold border border-zinc-700/40 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <VscAdd className="text-amber-400 text-xs" /> Chapter Pill
          </button>
          <button
            onClick={() => handleAddOverlay('custom_text')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-200 text-[10px] font-semibold border border-zinc-700/40 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <VscAdd className="text-amber-400 text-xs" /> Custom Text
          </button>
          <button
            onClick={() => handleAddOverlay('film_grain')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-200 text-[10px] font-semibold border border-zinc-700/40 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <VscAdd className="text-amber-400 text-xs" /> Film Grain
          </button>
        </div>
      </div>

      {/* ── Default-on film grain (no item yet → legacy fallback renders it) ── */}
      {!hasFilmGrainItem && (
        <div className="bg-zinc-900/80 rounded-xl border border-purple-500/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                film grain
              </span>
              <span className="text-xs font-semibold text-zinc-200 truncate">Film Grain & Texture</span>
              <span className="text-[10px] text-emerald-400 font-bold shrink-0">● Default ON</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Cinematic texture is currently applied with default settings. Customize it or turn it off:
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleMaterializeGrain(true)}
              className="px-2.5 py-1.5 rounded-md bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 text-[10px] font-bold uppercase transition-colors cursor-pointer"
            >
              Customize
            </button>
            <button
              onClick={() => handleMaterializeGrain(false)}
              className="px-2.5 py-1.5 rounded-md bg-zinc-800/60 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 border border-zinc-700/40 text-[10px] font-bold uppercase transition-colors cursor-pointer"
            >
              Turn Off
            </button>
          </div>
        </div>
      )}

      {/* ── Overlay List ── */}
      {overlays.length === 0 ? (
        <div className="p-8 text-center bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800 text-zinc-500 space-y-2">
          <VscLayers className="text-2xl mx-auto text-zinc-600" />
          <p className="text-xs font-semibold text-zinc-400">No Global Overlays Configured</p>
          <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
            Click one of the buttons above to add a persistent Channel Watermark, Progress Bar, or Chapter Pill.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {overlays.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            const isEnabled = item.enabled !== false;

            return (
              <div
                key={item.id || idx}
                className={`bg-zinc-900/80 rounded-xl border transition-all ${
                  isExpanded ? 'border-amber-500/40 shadow-lg shadow-black/40' : 'border-zinc-800/70 hover:border-zinc-700/80'
                }`}
              >
                {/* Overlay Header Bar */}
                <div
                  onClick={() => setExpanded(isExpanded ? null : item.id)}
                  className="flex items-center justify-between p-3 cursor-pointer select-none gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 text-xs">
                      {isExpanded ? <VscChevronDown /> : <VscChevronRight />}
                    </span>

                    <span
                      className={`shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        item.type === 'watermark'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : item.type === 'progress_bar'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : item.type === 'chapter_pill'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : item.type === 'film_grain'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-zinc-700/40 text-zinc-300 border border-zinc-600/40'
                      }`}
                    >
                      {item.type.replace('_', ' ')}
                    </span>

                    <span className="text-xs font-semibold text-zinc-200 truncate">
                      {item.type === 'watermark' && (item.channel_name || 'Watermark')}
                      {item.type === 'progress_bar' && 'Video Progress Bar'}
                      {item.type === 'chapter_pill' && (item.chapter_title || 'Chapter Marker')}
                      {item.type === 'custom_text' && (item.text || 'Custom Text')}
                      {item.type === 'film_grain' && 'Film Grain & Texture'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => handleToggleEnabled(idx, e)}
                      className={`w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer ${
                        isEnabled ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-zinc-600 hover:bg-zinc-800'
                      }`}
                      title={isEnabled ? 'Enabled (Click to Disable)' : 'Disabled (Click to Enable)'}
                    >
                      {isEnabled ? <VscEye className="text-xs" /> : <VscEyeClosed className="text-xs" />}
                    </button>

                    <button
                      onClick={(e) => handleDuplicate(idx, e)}
                      className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Duplicate"
                    >
                      <VscCopy className="text-xs" />
                    </button>

                    <button
                      onClick={(e) => handleDelete(idx, e)}
                      className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      title="Remove / Delete Overlay"
                    >
                      <VscTrash className="text-xs" />
                    </button>
                  </div>
                </div>

                {/* Expanded Form Fields */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden border-t border-zinc-800/60 p-3.5 space-y-4 bg-black/20"
                    >
                      {/* 1. Timing & Position Grid */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Timeline Span
                          </label>
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                            value={item.timing || 'full'}
                            onChange={(e) => handleUpdateItem(idx, 'timing', e.target.value)}
                          >
                            <option value="full">Full Video (00:00 → End)</option>
                            <option value="custom">Custom Time Interval</option>
                          </select>
                        </div>

                        {item.type !== 'film_grain' && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Anchor Position
                          </label>
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                            value={item.position || (item.type === 'progress_bar' ? 'top' : 'top_right')}
                            onChange={(e) => handleUpdateItem(idx, 'position', e.target.value)}
                          >
                            {POSITION_OPTIONS.map((pos) => (
                              <option key={pos.value} value={pos.value}>
                                {pos.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        )}
                      </div>

                      {/* Custom Time Inputs */}
                      {item.timing === 'custom' && (
                        <div className="grid grid-cols-2 gap-2.5 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/40">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Start Time (Seconds)
                            </label>
                            <input
                              type="number"
                              className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500/50"
                              value={item.from_seconds ?? 0}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                handleUpdateItem(idx, 'from_seconds', isNaN(v) ? 0 : v);
                              }}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Duration (Seconds)
                            </label>
                            <input
                              type="number"
                              className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500/50"
                              value={item.duration_seconds ?? 15}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                // Allow 0 mid-typing (e.g. "0." → 0.5); the
                                // minimum is enforced on blur instead.
                                handleUpdateItem(idx, 'duration_seconds', isNaN(v) ? 0 : Math.max(0, v));
                              }}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value);
                                // A 0s overlay never shows — floor to 1s on commit.
                                if (!isNaN(v) && v <= 0) handleUpdateItem(idx, 'duration_seconds', 1);
                              }}
                              placeholder="15"
                            />
                          </div>
                        </div>
                      )}

                      {/* 2. Type-Specific Form Controls */}

                      {/* ── Watermark Controls ── */}
                      {item.type === 'watermark' && (
                        <div className="space-y-3 pt-1">
                          {/* Logo Image Upload & Preview */}
                          <div className="space-y-1.5 bg-zinc-950/40 p-3 rounded-lg border border-zinc-800/40">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Channel Logo Image
                            </label>
                            <div className="flex items-center gap-3">
                              {item.logo_url ? (
                                <div className="relative group w-12 h-12 rounded-full overflow-hidden border border-white/20 shrink-0 bg-black/50">
                                  <img src={getMediaUrlSync(item.logo_url)} alt="Logo" className="w-full h-full object-cover" />
                                  <button
                                    onClick={() => setLogoUrl(idx, '')}
                                    className="absolute inset-0 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-rose-400 cursor-pointer"
                                    title="Remove Logo Image"
                                  >
                                    <VscClose className="text-base" />
                                  </button>
                                </div>
                              ) : (
                                <div className="w-12 h-12 rounded-full border border-dashed border-zinc-700/80 bg-zinc-900/60 flex flex-col items-center justify-center text-center shrink-0 p-1 select-none">
                                  <span className="text-[9px] font-semibold text-zinc-500 leading-none">No</span>
                                  <span className="text-[9px] font-semibold text-zinc-500 leading-none mt-0.5">Logo</span>
                                </div>
                              )}

                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleUploadImage(idx)}
                                    disabled={uploadingId === item.id}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    {uploadingId === item.id ? <VscLoading className="animate-spin" /> : <VscCloudUpload />}
                                    Upload Logo File
                                  </button>
                                  {item.logo_url && (
                                    <button
                                      onClick={() => setLogoUrl(idx, '')}
                                      className="px-2.5 py-1.5 rounded-md bg-zinc-800/60 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 border border-zinc-700/40 text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>
                                <input
                                  type="text"
                                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-zinc-300 font-mono focus:outline-none"
                                  value={item.logo_url || ''}
                                  onChange={(e) => handleUpdateItem(idx, 'logo_url', e.target.value)}
                                  placeholder="Or paste image URL / local path..."
                                />
                              </div>
                            </div>
                          </div>

                          {/* Channel Handle & Verified Badge */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Channel Name / Handle
                              </label>
                              <input
                                type="text"
                                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50"
                                value={item.channel_name || ''}
                                onChange={(e) => handleUpdateItem(idx, 'channel_name', e.target.value)}
                                placeholder="@NitishRajput"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Logo Size ({item.logo_size ?? 34}px)
                              </label>
                              <div className="h-[34px] flex items-center px-1">
                                <input
                                  type="range"
                                  min="16"
                                  max="100"
                                  value={item.logo_size ?? 34}
                                  onChange={(e) => handleUpdateItem(idx, 'logo_size', parseInt(e.target.value) || 34)}
                                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.show_verified_badge !== false}
                                onChange={(e) => handleUpdateItem(idx, 'show_verified_badge', e.target.checked)}
                                className="rounded accent-amber-500 cursor-pointer"
                              />
                              Verified Checkmark
                            </label>
                            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.glass_blur !== false}
                                onChange={(e) => handleUpdateItem(idx, 'glass_blur', e.target.checked)}
                                className="rounded accent-amber-500 cursor-pointer"
                              />
                              Glassmorphic Blur
                            </label>
                          </div>
                        </div>
                      )}

                      {/* ── Progress Bar Controls ── */}
                      {item.type === 'progress_bar' && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Bar Color
                              </label>
                              <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50">
                                <input
                                  type="color"
                                  value={cssToSwatchHex(item.color, '#f59e0b')}
                                  onChange={(e) => handleUpdateItem(idx, 'color', pickColor(item.color, e.target.value))}
                                  className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                                  title={pickerTitle(item.color, 'Pick bar color')}
                                />
                                <input
                                  type="text"
                                  className="w-full bg-transparent text-xs text-zinc-200 focus:outline-none font-mono"
                                  value={item.color ?? ''}
                                  onChange={(e) => handleUpdateItem(idx, 'color', e.target.value)}
                                  placeholder="#f59e0b"
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Track Background Color
                              </label>
                              <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50">
                                <input
                                  type="color"
                                  value={cssToSwatchHex(item.track_color, '#ffffff')}
                                  onChange={(e) => handleUpdateItem(idx, 'track_color', pickColor(item.track_color, e.target.value))}
                                  className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                                  title={pickerTitle(item.track_color, 'Pick track color')}
                                />
                                <input
                                  type="text"
                                  className="w-full bg-transparent text-xs text-zinc-200 font-mono focus:outline-none"
                                  value={item.track_color ?? ''}
                                  onChange={(e) => handleUpdateItem(idx, 'track_color', e.target.value)}
                                  placeholder="rgba(255, 255, 255, 0.1)"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Bar Height ({item.bar_height ?? 4}px)
                              </label>
                              <div className="h-[34px] flex items-center px-1">
                                <input
                                  type="range"
                                  min="1"
                                  max="24"
                                  value={item.bar_height ?? 4}
                                  onChange={(e) => handleUpdateItem(idx, 'bar_height', parseInt(e.target.value) || 4)}
                                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-transparent select-none block">
                                Effects
                              </label>
                              <div className="h-[34px] flex items-center">
                                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={item.glow !== false}
                                    onChange={(e) => handleUpdateItem(idx, 'glow', e.target.checked)}
                                    className="rounded accent-amber-500 cursor-pointer"
                                  />
                                  Neon Glow
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Chapter Pill Controls ── */}
                      {item.type === 'chapter_pill' && (
                        <div className="grid grid-cols-2 gap-2.5 pt-1">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Chapter Number
                            </label>
                            <input
                              type="number"
                              className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none"
                              value={item.chapter_number ?? 1}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                handleUpdateItem(idx, 'chapter_number', isNaN(v) ? 1 : v);
                              }}
                              placeholder="1"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Chapter Title
                            </label>
                            <input
                              type="text"
                              className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none"
                              value={item.chapter_title || ''}
                              onChange={(e) => handleUpdateItem(idx, 'chapter_title', e.target.value)}
                              placeholder="The Investigation"
                            />
                          </div>
                        </div>
                      )}

                      {/* ── Custom Text Controls ── */}
                      {item.type === 'custom_text' && (
                        <div className="space-y-2.5 pt-1">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Text Content
                            </label>
                            <input
                              type="text"
                              className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50"
                              value={item.text || ''}
                              onChange={(e) => handleUpdateItem(idx, 'text', e.target.value)}
                              placeholder="CUSTOM WATERMARK"
                            />
                          </div>
                        </div>
                      )}

                      {/* ── Film Grain Controls (fullscreen texture, no position) ── */}
                      {item.type === 'film_grain' && (
                        <div className="space-y-3 pt-1">
                          <p className="text-[11px] text-zinc-500 leading-relaxed">
                            Cinematic texture over the full canvas. Disable the eye-toggle to remove it entirely.
                          </p>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.grain_enabled !== false}
                                onChange={(e) => handleUpdateItem(idx, 'grain_enabled', e.target.checked)}
                                className="rounded accent-amber-500 cursor-pointer"
                              />
                              Paper Grain Texture
                            </label>
                            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.sepia_enabled !== false}
                                onChange={(e) => handleUpdateItem(idx, 'sepia_enabled', e.target.checked)}
                                className="rounded accent-amber-500 cursor-pointer"
                              />
                              Sepia Wash
                            </label>
                            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.dust_enabled !== false}
                                onChange={(e) => handleUpdateItem(idx, 'dust_enabled', e.target.checked)}
                                className="rounded accent-amber-500 cursor-pointer"
                              />
                              Film Dust Particles
                            </label>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Grain Intensity ({Math.round((item.grain_opacity ?? 0.8) * 100)}%)
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={item.grain_opacity ?? 0.8}
                              onChange={(e) => handleUpdateItem(idx, 'grain_opacity', parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                              Sepia Strength ({Math.round((item.sepia_opacity ?? 0.02) * 100)}%)
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="0.2"
                              step="0.01"
                              value={item.sepia_opacity ?? 0.02}
                              onChange={(e) => handleUpdateItem(idx, 'sepia_opacity', parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>
                      )}

                      {/* 3. Deep Color & Background Customization (not for bars / fullscreen grain) */}
                      {item.type !== 'progress_bar' && item.type !== 'film_grain' && (
                        <div className="space-y-2.5 pt-2 border-t border-zinc-800/40">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            Colors & Shape Styling
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] text-zinc-500 block">Text / Accent</label>
                              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 focus-within:border-amber-500/50">
                                <input
                                  type="color"
                                  value={cssToSwatchHex(item.color, '#ffffff')}
                                  onChange={(e) => handleUpdateItem(idx, 'color', pickColor(item.color, e.target.value))}
                                  className="w-3.5 h-3.5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                                  title={pickerTitle(item.color, 'Pick accent color')}
                                />
                                <input
                                  type="text"
                                  className="w-full bg-transparent text-[10px] text-zinc-200 font-mono focus:outline-none"
                                  value={item.color || ''}
                                  onChange={(e) => handleUpdateItem(idx, 'color', e.target.value)}
                                  placeholder="#ffffff"
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-zinc-500 block">Background</label>
                              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 focus-within:border-amber-500/50">
                                <input
                                  type="color"
                                  value={cssToSwatchHex(item.bg_color, '#0f172a')}
                                  onChange={(e) => handleUpdateItem(idx, 'bg_color', pickColor(item.bg_color, e.target.value))}
                                  className="w-3.5 h-3.5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                                  title={pickerTitle(item.bg_color, 'Pick background color')}
                                />
                                <input
                                  type="text"
                                  className="w-full bg-transparent text-[10px] text-zinc-200 font-mono focus:outline-none"
                                  value={item.bg_color || ''}
                                  onChange={(e) => handleUpdateItem(idx, 'bg_color', e.target.value)}
                                  placeholder="rgba(15,23,42,0.7)"
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-zinc-500 block">Corner Shape</label>
                              <select
                                className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-zinc-200 focus:outline-none cursor-pointer"
                                value={item.border_radius || '9999px'}
                                onChange={(e) => handleUpdateItem(idx, 'border_radius', e.target.value)}
                              >
                                {RADIUS_OPTIONS.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 4. Fine-Tune Position Nudging & Overall Scale (not for fullscreen grain) */}
                      {item.type !== 'film_grain' && (
                      <div className="space-y-2 pt-2 border-t border-zinc-800/40">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Scale & Manual Position Adjust
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Scale ({(item.scale ?? 1).toFixed(2)}x)
                            </label>
                            <div className="h-6 flex items-center px-1">
                              <input
                                type="range"
                                min="0.5"
                                max="2.5"
                                step="0.05"
                                value={item.scale ?? 1}
                                onChange={(e) => handleUpdateItem(idx, 'scale', parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Nudge X ({item.nudge_x ?? 0}px)
                            </label>
                            <div className="h-6 flex items-center px-1">
                              <input
                                type="range"
                                min="-150"
                                max="150"
                                step="2"
                                value={item.nudge_x ?? 0}
                                onChange={(e) => handleUpdateItem(idx, 'nudge_x', parseInt(e.target.value) || 0)}
                                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Nudge Y ({item.nudge_y ?? 0}px)
                            </label>
                            <div className="h-6 flex items-center px-1">
                              <input
                                type="range"
                                min="-150"
                                max="150"
                                step="2"
                                value={item.nudge_y ?? 0}
                                onChange={(e) => handleUpdateItem(idx, 'nudge_y', parseInt(e.target.value) || 0)}
                                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      )}

                      {/* 5. Opacity (& Entrance Animation — not for fullscreen grain) */}
                      <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/40">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Opacity ({Math.round((item.opacity ?? (item.type === 'film_grain' ? 1 : 0.85)) * 100)}%)
                          </label>
                          <div className="h-[34px] flex items-center px-1">
                            <input
                              type="range"
                              min="0.1"
                              max="1"
                              step="0.05"
                              value={item.opacity ?? (item.type === 'film_grain' ? 1 : 0.85)}
                              onChange={(e) => handleUpdateItem(idx, 'opacity', parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                          </div>
                        </div>

                        {item.type !== 'film_grain' && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Entrance Animation
                          </label>
                          <select
                            className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1 text-xs text-zinc-200 focus:outline-none cursor-pointer"
                            value={item.animation || 'fade'}
                            onChange={(e) => handleUpdateItem(idx, 'animation', e.target.value)}
                          >
                            {ANIMATION_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
