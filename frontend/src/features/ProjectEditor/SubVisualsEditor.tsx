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

export const SubVisualsEditor = ({ subVisuals, onChange, timings, activeIdx, onSeek, onRewriteSubVisual, totalDurationFrames = 0, onUploadSubVisual, onPreviewSubVisual, uploadingSubVisual }: { subVisuals: any[], onChange: (newSubs: any[]) => void, timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void, onRewriteSubVisual?: (idx: number, prompt: string) => Promise<void>, totalDurationFrames?: number, onUploadSubVisual?: (idx: number, visualType?: string) => Promise<string | undefined> | void, onPreviewSubVisual?: (idx: number, query: string) => Promise<string | undefined> | void, uploadingSubVisual?: string | null }) => {
  const [aiPromptIdx, setAiPromptIdx] = useState<number | null>(null);
  const [aiPromptText, setAiPromptText] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [viewMode, setViewMode] = useState<Record<number, 'gui'|'json'>>({});

  // Keep the latest array in a ref so rapid consecutive edits build on top of
  // each other, and only resync when the prop actually changes.
  const latestSubVisualsRef = useRef(subVisuals);
  const prevSubVisualsRef = useRef(subVisuals);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (prevSubVisualsRef.current !== subVisuals) {
      prevSubVisualsRef.current = subVisuals;
      latestSubVisualsRef.current = subVisuals;
    }
  });

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Sub-Visuals (Cuts)</label>
      </div>

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

                {onRewriteSubVisual && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); if (aiPromptIdx === idx) { setAiPromptIdx(null); setAiPromptText(''); } else { setAiPromptIdx(idx); setAiPromptText(''); } }} className="text-amber-500/80 hover:text-amber-400 text-xs px-2 py-1 bg-amber-500/10 rounded-md cursor-pointer transition-colors" title="AI Magic Rewrite"><BsStars size={14} /></button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(idx); }} className="text-red-500/70 hover:text-red-400 text-xs px-2 py-1 bg-red-500/10 rounded-md cursor-pointer transition-colors opacity-0 group-hover:opacity-100"><BiTrashAlt size={14} /></button>
              </div>

              {aiPromptIdx === idx && onRewriteSubVisual && (
                <div className="bg-amber-950/40 p-2.5 rounded border border-amber-900/50 mt-8 mb-2 relative" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-2">
                    <CustomInput
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
                <div className="col-span-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Composition (AST)</label>
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); setViewMode(prev => ({ ...prev, [idx]: prev[idx] === 'json' ? 'gui' : 'json' })) }} 
                      className="text-[10px] font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 text-stone-300 px-2 py-1 rounded transition-colors"
                    >
                       View: {viewMode[idx] === 'json' ? 'GUI' : 'JSON'}
                    </button>
                  </div>
                  {viewMode[idx] === 'json' ? (
                    <AstJsonEditor
                      initialValue={latestSubVisualsRef.current[idx]?.composition || {}}
                      onChange={(parsed) => handleUpdate(idx, 'composition', parsed)}
                    />
                  ) : (
                    <AstGraphicalEditor
                      initialValue={latestSubVisualsRef.current[idx]?.composition || {}}
                      onChange={(parsed) => handleUpdate(idx, 'composition', parsed)}
                      onUploadSubVisual={onUploadSubVisual ? (visualType) => onUploadSubVisual(idx, visualType) : undefined}
                      onPreviewSubVisual={onPreviewSubVisual ? (query) => onPreviewSubVisual(idx, query) : undefined}
                      uploadingSubVisual={uploadingSubVisual}
                    />
                  )}
                </div>

                {/* Audio cut toggles — available for every sub-visual type: silence
                  the narrator voiceover / bg music for this exact interval. */}
                <div className="col-span-2 flex items-center gap-2 mt-2">
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

