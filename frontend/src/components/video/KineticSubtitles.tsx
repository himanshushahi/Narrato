import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Transcription, TranscriptionWord, SceneTiming } from './NitishRajputComposition';
import { NOTO_FONT_MAP } from './complexScriptFonts';
import { withSubtitleDefaults } from '../../utils/subtitleSchema';

interface SubtitleDisplacement {
  startFrame: number;
  endFrame: number;
  position?: 'bottom' | 'top' | 'hidden';
}

interface Props {
  transcription: Transcription;
  sceneTimings?: SceneTiming[];
  styleType?: string;
  subtitleSettings?: any;
  subtitleDisplacements?: SubtitleDisplacement[];
  designSystem?: any;
}

/** Sentence boundary punctuation for Hindi and English */
const SENTENCE_END_REGEX = /[।\.\|\?\!]/;

// Accepts #rrggbb, #rgb, and rgb()/rgba() strings (the settings color
// input allows all three); unknown shapes fall back to amber.
function hexToRgba(hex: string, alpha: number): string {
  if (!hex || typeof hex !== 'string') return `rgba(251, 191, 36, ${alpha})`;
  const s = hex.trim();
  if (/^rgba?\(/i.test(s)) return s;
  if (s[0] !== '#') return `rgba(251, 191, 36, ${alpha})`;
  let r: number, g: number, b: number;
  if (s.length === 4) {
    r = parseInt(s[1] + s[1], 16);
    g = parseInt(s[2] + s[2], 16);
    b = parseInt(s[3] + s[3], 16);
  } else {
    r = parseInt(s.slice(1, 3), 16);
    g = parseInt(s.slice(3, 5), 16);
    b = parseInt(s.slice(5, 7), 16);
  }
  return `rgba(${Number.isFinite(r) ? r : 251}, ${Number.isFinite(g) ? g : 191}, ${Number.isFinite(b) ? b : 36}, ${alpha})`;
}

// Springs settle to ~1 within ~20 frames; beyond that skip spring() call.
const SPRING_SETTLE_FRAMES = 20;

interface SentenceGroup {
  words: TranscriptionWord[];
  startTime: number;
  endTime: number;
  text: string;
}

function findSentenceAtTime(sentences: SentenceGroup[], time: number): SentenceGroup | undefined {
  let low = 0;
  let high = sentences.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const sentence = sentences[mid];
    if (time < sentence.startTime) {
      high = mid - 1;
    } else if (time >= sentence.endTime) {
      low = mid + 1;
    } else {
      return sentence;
    }
  }
  return undefined;
}

function splitWordsIntoSentences(words: TranscriptionWord[], maxWordsPerScreen: number): SentenceGroup[] {
  if (words.length === 0) return [];
  const sentences: SentenceGroup[] = [];
  let currentWords: TranscriptionWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const wordObj = words[i];
    currentWords.push(wordObj);

    const isLastWord = i === words.length - 1;
    const endsWithPunctuation = SENTENCE_END_REGEX.test(wordObj.word.trim());
    const exceedsMaxWords = currentWords.length >= maxWordsPerScreen;

    if (endsWithPunctuation || exceedsMaxWords || isLastWord) {
      const startTime = currentWords[0].start;
      const endTime = currentWords[currentWords.length - 1].end;
      const text = currentWords.map(w => w.word).join(' ');

      sentences.push({
        words: [...currentWords],
        startTime,
        endTime,
        text
      });
      currentWords = [];
    }
  }

  return sentences;
}

/**
 * Fallback: splits plain text into estimated-time sentence groups
 * when whisper has no word-level timestamps (only segment start/end).
 */
