import React, { useRef, useState, useEffect } from 'react';

interface SubVisualsDurationBarProps {
  subVisuals: any[];
  onChange: (newRatios: number[]) => void;
  totalDurationFrames: number;
}

export const SubVisualsDurationBar: React.FC<SubVisualsDurationBarProps> = ({ subVisuals, onChange, totalDurationFrames }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratios, setRatios] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState<number | null>(null);

  const numSubs = subVisuals.length;

  useEffect(() => {
    let currentRatios = subVisuals.map(sv => sv.duration_ratio);
    const hasValidRatios = currentRatios.every(r => typeof r === 'number' && !isNaN(r)) && 
                           Math.abs(currentRatios.reduce((a, b) => a + b, 0) - 1.0) < 0.01;
    if (!hasValidRatios && numSubs > 0) {
      currentRatios = Array(numSubs).fill(1.0 / numSubs);
    }
    setRatios(currentRatios);
  }, [subVisuals, numSubs]);

  const MIN_SECONDS = 0.5;
  const totalDurationSeconds = totalDurationFrames / 30;
  const MIN_RATIO = totalDurationSeconds > 0 ? MIN_SECONDS / totalDurationSeconds : 0;

  const handlePointerDown = (index: number) => {
    setIsDragging(index);
    document.body.style.userSelect = 'none';
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (isDragging === null || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    let newSplitRatio = x / rect.width;

    const newRatios = [...ratios];
    let sumBefore = 0;
    for (let i = 0; i < isDragging; i++) {
      sumBefore += newRatios[i];
    }
    
    // Bounds for the dragged split
    const leftBound = sumBefore + MIN_RATIO;
    const rightBound = sumBefore + newRatios[isDragging] + newRatios[isDragging + 1] - MIN_RATIO;

    newSplitRatio = Math.max(leftBound, Math.min(newSplitRatio, rightBound));

    const leftRatio = newSplitRatio - sumBefore;
    const rightRatio = (newRatios[isDragging] + newRatios[isDragging + 1]) - leftRatio;

    newRatios[isDragging] = leftRatio;
    newRatios[isDragging + 1] = rightRatio;

    setRatios(newRatios);
  };

  const handlePointerUp = () => {
    if (isDragging !== null) {
      onChange(ratios);
      setIsDragging(null);
      document.body.style.userSelect = '';
    }
  };

  useEffect(() => {
    if (isDragging !== null) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, ratios]);

  if (numSubs <= 1 || totalDurationFrames === 0) return null;

  let cumulative = 0;
  const splits = ratios.slice(0, -1).map(r => {
    cumulative += r;
    return cumulative;
  });

  return (
    <div className="mb-4">
      <div className="flex justify-between items-end mb-1.5">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-[10px]">Adjust Durations</label>
        <span className="text-[9px] text-stone-500 font-mono">Total: {totalDurationSeconds.toFixed(1)}s</span>
      </div>
      
      <div 
        ref={containerRef}
        className="relative h-6 bg-black/40 border border-white/10 rounded-lg overflow-hidden flex"
      >
        {ratios.map((r, i) => {
          const durationS = r * totalDurationSeconds;
          return (
            <div 
              key={i} 
              style={{ width: `${r * 100}%` }}
              className={`h-full border-r border-black/20 flex items-center justify-center overflow-hidden transition-colors ${i % 2 === 0 ? 'bg-amber-500/10' : 'bg-amber-500/5'}`}
            >
              <span className="text-[9px] text-amber-500/80 font-mono font-medium truncate px-1">
                {durationS.toFixed(1)}s
              </span>
            </div>
          );
        })}

        {splits.map((split, i) => (
          <div
            key={i}
            style={{ left: `${split * 100}%` }}
            className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize group flex justify-center z-10"
            onPointerDown={() => handlePointerDown(i)}
          >
            <div className={`w-0.5 h-full transition-colors ${isDragging === i ? 'bg-amber-400' : 'bg-amber-500/50 group-hover:bg-amber-400'}`} />
            {/* Handle Thumb */}
            <div className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-4 rounded-sm border transition-all shadow-lg ${isDragging === i ? 'bg-amber-400 border-amber-300 scale-110' : 'bg-stone-700 border-stone-500 group-hover:bg-amber-500 group-hover:border-amber-400'}`} />
          </div>
        ))}
      </div>
    </div>
  );
};
