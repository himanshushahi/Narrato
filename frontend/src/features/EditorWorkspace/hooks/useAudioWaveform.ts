import { useState, useEffect } from 'react';

// Global cache so waveforms are decoded only ONCE per session/URL (capped at 50 to prevent leaks)
const MAX_CACHE_SIZE = 50;
const waveformCache = new Map<string, { peaks: Float32Array; duration: number }>();
const pendingFetches = new Map<string, Promise<{ peaks: Float32Array; duration: number } | null>>();

export function getCleanAudioKey(url?: string): string {
  if (!url) return '';
  return url.replace(/([?&])t=\d+(&|$)/g, '$1').replace(/[?&]$/, '');
}

export function useAudioWaveform(audioUrl?: string) {
  const cleanKey = getCleanAudioKey(audioUrl);

  const [data, setData] = useState<{ peaks: Float32Array; duration: number } | null>(() => {
    if (cleanKey && waveformCache.has(cleanKey)) {
      return waveformCache.get(cleanKey)!;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!audioUrl || !cleanKey) {
      setData(null);
      return;
    }

    if (waveformCache.has(cleanKey)) {
      const cached = waveformCache.get(cleanKey)!;
      setData(cached);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    let fetchPromise = pendingFetches.get(cleanKey);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        try {
          const res = await fetch(audioUrl);
          if (!res.ok) return null;
          const arrayBuffer = await res.arrayBuffer();
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) return null;
          
          const audioCtx = new AudioContextClass();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          await audioCtx.close();

          const rawData = audioBuffer.getChannelData(0);
          const duration = audioBuffer.duration;
          // Sample ~60 peaks per second for high resolution waveform
          const peaksCount = Math.max(120, Math.floor(duration * 60));
          const step = Math.max(1, Math.floor(rawData.length / peaksCount));
          const peaks = new Float32Array(peaksCount);

          for (let i = 0; i < peaksCount; i++) {
            let max = 0;
            const start = i * step;
            const end = Math.min(start + step, rawData.length);
            for (let j = start; j < end; j++) {
              const val = Math.abs(rawData[j]);
              if (val > max) max = val;
            }
            peaks[i] = max;
          }

          const result = { peaks, duration };
          if (waveformCache.size >= MAX_CACHE_SIZE) {
            const firstKey = waveformCache.keys().next().value;
            if (firstKey) waveformCache.delete(firstKey);
          }
          waveformCache.set(cleanKey, result);
          return result;
        } catch (e) {
          console.warn('Failed to extract audio waveform:', e);
          return null;
        } finally {
          pendingFetches.delete(cleanKey);
        }
      })();
      pendingFetches.set(cleanKey, fetchPromise);
    }

    fetchPromise.then((result) => {
      if (isMounted) {
        setData(result);
        setIsLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [audioUrl, cleanKey]);

  return { peaks: data?.peaks, duration: data?.duration, isLoading };
}
