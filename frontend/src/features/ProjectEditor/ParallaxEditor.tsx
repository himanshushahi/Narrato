import { BiReset } from 'react-icons/bi';

// ─── Parallax defaults (mirrors component defaults) ─────────────
const DEFAULTS = {
  strength: 70,
  camera_path: 'orbit',
  bg_zoom_min: 1.1,
  bg_zoom_max: 1.25,
  fg_zoom_min: 1.0,
  fg_zoom_max: 1.25,
  bg_blur: 1,
  drift_x: 30,
  drift_y: 15,
  rotate_y: 3,
  depth_z: 80,
  fg_brightness: 1.0,
};

const CAMERA_PATHS = [
  { value: 'orbit', label: 'Orbit (Circular)' },
  { value: 'ken-burns', label: 'Ken Burns (Pan & Zoom)' },
  { value: 'float', label: 'Float (Gentle Drift)' },
  { value: 'dolly', label: 'Dolly (Push In)' },
  { value: 'crane', label: 'Crane (Ascending)' },
];

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

const SliderField = ({ label, value, min, max, step, unit, onChange }: SliderFieldProps) => (
  <div className="space-y-1">
    <div className="flex justify-between items-center text-xs">
      <label className="text-stone-400 font-medium">{label}</label>
      <span className="text-amber-400 font-mono font-bold text-[11px]">
        {value}{unit ?? ''}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-stone-900 rounded-lg appearance-none cursor-pointer accent-amber-500"
    />
  </div>
);

export const ParallaxEditor = ({
  visualMeta,
  onChange,
}: {
  visualMeta: any;
  onChange: (newMeta: any) => void;
}) => {
  // Parallax settings live under visualMeta.parallax
  const p = visualMeta.parallax ?? {};

  const val = (key: keyof typeof DEFAULTS): number =>
    p[key] !== undefined ? p[key] : DEFAULTS[key];

  const strVal = (key: 'camera_path'): string =>
    p[key] ?? DEFAULTS[key];

  const update = (key: string, v: number | string) => {
    onChange({
      ...visualMeta,
      parallax: { ...p, [key]: v },
    });
  };

  const resetAll = () => {
    onChange({
      ...visualMeta,
      parallax: { ...DEFAULTS },
    });
  };

  return (
    <div className="col-span-2 space-y-4 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      {/* Header */}
      <div className="flex justify-between items-center">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">
          2.5D Parallax Depth
        </label>
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-amber-400 bg-stone-800/50 hover:bg-stone-800 px-2 py-1 rounded transition-colors cursor-pointer"
        >
          <BiReset size={12} /> Reset
        </button>
      </div>

      {/* Foreground URL (existing field) */}
      <div className="space-y-1">
        <label className="text-stone-400 font-medium text-xs">Foreground Cutout URL</label>
        <input
          type="text"
          value={visualMeta.foreground_url ?? ''}
          onChange={e => onChange({ ...visualMeta, foreground_url: e.target.value })}
          className="w-full bg-stone-950 border border-stone-800 rounded px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/50 font-mono"
          placeholder="URL to transparent PNG cutout, or leave empty for single-layer pan"
        />
      </div>

      {/* Camera Path preset */}
      <div className="space-y-1">
        <label className="text-stone-400 font-medium text-xs">Camera Path</label>
        <div className="flex flex-wrap gap-1.5">
          {CAMERA_PATHS.map(cp => (
            <button
              key={cp.value}
              type="button"
              onClick={() => update('camera_path', cp.value)}
              className={`text-[10px] px-2.5 py-1.5 rounded font-semibold transition-all cursor-pointer ${
                strVal('camera_path') === cp.value
                  ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                  : 'bg-stone-800/50 text-stone-400 hover:text-stone-200 border border-stone-700/50 hover:border-stone-600'
              }`}
            >
              {cp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div className="space-y-3">
        <SliderField
          label="Parallax Strength"
          value={val('strength')}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={v => update('strength', v)}
        />
        <SliderField
          label="Background Zoom Min"
          value={val('bg_zoom_min')}
          min={1.0}
          max={1.5}
          step={0.05}
          onChange={v => update('bg_zoom_min', v)}
        />
        <SliderField
          label="Background Zoom Max"
          value={val('bg_zoom_max')}
          min={1.0}
          max={1.8}
          step={0.05}
          onChange={v => update('bg_zoom_max', v)}
        />
        <SliderField
          label="Foreground Zoom Min"
          value={val('fg_zoom_min')}
          min={0.8}
          max={1.5}
          step={0.05}
          onChange={v => update('fg_zoom_min', v)}
        />
        <SliderField
          label="Foreground Zoom Max"
          value={val('fg_zoom_max')}
          min={0.8}
          max={2.0}
          step={0.05}
          onChange={v => update('fg_zoom_max', v)}
        />
        <SliderField
          label="Background Blur"
          value={val('bg_blur')}
          min={0}
          max={15}
          step={1}
          unit="px"
          onChange={v => update('bg_blur', v)}
        />
        <SliderField
          label="Horizontal Drift"
          value={val('drift_x')}
          min={0}
          max={120}
          step={5}
          unit="px"
          onChange={v => update('drift_x', v)}
        />
        <SliderField
          label="Vertical Drift"
          value={val('drift_y')}
          min={0}
          max={80}
          step={5}
          unit="px"
          onChange={v => update('drift_y', v)}
        />
        <SliderField
          label="Y-Axis Rotation"
          value={val('rotate_y')}
          min={0}
          max={15}
          step={1}
          unit="°"
          onChange={v => update('rotate_y', v)}
        />
        <SliderField
          label="Depth Z Separation"
          value={val('depth_z')}
          min={0}
          max={200}
          step={10}
          unit="px"
          onChange={v => update('depth_z', v)}
        />
      </div>

      {/* Tips */}
      <details className="text-[10px] text-stone-500">
        <summary className="cursor-pointer hover:text-stone-300 font-medium">Tips</summary>
        <ul className="mt-1.5 space-y-1 pl-4 list-disc">
          <li><strong>Orbit</strong> works best when you have a foreground cutout — it circles around the subject</li>
          <li><strong>Float</strong> is great for subtle, dreamy movement on single images</li>
          <li><strong>Ken Burns</strong> is the classic documentary slow pan-and-zoom</li>
          <li><strong>Dolly</strong> pushes into the scene — pairs well with a vignette</li>
          <li>Higher <strong>Strength</strong> amplifies all motion parameters proportionally</li>
          <li>Add a <strong>Foreground Cutout</strong> (transparent PNG) for true 2.5D depth</li>
        </ul>
      </details>
    </div>
  );
};
