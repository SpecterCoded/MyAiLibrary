const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  isBackgroundPollingLogEvent,
  SystemLogService,
  normalizeExternalLogEvent,
} = require('../dist/system-log.js')
const { normalizeBackendLine } = require('../dist/backend-process.js')

test('SystemLogService persists sanitized events and supports export and clear', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'myailibrary-system-log-'))
  try {
    const service = new SystemLogService(temporaryRoot)
    const event = service.emit({
      source: 'backend',
      level: 'error',
      category: 'knowledge',
      event: 'knowledge.failed',
      message: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 api_key=plain-secret',
      operation: 'knowledge_generation',
      phase: 'concept_extraction',
      status: 'failed',
      correlationId: 'job-1',
      context: {
        apiKey: 'must-not-be-written',
        totalTokenCount: 150,
        providerCostUsd: 0.0042,
        file: 'C:\\Users\\Sensitive Name\\Documents\\sample.pdf',
        nested: { password: 'must-not-be-written' },
      },
    })

    assert.equal(event.category, 'KNOWLEDGE')
    assert.equal(event.context.apiKey, '[REDACTED]')
    assert.equal(event.context.totalTokenCount, 150)
    assert.equal(event.context.providerCostUsd, 0.0042)
    assert.equal(event.context.nested.password, '[REDACTED]')
    assert.match(event.context.file, /%USER%/)
    assert.doesNotMatch(event.message, /abcdefghijklmnopqrstuvwxyz123456/)
    assert.doesNotMatch(event.message, /plain-secret/)

    const snapshot = service.snapshot()
    assert.equal(snapshot.events.length, 1)
    assert.equal(snapshot.events[0].correlationId, 'job-1')

    const exportPath = path.join(temporaryRoot, 'export.jsonl')
    assert.equal(service.exportTo(exportPath), 1)
    const exported = readFileSync(exportPath, 'utf8')
    assert.doesNotMatch(exported, /must-not-be-written/)
    assert.match(exported, /knowledge\.failed/)

    assert.equal(service.clear(), 1)
    const cleared = service.snapshot()
    assert.equal(cleared.events.length, 1)
    assert.equal(cleared.events[0].event, 'diagnostics.history_cleared')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('SystemLogService clears only matching retained events', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'myailibrary-system-log-filtered-'))
  try {
    const service = new SystemLogService(temporaryRoot)
    service.emit({
      source: 'backend',
      level: 'error',
      category: 'QUEUE',
      event: 'queue.failed',
      message: 'Queue failed.',
    })
    service.emit({
      source: 'renderer',
      level: 'error',
      category: 'RENDERER',
      event: 'renderer.failed',
      message: 'Renderer failed.',
    })
    service.emit({
      source: 'backend',
      level: 'info',
      category: 'QUEUE',
      event: 'queue.completed',
      message: 'Queue completed.',
    })

    assert.equal(service.countMatching({ level: 'error', source: 'backend' }), 1)
    assert.equal(service.clear({ level: 'error', source: 'backend' }), 1)

    const snapshot = service.snapshot()
    assert.equal(snapshot.events.some((event) => event.event === 'queue.failed'), false)
    assert.equal(snapshot.events.some((event) => event.event === 'renderer.failed'), true)
    assert.equal(snapshot.events.some((event) => event.event === 'queue.completed'), true)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('SystemLogService retains only the newest 500 events in memory and on disk', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'myailibrary-system-log-cap-'))
  try {
    const service = new SystemLogService(temporaryRoot)
    for (let index = 0; index < 510; index += 1) {
      service.emit({
        source: 'backend',
        level: 'info',
        category: 'TEST',
        event: `test.event.${index}`,
        message: `Event ${index}`,
      })
    }

    const snapshot = service.snapshot()
    assert.equal(snapshot.events.length, 500)
    assert.equal(snapshot.totalEvents, 500)
    assert.equal(snapshot.events[0].event, 'test.event.10')
    assert.equal(snapshot.events[499].event, 'test.event.509')

    const persistedLines = readFileSync(service.currentPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
    assert.equal(persistedLines.length, 500)
    assert.equal(JSON.parse(persistedLines[0]).event, 'test.event.10')
    assert.equal(JSON.parse(persistedLines[499]).event, 'test.event.509')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('background GET polling is excluded without hiding real actions', () => {
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'api.request_completed',
    message: 'GET /queue completed with HTTP 200.',
    phase: '/queue',
    context: { method: 'GET', path: '/queue' },
  }), true)
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'api.request_started',
    message: 'GET /queue/resource-1 started.',
    context: { method: 'GET', path: '/queue/resource-1' },
  }), true)
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'backend.stderr',
    message: 'INFO: 127.0.0.1 - "GET /notifications?tab=Inbox HTTP/1.1" 200 OK',
  }), true)
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'api.request_completed',
    message: 'GET /tasks completed with HTTP 200.',
    context: { method: 'GET', path: '/tasks' },
  }), true)
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'api.request_completed',
    message: 'POST /queue/clear completed with HTTP 200.',
    context: { method: 'POST', path: '/queue/clear' },
  }), false)
  assert.equal(isBackgroundPollingLogEvent({
    source: 'backend',
    category: 'SYSTEM',
    event: 'api.request_completed',
    message: 'GET /resources completed with HTTP 200.',
    context: { method: 'GET', path: '/resources' },
  }), false)
})

test('backend text severity wins over the stderr transport', () => {
  const startup = normalizeBackendLine('INFO:     Application startup complete.', 'stderr')
  assert.ok(startup)
  assert.equal(startup.level, 'info')
  assert.equal(startup.event, 'backend.stderr')

  const warning = normalizeBackendLine('WARNING:  Development configuration is active.', 'stderr')
  assert.ok(warning)
  assert.equal(warning.level, 'warning')

  const deprecation = normalizeBackendLine(
    'C:\\app\\main.py:42: DeprecationWarning: datetime.datetime.utcnow() is deprecated',
    'stderr',
  )
  assert.ok(deprecation)
  assert.equal(deprecation.level, 'warning')

  const warningSource = normalizeBackendLine('now = datetime.utcnow()', 'stderr', 'warning')
  assert.ok(warningSource)
  assert.equal(warningSource.level, 'warning')

  const failure = normalizeBackendLine('ERROR:    Application startup failed.', 'stderr')
  assert.ok(failure)
  assert.equal(failure.level, 'error')

  const unstructuredStderr = normalizeBackendLine('subprocess exited unexpectedly', 'stderr')
  assert.ok(unstructuredStderr)
  assert.equal(unstructuredStderr.level, 'error')
})

test('normalizeExternalLogEvent accepts only the structured event schema', () => {
  assert.equal(normalizeExternalLogEvent(null), null)
  assert.equal(normalizeExternalLogEvent({ source: 'backend' }), null)

  const event = normalizeExternalLogEvent({
    source: 'backend',
    level: 'warn',
    category: 'QUEUE',
    event: 'queue.started',
    message: 'Queue worker started.',
    status: 'running',
    durationMs: 12,
  })
  assert.ok(event)
  assert.equal(event.level, 'warning')
  assert.equal(event.status, 'running')
  assert.equal(event.durationMs, 12)
})
