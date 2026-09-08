import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProjectStore } from '../../../store/useProjectStore';
import { callApi } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { getCleanAudioKey } from './useAudioWaveform';

/** Clip-list equality ignoring the `&t=` cache-buster (clip files are uuid-named,
 *  never overwritten in place, so identical fields mean identical bytes). */
function sameClips(a: Array<Record<string, any>>, b: Array<Record<string, any>>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {};
    const y = b[i] || {};
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      const vx = k === 'audio_url' ? getCleanAudioKey(x[k]) : x[k];
      const vy = k === 'audio_url' ? getCleanAudioKey(y[k]) : y[k];
      if (vx !== vy) return false;
    }
  }
  return true;
}

import { estimateTextDuration, calculateSubVisualTimings } from '../../../utils/duration';
import { MusicClip, SfxClip } from '../../../components/video/NitishRajputComposition';

/** Frame-value equality for timing records (numbers only — cheap). */
function sameTimings(
  a: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>,
  b: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
    const sa = a[i].subs || [];
    const sb = b[i].subs || [];
    if (sa.length !== sb.length) return false;
    for (let j = 0; j < sa.length; j++) {
      if (sa[j].start !== sb[j].start || sa[j].end !== sb[j].end) return false;
    }
  }
  return true;
}

interface UseEditorDataReturn {
  scriptData: any;
  setScriptData: (data: any) => void;
  designData: any;
  setDesignData: (data: any) => void;
  manifestData: any[];
  setManifestData: (data: any[]) => void;
  transcriptionData: any;
  setTranscriptionData: (data: any) => void;
  loadingScript: boolean;
  reloadKey: number;
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  musicClips: MusicClip[];
  updateMusicClips: (clips: MusicClip[]) => Promise<boolean>;
  sfxClips: SfxClip[];
  updateSfxClips: (clips: SfxClip[]) => Promise<boolean>;
  loadFiles: (projId: string) => Promise<{ script: any; manifest: any[] }>;
  getAudioSourceUrl: (projectId: string) => string;
  getBGMUrl: () => string;
}

