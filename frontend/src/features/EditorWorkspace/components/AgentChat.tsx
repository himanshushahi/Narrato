import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { copyText } from '../../../utils/clipboard';
import {
  Terminal,
  Send,
  Square,
  Trash2,
  Check,
  Copy,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Bot,
  AlertCircle,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useAgentChat, ChatMessage, StreamState } from '../hooks/useAgentChat';

// Markdown rendering for assistant replies — styled to match the dark cinematic theme
const markdownComponents = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0 leading-relaxed text-[11px] text-zinc-200">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-4 mb-2 space-y-0.5 text-[11px] text-zinc-200">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 text-[11px] text-zinc-200">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  code: ({ children }: any) => (
    <code className="font-mono text-[10px] bg-zinc-950/80 border border-zinc-800 rounded px-1.5 py-0.5 text-blue-300">{children}</code>
  ),
  pre: ({ children }: any) => (
    <pre className="font-mono text-[10px] bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-words my-2 text-zinc-300 leading-normal">{children}</pre>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline font-medium">{children}</a>
  ),
  strong: ({ children }: any) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  h1: ({ children }: any) => <h1 className="text-xs font-bold text-zinc-100 mb-1.5 mt-2">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-[11px] font-bold text-zinc-100 mb-1 mt-1.5">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-[11px] font-semibold text-zinc-200 mb-1">{children}</h3>,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-2 rounded-lg border border-zinc-800/80"><table className="text-[10px] border-collapse w-full">{children}</table></div>
  ),
  th: ({ children }: any) => <th className="bg-zinc-900/90 border-b border-zinc-800 px-2 py-1 text-left font-semibold text-zinc-200">{children}</th>,
  td: ({ children }: any) => <td className="border-b border-zinc-800/60 px-2 py-1 text-zinc-300 last:border-b-0">{children}</td>,
};

