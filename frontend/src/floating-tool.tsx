import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import CommandSearchModal from './components/SearchModal'
import CreatePlaylistModal from './components/CreatePlaylistModal'
import ImportContentModal from './components/ImportContentModal'

type FloatingToolKind = 'search' | 'create-playlist' | 'import-content'

function applyFloatingToolTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
}

function readFloatingToolKind(): FloatingToolKind | null {
  const value = new URLSearchParams(window.location.search).get('tool')
  return value === 'search' || value === 'create-playlist' || value === 'import-content' ? value : null
}

function FloatingToolApp() {
  const tool = readFloatingToolKind()

  useEffect(() => {
    const relayNavigation = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      if (detail) window.desktop?.sendFloatingToolAction({ type: 'navigate', detail })
    }
    const relayPlaylistRefresh = () => {
      window.desktop?.sendFloatingToolAction({ type: 'refresh-playlists' })
    }
    const relayNotebookNavigation = () => {
      window.desktop?.sendFloatingToolAction({ type: 'navigate', detail: { view: 'notebooks' } })
    }
    window.addEventListener('app-navigate', relayNavigation)
    window.addEventListener('refresh-playlists', relayPlaylistRefresh)
    window.addEventListener('open-notebook-view', relayNotebookNavigation)
    return () => {
      window.removeEventListener('app-navigate', relayNavigation)
      window.removeEventListener('refresh-playlists', relayPlaylistRefresh)
      window.removeEventListener('open-notebook-view', relayNotebookNavigation)
    }
  }, [])

  useEffect(() => {
    const preference = localStorage.getItem('app_theme')
    if (preference === 'light' || preference === 'dark') {
      applyFloatingToolTheme(preference)
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applySystemTheme = (dark: boolean) => applyFloatingToolTheme(dark ? 'dark' : 'light')
    applySystemTheme(mediaQuery.matches)
    const handleChange = (event: MediaQueryListEvent) => applySystemTheme(event.matches)
    const removeDesktopListener = window.desktop?.onSystemThemeChanged((theme) => applyFloatingToolTheme(theme))
    mediaQuery.addEventListener('change', handleChange)
    return () => {
      removeDesktopListener?.()
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const closeWindow = () => {
    window.setTimeout(() => {
      if (window.desktop) window.desktop.closeFloatingTool()
      else window.close()
    }, 0)
  }

  if (tool === 'search') {
    return <CommandSearchModal isOpen onClose={closeWindow} isFloating />
  }
  if (tool === 'create-playlist') {
    return <CreatePlaylistModal isOpen onClose={closeWindow} isFloating />
  }
  if (tool === 'import-content') {
    return (
      <ImportContentModal
        isOpen
        isFloating
        onClose={closeWindow}
        onNavigateToDownloads={() => {
          window.desktop?.sendFloatingToolAction({ type: 'navigate', detail: { view: 'downloads' } })
        }}
      />
    )
  }
  return null
}

document.documentElement.classList.add('floating-tool-window')
document.body.classList.add('floating-tool-window')
const initialTheme = localStorage.getItem('app_theme')
applyFloatingToolTheme(
  initialTheme === 'light' || initialTheme === 'dark'
    ? initialTheme
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FloatingToolApp />
  </StrictMode>,
)
