import { useEffect, useRef } from 'react';

interface ShortcutHandlers {
  onSave: () => void;
  onPlayPause: () => void;
  onUndo?: () => void;
  onEscape?: () => void;
  onDelete?: () => void;
  onSeekRelative?: (delta: number) => void;
  onPrevScene?: () => void;
  onNextScene?: () => void;
  onPrevSubVisual?: () => void;
  onNextSubVisual?: () => void;
  onGoToStart?: () => void;
  onGoToEnd?: () => void;
  onRunPipeline?: () => void;
  onFullscreenToggle?: () => void;
  onEditVisuals?: () => void;
  onDuplicate?: () => void;
  onDeleteLayer?: () => void;
}

function isArrowKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const h = ref.current;

      // Ctrl+S = Save (always)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        h.onSave();
        return;
      }

      // Ctrl+Enter = Run pipeline
      if (isCtrl && (e.key === 'Enter' || e.code === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        h.onRunPipeline?.();
        return;
      }

      // Ctrl+E = Edit visuals of active scene
      if (isCtrl && (e.key === 'e' || e.code === 'KeyE')) {
        e.preventDefault();
        e.stopPropagation();
        h.onEditVisuals?.();
        return;
      }

      // Ctrl+D = Duplicate selected layer (preview-only, saved on Ctrl+S).
      // Skipped inside text fields (Query INPUT, HTML/JSON TEXTAREA, SELECT,
      // contentEditable): typing Ctrl+D there must not spray a clone with no
      // undo. Bookmark is still suppressed via preventDefault. Capture phase
      // handles it in dev and prod.
      // Repeat guard: holding the keys must not spray N clones (no undo yet).
      if (isCtrl && (e.key?.toLowerCase() === 'd' || e.code === 'KeyD')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        const t = e.target as HTMLElement | null;
        if (isInput || t?.isContentEditable) return;
        h.onDuplicate?.();
        return;
      }

      // Ctrl+Arrow = Sub-visual navigation (even in inputs)
      if (isCtrl && isArrowKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowLeft') h.onPrevSubVisual?.();
        else if (e.key === 'ArrowRight') h.onNextSubVisual?.();
        else if (e.key === 'ArrowUp') h.onPrevScene?.();
        else if (e.key === 'ArrowDown') h.onNextScene?.();
        return;
      }

      // F = Fullscreen toggle (only when not in input)
      if ((e.key === 'f' || e.key === 'F') && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        h.onFullscreenToggle?.();
        return;
      }

      // Space = Play/Pause (only when not in input)
      if (e.key === ' ' && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        h.onPlayPause();
        return;
      }

      // Escape = Cancel edit / close modal (always)
      if (e.key === 'Escape') {
        e.preventDefault();
        h.onEscape?.();
        return;
      }

      // Skip input-only shortcuts when focus is in a text field
      // (Ctrl+Backspace keeps its native "delete word" behavior inside inputs).
      if (isInput) return;

      // Ctrl+Backspace/Delete = Delete selected layer (preview-only).
      // Before the plain Delete handler so the Ctrl combo never falls through
      // to scene delete. Only outside text fields; repeat-guarded (no undo).
      if (isCtrl && (e.key === 'Backspace' || e.key === 'Delete' || e.code === 'NumpadDecimal')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        h.onDeleteLayer?.();
        return;
      }

      // ArrowLeft / ArrowRight = Step frames
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        h.onSeekRelative?.(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        h.onSeekRelative?.(1);
        return;
      }

      // ArrowUp / ArrowDown = Previous / Next scene
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        h.onPrevScene?.();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        h.onNextScene?.();
        return;
      }

      // Delete / Backspace / Numpad Del (even with NumLock ON) = Delete selected item
      if (e.key === 'Delete' || e.key === 'Backspace' || e.code === 'NumpadDecimal') {
        e.preventDefault();
        h.onDelete?.();
        return;
      }

      // Home = Go to start
      if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        h.onGoToStart?.();
        return;
      }

      // End = Go to end
      if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        h.onGoToEnd?.();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}
