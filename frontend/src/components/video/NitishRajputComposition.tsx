import React, { useMemo, useCallback, useEffect } from 'react';
import { Sequence, Audio, useVideoConfig, useCurrentFrame, getRemotionEnvironment, interpolate, Easing, delayRender, continueRender } from 'remotion';
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

export type SfxClip = MusicClip;

export interface Props {
  audioUrl: string;
  bgMusicUrl?: string;
  bgMusicVolume?: number;
  musicClips?: MusicClip[];
  sfxClips?: SfxClip[];
  sfxVolume?: number;
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
  /**
   * Self-contained @font-face stylesheet (fonts embedded as data: URIs),
   * supplied by the backend at export time. The editor preview loads fonts
   * via injected <link> tags instead, so this is usually empty there.
   */
  fontCssInline?: string;
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
  // Settle-bail WITHOUT unmounting: past transFrames every branch has
  // converged to opacity 1 + identity transform, so render that final style
  // directly (no interpolate calls) but KEEP the same wrapper div. Returning
  // a bare fragment here previously swapped div -> fragment mid-cut, which
  // made React unmount + remount the whole subtree — destroying loaded
  // <Video>/<Img> elements ~0.5s into the cut (white/black flash while the
  // fresh element re-buffered). glitch keeps its own window (handled in case).
  if (transition !== 'glitch' && frame > transFrames) {
    return <div style={{ width: '100%', height: '100%', opacity: 1 }}>{children}</div>;
  }
  // Clamp config shared by every interpolation – prevents black flash during
  // headless export where sub-visuals are non-overlapping and the previous
  // sub-visual is already unmounted when this one starts at opacity 0.
  const clampBoth = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
  // Minimum opacity ensures the content is never fully invisible on frame 0,
  // which avoids exposing the black background between non-overlapping sequences.
  const MIN_OPACITY = 0.35;
  let style: React.CSSProperties = { width: '100%', height: '100%' };

