export interface PendingSignup {
  username: string
  email: string
}

type FetchLike = typeof fetch

function parseResponseDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const detail = (payload as { detail?: unknown }).detail
  return typeof detail === 'string' && detail.trim() ? detail.trim() : null
}

export function getPendingSignup(storage: Storage = sessionStorage): PendingSignup | null {
  const serialized = storage.getItem('temp_signup')
  if (!serialized) return null

  try {
    const parsed = JSON.parse(serialized) as Partial<PendingSignup>
    const username = typeof parsed.username === 'string' ? parsed.username.trim() : ''
    const email = typeof parsed.email === 'string' ? parsed.email.trim() : ''
    return username && email ? { username, email } : null
  } catch {
    return null
  }
}

export function clearPendingSignup(storage: Storage = sessionStorage): void {
  storage.removeItem('temp_signup')
}

export async function completeVerifiedSignup(
  firebaseToken: string,
  username: string,
  avatarUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ user_id: string; username: string }> {
  const response = await fetchImpl('/auth/complete-signup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: username.trim(),
      avatar_url: avatarUrl,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      parseResponseDetail(payload) ||
        'Your email is verified, but account setup could not be completed. Please try again.',
    )
  }
  return payload as { user_id: string; username: string }
}

export async function resolveLoginEmail(
  identifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const normalized = identifier.trim()
  if (normalized.includes('@')) return normalized

  const response = await fetchImpl(
    `/auth/resolve-email?username_or_email=${encodeURIComponent(normalized)}`,
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      parseResponseDetail(payload) ||
        'Username not found on this device. Sign in once with your email address to restore username login.',
    )
  }

  const email = (payload as { email?: unknown }).email
  if (typeof email !== 'string' || !email.trim()) {
    throw new Error('The username could not be resolved to an email address.')
  }
  return email.trim()
}
