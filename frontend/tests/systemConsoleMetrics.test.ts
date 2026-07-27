import { describe, expect, it } from 'vitest'
import { buildPerformanceSummary } from '../src/components/SystemConsole'
import type { DashboardData } from '../src/components/metrics/types'

function apiEvent(path: string, durationMs: number): SystemLogEvent {
  return {
    id: `${path}-${durationMs}`,
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    source: 'backend',
    level: 'info',
    category: 'SYSTEM',
    event: 'api.request_completed',
    message: `GET ${path} completed.`,
    operation: 'api_request',
    phase: path,
    status: 'completed',
    durationMs,
    context: { method: 'GET', path, statusCode: 200 },
  }
}

describe('System Console performance metrics', () => {
  it('keeps quality rejections separate from operational RAG failures', () => {
    const dashboard: DashboardData = {
      total_queries: 2,
      avg_latency_ms: 1500,
      cache_hit_rate: 0,
      avg_confidence: 0,
      entries: [
        {
          query: 'redacted by the console UI',
          latency_ms: 1000,
          success: true,
          response_passed: false,
        },
        {
          query: 'redacted by the console UI',
          latency_ms: 2000,
          success: false,
          response_passed: true,
        },
      ],
      ai_usage_entries: [],
    }

    const summary = buildPerformanceSummary([], dashboard)

    expect(summary.ragRuns).toBe(2)
    expect(summary.ragFailureRate).toBe(50)
    expect(summary.qualityAssessedRuns).toBe(2)
    expect(summary.qualityPassedRuns).toBe(1)
    expect(summary.qualityIssueRate).toBe(50)
    expect(summary.failuresByOperation).toEqual([])
  })

  it('excludes queue, task, and notification polling from product API traffic', () => {
    const summary = buildPerformanceSummary([
      apiEvent('/queue', 4),
      apiEvent('/tasks', 5),
      apiEvent('/notifications', 6),
      apiEvent('/chat/sessions', 20),
    ])

    expect(summary.apiRequests).toBe(1)
    expect(summary.backgroundApiRequests).toBe(3)
    expect(summary.averageApiLatencyMs).toBe(20)
  })

  it('resets the visible metrics window without using persisted lifetime totals', () => {
    const dashboard: DashboardData = {
      total_queries: 2,
      avg_latency_ms: 1500,
      cache_hit_rate: 0,
      avg_confidence: 0,
      entries: [
        {
          ts: '2026-07-27T10:00:00.000Z',
          latency_ms: 1000,
          success: false,
        },
        {
          ts: '2026-07-27T12:01:00.000Z',
          latency_ms: 2000,
          success: true,
        },
      ],
      ai_usage_entries: [
        {
          id: 'old',
          ts: '2026-07-27T10:00:00.000Z',
          feature: 'chat',
          operation: 'generation',
          total_tokens: 1000,
          provider_cost_usd: 0.5,
          is_exact_settled: true,
        },
        {
          id: 'new',
          ts: '2026-07-27T12:02:00.000Z',
          feature: 'chat',
          operation: 'generation',
          total_tokens: 250,
          provider_cost_usd: 0.1,
          is_exact_settled: true,
        },
      ],
      usage_summary: {
        used_tokens: 0,
        unit_tokens: 0,
        units_burned: 0,
        settled_events: 82,
        provider_total_tokens: 115_478,
        provider_total_cost_usd: 0.029686,
      },
    }

    const summary = buildPerformanceSummary([], dashboard, '2026-07-27T12:00:00.000Z')

    expect(summary.ragRuns).toBe(1)
    expect(summary.ragFailureRate).toBe(0)
    expect(summary.exactBillingCalls).toBe(1)
    expect(summary.retainedTokenCount).toBe(250)
    expect(summary.retainedProviderCostUsd).toBe(0.1)
  })
})
