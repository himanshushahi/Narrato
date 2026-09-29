import { CustomInput } from '../../components/ui/CustomInput';
import { SubVisualsDurationBar } from './SubVisualsDurationBar';
import { AstGraphicalEditor } from './components/AstGraphicalEditor';
import { formatTime } from './constants';
import { BiTrashAlt } from 'react-icons/bi';
import { BsPlus, BsStars, BsSendFill } from 'react-icons/bs';
import { useState, Fragment, useEffect, useRef, useCallback } from 'react';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('json', json);

// Stable fallback so AstGraphicalEditor's echo check doesn't see a fresh {}
// literal on every render when a cut has no composition yet.
const EMPTY_COMPOSITION: Record<string, any> = Object.freeze({ type: 'Sequence', children: [] }) as Record<string, any>;

const AstJsonEditor = ({ initialValue, onChange }: { initialValue: object, onChange: (val: object) => void }) => {
  const [text, setText] = useState(() => JSON.stringify(initialValue, null, 2));
  const [error, setError] = useState(false);

  useEffect(() => {
    // Sync external changes only if valid and different to prevent jumping
    const newText = JSON.stringify(initialValue, null, 2);
    try {
      const currentParsed = JSON.parse(text);
      if (JSON.stringify(currentParsed, null, 2) !== newText) {
        setText(newText);
      }
    } catch {
      // If currently invalid, don't clobber it unless forced
    }
  }, [initialValue]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className={`w-full h-[400px] bg-black/40 border rounded text-xs font-mono overflow-auto ${error ? 'border-red-500/50' : 'border-white/10 focus-within:border-amber-500/50'}`}>
      <Editor
        value={text}
        onValueChange={handleChange}
        highlight={code => hljs.highlight(code, { language: 'json' }).value}
        padding={12}
        style={{
          fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace',
          minHeight: '100%',
        }}
        textareaClassName="focus:outline-none"
      />
    </div>
  );
};

