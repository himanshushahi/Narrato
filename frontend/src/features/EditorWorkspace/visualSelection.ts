/**
 * Shared selection model for the Visuals editor tab.
 *
 * Selection is stored in timeline/manifest coordinates (sceneIdx, subIdx) —
 * the same indices the Timeline, MediaSidebar assets, and sceneTimings use.
 * These helpers resolve a selection to the script.json section it edits
 * (introduction / scenes[i] / conclusion), mirroring the mapping used by
 * the timeline edit handlers in EditorWorkspace.
 */

export interface VisualSelection {
  /** Manifest/timeline scene index (includes introduction at 0 when present). */
  sceneIdx: number;
  /** Sub-visual index within the scene. */
  subIdx: number;
}

export type VisualSection = 'introduction' | 'scenes' | 'conclusion';

export interface ResolvedVisual {
  /** Script card key convention shared with the save flow. */
  cardKey: string;
  /** Index into scriptData.scenes (-1 for introduction/conclusion). */
  sceneNumber: number;
  sectionType: VisualSection;
  title: string;
  /** Full sub-visuals array of the section (script source of truth). */
  subVisuals: any[];
  sceneTiming?: { start: number; end: number };
  subTiming?: { start: number; end: number };
  totalDurationFrames: number;
}

/** Manifest scene index → script scenes index (skips introduction).
 * Assumes manifest ↔ script intro symmetry (both are written together by the
 * save pipeline). If the manifest is stale (intro added/removed without sync),
 * the index may point at the wrong scene — callers treat a missing scriptScene
 * as null (unresolvable) rather than guessing. */
export function manifestToScriptSceneIndex(manifestData: any[], manifestIdx: number): number {
  let scriptIdx = 0;
  for (let i = 0; i < manifestIdx && i < manifestData.length; i++) {
    if (manifestData[i]?.section_type === 'scene') scriptIdx++;
  }
  return scriptIdx;
}

export function resolveVisualSelection(
  scriptData: any,
  manifestData: any[],
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>,
  sel: VisualSelection | null,
): ResolvedVisual | null {
  if (!scriptData || !sel) return null;
  const manifestScene = manifestData?.[sel.sceneIdx];
  if (!manifestScene) return null;

  const sectionType = manifestScene.section_type;
  const timing = sceneTimings?.[sel.sceneIdx];

  // NOTE: empty / out-of-range sections intentionally return a resolved object
  // (with possibly-empty subVisuals) instead of null, so the Visuals tab can
  // show the section header + "Add Cut" recovery. Null is reserved for "no
  // section at all" (missing manifest entry / missing script section).
  if (sectionType === 'introduction' && scriptData.introduction) {
    const subVisuals = scriptData.introduction.sub_visuals || [];
    return {
      cardKey: 'intro',
      sceneNumber: -1,
      sectionType: 'introduction',
      title: 'Introduction',
      subVisuals,
      sceneTiming: timing,
      subTiming: timing?.subs?.[sel.subIdx],
      totalDurationFrames: timing ? timing.end - timing.start : 0,
    };
  }

  if (sectionType === 'conclusion' && scriptData.conclusion) {
    const subVisuals = scriptData.conclusion.sub_visuals || [];
    return {
      cardKey: 'conclusion',
      sceneNumber: -1,
      sectionType: 'conclusion',
      title: 'Conclusion',
      subVisuals,
      sceneTiming: timing,
      subTiming: timing?.subs?.[sel.subIdx],
      totalDurationFrames: timing ? timing.end - timing.start : 0,
    };
  }

  if (sectionType === 'scene' && Array.isArray(scriptData.scenes)) {
    const manifestHasIntro = manifestData?.[0]?.section_type === 'introduction';
    const scriptHasIntro = !!scriptData.introduction;
    const countIdx = manifestToScriptSceneIndex(manifestData, sel.sceneIdx);
    // Positional fallback for stale manifests (intro added/removed on one
    // side without sync): mirror the timeline mapping (sceneIndex - hasIntro).
    const positionalIdx = sel.sceneIdx - (manifestHasIntro ? 1 : 0);
    const candidates = [countIdx, positionalIdx].filter(
      (v, i, a) => Number.isInteger(v) && (v as number) >= 0 && a.indexOf(v) === i,
    ) as number[];
    const manifestTitle = (manifestScene as any)?.title as string | undefined;
    let scriptIdx = -1;
    // Prefer the candidate whose script title matches the manifest title;
    // without titles, prefer the count mapping (pre-existing behavior).
    for (const c of candidates) {
      const s = scriptData.scenes[c];
      if (!s) continue;
      if (!manifestTitle || !s.title || s.title === manifestTitle) { scriptIdx = c; break; }
    }
    // Title mismatch on all candidates: if the manifest/side intro presence
    // disagrees (stale manifest), the two mappings point at different scenes.
    // When script intro presence disagrees with the manifest, try compensating
    // by ±1 before giving up.
    if (scriptIdx === -1 && manifestHasIntro !== scriptHasIntro) {
      for (const c of candidates.flatMap((c) => [c - 1, c + 1])) {
        const s = scriptData.scenes[c];
        if (!s) continue;
        if (!manifestTitle || !s.title || s.title === manifestTitle) { scriptIdx = c; break; }
      }
    }
    if (scriptIdx === -1) return null;
    const scriptScene = scriptData.scenes[scriptIdx];
    if (!scriptScene) return null;
    const subVisuals = scriptScene.sub_visuals || [];
    return {
      cardKey: `scene_${scriptIdx}`,
      sceneNumber: scriptIdx,
      sectionType: 'scenes',
      title: scriptScene.title || `Scene ${scriptIdx + 1}`,
      subVisuals,
      sceneTiming: timing,
      subTiming: timing?.subs?.[sel.subIdx],
      totalDurationFrames: timing ? timing.end - timing.start : 0,
    };
  }

  return null;
}
