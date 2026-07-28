import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface StringProtection {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface SecureAuthPayload {
  version: 1
  encryptedRefreshToken: string
}

const MAX_REFRESH_TOKEN_LENGTH = 65_536
const MAX_AUTH_FILE_BYTES = 128 * 1024

function validRefreshToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REFRESH_TOKEN_LENGTH &&
    value.trim() === value &&
    !value.includes('\0')
  )
}

export class SecureAuthStore {
  constructor(
    private readonly filePath: string,
    private readonly protection: StringProtection,
  ) {}

  setRefreshToken(refreshToken: unknown): boolean {
    if (!validRefreshToken(refreshToken) || !this.protection.isEncryptionAvailable()) return false

    const encrypted = this.protection.encryptString(refreshToken)
    if (encrypted.length === 0) return false

    const payload: SecureAuthPayload = {
      version: 1,
      encryptedRefreshToken: encrypted.toString('base64'),
    }
    const directory = path.dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`

    try {
      writeFileSync(temporaryPath, JSON.stringify(payload), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      renameSync(temporaryPath, this.filePath)
      return true
    } finally {
      if (existsSync(temporaryPath)) {
        try {
          unlinkSync(temporaryPath)
        } catch {
          // The final destination is authoritative; stale temporary files contain only ciphertext.
        }
      }
    }
  }

  getRefreshToken(): string | null {
    if (!this.protection.isEncryptionAvailable() || !existsSync(this.filePath)) return null

    try {
      if (statSync(this.filePath).size > MAX_AUTH_FILE_BYTES) return null
      const payload = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SecureAuthPayload>
      if (
        payload.version !== 1 ||
        typeof payload.encryptedRefreshToken !== 'string' ||
        payload.encryptedRefreshToken.length === 0
      ) return null

      const encrypted = Buffer.from(payload.encryptedRefreshToken, 'base64')
      if (encrypted.length === 0) return null
      const refreshToken = this.protection.decryptString(encrypted)
      return validRefreshToken(refreshToken) ? refreshToken : null
    } catch {
      return null
    }
  }

  clearRefreshToken(): boolean {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath)
      return true
    } catch {
      return false
    }
  }
}
