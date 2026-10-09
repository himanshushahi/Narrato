import { create } from 'zustand';
import { callApi } from '../utils/call-api';

interface ConnectivityState {
  /** Browser-level online flag (navigator.onLine + online/offline events). */
  browserOnline: boolean;
  /** Backend-probed internet flag (None = not yet probed). */
  internetUp: boolean | null;
  backendAlive: boolean;
  lastChecked: number;
  wasOffline: boolean;
  setBrowserOnline: (v: boolean) => void;
  probe: (force?: boolean) => Promise<boolean>;
  /** True when we should treat the machine as offline. */
  isOffline: () => boolean;
}

let inflight: Promise<boolean> | null = null;
// Monotonic probe id: a slow probe started while online must not overwrite
// a fresher offline state (browser event or a newer forced probe) when it
// finally resolves — that race silently cleared the banner right after it
// appeared, so going offline showed nothing while reconnecting toasted.
let probeSeq = 0;
// Passive probes must stay in sync with the backend cache (CACHE_TTL_S = 10s)
// so a drop without browser events is noticed within ~10s, not 30s.
const PASSIVE_THROTTLE_MS = 10000;

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  internetUp: null,
  backendAlive: true,
  lastChecked: 0,
  wasOffline: false,

  setBrowserOnline: (v) =>
    set((s) => ({
      browserOnline: v,
      // Browser says offline -> trust it immediately; online needs a probe.
      internetUp: v ? s.internetUp : false,
      wasOffline: s.wasOffline || !v,
    })),

  probe: async (force = false) => {
    // Explicit user actions (Retry/Resume/Send) bypass both the throttle
    // AND any passive probe already in flight — otherwise reconnect ->
    // immediate Resume still rejects as offline for up to 30s.
    if (!force && inflight) return inflight;
    // Startup race: App mounts before pywebview injects its JS bridge
    // (pywebviewready fires later, then pywebviewListeners pulls the
    // project list). callApi returns null while the bridge is missing,
    // which previously marked backendAlive=false -> false "Backend not
    // connected" banner until the next 30s passive probe cleared it,
    // even though Dashboard's (later) fetchProjects succeeded.
    // While the bridge itself is absent, stay optimistic and retry soon
    // instead of declaring the backend down.
    if (
      typeof window !== 'undefined' &&
      typeof (window as any).pywebview?.api?.check_connectivity !== 'function'
    ) {
      if (force) {
        window.setTimeout(() => {
          if (
            typeof (window as any).pywebview?.api?.check_connectivity === 'function'
          ) {
            get().probe(true);
          }
        }, 1500);
      }
      return get().browserOnline;
    }
    // Throttle passive probes; explicit Retry always forces.
    if (!force && Date.now() - get().lastChecked < PASSIVE_THROTTLE_MS && get().internetUp !== null) {
      const cur = get().internetUp;
      return cur !== false;
    }
    const mySeq = ++probeSeq;
    inflight = (async () => {
      try {
        const res = await callApi<{ success: boolean; internet?: boolean }>(
          'check_connectivity', force,
        );
        if (mySeq !== probeSeq) return get().browserOnline && get().internetUp !== false;
        if (res === null) {
          // Bridge exists but the call failed/returned nothing = backend down.
          // (Bridge-absent case returns early above and never marks down.)
          set({ backendAlive: false, lastChecked: Date.now() });
          return get().browserOnline;
        }
        const up = res.internet !== false;
        // Browser-offline wins over a stale backend "online" (backend cache
        // can return a healthy read for ~10s after the drop, and a slow
        // pre-drop probe can resolve after the offline event).
        const effective = get().browserOnline ? up : false;
        set((s) => ({
          internetUp: effective,
          backendAlive: true,
          lastChecked: Date.now(),
          wasOffline: s.wasOffline || !effective,
        }));
        return effective;
      } catch {
        if (mySeq !== probeSeq) return get().browserOnline && get().internetUp !== false;
        set({ backendAlive: false, lastChecked: Date.now() });
        return get().browserOnline;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  isOffline: () => {
    const s = get();
    if (!s.browserOnline) return true;
    if (s.internetUp === false) return true;
    return false;
  },
}));

/** Install once at app boot: browser events + periodic backend probe. */
export function initConnectivityListeners(onReconnect?: () => void, onOffline?: () => void) {
  const store = useConnectivityStore.getState();
  // Only probe once the pywebview bridge exists. Probing earlier always
  // yields null -> false backendAlive (see probe guard above).
  const bridgeReady = () =>
    typeof window !== 'undefined' &&
    typeof (window as any).pywebview?.api?.check_connectivity === 'function';
  if (bridgeReady()) {
    store.probe(true);
  } else {
    // pywebviewready fires when the bridge is injected (after first render);
    // the timeout covers hosts that become ready without the event.
    const onReady = () => useConnectivityStore.getState().probe(true);
    window.addEventListener('pywebviewready', onReady, { once: true });
    window.setTimeout(() => {
      if (bridgeReady()) useConnectivityStore.getState().probe(true);
    }, 2000);
    // Clean up the one-shot listener if dispose() runs first.
    (store as any).__connectivityReadyHandler = onReady;
  }

  const goOffline = () => {
    useConnectivityStore.getState().setBrowserOnline(false);
  };
  const goOnline = async () => {
    useConnectivityStore.getState().setBrowserOnline(true);
    await useConnectivityStore.getState().probe(true);
  };
  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);

  // Single transition channel: toast exactly once per online<->offline flip,
  // no matter which path detected it (browser event or backend probe).
  // Previously only reconnect toasted, so a drop showed just the banner —
  // and when the banner was delayed by the throttle, seemingly nothing.
  let prevOffline = useConnectivityStore.getState().isOffline();
  const unsub = useConnectivityStore.subscribe((s) => {
    const off = !s.browserOnline || s.internetUp === false;
    if (off === prevOffline) return;
    prevOffline = off;
    if (off) onOffline?.();
    else onReconnect?.();
  });

  // Steady-state re-probe so a mid-run drop is noticed even without
  // browser events (some WebView2 drops don't fire them reliably, and
  // Chromium's navigator.onLine can stay true behind a router with dead
  // WAN — only the backend probe sees that case).
  // Tick every 5s: healthy path stays throttled to PASSIVE_THROTTLE_MS
  // inside probe(false), but a backendAlive=false state force-retries here
  // so a false/real negative clears in seconds, not after a long window.
  const timer = setInterval(() => {
    const s = useConnectivityStore.getState();
    if (!s.backendAlive) s.probe(true);
    else s.probe(false);
  }, 5000);

  return () => {
    window.removeEventListener('offline', goOffline);
    window.removeEventListener('online', goOnline);
    const handler = (store as any).__connectivityReadyHandler;
    if (handler) window.removeEventListener('pywebviewready', handler);
    unsub();
    clearInterval(timer);
  };
}
