/**
 * Disables default browser behaviors and shortcuts in production mode
 * to create a native desktop application experience.
 */
export function disableBrowserShortcutsInProduction() {
  if (!import.meta.env.PROD) {
    return;
  }

  // Prevent Context Menu (Right Click)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Prevent keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Helper to check if Ctrl (or Cmd on Mac) is pressed
    const isCtrl = e.ctrlKey || e.metaKey;

    // 1. Reloading (F5, Ctrl+R, Ctrl+Shift+R)
    if (e.key === 'F5' || (isCtrl && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
    }
    
    // 2. DevTools & View Source (F12, Ctrl+Shift+I/J/C, Ctrl+U)
    if (
      e.key === 'F12' ||
      (isCtrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) ||
      (isCtrl && e.key.toLowerCase() === 'u')
    ) {
      e.preventDefault();
    }

    // 3. Printing & Saving (Ctrl+P, Ctrl+S)
    if (isCtrl && ['p', 's'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }

    // 4. Find (F3, Ctrl+F)
    if (e.key === 'F3' || (isCtrl && e.key.toLowerCase() === 'f')) {
      e.preventDefault();
    }

    // 5. Tab and Window Management (Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Tab, Ctrl+1-9)
    if (
      isCtrl && 
      (['t', 'w', 'n'].includes(e.key.toLowerCase()) || 
       e.key === 'Tab' || 
       (e.key >= '1' && e.key <= '9'))
    ) {
      e.preventDefault();
    }

    // 6. Navigation and Address Bar (Ctrl+L, Alt+D)
    if ((isCtrl && e.key.toLowerCase() === 'l') || (e.altKey && e.key.toLowerCase() === 'd')) {
      e.preventDefault();
    }

    // 7. History, Downloads, Bookmarks (Ctrl+H, Ctrl+J, Ctrl+D, Ctrl+Shift+O, Ctrl+Shift+Delete)
    if (
      isCtrl && 
      (['h', 'j', 'd', 'o'].includes(e.key.toLowerCase()) || e.key === 'Delete')
    ) {
      e.preventDefault();
    }

    // 8. Backspace navigation (if not in input/textarea/contenteditable)
    if (e.key === 'Backspace') {
      const target = e.target as HTMLElement;
      if (
        target.tagName !== 'INPUT' &&
        target.tagName !== 'TEXTAREA' &&
        !target.isContentEditable
      ) {
        e.preventDefault();
      }
    }
    
    // 10. Alt+Left / Alt+Right (Browser History Navigation)
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent dragging images or links
  document.addEventListener('dragstart', (e) => {
    if (e.target instanceof HTMLImageElement || e.target instanceof HTMLAnchorElement) {
      e.preventDefault();
    }
  });
}
