import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppStore, Project, Task } from '../store/appStore';
import RemotionVideoPlayer from '../components/video/RemotionVideoPlayer';
import {
  VscPlay, VscRefresh, VscFolderOpened, VscSave, VscEye, VscFlame, VscTrash, VscArrowLeft, VscSparkle,
  VscPulse
} from 'react-icons/vsc';

export const ProjectEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const {
    selectedProject, tasks, fetchProjectDetail, startPipeline, cancelPipeline, queue
  } = useAppStore();

  const [scriptData, setScriptData] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any[]>([]);
  const [transcriptionData, setTranscriptionData] = useState<any>({ segments: [] });
  const [loadingScript, setLoadingScript] = useState(false);
  const [editingCard, setEditingCard] = useState<string | null>(null); // 'intro', 'conclusion', or 'scene_i'
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [rewritingIdx, setRewritingIdx] = useState<number | null>(null);
  const [rewritingType, setRewritingType] = useState<string>('');

  useEffect(() => {
    if (id) {
      fetchProjectDetail(id);
      loadFiles(id);
    }
  }, [id]);

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
            setManifestData(manifest || []);
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
  const renderTask = tasks['render'];

  const triggerFullPipeline = async () => {
    if (!id) return;
    const steps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render'];
    await startPipeline(id, steps);
    loadFiles(id);
  };

  const triggerVisualSync = async () => {
    if (!id) return;
    const steps = ['generate_voiceover', 'transcribe', 'fetch_assets', 'render'];
    await startPipeline(id, steps);
    loadFiles(id);
  };

  const triggerExportOnly = async () => {
    if (!id) return;
    await startPipeline(id, ['render']);
  };

  const handleSaveCard = async (type: string, index?: number) => {
    if (!id || !scriptData || !window.eel) return;

    // Save locally edited script parameters back to python storage
    const success = await window.eel.save_json_file(selectedProject.script_path, scriptData)();
    if (success) {
      setEditingCard(null);
      // Re-trigger asset updates since narration was updated
      alert("Script card saved! Click 'Sync Audio & Subtitles' to generate new speech clips.");
    }
  };

  const handleRewriteSection = async (type: string, index: number) => {
    if (!id || !scriptData || !window.eel) return;
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
        alert("LLM rewrite completed and saved! Click 'Sync Audio & Subtitles' to rebuild speech.");
      } else {
        alert("Rewrite failed: " + (res.error || "Unknown error"));
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
      return `http://localhost:8888/api/media?path=${encodeURIComponent(selectedProject.audio_path)}`;
    }
    return '';
  };

  const getBGMUrl = () => {
    if (selectedProject.bg_music_path) {
      return `http://localhost:8888/api/media?path=${encodeURIComponent(selectedProject.bg_music_path)}`;
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
            <button
              onClick={() => cancelPipeline(selectedProject.id)}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-xs font-bold transition-colors animate-pulse"
            >
              Cancel Render
            </button>
          ) : (
            <>
              {!selectedProject.script_path ? (
                <button
                  onClick={triggerFullPipeline}
                  className="bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800 text-white px-5 py-2.5 rounded text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
                >
                  <VscFlame className="text-sm" /> Generate Video
                </button>
              ) : (
                <>
                  <button
                    onClick={triggerVisualSync}
                    className="bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-4 py-2.5 rounded text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <VscRefresh className="text-sm" /> Sync Audio & Subtitles
                  </button>
                  <button
                    onClick={triggerExportOnly}
                    className="bg-amber-600 hover:bg-amber-700 text-zinc-950 px-4 py-2.5 rounded text-xs font-black transition-colors flex items-center gap-1.5"
                  >
                    <VscPlay className="text-sm" /> Export Video (MP4)
                  </button>
                </>
              )}
            </>
          )}

          {selectedProject.video_path && (
            <button
              onClick={async () => {
                if (window.eel) await window.eel.open_exports_folder()();
              }}
              className="p-2.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded border border-stone-700 hover:text-white transition-colors"
              title="Open Exports Directory"
            >
              <VscFolderOpened />
            </button>
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
              audioUrl={getAudioSourceUrl()}
              bgMusicUrl={getBGMUrl()}
              bgMusicVolume={selectedProject.bg_music_volume}
              scenes={manifestData}
              transcription={transcriptionData}
              styleType={selectedProject.style}
              language={selectedProject.language}
            />
          </div>

          {/* Active Job Progress Overlay */}
          {activeTaskStep && (
            <div className="bg-stone-900/60 border border-stone-800 p-4 rounded-lg shadow-md">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                  <VscPulse className="animate-pulse" /> Active Pipeline Stage: {activeTaskStep.step.replace('_', ' ')}
                </span>
                <span className="text-xs font-mono text-stone-400">{activeTaskStep.progress.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-stone-950 h-2 rounded-full overflow-hidden border border-stone-800">
                <div
                  className="bg-gradient-to-r from-amber-600 to-orange-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${activeTaskStep.progress}%` }}
                />
              </div>
              <p className="text-[10px] text-stone-500 mt-2 italic">{activeTaskStep.message || 'Waiting...'}</p>
            </div>
          )}

          {/* Settings reference details */}
          <div className="bg-stone-900/30 border border-stone-800/40 p-4 rounded-lg text-xs text-stone-500 space-y-2">
            <h3 className="font-bold text-stone-400 uppercase tracking-wider text-[10px] mb-1">Canvas Specifications</h3>
            <p>• Output Format: H.264 MP4 | aspect 16:9 (1920x1080) at 30 fps</p>
            <p>• Visual overlay includes dust scratches and radial vignettes.</p>
            <p>• Subtitles are synced word-by-word with spring animations.</p>
          </div>
        </div>

        {/* Right Side: Interactive Script Editor */}
        <div className="w-1/2 p-6 overflow-y-auto bg-stone-950/40 flex flex-col gap-6">
          <h2 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Documentary Script & Cues</h2>

          {loadingScript ? (
            <div className="py-12 text-center text-stone-500">
              <p>Reading script details...</p>
            </div>
          ) : !scriptData ? (
            <div className="py-20 text-center bg-stone-900/30 border border-stone-800 rounded-lg p-6">
              <p className="text-stone-400">Pipeline assets have not been generated.</p>
              <p className="text-xs text-stone-600 mt-1 max-w-xs mx-auto">Launch the generation pipeline above to call LLM scripting and synthesize voiceovers.</p>
              <button
                onClick={triggerFullPipeline}
                className="mt-4 bg-amber-600 hover:bg-amber-700 text-zinc-950 px-4 py-2 rounded text-xs font-bold transition-all"
              >
                Launch Pipeline
              </button>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Introduction Card */}
              <div className={`p-4 rounded-lg border transition-all ${editingCard === 'intro' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">0. Hook Introduction</span>
                  <div className="flex gap-2">
                    {editingCard === 'intro' ? (
                      <button
                        onClick={() => handleSaveCard('introduction')}
                        className="flex items-center gap-1 bg-amber-600 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold"
                      >
                        <VscSave /> Save
                      </button>
                    ) : (
                      <button
                        onClick={() => setEditingCard('intro')}
                        className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {editingCard === 'intro' ? (
                  <div className="space-y-3">
                    <textarea
                      rows={3}
                      value={scriptData.introduction.hook}
                      onChange={(e) => {
                        const copy = { ...scriptData };
                        copy.introduction.hook = e.target.value;
                        setScriptData(copy);
                      }}
                      className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white resize-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Cue Keyword</label>
                        <input
                          type="text"
                          value={scriptData.introduction.visual_cue}
                          onChange={(e) => {
                            const copy = { ...scriptData };
                            copy.introduction.visual_cue = e.target.value;
                            setScriptData(copy);
                          }}
                          className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Layer Type</label>
                        <select
                          value={scriptData.introduction.visual_type}
                          onChange={(e) => {
                            const copy = { ...scriptData };
                            copy.introduction.visual_type = e.target.value;
                            setScriptData(copy);
                          }}
                          className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                        >
                          <option value="scene">B-Roll Scene</option>
                          <option value="image">Stock Image</option>
                          <option value="portrait">Portrait</option>
                          <option value="chart">Animated Chart</option>
                          <option value="map">Vintage Map</option>
                          <option value="document">Archival Document</option>
                        </select>
                      </div>
                    </div>

                    {/* LLM Rewrite sub-section */}
                    <div className="border-t border-stone-800/80 pt-3 mt-2">
                      <label className="block text-[9px] text-stone-400 uppercase tracking-wide font-bold mb-1">AI Prompt Rewrite</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g., make it sound more suspenseful or dramatic..."
                          value={rewritePrompt}
                          onChange={(e) => setRewritePrompt(e.target.value)}
                          className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-xs text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleRewriteSection('introduction', 0)}
                          disabled={rewritingType === 'introduction'}
                          className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1"
                        >
                          {rewritingType === 'introduction' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.introduction.hook}</p>
                    <div className="flex gap-4 text-[10px] text-stone-500 border-t border-stone-800/40 pt-2 font-mono">
                      <span>Layer: <strong className="text-stone-300 capitalize">{scriptData.introduction.visual_type}</strong></span>
                      <span>Cue: <strong className="text-stone-300">{scriptData.introduction.visual_cue}</strong></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Scenes Map */}
              {scriptData.scenes.map((scene: any, idx: number) => {
                const cardKey = `scene_${idx}`;
                const isEditing = editingCard === cardKey;

                return (
                  <div key={idx} className={`p-4 rounded-lg border transition-all ${isEditing ? 'bg-stone-900 border-amber-600/60 shadow-lg' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">
                        Scene {idx + 1}: {scene.title}
                      </span>
                      <div className="flex gap-2">
                        {isEditing ? (
                          <button
                            onClick={() => handleSaveCard(cardKey, idx)}
                            className="flex items-center gap-1 bg-amber-600 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold"
                          >
                            <VscSave /> Save
                          </button>
                        ) : (
                          <button
                            onClick={() => setEditingCard(cardKey)}
                            className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <textarea
                          rows={3}
                          value={scene.narration}
                          onChange={(e) => {
                            const copy = { ...scriptData };
                            copy.scenes[idx].narration = e.target.value;
                            setScriptData(copy);
                          }}
                          className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white resize-none"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Cue Keyword</label>
                            <input
                              type="text"
                              value={scene.visual_cue}
                              onChange={(e) => {
                                const copy = { ...scriptData };
                                copy.scenes[idx].visual_cue = e.target.value;
                                setScriptData(copy);
                              }}
                              className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Layer Type</label>
                            <select
                              value={scene.visual_type}
                              onChange={(e) => {
                                const copy = { ...scriptData };
                                copy.scenes[idx].visual_type = e.target.value;
                                setScriptData(copy);
                              }}
                              className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                            >
                              <option value="scene">B-Roll Scene</option>
                              <option value="image">Stock Image</option>
                              <option value="portrait">Portrait</option>
                              <option value="chart">Animated Chart</option>
                              <option value="map">Vintage Map</option>
                              <option value="document">Archival Document</option>
                            </select>
                          </div>
                        </div>

                        {/* AI Rewrite controls */}
                        <div className="border-t border-stone-800/80 pt-3 mt-2">
                          <label className="block text-[9px] text-stone-400 uppercase tracking-wide font-bold mb-1">AI Prompt Rewrite</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. rewrite this describing the ships blockading the port..."
                              value={rewritePrompt}
                              onChange={(e) => setRewritePrompt(e.target.value)}
                              className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-xs text-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleRewriteSection('scenes', idx)}
                              disabled={rewritingType === 'scenes' && rewritingIdx === idx}
                              className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1"
                            >
                              {rewritingType === 'scenes' && rewritingIdx === idx ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-stone-200 leading-relaxed font-sans">{scene.narration}</p>
                        <div className="flex gap-4 text-[10px] text-stone-500 border-t border-stone-800/40 pt-2 font-mono">
                          <span>Layer: <strong className="text-stone-300 capitalize">{scene.visual_type}</strong></span>
                          <span>Cue: <strong className="text-stone-300">{scene.visual_cue}</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Conclusion Card */}
              <div className={`p-4 rounded-lg border transition-all ${editingCard === 'conclusion' ? 'bg-stone-900 border-amber-600/60 shadow-lg' : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'}`}>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-500 font-sans">Final Conclusion</span>
                  <div className="flex gap-2">
                    {editingCard === 'conclusion' ? (
                      <button
                        onClick={() => handleSaveCard('conclusion')}
                        className="flex items-center gap-1 bg-amber-600 text-zinc-950 px-2.5 py-1 rounded text-[10px] font-bold"
                      >
                        <VscSave /> Save
                      </button>
                    ) : (
                      <button
                        onClick={() => setEditingCard('conclusion')}
                        className="text-[10px] text-stone-400 hover:text-white px-2 py-1 rounded border border-stone-800 bg-stone-950/30"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {editingCard === 'conclusion' ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold">Summary Text</label>
                      <textarea
                        rows={2}
                        value={scriptData.conclusion.summary}
                        onChange={(e) => {
                          const copy = { ...scriptData };
                          copy.conclusion.summary = e.target.value;
                          setScriptData(copy);
                        }}
                        className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white resize-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold">Call To Action (CTA)</label>
                      <textarea
                        rows={2}
                        value={scriptData.conclusion.cta}
                        onChange={(e) => {
                          const copy = { ...scriptData };
                          copy.conclusion.cta = e.target.value;
                          setScriptData(copy);
                        }}
                        className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Cue Keyword</label>
                        <input
                          type="text"
                          value={scriptData.conclusion.visual_cue}
                          onChange={(e) => {
                            const copy = { ...scriptData };
                            copy.conclusion.visual_cue = e.target.value;
                            setScriptData(copy);
                          }}
                          className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 uppercase tracking-wide font-bold mb-1">Visual Layer Type</label>
                        <select
                          value={scriptData.conclusion.visual_type}
                          onChange={(e) => {
                            const copy = { ...scriptData };
                            copy.conclusion.visual_type = e.target.value;
                            setScriptData(copy);
                          }}
                          className="w-full bg-stone-950 border border-stone-800 rounded p-2 text-xs text-white"
                        >
                          <option value="scene">B-Roll Scene</option>
                          <option value="image">Stock Image</option>
                          <option value="portrait">Portrait</option>
                          <option value="chart">Animated Chart</option>
                          <option value="map">Vintage Map</option>
                          <option value="document">Archival Document</option>
                        </select>
                      </div>
                    </div>

                    {/* AI Rewrite controls */}
                    <div className="border-t border-stone-800/80 pt-3 mt-2">
                      <label className="block text-[9px] text-stone-400 uppercase tracking-wide font-bold mb-1">AI Prompt Rewrite</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g. make the ending call to subscribe more witty..."
                          value={rewritePrompt}
                          onChange={(e) => setRewritePrompt(e.target.value)}
                          className="flex-1 bg-stone-950 border border-stone-800 rounded px-2 py-1 text-xs text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleRewriteSection('conclusion', 0)}
                          disabled={rewritingType === 'conclusion'}
                          className="bg-stone-800 hover:bg-amber-600 hover:text-zinc-950 text-stone-300 border border-stone-700 px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1"
                        >
                          {rewritingType === 'conclusion' ? 'Rewriting...' : <><VscSparkle /> AI Rewrite</>}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-stone-200 leading-relaxed font-sans">{scriptData.conclusion.summary}</p>
                    <p className="text-xs text-amber-500 font-bold leading-relaxed font-sans">{scriptData.conclusion.cta}</p>
                    <div className="flex gap-4 text-[10px] text-stone-500 border-t border-stone-800/40 pt-2 font-mono">
                      <span>Layer: <strong className="text-stone-300 capitalize">{scriptData.conclusion.visual_type}</strong></span>
                      <span>Cue: <strong className="text-stone-300">{scriptData.conclusion.visual_cue}</strong></span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

      </div>

    </div>
  );
};
export default ProjectEditor;
