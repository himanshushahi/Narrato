/** Per-layer-type capability rules for the Advanced tabs (Layout / Filters / Motion FX).
 *
 * Rendering itself is universal (container + ASTAnimator wrapper apply to every
 * type), so these rules only drive *editor* hints: info notes, never data loss.
 */

import { hasSpatialMotion } from '../../../components/video/spatialMotion';

export type LayerKind =
  | 'Image'
  | 'Video'
  | 'Text'
  | 'Chart'
  | 'Shape'
  | 'Lottie'
  | 'Particles'
  | 'HTML'
  | 'Map'
  | 'Unknown';

export interface LayerCapability {
  /** Hint shown in the Filters tab for this type, if any. */
  filterNote?: string;
  /** Note for the Coordinates & Dimensions section (resize crops rather than refits). */
  dimensionsNote?: string;
  /** Note for the Transform section (rotation exposes canvas edges). */
  transformNote?: string;
  /** When true, SVG url(#fx-*) look presets are disabled (transparent canvas). */
  disableSvgLooks?: boolean;
}

const PARTICLES_FILTER =
  'Note: SVG duotone/thermal looks expect opaque pixels — on the sparse transparent particle canvas they can look empty. CSS grades (brightness/contrast) work fine.';
const PARTICLES_DIMS =
  'Note: resizing crops the fixed full-frame emitter field instead of refitting it — Fullscreen is recommended for Particles.';
const MAP_DIMS =
  'Note: the map renders full-canvas and ignores inner sizing — shrinking this layer crops the world map instead of fitting it. Fullscreen is recommended for Map.';
const CANVAS_ROTATE =
  'Note: rotation turns the whole full-frame canvas and exposes the composition background at the corners — prefer small angles for full-frame layers.';

export function normalizeLayerKind(raw: unknown): LayerKind {
  const s = String(raw ?? '').trim().toLowerCase();
  switch (s) {
    case 'video':
      return 'Video';
    case 'text':
      return 'Text';
    case 'chart':
      return 'Chart';
    case 'shape':
      return 'Shape';
    case 'lottie':
      return 'Lottie';
    case 'particles':
      return 'Particles';
    case 'html':
      return 'HTML';
    case 'map':
      return 'Map';
    case 'image':
    case '':
      return 'Image';
    default:
      return 'Unknown';
  }
}

export function getLayerCapability(kind: LayerKind): LayerCapability {
  switch (kind) {
    case 'Text':
    case 'Chart':
    case 'HTML':
    case 'Shape':
    case 'Image':
    case 'Video':
    case 'Lottie':
      return {};
    case 'Particles':
      return {
        filterNote: PARTICLES_FILTER,
        dimensionsNote: PARTICLES_DIMS,
        transformNote: CANVAS_ROTATE,
        disableSvgLooks: true,
      };
    case 'Map':
      return { dimensionsNote: MAP_DIMS, transformNote: CANVAS_ROTATE };
    case 'Unknown':
    default:
      return {};
  }
}

/** Only spatial keyframes produce shutter motion — opacity/blur/brightness fades don't. */
export { SPATIAL_ANIMATION_PROPS } from '../../../components/video/spatialMotion';

// ── Style key support (warning surface) ─────────────────────────────────
// Warn-don't-block contract: the renderer honors any CSS it receives and the
// backend only repairs geometry-breakers, so `blocked` is exactly the set of
// keys no UI or overlay can represent — a raw `transform` (renders outside
// the canvas overlay box) and non-`absolute` `position` (renderer forces
// absolute containers). Everything else with no visual editor lands in
// `advanced`: it renders, it is editable as JSON, and frequent keys earn a
// control later (promote-by-data). Positioning keys
// (position/left/top/right/bottom) count as covered: canvas drag + Layout
// sliders/presets operate on them even when a particular anchor lacks a
// dedicated slider.
// Keys with a real GUI control (Layout tab / type panels / canvas drag).
const GUI_UNIVERSAL_KEYS: ReadonlySet<string> = new Set([
  'position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  'borderRadius', 'rotate', 'scale', 'scaleX', 'scaleY',
]);

