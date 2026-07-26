import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Img } from 'remotion';

interface DeviceMockupProps {
  meta: any;
  durationInFrames: number;
  visualUrl?: string;
}

export const DeviceMockup: React.FC<DeviceMockupProps> = ({ meta, visualUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const device = meta?.device?.toLowerCase() || 'iphone';
  const screenImageUrl = meta?.screen_image_url;

  // Screen content: uploaded file > screen_image_url meta
  const screenSrc = visualUrl || screenImageUrl || '';

  // Screen-level zoom & position from meta
  const screenZoom = meta?.screen_zoom ?? 1;
  const screenOffsetX = meta?.screen_offset_x ?? 0;
  const screenOffsetY = meta?.screen_offset_y ?? 0;

  // Float animation
  const progress = spring({
    fps,
    frame,
    config: { damping: 200, stiffness: 20 }
  });

  const floatY = Math.sin(frame / 30) * 20; // gentle float up and down
  
  // Rotate animation on entrance
  const rotateY = interpolate(progress, [0, 1], [-20, 0]);
  const scale = interpolate(progress, [0, 1], [0.8, 1]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  const isIphone = device === 'iphone';

  // Device dimensions
  const width = isIphone ? 400 : 900;
  const height = isIphone ? 800 : 560;
  const borderRadius = isIphone ? 40 : 20;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      perspective: '1500px',
      backgroundColor: '#0c0a09'
    }}>
      <div style={{
        width,
        height,
        backgroundColor: '#262626',
        borderRadius,
        position: 'relative',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.1)',
        transform: `translateY(${floatY}px) rotateY(${rotateY}deg) scale(${scale})`,
        opacity,
        transformStyle: 'preserve-3d',
        border: isIphone ? '12px solid #171717' : '8px solid #171717',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: isIphone ? 0 : '10px 10px 0 10px'
      }}>
        
        {/* Notch / Camera */}
        {isIphone ? (
          <div style={{
            position: 'absolute',
            top: 0,
            width: '150px',
            height: '30px',
            backgroundColor: '#171717',
            borderBottomLeftRadius: '20px',
            borderBottomRightRadius: '20px',
            zIndex: 10
          }} />
        ) : (
          <div style={{
            position: 'absolute',
            top: '4px',
            width: '6px',
            height: '6px',
            backgroundColor: '#000',
            borderRadius: '50%',
            zIndex: 10
          }} />
        )}

        {/* Screen Content */}
        <div style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#000',
          borderRadius: isIphone ? 28 : 8,
          overflow: 'hidden',
          position: 'relative',
        }}>
          {screenSrc ? (
              <Img
                src={screenSrc}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${screenZoom}) translate3d(${screenOffsetX}px, ${screenOffsetY}px, 0)`,
                }}
              />
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#52525b',
              fontSize: '24px',
              fontFamily: 'sans-serif'
            }}>
              No Screen Image
            </div>
          )}
        </div>
        
        {/* Macbook Bottom Lip */}
        {!isIphone && (
          <div style={{
            width: '120%',
            height: '20px',
            backgroundColor: '#3f3f46',
            position: 'absolute',
            bottom: '-20px',
            borderBottomLeftRadius: '10px',
            borderBottomRightRadius: '10px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
            transform: 'translateZ(10px) rotateX(10deg)',
          }} />
        )}
      </div>
    </div>
  );
};
