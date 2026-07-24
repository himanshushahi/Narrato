import { useState, useEffect } from 'react';
import { useUIStore } from '../../store/useUIStore';
import EditorModule from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/vs2015.css';
import beautify from 'js-beautify';
import { BiCodeAlt, BiCheck, BiPlus, BiTrash } from 'react-icons/bi';

// Register only the languages we need
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

// Handle CJS/ESM interop for Vite
const Editor = (EditorModule as any).default || EditorModule;

export const CustomHtmlUiEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const hasOverlay = !!visualMeta?.custom_html_ui;

  const [html, setHtml] = useState(() => {
    const raw = visualMeta?.custom_html_ui?.html || '';
    return raw ? beautify.html(raw, { indent_size: 2, wrap_line_length: 80 }) : '';
  });
  const [cssCode, setCssCode] = useState(() => {
    const raw = visualMeta?.custom_html_ui?.css || '';
    return raw ? beautify.css(raw, { indent_size: 2 }) : '';
  });
  const { addToast } = useUIStore();

  useEffect(() => {
    const rawHtml = visualMeta?.custom_html_ui?.html || '';
    setHtml(rawHtml ? beautify.html(rawHtml, { indent_size: 2, wrap_line_length: 80 }) : '');
    const rawCss = visualMeta?.custom_html_ui?.css || '';
    setCssCode(rawCss ? beautify.css(rawCss, { indent_size: 2 }) : '');
  }, [visualMeta?.custom_html_ui?.html, visualMeta?.custom_html_ui?.css]);

  const handleSave = () => {
    onChange({ ...visualMeta, custom_html_ui: { html, css: cssCode } });
    addToast("HTML UI Overlay saved", "success");
  };

  const handleEnable = () => {
    const defaultHtml = '<div class="custom-overlay">\n  <h2>Custom Overlay</h2>\n</div>';
    const defaultCss = '.custom-overlay {\n  position: absolute;\n  top: 50px;\n  right: 50px;\n  padding: 20px;\n  background: rgba(0,0,0,0.5);\n  color: white;\n  border-radius: 10px;\n}';
    onChange({ ...visualMeta, custom_html_ui: { html: defaultHtml, css: defaultCss } });
  };

  const handleDisable = () => {
    const copy = { ...visualMeta };
    delete copy.custom_html_ui;
    onChange(copy);
  };

  const handleFormatHtml = () => setHtml(beautify.html(html, { indent_size: 2, wrap_line_length: 80 }));
  const handleFormatCss = () => setCssCode(beautify.css(cssCode, { indent_size: 2 }));

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
    <div className="col-span-2 space-y-2 mt-2 bg-stone-900/40 p-3 rounded-lg border border-stone-800">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400 font-bold uppercase tracking-wider">Custom HTML UI Overlay</label>
        {!hasOverlay ? (
          <button
            type="button"
            onClick={handleEnable}
            className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-amber-600/20 hover:bg-amber-600/40 text-amber-500 px-2 py-1 rounded transition-all active:scale-95"
          >
            <BiPlus size={12} /> Add Overlay
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDisable}
            className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-red-900/40 hover:bg-red-900/80 text-red-400 px-2 py-1 rounded transition-all active:scale-95"
          >
            <BiTrash size={12} /> Remove
          </button>
        )}
      </div>

      {hasOverlay && (
        <div 
          className="space-y-4 pt-2 border-t border-white/5"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
              e.preventDefault();
              handleSave();
            }
          }}
        >
          <div className="flex justify-between items-center text-xs mb-1.5">
            <label className="text-stone-400/80 font-medium tracking-wide">Overlay HTML</label>
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
          <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '120px' }}>
            <Editor
              value={html}
              onValueChange={(code: string) => setHtml(code)}
              highlight={highlightHtml}
              padding={14}
              style={{
                fontFamily: '"Fira Code", "Fira Mono", Consolas, monospace',
                fontSize: 11,
                minHeight: '120px'
              }}
              className="w-full text-white"
              textareaClassName="focus:outline-none"
            />
          </div>

          <div className="flex justify-between items-center text-xs mb-1.5 pt-2">
            <label className="text-stone-400/80 font-medium tracking-wide">Overlay CSS</label>
            <button
              type="button"
              onClick={handleFormatCss}
              className="cursor-pointer flex items-center gap-1 text-[10px] whitespace-nowrap font-medium bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded-md text-stone-300 transition-all active:scale-95"
            >
              <BiCodeAlt size={11} /> Format
            </button>
          </div>
          <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '120px' }}>
            <Editor
              value={cssCode}
              onValueChange={(code: string) => setCssCode(code)}
              highlight={highlightCss}
              padding={14}
              style={{
                fontFamily: '"Fira Code", "Fira Mono", Consolas, monospace',
                fontSize: 11,
                minHeight: '120px'
              }}
              className="w-full text-white"
              textareaClassName="focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};
