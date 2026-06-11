import { BiReset } from 'react-icons/bi';
import { SubVisualTransform, DEFAULT_TRANSFORM } from '../../components/video/SubVisualTransform';

// ─── Slider field primitive (matches ParallaxEditor pattern) ─────
interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  displayValue?: string;
  onChange: (v: number) => void;
}

const SliderField = ({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: SliderFieldProps) => (
  <div className="space-y-1">
    <div className="flex justify-between items-center text-xs">
      <label className="text-stone-400 font-medium">{label}</label>
      <span className="text-amber-400 font-mono font-bold text-[11px]">
        {displayValue ?? value}
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

// ─── TransformEditor ─────────────────────────────────────────────
interface Props {
  transform?: SubVisualTransform;
  onChange: (newTransform: SubVisualTransform) => void;
}

export const TransformEditor = ({ transform, onChange }: Props) => {
  const t = transform ?? DEFAULT_TRANSFORM;

  const update = (key: keyof SubVisualTransform, value: number) => {
    onChange({ ...t, [key]: value });
  };

  const resetAll = () => {
    onChange({ ...DEFAULT_TRANSFORM });
  };

  const formatOffset = (v: number) =>
    `${v >= 0 ? '+' : ''}${v}px`;

  return (
    <div className="col-span-2 space-y-3 mt-2 bg-stone-900/60 p-3.5 rounded-lg border border-stone-800">
      {/* Header */}
      <div className="flex justify-between items-center">
        <label className="text-stone-400 font-bold uppercase tracking-wider text-xs">
          Camera Transform
        </label>
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-amber-400 bg-stone-800/50 hover:bg-stone-800 px-2 py-1 rounded transition-colors cursor-pointer"
        >
          <BiReset size={12} /> Reset
        </button>
      </div>

      {/* Zoom slider */}
      <SliderField
        label="Zoom"
        value={t.zoom}
        min={0.1}
        max={5.0}
        step={0.05}
        displayValue={`${t.zoom.toFixed(2)}x`}
        onChange={v => update('zoom', v)}
      />

      {/* X Offset slider */}
      <SliderField
        label="X Offset"
        value={t.offsetX}
        min={-500}
        max={500}
        step={1}
        displayValue={formatOffset(t.offsetX)}
        onChange={v => update('offsetX', v)}
      />

      {/* Y Offset slider */}
      <SliderField
        label="Y Offset"
        value={t.offsetY}
        min={-500}
        max={500}
        step={1}
        displayValue={formatOffset(t.offsetY)}
        onChange={v => update('offsetY', v)}
      />
    </div>
  );
};
