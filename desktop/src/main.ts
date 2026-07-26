import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell, Tray } from 'electron'
import { BackendRuntime, BackendState, startBackend, stopBackend } from './backend-process'
import { createAndVerifyUpdateBackup } from './update-backup'
import { DesktopUpdater } from './updater'
import type { UpdatePreferences } from './update-types'

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
const JOURNALIT_PACKAGE_FILENAME = 'Journalit-Local-1.8.1-Fresh.zip'

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

function sendBackendState(state: BackendState, detail?: string): void {
  splashWindow?.webContents.send('desktop:backend-state', state, detail)
  for (const window of appWindows) {
    if (!window.isDestroyed()) window.webContents.send('desktop:backend-state', state, detail)
  }
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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: showMainWindow },
    { type: 'separator' },
    { label: 'Close', click: () => app.quit() },
  ]))
  tray.on('click', showMainWindow)
}

function senderIsTrusted(frameUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === allowedRendererOrigin
  } catch {
    return false
  }
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
    console.warn('[desktop] rejected invalid attachment viewer payload')
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
  ipcMain.handle('desktop:select-file', async (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const options: Electron.OpenDialogOptions = { properties: ['openFile'] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('desktop:select-folder', async (event) => {
    if (!senderIsTrusted(event.senderFrame?.url ?? '')) return null
    const options: Electron.OpenDialogOptions = {
      title: 'Select Library Workspace Folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
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
      console.error(`[desktop] Journalit integration package is missing: ${packagePath}`)
      return false
    }
    shell.showItemInFolder(packagePath)
    return true
  })
  ipcMain.handle('desktop:get-version', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? app.getVersion() : '')
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
  ipcMain.handle('desktop:open-backend-log-terminal', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? openBackendLogTerminal() : false)
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
  if (windowControlsHidden) return
  for (const window of appWindows) {
    if (window.isDestroyed()) continue
    window.setTitleBarOverlay({
      color: theme === 'dark' ? '#0f141d' : '#f5f8fd',
      symbolColor: theme === 'dark' ? '#f8fafc' : '#0f172a',
      height: 40,
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
    window.setTitleBarOverlay({
      color: '#020617',
      symbolColor: '#020617',
      height: 40,
    })
    window.setBackgroundColor('#020617')
  }
}

function openBackendLogTerminal(): boolean {
  const logPath = backend?.logPath ?? path.join(desktopDataRoot(), 'logs', 'backend.log')
  if (process.platform !== 'win32') {
    if (existsSync(logPath)) {
      void shell.openPath(logPath)
      return true
    }
    shell.showItemInFolder(logPath)
    return false
  }

  const logDir = path.dirname(logPath)
  mkdirSync(logDir, { recursive: true })
  const escapedLogPath = logPath.replace(/'/g, "''")
  const scriptPath = path.join(logDir, 'open-backend-log.ps1')
  const script = [
    `$host.UI.RawUI.WindowTitle = 'MyAiLibrary Backend Log'`,
    `Write-Host 'MyAiLibrary backend log' -ForegroundColor Cyan`,
    `Write-Host '${escapedLogPath}' -ForegroundColor DarkCyan`,
    `Write-Host 'Press Ctrl+C to stop watching. Closing this window does not stop the app.' -ForegroundColor DarkGray`,
    `Write-Host ''`,
    `if (-not (Test-Path -LiteralPath '${escapedLogPath}')) {`,
    `  Write-Host 'The backend log file does not exist yet.' -ForegroundColor Yellow`,
    `  Read-Host 'Press Enter to close'`,
    `  exit`,
    `}`,
    `Write-Host 'Watching new backend log lines from now...' -ForegroundColor DarkGray`,
    `Write-Host ''`,
    `Get-Content -LiteralPath '${escapedLogPath}' -Tail 0 -Wait`,
  ].join('\r\n')
  writeFileSync(scriptPath, script, 'utf8')

  const child = spawn('cmd.exe', [
    '/d',
    '/c',
    'start',
    '""',
    'powershell.exe',
    '-NoProfile',
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return true
}

function isBackendLogInputShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  if (!input.control && !input.meta) return false
  if (input.alt) return false
  const key = (input.key || '').toLowerCase()
  const code = input.code || ''
  const isT = key === 't' || code === 'KeyT'
  const isLegacyLogShortcut = input.shift && (key === 'l' || code === 'KeyL')
  return (!input.shift && isT) || isLegacyLogShortcut
}

function registerBackendLogShortcut(): void {
  const shortcuts = ['CommandOrControl+T', 'Control+T', 'CommandOrControl+Shift+L']
  for (const shortcut of shortcuts) {
    globalShortcut.unregister(shortcut)
  }
  const registered = shortcuts.some((shortcut) => (
    globalShortcut.register(shortcut, () => {
      openBackendLogTerminal()
    })
  ))
  if (!registered) {
    console.warn('[desktop] failed to register backend log shortcut')
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

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const window = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    show: false,
    backgroundColor: currentTitleBarTheme === 'dark' ? '#090b10' : '#f5f8fd',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'MyAiLibrary',
    titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: currentTitleBarTheme === 'dark' ? '#0f141d' : '#f5f8fd',
        symbolColor: currentTitleBarTheme === 'dark' ? '#f8fafc' : '#0f172a',
        height: 40,
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
  window.on('will-resize', (event) => {
    if (!window.isMaximized() && !window.isFullScreen()) {
      event.preventDefault()
    }
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  appWindows.add(window)
  window.on('closed', () => {
    appWindows.delete(window)
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
    if (isBackendLogInputShortcut(input)) {
      event.preventDefault()
      openBackendLogTerminal()
    }
  })
  return window
}

async function showStartupFailure(error: unknown, logPath?: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
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
  const buttons = ['Retry', ...(logPath ? ['Open logs'] : []), ...(previousReleaseUrl ? ['Open previous release'] : []), 'Exit']
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
  } else if (selected === 'Open logs' && logPath) {
    shell.showItemInFolder(logPath)
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
    backend = await startBackend({ dataDir: dataRoot, token, onState: sendBackendState })
    const rendererUrl = app.isPackaged ? backend.origin : process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
    currentRendererUrl = rendererUrl
    allowedRendererOrigin = new URL(rendererUrl).origin
    configureBackendSession(backend.origin, token)

    mainWindow = createMainWindow()
    mainWindow.once('ready-to-show', () => {
      splashWindow?.close()
      splashWindow = null
      mainWindow?.show()
    })
    await mainWindow.loadURL(rendererUrl)
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
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', sendSystemThemeChanged)
  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  const dataRoot = desktopDataRoot()
  updater = new DesktopUpdater(dataRoot, async (targetVersion) => {
    const previousToken = backend?.token ?? randomBytes(32).toString('hex')
    await stopBackend(backend, sendBackendState)
    backend = null
    try {
      await createAndVerifyUpdateBackup(dataRoot, app.getVersion(), targetVersion)
    } catch (error) {
      // The installer has not started, so restore normal app service before reporting the failure.
      backend = await startBackend({ dataDir: dataRoot, token: previousToken, onState: sendBackendState })
      const rendererUrl = app.isPackaged ? backend.origin : process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'
      currentRendererUrl = rendererUrl
      allowedRendererOrigin = new URL(rendererUrl).origin
      configureBackendSession(backend.origin, previousToken)
      if (app.isPackaged && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(rendererUrl)
      throw error
    }
  })
  nativeAutoUpdater.on('before-quit-for-update', () => { quitting = true })
  registerIpc()
  registerBackendLogShortcut()
  createTray()
  await bootApplication()
})

app.on('will-quit', () => {
  globalShortcut.unregister('CommandOrControl+Shift+L')
  globalShortcut.unregister('CommandOrControl+T')
  globalShortcut.unregister('Control+T')
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
  void stopBackend(backend, sendBackendState).finally(() => app.exit(0))
})
