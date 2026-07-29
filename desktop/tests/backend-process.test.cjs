const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  isOwnedBackendProcess,
  rootOwnedProcessIds,
} = require('../dist/backend-process.js')

test('packaged backend ownership requires both exact executable and data directory', () => {
  const expectedExecutable = String.raw`C:\Program Files\MyAiLibrary\resources\backend\myailibrary-backend.exe`
  const expectedDataDir = String.raw`C:\Users\Example\AppData\Local\MyAILibrary`
  const owned = {
    processId: 120,
    parentProcessId: 20,
    executablePath: expectedExecutable,
    commandLine: `"${expectedExecutable}" --port 49152 --token=redacted --data-dir "${expectedDataDir}"`,
  }

  assert.equal(isOwnedBackendProcess(owned, expectedExecutable, expectedDataDir), true)
  assert.equal(
    isOwnedBackendProcess(
      { ...owned, executablePath: String.raw`D:\Other App\myailibrary-backend.exe` },
      expectedExecutable,
      expectedDataDir,
    ),
    false,
  )
  assert.equal(
    isOwnedBackendProcess(
      { ...owned, commandLine: owned.commandLine.replace('MyAILibrary', 'OtherLibrary') },
      expectedExecutable,
      expectedDataDir,
    ),
    false,
  )
})

test('development backend ownership is scoped to this entry point and data directory', () => {
  const expectedExecutable = String.raw`C:\repo\backend\venv\Scripts\python.exe`
  const expectedEntry = String.raw`C:\repo\backend\desktop_entry.py`
  const expectedDataDir = String.raw`C:\Users\Example\AppData\Local\MyAILibrary`
  const processInfo = {
    processId: 121,
    parentProcessId: 20,
    executablePath: String.raw`C:\Python314\python.exe`,
    commandLine: `"${expectedExecutable}" "${expectedEntry}" --port 8000 --data-dir "${expectedDataDir}"`,
  }

  assert.equal(
    isOwnedBackendProcess(processInfo, expectedExecutable, expectedDataDir, expectedEntry),
    true,
  )
  assert.equal(
    isOwnedBackendProcess(
      {
        ...processInfo,
        commandLine: processInfo.commandLine.replaceAll(String.raw`C:\repo`, String.raw`C:\other-repo`),
      },
      expectedExecutable,
      expectedDataDir,
      expectedEntry,
    ),
    false,
  )
})

test('only top-level owned processes are selected for tree termination', () => {
  const processes = [
    { processId: 10, parentProcessId: 1, executablePath: '', commandLine: '' },
    { processId: 11, parentProcessId: 10, executablePath: '', commandLine: '' },
    { processId: 12, parentProcessId: 11, executablePath: '', commandLine: '' },
    { processId: 20, parentProcessId: 2, executablePath: '', commandLine: '' },
  ]

  assert.deepEqual(rootOwnedProcessIds(processes), [10, 20])
})

test('the dev supervisor owns replacement cleanup once and stops siblings on every exit', () => {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const scripts = packageJson.scripts

  assert.match(scripts.predev, /cleanup-stale-runtime\.ps1 -IncludeRendererPort/)
  assert.match(scripts.dev, /concurrently --kill-others /)
  assert.equal(Object.hasOwn(scripts, 'postdev'), false)
  assert.equal(Object.hasOwn(scripts, 'predev:renderer'), false)
  assert.equal(Object.hasOwn(scripts, 'predev:electron'), false)
})
