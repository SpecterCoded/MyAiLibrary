import { contextBridge, ipcRenderer } from 'electron'
import type { InstalledUpdateInfo, UpdatePreferences, UpdateState } from './update-types'
import type { SystemLogEventInput } from './system-log'

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

interface WorkspaceTabPayload {
  id: string
  title: string
  kind: string
  params?: Record<string, string | number | undefined>
  createdAt: number
  updatedAt: number
}

interface WorkspaceTabsStatePayload {
  tabs: WorkspaceTabPayload[]
  activeTabId: string
}

type FloatingToolKind = 'search' | 'create-playlist' | 'import-content'
type FloatingToolAction =
  | { type: 'navigate'; detail: Record<string, unknown> }
  | { type: 'refresh-playlists' }

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

contextBridge.exposeInMainWorld('desktop', {
  openFloatingTool: (kind: FloatingToolKind): Promise<boolean> =>
    ipcRenderer.invoke('desktop:open-floating-tool', kind),
  closeFloatingTool: (): void => ipcRenderer.send('desktop:close-floating-tool'),
  floatingToolReady: (): Promise<boolean> => ipcRenderer.invoke('desktop:floating-tool-ready'),
  moveFloatingToolBy: (deltaX: number, deltaY: number): void =>
    ipcRenderer.send('desktop:move-floating-tool', deltaX, deltaY),
  sendFloatingToolAction: (action: FloatingToolAction): void =>
    ipcRenderer.send('desktop:floating-tool-action', action),
  onFloatingToolAction: (listener: (action: FloatingToolAction) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, action: FloatingToolAction) => listener(action)
    ipcRenderer.on('desktop:floating-tool-action', wrapped)
    return () => ipcRenderer.removeListener('desktop:floating-tool-action', wrapped)
  },
  getWorkspaceWindowContext: (): Promise<{ windowId: string; isPrimary: boolean; tabsState: WorkspaceTabsStatePayload | null } | null> =>
    ipcRenderer.invoke('desktop:get-workspace-window-context'),
  openWorkspaceWindow: (tab: WorkspaceTabPayload): Promise<{ success: boolean; windowId?: string; error?: string }> =>
    ipcRenderer.invoke('desktop:open-workspace-window', tab),
  attachWorkspaceWindowToPrimary: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('desktop:attach-workspace-window-to-primary'),
  saveWorkspaceWindowTabs: (state: WorkspaceTabsStatePayload): Promise<boolean> =>
    ipcRenderer.invoke('desktop:save-workspace-window-tabs', state),
  onWorkspaceTabsAttached: (listener: (state: WorkspaceTabsStatePayload) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: WorkspaceTabsStatePayload) => listener(state)
    ipcRenderer.on('desktop:workspace-tabs-attached', wrapped)
    return () => ipcRenderer.removeListener('desktop:workspace-tabs-attached', wrapped)
  },
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-file'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-folder'),
  revealPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('desktop:reveal-path', targetPath),
  openJournalitPackage: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-journalit-package'),
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
  openSystemConsole: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-system-console'),
  openBackendLogTerminal: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-backend-log-terminal'),
  logSystemEvent: (event: SystemLogEventInput): void => ipcRenderer.send('system-log:renderer-event', event),
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
