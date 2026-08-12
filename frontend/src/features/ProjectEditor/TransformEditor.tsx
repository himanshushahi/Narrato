import React, { useCallback, useRef } from 'react';
import { BiReset } from 'react-icons/bi';
import { SubVisualTransform, DEFAULT_TRANSFORM } from '../../components/video/SubVisualTransform';

import { SliderField } from '../../components/ui/SliderField';

// ─── TransformEditor ─────────────────────────────────────────────
interface Props {
  transform?: SubVisualTransform;
  onChange: (newTransform: SubVisualTransform) => void;
}

export const TransformEditor = React.memo(({ transform, onChange }: Props) => {

  const t = transform ?? DEFAULT_TRANSFORM;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const tRef = useRef(t);
  tRef.current = t;

  // Stable per-key handlers (created once, cached by key) that read the
  // latest transform/onChange via refs, so SliderField's memo can skip the
  // sliders whose value didn't change on each drag tick.
  const handlerCache = useRef<Record<string, (v: number) => void>>({});
  const getHandler = useCallback((key: keyof SubVisualTransform) => {
    const cache = handlerCache.current;
    if (!cache[key]) {
      cache[key] = (v: number) => {
        onChangeRef.current({ ...tRef.current, [key]: v });
      };
    }
    return cache[key];
  }, []);

  const resetAll = useCallback(() => {
    onChangeRef.current({ ...DEFAULT_TRANSFORM });
  }, []);

  const formatOffset = (v: number) =>
    `${v >= 0 ? '+' : ''}${v}px`;

  return (
    <div className="col-span-2 space-y-4 mt-3 pt-3 border-t border-white/5">
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <label className="text-stone-400/80 font-medium tracking-wide text-[10px]">
          Camera Transform
        </label>
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-amber-400 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1 rounded-md transition-colors cursor-pointer"
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
        onChange={getHandler('zoom')}
      />

      {/* X Offset slider */}
      <SliderField
        label="X Offset"
        value={t.offsetX}
        min={-500}
        max={500}
        step={1}
        displayValue={formatOffset(t.offsetX)}
        onChange={getHandler('offsetX')}
      />

      {/* Y Offset slider */}
      <SliderField
        label="Y Offset"
        value={t.offsetY}
        min={-500}
        max={500}
        step={1}
        displayValue={formatOffset(t.offsetY)}
        onChange={getHandler('offsetY')}
      />
    </div>
  );
});
TransformEditor.displayName = 'TransformEditor';

