import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRefreshToken, getRefreshToken, storeRefreshToken } from '../src/utils/authStorage'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

describe('refresh-token storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('window', { desktop: undefined })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses browser storage only outside Electron', async () => {
    await storeRefreshToken('browser.refresh.token')
    expect(localStorage.getItem('refresh_token')).toBe('browser.refresh.token')
    expect(await getRefreshToken()).toBe('browser.refresh.token')
  })

  it('stores Electron refresh tokens through the secure bridge', async () => {
    const setRefreshToken = vi.fn(async () => true)
    vi.stubGlobal('window', {
      desktop: {
        setRefreshToken,
        getRefreshToken: vi.fn(async () => 'encrypted.refresh.token'),
        clearRefreshToken: vi.fn(async () => true),
      },
    })
    localStorage.setItem('refresh_token', 'legacy.token')

    await storeRefreshToken('encrypted.refresh.token')

    expect(setRefreshToken).toHaveBeenCalledWith('encrypted.refresh.token')
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(await getRefreshToken()).toBe('encrypted.refresh.token')
  })

  it('migrates a legacy Electron token only after secure storage succeeds', async () => {
    const setRefreshToken = vi.fn(async () => true)
    vi.stubGlobal('window', {
      desktop: {
        setRefreshToken,
        getRefreshToken: vi.fn(async () => null),
        clearRefreshToken: vi.fn(async () => true),
      },
    })
    localStorage.setItem('refresh_token', 'legacy.refresh.token')

    expect(await getRefreshToken()).toBe('legacy.refresh.token')
    expect(setRefreshToken).toHaveBeenCalledWith('legacy.refresh.token')
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })

  it('preserves a legacy token when encrypted migration is unavailable', async () => {
    vi.stubGlobal('window', {
      desktop: {
        setRefreshToken: vi.fn(async () => false),
        getRefreshToken: vi.fn(async () => null),
        clearRefreshToken: vi.fn(async () => true),
      },
    })
    localStorage.setItem('refresh_token', 'legacy.refresh.token')

    expect(await getRefreshToken()).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBe('legacy.refresh.token')
  })

  it('clears both legacy and encrypted refresh tokens', async () => {
    const clearEncrypted = vi.fn(async () => true)
    vi.stubGlobal('window', {
      desktop: {
        setRefreshToken: vi.fn(async () => true),
        getRefreshToken: vi.fn(async () => null),
        clearRefreshToken: clearEncrypted,
      },
    })
    localStorage.setItem('refresh_token', 'legacy.refresh.token')

    await clearRefreshToken()

    expect(clearEncrypted).toHaveBeenCalledOnce()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
