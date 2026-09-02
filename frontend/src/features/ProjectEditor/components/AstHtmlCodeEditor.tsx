import React, { useState } from 'react';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/atom-one-dark.css';
import { BsCodeSlash, BsMagic, BsClipboard } from 'react-icons/bs';

try {
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('svg', xml);
  hljs.registerLanguage('css', css);
} catch {
  // Already registered
}

interface AstHtmlCodeEditorProps {
  value: string;
  onChange: (val: string) => void;
}

/**
 * Clean XML / HTML Auto-Formatter
 */
function formatHtml(html: string): string {
  let formatted = '';
  let indent = '';
  const tab = '  ';

  // Split tags and text
  const tokens = html
    .replace(/>\s*</g, '><')
    .replace(/</g, '~::~<')
    .replace(/\s*~::~/g, '~::~')
    .split('~::~');

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;

    // Closing tag e.g. </div> or </p>
    if (token.startsWith('</')) {
      indent = indent.slice(tab.length);
      formatted += indent + token + '\n';
    }
    // Self closing tag e.g. <img /> or <circle ... />
    else if (token.endsWith('/>') || token.startsWith('<!') || token.startsWith('<?')) {
      formatted += indent + token + '\n';
    }
    // Opening tag e.g. <div> or <svg ...>
    else if (token.startsWith('<') && !token.includes('</')) {
      formatted += indent + token + '\n';
      indent += tab;
    }
    // Inner text or tag with close e.g. <span>Hello</span>
    else if (token.startsWith('<') && token.includes('</')) {
      formatted += indent + token + '\n';
    } else {
      formatted += indent + token + '\n';
    }
  }

  return formatted.trim();
}

export const AstHtmlCodeEditor: React.FC<AstHtmlCodeEditorProps> = ({
  value,
  onChange,
}) => {
  const [copied, setCopied] = useState(false);

  const handleFormat = () => {
    if (!value) return;
    const formatted = formatHtml(value);
    onChange(formatted);
  };

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lineCount = (value || '').split('\n').length;

  return (
    <div className="space-y-2">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <BsCodeSlash size={12} />
          HTML / SVG Code ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleFormat}
            className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            title="Auto-format & indent HTML / SVG code"
          >
            <BsMagic size={10} /> Format Code
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 text-stone-300 text-[10px] font-bold uppercase rounded flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            title="Copy code to clipboard"
          >
            <BsClipboard size={10} /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Syntax Highlighted Code Editor */}
      <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1e1e1e] focus-within:border-amber-500/50 shadow-inner">
        <Editor
          value={value || ''}
          onValueChange={onChange}
          highlight={code => {
            try {
              return hljs.highlight(code || '', { language: 'xml' }).value;
            } catch {
              return code;
            }
          }}
          padding={12}
          placeholder="<div>\n  <style>...</style>\n  <svg>...</svg>\n</div>"
          style={{
            fontFamily: '"Fira Code", "JetBrains Mono", Consolas, Menlo, monospace',
            fontSize: 12,
            minHeight: 120,
            lineHeight: 1.5,
          }}
          className="text-stone-200"
        />
      </div>
    </div>
  );
};
