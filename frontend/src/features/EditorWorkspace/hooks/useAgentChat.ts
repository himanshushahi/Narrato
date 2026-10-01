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
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Commit the in-flight stream into the message list (as provisional
  // entries) so streamed text isn't lost when tools start / errors hit.
  // The next refresh() reconciles against persisted history by id.
  const commitStream = useCallback((suffix = '') => {
    const s = streamRef.current;
    streamRef.current = null;
    setStream(null);
    if (!s || (!s.text && !s.thinking)) return;
    setMessages((prev) => {
      const next = prev.slice();
      if (s.thinking) next.push({ id: `${s.id}-t`, role: 'thinking', text: s.thinking, ts: Date.now() / 1000 });
      if (s.text) next.push({ id: s.id, role: 'assistant', text: s.text + suffix, ts: Date.now() / 1000 });
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
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
      setMessages(mapped);
      setPending(res.pending || null);
      if (!res.running) {
        setRunning(false);
        setActiveTools([]);
      } else {
        setRunning(true);
      }
    }
  }, [projectId]);

  // Live push from backend ui_queue ("onChatEvent") + polling fallback.
  useEffect(() => {
    (window as any).onChatEvent = (evt: any) => {
      if (!evt || evt.project_id !== projectId) return;
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
        setStream(next);
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
        if (evt.type === 'error') {
          setMessages((prev) => [...prev, { id: uid(), role: 'system', text: evt.error || 'Turn failed.', ts: Date.now() / 1000 }]);
        }
        refresh();
      } else if (evt.type === 'notice') {
        setMessages((prev) => [...prev, { id: uid(), role: 'system', text: evt.text || '', ts: Date.now() / 1000 }]);
      }
    };
    return () => { (window as any).onChatEvent = undefined; };
  }, [projectId, refresh, commitStream]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (running) {
      if (!pollRef.current) {
        pollRef.current = setInterval(refresh, 2500);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [running, refresh]);

  const send = useCallback(async (text: string, opts?: { confirmRender?: boolean; confirmAction?: boolean }) => {
    if (!projectId || running) return;
    const trimmed = text.trim();
    if (!trimmed && !opts?.confirmRender && opts?.confirmAction === undefined) return;
    if (opts?.confirmAction === undefined) {
      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed || '(approved render)', ts: Date.now() / 1000 }]);
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
