import React, { useMemo, useCallback } from 'react';
import { Sequence, Audio, useVideoConfig, useCurrentFrame, getRemotionEnvironment } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';

import { ASTRenderer } from './ASTRenderer';
import { calculateSubVisualTimings } from '../../utils/duration';
import { getCanvasScaleFactor } from './compositionScale';

interface SubVisual {
  composition?: any;
  /** Proportional duration share within the scene (values sum to ~1.0). Set by Adjust Durations bar. */
  duration_ratio?: number;
  /** Dynamic subtitle dodging position for this sub-visual */
  subtitle_position?: 'bottom' | 'top' | 'hidden';
  /** Cut the narrator voiceover during this sub-visual's timeline interval. */
  mute_voiceover?: boolean;
  /** Cut the background music during this sub-visual's timeline interval. */
  mute_bg_music?: boolean;
}

export interface Scene {
  index: number;
  section_type: string;
  title: string;
  text: string;
  audio_file: string;
  audio_url: string;
  duration: number;
  sub_visuals: SubVisual[];
}

export interface TranscriptionWord {
  start: number;
  end: number;
  word: string;
}

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptionWord[];
}

export interface Transcription {
  language: string;
  segments: TranscriptionSegment[];
}

export interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  voiceoverVolume?: number;
  muteVideoAudio?: boolean;
  scenes: Scene[];
  transcription: Transcription;
  style?: string;
  language?: string;
  subtitleSettings?: any;
  designSystem?: any;
  __file_server_port__?: number;
}

export interface SceneTiming {
  start: number;
  end: number;
  text: string;
}

// ── Time-window virtualization gates ────────────────────────────────────────
// Heavy scene/sub-visual trees are only mounted while the playhead is near.
// Defined at module scope so their component identity is stable across frames;
// each gate re-renders on frame change (useCurrentFrame) and bails out on the
// placeholder for distant content. Applies during preview AND headless
// rendering (no isRendering exemption): each rendered frame's DOM then holds
// ~1-3 scenes instead of all 250 visuals, which prevents the OOM/GPU timeout
// hang on 10-15 minute videos.

const BLACK_PLACEHOLDER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  backgroundColor: '#0c0a09',
};

const isFrameInRanges = (frame: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((r) => frame >= r.start && frame < r.end);

const SceneGate: React.FC<{
  from: number;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ from, durationInFrames, children }) => {
  // useCurrentFrame at composition-root level = the global frame. The
  // Sequence is only mounted while the playhead is near, so the gate is a
  // real decision here (unlike rendering it inside the Sequence, where
  // Remotion already drops inactive trees and the check is tautological).
  const frame = useCurrentFrame();
  // Buffer: mount -90f before start, keep +120f past end
  const isNear = frame >= from - 90 && frame <= from + durationInFrames + 120;
  return isNear ? (
    <Sequence from={from} durationInFrames={durationInFrames}>
      {children}
    </Sequence>
  ) : (
    <div style={BLACK_PLACEHOLDER_STYLE} />
  );
};

const SubGate: React.FC<{
  subFrom: number;
  subDuration: number;
  children: React.ReactNode;
}> = ({ subFrom, subDuration, children }) => {
  // frame is scene-relative here (SubGate lives inside SceneGate's Sequence).
  const frame = useCurrentFrame();
  // Buffer: mount -60f before start, keep +90f past end
  const isNear = frame >= subFrom - 60 && frame <= subFrom + subDuration + 60;
  return isNear ? (
    <Sequence from={subFrom} durationInFrames={subDuration}>
      {children}
    </Sequence>
  ) : (
    <div style={BLACK_PLACEHOLDER_STYLE} />
  );
};

// ── Frame-accurate volume modulation for audio elements ─────────────────────
const FrameVolumeAudio: React.FC<{
  src: string;
  muteRanges: Array<{ start: number; end: number }>;
  baseVolume?: number;
  loop?: boolean;
}> = ({ src, muteRanges, baseVolume = 1, loop = false }) => {
  const frame = useCurrentFrame();
  const isMuted = isFrameInRanges(frame, muteRanges);
  const volume = isMuted ? 0 : baseVolume;
  return <Audio src={src} volume={volume} loop={loop} />;
};

