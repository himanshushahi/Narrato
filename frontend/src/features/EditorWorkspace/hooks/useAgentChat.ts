import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi } from '../../../utils/call-api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
  text: string;
  tool?: string;
  args?: Record<string, any>;
  ok?: boolean;
  // Persisted system subtype from the backend (error | notice). Error =
  // agent-stopping failure (LLM/provider/budget); notice = user cancel.
  kind?: 'error' | 'notice';
  ts: number;
  // Canonical backend ordering key (monotonic per session). Persisted entries
  // always carry one; local-only provisionals don't until the backend
  // confirms them via a matching id/turn event or refresh snapshot.
  seq?: number;
  // LLM turn that produced this entry (stream id). Lets provisionals created
  // by commitStream reconcile against the persisted entry for the SAME turn
  // by key instead of by fuzzy text overlap.
  turn?: string;
  callId?: string;
  // Local-only entry not (yet) confirmed by persisted history: the user echo
  // and committed stream partials. Superseded by id/turn (see merge below)
  // and purged on clean done.
  provisional?: boolean;
}

// Exact-match normalization for the fallback path (old sessions without
// turn/seq, user echo). Deliberately NOT substring-based: substring overlap
// between two distinct narrations in one turn collapsed them into one slot
// and teleported survivors to the end of the list.
const normText = (t: string) => (t || '').trim().replace(/\r\n/g, '\n');

export interface ActiveTool {
  tool: string;
  detail: string;
  callId?: string;
}

export interface PendingConfirm {
  id: string;
  kind: 'render' | 'destructive' | string;
  tool: string;
  args: any;
}

export interface StreamState {
  id: string;
  text: string;
  thinking: string;
}

const uid = () => Math.random().toString(36).substring(2, 10);

const upsert = (prev: ChatMessage[], msg: ChatMessage): ChatMessage[] => {
  const i = prev.findIndex((m) => m.id === msg.id);
  if (i === -1) return [...prev, msg];
  const next = prev.slice();
  next[i] = msg;
  return next;
};

