import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, session, shell, Tray } from 'electron'
import { BackendRuntime, BackendState, startBackend, stopBackend } from './backend-process'
import { SecureAuthStore } from './secure-auth-store'
import { createAndVerifyUpdateBackup } from './update-backup'
import {
  isBackgroundPollingLogEvent,
  normalizeExternalLogEvent,
  SystemLogService,
  type SystemLogClearFilter,
  type SystemLogEventInput,
} from './system-log'
import { DesktopUpdater } from './updater'
import type { UpdatePreferences } from './update-types'
import { buildTrayMenuTemplate } from './tray-menu'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backend: BackendRuntime | null = null
let updater: DesktopUpdater | null = null
let quitting = false
let allowedRendererOrigin = ''
let currentRendererUrl = ''
let currentTitleBarTheme: 'light' | 'dark' = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
let windowControlsHidden = false
const appWindows = new Set<BrowserWindow>()
let attachmentViewerWindow: BrowserWindow | null = null
let attachmentViewerReady = false
let pendingAttachmentViewerPayload: AttachmentViewerPayload | null = null
const attachmentViewerFilePaths = new Map<string, string>()
let systemLogWindow: BrowserWindow | null = null
let systemLogService: SystemLogService | null = null
let currentBackendState: BackendState = 'stopped'
let lastBackendTerminalLaunchAt = 0
let secureAuthStore: SecureAuthStore | null = null
type FloatingToolKind = 'search' | 'create-playlist' | 'import-content'
type FloatingToolAction =
  | { type: 'navigate'; detail: Record<string, unknown> }
  | { type: 'refresh-playlists' }
const floatingToolWindows = new Map<FloatingToolKind, BrowserWindow>()
const floatingToolKindsByWebContents = new Map<number, FloatingToolKind>()
const JOURNALIT_PACKAGE_FILENAME = 'Journalit-Local-1.8.1-Fresh.zip'
const PRIMARY_WORKSPACE_WINDOW_ID = 'main'
const MAX_WORKSPACE_WINDOWS = 5
const MAX_WORKSPACE_TABS = 5
const PRIMARY_WORKSPACE_WIDTH = 1600
const PRIMARY_WORKSPACE_HEIGHT = 960
const DETACHED_WORKSPACE_MIN_WIDTH = 1220
const DETACHED_WORKSPACE_MIN_HEIGHT = 815
const SYSTEM_LOG_MIN_WIDTH = 1100
const SYSTEM_LOG_MIN_HEIGHT = 720
const WINDOW_CONTROL_OVERLAY_HEIGHT = 43
const WORKSPACE_WINDOW_REGISTRY_VERSION = 1
const workspaceWindowsById = new Map<string, BrowserWindow>()
const workspaceWindowIdsByWebContents = new Map<number, string>()
const workspaceWindowRecords = new Map<string, WorkspaceWindowRecord>()
let workspaceRegistrySaveTimer: NodeJS.Timeout | null = null

const WORKSPACE_TAB_KINDS = new Set([
  'home',
  'library',
  'folder',
  'downloads',
  'notebooks',
  'concepts',
  'chat',
  'metrics',
  'settings',
  'rag-explorer',
  'audio-player',
  'video-player',
  'document-intelligence',
])

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

interface WorkspaceWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface WorkspaceWindowRecord {
  id: string
  primary: boolean
  bounds?: WorkspaceWindowBounds
  maximized?: boolean
  tabsState?: WorkspaceTabsStatePayload
}

interface WorkspaceWindowRegistry {
  version: number
  windows: WorkspaceWindowRecord[]
}

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

const SYSTEM_LOG_CHANNELS = {
  event: 'system-log:event',
  setFilter: 'system-log:set-filter',
  getSnapshot: 'system-log:get-snapshot',
  getBackendState: 'system-log:get-backend-state',
  getTheme: 'system-log:get-theme',
  themeChanged: 'system-log:theme-changed',
  export: 'system-log:export',
  clear: 'system-log:clear',
  reveal: 'system-log:reveal',
  close: 'system-log:close',
  minimize: 'system-log:minimize',
  toggleMaximize: 'system-log:toggle-maximize',
  isMaximized: 'system-log:is-maximized',
} as const

function normalizeSystemLogClearFilter(value: unknown): SystemLogClearFilter | undefined | null {
  if (value == null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const filter: SystemLogClearFilter = {}

  if (candidate.level !== undefined) {
    if (!['debug', 'info', 'warning', 'error', 'critical'].includes(String(candidate.level))) return null
    filter.level = candidate.level as SystemLogClearFilter['level']
  }
  if (candidate.source !== undefined) {
    if (!['desktop', 'backend', 'renderer'].includes(String(candidate.source))) return null
    filter.source = candidate.source as SystemLogClearFilter['source']
  }
  if (candidate.category !== undefined) {
    if (typeof candidate.category !== 'string' || !candidate.category.trim() || candidate.category.length > 120) return null
    filter.category = candidate.category.trim().toUpperCase()
  }
  if (candidate.eventIds !== undefined) {
    if (
      !Array.isArray(candidate.eventIds) ||
      candidate.eventIds.length > 10_000 ||
      candidate.eventIds.some((id) => typeof id !== 'string' || id.length > 100)
    ) return null
    filter.eventIds = Array.from(new Set(candidate.eventIds))
  }
  return Object.keys(filter).length > 0 ? filter : undefined
}

function describeSystemLogClearFilter(filter?: SystemLogClearFilter): string {
  if (!filter) return 'all structured diagnostic history'
  if (filter.eventIds) return 'the events currently visible in the stream'
  const parts = [
    filter.level ? `${filter.level} severity` : '',
    filter.source ? `${filter.source} source` : '',
    filter.category ? `${filter.category} category` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'all structured diagnostic history'
}

const desktopContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}
if (process.platform === 'win32') {
  app.setAppUserModelId('com.myailibrary.desktop')
}

function desktopDataRoot(): string {
  const base = process.env.LOCALAPPDATA || app.getPath('userData')
  return path.join(base, 'MyAILibrary')
}

function getSecureAuthStore(): SecureAuthStore {
  if (!secureAuthStore) {
    secureAuthStore = new SecureAuthStore(
      path.join(desktopDataRoot(), 'secrets', 'auth-session.json'),
      safeStorage,
    )
  }
  return secureAuthStore
}

function workspaceWindowRegistryPath(): string {
  return path.join(desktopDataRoot(), 'workspace-windows.json')
}

function normalizeWorkspaceTab(value: unknown): WorkspaceTabPayload | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length < 1 ||
    candidate.id.length > 256 ||
    typeof candidate.title !== 'string' ||
    candidate.title.length < 1 ||
    candidate.title.length > 512 ||
    typeof candidate.kind !== 'string' ||
    !WORKSPACE_TAB_KINDS.has(candidate.kind) ||
    typeof candidate.createdAt !== 'number' ||
    !Number.isFinite(candidate.createdAt) ||
    typeof candidate.updatedAt !== 'number' ||
    !Number.isFinite(candidate.updatedAt)
  ) return null

  const normalized: WorkspaceTabPayload = {
    id: candidate.id,
    title: candidate.title,
    kind: candidate.kind,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
  if (candidate.params !== undefined) {
    if (!candidate.params || typeof candidate.params !== 'object' || Array.isArray(candidate.params)) return null
    const params = candidate.params as Record<string, unknown>
    const allowedStringKeys = ['playlistId', 'playlistName', 'folderId', 'folderName', 'resourceId', 'mediaUrl', 'settingsTab']
    const normalizedParams: Record<string, string | number> = {}
    for (const [key, paramValue] of Object.entries(params)) {
      if (paramValue === undefined) continue
      if (key === 'time') {
        if (typeof paramValue !== 'number' || !Number.isFinite(paramValue) || paramValue < 0) return null
        normalizedParams.time = paramValue
        continue
      }
      if (!allowedStringKeys.includes(key) || typeof paramValue !== 'string') return null
      const maxLength = key === 'mediaUrl' ? 32_768 : 1_024
      if (paramValue.length > maxLength) return null
      normalizedParams[key] = paramValue
    }
    normalized.params = normalizedParams
  }
  return normalized
}

