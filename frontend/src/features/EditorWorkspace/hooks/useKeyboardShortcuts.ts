import { useEffect, useRef } from 'react';

interface ShortcutHandlers {
  onSave: () => void;
  onPlayPause: () => void;
  onUndo?: () => void;
  onOpenCommandPalette?: () => void;
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
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
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

      // Ctrl+K = Command palette
      if (isCtrl && (e.key === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        h.onOpenCommandPalette?.();
        return;
      }

      // Ctrl+E = Edit visuals of active scene
      if (isCtrl && (e.key === 'e' || e.code === 'KeyE')) {
        e.preventDefault();
        e.stopPropagation();
        h.onEditVisuals?.();
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
      if (isInput) return;

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

      // Delete / Backspace = Delete selected item
      if (e.key === 'Delete' || e.key === 'Backspace') {
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
