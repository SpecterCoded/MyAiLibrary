const LEGACY_REFRESH_TOKEN_KEY = 'refresh_token'

function validateRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 65_536
}

export async function storeRefreshToken(refreshToken: unknown): Promise<void> {
  if (!validateRefreshToken(refreshToken)) {
    throw new Error('The authentication service returned an invalid session token.')
  }

  if (window.desktop) {
    const stored = await window.desktop.setRefreshToken(refreshToken)
    if (!stored) {
      throw new Error('Windows secure session storage is unavailable. Please restart the application and try again.')
    }
    localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
    return
  }

  localStorage.setItem(LEGACY_REFRESH_TOKEN_KEY, refreshToken)
}

export async function getRefreshToken(): Promise<string | null> {
  if (!window.desktop) return localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY)

  const encryptedToken = await window.desktop.getRefreshToken()
  if (validateRefreshToken(encryptedToken)) {
    localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
    return encryptedToken
  }

  const legacyToken = localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY)
  if (!validateRefreshToken(legacyToken)) return null

  const migrated = await window.desktop.setRefreshToken(legacyToken)
  if (!migrated) return null
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
  return legacyToken
}

export async function clearRefreshToken(): Promise<void> {
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
  if (window.desktop && !(await window.desktop.clearRefreshToken())) {
    throw new Error('The encrypted session could not be cleared.')
  }
}
