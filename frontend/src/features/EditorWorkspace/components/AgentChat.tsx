import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { VscSend, VscStopCircle, VscTrash, VscCheck, VscTerminal, VscSparkle, VscChevronDown, VscChevronRight, VscLightbulb } from 'react-icons/vsc';
import { useAgentChat, ChatMessage, StreamState } from '../hooks/useAgentChat';

// Markdown rendering for assistant replies — styled to the app theme
// (zinc text, blue links, compact code blocks).
const markdownComponents = {
  p: ({ children }: any) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
  li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  code: ({ children }: any) => (
    <code className="font-mono text-[8px] bg-zinc-950/70 border border-zinc-800 rounded px-1 py-px text-zinc-300">{children}</code>
  ),
  pre: ({ children }: any) => (
    <pre className="font-mono text-[8px] bg-zinc-950/70 border border-zinc-800 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words mb-1.5">{children}</pre>
  ),
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">{children}</a>
  ),
  strong: ({ children }: any) => <strong className="font-bold text-zinc-100">{children}</strong>,
  h1: ({ children }: any) => <p className="font-bold text-zinc-100 mb-1">{children}</p>,
  h2: ({ children }: any) => <p className="font-bold text-zinc-100 mb-1">{children}</p>,
  h3: ({ children }: any) => <p className="font-bold text-zinc-100 mb-1">{children}</p>,
  table: ({ children }: any) => (
    <div className="overflow-x-auto mb-1.5"><table className="text-[8px] border-collapse">{children}</table></div>
  ),
  th: ({ children }: any) => <th className="border border-zinc-700 px-1.5 py-0.5 text-left font-bold text-zinc-200">{children}</th>,
  td: ({ children }: any) => <td className="border border-zinc-800 px-1.5 py-0.5 text-zinc-300">{children}</td>,
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
    return { ok: true, label: bits.join(' · ') || 'ok' };
  }
  if (parsed.ok === false) return { ok: false, label: String(parsed.error || 'failed').slice(0, 160) };
  return { ok: null, label: '' };
};

// Memoized: the parent re-renders on every stream tick, but message objects
// are referentially stable across no-op refreshes (see useAgentChat merge),
// so history bubbles skip re-render — no O(history) markdown re-parse.
const ThinkingBlock: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const [open, setOpen] = useState(false);
  const text = msg.text.length > 3000 ? msg.text.slice(0, 3000) + '…' : msg.text;
  return (
    <div className="border rounded-lg px-2 py-1 bg-zinc-900/30 border-zinc-800/60">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 cursor-pointer">
        {open ? <VscChevronDown className="text-[9px]" /> : <VscChevronRight className="text-[9px]" />}
        <VscLightbulb className="text-[10px]" /> Thinking
      </button>
      {open && (
        <div className="mt-1 text-[8px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
});

const ToolCard: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  const [openArgs, setOpenArgs] = useState(false);
  const [openResult, setOpenResult] = useState(false);
  // Parsed once per message content — not on every parent render.
  const parsed = useMemo(() => tryParseJson(msg.text), [msg.text]);
  const summary = useMemo(() => summarizeResult(parsed), [parsed]);
  const ok = summary.ok;
  // review_frame persists a contact sheet the agent actually saw — show it.
  const imagePath = parsed && typeof parsed === 'object'
    ? (parsed.image_path || parsed.image_file || null)
    : null;
  const imageUrl = imagePath ? getMediaUrlSync(String(imagePath)) : null;
  const argsEntries = useMemo(
    () => msg.args ? Object.entries(msg.args).filter(([, v]) => v !== '' && v != null) : [],
    [msg.args],
  );

  return (
    <div className={`border rounded-lg px-2 py-1.5 bg-zinc-900/50 ${ok === false ? 'border-red-600/30' : 'border-zinc-800'}`}>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center border text-[9px] text-violet-400 bg-violet-500/10 border-violet-500/25">
          <VscTerminal />
        </span>
        <span className="text-[9px] font-bold text-zinc-200 font-mono truncate flex-1">{msg.tool}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok === false ? 'bg-red-500' : ok === true ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
      </div>

      {summary.label && (
        <p className={`text-[8px] font-mono mt-1 break-words ${ok === false ? 'text-red-400' : 'text-zinc-400'}`}>
          {summary.label}
        </p>
      )}

      {imageUrl && (
        <img src={imageUrl} alt={`${msg.tool} review`} className="mt-1.5 rounded border border-zinc-800 w-full object-contain max-h-48" loading="lazy" />
      )}

      <div className="flex gap-1 mt-1.5">
        {argsEntries.length > 0 && (
          <button onClick={() => setOpenArgs((v) => !v)}
            className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-violet-400/80 hover:text-violet-300 cursor-pointer">
            {openArgs ? <VscChevronDown className="text-[9px]" /> : <VscChevronRight className="text-[9px]" />} Args
          </button>
        )}
        <button onClick={() => setOpenResult((v) => !v)}
          className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 cursor-pointer">
          {openResult ? <VscChevronDown className="text-[9px]" /> : <VscChevronRight className="text-[9px]" />} Result
        </button>
      </div>

      {openArgs && argsEntries.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {argsEntries.map(([k, v]) => (
            <div key={k} className="flex gap-1.5 text-[8px] font-mono">
              <span className="text-violet-400/70 shrink-0">{k}:</span>
              <span className="text-zinc-400 break-all">{typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300)}</span>
            </div>
          ))}
        </div>
      )}

      {openResult && (
        <pre className="mt-1 text-[8px] font-mono text-zinc-400 bg-zinc-950/70 border border-zinc-800 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {parsed ? JSON.stringify(parsed, null, 2).slice(0, 6000) : msg.text.slice(0, 6000)}
        </pre>
      )}
    </div>
  );
});

