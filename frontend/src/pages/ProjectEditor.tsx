import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import RemotionVideoPlayer, { RemotionVideoPlayerRef } from '../components/video/RemotionVideoPlayer';
import { CustomInput, CustomTextarea } from '../components/ui/CustomInput';
import { CustomSelect } from '../components/ui/CustomSelect';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscPlay, VscFolderOpened, VscSave, VscFlame, VscArrowLeft, VscSparkle,
  VscPulse, VscCheck, VscError, VscLoading, VscCircleFilled, VscWarning,
  VscCloudDownload, VscStarFull, VscTrash
} from 'react-icons/vsc';

const VISUAL_TYPE_OPTIONS = [
  { value: 'scene', label: 'B-Roll Scene' },
  { value: 'image', label: 'Stock Image' },
  { value: 'parallax', label: '2.5D Parallax Photo' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'chart', label: 'Animated Chart' },
  { value: 'map', label: 'Vintage Map' },
  { value: 'network', label: 'Network Diagram (String Board)' },
  { value: 'document', label: 'Archival Document' },
  { value: 'youtube', label: 'YouTube Video' },
];

const TRANSITION_TYPE_OPTIONS = [
  { value: 'subtle_slide', label: 'Subtle Slide (Default)' },
  { value: 'fade', label: 'Fade' },
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'slide_left', label: 'Slide Left' },
  { value: 'slide_right', label: 'Slide Right' },
  { value: 'none', label: 'None (Cut)' },
];

const TARGET_STAGE_OPTIONS = [
  { value: 'render', label: 'Run Full Pipeline' },
  { value: 'generate_script', label: 'Stop after: Scripting' },
  { value: 'generate_voiceover', label: 'Stop after: Voiceover' },
  { value: 'transcribe', label: 'Stop after: Transcription' },
  { value: 'fetch_assets', label: 'Stop after: Visuals' },
];

const PIPELINE_STAGES = [
  { id: 'generate_script', title: 'Script Generation', desc: 'AI scriptwriting & cues formulation' },
  { id: 'generate_voiceover', title: 'Voiceover Synthesis', desc: 'Synthesizing AI narrator voiceover' },
  { id: 'transcribe', title: 'Transcription & Sync', desc: 'Whisper word-level audio alignment' },
  { id: 'fetch_assets', title: 'Fetch Visual Assets', desc: 'Retrieving B-roll clips & images' },
  { id: 'render', title: 'Video Export (Remotion)', desc: 'Compiling frames to final MP4' }
];

const getDefaultMetaForType = (type: string, existingMeta: any) => {
  const meta: any = {};

  // Preserve existing lower third
  if (existingMeta?.lower_third) {
    meta.lower_third = { ...existingMeta.lower_third };
  }

  // Inject defaults based on type
  if (type === 'chart') {
    meta.chart_type = 'bar';
    meta.data = [{ label: 'Category 1', value: 10 }];
  } else if (type === 'map') {
    meta.map_style = 'vintage';
    meta.locations = [{ name: 'New Location', coord: [0, 0] }];
  } else if (type === 'document') {
    meta.headline = 'News';
    meta.doc_text = 'Content...';
    meta.highlight_text = '';
    meta.source = 'Source';
    meta.date = new Date().getFullYear().toString();
  } else if (type === 'network') {
    meta.nodes = [{ id: '1', label: 'Entity 1', type: 'person' }];
    meta.edges = [];
  } else if (type === 'youtube') {
    meta.start_offset = 15;
    meta.duration = 15;
    meta.skip_intro = true;
  } else if (type === 'portrait') {
    meta.person_name = 'Historical Figure';
  } else if (type === 'parallax') {
    meta.foreground_url = existingMeta?.foreground_url || '';
  }

  return meta;
};


