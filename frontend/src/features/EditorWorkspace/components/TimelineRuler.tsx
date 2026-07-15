import React from 'react';

const FPS = 30;
const HEADER_WIDTH = 110;

interface TimelineRulerProps {
  totalDuration: number;
  timelineZoom: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = React.memo(({ totalDuration, timelineZoom }) => {
  const marks: React.ReactNode[] = [];
  const totalSeconds = Math.ceil(totalDuration / FPS);
  const step = timelineZoom < 30 ? 10 : timelineZoom < 60 ? 5 : timelineZoom < 120 ? 2 : 1;
  for (let s = 0; s <= totalSeconds; s += step) {
    const x = s * timelineZoom;
    const isMajor = s % (step * 5) === 0;
    marks.push(
      <React.Fragment key={`ruler-${s}`}>
        <div className="absolute top-0" style={{ left: x + HEADER_WIDTH }}>
          <div className={`w-px ${isMajor ? 'h-3 bg-zinc-600' : 'h-1.5 bg-zinc-700'}`} />
          {isMajor && (
            <span className="text-[8px] font-mono text-zinc-500 absolute -translate-x-1/2 mt-1 select-none">
              {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      </React.Fragment>
    );
  }
  return <>{marks}</>;
});
TimelineRuler.displayName = 'TimelineRuler';
