import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Transcription, TranscriptionWord, SceneTiming } from './NitishRajputComposition';

interface Props {
  transcription: Transcription;
  sceneTimings?: SceneTiming[];
  styleType?: string;
  subtitleSettings?: any;
}

/** Sentence boundary punctuation for Hindi and English */
const SENTENCE_END_REGEX = /[।\.\|\?\!]/;

/**
 * Splits a list of words into sentence-level groups based on punctuation markers.
 * A sentence ends when a word ends with ।, ., |, ?, !, or , (comma used as clause separator).
 * Each group gets its own start/end time from its constituent words.
 */
interface SentenceGroup {
  words: TranscriptionWord[];
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * Binary search for the sentence active at `time`. Sentences are sorted by
 * startTime and contiguous (endTime forced to next startTime in post-processing),
 * so O(log n) replaces the per-frame linear scan over thousands of sentences.
 */
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
  let currentGroup: TranscriptionWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentGroup.push(word);

    const trimmedWord = word.word.trim();
    // Check if this word ends a sentence (ends with sentence-ending punctuation)
    const endsWithPunctuation = SENTENCE_END_REGEX.test(trimmedWord.charAt(trimmedWord.length - 1));
    // Also check if comma acts as a clause boundary (only if we have enough words for a reasonable chunk)
    const endsWithComma = trimmedWord.endsWith(',') && currentGroup.length >= 4;

    // Detect silence gaps
    let hasLargeSilenceGap = false;
    let hasSmallGap = false;
    if (i < words.length - 1) {
      const nextWord = words[i + 1];
      const gap = nextWord.start - word.end;
      if (gap > 1.2) {
        hasLargeSilenceGap = true;
      }
      if (gap > 0.25) {
        hasSmallGap = true; // Natural breathing pause
      }
    }

    const isLastWord = i === words.length - 1;
    const isTooLong = currentGroup.length >= maxWordsPerScreen;
    const isNaturalBreak = currentGroup.length >= Math.min(5, maxWordsPerScreen - 2) && hasSmallGap;

    if (endsWithPunctuation || endsWithComma || isLastWord || hasLargeSilenceGap || isTooLong || isNaturalBreak) {
      // Flush current group as a sentence
      if (currentGroup.length > 0) {
        const sentenceDuration = currentGroup[currentGroup.length - 1].end - currentGroup[0].start;
        const totalWordDuration = currentGroup.reduce((sum, w) => sum + (w.end - w.start), 0);
        const avgWordDuration = totalWordDuration / currentGroup.length;
        
        let isValidTimings = true;
        // If a "word" takes > 3.0 seconds on average, it's likely a whole phrase lumped together
        if (avgWordDuration > 3.0) isValidTimings = false;
        // If the spoken words account for less than 15% of the sentence duration, it's probably hallucinated gaps
        if (sentenceDuration > 2.0 && totalWordDuration / sentenceDuration < 0.15) isValidTimings = false;

        sentences.push({
          words: isValidTimings ? [...currentGroup] : [],
          startTime: currentGroup[0].start,
          endTime: currentGroup[currentGroup.length - 1].end,
          text: currentGroup.map(w => w.word.trim()).join(' ')
        });
        currentGroup = [];
      }
    }
  }

  // Safety: if there are leftover words (shouldn't happen due to isLastWord check)
  if (currentGroup.length > 0) {
    sentences.push({
      words: [...currentGroup],
      startTime: currentGroup[0].start,
      endTime: currentGroup[currentGroup.length - 1].end,
      text: currentGroup.map(w => w.word.trim()).join(' ')
    });
  }

  return sentences;
}

/**
 * Splits raw text (no word timestamps) into sentence chunks for display.
 * Distributes time evenly across sentences within the given time range.
 */
