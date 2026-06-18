import React, { useRef, useEffect } from 'react';
import { useVideoConfig, useCurrentFrame } from 'remotion';

export const CustomHtmlVisual: React.FC<{ meta: any }> = ({ meta }) => {
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc?.documentElement) {
      const timeInSeconds = frame / fps;
      doc.documentElement.style.setProperty('--remotion-time', timeInSeconds.toString());
    }
  }, [frame, fps]);

  const html = meta?.html || '<div class="custom-html-fallback"><h1>Custom HTML Visual</h1><p>Edit the HTML and CSS in the Inspector panel.</p></div>';
  const css = meta?.css || `
    .custom-html-fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #fef3c7;
      font-family: 'Montserrat', sans-serif;
      text-align: center;
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
    }
    .custom-html-fallback h1 {
      font-size: 80px;
      margin: 0;
      text-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .custom-html-fallback p {
      font-size: 40px;
      opacity: 0.8;
    }
  `;

  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700;800&display=swap" rel="stylesheet">
        <style>
          /* Synchronize all CSS animations with the Remotion timeline */
          *, *::before, *::after {
            animation-play-state: paused !important;
            animation-delay: calc(var(--remotion-time, 0) * -1s) !important;
          }

          body { 
            background-color: #0c0a09; /* Default dark background matching the video */
            color: #ffffff;
            margin: 0; 
            padding: 0; 
            width: 100vw; 
            height: 100vh; 
            overflow: hidden; 
          }
          #custom-html-wrapper {
            width: 100%;
            height: 100%;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          ${css}
        </style>
      </head>
      <body>
        <div id="custom-html-wrapper">
          ${html}
        </div>
      </body>
    </html>
  `;

  return (
    <div style={{ width, height }} className="absolute inset-0 overflow-hidden bg-transparent">
      <iframe 
        ref={iframeRef}
        title="Custom HTML Sandbox"
        srcDoc={srcDoc}
        style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
        sandbox="allow-scripts allow-same-origin"
        // @ts-ignore - React requires lowercase for custom DOM attributes
        allowtransparency="true"
      />
    </div>
  );
};