function normalizeWorkspaceTabsState(value: unknown): WorkspaceTabsStatePayload | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.tabs) ||
    candidate.tabs.length < 1 ||
    candidate.tabs.length > MAX_WORKSPACE_TABS ||
    typeof candidate.activeTabId !== 'string'
  ) return null
  const tabs = candidate.tabs.map(normalizeWorkspaceTab)
  if (tabs.some((tab) => tab === null)) return null
  const normalizedTabs = tabs as WorkspaceTabPayload[]
  if (new Set(normalizedTabs.map((tab) => tab.id)).size !== normalizedTabs.length) return null
  if (!normalizedTabs.some((tab) => tab.id === candidate.activeTabId)) return null
  return { tabs: normalizedTabs, activeTabId: candidate.activeTabId }
}

function normalizeDetachedWorkspaceTabsState(value: unknown): WorkspaceTabsStatePayload | null {
  const state = normalizeWorkspaceTabsState(value)
  if (!state) return null
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  if (!activeTab || activeTab.kind === 'home') return null
  return { tabs: [activeTab], activeTabId: activeTab.id }
}

function normalizeWorkspaceBounds(value: unknown): WorkspaceWindowBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.x !== 'number' ||
    typeof candidate.y !== 'number' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height)
  ) return undefined
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.max(1024, Math.round(candidate.width)),
    height: Math.max(700, Math.round(candidate.height)),
  }
}

function loadWorkspaceWindowRegistry(): void {
  workspaceWindowRecords.clear()
  try {
    const parsed = JSON.parse(readFileSync(workspaceWindowRegistryPath(), 'utf8')) as Partial<WorkspaceWindowRegistry>
    if (parsed.version === WORKSPACE_WINDOW_REGISTRY_VERSION && Array.isArray(parsed.windows)) {
      for (const value of parsed.windows.slice(0, MAX_WORKSPACE_WINDOWS)) {
        if (!value || typeof value !== 'object') continue
        const candidate = value as Partial<WorkspaceWindowRecord>
        if (
          typeof candidate.id !== 'string' ||
          candidate.id.length < 1 ||
          candidate.id.length > 128 ||
          workspaceWindowRecords.has(candidate.id)
        ) continue
        const primary = candidate.id === PRIMARY_WORKSPACE_WINDOW_ID
        const tabsState = candidate.tabsState === undefined
          ? undefined
          : (primary
              ? normalizeWorkspaceTabsState(candidate.tabsState)
              : normalizeDetachedWorkspaceTabsState(candidate.tabsState)) ?? undefined
        if (!primary && !tabsState) continue
        workspaceWindowRecords.set(candidate.id, {
          id: candidate.id,
          primary,
          bounds: normalizeWorkspaceBounds(candidate.bounds),
          maximized: candidate.maximized === true,
          tabsState,
        })
      }
    }
  } catch {
    // Missing or corrupt state starts with a clean primary window.
  }
  const existingPrimary = workspaceWindowRecords.get(PRIMARY_WORKSPACE_WINDOW_ID)
  workspaceWindowRecords.set(PRIMARY_WORKSPACE_WINDOW_ID, existingPrimary ?? {
    id: PRIMARY_WORKSPACE_WINDOW_ID,
    primary: true,
  })
}

function captureWorkspaceWindowRecord(record: WorkspaceWindowRecord): void {
  const window = workspaceWindowsById.get(record.id)
  if (!window || window.isDestroyed()) return
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  record.bounds = normalizeWorkspaceBounds(bounds)
  record.maximized = window.isMaximized()
}

function persistWorkspaceWindowRegistry(): void {
  if (workspaceRegistrySaveTimer) {
    clearTimeout(workspaceRegistrySaveTimer)
    workspaceRegistrySaveTimer = null
  }
  for (const record of workspaceWindowRecords.values()) captureWorkspaceWindowRecord(record)
  const registry: WorkspaceWindowRegistry = {
    version: WORKSPACE_WINDOW_REGISTRY_VERSION,
    windows: Array.from(workspaceWindowRecords.values()).slice(0, MAX_WORKSPACE_WINDOWS),
  }
  const targetPath = workspaceWindowRegistryPath()
  const temporaryPath = `${targetPath}.tmp`
  try {
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(registry, null, 2), 'utf8')
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    emitSystemLog({
      source: 'desktop',
      level: 'warning',
      category: 'WINDOWS',
      event: 'workspace.registry_persist_failed',
      message: 'Workspace window state could not be saved.',
      operation: 'workspace_persistence',
      phase: 'save',
      status: 'failed',
      context: { error },
    })
  }
}

function scheduleWorkspaceWindowRegistrySave(): void {
  if (workspaceRegistrySaveTimer) clearTimeout(workspaceRegistrySaveTimer)
  workspaceRegistrySaveTimer = setTimeout(persistWorkspaceWindowRegistry, 250)
}

function detachedWorkspaceMinimumSize(): { width: number; height: number } {
  return { width: DETACHED_WORKSPACE_MIN_WIDTH, height: DETACHED_WORKSPACE_MIN_HEIGHT }
}

function emitSystemLog(event: SystemLogEventInput): void {
  if (isBackgroundPollingLogEvent(event)) return
  systemLogService?.emit(event)
}

function clampWorkspaceBounds(
  bounds: WorkspaceWindowBounds | undefined,
  primary: boolean,
  minimum = { width: DETACHED_WORKSPACE_MIN_WIDTH, height: DETACHED_WORKSPACE_MIN_HEIGHT },
): WorkspaceWindowBounds {
  const display = bounds
    ? screen.getDisplayMatching(bounds)
    : screen.getPrimaryDisplay()
  const area = display.workArea
  const defaultWidth = Math.min(primary ? PRIMARY_WORKSPACE_WIDTH : 1440, area.width)
  const defaultHeight = Math.min(primary ? PRIMARY_WORKSPACE_HEIGHT : 880, area.height)
  const width = primary
    ? defaultWidth
    : Math.min(Math.max(bounds?.width ?? defaultWidth, minimum.width), area.width)
  const height = primary
    ? defaultHeight
    : Math.min(Math.max(bounds?.height ?? defaultHeight, minimum.height), area.height)
  const defaultX = area.x + Math.round((area.width - width) / 2)
  const defaultY = area.y + Math.round((area.height - height) / 2)
  const x = Math.min(Math.max(bounds?.x ?? defaultX, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds?.y ?? defaultY, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

function workspaceRendererUrl(windowId: string): string {
  const url = new URL(currentRendererUrl)
  url.searchParams.set('workspaceWindow', windowId)
  if (process.argv.includes('--myai-release-smoke')) {
    url.searchParams.set('releaseSmoke', 'background-ai')
  }
  return url.toString()
}

function floatingToolRendererUrl(kind: FloatingToolKind): string {
  if (!currentRendererUrl) return 'about:blank'
  const url = new URL('/floating-tool.html', currentRendererUrl)
  url.searchParams.set('tool', kind)
  return url.toString()
}

function sendBackendState(state: BackendState, detail?: string): void {
  currentBackendState = state
  emitSystemLog({
    source: 'desktop',
    level: state === 'failed' ? 'error' : 'info',
    category: 'BACKEND',
    event: `backend.state_${state}`,
    message: detail || `Local AI service is ${state}.`,
    operation: 'backend_lifecycle',
    phase: 'health',
    status: state === 'ready'
      ? 'completed'
      : state === 'starting'
        ? 'starting'
        : state === 'stopping'
          ? 'running'
          : state,
  })
  splashWindow?.webContents.send('desktop:backend-state', state, detail)
  for (const window of appWindows) {
    if (!window.isDestroyed()) window.webContents.send('desktop:backend-state', state, detail)
  }
  if (systemLogWindow && !systemLogWindow.isDestroyed()) {
    systemLogWindow.webContents.send('desktop:backend-state', state, detail)
  }
  if (state === 'failed') openSystemConsole('error')
}

function journalitPackagePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'integrations', 'journalit', JOURNALIT_PACKAGE_FILENAME)
    : path.resolve(__dirname, '..', '..', JOURNALIT_PACKAGE_FILENAME)
}

function resolvedSystemTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function sendSystemThemeChanged(): void {
  const theme = resolvedSystemTheme()
  splashWindow?.webContents.send('desktop:system-theme-changed', theme)
  for (const window of appWindows) {
    if (!window.isDestroyed()) window.webContents.send('desktop:system-theme-changed', theme)
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) return
  const trayIconPath = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png')
  const fallbackIconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const iconPath = existsSync(trayIconPath) ? trayIconPath : fallbackIconPath
  if (!existsSync(iconPath)) return

  const trayIcon = nativeImage.createFromPath(iconPath)
  tray = new Tray(trayIcon)
  tray.setToolTip('MyAiLibrary')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    open: showMainWindow,
    quit: () => app.quit(),
  })))
  tray.on('click', showMainWindow)
}

