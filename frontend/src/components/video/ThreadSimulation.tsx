import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface Message {
  sender?: string;
  text: string;
  is_self: boolean;
}

interface ThreadSimulationProps {
  meta: any;
  durationInFrames: number;
}

export const ThreadSimulation: React.FC<ThreadSimulationProps> = ({ meta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const platform = meta?.platform?.toLowerCase() || 'whatsapp';
  const messages: Message[] = meta?.messages || [];

  const staggerFrames = 30; // 1 second between messages

  // Styling based on platform
  const getStyles = () => {
    switch (platform) {
      case 'instagram':
        return {
          bg: '#fafafa',
          headerBg: '#ffffff',
          headerText: '#262626',
          selfMsg: '#efefef',
          selfText: '#262626',
          otherMsg: '#ffffff',
          otherText: '#262626',
          otherBorder: '1px solid #dbdbdb',
          fontFamily: 'Inter, sans-serif',
        };
      case 'facebook':
        return {
          bg: '#ffffff',
          headerBg: '#ffffff',
          headerText: '#050505',
          selfMsg: '#0084ff',
          selfText: '#ffffff',
          otherMsg: '#f0f2f5',
          otherText: '#050505',
          otherBorder: 'none',
          fontFamily: 'Helvetica, Arial, sans-serif',
        };
      case 'whatsapp':
      default:
        return {
          bg: '#efeae2',
          headerBg: '#075e54',
          headerText: '#ffffff',
          selfMsg: '#dcf8c6',
          selfText: '#303030',
          otherMsg: '#ffffff',
          otherText: '#303030',
          otherBorder: 'none',
          fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
        };
    }
  };

  const theme = getStyles();

  const getPlatformIconColor = () => {
    switch(platform) {
      case 'instagram': return '#8e8e8e';
      case 'facebook': return '#0084ff';
      default: return '#8696a0';
    }
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '750px',
        height: '100%',
        backgroundColor: theme.bg,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.fontFamily,
        position: 'relative',
        boxShadow: '0 0 150px rgba(0,0,0,0.4)',
        borderLeft: '1px solid rgba(255,255,255,0.05)',
        borderRight: '1px solid rgba(255,255,255,0.05)'
      }}>
      {/* Optional WhatsApp pattern overlay */}
      {platform === 'whatsapp' && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          opacity: 0.06,
          backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
          backgroundSize: '400px',
          zIndex: 0
        }} />
      )}

      {/* Header */}
      <div style={{
        height: '120px',
        backgroundColor: theme.headerBg,
        display: 'flex',
        alignItems: 'center',
        padding: '0 40px',
        boxShadow: platform === 'whatsapp' ? '0 1px 3px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.05)',
        zIndex: 10
      }}>
        <div style={{
          width: '70px',
          height: '70px',
          borderRadius: '50%',
          backgroundColor: '#e2e8f0',
          marginRight: '25px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748b',
          fontWeight: 'bold',
          fontSize: '28px'
        }}>
          {messages.length > 0 && !messages[0].is_self && messages[0].sender ? messages[0].sender.charAt(0).toUpperCase() : 'U'}
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{
            margin: 0,
            color: theme.headerText,
            fontSize: '32px',
            fontWeight: 600
          }}>
            {platform.charAt(0).toUpperCase() + platform.slice(1)} Chat
          </h2>
          <p style={{ margin: '5px 0 0 0', color: platform === 'whatsapp' ? 'rgba(255,255,255,0.9)' : '#8e8e8e', fontSize: '18px' }}>
            Online
          </p>
        </div>
        <div style={{
          display: 'flex',
          gap: '30px',
          color: platform === 'whatsapp' ? 'white' : getPlatformIconColor(),
          fontSize: '32px'
        }}>
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
          </svg>
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        </div>
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1,
        padding: '40px 40px 140px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        justifyContent: 'flex-end',
        overflow: 'hidden',
        zIndex: 1
      }}>
        {messages.map((msg, idx) => {
          const startFrame = idx * staggerFrames + 10;
          
          const progress = spring({
            fps,
            frame: frame - startFrame,
            config: { damping: 16, stiffness: 140 }
          });

          const translateY = interpolate(progress, [0, 1], [40, 0]);
          const opacity = interpolate(progress, [0, 1], [0, 1]);
          const scale = interpolate(progress, [0, 0.5, 1], [0.95, 1.02, 1]);

          if (frame < startFrame) return null;

          return (
            <div key={idx} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.is_self ? 'flex-end' : 'flex-start',
              opacity,
              transform: `translateY(${translateY}px) scale(${scale})`,
              transformOrigin: msg.is_self ? 'bottom right' : 'bottom left'
            }}>
              {!msg.is_self && msg.sender && (
                <div style={{
                  fontSize: '16px',
                  color: '#64748b',
                  marginBottom: '6px',
                  marginLeft: '16px',
                  fontWeight: 500
                }}>
                  {msg.sender}
                </div>
              )}
              <div style={{
                maxWidth: '75%',
                backgroundColor: msg.is_self ? theme.selfMsg : theme.otherMsg,
                color: msg.is_self ? theme.selfText : theme.otherText,
                padding: '20px 28px',
                borderRadius: platform === 'whatsapp' ? '18px' : '26px',
                borderBottomRightRadius: msg.is_self && platform === 'whatsapp' ? '4px' : undefined,
                borderBottomLeftRadius: !msg.is_self && platform === 'whatsapp' ? '4px' : undefined,
                border: !msg.is_self ? theme.otherBorder : 'none',
                fontSize: '28px',
                lineHeight: '1.45',
                boxShadow: platform === 'whatsapp' ? '0 1px 2px rgba(11,20,26,0.1)' : '0 2px 10px rgba(0,0,0,0.03)',
                position: 'relative'
              }}>
                {msg.text}
                <span style={{
                  fontSize: '14px',
                  color: msg.is_self ? 'rgba(0,0,0,0.4)' : '#94a3b8',
                  float: 'right',
                  marginTop: '15px',
                  marginLeft: '15px'
                }}>
                  12:00 PM {msg.is_self && <span style={{ color: platform === 'whatsapp' ? '#53bdeb' : '#0084ff', marginLeft: '4px' }}>✓✓</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Message Input Bar */}
      <div style={{
        height: '110px',
        backgroundColor: platform === 'whatsapp' ? '#f0f2f5' : '#ffffff',
        display: 'flex',
        alignItems: 'center',
        padding: '0 40px',
        zIndex: 10,
        gap: '20px',
        borderTop: platform !== 'whatsapp' ? '1px solid #dbdbdb' : 'none',
        position: 'absolute',
        bottom: 0,
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{ color: getPlatformIconColor(), display: 'flex', alignItems: 'center' }}>
          <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S8.33 8 7.5 8 6 8.67 6 9.5 6.67 11 7.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H8.39c.8 2.04 2.78 3.5 5.11 3.5z"/>
          </svg>
        </div>
        {platform === 'whatsapp' && (
          <div style={{ color: getPlatformIconColor(), display: 'flex', alignItems: 'center' }}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S6 2.79 6 5v12.5c0 3.31 2.69 6 6 6s6-2.69 6-6V6h-1.5z"/>
            </svg>
          </div>
        )}
        <div style={{
          flex: 1,
          height: '65px',
          backgroundColor: '#ffffff',
          borderRadius: platform === 'whatsapp' ? '12px' : '32px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 25px',
          color: '#8696a0',
          fontSize: '24px',
          border: platform !== 'whatsapp' ? '1px solid #dbdbdb' : 'none'
        }}>
          Type a message
        </div>
        {platform === 'whatsapp' ? (
          <div style={{
            width: '65px',
            height: '65px',
            borderRadius: '50%',
            backgroundColor: '#00a884',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '28px'
          }}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
            </svg>
          </div>
        ) : (
          <span style={{ fontSize: '28px', color: getPlatformIconColor(), fontWeight: 'bold' }}>Send</span>
        )}
      </div>
      </div>
    </div>
  );
};