function splitTextIntoTimedSentences(text: string, start: number, end: number, wordsPerScreen: number): SentenceGroup[] {
  // Split on sentence-ending punctuation, keeping the delimiter
  let rawParts = text.split(/(?<=[।\.\|\?\!\,])\s*/);
  let parts = rawParts.filter(p => p.trim().length > 0);

  // If there's no punctuation and the text is very long, artificially split it into chunks
  if (parts.length === 1 && parts[0].split(' ').length > wordsPerScreen) {
    const words = parts[0].split(' ');
    const chunkedParts = [];
    for (let i = 0; i < words.length; i += wordsPerScreen) {
      chunkedParts.push(words.slice(i, i + wordsPerScreen).join(' '));
    }
    parts = chunkedParts;
  }

  if (parts.length === 0) return [];

  const totalDuration = end - start;
  // Weight each part by character length for proportional timing
  const totalChars = parts.reduce((sum, p) => sum + p.length, 0);

  let offset = start;
  return parts.map(part => {
    const ratio = part.length / totalChars;
    const duration = totalDuration * ratio;
    const sentenceStart = offset;
    const sentenceEnd = offset + duration;
    offset = sentenceEnd;

    return {
      words: [], // No word-level timestamps for text-based fallback
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
  subtitleSettings = {}
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const wordsPerScreen = subtitleSettings.wordsPerScreen ?? 10;

  // Pre-compute all sentence groups from transcription segments
  const allSentences = useMemo(() => {
    const sentences: SentenceGroup[] = [];
    for (const seg of transcription.segments) {
      if (seg.words && seg.words.length > 0) {
        const groups = splitWordsIntoSentences(seg.words, wordsPerScreen);
        sentences.push(...groups);
      } else {
        // Segment with no word timestamps: split text into timed sentences
        const groups = splitTextIntoTimedSentences(seg.text, seg.start, seg.end, wordsPerScreen);
        sentences.push(...groups);
      }
    }

    // Post-process to eliminate gaps and overlaps between sentences globally.
    // findSentenceAtTime binary-searches a sorted, non-overlapping timeline —
    // sort first, or an unsorted/overlapping list makes the search silently
    // miss sentences (subtitle lines vanish with no error).
    sentences.sort((a, b) => a.startTime - b.startTime);
    for (let j = 0; j < sentences.length - 1; j++) {
      // Force the current sentence to end exactly when the next sentence begins
      if (sentences[j].endTime > sentences[j + 1].startTime) {
        sentences[j].endTime = sentences[j + 1].startTime;
      }
    }

    return sentences;
  }, [transcription, wordsPerScreen]);

  // Pre-compute fallback sentences from scene timings (for transcription gaps)
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

  // 1. Find active sentence from transcription (primary source)
  let activeSentence = findSentenceAtTime(allSentences, currentTime);

  // 2. If no transcription sentence found, fall back to scene timing sentences ONLY if we have no transcription data
  if (!activeSentence && allSentences.length === 0 && fallbackSentences.length > 0) {
    activeSentence = findSentenceAtTime(fallbackSentences, currentTime);
  }

  if (!activeSentence) return null;

  const words = activeSentence.words;
  const effectiveBackgroundStyle = subtitleSettings.backgroundStyle || (subtitleSettings.showBackgroundHighlight !== false ? 'highlight' : 'none');
  const fullBgColor = subtitleSettings.fullBgColor || 'rgba(0,0,0,0.6)';

  // === TEXT-ONLY FALLBACK (no word-level timestamps) ===
  if (words.length === 0) {
    // Fade-in animation
    const sentenceStartFrame = Math.floor(activeSentence.startTime * fps);
    const localFrame = frame - sentenceStartFrame;
    const fadeIn = interpolate(localFrame, [0, 8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });

    return (
      <div style={{
        position: 'absolute',
        bottom: 120,
        left: '5%',
        right: '5%',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 8,
        pointerEvents: 'none',
        opacity: fadeIn
      }}>
        <div style={{
          fontFamily: subtitleSettings.fontFamily ? `"${subtitleSettings.fontFamily}", sans-serif` : 'Montserrat, sans-serif',
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

  // === WORD-LEVEL KINETIC RENDERING (one sentence at a time) ===
  return (
    <div style={{
      position: 'absolute',
      bottom: subtitleSettings.bottomOffset !== undefined ? subtitleSettings.bottomOffset : 120,
      left: '10%',
      right: '10%',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 8,
      pointerEvents: 'none'
    }}>
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
          // Extend this word's highlight until the next word starts to eliminate gaps
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
          const activeColor = subtitleSettings.activeColor || '#fbbf24';
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
                  fontFamily: subtitleSettings.fontFamily ? `"${subtitleSettings.fontFamily}", sans-serif` : 'Montserrat, sans-serif',
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
