import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../../store/useProjectStore';
import { callEel } from '../../../utils/eel-bridge';

import { estimateTextDuration } from '../../../utils/duration';

export interface UseEditorDataReturn {
  scriptData: any;
  setScriptData: (data: any) => void;
  manifestData: any[];
  setManifestData: (data: any[]) => void;
  transcriptionData: any;
  setTranscriptionData: (data: any) => void;
  loadingScript: boolean;
  reloadKey: number;
  liveScenes: any[];
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  loadFiles: (projId: string) => Promise<void>;
  getAudioSourceUrl: (projectId: string) => string;
  getBGMUrl: () => string;
}

export function useEditorData(projectId: string | undefined): UseEditorDataReturn {
  const fetchProjectDetail = useProjectStore((s) => s.fetchProjectDetail);

  const [scriptData, setScriptData] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any[]>([]);
  const [transcriptionData, setTranscriptionData] = useState<any>({ segments: [] });
  const [loadingScript, setLoadingScript] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Load project detail on mount
  useEffect(() => {
    if (projectId) {
      fetchProjectDetail(projectId);
      loadFiles(projectId);
    }
  }, [projectId]);

  // Read generated JSON assets from Python server static bridges
  const loadFiles = useCallback(async (projId: string) => {
    setLoadingScript(true);
    try {
      const project = await callEel<any>('db_get_project', projId);
      if (project) {
        if (project.script_path) {
          const script = await callEel<any>('read_json_file', project.script_path);
          setScriptData(script);
        }
        if (project.assets_manifest_path) {
          const manifest = await callEel<any>('read_json_file', project.assets_manifest_path);
          const enrichedManifest = (manifest || []).map((scene: any) => {
            const enrichedSubVisuals = (scene.sub_visuals || []).map((sv: any) => ({
              ...sv,
              visual_url: sv.visual_path
                ? `/api/media?path=${encodeURIComponent(sv.visual_path)}`
                : ''
            }));
            return {
              ...scene,
              visual_url: scene.visual_path
                ? `/api/media?path=${encodeURIComponent(scene.visual_path)}`
                : '',
              sub_visuals: enrichedSubVisuals
            };
          });
          setManifestData(enrichedManifest);
        }
        if (project.transcription_path) {
          const transcript = await callEel<any>('read_json_file', project.transcription_path);
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
  }, []);

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
          const osv = origSubVisuals[idx] || {};
          const visualUrl = osv.visual_url ? `${osv.visual_url}&t=${reloadKey}` : '';
          return {
            ...osv,
            visual_type: lsv.visual_type,
            visual_cue: lsv.visual_cue,
            transition_type: lsv.transition_type,
            visual_meta: lsv.visual_meta,
            transform: lsv.transform,
            duration_ratio: lsv.duration_ratio,
            visual_url: visualUrl,
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
        let ratios = subVisuals.map((sv: any) => sv.duration_ratio);
        const hasValidRatios = ratios.every((r: any) => typeof r === 'number' && !isNaN(r)) && 
                               Math.abs(ratios.reduce((a: number, b: number) => a + b, 0) - 1.0) < 0.01;
        
        if (!hasValidRatios) {
          ratios = Array(numSubs).fill(1.0 / numSubs);
        }

        let currentOffset = start;
        subs = subVisuals.map((_: any, idx: number) => {
          const subDuration = idx === numSubs - 1
            ? end - currentOffset // Last subvisual gets remainder
            : Math.max(1, Math.floor(durationFrames * ratios[idx]));
            
          const subFrom = currentOffset;
          const subEnd = subFrom + Math.max(1, subDuration);
          currentOffset = subEnd;
          
          return { start: subFrom, end: subEnd };
        });
      }

      offset = end;
      return { start, end, subs };
    });
  }, [liveScenes]);

  const getAudioSourceUrl = useCallback(() => {
    const project = useProjectStore.getState().selectedProject;
    if (project?.audio_path) {
      return `/api/media?path=${encodeURIComponent(project.audio_path)}&t=${reloadKey}`;
    }
    return '';
  }, [reloadKey]);

  const getBGMUrl = useCallback(() => {
    const project = useProjectStore.getState().selectedProject;
    if (project?.bg_music_path) {
      return `/api/media?path=${encodeURIComponent(project.bg_music_path)}&t=${reloadKey}`;
    }
    return '';
  }, [reloadKey]);

  return {
    scriptData, setScriptData,
    manifestData, setManifestData,
    transcriptionData, setTranscriptionData,
    loadingScript, reloadKey,
    liveScenes, sceneTimings,
    loadFiles,
    getAudioSourceUrl, getBGMUrl
  };
}
