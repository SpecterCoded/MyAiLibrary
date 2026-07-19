export interface NativeSelectionResult {
  path: string | null
  error?: string
}

async function fallbackSelection(endpoint: '/auth/select-file' | '/auth/select-folder'): Promise<NativeSelectionResult> {
  const token = localStorage.getItem('access_token')
  const response = await fetch(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new Error(`Server returned ${response.status}`)
  return response.json() as Promise<NativeSelectionResult>
}

export async function selectFile(): Promise<NativeSelectionResult> {
  if (window.desktop) return { path: await window.desktop.selectFile() }
  return fallbackSelection('/auth/select-file')
}

export async function selectFolder(): Promise<NativeSelectionResult> {
  if (window.desktop) return { path: await window.desktop.selectFolder() }
  return fallbackSelection('/auth/select-folder')
}

export async function revealPath(targetPath: string): Promise<boolean> {
  if (!window.desktop) return false
  return window.desktop.revealPath(targetPath)
}
