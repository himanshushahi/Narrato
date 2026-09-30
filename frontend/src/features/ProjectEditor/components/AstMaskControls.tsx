import React, { memo } from 'react';
import { ASTLayerMask, ASTMaskShape, ASTMaskReveal, ASTPolygonPreset } from '../../../components/video/ASTAnimator';
import { BiTrashAlt } from 'react-icons/bi';

interface AstMaskControlsProps {
  mask?: ASTLayerMask;
  onChange: (mask: ASTLayerMask | undefined) => void;
}

const SHAPES: { id: ASTMaskShape; label: string; icon: string }[] = [
  { id: 'none', label: 'None', icon: '🚫' },
  { id: 'circle', label: 'Circle', icon: '⭕' },
  { id: 'ellipse', label: 'Ellipse', icon: '🕳️' },
  { id: 'inset', label: 'Inset Box', icon: '🔲' },
  { id: 'polygon', label: 'Polygon', icon: '🔷' },
];

const POLYGON_PRESETS: { id: ASTPolygonPreset; label: string; icon: string }[] = [
  { id: 'hexagon', label: 'Hexagon', icon: '⬡' },
  { id: 'diamond', label: 'Diamond', icon: '◆' },
  { id: 'triangle', label: 'Triangle', icon: '▲' },
  { id: 'star', label: '5-Point Star', icon: '★' },
  { id: 'slant_left', label: 'Slant Left', icon: '▰' },
  { id: 'slant_right', label: 'Slant Right', icon: '▰' },
  { id: 'custom', label: 'Custom Points', icon: '✎' },
];

const REVEAL_MODES: { id: ASTMaskReveal; label: string; icon: string }[] = [
  { id: 'none', label: 'None (Static Mask)', icon: '⏸️' },
  { id: 'circle_iris', label: 'Circle Iris (Expand Out)', icon: '🟢' },
  { id: 'wipe_right', label: 'Wipe Right (Horizontal)', icon: '▶️' },
  { id: 'wipe_down', label: 'Wipe Down (Vertical)', icon: '🔽' },
  { id: 'split_vertical', label: 'Split Curtain (Center Out)', icon: '↔️' },
  { id: 'wipe_diagonal', label: 'Wipe Diagonal', icon: '↘️' },
];

function parseNumeric(val: number | string | undefined, defaultVal: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^-\d.]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return defaultVal;
}

