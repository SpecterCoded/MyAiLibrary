import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Download,
  DollarSign,
  Eraser,
  FileSearch,
  FolderOpen,
  Layers3,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  Server,
  Square,
  TerminalSquare,
  Timer,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type ViewMode = 'stream' | 'runs' | 'performance'
type LevelFilter = 'all' | SystemLogLevel
type SourceFilter = 'all' | SystemLogSource

const LEVEL_ORDER: Record<SystemLogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
}

const LEVEL_STYLE: Record<SystemLogLevel, { text: string; dot: string; badge: string }> = {
  debug: { text: 'text-slate-400', dot: 'bg-slate-500', badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  info: { text: 'text-sky-300', dot: 'bg-sky-400', badge: 'bg-sky-500/10 text-sky-300 border-sky-500/20' },
  warning: { text: 'text-amber-300', dot: 'bg-amber-400', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  error: { text: 'text-rose-300', dot: 'bg-rose-400', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  critical: { text: 'text-fuchsia-300', dot: 'bg-fuchsia-400', badge: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20' },
}

const SOURCE_STYLE: Record<SystemLogSource, string> = {
  desktop: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  backend: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  renderer: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
}

function formatTime(timestamp: string, includeDate = false): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return includeDate
    ? date.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
}

function formatDuration(durationMs?: number): string {
  if (durationMs == null) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`
}

function formatCost(value: unknown): string {
  if (value == null || value === '') return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `$${numeric.toFixed(6)}` : '—'
}

function formatWallet(value: unknown, currency: unknown): string {
  if (value == null || value === '') return 'Unavailable'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'Unavailable'
  const unit = typeof currency === 'string' && currency ? currency : 'USD'
  return `${numeric.toFixed(4)} ${unit}`
}

function statusColor(status?: SystemLogStatus): string {
  if (status === 'completed') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
  if (status === 'failed') return 'text-rose-300 bg-rose-500/10 border-rose-500/20'
  if (status === 'cancelled' || status === 'stopped') return 'text-slate-300 bg-slate-500/10 border-slate-500/20'
  if (status === 'waiting') return 'text-amber-300 bg-amber-500/10 border-amber-500/20'
  return 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface RunGroup {
  id: string
  operation: string
  source: SystemLogSource
  startedAt: string
  finishedAt?: string
  status: SystemLogStatus
  durationMs?: number
  events: SystemLogEvent[]
  phases: Array<{
    name: string
    status?: SystemLogStatus
    durationMs?: number
    timestamp: string
    level: SystemLogLevel
  }>
}

interface DailyCostPoint {
  key: string
  label: string
  cost: number
  tokens: number
  calls: number
}

interface PerformanceSummary {
  averageRagLatencyMs: number
  ragFailureRate: number
  ragRuns: number
  averageApiLatencyMs: number
  apiRequests: number
  averageGenerationLatencyMs: number
  generationRuns: number
  retainedProviderCostUsd: number
  retainedTokenCount: number
  exactBillingCalls: number
  unavailableBillingCalls: number
  pendingBillingCalls: number
  dailyCosts: DailyCostPoint[]
  failuresByOperation: Array<{ operation: string; count: number }>
}

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0
}

function contextNumber(event: SystemLogEvent, key: string): number {
  const value = Number(event.context?.[key])
  return Number.isFinite(value) ? value : 0
}

function buildPerformanceSummary(events: SystemLogEvent[]): PerformanceSummary {
  const ragTerminals = events.filter((event) => (
    /^rag\.pipeline_(?:completed|failed)$/.test(event.event)
  ))
  const ragFailures = ragTerminals.filter((event) => event.status === 'failed')
  const apiTerminals = events.filter((event) => event.event === 'api.request_completed')
  const generationTerminals = events.filter((event) => (
    /^generation\.run_(?:completed|failed)$/.test(event.event)
  ))

  const settledByCorrelation = new Map<string, SystemLogEvent>()
  for (const event of events) {
    if (
      event.event !== 'provider.usage_settled'
      && event.event !== 'provider.billing_reported'
    ) continue
    const key = event.correlationId || event.id
    const current = settledByCorrelation.get(key)
    if (!current || Date.parse(event.timestamp) >= Date.parse(current.timestamp)) {
      settledByCorrelation.set(key, event)
    }
  }
  const settled = Array.from(settledByCorrelation.values())
  const unavailableBillingCalls = events.filter((event) => (
    event.event === 'provider.billing_unavailable'
  )).length
  const pendingBillingCalls = events.filter((event) => (
    event.event === 'provider.billing_pending'
    || event.event === 'provider.usage_pending'
  )).length

  const dailyMap = new Map<string, DailyCostPoint>()
  const today = new Date()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
    dailyMap.set(key, {
      key,
      label: date.toLocaleDateString([], { weekday: 'short' }),
      cost: 0,
      tokens: 0,
      calls: 0,
    })
  }
  for (const event of settled) {
    const date = new Date(event.timestamp)
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
    const point = dailyMap.get(key)
    if (!point) continue
    point.cost += contextNumber(event, 'providerCostUsd')
    point.tokens += contextNumber(event, 'totalTokenCount')
    point.calls += 1
  }

  const failureCounts = new Map<string, number>()
  for (const event of events) {
    if (
      event.status !== 'failed'
      || !(
        event.event.endsWith('_failed')
        || event.event.endsWith('.failed')
        || event.event === 'api.request_completed'
      )
    ) continue
    const operation = event.operation || event.category
    failureCounts.set(operation, (failureCounts.get(operation) || 0) + 1)
  }

  return {
    averageRagLatencyMs: average(
      ragTerminals
        .map((event) => event.durationMs)
        .filter((value): value is number => typeof value === 'number')
    ),
    ragFailureRate: ragTerminals.length > 0
      ? (ragFailures.length / ragTerminals.length) * 100
      : 0,
    ragRuns: ragTerminals.length,
    averageApiLatencyMs: average(
      apiTerminals
        .map((event) => event.durationMs)
        .filter((value): value is number => typeof value === 'number')
    ),
    apiRequests: apiTerminals.length,
    averageGenerationLatencyMs: average(
      generationTerminals
        .map((event) => event.durationMs)
        .filter((value): value is number => typeof value === 'number')
    ),
    generationRuns: generationTerminals.length,
    retainedProviderCostUsd: settled.reduce(
      (total, event) => total + contextNumber(event, 'providerCostUsd'),
      0,
    ),
    retainedTokenCount: settled.reduce(
      (total, event) => total + contextNumber(event, 'totalTokenCount'),
      0,
    ),
    exactBillingCalls: settled.length,
    unavailableBillingCalls,
    pendingBillingCalls,
    dailyCosts: Array.from(dailyMap.values()),
    failuresByOperation: Array.from(failureCounts.entries())
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  }
}

function buildRuns(events: SystemLogEvent[]): RunGroup[] {
  const grouped = new Map<string, SystemLogEvent[]>()
  for (const event of events) {
    if (!event.correlationId || !event.operation) continue
    const group = grouped.get(event.correlationId) ?? []
    group.push(event)
    grouped.set(event.correlationId, group)
  }

  return Array.from(grouped.entries())
    .filter(([, runEvents]) => runEvents.some((event) => event.operation !== 'api_request'))
    .map(([id, runEvents]) => {
    const sorted = [...runEvents].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    const last = sorted.at(-1)!
    const workflowEvent = [...sorted].reverse().find((event) => event.operation !== 'api_request') ?? last
    const phaseMap = new Map<string, RunGroup['phases'][number]>()
    for (const event of sorted) {
      if (!event.phase) continue
      phaseMap.set(event.phase, {
        name: event.phase,
        status: event.status,
        durationMs: event.durationMs,
        timestamp: event.timestamp,
        level: event.level,
      })
    }
    const terminal = [...sorted].reverse().find((event) => (
      /^(?:rag\.pipeline_(?:completed|failed|stopped)|generation\.run_(?:completed|failed|stopped)|queue\.job_(?:completed|failed)|download\.task_(?:completed|failed)|processing\.completed|knowledge\.(?:completed|failed|controlled)|api\.request_(?:completed|failed)|backend\.process_exited)$/.test(event.event)
    ))
    const started = sorted[0]
    const inferredDuration = Math.max(0, Date.parse(last.timestamp) - Date.parse(started.timestamp))
    return {
      id,
      operation: workflowEvent.operation || 'operation',
      source: workflowEvent.source,
      startedAt: started.timestamp,
      finishedAt: terminal?.timestamp,
      status: terminal?.status || (
        last.status === 'starting' || last.status === 'running' || last.status === 'waiting'
          ? last.status
          : 'running'
      ),
      durationMs: terminal?.durationMs ?? inferredDuration,
      events: sorted,
      phases: Array.from(phaseMap.values()),
    }
  })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string
  value: string | number
  detail: string
  icon: React.ReactNode
  tone: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.065] bg-white/[0.025] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-semibold text-slate-100">{value}</span>
            <span className="truncate text-[10px] text-slate-500">{detail}</span>
          </div>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
      </div>
    </div>
  )
}

export default function SystemConsole() {
  const [events, setEvents] = useState<SystemLogEvent[]>([])
  const [totalEvents, setTotalEvents] = useState(0)
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const [view, setView] = useState<ViewMode>('stream')
  const [level, setLevel] = useState<LevelFilter>(() => {
    const requested = new URLSearchParams(window.location.search).get('level')
    return requested === 'error' || requested === 'critical' || requested === 'warning' ? requested : 'all'
  })
  const [source, setSource] = useState<SourceFilter>('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [wrapLines, setWrapLines] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<SystemLogEvent | null>(null)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [backendState, setBackendState] = useState<'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'>('stopped')
  const [toast, setToast] = useState('')
  const [isMaximized, setIsMaximized] = useState(false)
  const pausedRef = useRef(false)
  const pendingRef = useRef<SystemLogEvent[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    let disposed = false
    void window.systemLogs?.getSnapshot(10_000).then((snapshot) => {
      if (!snapshot || disposed) return
      setEvents(snapshot.events)
      setTotalEvents(snapshot.totalEvents)
      setHistoryTruncated(snapshot.truncated)
    })
    const removeEvent = window.systemLogs?.onEvent((event) => {
      setTotalEvents((count) => count + 1)
      if (pausedRef.current) {
        pendingRef.current.push(event)
        setPendingCount(pendingRef.current.length)
        return
      }
      setEvents((current) => [...current.slice(-9_999), event])
    })
    const removeFilter = window.systemLogs?.onSetFilter((nextLevel) => {
      if (nextLevel === 'error' || nextLevel === 'warning' || nextLevel === 'critical' || nextLevel === 'info' || nextLevel === 'debug') {
        setLevel(nextLevel)
        setView('stream')
      }
    })
    const removeBackend = window.systemLogs?.onBackendState((state) => setBackendState(state))
    void window.systemLogs?.getBackendState().then(setBackendState)
    void window.systemLogs?.isMaximized().then(setIsMaximized)
    return () => {
      disposed = true
      removeEvent?.()
      removeFilter?.()
      removeBackend?.()
    }
  }, [])

  useEffect(() => {
    if (!autoScroll || paused || view !== 'stream') return
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [events, autoScroll, paused, view])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const categories = useMemo(() => (
    Array.from(new Set(events.map((event) => event.category))).sort()
  ), [events])

  const filteredEvents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return events.filter((event) => {
      if (level !== 'all' && event.level !== level) return false
      if (source !== 'all' && event.source !== source) return false
      if (category !== 'all' && event.category !== category) return false
      if (!normalizedSearch) return true
      return [
        event.message,
        event.event,
        event.category,
        event.operation,
        event.phase,
        event.correlationId,
        safeJson(event.context),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    })
  }, [events, level, source, category, search])

  const runs = useMemo(() => buildRuns(filteredEvents), [filteredEvents])
  const performance = useMemo(() => buildPerformanceSummary(events), [events])
  const maxDailyCost = Math.max(
    ...performance.dailyCosts.map((point) => point.cost),
    0.000001,
  )
  const errors = events.filter((event) => LEVEL_ORDER[event.level] >= LEVEL_ORDER.error).length
  const warnings = events.filter((event) => event.level === 'warning').length
  const activeRuns = buildRuns(events).filter((run) => run.status === 'running' || run.status === 'starting' || run.status === 'waiting').length

  const resume = () => {
    setPaused(false)
    const pending = pendingRef.current
    pendingRef.current = []
    setPendingCount(0)
    if (pending.length > 0) setEvents((current) => [...current, ...pending].slice(-10_000))
  }

  const copyEvent = async (event: SystemLogEvent) => {
    await navigator.clipboard.writeText(safeJson(event))
    setToast('Event copied')
  }

  const exportLogs = async () => {
    const result = await window.systemLogs?.exportLogs()
    if (result?.success) setToast(`Exported ${result.count ?? 0} events`)
  }

  const clearLogs = async (filter?: SystemLogClearFilter) => {
    const result = await window.systemLogs?.clearLogs(filter)
    if (!result?.success) return
    const snapshot = await window.systemLogs?.getSnapshot(10_000)
    setEvents(snapshot?.events ?? [])
    setTotalEvents(snapshot?.totalEvents ?? 0)
    setHistoryTruncated(snapshot?.truncated ?? false)
    pendingRef.current = []
    setPendingCount(0)
    setSelectedEvent(null)
    if (filter?.category) setCategory('all')
    setToast(result.deleted > 0 ? `Cleared ${result.deleted.toLocaleString()} event${result.deleted === 1 ? '' : 's'}` : 'No matching events to clear')
  }

  const toggleRun = (runId: string) => {
    setExpandedRuns((current) => {
      const next = new Set(current)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

  return (
    <div className="system-console-root flex h-screen w-screen flex-col overflow-hidden bg-[#080b12] text-slate-200 selection:bg-indigo-500/30">
      <header className="system-console-header system-console-drag flex h-11 shrink-0 items-center border-b border-white/[0.07] bg-[#0b0f18] pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/40">
            <TerminalSquare size={15} className="text-white" />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[12px] font-semibold text-slate-100">MyAiLibrary System Console</span>
            <span className="h-3 w-px bg-white/10" />
            <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
              backendState === 'ready' ? 'text-emerald-400' : backendState === 'failed' ? 'text-rose-400' : 'text-amber-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                backendState === 'ready' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : backendState === 'failed' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'
              }`} />
              {backendState === 'ready' ? 'Backend online' : `Backend ${backendState}`}
            </span>
          </div>
        </div>
        <div className="ml-auto flex h-full system-console-no-drag">
          <button onClick={() => window.systemLogs?.minimize()} className="flex w-12 items-center justify-center text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200" title="Minimize">
            <Minimize2 size={14} />
          </button>
          <button
            onClick={() => {
              window.systemLogs?.toggleMaximize()
              window.setTimeout(() => void window.systemLogs?.isMaximized().then(setIsMaximized), 120)
            }}
            className="flex w-12 items-center justify-center text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Square size={12} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={() => window.systemLogs?.close()} className="flex w-12 items-center justify-center text-slate-500 transition-colors hover:bg-rose-500 hover:text-white" title="Close">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="system-console-summary grid shrink-0 grid-cols-4 gap-3 border-b border-white/[0.055] bg-[#090d15] px-5 py-3">
        <MetricCard label="Events" value={totalEvents.toLocaleString()} detail={historyTruncated ? 'latest 10k shown' : 'retained'} icon={<Activity size={17} />} tone="bg-sky-500/10 text-sky-300" />
        <MetricCard label="Active runs" value={activeRuns} detail="in progress" icon={<Zap size={17} />} tone="bg-indigo-500/10 text-indigo-300" />
        <MetricCard label="Warnings" value={warnings} detail="retained" icon={<AlertTriangle size={17} />} tone="bg-amber-500/10 text-amber-300" />
        <MetricCard label="Errors" value={errors} detail="need attention" icon={<XCircle size={17} />} tone="bg-rose-500/10 text-rose-300" />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="system-console-sidebar flex w-56 shrink-0 flex-col border-r border-white/[0.065] bg-[#090d15] p-3">
          <div className="grid grid-cols-3 rounded-lg bg-black/20 p-1">
            <button onClick={() => setView('stream')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-semibold transition ${view === 'stream' ? 'bg-indigo-500/15 text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <TerminalSquare size={13} /> Stream
            </button>
            <button onClick={() => setView('runs')} className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-semibold transition ${view === 'runs' ? 'bg-indigo-500/15 text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <Layers3 size={13} /> Runs
            </button>
            <button onClick={() => setView('performance')} className={`flex items-center justify-center gap-1.5 rounded-md px-1 py-2 text-[10px] font-semibold transition ${view === 'performance' ? 'bg-indigo-500/15 text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <BarChart3 size={13} /> Metrics
            </button>
          </div>

          <div className="mt-5">
            <p className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Severity</p>
            {(['all', 'critical', 'error', 'warning', 'info', 'debug'] as LevelFilter[]).map((item) => {
              const count = item === 'all' ? events.length : events.filter((event) => event.level === item).length
              return (
                <div key={item} className={`group mb-0.5 flex w-full items-center rounded-lg transition ${level === item ? 'bg-white/[0.06] text-slate-100' : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-300'}`}>
                  <button onClick={() => setLevel(item)} className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-2 text-left text-[11px] font-medium">
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${item === 'all' ? 'bg-indigo-400' : LEVEL_STYLE[item].dot}`} />
                      {item[0].toUpperCase() + item.slice(1)}
                    </span>
                    <span className="font-mono text-[9px] text-slate-700">{count}</span>
                  </button>
                  <button
                    onClick={() => void clearLogs(item === 'all' ? undefined : { level: item })}
                    disabled={count === 0}
                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-700 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:pointer-events-none group-hover:opacity-100 focus:opacity-100"
                    title={`Clear ${item === 'all' ? 'all retained events' : `${item} events`}`}
                    aria-label={`Clear ${item === 'all' ? 'all retained events' : `${item} events`}`}
                  >
                    <Eraser size={11} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="mt-4">
            <p className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Source</p>
            {(['all', 'desktop', 'backend', 'renderer'] as SourceFilter[]).map((item) => (
              <button key={item} onClick={() => setSource(item)} className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-medium transition ${source === item ? 'bg-white/[0.06] text-slate-100' : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-300'}`}>
                {item === 'desktop' ? <CircleDot size={12} /> : item === 'backend' ? <Server size={12} /> : item === 'renderer' ? <Layers3 size={12} /> : <Activity size={12} />}
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-3">
            <button onClick={() => void exportLogs()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200">
              <Download size={13} /> Export sanitized logs
            </button>
            <button onClick={() => void window.systemLogs?.revealLogs()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200">
              <FolderOpen size={13} /> Reveal log files
            </button>
            <button onClick={() => void clearLogs()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-medium text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300">
              <Eraser size={13} /> Clear history
            </button>
          </div>
        </aside>

        <main className="system-console-main flex min-w-0 flex-1 flex-col bg-[#080b12]">
          <div className="system-console-toolbar flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
            <div className="relative min-w-0 flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search messages, events, phases, IDs…"
                className="h-8 w-full rounded-lg border border-white/[0.065] bg-white/[0.025] pl-9 pr-3 text-[11px] text-slate-200 outline-none placeholder:text-slate-700 focus:border-indigo-500/35 focus:bg-indigo-500/[0.025]"
              />
            </div>
            <div className="relative">
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-8 min-w-36 appearance-none rounded-lg border border-white/[0.065] bg-[#0c111b] pl-3 pr-8 text-[10px] font-semibold text-slate-400 outline-none">
                <option value="all">All categories</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            </div>
            {category !== 'all' && (
              <button
                onClick={() => void clearLogs({ category })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.065] bg-white/[0.025] text-slate-500 transition hover:border-rose-500/25 hover:bg-rose-500/10 hover:text-rose-400"
                title={`Clear all ${category} category events`}
                aria-label={`Clear all ${category} category events`}
              >
                <Eraser size={12} />
              </button>
            )}
            <button onClick={() => paused ? resume() : setPaused(true)} className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-semibold transition ${paused ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'border-white/[0.065] bg-white/[0.025] text-slate-500 hover:text-slate-200'}`}>
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? `Resume${pendingCount ? ` (${pendingCount})` : ''}` : 'Pause'}
            </button>
            {view === 'stream' && (
              <>
                <button
                  onClick={() => void clearLogs({ eventIds: filteredEvents.map((event) => event.id) })}
                  disabled={filteredEvents.length === 0}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.065] bg-white/[0.025] px-3 text-[10px] font-semibold text-slate-500 transition hover:border-rose-500/25 hover:bg-rose-500/10 hover:text-rose-400 disabled:pointer-events-none disabled:opacity-40"
                  title="Clear events currently visible with these filters"
                >
                  <Eraser size={12} /> Clear stream
                </button>
                <button onClick={() => setAutoScroll((value) => !value)} className={`h-8 rounded-lg border px-3 text-[10px] font-semibold transition ${autoScroll ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300' : 'border-white/[0.065] bg-white/[0.025] text-slate-500'}`}>
                  Follow
                </button>
                <button onClick={() => setWrapLines((value) => !value)} className={`h-8 rounded-lg border px-3 text-[10px] font-semibold transition ${wrapLines ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300' : 'border-white/[0.065] bg-white/[0.025] text-slate-500'}`}>
                  Wrap
                </button>
              </>
            )}
          </div>

          {view === 'stream' ? (
            <div className="flex min-h-0 flex-1">
              <div ref={scrollRef} onScroll={(event) => {
                const element = event.currentTarget
                setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
              }} className="min-w-0 flex-1 overflow-auto font-mono">
                {filteredEvents.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-slate-700">
                    <FileSearch size={30} strokeWidth={1.4} />
                    <p className="mt-3 text-xs font-sans font-medium">No events match these filters</p>
                  </div>
                ) : filteredEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className={`grid w-full grid-cols-[88px_68px_86px_minmax(0,1fr)] items-start gap-2 border-b border-white/[0.035] px-4 py-2 text-left text-[10px] leading-5 transition hover:bg-white/[0.025] ${selectedEvent?.id === event.id ? 'bg-indigo-500/[0.06]' : ''}`}
                  >
                    <span className="whitespace-nowrap text-slate-650">{formatTime(event.timestamp)}</span>
                    <span className={`w-fit rounded border px-1.5 py-px font-sans text-[8px] font-bold uppercase tracking-wider ${LEVEL_STYLE[event.level].badge}`}>{event.level}</span>
                    <span className={`w-fit rounded border px-1.5 py-px font-sans text-[8px] font-bold uppercase tracking-wider ${SOURCE_STYLE[event.source]}`}>{event.source}</span>
                    <span className={`min-w-0 ${wrapLines ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                      <span className="mr-2 text-slate-600">[{event.category}]</span>
                      {event.phase && <span className="mr-2 text-indigo-400">{event.phase}</span>}
                      <span className={LEVEL_STYLE[event.level].text}>{event.message}</span>
                    </span>
                  </button>
                ))}
              </div>

              {selectedEvent && (
                <aside className="system-console-detail w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#0a0e17] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Event detail</p>
                      <h3 className="mt-1.5 break-words text-sm font-semibold text-slate-100">{selectedEvent.event}</h3>
                    </div>
                    <button onClick={() => setSelectedEvent(null)} className="rounded-md p-1.5 text-slate-600 hover:bg-white/5 hover:text-slate-300"><X size={14} /></button>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-400">{selectedEvent.message}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {[
                      ['Time', formatTime(selectedEvent.timestamp, true)],
                      ['Level', selectedEvent.level],
                      ['Source', selectedEvent.source],
                      ['Category', selectedEvent.category],
                      ['Operation', selectedEvent.operation || '—'],
                      ['Phase', selectedEvent.phase || '—'],
                      ['Status', selectedEvent.status || '—'],
                      ['Duration', formatDuration(selectedEvent.durationMs)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-white/[0.055] bg-white/[0.02] p-2.5">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-slate-650">{label}</p>
                        <p className="mt-1 break-all text-[10px] text-slate-300">{value}</p>
                      </div>
                    ))}
                  </div>
                  {selectedEvent.correlationId && (
                    <div className="mt-3 rounded-lg border border-indigo-500/15 bg-indigo-500/[0.04] p-3">
                      <p className="text-[8px] font-bold uppercase tracking-wider text-indigo-400/60">Correlation ID</p>
                      <p className="mt-1 break-all font-mono text-[9px] text-indigo-300">{selectedEvent.correlationId}</p>
                    </div>
                  )}
                  {selectedEvent.event === 'provider.usage_settled' && selectedEvent.context && (
                    <div className="mt-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.035] p-3">
                      <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-400/70">Settled provider metrics</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {[
                          ['Tokens', String(selectedEvent.context.totalTokenCount ?? '—')],
                          ['Cost', formatCost(selectedEvent.context.providerCostUsd)],
                          ['Wallet', formatWallet(selectedEvent.context.walletBalance, selectedEvent.context.walletCurrency)],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg border border-white/[0.055] bg-black/15 p-2">
                            <p className="text-[7px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
                            <p className="mt-1 break-all font-mono text-[9px] text-emerald-200">{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[8px] text-slate-600">
                        {String(selectedEvent.context.promptTokenCount ?? 0)} input + {String(selectedEvent.context.completionTokenCount ?? 0)} output
                      </p>
                    </div>
                  )}
                  {selectedEvent.context && (
                    <div className="mt-3">
                      <p className="mb-2 text-[8px] font-bold uppercase tracking-wider text-slate-650">Safe context</p>
                      <pre className="overflow-auto rounded-lg border border-white/[0.055] bg-black/25 p-3 text-[9px] leading-4 text-slate-400">{safeJson(selectedEvent.context)}</pre>
                    </div>
                  )}
                  <button onClick={() => void copyEvent(selectedEvent)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] py-2 text-[10px] font-semibold text-slate-400 transition hover:bg-white/[0.06] hover:text-white">
                    <Copy size={12} /> Copy event JSON
                  </button>
                </aside>
              )}
            </div>
          ) : view === 'runs' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {runs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-slate-700">
                  <Layers3 size={32} strokeWidth={1.4} />
                  <p className="mt-3 text-xs font-medium">Structured runs will appear as operations execute</p>
                </div>
              ) : (
                <div className="mx-auto max-w-5xl space-y-3">
                  {runs.map((run) => {
                    const expanded = expandedRuns.has(run.id)
                    return (
                      <div key={run.id} className="overflow-hidden rounded-xl border border-white/[0.065] bg-white/[0.02]">
                        <button onClick={() => toggleRun(run.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.025]">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${statusColor(run.status)}`}>
                            {run.status === 'completed' ? <Check size={14} /> : run.status === 'failed' ? <XCircle size={14} /> : run.status === 'waiting' ? <Clock3 size={14} /> : <Activity size={14} className="animate-pulse" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold text-slate-200">{run.operation.replaceAll('_', ' ')}</span>
                              <span className={`rounded border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ${SOURCE_STYLE[run.source]}`}>{run.source}</span>
                              <span className={`rounded border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ${statusColor(run.status)}`}>{run.status}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[9px] text-slate-600">
                              <span>{formatTime(run.startedAt, true)}</span>
                              <span>{run.phases.length} phases</span>
                              <span>{run.events.length} events</span>
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-slate-500">{formatDuration(run.durationMs)}</span>
                          {expanded ? <ChevronDown size={14} className="text-slate-600" /> : <ChevronRight size={14} className="text-slate-600" />}
                        </button>
                        {expanded && (
                          <div className="border-t border-white/[0.05] bg-black/10 px-5 py-4">
                            <div className="relative space-y-0">
                              <div className="absolute bottom-3 left-[7px] top-3 w-px bg-white/[0.07]" />
                              {run.phases.map((phase, index) => (
                                <div key={`${phase.name}-${index}`} className="relative flex items-center gap-3 py-2">
                                  <span className={`z-10 h-[15px] w-[15px] rounded-full border-4 border-[#0a0e16] ${phase.status === 'failed' ? 'bg-rose-400' : phase.status === 'completed' ? 'bg-emerald-400' : 'bg-indigo-400'}`} />
                                  <span className="min-w-44 text-[10px] font-semibold text-slate-300">{phase.name.replaceAll('_', ' ')}</span>
                                  {phase.status && <span className={`rounded border px-1.5 py-px text-[8px] font-bold uppercase ${statusColor(phase.status)}`}>{phase.status}</span>}
                                  <span className="ml-auto font-mono text-[9px] text-slate-600">{formatDuration(phase.durationMs)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2 font-mono text-[9px] text-slate-600">
                              run {run.id}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto max-w-6xl space-y-4">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-400/70">Retained performance window</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-100">Pipeline health and provider spend</h2>
                  <p className="mt-1 text-[10px] text-slate-600">Calculated locally from the latest {events.length.toLocaleString()} sanitized structured events.</p>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="Average RAG latency" value={formatDuration(performance.averageRagLatencyMs)} detail={`${performance.ragRuns} runs`} icon={<Timer size={17} />} tone="bg-cyan-500/10 text-cyan-300" />
                  <MetricCard label="RAG failure rate" value={`${performance.ragFailureRate.toFixed(1)}%`} detail={`${performance.ragRuns} runs`} icon={<AlertTriangle size={17} />} tone={performance.ragFailureRate > 5 ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'} />
                  <MetricCard label="Provider cost" value={formatCost(performance.retainedProviderCostUsd)} detail={`${performance.exactBillingCalls} settled`} icon={<DollarSign size={17} />} tone="bg-emerald-500/10 text-emerald-300" />
                  <MetricCard label="Token burn" value={performance.retainedTokenCount.toLocaleString()} detail="settled tokens" icon={<Zap size={17} />} tone="bg-violet-500/10 text-violet-300" />
                </div>

                <div className="grid grid-cols-[1.4fr_0.8fr] gap-4">
                  <section className="rounded-xl border border-white/[0.065] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Daily provider cost</p>
                        <p className="mt-1 text-xs font-semibold text-slate-200">Last seven calendar days</p>
                      </div>
                      <BarChart3 size={17} className="text-indigo-400" />
                    </div>
                    <div className="mt-5 flex h-44 items-end gap-3 border-b border-white/[0.06] px-2">
                      {performance.dailyCosts.map((point) => (
                        <div key={point.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                          <span className="font-mono text-[8px] text-slate-600">{point.cost > 0 ? formatCost(point.cost) : '—'}</span>
                          <div className="flex h-28 w-full items-end rounded-t-md bg-black/15 px-1">
                            <div
                              className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-cyan-400 shadow-[0_0_16px_rgba(99,102,241,0.15)]"
                              style={{ height: `${point.cost > 0 ? Math.max(6, (point.cost / maxDailyCost) * 100) : 2}%` }}
                              title={`${point.calls} settled calls · ${point.tokens.toLocaleString()} tokens`}
                            />
                          </div>
                          <span className="pb-2 text-[8px] font-semibold uppercase text-slate-600">{point.label}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/[0.065] bg-white/[0.02] p-4">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Latency summary</p>
                    <div className="mt-4 space-y-3">
                      {[
                        ['RAG pipeline', formatDuration(performance.averageRagLatencyMs), `${performance.ragRuns} runs`],
                        ['Generation', formatDuration(performance.averageGenerationLatencyMs), `${performance.generationRuns} runs`],
                        ['API request', formatDuration(performance.averageApiLatencyMs), `${performance.apiRequests} requests`],
                      ].map(([label, value, detail]) => (
                        <div key={label} className="rounded-lg border border-white/[0.05] bg-black/15 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[10px] font-semibold text-slate-400">{label}</span>
                            <span className="font-mono text-[10px] text-cyan-300">{value}</span>
                          </div>
                          <p className="mt-1 text-[8px] text-slate-650">{detail}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <section className="rounded-xl border border-white/[0.065] bg-white/[0.02] p-4">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Failure concentration</p>
                    <div className="mt-3 space-y-2">
                      {performance.failuresByOperation.length === 0 ? (
                        <p className="rounded-lg border border-emerald-500/10 bg-emerald-500/[0.025] p-4 text-[10px] text-emerald-400/70">No terminal failures in the retained event window.</p>
                      ) : performance.failuresByOperation.map((item) => (
                        <div key={item.operation} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-black/15 px-3 py-2.5">
                          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">{item.operation.replaceAll('_', ' ')}</span>
                          <span className="rounded-md bg-rose-500/10 px-2 py-1 font-mono text-[9px] text-rose-300">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/[0.065] bg-white/[0.02] p-4">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Billing coverage</p>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/[0.025] p-4">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-500/60">Exact / zero</p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-300">{performance.exactBillingCalls}</p>
                        <p className="mt-1 text-[8px] text-slate-600">settled provider calls</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/10 bg-amber-500/[0.025] p-4">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500/60">Unavailable</p>
                        <p className="mt-2 text-2xl font-semibold text-amber-300">{performance.unavailableBillingCalls}</p>
                        <p className="mt-1 text-[8px] text-slate-600">provider omitted cost</p>
                      </div>
                      <div className="rounded-lg border border-indigo-500/10 bg-indigo-500/[0.025] p-4">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-indigo-500/60">Pending</p>
                        <p className="mt-2 text-2xl font-semibold text-indigo-300">{performance.pendingBillingCalls}</p>
                        <p className="mt-1 text-[8px] text-slate-600">awaiting provider index</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="system-console-footer flex h-7 shrink-0 items-center gap-4 border-t border-white/[0.06] bg-[#090d15] px-4 font-mono text-[8px] uppercase tracking-wider text-slate-700">
        <span>{filteredEvents.length.toLocaleString()} visible</span>
        <span>safe metadata policy</span>
        <span>14-day / 100 MB retention</span>
        <span className="ml-auto flex items-center gap-1.5 text-emerald-500/70"><span className="h-1 w-1 rounded-full bg-emerald-400" /> live IPC</span>
      </footer>

      {toast && (
        <div className="system-console-toast pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-900/95 px-4 py-2 text-[11px] font-semibold text-slate-200 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}