export function useAgentChat(projectId: string | undefined) {
  const sessionId = 'default';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [stream, setStream] = useState<StreamState | null>(null);
  const streamRef = useRef<StreamState | null>(null);
  // Stream deltas arrive per token — buffer them and flush to state at most
  // every ~120ms so each chunk doesn't re-render the whole history.
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshingRef = useRef(false);
  const refreshPendingRef = useRef(false);
  // Once a push event arrives the channel is alive — the poller drops to a
  // dead-man fallback cadence instead of racing every push with a full pull.
  const pushSeenRef = useRef(false);
  const [pushLive, setPushLive] = useState(false);
  const markPushSeen = useCallback(() => {
    if (!pushSeenRef.current) {
      pushSeenRef.current = true;
      setPushLive(true);
    }
  }, []);

  const flushStream = useCallback(() => {
    streamFlushRef.current = null;
    const s = streamRef.current;
    if (s) setStream({ ...s });
  }, []);

  const queueStreamFlush = useCallback(() => {
    if (!streamFlushRef.current) {
      streamFlushRef.current = setTimeout(flushStream, 120);
    }
  }, [flushStream]);

  // Commit the in-flight stream into the message list (as provisional
  // entries) so streamed text isn't lost when tools start / errors hit.
  // Upsert by id: several tool_starts can fire within one turn, and pushing
  // the same `${turn}-t` id twice creates duplicate React keys.
  // Blank-only content is dropped. A provisional is skipped when the SAME
  // turn already has a persisted entry (assistant/thinking events arrive
  // before tool_start and carry the persisted id + turn), or when an
  // exact-text match already exists in the current user-turn.
  const commitStream = useCallback((suffix = '') => {
    if (streamFlushRef.current) {
      clearTimeout(streamFlushRef.current);
      streamFlushRef.current = null;
    }
    const s = streamRef.current;
    streamRef.current = null;
    setStream(null);
    const text = s?.text && s.text.trim() ? s.text.trim() : '';
    const thinking = s?.thinking && s.thinking.trim() ? s.thinking.trim() : '';
    if (!text && !thinking) return;
    const now = Date.now() / 1000;
    setMessages((prev) => {
      let next = prev;
      const lastUserIdx = prev.map((m) => m.role).lastIndexOf('user');
      const currentTurn = lastUserIdx === -1 ? prev : prev.slice(lastUserIdx);

      if (thinking) {
        const thinkingNorm = normText(thinking);
        // The persisted thinking entry for this turn (if the backend already
        // emitted it) supersedes any stream partial — never duplicate it.
        const persistedForTurn = currentTurn.some((m) =>
          m.role === 'thinking' && !m.provisional && (m.turn === s!.id || normText(m.text) === thinkingNorm));
        if (!persistedForTurn) {
          const exists = currentTurn.some((m) => m.role === 'thinking' && normText(m.text) === thinkingNorm);
          if (!exists) {
            next = upsert(next, {
              id: `${s!.id}-t`, role: 'thinking', text: thinking,
              ts: now, turn: s!.id, provisional: true,
            });
          }
        }
      }
      if (text) {
        const fullText = normText(text + suffix);
        // Same-turn persisted assistant (delivered via the assistant event
        // just before tool_start) wins over the stream partial.
        const persistedForTurn = currentTurn.some((m) =>
          m.role === 'assistant' && !m.provisional && (m.turn === s!.id || normText(m.text) === fullText));
        if (!persistedForTurn) {
          const exists = currentTurn.some((m) => m.role === 'assistant' && normText(m.text) === fullText);
          if (!exists) {
            next = upsert(next, {
              id: s!.id, role: 'assistant', text: fullText,
              ts: now, turn: s!.id, provisional: true,
            });
          }
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    if (refreshingRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    refreshingRef.current = true;
    try {
      const res = await callApi<any>('chat_history', projectId, sessionId);
      if (!res) {
        // pywebview bridge missing (e.g. browser dev) — say so once instead
        // of looking silently dead.
        setMessages((prev) => prev.length ? prev : [{
          id: 'backend-unreachable', role: 'system',
          text: 'Backend unreachable — open this project in the desktop app to use agent chat.',
          ts: Date.now() / 1000,
        }]);
        return;
      }
      if (res?.success) {
        const mapped: ChatMessage[] = (res.messages || []).map((m: any) => ({
          id: m.id || uid(),
          role: m.role,
          text: String(m.text || ''),
          tool: m.tool,
          args: m.args,
          kind: m.kind,
          callId: m.call_id,
          seq: typeof m.seq === 'number' ? m.seq : undefined,
          turn: m.turn,
          ts: m.ts || Date.now() / 1000,
        }));
        // Canonical order: persisted entries sort by backend seq. Entries
        // without a seq (legacy sessions) keep their arrival order at the
        // position they were stored — never interleaved by timestamp, which
        // proved unstable across client/server float clocks.
        mapped.sort((a, b) => {
          if (typeof a.seq === 'number' && typeof b.seq === 'number') return a.seq - b.seq;
          return 0;
        });
        // Merge, not wholesale replace: keep the previous array (and every
        // unchanged message object) referentially stable when nothing changed,
        // so memoized bubbles skip re-render on no-op polls.
        setMessages((prev) => {
          const argsKey = (m: ChatMessage) => JSON.stringify(m.args ?? null);
          if (prev.length === mapped.length && prev.every((m, i) =>
            m.id === mapped[i].id && m.role === mapped[i].role &&
            m.text === mapped[i].text && m.tool === mapped[i].tool &&
            m.kind === mapped[i].kind &&
            argsKey(m) === argsKey(mapped[i]))) {
            return prev;
          }
          const byId = new Map(prev.map((m) => [m.id, m]));
          const next = mapped.map((m) => {
            const old = byId.get(m.id);
            if (old && old.role === m.role && old.text === m.text &&
                old.tool === m.tool && old.kind === m.kind && argsKey(old) === argsKey(m)) {
              // Adopt seq/turn/ts metadata without breaking memo identity.
              if (old.seq === m.seq && old.turn === m.turn && old.ts === m.ts) return old;
              return { ...old, seq: m.seq, turn: m.turn, ts: m.ts };
            }
            return m;
          });

          // Current turn in mapped (messages after the latest user message).
          const mappedLastUserIdx = mapped.map((m) => m.role).lastIndexOf('user');
          const mappedCurrentTurn = mappedLastUserIdx === -1 ? mapped : mapped.slice(mappedLastUserIdx);
          const persistedTurns = new Set(
            mappedCurrentTurn.filter((x) => !x.provisional && x.turn).map((x) => x.turn as string),
          );

          // Carry over local-only entries ONLY: provisional echoes/partials
          // and ephemeral system notices. Anything with a persisted id is
          // already in `next`. A provisional is absorbed (dropped) when the
          // same turn was persisted (id/turn match) or its exact normalized
          // text already exists in the current turn — no substring guessing,
          // which used to merge distinct narrations and strand survivors at
          // the end of the list out of order.
          // Provisionals keep their relative order and always trail the
          // persisted snapshot: they are by construction the newest items.
          for (const m of prev) {
            if (mapped.some((x) => x.id === m.id)) continue;
            if (!m.provisional) {
              // Non-provisional strays (e.g. superseded live upserts) never
              // re-enter: the snapshot is canonical for persisted entries.
              continue;
            }
            const mNorm = normText(m.text);
            if (!mNorm) continue;

            // Same-turn persisted entry supersedes this provisional.
            if (m.turn && persistedTurns.has(m.turn)) continue;

            const absorbed = mappedCurrentTurn.some((x) =>
              x.role === m.role && normText(x.text) === mNorm);
            if (absorbed) continue;

            const nextLastUserIdx = next.map((x) => x.role).lastIndexOf('user');
            const nextCurrentTurn = nextLastUserIdx === -1 ? next : next.slice(nextLastUserIdx);
            if (nextCurrentTurn.some((x) => x.role === m.role && normText(x.text) === mNorm)) {
              continue;
            }

            next.push(m);
          }

          return next;
        });
        setPending(res.pending || null);
        if (!res.running) {
          setRunning(false);
          setActiveTools([]);
        } else {
          setRunning(true);
        }
      }
    } finally {
      refreshingRef.current = false;
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        refresh();
      }
    }
  }, [projectId]);

  // Live push from backend ui_queue ("onChatEvent") + polling fallback.
  useEffect(() => {
    (window as any).onChatEvent = (evt: any) => {
      if (!evt || evt.project_id !== projectId) return;
      markPushSeen();
      if (evt.type === 'started') {
        setRunning(true);
        setActiveTools([]);
      } else if (evt.type === 'stream') {
        const turn = String(evt.turn || 'x');
        const delta = String(evt.delta || '');
        if (!delta) return;
        const next: StreamState = streamRef.current && streamRef.current.id === turn
          ? { ...streamRef.current }
          : { id: turn, text: '', thinking: '' };
        if (evt.kind === 'thinking') next.thinking += delta;
        else next.text += delta;
        streamRef.current = next;
        queueStreamFlush();
      } else if (evt.type === 'thinking') {
        // Persisted entry arrives with its stable id (+ turn/seq). Any
        // stream partial for the same turn is superseded — drop it so the
        // same reasoning block never occupies two slots.
        setMessages((prev) => {
          const turn = evt.turn;
          let next = upsert(prev, {
            id: evt.id || uid(), role: 'thinking',
            text: evt.text || '', ts: evt.ts || Date.now() / 1000,
            seq: typeof evt.seq === 'number' ? evt.seq : undefined,
            turn,
          });
          if (turn) {
            next = next.filter((m) =>
              !(m.provisional && m.turn === turn && m.id !== (evt.id || '')));
          }
          return next;
        });
      } else if (evt.type === 'assistant') {
        // Persisted narration for a turn (emitted right after the history
        // append, before tool_start). Supersedes the stream partial for the
        // same turn; commitStream later skips re-adding it (see above).
        setMessages((prev) => {
          const turn = evt.turn;
          let next = upsert(prev, {
            id: evt.id || uid(), role: 'assistant',
            text: evt.text || '', ts: evt.ts || Date.now() / 1000,
            seq: typeof evt.seq === 'number' ? evt.seq : undefined,
            turn,
          });
          if (turn) {
            next = next.filter((m) =>
              !(m.provisional && m.turn === turn && m.id !== (evt.id || '')));
          }
          return next;
        });
      } else if (evt.type === 'tool_start') {
        commitStream();
        setActiveTools((prev) => [...prev, { tool: evt.tool, detail: JSON.stringify(evt.args || {}), callId: evt.call_id }]);
      } else if (evt.type === 'tool_done') {
        // Remove one spinner instance (parallel same-tool calls each have
        // their own call_id); fall back to name match for legacy events.
        setActiveTools((prev) => {
          if (evt.call_id) {
            const i = prev.findIndex((t) => t.callId === evt.call_id);
            if (i !== -1) return [...prev.slice(0, i), ...prev.slice(i + 1)];
          }
          const i = prev.findIndex((t) => t.tool === evt.tool);
          return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)];
        });
        // Place the tool card immediately in event order (events arrive via
        // the ordered ui_queue). The follow-up refresh upgrades it in place
        // with full args + untruncated result under the same id.
        if (evt.id) {
          const toolMsg: ChatMessage = {
            id: evt.id, role: 'tool',
            text: evt.text || '', tool: evt.tool,
            ts: evt.ts || Date.now() / 1000,
            seq: typeof evt.seq === 'number' ? evt.seq : undefined,
            turn: evt.turn, callId: evt.call_id,
          };
          setMessages((prev) => upsert(prev, toolMsg));
        }
        // Pull the persisted entry (with args + full result) into the list.
        refresh();
      } else if (evt.type === 'confirm') {
        setPending({ id: evt.id, kind: evt.kind, tool: evt.tool, args: evt.args });
        setRunning(false);
        setActiveTools([]);
        refresh();
      } else if (evt.type === 'done' || evt.type === 'error') {
        setRunning(false);
        setActiveTools([]);
        streamRef.current = null;
        setStream(null);
        if (evt.type === 'done') {
          // Turn settled — backend history is canonical. Drop only
          // provisionals superseded by a persisted entry: same turn already
          // confirmed, or exact normalized text already present in the
          // current user-turn. User echoes are left for refresh() to absorb
          // (so a failed refresh can't erase the user's own message), and
          // error/cancel paths keep partials: they're all the user gets.
          setMessages((prev) => {
            if (!prev.some((m) => m.provisional)) return prev;
            const lastUserIdx = prev.map((m) => m.role).lastIndexOf('user');
            const persistedTurns = new Set(
              prev.filter((m) => !m.provisional && m.turn).map((m) => m.turn as string),
            );
            const currentTurn = lastUserIdx === -1 ? prev : prev.slice(lastUserIdx);
            return prev.filter((m) => {
              if (!m.provisional) return true;
              if (m.role === 'user') return true;
              if (m.turn && persistedTurns.has(m.turn)) return false;
              const mNorm = normText(m.text);
              if (mNorm && currentTurn.some((x) =>
                !x.provisional && x.role === m.role && normText(x.text) === mNorm)) {
                return false;
              }
              return true;
            });
          });
        }
        if (evt.type === 'error') {
          // Backend now persists the error (stable id/seq/turn) before
          // emitting. Upsert by that id so the follow-up refresh adopts it
          // instead of wiping it as a stray. If the error event carries no id
          // (e.g. out-of-session fallback in bridge._worker), mark it provisional
          // so refresh() carries it over instead of dropping it as a stray.
          const errMsg: ChatMessage = {
            id: evt.id || uid(), role: 'system', kind: 'error',
            text: evt.error || evt.text || 'Turn failed.',
            ts: evt.ts || Date.now() / 1000,
            seq: typeof evt.seq === 'number' ? evt.seq : undefined,
            turn: evt.turn,
            provisional: !evt.id,
          };
          setMessages((prev) => upsert(prev, errMsg));
        }
        refresh();
      } else if (evt.type === 'notice') {
        const noticeMsg: ChatMessage = {
          id: evt.id || uid(), role: 'system', kind: 'notice',
          text: evt.text || evt.error || '', ts: evt.ts || Date.now() / 1000,
          seq: typeof evt.seq === 'number' ? evt.seq : undefined,
          turn: evt.turn,
          provisional: !evt.id,
        };
        setMessages((prev) => upsert(prev, noticeMsg));
      }
    };
    return () => {
      (window as any).onChatEvent = undefined;
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }
    };
  }, [projectId, refresh, commitStream, markPushSeen, queueStreamFlush]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    // Poll only as a dead-man fallback: once pushes arrive, back off.
    const cadence = pushLive ? 10000 : 2500;
    if (running) {
      if (!pollRef.current) {
        pollRef.current = setInterval(refresh, cadence);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [running, refresh, pushLive]);

  const send = useCallback(async (text: string, opts?: { confirmRender?: boolean; confirmAction?: boolean }) => {
    if (!projectId || running) return;
    const trimmed = text.trim();
    if (!trimmed && !opts?.confirmRender && opts?.confirmAction === undefined) return;
    if (opts?.confirmAction === undefined) {
      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed || '(approved render)', ts: Date.now() / 1000, provisional: true }]);
    }
    setRunning(true);
    if (opts?.confirmRender || opts?.confirmAction !== undefined) setPending(null);
    const res = await callApi<any>(
      'chat_send', projectId, trimmed, sessionId,
      opts?.confirmRender || false,
      opts?.confirmAction === undefined ? null : opts.confirmAction,
    );
    if (!res?.success) {
      setRunning(false);
      setMessages((prev) => [...prev, { id: uid(), role: 'system', kind: 'error', text: res?.error || 'Failed to send.', ts: Date.now() / 1000, provisional: true }]);
      refresh();
    }
  }, [projectId, running, refresh]);

  const cancel = useCallback(async () => {
    if (!projectId) return;
    commitStream(' ⏹');
    await callApi('chat_cancel', projectId, sessionId);
    setRunning(false);
    setActiveTools([]);
    refresh();
  }, [projectId, refresh, commitStream]);

  const clear = useCallback(async () => {
    if (!projectId) return;
    await callApi('chat_clear', projectId, sessionId);
    setMessages([]);
    setActiveTools([]);
    streamRef.current = null;
    setStream(null);
    setPending(null);
  }, [projectId]);

  return { messages, activeTools, stream, running, pending, send, cancel, clear, refresh };
}
