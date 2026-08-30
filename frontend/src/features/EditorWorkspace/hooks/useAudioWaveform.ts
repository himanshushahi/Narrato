import { useState, useEffect } from 'react';

// Global cache so waveforms are decoded only ONCE per session/URL
const waveformCache = new Map<string, { peaks: Float32Array; duration: number }>();
const pendingFetches = new Map<string, Promise<{ peaks: Float32Array; duration: number } | null>>();

export function useAudioWaveform(audioUrl?: string) {
  const [data, setData] = useState<{ peaks: Float32Array; duration: number } | null>(() => {
    if (audioUrl && waveformCache.has(audioUrl)) {
      return waveformCache.get(audioUrl)!;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!audioUrl) {
      setData(null);
      return;
    }

    if (waveformCache.has(audioUrl)) {
      setData(waveformCache.get(audioUrl)!);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    let fetchPromise = pendingFetches.get(audioUrl);
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
          waveformCache.set(audioUrl, result);
          return result;
        } catch (e) {
          console.warn('Failed to extract audio waveform:', e);
          return null;
        } finally {
          pendingFetches.delete(audioUrl);
        }
      })();
      pendingFetches.set(audioUrl, fetchPromise);
    }

    fetchPromise.then((result) => {
      if (isMounted) {
        setData(result);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [audioUrl]);

  return { peaks: data?.peaks, duration: data?.duration, isLoading };
}