function senderIsTrusted(frameUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === allowedRendererOrigin
  } catch {
    return false
  }
}

function configureRendererPermissions(): void {
  const rendererSession = session.defaultSession

  rendererSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (
      permission !== 'media' ||
      !webContents ||
      !workspaceWindowIdsByWebContents.has(webContents.id) ||
      !senderIsTrusted(webContents.getURL())
    ) return false

    const requestUrl = details.securityOrigin || details.requestingUrl || requestingOrigin
    return (
      senderIsTrusted(requestUrl) &&
      details.mediaType !== 'video'
    )
  })

  rendererSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (
      permission !== 'media' ||
      !workspaceWindowIdsByWebContents.has(webContents.id) ||
      !senderIsTrusted(webContents.getURL())
    ) {
      callback(false)
      return
    }

    const mediaDetails = details as Electron.MediaAccessPermissionRequest
    const requestUrl = mediaDetails.securityOrigin || mediaDetails.requestingUrl
    const mediaTypes = mediaDetails.mediaTypes ?? []
    const requestsAudioOnly = mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === 'audio')
    callback(senderIsTrusted(requestUrl) && requestsAudioOnly)
  })
}

function isFloatingToolKind(value: unknown): value is FloatingToolKind {
  return value === 'search' || value === 'create-playlist' || value === 'import-content'
}

function normalizeFloatingToolAction(value: unknown): FloatingToolAction | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'refresh-playlists') return { type: 'refresh-playlists' }
  if (candidate.type !== 'navigate' || !candidate.detail || typeof candidate.detail !== 'object' || Array.isArray(candidate.detail)) {
    return null
  }
  const detail = candidate.detail as Record<string, unknown>
  const allowedViews = new Set(['folder', 'audio-player', 'video-player', 'notebooks', 'concepts', 'downloads'])
  if (typeof detail.view !== 'string' || !allowedViews.has(detail.view)) return null
  try {
    if (JSON.stringify(detail).length > 32_768) return null
  } catch {
    return null
  }
  return { type: 'navigate', detail }
}

function createFloatingToolWindow(kind: FloatingToolKind, sourceWindow: BrowserWindow | null): BrowserWindow {
  const sizes: Record<FloatingToolKind, { width: number; height: number; minWidth: number; minHeight: number; title: string }> = {
    search: { width: 940, height: 720, minWidth: 720, minHeight: 520, title: 'Search MyAiLibrary' },
    'create-playlist': { width: 840, height: 920, minWidth: 720, minHeight: 680, title: 'Create Playlist' },
    'import-content': { width: 760, height: 900, minWidth: 520, minHeight: 680, title: 'Import Content' },
  }
  const config = sizes[kind]
  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed() ? sourceWindow.getBounds() : undefined
  const display = sourceBounds ? screen.getDisplayMatching(sourceBounds) : screen.getPrimaryDisplay()
  const area = display.workArea
  const width = Math.min(config.width, area.width)
  const height = Math.min(config.height, area.height)
  const centerX = sourceBounds ? sourceBounds.x + Math.round(sourceBounds.width / 2) : area.x + Math.round(area.width / 2)
  const centerY = sourceBounds ? sourceBounds.y + Math.round(sourceBounds.height / 2) : area.y + Math.round(area.height / 2)
  const x = Math.min(Math.max(centerX - Math.round(width / 2), area.x), area.x + area.width - width)
  const y = Math.min(Math.max(centerY - Math.round(height / 2), area.y), area.y + area.height - height)
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const toolWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(config.minWidth, width),
    minHeight: Math.min(config.minHeight, height),
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: false,
    title: config.title,
    icon: existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  toolWindow.setMenu(null)
  toolWindow.setMenuBarVisibility(false)
  appWindows.add(toolWindow)
  floatingToolWindows.set(kind, toolWindow)
  const toolWebContentsId = toolWindow.webContents.id
  floatingToolKindsByWebContents.set(toolWebContentsId, kind)
  toolWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (toolWindow.isDestroyed() || toolWindow.isVisible()) return
      toolWindow.show()
      toolWindow.focus()
    }, 1_000)
  })
  toolWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  toolWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === allowedRendererOrigin) return
    } catch {
      // Only the configured renderer origin is allowed.
    }
    event.preventDefault()
  })
  toolWindow.on('closed', () => {
    appWindows.delete(toolWindow)
    floatingToolKindsByWebContents.delete(toolWebContentsId)
    if (floatingToolWindows.get(kind) === toolWindow) floatingToolWindows.delete(kind)
    if (!quitting) {
      setTimeout(() => {
        const returnWindow = sourceWindow && !sourceWindow.isDestroyed() ? sourceWindow : mainWindow
        if (!returnWindow || returnWindow.isDestroyed()) return
        if (returnWindow.isMinimized()) returnWindow.restore()
        returnWindow.show()
        returnWindow.focus()
      }, 0)
    }
  })
  void toolWindow.loadURL(floatingToolRendererUrl(kind))
  return toolWindow
}

function openFloatingTool(kind: FloatingToolKind, sourceWindow: BrowserWindow | null): void {
  const existing = floatingToolWindows.get(kind)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  createFloatingToolWindow(kind, sourceWindow)
}

function isValidAttachmentViewerItem(value: unknown): value is AttachmentViewerItem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const validKind = candidate.kind === 'image' || candidate.kind === 'video' || candidate.kind === 'audio' || candidate.kind === 'pdf'
  const validUrl = typeof candidate.url === 'string' && (
    candidate.url.startsWith('blob:') ||
    candidate.url.startsWith('data:') ||
    candidate.url.startsWith('app-media://') ||
    candidate.url.startsWith('http://127.0.0.1:')
  )
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    validKind &&
    validUrl &&
    (candidate.mimeType === undefined || typeof candidate.mimeType === 'string') &&
    (candidate.size === undefined || typeof candidate.size === 'number') &&
    (candidate.pageCount === undefined || typeof candidate.pageCount === 'number') &&
    (candidate.sourcePath === undefined || (typeof candidate.sourcePath === 'string' && candidate.sourcePath.length <= 32_768))
  )
}

function isValidAttachmentViewerPayload(value: unknown): value is AttachmentViewerPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.attachments) || candidate.attachments.length === 0) return false
  if (candidate.attachments.length > 100) return false
  if (typeof candidate.activeIndex !== 'number') return false
  if (candidate.activeIndex < 0 || candidate.activeIndex >= candidate.attachments.length) return false
  return candidate.attachments.every(isValidAttachmentViewerItem)
}

function prepareAttachmentViewerPayload(payload: AttachmentViewerPayload): AttachmentViewerPayload {
  attachmentViewerFilePaths.clear()
  return {
    activeIndex: payload.activeIndex,
    attachments: payload.attachments.map((attachment) => {
      if (attachment.sourcePath) {
        const resolvedPath = path.resolve(attachment.sourcePath)
        if (existsSync(resolvedPath)) {
          attachmentViewerFilePaths.set(attachment.id, resolvedPath)
        }
      }
      const { sourcePath: _sourcePath, ...safeAttachment } = attachment
      return safeAttachment
    }),
  }
}

function attachmentViewerUrl(): string {
  if (!currentRendererUrl) return 'about:blank'
  return new URL('/attachment-viewer.html', currentRendererUrl).toString()
}

function createAttachmentViewerWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1160, Math.max(960, Math.round(screenWidth * 0.68)))
  const height = Math.min(820, Math.max(680, Math.round(screenHeight * 0.72)))
  const viewer = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 520,
    x: Math.max(0, Math.round((screenWidth - width) / 2)),
    y: Math.max(0, Math.round((screenHeight - height) / 2)),
    frame: false,
    resizable: true,
    movable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    show: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'MyAiLibrary Attachments',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  viewer.setMenu(null)
  viewer.setMenuBarVisibility(false)
  appWindows.add(viewer)

  viewer.once('ready-to-show', () => viewer.show())
  viewer.webContents.on('did-finish-load', () => {
    attachmentViewerReady = true
    if (pendingAttachmentViewerPayload) {
      viewer.webContents.send(ATTACHMENT_VIEWER_CHANNELS.payload, pendingAttachmentViewerPayload)
      pendingAttachmentViewerPayload = null
    }
  })
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  viewer.webContents.on('will-navigate', (event, url) => {
    try {
      const origin = new URL(url).origin
      if (allowedRendererOrigin && origin === allowedRendererOrigin) return
    } catch {
      // file/about URLs are not used for this viewer in normal runtime.
    }
    event.preventDefault()
  })
  viewer.on('closed', () => {
    appWindows.delete(viewer)
    if (attachmentViewerWindow === viewer) attachmentViewerWindow = null
    attachmentViewerReady = false
    pendingAttachmentViewerPayload = null
    attachmentViewerFilePaths.clear()
  })

  void viewer.loadURL(attachmentViewerUrl())
  return viewer
}

function openAttachmentViewer(payload: AttachmentViewerPayload): void {
  if (!isValidAttachmentViewerPayload(payload)) {
    emitSystemLog({
      source: 'desktop',
      level: 'warning',
      category: 'SECURITY',
      event: 'attachment.invalid_payload_rejected',
      message: 'An invalid attachment viewer request was rejected.',
      operation: 'attachment_viewer',
      phase: 'validation',
      status: 'failed',
    })
    return
  }
  const viewerPayload = prepareAttachmentViewerPayload(payload)

  if (!attachmentViewerWindow || attachmentViewerWindow.isDestroyed()) {
    attachmentViewerReady = false
    pendingAttachmentViewerPayload = viewerPayload
    attachmentViewerWindow = createAttachmentViewerWindow()
    return
  }

  if (attachmentViewerWindow.isMinimized()) attachmentViewerWindow.restore()
  attachmentViewerWindow.show()
  attachmentViewerWindow.focus()

  if (attachmentViewerReady) {
    attachmentViewerWindow.webContents.send(ATTACHMENT_VIEWER_CHANNELS.payload, viewerPayload)
  } else {
    pendingAttachmentViewerPayload = viewerPayload
  }
}

