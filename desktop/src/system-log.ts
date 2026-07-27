import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

export type SystemLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical'
export type SystemLogSource = 'desktop' | 'backend' | 'renderer'
export type SystemLogStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped'

export interface SystemLogEventInput {
  timestamp?: string
  source: SystemLogSource
  level?: SystemLogLevel
  category: string
  event: string
  message: string
  operation?: string
  phase?: string
  status?: SystemLogStatus
  correlationId?: string
  durationMs?: number
  context?: Record<string, unknown>
}

export interface SystemLogEvent extends SystemLogEventInput {
  id: string
  timestamp: string
  sessionId: string
  level: SystemLogLevel
  context?: Record<string, unknown>
}

export interface SystemLogSnapshot {
  sessionId: string
  startedAt: string
  events: SystemLogEvent[]
  totalEvents: number
  truncated: boolean
}

export interface SystemLogClearFilter {
  level?: SystemLogLevel
  source?: SystemLogSource
  category?: string
  eventIds?: string[]
}

type SystemLogListener = (event: SystemLogEvent) => void

const STRUCTURED_LOG_NAME = 'system-events.jsonl'
const ROTATED_LOG_PREFIX = 'system-events-'
const MAX_CURRENT_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const MAX_RETAINED_EVENTS = 500
const DEFAULT_SNAPSHOT_LIMIT = MAX_RETAINED_EVENTS
const MAX_CONTEXT_DEPTH = 5
const MAX_CONTEXT_KEYS = 60
const MAX_ARRAY_ITEMS = 40
const MAX_STRING_LENGTH = 4_000
const SAFE_METRIC_KEYS = new Set([
  'promptTokenCount',
  'completionTokenCount',
  'totalTokenCount',
  'tokenCount',
  'tokensBurned',
])

const SENSITIVE_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|prompt|secret|token|transcript|document[_-]?content|request[_-]?body|response[_-]?body|(?:^|[_-])(?:query|question|answer|context|content|sources?)(?:$|[_-]))/i
const TOKEN_PATTERN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/gi
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi
const URL_SECRET_PATTERN = /([?&](?:api[_-]?key|key|token|secret|password|signature)=)[^&#\s]+/gi
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|authorization|cookie|credential|password|secret|token)\s*[:=]\s*["']?[^\s,"']+/gi
const USER_PATH_PATTERN = /([A-Za-z]:\\Users\\)[^\\\r\n]+/gi

function normalizeLevel(value: unknown): SystemLogLevel {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'warn') return 'warning'
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warning' ||
    normalized === 'error' ||
    normalized === 'critical'
  ) return normalized
  return 'info'
}

export function sanitizeLogText(value: string): string {
  const sanitized = value
    .replace(AUTH_HEADER_PATTERN, '$1 [REDACTED]')
    .replace(TOKEN_PATTERN, '[REDACTED_TOKEN]')
    .replace(URL_SECRET_PATTERN, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1=[REDACTED]')
    .replace(USER_PATH_PATTERN, '$1%USER%')
  return sanitized.length > MAX_STRING_LENGTH
    ? `${sanitized.slice(0, MAX_STRING_LENGTH)}...`
    : sanitized
}

function sanitizeValue(value: unknown, depth = 0, key = ''): unknown {
  if (!SAFE_METRIC_KEYS.has(key) && SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeLogText(value)
  if (depth >= MAX_CONTEXT_DEPTH) return '[TRUNCATED]'
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
  }
  if (value instanceof Error) {
    return {
      name: sanitizeLogText(value.name),
      message: sanitizeLogText(value.message),
      stack: value.stack ? sanitizeLogText(value.stack) : undefined,
    }
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_CONTEXT_KEYS)) {
      output[entryKey] = sanitizeValue(entryValue, depth + 1, entryKey)
    }
    return output
  }
  return sanitizeLogText(String(value))
}

function parseEvent(line: string): SystemLogEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<SystemLogEvent>
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.source !== 'string' ||
      typeof parsed.category !== 'string' ||
      typeof parsed.event !== 'string' ||
      typeof parsed.message !== 'string'
    ) return null
    return {
      ...parsed,
      source: parsed.source as SystemLogSource,
      id: parsed.id,
      timestamp: parsed.timestamp,
      sessionId: parsed.sessionId,
      category: parsed.category,
      event: parsed.event,
      message: parsed.message,
      level: normalizeLevel(parsed.level),
    }
  } catch {
    return null
  }
}

function isBackgroundPollingPath(value: string): boolean {
  const withoutQuery = value.split('?', 1)[0]
  const normalized = withoutQuery.length > 1
    ? withoutQuery.replace(/\/+$/, '')
    : withoutQuery
  return (
    normalized === '/tasks'
    || normalized === '/notifications'
    || normalized === '/queue'
    || normalized.startsWith('/queue/')
  )
}

