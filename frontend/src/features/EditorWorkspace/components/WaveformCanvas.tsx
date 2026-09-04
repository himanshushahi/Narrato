import React, { useRef, useEffect } from 'react';

interface WaveformCanvasProps {
  peaks?: Float32Array;
  totalAudioDuration?: number;
  startTime?: number; // slice start offset in seconds
  duration: number;   // slice duration in seconds
  width: number;
  height?: number;
  color?: string;
  isMuted?: boolean;
  isCut?: boolean;
  loop?: boolean;
  fadeInDuration?: number;
  fadeOutDuration?: number;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = React.memo(({
  peaks,
  totalAudioDuration,
  startTime = 0,
  duration,
  width,
  height = 24,
  color = '#10b981',
  isMuted = false,
  isCut = false,
  loop = false,
  fadeInDuration = 0,
  fadeOutDuration = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.floor(width * dpr));
    const targetH = Math.max(1, Math.floor(height * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!peaks || peaks.length === 0 || !totalAudioDuration || totalAudioDuration <= 0 || duration <= 0) {
      // Placeholder subtle center line
      ctx.strokeStyle = isCut || isMuted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const totalPeaks = peaks.length;
    const barWidth = 2;
    const barGap = 1;
    const step = barWidth + barGap;
    const totalBars = Math.floor(width / step);

    const centerY = height / 2;
    const maxBarHeight = (height / 2) - 2;

    for (let i = 0; i < totalBars; i++) {
      const t = (i / totalBars) * duration;
      const rawTime = startTime + t;

      if (!loop && rawTime > totalAudioDuration) {
        continue;
      }

      const effectiveTime = loop ? (rawTime % totalAudioDuration) : rawTime;
      const peakFraction = Math.max(0, Math.min(1, effectiveTime / totalAudioDuration));
      const peakIdx = Math.min(totalPeaks - 1, Math.floor(peakFraction * totalPeaks));
      const amp = Math.min(1.0, Math.max(0.08, peaks[peakIdx] || 0.08));

      // Calculate fade volume multiplier
      let fadeVol = 1.0;
      if (fadeInDuration > 0 && t < fadeInDuration) {
        fadeVol = Math.min(fadeVol, Math.max(0.1, t / fadeInDuration));
      }
      if (fadeOutDuration > 0 && t > duration - fadeOutDuration) {
        const remaining = duration - t;
        fadeVol = Math.min(fadeVol, Math.max(0.1, remaining / fadeOutDuration));
      }

      const barH = Math.max(2, amp * maxBarHeight * fadeVol);
      const x = i * step;
      const y = centerY - barH;

      ctx.fillStyle = isCut || isMuted
        ? 'rgba(239, 68, 68, 0.4)'
        : (fadeVol < 0.9 ? `${color}bb` : color);

      ctx.fillRect(x, y, barWidth, barH * 2);

      // Draw subtle loop boundary notch if loop wrapped around nearby
      if (loop && i > 0 && rawTime > totalAudioDuration) {
        const prevT = ((i - 1) / totalBars) * duration;
        const prevRaw = startTime + prevT;
        if (Math.floor(rawTime / totalAudioDuration) > Math.floor(prevRaw / totalAudioDuration)) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 2);
          ctx.lineTo(x, height - 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }, [peaks, totalAudioDuration, startTime, duration, width, height, color, isMuted, isCut, loop, fadeInDuration, fadeOutDuration]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px` }}
      className="pointer-events-none block"
    />
  );
});

WaveformCanvas.displayName = 'WaveformCanvas';
