import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Brain,
  Download,
  Filter,
  Gauge,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from 'lucide-react';

import { ActivityTimeline } from './metrics/ActivityTimeline';
import { RequestInspectorDrawer } from './metrics/RequestInspectorDrawer';
import type { DashboardData, DashboardRange, MetricEntry, RequestRecord } from './metrics/types';
import {
  buildUsageSummaryForRange,
  buildLiveActivity,
  buildRequestRecords,
  buildSummary,
  filterAiUsageByRange,
  filterEntriesByRange,
  formatCompactNumber,
  formatDuration,
  formatFeatureLabel,
  formatCurrency,
  formatLocalDateTime,
  formatPercent,
  formatRelativeTime,
  getMachineTimeZone,
  normalizeSearch,
} from './metrics/utils';
import { DistributionBars, DonutChart, EmptyPanel, KpiCard, MiniAreaChart, SectionCard } from './metrics/ui';
import { WorkflowGraph } from './metrics/WorkflowGraph';

const LazyEvaluationWorkbench = lazy(() => import('./EvaluationWorkbench'));

type DashboardTab = 'overview' | 'diagnostics' | 'evaluation';
type SeverityFilter = 'all' | 'info' | 'warning' | 'error';
type ExpandablePanel = 'retrieval' | 'performance' | 'quality' | null;
type FetchMetricsOptions = {
  showSkeleton?: boolean;
  minimumDelayMs?: number;
  manual?: boolean;
};

const EVALUATION_MODE_KEY = 'frontend_evaluation_mode';

function exportJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function MetricsDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [range, setRange] = useState<DashboardRange>('week');
  const [globalSearch, setGlobalSearch] = useState('');
  const [activitySearch, setActivitySearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedPanel, setExpandedPanel] = useState<ExpandablePanel>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [evaluationModeEnabled, setEvaluationModeEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EVALUATION_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const fetchMetrics = async (options: FetchMetricsOptions = {}) => {
    const startedAt = Date.now();
    let nextData: DashboardData | null = null;
    let nextError: string | null = null;
    if (options.showSkeleton) {
      setLoading(true);
    }
    if (options.manual) {
      setRefreshing(true);
    }
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/api/metrics/dashboard?limit=2000', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Failed to fetch metrics dashboard data');
      const payload = await response.json();
      nextData = payload;
      nextError = null;
    } catch (fetchError: any) {
      nextError = fetchError.message || 'Unable to load metrics dashboard.';
    } finally {
      const elapsed = Date.now() - startedAt;
      const remainingDelay = Math.max(0, (options.minimumDelayMs || 0) - elapsed);
      if (remainingDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingDelay));
      }
      unstable_batchedUpdates(() => {
        if (nextData) {
          setData(nextData);
        }
        setError(nextError);
        setLoading(false);
        if (options.manual) {
          setRefreshing(false);
        }
      });
    }
  };

  const handleManualRefresh = () => {
    setSelectedRequestId(null);
    fetchMetrics({ showSkeleton: true, minimumDelayMs: 650, manual: true });
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 15000);
    const syncEvaluationMode = () => {
      try {
        setEvaluationModeEnabled(localStorage.getItem(EVALUATION_MODE_KEY) === 'true');
      } catch {
        setEvaluationModeEnabled(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setExpandedPanel(null);
      }
    };

    window.addEventListener('rag-evaluation-mode-changed', syncEvaluationMode);
    window.addEventListener('storage', syncEvaluationMode);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rag-evaluation-mode-changed', syncEvaluationMode);
      window.removeEventListener('storage', syncEvaluationMode);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const filteredEntries = useMemo(
    () => filterEntriesByRange((data?.entries as MetricEntry[] | undefined) || [], range),
    [data?.entries, range],
  );
  const filteredAiUsage = useMemo(
    () => filterAiUsageByRange(data?.ai_usage_entries || [], range),
    [data?.ai_usage_entries, range],
  );
  const requests = useMemo(() => buildRequestRecords(filteredEntries), [filteredEntries]);
  const accountUsageSummary = data?.usage_summary || null;
  const walletBalance = data?.wallet_balance || null;
  const usageSummary = useMemo(() => {
    const base = accountUsageSummary;
    if (!base) return null;
    return buildUsageSummaryForRange(
      filteredAiUsage,
      base.unit_tokens,
    );
  }, [accountUsageSummary, filteredAiUsage]);
  const searchTerm = normalizeSearch(globalSearch);

  const visibleRequests = useMemo(() => {
    if (!searchTerm) return requests;
    return requests.filter((request) => {
      const haystack = [
        request.query,
        request.retrievalStrategy || '',
        request.plannerReasoning || '',
        request.confidenceLabel || '',
        request.complexity || '',
        ...request.modulesExecuted,
        ...request.fallbackReasons,
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [requests, searchTerm]);

  const summary = useMemo(
    () => buildSummary(visibleRequests, filteredEntries, filteredAiUsage),
    [filteredAiUsage, filteredEntries, visibleRequests],
  );
  const generationActivity = useMemo(() => {
    return [...filteredAiUsage]
      .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime())
      .filter((entry) => entry.is_user_visible ?? entry.usage_scope === 'user_visible')
      .slice(0, 24);
  }, [filteredAiUsage]);

  const liveActivity = useMemo(() => {
    const base = buildLiveActivity(filteredEntries).filter((item) => {
      const severityOk = severityFilter === 'all' || item.severity === severityFilter;
      const searchOk = !activitySearch.trim()
        || `${item.title} ${item.description} ${item.label}`.toLowerCase().includes(activitySearch.toLowerCase());
      return severityOk && searchOk;
    });
    return base;
  }, [activitySearch, filteredEntries, severityFilter]);

  const selectedRequest = useMemo(
    () => visibleRequests.find((request) => request.id === selectedRequestId) || visibleRequests[0] || null,
    [selectedRequestId, visibleRequests],
  );

  const performanceSeries = visibleRequests.slice().reverse().map((request) => request.latencyMs || 0);
  const confidenceSeries = visibleRequests.slice().reverse().map((request) => (request.confidence || 0) * 100);
  const chartPanelMap = {
    retrieval: (
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Retrieval strategy mix">
          {summary.strategyDistribution.length > 0 ? (
            <DonutChart items={summary.strategyDistribution} />
          ) : (
            <EmptyPanel title="No retrieval mix yet" description="Strategy telemetry will show up here as requests are processed." />
          )}
        </SectionCard>
        <SectionCard title="Chunk and complexity distributions">
          <div className="grid gap-6 md:grid-cols-2">
            <DistributionBars items={summary.chunkDistribution} />
            <DistributionBars items={summary.complexityDistribution} />
          </div>
        </SectionCard>
      </div>
    ),
    performance: (
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Latency trend" subtitle="End-to-end response time across the current window">
          {performanceSeries.length > 1 ? (
            <MiniAreaChart data={performanceSeries} color="#06B6D4" />
          ) : (
            <EmptyPanel title="Not enough samples" description="Run a few more requests to visualize latency trends." />
          )}
        </SectionCard>
        <SectionCard title="Performance snapshot">
          <div className="grid gap-4 md:grid-cols-2">
            <InlineStat label="Average response" value={formatDuration(summary.averageResponseTime)} />
            <InlineStat label="Slowest request" value={formatDuration(Math.max(...visibleRequests.map((request) => request.latencyMs), 0))} />
            <InlineStat label="Cache hit rate" value={formatPercent(summary.cacheHitRate)} />
            <InlineStat label="Retry events" value={String(visibleRequests.reduce((sum, request) => sum + request.retryCount, 0))} />
          </div>
        </SectionCard>
      </div>
    ),
    quality: (
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Confidence trend">
          {confidenceSeries.length > 1 ? (
            <MiniAreaChart data={confidenceSeries} color="#8B5CF6" />
          ) : (
            <EmptyPanel title="No quality trend yet" description="Confidence trends appear after multiple requests." />
          )}
        </SectionCard>
        <SectionCard title="Quality distribution">
          <DistributionBars items={summary.confidenceDistribution} />
        </SectionCard>
      </div>
    ),
  };

  const panelTitles: Record<Exclude<ExpandablePanel, null>, string> = {
    retrieval: 'Retrieval analytics',
    performance: 'Performance analytics',
    quality: 'Quality analytics',
  };

  const tabs: DashboardTab[] = evaluationModeEnabled ? ['overview', 'diagnostics', 'evaluation'] : ['overview', 'diagnostics'];
  const latestHealth = summary.successRate >= 80 ? 'Healthy' : summary.successRate >= 55 ? 'Watch' : 'Needs attention';
  const machineTimeZone = getMachineTimeZone();

  return (
    <div className="metrics-hidden-scroll relative flex h-full flex-col overflow-y-auto bg-[#FCFBF9] px-5 py-5 dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="px-2 py-4">
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif text-5xl italic tracking-tight text-slate-900 dark:text-white">
                Modern observability for your retrieval and reasoning pipeline
              </h1>
              <p className="mt-4 max-w-2xl text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                This dashboard reuses your current metrics and telemetry to surface request health, retrieval behavior,
                agent workflow decisions, and evaluation insights in a single operational workspace.
              </p>
            </div>
            
            <div className="flex items-center justify-between rounded-xl bg-[#2b4c3b] px-5 py-4 text-white shadow-sm">
              <div className="flex items-center gap-3 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${latestHealth === 'Healthy' ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
                <span className="font-semibold">{latestHealth === 'Healthy' ? 'All systems operational' : 'System needs attention'}</span>
                <span className="text-white/60">•</span>
                <span className="text-white/80">Your services are being monitored. {latestHealth === 'Healthy' ? 'No current disruptions detected.' : 'Please review the diagnostics.'}</span>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Live update</div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <HeroPill icon={<ShieldCheck size={14} />} label="System health" value={latestHealth} />
              <HeroPill icon={<Gauge size={14} />} label="Requests in window" value={String(summary.totalRequests)} />
              <HeroPill icon={<Brain size={14} />} label="Avg confidence" value={formatPercent(summary.averageConfidence * 100)} />
              <HeroPill icon={<TimerReset size={14} />} label="Avg response" value={formatDuration(summary.averageResponseTime)} />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/75 p-1.5 dark:border-white/10 dark:bg-slate-950/80">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize transition ${
                    activeTab === tab
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative min-w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Search requests, planners, warnings...  /"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-indigo-300 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
                  aria-label="Global metrics search"
                />
              </div>

              <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-slate-950">
                {(['hour', 'today', 'week', 'month'] as DashboardRange[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                      range === option
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => exportJson(`metrics-dashboard-${range}.json`, { generated_at: new Date().toISOString(), range, requests: visibleRequests, entries: filteredEntries })}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
              >
                <Download size={15} />
                Export
              </button>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing || loading}
                aria-busy={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <ErrorState error={error} onRetry={() => fetchMetrics({ showSkeleton: true, minimumDelayMs: 450 })} />
        ) : activeTab === 'evaluation' && evaluationModeEnabled ? (
          <Suspense fallback={<DashboardSkeleton />}>
            <LazyEvaluationWorkbench />
          </Suspense>
        ) : activeTab === 'diagnostics' ? (
          <DiagnosticsView
            requests={visibleRequests}
            onInspect={(requestId) => setSelectedRequestId(requestId)}
          />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <KpiCard title="Total requests" value={formatCompactNumber(summary.totalRequests)} subtitle="All requests in the selected window" sparkline={performanceSeries} />
              <KpiCard title="Response pass rate" value={formatPercent(summary.successRate)} subtitle="Heuristic: no errors and confidence >= 0.5" tone={summary.successRate >= 80 ? 'success' : summary.successRate >= 55 ? 'warning' : 'danger'} status={latestHealth} sparkline={confidenceSeries} />
              <KpiCard title="Average confidence" value={formatPercent(summary.averageConfidence * 100)} subtitle="Confidence score returned by the existing backend" tone="default" sparkline={confidenceSeries} />
              <KpiCard title="Average response time" value={formatDuration(summary.averageResponseTime)} subtitle="End-to-end request latency" tone="warning" sparkline={performanceSeries} />
              <KpiCard title="Cache hit rate" value={formatPercent(summary.cacheHitRate)} subtitle="Semantic cache effectiveness" tone="success" />
              <KpiCard title="Hallucination rate" value={formatPercent(summary.hallucinationRate)} subtitle="Requests with at least one detected issue" tone={summary.hallucinationRate < 15 ? 'success' : 'danger'} />
              <KpiCard title="Avg rerank score" value={summary.averageRetrievalQuality != null ? `${summary.averageRetrievalQuality.toFixed(1)}%` : 'n/a'} subtitle="Average rerank score from recorded requests" />
              <KpiCard title="User token usage" value={usageSummary ? formatCompactNumber(usageSummary.used_tokens) : 'n/a'} subtitle="User-visible settled AI usage only" tone="default" />
              <KpiCard title="Provider wallet" value={walletBalance?.available ? formatCurrency(walletBalance.amount) : 'n/a'} subtitle={walletBalance?.configured ? (walletBalance.message || `${walletBalance.currency || 'USD'} balance from configured provider`) : 'Wallet balance not configured'} tone={walletBalance?.available ? 'success' : 'warning'} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <SectionCard title="AI usage container" subtitle={`Selected-window usage only includes user-visible AI actions. Local timezone: ${machineTimeZone}`}>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <InlineStat label="User used tokens" value={usageSummary ? formatCompactNumber(usageSummary.used_tokens) : 'n/a'} />
                  <InlineStat label="Provider tokens" value={usageSummary ? formatCompactNumber(usageSummary.provider_total_tokens) : 'n/a'} />
                  <InlineStat label="Provider cost" value={usageSummary ? formatCurrency(usageSummary.provider_total_cost_usd || 0) : 'n/a'} />
                  <InlineStat label="Wallet balance" value={walletBalance?.available ? formatCurrency(walletBalance.amount) : 'n/a'} />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <InlineStat label="25k units burned" value={usageSummary ? usageSummary.units_burned.toFixed(2) : 'n/a'} />
                  <InlineStat label="User-visible events" value={usageSummary ? String(usageSummary.user_visible_events ?? 0) : 'n/a'} />
                  <InlineStat label="Pending events" value={usageSummary ? String(usageSummary.pending_events ?? 0) : 'n/a'} />
                </div>
                <div className="mt-5 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-4 text-sm text-amber-900">
                  Settled events: {usageSummary?.settled_events ?? 0} • Pending settlement: {usageSummary?.pending_events ?? 0}. This total now counts only provider-confirmed usage, not estimates or formulas.
                </div>
                <div className="mt-3 rounded-2xl border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-900">
                  User usage counts only visible actions. Internal embeddings, planners, rewrites, retrieval helpers, and compression are excluded from AI cost tracking.
                </div>
              </SectionCard>

              <SectionCard title="Cost by AI feature" subtitle="Largest user-visible token consumers in the current time window">
                {summary.aiFeatureBreakdown.length > 0 ? (
                  <DistributionBars items={summary.aiFeatureBreakdown} />
                ) : (
                  <EmptyPanel title="No AI cost events yet" description="Once users trigger AI-backed actions, their token usage and cost will appear here." />
                )}
              </SectionCard>
            </div>

            <SectionCard
              title="Generation and Regeneration Tracker"
              subtitle="User-visible AI actions only. Internal indexing and retrieval helper events are excluded from this list."
              actions={
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300">
                  <Sparkles size={12} />
                  {generationActivity.length} recent actions
                </span>
              }
            >
              {generationActivity.length > 0 ? (
                <div className="metrics-hidden-scroll max-h-[428px] space-y-3 overflow-auto pr-1">
                  {generationActivity.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-slate-950/60 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {formatFeatureLabel(entry.feature)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatRelativeTime(entry.ts || '')}
                          </span>
                          <span className="text-xs text-slate-400">
                            {entry.ts ? formatLocalDateTime(entry.ts) : 'Unknown local time'}
                          </span>
                          {entry.metadata?.pending_settlement ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                              Pending
                            </span>
                          ) : entry.is_exact_settled ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              Settled
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                          {entry.resource_id ? `Resource: ${entry.resource_id}` : 'Global action'} • Model: {entry.model || 'unknown'} • Operation: {entry.operation}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:min-w-[280px]">
                        <MetricChip label="Prompt" value={formatCompactNumber(entry.prompt_tokens || 0)} />
                        <MetricChip label="Output" value={formatCompactNumber(entry.completion_tokens || 0)} />
                        <MetricChip label="Total" value={formatCompactNumber(entry.total_tokens || 0)} />
                        <MetricChip label="Units" value={entry.unit_tokens ? ((entry.total_tokens || 0) / entry.unit_tokens).toFixed(2) : 'n/a'} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyPanel
                  title="No generation history yet"
                  description="As users generate or regenerate AI-backed content, each request will appear here with its burned token count."
                />
              )}
            </SectionCard>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <SectionCard
                title="Live activity"
                subtitle="Latest requests, planner events, cache outcomes, retries, and verification signals"
                actions={
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300">
                    <Filter size={12} />
                    {liveActivity.length} visible
                  </span>
                }
              >
                <ActivityTimeline
                  items={liveActivity}
                  search={activitySearch}
                  setSearch={setActivitySearch}
                  severityFilter={severityFilter}
                  setSeverityFilter={setSeverityFilter}
                  onInspectRequest={(query) => {
                    const request = visibleRequests.find((item) => item.query === query) || visibleRequests[0];
                    if (request) setSelectedRequestId(request.id);
                  }}
                />
              </SectionCard>

              <SectionCard title="Request inspector preview" subtitle="Click any activity or request row to open the full side drawer">
                {selectedRequest ? (
                  <div className="space-y-5">
                    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-5 dark:border-white/10 dark:bg-slate-950/70">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Current focus</div>
                          <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{selectedRequest.query}</h3>
                          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            {selectedRequest.retrievalStrategy || 'No retrieval strategy recorded'} • {formatDuration(selectedRequest.latencyMs)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedRequestId(selectedRequest.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
                        >
                          Open
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </div>
                    <WorkflowGraph nodes={selectedRequest.workflowNodes.slice(0, 8)} compact />
                  </div>
                ) : (
                  <EmptyPanel title="No request selected" description="Once requests appear, this panel will preview the most relevant one." />
                )}
              </SectionCard>
            </div>

            <div className="grid gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
              <SectionCard
                title="Retrieval analytics"
                subtitle="Strategy mix, hierarchy usage, chunk distribution, and context enrichment signals"
                onExpand={() => setExpandedPanel('retrieval')}
              >
                <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                  {summary.strategyDistribution.length > 0 ? (
                    <DonutChart items={summary.strategyDistribution} />
                  ) : (
                    <EmptyPanel title="No strategy telemetry yet" description="Retrieval strategies will appear once requests flow through the planner." />
                  )}
                  <div className="grid gap-5">
                    <DistributionBars items={summary.chunkDistribution} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <InlineStat label="Parent expansion usage" value={`${summary.parentUsage} requests`} />
                      <InlineStat label="Hierarchy usage" value={`${summary.hierarchyUsage} requests`} />
                      <InlineStat label="Avg context size" value={summary.contextSizeAverage != null ? `${summary.contextSizeAverage} tokens` : 'n/a'} />
                      <InlineStat label="Compression ratio" value={summary.compressionRatio != null ? `${summary.compressionRatio.toFixed(1)}%` : 'n/a'} />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Agent workflow" subtitle="Executed nodes are highlighted, skipped steps are muted, retries surface in amber">
                {selectedRequest ? (
                  <WorkflowGraph nodes={selectedRequest.workflowNodes} />
                ) : (
                  <EmptyPanel title="No workflow to visualize" description="As soon as requests are available, the workflow graph will light up." />
                )}
              </SectionCard>
            </div>

            <div className="grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">
              <SectionCard
                title="Performance"
                subtitle="Latency, cache efficiency, and slow request visibility"
                onExpand={() => setExpandedPanel('performance')}
              >
                {performanceSeries.length > 1 ? (
                  <MiniAreaChart data={performanceSeries} color="#06B6D4" />
                ) : (
                  <EmptyPanel title="Waiting on latency data" description="Run more than one request to reveal the trend line." />
                )}
                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <InlineStat label="Average response" value={formatDuration(summary.averageResponseTime)} />
                  <InlineStat label="Slowest request" value={formatDuration(Math.max(...visibleRequests.map((request) => request.latencyMs), 0))} />
                  <InlineStat label="Cache hit rate" value={formatPercent(summary.cacheHitRate)} />
                  <InlineStat label="Retry events" value={String(visibleRequests.reduce((sum, request) => sum + request.retryCount, 0))} />
                </div>
              </SectionCard>

              <SectionCard
                title="Quality & cost"
                subtitle="Confidence signals plus real user-visible token and provider cost totals for the selected window"
                onExpand={() => setExpandedPanel('quality')}
              >
                <div className="grid gap-6">
                  <DistributionBars items={summary.confidenceDistribution} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <InlineStat label="Hallucination rate" value={formatPercent(summary.hallucinationRate)} />
                    <InlineStat label="Avg rerank score" value={summary.averageRetrievalQuality != null ? `${summary.averageRetrievalQuality.toFixed(1)}%` : 'n/a'} />
                    <InlineStat label="Prompt tokens" value={formatCompactNumber(summary.promptTokens)} />
                    <InlineStat label="Provider cost" value={summary.providerCost != null ? `$${summary.providerCost.toFixed(summary.providerCost < 1 ? 4 : 2)}` : 'n/a'} />
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Request inventory" subtitle="Recent requests ordered by freshness. Click any row to open the inspector drawer.">
              <div className="metrics-hidden-scroll max-h-[640px] overflow-auto">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                    <tr className="border-b border-slate-200/80 text-left text-slate-400 dark:border-white/10">
                      <th className="pb-3 font-semibold">Request</th>
                      <th className="pb-3 font-semibold">Strategy</th>
                      <th className="pb-3 font-semibold">Latency</th>
                      <th className="pb-3 font-semibold">Confidence</th>
                      <th className="pb-3 font-semibold">Chunks</th>
                      <th className="pb-3 font-semibold">Cache</th>
                      <th className="pb-3 font-semibold">Retries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRequests.map((request) => (
                      <tr
                        key={request.id}
                        className="cursor-pointer border-b border-slate-100 transition hover:bg-white/80 dark:border-white/5 dark:hover:bg-slate-900/70"
                        onClick={() => setSelectedRequestId(request.id)}
                      >
                        <td className="py-3 pr-4">
                          <div className="max-w-[420px] truncate font-medium text-slate-900 dark:text-white">{request.query}</div>
                          <div className="mt-1 text-xs text-slate-400">{new Date(request.ts).toLocaleTimeString()}</div>
                        </td>
                        <td className="py-3 text-slate-500 dark:text-slate-300">{request.retrievalStrategy || 'n/a'}</td>
                        <td className="py-3 text-slate-500 dark:text-slate-300">{formatDuration(request.latencyMs)}</td>
                        <td className="py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            (request.confidence ?? 0) >= 0.75
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : (request.confidence ?? 0) >= 0.5
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          }`}>
                            {request.confidenceLabel || (request.confidence != null ? request.confidence.toFixed(2) : 'n/a')}
                          </span>
                        </td>
                        <td className="py-3 text-slate-500 dark:text-slate-300">{request.chunks}</td>
                        <td className="py-3 text-slate-500 dark:text-slate-300">{request.cacheHit == null ? 'n/a' : request.cacheHit ? 'Hit' : 'Miss'}</td>
                        <td className="py-3 text-slate-500 dark:text-slate-300">{request.retryCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      <RequestInspectorDrawer request={selectedRequestId ? visibleRequests.find((request) => request.id === selectedRequestId) || null : null} onClose={() => setSelectedRequestId(null)} />

      <AnimatePresence>
        {expandedPanel && (
          <>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              type="button"
              onClick={() => setExpandedPanel(null)}
              className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm"
              aria-label="Close expanded analytics view"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-6 top-8 z-50 mx-auto max-w-6xl rounded-[32px] border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl dark:bg-slate-950/95"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Full screen panel</div>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{panelTitles[expandedPanel]}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedPanel(null)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
                >
                  Close
                </button>
              </div>
              {chartPanelMap[expandedPanel]}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function HeroPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200/60 bg-white px-5 py-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-3 font-sans text-3xl font-semibold tracking-tight text-slate-950 [font-variant-numeric:tabular-nums] dark:text-white">{value}</div>
    </div>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white px-4 py-4 dark:border-white/10 dark:bg-slate-950/70 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-2 font-sans text-lg font-semibold text-slate-950 [font-variant-numeric:tabular-nums] dark:text-white">{value}</div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-900/70">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-[24px] border border-white/60 bg-white/70 dark:border-white/10 dark:bg-slate-900/60" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="h-[420px] animate-pulse rounded-[28px] border border-white/60 bg-white/70 dark:border-white/10 dark:bg-slate-900/60" />
        <div className="h-[420px] animate-pulse rounded-[28px] border border-white/60 bg-white/70 dark:border-white/10 dark:bg-slate-900/60" />
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[32px] border border-rose-200 bg-white/80 p-10 text-center dark:border-rose-500/20 dark:bg-slate-950/70">
      <div className="rounded-full bg-rose-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-rose-600 dark:text-rose-300">
        Diagnostics unavailable
      </div>
      <h2 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">The metrics dashboard could not load</h2>
      <p className="mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
      >
        <RefreshCw size={15} />
        Retry
      </button>
    </div>
  );
}

function DiagnosticsView({
  requests,
  onInspect,
}: {
  requests: RequestRecord[];
  onInspect: (requestId: string) => void;
}) {
  const diagnostics = requests.filter((request) => request.warningCount > 0 || request.errorCount > 0 || request.fallbackReasons.length > 0);

  return (
    <div className="mx-auto grid w-full max-w-[1500px] min-w-0 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0">
        <SectionCard title="Errors & diagnostics" subtitle="Failed requests, fallback paths, retry reasons, and low-confidence traces">
          {diagnostics.length === 0 ? (
            <EmptyPanel title="No diagnostics issues in this window" description="Warnings, retries, or fallback reasons will appear here automatically." />
          ) : (
            <div className="metrics-hidden-scroll h-[520px] space-y-4 overflow-auto pr-1">
              {diagnostics.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => onInspect(request.id)}
                  className="w-full min-w-0 rounded-[24px] border border-slate-200/80 bg-white/80 p-4 text-left transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-slate-950/70 dark:hover:border-white/20"
                >
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{request.query}</div>
                      <div className="mt-1 text-xs text-slate-400">{new Date(request.ts).toLocaleString()}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      request.errorCount > 0 ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    }`}>
                      {request.errorCount > 0 ? `${request.errorCount} errors` : `${request.warningCount} warnings`}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                    <div className="min-w-0 truncate">Strategy: {request.retrievalStrategy || 'n/a'}</div>
                    <div>Retries: {request.retryCount}</div>
                    <div className="min-w-0 truncate">Confidence: {request.confidenceLabel || 'n/a'}</div>
                    <div>Hallucinations: {request.hallucinations}</div>
                  </div>

                  {request.fallbackReasons.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
                      {request.fallbackReasons.slice(0, 2).map((reason, index) => (
                        <li key={`${reason}-${index}`} className="break-words">{reason}</li>
                      ))}
                    </ul>
                  )}
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="flex min-w-0">
        <SectionCard title="Request diagnostics table" subtitle="Search and inspect the requests that produced warnings, retries, or fallback signals">
          <div className="metrics-hidden-scroll h-[520px] min-w-0 overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200/80 text-left text-slate-400 dark:border-white/10">
                <th className="w-[48%] pb-3 pr-3 font-semibold">Request</th>
                <th className="w-[13%] pb-3 pr-2 text-center font-semibold">Warn</th>
                <th className="w-[13%] pb-3 pr-2 text-center font-semibold">Err</th>
                <th className="w-[13%] pb-3 pr-2 text-center font-semibold">Fallback</th>
                <th className="w-[13%] pb-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((request) => (
                <tr key={request.id} className="border-b border-slate-100 dark:border-white/5">
                  <td className="py-3 pr-3">
                    <div className="truncate font-medium text-slate-900 dark:text-white">{request.query}</div>
                    <div className="mt-1 text-xs text-slate-400">{request.retrievalStrategy || 'n/a'}</div>
                  </td>
                  <td className="py-3 pr-2 text-center text-slate-500 dark:text-slate-300">{request.warningCount}</td>
                  <td className="py-3 pr-2 text-center text-slate-500 dark:text-slate-300">{request.errorCount}</td>
                  <td className="py-3 pr-2 text-center text-slate-500 dark:text-slate-300">{request.fallbackReasons.length}</td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onInspect(request.id)}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}