const MessageBubble: React.FC<{ msg: ChatMessage }> = memo(({ msg }) => {
  if (msg.role === 'system') {
    return (
      <div className="border rounded-lg px-2 py-1.5 text-[8px] bg-zinc-900/60 border-zinc-800 text-zinc-500 italic break-words">
        {msg.text.length > 600 ? msg.text.slice(0, 600) + '…' : msg.text}
      </div>
    );
  }
  return (
    <div
      className={`border rounded-lg px-2 py-1.5 text-[9px] leading-relaxed break-words ${
        msg.role === 'user' ? 'bg-blue-600/10 border-blue-600/25 text-zinc-200 ml-6'
        : 'bg-zinc-900/50 border-zinc-800 text-zinc-300 mr-4'
      }`}>
      {msg.role === 'assistant'
        ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text}</ReactMarkdown>
        : msg.text}
    </div>
  );
});

// Stream preview isolated in its own component: it re-renders on stream
// ticks while memoized history bubbles (stable refs) skip them.
const StreamPreview: React.FC<{ stream: StreamState }> = memo(({ stream }) => (
  <div className="border rounded-lg px-2 py-1.5 text-[9px] leading-relaxed break-words bg-zinc-900/50 border-blue-600/25 text-zinc-300 mr-4">
    {stream.thinking && (
      <p className="text-[8px] text-zinc-500 italic mb-1 leading-relaxed whitespace-pre-wrap break-words">
        {stream.thinking.length > 400 ? 'Thinking…' : stream.thinking}
      </p>
    )}
    {stream.text
      ? <><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{stream.text}</ReactMarkdown><span className="text-blue-400 animate-pulse">▍</span></>
      : <p className="text-[9px] text-blue-400 animate-pulse font-mono">Agent is thinking…<span>▍</span></p>}
  </div>
));