function splitTextIntoTimedSentences(text: string, start: number, end: number, maxWordsPerScreen: number): SentenceGroup[] {
  if (!text || !text.trim()) return [];
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [];

  const parts: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const isPunct = SENTENCE_END_REGEX.test(words[i]);
    const isFull = cur.length >= maxWordsPerScreen;
    const isLast = i === words.length - 1;
    if (isPunct || isFull || isLast) {
      parts.push(cur.join(' '));
      cur = [];
    }
  }

  const totalDuration = end - start;
  const totalChars = parts.reduce((sum, p) => sum + p.length, 0);

  let offset = start;
  return parts.map(part => {
    const ratio = totalChars > 0 ? part.length / totalChars : 1 / parts.length;
    const duration = totalDuration * ratio;
    const sentenceStart = offset;
    const sentenceEnd = offset + duration;
    offset = sentenceEnd;

    return {
      words: [],
      startTime: sentenceStart,
      endTime: sentenceEnd,
      text: part.trim()
    };
  });
}
/** Split words into two char-balanced lines for the stack layout. */
function splitBalancedLines(words: TranscriptionWord[]): TranscriptionWord[][] {
  if (words.length <= 1) return [words];
  const total = words.reduce((s, w) => s + w.word.trim().length, 0);
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].word.trim().length;
    if (acc >= total / 2) {
      cut = i + 1;
      break;
    }
  }
  return [words.slice(0, cut), words.slice(cut)];
}

interface WordMotion {
  scale: number;
  translateY: number;
  rotate: number;
  opacity: number;
}

