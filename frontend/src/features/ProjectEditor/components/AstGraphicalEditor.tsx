import { useState, useEffect } from 'react';
import { BiTrashAlt, BiCopy } from 'react-icons/bi';
import { BsPlus, BsSearch, BsUpload, BsChevronDown, BsChevronRight, BsSliders } from 'react-icons/bs';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/atom-one-dark.css';
import { callApi } from '../../../utils/call-api';
import { useProjectStore } from '../../../store/useProjectStore';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

hljs.registerLanguage('json', json);

const MiniJsonEditor = ({ label, value, onChange }: { label: string; value: any; onChange: (val: any) => void }) => {
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
    } catch {
      setError(true);
    }
  };

  return (
    <div className="flex flex-col gap-1 w-full min-w-0">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</label>
        {error && <span className="text-[9px] text-red-400 font-mono">Invalid JSON</span>}
      </div>
      <div className={`w-full bg-black/50 border rounded-md text-[11px] font-mono overflow-auto transition-colors ${error ? 'border-red-500/50' : 'border-white/10 focus-within:border-amber-500/50'}`}>
        <Editor
          value={text}
          onValueChange={handleChange}
          highlight={code => hljs.highlight(code, { language: 'json' }).value}
          padding={8}
          style={{ fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace', minHeight: '65px' }}
          textareaClassName="focus:outline-none"
        />
      </div>
    </div>
  );
};

export const AstGraphicalEditor = ({
  initialValue,
  onChange,
  onUploadSubVisual,
  uploadingSubVisual
}: {
  initialValue: any;
  onChange: (val: any) => void;
  onUploadSubVisual?: (visualType?: string) => Promise<string | undefined> | void;
  uploadingSubVisual?: string | null;
}) => {
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
  const [expandedAdvanced, setExpandedAdvanced] = useState<Record<number, boolean>>({});

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
    const content = { ...(newComp.children[idx]?.content || {}) };
    content[field] = val;
    newComp.children[idx] = { ...newComp.children[idx], content };
    triggerChange(newComp);
  };

  const handleAddLayer = () => {
    const newComp = { ...composition };
    newComp.children = newComp.children ? [...newComp.children] : [];
    newComp.children.push({
      type: 'Layer',
      z_index: newComp.children.length > 0 ? (newComp.children[newComp.children.length - 1].z_index || 0) + 5 : 0,
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
        alert('Preview failed: ' + res?.error);
      }
    } catch (e) {
      alert('Preview error: ' + e);
    } finally {
      setPreviewingIdx(null);
    }
  };

  const handleSavePreview = (idx: number) => {
    if (draftQueries[idx] !== undefined) {
      updateContent(idx, 'query', draftQueries[idx]);
    }
    setDraftQueries(prev => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  };

  const handleDiscardPreview = (idx: number) => {
    setDraftQueries(prev => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
    setPreviewPaths(prev => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  };

  const toggleAdvanced = (idx: number) => {
    setExpandedAdvanced(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const layers = composition.children || [];

  return (
    <div className="space-y-3 w-full min-w-0">
      {layers.map((layer: any, idx: number) => {
        const content = layer.content || {};
        const cType = content.type || 'Image';
        const isAdvancedOpen = !!expandedAdvanced[idx];

        return (
          <div
            key={idx}
            className="p-3 bg-zinc-900/70 border border-zinc-800/90 rounded-xl space-y-3 relative group/layer hover:border-zinc-700/80 transition-all shadow-sm w-full min-w-0"
          >
            {/* Header: Layer Title, Z-Index, and Action Buttons */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-amber-400 shrink-0">Layer {idx + 1}</span>
                <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded-md border border-white/10 focus-within:border-amber-500/50">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase">Z:</span>
                  <input
                    type="number"
                    className="bg-transparent w-10 text-xs text-stone-200 focus:outline-none text-center font-mono"
                    value={layer.z_index ?? 0}
                    onChange={e => updateLayer(idx, 'z_index', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDuplicateLayer(idx)}
                  className="p-1.5 text-stone-400 hover:text-stone-200 bg-white/5 hover:bg-white/10 rounded-md transition-colors cursor-pointer"
                  title="Duplicate Layer"
                >
                  <BiCopy size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLayer(idx)}
                  className="p-1.5 text-red-400/80 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md transition-colors cursor-pointer"
                  title="Delete Layer"
                >
                  <BiTrashAlt size={13} />
                </button>
              </div>
            </div>

            {/* Content Type Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Type</label>
              <select
                className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                value={cType}
                onChange={e => updateContent(idx, 'type', e.target.value)}
              >
                <option value="Image">Image</option>
                <option value="Video">Video</option>
                <option value="Text">Text</option>
                <option value="HTML">HTML / SVG</option>
                <option value="Map">Map</option>
              </select>
            </div>

            {/* Dynamic Content Fields for Image and Video */}
            {(cType === 'Image' || cType === 'Video') && (
              <div className="space-y-2.5">
                {/* Search Query + Action Buttons */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Query / Search</label>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={previewingIdx === idx}
                        onClick={() => handlePreviewQuery(idx, draftQueries[idx] !== undefined ? draftQueries[idx] : (content.query || ''))}
                        className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[10px] uppercase font-bold rounded-md flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
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
                              updateContent(idx, 'local_path', p);
                              updateContent(idx, 'source', 'upload');
                            }
                          }}
                          className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[10px] uppercase font-bold rounded-md flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
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
                    value={draftQueries[idx] !== undefined ? draftQueries[idx] : (content.query || '')}
                    onChange={e => handleQueryChange(idx, e.target.value)}
                    placeholder="e.g. cinematic cityscape, futuristic neon..."
                  />
                </div>

                {/* Unsaved Query Notice */}
                {draftQueries[idx] !== undefined && draftQueries[idx] !== (content.query || '') && (
                  <div className="flex items-center justify-between gap-2 bg-amber-950/40 border border-amber-900/60 p-2 rounded-md">
                    <span className="text-[10px] text-amber-400 font-medium">Unsaved query</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDiscardPreview(idx)}
                        className="px-2 py-0.5 text-[10px] uppercase font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors cursor-pointer"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSavePreview(idx)}
                        className="px-2 py-0.5 text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Media Preview Box */}
                {previewPaths[idx] && (
                  <div className="mt-1 relative rounded-lg overflow-hidden border border-white/10 w-full max-w-[260px] aspect-video bg-black/60 mx-auto flex items-center justify-center shadow-inner">
                    {previewPaths[idx].endsWith('.mp4') || previewPaths[idx].endsWith('.webm') ? (
                      <video src={`${getMediaUrlSync(previewPaths[idx])}&t=${Date.now()}`} className="w-full h-full object-contain" controls muted autoPlay loop />
                    ) : (
                      <img src={`${getMediaUrlSync(previewPaths[idx])}&t=${Date.now()}`} className="w-full h-full object-contain" alt="Preview" />
                    )}
                  </div>
                )}

                {/* Source & Image Type in a clean grid */}
                <div className="grid grid-cols-2 gap-2">
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
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Text Content</label>
                  <textarea
                    className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-2 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 min-h-[48px] resize-none leading-relaxed"
                    value={content.text || ''}
                    onChange={e => updateContent(idx, 'text', e.target.value)}
                    placeholder="Enter text..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Font</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-mono truncate"
                      value={content.font || ''}
                      onChange={e => updateContent(idx, 'font', e.target.value)}
                      placeholder="Inter, Oswald..."
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Color</label>
                    <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md px-2 py-1 focus-within:border-amber-500/50 min-w-0">
                      <input
                        type="color"
                        value={content.color?.startsWith('#') && content.color.length === 7 ? content.color : '#ffffff'}
                        onChange={e => updateContent(idx, 'color', e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
                      />
                      <input
                        type="text"
                        className="w-full bg-transparent text-xs text-stone-200 focus:outline-none font-mono min-w-0"
                        value={content.color || ''}
                        onChange={e => updateContent(idx, 'color', e.target.value)}
                        placeholder="#ffffff"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic Content Fields for HTML */}
            {cType === 'HTML' && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">HTML / SVG Code</label>
                <textarea
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-2 text-xs text-stone-200 font-mono focus:outline-none focus:border-amber-500/50 min-h-[100px] leading-normal"
                  value={content.html_content || ''}
                  onChange={e => updateContent(idx, 'html_content', e.target.value)}
                  placeholder="<style>...</style><svg>...</svg>"
                />
              </div>
            )}

            {/* Dynamic Content Fields for Map */}
            {cType === 'Map' && (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Map Style</label>
                  <select
                    className="w-full bg-black/40 border border-white/10 text-xs text-stone-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    value={content.map_style || 'modern_dark'}
                    onChange={e => updateContent(idx, 'map_style', e.target.value)}
                  >
                    <option value="modern_dark">Modern Dark</option>
                    <option value="vintage">Vintage</option>
                    <option value="minimal_light">Minimal Light</option>
                    <option value="nautical_blue">Nautical Blue</option>
                  </select>
                </div>
                <div className="w-full">
                  <MiniJsonEditor label="Locations (JSON Array)" value={content.locations || []} onChange={val => updateContent(idx, 'locations', val)} />
                </div>
              </div>
            )}

            {/* Collapsible Advanced: Styling, Animations & Filters */}
            <div className="pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => toggleAdvanced(idx)}
                className="w-full flex items-center justify-between py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <BsSliders size={11} className="text-amber-400" />
                  Advanced (CSS Style & Animations)
                </span>
                {isAdvancedOpen ? <BsChevronDown size={11} /> : <BsChevronRight size={11} />}
              </button>

              {isAdvancedOpen && (
                <div className="space-y-3 pt-2.5">
                  <MiniJsonEditor label="Style (CSS Object)" value={content.style || {}} onChange={val => updateContent(idx, 'style', val)} />
                  <MiniJsonEditor label="Animations Array" value={layer.animations || []} onChange={val => updateLayer(idx, 'animations', val)} />
                  <MiniJsonEditor label="Filters Array" value={layer.filters || []} onChange={val => updateLayer(idx, 'filters', val)} />
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
    </div>
  );
};
