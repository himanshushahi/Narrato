import { useState } from 'react';
import { useUIStore } from '../../store/useUIStore';
import EditorModule from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/themes/prism-twilight.css';

// Handle CJS/ESM interop for Vite
const Editor = (EditorModule as any).default || EditorModule;

export const HtmlDataEditor = ({ visualMeta, onChange }: { visualMeta: any, onChange: (newMeta: any) => void }) => {
  const [html, setHtml] = useState(() => visualMeta?.html || '');
  const [css, setCss] = useState(() => visualMeta?.css || '');
  const { addToast } = useUIStore();

  const handleSave = () => {
    onChange({ ...visualMeta, html, css });
    addToast("HTML & CSS saved to scene", "success");
  };

  return (
    <div className="col-span-2 space-y-4 mt-3 pt-3 border-t border-white/5">
      <div className="flex justify-between items-center text-xs mb-1">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw HTML</label>
        <button type="button" onClick={handleSave} className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-md text-stone-300 transition-colors">Apply Changes</button>
      </div>
      <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '160px' }}>
        <Editor
          value={html}
          onValueChange={(code: string) => setHtml(code)}
          highlight={(code: string) => Prism.highlight(code, Prism.languages.markup, 'markup')}
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

      <div className="flex justify-between items-center text-xs mb-1 pt-2">
        <label className="text-stone-400/80 font-medium tracking-wide">Raw CSS</label>
      </div>
      <div className="bg-black/20 border border-white/5 rounded-lg focus-within:border-amber-500/50 focus-within:bg-black/40 transition-all overflow-hidden relative" style={{ minHeight: '160px' }}>
        <Editor
          value={css}
          onValueChange={(code: string) => setCss(code)}
          highlight={(code: string) => Prism.highlight(code, Prism.languages.css, 'css')}
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
