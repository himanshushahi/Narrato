import React from 'react';

const HEADER_WIDTH = 110;

interface TrackHeaderProps {
  label: string;
  dotColor: string;
  children?: React.ReactNode;
}

export const TrackHeader: React.FC<TrackHeaderProps> = React.memo(({ label, dotColor, children }) => (
  <div
    className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-40 backdrop-blur-md"
    style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
  >
    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
    <div className="flex items-center gap-0.5">{children}</div>
  </div>
));
TrackHeader.displayName = 'TrackHeader';
