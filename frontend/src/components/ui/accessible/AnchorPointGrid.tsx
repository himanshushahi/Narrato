import React, { memo, useRef } from 'react';

export type AnchorPoint =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface AnchorPointGridProps {
  value: AnchorPoint;
  onChange: (val: AnchorPoint) => void;
  label?: string;
  disabled?: boolean;
}

const GRID_POINTS: { id: AnchorPoint; label: string; row: number; col: number }[] = [
  { id: 'top-left', label: 'Top Left', row: 0, col: 0 },
  { id: 'top-center', label: 'Top Center', row: 0, col: 1 },
  { id: 'top-right', label: 'Top Right', row: 0, col: 2 },
  { id: 'center-left', label: 'Center Left', row: 1, col: 0 },
  { id: 'center', label: 'Center Center', row: 1, col: 1 },
  { id: 'center-right', label: 'Center Right', row: 1, col: 2 },
  { id: 'bottom-left', label: 'Bottom Left', row: 2, col: 0 },
  { id: 'bottom-center', label: 'Bottom Center', row: 2, col: 1 },
  { id: 'bottom-right', label: 'Bottom Right', row: 2, col: 2 },
];

export const AnchorPointGrid: React.FC<AnchorPointGridProps> = memo(({
  value = 'center',
  onChange,
  label = 'Anchor Pin',
  disabled = false,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, currentId: AnchorPoint) => {
    if (disabled) return;
    const current = GRID_POINTS.find(p => p.id === currentId);
    if (!current) return;

    let targetRow = current.row;
    let targetCol = current.col;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      targetRow = Math.max(0, current.row - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      targetRow = Math.min(2, current.row + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetCol = Math.max(0, current.col - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetCol = Math.min(2, current.col + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetRow = 0;
      targetCol = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetRow = 2;
      targetCol = 2;
    }

    const nextPoint = GRID_POINTS.find(p => p.row === targetRow && p.col === targetCol);
    if (nextPoint && nextPoint.id !== currentId) {
      onChange(nextPoint.id);
      const btn = gridRef.current?.querySelector<HTMLButtonElement>(`[data-anchor="${nextPoint.id}"]`);
      btn?.focus();
    }
  };

  const hasSelection = GRID_POINTS.some(p => p.id === value);

  return (
    <div className={`space-y-1 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {label && label.trim().length > 0 && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block select-none">
          {label}
        </span>
      )}
      <div
        ref={gridRef}
        role="radiogroup"
        aria-label={label || 'Anchor Pin'}
        className="w-20 h-20 p-1.5 bg-zinc-950/80 border border-zinc-800 rounded-lg grid grid-cols-3 grid-rows-3 gap-1 shadow-inner"
      >
        {GRID_POINTS.map((pt) => {
          const isSelected = pt.id === value;
          const isFocusable = isSelected || (!hasSelection && pt.id === 'center');
          return (
            <button
              key={pt.id}
              type="button"
              role="radio"
              data-anchor={pt.id}
              aria-checked={isSelected}
              tabIndex={isFocusable ? 0 : -1}
              onClick={() => onChange(pt.id)}
              onKeyDown={(e) => handleKeyDown(e, pt.id)}
              title={pt.label}
              className={`w-full h-full rounded flex items-center justify-center transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${
                isSelected
                  ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                  : 'bg-zinc-800/80 hover:bg-zinc-700'
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  isSelected ? 'bg-zinc-950' : 'bg-stone-400'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
});

AnchorPointGrid.displayName = 'AnchorPointGrid';
