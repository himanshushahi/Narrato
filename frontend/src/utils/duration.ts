export const estimateTextDuration = (text: string | undefined | null): number => {
  if (!text || text.trim() === '') return 5;
  return Math.max(5, Math.ceil(text.length / 15));
};

export const calculateSubVisualTimings = (subVisuals: any[], durationFrames: number, startFrame: number = 0, fps: number = 30) => {
  const numSubs = subVisuals.length;
  if (numSubs === 0) return [];

  const svDurations = subVisuals.map(sv => sv.duration);
  const allDurationsValid = svDurations.every(d => typeof d === 'number' && !isNaN(d) && d > 0);

  const ratios = subVisuals.map(s => s.duration_ratio);
  const hasValidRatios = ratios.every((r: any) => typeof r === 'number' && !isNaN(r)) && 
                         Math.abs(ratios.reduce((a: number, b: number) => a + b, 0) - 1.0) < 0.01;

  let currentOffset = startFrame;
  const subs = subVisuals.map((_, idx) => {
    let subDuration = 1;

    if (hasValidRatios) {
      subDuration = idx === numSubs - 1
        ? Math.max(1, startFrame + durationFrames - currentOffset)
        : Math.max(1, Math.round(durationFrames * ratios[idx]));
    } else if (allDurationsValid) {
      subDuration = Math.max(1, Math.round((svDurations[idx] as number) * fps));
      if (idx === numSubs - 1) {
        subDuration = Math.max(1, startFrame + durationFrames - currentOffset);
      }
    } else {
      subDuration = idx === numSubs - 1
        ? Math.max(1, startFrame + durationFrames - currentOffset)
        : Math.max(1, Math.floor(durationFrames / numSubs));
    }
    
    const subFrom = currentOffset;
    const subEnd = subFrom + Math.max(1, subDuration);
    currentOffset = subEnd;
    
    return { start: subFrom, end: subEnd };
  });

  return subs;
};
