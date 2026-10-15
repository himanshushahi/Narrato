import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '../../../components/ui/GlassCard';
import { GlowButton } from '../../../components/ui/GlowButton';
import {
  VscServer, VscCheck, VscError, VscClippy, VscLink,
  VscWarning, VscBook, VscRefresh, VscChevronDown,
} from 'react-icons/vsc';
import { callApi } from '../../../utils/call-api';

interface McpStatus {
  running: boolean;
  url: string | null;
  port: number | null;
  tool_count: number;
  tools: string[];
  resource_count?: number;
  resources?: string[];
  resource_template_count?: number;
  resource_templates?: string[];
  prompt_count?: number;
  prompts?: string[];
}

const TOOL_GROUPS: { title: string; tools: { name: string; blurb: string }[] }[] = [
  {
    title: 'Project',
    tools: [
      { name: 'create_project', blurb: 'Create a project (format, duration, language, voice)' },
      { name: 'list_projects', blurb: 'List all projects with status' },
      { name: 'project_status', blurb: 'Full project row + per-stage states' },
      { name: 'delete_project', blurb: 'Permanently delete project + files' },
    ],
  },
  {
    title: 'Script, Design & Voice',
    tools: [
      { name: 'save_script', blurb: 'Validate + save agent-written narration' },
      { name: 'get_script', blurb: 'Read script back (ASTs stripped by default)' },
      { name: 'save_design', blurb: 'Save the design system cuts bind to' },
      { name: 'list_voice_options', blurb: 'Engines + voices to offer you' },
      { name: 'update_voice_settings', blurb: 'Change voice/speed/music volume' },
      { name: 'update_transcribe_settings', blurb: 'Change whisper model/device' },
      { name: 'update_subtitle_settings', blurb: 'Change subtitle styling (render-only reset)' },
      { name: 'get_transcription', blurb: 'Read word-level transcription & segments (section-scoped or global)' },

      { name: 'list_skills', blurb: 'Writing/visual guide catalogue' },
      { name: 'get_skill', blurb: 'Full guide markdown — or brief=true map / section="..." chunk for big skills' },
      { name: 'get_stage_skills', blurb: 'One-call starter pack per stage (satisfies skill gate)' },
      { name: 'append_skill_learning', blurb: 'Log persistent learnings and quality fixes to skill LEARNINGS.md' },
      { name: 'get_visuals', blurb: 'Read back sub-visuals for one section / single cut' },
      { name: 'probe_cut', blurb: 'Inspect one cut: JSON + timing + asset files' },
      { name: 'probe_scene', blurb: 'Inspect one section: per-cut summaries + variety' },
      { name: 'probe_asset', blurb: 'File truth for one media layer (exists/size/fix)' },
    ],
  },
  {
    title: 'Pipeline stages',
    tools: [
      { name: 'run_stage', blurb: 'Run voiceover / transcribe / assets / render (wait or background)' },
      { name: 'stage_status', blurb: 'Poll a background stage' },
      { name: 'sleep', blurb: 'Pause up to 120s between polls (sleep → stage_status until done)' },
      { name: 'cancel_stage', blurb: 'Stop a running agent stage' },
      { name: 'get_section_timings', blurb: 'True audio durations + word timestamps' },
      { name: 'save_visuals', blurb: 'Validate + save sub-visuals per section (variety stats, cut patch + dry-run)' },
      { name: 'save_visuals_batch', blurb: 'Whole video in 2 calls: batch dry-run → fix → batch persist' },
      { name: 'clear_visuals', blurb: 'Delete ALL visual ASTs (keeps narration/audio/design; optionally downloads)' },
      { name: 'clear_assets', blurb: 'Delete ALL downloaded assets (keeps cuts for re-fetch)' },
      { name: 'review_frame', blurb: 'Contact-sheet snapshots: rendered, composition or asset lineup — mandatory per-section review' },
    ],
  },
  {
    title: 'Research & files',
    tools: [
      { name: 'search_media', blurb: 'Verify stock queries (Pexels/Pixabay/Wiki/YouTube/Archive)' },
      { name: 'web_search', blurb: 'Fact research for scripts' },
      { name: 'list_project_files', blurb: 'Inspect project folder contents' },
      { name: 'read_project_file', blurb: 'Read text artifacts (manifests, logs)' },
    ],
  },
];

const STAGE_ORDER = [
  'create_project (+ list_voice_options → ask topic/style-hint/format/duration/language/export/voice)',
  'save_script',
  'run_stage(generate_voiceover) → run_stage(transcribe)',
  'get_section_timings + save_design + save_visuals (brief-first skills)',
  'run_stage(fetch_assets)',
  'review_frame(composition) per section AFTER fetch_assets → patch bad cuts (re-fetch if new query)',
  'STOP for human review → run_stage(render, confirm_render=true)',
];