function registerIpc(): void {
  ipcMain.handle('desktop:open-floating-tool', (event, value: unknown) => {
    if (
      !senderIsTrusted(event.senderFrame?.url ?? '') ||
      !workspaceWindowIdsByWebContents.has(event.sender.id) ||
      !isFloatingToolKind(value)
    ) return false
    openFloatingTool(value, BrowserWindow.fromWebContents(event.sender))
    return true
  })
  ipcMain.on('desktop:close-floating-tool', (event) => {
    const kind = floatingToolKindsByWebContents.get(event.sender.id)
    if (!kind) return
    const toolWindow = floatingToolWindows.get(kind)
    if (toolWindow?.webContents !== event.sender || toolWindow.isDestroyed()) return
    toolWindow.close()
  })
  ipcMain.handle('desktop:floating-tool-ready', (event) => {
    const kind = floatingToolKindsByWebContents.get(event.sender.id)
    const toolWindow = kind ? floatingToolWindows.get(kind) : undefined
    if (!toolWindow || toolWindow.webContents !== event.sender || toolWindow.isDestroyed()) return false
    toolWindow.show()
    toolWindow.focus()
    return true
  })
  ipcMain.on('desktop:move-floating-tool', (event, deltaX: unknown, deltaY: unknown) => {
    const kind = floatingToolKindsByWebContents.get(event.sender.id)
    const toolWindow = kind ? floatingToolWindows.get(kind) : undefined
    if (
      !toolWindow ||
      toolWindow.webContents !== event.sender ||
      toolWindow.isDestroyed() ||
      typeof deltaX !== 'number' ||
      typeof deltaY !== 'number' ||
      !Number.isFinite(deltaX) ||
      !Number.isFinite(deltaY) ||
      Math.abs(deltaX) > 500 ||
      Math.abs(deltaY) > 500
    ) return
    const [x, y] = toolWindow.getPosition()
    toolWindow.setPosition(x + Math.round(deltaX), y + Math.round(deltaY), false)
  })
  ipcMain.on('desktop:floating-tool-action', (event, value: unknown) => {
    const kind = floatingToolKindsByWebContents.get(event.sender.id)
    const toolWindow = kind ? floatingToolWindows.get(kind) : undefined
    if (!toolWindow || toolWindow.webContents !== event.sender) return
    const action = normalizeFloatingToolAction(value)
    if (!action || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('desktop:floating-tool-action', action)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  ipcMain.handle('desktop:get-workspace-window-context', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const windowId = workspaceWindowIdsByWebContents.get(event.sender.id)
    if (!windowId) return null
    const record = workspaceWindowRecords.get(windowId)
    if (!record) return null
    return {
      windowId: record.id,
      isPrimary: record.primary,
      tabsState: record.tabsState ?? null,
    }
  })
  ipcMain.handle('desktop:open-workspace-window', async (event, value: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '') || !workspaceWindowIdsByWebContents.has(event.sender.id)) {
      return { success: false, error: 'This window is not authorized to open workspace windows.' }
    }
    const tab = normalizeWorkspaceTab(value)
    if (!tab || tab.kind === 'home' || tab.kind === 'library') {
      return { success: false, error: 'Home and Library stay in the primary window.' }
    }
    return openDetachedWorkspaceWindow(tab, BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.handle('desktop:attach-workspace-window-to-primary', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) {
      return { success: false, error: 'This window is not authorized to attach workspace pages.' }
    }
    const sourceWindowId = workspaceWindowIdsByWebContents.get(event.sender.id)
    const sourceRecord = sourceWindowId ? workspaceWindowRecords.get(sourceWindowId) : undefined
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (!sourceWindowId || !sourceRecord || sourceRecord.primary || !sourceWindow || sourceWindow.isDestroyed()) {
      return { success: false, error: 'Only a detached workspace window can be attached.' }
    }
    const sourceState = sourceRecord.tabsState
      ? normalizeDetachedWorkspaceTabsState(sourceRecord.tabsState)
      : null
    const primaryRecord = workspaceWindowRecords.get(PRIMARY_WORKSPACE_WINDOW_ID)
    const primaryWindow = workspaceWindowsById.get(PRIMARY_WORKSPACE_WINDOW_ID)
    const primaryState = primaryRecord?.tabsState
      ? normalizeWorkspaceTabsState(primaryRecord.tabsState)
      : null
    if (!sourceState || !primaryRecord || !primaryWindow || primaryWindow.isDestroyed() || !primaryState) {
      return { success: false, error: 'The primary workspace is not ready yet.' }
    }

    const sourceTab = sourceState.tabs[0]
    const existingIds = new Set(primaryState.tabs.map((tab) => tab.id))
    const attachedTab = existingIds.has(sourceTab.id)
      ? {
          ...sourceTab,
          id: `tab-${randomBytes(8).toString('hex')}`,
          updatedAt: Date.now(),
        }
      : sourceTab
    if (primaryState.tabs.length >= MAX_WORKSPACE_TABS) {
      return { success: false, error: `The primary window already has ${MAX_WORKSPACE_TABS} tabs open.` }
    }

    const nextState: WorkspaceTabsStatePayload = {
      tabs: [...primaryState.tabs, attachedTab],
      activeTabId: attachedTab.id,
    }
    primaryRecord.tabsState = nextState
    scheduleWorkspaceWindowRegistrySave()
    primaryWindow.webContents.send('desktop:workspace-tabs-attached', nextState)
    if (primaryWindow.isMinimized()) primaryWindow.restore()
    primaryWindow.show()
    primaryWindow.focus()
    sourceWindow.hide()
    setTimeout(() => {
      if (!sourceWindow.isDestroyed()) sourceWindow.close()
    }, 50)
    return { success: true }
  })
  ipcMain.handle('desktop:save-workspace-window-tabs', (event, value: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return false
    const windowId = workspaceWindowIdsByWebContents.get(event.sender.id)
    if (!windowId) return false
    const record = workspaceWindowRecords.get(windowId)
    if (!record) return false
    const normalizedState = normalizeWorkspaceTabsState(value)
    if (!normalizedState) return false
    if (!record.primary && normalizedState.tabs.length !== 1) return false
    const state = record.primary
      ? normalizedState
      : normalizeDetachedWorkspaceTabsState(normalizedState)
    if (!state) return false
    record.tabsState = state
    scheduleWorkspaceWindowRegistrySave()
    return true
  })
  ipcMain.handle('desktop:select-file', async (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const options: Electron.OpenDialogOptions = { properties: ['openFile'] }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('desktop:select-folder', async (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const options: Electron.OpenDialogOptions = {
      title: 'Select Library Workspace Folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('desktop:reveal-path', async (event, targetPath: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '') || typeof targetPath !== 'string' || !targetPath || targetPath.length > 32_768) return false
    if (!existsSync(targetPath)) return false
    shell.showItemInFolder(path.resolve(targetPath))
    return true
  })
  ipcMain.handle('desktop:open-journalit-package', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return false
    const packagePath = journalitPackagePath()
    if (!existsSync(packagePath)) {
      emitSystemLog({
        source: 'desktop',
        level: 'error',
        category: 'INTEGRATION',
        event: 'journalit.package_missing',
        message: 'The Journalit integration package is missing.',
        operation: 'journalit_integration',
        phase: 'open_package',
        status: 'failed',
        context: { packagePath },
      })
      return false
    }
    shell.showItemInFolder(packagePath)
    return true
  })
  ipcMain.handle('desktop:get-version', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? app.getVersion() : '')
  ipcMain.handle('desktop:set-refresh-token', (event, refreshToken: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return false
    try {
      return getSecureAuthStore().setRefreshToken(refreshToken)
    } catch {
      return false
    }
  })
  ipcMain.handle('desktop:get-refresh-token', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    return getSecureAuthStore().getRefreshToken()
  })
  ipcMain.handle('desktop:clear-refresh-token', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return false
    return getSecureAuthStore().clearRefreshToken()
  })
  ipcMain.handle('desktop:get-system-theme', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? resolvedSystemTheme() : 'light')
  ipcMain.handle('desktop:get-update-state', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.getState() ?? null : null)
  ipcMain.handle('desktop:check-for-updates', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.checkForUpdates(true) ?? null : null)
  ipcMain.handle('desktop:download-update', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.downloadUpdate() ?? null : null)
  ipcMain.handle('desktop:install-update', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.installUpdate() ?? null : null)
  ipcMain.handle('desktop:get-update-preferences', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.getPreferences() ?? null : null)
  ipcMain.handle('desktop:get-installed-update', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.getInstalledUpdate() ?? null : null)
  ipcMain.handle('desktop:set-update-preferences', (event, preferences: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '') || !preferences || typeof preferences !== 'object') return null
    const candidate = preferences as Partial<UpdatePreferences>
    if (
      (candidate.automaticallyCheck !== undefined && typeof candidate.automaticallyCheck !== 'boolean') ||
      (candidate.automaticallyDownload !== undefined && typeof candidate.automaticallyDownload !== 'boolean') ||
      (candidate.channel !== undefined && candidate.channel !== 'stable' && candidate.channel !== 'testing')
    ) return null
    return updater?.setPreferences(candidate) ?? null
  })
  ipcMain.handle('desktop:open-update-logs', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.openLogs() ?? false : false)
  ipcMain.handle('desktop:get-app-info', (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const dataDir = desktopDataRoot()
    const logsDir = path.join(dataDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const updateState = updater?.getState()
    return {
      appName: 'MyAiLibrary',
      appId: 'com.myailibrary.desktop',
      version: app.getVersion(),
      buildType: app.isPackaged ? 'Electron Desktop' : 'Electron Development',
      platform: `${process.platform} ${process.arch}`,
      osRelease: process.getSystemVersion?.() || process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      dataDir,
      logsDir,
      updateChannel: updateState?.channel ?? 'stable',
      updateStatus: updateState?.status ?? 'idle',
      installationEnabled: updateState?.installationEnabled ?? false,
    }
  })
  ipcMain.handle('desktop:open-system-console', (event) => (
    senderIsTrusted(event.senderFrame?.url ?? '') ? openSystemConsole() : false
  ))
  ipcMain.handle('desktop:open-backend-log-terminal', (event) => (
    senderIsTrusted(event.senderFrame?.url ?? '') ? openBackendLogTerminal() : false
  ))
  ipcMain.on('system-log:renderer-event', (event, value: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return
    const normalized = normalizeExternalLogEvent(value)
    if (!normalized) return
    emitSystemLog({ ...normalized, source: 'renderer' })
  })
  ipcMain.handle(SYSTEM_LOG_CHANNELS.getSnapshot, (event, limit: unknown) => {
    if (event.sender !== systemLogWindow?.webContents || !systemLogService) return null
    return systemLogService.snapshot(typeof limit === 'number' ? limit : undefined)
  })
  ipcMain.handle(SYSTEM_LOG_CHANNELS.getBackendState, (event) => (
    event.sender === systemLogWindow?.webContents ? currentBackendState : 'stopped'
  ))
  ipcMain.handle(SYSTEM_LOG_CHANNELS.getTheme, (event) => (
    event.sender === systemLogWindow?.webContents ? currentTitleBarTheme : 'dark'
  ))
  ipcMain.handle(SYSTEM_LOG_CHANNELS.export, async (event) => {
    if (event.sender !== systemLogWindow?.webContents || !systemLogService) return { success: false }
    const result = await dialog.showSaveDialog(systemLogWindow, {
      title: 'Export sanitized diagnostics',
      defaultPath: path.join(app.getPath('documents'), `MyAiLibrary-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`),
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
    })
    if (result.canceled || !result.filePath) return { success: false }
    const count = systemLogService.exportTo(result.filePath)
    emitSystemLog({
      source: 'desktop',
      level: 'info',
      category: 'DIAGNOSTICS',
      event: 'diagnostics.exported',
      message: 'Sanitized diagnostics were exported.',
      status: 'completed',
      context: { eventCount: count },
    })
    return { success: true, path: result.filePath, count }
  })
  ipcMain.handle(SYSTEM_LOG_CHANNELS.clear, async (event, requestedFilter: unknown) => {
    if (event.sender !== systemLogWindow?.webContents || !systemLogService) {
      return { success: false, deleted: 0 }
    }
    const filter = normalizeSystemLogClearFilter(requestedFilter)
    if (filter === null) return { success: false, deleted: 0 }
    const matchingCount = systemLogService.countMatching(filter)
    if (matchingCount === 0) return { success: true, deleted: 0 }
    const scope = describeSystemLogClearFilter(filter)
    const result = await dialog.showMessageBox(systemLogWindow, {
      type: 'warning',
      title: 'Clear diagnostic history?',
      message: `Clear ${scope}?`,
      detail: `${matchingCount.toLocaleString()} retained event${matchingCount === 1 ? '' : 's'} will be removed. This cannot be undone. The raw backend fallback log is kept.`,
      buttons: ['Cancel', 'Clear events'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response !== 1) return { success: false, deleted: 0 }
    const deleted = systemLogService.clear(filter)
    return { success: true, deleted }
  })
  ipcMain.handle(SYSTEM_LOG_CHANNELS.reveal, (event) => {
    if (event.sender !== systemLogWindow?.webContents || !systemLogService) return false
    shell.showItemInFolder(systemLogService.currentPath)
    return true
  })
  ipcMain.on(SYSTEM_LOG_CHANNELS.close, (event) => {
    if (event.sender === systemLogWindow?.webContents) systemLogWindow.close()
  })
  ipcMain.on(SYSTEM_LOG_CHANNELS.minimize, (event) => {
    if (event.sender === systemLogWindow?.webContents) systemLogWindow.minimize()
  })
  ipcMain.on(SYSTEM_LOG_CHANNELS.toggleMaximize, (event) => {
    if (event.sender !== systemLogWindow?.webContents || !systemLogWindow) return
    if (systemLogWindow.isMaximized()) systemLogWindow.unmaximize()
    else systemLogWindow.maximize()
  })
  ipcMain.handle(SYSTEM_LOG_CHANNELS.isMaximized, (event) => (
    event.sender === systemLogWindow?.webContents && !!systemLogWindow?.isMaximized()
  ))
  ipcMain.handle('desktop:set-titlebar-theme', (event, theme: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '') || (theme !== 'light' && theme !== 'dark')) return false
    applyTitleBarTheme(theme)
    return true
  })
  ipcMain.handle('desktop:set-window-controls-hidden', (event, hidden: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '') || typeof hidden !== 'boolean') return false
    setWindowControlsHidden(hidden)
    return true
  })
  ipcMain.on('desktop-attachments:open-viewer', (event, payload: unknown) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return
    openAttachmentViewer(payload as AttachmentViewerPayload)
  })
  ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.close, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents) return
    attachmentViewerWindow?.close()
  })
  ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.minimize, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents) return
    attachmentViewerWindow?.minimize()
  })
  ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.toggleMaximize, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents || !attachmentViewerWindow) return
    if (attachmentViewerWindow.isMaximized()) attachmentViewerWindow.unmaximize()
    else attachmentViewerWindow.maximize()
  })
  ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.isMaximized, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents) return false
    return attachmentViewerWindow?.isMaximized() ?? false
  })
  ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.toggleAlwaysOnTop, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents || !attachmentViewerWindow) return false
    const next = !attachmentViewerWindow.isAlwaysOnTop()
    attachmentViewerWindow.setAlwaysOnTop(next)
    return next
  })
  ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.getAlwaysOnTop, (event) => {
    if (event.sender !== attachmentViewerWindow?.webContents) return false
    return attachmentViewerWindow?.isAlwaysOnTop() ?? false
  })
  ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.showInFolder, (event, attachmentId: unknown) => {
    if (event.sender !== attachmentViewerWindow?.webContents || typeof attachmentId !== 'string') return
    const targetPath = attachmentViewerFilePaths.get(attachmentId)
    if (!targetPath || !existsSync(targetPath)) return
    shell.showItemInFolder(targetPath)
  })
  ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.saveAs, async (event, attachmentId: unknown) => {
    if (event.sender !== attachmentViewerWindow?.webContents || typeof attachmentId !== 'string') return
    const targetPath = attachmentViewerFilePaths.get(attachmentId)
    if (!targetPath || !existsSync(targetPath)) return
    const result = await dialog.showSaveDialog(attachmentViewerWindow, {
      defaultPath: path.join(app.getPath('downloads'), path.basename(targetPath)),
    })
    if (result.canceled || !result.filePath) return
    copyFileSync(targetPath, result.filePath)
  })
}

