import type { RAGResponseDetails } from './types';

const telemetryCache = new Map<string, Partial<RAGResponseDetails>>();
const telemetryRequests = new Map<string, Promise<Partial<RAGResponseDetails>>>();

interface MetricsEntry {
  type?: string;
  query?: string;
  latency_ms?: number;
  cache_hit?: boolean;
  chunks?: number;
  hallucinations?: number;
  confidence?: number;
  confidence_label?: string;
  retrieval_strategy?: string;
  modules_executed?: string[];
  reasoning?: string;
  execution_time_ms?: number;
  success?: boolean;
  selected?: boolean;
}

interface MetricsPayload {
  entries?: MetricsEntry[];
}

export function hasResponseTelemetryData(details: Partial<RAGResponseDetails> | null | undefined): boolean {
  if (!details) return false;
  return Boolean(
    details.confidence !== null && details.confidence !== undefined ||
    details.confidenceLabel ||
    details.cacheHit !== null && details.cacheHit !== undefined ||
    details.retrievedChunks !== null && details.retrievedChunks !== undefined ||
    details.hallucinationCount !== null && details.hallucinationCount !== undefined ||
    details.hallucinationCheckPassed !== null && details.hallucinationCheckPassed !== undefined ||
    details.processingTimeMs !== null && details.processingTimeMs !== undefined
  );
}

export function hasCompleteResponseTelemetryData(details: Partial<RAGResponseDetails> | null | undefined): boolean {
  if (!details) return false;

  const hasCoreQueryMetrics = Boolean(
    details.confidence !== null && details.confidence !== undefined ||
    details.confidenceLabel ||
    details.cacheHit !== null && details.cacheHit !== undefined ||
    details.retrievedChunks !== null && details.retrievedChunks !== undefined ||
    details.hallucinationCount !== null && details.hallucinationCount !== undefined ||
    details.hallucinationCheckPassed !== null && details.hallucinationCheckPassed !== undefined ||
    details.processingTimeMs !== null && details.processingTimeMs !== undefined
  );

  const hasRetrievalContext = Boolean(
    details.retrievalStrategy ||
    details.parentExpansionUsed !== null && details.parentExpansionUsed !== undefined ||
    details.hierarchicalRetrievalUsed !== null && details.hierarchicalRetrievalUsed !== undefined ||
    (details.modulesExecuted && details.modulesExecuted.length > 0) ||
    details.reasoning
  );

  return hasCoreQueryMetrics && hasRetrievalContext;
}

function matchesQuery(entry: MetricsEntry, query: string): boolean {
  return (entry.query || '').trim() === query.trim();
}

function entryForType(entries: MetricsEntry[], type: string, query: string): MetricsEntry | null {
  return entries.find((entry) => entry.type === type && matchesQuery(entry, query)) || null;
}

export async function fetchResponseTelemetry(
  query: string,
  token: string | null,
): Promise<Partial<RAGResponseDetails>> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {};
  }

  const cached = telemetryCache.get(normalizedQuery);
  if (cached) {
    return cached;
  }

  const pending = telemetryRequests.get(normalizedQuery);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const response = await fetch('/api/metrics/dashboard?limit=200', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new Error('Failed to fetch response telemetry');
    }

    const payload = (await response.json()) as MetricsPayload;
    const entries = [...(payload.entries || [])].reverse();
    const queryEntry = entries.find((entry) => !entry.type && matchesQuery(entry, normalizedQuery)) || null;
    const planEntry = entryForType(entries, 'retrieval_plan', normalizedQuery);
    const parentEntry = entryForType(entries, 'parent_child_expansion', normalizedQuery);
    const hierarchicalEntry = entryForType(entries, 'hierarchical_retrieval', normalizedQuery);

    const hallucinationCount = queryEntry?.hallucinations;
    const result = {
      query: normalizedQuery,
      confidence: queryEntry?.confidence ?? null,
      confidenceLabel: queryEntry?.confidence_label ?? null,
      retrievalStrategy: planEntry?.retrieval_strategy ?? null,
      cacheHit: queryEntry?.cache_hit ?? planEntry?.cache_hit ?? null,
      retrievedChunks: queryEntry?.chunks ?? null,
      parentExpansionUsed: parentEntry ? Boolean(parentEntry.success && parentEntry.selected !== false) : null,
      hierarchicalRetrievalUsed: hierarchicalEntry ? Boolean(hierarchicalEntry.success && hierarchicalEntry.selected) : null,
      hallucinationCount: hallucinationCount ?? null,
      hallucinationCheckPassed: hallucinationCount === undefined ? null : hallucinationCount === 0,
      processingTimeMs: queryEntry?.latency_ms ?? planEntry?.execution_time_ms ?? null,
      modulesExecuted: planEntry?.modules_executed || [],
      reasoning: planEntry?.reasoning ?? null,
    } satisfies Partial<RAGResponseDetails>;

    if (hasResponseTelemetryData(result)) {
      telemetryCache.set(normalizedQuery, result);
    }
    return result;
  })();

  telemetryRequests.set(normalizedQuery, request);

  try {
    return await request;
  } finally {
    telemetryRequests.delete(normalizedQuery);
  }
}