const RULES_WHILE_RUNNING = [
  'Do not start the app pipeline (or Resume) on the same project — one driver at a time (app queue vs agent).',
  'Do not edit script.json, design.json, manifests or voiceover files by hand while a stage runs.',
  'Do not restart/close the app mid-stage — running tasks are marked failed on startup.',
  'Do not delete or move files inside the project folder mid-run.',
  'One agent session per project. A second session cannot see the first one\u2019s in-progress work.',
  'After an app restart, re-check project_status — pending stages resume cleanly, failed ones need a re-run.',
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CodeBlock: React.FC<{ title: string; code: string; copiedKey: string; onCopy: (key: string, text: string) => void; disabled?: boolean }> = ({
  title, code, copiedKey, onCopy, disabled,
}) => (
  <div className="bg-black/30 rounded-md border border-stone-800/50 overflow-hidden">
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-800/50">
      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{title}</span>
      <button
        type="button"
        onClick={() => onCopy(copiedKey, code)}
        disabled={disabled}
        className="flex items-center gap-1 text-[10px] font-bold text-stone-400 hover:text-stone-100 uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <VscClippy className="text-xs" />
        Copy
      </button>
    </div>
    <pre className="p-3 text-[11px] leading-relaxed text-stone-200 font-mono whitespace-pre-wrap break-all">{code}</pre>
  </div>
);

export const McpAgentCard: React.FC = () => {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const mounted = useRef(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callApi<McpStatus>('get_mcp_status');
      if (!mounted.current) return;
      if (res) {
        setStatus(res);
      } else {
        setError('Bridge unreachable — is the desktop app running?');
      }
    } catch {
      if (mounted.current) setError('Failed to reach the MCP endpoint.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchStatus();
    return () => { mounted.current = false; };
  }, [fetchStatus]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = useCallback(async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
    } else {
      setError('Copy failed — select the text and copy it manually.');
    }
  }, []);

  const url = status?.url || 'http://127.0.0.1:8765/mcp';
  const running = !!status?.running;

  const opencodeJson = `{\n  "mcp": {\n    "narrato": {\n      "type": "remote",\n      "url": "${url}",\n      "enabled": true\n    }\n  }\n}`;
  const claudeCmd = `claude mcp add --transport http narrato ${url}`;
  const genericJson = `{\n  "mcpServers": {\n    "narrato": { "url": "${url}" }\n  }\n}`;

  const liveTools: Set<string> = new Set(status?.tools || []);
  const grouped = TOOL_GROUPS.map((g) => ({
    ...g,
    tools: g.tools.filter((t) => liveTools.size === 0 || liveTools.has(t.name)),
  })).filter((g) => g.tools.length > 0);
  const known = new Set(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name)));
  const extra = (status?.tools || []).filter((t) => !known.has(t));

  return (
    <div>
      <GlassCard className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-stone-200 flex items-center gap-3 border-l-4 border-[var(--color-accent-primary)] pl-3 uppercase tracking-wider">
            <VscServer className="text-base text-[var(--color-accent-primary)]" />
            Agent Control (MCP)
          </h2>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wider border flex items-center gap-1 ${running
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
              : 'bg-stone-800/40 text-stone-400 border-stone-700/40'
              }`}>
              {loading ? 'Checking…' : running ? (
                <><VscCheck className="text-[10px]" /> Running</>
              ) : (
                <><VscError className="text-[10px]" /> Offline</>
              )}
            </span>
            <GlowButton variant="secondary" size="sm" type="button" onClick={fetchStatus} icon={<VscRefresh />}>
              Refresh
            </GlowButton>
          </div>
        </div>

        <p className="text-xs text-stone-400">
          External AI agents (Claude Code, opencode, Cursor…) drive the video pipeline through this
          local MCP endpoint — <span className="text-stone-200 font-semibold">no app LLM key needed</span>.
          The agent writes scripts, designs and visuals; the app executes voiceover, transcription,
          asset downloads and rendering. The server starts automatically with the app on loopback only.
        </p>

        {/* Endpoint URL */}
        <div className="bg-black/20 p-3 rounded-md border border-stone-800/40 space-y-2">
          <div className="flex items-center gap-2">
            <VscLink className="text-xs text-stone-500" />
            <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Endpoint</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-emerald-300 font-mono truncate">{url}</code>
            <button
              type="button"
              onClick={() => handleCopy('url', url)}
              disabled={!running}
              title={running ? 'Copy endpoint URL' : 'Endpoint offline — start the app first'}
              className="flex items-center gap-1 text-[10px] font-bold text-stone-300 hover:text-white uppercase tracking-wider border border-stone-700/60 rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <VscClippy className="text-xs" />
              {copied === 'url' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {!running && !loading && (
            <p className="text-[10px] text-amber-300/90">
              {error || 'Endpoint offline — connect snippets below are placeholders until the app brings it online.'}
            </p>
          )}
          <p className="text-[10px] text-stone-500">
            Host-bound to 127.0.0.1{status?.port ? ` · port ${status.port}` : ''} ·{' '}
            {status
              ? `${status.tool_count} tools · ${status.resource_count ?? 1} resource${(status.resource_count ?? 1) === 1 ? '' : 's'} · ${status.resource_template_count ?? 0} templates · ${status.prompt_count ?? 1} prompt${(status.prompt_count ?? 1) === 1 ? '' : 's'}`
              : 'start the app to bring it online'} · loopback only, never exposed to a network.
          </p>
          {status && (status.resource_template_count ?? 0) === 0 && (
            <p className="text-[10px] text-stone-500">
              0 resource templates is by design — reads stay as tools (skill-gate tracking + structured args don&apos;t fit URI templates).
              Agents calling resources/list + resources/templates/list during discovery is correct MCP behavior.
            </p>
          )}
        </div>

        {/* How to connect */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-stone-200 uppercase tracking-wider">How to connect your agent</h3>
          <CodeBlock title="opencode.json" code={opencodeJson} copiedKey="opencode" onCopy={handleCopy} disabled={!running} />
          <CodeBlock title="Claude Code (terminal)" code={claudeCmd} copiedKey="claude" onCopy={handleCopy} disabled={!running} />
          <CodeBlock title="Cursor / Claude Desktop / Gemini (mcpServers)" code={genericJson} copiedKey="generic" onCopy={handleCopy} disabled={!running} />
          {copied && copied !== 'url' && (
            <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
              <VscCheck /> Copied — paste it into your agent config and restart/reload the agent.
            </p>
          )}
        </div>

        {/* Stage order */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-stone-200 uppercase tracking-wider flex items-center gap-2">
            <VscBook className="text-xs text-stone-500" /> How a build flows
          </h3>
          <ol className="space-y-1.5">
            {STAGE_ORDER.map((step, i) => (
              <li key={step} className="flex items-center gap-2 text-xs text-stone-300">
                <span className="w-5 h-5 shrink-0 rounded-full bg-black/40 border border-stone-700/60 flex items-center justify-center text-[10px] font-bold text-stone-400">
                  {i + 1}
                </span>
                <code className="font-mono text-[11px]">{step}</code>
              </li>
            ))}
          </ol>
          <p className="text-[10px] text-stone-500">
            Long stages (voiceover, transcribe, render) run in background — the agent loops sleep → stage_status until done, and mutating tools stay locked meanwhile.
            The agent authors visuals itself (generate_visuals is not an MCP stage).
          </p>
          <div className="bg-amber-950/20 border border-amber-800/30 rounded-md px-3 py-2">
            <p className="text-[11px] text-amber-200 font-medium">
              Human review gate: the agent builds through asset download, then stops and asks you
              to review/edit in the app. The final render only runs after your explicit approval
              (confirm_render=true) — it can never render behind your back.
            </p>
          </div>
        </div>

        {/* Rules */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
            <VscWarning className="text-xs" /> While the agent is working — don’t
          </h3>
          <ul className="space-y-1.5">
            {RULES_WHILE_RUNNING.map((rule) => (
              <li key={rule} className="flex items-start gap-2 text-xs text-stone-300">
                <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500/80" />
                {rule}
              </li>
            ))}
          </ul>
        </div>

        {/* Tool inventory */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-bold text-stone-200 uppercase tracking-wider"
          >
            <VscChevronDown className={`text-xs transition-transform ${showTools ? 'rotate-180' : ''}`} />
            Registered tools ({status ? status.tool_count : TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)})
          </button>
          {showTools && (
            <div className="space-y-4">
              {grouped.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">{group.title}</h4>
                  <div className="grid grid-cols-1 gap-1.5">
                    {group.tools.map((tool) => (
                      <div key={tool.name} className="flex items-baseline gap-2 bg-black/20 rounded px-2.5 py-1.5 border border-stone-800/40">
                        <code className="text-[11px] text-stone-100 font-mono shrink-0">{tool.name}</code>
                        <span className="text-[11px] text-stone-500 truncate">{tool.blurb}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {extra.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Other</h4>
                  {extra.map((name) => (
                    <div key={name} className="bg-black/20 rounded px-2.5 py-1.5 border border-stone-800/40">
                      <code className="text-[11px] text-stone-100 font-mono">{name}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-[10px] text-stone-500">
          Advanced: override the port with NARRATO_MCP_PORT, or disable the endpoint with NARRATO_MCP_DISABLE=1.
          The agent also gets a built-in build guide (narrato://pipeline-guide) and a make_video starter prompt.
        </p>
      </GlassCard>
    </div>
  );
};