interface AgentChatProps {
  projectId: string;
  pipelineRunning: boolean;
}

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

  useEffect(() => {
    // Only follow the stream while the user is already at the bottom —
    // never yank them away from history they are reading.
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages.length, running, activeTools.length, stream?.text.length, stream?.thinking.length]);

  const submit = () => {
    if (!input.trim() || running || pipelineRunning) return;
    send(input);
    setInput('');
  };

  return (
    <div className="glass-panel rounded-xl p-3 space-y-2 flex flex-col flex-1 min-h-[420px]">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <VscSparkle className="text-[var(--color-accent-primary)]" /> Agent Chat — same tools as MCP
          </h3>
          <p className="text-[8px] text-zinc-600 mt-0.5">
            The in-app agent uses the same tools + skill gates as the MCP server. It builds step by step and stops for review before render.
          </p>
        </div>
        <button onClick={clear} title="Clear chat history"
          className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer p-1">
          <VscTrash className="text-[12px]" />
        </button>
      </div>

      {pipelineRunning && (
        <div className="bg-amber-600/10 border border-amber-600/25 text-amber-300 p-2 rounded-lg text-[9px] font-bold">
          Pipeline is running — chat stage tools are locked until it finishes (one driver at a time).
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="space-y-1.5 flex-1 min-h-[160px] overflow-y-auto pr-1">
        {messages.length === 0 && !stream && activeTools.length === 0 && (
          <p className="text-[9px] text-zinc-600 text-center py-4 leading-relaxed">
            Ask the agent to work on this project, e.g.<br />
            <span className="text-zinc-400 font-mono">“Check project status and tell me what is missing”</span><br />
            <span className="text-zinc-400 font-mono">“Show me what is in scene 1”</span>
          </p>
        )}
        {messages.map((m) => {
          if (m.role === 'tool') return <ToolCard key={m.id} msg={m} />;
          if (m.role === 'thinking') return <ThinkingBlock key={m.id} msg={m} />;
          return <MessageBubble key={m.id} msg={m} />;
        })}
        {activeTools.map((t, i) => (
          <div key={`${t.tool}-${i}`} className="flex items-center gap-2 border rounded-lg px-2 py-1.5 bg-blue-600/5 border-blue-600/20">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <span className="text-[9px] font-mono text-blue-300 truncate">
              Running {t.tool}… <span className="text-zinc-500">{t.detail.slice(0, 120)}</span>
            </span>
          </div>
        ))}
        {running && activeTools.length === 0 && !stream && (
          <p className="text-[9px] text-blue-400 animate-pulse font-mono">Agent is thinking…</p>
        )}
        {stream && (stream.text || stream.thinking) && <StreamPreview stream={stream} />}
      </div>

      {pending ? (
        <div className={`${pending.kind === 'render' ? 'bg-emerald-600/10 border-emerald-600/25' : 'bg-red-600/10 border-red-600/25'} border rounded-lg p-2 space-y-1.5`}>
          <p className={`text-[9px] font-bold ${pending.kind === 'render' ? 'text-emerald-300' : 'text-red-300'}`}>
            {pending.kind === 'render'
              ? 'Human review gate: the build is ready. Review in the app, then approve the final render.'
              : `Approval needed: ${pending.tool} cannot be undone. Approve it to continue — or deny it.`}
          </p>
          {pending.kind !== 'render' && (
            <pre className="text-[8px] font-mono text-zinc-400 bg-zinc-950/70 border border-zinc-800 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
              {JSON.stringify(pending.args || {}, null, 2).slice(0, 1000)}
            </pre>
          )}
          <div className="flex gap-2">
            <button onClick={() => send(pending.kind === 'render' ? 'Approved — render the final video.' : `Approved — proceed with ${pending.tool}.`, { confirmRender: pending.kind === 'render', confirmAction: true })}
              className={`flex-1 flex items-center justify-center gap-1 text-[9px] py-1.5 font-bold text-white rounded transition-colors cursor-pointer ${pending.kind === 'render' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}>
              <VscCheck /> {pending.kind === 'render' ? 'Approve render' : 'Approve'}
            </button>
            <button onClick={() => send('Not approved.', { confirmAction: false })}
              className="flex-1 text-[9px] py-1.5 font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 transition-colors cursor-pointer">
              {pending.kind === 'render' ? 'Keep editing' : 'Deny'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={pipelineRunning ? 'Locked while pipeline runs…' : 'Ask the agent to build, fix, or explain…'}
          disabled={running || pipelineRunning}
          className="flex-1 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-2 text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-[var(--color-accent-primary)]/50 disabled:opacity-50"
        />
        {running ? (
          <button onClick={cancel} title="Stop agent turn"
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[12px] font-bold transition-colors cursor-pointer">
            <VscStopCircle />
          </button>
        ) : (
          <button onClick={submit} title="Send" disabled={!input.trim() || pipelineRunning}
            className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white text-[12px] font-bold transition-all disabled:opacity-40 cursor-pointer">
            <VscSend />
          </button>
        )}
      </div>
      <p className="text-[8px] text-zinc-600 text-center">Deletions, clears and the final render pause for your approval.</p>
    </div>
  );
};
