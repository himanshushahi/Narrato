import { CustomInput } from '../../components/ui/CustomInput';
import { CustomSelect } from '../../components/ui/CustomSelect';
import { SubVisualsDurationBar } from './SubVisualsDurationBar';
import { MapLocationsEditor } from './MapLocationsEditor';

import { NewspaperEditor } from './NewspaperEditor';
import { NetworkDataEditor } from './NetworkDataEditor';
import { DeviceMockupEditor, ThreadSimulationEditor } from './NewVisualTypesEditors';

import { ParallaxEditor } from './ParallaxEditor';
import { NumberingEditor } from './NumberingEditor';
import { HtmlDataEditor } from './HtmlDataEditor';
import { TransformEditor } from './TransformEditor';
import { CustomHtmlUiEditor } from './CustomHtmlUiEditor';
import { VISUAL_TYPE_OPTIONS, TRANSITION_TYPE_OPTIONS, formatTime, getDefaultMetaForType } from './constants';
import { BiTrashAlt } from 'react-icons/bi';
import { BsPlus, BsStars, BsSendFill, BsEye, BsUpload } from 'react-icons/bs';
import { useState, Fragment, useEffect } from 'react';

export const SubVisualsEditor = ({ subVisuals, onChange, timings, activeIdx, onSeek, onRewriteSubVisual, totalDurationFrames = 0, previewingSubVisual, onPreviewSubVisual, onUploadSubVisual, uploadingSubVisual }: { subVisuals: any[], onChange: (newSubs: any[]) => void, timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void, onRewriteSubVisual?: (idx: number, prompt: string) => Promise<void>, totalDurationFrames?: number, previewingSubVisual?: string | null, onPreviewSubVisual?: (idx: number) => void, onUploadSubVisual?: (idx: number) => void, uploadingSubVisual?: string | null }) => {
  const [aiPromptIdx, setAiPromptIdx] = useState<number | null>(null);
  const [aiPromptText, setAiPromptText] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);

  useEffect(() => {
    if (activeIdx === undefined || activeIdx < 0) return;
    const el = document.querySelector('[data-active-sub="true"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIdx]);

  const getValidVisualType = (type: string) => {
    if (!type) return 'scene';
    const t = String(type).toLowerCase();
    if (VISUAL_TYPE_OPTIONS.some(o => o.value === t)) return t;
    const match = VISUAL_TYPE_OPTIONS.find(o => o.label.toLowerCase() === t);
    if (match) return match.value;
    if (t.includes('parallax')) return 'parallax';
    if (t.includes('portrait')) return 'portrait';
    if (t.includes('youtube') || t.includes('video')) return 'youtube';
    if (t.includes('image')) return 'image';
    return 'scene';
  };

  const handleUpdate = (idx: number, field: string, val: any) => {
    const copy = [...subVisuals];
    copy[idx] = { ...copy[idx] };

    if (field === 'visual_type' && copy[idx][field] === val) {
      return;
    }
    
    // Sanitize visual_type if the user modifies another field but leaves the type untouched
    if (field !== 'visual_type' && copy[idx].visual_type) {
      copy[idx].visual_type = getValidVisualType(copy[idx].visual_type);
    }

    copy[idx][field] = val;
    if (field === 'visual_type') {
      copy[idx].visual_meta = getDefaultMetaForType(val, copy[idx].visual_meta);
    }
    onChange(copy);
  };

  const handleUpdateMeta = (idx: number, newMeta: any) => {
    const copy = [...subVisuals];
    copy[idx] = { ...copy[idx], visual_meta: newMeta };
    onChange(copy);
  };

  const handleAdd = () => {
    onChange([...subVisuals, { visual_type: 'scene', visual_cue: '', visual_meta: {} }]);
  };

  const handleInsert = (idx: number) => {
    const copy = [...subVisuals];
    copy.splice(idx, 0, { visual_type: 'scene', visual_cue: '', visual_meta: {} });
    onChange(copy);
  };

  const handleRemove = (idx: number) => {
    onChange(subVisuals.filter((_: any, i: number) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Sub-Visuals (Cuts)</label>
      </div>
      
      <SubVisualsDurationBar 
        subVisuals={subVisuals} 
        onChange={(ratios) => {
          const copy = [...subVisuals];
          ratios.forEach((r, i) => {
             copy[i].duration_ratio = r;
             copy[i].duration = r * ((totalDurationFrames || 0) / 30);
          });
          onChange(copy);
        }} 
        totalDurationFrames={totalDurationFrames || 0} 
      />

      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <Fragment key={idx}>
            {/* Insert divider between cards */}
            <div className="flex items-center gap-2 group/insert">
              <div className="flex-1 h-px bg-white/5 group-hover/insert:bg-amber-500/20 transition-colors"></div>
              <button type="button" onClick={(e) => { e.stopPropagation(); handleInsert(idx); }} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-stone-500 hover:text-amber-400 opacity-0 group-hover/insert:opacity-100 transition-all duration-200 px-2 py-1 rounded hover:bg-amber-500/10 cursor-pointer" title="Insert layer here">
                <BsPlus size={14} /> Insert
              </button>
              <div className="flex-1 h-px bg-white/5 group-hover/insert:bg-amber-500/20 transition-colors"></div>
            </div>

            <div key={idx}
              data-active-sub={isActive ? 'true' : undefined}
              onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
              className={`p-4 rounded-xl border space-y-4 relative cursor-pointer transition-all duration-300 group ${isActive ? 'border-amber-500/40 bg-amber-900/5 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-black/30'}`}>
              <div className="absolute top-2 right-2 flex gap-1">
                {onUploadSubVisual && ['image', 'portrait', 'parallax', 'device_mockup'].includes(getValidVisualType(sv.visual_type)) && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onUploadSubVisual(idx); }} disabled={uploadingSubVisual !== null} className="text-green-500/80 hover:text-green-400 text-xs px-2 py-1 bg-green-500/10 rounded-md cursor-pointer transition-colors disabled:opacity-50" title="Upload Image">
                    {uploadingSubVisual !== null ? <div className="w-3 h-3 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" /> : <BsUpload size={14} />}
                  </button>
                )}
                {onPreviewSubVisual && ['scene', 'image', 'portrait', 'parallax', 'youtube', 'ai_image', 'device_mockup'].includes(getValidVisualType(sv.visual_type)) && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onPreviewSubVisual(idx); }} disabled={previewingSubVisual !== null} className="text-blue-500/80 hover:text-blue-400 text-xs px-2 py-1 bg-blue-500/10 rounded-md cursor-pointer transition-colors disabled:opacity-50" title="Download & Preview">
                    {previewingSubVisual !== null ? <div className="w-3 h-3 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" /> : <BsEye size={14} />}
                  </button>
                )}
                {onRewriteSubVisual && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (aiPromptIdx === idx) { setAiPromptIdx(null); setAiPromptText(''); } else { setAiPromptIdx(idx); setAiPromptText(''); } }} className="text-amber-500/80 hover:text-amber-400 text-xs px-2 py-1 bg-amber-500/10 rounded-md cursor-pointer transition-colors" title="AI Magic Rewrite"><BsStars size={14} /></button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(idx); }} className="text-red-500/70 hover:text-red-400 text-xs px-2 py-1 bg-red-500/10 rounded-md cursor-pointer transition-colors opacity-0 group-hover:opacity-100"><BiTrashAlt size={14} /></button>
              </div>
            
            {aiPromptIdx === idx && onRewriteSubVisual && (
              <div className="bg-amber-950/40 p-2.5 rounded border border-amber-900/50 mt-8 mb-2 relative" onClick={e => e.stopPropagation()}>
                <div className="flex gap-2">
                  <input 
                    autoFocus
                    type="text" 
                    placeholder={`e.g. Change this to a stunning network diagram...`}
                    className="flex-1 bg-black/50 border border-amber-900/50 rounded px-3 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50"
                    value={aiPromptText}
                    onChange={e => setAiPromptText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && aiPromptText.trim() && !isRewriting) {
                        e.preventDefault();
                        setIsRewriting(true);
                        onRewriteSubVisual(idx, aiPromptText).finally(() => {
                          setIsRewriting(false);
                          setAiPromptIdx(null);
                          setAiPromptText('');
                        });
                      }
                    }}
                  />
                  <button 
                    disabled={isRewriting || !aiPromptText.trim()}
                    onClick={() => {
                      setIsRewriting(true);
                      onRewriteSubVisual(idx, aiPromptText).finally(() => {
                        setIsRewriting(false);
                        setAiPromptIdx(null);
                        setAiPromptText('');
                      });
                    }}
                    className="bg-amber-600 hover:bg-amber-500 text-white px-3 rounded flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isRewriting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <BsSendFill size={12} />}
                  </button>
                </div>
              </div>
            )}
            
            <div className={`flex items-center gap-2 mb-2 ${aiPromptIdx === idx ? 'mt-2' : ''}`}>
              <div className={`text-xs font-bold tracking-wide ${isActive ? 'text-amber-400' : 'text-stone-400 group-hover:text-stone-300'}`}>Layer {idx + 1}</div>
              {timing && (
                <div className="text-[10px] font-mono bg-black/40 px-2 py-0.5 rounded-full text-stone-500 border border-white/5">
                  {formatTime(timing.start)} - {formatTime(timing.end)}
                </div>
              )}
              {isActive && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
            </div>
            <div className="grid grid-cols-2 gap-4" onClick={e => e.stopPropagation()}>
              <div className="col-span-2">
                <CustomInput label="Visual Cue Keyword" type="text" placeholder="e.g. A bustling city at night..." value={sv.visual_cue || ''} onChange={(e) => handleUpdate(idx, 'visual_cue', e.target.value)} />
              </div>
              <div className="col-span-1">
                <CustomSelect label="Layer Type" options={VISUAL_TYPE_OPTIONS} value={getValidVisualType(sv.visual_type)} onChange={(val) => handleUpdate(idx, 'visual_type', val)} />
              </div>
              <div className="col-span-1">
                <CustomSelect label="Transition" options={TRANSITION_TYPE_OPTIONS} value={sv.transition_type || sv.transition || 'subtle_slide'} onChange={(val) => handleUpdate(idx, 'transition_type', val)} />
              </div>

              {/* Video volume control — only for video-capable types */}
              {(getValidVisualType(sv.visual_type) === 'scene' || getValidVisualType(sv.visual_type) === 'youtube') && (
                <div className="col-span-2 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <label className="text-stone-400 font-bold uppercase tracking-wider">Video Audio Volume:</label>
                    <span className="text-amber-500 font-mono font-bold">{sv.videoVolume !== undefined ? Math.round(sv.videoVolume * 100) : 0}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={sv.videoVolume !== undefined ? sv.videoVolume : 0}
                    onChange={(e) => handleUpdate(idx, 'videoVolume', parseFloat(e.target.value))}
                    className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="flex justify-between text-[9px] text-stone-600">
                    <span>Muted</span>
                    <span>Full</span>
                  </div>
                </div>
              )}

              {/* Audio cut toggles — available for every sub-visual type: silence
                  the narrator voiceover / bg music for this exact interval. */}
              <div className="col-span-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleUpdate(idx, 'mute_voiceover', !sv.mute_voiceover); }}
                  className={`flex-1 px-2 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${sv.mute_voiceover ? 'bg-red-500/15 border-red-500/50 text-red-400' : 'bg-white/5 border-white/10 text-stone-400 hover:border-emerald-500/40 hover:text-emerald-400'}`}
                  title="Cut the narrator voiceover during this sub-visual's interval"
                >
                  {sv.mute_voiceover ? '✕ Cut Voiceover' : '🎙️ Voiceover On'}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleUpdate(idx, 'mute_bg_music', !sv.mute_bg_music); }}
                  className={`flex-1 px-2 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${sv.mute_bg_music ? 'bg-red-500/15 border-red-500/50 text-red-400' : 'bg-white/5 border-white/10 text-stone-400 hover:border-blue-500/40 hover:text-blue-400'}`}
                  title="Cut the background music during this sub-visual's interval"
                >
                  {sv.mute_bg_music ? '✕ Cut Music' : '🎵 Music On'}
                </button>
              </div>

              {/* Always-visible Camera Transform controls */}
              <TransformEditor
                transform={sv.transform}
                onChange={(newTransform) => handleUpdate(idx, 'transform', newTransform)}
              />

              {sv.visual_type === 'youtube' && (
                <div className="col-span-2 mt-2 bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 shadow-lg">
                  <div className="space-y-1.5">
                     <div className="flex justify-between items-center text-xs">
                      <label className="text-stone-400 font-bold uppercase tracking-wider">Start Offset (Skip Intro):</label>
                      <span className="text-amber-500 font-mono font-bold">{sv.visual_meta?.start_offset !== undefined ? sv.visual_meta.start_offset : 15}s</span>
                    </div>
                    <input type="range" min="0" max="120" step="1" value={sv.visual_meta?.start_offset !== undefined ? sv.visual_meta.start_offset : 15} onChange={(e) => handleUpdateMeta(idx, { ...sv.visual_meta, start_offset: parseInt(e.target.value) })} className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-stone-400 font-bold uppercase tracking-wider">Clip Duration:</label>
                      <span className="text-[var(--color-accent-light)] font-mono font-bold">{sv.visual_meta?.duration !== undefined ? sv.visual_meta.duration : 15}s</span>
                    </div>
                    <input type="range" min="5" max="60" step="1" value={sv.visual_meta?.duration !== undefined ? sv.visual_meta.duration : 15} onChange={(e) => handleUpdateMeta(idx, { ...sv.visual_meta, duration: parseInt(e.target.value) })} className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent-primary)]" />
                  </div>
                </div>
              )}

              {sv.visual_type === 'map' && (
                <MapLocationsEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}

              {sv.visual_type === 'document' && (
                <NewspaperEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}

              {sv.visual_type === 'network' && (
                <NetworkDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'parallax' && (
                <ParallaxEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'list' && (
                <NumberingEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'custom_html' && (
                <HtmlDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'thread' && (
                <ThreadSimulationEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'device_mockup' && (
                <DeviceMockupEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              <CustomHtmlUiEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />

            </div>
          </div>
          </Fragment>
        )
      })}
      {subVisuals.length === 0 && <p className="text-xs text-stone-500 italic">No sub-visuals. A default black screen will be shown.</p>}
      
      <button type="button" onClick={handleAdd} className="w-full py-3 mt-2 text-xs font-bold uppercase tracking-wider bg-amber-600/10 text-amber-500 hover:bg-amber-600/20 border border-amber-600/30 border-dashed rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors">
        <BsPlus size={20} /> Add New Sub-Visual
      </button>
    </div>
  );
};

