import React, { useMemo, useCallback } from 'react';
import { Sequence, Audio, useVideoConfig, useCurrentFrame, getRemotionEnvironment } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';
import { PanScanImage } from './PanScanImage';
import { ParallaxImage } from './ParallaxImage';
import { DataVisualizations } from './DataVisualizations';
import { NumberingList } from './NumberingList';
import { TransitionWrapper } from './TransitionWrapper';
import { ZoomWrapper } from './ZoomWrapper';
import { SubVisualTransform } from './SubVisualTransform';
import { CustomHtmlVisual } from './CustomHtmlVisual';
import { CustomHtmlUiOverlay } from './CustomHtmlUiOverlay';
import { ThreadSimulation } from './ThreadSimulation';
import { DeviceMockup } from './DeviceMockup';
import { calculateSubVisualTimings } from '../../utils/duration';

interface SubVisual {
  visual_type: 'scene' | 'portrait' | 'image' | 'map' | 'document' | 'youtube' | 'parallax' | 'network' | 'list' | 'custom_html' | 'thread' | 'device_mockup' | 'ai_image';
  visual_cue: string;
  transition_type?: string;
  visual_url?: string;
  visual_meta?: any;
  duration?: number;
  /** User-configured zoom & pan offset applied uniformly to this sub-visual */
  transform?: SubVisualTransform;
  /** Proportional duration share within the scene (values sum to ~1.0). Set by Adjust Durations bar. */
  duration_ratio?: number;
  /** Volume for video-type sub-visuals (0-1). 0 = muted (default), 1 = full volume. */
  videoVolume?: number;
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
  const isNear = frame >= subFrom - 60 && frame <= subFrom + subDuration + 90;
  return isNear ? (
    <Sequence from={subFrom} durationInFrames={subDuration}>
      {children}
    </Sequence>
  ) : null;
};

// Volume for the narration/music tracks is evaluated against GLOBAL timeline
// frames. But `<Audio loop>` internally wraps the element in a Remotion
// `<Loop>`, so the `frame` argument given to the `volume` callback is
// LOOP-RELATIVE (it resets to 0 on every loop pass and never matches the
// global timeline after the first pass). Instead of trusting that argument,
// this component subscribes to the global frame itself: Remotion evaluates
// the volume callback during the render of the current frame, so the captured
// global frame is always the frame being rendered.
const FrameVolumeAudio: React.FC<{
  src: string;
  loop?: boolean;
  muteRanges: Array<{ start: number; end: number }>;
  baseVolume: number;
}> = ({ src, loop, muteRanges, baseVolume }) => {
  const frame = useCurrentFrame();
  const volume = Math.max(0, Math.min(1, baseVolume));
  return (
    <Audio
      src={src}
      loop={loop}
      pauseWhenBuffering
      volume={() => (isFrameInRanges(frame, muteRanges) ? 0 : volume)}
    />
  );
};

export const NitishRajputComposition = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  voiceoverVolume = 1.0,
  muteVideoAudio = false,
  scenes = [],
  transcription = { language: '', segments: [] },
  style = 'nitish_rajput',
  subtitleSettings = {}
}: Props) => {
  useVideoConfig();

  // Build scene timing lookup (cumulative start/end times) for subtitle gap-filling
  const sceneTimings: SceneTiming[] = useMemo(() => {
    let offset = 0;
    return scenes.map(scene => {
      const start = offset;
      const end = offset + (scene.duration || 0);
      offset = end;
      return { start, end, text: scene.text };
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

  // Helper to render a single sub-visual's content
  const renderSubVisual = useCallback((subVis: SubVisual, durationFrames: number) => {
    const type = subVis.visual_type;
    const url = subVis.visual_url || '';
    const meta = subVis.visual_meta || {};
    const transform = subVis.transform;

    if (type === 'map' || type === 'document' || type === 'network') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          {/* ZoomWrapper wraps both background and visualization — they scale together */}
          <ZoomWrapper transform={transform}>
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: '#1c1917',
                backgroundImage: 'radial-gradient(circle, #292524 0%, #0c0a09 100%)'
              }} />
              <DataVisualizations type={type} meta={meta} durationInFrames={durationFrames} />
            </div>
          </ZoomWrapper>
          {/* Vignette overlay stays OUTSIDE ZoomWrapper so it never scales with camera zoom — same pattern as ParallaxImage */}
          <div style={{
            position: 'absolute', inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none', zIndex: 10
          }} />
        </div>
      );
    }

    if (type === 'parallax') {
      return (
        <ParallaxImage
          backgroundUrl={url}
          foregroundUrl={meta.foreground_url}
          meta={meta.parallax || meta}
          cue={subVis.visual_cue}
          durationInFrames={durationFrames}
          transform={transform}
        />
      );
    }

    if (type === 'list') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: '#1c1917',
                backgroundImage: 'radial-gradient(circle, #292524 0%, #0c0a09 100%)'
              }} />
              <NumberingList meta={meta} durationInFrames={durationFrames} subtitleSettings={subtitleSettings} cue={subVis.visual_cue} />
            </div>
          </ZoomWrapper>
          <div style={{
            position: 'absolute', inset: 0,
            boxShadow: 'inset 0 0 250px rgba(0,0,0,0.9)',
            pointerEvents: 'none', zIndex: 10
          }} />
        </div>
      );
    }

    if (type === 'custom_html') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <CustomHtmlVisual meta={meta} />
          </ZoomWrapper>
        </div>
      );
    }

    if (type === 'thread') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <ThreadSimulation meta={meta} durationInFrames={durationFrames} />
          </ZoomWrapper>
        </div>
      );
    }
    if (type === 'device_mockup') {
      return (
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <ZoomWrapper transform={transform}>
            <DeviceMockup meta={meta} durationInFrames={durationFrames} visualUrl={url} />
          </ZoomWrapper>
        </div>
      );
    }


    // Default: Image, portrait, or B-roll video. Display with pan-and-scan camera glide
    return (
      <PanScanImage
        src={url}
        type={type}
        cue={subVis.visual_cue}
        durationInFrames={durationFrames}
        transform={transform}
        videoVolume={muteVideoAudio ? 0 : (subVis.videoVolume || 0)}
      />
    );
  }, [subtitleSettings, muteVideoAudio]);

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
            const htmlUiMeta = subVis.visual_meta?.custom_html_ui;

            return (
              <SubGate
                key={`sub-${subIdx}`}
                subFrom={subFrom}
                subDuration={subDuration}
              >
                <TransitionWrapper durationInFrames={subDuration} type={subVis.transition_type}>
                  {renderSubVisual(subVis, subDuration)}
                </TransitionWrapper>
                {htmlUiMeta && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}>
                    <CustomHtmlUiOverlay meta={htmlUiMeta} />
                  </div>
                )}
              </SubGate>
            );
          })}

          {!subtitleSettings?.hide_chapter_name && scene.title && (
            <div style={{
              position: 'absolute',
              top: 50,
              left: 60,
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              color: subtitleSettings?.chapter_text_color || '#d6d3d1',
              textTransform: 'uppercase',
              letterSpacing: 2,
              opacity: 0.6,
              borderLeft: `4px solid ${subtitleSettings?.chapter_border_color || '#b45309'}`,
              paddingLeft: 12,
              zIndex: 50
            }}>
              {scene.title}
            </div>
          )}
        </SceneGate>
      );
    });
  }, [scenes, subtitleSettings, renderSubVisual]);

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
          />
        </div>
      )}

      {/* 5. Paper Overlay Layer */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 110, pointerEvents: 'none' }}>
        <PaperOverlay />
      </div>
    </div>
  );
};
