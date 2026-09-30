import React, { memo } from 'react';
import { ASTLayerMask, ASTMaskShape, ASTMaskReveal, ASTPolygonPreset } from '../../../components/video/ASTAnimator';
import {
  Trash2,
  Ban,
  Circle,
  Disc,
  Square,
  Diamond,
  Hexagon,
  Triangle,
  Star,
  Edit3,
  Pause,
  ArrowRight,
  ArrowDown,
  ArrowLeftRight,
  ArrowDownRight,
  Sparkles,
} from 'lucide-react';
import { AnimationTimingBar } from '../../../components/ui/accessible/AnimationTimingBar';

interface AstMaskControlsProps {
  mask?: ASTLayerMask;
  onChange: (mask: ASTLayerMask | undefined) => void;
  sceneDuration?: number;
}

const SHAPES: { id: ASTMaskShape; label: string; icon: React.ReactNode }[] = [
  { id: 'none', label: 'None', icon: <Ban size={11} /> },
  { id: 'circle', label: 'Circle', icon: <Circle size={11} /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Disc size={11} /> },
  { id: 'inset', label: 'Inset Box', icon: <Square size={11} /> },
  { id: 'polygon', label: 'Polygon', icon: <Diamond size={11} /> },
];

const POLYGON_PRESETS: { id: ASTPolygonPreset; label: string; icon: React.ReactNode }[] = [
  { id: 'hexagon', label: 'Hexagon', icon: <Hexagon size={11} /> },
  { id: 'diamond', label: 'Diamond', icon: <Diamond size={11} /> },
  { id: 'triangle', label: 'Triangle', icon: <Triangle size={11} /> },
  { id: 'star', label: '5-Point Star', icon: <Star size={11} /> },
  { id: 'slant_left', label: 'Slant Left', icon: <Square size={11} className="-skew-x-12" /> },
  { id: 'slant_right', label: 'Slant Right', icon: <Square size={11} className="skew-x-12" /> },
  { id: 'custom', label: 'Custom Points', icon: <Edit3 size={11} /> },
];

const REVEAL_MODES: { id: ASTMaskReveal; label: string; icon: React.ReactNode }[] = [
  { id: 'none', label: 'None (Static Mask)', icon: <Pause size={11} /> },
  { id: 'circle_iris', label: 'Circle Iris (Expand Out)', icon: <Circle size={11} /> },
  { id: 'wipe_right', label: 'Wipe Right (Horizontal)', icon: <ArrowRight size={11} /> },
  { id: 'wipe_down', label: 'Wipe Down (Vertical)', icon: <ArrowDown size={11} /> },
  { id: 'split_vertical', label: 'Split Curtain (Center Out)', icon: <ArrowLeftRight size={11} /> },
  { id: 'wipe_diagonal', label: 'Wipe Diagonal', icon: <ArrowDownRight size={11} /> },
];

function parseNumeric(val: number | string | undefined, defaultVal: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^-\d.]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return defaultVal;
}

