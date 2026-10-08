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

/**
 * Content-based unsaved tracking (per-card).
 *
 * Legacy `setEditorDirty(sessionOpen)` treated any open card as dirty —
 * just opening the Visuals tab blocked agent reloads forever. The new
 * model tracks actual unsaved edits per card: opening/reverting a card is
 * clean, only real mutations mark it dirty. `dirty` is the OR over unsaved
 * cards + in-flight debounced ticks (see below).
 */
const unsavedCards = new Set<string>();
const pendingCards = new Set<string>();
/** Legacy forced flag (no active callers — kept consistent so a forced true
 *  stays sticky until explicitly cleared, never silently overridden). */
let forcedDirty = false;

function recompute(): void {
  const next = forcedDirty || unsavedCards.size > 0 || pendingCards.size > 0;
  if (next === dirty) return;
  dirty = next;
  listeners.forEach((fn) => {
    try {
      fn(dirty);
    } catch {
      /* listener errors must never break the publisher */
    }
  });
}

export function setEditorDirty(d: boolean): void {
  // Legacy force-setter (unmount/project-switch/save tails). When forced
  // clean, also drop per-card state so a stale card can't re-dirty later.
  forcedDirty = d;
  if (!d) {
    unsavedCards.clear();
    pendingCards.clear();
  }
  recompute();
}

/** Mark one card as holding unsaved edits (real mutation happened). */
export function markCardDirty(cardKey: string): void {
  if (!cardKey) return;
  if (unsavedCards.has(cardKey)) return;
  unsavedCards.add(cardKey);
  recompute();
}

/** Mark one card clean (saved / reverted to baseline). Other cards keep state. */
export function markCardClean(cardKey: string): void {
  if (!cardKey) return;
  let changed = false;
  if (unsavedCards.delete(cardKey)) changed = true;
  if (pendingCards.delete(cardKey)) changed = true;
  if (changed) recompute();
}

/** Whole-document persisted (manual save, timeline persist, AI persist). */
export function clearEditorDirty(): void {
  if (!forcedDirty && unsavedCards.size === 0 && pendingCards.size === 0 && !dirty) return;
  forcedDirty = false;
  unsavedCards.clear();
  pendingCards.clear();
  recompute();
}

/** Visuals-tab debounce: ticks scheduled but not yet flushed to the store. */
export function setCardPending(cardKey: string, pending: boolean): void {
  if (!cardKey) return;
  const had = pendingCards.has(cardKey);
  if (pending && !had) {
    pendingCards.add(cardKey);
    recompute();
  } else if (!pending && had) {
    pendingCards.delete(cardKey);
    recompute();
  }
}

export function isEditorDirty(): boolean {
  return dirty;
}

/** Per-card check (for rebaseline guards — clean cards may follow external updates). */
export function isCardDirty(cardKey: string): boolean {
  if (!cardKey) return false;
  return unsavedCards.has(cardKey) || pendingCards.has(cardKey);
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
