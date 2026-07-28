const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { SecureAuthStore } = require('../dist/secure-auth-store.js')

function createProtection(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('protected:')) throw new Error('Invalid ciphertext')
      return decoded.slice('protected:'.length)
    },
  }
}

function withStore(callback, available = true) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'myailibrary-secure-auth-'))
  const filePath = path.join(directory, 'auth-session.json')
  const store = new SecureAuthStore(filePath, createProtection(available))
  try {
    callback({ directory, filePath, store })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('refresh tokens are encrypted at rest and survive a store reload', () => {
  withStore(({ filePath, store }) => {
    const token = 'header.payload.signature'
    assert.equal(store.setRefreshToken(token), true)
    assert.equal(readFileSync(filePath, 'utf8').includes(token), false)
    assert.equal(store.getRefreshToken(), token)
  })
})

test('a new login safely replaces the previous encrypted refresh token', () => {
  withStore(({ store }) => {
    assert.equal(store.setRefreshToken('first.refresh.token'), true)
    assert.equal(store.setRefreshToken('second.refresh.token'), true)
    assert.equal(store.getRefreshToken(), 'second.refresh.token')
  })
})

test('clearing the secure session prevents later refresh-token recovery', () => {
  withStore(({ store }) => {
    assert.equal(store.setRefreshToken('header.payload.signature'), true)
    assert.equal(store.clearRefreshToken(), true)
    assert.equal(store.getRefreshToken(), null)
    assert.equal(store.clearRefreshToken(), true)
  })
})

test('unavailable encryption refuses to persist a refresh token', () => {
  withStore(({ store }) => {
    assert.equal(store.setRefreshToken('header.payload.signature'), false)
    assert.equal(store.getRefreshToken(), null)
  }, false)
})

test('invalid tokens and corrupt encrypted payloads fail closed', () => {
  withStore(({ filePath, store }) => {
    assert.equal(store.setRefreshToken('  '), false)
    writeFileSync(filePath, '{"version":1,"encryptedRefreshToken":"not-valid-ciphertext"}', 'utf8')
    assert.equal(store.getRefreshToken(), null)
  })
})