export function useEditorData(projectId: string | undefined): UseEditorDataReturn {
  const fetchProjectDetail = useProjectStore((s) => s.fetchProjectDetail);

  const [scriptData, setScriptData] = useState<any>(null);
  const [designData, setDesignData] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any[]>([]);
  const [transcriptionData, setTranscriptionData] = useState<any>({ segments: [] });
  const [loadingScript, setLoadingScript] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Read generated JSON assets from Python server static bridges
  const loadFiles = useCallback(async (projId: string): Promise<{ script: any; manifest: any[] }> => {
    setLoadingScript(true);
    let reloadedScript: any = null;
    let reloadedManifest: any[] = [];
    try {
      const project = await callApi<any>('db_get_project', projId);
      if (project) {
        if (project.script_path) {
          const script = await callApi<any>('read_json_file', project.script_path);
          setScriptData(script);
          reloadedScript = script;
          const designPath = project.script_path.replace(/script\.json$/, 'design.json');
          const design = await callApi<any>('read_json_file', designPath);
          setDesignData(design);
        }
        if (project.assets_manifest_path) {
          const manifest = await callApi<any>('read_json_file', project.assets_manifest_path);
          const enrichedManifest = (manifest || []).map((scene: any) => {
            const enrichedSubVisuals = (scene.sub_visuals || []).map((sv: any) => ({
              ...sv,
              visual_url: sv.visual_path
                ? getMediaUrlSync(sv.visual_path)
                : ''
            }));
            return {
              ...scene,
              visual_url: scene.visual_path
                ? getMediaUrlSync(scene.visual_path)
                : '',
              sub_visuals: enrichedSubVisuals
            };
          });
          setManifestData(enrichedManifest);
          reloadedManifest = enrichedManifest;
        }
        if (project.transcription_path) {
          const transcript = await callApi<any>('read_json_file', project.transcription_path);
          setTranscriptionData(transcript || { segments: [] });
        }

        // Update store with fresh project metadata (audio_path, transcription_path, etc.)
        // and bust media cache so the preview player picks up new audio/subtitles
        useProjectStore.getState().setSelectedProject(project);
        setReloadKey(k => k + 1);
      }
    } catch (e) {
      console.error("Failed to load asset JSONs:", e);
    } finally {
      setLoadingScript(false);
    }
    // Returned so save tails can distinguish their own reload landing in
    // shared state from genuine mid-save user edits (see handleSaveCard).
    return { script: reloadedScript, manifest: reloadedManifest };
  }, []);

  // Load project detail on mount — sequence: fetch detail first, then files,
  // so selectedProject + tasks are in the store before loadFiles reads paths.
  useEffect(() => {
    if (projectId) {
      (async () => {
        await fetchProjectDetail(projectId);
        await loadFiles(projectId);
      })().catch(console.error);
    }
  }, [projectId, fetchProjectDetail, loadFiles]);

  /** Build a scene object from script data (used when manifest is unavailable) */
  const buildSceneFromScript = useCallback((
    sectionType: string,
    source: any,
    title: string,
    text: string,
  ) => ({
    index: 0,
    section_type: sectionType,
    title,
    text,
    audio_file: '',
    audio_url: '',
    duration: estimateTextDuration(text),
    sub_visuals: (source?.sub_visuals || []).map((sv: any) => ({
      ...sv,
      visual_url: '',
      duration: 0,
    })),
  }), []);

  // Compute live scenes from manifest + script data
  const liveScenes = useMemo(() => {
    // Case 1: Both manifest and script exist — enrich manifest with script data
    if (manifestData && manifestData.length > 0 && scriptData) {
      let sceneCounter = 0;
      return manifestData.map((manifestScene: any) => {
        const type = manifestScene.section_type;
        let liveSubVisuals: any[] = [];
        let liveTitle = manifestScene.title;

        if (type === 'introduction' && scriptData?.introduction) {
          liveSubVisuals = scriptData.introduction?.sub_visuals || [];
        } else if (type === 'conclusion' && scriptData?.conclusion) {
          liveSubVisuals = scriptData.conclusion?.sub_visuals || [];
        } else if (type === 'scene' && Array.isArray(scriptData?.scenes)) {
          const currentIdx = sceneCounter;
          sceneCounter++;
          const scriptScene = scriptData.scenes[currentIdx];
          if (scriptScene) {
            liveSubVisuals = scriptScene?.sub_visuals || [];
            if (scriptScene.title !== undefined) liveTitle = scriptScene.title;
          }
        }

        const origSubVisuals = manifestScene.sub_visuals || [];
        const resolvedSubVisuals = liveSubVisuals.map((lsv: any, idx: number) => {
          const matchIdx = idx < origSubVisuals.length ? idx : -1;
          const osv = matchIdx !== -1 ? origSubVisuals[matchIdx] : {};

          const visualUrl = osv.visual_url ? `${osv.visual_url}&t=${reloadKey}` : '';
          // Script is the source of truth for the transition: the AST
          // sub-visual editor writes scriptData only (the manifest is rebuilt
          // on save), while the timeline writes both stores. Resolving from
          // the script side keeps the player and timeline badges in sync with
          // unsaved editor changes instead of showing the stale manifest value.
          const resolvedTransition = lsv.transition || lsv.transition_type || osv.transition || osv.transition_type;
          return {
            ...osv,
            transition: resolvedTransition,
            transition_type: resolvedTransition,
            // Script is the source of truth for punch-ins too (same reason).
            emphasis: (lsv as any).emphasis ?? (osv as any).emphasis,
            visual_meta: lsv.visual_meta,
            transform: lsv.transform,
            duration_ratio: lsv.duration_ratio,
            videoVolume: lsv.videoVolume,
            mute_voiceover: lsv.mute_voiceover,
            mute_bg_music: lsv.mute_bg_music,
            visual_url: visualUrl,
            composition: lsv.composition || osv.composition,
            duration: osv.duration
          };
        });

        const resolvedAudioUrl = manifestScene.audio_url ? `${manifestScene.audio_url}&t=${reloadKey}` : '';

        const sceneDuration = manifestScene.duration > 0
          ? manifestScene.duration
          : estimateTextDuration(
              type === 'introduction' ? scriptData?.introduction?.hook
              : type === 'conclusion' ? scriptData?.conclusion?.summary
              : scriptData?.scenes?.[sceneCounter - 1]?.narration
            );

        return {
          ...manifestScene,
          title: liveTitle,
          sub_visuals: resolvedSubVisuals,
          audio_url: resolvedAudioUrl,
          duration: sceneDuration
        };
      });
    }

    // Case 2: Script data exists but manifest hasn't been generated yet
    // Derive scenes from script for preview
    if (scriptData) {
      const derived: any[] = [];

      if (scriptData.introduction) {
        derived.push(buildSceneFromScript(
          'introduction', scriptData.introduction,
          'Introduction', scriptData.introduction.hook || ''
        ));
      }

      (scriptData.scenes || []).forEach((scene: any, idx: number) => {
        derived.push({
          ...buildSceneFromScript(
            'scene', scene,
            scene.title || `Scene ${idx + 1}`,
            scene.narration || ''
          ),
          index: idx,
        });
      });

      if (scriptData.conclusion) {
        derived.push(buildSceneFromScript(
          'conclusion', scriptData.conclusion,
          'Conclusion', scriptData.conclusion.summary || ''
        ));
      }

      return derived;
    }

    // Case 3: Only manifest exists — return manifest as-is
    return manifestData || [];
  }, [manifestData, scriptData, reloadKey, buildSceneFromScript]);

  // Compute scene timings
  const rawTimings = useMemo(() => {
    if (!liveScenes) return [];
    let offset = 0;
    return liveScenes.map((scene: any) => {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const start = offset;
      const end = offset + durationFrames;

      const subVisuals = scene.sub_visuals || [];

      const subs = calculateSubVisualTimings(subVisuals, durationFrames, start);

      offset = end;
      return { start, end, subs };
    });
  }, [liveScenes]);

  // Deep-stabilize timings: visual/text edits that don't move frame
  // boundaries return the PREVIOUS array reference, so the Timeline, track
  // components, and sidebar lists memo-skip instead of re-rendering on every
  // keystroke/slider tick. Purely referential — frame values identical.
  // Memo with ref comparison prevents 1-render lag and extra paint cycles.
  const prevTimingsRef = useRef(rawTimings);
  const sceneTimings = useMemo(() => {
    if (sameTimings(prevTimingsRef.current, rawTimings)) {
      return prevTimingsRef.current;
    }
    prevTimingsRef.current = rawTimings;
    return rawTimings;
  }, [rawTimings]);

  const selectedProject = useProjectStore((s) => s.selectedProject);
  const updateProject = useProjectStore((s) => s.updateProject);

  const musicClipsRaw = useMemo<MusicClip[]>(() => {
    if (!selectedProject) return [];
    const totalFrames = sceneTimings.length > 0 ? sceneTimings[sceneTimings.length - 1].end : 300;

    let clips: MusicClip[] | null = null;
    if (selectedProject.music_clips !== undefined && selectedProject.music_clips !== null) {
      try {
        clips = typeof selectedProject.music_clips === 'string'
          ? JSON.parse(selectedProject.music_clips)
          : selectedProject.music_clips;
      } catch (e) {
        clips = null;
      }
    }

    // Fallback: ONLY if music_clips was never configured on this project (null/undefined)
    if (clips === null) {
      if (selectedProject.bg_music_path) {
        clips = [
          {
            id: 'default_bgm',
            name: selectedProject.bg_music_path.split(/[/\\]/).pop() || 'Background Music',
            audio_path: selectedProject.bg_music_path,
            start_frame: 0,
            duration_frames: totalFrames,
            source_start_seconds: 0,
            volume: selectedProject.bg_music_volume ?? 0.15,
            loop: true,
            fade_in_seconds: 0.5,
            fade_out_seconds: 1.0,
            is_muted: false,
          }
        ];
      } else {
        clips = [];
      }
    }

    return (clips || []).map((c: MusicClip) => ({
      ...c,
      audio_url: c.audio_path ? `${getMediaUrlSync(c.audio_path)}&t=${reloadKey}` : '',
    }));
  }, [selectedProject?.music_clips, selectedProject?.bg_music_path, selectedProject?.bg_music_volume, reloadKey, sceneTimings]);

  // Referential stabilization: identical clip content (ignoring cache-buster)
  // returns the PREVIOUS array so the preview player and timeline memo-skip.
  const prevMusicRef = useRef<MusicClip[]>([]);
  const musicClips = useMemo(() => {
    if (sameClips(prevMusicRef.current, musicClipsRaw)) {
      return prevMusicRef.current;
    }
    prevMusicRef.current = musicClipsRaw;
    return musicClipsRaw;
  }, [musicClipsRaw]);

  const updateMusicClips = useCallback(async (newClips: MusicClip[]) => {
    if (!projectId) return false;
    const cleanClips = (newClips || []).map(c => {
      const { audio_url, ...rest } = c;
      return rest;
    });
    const success = await updateProject(projectId, {
      music_clips: cleanClips
    });
    if (success) {
      setReloadKey(k => k + 1);
    }
    return success;
  }, [projectId, updateProject]);

  const sfxClipsRaw = useMemo<SfxClip[]>(() => {
    if (!selectedProject) return [];
    let clips: SfxClip[] | null = null;
    if ((selectedProject as any).sfx_clips !== undefined && (selectedProject as any).sfx_clips !== null) {
      try {
        const raw = (selectedProject as any).sfx_clips;
        clips = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        clips = [];
      }
    } else {
      clips = [];
    }
    return (clips || []).map((c: SfxClip) => ({
      ...c,
      audio_url: c.audio_path ? `${getMediaUrlSync(c.audio_path)}&t=${reloadKey}` : '',
    }));
  }, [(selectedProject as any)?.sfx_clips, reloadKey]);

  const prevSfxRef = useRef<SfxClip[]>([]);
  const sfxClips = useMemo(() => {
    if (sameClips(prevSfxRef.current, sfxClipsRaw)) {
      return prevSfxRef.current;
    }
    prevSfxRef.current = sfxClipsRaw;
    return sfxClipsRaw;
  }, [sfxClipsRaw]);

  const updateSfxClips = useCallback(async (newClips: SfxClip[]) => {
    if (!projectId) return false;
    const cleanClips = (newClips || []).map(c => {
      const { audio_url, ...rest } = c;
      return rest;
    });
    const success = await updateProject(projectId, { sfx_clips: cleanClips } as any);
    if (success) {
      setReloadKey(k => k + 1);
    }
    return success;
  }, [projectId, updateProject]);

  const getAudioSourceUrl = useCallback(() => {
    const project = useProjectStore.getState().selectedProject;
    if (project?.audio_path) {
      return `${getMediaUrlSync(project.audio_path)}&t=${reloadKey}`;
    }
    return '';
  }, [reloadKey]);

  const getBGMUrl = useCallback(() => {
    const project = useProjectStore.getState().selectedProject;
    if (project?.bg_music_path) {
      return `${getMediaUrlSync(project.bg_music_path)}&t=${reloadKey}`;
    }
    return '';
  }, [reloadKey]);

  return {
    scriptData, setScriptData,
    designData, setDesignData,
    manifestData, setManifestData,
    transcriptionData, setTranscriptionData,
    loadingScript, reloadKey,
    liveScenes, sceneTimings,
    musicClips, updateMusicClips,
    sfxClips, updateSfxClips,
    loadFiles,
    getAudioSourceUrl, getBGMUrl
  };
}
