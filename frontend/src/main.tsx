import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeEelListeners } from './store/eelListeners'
import { disableBrowserShortcutsInProduction } from './utils/browserShortcuts'


// Initialize security/native-feel behaviors
disableBrowserShortcutsInProduction();

/**
 * Initialize Eel connection and listeners before rendering the app.
 *
 * KEY FIX for "no connection on first launch" issue:
 * - On first launch after install, the frontend often loads before Python's
 *   WebSocket server is ready. The original code would fail silently.
 * - Now we start the connection monitor immediately, which will retry
 *   connecting with exponential backoff until the backend is ready.
 * - The app renders immediately but shows a "connecting" state until ready.
 */
try {
  initializeEelListeners();
  console.log("[Main] Eel listeners initialized, connection monitor active");
} catch (error) {
  console.warn("Eel listeners initialization skipped (not running in Eel environment):", error);
}

// Render the app - connection status is now displayed in the UI
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)