function applyTitleBarTheme(theme: 'light' | 'dark'): void {
  currentTitleBarTheme = theme
  if (systemLogWindow && !systemLogWindow.isDestroyed()) {
    systemLogWindow.setBackgroundColor(theme === 'dark' ? '#1e1f22' : '#f5f8fd')
    systemLogWindow.setTitleBarOverlay({
      color: theme === 'dark' ? '#1e1f22' : '#f5f8fd',
      symbolColor: theme === 'dark' ? '#f8fafc' : '#0f172a',
      height: WINDOW_CONTROL_OVERLAY_HEIGHT,
    })
    systemLogWindow.webContents.send(SYSTEM_LOG_CHANNELS.themeChanged, theme)
  }
  if (windowControlsHidden) return
  for (const window of appWindows) {
    if (window.isDestroyed()) continue
    const windowId = workspaceWindowIdsByWebContents.get(window.webContents.id)
    if (!windowId) continue
    window.setTitleBarOverlay({
      // Let the active renderer surface show through so startup loaders and
      // light/dark workspace titlebars cannot drift from the native controls.
      color: '#00000000',
      symbolColor: theme === 'dark' ? '#f8fafc' : '#0f172a',
      height: WINDOW_CONTROL_OVERLAY_HEIGHT,
    })
    window.setBackgroundColor(theme === 'dark' ? '#090b10' : '#f5f8fd')
  }
}

function setWindowControlsHidden(hidden: boolean): void {
  windowControlsHidden = hidden
  if (!hidden) {
    applyTitleBarTheme(currentTitleBarTheme)
    return
  }
  for (const window of appWindows) {
    if (window.isDestroyed()) continue
    if (!workspaceWindowIdsByWebContents.has(window.webContents.id)) continue
    window.setTitleBarOverlay({
      color: '#020617',
      symbolColor: '#020617',
      height: WINDOW_CONTROL_OVERLAY_HEIGHT,
    })
    window.setBackgroundColor('#020617')
  }
}

function createSystemLogWindow(initialLevel?: string): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const viewer = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: SYSTEM_LOG_MIN_WIDTH,
    minHeight: SYSTEM_LOG_MIN_HEIGHT,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: currentTitleBarTheme === 'dark' ? '#1e1f22' : '#f5f8fd',
      symbolColor: currentTitleBarTheme === 'dark' ? '#f8fafc' : '#0f172a',
      height: WINDOW_CONTROL_OVERLAY_HEIGHT,
    },
    show: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    backgroundColor: currentTitleBarTheme === 'dark' ? '#1e1f22' : '#f5f8fd',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'MyAiLibrary System Console',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'diagnostics-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  viewer.setMenu(null)
  viewer.setMenuBarVisibility(false)
  systemLogWindow = viewer

  const unsubscribe = systemLogService?.subscribe((event) => {
    if (!viewer.isDestroyed()) viewer.webContents.send(SYSTEM_LOG_CHANNELS.event, event)
  })
  viewer.once('ready-to-show', () => {
    viewer.show()
    viewer.focus()
    if (initialLevel) viewer.webContents.send(SYSTEM_LOG_CHANNELS.setFilter, initialLevel)
    viewer.webContents.send('desktop:backend-state', currentBackendState)
    viewer.webContents.send(SYSTEM_LOG_CHANNELS.themeChanged, currentTitleBarTheme)
  })
  viewer.on('closed', () => {
    unsubscribe?.()
    if (systemLogWindow === viewer) systemLogWindow = null
  })
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  viewer.webContents.on('will-navigate', (event) => event.preventDefault())

  if (currentRendererUrl) {
    const url = new URL('/diagnostics.html', currentRendererUrl)
    if (initialLevel) url.searchParams.set('level', initialLevel)
    url.searchParams.set('theme', currentTitleBarTheme)
    void viewer.loadURL(url.toString())
  } else if (app.isPackaged) {
    void viewer.loadFile(path.join(process.resourcesPath, 'ui', 'diagnostics.html'), {
      query: {
        ...(initialLevel ? { level: initialLevel } : {}),
        theme: currentTitleBarTheme,
      },
    })
  } else {
    const rendererBase = process.env.ELECTRON_RENDERER_URL || currentRendererUrl || 'http://127.0.0.1:5173'
    const url = new URL('/diagnostics.html', rendererBase)
    if (initialLevel) url.searchParams.set('level', initialLevel)
    url.searchParams.set('theme', currentTitleBarTheme)
    void viewer.loadURL(url.toString())
  }
  return viewer
}

function openSystemConsole(initialLevel?: string): boolean {
  if (!systemLogService) return false
  if (!systemLogWindow || systemLogWindow.isDestroyed()) {
    createSystemLogWindow(initialLevel)
  } else {
    if (systemLogWindow.isMinimized()) systemLogWindow.restore()
    systemLogWindow.show()
    systemLogWindow.focus()
    if (initialLevel) systemLogWindow.webContents.send(SYSTEM_LOG_CHANNELS.setFilter, initialLevel)
  }
  emitSystemLog({
    source: 'desktop',
    level: 'info',
    category: 'DIAGNOSTICS',
    event: 'diagnostics.console_opened',
    message: 'System Console opened.',
    status: 'completed',
  })
  return true
}

