import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import {
  DEFAULT_UPDATE_PREFERENCES,
  type UpdatePreferences,
  type UpdateState,
  type InstalledUpdateInfo,
} from './update-types'

type PrepareInstall = (targetVersion: string) => Promise<void>

interface StoredUpdatePreferences extends UpdatePreferences {
  lastCheckedAt?: string
}

function plainReleaseNotes(value: UpdateInfo['releaseNotes']): string | undefined {
  const raw = Array.isArray(value)
    ? value.map((note) => `${note.version ? `${note.version}\n` : ''}${note.note ?? ''}`).join('\n\n')
    : value
  if (!raw) return undefined
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12_000) || undefined
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(?:ghp|github_pat|token)[-_A-Za-z0-9]+/gi, '[redacted]').slice(0, 1_000)
}

function validatedLoopbackFeed(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
    if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.username || url.password) return null
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export class DesktopUpdater {
  private readonly configDir: string
  private readonly preferencesPath: string
  private readonly logPath: string
  private readonly pendingUpdatePath: string
  private readonly prepareInstall: PrepareInstall
  private preferences: StoredUpdatePreferences
  private busy = false
  private state: UpdateState
  private installedUpdate: InstalledUpdateInfo | null = null
  private readonly simulationMode: string
  private readonly localTestFeed: string | null

  constructor(dataRoot: string, prepareInstall: PrepareInstall) {
    this.configDir = path.join(dataRoot, 'config')
    this.preferencesPath = path.join(this.configDir, 'update-settings.json')
    this.logPath = path.join(dataRoot, 'logs', 'updater.log')
    this.pendingUpdatePath = path.join(this.configDir, 'pending-update.json')
    this.prepareInstall = prepareInstall
    this.simulationMode = app.isPackaged ? '' : (process.env.MYAI_UPDATE_SIMULATION ?? '').toLowerCase()
    mkdirSync(this.configDir, { recursive: true })
    mkdirSync(path.dirname(this.logPath), { recursive: true })
    log.transports.file.resolvePathFn = () => this.logPath
    log.transports.file.level = 'info'
    log.info('Desktop updater initialized', { version: app.getVersion(), channel: 'stable' })
    autoUpdater.logger = log
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.channel = 'stable'

    this.preferences = this.readPreferences()
    let releaseEnablesUpdates = false
    let packageAllowsLocalTesting = false
    try {
      const metadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
        updatesEnabled?: unknown
        updatesTestMode?: unknown
      }
      releaseEnablesUpdates = metadata.updatesEnabled === true
      packageAllowsLocalTesting = metadata.updatesTestMode === true
    } catch (error) {
      log.warn('Could not read packaged update policy', safeError(error))
    }
    const requestedLocalFeed = validatedLoopbackFeed(process.env.MYAI_LOCAL_UPDATE_URL)
    this.localTestFeed = app.isPackaged && packageAllowsLocalTesting && process.env.MYAI_ENABLE_TEST_UPDATES === '1'
      ? requestedLocalFeed
      : null
    if (this.localTestFeed) {
      autoUpdater.setFeedURL({ provider: 'generic', url: this.localTestFeed, channel: 'stable' })
      log.warn('LOCAL ENGINEERING UPDATE MODE ENABLED', { feed: this.localTestFeed })
    } else if (packageAllowsLocalTesting && process.env.MYAI_ENABLE_TEST_UPDATES === '1') {
      log.warn('Local engineering update mode was requested without a valid loopback HTTP feed.')
    }
    const installationEnabled = app.isPackaged && (
      releaseEnablesUpdates || process.env.MYAI_ENABLE_SIGNED_UPDATES === '1' || this.localTestFeed !== null
    )
    const simulatedStatus = this.simulationMode === 'available'
      ? 'available'
      : this.simulationMode === 'downloading'
        ? 'downloading'
        : this.simulationMode === 'ready'
          ? 'ready-to-install'
          : undefined
    this.state = {
      status: simulatedStatus ?? (installationEnabled ? 'idle' : 'disabled'),
      currentVersion: app.getVersion(),
      availableVersion: simulatedStatus ? '0.2.0-test' : undefined,
      releaseDate: simulatedStatus ? new Date().toISOString() : undefined,
      releaseNotes: simulatedStatus ? 'Development preview of the global update notification and Updates tab.' : undefined,
      percent: simulatedStatus === 'downloading' ? 58 : simulatedStatus === 'ready-to-install' ? 100 : undefined,
      transferredBytes: simulatedStatus === 'downloading' ? 48_654_336 : undefined,
      totalBytes: simulatedStatus ? 83_886_080 : undefined,
      lastCheckedAt: this.preferences.lastCheckedAt,
      installationEnabled,
      errorMessage: simulatedStatus
        ? 'Development simulation only. Downloading and installation are disabled.'
        : this.localTestFeed
          ? `Engineering test mode is using the local update feed ${this.localTestFeed}.`
        : installationEnabled
        ? undefined
        : app.isPackaged
          ? 'Secure updates will be enabled after this build is Authenticode-signed.'
          : 'Updates are available only in an installed, signed desktop build.',
    }
    this.registerEvents()
  }

  private readPreferences(): StoredUpdatePreferences {
    try {
      const stored = JSON.parse(readFileSync(this.preferencesPath, 'utf8')) as Partial<StoredUpdatePreferences>
      return {
        automaticallyCheck: typeof stored.automaticallyCheck === 'boolean' ? stored.automaticallyCheck : true,
        automaticallyDownload: typeof stored.automaticallyDownload === 'boolean' ? stored.automaticallyDownload : false,
        lastCheckedAt: typeof stored.lastCheckedAt === 'string' ? stored.lastCheckedAt : undefined,
      }
    } catch {
      return { ...DEFAULT_UPDATE_PREFERENCES }
    }
  }

  private savePreferences(): void {
    const temporaryPath = `${this.preferencesPath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(this.preferences, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.preferencesPath)
  }

  private emit(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('desktop:update-state', this.state)
    }
  }

  private registerEvents(): void {
    autoUpdater.on('checking-for-update', () => this.emit({ status: 'checking', errorMessage: undefined }))
    autoUpdater.on('update-available', (info) => {
      this.busy = false
      this.emit({
        status: 'available',
        availableVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: plainReleaseNotes(info.releaseNotes),
        totalBytes: info.files.find((file) => typeof file.size === 'number')?.size,
      })
      if (this.preferences.automaticallyDownload) void this.downloadUpdate()
    })
    autoUpdater.on('update-not-available', () => {
      this.busy = false
      this.emit({ status: 'up-to-date', availableVersion: undefined, releaseDate: undefined, releaseNotes: undefined })
    })
    autoUpdater.on('download-progress', (progress: ProgressInfo) => this.emit({
      status: 'downloading',
      percent: progress.percent,
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
    }))
    autoUpdater.on('update-downloaded', (info) => {
      this.busy = false
      this.emit({
        status: 'ready-to-install',
        availableVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: plainReleaseNotes(info.releaseNotes),
        percent: 100,
      })
    })
    autoUpdater.on('error', (error) => {
      this.busy = false
      log.error('Updater error', safeError(error))
      this.emit({ status: 'error', errorMessage: safeError(error) })
    })
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  getPreferences(): UpdatePreferences {
    return {
      automaticallyCheck: this.preferences.automaticallyCheck,
      automaticallyDownload: this.preferences.automaticallyDownload,
    }
  }

  getInstalledUpdate(): InstalledUpdateInfo | null {
    return this.installedUpdate ? { ...this.installedUpdate } : null
  }

  markApplicationReady(): void {
    if (this.simulationMode === 'installed') {
      this.installedUpdate = {
        previousVersion: '0.1.1',
        currentVersion: app.getVersion(),
        installedAt: new Date().toISOString(),
        releaseNotes: 'Development preview of the successful-update notification.',
      }
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('desktop:update-installed', this.installedUpdate)
      }
      return
    }
    try {
      const pending = JSON.parse(readFileSync(this.pendingUpdatePath, 'utf8')) as {
        previousVersion?: unknown
        targetVersion?: unknown
        releaseNotes?: unknown
      }
      const currentVersion = app.getVersion()
      if (
        typeof pending.previousVersion !== 'string' ||
        typeof pending.targetVersion !== 'string' ||
        pending.targetVersion !== currentVersion ||
        pending.previousVersion === currentVersion
      ) return
      this.installedUpdate = {
        previousVersion: pending.previousVersion,
        currentVersion,
        installedAt: new Date().toISOString(),
        releaseNotes: typeof pending.releaseNotes === 'string' ? pending.releaseNotes : undefined,
      }
      unlinkSync(this.pendingUpdatePath)
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('desktop:update-installed', this.installedUpdate)
      }
      log.info('Update completed successfully', { from: pending.previousVersion, to: currentVersion })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') log.warn('Could not read pending update marker', safeError(error))
    }
  }

  setPreferences(value: Partial<UpdatePreferences>): UpdatePreferences {
    if (typeof value.automaticallyCheck === 'boolean') this.preferences.automaticallyCheck = value.automaticallyCheck
    if (typeof value.automaticallyDownload === 'boolean') this.preferences.automaticallyDownload = value.automaticallyDownload
    this.savePreferences()
    return this.getPreferences()
  }

  async checkForUpdates(manual = true): Promise<UpdateState> {
    if (!this.state.installationEnabled) return this.getState()
    if (this.busy || this.state.status === 'downloading' || this.state.status === 'ready-to-install') return this.getState()
    if (!manual && !this.preferences.automaticallyCheck) return this.getState()
    if (!manual && this.preferences.lastCheckedAt) {
      const elapsed = Date.now() - Date.parse(this.preferences.lastCheckedAt)
      if (Number.isFinite(elapsed) && elapsed < 24 * 60 * 60 * 1_000) return this.getState()
    }
    this.busy = true
    this.preferences.lastCheckedAt = new Date().toISOString()
    this.savePreferences()
    this.emit({ status: 'checking', lastCheckedAt: this.preferences.lastCheckedAt, errorMessage: undefined })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.busy = false
      this.emit({ status: 'error', errorMessage: safeError(error) })
    }
    return this.getState()
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.state.installationEnabled || this.busy || this.state.status !== 'available') return this.getState()
    this.busy = true
    this.emit({ status: 'downloading', percent: 0, transferredBytes: 0, totalBytes: undefined, errorMessage: undefined })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.busy = false
      this.emit({ status: 'error', errorMessage: safeError(error) })
    }
    return this.getState()
  }

  async installUpdate(): Promise<UpdateState> {
    if (!this.state.installationEnabled || this.busy || this.state.status !== 'ready-to-install' || !this.state.availableVersion) {
      return this.getState()
    }
    this.busy = true
    this.emit({ status: 'preparing', errorMessage: undefined })
    try {
      await this.prepareInstall(this.state.availableVersion)
      const pendingUpdate = {
        formatVersion: 1,
        previousVersion: app.getVersion(),
        targetVersion: this.state.availableVersion,
        releaseNotes: this.state.releaseNotes,
        preparedAt: new Date().toISOString(),
      }
      const temporaryPath = `${this.pendingUpdatePath}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(pendingUpdate, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, this.pendingUpdatePath)
      this.emit({ status: 'installing' })
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      this.busy = false
      log.error('Pre-update safety gate failed', safeError(error))
      this.emit({ status: 'error', errorMessage: `${safeError(error)} Your current installation and data were not changed.` })
    }
    return this.getState()
  }

  async openLogs(): Promise<boolean> {
    const result = await shell.openPath(this.logPath)
    if (!result) return true
    shell.showItemInFolder(this.logPath)
    return false
  }

  scheduleAutomaticCheck(): void {
    setTimeout(() => void this.checkForUpdates(false), 15_000)
  }
}