export const AstMaskControls: React.FC<AstMaskControlsProps> = memo(({ mask = {}, onChange }) => {
  const shape = mask.shape || 'none';
  const reveal = mask.reveal || 'none';

  const update = (patch: Partial<ASTLayerMask>) => {
    const next: ASTLayerMask = { ...mask, ...patch };
    onChange(next);
  };

  const handleShapeChange = (newShape: ASTMaskShape) => {
    if (newShape === 'none') {
      if (!mask.reveal || mask.reveal === 'none') {
        onChange(undefined);
        return;
      }
      update({ shape: 'none' });
      return;
    }

    const updates: Partial<ASTLayerMask> = { shape: newShape };
    if (newShape === 'circle') {
      updates.size = mask.size ?? 50;
      updates.x = mask.x ?? 50;
      updates.y = mask.y ?? 50;
    } else if (newShape === 'ellipse') {
      updates.rx = mask.rx ?? 50;
      updates.ry = mask.ry ?? 35;
      updates.x = mask.x ?? 50;
      updates.y = mask.y ?? 50;
    } else if (newShape === 'inset') {
      updates.top = mask.top ?? 10;
      updates.right = mask.right ?? 10;
      updates.bottom = mask.bottom ?? 10;
      updates.left = mask.left ?? 10;
      updates.corner_radius = mask.corner_radius ?? 16;
    } else if (newShape === 'polygon') {
      updates.polygon_preset = mask.polygon_preset ?? 'hexagon';
    }
    update(updates);
  };

  const handleClear = () => {
    onChange(undefined);
  };

  const circleSize = parseNumeric(mask.size, 50);
  const circleX = parseNumeric(mask.x, 50);
  const circleY = parseNumeric(mask.y, 50);

  const ellipseRx = parseNumeric(mask.rx, 50);
  const ellipseRy = parseNumeric(mask.ry, 35);
  const ellipseX = parseNumeric(mask.x, 50);
  const ellipseY = parseNumeric(mask.y, 50);

  const insetTop = parseNumeric(mask.top, 0);
  const insetRight = parseNumeric(mask.right, 0);
  const insetBottom = parseNumeric(mask.bottom, 0);
  const insetLeft = parseNumeric(mask.left, 0);
  const insetRadius = parseNumeric(mask.corner_radius, 0);

  const polygonPreset = mask.polygon_preset || 'hexagon';
  const customPoints = mask.points || '50% 0%, 100% 50%, 50% 100%, 0% 50%';

  const revealDuration = mask.reveal_duration ?? 0.8;
  const revealDelay = mask.reveal_delay ?? 0.0;
  const revealEasing = mask.reveal_easing || 'ease-out';
  const revealInverted = !!mask.inverted;

  return (
    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-4">
      {/* Header with Title and Clear Action */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            Shape & Vector Masking (Clip Path)
          </span>
          <p className="text-[10px] text-stone-400 mt-0.5">
            Clip layer geometry into geometric shapes and animated transitions.
          </p>
        </div>
        {(shape !== 'none' || reveal !== 'none') && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2 py-0.5 rounded transition-colors cursor-pointer"
            title="Reset and clear mask"
          >
            <BiTrashAlt size={11} />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* 1. Mask Shape Selector */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
          Mask Geometry Shape
        </label>
        <div className="grid grid-cols-5 gap-1 p-1 bg-black/50 border border-white/5 rounded-lg">
          {SHAPES.map(s => {
            const active = shape === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleShapeChange(s.id)}
                className={`py-1 text-[10px] font-bold rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer truncate ${active
                    ? 'bg-amber-500 text-black shadow-sm font-extrabold'
                    : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                  }`}
              >
                <span>{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Shape-Specific Coordinate Sliders & Inputs */}
      {shape === 'circle' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Circle Parameters
          </div>
          {/* Radius Size */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-stone-400">Radius / Size</span>
              <span className="font-mono text-stone-200">{circleSize}%</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={circleSize}
                onChange={e => update({ size: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
              <input
                type="number"
                min={1}
                max={150}
                value={circleSize}
                onChange={e => update({ size: parseFloat(e.target.value) || 50 })}
                className="w-14 bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-xs font-mono text-right text-stone-200 focus:outline-none"
              />
            </div>
          </div>
          {/* Center Coordinates X / Y */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Center X</span>
                <span className="font-mono text-stone-200">{circleX}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={circleX}
                onChange={e => update({ x: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Center Y</span>
                <span className="font-mono text-stone-200">{circleY}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={circleY}
                onChange={e => update({ y: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'ellipse' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Ellipse Radii & Pivot
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Radius X (Horizontal)</span>
                <span className="font-mono text-stone-200">{ellipseRx}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={ellipseRx}
                onChange={e => update({ rx: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Radius Y (Vertical)</span>
                <span className="font-mono text-stone-200">{ellipseRy}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={ellipseRy}
                onChange={e => update({ ry: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Center X</span>
                <span className="font-mono text-stone-200">{ellipseX}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={ellipseX}
                onChange={e => update({ x: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Center Y</span>
                <span className="font-mono text-stone-200">{ellipseY}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={ellipseY}
                onChange={e => update({ y: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'inset' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Inset Edge Insets & Rounded Corners
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Crop Top</span>
                <span className="font-mono text-stone-200">{insetTop}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={insetTop}
                onChange={e => update({ top: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Crop Bottom</span>
                <span className="font-mono text-stone-200">{insetBottom}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={insetBottom}
                onChange={e => update({ bottom: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Crop Left</span>
                <span className="font-mono text-stone-200">{insetLeft}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={insetLeft}
                onChange={e => update({ left: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Crop Right</span>
                <span className="font-mono text-stone-200">{insetRight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={insetRight}
                onChange={e => update({ right: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
            </div>
          </div>
          {/* Corner Radius */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-stone-400">Corner Radius</span>
              <span className="font-mono text-stone-200">{insetRadius}px</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={120}
                step={2}
                value={insetRadius}
                onChange={e => update({ corner_radius: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer h-1.5"
              />
              <input
                type="number"
                min={0}
                max={200}
                value={insetRadius}
                onChange={e => update({ corner_radius: parseFloat(e.target.value) || 0 })}
                className="w-14 bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-xs font-mono text-right text-stone-200 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'polygon' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Polygon Preset & Custom Points
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {POLYGON_PRESETS.map(p => {
              const active = polygonPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ polygon_preset: p.id })}
                  className={`py-1 px-1.5 text-[10px] font-bold rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer truncate ${active
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                      : 'text-stone-400 hover:text-stone-200 bg-black/40 border border-white/5'
                    }`}
                >
                  <span>{p.icon}</span>
                  <span className="truncate">{p.label}</span>
                </button>
              );
            })}
          </div>
          {polygonPreset === 'custom' && (
            <div className="space-y-1 pt-1">
              <label className="text-[10px] text-stone-400 block">
                SVG/CSS Polygon Points (e.g. <code className="font-mono text-amber-300">50% 0%, 100% 50%, 50% 100%, 0% 50%</code>)
              </label>
              <input
                type="text"
                value={customPoints}
                onChange={e => update({ points: e.target.value })}
                placeholder="50% 0%, 100% 50%, 50% 100%, 0% 50%"
                className="w-full bg-black/50 border border-white/10 rounded px-2.5 py-1 text-xs font-mono text-stone-200 focus:outline-none focus:border-amber-500/50"
              />
            </div>
          )}
        </div>
      )}

      {/* 3. Animated Reveal Transition */}
      <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            🎬 Animated Mask Reveal
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              checked={revealInverted}
              onChange={e => update({ inverted: e.target.checked })}
              className="rounded accent-amber-500 cursor-pointer"
            />
            <span>Invert Direction</span>
          </label>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-stone-400 block">Transition Mode</label>
          <select
            value={reveal}
            onChange={e => update({ reveal: e.target.value as ASTMaskReveal })}
            className="w-full bg-black/50 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none cursor-pointer font-medium"
          >
            {REVEAL_MODES.map(m => (
              <option key={m.id} value={m.id}>
                {m.icon} {m.label}
              </option>
            ))}
          </select>
        </div>

        {reveal !== 'none' && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] text-stone-400 block">Duration (s)</label>
              <input
                type="number"
                min={0.1}
                max={10.0}
                step={0.1}
                value={revealDuration}
                onChange={e => update({ reveal_duration: Math.max(0.05, parseFloat(e.target.value) || 0.8) })}
                className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-stone-200 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-stone-400 block">Delay (s)</label>
              <input
                type="number"
                min={0.0}
                max={20.0}
                step={0.1}
                value={revealDelay}
                onChange={e => update({ reveal_delay: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs font-mono text-stone-200 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-stone-400 block">Easing Curve</label>
              <select
                value={revealEasing}
                onChange={e => update({ reveal_easing: e.target.value as any })}
                className="w-full bg-black/50 border border-white/10 text-xs text-stone-200 rounded px-1.5 py-1 focus:outline-none cursor-pointer"
              >
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In-Out</option>
                <option value="ease-in">Ease In</option>
                <option value="bounce">Bounce</option>
                <option value="linear">Linear</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

AstMaskControls.displayName = 'AstMaskControls';
