/** Single source of truth for "does this layer spatially move?" (shutter-blur gating).
 *
 * Only *spatial* keyframes (scale/slide/rotate) produce shutter motion.
 * Opacity/blur/brightness fades render spatially identical subframes, so they
 * must not trigger multi-sample `CameraMotionBlur`. This module lives next to
 * the renderer (not in the editor feature) so both `ASTAnimator` and the
 * editor's `layerCapabilities` import the same logic instead of drifting.
 */

export const SPATIAL_ANIMATION_PROPS: ReadonlySet<string> = new Set([
  'scale',
  'translateX',
  'translateY',
  'rotate',
  'rotateX',
  'rotateY',
]);

export interface SpatialAnimation {
  property?: unknown;
  duration?: unknown;
  from?: unknown;
  to?: unknown;
}

/** A keyframe counts as motion only if the renderer would actually apply it. */
export function isSpatialAnimation(anim: SpatialAnimation | null | undefined): boolean {
  if (!anim) return false;
  if (!SPATIAL_ANIMATION_PROPS.has(String((anim as { property?: unknown }).property ?? ''))) {
    return false;
  }
  // Mirror AnimatedLayer's guards: non-numeric duration/from/to tracks are skipped.
  const { duration, from, to } = anim as { duration?: unknown; from?: unknown; to?: unknown };
  return (
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    typeof from === 'number' &&
    Number.isFinite(from) &&
    typeof to === 'number' &&
    Number.isFinite(to)
  );
}

export function hasSpatialMotion(
  animations: readonly SpatialAnimation[] | null | undefined,
  floating?: unknown,
  cameraShake?: unknown,
): boolean {
  if (floating) return true;
  if (typeof cameraShake === 'string' && cameraShake !== 'none') return true;
  return (animations ?? []).some(isSpatialAnimation);
}
