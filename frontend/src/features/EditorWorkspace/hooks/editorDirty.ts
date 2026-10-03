/**
 * Cross-hook unsaved-edit signal.
 *
 * useScriptEditing (writer) publishes whether the user currently has an
 * edit session open; useEditorData (reader) checks it before replacing
 * script/design/manifest state with freshly agent-saved files, so a live
 * agent reload can never silently wipe unsaved user edits. The deferred
 * reload fires once the edit session closes.
 *
 * Module-level (not React state) because the writer and reader are sibling
 * hooks with no shared parent state — and the check must also work from
 * plain event callbacks.
 */
let dirty = false;
const listeners = new Set<(d: boolean) => void>();

export function setEditorDirty(d: boolean): void {
  if (d === dirty) return;
  dirty = d;
  listeners.forEach((fn) => {
    try {
      fn(d);
    } catch {
      /* listener errors must never break the publisher */
    }
  });
}

export function isEditorDirty(): boolean {
  return dirty;
}

export function subscribeEditorDirty(fn: (d: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Self-save quiet window (scoped per project).
 *
 * handleSaveCard (Ctrl+S) keeps the edit card open — and dirty — for the
 * whole save (persist + asset fetch + reload tail take seconds). Any
 * project-files-changed event landing in that window is usually the user's
 * OWN save echoing back (or a concurrent event the save tail already
 * reconciles via loadFiles), never a foreign edit worth a toast. The writer
 * marks start/end; the reader (useEditorData scheduleReload) skips the toast
 * while quiet but still defers the reload (own-echo defers are snapshot
 * no-ops; genuine concurrent edits then apply on card close instead of
 * being lost). Depth-counted so overlapping saves can't prematurely close
 * the window; keyed by projectId so one project's save never suppresses
 * another project's genuine events.
 */
const selfSave = new Map<string, { depth: number; endedAt: number }>();
const SELF_SAVE_TAIL_MS = 3000;

export function markSelfSaveStart(projectId: string): void {
  if (!projectId) return;
  const s = selfSave.get(projectId) ?? { depth: 0, endedAt: 0 };
  s.depth += 1;
  selfSave.set(projectId, s);
}

export function markSelfSaveEnd(projectId: string): void {
  if (!projectId) return;
  const s = selfSave.get(projectId);
  if (!s) return;
  s.depth = Math.max(0, s.depth - 1);
  if (s.depth === 0) {
    s.endedAt = Date.now();
  }
  selfSave.set(projectId, s);
}

export function isSelfSaveQuiet(projectId: string): boolean {
  if (!projectId) return false;
  const s = selfSave.get(projectId);
  if (!s) return false;
  if (s.depth > 0) return true;
  return Date.now() - s.endedAt < SELF_SAVE_TAIL_MS;
}
