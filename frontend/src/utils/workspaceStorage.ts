export interface WorkspaceLibrary {
  id: string
  name: string
  path: string
  is_default: boolean
  is_app_managed: boolean
  deletion_pending: boolean
}

export interface WorkspaceLibraryDraft {
  name: string
  path: string
}

export class WorkspaceRegistrationError extends Error {
  readonly remaining: WorkspaceLibraryDraft[]
  readonly confirmed: WorkspaceLibrary[]

  constructor(
    message: string,
    remaining: WorkspaceLibraryDraft[],
    confirmed: WorkspaceLibrary[],
  ) {
    super(message)
    this.name = 'WorkspaceRegistrationError'
    this.remaining = remaining
    this.confirmed = confirmed
  }
}

function trimmedDraft(draft: WorkspaceLibraryDraft): WorkspaceLibraryDraft {
  return {
    name: draft.name.trim(),
    path: draft.path.trim(),
  }
}

export function buildWorkspaceSaveQueue(
  pending: WorkspaceLibraryDraft[],
  openDraft: WorkspaceLibraryDraft,
): WorkspaceLibraryDraft[] {
  const normalizedPending = pending.map(trimmedDraft)
  const normalizedOpenDraft = trimmedDraft(openDraft)
  const hasName = normalizedOpenDraft.name.length > 0
  const hasPath = normalizedOpenDraft.path.length > 0

  if (hasName !== hasPath) {
    throw new Error('Enter both a library name and directory path before saving.')
  }

  return hasName && hasPath
    ? [...normalizedPending, normalizedOpenDraft]
    : normalizedPending
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { detail?: unknown }
    return typeof body.detail === 'string' && body.detail.trim() ? body.detail : fallback
  } catch {
    return fallback
  }
}

export async function registerWorkspaceLibraries(
  drafts: WorkspaceLibraryDraft[],
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceLibrary[]> {
  const confirmed: WorkspaceLibrary[] = []

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    let response: Response
    try {
      response = await fetchImpl(
        `/storage-paths?name=${encodeURIComponent(draft.name)}&path=${encodeURIComponent(draft.path)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      )
    } catch {
      throw new WorkspaceRegistrationError(
        `Could not register "${draft.name}" because the local service could not be reached.`,
        drafts.slice(index),
        confirmed,
      )
    }

    if (!response.ok) {
      const detail = await responseError(response, 'The workspace could not be registered.')
      throw new WorkspaceRegistrationError(
        `Could not register "${draft.name}": ${detail}`,
        drafts.slice(index),
        confirmed,
      )
    }

    try {
      confirmed.push(await response.json() as WorkspaceLibrary)
    } catch {
      throw new WorkspaceRegistrationError(
        `Could not confirm that "${draft.name}" was registered. You can safely retry.`,
        drafts.slice(index),
        confirmed,
      )
    }
  }

  return confirmed
}

export async function fetchWorkspaceLibraries(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceLibrary[]> {
  const response = await fetchImpl('/storage-paths', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(await responseError(response, 'Failed to refresh registered libraries.'))
  }
  return response.json() as Promise<WorkspaceLibrary[]>
}

export interface DeleteWorkspaceResult {
  message: string
  active_path: string | null
  switched_to_default: boolean
}

export async function deleteWorkspaceLibrary(
  workspaceId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeleteWorkspaceResult> {
  const response = await fetchImpl(
    `/storage-paths/${encodeURIComponent(workspaceId)}?confirm=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!response.ok) {
    throw new Error(await responseError(response, 'The workspace could not be deleted.'))
  }
  return response.json() as Promise<DeleteWorkspaceResult>
}
