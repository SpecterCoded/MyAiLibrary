const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveUpdatePreferences } = require('../dist/update-preferences.js')

test('a fresh beta-capable package defaults to Testing', () => {
  assert.deepEqual(resolveUpdatePreferences(undefined, 'testing'), {
    automaticallyCheck: true,
    automaticallyDownload: false,
    channel: 'testing',
    lastCheckedAt: undefined,
  })
})

test('a fresh stable-only package defaults to Stable', () => {
  assert.equal(resolveUpdatePreferences(undefined, 'stable').channel, 'stable')
})

test('an explicit saved Stable choice is preserved in a beta package', () => {
  assert.equal(resolveUpdatePreferences({
    automaticallyCheck: false,
    automaticallyDownload: true,
    channel: 'stable',
    lastCheckedAt: '2026-07-28T08:00:00.000Z',
  }, 'testing').channel, 'stable')
})

test('an explicit saved Testing choice is preserved when available', () => {
  const preferences = resolveUpdatePreferences({
    automaticallyCheck: false,
    automaticallyDownload: true,
    channel: 'testing',
    lastCheckedAt: '2026-07-28T08:00:00.000Z',
  }, 'stable')

  assert.deepEqual(preferences, {
    automaticallyCheck: false,
    automaticallyDownload: true,
    channel: 'testing',
    lastCheckedAt: '2026-07-28T08:00:00.000Z',
  })
})

test('invalid saved values fall back without changing valid booleans', () => {
  assert.deepEqual(resolveUpdatePreferences({
    automaticallyCheck: false,
    automaticallyDownload: 'yes',
    channel: 'preview',
    lastCheckedAt: 42,
  }, 'testing'), {
    automaticallyCheck: false,
    automaticallyDownload: false,
    channel: 'testing',
    lastCheckedAt: undefined,
  })
})
