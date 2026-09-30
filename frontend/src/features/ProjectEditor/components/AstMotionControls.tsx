import React, { memo } from 'react';
import {
  Waves,
  Wind,
  Video,
  AlertTriangle,
  RotateCcw,
  Compass,
  Box,
  Ban,
  Smartphone,
  Zap,
  Radio,
  Sliders,
  Check,
} from 'lucide-react';
import { AnchorPointGrid, AnchorPoint } from '../../../components/ui/accessible/AnchorPointGrid';
import { SegmentedControl } from '../../../components/ui/accessible/SegmentedControl';
import { ScrubbableNumberInput } from '../../../components/ui/accessible/ScrubbableNumberInput';

export interface AstMotionControlsProps {
  layer: Record<string, any>;
  onUpdate: (key: string, value: any) => void;
  motionState: {
    hasMotion: boolean;
    shutterDisabled: boolean;
    shutterReason?: string;
  };
  layerKind?: string;
}

function toAnchorPoint(origin?: string): AnchorPoint {
  if (!origin) return 'center';
  const clean = origin.trim().toLowerCase().replace(/\s+/g, '-');
  if (clean === 'center' || clean === 'center-center') return 'center';
  if (clean === 'top-left') return 'top-left';
  if (clean === 'top-center' || clean === 'top') return 'top-center';
  if (clean === 'top-right') return 'top-right';
  if (clean === 'center-left' || clean === 'left') return 'center-left';
  if (clean === 'center-right' || clean === 'right') return 'center-right';
  if (clean === 'bottom-left') return 'bottom-left';
  if (clean === 'bottom-center' || clean === 'bottom') return 'bottom-center';
  if (clean === 'bottom-right') return 'bottom-right';
  return 'center';
}

function fromAnchorPoint(point: AnchorPoint): string {
  if (point === 'center') return 'center center';
  return point.replace('-', ' ');
}

const SHUTTER_PRESETS = [
  { angle: 90, label: '90°', desc: 'Crisp action' },
  { angle: 180, label: '180°', desc: 'Cinematic 24fps (Standard)' },
  { angle: 270, label: '270°', desc: 'Smooth blur' },
  { angle: 360, label: '360°', desc: 'Dreamy streak' },
];

const CAMERA_SHAKE_OPTIONS = [
  { value: 'none', label: 'None', icon: <Ban className="w-3 h-3 text-stone-400" /> },
  { value: 'handheld', label: 'Handheld', icon: <Smartphone className="w-3 h-3 text-sky-400" /> },
  { value: 'shockwave', label: 'Shockwave', icon: <Zap className="w-3 h-3 text-amber-400" /> },
  { value: 'glitch', label: 'Glitch', icon: <Radio className="w-3 h-3 text-rose-400" /> },
];

const SHAKE_DESCRIPTIONS: Record<string, string> = {
  none: 'Static stable camera without jitter or drift',
  handheld: 'Organic natural handheld camera sway & subtle floating drift',
  shockwave: 'Sudden explosive earthquake tremors with rapid damping',
  glitch: 'Digital horizontal micro-displacement & jitter slices',
};

const PERSPECTIVE_PRESETS = [
  { value: 400, label: '400px', desc: 'Wide Angle (Dramatic 3D)' },
  { value: 1000, label: '1000px', desc: 'Standard 50mm (Cinematic)' },
  { value: 2400, label: '2400px', desc: 'Telephoto (Orthographic / Flat)' },
];

const VANISHING_POINTS: { id: string; label: string; sub: string; row: number; col: number }[] = [
  { id: '0% 0%', label: 'Top-Left', sub: 'High Left Angle', row: 0, col: 0 },
  { id: '50% 0%', label: "Top-Center (Bird's Eye)", sub: 'Looking Down', row: 0, col: 1 },
  { id: '100% 0%', label: 'Top-Right', sub: 'High Right Angle', row: 0, col: 2 },
  { id: '0% 50%', label: 'Center-Left', sub: 'Looking from Left', row: 1, col: 0 },
  { id: 'center center', label: 'Eye Level (Default)', sub: 'Neutral Center', row: 1, col: 1 },
  { id: '100% 50%', label: 'Center-Right', sub: 'Looking from Right', row: 1, col: 2 },
  { id: '0% 100%', label: 'Bottom-Left', sub: 'Low Left Angle', row: 2, col: 0 },
  { id: '50% 100%', label: "Bottom-Center (Worm's Eye)", sub: 'Looking Up', row: 2, col: 1 },
  { id: '100% 100%', label: 'Bottom-Right', sub: 'Low Right Angle', row: 2, col: 2 },
];

