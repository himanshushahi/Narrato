import React, { useRef, useEffect, useState } from 'react';
import { useVideoConfig, useCurrentFrame, delayRender, continueRender } from 'remotion';
import { getLogicalCanvasSize } from './compositionScale';

export const CustomHtmlUiOverlay: React.FC<{ meta: any }> = ({ meta }) => {
  const { width: configWidth, height: configHeight, fps } = useVideoConfig();
  // Fast preview renders on a reduced canvas; the overlay must span the logical
  // 1080p canvas so the scaled composition keeps identical framing.
  const { width, height } = getLogicalCanvasSize(configWidth, configHeight);
  const frame = useCurrentFrame();
  const containerRef = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender("Loading Custom HTML UI Overlay Shadow DOM"));
  const hasContinuedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!hasContinuedRef.current) {
        continueRender(handle);
        hasContinuedRef.current = true;
      }
    };
  }, [handle]);

  const html = meta?.html || '<div class="custom-html-ui-fallback"><h2>Custom Overlay</h2></div>';
  const css = meta?.css || `
    .custom-html-ui-fallback {
      position: absolute;
      top: 50px;
      right: 50px;
      padding: 20px 40px;
      color: #fef3c7;
      font-family: 'Montserrat', sans-serif;
      text-align: center;
      background: rgba(30, 27, 75, 0.8);
      border: 2px solid rgba(255,255,255,0.2);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .custom-html-ui-fallback h2 {
      font-size: 40px;
      margin: 0;
      text-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
  `;

  useEffect(() => {
    if (containerRef.current) {
      if (!containerRef.current.shadowRoot) {
        containerRef.current.attachShadow({ mode: 'open' });
      }

      const shadow = containerRef.current.shadowRoot;
      if (shadow) {
        shadow.innerHTML = `
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700;800&family=Inter:wght@400;500;700;800&family=Oswald:wght@400;500;700;800&family=Outfit:wght@400;500;700;800&display=swap" rel="stylesheet">
          <style>
            /* Synchronize all CSS animations with the Remotion timeline */
            *, *::before, *::after {
              animation-play-state: paused !important;
              animation-delay: calc(var(--remotion-time, 0) * -1s) !important;
            }

            #custom-html-wrapper {
              width: 100%;
              height: 100%;
              position: relative;
            }
            ${css}
          </style>
          <div id="custom-html-wrapper">
            ${html}
          </div>
        `;
      }
      
      if (!hasContinuedRef.current) {
        continueRender(handle);
        hasContinuedRef.current = true;
      }
    }
  }, [html, css, handle]);

  useEffect(() => {
    if (containerRef.current) {
      const timeInSeconds = frame / fps;
      // Pass the remotion time as a CSS variable to the container.
      // Shadow DOM inherits CSS variables from its host naturally!
      containerRef.current.style.setProperty('--remotion-time', timeInSeconds.toString());
    }
  }, [frame, fps]);

  return (
    <div 
      ref={containerRef}
      style={{ width, height, pointerEvents: 'none' }} 
      className="absolute inset-0 overflow-hidden bg-transparent"
    />
  );
};
