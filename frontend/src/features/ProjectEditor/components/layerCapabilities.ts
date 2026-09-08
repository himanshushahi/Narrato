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