const tryParseJson = (text: string): any | null => {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

const summarizeResult = (parsed: any): { ok: boolean | null; label: string } => {
  if (!parsed || typeof parsed !== 'object') return { ok: null, label: '' };
  if (parsed.ok === true) {
    const bits: string[] = [];
    if (parsed.scene_count != null) bits.push(`${parsed.scene_count} scenes`);
    if (parsed.title) bits.push(String(parsed.title).slice(0, 60));
    if (parsed.stage) bits.push(String(parsed.stage));
    if (parsed.status) bits.push(String(parsed.status));
    if (parsed.video_path) bits.push('video ready');
    return { ok: true, label: bits.join(' · ') || 'Success' };
  }
  if (parsed.ok === false) return { ok: false, label: String(parsed.error || 'Failed').slice(0, 160) };
  return { ok: null, label: '' };
};

// Reasoning thought trace — collapsible card
const ThinkingBlock: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const [open, setOpen] = useState(false);
  const text = msg.text.length > 3000 ? msg.text.slice(0, 3000) + '…' : msg.text;

  return (
    <div className="w-full rounded-xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden transition-all duration-200">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-medium text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.06] transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-semibold uppercase tracking-wider text-[9px]">Agent Thought Process</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500">
          <span className="text-[9px] font-mono">{msg.text.length} chars</span>
          {open ? <ChevronDown className="w-3 h-3 text-zinc-400" /> : <ChevronRight className="w-3 h-3 text-zinc-400" />}
        </div>
      </button>
      {open && (
        <div className="px-3 py-2 bg-black/30 border-t border-amber-500/10 text-[10px] text-zinc-400 leading-relaxed font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
});

// Tool call result card — symmetrical, clean header, expandable args and result
const ToolCard: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const [openArgs, setOpenArgs] = useState(false);
  const [openResult, setOpenResult] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);

  const parsed = useMemo(() => tryParseJson(msg.text), [msg.text]);
  const summary = useMemo(() => summarizeResult(parsed), [parsed]);
  const ok = summary.ok;

  const imagePath = parsed && typeof parsed === 'object'
    ? (parsed.image_path || parsed.image_file || null)
    : null;
  const imageUrl = imagePath ? getMediaUrlSync(String(imagePath)) : null;

  const argsEntries = useMemo(
    () => msg.args ? Object.entries(msg.args).filter(([, v]) => v !== '' && v != null) : [],
    [msg.args],
  );

  const onCopyResult = async () => {
    const raw = parsed ? JSON.stringify(parsed, null, 2) : msg.text;
    if (await copyText(raw)) {
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 1500);
    }
  };

  return (
    <div className={`w-full rounded-xl border transition-all duration-200 overflow-hidden ${
      ok === false
        ? 'border-red-500/30 bg-red-950/10'
        : ok === true
        ? 'border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700/80'
        : 'border-zinc-800 bg-zinc-900/30'
    }`}>
      {/* Tool Header */}
      <div className={`flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900/70 border-b ${
        openArgs || openResult || summary.label || imageUrl ? 'border-zinc-800/60' : 'border-transparent'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
            ok === false
              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
              : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
          }`}>
            <Terminal className="w-3 h-3" />
          </span>
          <span className="text-[11px] font-mono font-semibold text-zinc-200 truncate">
            {msg.tool}
          </span>
          {ok === true && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 flex items-center gap-1 shrink-0">
              <Check className="w-2.5 h-2.5" /> Done
            </span>
          )}
          {ok === false && (
            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-red-500/10 text-red-400 border border-red-500/25 flex items-center gap-1 shrink-0">
              <AlertCircle className="w-2.5 h-2.5" /> Error
            </span>
          )}
        </div>

        {/* Action Toggles */}
        <div className="flex items-center gap-1 shrink-0">
          {argsEntries.length > 0 && (
            <button
              onClick={() => setOpenArgs((v) => !v)}
              className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded font-medium border transition-colors cursor-pointer ${
                openArgs
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Args {openArgs ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            </button>
          )}
          <button
            onClick={() => setOpenResult((v) => !v)}
            className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded font-medium border transition-colors cursor-pointer ${
              openResult
                ? 'bg-zinc-700/60 border-zinc-600 text-zinc-200'
                : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Result {openResult ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summary.label && (
        <div className={`px-3 py-1.5 bg-black/25 flex items-center gap-2 text-[10px] font-mono ${
          ok === false ? 'text-red-400' : 'text-zinc-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok === false ? 'bg-red-400' : 'bg-emerald-400'}`} />
          <span className="truncate">{summary.label}</span>
        </div>
      )}

      {/* Frame review image */}
      {imageUrl && (
        <div className="p-2.5 bg-black/30 border-t border-zinc-800/40">
          <img
            src={imageUrl}
            alt={`${msg.tool} review`}
            className="rounded-lg border border-zinc-800 w-full object-contain max-h-52 bg-zinc-950/60"
            loading="lazy"
          />
        </div>
      )}

      {/* Expandable Args view */}
      {openArgs && argsEntries.length > 0 && (
        <div className="px-3 py-2 bg-zinc-950/80 border-t border-zinc-800/60 space-y-1">
          {argsEntries.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[10px] font-mono leading-relaxed">
              <span className="text-violet-400 font-semibold shrink-0">{k}:</span>
              <span className="text-zinc-300 break-all">
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Result view */}
      {openResult && (
        <div className="relative bg-zinc-950/90 border-t border-zinc-800/60">
          <button
            onClick={onCopyResult}
            className="absolute top-2 right-2 p-1 rounded bg-zinc-800/70 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Copy result JSON"
          >
            {copiedResult ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <pre className="p-3 text-[10px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words max-h-52 overflow-y-auto pr-8">
            {parsed ? JSON.stringify(parsed, null, 2) : msg.text}
          </pre>
        </div>
      )}
    </div>
  );
});

// Chat message bubble: User right-aligned, Assistant left-aligned
const MessageBubble: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onCopy = async () => {
    if (await copyText(msg.text)) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  if (msg.role === 'system') {
    if (msg.kind === 'error') {
      const text = msg.text || 'An unexpected error occurred.';
      return (
        <div className="w-full rounded-xl border border-red-500/30 bg-red-950/15 p-3 space-y-1.5 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <p className="text-[11px] font-bold text-red-300">Agent stopped</p>
          </div>
          <p className="text-[10px] text-red-200/90 leading-relaxed whitespace-pre-wrap break-words">
            {text.length > 2000 ? text.slice(0, 2000) + '…' : text}
          </p>
        </div>
      );
    }
    const text = msg.text || '';
    return (
      <div className="flex justify-center w-full my-1">
        <div className="border rounded-full px-3 py-1 text-[9px] bg-zinc-900/80 border-zinc-800 text-zinc-500 italic max-w-[90%] text-center truncate">
          {text.length > 300 ? text.slice(0, 300) + '…' : text}
        </div>
      </div>
    );
  }

  // Guard against blank/whitespace assistant bubbles
  if (msg.role === 'assistant' && !msg.text?.trim()) {
    return null;
  }

  const isUser = msg.role === 'user';
  const copyable = !isUser && msg.text.length > 0;

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative rounded-2xl px-3.5 py-2.5 text-[11px] leading-relaxed break-words shadow-sm transition-all ${
          isUser
            ? 'max-w-[85%] rounded-tr-xs bg-blue-600/20 border border-blue-500/30 text-zinc-100 ml-6'
            : 'w-full rounded-tl-xs bg-zinc-900/60 border border-zinc-800/80 text-zinc-200'
        }`}
      >
        {copyable && (
          <button
            onClick={onCopy}
            title={copied ? 'Copied!' : 'Copy response'}
            className="absolute top-2 right-2 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
        {msg.role === 'assistant' ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {msg.text}
          </ReactMarkdown>
        ) : (
          <span className="whitespace-pre-wrap">{msg.text}</span>
        )}
      </div>
    </div>
  );
});

// Live in-flight stream preview
const StreamPreview: React.FC<{ stream: StreamState }> = memo(({ stream }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onCopy = async () => {
    if (!stream.text) return;
    if (await copyText(stream.text)) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex w-full justify-start">
      <div className="group relative w-full rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-[11px] leading-relaxed break-words bg-zinc-900/60 border border-blue-500/30 text-zinc-200 shadow-sm">
        {stream.text?.trim() && (
          <button
            onClick={onCopy}
            title={copied ? 'Copied!' : 'Copy response'}
            className="absolute top-2 right-2 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
        {stream.thinking?.trim() && (
          <div className="mb-2 p-2 rounded-lg bg-amber-500/[0.04] border border-amber-500/15 text-[10px] text-amber-300/80 font-mono italic whitespace-pre-wrap break-words">
            {stream.thinking.length > 400 ? 'Agent is thinking…' : stream.thinking}
          </div>
        )}
        {stream.text?.trim() ? (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {stream.text}
            </ReactMarkdown>
            <span className="text-blue-400 animate-pulse font-mono">▍</span>
          </>
        ) : stream.thinking?.trim() ? null : (
          <p className="text-[11px] text-blue-400 animate-pulse font-mono flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Agent is thinking…
          </p>
        )}
      </div>
    </div>
  );
});

interface AgentChatProps {
  projectId: string;
  pipelineRunning: boolean;
}

const SUGGESTED_PROMPTS = [
  'Check project status and tell me what is missing',
  'Show me what is in scene 1',
  'Inspect audio timings and visual plan',
];

export const AgentChat: React.FC<AgentChatProps> = ({ projectId, pipelineRunning }) => {
  const { messages, activeTools, stream, running, pending, send, cancel, clear } = useAgentChat(projectId);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const ordered = useMemo(() => {
    // messages already arrive in canonical order (backend seq for persisted,
    // event order for live upserts, provisionals trailing). This pass is only
    // a safety net: drop blanks, collapse true duplicates by id, and absorb a
    // provisional when the same turn was persisted or its exact text already
    // appears in the current user-turn. Matching is exact-only on purpose —
    // the old substring heuristic merged distinct narrations sharing
    // boilerplate and stranded survivors out of order.
    const norm = (t: string) => (t || '').trim().replace(/\r\n/g, '\n');
    const seenIds = new Set<string>();
    const result: ChatMessage[] = [];
    let currentTurnStartIndex = 0;

    for (const m of messages) {
      if (seenIds.has(m.id)) continue;
      if (m.role === 'user') {
        seenIds.add(m.id);
        currentTurnStartIndex = result.length;
        result.push(m);
        continue;
      }

      if (m.role === 'assistant' || m.role === 'thinking') {
        const text = norm(m.text);
        if (!text) continue;
        const currentTurnSlice = result.slice(currentTurnStartIndex);
        // A persisted entry for the same turn supersedes a provisional one.
        if (m.turn && currentTurnSlice.some((p) =>
          p.role === m.role && !p.provisional && p.turn === m.turn)) {
          if (m.provisional) continue;
        }
        const dupIdx = currentTurnSlice.findIndex(
          (p) => p.role === m.role && norm(p.text) === text,
        );
        if (dupIdx !== -1) {
          const globalIdx = currentTurnStartIndex + dupIdx;
          const existing = result[globalIdx];
          // Prefer the persisted entry in place so its position (ahead of
          // its tool calls) never moves.
          if (!existing.provisional && m.provisional) continue;
          if (existing.provisional && !m.provisional) {
            seenIds.add(m.id);
            result[globalIdx] = m;
            continue;
          }
          continue;
        }
        seenIds.add(m.id);
        result.push(m);
        continue;
      }

      seenIds.add(m.id);
      result.push(m);
    }
    return result;
  }, [messages]);

  const visibleStream = useMemo<StreamState | null>(() => {
    if (!stream) return null;
    const norm = (t: string) => (t || '').trim().replace(/\r\n/g, '\n');
    const textNorm = norm(stream.text);
    const thinkNorm = norm(stream.thinking);
    if (!textNorm && !thinkNorm) return null;

    // Only compare against messages in the CURRENT turn. A turn already
    // persisted (same turn key present) or exact-text duplicated means the
    // preview content is already shown — hide it to avoid double rendering.
    const lastUserIdx = ordered.map((m) => m.role).lastIndexOf('user');
    const currentTurn = lastUserIdx === -1 ? ordered : ordered.slice(lastUserIdx);

    const textAlreadyInChat = textNorm.length > 0 && currentTurn.some((m) =>
      m.role === 'assistant' && (m.turn === stream.id || norm(m.text) === textNorm));

    const thinkAlreadyInChat = thinkNorm.length > 0 && currentTurn.some((m) =>
      m.role === 'thinking' && (m.turn === stream.id || norm(m.text) === thinkNorm));

    const activeText = textAlreadyInChat ? '' : stream.text;
    const activeThink = thinkAlreadyInChat ? '' : stream.thinking;

    if (!activeText.trim() && !activeThink.trim()) return null;

    return {
      id: stream.id,
      text: activeText,
      thinking: activeThink,
    };
  }, [stream, ordered]);

  useEffect(() => {
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [ordered.length, running, activeTools.length, visibleStream?.text.length, visibleStream?.thinking.length]);

  const submit = () => {
    if (!input.trim() || running || pipelineRunning) return;
    send(input);
    setInput('');
  };

  const handleSuggestionClick = (prompt: string) => {
    if (running || pipelineRunning) return;
    setInput(prompt);
  };

  return (
    <div className="glass-panel rounded-xl p-3 flex flex-col flex-1 min-h-0 border border-zinc-800/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-200">
                Agent Assistant
              </h3>
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            </div>
            <p className="text-[9px] text-zinc-500 mt-0.5">
              Autonomous project workspace agent · Native MCP tools
            </p>
          </div>
        </div>
        <button
          onClick={clear}
          title="Clear chat history"
          className="text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 transition-all p-1.5 rounded-lg cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {pipelineRunning && (
        <div className="bg-amber-600/10 border border-amber-600/25 text-amber-300 p-2 rounded-lg text-[10px] font-medium flex items-center gap-2 shrink-0 my-1">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Pipeline is currently running — agent stage tools are locked until it finishes.</span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="space-y-2.5 flex-1 min-h-0 overflow-y-auto pr-1 my-0.5"
      >
        {/* Empty state */}
        {ordered.length === 0 && !visibleStream && activeTools.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-sm">
              <Bot className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-zinc-300">How can I assist with your project?</p>
              <p className="text-[10px] text-zinc-500 max-w-xs mx-auto leading-relaxed">
                Inspect script and visuals, ground against skills, verify media, or run pipeline stages.
              </p>
            </div>
            {/* Quick action chips */}
            <div className="flex flex-col gap-1.5 w-full max-w-xs pt-1">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSuggestionClick(prompt)}
                  className="text-left text-[10px] px-3 py-1.5 rounded-lg bg-zinc-900/70 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer truncate"
                >
                  “{prompt}”
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ordered historical messages */}
        {ordered.map((m) => {
          if (m.role === 'tool') return <ToolCard key={m.id} msg={m} />;
          if (m.role === 'thinking') return <ThinkingBlock key={m.id} msg={m} />;
          return <MessageBubble key={m.id} msg={m} />;
        })}

        {/* Live stream preview (narration precedes its tool call, so the
            preview renders above the running-tool spinners — matching the
            canonical user → thinking → assistant → tool order instead of
            teleporting on every tool_done). */}
        {visibleStream && <StreamPreview stream={visibleStream} />}

        {/* Active running tools */}
        {activeTools.map((t, i) => (
          <div
            key={t.callId || `${t.tool}-${i}`}
            className="w-full rounded-xl border border-blue-500/25 bg-blue-500/[0.04] p-2.5 flex items-center justify-between gap-3 shadow-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-mono font-semibold text-blue-300 shrink-0">
                  Running {t.tool}…
                </span>
                <span className="text-[10px] text-zinc-500 truncate font-mono">
                  {t.detail}
                </span>
              </div>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0 animate-pulse">
              Active
            </span>
          </div>
        ))}

        {/* Running idle status */}
        {running && activeTools.length === 0 && !visibleStream && (
          <div className="flex items-center gap-2 py-1 text-[11px] text-blue-400 animate-pulse font-mono">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Agent is thinking…</span>
          </div>
        )}
      </div>

      {/* Human-in-the-loop pending approval card */}
      {pending && (
        <div className={`border rounded-xl p-3 space-y-2 shadow-md shrink-0 ${
          pending.kind === 'render'
            ? 'bg-emerald-950/20 border-emerald-500/35'
            : 'bg-amber-950/20 border-amber-500/35'
        }`}>
          <div className="flex items-center gap-2">
            <ShieldAlert className={`w-4 h-4 shrink-0 ${pending.kind === 'render' ? 'text-emerald-400' : 'text-amber-400'}`} />
            <p className={`text-[11px] font-bold ${pending.kind === 'render' ? 'text-emerald-300' : 'text-amber-300'}`}>
              {pending.kind === 'render'
                ? 'Review Gate: Ready for Final Render'
                : `Confirmation Required: ${pending.tool}`}
            </p>
          </div>
          <p className="text-[10px] text-zinc-300 leading-relaxed">
            {pending.kind === 'render'
              ? 'The project video elements have been assembled and reviewed. Approve the final render or request modifications.'
              : `This action cannot be undone. Approve to proceed with ${pending.tool}, or deny it.`}
          </p>
          {pending.kind !== 'render' && pending.args && (
            <pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950/80 border border-zinc-800 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
              {JSON.stringify(pending.args, null, 2)}
            </pre>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => send(
                pending.kind === 'render' ? 'Approved — render the final video.' : `Approved — proceed with ${pending.tool}.`,
                { confirmRender: pending.kind === 'render', confirmAction: true }
              )}
              className={`flex-1 flex items-center justify-center gap-1.5 text-[10px] py-1.5 font-bold text-white rounded-lg transition-colors cursor-pointer shadow-sm ${
                pending.kind === 'render' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              {pending.kind === 'render' ? 'Approve Final Render' : 'Approve Action'}
            </button>
            <button
              onClick={() => send('Not approved.', { confirmAction: false })}
              className="flex-1 text-[10px] py-1.5 font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700 transition-colors cursor-pointer"
            >
              {pending.kind === 'render' ? 'Keep Editing' : 'Deny'}
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex gap-2 items-center pt-2 border-t border-zinc-800/60 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={pipelineRunning ? 'Locked while pipeline runs…' : 'Ask the agent to inspect, generate, or modify…'}
          disabled={running || pipelineRunning}
          className="flex-1 bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/20 disabled:opacity-50 transition-all"
        />
        {running ? (
          <button
            onClick={cancel}
            title="Stop agent turn"
            className="h-8 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            <Square className="w-3 h-3 fill-current" /> Stop
          </button>
        ) : (
          <button
            onClick={submit}
            title="Send (Enter)"
            disabled={!input.trim() || pipelineRunning}
            className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer shrink-0 shadow-sm"
          >
            <Send className="w-3 h-3" /> Send
          </button>
        )}
      </div>

      <p className="text-[8px] text-zinc-600 text-center select-none shrink-0 pt-0.5">
        Deletions, clears, and final renders pause for your explicit review and approval.
      </p>
    </div>
  );
};
