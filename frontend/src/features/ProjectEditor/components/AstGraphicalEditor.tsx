import { useState, useEffect } from 'react';
import { BiTrashAlt, BiCopy } from 'react-icons/bi';
import { BsPlus, BsSearch, BsUpload } from 'react-icons/bs';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/atom-one-dark.css';
import { callApi } from '../../../utils/call-api';
import { useProjectStore } from '../../../store/useProjectStore';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

hljs.registerLanguage('json', json);

const MiniJsonEditor = ({ label, value, onChange }: { label: string, value: any, onChange: (val: any) => void }) => {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const currentParsed = JSON.parse(text);
      const newText = JSON.stringify(value || {}, null, 2);
      if (JSON.stringify(currentParsed, null, 2) !== newText) {
        setText(newText);
      }
    } catch {
      // ignore
    }
  }, [value, text]);

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
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase text-stone-400">{label}</label>
      <div className={`w-full bg-black/40 border rounded text-[10px] font-mono overflow-auto ${error ? 'border-red-500/50' : 'border-white/10'}`}>
        <Editor
          value={text}
          onValueChange={handleChange}
          highlight={code => hljs.highlight(code, { language: 'json' }).value}
          padding={8}
          style={{ fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace', minHeight: '60px' }}
          textareaClassName="focus:outline-none"
        />
      </div>
    </div>
  );
};

