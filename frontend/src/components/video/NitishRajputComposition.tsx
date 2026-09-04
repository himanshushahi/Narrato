import React, { useMemo, useCallback } from 'react';
import { Sequence, Audio, useVideoConfig, useCurrentFrame, getRemotionEnvironment, interpolate, Easing } from 'remotion';
import { PaperOverlay } from './PaperOverlay';
import { KineticSubtitles } from './KineticSubtitles';
import { GlobalOverlaysRenderer, GlobalOverlayItem } from './GlobalOverlaysRenderer';

import { ASTRenderer } from './ASTRenderer';
import { calculateSubVisualTimings } from '../../utils/duration';
import { getCanvasScaleFactor } from './compositionScale';
import { QualityMode, QualityPolicy } from './renderQuality';

interface SubVisual {
  composition?: any;
  /** Proportional duration share within the scene (values sum to ~1.0). Set by Adjust Durations bar. */
  duration_ratio?: number;
  /** Cut the narrator voiceover during this sub-visual's timeline interval. */
  mute_voiceover?: boolean;
  /** Cut the background music during this sub-visual's timeline interval. */
  mute_bg_music?: boolean;
  /** Entrance transition animation */
  transition?: string;
  /** Mid-cut punch-in zooms (MrBeast-style emphasis): sudden scale-up + settle. */
  emphasis?: EmphasisMark[];
}

