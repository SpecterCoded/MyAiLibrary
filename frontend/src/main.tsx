import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import App from './App'

// Suppress browser extension connection errors globally
if (typeof window !== 'undefined') {
  const isExtensionError = (msg: string) => {
    return msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist');
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason) {
      const msg = reason.message || String(reason);
      if (isExtensionError(msg)) {
        event.preventDefault();
      }
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (isExtensionError(msg)) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
