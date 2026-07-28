import {
  DEFAULT_UPDATE_PREFERENCES,
  type UpdateChannel,
  type UpdatePreferences,
} from './update-types'

export interface StoredUpdatePreferences extends UpdatePreferences {
  lastCheckedAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveUpdatePreferences(
  value: unknown,
  defaultChannel: UpdateChannel,
): StoredUpdatePreferences {
  const stored = isRecord(value) ? value : {}
  const channel = stored.channel === 'stable' || stored.channel === 'testing'
    ? stored.channel
    : defaultChannel

  return {
    automaticallyCheck: typeof stored.automaticallyCheck === 'boolean'
      ? stored.automaticallyCheck
      : DEFAULT_UPDATE_PREFERENCES.automaticallyCheck,
    automaticallyDownload: typeof stored.automaticallyDownload === 'boolean'
      ? stored.automaticallyDownload
      : DEFAULT_UPDATE_PREFERENCES.automaticallyDownload,
    channel,
    lastCheckedAt: typeof stored.lastCheckedAt === 'string' ? stored.lastCheckedAt : undefined,
  }
}
