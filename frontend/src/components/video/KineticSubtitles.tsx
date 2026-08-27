import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Transcription, TranscriptionWord, SceneTiming } from './NitishRajputComposition';

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

export const KineticSubtitles: React.FC<Props> = ({ 
  transcription, 
  sceneTimings = [],
  styleType: _styleType = 'nitish_rajput',
  subtitleSettings = {},
  subtitleDisplacements = [],
  designSystem
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Determine dynamic subtitle placement (bottom, top, or hidden) for the current frame
  const currentDisplacement = useMemo<'bottom' | 'top' | 'hidden'>(() => {
    if (!subtitleDisplacements || subtitleDisplacements.length === 0) return 'bottom';
    for (const d of subtitleDisplacements) {
      if (frame >= d.startFrame && frame < d.endFrame) {
        return d.position || 'bottom';
      }
    }
    return 'bottom';
  }, [subtitleDisplacements, frame]);

  const wordsPerScreen = subtitleSettings.wordsPerScreen ?? 10;

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
  const effectiveBackgroundStyle = subtitleSettings.backgroundStyle || (subtitleSettings.showBackgroundHighlight !== false ? 'highlight' : 'none');
  const fullBgColor = subtitleSettings.fullBgColor || 'rgba(0,0,0,0.6)';

  // Design system token fallbacks.
  // For complex-script languages (Hindi, Tamil, Arabic, etc.) we must never
  // fall back to a Latin-only font — doing so renders Devanagari/Tamil/Arabic
  // glyphs as tofu boxes. Use the language stored in the design system's
  // _language metadata to pick the correct Noto family when typography is absent.
  const NOTO_FONT_MAP: Record<string, string> = {
    hi: 'Noto Sans Devanagari', mr: 'Noto Sans Devanagari',
    bn: 'Noto Sans Bengali',    ta: 'Noto Sans Tamil',
    te: 'Noto Sans Telugu',     ar: 'Noto Sans Arabic',
    th: 'Noto Sans Thai',       gu: 'Noto Sans Gujarati',
    pa: 'Noto Sans Gurmukhi',   ml: 'Noto Sans Malayalam',
    kn: 'Noto Sans Kannada',
  };
  const projectLang: string = designSystem?._language || '';
  const complexScriptFallback = NOTO_FONT_MAP[projectLang] || 'Inter';
  const themeFont = designSystem?.typography?.heading_font || designSystem?.typography?.body_font || complexScriptFallback;
  const themeAccent = designSystem?.color_palette?.accent || designSystem?.color_palette?.primary || '#fbbf24';
  const effectiveFontFamily = subtitleSettings.fontFamily ? `"${subtitleSettings.fontFamily}", sans-serif` : `"${themeFont}", sans-serif`;

  const isTopPosition = currentDisplacement === 'top';
  const positionStyles: React.CSSProperties = isTopPosition ? {
    position: 'absolute',
    top: subtitleSettings.topOffset !== undefined ? subtitleSettings.topOffset : 100,
    bottom: 'auto',
    left: '5%',
    right: '5%',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 8,
    pointerEvents: 'none',
    transition: 'top 0.3s ease-out'
  } : {
    position: 'absolute',
    bottom: subtitleSettings.bottomOffset !== undefined ? subtitleSettings.bottomOffset : 120,
    top: 'auto',
    left: '5%',
    right: '5%',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 8,
    pointerEvents: 'none',
    transition: 'bottom 0.3s ease-out'
  };

  if (words.length === 0) {
    const sentenceStartFrame = Math.floor(activeSentence.startTime * fps);
    const localFrame = frame - sentenceStartFrame;
    const fadeIn = interpolate(localFrame, [0, 8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });

    return (
      <div style={{ ...positionStyles, opacity: fadeIn }}>
        <div style={{
          fontFamily: effectiveFontFamily,
          fontWeight: subtitleSettings.fontWeight || 800,
          fontSize: subtitleSettings.fontSize || 48,
          color: subtitleSettings.futureColor || '#ffffff',
          textAlign: 'center',
          textShadow: '0px 4px 10px rgba(0,0,0,0.9), 0px 0px 4px rgba(0,0,0,1)',
          lineHeight: 1.3,
          maxWidth: 1200,
          wordSpacing: subtitleSettings.wordSpacing !== undefined ? subtitleSettings.wordSpacing : 0,
          textTransform: subtitleSettings.textTransform || 'none',
          backgroundColor: effectiveBackgroundStyle === 'full_block' ? fullBgColor : 'transparent',
          padding: effectiveBackgroundStyle === 'full_block' ? '20px 40px' : '0',
          borderRadius: effectiveBackgroundStyle === 'full_block' ? '12px' : '0'
        }}>
          {activeSentence.text}
        </div>
      </div>
    );
  }

  return (
    <div style={positionStyles}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: `12px ${subtitleSettings.wordSpacing !== undefined ? subtitleSettings.wordSpacing : 18}px`,
        maxWidth: 1200,
        backgroundColor: effectiveBackgroundStyle === 'full_block' ? fullBgColor : 'transparent',
        padding: effectiveBackgroundStyle === 'full_block' ? '20px 40px' : '0',
        borderRadius: effectiveBackgroundStyle === 'full_block' ? '12px' : '0'
      }}>
        {words.map((wordObj, i) => {
          const nextWord = words[i + 1];
          const effectiveEnd = nextWord ? nextWord.start : activeSentence.endTime;
          const isActive = currentTime >= wordObj.start && currentTime < effectiveEnd;
          // Word is "past" if current time has moved beyond it
          const isPast = currentTime >= effectiveEnd;
          
          // Calculate frames elapsed since this word became active
          const wordStartFrame = Math.floor(wordObj.start * fps);
          const activeFrames = frame - wordStartFrame;

          // Animation on word activation
          let scale = 1.0;
          let translateY = 0;

          if (isActive && activeFrames >= 0) {
            const animType = subtitleSettings.activeAnimation || 'bounce';
            
            if (animType === 'bounce') {
              const springVal = spring({
                frame: activeFrames,
                fps,
                config: { damping: 9, mass: 0.25, stiffness: 120 }
              });
              scale = 1.0 + springVal * 0.18; // Bounce from 1.0 to 1.18
            } else if (animType === 'pop') {
              const springVal = spring({
                frame: activeFrames,
                fps,
                config: { damping: 12, mass: 0.4, stiffness: 180 }
              });
              scale = 0.5 + springVal * 0.7; // Start at 0.5, pop to 1.2
            } else if (animType === 'jump') {
              const springVal = spring({
                frame: activeFrames,
                fps,
                config: { damping: 10, mass: 0.3, stiffness: 150 }
              });
              translateY = -15 * springVal * (1 - Math.min(1, activeFrames / (fps * 0.4))); // Jump up and fall back
              scale = 1.0 + springVal * 0.1;
            }
          }

          // Nitish Rajput style highlights:
          // Active word: bright amber-yellow with glow
          // Past words: dimmed stone white
          // Future words: standard white
          const activeColor = subtitleSettings.activeColor || themeAccent;
          const pastColor = subtitleSettings.pastColor || '#d6d3d1';
          const futureColor = subtitleSettings.futureColor || '#f5f5f4';
          
          const color = isActive ? activeColor : isPast ? pastColor : futureColor;
          
          // Hex to rgba helper for shadow glow
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16) || 251;
            const g = parseInt(hex.slice(3, 5), 16) || 191;
            const b = parseInt(hex.slice(5, 7), 16) || 36;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };
          
          const textShadow = isActive 
            ? `0 0 15px ${hexToRgba(activeColor, 0.4)}, 0px 4px 12px rgba(0,0,0,0.9)`
            : '0px 4px 12px rgba(0,0,0,0.9), 0px 2px 4px rgba(0,0,0,0.8)';

          return (
            <span
              key={i}
              style={{
                position: 'relative',
                display: 'inline-block'
              }}
            >
              {/* Highlighter Background */}
              {(isPast || isActive) && effectiveBackgroundStyle === 'highlight' ? (
                <span style={{
                  position: 'absolute',
                  left: -2,
                  right: -2,
                  bottom: 2,
                  height: '40%',
                  backgroundColor: hexToRgba(subtitleSettings.highlightBgColor || activeColor, 0.4),
                  transformOrigin: 'left center',
                  transform: `scaleX(${isPast ? 1 : interpolate(activeFrames, [0, 5], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })})`,
                  zIndex: -1,
                  borderRadius: 2
                }} />
              ) : null}
              <span
                style={{
                  fontFamily: effectiveFontFamily,
                  fontWeight: subtitleSettings.fontWeight || 900,
                  fontSize: subtitleSettings.fontSize || 54,
                  color: color,
                  textTransform: subtitleSettings.textTransform || 'uppercase',
                  textShadow: textShadow,
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  transition: 'color 0.08s ease-out, transform 0.1s ease-out',
                  display: 'inline-block',
                  position: 'relative',
                  zIndex: 1
                }}
              >
                {wordObj.word.trim()}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
