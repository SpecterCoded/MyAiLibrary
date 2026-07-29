const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'myailibrary-updater-policy-'))
const packagedAppRoot = path.join(temporaryRoot, 'packaged-app')
mkdirSync(packagedAppRoot, { recursive: true })
writeFileSync(path.join(packagedAppRoot, 'package.json'), JSON.stringify({
  version: '0.1.0-beta.1',
  updatesEnabled: false,
  updatesTestMode: false,
  updatesTestingEnabled: true,
}))

let checkCalls = 0
let downloadCalls = 0
let installCalls = 0
let installArguments = []
const autoUpdater = new EventEmitter()
Object.assign(autoUpdater, {
  logger: null,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowDowngrade: false,
  allowPrerelease: false,
  channel: 'stable',
  checkForUpdates: async () => {
    checkCalls += 1
  },
  downloadUpdate: async () => {
    downloadCalls += 1
    autoUpdater.emit('download-progress', {
      percent: 50,
      transferred: 512,
      total: 1024,
    })
    autoUpdater.emit('update-downloaded', {
      version: '0.1.0-beta.2',
      releaseDate: '2026-07-29T00:00:00.000Z',
      releaseNotes: 'A newer beta is ready.',
      files: [{ size: 1024 }],
    })
  },
  quitAndInstall: (...args) => {
    installCalls += 1
    installArguments = args
  },
  setFeedURL: () => {},
})

const log = {
  transports: { file: { resolvePathFn: undefined, level: 'info' } },
  info: () => {},
  warn: () => {},
  error: () => {},
}

const originalLoad = Module._load
Module._load = function loadWithElectronMocks(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getAppPath: () => packagedAppRoot,
        getVersion: () => '0.1.0-beta.1',
      },
      BrowserWindow: { getAllWindows: () => [] },
      shell: {
        openPath: async () => '',
        showItemInFolder: () => {},
      },
    }
  }
  if (request === 'electron-updater') return { autoUpdater }
  if (request === 'electron-log/main') return { __esModule: true, default: log }
  return originalLoad.call(this, request, parent, isMain)
}

const { DesktopUpdater } = require('../dist/updater.js')
Module._load = originalLoad

test('packaged beta updater defaults to Testing, exercises update states, and preserves Stable', async () => {
  const dataRoot = path.join(temporaryRoot, 'user-data')
  let preparedVersion = ''
  const updater = new DesktopUpdater(dataRoot, async (version) => {
    preparedVersion = version
  })

  assert.equal(updater.getPreferences().channel, 'testing')
  assert.equal(updater.getState().testingChannelAvailable, true)
  assert.equal(updater.getState().unsignedTestingMode, true)
  assert.equal(updater.getState().installationEnabled, true)
  assert.equal(autoUpdater.channel, 'beta')
  assert.equal(autoUpdater.allowPrerelease, true)

  await updater.checkForUpdates(true)
  assert.equal(checkCalls, 1)
  assert.equal(updater.getState().status, 'checking')

  autoUpdater.emit('update-available', {
    version: '0.1.0-beta.2',
    releaseDate: '2026-07-29T00:00:00.000Z',
    releaseNotes: 'A newer beta is available.',
    files: [{ size: 1024 }],
  })
  assert.equal(updater.getState().status, 'available')

  await updater.downloadUpdate()
  assert.equal(downloadCalls, 1)
  assert.equal(updater.getState().status, 'ready-to-install')
  assert.equal(updater.getState().percent, 100)

  await updater.installUpdate()
  assert.equal(preparedVersion, '0.1.0-beta.2')
  assert.equal(installCalls, 1)
  assert.deepEqual(installArguments, [true, true])
  assert.equal(updater.getState().status, 'installing')

  updater.setPreferences({ channel: 'stable' })
  assert.equal(updater.getPreferences().channel, 'stable')
  assert.equal(updater.getState().installationEnabled, false)
  assert.equal(autoUpdater.channel, 'stable')
  assert.equal(autoUpdater.allowPrerelease, false)

  const saved = JSON.parse(readFileSync(
    path.join(dataRoot, 'config', 'update-settings.json'),
    'utf8',
  ))
  assert.equal(saved.channel, 'stable')

  const relaunched = new DesktopUpdater(dataRoot, async () => {})
  assert.equal(relaunched.getPreferences().channel, 'stable')
  assert.equal(relaunched.getState().installationEnabled, false)
})

test.after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})