export const AstMaskControls: React.FC<AstMaskControlsProps> = memo(({
  mask = {},
  onChange,
  sceneDuration = 5.0,
}) => {
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
    <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-4">
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
            <Trash2 size={11} />
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
                className={`py-1 text-[10px] font-bold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer truncate ${active
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
                max={150}
                value={circleSize}
                onChange={e => update({ size: parseFloat(e.target.value) || 50 })}
                className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
              <input
                type="number"
                min={5}
                max={200}
                value={circleSize}
                onChange={e => update({ size: parseFloat(e.target.value) || 50 })}
                className="w-14 bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-xs font-mono text-stone-200 text-center focus:outline-none"
              />
            </div>
          </div>

          {/* Center Coordinates X, Y */}
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
                value={circleX}
                onChange={e => update({ x: parseFloat(e.target.value) || 50 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
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
                value={circleY}
                onChange={e => update({ y: parseFloat(e.target.value) || 50 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'ellipse' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Ellipse Parameters
          </div>
          {/* Radius X and Radius Y */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Radius X</span>
                <span className="font-mono text-stone-200">{ellipseRx}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={150}
                value={ellipseRx}
                onChange={e => update({ rx: parseFloat(e.target.value) || 50 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Radius Y</span>
                <span className="font-mono text-stone-200">{ellipseRy}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={150}
                value={ellipseRy}
                onChange={e => update({ ry: parseFloat(e.target.value) || 35 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
          </div>

          {/* Center Coordinates X, Y */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Center X</span>
                <span className="font-mono text-stone-200">{ellipseX}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={ellipseX}
                onChange={e => update({ x: parseFloat(e.target.value) || 50 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
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
                value={ellipseY}
                onChange={e => update({ y: parseFloat(e.target.value) || 50 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
          </div>
        </div>
      )}

      {shape === 'inset' && (
        <div className="p-2.5 bg-black/30 border border-white/5 rounded-lg space-y-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
            Inset Box Margins & Corners
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Top Inset</span>
                <span className="font-mono text-stone-200">{insetTop}%</span>
              </div>
              <input
                type="range"
                aria-label="Top Inset Crop"
                min={0}
                max={50}
                value={insetTop}
                onChange={e => update({ top: parseFloat(e.target.value) || 0 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Bottom Inset</span>
                <span className="font-mono text-stone-200">{insetBottom}%</span>
              </div>
              <input
                type="range"
                aria-label="Bottom Inset Crop"
                min={0}
                max={50}
                value={insetBottom}
                onChange={e => update({ bottom: parseFloat(e.target.value) || 0 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Left Inset</span>
                <span className="font-mono text-stone-200">{insetLeft}%</span>
              </div>
              <input
                type="range"
                aria-label="Left Inset Crop"
                min={0}
                max={50}
                value={insetLeft}
                onChange={e => update({ left: parseFloat(e.target.value) || 0 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-stone-400">Right Inset</span>
                <span className="font-mono text-stone-200">{insetRight}%</span>
              </div>
              <input
                type="range"
                aria-label="Right Inset Crop"
                min={0}
                max={50}
                value={insetRight}
                onChange={e => update({ right: parseFloat(e.target.value) || 0 })}
                className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
              />
            </div>
          </div>
          {/* Corner Radius */}
          <div className="space-y-1 pt-1 border-t border-white/5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-stone-400">Corner Radius</span>
              <span className="font-mono text-stone-200">{insetRadius}px</span>
            </div>
            <input
              type="range"
              aria-label="Mask Corner Radius in pixels"
              min={0}
              max={100}
              value={insetRadius}
              onChange={e => update({ corner_radius: parseFloat(e.target.value) || 0 })}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-black/50 rounded"
            />
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
                  className={`py-1 px-1.5 text-[10px] font-bold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer truncate ${active
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
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Sparkles size={11} /> Animated Mask Reveal
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
          <label className="text-[10px] text-stone-400 block font-semibold">Transition Mode</label>
          <select
            value={reveal}
            aria-label="Mask Transition Mode"
            onChange={e => update({ reveal: e.target.value as ASTMaskReveal })}
            className="w-full bg-black/50 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none cursor-pointer font-medium"
          >
            {REVEAL_MODES.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {reveal !== 'none' && (
          <div className="pt-2 border-t border-white/5 space-y-2">
            <AnimationTimingBar
              sceneDuration={sceneDuration}
              delay={revealDelay}
              duration={revealDuration}
              label="Mask Reveal Timing"
              onChange={({ delay, duration }) => {
                update({ reveal_delay: delay, reveal_duration: duration });
              }}
            />

            <div className="space-y-1 pt-1">
              <label className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">
                Easing Curve
              </label>
              <select
                value={revealEasing}
                aria-label="Mask Reveal Easing Curve"
                onChange={e => update({ reveal_easing: e.target.value as any })}
                className="w-full bg-black/50 border border-white/10 text-xs text-stone-200 rounded-md px-2 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="ease-out">Ease Out (Smooth Stop)</option>
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