export const NitishRajputComposition: React.FC<Props> = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.2,
  voiceoverVolume = 1.0,

  scenes,
  transcription,
  style = 'nitish_rajput',
  subtitleSettings = {},
  designSystem,
  __file_server_port__
}) => {
  if (__file_server_port__ && typeof window !== 'undefined') {
    window.__file_server_port__ = __file_server_port__;
  }

  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  // Fast preview (compositionScale=0.5) shrinks the Player canvas to 960x540.
  // Visuals are authored in 1080p logical pixels, so the content tree is laid
  // out at the logical size and scaled down to fill the smaller canvas — the
  // exported 1080p render (scaleFactor 1) is untouched.
  const scaleFactor = getCanvasScaleFactor(canvasWidth, canvasHeight);

  // Build scene timing lookup (cumulative start/end times) for subtitle gap-filling
  const sceneTimings: SceneTiming[] = useMemo(() => {
    let currentTime = 0;
    return scenes.map(scene => {
      const start = currentTime;
      const end = currentTime + (scene.duration || 0);
      currentTime = end;
      return { start, end, text: scene.text || '' };
    });
  }, [scenes]);

  // Global-frame ranges where the narrator voiceover / bg music are cut,
  // derived from sub-visuals with mute_voiceover / mute_bg_music enabled.
  const { voiceMuteRanges, bgMuteRanges } = useMemo(() => {
    const voice: Array<{ start: number; end: number }> = [];
    const bg: Array<{ start: number; end: number }> = [];
    let offset = 0;
    for (const scene of scenes) {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const subVisuals = scene.sub_visuals || [];
      const timings = subVisuals.length > 0 ? calculateSubVisualTimings(subVisuals, durationFrames, 0) : [];
      subVisuals.forEach((sv, i) => {
        const t = timings[i];
        if (!t) return;
        if (sv.mute_voiceover) voice.push({ start: offset + t.start, end: offset + t.end });
        if (sv.mute_bg_music) bg.push({ start: offset + t.start, end: offset + t.end });
      });
      offset += durationFrames;
    }
    return { voiceMuteRanges: voice, bgMuteRanges: bg };
  }, [scenes]);

  // Compute frame-range subtitle displacements for dodging (top, bottom, hidden)
  const subtitleDisplacements = useMemo(() => {
    const list: Array<{ startFrame: number; endFrame: number; position: 'bottom' | 'top' | 'hidden' }> = [];
    let offset = 0;
    for (const scene of scenes) {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const subVisuals = scene.sub_visuals || [];
      const timings = subVisuals.length > 0 ? calculateSubVisualTimings(subVisuals, durationFrames, 0) : [];
      subVisuals.forEach((sv, i) => {
        const t = timings[i];
        if (t && sv.subtitle_position) {
          list.push({
            startFrame: offset + t.start,
            endFrame: offset + t.end,
            position: sv.subtitle_position
          });
        }
      });
      offset += durationFrames;
    }
    return list;
  }, [scenes]);

  // Helper to render a single sub-visual's content
  const renderSubVisual = useCallback((subVis: SubVisual) => {
    if (subVis.composition) {
      return <ASTRenderer composition={subVis.composition} />;
    }
    return null;
  }, []);

  // ── Time-window virtualization ──────────────────────────────────────────────
  // Pre-calculate and memoize the timeline tree once; per-frame virtualization
  // decisions are made inside the module-scope SceneGate/SubGate components,
  // so the memo only recomputes when scenes/settings actually change.
  const renderedScenes = useMemo(() => {
    let frameOffset = 0;
    return scenes.map((scene, idx) => {
      const durationFrames = Math.max(30, Math.ceil((scene.duration || 0) * 30));
      const currentOffset = frameOffset;
      frameOffset += durationFrames;

      const subVisuals = scene.sub_visuals || [];
      const timings = subVisuals.length > 0 ? calculateSubVisualTimings(subVisuals, durationFrames, 0) : [];

      return (
        <SceneGate key={`scene-${idx}`} from={currentOffset} durationInFrames={durationFrames}>
          {subVisuals.map((subVis, subIdx) => {
            const timing = timings[subIdx];
            const subFrom = timing.start;
            const subDuration = Math.max(1, timing.end - timing.start);
            return (
              <SubGate
                key={`sub-${subIdx}`}
                subFrom={subFrom}
                subDuration={subDuration}
              >
                {renderSubVisual(subVis)}
              </SubGate>
            );
          })}
        </SceneGate>
      );
    });
  }, [scenes, renderSubVisual]);

  // ── Resolution scaling (fast preview) ─────────────────────────────────────
  // At scaleFactor 1 (export / full-res preview) the layers mount directly.
  // Otherwise the entire visual tree is laid out at the logical 1080p size
  // inside a div scaled to fill the reduced Player canvas, so every absolute
  // pixel coordinate stays correct while the GPU only rasterizes at
  // (scaleFactor)^2 of the pixels.
  const visualLayers = (
    <>
      {/* 3. Chronological Scene Sequences */}
      {renderedScenes}

      {/* 4. Active Typographic Subtitle Overlay */}
      {!subtitleSettings?.hide_subtitles && transcription && transcription.segments && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
          <KineticSubtitles 
            transcription={transcription} 
            sceneTimings={sceneTimings}
            styleType={style} 
            subtitleSettings={subtitleSettings}
            subtitleDisplacements={subtitleDisplacements}
            designSystem={designSystem}
          />
        </div>
      )}

      {/* 5. Paper Overlay Layer */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 110, pointerEvents: 'none' }}>
        <PaperOverlay />
      </div>
    </>
  );

  return (
    <div style={{ flex: 1, backgroundColor: '#0c0a09', position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      {/* 1. Spoken Narration Track & Ambient Soundtrack (Preview Only) */}
      {/* In production render, audio is now mixed directly via FFmpeg for speed */}
      {/* Volume is a frame-based function: muted sub-visuals (mute_voiceover / */}
      {/* mute_bg_music) silence their track for exactly their timeline interval. */}
      {!getRemotionEnvironment().isRendering && (
        <>
          {audioUrl && (
            <FrameVolumeAudio src={audioUrl} muteRanges={voiceMuteRanges} baseVolume={voiceoverVolume} />
          )}
          {bgMusicUrl && (
            <FrameVolumeAudio src={bgMusicUrl} muteRanges={bgMuteRanges} baseVolume={bgMusicVolume} loop />
          )}
        </>
      )}

      {scaleFactor !== 1 ? (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: canvasWidth / scaleFactor,
            height: canvasHeight / scaleFactor,
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}>
            {visualLayers}
          </div>
        </div>
      ) : (
        visualLayers
      )}
    </div>
  );
};
