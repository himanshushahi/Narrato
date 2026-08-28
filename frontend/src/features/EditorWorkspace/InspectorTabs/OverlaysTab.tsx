import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscLayers,
  VscAdd,
  VscTrash,
  VscSave,
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
  onSave: () => void;
  isSaving: boolean;
}

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

export const OverlaysTab: React.FC<OverlaysTabProps> = ({
  scriptData,
  projectId,
  onSetScriptData,
  onSave,
  isSaving,
}) => {
  // Filter out any legacy banner entries if they existed
  const rawOverlays: GlobalOverlayItem[] = scriptData?.overlays || [];
  const overlays = rawOverlays.filter((item) => (item.type as string) !== 'banner');
  const [expandedId, setExpandedId] = useState<string | null>(overlays[0]?.id || null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadIdxRef = useRef<number | null>(null);

  const updateOverlays = (newOverlays: GlobalOverlayItem[]) => {
    onSetScriptData({
      ...scriptData,
      overlays: newOverlays,
    });
  };

  const handleUpdateItem = (index: number, field: keyof GlobalOverlayItem, value: any) => {
    const next = [...overlays];
    next[index] = {
      ...next[index],
      [field]: value,
    };
    updateOverlays(next);
  };

  const handleToggleEnabled = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = [...overlays];
    next[index] = {
      ...next[index],
      enabled: next[index].enabled === false ? true : false,
    };
    updateOverlays(next);
  };

  const handleDelete = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = overlays.filter((_, i) => i !== index);
    updateOverlays(next);
  };

  const handleDuplicate = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const item = overlays[index];
    const duplicate: GlobalOverlayItem = {
      ...item,
      id: `${item.type}_${Date.now().toString(36)}`,
    };
    const next = [...overlays.slice(0, index + 1), duplicate, ...overlays.slice(index + 1)];
    updateOverlays(next);
    setExpandedId(duplicate.id);
  };

  // ── Image Upload Handling (Native Dialog + Web Input Fallback) ─────────────
  const handleUploadImage = async (index: number) => {
    activeUploadIdxRef.current = index;
    setUploadingIdx(index);

    try {
      if (projectId) {
        const res = await callApi<{ success: boolean; asset_path?: string; error?: string }>(
          'upload_overlay_asset',
          projectId
        );
        if (res?.success && res.asset_path) {
          const mediaUrl = `${getMediaUrlSync(res.asset_path)}&t=${Date.now()}`;
          handleUpdateItem(index, 'logo_url', mediaUrl);
          setUploadingIdx(null);
          return;
        }
      }
    } catch {
      // Fall through to browser file picker
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
    setUploadingIdx(null);
  };

  const handleHtmlFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetIdx = activeUploadIdxRef.current;
    if (file && targetIdx !== null && targetIdx >= 0 && targetIdx < overlays.length) {
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const dataUrl = loadEvent.target?.result as string;
        if (dataUrl) {
          handleUpdateItem(targetIdx, 'logo_url', dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddOverlay = (type: GlobalOverlayItem['type']) => {
    let newItem: GlobalOverlayItem;
    const uid = `${type}_${Date.now().toString(36)}`;

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
    }

    const next = [...overlays, newItem];
    updateOverlays(next);
    setExpandedId(newItem.id);
  };

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

          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? <VscLoading className="animate-spin text-[11px]" /> : <VscSave className="text-[11px]" />}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Add, scale, recolor, or remove full-video watermarks, progress bars, and chapter pills with live preview.
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
        </div>
      </div>

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
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
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
                              onChange={(e) => handleUpdateItem(idx, 'from_seconds', parseFloat(e.target.value) || 0)}
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
                              onChange={(e) => handleUpdateItem(idx, 'duration_seconds', parseFloat(e.target.value) || 1)}
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
                                  <img src={item.logo_url} alt="Logo" className="w-full h-full object-cover" />
                                  <button
                                    onClick={() => handleUpdateItem(idx, 'logo_url', '')}
                                    className="absolute inset-0 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-rose-400 cursor-pointer"
                                    title="Remove Logo Image"
                                  >
                                    <VscClose className="text-base" />
                                  </button>
                                </div>
                              ) : (
                                <div className="w-12 h-12 rounded-full border border-dashed border-zinc-700 flex items-center justify-center text-zinc-600 text-xs shrink-0 font-bold">
                                  No Logo
                                </div>
                              )}

                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleUploadImage(idx)}
                                    disabled={uploadingIdx === idx}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    {uploadingIdx === idx ? <VscLoading className="animate-spin" /> : <VscCloudUpload />}
                                    Upload Logo File
                                  </button>
                                  {item.logo_url && (
                                    <button
                                      onClick={() => handleUpdateItem(idx, 'logo_url', '')}
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
                              <input
                                type="range"
                                min="16"
                                max="100"
                                value={item.logo_size ?? 34}
                                onChange={(e) => handleUpdateItem(idx, 'logo_size', parseInt(e.target.value) || 34)}
                                className="w-full accent-amber-500 cursor-pointer pt-2"
                              />
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
                                  value={item.color?.startsWith('#') && item.color.length === 7 ? item.color : '#f59e0b'}
                                  onChange={(e) => handleUpdateItem(idx, 'color', e.target.value)}
                                  className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                                />
                                <input
                                  type="text"
                                  className="w-full bg-transparent text-xs text-zinc-200 focus:outline-none font-mono"
                                  value={item.color || '#f59e0b'}
                                  onChange={(e) => handleUpdateItem(idx, 'color', e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Track Background Color
                              </label>
                              <input
                                type="text"
                                className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1 text-xs text-zinc-200 font-mono focus:outline-none"
                                value={item.track_color || 'rgba(255, 255, 255, 0.1)'}
                                onChange={(e) => handleUpdateItem(idx, 'track_color', e.target.value)}
                                placeholder="rgba(255, 255, 255, 0.1)"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                                Bar Height ({item.bar_height ?? 4}px)
                              </label>
                              <input
                                type="range"
                                min="1"
                                max="24"
                                value={item.bar_height ?? 4}
                                onChange={(e) => handleUpdateItem(idx, 'bar_height', parseInt(e.target.value) || 4)}
                                className="w-full accent-amber-500 cursor-pointer pt-2"
                              />
                            </div>

                            <div className="flex items-center gap-2 pt-4">
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
                              onChange={(e) => handleUpdateItem(idx, 'chapter_number', parseInt(e.target.value) || 1)}
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

                      {/* 3. Deep Color & Background Customization */}
                      {item.type !== 'progress_bar' && (
                        <div className="space-y-2.5 pt-2 border-t border-zinc-800/40">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            Colors & Shape Styling
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] text-zinc-500 block">Text / Accent</label>
                              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-1">
                                <input
                                  type="color"
                                  value={item.color?.startsWith('#') && item.color.length === 7 ? item.color : '#ffffff'}
                                  onChange={(e) => handleUpdateItem(idx, 'color', e.target.value)}
                                  className="w-3.5 h-3.5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
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
                              <input
                                type="text"
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-200 font-mono focus:outline-none"
                                value={item.bg_color || ''}
                                onChange={(e) => handleUpdateItem(idx, 'bg_color', e.target.value)}
                                placeholder="rgba(15,23,42,0.7)"
                              />
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

                      {/* 4. Fine-Tune Position Nudging & Overall Scale */}
                      <div className="space-y-2 pt-2 border-t border-zinc-800/40">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Scale & Manual Position Adjust
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Scale ({(item.scale ?? 1).toFixed(2)}x)
                            </label>
                            <input
                              type="range"
                              min="0.5"
                              max="2.5"
                              step="0.05"
                              value={item.scale ?? 1}
                              onChange={(e) => handleUpdateItem(idx, 'scale', parseFloat(e.target.value))}
                              className="w-full accent-amber-500 cursor-pointer"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Nudge X ({item.nudge_x ?? 0}px)
                            </label>
                            <input
                              type="range"
                              min="-150"
                              max="150"
                              step="2"
                              value={item.nudge_x ?? 0}
                              onChange={(e) => handleUpdateItem(idx, 'nudge_x', parseInt(e.target.value) || 0)}
                              className="w-full accent-amber-500 cursor-pointer"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] text-zinc-500 block">
                              Nudge Y ({item.nudge_y ?? 0}px)
                            </label>
                            <input
                              type="range"
                              min="-150"
                              max="150"
                              step="2"
                              value={item.nudge_y ?? 0}
                              onChange={(e) => handleUpdateItem(idx, 'nudge_y', parseInt(e.target.value) || 0)}
                              className="w-full accent-amber-500 cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 5. Opacity & Entrance Animation */}
                      <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/40">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                            Opacity ({Math.round((item.opacity ?? 0.85) * 100)}%)
                          </label>
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={item.opacity ?? 0.85}
                            onChange={(e) => handleUpdateItem(idx, 'opacity', parseFloat(e.target.value))}
                            className="w-full accent-amber-500 cursor-pointer"
                          />
                        </div>

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