  switch (transition) {
    case 'slide_left':
    case 'subtle_slide': {
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
    case 'whip_pan': {
      // Fast directional whip: short high-velocity slide + scale punch +
      // motion streak. Shorter travel than slide (60% vs 100%) with an
      // ease-in attack so it reads as a whip, not a glide.
      const x = interpolate(frame, [0, transFrames], [60, 0], {
        ...clampBoth,
        easing: Easing.in(Easing.quad),
      });
      const scale = interpolate(frame, [0, transFrames], [1.18, 1], {
        ...clampBoth,
        easing: Easing.out(Easing.cubic),
      });
      const opacity = interpolate(frame, [0, Math.min(6, transFrames)], [MIN_OPACITY, 1], clampBoth);
      style = { ...style, transform: `translateX(${x}%) scale(${scale})`, opacity };
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
    case 'crossfade':
    case 'dissolve': {
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
  // Hooks must stay above any early return — same mounted instance can gain
  // or lose emphasis via the editor while preview stays mounted, which would
  // otherwise throw "Rendered more/fewer hooks than expected" and crash the
  // Player error boundary (exactly the video-cut crash reported).
  // Fix 8: precompute windows once per emphasis identity; skip marks whose
  // window doesn't contain frame (no interpolate calls for idle marks).
  const windows = React.useMemo(() => (emphasis || [])
    .filter((m) => m && typeof m.at === 'number')
    .map((m) => {
      const peak = Math.min(1.6, Math.max(1.02, typeof m.scale === 'number' ? m.scale : 1.12));
      const dur = Math.min(2, Math.max(0.2, typeof m.duration === 'number' ? m.duration : 0.5));
      const startF = Math.max(0, Math.round(m.at * fps));
      const durF = Math.max(2, Math.round(dur * fps));
      return { startF, durF, peak };
    }), [emphasis, fps]);
  let total = 1;
  for (const w of windows) {
    if (frame < w.startF || frame > w.startF + w.durF) continue;
    const attack = interpolate(frame, [w.startF, w.startF + w.durF * 0.35], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    const release = interpolate(frame, [w.startF + w.durF * 0.35, w.startF + w.durF], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.ease),
    });
    total *= 1 + (w.peak - 1) * attack * (1 - release);
  }
  // Always render the same wrapper div: swapping div <-> fragment when a mark
  // window starts/ends used to unmount + remount loaded <Video>/<Img> mid-cut
  // (same flash class as the transition settle bug). Idle style carries no
  // transform so pixels are identical to the old fragment path.
  if (total === 1) {
    return <div style={{ width: '100%', height: '100%' }}>{children}</div>;
  }
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

/**
 * Export-time font injector. Headless Chromium renders the prebuilt bundle,
 * which never sees the editor document's injected <link> font tags — without
 * this, export falls back to system fonts with different metrics (the
 * Devanagari clipping / preview≠export drift). Injects the backend-supplied
 * self-contained stylesheet and holds the frame (delayRender) until
 * document.fonts is ready, with a 5s failsafe so rendering can never hang.
 */
const FontLoader: React.FC<{ css?: string }> = ({ css }) => {
  // Handle is created per css value inside the effect (never during render,
  // so StrictMode double-render can't leak a hold): a css swap settles the
  // old hold in cleanup and takes a fresh one until fonts are ready again.
  useEffect(() => {
    const handle = delayRender('font-loader');
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        continueRender(handle);
      }
    };
    if (css) {
      const existing = document.querySelector('style[data-export-fonts]');
      if (existing) {
        existing.textContent = css;
      } else {
        const el = document.createElement('style');
        el.setAttribute('data-export-fonts', '1');
        el.textContent = css;
        document.head.appendChild(el);
      }
      try {
        const ready = (document as any).fonts?.ready;
        if (ready && typeof ready.then === 'function') {
          ready.then(finish).catch(finish);
        } else {
          finish();
        }
      } catch {
        finish();
      }
    } else {
      finish();
    }
    const failsafe = setTimeout(finish, 5000);
    return () => {
      clearTimeout(failsafe);
      finish(); // never leak a hold on unmount / css swap
    };
  }, [css]);
  return null;
};

export const NitishRajputComposition: React.FC<Props> = ({
  audioUrl,
  bgMusicUrl,
  bgMusicVolume = 0.2,
  musicClips = [],
  sfxClips = [],
  sfxVolume = 0.5,
  voiceoverVolume = 1.0,

  scenes,
  transcription,
  style = 'nitish_rajput',
  subtitleSettings = {},
  designSystem,
  overlays = [],
  qualityMode,
  quality,
  __file_server_port__,
  fontCssInline = ''
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

      {/* 5. Film Grain / Paper Overlay — managed in Global Overlays tab.
          Legacy projects without a film_grain item keep the classic look
          (default ON). Add + disable the Film Grain overlay to remove it.
          Scene/cut visuals stay in AstGraphicalEditor; global overlays are
          manual-only (no AI tool writes overlays[]). */}
      {!(overlays || []).some((o: any) => o?.type === 'film_grain') && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 110, pointerEvents: 'none' }}>
          {/* Fix 11: drop fullscreen color-burn sepia in preview (export keeps it). */}
          <PaperOverlay hideSepia={qualityMode === 'preview'} />
        </div>
      )}
    </>
  );

  return (
    <div style={{ flex: 1, backgroundColor: '#0c0a09', position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      <FontLoader css={fontCssInline} />
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
          {sfxClips && sfxClips.length > 0 && sfxClips.map((clip) => {
            if (!clip.audio_url || clip.is_muted) return null;
            const startFrame = Math.max(0, Math.round(clip.start_frame || 0));
            const durationFrames = Math.max(1, Math.round(clip.duration_frames || 30));
            const fadeInFrames = Math.round((clip.fade_in_seconds || 0) * 30);
            const fadeOutFrames = Math.round((clip.fade_out_seconds || 0) * 30);
            const startFromFrame = Math.round((clip.source_start_seconds || 0) * 30);
            const clipVolume = Math.max(0, (clip.volume ?? 0.5) * (sfxVolume !== undefined ? sfxVolume / 0.5 : 1));
            return (
              <Sequence key={`sfx-${clip.id}`} from={startFrame} durationInFrames={durationFrames} premountFor={30}>
                <DynamicFadeAudio
                  src={clip.audio_url}
                  clipDurationFrames={durationFrames}
                  baseVolume={clipVolume}
                  startFromFrame={startFromFrame}
                  fadeInFrames={fadeInFrames}
                  fadeOutFrames={fadeOutFrames}
                  loop={!!clip.loop}
                />
              </Sequence>
            );
          })}
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
