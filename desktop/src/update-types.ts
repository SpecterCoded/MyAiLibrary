export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'preparing'
  | 'ready-to-install'
  | 'installing'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseDate?: string
  releaseNotes?: string
  percent?: number
  transferredBytes?: number
  totalBytes?: number
  lastCheckedAt?: string
  errorMessage?: string
  installationEnabled: boolean
}

export interface UpdatePreferences {
  automaticallyCheck: boolean
  automaticallyDownload: boolean
}

export interface InstalledUpdateInfo {
  previousVersion: string
  currentVersion: string
  installedAt: string
  releaseNotes?: string
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  automaticallyCheck: true,
  automaticallyDownload: false,
}
