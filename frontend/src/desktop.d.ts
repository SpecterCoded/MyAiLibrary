import type { WorkspaceTab, WorkspaceTabsState } from './types/workspaceTabs'

export {}

declare global {
  type DesktopUpdateStatus =
    | 'disabled' | 'idle' | 'checking' | 'available' | 'up-to-date'
    | 'downloading' | 'downloaded' | 'preparing' | 'ready-to-install'
    | 'installing' | 'error'

  interface DesktopUpdateState {
    status: DesktopUpdateStatus
    currentVersion: string
    availableVersion?: string
    releaseDate?: string
    releaseNotes?: string
    percent?: number
    transferredBytes?: number
    totalBytes?: number
    lastCheckedAt?: string
    errorMessage?: string
    installationEnabled: boolean
    channel: 'stable' | 'testing'
    testingChannelAvailable: boolean
    unsignedTestingMode: boolean
  }

  interface DesktopUpdatePreferences {
    automaticallyCheck: boolean
    automaticallyDownload: boolean
    channel: 'stable' | 'testing'
  }

  interface DesktopInstalledUpdateInfo {
    previousVersion: string
    currentVersion: string
    installedAt: string
    releaseNotes?: string
  }

  interface DesktopAppInfo {
    appName: string
    appId: string
    version: string
    buildType: string
    platform: string
    osRelease: string
    electronVersion: string
    chromeVersion: string
    nodeVersion: string
    dataDir: string
    logsDir: string
    updateChannel: 'stable' | 'testing'
    updateStatus: DesktopUpdateStatus
    installationEnabled: boolean
  }

  interface DesktopBridge {
    openFloatingTool(kind: 'search' | 'create-playlist' | 'import-content'): Promise<boolean>
    closeFloatingTool(): void
    floatingToolReady(): Promise<boolean>
    moveFloatingToolBy(deltaX: number, deltaY: number): void
    sendFloatingToolAction(action:
      | { type: 'navigate'; detail: Record<string, unknown> }
      | { type: 'refresh-playlists' }
    ): void
    onFloatingToolAction(listener: (action:
      | { type: 'navigate'; detail: Record<string, unknown> }
      | { type: 'refresh-playlists' }
    ) => void): () => void
    getWorkspaceWindowContext(): Promise<{
      windowId: string
      isPrimary: boolean
      tabsState: WorkspaceTabsState | null
    } | null>
    openWorkspaceWindow(tab: WorkspaceTab): Promise<{
      success: boolean
      windowId?: string
      error?: string
    }>
    attachWorkspaceWindowToPrimary(): Promise<{
      success: boolean
      error?: string
    }>
    saveWorkspaceWindowTabs(state: WorkspaceTabsState): Promise<boolean>
    onWorkspaceTabsAttached(listener: (state: WorkspaceTabsState) => void): () => void
    selectFile(): Promise<string | null>
    selectFolder(): Promise<string | null>
    revealPath(targetPath: string): Promise<boolean>
    openJournalitPackage(): Promise<boolean>
    getVersion(): Promise<string>
    getUpdateState(): Promise<DesktopUpdateState | null>
    checkForUpdates(): Promise<DesktopUpdateState | null>
    downloadUpdate(): Promise<DesktopUpdateState | null>
    installUpdate(): Promise<DesktopUpdateState | null>
    getUpdatePreferences(): Promise<DesktopUpdatePreferences | null>
    getInstalledUpdate(): Promise<DesktopInstalledUpdateInfo | null>
    setUpdatePreferences(preferences: Partial<DesktopUpdatePreferences>): Promise<DesktopUpdatePreferences | null>
    openUpdateLogs(): Promise<boolean>
    getAppInfo(): Promise<DesktopAppInfo | null>
    openBackendLogTerminal(): Promise<boolean>
    getSystemTheme(): Promise<'light' | 'dark'>
    setTitleBarTheme(theme: 'light' | 'dark'): Promise<boolean>
    setWindowControlsHidden(hidden: boolean): Promise<boolean>
    onSystemThemeChanged(listener: (theme: 'light' | 'dark') => void): () => void
    onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
    onUpdateInstalled(listener: (info: DesktopInstalledUpdateInfo) => void): () => void
    onBackendState(listener: (state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed', detail?: string) => void): () => void
  }

  type DesktopAttachmentKind = 'image' | 'video' | 'audio' | 'pdf'

  interface DesktopAttachmentViewerItem {
    id: string
    kind: DesktopAttachmentKind
    name: string
    url: string
    mimeType?: string
    size?: number
    pageCount?: number
    sourcePath?: string
  }

  interface DesktopAttachmentViewerPayload {
    attachments: DesktopAttachmentViewerItem[]
    activeIndex: number
  }

  interface DesktopAttachmentsBridge {
    openViewer(payload: DesktopAttachmentViewerPayload): void
  }

  interface Window {
    desktop?: DesktopBridge
    desktopAttachments?: DesktopAttachmentsBridge
  }
}
