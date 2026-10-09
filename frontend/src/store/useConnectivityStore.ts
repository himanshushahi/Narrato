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
    // Throttle passive probes to 30s; explicit Retry always forces.
    if (!force && Date.now() - get().lastChecked < 30000 && get().internetUp !== null) {
      const cur = get().internetUp;
      return cur !== false;
    }
    inflight = (async () => {
      try {
        const res = await callApi<{ success: boolean; internet?: boolean }>(
          'check_connectivity', force,
        );
        if (res === null) {
          // pywebview bridge missing/throwing = backend down, not offline net.
          set({ backendAlive: false, lastChecked: Date.now() });
          return get().browserOnline;
        }
        const up = res.internet !== false;
        set((s) => ({
          internetUp: up,
          backendAlive: true,
          lastChecked: Date.now(),
          wasOffline: s.wasOffline || !up,
        }));
        return up;
      } catch {
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
export function initConnectivityListeners(onReconnect?: () => void) {
  const store = useConnectivityStore.getState();
  // Initial probe (backend alive? internet up?).
  store.probe(true);

  const goOffline = () => {
    useConnectivityStore.getState().setBrowserOnline(false);
  };
  const goOnline = async () => {
    useConnectivityStore.getState().setBrowserOnline(true);
    const up = await useConnectivityStore.getState().probe(true);
    if (up && onReconnect) onReconnect();
  };
  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);

  // Passive re-probe every 30s so a mid-run drop is noticed even without
  // browser events (some WebView2 drops don't fire them reliably).
  const timer = setInterval(() => {
    useConnectivityStore.getState().probe(false);
  }, 30000);

  return () => {
    window.removeEventListener('offline', goOffline);
    window.removeEventListener('online', goOnline);
    clearInterval(timer);
  };
}
