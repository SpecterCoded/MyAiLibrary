export interface MetricEntry {
  ts?: string;
  type?: string;
  query?: string;
  latency_ms?: number;
  cache_hit?: boolean;
  chunks?: number;
  avg_rerank?: number;
  top_rerank?: number;
  hallucinations?: number;
  confidence?: number;
  confidence_label?: string;
  complexity?: string;
  execution_time_ms?: number;
  retrieval_strategy?: string;
  modules_executed?: string[];
  modules_skipped?: string[];
  reasoning?: string;
  final_confidence?: number;
  planner_input?: string;
  planner_output?: unknown;
  child_chunks?: unknown[];
  parent_sections?: unknown[];
  context_size_before_tokens?: number;
  context_size_after_tokens?: number;
  success?: boolean;
  selected?: boolean;
  selected_levels?: string[];
  retrieved_nodes?: unknown[];
  fallback_reason?: string;
  workflow_id?: string;
  event_type?: string;
  node_id?: string;
  tool_name?: string;
  status?: string;
  details?: any;
  workflow?: any;
  final_plan?: any;
  retry_count?: number;
  evaluations?: any[];
  decisions?: any[];
  execution_state?: Record<string, unknown>;
}

export interface DashboardData {
  total_queries: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  avg_confidence: number;
  entries: MetricEntry[];
  ai_usage_entries?: AiUsageEntry[];
  usage_summary?: UsageSummary;
  wallet_balance?: WalletBalance;
}

export interface WalletBalance {
  configured: boolean;
  available: boolean;
  amount: number | null;
  currency?: string | null;
  message?: string | null;
}

export interface UsageSummary {
  used_tokens: number;
  unit_tokens: number;
  units_burned: number;
  settled_events?: number;
  pending_events?: number;
  user_visible_events?: number;
  provider_total_tokens?: number;
  provider_total_cost_usd?: number;
}

export interface AiUsageEntry {
  id: string;
  ts?: string | null;
  user_id?: string | null;
  resource_id?: string | null;
  feature: string;
  operation: string;
  provider?: string | null;
  model?: string | null;
  request_id?: string | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  provider_cost_usd?: number | null;
  billable_cost_usd?: number | null;
  unit_tokens?: number | null;
  unit_price_usd?: number | null;
  metadata?: Record<string, unknown>;
  usage_scope?: 'user_visible' | 'internal';
  is_user_visible?: boolean;
  is_exact_settled?: boolean;
}

export interface RequestRecord {
  id: string;
  ts: string;
  query: string;
  queryEntry: MetricEntry;
  relatedEvents: MetricEntry[];
  retrievalStrategy: string | null;
  cacheHit: boolean | null;
  chunks: number;
  confidence: number | null;
  confidenceLabel: string | null;
  hallucinations: number;
  latencyMs: number;
  avgRerank: number | null;
  topRerank: number | null;
  complexity: string | null;
  parentExpansionUsed: boolean;
  hierarchicalUsed: boolean;
  retryCount: number;
  warningCount: number;
  errorCount: number;
  plannerReasoning: string | null;
  modulesExecuted: string[];
  workflowNodes: WorkflowNodeState[];
  fallbackReasons: string[];
}

export interface WorkflowNodeState {
  id: string;
  label: string;
  status: 'executed' | 'skipped' | 'retry' | 'warning' | 'idle';
  durationMs?: number | null;
  note?: string | null;
}

export type DashboardRange = 'hour' | 'today' | 'week' | 'month';

export interface DashboardSummary {
  totalRequests: number;
  successRate: number;
  averageConfidence: number;
  averageResponseTime: number;
  cacheHitRate: number;
  hallucinationRate: number;
  averageRetrievalQuality: number | null;
  tokenUsage: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  providerCost: number | null;
  estimatedCost: number | null;
  billableCost: number | null;
  tokenUnitBurn: number | null;
  averageCostPerRequest: number | null;
  strategyDistribution: Array<{ label: string; value: number }>;
  parentUsage: number;
  hierarchyUsage: number;
  chunkDistribution: Array<{ label: string; value: number }>;
  confidenceDistribution: Array<{ label: string; value: number }>;
  complexityDistribution: Array<{ label: string; value: number }>;
  compressionRatio: number | null;
  contextSizeAverage: number | null;
  activityBreakdown: Array<{ label: string; value: number }>;
  aiFeatureBreakdown: Array<{ label: string; value: number }>;
}
