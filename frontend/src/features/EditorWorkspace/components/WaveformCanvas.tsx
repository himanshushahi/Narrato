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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!peaks || peaks.length === 0 || !totalAudioDuration || totalAudioDuration <= 0) {
      // Placeholder subtle center line
      ctx.strokeStyle = isCut || isMuted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const totalPeaks = peaks.length;
    const startPeakIdx = Math.max(0, Math.floor((startTime / totalAudioDuration) * totalPeaks));
    const endPeakIdx = Math.min(totalPeaks, Math.floor(((startTime + duration) / totalAudioDuration) * totalPeaks));
    const slicePeaksCount = Math.max(1, endPeakIdx - startPeakIdx);

    // Sharp square vertical bars
    const barWidth = 2;
    const barGap = 1;
    const step = barWidth + barGap;
    const totalBars = Math.floor(width / step);

    const centerY = height / 2;
    const maxBarHeight = (height / 2) - 2;

    ctx.fillStyle = isCut || isMuted ? 'rgba(239, 68, 68, 0.4)' : color;

    for (let i = 0; i < totalBars; i++) {
      const peakFraction = i / totalBars;
      const peakIdx = startPeakIdx + Math.floor(peakFraction * slicePeaksCount);
      const amp = Math.min(1.0, Math.max(0.08, peaks[peakIdx] || 0.08));

      const barH = Math.max(2, amp * maxBarHeight);
      const x = i * step;
      const y = centerY - barH;

      // Draw sharp square bars (mirrored around center)
      ctx.fillRect(x, y, barWidth, barH * 2);
    }
  }, [peaks, totalAudioDuration, startTime, duration, width, height, color, isMuted, isCut]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px` }}
      className="pointer-events-none block"
    />
  );
});

WaveformCanvas.displayName = 'WaveformCanvas';
