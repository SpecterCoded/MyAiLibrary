import type {
  AiUsageEntry,
  UsageSummary,
  DashboardRange,
  DashboardSummary,
  MetricEntry,
  RequestRecord,
  WorkflowNodeState,
} from './types';

const DEFAULT_WORKFLOW = [
  { id: 'planner', label: 'Planner' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'cache', label: 'Cache' },
  { id: 'retrieve', label: 'Retrieval' },
  { id: 'rerank', label: 'Rerank' },
  { id: 'parent', label: 'Parent Expansion' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'compress', label: 'Compression' },
  { id: 'llm', label: 'LLM' },
  { id: 'hallucination', label: 'Hallucination' },
  { id: 'confidence', label: 'Confidence' },
];

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter(isNumber);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function round(value: number | null | undefined, digits = 1): number | null {
  if (!isNumber(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getMachineTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
  } catch {
    return 'Local time';
  }
}

export function formatLocalDateTime(value: string): string {
  const date = safeDate(value);
  if (!date) return 'Unknown local time';
  try {
    return date.toLocaleString();
  } catch {
    return date.toString();
  }
}

function toTitleLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function strategyFromGroup(queryEntry: MetricEntry, events: MetricEntry[]): string | null {
  const explicit = [...events].reverse().find((entry) => entry.retrieval_strategy)?.retrieval_strategy;
  if (explicit) return explicit.replace(/_/g, ' ');

  const planBased = [...events].reverse().find((entry) => entry.final_plan?.retrieval_mode)?.final_plan?.retrieval_mode;
  if (typeof planBased === 'string') return planBased.replace(/_/g, ' ');

  const reflectionBased = [...events]
    .reverse()
    .find((entry) => entry.details?.retry_decision?.adapted_plan?.retrieval_mode)?.details?.retry_decision?.adapted_plan?.retrieval_mode;
  if (typeof reflectionBased === 'string') return reflectionBased.replace(/_/g, ' ');

  if (queryEntry.avg_rerank && queryEntry.avg_rerank > 0.35) return 'hybrid';
  return null;
}

function extractFallbackReasons(events: MetricEntry[]): string[] {
  return events
    .map((entry) => entry.fallback_reason || entry.details?.reasoning || entry.reasoning)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function buildWorkflowNodes(request: {
  relatedEvents: MetricEntry[];
  queryEntry: MetricEntry;
  parentExpansionUsed: boolean;
  hierarchicalUsed: boolean;
  retryCount: number;
}): WorkflowNodeState[] {
  const executedSet = new Set<string>();
  const retrySet = new Set<string>();
  const warningSet = new Set<string>();

  for (const event of request.relatedEvents) {
    const node = (event.node_id || '').toLowerCase();
    if (!node) continue;
    if (event.status === 'completed') executedSet.add(node);
    if ((event.details?.retry ?? 0) > 0 || event.status === 'switch_strategy') retrySet.add(node);
    if (event.status && !['completed', 'continue'].includes(event.status)) warningSet.add(node);
  }

  const modulesExecuted = request.relatedEvents.flatMap((event) => event.modules_executed || []);
  const modulesSkipped = request.relatedEvents.flatMap((event) => event.modules_skipped || []);

  for (const moduleName of modulesExecuted) {
    const lowered = moduleName.toLowerCase();
    if (lowered.includes('rerank')) executedSet.add('rerank');
    if (lowered.includes('compression')) executedSet.add('compress');
    if (lowered.includes('hallucination')) executedSet.add('hallucination');
    if (lowered.includes('confidence')) executedSet.add('confidence');
    if (lowered.includes('cache')) executedSet.add('cache');
  }

  for (const moduleName of modulesSkipped) {
    const lowered = moduleName.toLowerCase();
    if (lowered.includes('rerank')) warningSet.add('rerank');
    if (lowered.includes('compression')) warningSet.add('compress');
    if (lowered.includes('hallucination')) warningSet.add('hallucination');
  }

  if (request.parentExpansionUsed) executedSet.add('parent');
  if (request.hierarchicalUsed) executedSet.add('hierarchy');
  if ((request.queryEntry.hallucinations || 0) > 0) warningSet.add('hallucination');
  if (request.retryCount > 0) retrySet.add('retrieve');

  return DEFAULT_WORKFLOW.map((node, index) => {
    let status: WorkflowNodeState['status'] = 'idle';
    if (executedSet.has(node.id)) status = 'executed';
    if (retrySet.has(node.id)) status = 'retry';
    if (warningSet.has(node.id) && status !== 'retry') status = 'warning';
    if (node.id === 'parent' && !request.parentExpansionUsed) status = status === 'idle' ? 'skipped' : status;
    if (node.id === 'hierarchy' && !request.hierarchicalUsed) status = status === 'idle' ? 'skipped' : status;
    if (node.id === 'rewrite' && index < 3) status = status === 'idle' ? 'executed' : status;
    if (node.id === 'llm') status = status === 'idle' ? 'executed' : status;

    return {
      ...node,
      status,
      durationMs: index === 0 ? round(request.queryEntry.latency_ms, 0) : null,
      note: node.id === 'retrieve' && request.retryCount > 0 ? `${request.retryCount} retry` : null,
    };
  });
}

export function filterEntriesByRange(entries: MetricEntry[], range: DashboardRange): MetricEntry[] {
  const now = Date.now();
  const ranges: Record<DashboardRange, number> = {
    hour: 60 * 60 * 1000,
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  return entries.filter((entry) => {
    const date = safeDate(entry.ts);
    if (!date) return false;
    return now - date.getTime() <= ranges[range];
  });
}

export function filterAiUsageByRange(entries: AiUsageEntry[], range: DashboardRange): AiUsageEntry[] {
  const now = Date.now();
  const ranges: Record<DashboardRange, number> = {
    hour: 60 * 60 * 1000,
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  return entries.filter((entry) => {
    const date = safeDate(entry.ts || undefined);
    if (!date) return false;
    return now - date.getTime() <= ranges[range];
  });
}

export function buildUsageSummaryForRange(
  entries: AiUsageEntry[],
  unitTokens: number,
): UsageSummary {
  let usedTokens = 0;
  let providerTotalTokens = 0;
  let providerTotalCostUsd = 0;
  let settledEvents = 0;
  let pendingEvents = 0;
  let userVisibleEvents = 0;

  for (const entry of entries) {
    if (entry.metadata?.pending_settlement) {
      pendingEvents += 1;
      continue;
    }
    if (!entry.is_exact_settled) continue;

    const totalTokens = entry.total_tokens || 0;
    settledEvents += 1;
    providerTotalTokens += totalTokens;
    providerTotalCostUsd += entry.provider_cost_usd || 0;

    if (entry.is_user_visible ?? entry.usage_scope === 'user_visible') {
      usedTokens += totalTokens;
      userVisibleEvents += 1;
    }
  }

  const safeUnitTokens = unitTokens > 0 ? unitTokens : 25000;

  return {
    used_tokens: usedTokens,
    unit_tokens: safeUnitTokens,
    units_burned: round(usedTokens / safeUnitTokens, 4) || 0,
    settled_events: settledEvents,
    pending_events: pendingEvents,
    user_visible_events: userVisibleEvents,
    provider_total_tokens: providerTotalTokens,
    provider_total_cost_usd: round(providerTotalCostUsd, 6) || 0,
  };
}

export function buildRequestRecords(entries: MetricEntry[]): RequestRecord[] {
  const sorted = [...entries].sort((a, b) => {
    const aTime = safeDate(a.ts)?.getTime() || 0;
    const bTime = safeDate(b.ts)?.getTime() || 0;
    return aTime - bTime;
  });

  const requests: RequestRecord[] = [];
  let currentEvents: MetricEntry[] = [];

  for (const entry of sorted) {
    if (!entry.type && entry.query) {
      const retryCount = currentEvents.reduce((maxRetry, event) => Math.max(maxRetry, event.details?.retry ?? -1), -1) + 1;
      const parentUsed = currentEvents.some((event) => event.type === 'parent_child_expansion' && event.success && event.selected !== false);
      const hierarchyUsed = currentEvents.some((event) => event.type === 'hierarchical_retrieval' && event.success && event.selected);
      const warningCount = currentEvents.filter((event) => event.status && !['completed', 'continue'].includes(event.status)).length
        + ((entry.hallucinations || 0) > 0 ? 1 : 0);
      const errorCount = currentEvents.filter((event) => event.status === 'failed' || event.success === false).length;
      const modulesExecuted = Array.from(new Set(currentEvents.flatMap((event) => event.modules_executed || [])));

      const record: RequestRecord = {
        id: `${entry.ts || 'request'}-${entry.query}`,
        ts: entry.ts || new Date().toISOString(),
        query: entry.query,
        queryEntry: entry,
        relatedEvents: currentEvents,
        retrievalStrategy: strategyFromGroup(entry, currentEvents),
        cacheHit: typeof entry.cache_hit === 'boolean' ? entry.cache_hit : null,
        chunks: entry.chunks || 0,
        confidence: isNumber(entry.confidence) ? entry.confidence : null,
        confidenceLabel: entry.confidence_label || null,
        hallucinations: entry.hallucinations || 0,
        latencyMs: entry.latency_ms || 0,
        avgRerank: isNumber(entry.avg_rerank) ? entry.avg_rerank : null,
        topRerank: isNumber(entry.top_rerank) ? entry.top_rerank : null,
        complexity: entry.complexity || null,
        parentExpansionUsed: parentUsed,
        hierarchicalUsed: hierarchyUsed,
        retryCount: Math.max(retryCount, 0),
        warningCount,
        errorCount,
        plannerReasoning: currentEvents.map((event) => event.reasoning).find((value): value is string => typeof value === 'string' && value.length > 0) || null,
        modulesExecuted,
        fallbackReasons: extractFallbackReasons(currentEvents),
        workflowNodes: [],
      };

      record.workflowNodes = buildWorkflowNodes(record);
      requests.push(record);
      currentEvents = [];
    } else {
      currentEvents.push(entry);
    }
  }

  return requests.reverse();
}

export function buildSummary(
  requests: RequestRecord[],
  entries: MetricEntry[],
  aiUsageEntries: AiUsageEntry[] = [],
): DashboardSummary {
  const successRate = requests.length
    ? (requests.filter((request) => request.errorCount === 0 && (request.confidence ?? 0) >= 0.5).length / requests.length) * 100
    : 0;

  const strategyMap = new Map<string, number>();
  for (const request of requests) {
    const key = request.retrievalStrategy || 'unknown';
    strategyMap.set(key, (strategyMap.get(key) || 0) + 1);
  }

  const complexityMap = new Map<string, number>();
  for (const request of requests) {
    const key = request.complexity || 'unknown';
    complexityMap.set(key, (complexityMap.get(key) || 0) + 1);
  }

  const confidenceDistribution = [
    { label: 'High', value: requests.filter((request) => (request.confidence ?? 0) >= 0.75).length },
    { label: 'Medium', value: requests.filter((request) => (request.confidence ?? 0) >= 0.5 && (request.confidence ?? 0) < 0.75).length },
    { label: 'Low', value: requests.filter((request) => (request.confidence ?? 0) < 0.5).length },
  ];

  const chunkBuckets = [
    { label: '1-3', value: requests.filter((request) => request.chunks <= 3).length },
    { label: '4-8', value: requests.filter((request) => request.chunks > 3 && request.chunks <= 8).length },
    { label: '9+', value: requests.filter((request) => request.chunks > 8).length },
  ];

  const parentEntries = entries.filter((entry) => entry.type === 'parent_child_expansion');
  const hierarchyEntries = entries.filter((entry) => entry.type === 'hierarchical_retrieval');
  const contextBefore = average(parentEntries.concat(hierarchyEntries).map((entry) => entry.context_size_before_tokens ?? null));
  const contextAfter = average(parentEntries.concat(hierarchyEntries).map((entry) => entry.context_size_after_tokens ?? null));

  const totalTokens = aiUsageEntries.reduce((sum, entry) => sum + (entry.total_tokens || 0), 0);
  const providerCost = aiUsageEntries.reduce((sum, entry) => sum + (entry.provider_cost_usd || 0), 0);
  const billableCost = aiUsageEntries.reduce(
    (sum, entry) => sum + (entry.billable_cost_usd ?? entry.provider_cost_usd ?? 0),
    0,
  );
  const maxUnitTokens = aiUsageEntries.reduce((max, entry) => Math.max(max, entry.unit_tokens || 0), 0);
  const userVisibleUsageEntries = aiUsageEntries.filter((entry) => entry.is_user_visible ?? entry.usage_scope === 'user_visible');
  const promptTokens = userVisibleUsageEntries.reduce((sum, entry) => sum + (entry.prompt_tokens || 0), 0);
  const completionTokens = userVisibleUsageEntries.reduce((sum, entry) => sum + (entry.completion_tokens || 0), 0);
  const userVisibleProviderCost = userVisibleUsageEntries.reduce((sum, entry) => sum + (entry.provider_cost_usd || 0), 0);
  const featureUsage = new Map<string, number>();
  for (const entry of userVisibleUsageEntries) {
    const label = toTitleLabel(entry.feature || 'unknown');
    featureUsage.set(label, (featureUsage.get(label) || 0) + (entry.total_tokens || 0));
  }

  return {
    totalRequests: requests.length,
    successRate: round(successRate, 1) || 0,
    averageConfidence: round(average(requests.map((request) => request.confidence)), 2) || 0,
    averageResponseTime: round(average(requests.map((request) => request.latencyMs)), 1) || 0,
    cacheHitRate: round(
      requests.length ? (requests.filter((request) => request.cacheHit).length / requests.length) * 100 : 0,
      1,
    ) || 0,
    hallucinationRate: round(
      requests.length ? (requests.filter((request) => request.hallucinations > 0).length / requests.length) * 100 : 0,
      1,
    ) || 0,
    averageRetrievalQuality: round(average(requests.map((request) => request.avgRerank != null ? request.avgRerank * 100 : null)), 1),
    tokenUsage: totalTokens || null,
    promptTokens: promptTokens || null,
    completionTokens: completionTokens || null,
    providerCost: round(userVisibleProviderCost, 4),
    estimatedCost: round(providerCost, 4),
    billableCost: round(billableCost, 4),
    tokenUnitBurn: maxUnitTokens > 0 ? round(totalTokens / maxUnitTokens, 3) : null,
    averageCostPerRequest: requests.length > 0 ? round(billableCost / requests.length, 4) : null,
    strategyDistribution: Array.from(strategyMap.entries()).map(([label, value]) => ({ label, value })),
    parentUsage: requests.filter((request) => request.parentExpansionUsed).length,
    hierarchyUsage: requests.filter((request) => request.hierarchicalUsed).length,
    chunkDistribution: chunkBuckets,
    confidenceDistribution,
    complexityDistribution: Array.from(complexityMap.entries()).map(([label, value]) => ({ label, value })),
    compressionRatio: contextBefore && contextAfter ? round((1 - contextAfter / contextBefore) * 100, 1) : null,
    contextSizeAverage: round(contextAfter || contextBefore, 0),
    activityBreakdown: [
      { label: 'Requests', value: requests.length },
      { label: 'Warnings', value: requests.reduce((sum, request) => sum + request.warningCount, 0) },
      { label: 'Retries', value: requests.reduce((sum, request) => sum + request.retryCount, 0) },
      { label: 'Errors', value: requests.reduce((sum, request) => sum + request.errorCount, 0) },
    ],
    aiFeatureBreakdown: Array.from(featureUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value })),
  };
}

export function buildLiveActivity(entries: MetricEntry[]) {
  return [...entries]
    .sort((a, b) => (safeDate(b.ts)?.getTime() || 0) - (safeDate(a.ts)?.getTime() || 0))
    .map((entry, index) => {
      const severity: 'info' | 'warning' | 'error' = entry.status === 'failed' || entry.success === false
        ? 'error'
        : entry.type === 'retrieval_agent_event' && entry.status && !['completed', 'continue'].includes(entry.status)
          ? 'warning'
          : !entry.type && (entry.hallucinations || 0) > 0
            ? 'warning'
            : 'info';

      const title = !entry.type
        ? entry.query || 'Request'
        : entry.type === 'retrieval_agent_event'
          ? `${entry.event_type || 'workflow'} • ${entry.node_id || 'node'}`
          : entry.type.replace(/_/g, ' ');

      const description = !entry.type
        ? `${entry.chunks || 0} chunks • ${(entry.confidence_label || '').trim() || 'confidence unavailable'}`
        : entry.reasoning || entry.fallback_reason || entry.details?.reasoning || JSON.stringify(entry.details || {}).slice(0, 120);

      return {
        id: `${entry.ts || 'event'}-${index}`,
        title,
        description,
        severity,
        label: entry.type || 'request',
        ts: entry.ts || new Date().toISOString(),
        query: entry.query || null,
        raw: entry,
      };
    });
}

export function formatRelativeTime(value: string): string {
  const date = safeDate(value);
  if (!date) return 'Unknown time';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function formatCompactNumber(value: number | null | undefined, suffix = ''): string {
  if (!isNumber(value)) return 'n/a';
  return `${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

export function formatCurrency(value: number | null | undefined): string {
  if (!isNumber(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (!isNumber(value)) return 'n/a';
  return `${value.toFixed(1)}%`;
}

export function formatDuration(value: number | null | undefined): string {
  if (!isNumber(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function formatFeatureLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown action';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
