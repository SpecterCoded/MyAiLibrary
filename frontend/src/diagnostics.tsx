import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import SystemConsole from './components/SystemConsole'

function applyDiagnosticsTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme, 'system-console-document')
  document.documentElement.style.colorScheme = theme
}

const requestedTheme = new URLSearchParams(window.location.search).get('theme')
applyDiagnosticsTheme(requestedTheme === 'light' ? 'light' : 'dark')
document.body.classList.add('system-console-document')

void window.systemLogs?.getTheme().then(applyDiagnosticsTheme)
window.systemLogs?.onThemeChanged(applyDiagnosticsTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SystemConsole />
  </StrictMode>,
)