/** Cheap arithmetic easings (no spring cost) for the fast viral animations. */
function easeOutCubic(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function computeWordMotion(animType: string, activeFrames: number, fps: number, settled: boolean): WordMotion {
  const base: WordMotion = { scale: 1, translateY: 0, rotate: 0, opacity: 1 };
  if (animType === 'none' || activeFrames < 0) return base;
  if (animType === 'bounce') {
    const springVal = settled ? 1 : spring({
      frame: activeFrames,
      fps,
      config: { damping: 9, mass: 0.25, stiffness: 120 }
    });
    base.scale = 1.0 + springVal * 0.18; // Bounce from 1.0 to 1.18
    return base;
  }
  if (animType === 'pop') {
    const springVal = settled ? 1 : spring({
      frame: activeFrames,
      fps,
      config: { damping: 12, mass: 0.4, stiffness: 180 }
    });
    base.scale = 0.5 + springVal * 0.7; // Start at 0.5, pop to 1.2
    return base;
  }
  if (animType === 'jump') {
    if (settled) {
      // Asymptote match: spring -> 1 gives scale 1.1, and the
      // (1 - min(1, ...)) decay drives translateY -> 0. Snapping to
      // 1.0 here caused a visible ~10% shrink at frame 21.
      base.scale = 1.1;
      return base;
    }
    const springVal = spring({
      frame: activeFrames,
      fps,
      config: { damping: 10, mass: 0.3, stiffness: 150 }
    });
    base.translateY = -15 * springVal * (1 - Math.min(1, activeFrames / (fps * 0.4))); // Jump up and fall back
    base.scale = 1.0 + springVal * 0.1;
    return base;
  }
  if (animType === 'slide') {
    const p = easeOutCubic(activeFrames / 8);
    base.translateY = 26 * (1 - p);
    base.opacity = p;
    return base;
  }
  if (animType === 'fade') {
    const p = easeOutCubic(activeFrames / 6);
    base.opacity = 0.15 + 0.85 * p;
    base.scale = 0.96 + 0.04 * p;
    return base;
  }
  if (animType === 'scale') {
    base.scale = 0.5 + 0.5 * easeOutBack(activeFrames / 10);
    return base;
  }
  if (animType === 'tilt') {
    const springVal = settled ? 1 : spring({
      frame: activeFrames,
      fps,
      config: { damping: 11, mass: 0.35, stiffness: 160 }
    });
    base.rotate = -12 * (1 - springVal);
    base.scale = 0.85 + springVal * 0.15;
    return base;
  }
  return base;
}

export const KineticSubtitles: React.FC<Props> = ({
  transcription,
  sceneTimings = [],
  styleType: _styleType = 'nitish_rajput',
  subtitleSettings = {},
  subtitleDisplacements = [],
  designSystem
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const currentTime = frame / fps;

  // Tri-state: null = no per-cut override on this frame, so the user's
  // position preset applies. An explicit per-cut 'bottom' must beat a
  // preset top/center — a plain 'bottom' default here would lose that.
  const currentDisplacement = useMemo<'bottom' | 'top' | 'hidden' | null>(() => {
    if (!subtitleDisplacements || subtitleDisplacements.length === 0) return null;
    for (const d of subtitleDisplacements) {
      if (frame >= d.startFrame && frame < d.endFrame) {
        return d.position || 'bottom';
      }
    }
    return null;
  }, [subtitleDisplacements, frame]);

  // Single source of truth — schema defaults, user settings on top.
  const s = useMemo(() => withSubtitleDefaults(subtitleSettings), [subtitleSettings]);
  const wordsPerScreen: number = s.wordsPerScreen;

  const allSentences = useMemo(() => {
    const sentences: SentenceGroup[] = [];
    for (const seg of transcription.segments) {
      if (seg.words && seg.words.length > 0) {
        const groups = splitWordsIntoSentences(seg.words, wordsPerScreen);
        sentences.push(...groups);
      } else {
        const groups = splitTextIntoTimedSentences(seg.text, seg.start, seg.end, wordsPerScreen);
        sentences.push(...groups);
      }
    }

    sentences.sort((a, b) => a.startTime - b.startTime);
    for (let j = 0; j < sentences.length - 1; j++) {
      if (sentences[j].endTime > sentences[j + 1].startTime) {
        sentences[j].endTime = sentences[j + 1].startTime;
      }
    }

    return sentences;
  }, [transcription, wordsPerScreen]);

  const fallbackSentences = useMemo(() => {
    const sentences: SentenceGroup[] = [];
    for (const scene of sceneTimings) {
      if (scene.text) {
        const groups = splitTextIntoTimedSentences(scene.text, scene.start, scene.end, wordsPerScreen);
        sentences.push(...groups);
      }
    }
    sentences.sort((a, b) => a.startTime - b.startTime);
    return sentences;
  }, [sceneTimings, wordsPerScreen]);

  // If active sub-visual declared subtitles hidden, suppress rendering
  if (currentDisplacement === 'hidden') return null;

  let activeSentence = findSentenceAtTime(allSentences, currentTime);
  if (!activeSentence && allSentences.length === 0 && fallbackSentences.length > 0) {
    activeSentence = findSentenceAtTime(fallbackSentences, currentTime);
  }

  if (!activeSentence) return null;

  const words = activeSentence.words;

  // Design system token fallbacks.
  // For complex-script languages (Hindi, Tamil, Arabic, etc.) we must never
  // fall back to a Latin-only font — doing so renders Devanagari/Tamil/Arabic
  // glyphs as tofu boxes. Use the language stored in the design system's
  // _language metadata to pick the correct Noto family when typography is absent.
  // (Map lives in complexScriptFonts.ts — shared with Text layers and export.)
  const projectLang: string = designSystem?._language || '';
  const complexScriptFallback = NOTO_FONT_MAP[projectLang] || 'Inter';
  const themeFont = designSystem?.typography?.heading_font || designSystem?.typography?.body_font || complexScriptFallback;
  const themeAccent = designSystem?.color_palette?.accent || designSystem?.color_palette?.primary || '#fbbf24';
  const effectiveFontFamily = s.fontFamily ? `"${s.fontFamily}", sans-serif` : `"${themeFont}", sans-serif`;

  // Per-cut displacement wins; otherwise the user's position preset applies.
  // (null = no override on this frame, including an explicit per-cut bottom.)
  const anchor: 'bottom' | 'center' | 'top' =
    currentDisplacement === 'top'
      ? 'top'
      : currentDisplacement === 'bottom'
        ? 'bottom'
        : (s.position === 'center' ? 'center' : s.position === 'top' ? 'top' : 'bottom');
  const positionStyles: React.CSSProperties = anchor === 'top' ? {
    position: 'absolute',
    top: s.topOffset,
    bottom: 'auto',
    left: '5%',
    right: '5%',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 8,
    pointerEvents: 'none',
    transition: 'none'
  } : anchor === 'center' ? {
    position: 'absolute',
    top: '50%',
    bottom: 'auto',
    left: '5%',
    right: '5%',
    display: 'flex',
    justifyContent: 'center',
    transform: 'translateY(-50%)',
    zIndex: 8,
    pointerEvents: 'none',
    transition: 'none'
  } : {
    position: 'absolute',
    bottom: s.bottomOffset,
    top: 'auto',
    left: '5%',
    right: '5%',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 8,
    pointerEvents: 'none',
    transition: 'none'
  };

  // Container width binds to the narrowest of the legacy cap and the frame.
  // (left/right 5% already constrain portrait; the cap only binds landscape.)
  const containerMaxWidth = Math.min(1200, Math.floor(width * 0.9));

  // Precompute colors once per render, not per word per frame (was
  // 3x parseInt x ~10 words x 30fps). Plain consts — NOT useMemo — because
  // this sits after the `return null` early returns above; hooks here would
  // throw "Rendered fewer hooks than expected" during subtitle gaps.
  const activeColor: string = s.activeColor || themeAccent;
  const highlightBase: string = s.highlightBgColor || activeColor;
  const highlightBg = hexToRgba(highlightBase, 0.4);
  const glowColor: string = s.glowColor || activeColor;
  const activeShadow = s.glowRadius > 0
    ? `0 0 ${s.glowRadius}px ${hexToRgba(glowColor, 0.45)}, 0px 4px 12px rgba(0,0,0,0.9)`
    : '0px 4px 12px rgba(0,0,0,0.9), 0px 2px 4px rgba(0,0,0,0.8)';
  const idleShadow = '0px 4px 12px rgba(0,0,0,0.9), 0px 2px 4px rgba(0,0,0,0.8)';
  const strokeWidth: number = s.strokeWidth || 0;
  const strokeStyle = strokeWidth > 0 ? `${strokeWidth}px ${s.strokeColor || '#000000'}` : undefined;
  const pillOn = s.pillStyle === 'active';
  const pillBg: string = s.pillBgColor || highlightBase;
  const pillText: string = s.pillTextColor || activeColor;
  const pastColor: string = s.pastColor;
  const futureColor: string = s.futureColor;
  const lineHeight: number = s.lineHeight || 1.25;
  const fontWeight: number = s.fontWeight || 800;
  const fontSize: number = s.fontSize || 54;

  const blockBg = s.backgroundStyle === 'full_block' ? {
    backgroundColor: s.fullBgColor,
    padding: '20px 40px',
    borderRadius: '12px',
  } : { backgroundColor: 'transparent', padding: '0', borderRadius: '0' };

  if (words.length === 0) {
    const sentenceStartFrame = Math.floor(activeSentence.startTime * fps);
    const localFrame = frame - sentenceStartFrame;
    // Settle-bail: fade is done after 8 frames, skip interpolate.
    const fadeIn = localFrame > 8 ? 1 : interpolate(localFrame, [0, 8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });

    return (
      <div style={{ ...positionStyles, opacity: fadeIn }}>
        <div style={{
          fontFamily: effectiveFontFamily,
          fontWeight,
          fontSize,
          color: futureColor,
          textAlign: 'center',
          textShadow: idleShadow,
          WebkitTextStroke: strokeStyle,
          lineHeight,
          maxWidth: containerMaxWidth,
          wordSpacing: s.wordSpacing,
          textTransform: s.textTransform,
          ...blockBg,
        }}>
          {activeSentence.text}
        </div>
      </div>
    );
  }

  // Shared per-word renderer — coloring priority:
  // active word > past/future. Pill replaces the underline
  // highlight bar on the active word so the two never stack.
  const renderWord = (wordObj: TranscriptionWord, i: number, sentence: SentenceGroup) => {
    const nextWord = sentence.words[i + 1];
    const effectiveEnd = nextWord ? nextWord.start : sentence.endTime;
    const isActive = currentTime >= wordObj.start && currentTime < effectiveEnd;
    // Word is "past" if current time has moved beyond it
    const isPast = currentTime >= effectiveEnd;

    // Calculate frames elapsed since this word became active
    const wordStartFrame = Math.floor(wordObj.start * fps);
    const activeFrames = frame - wordStartFrame;

    // Animation on word activation
    let motion: WordMotion = { scale: 1, translateY: 0, rotate: 0, opacity: 1 };
    if (isActive && activeFrames >= 0) {
      // Settle-bail: after ~20 frames springs are ~1; skip spring() cost.
      const settled = activeFrames > SPRING_SETTLE_FRAMES;
      motion = computeWordMotion(s.activeAnimation || 'bounce', activeFrames, fps, settled);
    }

    const color = isActive
      ? (pillOn ? pillText : activeColor)
      : isPast
        ? pastColor
        : futureColor;

    const textShadow = isActive ? activeShadow : idleShadow;
    const showBar = (isPast || (isActive && !pillOn && activeFrames > 5)) && s.backgroundStyle === 'highlight';

    return (
      <span
        key={i}
        style={{
          position: 'relative',
          display: 'inline-block',
          opacity: motion.opacity,
        }}
      >
        {/* Highlighter Background */}
        {showBar ? (
          <span style={{
            position: 'absolute',
            left: -2,
            right: -2,
            bottom: 2,
            height: '40%',
            backgroundColor: highlightBg,
            transformOrigin: 'left center',
            transform: `scaleX(${isPast || activeFrames > 5 ? 1 : interpolate(activeFrames, [0, 5], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })})`,
            zIndex: -1,
            borderRadius: 2
          }} />
        ) : null}
        <span
          style={{
            fontFamily: effectiveFontFamily,
            fontWeight,
            fontSize,
            color,
            textTransform: s.textTransform,
            textShadow,
            WebkitTextStroke: strokeStyle,
            transform: `translateY(${motion.translateY}px) scale(${motion.scale}) rotate(${motion.rotate}deg)`,
            transition: 'none',
            display: 'inline-block',
            position: 'relative',
            zIndex: 1,
            backgroundColor: isActive && pillOn ? pillBg : 'transparent',
            padding: isActive && pillOn ? s.pillPadding : '0',
            borderRadius: isActive && pillOn ? s.pillRadius : 0,
          }}
        >
          {wordObj.word.trim()}
        </span>
      </span>
    );
  };

  const containerGap = `12px ${s.wordSpacing}px`;

  // Karaoke: a sliding window around the active word. The window wraps
  // (never clips: nowrap sliced long words mid-glyph at the frame edge).
  // Global indexes are threaded through so end-time chaining stays exact.
  if (s.layoutMode === 'karaoke') {
    const win: number = Math.max(3, s.karaokeWindow || 5);
    let activeIdx = words.findIndex((w, i) => {
      const next = words[i + 1];
      const end = next ? next.start : activeSentence.endTime;
      return currentTime >= w.start && currentTime < end;
    });
    if (activeIdx < 0) activeIdx = 0;
    const half = Math.floor(win / 2);
    let start = words.length <= win ? 0 : Math.max(0, Math.min(activeIdx - half, words.length - win));
    const windowWords = words.slice(start, start + win);
    return (
      <div style={positionStyles}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap: containerGap,
          maxWidth: containerMaxWidth,
          lineHeight,
          ...blockBg,
        }}>
          {windowWords.map((w, k) => renderWord(w, start + k, activeSentence))}
        </div>
      </div>
    );
  }

  // Stack: two char-balanced lines for tall-format readability.
  if (s.layoutMode === 'stack') {
    const lines = splitBalancedLines(words);
    return (
      <div style={positionStyles}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          maxWidth: containerMaxWidth,
          ...blockBg,
        }}>
          {lines.map((line, li) => {
            // Global index = words before this line + index within it.
            const base = lines.slice(0, li).reduce((n, l) => n + l.length, 0);
            return (
            <div key={li} style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: containerGap,
              lineHeight,
            }}>
              {line.map((w, k) => renderWord(w, base + k, activeSentence))}
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Sentence: the full group, wrapping, centered (classic look).
  return (
    <div style={positionStyles}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: containerGap,
        maxWidth: containerMaxWidth,
        lineHeight,
        ...blockBg,
      }}>
        {words.map((wordObj, i) => renderWord(wordObj, i, activeSentence))}
      </div>
    </div>
  );
};
