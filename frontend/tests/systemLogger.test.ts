import { describe, expect, it } from 'vitest'
import { createDuplicateMessageGuard, isExpectedRequestCancellation } from '../src/utils/systemLogger'

describe('renderer request diagnostics', () => {
  it('does not classify an AbortError as a failed network request', () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'

    expect(isExpectedRequestCancellation(error)).toBe(true)
  })

  it('recognizes cancellation from the request signal', () => {
    const controller = new AbortController()
    controller.abort()

    expect(isExpectedRequestCancellation(new Error('cancelled'), controller.signal)).toBe(true)
  })

  it('keeps genuine request exceptions reportable', () => {
    expect(isExpectedRequestCancellation(new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('renderer console warning diagnostics', () => {
  it('retains the first warning while suppressing an identical flood window', () => {
    const shouldLog = createDuplicateMessageGuard(30_000)

    expect(shouldLog('same warning', 1_000)).toBe(true)
    expect(shouldLog('same warning', 2_000)).toBe(false)
    expect(shouldLog('different warning', 2_000)).toBe(true)
    expect(shouldLog('same warning', 31_000)).toBe(true)
  })
})