const GUI_EXTRAS_BY_KIND: Record<string, ReadonlySet<string>> = {
  Text: new Set(['fontSize', 'textAlign', 'lineHeight', 'letterSpacing', 'textShadow', 'fontStyle']),
  Chart: new Set(['color']),
  Image: new Set(['objectFit', 'aspectRatio']),
  Video: new Set(['objectFit', 'aspectRatio']),
};

export interface StyleKeySupport {
  /** Keys with no visual editor (render fine — edit via JSON). */
  advanced: string[];
  /** Keys that break overlay geometry with no possible UI representation
   * (`transform`, non-`absolute` position). */
  blocked: string[];
}

export function getStyleKeySupport(kind: LayerKind, style: unknown): StyleKeySupport {
  const advanced: string[] = [];
  const blocked: string[] = [];
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return { advanced, blocked };
  }
  const guiExtras = GUI_EXTRAS_BY_KIND[kind] ?? new Set<string>();
  const entries = Object.entries(style as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (
      key === 'transform' ||
      (key === 'position' && typeof value === 'string' && value.trim() !== '' && value.trim() !== 'absolute')
    ) {
      blocked.push(key);
      continue;
    }
    if (!GUI_UNIVERSAL_KEYS.has(key) && !guiExtras.has(key)) {
      advanced.push(key);
    }
  }
  advanced.sort();
  blocked.sort();
  return { advanced, blocked };
}

/** Remediation hints for blocked keys (shown beside the warning). */
export const BLOCKED_STYLE_HINTS: Record<string, string> = {
  transform: 'Use rotate / scale / scaleX / scaleY instead — raw transform renders outside the canvas overlay box.',
  position: 'Position is always absolute — other values break the overlay box.',
  src: 'Folded into lottie_url by the validator — set the Lottie URL field instead.',
};

/** Guidance hints for advanced keys (shown beside the warning). */
export const ADVANCED_STYLE_HINTS: Record<string, string> = {
  opacity: 'Renders, but prefer the Animations tab (opacity keyframe).',
  filter: 'Renders, but prefer the Filters tab.',
  display: 'Takes effect, but can hide the layer with no control to undo — prefer removing it.',
  mixBlendMode: 'Works on some layers; prefer filters "mix-blend-mode: X" (Filters tab).',
  fontFamily: 'Moved to the Font Family dropdown by the validator when empty.',
  fontWeight: 'Moved to the Weight dropdown by the validator when empty.',
  justifyContent: 'Overrides the Align dropdown — remove it to make Align work.',
};

/** Shutter-angle slider needs blur ON plus real spatial motion (anim, float or shake). */
export function getMotionState(opts: {
  motionBlur: boolean;
  animations?: { property?: string; duration?: unknown; from?: unknown; to?: unknown }[];
  floating: boolean;
  cameraShake?: string;
}): { hasMotion: boolean; shutterDisabled: boolean; shutterReason?: string } {
  // Same predicate as the renderer (./spatialMotion) — incl. numeric guards.
  const hasMotion = hasSpatialMotion(opts.animations, opts.floating, opts.cameraShake);
  if (!opts.motionBlur) {
    return {
      hasMotion,
      shutterDisabled: true,
      shutterReason: 'Enable Motion Blur first — then the shutter angle controls the blur spread.',
    };
  }
  if (!hasMotion) {
    return {
      hasMotion,
      shutterDisabled: true,
      shutterReason:
        'Motion Blur needs physical movement (scale/slide/rotate keyframe, floating drift, or camera shake). Opacity and blur/brightness fades alone produce no shutter motion — add a spatial keyframe first.',
    };
  }
  return { hasMotion, shutterDisabled: false };
}

/** True for SVG-filter look tokens (emboss / sharpen / posterize / duotones / thermal). */
export const isSvgLookToken = (filter: string): boolean =>
  /url\s*\(\s*#fx-/i.test(String(filter ?? ''));
