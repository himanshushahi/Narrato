import { VISUAL_TYPE_OPTIONS } from '../features/ProjectEditor/constants';

/**
 * Normalize a sub-visual's visual_type to one of the canonical option values.
 * The backend decides video vs image upload with a strict `in ('scene', 'youtube')`
 * check, while stored types can be fuzzily labelled ("scene video", "YouTube Clip",
 * localized labels). Normalizing once here keeps the UI (button labels, dialogs)
 * and the backend (upload dialog type) consistent.
 */
export const getValidVisualType = (type: string): string => {
  if (!type) return 'scene';
  const t = String(type).toLowerCase();
  if (VISUAL_TYPE_OPTIONS.some((o) => o.value === t)) return t;
  const match = VISUAL_TYPE_OPTIONS.find((o) => o.label.toLowerCase() === t);
  if (match) return match.value;
  if (t.includes('parallax')) return 'parallax';
  if (t.includes('portrait')) return 'portrait';
  if (t.includes('youtube') || t.includes('video')) return 'youtube';
  if (t.includes('image')) return 'image';
  return 'scene';
};
