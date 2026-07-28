import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingSignup,
  completeVerifiedSignup,
  getPendingSignup,
  resolveLoginEmail,
} from '../src/utils/authFlow'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
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

describe('authentication flow helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves the original signup username until completion succeeds', async () => {
    const storage = memoryStorage({
      temp_signup: JSON.stringify({
        username: '  OriginalName  ',
        email: 'person@example.com',
        password: 'not-returned-by-helper',
      }),
      temp_avatar: 'avatar.svg',
    })
    const pending = getPendingSignup(storage)
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.username).toBe('OriginalName')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer real.firebase.token' })
      return new Response(
        JSON.stringify({ user_id: 'firebase-user', username: 'OriginalName' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    expect(pending?.username).toBe('OriginalName')
    await completeVerifiedSignup(
      'real.firebase.token',
      pending!.username,
      storage.getItem('temp_avatar') || '',
      fetchImpl,
    )
    clearPendingSignup(storage)

    expect(storage.getItem('temp_signup')).toBeNull()
    expect(storage.getItem('temp_avatar')).toBe('avatar.svg')
  })

  it('does not report completion or clear pending state after a backend failure', async () => {
    const storage = memoryStorage({
      temp_signup: JSON.stringify({
        username: 'RetryUser',
        email: 'retry@example.com',
      }),
    })
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Unable to verify your sign-in. Please try again.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(
      completeVerifiedSignup('rejected.token', 'RetryUser', '', fetchImpl),
    ).rejects.toThrow('Unable to verify your sign-in. Please try again.')

    expect(getPendingSignup(storage)?.username).toBe('RetryUser')
  })

  it('resolves a mixed-case username to the backend email', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ email: 'person@example.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(resolveLoginEmail('  MixedCaseUser  ', fetchImpl)).resolves.toBe(
      'person@example.com',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      '/auth/resolve-email?username_or_email=MixedCaseUser',
    )
  })

  it('explains how to recover username login on a new or repaired installation', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        detail:
          'Username not found on this device. Sign in once with your email address to restore username login.',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(resolveLoginEmail('missing-user', fetchImpl)).rejects.toThrow(
      'Sign in once with your email address',
    )
  })

  it('uses an email address directly without calling the username resolver', async () => {
    const fetchImpl = vi.fn() as typeof fetch
    await expect(resolveLoginEmail(' person@example.com ', fetchImpl)).resolves.toBe(
      'person@example.com',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