export const AstGraphicalEditor = ({ initialValue, onChange, onUploadSubVisual, uploadingSubVisual }: { initialValue: any, onChange: (val: any) => void, onUploadSubVisual?: (visualType?: string) => Promise<string | undefined> | void, uploadingSubVisual?: string | null }) => {
  const selectedProject = useProjectStore(s => s.selectedProject);
  const [composition, setComposition] = useState(() => {
    if (!initialValue || !initialValue.type) {
      return { type: 'Sequence', children: [] };
    }
    return initialValue;
  });

  const [draftQueries, setDraftQueries] = useState<Record<number, string>>({});
  const [previewingIdx, setPreviewingIdx] = useState<number | null>(null);
  const [previewPaths, setPreviewPaths] = useState<Record<number, string>>({});

  useEffect(() => {
    if (initialValue && initialValue !== composition) {
      if (JSON.stringify(initialValue) !== JSON.stringify(composition)) {
         setComposition(initialValue);
      }
    }
  }, [initialValue, composition]);

  const triggerChange = (newComp: any) => {
    setComposition(newComp);
    onChange(newComp);
  };

  const updateLayer = (idx: number, field: string, val: any) => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children[idx] = { ...newComp.children[idx], [field]: val };
    triggerChange(newComp);
  };

  const updateContent = (idx: number, field: string, val: any) => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    const content = { ...(newComp.children[idx].content || {}) };
    content[field] = val;
    newComp.children[idx] = { ...newComp.children[idx], content };
    triggerChange(newComp);
  };

  const handleAddLayer = () => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.push({
      type: 'Layer',
      z_index: (newComp.children.length > 0 ? (newComp.children[newComp.children.length - 1].z_index || 0) + 5 : 0),
      content: { type: 'Image', query: '', source: 'pexels' }
    });
    triggerChange(newComp);
  };

  const handleDeleteLayer = (idx: number) => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.splice(idx, 1);
    triggerChange(newComp);
  };

  const handleDuplicateLayer = (idx: number) => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    const clone = JSON.parse(JSON.stringify(newComp.children[idx]));
    clone.z_index = (clone.z_index || 0) + 1;
    newComp.children.splice(idx + 1, 0, clone);
    triggerChange(newComp);
  };

  const handleQueryChange = (idx: number, newQuery: string) => {
     setDraftQueries(prev => ({ ...prev, [idx]: newQuery }));
  };

  const handlePreviewQuery = async (idx: number, queryToSearch: string) => {
     if (!selectedProject?.id || !queryToSearch) return;
     setPreviewingIdx(idx);
     try {
       const res = await callApi<{ success: boolean; visual_path?: string; error?: string }>('preview_asset_download', selectedProject.id, queryToSearch);
       if (res?.success && res.visual_path) {
         setPreviewPaths(prev => ({ ...prev, [idx]: res.visual_path as string }));
       } else {
         alert("Preview failed: " + res?.error);
       }
     } catch(e) {
       alert("Preview error: " + e);
     } finally {
       setPreviewingIdx(null);
     }
  };

  const handleSavePreview = (idx: number) => {
     if (draftQueries[idx] !== undefined) {
         updateContent(idx, 'query', draftQueries[idx]);
     }
     setDraftQueries(prev => {
       const copy = {...prev};
       delete copy[idx];
       return copy;
     });
  };

  const handleDiscardPreview = (idx: number) => {
     setDraftQueries(prev => {
       const copy = {...prev};
       delete copy[idx];
       return copy;
     });
     setPreviewPaths(prev => {
       const copy = {...prev};
       delete copy[idx];
       return copy;
     });
  };

  const layers = composition.children || [];

  return (
    <div className="space-y-4">
      {layers.map((layer: any, idx: number) => {
        const content = layer.content || {};
        const cType = content.type || 'Image';
        
        return (
          <div key={idx} className="p-3 bg-black/30 border border-white/5 rounded-lg space-y-3 relative group/layer hover:border-white/10 transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-500">Layer {idx + 1}</span>
                <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded border border-white/10 focus-within:border-amber-500/50">
                  <span className="text-[10px] text-stone-400">Z-Index:</span>
                  <input 
                    type="number" 
                    className="bg-transparent w-12 text-xs text-white focus:outline-none text-center"
                    value={layer.z_index ?? 0}
                    onChange={(e) => updateLayer(idx, 'z_index', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover/layer:opacity-100 transition-opacity">
                <button type="button" onClick={() => handleDuplicateLayer(idx)} className="p-1.5 text-stone-400 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors" title="Duplicate Layer"><BiCopy size={12} /></button>
                <button type="button" onClick={() => handleDeleteLayer(idx)} className="p-1.5 text-red-500/70 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors" title="Delete Layer"><BiTrashAlt size={12} /></button>
              </div>
            </div>

            {/* Content Type Selector */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-stone-400 w-16">Type</label>
              <select 
                className="bg-black/40 border border-white/10 text-xs text-white rounded px-2 py-1.5 focus:outline-none focus:border-amber-500/50 flex-1"
                value={cType}
                onChange={(e) => updateContent(idx, 'type', e.target.value)}
              >
                <option value="Image">Image</option>
                <option value="Video">Video</option>
                <option value="Text">Text</option>
                <option value="HTML">HTML / SVG</option>
                <option value="Map">Map</option>
              </select>
            </div>

            {/* Dynamic Content Fields */}
            {(cType === 'Image' || cType === 'Video') && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase text-stone-400 w-16">Query</label>
                  <input type="text" className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50 placeholder-stone-600" 
                    value={draftQueries[idx] !== undefined ? draftQueries[idx] : (content.query || '')} 
                    onChange={e => handleQueryChange(idx, e.target.value)} 
                    placeholder="e.g. cinematic wide shot" 
                  />
                  <button 
                    type="button"
                    disabled={previewingIdx === idx}
                    onClick={() => handlePreviewQuery(idx, draftQueries[idx] !== undefined ? draftQueries[idx] : (content.query || ''))}
                    className="px-2 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] uppercase font-bold rounded flex items-center gap-1 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {previewingIdx === idx ? '...' : <BsSearch size={12} />} Preview
                  </button>
                  {onUploadSubVisual && (
                    <button 
                      type="button"
                      disabled={uploadingSubVisual !== null}
                      onClick={async () => {
                        const p = await onUploadSubVisual(cType === 'Image' ? 'image' : cType === 'Video' ? 'video' : 'ast');
                        if (p) {
                          updateContent(idx, 'local_path', p);
                          updateContent(idx, 'source', 'upload');
                        }
                      }}
                      className="px-2 py-1.5 bg-green-600 hover:bg-green-500 text-white text-[10px] uppercase font-bold rounded flex items-center gap-1 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <BsUpload size={12} /> Upload
                    </button>
                  )}
                </div>
                
                {draftQueries[idx] !== undefined && draftQueries[idx] !== (content.query || '') && (
                  <div className="flex items-center gap-2 bg-black/20 p-2 rounded border border-amber-500/30 ml-[72px]">
                    <span className="text-[10px] text-amber-400 font-bold uppercase">Unsaved Query Changes</span>
                    <div className="flex-1"></div>
                    <button type="button" onClick={() => handleDiscardPreview(idx)} className="px-2 py-1 text-[10px] uppercase font-bold bg-red-500/20 text-red-400 hover:bg-red-500/40 rounded transition-colors cursor-pointer">Discard</button>
                    <button type="button" onClick={() => handleSavePreview(idx)} className="px-2 py-1 text-[10px] uppercase font-bold bg-green-500/20 text-green-400 hover:bg-green-500/40 rounded transition-colors cursor-pointer">Save Query</button>
                  </div>
                )}

                {previewPaths[idx] && (
                  <div className="mt-1 relative rounded overflow-hidden border border-white/10 w-full max-w-[200px] aspect-video bg-black/50 flex items-center justify-center ml-[72px]">
                     {previewPaths[idx].endsWith('.mp4') || previewPaths[idx].endsWith('.webm') ? (
                       <video src={`${getMediaUrlSync(previewPaths[idx])}&t=${Date.now()}`} className="max-w-full max-h-full object-contain" controls muted autoPlay loop />
                     ) : (
                       <img src={`${getMediaUrlSync(previewPaths[idx])}&t=${Date.now()}`} className="max-w-full max-h-full object-contain" alt="Preview" />
                     )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase text-stone-400 w-16">Source</label>
                  <select className="flex-1 bg-black/40 border border-white/10 text-xs text-white rounded px-2 py-1.5 focus:outline-none focus:border-amber-500/50" value={content.source || 'pexels'} onChange={e => updateContent(idx, 'source', e.target.value)}>
                    <option value="upload">Upload / Local</option>
                    <option value="pexels">Pexels</option>
                    <option value="pixabay">Pixabay</option>
                    {cType !== 'Video' && <option value="wikipedia">Wikipedia</option>}
                    {cType !== 'Image' && <option value="youtube">YouTube</option>}
                  </select>
                </div>
                {content.source === 'youtube' && (
                  <div className="flex gap-2 ml-[72px]">
                     <div className="flex items-center gap-2 flex-1">
                        <label className="text-[10px] font-bold uppercase text-stone-400">YT Start (s)</label>
                        <input type="number" className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50 placeholder-stone-600" value={content.yt_start_offset ?? ''} onChange={e => updateContent(idx, 'yt_start_offset', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="15" />
                     </div>
                     <div className="flex items-center gap-2 flex-1">
                        <label className="text-[10px] font-bold uppercase text-stone-400">YT Dur (s)</label>
                        <input type="number" className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50 placeholder-stone-600" value={content.yt_duration ?? ''} onChange={e => updateContent(idx, 'yt_duration', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="10" />
                     </div>
                  </div>
                )}
                {content.source === 'pixabay' && (
                  <div className="flex items-center gap-2 ml-[72px]">
                    <label className="text-[10px] font-bold uppercase text-stone-400 whitespace-nowrap">Image Type</label>
                    <select className="flex-1 bg-black/40 border border-white/10 text-xs text-white rounded px-2 py-1 focus:outline-none focus:border-amber-500/50" value={content.image_type || 'all'} onChange={e => updateContent(idx, 'image_type', e.target.value)}>
                      <option value="all">All</option>
                      <option value="photo">Photo</option>
                      <option value="illustration">Illustration (Cutout)</option>
                      <option value="vector">Vector</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {cType === 'Text' && (
              <>
                <div className="flex items-start gap-2">
                  <label className="text-[10px] font-bold uppercase text-stone-400 w-16 mt-2">Text</label>
                  <textarea className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50 min-h-[40px]" value={content.text || ''} onChange={e => updateContent(idx, 'text', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2 ml-[72px]">
                  <div className="flex items-center gap-2">
                     <label className="text-[10px] font-bold uppercase text-stone-400 w-10">Font</label>
                     <input type="text" className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50 placeholder-stone-600" value={content.font || ''} onChange={e => updateContent(idx, 'font', e.target.value)} placeholder="Noto Sans..." />
                  </div>
                  <div className="flex items-center gap-2">
                     <label className="text-[10px] font-bold uppercase text-stone-400 w-10">Color</label>
                     <input type="text" className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50 placeholder-stone-600" value={content.color || ''} onChange={e => updateContent(idx, 'color', e.target.value)} placeholder="#ffffff" />
                  </div>
                </div>
              </>
            )}

            {cType === 'HTML' && (
              <div className="flex flex-col gap-1 mt-2">
                <label className="text-[10px] font-bold uppercase text-stone-400">HTML / SVG Code</label>
                <textarea className="w-full bg-black/40 border border-white/10 rounded px-2 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500/50 min-h-[120px]" value={content.html_content || ''} onChange={e => updateContent(idx, 'html_content', e.target.value)} placeholder="<style>...</style><svg>...</svg>" />
              </div>
            )}

            {cType === 'Map' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase text-stone-400 w-16">Style</label>
                  <select className="flex-1 bg-black/40 border border-white/10 text-xs text-white rounded px-2 py-1.5 focus:outline-none focus:border-amber-500/50" value={content.map_style || 'modern_dark'} onChange={e => updateContent(idx, 'map_style', e.target.value)}>
                    <option value="modern_dark">Modern Dark</option>
                    <option value="vintage">Vintage</option>
                    <option value="minimal_light">Minimal Light</option>
                    <option value="nautical_blue">Nautical Blue</option>
                  </select>
                </div>
                <div className="ml-[72px]">
                  <MiniJsonEditor label="Locations (JSON Array)" value={content.locations || []} onChange={val => updateContent(idx, 'locations', val)} />
                </div>
              </>
            )}

            {/* Styling and Advanced (CSS, Animations, Filters) */}
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/5">
               <MiniJsonEditor label="Style (CSS Object)" value={content.style || {}} onChange={val => updateContent(idx, 'style', val)} />
               <div className="flex flex-col gap-3">
                  <MiniJsonEditor label="Animations Array" value={layer.animations || []} onChange={val => updateLayer(idx, 'animations', val)} />
                  <MiniJsonEditor label="Filters Array" value={layer.filters || []} onChange={val => updateLayer(idx, 'filters', val)} />
               </div>
            </div>

          </div>
        );
      })}

      <button type="button" onClick={handleAddLayer} className="w-full py-2.5 mt-2 text-xs font-bold uppercase tracking-wider bg-white/5 text-stone-300 hover:bg-white/10 border border-white/10 border-dashed rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
        <BsPlus size={18} /> Add Layer
      </button>
    </div>
  );
};