const formatTime = (frame: number) => {
  const totalSeconds = Math.floor(frame / 30);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const SubVisualsEditor = ({ subVisuals, onChange, timings, activeIdx, onSeek }: { subVisuals: any[], onChange: (newSubs: any[]) => void, timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void }) => {
  const handleUpdate = (idx: number, field: string, val: any) => {
    const copy = [...subVisuals];
    if (field === 'visual_type' && copy[idx][field] === val) {
      return;
    }
    copy[idx][field] = val;
    if (field === 'visual_type') {
      copy[idx].visual_meta = getDefaultMetaForType(val, copy[idx].visual_meta);
    }
    onChange(copy);
  };

  const handleUpdateMeta = (idx: number, newMeta: any) => {
    const copy = [...subVisuals];
    copy[idx].visual_meta = newMeta;
    onChange(copy);
  };

  const handleAdd = () => {
    onChange([...subVisuals, { visual_type: 'scene', visual_cue: '', visual_meta: {} }]);
  };

  const handleRemove = (idx: number) => {
    onChange(subVisuals.filter((_: any, i: number) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">Sub-Visuals (Cuts)</label>
        <button type="button" onClick={handleAdd} className="text-[10px] bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 px-2 py-1 rounded">+ Add Sub-Visual</button>
      </div>
      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <div key={idx}
            onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
            className={`bg-stone-900/60 p-3 rounded border space-y-3 relative cursor-pointer transition-colors ${isActive ? 'border-amber-500/60 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-stone-800 hover:border-stone-700'}`}>
            <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(idx); }} className="absolute top-2 right-2 text-red-500 hover:text-red-400 text-xs px-2 py-1 bg-red-500/10 rounded">Remove</button>
            <div className="flex items-center gap-2 mb-1">
              <div className={`text-xs font-bold ${isActive ? 'text-amber-400' : 'text-stone-500'}`}>Sub-Visual {idx + 1}</div>
              {timing && (
                <div className="text-[9px] font-mono bg-stone-950 px-1.5 py-0.5 rounded text-stone-400 border border-stone-800">
                  [{formatTime(timing.start)} - {formatTime(timing.end)}]
                </div>
              )}
              {isActive && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
            </div>
            <div className="grid grid-cols-2 gap-3" onClick={e => e.stopPropagation()}>
              <CustomInput label="Visual Cue Keyword" type="text" value={sv.visual_cue || ''} onChange={(e) => handleUpdate(idx, 'visual_cue', e.target.value)} />
              <div className="flex gap-2">
                <div className="w-1/2">
                  <CustomSelect label="Layer Type" options={VISUAL_TYPE_OPTIONS} value={sv.visual_type || 'scene'} onChange={(val) => handleUpdate(idx, 'visual_type', val)} />
                </div>
                <div className="w-1/2">
                  <CustomSelect label="Transition" options={TRANSITION_TYPE_OPTIONS} value={sv.transition_type || 'subtle_slide'} onChange={(val) => handleUpdate(idx, 'transition_type', val)} />
                </div>
              </div>

              {sv.visual_type === 'youtube' && (
                <div className="col-span-2 space-y-4 mt-2 bg-stone-950/60 p-3.5 rounded-lg border border-stone-800">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-stone-400 font-bold uppercase tracking-wider">Start Offset (Skip Intro):</label>
                      <span className="text-[var(--color-accent-light)] font-mono font-bold">{sv.visual_meta?.start_offset !== undefined ? sv.visual_meta.start_offset : 15}s</span>
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
              {sv.visual_type === 'chart' && (
                <ChartDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'document' && (
                <DocumentHighlightEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              {sv.visual_type === 'network' && (
                <NetworkDataEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />
              )}
              <LowerThirdEditor visualMeta={sv.visual_meta || {}} onChange={(newMeta) => handleUpdateMeta(idx, newMeta)} />

            </div>
          </div>
        )
      })}
      {subVisuals.length === 0 && <p className="text-xs text-stone-500 italic">No sub-visuals. A default black screen will be shown.</p>}
    </div>
  );
};

const SubVisualsView = ({ subVisuals, timings, activeIdx, onSeek }: { subVisuals: any[], timings?: any[], activeIdx?: number, onSeek?: (frame: number) => void }) => {
  return (
    <div className="flex flex-col gap-2 border-t border-stone-800/40 pt-2">
      {subVisuals.map((sv: any, idx: number) => {
        const isActive = activeIdx === idx;
        const timing = timings?.[idx];

        return (
          <div key={idx}
            onClick={() => { if (timing && onSeek) onSeek(timing.start); }}
            className={`flex flex-col gap-1 text-[10px] font-mono px-2 py-1.5 rounded cursor-pointer transition-colors ${isActive ? 'bg-amber-900/20 text-amber-100 border border-amber-500/30' : 'bg-stone-900/30 text-stone-500 hover:bg-stone-800/50 border border-transparent'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-4 ${isActive ? 'text-amber-400' : 'text-stone-600'}`}>{idx + 1}.</span>
              {timing && (
                <span className="bg-stone-950/80 px-1 rounded text-stone-400 border border-stone-800/60">
                  {formatTime(timing.start)}
                </span>
              )}
              <span>Layer: <strong className={isActive ? 'text-amber-300 capitalize' : 'text-stone-300 capitalize'}>{sv.visual_type}</strong></span>
            </div>
            <div className="pl-6 flex items-center gap-2">
              <span>Cue: <strong className={isActive ? 'text-amber-200' : 'text-stone-300'}>{sv.visual_cue}</strong></span>
              {isActive && <span className="ml-auto text-[9px] text-amber-500 bg-amber-500/10 px-1 rounded animate-pulse">Playing</span>}
            </div>
          </div>
        )
      })}
    </div>
  );
};

const MapLocationsEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const locations = visualMeta?.locations || [];
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);

  const handleUpdate = (idx: number, field: string, val: string) => {
    const newLocs = [...locations];
    if (field === 'name') newLocs[idx].name = val;
    if (field === 'lat') newLocs[idx].coord[0] = parseFloat(val) || 0;
    if (field === 'lon') newLocs[idx].coord[1] = parseFloat(val) || 0;
    onChange({ ...visualMeta, locations: newLocs });
  };

  const handleAdd = () => {
    onChange({ ...visualMeta, locations: [...locations, { name: 'New Place', coord: [0, 0] }] });
  };

  const handleRemove = (idx: number) => {
    const newLocs = locations.filter((_: any, i: number) => i !== idx);
    onChange({ ...visualMeta, locations: newLocs });
  };

  const handleAutoLocate = async (idx: number) => {
    const name = locations[idx].name;
    if (!name) return;
    setLoadingIdx(idx);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const newLocs = [...locations];
        newLocs[idx].coord[0] = parseFloat(data[0].lat);
        newLocs[idx].coord[1] = parseFloat(data[0].lon);
        onChange({ ...visualMeta, locations: newLocs });
      } else {
        alert(`Could not find coordinates for "${name}"`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to fetch coordinates.");
    } finally {
      setLoadingIdx(null);
    }
  };

  return (
    <div className="col-span-2 space-y-3 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Map Locations (Lat, Lon):</label>
        <button type="button" onClick={handleAdd} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">
          + Add Point
        </button>
      </div>
      <div className="space-y-2">
        {locations.map((loc: any, idx: number) => (
          <div key={idx} className="flex gap-2 items-center">
            <div className="flex w-1/3 relative">
              <input type="text" value={loc.name} onChange={e => handleUpdate(idx, 'name', e.target.value)} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 pr-7 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Name" />
              <button
                type="button"
                onClick={() => handleAutoLocate(idx)}
                disabled={loadingIdx === idx}
                className="absolute right-1 top-1 text-stone-400 hover:text-amber-400 disabled:opacity-50"
                title="Auto-Locate Coordinates"
              >
                {loadingIdx === idx ? <VscLoading className="animate-spin text-xs mt-0.5" /> : '📍'}
              </button>
            </div>
            <input type="number" step="any" value={loc.coord?.[0] || 0} onChange={e => handleUpdate(idx, 'lat', e.target.value)} className="w-1/4 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Lat" />
            <input type="number" step="any" value={loc.coord?.[1] || 0} onChange={e => handleUpdate(idx, 'lon', e.target.value)} className="w-1/4 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Lon" />
            <button type="button" onClick={() => handleRemove(idx)} className="text-red-400 hover:text-red-300 px-2 py-1 text-xs">✕</button>
          </div>
        ))}
        {locations.length === 0 && <p className="text-[10px] text-stone-500">No locations set.</p>}
      </div>
    </div>
  );
};

export const ProjectEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const {
    selectedProject, tasks, fetchProjectDetail, startPipeline, resumePipeline, cancelPipeline, queue, addToast, updateProject, downloadFont
  } = useAppStore();

  const [scriptData, setScriptData] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any[]>([]);
  const [transcriptionData, setTranscriptionData] = useState<any>({ segments: [] });
  const [loadingScript, setLoadingScript] = useState(false);
  const [editingCard, setEditingCard] = useState<string | null>(null); // 'intro', 'conclusion', or 'scene_i'
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [targetStage, setTargetStage] = useState('render');
  const [rewritingIdx, setRewritingIdx] = useState<number | null>(null);
  const [rewritingType, setRewritingType] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'script' | 'subtitles'>('script');
  const [isSavingSubtitles, setIsSavingSubtitles] = useState(false);

  const [originalScriptData, setOriginalScriptData] = useState<any>(null);
  const [originalManifestData, setOriginalManifestData] = useState<any[]>([]);
  const [scriptChangedAlert, setScriptChangedAlert] = useState(false);
  const [savingCardKey, setSavingCardKey] = useState<string | null>(null);
  const [wasActive, setWasActive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [currentFrame, setCurrentFrame] = useState(0);
  const playerRef = useRef<RemotionVideoPlayerRef>(null);

  const getLiveScenes = React.useCallback(() => {
    if (!manifestData || !scriptData) return manifestData;

    let sceneCounter = 0;
    return manifestData.map((manifestScene: any) => {
      const type = manifestScene.section_type;
      let liveSubVisuals: any[] = [];

      if (type === 'introduction' && scriptData.introduction) {
        liveSubVisuals = scriptData.introduction.sub_visuals || [];
      } else if (type === 'conclusion' && scriptData.conclusion) {
        liveSubVisuals = scriptData.conclusion.sub_visuals || [];
      } else if (type === 'scene' && scriptData.scenes) {
        const currentIdx = sceneCounter;
        sceneCounter++;
        const scriptScene = scriptData.scenes[currentIdx];
        if (scriptScene) {
          liveSubVisuals = scriptScene.sub_visuals || [];
        }
      }

      const origSubVisuals = manifestScene.sub_visuals || [];

      const resolvedSubVisuals = liveSubVisuals.map((lsv: any, idx: number) => {
        const osv = origSubVisuals[idx] || {};
        const requiresNewAsset =
          lsv.visual_type !== osv.visual_type ||
          lsv.visual_cue !== osv.visual_cue ||
          JSON.stringify(lsv.visual_meta || {}) !== JSON.stringify(osv.visual_meta || {});
        const visualUrl = requiresNewAsset ? '' : (osv.visual_url ? `${osv.visual_url}&t=${reloadKey}` : '');
        return {
          ...osv,
          visual_type: lsv.visual_type,
          visual_cue: lsv.visual_cue,
          transition_type: lsv.transition_type,
          visual_meta: lsv.visual_meta,
          visual_url: visualUrl,
          duration: osv.duration
        };
      });

      const resolvedAudioUrl = manifestScene.audio_url ? `${manifestScene.audio_url}&t=${reloadKey}` : '';

      return {
        ...manifestScene,
        sub_visuals: resolvedSubVisuals,
        audio_url: resolvedAudioUrl
      };
    });
  }, [manifestData, scriptData, reloadKey]);

  const liveScenes = getLiveScenes();

  const sceneTimings = useMemo(() => {
    if (!liveScenes) return [];
    let offset = 0;
    return liveScenes.map((scene: any) => {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const start = offset;
      const end = offset + durationFrames;

      const subVisuals = scene.sub_visuals || [];
      const numSubs = subVisuals.length;

      let subs: any[] = [];
      if (numSubs > 0) {
        subs = subVisuals.map((sv: any, idx: number) => {
          const baseSubDuration = Math.floor(durationFrames / numSubs);
          const subFrom = start + idx * baseSubDuration;
          const subDuration = idx === numSubs - 1
            ? durationFrames - (idx * baseSubDuration)
            : baseSubDuration;
          return { start: subFrom, end: subFrom + Math.max(1, subDuration) };
        });
      }

      offset = end;
      return { start, end, subs };
    });
  }, [liveScenes]);

  const activeSceneIdx = sceneTimings.findIndex(t => currentFrame >= t.start && currentFrame < t.end);
  const activeSubIdx = activeSceneIdx >= 0 && sceneTimings[activeSceneIdx].subs.length > 0
    ? sceneTimings[activeSceneIdx].subs.findIndex(t => currentFrame >= t.start && currentFrame < t.end)
    : -1;

  const handleSeek = (frame: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(frame);
    }
  };


  const handleStartEdit = (cardKey: string) => {
    setOriginalScriptData(JSON.parse(JSON.stringify(scriptData)));
    setOriginalManifestData(JSON.parse(JSON.stringify(manifestData)));
    setEditingCard(cardKey);
  };

  const handleCancelEdit = () => {
    if (originalScriptData) {
      setScriptData(originalScriptData);
    }
    setEditingCard(null);
    setOriginalScriptData(null);
    setOriginalManifestData([]);
  };

  const parsedSubtitleSettings = useMemo(() => {
    if (!selectedProject?.subtitle_settings) return {};
    try {
      return JSON.parse(selectedProject.subtitle_settings);
    } catch (e) {
      return {};
    }
  }, [selectedProject?.subtitle_settings]);

  useEffect(() => {
    if (parsedSubtitleSettings.fontFamily) {
      downloadFont(parsedSubtitleSettings.fontFamily).then(res => {
        if (res.success && res.css_path) {
          const id = `font-${parsedSubtitleSettings.fontFamily.replace(/\s/g, '')}`;
          if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = `http://localhost:8888/api/media?path=${encodeURIComponent(res.css_path)}`;
            document.head.appendChild(link);
          }
        }
      });
    }
  }, [parsedSubtitleSettings.fontFamily, downloadFont]);

  useEffect(() => {
    if (id) {
      fetchProjectDetail(id);
      loadFiles(id);
    }
  }, [id]);

  useEffect(() => {
    if (queue.active === id) {
      setWasActive(true);
    } else if (wasActive && queue.active !== id) {
      setWasActive(false);
      loadFiles(id!);
    }
  }, [queue.active, id, wasActive]);

  const previousTasksRef = React.useRef(tasks);

  useEffect(() => {
    // Check if any critical tasks just completed to live-reload assets (Bug Fix)
    const criticalSteps = ['generate_script', 'transcribe', 'fetch_assets'];
    let shouldReload = false;

    for (const step of criticalSteps) {
      const prevStatus = previousTasksRef.current[step]?.status;
      const currStatus = tasks[step]?.status;

      if (prevStatus !== 'completed' && currStatus === 'completed') {
        shouldReload = true;
        break;
      }
    }

    if (shouldReload && id) {
      loadFiles(id);
    }

    previousTasksRef.current = tasks;
  }, [tasks, id]);

  // Read generated JSON assets from Python server static bridges
  const loadFiles = async (projId: string) => {
    setLoadingScript(true);
    try {
      if (window.eel) {
        const project = await window.eel.db_get_project(projId)();
        if (project) {
          if (project.script_path) {
            const script = await window.eel.read_json_file(project.script_path)();
            setScriptData(script);
          }
          if (project.assets_manifest_path) {
            const manifest = await window.eel.read_json_file(project.assets_manifest_path)();
            // Transform visual_path → visual_url for the player
            // The manifest stores absolute file paths, but the Remotion player needs HTTP URLs
            // served through the Bottle media server (same pattern as audio URLs)
            const enrichedManifest = (manifest || []).map((scene: any) => {
              const enrichedSubVisuals = (scene.sub_visuals || []).map((sv: any) => ({
                ...sv,
                visual_url: sv.visual_path
                  ? `http://localhost:8888/api/media?path=${encodeURIComponent(sv.visual_path)}`
                  : ''
              }));

              return {
                ...scene,
                visual_url: scene.visual_path
                  ? `http://localhost:8888/api/media?path=${encodeURIComponent(scene.visual_path)}`
                  : '',
                sub_visuals: enrichedSubVisuals
              };
            });
            setManifestData(enrichedManifest);
            // Also reset original manifest data when loading fresh files
            setOriginalManifestData(enrichedManifest);
          }
          if (project.transcription_path) {
            const transcript = await window.eel.read_json_file(project.transcription_path)();
            setTranscriptionData(transcript || { segments: [] });
          }
        }
      }
    } catch (e) {
      console.error("Failed to load asset JSONs:", e);
    } finally {
      setLoadingScript(false);
      setScriptChangedAlert(false);
    }
  };

  if (!selectedProject) {
    return (
      <div className="py-20 text-center text-stone-400">
        <p>Loading project workspace...</p>
      </div>
    );
  }

  // Calculate current active pipeline progress
  const activeTaskStep = queue.active === selectedProject.id ? Object.values(tasks).find(t => t.status === 'running') : null;

  const triggerFullPipeline = async () => {
    if (!id) return;
    setScriptChangedAlert(false);
    const allSteps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render'];
    const targetIdx = allSteps.indexOf(targetStage);
    const steps = allSteps.slice(0, targetIdx + 1);
    await startPipeline(id, steps);
    loadFiles(id);
  };

  const triggerExportOnly = async () => {
    if (!id) return;
    await startPipeline(id, ['render']);
  };

  const hasVisualEdits = () => {
    if (!manifestData || !scriptData) return false;

    let sceneCounter = 0;
    let changed = false;

    manifestData.forEach((manifestScene: any) => {
      const type = manifestScene.section_type;
      let liveSubVisuals: any[] = [];

      if (type === 'introduction' && scriptData.introduction) {
        liveSubVisuals = scriptData.introduction.sub_visuals || [];
      } else if (type === 'conclusion' && scriptData.conclusion) {
        liveSubVisuals = scriptData.conclusion.sub_visuals || [];
      } else if (type === 'scene' && scriptData.scenes) {
        const scriptScene = scriptData.scenes[sceneCounter];
        sceneCounter++;
        if (scriptScene) {
          liveSubVisuals = scriptScene.sub_visuals || [];
        }
      }

      const origSubVisuals = manifestScene.sub_visuals || [];
      const relevantLiveSubVisuals = liveSubVisuals.map((lsv: any) => ({
        visual_type: lsv.visual_type,
        visual_cue: lsv.visual_cue,
        transition_type: lsv.transition_type,
        visual_meta: lsv.visual_meta
      }));
      const relevantOrigSubVisuals = origSubVisuals.map((osv: any) => ({
        visual_type: osv.visual_type,
        visual_cue: osv.visual_cue,
        transition_type: osv.transition_type,
        visual_meta: osv.visual_meta
      }));
      if (JSON.stringify(relevantLiveSubVisuals) !== JSON.stringify(relevantOrigSubVisuals)) {
        changed = true;
      }
    });

    return changed;
  };

  const canResumeFrom = (stageId: string) => {
    if (queue.active === selectedProject.id) return false;
    if (scriptChangedAlert) return false;

    const targetIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (targetIdx === -1) return false;

    for (let i = 0; i < targetIdx; i++) {
      const priorStageId = PIPELINE_STAGES[i].id;
      if (tasks[priorStageId]?.status !== 'completed') {
        return false;
      }
    }
    return true;
  };

  const handleResumeFromStage = async (stageId: string) => {
    if (!id || !canResumeFrom(stageId)) return;

    const startIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    if (startIdx === -1) return;

    // Respect the targetStage selection
    const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
    const finalEndIdx = endIdx !== -1 && endIdx >= startIdx ? endIdx : PIPELINE_STAGES.length - 1;

    const stepsToRun = PIPELINE_STAGES.slice(startIdx, finalEndIdx + 1).map(s => s.id);

    setScriptChangedAlert(false);
    try {
      const res = await startPipeline(id, stepsToRun);
      if (res.success) {
        addToast(`Resumed pipeline from: ${PIPELINE_STAGES[startIdx].title}`, 'success');
      } else {
        addToast(res.error || "Failed to start pipeline", 'error');
      }
      loadFiles(id);
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  };

  const handleResumePipeline = async () => {
    if (!id) return;

    try {
      let res;

      const allSteps = PIPELINE_STAGES.map(s => s.id);
      const endIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
      const limitSteps = (steps: string[]) => {
        if (endIdx === -1) return steps;
        return steps.filter(step => allSteps.indexOf(step) <= endIdx);
      };

      if (scriptChangedAlert) {
        res = await startPipeline(id, limitSteps(['generate_voiceover', 'transcribe', 'fetch_assets', 'render']));
      } else if (hasVisualEdits()) {
        res = await startPipeline(id, limitSteps(['fetch_assets', 'render']));
      } else {
        // Find remaining steps
        const completedSteps = new Set(Object.values(tasks).filter(t => t.status === 'completed').map(t => t.step));
        let remainingSteps = allSteps.filter(s => !completedSteps.has(s));
        if (remainingSteps.length === 0) remainingSteps = ['render'];

        res = await startPipeline(id, limitSteps(remainingSteps));
      }

      setScriptChangedAlert(false);

      if (res.success) {
        addToast("Pipeline started successfully", 'success');
      } else {
        addToast(res.error || "Failed to start pipeline", 'error');
      }
      loadFiles(id);
    } catch (err) {
      console.error(err);
      addToast("Failed to start pipeline", 'error');
    }
  };

  const handleSaveCard = async (cardKey?: string, index?: number) => {
    if (!id || !scriptData || !window.eel || !selectedProject.script_path) return;

    if (cardKey) {
      setSavingCardKey(cardKey);
    }

    let narrationChanged = false;
    if (originalScriptData) {
      if (cardKey === 'introduction' || cardKey === 'intro') {
        if (scriptData.introduction?.hook !== originalScriptData.introduction?.hook) {
          narrationChanged = true;
        }
      } else if (cardKey === 'conclusion') {
        if (scriptData.conclusion?.summary !== originalScriptData.conclusion?.summary ||
          scriptData.conclusion?.cta !== originalScriptData.conclusion?.cta) {
          narrationChanged = true;
        }
      } else if (index !== undefined && scriptData.scenes && originalScriptData.scenes) {
        const scene = scriptData.scenes[index];
        const origScene = originalScriptData.scenes[index];
        if (scene && origScene && scene.narration !== origScene.narration) {
          narrationChanged = true;
        }
      }
    }

    const success = await window.eel.save_json_file(selectedProject.script_path, scriptData)();
    if (success) {
      // Build the full manifest with live sub_visuals from scriptData
      const buildLiveManifest = () => {
        if (!manifestData || !scriptData) return manifestData;

        let sceneCounter = 0;
        return manifestData.map((manifestScene: any) => {
          const type = manifestScene.section_type;
          let liveSubVisuals: any[] = [];

          if (type === 'introduction' && scriptData.introduction) {
            liveSubVisuals = scriptData.introduction.sub_visuals || [];
          } else if (type === 'conclusion' && scriptData.conclusion) {
            liveSubVisuals = scriptData.conclusion.sub_visuals || [];
          } else if (type === 'scene' && scriptData.scenes) {
            const currentIdx = sceneCounter;
            sceneCounter++;
            const scriptScene = scriptData.scenes[currentIdx];
            if (scriptScene) {
              liveSubVisuals = scriptScene.sub_visuals || [];
            }
          }

          const origSubVisuals = manifestScene.sub_visuals || [];
          const mergedSubVisuals = liveSubVisuals.map((lsv: any, idx: number) => {
            const osv = origSubVisuals[idx] || {};
            const requiresNewAsset =
              lsv.visual_type !== osv.visual_type ||
              lsv.visual_cue !== osv.visual_cue ||
              JSON.stringify(lsv.visual_meta || {}) !== JSON.stringify(osv.visual_meta || {});

            if (!requiresNewAsset) {
              return {
                ...lsv,
                visual_path: osv.visual_path,
                visual_url: osv.visual_url,
                duration: osv.duration
              };
            }
            return lsv;
          });

          return {
            ...manifestScene,
            sub_visuals: mergedSubVisuals
          };
        });
      };

      const liveManifest = buildLiveManifest();

      // Use the new save_project_with_cleanup API to save and cleanup assets
      const cleanupResult = await window.eel.save_project_with_cleanup(id, scriptData, liveManifest)();

      if (cleanupResult) {
        console.log(`Assets cleaned: ${cleanupResult.deleted_files?.length || 0} deleted, ${cleanupResult.preserved_files?.length || 0} preserved`);
      }

      // Fetch updated assets for changed sub-visuals (only if actual edits were made)
      if (liveManifest) {
        // Compare against the original manifest state at edit time, not the current manifestData
        const originalManifest = originalManifestData.length > 0 ? originalManifestData : manifestData;

        for (let manifestIndex = 0; manifestIndex < liveManifest.length; manifestIndex++) {
          const manifestScene = liveManifest[manifestIndex];
          const liveSubVisuals = manifestScene.sub_visuals || [];
          // Match by index, not by section_type (since multiple scenes share the same section_type)
          const origScene = originalManifest[manifestIndex];
          const origSubVisuals = origScene?.sub_visuals || [];

          for (let subIdx = 0; subIdx < liveSubVisuals.length; subIdx++) {
            const liveSv = liveSubVisuals[subIdx];
            const origSv = origSubVisuals[subIdx] || {};

            // Compare only the relevant fields that trigger asset fetching
            const liveKey = JSON.stringify({
              visual_type: liveSv.visual_type,
              visual_cue: liveSv.visual_cue,
              visual_meta: liveSv.visual_meta
            });
            const origKey = JSON.stringify({
              visual_type: origSv.visual_type,
              visual_cue: origSv.visual_cue,
              visual_meta: origSv.visual_meta
            });
            const hasChanged = liveKey !== origKey;

            if (hasChanged && liveSv.visual_type && ['scene', 'image', 'portrait', 'parallax', 'youtube'].includes(liveSv.visual_type)) {
              try {
                await window.eel.fetch_single_scene_asset(id, manifestIndex, subIdx, liveSv.visual_type, liveSv.visual_cue || '')();
              } catch (e) {
                console.error("Failed to fetch updated sub_visual", subIdx, e);
              }
            }
          }
        }
      }

      await loadFiles(id);

      setEditingCard(null);
      setSavingCardKey(null);

      // Show appropriate toast based on what changed
      if (narrationChanged) {
        addToast("Narration text updated! We recommend resuming/syncing the pipeline to regenerate voiceover and subtitles.", 'warning', 6000);
        setScriptChangedAlert(true);
      } else if (cleanupResult?.deleted_files && cleanupResult.deleted_files.length > 0) {
        addToast(`Saved! Removed ${cleanupResult.deleted_files.length} unused asset file(s).`, 'success');
      } else {
        addToast("Project saved successfully!", 'success');
      }
    } else {
      setSavingCardKey(null);
      addToast("Failed to save script changes", 'error');
    }
  };

  const handleSaveTranscription = async () => {
    if (!id || !transcriptionData || !window.eel || !selectedProject.transcription_path) return;
    setIsSavingSubtitles(true);
    try {
      const success = await window.eel.save_json_file(selectedProject.transcription_path, transcriptionData)();
      if (success) {
        addToast("Subtitles saved successfully!", 'success');
        // Reload files so the Remotion player gets the new data.
        loadFiles(id);
      } else {
        addToast("Failed to save subtitles", 'error');
      }
    } catch (e) {
      console.error(e);
      addToast("Failed to save subtitles", 'error');
    } finally {
      setIsSavingSubtitles(false);
    }
  };


  const handleRewriteSection = async (type: string, index: number) => {
    if (!id || !scriptData || !window.eel || !selectedProject.script_path) return;
    setRewritingIdx(index);
    setRewritingType(type);

    try {
      const res = await window.eel.regenerate_script_section(
        index, type, scriptData, rewritePrompt, selectedProject.language
      )();

      if (res.success && res.data) {
        const updated = { ...scriptData };
        if (type === 'introduction') {
          updated.introduction = res.data;
        } else if (type === 'conclusion') {
          updated.conclusion = res.data;
        } else {
          updated.scenes[index] = res.data;
        }

        setScriptData(updated);
        await window.eel.save_json_file(selectedProject.script_path, updated)();
        setEditingCard(null);
        setRewritePrompt('');
        setScriptChangedAlert(true);
        addToast("LLM rewrite completed and saved! Click 'Sync Audio & Subtitles' or 'Resume Pipeline' to rebuild voiceover.", 'success');
      } else {
        addToast("Rewrite failed: " + (res.error || "Unknown error"), 'error');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRewritingIdx(null);
      setRewritingType('');
    }
  };

  // Convert local project assets directory file paths to media streaming URLs
  const getAudioSourceUrl = () => {
    if (selectedProject.audio_path) {
      return `http://localhost:8888/api/media?path=${encodeURIComponent(selectedProject.audio_path)}&t=${reloadKey}`;
    }
    return '';
  };

  const getBGMUrl = () => {
    if (selectedProject.bg_music_path) {
      return `http://localhost:8888/api/media?path=${encodeURIComponent(selectedProject.bg_music_path)}&t=${reloadKey}`;
    }
    return '';
  };

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] z-10 relative">

      {/* Editor Sub-header */}
      <div className="bg-stone-900 border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 text-stone-400 hover:text-white rounded hover:bg-stone-800 transition-colors">
            <VscArrowLeft />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white font-sans">{selectedProject.name}</h1>
            <p className="text-xs text-stone-500 font-mono">ID: {selectedProject.id.slice(0, 8)}... | Style: {selectedProject.style}</p>
          </div>
        </div>

        {/* Pipeline Controls */}
        <div className="flex items-center gap-3">
          {queue.active === selectedProject.id ? (
            <span className="text-xs bg-amber-600/10 text-amber-400 px-3 py-2 rounded border border-amber-600/25 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <VscPulse className="animate-spin text-sm" /> Processing...
            </span>
          ) : (
            <>
              {!selectedProject.script_path && (
                <button
                  onClick={triggerFullPipeline}
                  className="bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white px-5 py-2.5 rounded text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <VscFlame className="text-sm" /> Generate Video
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor Split Layout */}
      <div className="flex-1 flex min-h-0">

        {/* Left Side: Remotion Video Player & Compiler Progress */}
        <div className="w-1/2 p-6 flex flex-col gap-6 border-r border-stone-800 bg-stone-950/20 overflow-y-auto">
          <div>
            <h2 className="text-sm font-bold text-stone-400 uppercase tracking-widest mb-3">Live Video Canvas</h2>
            <RemotionVideoPlayer
              ref={playerRef}
              audioUrl={getAudioSourceUrl()}
              bgMusicUrl={getBGMUrl()}
              bgMusicVolume={selectedProject.bg_music_volume}
              scenes={liveScenes}
              transcription={transcriptionData}
              styleType={selectedProject.style}
              language={selectedProject.language}
              subtitleSettings={parsedSubtitleSettings}
              onFrameUpdate={setCurrentFrame}
            />
          </div>

          {/* Production Pipeline & Controls Panel */}
          <div className="bg-stone-900/40 border border-stone-800 p-5 rounded-xl shadow-lg backdrop-blur-md flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-stone-800/80 pb-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-stone-300 font-sans">
                  Production Pipeline
                </h3>
                <p className="text-[10px] text-stone-500 mt-0.5">Automated video generation workflow</p>
              </div>
              {queue.active === selectedProject.id && (
                <span className="text-[9px] bg-amber-600/10 text-amber-400 px-2 py-0.5 rounded border border-amber-600/20 font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  <VscPulse className="animate-spin text-xs" />
                  Active
                </span>
              )}
            </div>

            {/* Stages List */}
            <div className="flex flex-col relative py-1">
              {PIPELINE_STAGES.map((stage, idx) => {
                const task = tasks[stage.id];
                const isRunning = queue.active === selectedProject.id && (activeTaskStep?.step === stage.id || task?.status === 'running');
                const isCompleted = task?.status === 'completed';
                const isFailed = task?.status === 'failed' || (!queue.active && task?.status === 'running');
                const isPending = task?.status === 'pending';
                const clickable = canResumeFrom(stage.id);

                let progress = 0;
                if (isRunning) {
                  progress = activeTaskStep?.progress || task?.progress || 0;
                } else if (isCompleted) {
                  progress = 100;
                }

                const message = isRunning
                  ? (activeTaskStep?.message || task?.message || 'Processing...')
                  : (isFailed ? (task?.error_message || 'Failed') : '');

                return (
                  <div
                    key={stage.id}
                    onClick={() => clickable && handleResumeFromStage(stage.id)}
                    className={`relative pl-11 pr-3 pb-5 last:pb-2 flex flex-col group/stage transition-all duration-200 py-1.5 -mx-3 rounded-lg border border-transparent ${clickable ? 'cursor-pointer hover:bg-stone-850/60 hover:border-stone-800/80 hover:shadow-sm' : ''
                      }`}
                  >
                    {/* Connecting vertical line */}
                    {idx < PIPELINE_STAGES.length - 1 && (
                      <div className={`absolute left-[21px] top-7 bottom-0 w-[2px] transition-colors duration-300 ${isCompleted ? 'bg-emerald-500/30' : 'bg-stone-850'
                        }`} />
                    )}

                    {/* Circle Status Badge */}
                    <div className="absolute left-3 top-1.5">
                      {isCompleted ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shrink-0" title="Completed">
                          <VscCheck className="text-xs" />
                        </div>
                      ) : isRunning ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0 animate-pulse" title="Running">
                          <VscLoading className="text-xs animate-spin" />
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500/10 text-red-400 border border-red-500/25 shrink-0" title="Failed">
                          <VscError className="text-xs font-bold" />
                        </div>
                      ) : isPending ? (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0 animate-pulse" title="Queued">
                          <VscCircleFilled className="text-[10px]" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-stone-850 text-stone-500 border border-stone-800 shrink-0" title="Pending">
                          <span className="text-[9px] font-bold font-mono">{idx + 1}</span>
                        </div>
                      )}
                    </div>

                    {/* Stage Info */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className={`text-xs font-bold font-sans transition-colors ${isRunning ? 'text-amber-400 font-extrabold' : isCompleted ? 'text-stone-300 font-bold' : isFailed ? 'text-red-400 font-bold' : 'text-stone-400 font-medium'
                          }`}>
                          {stage.title}
                        </span>
                        <span className="text-[10px] text-stone-500 mt-0.5">{stage.desc}</span>
                      </div>

                      {/* Status Text or Action Button */}
                      <div className="shrink-0 flex items-center min-w-[85px] justify-end relative h-8">
                        {clickable ? (
                          <>
                            {/* Status badge: shown by default, fades out on hover */}
                            <div className="group-hover/stage:opacity-0 transition-opacity duration-200 flex items-center justify-end">
                              <span className={`text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${isCompleted ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/10' :
                                isRunning ? 'bg-amber-500/5 text-amber-400 border-amber-500/10 animate-pulse' :
                                  isFailed ? 'bg-red-500/5 text-red-400 border-red-500/10' :
                                    isPending ? 'bg-blue-500/5 text-blue-400 border-blue-500/10' :
                                      'bg-stone-900 text-stone-600 border-stone-800/60'
                                }`}>
                                {isCompleted ? 'Done' :
                                  isRunning ? `${progress.toFixed(0)}%` :
                                    isFailed ? 'Failed' :
                                      isPending ? 'Queued' :
                                        'Waiting'}
                              </span>
                            </div>

                            {/* Resume button: hidden by default, fades in on hover */}
                            <div className="absolute right-0 opacity-0 group-hover/stage:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/stage:pointer-events-auto flex items-center justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResumeFromStage(stage.id);
                                }}
                                className="bg-amber-600 hover:bg-amber-700 text-zinc-950 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded transition-all cursor-pointer shadow-md hover:scale-105 flex items-center gap-1"
                              >
                                <VscPlay className="text-[9px]" /> {isCompleted ? 'Re-run' : 'Resume'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className={`text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${isCompleted ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/10' :
                            isRunning ? 'bg-amber-500/5 text-amber-400 border-amber-500/10 animate-pulse' :
                              isFailed ? 'bg-red-500/5 text-red-400 border-red-500/10' :
                                isPending ? 'bg-blue-500/5 text-blue-400 border-blue-500/10' :
                                  'bg-stone-900 text-stone-600 border-stone-800/60'
                            }`}>
                            {isCompleted ? 'Done' :
                              isRunning ? `${progress.toFixed(0)}%` :
                                isFailed ? 'Failed' :
                                  isPending ? 'Queued' :
                                    'Waiting'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Active Progress Bar */}
                    {isRunning && (
                      <div className="w-full bg-stone-950 h-1.5 rounded-full overflow-hidden border border-stone-800 mt-2">
                        <div
                          className="bg-gradient-to-r from-amber-600 to-orange-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}

                    {/* Message or Error Message */}
                    {message && (
                      <p className={`text-[10px] mt-1.5 leading-relaxed ${isFailed ? 'text-red-400 font-mono border border-red-500/10 bg-red-950/20 px-2 py-1 rounded' : 'text-stone-400 italic'
                        }`}>
                        {message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col gap-3 pt-3 border-t border-stone-850">
              {scriptChangedAlert && (
                <div className="bg-amber-600/10 border border-amber-600/25 p-3 rounded-lg text-[11px] text-amber-300 flex items-start gap-2 animate-pulse mb-1">
                  <VscWarning className="text-sm shrink-0 mt-0.5" />
                  <div>
                    <strong>Script narration changed!</strong> The spoken text has been updated. We recommend clicking <strong>Resume Pipeline</strong> to synchronize narrator voiceovers and subtitles.
                  </div>
                </div>
              )}

              {queue.active === selectedProject.id ? (
                <button
                  onClick={() => cancelPipeline(selectedProject.id)}
                  className="w-full bg-red-600 hover:bg-red-750 text-white py-2.5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer animate-pulse"
                >
                  <VscError className="text-sm font-bold" /> Cancel Pipeline Execution
                </button>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1.5 mb-2 px-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Target Stage (Run Until):</label>
                        <span className="text-[9px] text-amber-500/80 font-mono">{PIPELINE_STAGES.find(s => s.id === targetStage)?.title || 'All'}</span>
                      </div>
                      <div className="flex gap-1 bg-stone-900/60 p-1 rounded-lg border border-stone-800 overflow-hidden">
                        {PIPELINE_STAGES.map((stage, idx) => {
                          const targetIdx = PIPELINE_STAGES.findIndex(s => s.id === targetStage);
                          const isSelected = idx <= targetIdx;
                          const shortNames: Record<string, string> = {
                            'generate_script': 'Script',
                            'generate_voiceover': 'Voice',
                            'transcribe': 'Sync',
                            'fetch_assets': 'Visuals',
                            'render': 'Export'
                          };

                          return (
                            <button
                              key={stage.id}
                              type="button"
                              onClick={() => setTargetStage(stage.id)}
                              className={`flex-1 text-[9px] py-1.5 px-1 font-bold uppercase tracking-wider rounded transition-all duration-200 ${isSelected
                                ? 'bg-amber-600 text-zinc-950 shadow-sm shadow-amber-900/20'
                                : 'text-stone-500 hover:bg-stone-800 hover:text-stone-300 cursor-pointer'
                                }`}
                              title={`Stop after: ${stage.title}`}
                            >
                              {shortNames[stage.id] || stage.id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {!selectedProject.script_path ? (
                        <button
                          onClick={triggerFullPipeline}
                          className="w-full bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white py-2.5 rounded text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <VscFlame className="text-sm" /> Generate Video
                        </button>
                      ) : (
                        <button
                          onClick={handleResumePipeline}
                          className="w-full bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-850 text-white py-2.5 rounded text-xs font-extrabold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                          title="Intelligently resume pipeline compilation based on your edits"
                        >
                          <VscPlay className="text-sm" /> Resume Pipeline
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-stone-500 text-center select-none leading-relaxed px-1">
                    💡 <strong>Smart Resume:</strong> Skip completed steps like Script Writing or Voiceover to save time, compute power, and API key cost.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Settings reference details */}
          <div className="bg-stone-900/30 border border-stone-800/40 p-4 rounded-lg text-xs text-stone-500 space-y-2">
            <h3 className="font-bold text-stone-400 uppercase tracking-wider text-[10px] mb-1">Canvas Specifications</h3>
            <p>• Output Format: H.264 MP4 | aspect 16:9 (1920x1080) at 30 fps</p>
            <p>• Visual overlay includes dust scratches and radial vignettes.</p>
            <p>• Subtitles are synced word-by-word with spring animations.</p>
          </div>
        </div>

        {/* Right Side: Interactive Script Editor & Subtitles */}
        <div className="w-1/2 flex flex-col bg-stone-950/40">
          <div className="flex border-b border-stone-800/80 bg-stone-900/50 pt-4 px-6 gap-6 sticky top-0 z-10">
            <button
              className={`pb-3 cursor-pointer text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === 'script' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-stone-500 hover:text-stone-300'}`}
              onClick={() => setActiveTab('script')}
            >
              Documentary Script
            </button>
            <button
              className={`pb-3 cursor-pointer text-sm font-bold uppercase tracking-widest transition-colors ${activeTab === 'subtitles' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-stone-500 hover:text-stone-300'}`}
              onClick={() => setActiveTab('subtitles')}
            >
              Subtitles
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
            {activeTab === 'script' && (
              <>

                {loadingScript ? (
                  <div className="py-12 text-center text-stone-500">
                    <p>Reading script details...</p>
                  </div>
                ) : !scriptData ? (
                  <div className="py-20 text-center bg-stone-900/30 border border-stone-800 rounded-lg p-6">
                    {queue.active === selectedProject.id ? (
                      <>
                        <VscLoading className="text-4xl text-amber-500 animate-spin mx-auto mb-4" />
                        <p className="text-stone-300 font-bold">Generating Script & Assets...</p>
                        <p className="text-xs text-stone-600 mt-1 max-w-xs mx-auto">Please wait while the AI writes the documentary script. This might take a minute.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-stone-400 font-bold">Pipeline assets have not been generated.</p>
                        <p className="text-xs text-stone-600 mt-1 max-w-xs mx-auto mb-5">Launch the generation pipeline from the sidebar to call LLM scripting and synthesize voiceovers.</p>

                        <div className="flex flex-col items-center gap-3">
                          <button
                            onClick={triggerFullPipeline}
                            className="bg-amber-600 cursor-pointer hover:bg-amber-700 text-zinc-950 px-5 py-2.5 rounded text-xs font-bold transition-all shadow-md inline-flex justify-center items-center gap-2 max-w-[240px] w-full"
                          >
                            <VscPlay /> Launch Pipeline
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">

                    {/* Introduction Card */}
                    {(() => {
                      const introSceneIdx = 0;
                      const introTimings = sceneTimings[introSceneIdx]?.subs;
                      const isIntroActive = activeSceneIdx === introSceneIdx;
                      const introActiveSubIdx = isIntroActive ? activeSubIdx : -1;
                      return (
                        <motion.div
                          layout
                          className={`p-4 rounded-lg border transition-all ${editingCard === 'intro' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isIntroActive ? 'bg-amber-900/10 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${editingCard !== 'intro' ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (editingCard !== 'intro' && sceneTimings[introSceneIdx]) handleSeek(sceneTimings[introSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">0. Hook Introduction</span>
                              {isIntroActive && !editingCard && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {editingCard === 'intro' ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard('introduction')}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === 'introduction' ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit('intro')}
                                  className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {editingCard === 'intro' ? (
                              <motion.div
                                key="edit-intro"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomTextarea
                                  rows={3}
                                  value={scriptData.introduction.hook}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.introduction.hook = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scriptData.introduction.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; copy.introduction.sub_visuals = newSubs; setScriptData(copy); }} timings={introTimings} activeIdx={introActiveSubIdx} onSeek={handleSeek} />

                                {/* LLM Rewrite sub-section */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g., make it sound more suspenseful or dramatic..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('introduction', 0)}
                                      disabled={rewritingType === 'introduction'}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'introduction' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="view-intro"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.introduction.hook}</p>
                                <SubVisualsView subVisuals={scriptData.introduction.sub_visuals || []} timings={introTimings} activeIdx={introActiveSubIdx} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })()}

                    {/* Scenes Map */}
                    {scriptData.scenes.map((scene: any, idx: number) => {
                      const cardKey = `scene_${idx}`;
                      const isEditing = editingCard === cardKey;

                      const globalSceneIdx = idx + (scriptData.introduction ? 1 : 0);
                      const timings = sceneTimings[globalSceneIdx]?.subs;
                      const isActive = activeSceneIdx === globalSceneIdx;
                      const activeSubIdxForScene = isActive ? activeSubIdx : -1;

                      return (
                        <motion.div
                          key={idx}
                          layout
                          className={`p-4 rounded-lg border transition-all ${isEditing ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isActive ? 'bg-amber-900/10 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${!isEditing ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (!isEditing && sceneTimings[globalSceneIdx]) handleSeek(sceneTimings[globalSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">
                                Scene {idx + 1}: {scene.title}
                              </span>
                              {isActive && !isEditing && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard(cardKey, idx)}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === cardKey ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit(cardKey)}
                                  className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {isEditing ? (
                              <motion.div
                                key={`edit-scene-${idx}`}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomTextarea
                                  rows={3}
                                  value={scene.narration}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.scenes[idx].narration = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scene.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; copy.scenes[idx].sub_visuals = newSubs; setScriptData(copy); }} timings={timings} activeIdx={activeSubIdxForScene} onSeek={handleSeek} />

                                {/* AI Rewrite controls */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g. rewrite this describing the ships blockading the port..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('scenes', idx)}
                                      disabled={rewritingType === 'scenes' && rewritingIdx === idx}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'scenes' && rewritingIdx === idx ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key={`view-scene-${idx}`}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scene.narration}</p>
                                <SubVisualsView subVisuals={scene.sub_visuals || []} timings={timings} activeIdx={activeSubIdxForScene} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}

                    {/* Conclusion Card */}
                    {(() => {
                      const concSceneIdx = (scriptData.introduction ? 1 : 0) + scriptData.scenes.length;
                      const concTimings = sceneTimings[concSceneIdx]?.subs;
                      const isConcActive = activeSceneIdx === concSceneIdx;
                      const concActiveSubIdx = isConcActive ? activeSubIdx : -1;
                      return (
                        <motion.div
                          layout
                          className={`p-4 rounded-lg border transition-all ${editingCard === 'conclusion' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : isConcActive ? 'bg-amber-900/10 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}
                        >
                          <div
                            className={`flex justify-between items-center mb-3 ${editingCard !== 'conclusion' ? 'cursor-pointer hover:opacity-80' : ''}`}
                            onClick={() => { if (editingCard !== 'conclusion' && sceneTimings[concSceneIdx]) handleSeek(sceneTimings[concSceneIdx].start); }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">Final Conclusion</span>
                              {isConcActive && !editingCard && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span></span>}
                            </div>
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {editingCard === 'conclusion' ? (
                                <>
                                  <button
                                    onClick={() => handleSaveCard('conclusion')}
                                    disabled={savingCardKey !== null}
                                    className="flex items-center gap-1 bg-amber-600 disabled:opacity-50 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    {savingCardKey === 'conclusion' ? (
                                      <><VscLoading className="animate-spin text-[10px]" /> Saving...</>
                                    ) : (
                                      <><VscSave /> Save</>
                                    )}
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={savingCardKey !== null}
                                    className="text-[10px] disabled:opacity-50 text-stone-400 hover:text-white px-2.5 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleStartEdit('conclusion')}
                                  className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30 cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence mode="wait">
                            {editingCard === 'conclusion' ? (
                              <motion.div
                                key="edit-conclusion"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-3"
                              >
                                <CustomTextarea
                                  label="Summary Text"
                                  rows={2}
                                  value={scriptData.conclusion.summary}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.conclusion.summary = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <CustomTextarea
                                  label="Call To Action (CTA)"
                                  rows={2}
                                  value={scriptData.conclusion.cta}
                                  onChange={(e) => {
                                    const copy = { ...scriptData };
                                    copy.conclusion.cta = e.target.value;
                                    setScriptData(copy);
                                  }}
                                />
                                <SubVisualsEditor subVisuals={scriptData.conclusion.sub_visuals || []} onChange={(newSubs) => { const copy = { ...scriptData }; copy.conclusion.sub_visuals = newSubs; setScriptData(copy); }} timings={concTimings} activeIdx={concActiveSubIdx} onSeek={handleSeek} />

                                {/* AI Rewrite controls */}
                                <div className="border-t border-stone-800/80 pt-3 mt-2">
                                  <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                      <CustomInput
                                        label="AI Prompt Rewrite"
                                        type="text"
                                        placeholder="e.g. make the ending call to subscribe more witty..."
                                        value={rewritePrompt}
                                        onChange={(e) => setRewritePrompt(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRewriteSection('conclusion', 0)}
                                      disabled={rewritingType === 'conclusion'}
                                      className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-2.5 rounded text-xs font-bold transition-all flex items-center gap-1 shrink-0 h-[42px]"
                                    >
                                      {rewritingType === 'conclusion' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="view-conclusion"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.15 }}
                                className="space-y-2"
                              >
                                <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.conclusion.summary}</p>
                                <p className="text-xs text-amber-500 font-bold leading-relaxed font-sans">{scriptData.conclusion.cta}</p>
                                <SubVisualsView subVisuals={scriptData.conclusion.sub_visuals || []} timings={concTimings} activeIdx={concActiveSubIdx} onSeek={handleSeek} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })()}

                  </div>
                )}
              </>
            )}

            {activeTab === 'subtitles' && (
              <div className="flex-1 flex flex-col gap-6 h-full min-h-[500px]">
                <SubtitleSettingsEditor
                  settings={parsedSubtitleSettings}
                  onUpdate={async (newSettings) => {
                    await updateProject(selectedProject.id, { subtitle_settings: JSON.stringify(newSettings) });
                  }}
                />
                <div className="flex-1 min-h-[400px]">
                  <SubtitleEditor
                    transcription={transcriptionData}
                    onChange={(newTrans) => setTranscriptionData(newTrans)}
                    onPlaySegment={(frame) => handleSeek(frame)}
                    onSave={handleSaveTranscription}
                    isSaving={isSavingSubtitles}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};



const SubtitleSettingsEditor = ({ settings, onUpdate }: { settings: any, onUpdate: (newSettings: any) => void }) => {
  const [downloading, setDownloading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const { downloadFont, addToast, settings: globalSettings, saveSettings } = useAppStore();

  const presets = globalSettings?.subtitle_presets || [];
  const defaultPresetId = globalSettings?.default_subtitle_preset_id;

  const handleSavePreset = async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      addToast("Please enter a preset name", "error");
      return;
    }

    const existingIndex = presets.findIndex((p: any) => p.name.toLowerCase() === trimmedName.toLowerCase());
    let updatedPresets = [...presets];

    if (existingIndex >= 0) {
      updatedPresets[existingIndex] = {
        ...updatedPresets[existingIndex],
        settings: { ...settings }
      };
      addToast(`Preset "${trimmedName}" updated!`, "success");
    } else {
      updatedPresets.push({
        id: crypto.randomUUID(),
        name: trimmedName,
        settings: { ...settings }
      });
      addToast(`Preset "${trimmedName}" saved!`, "success");
    }

    await saveSettings({
      ...globalSettings,
      subtitle_presets: updatedPresets
    });
    setPresetName("");
  };

  const handleLoadPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setPresetName("");
      return;
    }
    const preset = presets.find((p: any) => p.id === presetId);
    if (preset) {
      onUpdate(preset.settings);
      setPresetName(preset.name);
      addToast(`Loaded preset "${preset.name}"`, "success");
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    const updatedPresets = presets.filter((p: any) => p.id !== presetId);
    const isDefault = defaultPresetId === presetId;

    await saveSettings({
      ...globalSettings,
      subtitle_presets: updatedPresets,
      default_subtitle_preset_id: isDefault ? undefined : defaultPresetId
    });
    addToast("Preset deleted", "info");
  };

  const handleSetDefaultPreset = async (presetId: string) => {
    const isCurrentlyDefault = defaultPresetId === presetId;
    await saveSettings({
      ...globalSettings,
      default_subtitle_preset_id: isCurrentlyDefault ? undefined : presetId
    });
    if (!isCurrentlyDefault) {
      addToast("Set as default preset", "success");
    } else {
      addToast("Removed default preset", "info");
    }
  };

  const handleFontChange = async (fontFamily: string) => {
    setSelectedPresetId("");
    onUpdate({ ...settings, fontFamily });
    if (!fontFamily) return;
    setDownloading(true);
    const res = await downloadFont(fontFamily);
    setDownloading(false);
    if (res.success && res.css_path) {
      addToast(`Font ${fontFamily} loaded`, "success");
      const id = `font-${fontFamily.replace(/\s/g, '')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = `http://localhost:8888/api/media?path=${encodeURIComponent(res.css_path)}`;
        document.head.appendChild(link);
      }
    } else {
      addToast(`Failed to load font: ${res.error}`, "error");
    }
  };

  return (
    <div className="bg-stone-900/60 p-5 rounded-xl border border-stone-800 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-stone-300 uppercase tracking-widest font-sans">Subtitle Styling</h3>
        {downloading && <span className="text-[10px] text-amber-500 font-bold flex items-center gap-1"><VscLoading className="animate-spin text-sm" /> Downloading Font...</span>}
      </div>

      {/* PRESETS SECTION */}
      <div className="bg-stone-950 p-3 rounded-lg border border-stone-800 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Presets</label>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <CustomSelect
              options={[
                { value: '', label: 'Load a preset...' },
                ...presets.map((p: any) => ({ value: p.id, label: p.name }))
              ]}
              value={selectedPresetId}
              onChange={handleLoadPreset}
            />
          </div>

          <div className="flex items-center gap-1 flex-1">
            <input
              type="text"
              placeholder="Preset Name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="w-full bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:outline-none focus:border-amber-500/50"
            />
            <button
              onClick={handleSavePreset}
              className="p-2 bg-amber-600 cursor-pointer hover:bg-amber-500 text-white rounded-md transition-colors"
              title="Save current styling as preset"
            >
              <VscSave />
            </button>
          </div>
        </div>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-800/50">
            {presets.map((p: any) => (
              <div key={p.id} className="flex items-center gap-1 bg-stone-900 border border-stone-700 rounded pl-2 pr-1 py-1 text-xs text-stone-300">
                <span className="truncate max-w-[120px] font-medium">{p.name}</span>
                <button
                  onClick={() => handleSetDefaultPreset(p.id)}
                  className={`p-1 rounded hover:bg-stone-800 transition-colors ${defaultPresetId === p.id ? 'text-amber-500' : 'text-stone-500 hover:text-stone-300'}`}
                  title={defaultPresetId === p.id ? "Remove as default" : "Set as default for new projects"}
                >
                  <VscStarFull />
                </button>
                <button
                  onClick={() => handleDeletePreset(p.id)}
                  className="p-1 rounded hover:bg-red-900/50 hover:text-red-400 text-stone-500 transition-colors"
                  title="Delete preset"
                >
                  <VscTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <hr className="border-stone-800" />

      <div className="grid grid-cols-2 gap-4">
        <CustomSelect
          label="Font Family"
          options={[
            { value: 'Montserrat', label: 'Montserrat (Latin)' },
            { value: 'Inter', label: 'Inter (Latin)' },
            { value: 'Roboto', label: 'Roboto (Latin)' },
            { value: 'Poppins', label: 'Poppins (Supports Hindi)' },
            { value: 'Hind', label: 'Hind (Supports Hindi)' },
            { value: 'Mukta', label: 'Mukta (Supports Hindi)' },
            { value: 'Kalam', label: 'Kalam (Supports Hindi)' },
            { value: 'Noto Sans Devanagari', label: 'Noto Sans Devanagari' },
            { value: 'Lato', label: 'Lato (Latin)' },
            { value: 'Oswald', label: 'Oswald (Latin)' },
            { value: 'Raleway', label: 'Raleway (Latin)' },
            { value: 'Anton', label: 'Anton (Latin)' },
            { value: 'Bebas Neue', label: 'Bebas Neue (Latin)' }
          ]}
          value={settings.fontFamily || 'Montserrat'}
          onChange={handleFontChange}
        />
        <CustomInput
          label="Font Size"
          type="number"
          value={settings.fontSize !== undefined ? settings.fontSize : 54}
          onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, fontSize: parseInt(e.target.value) || 54 }) }}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Active Highlight Color</label>
          <div className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 focus-within:border-amber-500/50">
            <input
              type="color"
              value={settings.activeColor || '#fbbf24'}
              onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, activeColor: e.target.value }) }}
              className="w-6 h-6 rounded cursor-pointer border-none p-0 bg-transparent shrink-0"
            />
            <input
              type="text"
              value={settings.activeColor || '#fbbf24'}
              onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, activeColor: e.target.value }) }}
              className="bg-transparent border-none text-[11px] text-white focus:outline-none w-full font-mono uppercase"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Past/Inactive Text Color</label>
          <div className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 focus-within:border-amber-500/50">
            <input
              type="color"
              value={settings.pastColor || '#d6d3d1'}
              onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, pastColor: e.target.value }) }}
              className="w-6 h-6 rounded cursor-pointer border-none p-0 bg-transparent shrink-0"
            />
            <input
              type="text"
              value={settings.pastColor || '#d6d3d1'}
              onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, pastColor: e.target.value }) }}
              className="bg-transparent border-none text-[11px] text-white focus:outline-none w-full font-mono uppercase"
            />
          </div>
        </div>
        <CustomSelect
          label="Text Transform"
          options={[
            { value: 'uppercase', label: 'UPPERCASE' },
            { value: 'lowercase', label: 'lowercase' },
            { value: 'capitalize', label: 'Capitalize' },
            { value: 'none', label: 'Normal' }
          ]}
          value={settings.textTransform || 'uppercase'}
          onChange={(val) => { setSelectedPresetId(""); onUpdate({ ...settings, textTransform: val }) }}
        />
        <CustomInput
          label="Y Position (px from bottom)"
          type="number"
          value={settings.bottomOffset !== undefined ? settings.bottomOffset : 120}
          onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, bottomOffset: parseInt(e.target.value) || 0 }) }}
        />
        <div className="flex flex-col gap-1.5 justify-center mt-2 col-span-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-300 font-medium">
            <input
              type="checkbox"
              checked={settings.showBackgroundHighlight !== false}
              onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, showBackgroundHighlight: e.target.checked }) }}
              className="w-4 h-4 rounded border-stone-700 bg-stone-900 text-amber-500 focus:ring-amber-500/50 focus:ring-offset-stone-950"
            />
            Show Read Text Background Highlight
          </label>
        </div>
        {settings.showBackgroundHighlight !== false && (
          <div className="flex flex-col gap-1.5 col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Background Highlight Color</label>
            <div className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 focus-within:border-amber-500/50 max-w-[50%]">
              <input
                type="color"
                value={settings.highlightBgColor || settings.activeColor || '#fbbf24'}
                onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, highlightBgColor: e.target.value }) }}
                className="w-6 h-6 rounded cursor-pointer border-none p-0 bg-transparent shrink-0"
              />
              <input
                type="text"
                value={settings.highlightBgColor || settings.activeColor || '#fbbf24'}
                onChange={(e) => { setSelectedPresetId(""); onUpdate({ ...settings, highlightBgColor: e.target.value }) }}
                className="bg-transparent border-none text-[11px] text-white focus:outline-none w-full font-mono uppercase"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const LowerThirdEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const lowerThird = visualMeta?.lower_third || { title: '', subtitle: '' };

  const handleUpdate = (field: string, val: string) => {
    if (!val && field === 'title') {
      const copy = { ...visualMeta };
      delete copy.lower_third;
      onChange(copy);
      return;
    }
    onChange({ ...visualMeta, lower_third: { ...lowerThird, [field]: val } });
  };

  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/40 p-3 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Universal Lower Third:</label>
      </div>
      <div className="flex gap-2">
        <input type="text" value={lowerThird.title} onChange={e => handleUpdate('title', e.target.value)} className="w-1/2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Title (e.g. Person Name)" />
        <input type="text" value={lowerThird.subtitle} onChange={e => handleUpdate('subtitle', e.target.value)} className="w-1/2 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Subtitle (e.g. Profession)" />
      </div>
    </div>
  );
};

const DocumentHighlightEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Document Highlight:</label>
      </div>
      <input type="text" value={visualMeta?.highlight_text || ''} onChange={e => onChange({ ...visualMeta, highlight_text: e.target.value })} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50" placeholder="Phrase to highlight with marker" />
    </div>
  );
};

const NetworkDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [jsonText, setJsonText] = useState(() => JSON.stringify({ nodes: visualMeta?.nodes || [], edges: visualMeta?.edges || [] }, null, 2));

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onChange({ ...visualMeta, nodes: parsed.nodes, edges: parsed.edges });
    } catch (e) {
      alert("Invalid JSON format");
    }
  };

  return (
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Network Data (JSON):</label>
        <button type="button" onClick={handleSave} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">Save JSON Data</button>
      </div>
      <textarea rows={6} value={jsonText} onChange={e => setJsonText(e.target.value)} className="w-full bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 font-mono" placeholder="{ nodes: [], edges: [] }" />
    </div>
  );
};

const ChartDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [loading, setLoading] = useState(false);
  const prompt = visualMeta?.chart_prompt || '';
  const data = visualMeta?.data || [];

  const handleFetch = async () => {
    if (!prompt) return;
    setLoading(true);
    try {
      if (window.eel) {
        const res = await window.eel.generate_chart_data_api(prompt)();
        if (res.success && res.data) {
          onChange({
            ...visualMeta,
            data: res.data,
            title: res.title || prompt.toUpperCase(),
            chart_type: res.chart_type || 'bar',
            chart_prompt: prompt
          });
        } else {
          alert(`Failed to generate data: ${res.error}`);
        }
      }
    } catch (e) {
      console.error(e);
      alert('Error generating chart data.');
    } finally {
      setLoading(false);
    }
  };

  const updateDataRow = (index: number, field: 'label' | 'value', val: string) => {
    const newData = [...data];
    if (field === 'label') newData[index].label = val;
    if (field === 'value') newData[index].value = parseFloat(val) || 0;
    onChange({ ...visualMeta, data: newData });
  };

  const removeDataRow = (index: number) => {
    const newData = data.filter((_: any, i: number) => i !== index);
    onChange({ ...visualMeta, data: newData });
  };

  const addDataRow = () => {
    const newData = [...data, { label: 'New', value: 0 }];
    onChange({ ...visualMeta, data: newData });
  };

  return (
    <div className="col-span-2 space-y-4 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      <div>
        <div className="flex justify-between items-center text-xs mb-2">
          <label className="text-stone-400 font-bold uppercase tracking-wider">✨ AI Data Generator:</label>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={prompt}
            onChange={(e) => onChange({ ...visualMeta, chart_prompt: e.target.value })}
            placeholder="e.g. Top 10 most populated countries in 2024"
            className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={loading || !prompt}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-zinc-950 px-3 py-1.5 rounded text-[11px] font-bold shrink-0 transition-colors flex items-center gap-1"
          >
            {loading ? <VscLoading className="animate-spin text-xs" /> : <VscSparkle className="text-xs" />} Generate
          </button>
        </div>
      </div>

      <div className="border-t border-stone-800 pt-3">
        <div className="flex justify-between items-center text-xs mb-2">
          <label className="text-stone-400 font-bold uppercase tracking-wider">Manual Editor:</label>
          <button type="button" onClick={addDataRow} className="text-[10px] bg-stone-800 hover:bg-stone-700 px-2 py-1 rounded text-stone-300">
            + Add Row
          </button>
        </div>
        {data.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {data.map((row: any, idx: number) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateDataRow(idx, 'label', e.target.value)}
                  className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
                  placeholder="Label"
                />
                <input
                  type="number"
                  step="any"
                  value={row.value}
                  onChange={(e) => updateDataRow(idx, 'value', e.target.value)}
                  className="w-24 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/50"
                  placeholder="Value"
                />
                <button type="button" onClick={() => removeDataRow(idx)} className="text-red-400 hover:text-red-300 px-1.5 py-1 text-xs">✕</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-stone-500 italic">No data yet. Generate with AI or add manually.</p>
        )}
      </div>
    </div>
  );
};

export default ProjectEditor;
