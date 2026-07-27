import { describe, expect, it } from 'vitest'
import { formatCurrency, formatUsageEntryCost } from '../src/components/metrics/utils'
import type { AiUsageEntry } from '../src/components/metrics/types'

function usageEntry(overrides: Partial<AiUsageEntry>): AiUsageEntry {
  return {
    id: 'usage-1',
    feature: 'generation',
    operation: 'generate',
    ...overrides,
  }
}

describe('per-request metrics cost', () => {
  it('shows exact provider cost before any fallback', () => {
    expect(formatUsageEntryCost(usageEntry({
      provider_cost_usd: 0.000123,
      billable_cost_usd: 0.5,
    }))).toBe('$0.000123')
  })

  it('uses billable cost when provider cost is unavailable', () => {
    expect(formatUsageEntryCost(usageEntry({
      provider_cost_usd: null,
      billable_cost_usd: 0.0123,
    }))).toBe('$0.0123')
  })

  it('shows pending instead of inventing a cost', () => {
    expect(formatUsageEntryCost(usageEntry({
      provider_cost_usd: null,
      billable_cost_usd: null,
      metadata: { pending_settlement: true },
    }))).toBe('pending')
  })

  it('keeps enough precision for very small provider costs', () => {
    expect(formatCurrency(0.000001)).toBe('$0.000001')
  })
})
