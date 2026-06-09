import { useEffect } from 'react';

interface ShortcutHandlers {
  onSave: () => void;
  onPlayPause: () => void;
  onUndo?: () => void;
  onOpenCommandPalette?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

      // Ctrl+S = Save (always, even in inputs)
      if (isCtrl && e.key === 's') {
        e.preventDefault();
        handlers.onSave();
        return;
      }

      // Space = Play/Pause (only when not in input)
      if (e.key === ' ' && !isInput) {
        e.preventDefault();
        handlers.onPlayPause();
        return;
      }

      // Ctrl+Z = Undo
      if (isCtrl && e.key === 'z' && handlers.onUndo) {
        e.preventDefault();
        handlers.onUndo();
        return;
      }

      // Ctrl+K = Command palette
      if (isCtrl && e.key === 'k' && handlers.onOpenCommandPalette) {
        e.preventDefault();
        handlers.onOpenCommandPalette();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
