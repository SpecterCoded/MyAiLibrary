import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { BackendRuntime, BackendState, startBackend, stopBackend } from './backend-process'
import { createAndVerifyUpdateBackup } from './update-backup'
import { DesktopUpdater } from './updater'
import type { UpdatePreferences } from './update-types'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let backend: BackendRuntime | null = null
let updater: DesktopUpdater | null = null
let quitting = false
let allowedRendererOrigin = ''

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

function desktopDataRoot(): string {
  const base = process.env.LOCALAPPDATA || app.getPath('userData')
  return path.join(base, 'MyAILibrary')
}

function sendBackendState(state: BackendState, detail?: string): void {
  splashWindow?.webContents.send('desktop:backend-state', state, detail)
  mainWindow?.webContents.send('desktop:backend-state', state, detail)
}

function senderIsTrusted(frameUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === allowedRendererOrigin
  } catch {
    return false
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
  ipcMain.handle('desktop:get-version', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? app.getVersion() : '')
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
      (candidate.automaticallyDownload !== undefined && typeof candidate.automaticallyDownload !== 'boolean')
    ) return null
    return updater?.setPreferences(candidate) ?? null
  })
  ipcMain.handle('desktop:open-update-logs', (event) => senderIsTrusted(event.senderFrame?.url ?? '') ? updater?.openLogs() ?? false : false)
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
    backgroundColor: '#090b10',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  void splash.loadFile(path.join(__dirname, '..', 'assets', 'splash.html'))
  splash.once('ready-to-show', () => splash.show())
  return splash
}

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#090b10',
    icon: existsSync(iconPath) ? iconPath : undefined,
    title: 'My AI Library',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
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
    title: 'My AI Library could not start',
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
      allowedRendererOrigin = new URL(rendererUrl).origin
      configureBackendSession(backend.origin, previousToken)
      if (app.isPackaged && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(rendererUrl)
      throw error
    }
  })
  nativeAutoUpdater.on('before-quit-for-update', () => { quitting = true })
  registerIpc()
  await bootApplication()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void stopBackend(backend, sendBackendState).finally(() => app.exit(0))
})
