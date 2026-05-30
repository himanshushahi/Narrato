import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { Transcription, TranscriptionWord } from './NitishRajputComposition';

interface Props {
  transcription: Transcription;
  styleType?: string;
}

export const KineticSubtitles: React.FC<Props> = ({ transcription, styleType = 'nitish_rajput' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // 1. Locate active spoken segment at current time
  const activeSegment = transcription.segments.find(
    (seg) => currentTime >= seg.start && currentTime <= seg.end
  );

  if (!activeSegment) return null;

  const words = activeSegment.words || [];

  // If whisper segment has no word-level timestamps, fallback to showing full text
  if (words.length === 0) {
    return (
      <div style={{
        position: 'absolute',
        bottom: 120,
        left: '5%',
        right: '5%',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 8,
        pointerEvents: 'none'
      }}>
        <div style={{
          fontFamily: 'Montserrat, sans-serif',
          fontWeight: 800,
          fontSize: 48,
          color: '#ffffff',
          textAlign: 'center',
          textShadow: '0px 4px 10px rgba(0,0,0,0.9), 0px 0px 4px rgba(0,0,0,1)',
          lineHeight: 1.3
        }}>
          {activeSegment.text}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 120,
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
        gap: '12px 18px',
        maxWidth: 1200
      }}>
        {words.map((wordObj, i) => {
          const isActive = currentTime >= wordObj.start && currentTime <= wordObj.end;
          
          // Calculate frames elapsed since this word became active
          const wordStartFrame = Math.floor(wordObj.start * fps);
          const activeFrames = frame - wordStartFrame;

          // Spring bounce animation on word activation
          let scale = 1.0;
          if (isActive && activeFrames >= 0) {
            const springVal = spring({
              frame: activeFrames,
              fps,
              config: { damping: 9, mass: 0.25, stiffness: 120 }
            });
            scale = 1.0 + springVal * 0.18; // Bounce from 1.0 to 1.18
          }

          // Nitish Rajput style highlights:
          // Active word is bright amber-yellow, glowing text-shadow, uppercase
          // Inactive word is white or stonewhite
          const color = isActive ? '#fbbf24' : '#f5f5f4';
          const textShadow = isActive 
            ? '0 0 15px rgba(251, 191, 36, 0.4), 0px 4px 12px rgba(0,0,0,0.9)'
            : '0px 4px 12px rgba(0,0,0,0.9), 0px 2px 4px rgba(0,0,0,0.8)';

          return (
            <span
              key={i}
              style={{
                fontFamily: 'Montserrat, sans-serif',
                fontWeight: 900,
                fontSize: 54,
                color: color,
                textTransform: 'uppercase',
                textShadow: textShadow,
                transform: `scale(${scale})`,
                transition: 'color 0.08s ease-out',
                display: 'inline-block'
              }}
            >
              {wordObj.word.trim()}
            </span>
          );
        })}
      </div>
    </div>
  );
};