/** One punch-in: `at` seconds (sub-relative) zoom to `scale` over `duration` seconds. */
export interface EmphasisMark {
  at: number;
  scale?: number;
  duration?: number;
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

export interface MusicClip {
  id: string;
  name: string;
  audio_path: string;
  audio_url?: string;
  start_frame: number;
  duration_frames: number;
  source_start_seconds?: number;
  source_duration_seconds?: number;
  volume?: number;
  loop?: boolean;
  fade_in_seconds?: number;
  fade_out_seconds?: number;
  is_muted?: boolean;
}

export interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  musicClips?: MusicClip[];
  voiceoverVolume?: number;
  muteVideoAudio?: boolean;
  scenes: Scene[];
  transcription: Transcription;
  style?: string;
  language?: string;
  subtitleSettings?: any;
  designSystem?: any;
  overlays?: GlobalOverlayItem[];
  /** 'preview' = cheap samples + capped glass; 'export' = full quality. Auto-detected when omitted. */
  qualityMode?: QualityMode;
  /** Visual-effects policy from Settings (defaults to balanced). */
  quality?: QualityPolicy | unknown;
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

const SceneGate: React.FC<{
  from: number;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ from, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  // During headless export, Chromium tabs render arbitrary frames in parallel.
  // The buffer-based virtualization can race with React mount/paint, producing
  // blank frames. Disable virtualization during rendering – Remotion's own
  // <Sequence> already hides content outside its frame range.
  const isRendering = getRemotionEnvironment().isRendering;
  // Buffer: mount -90f before start, keep +120f past end (preview only)
  const isNear = isRendering || (frame >= from - 90 && frame <= from + durationInFrames + 120);
  return isNear ? (
    <Sequence from={from} durationInFrames={durationInFrames} premountFor={30}>
      {children}
    </Sequence>
  ) : null;
};

const SubVisualTransitionWrapper: React.FC<{
  transition?: string;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ transition = 'cut', durationInFrames, children }) => {
  const frame = useCurrentFrame();

  if (!transition || transition === 'none' || transition === 'cut') {
    return <>{children}</>;
  }

  // 12-15 frame entrance animation, capped at half the cut duration
  const transFrames = Math.min(14, Math.max(4, Math.floor(durationInFrames / 2)));
  // Clamp config shared by every interpolation – prevents black flash during
  // headless export where sub-visuals are non-overlapping and the previous
  // sub-visual is already unmounted when this one starts at opacity 0.
  const clampBoth = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
  // Minimum opacity ensures the content is never fully invisible on frame 0,
  // which avoids exposing the black background between non-overlapping sequences.
  const MIN_OPACITY = 0.35;
  let style: React.CSSProperties = { width: '100%', height: '100%' };

  switch (transition) {
    case 'slide_left': {
      const x = interpolate(frame, [0, transFrames], [100, 0], {
        ...clampBoth,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
      const opacity = interpolate(frame, [0, Math.min(6, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `translateX(${x}%)`, opacity };
      break;
    }
    case 'slide_right': {
      const x = interpolate(frame, [0, transFrames], [-100, 0], {
        ...clampBoth,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
      const opacity = interpolate(frame, [0, Math.min(6, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `translateX(${x}%)`, opacity };
      break;
    }
    case 'slide_up': {
      const y = interpolate(frame, [0, transFrames], [100, 0], {
        ...clampBoth,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
      const opacity = interpolate(frame, [0, Math.min(6, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `translateY(${y}%)`, opacity };
      break;
    }
    case 'slide_down': {
      const y = interpolate(frame, [0, transFrames], [-100, 0], {
        ...clampBoth,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
      const opacity = interpolate(frame, [0, Math.min(6, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `translateY(${y}%)`, opacity };
      break;
    }
    case 'zoom_in': {
      const scale = interpolate(frame, [0, transFrames], [1.18, 1], {
        ...clampBoth,
        easing: Easing.out(Easing.cubic),
      });
      const opacity = interpolate(frame, [0, Math.min(8, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `scale(${scale})`, opacity };
      break;
    }
    case 'zoom_out': {
      const scale = interpolate(frame, [0, transFrames], [0.85, 1], {
        ...clampBoth,
        easing: Easing.out(Easing.cubic),
      });
      const opacity = interpolate(frame, [0, Math.min(8, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `scale(${scale})`, opacity };
      break;
    }
    case 'glitch': {
      const isGlitching = frame < Math.min(8, transFrames);
      const glitchX = isGlitching ? (frame % 2 === 0 ? (frame % 4 === 0 ? 15 : -15) : 0) : 0;
      const opacity = interpolate(frame, [0, 4], [0.4, 1], clampBoth);
      style = {
        ...style,
        transform: glitchX ? `translateX(${glitchX}px)` : undefined,
        filter: isGlitching ? 'contrast(1.3) hue-rotate(90deg)' : undefined,
        opacity,
      };
      break;
    }
    case 'crossfade': {
      const opacity = interpolate(frame, [0, transFrames], [MIN_OPACITY, 1], {
        ...clampBoth,
        easing: Easing.inOut(Easing.quad),
      });
      style = { ...style, opacity };
      break;
    }
    case 'fade':
    default: {
      const opacity = interpolate(frame, [0, transFrames], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, opacity };
      break;
    }
  }

  return <div style={style}>{children}</div>;
};

const SubGate: React.FC<{
  subFrom: number;
  subDuration: number;
  transition?: string;
  emphasis?: EmphasisMark[];
  children: React.ReactNode;
}> = ({ subFrom, subDuration, transition, emphasis, children }) => {
  // frame is scene-relative here (SubGate lives inside SceneGate's Sequence).
  const frame = useCurrentFrame();
  const isRendering = getRemotionEnvironment().isRendering;
  // Buffer: mount -60f before start, keep +90f past end (preview only)
  const isNear = isRendering || (frame >= subFrom - 60 && frame <= subFrom + subDuration + 60);
  return isNear ? (
    <Sequence from={subFrom} durationInFrames={subDuration} premountFor={30}>
      <SubVisualTransitionWrapper transition={transition} durationInFrames={subDuration}>
        <EmphasisWrapper emphasis={emphasis}>
          {children}
        </EmphasisWrapper>
      </SubVisualTransitionWrapper>
    </Sequence>
  ) : null;
};

/**
 * Mid-cut punch-in zooms (MrBeast-style emphasis energy): at each mark the
 * content snaps to `scale` with a fast ease-out attack, then settles back to
 * 1.0 over the mark duration. Pure function of frame — deterministic for
 * scrubbing and headless export. Zero-cost passthrough when empty.
 */
const EmphasisWrapper: React.FC<{
  emphasis?: EmphasisMark[];
  children: React.ReactNode;
}> = ({ emphasis, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!emphasis || emphasis.length === 0) return <>{children}</>;
  let total = 1;
  for (const m of emphasis) {
    if (!m || typeof m.at !== 'number') continue;
    const peak = Math.min(1.6, Math.max(1.02, typeof m.scale === 'number' ? m.scale : 1.12));
    const dur = Math.min(2, Math.max(0.2, typeof m.duration === 'number' ? m.duration : 0.5));
    const startF = Math.max(0, Math.round(m.at * fps));
    const durF = Math.max(2, Math.round(dur * fps));
    const attack = interpolate(frame, [startF, startF + durF * 0.35], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    const release = interpolate(frame, [startF + durF * 0.35, startF + durF], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.ease),
    });
    total *= 1 + (peak - 1) * attack * (1 - release);
  }
  if (total === 1) return <>{children}</>;
  return (
    <div style={{ width: '100%', height: '100%', transform: `scale(${total})`, transformOrigin: 'center center' }}>
      {children}
    </div>
  );
};

const isFrameInRanges = (frame: number, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((r) => frame >= r.start && frame < r.end);

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

const DynamicFadeAudio: React.FC<{
  src: string;
  clipDurationFrames: number;
  baseVolume?: number;
  startFromFrame?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  loop?: boolean;
  globalMuteRanges?: Array<{ start: number; end: number }>;
  clipGlobalStart?: number;
}> = ({
  src,
  clipDurationFrames,
  baseVolume = 0.2,
  startFromFrame = 0,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  loop = true,
  globalMuteRanges = [],
  clipGlobalStart = 0,
}) => {
  const frame = useCurrentFrame();
  const globalFrame = clipGlobalStart + frame;
  const isMuted = isFrameInRanges(globalFrame, globalMuteRanges);

  let volFactor = 1.0;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    volFactor = Math.min(volFactor, Math.max(0, frame / fadeInFrames));
  }
  if (fadeOutFrames > 0 && frame > clipDurationFrames - fadeOutFrames) {
    const remaining = clipDurationFrames - frame;
    volFactor = Math.min(volFactor, Math.max(0, remaining / fadeOutFrames));
  }

  const volume = isMuted ? 0 : Math.max(0, baseVolume * volFactor);
  return (
    <Audio
      src={src}
      volume={volume}
      startFrom={startFromFrame}
      loop={loop}
    />
  );
};

export const NitishRajputComposition: React.FC<Props> = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.2,
  musicClips = [],
  voiceoverVolume = 1.0,

  scenes,
  transcription,
  style = 'nitish_rajput',
  subtitleSettings = {},
  designSystem,
  overlays = [],
  qualityMode,
  quality,
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

  // Compute total duration in frames
  const totalDurationInFrames = useMemo(() => {
    return scenes.reduce((acc, s) => acc + Math.max(30, Math.ceil((s.duration || 0) * 30)), 0);
  }, [scenes]);

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
  // Disabled to keep subtitles consistent at the bottom of the screen.
  const subtitleDisplacements = useMemo(() => {
    return [];
  }, [scenes]);

  // Helper to render a single sub-visual's content
  const renderSubVisual = useCallback((subVis: SubVisual) => {
    if (subVis.composition) {
      return <ASTRenderer composition={subVis.composition} qualityMode={qualityMode} quality={quality} />;
    }
    return null;
  }, [qualityMode, quality]);

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
                transition={subVis.transition}
                emphasis={subVis.emphasis}
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

      {/* 4. Global Overlays & Branding Layer */}
      {overlays && overlays.length > 0 && (
        <GlobalOverlaysRenderer
          overlays={overlays}
          totalDurationInFrames={totalDurationInFrames}
          qualityMode={qualityMode}
          quality={quality}
        />
      )}

      {/* 5. Active Typographic Subtitle Overlay */}
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
          {musicClips && musicClips.length > 0 ? (
            musicClips.map((clip) => {
              if (!clip.audio_url || clip.is_muted) return null;
              const startFrame = Math.max(0, Math.round(clip.start_frame || 0));
              const durationFrames = Math.max(1, Math.round(clip.duration_frames || 30));
              const fadeInFrames = Math.round((clip.fade_in_seconds || 0) * 30);
              const fadeOutFrames = Math.round((clip.fade_out_seconds || 0) * 30);
              const startFromFrame = Math.round((clip.source_start_seconds || 0) * 30);
              const clipVolume = Math.max(0, (clip.volume ?? 0.2) * (bgMusicVolume !== undefined ? bgMusicVolume / 0.15 : 1));

              return (
                <Sequence key={clip.id} from={startFrame} durationInFrames={durationFrames} premountFor={30}>
                  <DynamicFadeAudio
                    src={clip.audio_url}
                    clipDurationFrames={durationFrames}
                    baseVolume={clipVolume}
                    startFromFrame={startFromFrame}
                    fadeInFrames={fadeInFrames}
                    fadeOutFrames={fadeOutFrames}
                    loop={clip.loop !== false}
                    globalMuteRanges={bgMuteRanges}
                    clipGlobalStart={startFrame}
                  />
                </Sequence>
              );
            })
          ) : bgMusicUrl ? (
            <FrameVolumeAudio src={bgMusicUrl} muteRanges={bgMuteRanges} baseVolume={bgMusicVolume} loop />
          ) : null}
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