function openBackendLogTerminal(): boolean {
  const now = Date.now()
  if (now - lastBackendTerminalLaunchAt < 750) return true
  lastBackendTerminalLaunchAt = now

  const logPath = backend?.logPath ?? path.join(desktopDataRoot(), 'logs', 'backend.log')
  mkdirSync(path.dirname(logPath), { recursive: true })
  if (!existsSync(logPath)) writeFileSync(logPath, '', 'utf8')

  if (process.platform !== 'win32') {
    shell.showItemInFolder(logPath)
    return false
  }

  const escapedLogPath = logPath.replace(/'/g, "''")
  const escapedLogDir = path.dirname(logPath).replace(/'/g, "''")
  const command = [
    "$Host.UI.RawUI.WindowTitle = 'MyAiLibrary Backend Terminal'",
    "$ErrorActionPreference = 'Continue'",
    `Set-Location -LiteralPath '${escapedLogDir}'`,
    "Write-Host 'MyAiLibrary Backend Terminal' -ForegroundColor Magenta",
    `Write-Host 'Live output: ${escapedLogPath}' -ForegroundColor DarkGray`,
    "Write-Host 'Background polling hidden: GET /queue, /tasks, /notifications' -ForegroundColor DarkGray",
    "Write-Host 'Press Ctrl+C to stop following the log.' -ForegroundColor DarkGray",
    "Write-Host ''",
    `Get-Content -LiteralPath '${escapedLogPath}' -Tail 0 -Wait | Where-Object { $_ -notmatch '(?i)(?:\\bGET\\b.*?/(?:queue|tasks|notifications)\\b|/(?:queue|tasks|notifications)\\b.*?\\bGET\\b)' }`,
  ].join('; ')
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  const powershellArgs = [
    '-NoLogo',
    '-NoProfile',
    '-NoExit',
    '-EncodedCommand',
    encodedCommand,
  ]
  const windowsTerminalAlias = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WindowsApps',
    'wt.exe',
  )
  const terminalExecutable = existsSync(windowsTerminalAlias)
    ? windowsTerminalAlias
    : 'wt.exe'

  const reportLaunchFailure = (error: Error) => {
    emitSystemLog({
      source: 'desktop',
      level: 'error',
      category: 'SHORTCUTS',
      event: 'backend_terminal.open_failed',
      message: error.message,
      status: 'failed',
    })
    shell.showItemInFolder(logPath)
  }

  const launchClassicConsole = () => {
    try {
      const fallback = spawn(
        'cmd.exe',
        ['/d', '/c', 'start', '""', 'powershell.exe', ...powershellArgs],
        {
          detached: true,
          windowsHide: false,
          stdio: 'ignore',
        },
      )
      fallback.once('error', reportLaunchFailure)
      fallback.unref()
    } catch (error) {
      reportLaunchFailure(
        error instanceof Error ? error : new Error('Backend terminal could not be opened.'),
      )
    }
  }

  try {
    const terminal = spawn(
      terminalExecutable,
      [
        '-w', 'new',
        'new-tab',
        '--title', 'MyAiLibrary Backend Terminal',
        'powershell.exe',
        ...powershellArgs,
      ],
      {
        windowsHide: false,
        stdio: 'ignore',
      },
    )
    terminal.once('error', () => launchClassicConsole())
    terminal.unref()
    emitSystemLog({
      source: 'desktop',
      level: 'info',
      category: 'SHORTCUTS',
      event: 'backend_terminal.opened',
      message: 'Backend log terminal opened.',
      status: 'completed',
    })
    return true
  } catch (error) {
    emitSystemLog({
      source: 'desktop',
      level: 'error',
      category: 'SHORTCUTS',
      event: 'backend_terminal.open_failed',
      message: error instanceof Error ? error.message : 'Backend log terminal could not be opened.',
      status: 'failed',
    })
    shell.showItemInFolder(logPath)
    return false
  }
}

function requestedDesktopShortcut(input: Electron.Input): 'system-console' | 'backend-terminal' | null {
  if (input.type !== 'keyDown') return null
  if (!input.control && !input.meta) return null
  if (input.alt) return null
  const key = (input.key || '').toLowerCase()
  const code = input.code || ''
  if (input.shift && (key === 'l' || code === 'KeyL')) return 'system-console'
  if (!input.shift && (key === 't' || code === 'KeyT')) return 'backend-terminal'
  return null
}

function registerDesktopShortcuts(): void {
  const shortcuts = [
    { accelerator: 'CommandOrControl+Shift+L', action: openSystemConsole, label: 'System Console' },
    { accelerator: 'CommandOrControl+T', action: openBackendLogTerminal, label: 'backend terminal' },
  ]
  for (const shortcut of shortcuts) {
    globalShortcut.unregister(shortcut.accelerator)
    const registered = globalShortcut.register(shortcut.accelerator, shortcut.action)
    if (registered) continue
    emitSystemLog({
      source: 'desktop',
      level: 'warning',
      category: 'SHORTCUTS',
      event: 'desktop.shortcut_registration_failed',
      message: `The ${shortcut.label} keyboard shortcut could not be registered.`,
      operation: 'application_boot',
      phase: 'shortcut_registration',
      status: 'failed',
      context: { accelerator: shortcut.accelerator },
    })
  }
}

function configureBackendSession(origin: string, token: string): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
    if (new URL(details.url).origin === origin || new URL(details.url).origin === allowedRendererOrigin) {
      details.requestHeaders['x-myailibrary-desktop-token'] = token
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
    const responseOrigin = new URL(details.url).origin
    if (!app.isPackaged || responseOrigin !== origin) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const responseHeaders = { ...details.responseHeaders }
    delete responseHeaders['content-security-policy']
    delete responseHeaders['Content-Security-Policy']
    responseHeaders['Content-Security-Policy'] = [desktopContentSecurityPolicy]
    callback({ responseHeaders })
  })
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#090b10' : '#f8fafc',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  void splash.loadFile(path.join(__dirname, '..', 'assets', 'splash.html'))
  splash.once('ready-to-show', () => splash.show())
  return splash
}

