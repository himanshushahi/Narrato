import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializePywebviewListeners } from './store/pywebviewListeners'
import { disableBrowserShortcutsInProduction } from './utils/browserShortcuts'


// Initialize security/native-feel behaviors
disableBrowserShortcutsInProduction();

/**
 * Initialize pywebview listeners before rendering the app.
 * Falls back gracefully if not in pywebview environment (e.g., browser dev).
 */
async function bootstrap() {
  try {
    await initializePywebviewListeners();
    console.log("[Main] Pywebview listeners initialized");
  } catch (error) {
    console.warn("Pywebview listeners initialization skipped (not in pywebview):", error);
  }

  // Render the app - connection status is now displayed in the UI
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap();