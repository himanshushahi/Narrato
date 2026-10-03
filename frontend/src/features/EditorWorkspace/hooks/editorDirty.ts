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
