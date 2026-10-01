import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi } from '../../../utils/call-api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
  text: string;
  tool?: string;
  args?: Record<string, any>;
  ok?: boolean;
  ts: number;
  // Local-only entry not (yet) confirmed by persisted history: the user echo
  // and committed stream partials. The backend assigns a fresh random id to
  // every persisted entry, so provisionals can NEVER reconcile by id — they
  // are superseded by content (see merge below) and purged on clean done.
  provisional?: boolean;
}

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
  // Blank-only content is dropped. Also avoids adding a provisional assistant
  // message if one with matching text is already present.
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
        const exists = currentTurn.some((m) => m.role === 'thinking' && m.text.trim() === thinking);
        if (!exists) {
          next = upsert(next, {
            id: `${s!.id}-t`, role: 'thinking', text: thinking,
            ts: now, provisional: true,
          });
        }
      }
      if (text) {
        const fullText = (text + suffix).trim();
        // Guard against duplicate assistant narration: if an assistant message
        // with matching text already exists in the current turn, skip adding a duplicate.
        const exists = currentTurn.some((m) => m.role === 'assistant' && (
          m.text.trim() === fullText ||
          (m.text.trim().length >= 20 && (m.text.includes(fullText) || fullText.includes(m.text.trim())))
        ));
        if (!exists) {
          next = upsert(next, {
            id: s!.id, role: 'assistant', text: fullText,
            ts: now, provisional: true,
          });
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
          ts: m.ts || Date.now() / 1000,
        }));
        // Merge, not wholesale replace: keep the previous array (and every
        // unchanged message object) referentially stable when nothing changed,
        // so memoized bubbles skip re-render on no-op polls.
        setMessages((prev) => {
          const argsKey = (m: ChatMessage) => JSON.stringify(m.args ?? null);
          if (prev.length === mapped.length && prev.every((m, i) =>
            m.id === mapped[i].id && m.role === mapped[i].role &&
            m.text === mapped[i].text && m.tool === mapped[i].tool &&
            argsKey(m) === argsKey(mapped[i]))) {
            return prev;
          }
          const byId = new Map(prev.map((m) => [m.id, m]));
          const next = mapped.map((m) => {
            const old = byId.get(m.id);
            if (old && old.role === m.role && old.text === m.text &&
                old.tool === m.tool && argsKey(old) === argsKey(m)) {
              return old;
            }
            return m;
          });

          // Text normalization (strip trailing whitespace & line endings)
          const norm = (t: string) => (t || '').trim().replace(/\r\n/g, '\n');

          // Current turn in mapped (messages after the latest user message in mapped)
          const mappedLastUserIdx = mapped.map((m) => m.role).lastIndexOf('user');
          const mappedCurrentTurn = mappedLastUserIdx === -1 ? mapped : mapped.slice(mappedLastUserIdx);

          // For any message in prev not present by id in mapped:
          // Keep only local-only unpersisted entries (e.g. system notices, or
          // provisional user/assistant messages that backend hasn't saved yet).
          for (const m of prev) {
            if (mapped.some((x) => x.id === m.id)) continue;
            const mNorm = norm(m.text);
            if (!mNorm) continue;

            // If user message is provisional, check if backend already persisted it in the current turn
            if (m.role === 'user') {
              const absorbed = mappedCurrentTurn.some((x) => x.role === 'user' && norm(x.text) === mNorm);
              if (absorbed) continue;
            }

            // If assistant or thinking message is provisional, check if backend already persisted it in the current turn
            if (m.role === 'assistant' || m.role === 'thinking') {
              const absorbed = mappedCurrentTurn.some((x) => {
                if (x.role !== m.role) return false;
                const xNorm = norm(x.text);
                if (xNorm === mNorm) return true;
                if (mNorm.length >= 20 && xNorm.length >= 20 && (xNorm.includes(mNorm) || mNorm.includes(xNorm))) {
                  return true;
                }
                return false;
              });
              if (absorbed) continue;
            }

            // Skip if next already contains an identical message in the current turn
            const nextLastUserIdx = next.map((x) => x.role).lastIndexOf('user');
            const nextCurrentTurn = nextLastUserIdx === -1 ? next : next.slice(nextLastUserIdx);
            if (nextCurrentTurn.some((x) => x.role === m.role && norm(x.text) === mNorm)) {
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
        setMessages((prev) => upsert(prev, {
          id: evt.id || uid(), role: 'thinking',
          text: evt.text || '', ts: Date.now() / 1000,
        }));
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
          // Turn settled — backend history is canonical; drop provisionals
          // so committed partials can't linger next to their persisted full
          // text. Error/cancel keep them: the partial is all the user gets.
          setMessages((prev) => prev.some((m) => m.provisional)
            ? prev.filter((m) => !m.provisional) : prev);
        }
        if (evt.type === 'error') {
          setMessages((prev) => [...prev, { id: uid(), role: 'system', text: evt.error || 'Turn failed.', ts: Date.now() / 1000 }]);
        }
        refresh();
      } else if (evt.type === 'notice') {
        setMessages((prev) => [...prev, { id: uid(), role: 'system', text: evt.text || '', ts: Date.now() / 1000 }]);
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
      setMessages((prev) => [...prev, { id: uid(), role: 'system', text: res?.error || 'Failed to send.', ts: Date.now() / 1000 }]);
    }
  }, [projectId, running]);

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
