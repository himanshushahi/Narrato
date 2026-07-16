import { useState, useEffect } from 'react';
import { useUIStore } from '../../store/useUIStore';
import EditorModule from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/vs2015.css';
import beautify from 'js-beautify';
import { BiCodeAlt, BiCheck } from 'react-icons/bi';

// Register only the languages we need
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

// Handle CJS/ESM interop for Vite
const Editor = (EditorModule as any).default || EditorModule;

export const HtmlDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [html, setHtml] = useState(() => {
    const raw = visualMeta?.html || '';
    return raw ? beautify.html(raw, { indent_size: 2, wrap_line_length: 80 }) : '';
  });
  const [css, setCss] = useState(() => {
    const raw = visualMeta?.css || '';
    return raw ? beautify.css(raw, { indent_size: 2 }) : '';
  });
  const { addToast } = useUIStore();

  useEffect(() => {
    const rawHtml = visualMeta?.html || '';
    setHtml(rawHtml ? beautify.html(rawHtml, { indent_size: 2, wrap_line_length: 80 }) : '');
    const rawCss = visualMeta?.css || '';
    setCss(rawCss ? beautify.css(rawCss, { indent_size: 2 }) : '');
  }, [visualMeta?.html, visualMeta?.css]);

  const handleSave = () => {
    onChange({ ...visualMeta, html, css });
    addToast("HTML & CSS saved to scene", "success");
  };

  const handleFormatHtml = () => setHtml(beautify.html(html, { indent_size: 2, wrap_line_length: 80 }));
  const handleFormatCss = () => setCss(beautify.css(css, { indent_size: 2 }));

  const highlightHtml = (code: string) => {
    try {
      return hljs.highlight(code, { language: 'xml' }).value;
    } catch {
      return code;
    }
  };

  const highlightCss = (code: string) => {
    try {
      return hljs.highlight(code, { language: 'css' }).value;
    } catch {
      return code;
    }
  };

  return (
    <div 
      className="col-span-2 space-y-4 mt-3 pt-3 border-t border-white/5"
      onKeyDown={(e) => {
        // Use Ctrl+P or Ctrl+Enter for previewing/applying to avoid conflict with global Ctrl+S save
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.key === 'Enter')) {
          e.preventDefault();
          handleSave();
        }
      }}
    >
      <div className="flex justify-between items-center text-xs mb-1.5">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw HTML</label>
        <div className="flex gap-1.5 items-center">
          <span className="text-[10px] text-stone-500 mr-1 hidden sm:inline-block">Ctrl+P to apply</span>
          <button
            type="button"
            onClick={handleFormatHtml}
            className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded-md text-stone-300 transition-all active:scale-95"
          >
            <BiCodeAlt size={11} /> Format
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-2.5 py-1 rounded-md transition-all active:scale-95 shadow-sm shadow-blue-600/20"
          >
            <BiCheck size={13} /> Apply
          </button>
        </div>
      </div>
      <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '160px' }}>
        <Editor
          value={html}
          onValueChange={(code: string) => setHtml(code)}
          highlight={highlightHtml}
          padding={14}
          style={{
            fontFamily: '"Fira Code", "Fira Mono", Consolas, monospace',
            fontSize: 12,
            minHeight: '160px'
          }}
          className="w-full text-white"
          textareaClassName="focus:outline-none"
        />
      </div>

      <div className="flex justify-between items-center text-xs mb-1.5 pt-2">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw CSS</label>
        <button
          type="button"
          onClick={handleFormatCss}
          className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded-md text-stone-300 transition-all active:scale-95"
        >
          <BiCodeAlt size={11} /> Format
        </button>
      </div>
      <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '160px' }}>
        <Editor
          value={css}
          onValueChange={(code: string) => setCss(code)}
          highlight={highlightCss}
          padding={14}
          style={{
            fontFamily: '"Fira Code", "Fira Mono", Consolas, monospace',
            fontSize: 12,
            minHeight: '160px'
          }}
          className="w-full text-white"
          textareaClassName="focus:outline-none"
        />
      </div>
    </div>
  );
};
