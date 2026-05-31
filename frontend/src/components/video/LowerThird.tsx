import React from 'react';
import { useCurrentFrame, spring, useVideoConfig } from 'remotion';

interface Props {
  title: string;
  subtitle?: string;
  durationInFrames: number;
}

export const LowerThird: React.FC<Props> = ({ title, subtitle, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animate in
  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 }
  });

  // Animate out (starts 15 frames before the end)
  const exitFrame = durationInFrames - 15;
  const exit = spring({
    frame: Math.max(0, frame - exitFrame),
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 }
  });

  // Calculate final position
  // Starts at -100% (offscreen left), slides in to 0%, slides out to -100%
  const translateX = entrance === 1 ? -100 * exit : -100 * (1 - entrance);

  if (!title) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 280,
      left: 60,
      transform: `translateX(${translateX}%)`,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20
    }}>
      {/* Decorative accent line */}
      <div style={{
        width: '100%',
        height: 6,
        backgroundColor: '#fbbf24',
        boxShadow: '0 0 10px rgba(251, 191, 36, 0.5)'
      }} />
      
      {/* Glassmorphism Card */}
      <div style={{
        backgroundColor: 'rgba(28, 25, 23, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '20px 40px',
        borderLeft: '4px solid #b45309',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '10px 15px 30px rgba(0,0,0,0.6)'
      }}>
        <h2 style={{
          fontFamily: 'Montserrat, sans-serif',
          fontWeight: 900,
          fontSize: 42,
          color: '#fef3c7',
          margin: 0,
          textTransform: 'uppercase',
          letterSpacing: 2,
          textShadow: '0 2px 4px rgba(0,0,0,0.8)'
        }}>
          {title}
        </h2>
        
        {subtitle && (
          <p style={{
            fontFamily: 'Merriweather, serif',
            fontWeight: 400,
            fontSize: 24,
            color: '#d6d3d1',
            margin: '8px 0 0 0',
            letterSpacing: 1
          }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};
