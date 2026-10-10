/**
 * Single source of truth for kinetic subtitle styling.
 *
 * Every layer of the subtitle pipeline reads from here:
 * - `KineticSubtitles.tsx` merges user settings over SUBTITLE_DEFAULTS
 *   (no more scattered `|| fallback` literals drifting apart).
 * - `SubtitleStyleControls.tsx` builds its controls from the same keys.
 * - `SubtitleSettings.tsx` saves/compares presets via SUBTITLE_KEYS.
 * - Backend (`render.py`) hashes the whole settings dict, so new keys
 *   invalidate the frame cache automatically; `agent/tools.py`
 *   (SUBTITLE_SETTING_KEYS + VISUAL_SETTINGS_SPEC) mirrors these keys
 *   for agent-side validation.
 *
 * Back-compat: `showBackgroundHighlight` (legacy boolean) is still honored
 * by the renderer via resolveBackgroundStyle(); `bottomOffset`/`topOffset`
 * stay pixel-based unless the user switches position mode.
 */

export const SUBTITLE_DEFAULTS = {
  // — Typography —
  fontFamily: 'Montserrat',
  fontSize: 54,
  fontWeight: 800,
  wordSpacing: 18,
  lineHeight: 1.25,
  textTransform: 'uppercase' as string,
  // — Colors —
  activeColor: '#fbbf24',
  pastColor: '#d6d3d1',
  futureColor: '#f5f5f4',
  // — Stroke & glow (viral-caption markers) —
  strokeWidth: 0, // px, 0 = off. 2-4px is the Hormozi/Beast look.
  strokeColor: '#000000',
  glowRadius: 15, // px halo behind the active word, 0 = off
  glowColor: '', // empty = follow activeColor
  // — Active-word pill (Hormozi box highlight) —
  pillStyle: 'none' as string, // 'none' | 'active'
  pillBgColor: '', // empty = follow highlight/active color
  pillRadius: 10, // px corner radius
  pillPadding: '2px 14px',
  pillTextColor: '', // empty = follow activeColor
  // — Motion —
  activeAnimation: 'bounce' as string, // bounce|pop|jump|slide|fade|scale|tilt|none
  // — Layout —
  layoutMode: 'sentence' as string, // sentence|karaoke|stack
  wordsPerScreen: 10,
  karaokeWindow: 5, // words visible around the active word in karaoke mode
  // — Position —
  position: 'bottom' as string, // bottom|center|top (per-cut displacement still wins)
  bottomOffset: 120, // px from bottom edge
  topOffset: 100, // px from top edge
  // — Backgrounds —
  backgroundStyle: 'highlight' as string, // none|highlight|full_block
  highlightBgColor: '#fbbf24',
  fullBgColor: 'rgba(0,0,0,0.6)',
} as const;

export type SubtitleSettingsShape = { [K in keyof typeof SUBTITLE_DEFAULTS]: (typeof SUBTITLE_DEFAULTS)[K] };

/** Every key persisted into presets and validated backend-side. */
export const SUBTITLE_KEYS = Object.keys(SUBTITLE_DEFAULTS);

/** Merge user settings over defaults + normalize legacy shapes. */
export function withSubtitleDefaults(settings: any): { [k: string]: any } {
  const merged: { [k: string]: any } = { ...(SUBTITLE_DEFAULTS as any), ...(settings || {}) };
  merged.backgroundStyle = resolveBackgroundStyle(merged);
  // fontWeight may arrive as a string ("800") from older blobs — the
  // renderer and preset-compare both need the numeric form.
  if (typeof merged.fontWeight === 'string') {
    const n = parseInt(merged.fontWeight, 10);
    merged.fontWeight = Number.isFinite(n) ? n : (SUBTITLE_DEFAULTS as any).fontWeight;
  }
  return merged;
}

/** Legacy `showBackgroundHighlight` boolean → `backgroundStyle`. */
export function resolveBackgroundStyle(s: any): string {
  if (s?.backgroundStyle) return s.backgroundStyle;
  return s?.showBackgroundHighlight !== false ? 'highlight' : 'none';
}

/** Pick defined keys out of a settings object (preset save/apply). */
export function extractSubtitleKeys(obj: any): { [k: string]: any } {
  const out: { [k: string]: any } = {};
  for (const k of SUBTITLE_KEYS) {
    if (obj?.[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Apply a (possibly partial) preset: keys the preset omits reset to
 *  defaults, so switching e.g. Beast Loud → Minimal White can't leave
 *  karaoke layout or a 3px outline behind. Returns a full key set. */
export function applyPresetOverDefaults(presetSettings: any): { [k: string]: any } {
  return extractSubtitleKeys({ ...(SUBTITLE_DEFAULTS as any), ...(presetSettings || {}) });
}

/** Portrait guard: a preset's landscape offset would sit under platform UI
 *  (bottom 28% safe area). Clamp up to the portrait-safe baseline. */
export function portraitSafePreset(presetSettings: any, isPortrait: boolean): { [k: string]: any } {
  if (!isPortrait) return presetSettings || {};
  const out = { ...(presetSettings || {}) };
  const minOffset = PORTRAIT_SUBTITLE_DEFAULTS.bottomOffset;
  if (out.bottomOffset !== undefined && out.bottomOffset < minOffset) {
    out.bottomOffset = minOffset;
  }
  return out;
}

/** True when a preset matches current settings (missing keys = defaults,
 *  legacy string weights normalized — both sides go through defaults). */
export function isPresetActive(preset: any, settings: any): boolean {
  const p = withSubtitleDefaults(preset?.settings ?? preset ?? {});
  const cur = withSubtitleDefaults(settings);
  for (const k of SUBTITLE_KEYS) {
    if (cur[k] !== p[k]) return false;
  }
  return true;
}

// ── Viral preset pack ─────────────────────────────────────────────
// Each entry is a partial settings object (missing keys = defaults).
// `label`/`desc` are UI-only and never persisted into project_settings.

export interface ViralPreset {
  id: string;
  label: string;
  desc: string;
  swatch: string; // dot color shown in the gallery
  settings: { [k: string]: any };
}

export const VIRAL_PRESETS: ViralPreset[] = [
  {
    id: 'hormozi_viral',
    label: 'Hormozi Viral',
    desc: 'Bold caps, outlined, yellow box on the spoken word',
    swatch: '#facc15',
    settings: {
      fontFamily: 'Anton',
      fontSize: 64,
      fontWeight: 800,
      wordSpacing: 16,
      textTransform: 'uppercase',
      activeColor: '#0c0a09',
      pastColor: '#ffffff',
      futureColor: '#ffffff',
      strokeWidth: 2,
      strokeColor: '#000000',
      glowRadius: 0,
      pillStyle: 'active',
      pillBgColor: '#facc15',
      pillRadius: 8,
      pillTextColor: '#0c0a09',
      activeAnimation: 'pop',
      layoutMode: 'sentence',
      wordsPerScreen: 7,
      backgroundStyle: 'none',
      position: 'bottom',
      bottomOffset: 140,
    },
  },
  {
    id: 'abdaal_clean',
    label: 'Abdaal Clean',
    desc: 'Lowercase, soft pop of color, no boxes',
    swatch: '#fde047',
    settings: {
      fontFamily: 'Inter',
      fontSize: 50,
      fontWeight: 700,
      wordSpacing: 12,
      textTransform: 'none',
      activeColor: '#fde047',
      pastColor: '#e4e4e7',
      futureColor: '#f5f5f4',
      strokeWidth: 0,
      glowRadius: 12,
      pillStyle: 'none',
      activeAnimation: 'fade',
      layoutMode: 'sentence',
      wordsPerScreen: 8,
      backgroundStyle: 'none',
      position: 'bottom',
      bottomOffset: 120,
    },
  },
  {
    id: 'beast_loud',
    label: 'Beast Loud',
    desc: 'Huge condensed type, heavy outline, max energy',
    swatch: '#ffff00',
    settings: {
      fontFamily: 'Anton',
      fontSize: 84,
      fontWeight: 800,
      wordSpacing: 20,
      textTransform: 'uppercase',
      activeColor: '#ffff00',
      pastColor: '#ffffff',
      futureColor: '#ffffff',
      strokeWidth: 3,
      strokeColor: '#000000',
      glowRadius: 0,
      pillStyle: 'none',
      activeAnimation: 'bounce',
      layoutMode: 'karaoke',
      karaokeWindow: 5,
      wordsPerScreen: 5,
      backgroundStyle: 'none',
      position: 'bottom',
      bottomOffset: 160,
    },
  },
  {
    id: 'hindi_viral',
    label: 'Hindi Viral',
    desc: 'Big Devanagari, amber karaoke underline',
    swatch: '#facc15',
    settings: {
      fontFamily: 'Mukta',
      fontSize: 72,
      fontWeight: 800,
      wordSpacing: 16,
      textTransform: 'none',
      activeColor: '#facc15',
      pastColor: '#e7e5e4',
      futureColor: '#f5f5f4',
      strokeWidth: 0,
      glowRadius: 14,
      pillStyle: 'none',
      activeAnimation: 'pop',
      layoutMode: 'sentence',
      wordsPerScreen: 7,
      backgroundStyle: 'highlight',
      highlightBgColor: '#facc15',
      position: 'bottom',
      bottomOffset: 140,
    },
  },
];

/** Portrait-safe starting point (bottom 28% safe area ≈ 540px @1080x1920). */
export const PORTRAIT_SUBTITLE_DEFAULTS: { [k: string]: any } = {
  fontSize: 64,
  wordsPerScreen: 6,
  bottomOffset: 560,
};

/** Font picker options (all downloadable via Google Fonts at runtime). */
export const SUBTITLE_FONT_OPTIONS = [
  { value: 'Anton', label: 'Anton (Viral caps)' },
  { value: 'Archivo Black', label: 'Archivo Black (Viral)' },
  { value: 'Luckiest Guy', label: 'Luckiest Guy (Beast)' },
  { value: 'Titan One', label: 'Titan One (Chunky)' },
  { value: 'Montserrat', label: 'Montserrat (Latin)' },
  { value: 'Inter', label: 'Inter (Latin)' },
  { value: 'Roboto', label: 'Roboto (Latin)' },
  { value: 'Poppins', label: 'Poppins (Supports Hindi)' },
  { value: 'Oswald', label: 'Oswald (Latin)' },
  { value: 'Bebas Neue', label: 'Bebas Neue (Latin)' },
  { value: 'Raleway', label: 'Raleway (Latin)' },
  { value: 'Lato', label: 'Lato (Latin)' },
  { value: 'Hind', label: 'Hind (Supports Hindi)' },
  { value: 'Mukta', label: 'Mukta (Supports Hindi)' },
  { value: 'Kalam', label: 'Kalam (Supports Hindi)' },
  { value: 'Noto Sans Devanagari', label: 'Noto Sans Devanagari' },
];