export function isBackgroundPollingLogEvent(
  event: SystemLogEventInput,
): boolean {
  const contextMethod = String(event.context?.method || '').toUpperCase()
  const contextPath = String(event.context?.path || event.phase || '')
  if (contextMethod === 'GET' && isBackgroundPollingPath(contextPath)) return true

  const requestMatch = event.message.match(/\bGET\s+([^\s"'?]+)/i)
  return Boolean(requestMatch?.[1] && isBackgroundPollingPath(requestMatch[1]))
}

export class SystemLogService {
  readonly sessionId = randomUUID()
  readonly startedAt = new Date().toISOString()
  readonly logDir: string
  readonly currentPath: string
  private readonly listeners = new Set<SystemLogListener>()
  private retainedEvents: SystemLogEvent[] = []

  constructor(dataDir: string) {
    this.logDir = path.join(dataDir, 'logs')
    this.currentPath = path.join(this.logDir, STRUCTURED_LOG_NAME)
    mkdirSync(this.logDir, { recursive: true })
    if (!existsSync(this.currentPath)) writeFileSync(this.currentPath, '', 'utf8')
    this.pruneHistory()
    this.retainedEvents = this.readPersistedEvents()
      .filter((event) => !isBackgroundPollingLogEvent(event))
      .slice(-MAX_RETAINED_EVENTS)
    this.rewriteRetainedEvents()
  }

  emit(input: SystemLogEventInput): SystemLogEvent {
    const context = input.context
      ? sanitizeValue(input.context) as Record<string, unknown>
      : undefined
    const event: SystemLogEvent = {
      id: randomUUID(),
      timestamp: input.timestamp && !Number.isNaN(Date.parse(input.timestamp))
        ? input.timestamp
        : new Date().toISOString(),
      sessionId: this.sessionId,
      source: input.source,
      level: normalizeLevel(input.level),
      category: sanitizeLogText(input.category || 'SYSTEM').toUpperCase(),
      event: sanitizeLogText(input.event || 'runtime.event'),
      message: sanitizeLogText(input.message || 'Event recorded'),
      operation: input.operation ? sanitizeLogText(input.operation) : undefined,
      phase: input.phase ? sanitizeLogText(input.phase) : undefined,
      status: input.status,
      correlationId: input.correlationId ? sanitizeLogText(input.correlationId) : undefined,
      durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Number(input.durationMs)) : undefined,
      context: context && Object.keys(context).length > 0 ? context : undefined,
    }

    this.retainedEvents.push(event)
    const exceededLimit = this.retainedEvents.length > MAX_RETAINED_EVENTS
    if (exceededLimit) this.retainedEvents.shift()

    try {
      if (exceededLimit) {
        this.rewriteRetainedEvents()
      } else {
        this.rotateIfNeeded()
        appendFileSync(this.currentPath, `${JSON.stringify(event)}\n`, 'utf8')
      }
    } catch {
      // Disk diagnostics must never disrupt the application.
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Diagnostics must never disrupt the application.
      }
    }
    return event
  }

  subscribe(listener: SystemLogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(limit = DEFAULT_SNAPSHOT_LIMIT): SystemLogSnapshot {
    const safeLimit = Math.min(MAX_RETAINED_EVENTS, Math.max(1, Math.floor(limit)))
    const events = this.readAllEvents()
    const selected = events.slice(-safeLimit)
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      events: selected,
      totalEvents: events.length,
      truncated: selected.length < events.length,
    }
  }

  exportTo(targetPath: string): number {
    const events = this.readAllEvents()
    writeFileSync(
      targetPath,
      events.map((event) => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : ''),
      'utf8',
    )
    return events.length
  }

  countMatching(filter?: SystemLogClearFilter): number {
    const eventIds = filter?.eventIds ? new Set(filter.eventIds) : undefined
    return this.readAllEvents().filter((event) => this.matchesClearFilter(event, filter, eventIds)).length
  }

  clear(filter?: SystemLogClearFilter): number {
    const events = this.readAllEvents()
    const eventIds = filter?.eventIds ? new Set(filter.eventIds) : undefined
    const remainingEvents = events.filter((event) => !this.matchesClearFilter(event, filter, eventIds))
    const deletedCount = events.length - remainingEvents.length
    if (deletedCount === 0) return 0

    this.retainedEvents = remainingEvents.slice(-MAX_RETAINED_EVENTS)
    this.rewriteRetainedEvents()
    this.emit({
      source: 'desktop',
      level: 'info',
      category: 'SYSTEM',
      event: 'diagnostics.history_cleared',
      message: filter ? 'Matching diagnostic history was cleared.' : 'Diagnostic history was cleared.',
      status: 'completed',
      context: {
        deletedCount,
        ...(filter?.level ? { clearLevel: filter.level } : {}),
        ...(filter?.source ? { clearSource: filter.source } : {}),
        ...(filter?.category ? { clearCategory: filter.category } : {}),
        ...(filter?.eventIds ? { clearSelection: 'visible_events' } : {}),
      },
    })
    return deletedCount
  }

  private matchesClearFilter(
    event: SystemLogEvent,
    filter?: SystemLogClearFilter,
    eventIds?: ReadonlySet<string>,
  ): boolean {
    if (!filter) return true
    if (filter.level && event.level !== filter.level) return false
    if (filter.source && event.source !== filter.source) return false
    if (filter.category && event.category !== filter.category) return false
    if (eventIds && !eventIds.has(event.id)) return false
    return true
  }

  private readAllEvents(): SystemLogEvent[] {
    return [...this.retainedEvents]
  }

  private readPersistedEvents(): SystemLogEvent[] {
    const events: SystemLogEvent[] = []
    const files = this.historyFiles()
      .map((filePath) => ({ filePath, modified: statSync(filePath).mtimeMs }))
      .sort((a, b) => a.modified - b.modified)
    for (const { filePath } of files) {
      let content = ''
      try {
        content = readFileSync(filePath, 'utf8')
      } catch {
        continue
      }
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue
        const event = parseEvent(line)
        if (event) events.push(event)
      }
    }
    return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }

  private rewriteRetainedEvents(): void {
    for (const filePath of this.historyFiles()) {
      if (filePath === this.currentPath) continue
      try {
        unlinkSync(filePath)
      } catch {
        // A locked rotated file can be retried on the next compaction.
      }
    }
    try {
      const content = this.retainedEvents
        .map((event) => JSON.stringify(event))
        .join('\n')
      writeFileSync(this.currentPath, content ? `${content}\n` : '', 'utf8')
    } catch {
      // Disk diagnostics must never disrupt the application.
    }
  }

  private historyFiles(): string[] {
    if (!existsSync(this.logDir)) return []
    return readdirSync(this.logDir)
      .filter((name) => name === STRUCTURED_LOG_NAME || (name.startsWith(ROTATED_LOG_PREFIX) && name.endsWith('.jsonl')))
      .map((name) => path.join(this.logDir, name))
      .filter((filePath) => existsSync(filePath))
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.currentPath)) {
      writeFileSync(this.currentPath, '', 'utf8')
      return
    }
    try {
      if (statSync(this.currentPath).size < MAX_CURRENT_FILE_BYTES) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(this.currentPath, path.join(this.logDir, `${ROTATED_LOG_PREFIX}${stamp}.jsonl`))
      writeFileSync(this.currentPath, '', 'utf8')
      this.pruneHistory()
    } catch {
      // Continue using the current file if rotation is temporarily blocked.
    }
  }

  private pruneHistory(): void {
    const now = Date.now()
    let files = this.historyFiles()
      .map((filePath) => ({ filePath, stat: statSync(filePath) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)

    for (const entry of files) {
      if (entry.filePath === this.currentPath || now - entry.stat.mtimeMs <= MAX_RETENTION_MS) continue
      try {
        unlinkSync(entry.filePath)
      } catch {
        // Ignore locked history and try again next startup/rotation.
      }
    }

    files = this.historyFiles()
      .map((filePath) => ({ filePath, stat: statSync(filePath) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    let totalBytes = files.reduce((sum, entry) => sum + entry.stat.size, 0)
    for (const entry of files) {
      if (totalBytes <= MAX_TOTAL_BYTES) break
      if (entry.filePath === this.currentPath) continue
      try {
        unlinkSync(entry.filePath)
        totalBytes -= entry.stat.size
      } catch {
        // Ignore locked history.
      }
    }
  }
}

export function normalizeExternalLogEvent(value: unknown): SystemLogEventInput | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const source = candidate.source
  if (source !== 'backend' && source !== 'renderer' && source !== 'desktop') return null
  if (
    typeof candidate.category !== 'string' ||
    typeof candidate.event !== 'string' ||
    typeof candidate.message !== 'string'
  ) return null

  const status = candidate.status
  const validStatus = (
    status === 'starting' ||
    status === 'running' ||
    status === 'waiting' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'stopped'
  ) ? status : undefined

  return {
    timestamp: typeof candidate.timestamp === 'string' ? candidate.timestamp : undefined,
    source,
    level: normalizeLevel(candidate.level),
    category: candidate.category,
    event: candidate.event,
    message: candidate.message,
    operation: typeof candidate.operation === 'string' ? candidate.operation : undefined,
    phase: typeof candidate.phase === 'string' ? candidate.phase : undefined,
    status: validStatus,
    correlationId: typeof candidate.correlationId === 'string' ? candidate.correlationId : undefined,
    durationMs: typeof candidate.durationMs === 'number' ? candidate.durationMs : undefined,
    context: candidate.context && typeof candidate.context === 'object' && !Array.isArray(candidate.context)
      ? candidate.context as Record<string, unknown>
      : undefined,
  }
}
