import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, Img } from 'remotion';

export interface MockupProps {
  preset?: 'social_post' | 'newspaper' | 'browser' | 'document' | 'phone';
  headline?: string;
  author?: string;
  handle?: string;
  avatar_url?: string;
  date?: string;
  body?: string;
  badge?: string;
  image_url?: string;
  style?: React.CSSProperties;
}

export const MockupRenderer: React.FC<MockupProps> = ({
  preset = 'social_post',
  headline,
  author = 'Official Report',
  handle = '@verified_source',
  avatar_url,
  date = 'Just now',
  body,
  badge = 'VERIFIED',
  image_url,
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 0.9 },
  });

  const authorInitial = ((author || '').trim().charAt(0) || 'A').toUpperCase();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        transform: `scale(${entrance}) translateY(${(1 - entrance) * 30}px)`,
        opacity: entrance,
        ...style,
      }}
    >
      {/* ── Social Post Preset (Twitter / X Card) ── */}
      {preset === 'social_post' && (
        <div
          style={{
            width: '90%',
            maxWidth: '680px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '24px',
            padding: '28px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(59, 130, 246, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            color: '#ffffff',
          }}
        >
          {/* User Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '20px',
                overflow: 'hidden',
                border: '2px solid rgba(255,255,255,0.2)',
              }}
            >
              {avatar_url ? (
                <Img src={avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                authorInitial
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 800, fontSize: '18px', color: '#ffffff' }}>{author}</span>
                <span
                  style={{
                    backgroundColor: '#38bdf8',
                    color: '#0f172a',
                    fontSize: '10px',
                    fontWeight: 900,
                    padding: '1px 5px',
                    borderRadius: '4px',
                  }}
                >
                  ✓
                </span>
              </div>
              <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.5)' }}>{handle}</span>
            </div>
            {date && (
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>{date}</span>
            )}
          </div>

          {/* Headline / Body */}
          {headline && (
            <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1.35, color: '#f8fafc' }}>
              {headline}
            </div>
          )}
          {body && (
            <div style={{ fontSize: '16px', fontWeight: 400, lineHeight: 1.5, color: 'rgba(255, 255, 255, 0.85)' }}>
              {body}
            </div>
          )}

          {/* Embedded media if provided */}
          {image_url && (
            <div style={{ width: '100%', height: '200px', borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Img src={image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
        </div>
      )}

      {/* ── Browser Window Preset ── */}
      {preset === 'browser' && (
        <div
          style={{
            width: '92%',
            maxWidth: '850px',
            backgroundColor: 'rgba(18, 18, 20, 0.92)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Browser Chrome Header */}
          <div
            style={{
              height: '42px',
              backgroundColor: 'rgba(30, 30, 35, 0.8)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', gap: '7px' }}>
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <div style={{ width: '11px', height: '11px', borderRadius: '50%', backgroundColor: '#10b981' }} />
            </div>
            <div
              style={{
                flex: 1,
                maxWidth: '400px',
                height: '24px',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 12px',
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.6)',
                fontFamily: 'monospace',
              }}
            >
              🔒 {handle.startsWith('http') ? handle : `https://news.source/${handle.replace('@', '')}`}
            </div>
          </div>

          {/* Browser Content */}
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {headline && (
              <div style={{ fontSize: '26px', fontWeight: 800, color: '#ffffff', lineHeight: 1.3 }}>
                {headline}
              </div>
            )}
            {body && (
              <div style={{ fontSize: '15px', color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.6 }}>
                {body}
              </div>
            )}
            {image_url && (
              <div style={{ width: '100%', height: '240px', borderRadius: '10px', overflow: 'hidden' }}>
                <Img src={image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Newspaper Preset ── */}
      {preset === 'newspaper' && (
        <div
          style={{
            width: '88%',
            maxWidth: '720px',
            backgroundColor: '#f5f0e8',
            color: '#1c1917',
            padding: '32px',
            borderRadius: '4px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 20px rgba(245,240,232,0.1)',
            border: '2px solid #292524',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontFamily: '"Times New Roman", Times, serif',
          }}
        >
          {/* Newspaper Masthead */}
          <div style={{ borderBottom: '3px double #1c1917', paddingBottom: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 900, letterSpacing: '2px', textTransform: 'uppercase' }}>
              {author || 'THE DAILY CHRONICLE'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginTop: '4px' }}>
              <span>SPECIAL INVESTIGATIVE REPORT</span>
              <span>{date}</span>
              <span>LATE CITY EDITION</span>
            </div>
          </div>

          {/* Headline */}
          {headline && (
            <div style={{ fontSize: '34px', fontWeight: 900, lineHeight: 1.15, textAlign: 'center', margin: '8px 0', textTransform: 'uppercase', letterSpacing: '-0.5px' }}>
              {headline}
            </div>
          )}

          {/* Subtext / Columns */}
          {body && (
            <div style={{ fontSize: '15px', lineHeight: 1.5, columnCount: 2, columnGap: '20px', textAlign: 'justify', borderTop: '1px solid #78716c', paddingTop: '10px' }}>
              {body}
            </div>
          )}
        </div>
      )}

      {/* ── Confidential Document Preset ── */}
      {preset === 'document' && (
        <div
          style={{
            width: '85%',
            maxWidth: '680px',
            backgroundColor: '#27272a',
            border: '2px solid rgba(255,255,255,0.2)',
            borderRadius: '8px',
            padding: '36px',
            boxShadow: '0 25px 60px rgba(0,0,0,0.9)',
            position: 'relative',
            color: '#f4f4f5',
            fontFamily: 'Courier, monospace',
          }}
        >
          {/* Stamp animation */}
          {(() => {
            const stampSpr = spring({
              frame: Math.max(0, frame - 15),
              fps,
              config: { damping: 8, stiffness: 200, mass: 0.5 },
            });
            return (
              <div
                style={{
                  position: 'absolute',
                  top: '24px',
                  right: '24px',
                  border: '4px solid #ef4444',
                  color: '#ef4444',
                  fontSize: '22px',
                  fontWeight: 900,
                  padding: '4px 16px',
                  textTransform: 'uppercase',
                  letterSpacing: '3px',
                  transform: `rotate(-12deg) scale(${1 + (1 - stampSpr) * 2})`,
                  opacity: stampSpr,
                  boxShadow: '0 0 15px rgba(239,68,68,0.3)',
                }}
              >
                {badge || 'TOP SECRET'}
              </div>
            );
          })()}

          <div style={{ fontSize: '13px', color: '#a1a1aa', textTransform: 'uppercase', marginBottom: '16px' }}>
            DOSSIER REF: #{(frame + 1042).toString(16).toUpperCase()} // CLASSIFIED
          </div>

          {headline && (
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginBottom: '16px', fontFamily: 'sans-serif' }}>
              {headline}
            </div>
          )}

          {body && (
            <div style={{ fontSize: '14px', lineHeight: 1.8, color: '#e4e4e7', whiteSpace: 'pre-line' }}>
              {body}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
