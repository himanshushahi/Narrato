import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeEelListeners } from './store/eelListeners'
import { disableBrowserShortcutsInProduction } from './utils/browserShortcuts'

// Initialize security/native-feel behaviors
disableBrowserShortcutsInProduction();

// Early initialize Eel listeners to map incoming Python callback calls directly to Zustand state
try {
  initializeEelListeners();
} catch (error) {
  console.warn("Eel listeners initialization skipped (not running in Eel environment):", error);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
