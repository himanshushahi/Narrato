/**
 * Complex-script font mapping — single source of truth for picking a
 * Google/Noto family that can actually render the project's language.
 * Latin-only fallbacks render Devanagari/Tamil/Arabic as tofu boxes, so
 * any text path (subtitles, Text layers, export) must resolve through here.
 */

/** Matches the Indic/Arabic/Thai blocks we generate voiceover for. */
export const COMPLEX_SCRIPT_RE =
  /[؀-ۿݐ-ݿऀ-ॿঀ-৿਀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ඀-ෟก-๿]/u;

/** True when the text needs a complex-script (non-Latin) font. */
export function isComplexScript(text: string | undefined | null): boolean {
  return COMPLEX_SCRIPT_RE.test(text || '');
}

/** True when the text contains Devanagari (Hindi/Marathi). */
export function isDevanagari(text: string | undefined | null): boolean {
  return /[ऀ-ॿ]/.test(text || '');
}

export const NOTO_FONT_MAP: Record<string, string> = {
  hi: 'Noto Sans Devanagari',
  mr: 'Noto Sans Devanagari',
  bn: 'Noto Sans Bengali',
  ta: 'Noto Sans Tamil',
  te: 'Noto Sans Telugu',
  ar: 'Noto Sans Arabic',
  th: 'Noto Sans Thai',
  gu: 'Noto Sans Gujarati',
  pa: 'Noto Sans Gurmukhi',
  ml: 'Noto Sans Malayalam',
  kn: 'Noto Sans Kannada',
};

/** Noto family for a project language code ('hi' → 'Noto Sans Devanagari'), '' when unknown. */
export function getNotoFamilyForLang(lang: string | undefined | null): string {
  if (!lang) return '';
  return NOTO_FONT_MAP[String(lang).toLowerCase()] || '';
}
