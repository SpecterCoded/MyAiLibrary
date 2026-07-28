import { describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceSaveQueue,
  deleteWorkspaceLibrary,
  fetchWorkspaceLibraries,
  registerWorkspaceLibraries,
  WorkspaceRegistrationError,
} from '../src/utils/workspaceStorage'

describe('workspace storage flow', () => {
  it('includes a complete open editor draft in the global save queue', () => {
    expect(buildWorkspaceSaveQueue(
      [{ name: ' Staged ', path: ' D:\\Staged ' }],
      { name: ' New workspace ', path: ' D:\\New ' },
    )).toEqual([
      { name: 'Staged', path: 'D:\\Staged' },
      { name: 'New workspace', path: 'D:\\New' },
    ])
  })

  it('ignores an empty editor but rejects a partially completed one', () => {
    const staged = [{ name: 'Staged', path: 'D:\\Staged' }]
    expect(buildWorkspaceSaveQueue(staged, { name: '', path: '' })).toEqual(staged)
    expect(() => buildWorkspaceSaveQueue(staged, { name: 'Missing path', path: '' }))
      .toThrow('Enter both a library name and directory path')
    expect(() => buildWorkspaceSaveQueue(staged, { name: '', path: 'D:\\MissingName' }))
      .toThrow('Enter both a library name and directory path')
  })

  it('registers every queued library in order', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ id: 'one', name: 'One', path: 'D:\\One' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ id: 'two', name: 'Two', path: 'D:\\Two' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch

    await expect(registerWorkspaceLibraries([
      { name: 'One', path: 'D:\\One' },
      { name: 'Two', path: 'D:\\Two' },
    ], 'token', fetchImpl)).resolves.toEqual([
      { id: 'one', name: 'One', path: 'D:\\One' },
      { id: 'two', name: 'Two', path: 'D:\\Two' },
    ])

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/storage-paths?name=One&path=D%3A%5COne',
      { method: 'POST', headers: { Authorization: 'Bearer token' } },
    )
  })

  it('retains the failed and unattempted drafts after a partial failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ id: 'one', name: 'One', path: 'D:\\One' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ detail: 'Directory is unavailable.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch
    const drafts = [
      { name: 'One', path: 'D:\\One' },
      { name: 'Two', path: 'D:\\Two' },
      { name: 'Three', path: 'D:\\Three' },
    ]

    try {
      await registerWorkspaceLibraries(drafts, 'token', fetchImpl)
      throw new Error('Expected registration to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceRegistrationError)
      const registrationError = error as WorkspaceRegistrationError
      expect(registrationError.message).toContain('Directory is unavailable.')
      expect(registrationError.confirmed).toEqual([
        { id: 'one', name: 'One', path: 'D:\\One' },
      ])
      expect(registrationError.remaining).toEqual(drafts.slice(1))
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps a draft retryable after a network or malformed-success response', async () => {
    const draft = [{ name: 'Retry', path: 'D:\\Retry' }]
    const offlineFetch = vi.fn(async () => {
      throw new Error('offline')
    }) as typeof fetch
    await expect(registerWorkspaceLibraries(draft, 'token', offlineFetch))
      .rejects.toMatchObject({ remaining: draft, confirmed: [] })

    const malformedFetch = vi.fn(async () => new Response(
      'not-json',
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    )) as typeof fetch
    await expect(registerWorkspaceLibraries(draft, 'token', malformedFetch))
      .rejects.toMatchObject({ remaining: draft, confirmed: [] })
  })

  it('refreshes the registered library list from the backend', async () => {
    const libraries = [{ id: 'one', name: 'One', path: 'D:\\One' }]
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify(libraries),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(fetchWorkspaceLibraries('token', fetchImpl)).resolves.toEqual(libraries)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/storage-paths',
      { headers: { Authorization: 'Bearer token' } },
    )
  })

  it('deletes a confirmed non-default workspace through the protected endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        message: 'Workspace permanently deleted.',
        active_path: 'D:\\Default',
        switched_to_default: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(deleteWorkspaceLibrary('secondary-id', 'token', fetchImpl)).resolves.toEqual({
      message: 'Workspace permanently deleted.',
      active_path: 'D:\\Default',
      switched_to_default: true,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/storage-paths/secondary-id?confirm=true',
      { method: 'DELETE', headers: { Authorization: 'Bearer token' } },
    )
  })

  it('surfaces backend workspace deletion safeguards', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'The default onboarding workspace cannot be deleted.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    await expect(deleteWorkspaceLibrary('default-id', 'token', fetchImpl))
      .rejects.toThrow('The default onboarding workspace cannot be deleted.')
  })
})
