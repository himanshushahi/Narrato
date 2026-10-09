import React, { useState } from 'react';
import { useConnectivityStore } from '../../store/useConnectivityStore';
import { useUIStore } from '../../store/useUIStore';

/**
 * Global offline banner: shows when the browser reports offline OR the
 * backend probe reports no internet. "Retry" forces a fresh probe.
 * Rendered at the top of both the dashboard and editor layouts.
 */
export const ConnectivityBanner: React.FC = () => {
  const browserOnline = useConnectivityStore((s) => s.browserOnline);
  const internetUp = useConnectivityStore((s) => s.internetUp);
  const backendAlive = useConnectivityStore((s) => s.backendAlive);
  const probe = useConnectivityStore((s) => s.probe);
  const addToast = useUIStore((s) => s.addToast);
  const [checking, setChecking] = useState(false);

  const offline = !browserOnline || internetUp === false;

  if (!offline && backendAlive) return null;

  const msg = !backendAlive
    ? 'Backend not connected — restart the app if this persists.'
    : 'You are offline — editing works, AI voice / assets / chat need internet. Progress is saved.';

  const retry = async () => {
    setChecking(true);
    try {
      const up = await probe(true);
      if (up) addToast('Back online.', 'success');
      else addToast('Still offline. Check your connection and retry.', 'warning', 4000);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="z-50 w-full bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-3 text-[11px] font-semibold text-amber-300">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
      <span className="truncate">{msg}</span>
      <button
        onClick={retry}
        disabled={checking}
        className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 disabled:opacity-50 transition-colors"
      >
        {checking ? 'Checking…' : 'Retry'}
      </button>
    </div>
  );
};
