/**
 * Canonical media-type extension sets.
 * Single source of truth — import these instead of inlining extension checks.
 *
 * NOTE on format nuances:
 * - .gif: Remotion <Img> renders only the first frame (animation lost).
 *         Acceptable trade-off vs crashing <Video>.
 * - .svg: Remotion <Img> applies raster scaling; vector sharpness may differ
 *         from a native <svg> embed. Acceptable for the media layer path.
 */

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif',
  '.gif', '.svg', '.bmp', '.ico', '.tif', '.tiff',
]);

const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.m4v', '.ogv', '.flv', '.3gp',
]);

/** Strips query string and hash fragment, checks extension against IMAGE_EXTS. */
export function isImageFile(path?: string | null): boolean {
  if (!path) return false;
  const clean = path.split('?')[0].split('#')[0].toLowerCase();
  const dot = clean.lastIndexOf('.');
  // Guard: no dot, dot is last char, or dot is in a directory segment (e.g. "v1.2/file").
  if (dot === -1 || dot === clean.length - 1) return false;
  const slash = clean.lastIndexOf('/');
  const backslash = clean.lastIndexOf('\\');
  if (dot < Math.max(slash, backslash)) return false;
  return IMAGE_EXTS.has(clean.slice(dot));
}

/** Strips query string and hash fragment, checks extension against VIDEO_EXTS. */
export function isVideoFile(path?: string | null): boolean {
  if (!path) return false;
  const clean = path.split('?')[0].split('#')[0].toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot === -1 || dot === clean.length - 1) return false;
  const slash = clean.lastIndexOf('/');
  const backslash = clean.lastIndexOf('\\');
  if (dot < Math.max(slash, backslash)) return false;
  return VIDEO_EXTS.has(clean.slice(dot));
}

/**
 * Given a path and a declared content type, returns the effective type
 * corrected by file extension. Falls back to the declared type when
 * the extension is unrecognised (e.g. no extension, or exotic format).
 */
export function inferMediaType(
  path: string | undefined | null,
  declaredType: string,
): 'Image' | 'Video' | string {
  if (isVideoFile(path)) return 'Video';
  if (isImageFile(path)) return 'Image';
  return declaredType;
}
