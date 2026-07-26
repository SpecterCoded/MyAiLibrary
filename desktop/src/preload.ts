import { contextBridge, ipcRenderer } from 'electron'
import type { InstalledUpdateInfo, UpdatePreferences, UpdateState } from './update-types'

export type BackendState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
export type BackendStateListener = (state: BackendState, detail?: string) => void

type AttachmentViewerKind = 'image' | 'video' | 'audio' | 'pdf'

interface AttachmentViewerItem {
  id: string
  kind: AttachmentViewerKind
  name: string
  url: string
  mimeType?: string
  size?: number
  pageCount?: number
  sourcePath?: string
}

interface AttachmentViewerPayload {
  attachments: AttachmentViewerItem[]
  activeIndex: number
}

const ATTACHMENT_VIEWER_CHANNELS = {
  payload: 'attachment-viewer:payload',
  close: 'attachment-viewer:close',
  minimize: 'attachment-viewer:minimize',
  toggleMaximize: 'attachment-viewer:toggle-maximize',
  isMaximized: 'attachment-viewer:is-maximized',
  toggleAlwaysOnTop: 'attachment-viewer:toggle-always-on-top',
  getAlwaysOnTop: 'attachment-viewer:get-always-on-top',
  showInFolder: 'attachment-viewer:show-in-folder',
  saveAs: 'attachment-viewer:save-as',
} as const

const DESKTOP_ATTACHMENTS_CHANNELS = {
  openViewer: 'desktop-attachments:open-viewer',
} as const

function isBackendLogShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key.toLowerCase()
  const isCtrlT = !event.shiftKey && (key === 't' || event.code === 'KeyT')
  const isLegacyShortcut = event.shiftKey && (key === 'l' || event.code === 'KeyL')
  return isCtrlT || isLegacyShortcut
}

window.addEventListener(
  'keydown',
  (event) => {
    if (!isBackendLogShortcut(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void ipcRenderer.invoke('desktop:open-backend-log-terminal')
  },
  { capture: true },
)

contextBridge.exposeInMainWorld('desktop', {
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-file'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-folder'),
  revealPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('desktop:reveal-path', targetPath),
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-version'),
  getUpdateState: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:install-update'),
  getUpdatePreferences: (): Promise<UpdatePreferences | null> => ipcRenderer.invoke('desktop:get-update-preferences'),
  getInstalledUpdate: (): Promise<InstalledUpdateInfo | null> => ipcRenderer.invoke('desktop:get-installed-update'),
  setUpdatePreferences: (preferences: Partial<UpdatePreferences>): Promise<UpdatePreferences | null> => ipcRenderer.invoke('desktop:set-update-preferences', preferences),
  openUpdateLogs: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-update-logs'),
  getAppInfo: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('desktop:get-app-info'),
  openBackendLogTerminal: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-backend-log-terminal'),
  getSystemTheme: (): Promise<'light' | 'dark'> => ipcRenderer.invoke('desktop:get-system-theme'),
  setTitleBarTheme: (theme: 'light' | 'dark'): Promise<boolean> => ipcRenderer.invoke('desktop:set-titlebar-theme', theme),
  setWindowControlsHidden: (hidden: boolean): Promise<boolean> => ipcRenderer.invoke('desktop:set-window-controls-hidden', hidden),
  onSystemThemeChanged: (listener: (theme: 'light' | 'dark') => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, theme: 'light' | 'dark') => listener(theme)
    ipcRenderer.on('desktop:system-theme-changed', wrapped)
    return () => ipcRenderer.removeListener('desktop:system-theme-changed', wrapped)
  },
  onBackendState: (listener: BackendStateListener): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: BackendState, detail?: string) => listener(state, detail)
    ipcRenderer.on('desktop:backend-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:backend-state', wrapped)
  },
  onUpdateState: (listener: (state: UpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('desktop:update-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:update-state', wrapped)
  },
  onUpdateInstalled: (listener: (info: InstalledUpdateInfo) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, info: InstalledUpdateInfo) => listener(info)
    ipcRenderer.on('desktop:update-installed', wrapped)
    return () => ipcRenderer.removeListener('desktop:update-installed', wrapped)
  },
})

contextBridge.exposeInMainWorld('desktopAttachments', {
  openViewer: (payload: AttachmentViewerPayload): void => {
    ipcRenderer.send(DESKTOP_ATTACHMENTS_CHANNELS.openViewer, payload)
  },
})

contextBridge.exposeInMainWorld('attachmentViewer', {
  onPayload: (listener: (payload: AttachmentViewerPayload) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AttachmentViewerPayload) => listener(payload)
    ipcRenderer.on(ATTACHMENT_VIEWER_CHANNELS.payload, wrapped)
    return () => ipcRenderer.removeListener(ATTACHMENT_VIEWER_CHANNELS.payload, wrapped)
  },
  close: (): void => ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.close),
  minimize: (): void => ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.minimize),
  toggleMaximize: (): void => ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.toggleMaximize),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.isMaximized),
  toggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.toggleAlwaysOnTop),
  getAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.getAlwaysOnTop),
  showInFolder: (attachmentId: string): void => ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.showInFolder, attachmentId),
  saveAs: (attachmentId: string): void => ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.saveAs, attachmentId),
})