export const AstMotionControls: React.FC<AstMotionControlsProps> = memo(({
  layer,
  onUpdate,
  motionState,
  layerKind = 'Layer',
}) => {
  const isFloating = !!layer.floating;
  const isMotionBlur = !!layer.motion_blur;
  const currentAngle = layer.shutter_angle ?? 180;
  const currentShake = layer.camera_shake || 'none';
  const currentAnchor = toAnchorPoint(layer.transform_origin);
  const currentPerspective = typeof layer.perspective === 'number'
    ? layer.perspective
    : (parseFloat(String(layer.perspective ?? '')) || 1000);
  const isCustomPerspective = layer.perspective !== undefined && layer.perspective !== 1000;
  const currentOrigin = layer.perspective_origin || 'center center';
  const isCustomOrigin = currentOrigin !== 'center center';

  return (
    <div className="p-3 bg-black/40 border border-white/10 rounded-xl space-y-4">
      {/* Header & Status Indicator */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <Video className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            Motion Physics & 3D Camera
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isFloating && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              Floating
            </span>
          )}
          {isMotionBlur && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
              Blur {currentAngle}°
            </span>
          )}
          {currentShake !== 'none' && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30 capitalize">
              {currentShake}
            </span>
          )}
        </div>
      </div>

      {/* Section 1: Harmonic Floating & Physical Motion Blur */}
      <div className="space-y-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 block">
          Layer Dynamics
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Floating Switch Card */}
          <button
            type="button"
            role="switch"
            aria-checked={isFloating}
            onClick={() => onUpdate('floating', !isFloating)}
            className={`p-2.5 rounded-lg border text-left flex items-start justify-between gap-3 transition-all cursor-pointer ${
              isFloating
                ? 'bg-cyan-950/20 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.1)]'
                : 'bg-black/50 border-white/5 hover:border-white/10 hover:bg-black/70'
            }`}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Waves className={`w-3.5 h-3.5 shrink-0 ${isFloating ? 'text-cyan-400' : 'text-stone-400'}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isFloating ? 'text-cyan-300' : 'text-stone-300'}`}>
                  Harmonic Floating
                </span>
              </div>
              <p className="text-[8.5px] text-stone-500 leading-tight">
                Natural sine-wave hovering drift
              </p>
            </div>
            <div
              className={`w-7 h-4 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                isFloating ? 'bg-cyan-500 justify-end' : 'bg-stone-800 justify-start'
              }`}
            >
              <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
            </div>
          </button>

          {/* Motion Blur Switch Card */}
          <button
            type="button"
            role="switch"
            aria-checked={isMotionBlur}
            onClick={() => onUpdate('motion_blur', !isMotionBlur)}
            className={`p-2.5 rounded-lg border text-left flex items-start justify-between gap-3 transition-all cursor-pointer ${
              isMotionBlur
                ? 'bg-amber-950/20 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                : 'bg-black/50 border-white/5 hover:border-white/10 hover:bg-black/70'
            }`}
            title={isMotionBlur && !motionState.hasMotion ? 'Motion Blur is armed but this layer is static' : 'Physical shutter blur for moving layers'}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Wind className={`w-3.5 h-3.5 shrink-0 ${isMotionBlur ? 'text-amber-400' : 'text-stone-400'}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isMotionBlur ? 'text-amber-300' : 'text-stone-300'}`}>
                  Motion Blur
                </span>
              </div>
              <p className="text-[8.5px] text-stone-500 leading-tight">
                Camera shutter-speed blur on movement
              </p>
            </div>
            <div
              className={`w-7 h-4 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                isMotionBlur ? 'bg-amber-500 justify-end' : 'bg-stone-800 justify-start'
              }`}
            >
              <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
            </div>
          </button>
        </div>

        {/* Warning if blur enabled on static layer */}
        {isMotionBlur && !motionState.hasMotion && (
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] leading-relaxed text-amber-200/90 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Blur is armed, but this <strong>[{layerKind}]</strong> layer is static. The renderer bypasses shutter blur without animations, floating, or camera shake. Add a spatial animation or turn on Floating to activate it.
            </span>
          </div>
        )}
      </div>

      {/* Section 2: Shutter Angle (Motion Blur Spread) */}
      <div
        className={`p-3 bg-black/50 border border-white/5 rounded-xl space-y-2.5 transition-opacity ${
          motionState.shutterDisabled ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
            <Sliders className="w-3 h-3 text-amber-400" />
            Shutter Angle (Blur Spread)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-mono text-xs font-bold">
              {currentAngle}°
            </span>
            {currentAngle !== 180 && !motionState.shutterDisabled && (
              <button
                type="button"
                onClick={() => onUpdate('shutter_angle', 180)}
                className="text-stone-500 hover:text-amber-300 p-0.5 rounded cursor-pointer transition-colors"
                title="Reset to 180° cinematic standard"
                aria-label="Reset shutter angle"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Presets Bar */}
        <div className="grid grid-cols-4 gap-1">
          {SHUTTER_PRESETS.map((preset) => {
            const isSelected = currentAngle === preset.angle;
            return (
              <button
                key={preset.angle}
                type="button"
                disabled={motionState.shutterDisabled}
                onClick={() => onUpdate('shutter_angle', preset.angle)}
                className={`py-1 px-1.5 rounded text-[9px] font-mono font-bold transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'bg-amber-500 text-black shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                    : 'bg-black/60 text-stone-300 hover:bg-stone-800 hover:text-white border border-white/5'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={`${preset.angle}°: ${preset.desc}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Range Slider & Scrubbable Input */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="range"
                min="45"
                max="360"
                step="15"
                value={currentAngle}
                disabled={motionState.shutterDisabled}
                onChange={(e) => onUpdate('shutter_angle', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500 h-1.5 bg-black/60 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Shutter angle range"
              />
            </div>
            <div className="w-20 shrink-0">
              <ScrubbableNumberInput
                ariaLabel="Shutter angle"
                hideLabel
                value={currentAngle}
                onChange={(val) => onUpdate('shutter_angle', val)}
                min={45}
                max={360}
                step={15}
                unit="°"
                disabled={motionState.shutterDisabled}
              />
            </div>
          </div>
          <div className="flex justify-between text-[7.5px] text-stone-500 font-mono">
            <span>45° (Sports / Sharp)</span>
            <span>180° (Film Standard)</span>
            <span>360° (Maximum Streak)</span>
          </div>
        </div>

        {motionState.shutterReason && (
          <p className="text-[8.5px] text-stone-500 leading-relaxed border-t border-white/5 pt-1.5">
            {motionState.shutterReason}
          </p>
        )}
      </div>

      {/* Section 3: Camera Shake / Jitter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-amber-400" />
            Camera Shake / Jitter
          </span>
          {currentShake !== 'none' && (
            <button
              type="button"
              onClick={() => onUpdate('camera_shake', undefined)}
              className="text-stone-500 hover:text-amber-300 text-[8.5px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-colors"
              title="Reset camera shake to none"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset
            </button>
          )}
        </div>

        <SegmentedControl
          options={CAMERA_SHAKE_OPTIONS}
          value={currentShake}
          onChange={(val) => onUpdate('camera_shake', val === 'none' ? undefined : val)}
        />

        <p className="text-[8.5px] text-stone-400 italic">
          {SHAKE_DESCRIPTIONS[currentShake] || SHAKE_DESCRIPTIONS.none}
        </p>
      </div>

      {/* Section 4: Transform Origin (Anchor Point Pivot) */}
      <div className="pt-2 border-t border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
            <Compass className="w-3 h-3 text-amber-400" />
            Transform Origin (Anchor Pivot)
          </span>
          {currentAnchor !== 'center' && (
            <button
              type="button"
              onClick={() => onUpdate('transform_origin', undefined)}
              className="text-stone-500 hover:text-amber-300 text-[8.5px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-colors"
              title="Reset anchor point to center"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Center
            </button>
          )}
        </div>

        <div className="p-2.5 bg-black/50 border border-white/5 rounded-xl flex items-center gap-4">
          {/* 3x3 Interactive Pin Pad */}
          <div className="shrink-0">
            <AnchorPointGrid
              value={currentAnchor}
              onChange={(pt) => onUpdate('transform_origin', pt === 'center' ? undefined : fromAnchorPoint(pt))}
              label=""
            />
          </div>

          {/* Details & Info */}
          <div className="space-y-1 min-w-0">
            <div className="text-[11px] font-bold text-stone-200 capitalize flex items-center gap-1.5">
              <span>{currentAnchor.replace('-', ' ')}</span>
              <span className="text-[9px] font-mono text-amber-400/80 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                {layer.transform_origin || 'center center'}
              </span>
            </div>
            <p className="text-[8.5px] text-stone-400 leading-relaxed">
              Anchor point controls the pivot center for scale, rotation, and motion drift.
            </p>
            {!motionState.hasMotion && (
              <span className="text-[8px] text-stone-500 italic block">
                Pivot takes visible effect when scale/rotate animations, floating, or shake are active.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 5: 3D Camera Perspective & FOV */}
      <div className="pt-2 border-t border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5 text-amber-400" />
            3D Camera Perspective & FOV
          </span>
          {(isCustomPerspective || isCustomOrigin) && (
            <button
              type="button"
              onClick={() => {
                onUpdate('perspective', undefined);
                onUpdate('perspective_origin', undefined);
              }}
              className="text-stone-500 hover:text-amber-300 text-[8.5px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-colors"
              title="Reset 3D camera to default (1000px Eye Level)"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset Camera
            </button>
          )}
        </div>

        {/* Camera Distance (FOV) */}
        <div className="p-2.5 bg-black/50 border border-white/5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
              Camera Distance (Focal Length)
            </span>
            <span className="text-amber-400 font-mono text-xs font-bold">
              {currentPerspective}px
            </span>
          </div>

          {/* Focal Length Presets */}
          <div className="grid grid-cols-3 gap-1">
            {PERSPECTIVE_PRESETS.map((preset) => {
              const isSelected = Math.abs(currentPerspective - preset.value) < 25;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onUpdate('perspective', preset.value === 1000 ? undefined : preset.value)}
                  className={`py-1 px-1.5 rounded text-[9px] font-bold transition-all cursor-pointer text-center ${
                    isSelected
                      ? 'bg-amber-500 text-black shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                      : 'bg-black/60 text-stone-300 hover:bg-stone-800 hover:text-white border border-white/5'
                  }`}
                  title={`${preset.label}: ${preset.desc}`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Slider & Scrubbable Input */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <input
                  type="range"
                  min="300"
                  max="3000"
                  step="50"
                  value={currentPerspective}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    onUpdate('perspective', val === 1000 ? undefined : val);
                  }}
                  className="w-full accent-amber-500 h-1.5 bg-black/60 rounded cursor-pointer"
                  aria-label="Camera distance in pixels"
                />
              </div>
              <div className="w-24 shrink-0">
                <ScrubbableNumberInput
                  ariaLabel="Camera perspective distance"
                  hideLabel
                  value={currentPerspective}
                  onChange={(val) => onUpdate('perspective', val === 1000 ? undefined : val)}
                  min={300}
                  max={3000}
                  step={50}
                  unit="px"
                />
              </div>
            </div>
            <div className="flex justify-between text-[7.5px] text-stone-500 font-mono">
              <span>300px (Wide Angle / Dramatic Depth)</span>
              <span>1000px (Standard)</span>
              <span>3000px (Telephoto / Flat)</span>
            </div>
          </div>
        </div>

        {/* Vanishing Point (Perspective Origin) */}
        <div className="p-2.5 bg-black/50 border border-white/5 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">
              Vanishing Point (Perspective Origin)
            </span>
            {isCustomOrigin && (
              <button
                type="button"
                onClick={() => onUpdate('perspective_origin', undefined)}
                className="text-stone-500 hover:text-amber-300 text-[8.5px] font-semibold uppercase flex items-center gap-1 cursor-pointer transition-colors"
                title="Reset vanishing point to Eye Level"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Eye Level
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {VANISHING_POINTS.map((vp) => {
              const isSelected = currentOrigin === vp.id;
              return (
                <button
                  key={vp.id}
                  type="button"
                  onClick={() => onUpdate('perspective_origin', vp.id === 'center center' ? undefined : vp.id)}
                  className={`p-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                      : 'bg-black/60 border-white/5 text-stone-400 hover:text-stone-200 hover:border-white/15 hover:bg-stone-900/60'
                  }`}
                  title={`${vp.label}: ${vp.sub}`}
                >
                  <div className="text-[9px] font-bold truncate flex items-center justify-between">
                    <span>{vp.label}</span>
                    {isSelected && <Check className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
                  </div>
                  <div className="text-[7.5px] text-stone-500 truncate">{vp.sub}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

AstMotionControls.displayName = 'AstMotionControls';
