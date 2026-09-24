/**
 * renderQuality — visual-effects quality policy, fully driven by user settings
 * (Settings → Rendering Engine → Visual Effects Quality).
 *
 * Nothing here is hardcoded: the composition receives
 * `quality: { motionBlur: 'off' | 'balanced' | 'full', glassCap: number }`
 * via render props (export) or the settings store (preview), and every helper
 * below derives from that policy object.
 *
 * Modes:
 * - 'off':      no CameraMotionBlur wrapper at all (fastest, flat look).
 * - 'balanced': fewer samples + blur bypassed on settled/static frames
 *               (default — near-identical look, much cheaper).
 * - 'full':     original 5 samples on every blurred frame (slowest, max fidelity).
 */

export type QualityMode = 'preview' | 'export';

type MotionBlurMode = 'off' | 'balanced' | 'full';

export interface QualityPolicy {
  motionBlur: MotionBlurMode;
  /** Max backdrop-blur radius in px (0 = frosted glass disabled). */
  glassCap: number;
}

export const DEFAULT_QUALITY: QualityPolicy = { motionBlur: 'balanced', glassCap: 16 };

/** Frames of grace after an animation settles before blur is bypassed. */
export const MOTION_BLUR_SETTLE_GRACE_FRAMES = 6;

const FULL_SAMPLES = 5;
const BALANCED_PREVIEW_SAMPLES = 2;
const BALANCED_EXPORT_SAMPLES = 3;

/**
 * Normalizes raw render-props / settings input into a safe policy.
 * Unknown values fall back to DEFAULT_QUALITY so a corrupt DB entry can
 * never break rendering.
 */
export function parseQuality(input: unknown): QualityPolicy {
  const raw = (input ?? {}) as Partial<QualityPolicy>;
  const motionBlur: MotionBlurMode =
    raw.motionBlur === 'off' || raw.motionBlur === 'full' || raw.motionBlur === 'balanced'
      ? raw.motionBlur
      : DEFAULT_QUALITY.motionBlur;
  const capNum = Number(raw.glassCap);
  const glassCap = Number.isFinite(capNum)
    ? Math.max(0, Math.min(24, Math.round(capNum)))
    : DEFAULT_QUALITY.glassCap;
  return { motionBlur, glassCap };
}

/** Samples for CameraMotionBlur under the given policy (0 = skip wrapper). */
export function getMotionBlurSamples(mode: QualityMode, quality?: QualityPolicy): number {
  const policy = quality ?? DEFAULT_QUALITY;
  if (policy.motionBlur === 'off') return 0;
  if (policy.motionBlur === 'full') return FULL_SAMPLES;
  return mode === 'preview' ? BALANCED_PREVIEW_SAMPLES : BALANCED_EXPORT_SAMPLES;
}

/** Whether settled/static frames may bypass the blur wrapper (balanced only). */
export function shouldBypassSettledBlur(quality?: QualityPolicy): boolean {
  return (quality ?? DEFAULT_QUALITY).motionBlur === 'balanced';
}

/** Max backdrop-blur radius kept under the given policy (preview caps tighter). */
export function getGlassBlurCap(mode: QualityMode, quality?: QualityPolicy): number {
  const policy = quality ?? DEFAULT_QUALITY;
  const previewCap = Math.min(policy.glassCap, 12);
  return mode === 'preview' ? previewCap : policy.glassCap;
}

/** Extracts the px radius from a `blur(Npx)` string. Returns null if absent. */
export function parseBlurPx(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.match(/blur\(\s*(\d+(?:\.\d+)?)\s*px\s*\)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clamps a backdrop-filter string like `blur(20px)` to the policy cap.
 * Returns undefined when input is empty, blur(0px), or the cap is 0
 * (glass disabled in Settings). Non-blur functions pass through untouched.
 */
export function optimizeBackdropFilter(
  value: string | undefined | null,
  cap: number,
): string | undefined {
  if (!value) return undefined;
  const px = parseBlurPx(value);
  if (px === null) return value; // not a blur() filter — leave alone
  if (px <= 0 || cap <= 0) return undefined;
  const capped = Math.min(px, cap);
  if (capped === px) return value;
  return value.replace(/blur\(\s*\d+(?:\.\d+)?\s*px\s*\)/, `blur(${capped}px)`);
}