export const SubVisualsEditor = ({ subVisuals, onChange, timings, activeIdx, onSeek, onRewriteSubVisual, totalDurationFrames = 0, onUploadSubVisual, onPreviewSubVisual, onDeleteLayer, onDuplicateLayer, onMoveLayer, onReorderLayer, uploadingSubVisual, singleCut = false, cutNumber, aiDisabled = false, promptDraftKey, loadPromptDraft, savePromptDraft }: { subVisuals: any[], onChange: (newSubs: any[]) => void, timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void, onRewriteSubVisual?: (idx: number, prompt: string) => Promise<void>, totalDurationFrames?: number, onUploadSubVisual?: (idx: number, visualType?: string, layerIdx?: number) => Promise<string | undefined> | void, onPreviewSubVisual?: (idx: number, query: string, layerIdx?: number, visualType?: string, source?: string, imageType?: string) => Promise<string | undefined> | void, onDeleteLayer?: (cutIdx: number, layerIdx: number) => void, onDuplicateLayer?: (cutIdx: number, layerIdx: number) => void, onMoveLayer?: (cutIdx: number, fromIdx: number, toIdx: number) => void, onReorderLayer?: (cutIdx: number, fromIdx: number, toIdx: number) => void, uploadingSubVisual?: string | null, singleCut?: boolean, cutNumber?: number, aiDisabled?: boolean, promptDraftKey?: string, loadPromptDraft?: (key: string) => string, savePromptDraft?: (key: string, text: string) => void }) => {
  const [aiPromptIdx, setAiPromptIdx] = useState<number | null>(null);
  const [aiPromptText, setAiPromptText] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [viewMode, setViewMode] = useState<Record<number, 'gui' | 'json'>>({});

  // Keep the latest array in a ref so rapid consecutive edits build on top of
  // each other, and only resync when the prop actually changes.
  const latestSubVisualsRef = useRef(subVisuals);
  const prevSubVisualsRef = useRef(subVisuals);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  if (prevSubVisualsRef.current !== subVisuals) {
    prevSubVisualsRef.current = subVisuals;
    latestSubVisualsRef.current = subVisuals;
  }

  useEffect(() => {
    if (activeIdx === undefined || activeIdx < 0) return;
    const el = document.querySelector('[data-active-sub="true"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIdx]);

  const handleUpdate = useCallback((idx: number, field: string, val: any) => {
    const copy = [...latestSubVisualsRef.current];
    copy[idx] = { ...copy[idx] };

    copy[idx][field] = val;
    latestSubVisualsRef.current = copy;
    onChangeRef.current(copy);
  }, []);




  const handleAdd = () => {
    const copy = [...latestSubVisualsRef.current, { duration: 3.0, composition: { type: 'Sequence', children: [] } }];
    latestSubVisualsRef.current = copy;
    onChange(copy);
  };

  const handleInsert = (idx: number) => {
    const copy = [...latestSubVisualsRef.current];
    copy.splice(idx, 0, { duration: 3.0, composition: { type: 'Sequence', children: [] } });
    latestSubVisualsRef.current = copy;
    onChange(copy);
  };

  const handleRemove = (idx: number) => {
    const copy = latestSubVisualsRef.current.filter((_: any, i: number) => i !== idx);
    latestSubVisualsRef.current = copy;
    onChange(copy);
  };

  // Shortcut: V toggles Graphical <-> JSON view for all cuts in this editor.
  // Uses a functional set so the global keydown listener never sees stale state.
  const toggleViewModeAll = useCallback(() => {
    setViewMode((prev) => {
      const cuts = latestSubVisualsRef.current || [];
      if (cuts.length === 0) return prev;
      const allJson = cuts.every((_: any, i: number) => (prev[i] ?? 'gui') === 'json');
      const next: Record<number, 'gui' | 'json'> = {};
      cuts.forEach((_: any, i: number) => {
        next[i] = allJson ? 'gui' : 'json';
      });
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'v' && e.key !== 'V') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      toggleViewModeAll();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleViewModeAll]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Sub-Visuals (Cuts)</label>
      </div>

      {/* Duration ratios only make sense for the full cut list — in single-cut
          lens mode the tab owns add/remove and the ratios stay untouched. */}
      {!singleCut && (
        <SubVisualsDurationBar
          subVisuals={subVisuals}
          onChange={(ratios) => {
            const copy = [...latestSubVisualsRef.current];
            ratios.forEach((r, i) => {
              copy[i].duration_ratio = r;
              copy[i].duration = r * ((totalDurationFrames || 0) / 30);
            });
            latestSubVisualsRef.current = copy;
            onChange(copy);
          }}
          totalDurationFrames={totalDurationFrames || 0}
        />
      )}

      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <Fragment key={idx}>
            {/* Insert divider between cards (list mode only) */}
            {!singleCut && (
              <div className="flex items-center gap-2 group/insert">
                <div className="flex-1 h-px bg-white/5 group-hover/insert:bg-amber-500/20 transition-colors"></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); handleInsert(idx); }} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-stone-500 hover:text-amber-400 opacity-0 group-hover/insert:opacity-100 transition-all duration-200 px-2 py-1 rounded hover:bg-amber-500/10 cursor-pointer" title="Insert layer here">
                  <BsPlus size={14} /> Insert
                </button>
                <div className="flex-1 h-px bg-white/5 group-hover/insert:bg-amber-500/20 transition-colors"></div>
              </div>
            )}

            <div key={idx}
              data-active-sub={isActive ? 'true' : undefined}
              onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
              className={`p-3.5 rounded-xl border space-y-3 relative cursor-pointer transition-all duration-300 group ${isActive ? 'border-amber-500/40 bg-amber-900/5 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-black/30'}`}
            >
              {/* Card Header: Cut Index, Timing & Action Buttons */}
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`text-xs font-bold tracking-wide shrink-0 ${isActive ? 'text-amber-400' : 'text-stone-400 group-hover:text-stone-300'}`}>
                    Cut {cutNumber ?? idx + 1}
                  </div>
                  {timing && (
                    <div className="text-[10px] font-mono bg-black/40 px-2 py-0.5 rounded-full text-stone-400 border border-white/5 shrink-0">
                      {formatTime(timing.start)} - {formatTime(timing.end)}
                    </div>
                  )}
                  {isActive && (
                    <span className="flex h-2 w-2 relative shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                  {onRewriteSubVisual && (
                    <button
                      type="button"
                      disabled={aiDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (aiDisabled) return;
                        if (aiPromptIdx === idx) {
                          setAiPromptIdx(null);
                          setAiPromptText('');
                        } else {
                          setAiPromptIdx(idx);
                          // Restore the per-cut draft so switching cuts mid-typing never loses it.
                          setAiPromptText(promptDraftKey && loadPromptDraft ? (loadPromptDraft(promptDraftKey) ?? '') : '');
                        }
                      }}
                      className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors ${aiDisabled ? 'opacity-40 cursor-not-allowed text-stone-500 bg-white/5 border border-white/10' : `cursor-pointer ${aiPromptIdx === idx ? 'bg-amber-500 text-black font-bold' : 'text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30'}`}`}
                      title={aiDisabled ? 'AI rewrites run one at a time — wait for the current one' : 'AI Magic Rewrite'}
                    >
                      <BsStars size={12} />
                      <span className="text-[10px] font-bold">AI Rewrite</span>
                    </button>
                  )}
                  {!singleCut && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemove(idx); }}
                      className="p-1.5 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-colors cursor-pointer"
                      title="Delete Cut"
                    >
                      <BiTrashAlt size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* AI Rewrite Prompt Input Box */}
              {aiPromptIdx === idx && onRewriteSubVisual && (
                <div className="bg-amber-950/40 p-2.5 rounded-lg border border-amber-900/50 relative" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-2">
                    <CustomInput
                      autoFocus
                      type="text"
                      placeholder={`e.g. Change this to a stunning 3D globe animation...`}
                      className="flex-1 bg-black/50 border border-amber-900/50 rounded px-3 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50"
                      value={aiPromptText}
                      onChange={e => {
                        setAiPromptText(e.target.value);
                        if (promptDraftKey && savePromptDraft) savePromptDraft(promptDraftKey, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && aiPromptText.trim() && !isRewriting && !aiDisabled) {
                          e.preventDefault();
                          setIsRewriting(true);
                          if (promptDraftKey && savePromptDraft) savePromptDraft(promptDraftKey, '');
                          onRewriteSubVisual(idx, aiPromptText).finally(() => {
                            setIsRewriting(false);
                            setAiPromptIdx(null);
                            setAiPromptText('');
                          });
                        }
                      }}
                    />
                    <button
                      disabled={isRewriting || aiDisabled || !aiPromptText.trim()}
                      onClick={() => {
                        setIsRewriting(true);
                        if (promptDraftKey && savePromptDraft) savePromptDraft(promptDraftKey, '');
                        onRewriteSubVisual(idx, aiPromptText).finally(() => {
                          setIsRewriting(false);
                          setAiPromptIdx(null);
                          setAiPromptText('');
                        });
                      }}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-3 rounded flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {isRewriting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <BsSendFill size={12} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Cut Toolbar: Transition Selector & Audio Toggles */}
              <div className="p-2.5 bg-black/35 border border-white/5 rounded-lg space-y-2" onClick={e => e.stopPropagation()}>
                {/* Transition Selector: Fills available horizontal width */}
                <div className="flex items-center gap-2 w-full">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
                    ⚡ Transition:
                  </span>
                  <select
                    className="flex-1 w-full bg-black/60 border border-white/10 hover:border-amber-500/40 text-[11px] font-semibold text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    value={sv.transition || 'cut'}
                    onChange={e => handleUpdate(idx, 'transition', e.target.value)}
                  >
                    <option value="cut">Cut (Instant)</option>
                    <option value="slide_left">Slide Left</option>
                    <option value="slide_right">Slide Right</option>
                    <option value="slide_up">Slide Up</option>
                    <option value="slide_down">Slide Down</option>
                    <option value="zoom_in">Zoom In (Punch)</option>
                    <option value="zoom_out">Zoom Out</option>
                    <option value="whip_pan">Whip Pan (Motion Blur)</option>
                    <option value="glitch">Glitch Jitter</option>
                    <option value="crossfade">Crossfade</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="fade">Fade</option>
                  </select>
                </div>

                {/* Punch-in Emphasis Marks: mid-cut zoom snaps */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
                      🎯 Punch-ins ({(sv.emphasis || []).length}):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const dur = typeof sv.duration === 'number' && sv.duration > 0 ? sv.duration : 3;
                        const marks = [...(sv.emphasis || [])];
                        marks.push({ at: Number(Math.min(Math.max(0.5, dur / 3), Math.max(0, dur - 0.6)).toFixed(2)), scale: 1.12, duration: 0.5 });
                        handleUpdate(idx, 'emphasis', marks);
                      }}
                      className="text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded cursor-pointer"
                      title="Add a punch-in zoom (sudden scale-up + settle) at 1/3 into this cut"
                    >
                      + Add
                    </button>
                  </div>
                  {(sv.emphasis || []).map((m: any, mIdx: number) => {
                    const dur = typeof sv.duration === 'number' && sv.duration > 0 ? sv.duration : 3;
                    const setMark = (patch: Record<string, any>) => {
                      const marks = [...(sv.emphasis || [])];
                      marks[mIdx] = { ...marks[mIdx], ...patch };
                      handleUpdate(idx, 'emphasis', marks);
                    };
                    const delMark = () => {
                      handleUpdate(idx, 'emphasis', (sv.emphasis || []).filter((_: any, i: number) => i !== mIdx));
                    };
                    return (
                      <div key={mIdx} className="p-2 bg-black/40 border border-white/10 rounded-lg space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-stone-400">Punch {mIdx + 1}</span>
                          <button type="button" onClick={delMark}
                            className="text-[9px] text-stone-500 hover:text-red-400 uppercase font-semibold cursor-pointer">
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="space-y-0.5">
                            <span className="text-[8px] font-bold uppercase text-stone-500">At (s)</span>
                            <input type="number" min={0} max={dur} step={0.1}
                              value={m?.at ?? 0}
                              onChange={e => setMark({ at: Math.min(dur, Math.max(0, parseFloat(e.target.value) || 0)) })}
                              className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-1 text-[11px] font-mono text-stone-200 focus:outline-none focus:border-amber-500/50" />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-[8px] font-bold uppercase text-stone-500">Zoom</span>
                            <input type="number" min={1.02} max={1.6} step={0.01}
                              value={m?.scale ?? 1.12}
                              onChange={e => setMark({ scale: Math.min(1.6, Math.max(1.02, parseFloat(e.target.value) || 1.12)) })}
                              className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-1 text-[11px] font-mono text-stone-200 focus:outline-none focus:border-amber-500/50" />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-[8px] font-bold uppercase text-stone-500">Secs</span>
                            <input type="number" min={0.2} max={2} step={0.1}
                              value={m?.duration ?? 0.5}
                              onChange={e => setMark({ duration: Math.min(2, Math.max(0.2, parseFloat(e.target.value) || 0.5)) })}
                              className="w-full bg-black/60 border border-white/10 rounded px-1.5 py-1 text-[11px] font-mono text-stone-200 focus:outline-none focus:border-amber-500/50" />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Audio Cut toggles: 50% / 50% Equal Horizontal Split */}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => handleUpdate(idx, 'mute_voiceover', !sv.mute_voiceover)}
                    className={`w-full py-1.5 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5 ${sv.mute_voiceover ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-white/5 border-white/10 text-stone-300 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                    title="Mute / Unmute narrator voiceover during this cut"
                  >
                    {sv.mute_voiceover ? '✕ Voice Muted' : '🎙️ Voice On'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdate(idx, 'mute_bg_music', !sv.mute_bg_music)}
                    className={`w-full py-1.5 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5 ${sv.mute_bg_music ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-white/5 border-white/10 text-stone-300 hover:border-blue-500/40 hover:text-blue-400 hover:bg-blue-500/10'}`}
                    title="Mute / Unmute background music during this cut"
                  >
                    {sv.mute_bg_music ? '✕ Music Off' : '🎵 Music On'}
                  </button>
                </div>
              </div>

              {/* Composition Section */}
              <div className="space-y-2 pt-1 min-w-0" onClick={e => e.stopPropagation()}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-400 shrink-0">Composition (AST)</label>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
                    {viewMode[idx] !== 'json' && ((sv ?? latestSubVisualsRef.current[idx])?.composition?.children?.length ?? 0) > 1 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('ast:toggle-collapse-all')); }}
                        className="h-6 inline-flex items-center px-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                        title="Collapse all to compact rows, or expand them again (X)"
                      >
                        Collapse
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setViewMode(prev => ({ ...prev, [idx]: prev[idx] === 'json' ? 'gui' : 'json' })) }}
                      className="h-6 inline-flex items-center px-2 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                      title="Toggle Graphical / JSON view (V)"
                    >
                      View: {viewMode[idx] === 'json' ? 'GUI' : 'JSON'}
                    </button>
                  </div>
                </div>

                {viewMode[idx] === 'json' ? (
                  <AstJsonEditor
                    initialValue={(sv ?? latestSubVisualsRef.current[idx])?.composition || EMPTY_COMPOSITION}
                    onChange={(parsed) => handleUpdate(idx, 'composition', parsed)}
                  />
                ) : (
                  <AstGraphicalEditor
                    initialValue={(sv ?? latestSubVisualsRef.current[idx])?.composition || EMPTY_COMPOSITION}
                    onChange={(parsed) => handleUpdate(idx, 'composition', parsed)}
                    onUploadSubVisual={onUploadSubVisual ? (visualType, layerIdx) => onUploadSubVisual(idx, visualType, layerIdx) : undefined}
                    onPreviewSubVisual={onPreviewSubVisual ? (query, layerIdx, visualType, source, imageType) => onPreviewSubVisual(idx, query, layerIdx, visualType, source, imageType) : undefined}
                    onDeleteLayer={onDeleteLayer ? (layerIdx) => onDeleteLayer(idx, layerIdx) : undefined}
                    onDuplicateLayer={onDuplicateLayer ? (layerIdx) => onDuplicateLayer(idx, layerIdx) : undefined}
                    onMoveLayer={onMoveLayer ? (fromIdx, toIdx) => onMoveLayer(idx, fromIdx, toIdx) : undefined}
                    onReorderLayer={onReorderLayer ? (fromIdx, toIdx) => onReorderLayer(idx, fromIdx, toIdx) : undefined}
                    uploadingSubVisual={uploadingSubVisual}
                  />
                )}
              </div>
            </div>
          </Fragment>
        )
      })}
      {subVisuals.length === 0 && <p className="text-xs text-stone-500 italic">No sub-visuals. A default black screen will be shown.</p>}

      {!singleCut && (
        <button type="button" onClick={handleAdd} className="w-full py-3 mt-2 text-xs font-bold uppercase tracking-wider bg-amber-600/10 text-amber-500 hover:bg-amber-600/20 border border-amber-600/30 border-dashed rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors">
          <BsPlus size={20} /> Add New Sub-Visual
        </button>
      )}
    </div>
  );
};

