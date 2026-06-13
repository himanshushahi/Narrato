import React from 'react';
import { useVideoConfig } from 'remotion';

export const CustomHtmlVisual: React.FC<{ meta: any }> = ({ meta }) => {
  const { width, height } = useVideoConfig();
  
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

  return (
    <div style={{ width, height }} className="absolute inset-0 overflow-hidden flex items-center justify-center">
      <style>{css}</style>
      <div 
        className="w-full h-full flex flex-col items-center justify-center"
        dangerouslySetInnerHTML={{ __html: html }} 
      />
    </div>
  );
};