function createWorkspaceWindow(record: WorkspaceWindowRecord): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const minimum = detachedWorkspaceMinimumSize()
  const bounds = clampWorkspaceBounds(record.bounds, record.primary, minimum)
  const window = new BrowserWindow({
    ...bounds,
    minWidth: record.primary ? bounds.width : minimum.width,
    minHeight: record.primary ? bounds.height : minimum.height,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: !record.primary,
    show: false,
    backgroundColor: currentTitleBarTheme === 'dark' ? '#090b10' : '#f5f8fd',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'MyAiLibrary',
    titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: currentTitleBarTheme === 'dark' ? '#f8fafc' : '#0f172a',
        height: WINDOW_CONTROL_OVERLAY_HEIGHT,
      },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.setMenu(null)
  window.setMenuBarVisibility(false)
  const webContentsId = window.webContents.id
  workspaceWindowsById.set(record.id, window)
  workspaceWindowIdsByWebContents.set(webContentsId, record.id)
  appWindows.add(window)
  if (record.primary) mainWindow = window

  const saveBounds = () => {
    captureWorkspaceWindowRecord(record)
    scheduleWorkspaceWindowRegistrySave()
  }
  window.on('resize', saveBounds)
  window.on('move', saveBounds)
  window.on('maximize', saveBounds)
  window.on('unmaximize', saveBounds)
  window.on('will-resize', (event) => {
    if (record.primary) event.preventDefault()
  })
  window.on('close', (event) => {
    if (quitting) return
    if (record.primary) {
      event.preventDefault()
      window.hide()
      return
    }
    workspaceWindowRecords.delete(record.id)
    persistWorkspaceWindowRegistry()
  })
  window.on('closed', () => {
    appWindows.delete(window)
    workspaceWindowsById.delete(record.id)
    workspaceWindowIdsByWebContents.delete(webContentsId)
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== allowedRendererOrigin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  window.webContents.on('before-input-event', (event, input) => {
    const shortcut = requestedDesktopShortcut(input)
    if (!shortcut) return
    event.preventDefault()
    if (shortcut === 'system-console') openSystemConsole()
    else openBackendLogTerminal()
  })
  if (record.maximized) window.once('ready-to-show', () => window.maximize())
  return window
}

async function launchWorkspaceWindow(record: WorkspaceWindowRecord): Promise<BrowserWindow> {
  const window = createWorkspaceWindow(record)
  window.once('ready-to-show', () => window.show())
  try {
    await window.loadURL(workspaceRendererUrl(record.id))
    return window
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

async function openDetachedWorkspaceWindow(
  tab: WorkspaceTabPayload,
  sourceWindow: BrowserWindow | null,
): Promise<{ success: true; windowId: string } | { success: false; error: string }> {
  if (workspaceWindowRecords.size >= MAX_WORKSPACE_WINDOWS) {
    return { success: false, error: `You can keep up to ${MAX_WORKSPACE_WINDOWS} workspace windows open.` }
  }
  const windowId = `workspace-${randomBytes(8).toString('hex')}`
  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed() ? sourceWindow.getBounds() : undefined
  const record: WorkspaceWindowRecord = {
    id: windowId,
    primary: false,
    bounds: sourceBounds ? {
      x: sourceBounds.x + 36,
      y: sourceBounds.y + 36,
      width: sourceBounds.width,
      height: sourceBounds.height,
    } : undefined,
    maximized: false,
    tabsState: { tabs: [tab], activeTabId: tab.id },
  }
  workspaceWindowRecords.set(windowId, record)
  persistWorkspaceWindowRegistry()
  try {
    const window = await launchWorkspaceWindow(record)
    window.focus()
    return { success: true, windowId }
  } catch (error) {
    workspaceWindowRecords.delete(windowId)
    persistWorkspaceWindowRegistry()
    const detail = error instanceof Error ? error.message : String(error)
    emitSystemLog({
      source: 'desktop',
      level: 'error',
      category: 'WINDOWS',
      event: 'workspace.detached_window_failed',
      message: 'A detached workspace window could not be created.',
      operation: 'workspace_window',
      phase: 'create',
      status: 'failed',
      context: { error, windowId },
    })
    return { success: false, error: `The new window could not be opened. ${detail}` }
  }
}

async function showStartupFailure(error: unknown, logPath?: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  emitSystemLog({
    source: 'desktop',
    level: 'critical',
    category: 'STARTUP',
    event: 'application.startup_failed',
    message: 'MyAiLibrary could not complete startup.',
    operation: 'application_boot',
    phase: 'startup',
    status: 'failed',
    context: { error },
  })
  openSystemConsole('error')
  let previousReleaseUrl: string | undefined
  if (logPath) {
    try {
      const reportPath = path.join(path.dirname(logPath), 'migration-recovery.json')
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { previousVersion?: unknown }
      if (typeof report.previousVersion === 'string' && /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(report.previousVersion)) {
        previousReleaseUrl = `https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v${report.previousVersion}`
      }
    } catch {
      // A recovery report exists only after an interrupted schema migration.
    }
  }
  const buttons = ['Retry', ...(logPath ? ['System Console'] : []), ...(previousReleaseUrl ? ['Open previous release'] : []), 'Exit']
  const choice = await dialog.showMessageBox({
    type: 'error',
    title: 'MyAiLibrary could not start',
    message: 'The local AI service did not start.',
    detail: `${message}${logPath ? `\n\nDiagnostics: ${logPath}` : ''}${previousReleaseUrl ? '\n\nYour verified database backup was restored. You can reinstall the previous application version if this update cannot start.' : ''}`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  })
  const selected = buttons[choice.response]
  if (selected === 'Retry') {
    await bootApplication()
  } else if (selected === 'System Console' && logPath) {
    openSystemConsole('error')
    await showStartupFailure(error, logPath)
  } else if (selected === 'Open previous release' && previousReleaseUrl) {
    await shell.openExternal(previousReleaseUrl)
    await showStartupFailure(error, logPath)
  } else {
    app.quit()
  }
}

async function bootApplication(): Promise<void> {
  splashWindow ??= createSplash()
  const dataRoot = desktopDataRoot()
  mkdirSync(dataRoot, { recursive: true })
  // Hex contains no leading option characters, so it is always safe for argparse.
  const token = randomBytes(32).toString('hex')

  try {
    backend = await startBackend({
      dataDir: dataRoot,
      token,
      onState: sendBackendState,
      onLogEvent: emitSystemLog,
    })
    const rendererUrl = app.isPackaged ? backend.origin : process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
    currentRendererUrl = rendererUrl
    allowedRendererOrigin = new URL(rendererUrl).origin
    configureBackendSession(backend.origin, token)

    loadWorkspaceWindowRegistry()
    const primaryRecord = workspaceWindowRecords.get(PRIMARY_WORKSPACE_WINDOW_ID)!
    mainWindow = await launchWorkspaceWindow(primaryRecord)
    splashWindow?.close()
    splashWindow = null

    const detachedRecords = Array.from(workspaceWindowRecords.values())
      .filter((record) => !record.primary)
      .slice(0, MAX_WORKSPACE_WINDOWS - 1)
    for (const record of detachedRecords) {
      try {
        await launchWorkspaceWindow(record)
      } catch (error) {
        workspaceWindowRecords.delete(record.id)
        emitSystemLog({
          source: 'desktop',
          level: 'error',
          category: 'WINDOWS',
          event: 'workspace.restore_failed',
          message: 'A detached workspace window could not be restored.',
          operation: 'application_boot',
          phase: 'restore_windows',
          status: 'failed',
          context: { error, windowId: record.id },
        })
      }
    }
    scheduleWorkspaceWindowRegistrySave()
    updater?.markApplicationReady()
    updater?.scheduleAutomaticCheck()
  } catch (error) {
    splashWindow?.hide()
    await showStartupFailure(error, backend?.logPath ?? path.join(dataRoot, 'logs', 'backend.log'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
  const dataRoot = desktopDataRoot()
  systemLogService = new SystemLogService(dataRoot)
  emitSystemLog({
    source: 'desktop',
    level: 'info',
    category: 'STARTUP',
    event: 'application.electron_ready',
    message: 'Electron runtime is ready.',
    operation: 'application_boot',
    phase: 'electron_ready',
    status: 'completed',
    context: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      architecture: process.arch,
    },
  })
  process.on('uncaughtException', (error) => {
    emitSystemLog({
      source: 'desktop',
      level: 'critical',
      category: 'SYSTEM',
      event: 'desktop.uncaught_exception',
      message: 'An uncaught Electron main-process exception occurred.',
      status: 'failed',
      context: { error },
    })
    openSystemConsole('error')
  })
  process.on('unhandledRejection', (reason) => {
    emitSystemLog({
      source: 'desktop',
      level: 'error',
      category: 'SYSTEM',
      event: 'desktop.unhandled_rejection',
      message: 'An unhandled Electron main-process promise rejection occurred.',
      status: 'failed',
      context: { reason },
    })
  })
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', sendSystemThemeChanged)
  Menu.setApplicationMenu(null)
  configureRendererPermissions()
  updater = new DesktopUpdater(dataRoot, async (targetVersion) => {
    const previousToken = backend?.token ?? randomBytes(32).toString('hex')
    await stopBackend(backend, sendBackendState)
    backend = null
    try {
      await createAndVerifyUpdateBackup(dataRoot, app.getVersion(), targetVersion)
    } catch (error) {
      // The installer has not started, so restore normal app service before reporting the failure.
      backend = await startBackend({
        dataDir: dataRoot,
        token: previousToken,
        onState: sendBackendState,
        onLogEvent: emitSystemLog,
      })
      const rendererUrl = app.isPackaged ? backend.origin : process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
      currentRendererUrl = rendererUrl
      allowedRendererOrigin = new URL(rendererUrl).origin
      configureBackendSession(backend.origin, previousToken)
      if (app.isPackaged) {
        await Promise.all(Array.from(workspaceWindowsById.entries()).map(async ([windowId, window]) => {
          if (!window.isDestroyed()) await window.loadURL(workspaceRendererUrl(windowId))
        }))
      }
      throw error
    }
  })
  nativeAutoUpdater.on('before-quit-for-update', () => { quitting = true })
  registerIpc()
  registerDesktopShortcuts()
  createTray()
  await bootApplication()
})

app.on('will-quit', () => {
  globalShortcut.unregister('CommandOrControl+Shift+L')
  globalShortcut.unregister('CommandOrControl+T')
  tray?.destroy()
  tray = null
})

app.on('window-all-closed', () => {
  if (quitting) return
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  emitSystemLog({
    source: 'desktop',
    level: 'info',
    category: 'SYSTEM',
    event: 'application.shutdown_started',
    message: 'Application shutdown started.',
    operation: 'application_shutdown',
    phase: 'shutdown',
    status: 'starting',
  })
  persistWorkspaceWindowRegistry()
  void stopBackend(backend, sendBackendState).finally(() => app.exit(0))
})
