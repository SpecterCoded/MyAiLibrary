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
    selectFile(): Promise<string | null>
    selectFolder(): Promise<string | null>
    revealPath(targetPath: string): Promise<boolean>
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
