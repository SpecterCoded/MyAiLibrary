import { captureOwnerStack } from 'react'

type RendererLogInput = Omit<SystemLogEventInput, 'source'>

let diagnosticsInstalled = false

export function logRendererEvent(input: RendererLogInput): void {
  window.desktop?.logSystemEvent({
    ...input,
    source: 'renderer',
  })
}

export function installRendererDiagnostics(): () => void {
  if (diagnosticsInstalled) return () => undefined
  diagnosticsInstalled = true

  logRendererEvent({
    level: 'info',
    category: 'RENDERER',
    event: 'renderer.initialized',
    message: 'Application renderer initialized.',
    operation: 'application_boot',
    phase: 'renderer',
    status: 'completed',
  })

  const handleError = (event: ErrorEvent) => {
    logRendererEvent({
      level: 'error',
      category: 'RENDERER',
      event: 'renderer.uncaught_error',
      message: event.message || 'An uncaught renderer error occurred.',
      status: 'failed',
      context: {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error instanceof Error
          ? { name: event.error.name, message: event.error.message, stack: event.error.stack }
          : undefined,
      },
    })
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    logRendererEvent({
      level: 'error',
      category: 'RENDERER',
      event: 'renderer.unhandled_rejection',
      message: reason instanceof Error
        ? reason.message
        : 'An unhandled renderer promise rejection occurred.',
      status: 'failed',
      context: {
        reason: reason instanceof Error
          ? { name: reason.name, message: reason.message, stack: reason.stack }
          : String(reason),
      },
    })
  }

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = performance.now()
    const rawUrl = input instanceof Request ? input.url : String(input)
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let path = 'request'
    try {
      path = new URL(rawUrl, window.location.origin).pathname
    } catch {
      // Retain the generic path when URL parsing fails.
    }
    try {
      const response = await originalFetch(input, init)
      const durationMs = Math.round(performance.now() - started)
      if (!response.ok || durationMs >= 5_000) {
        logRendererEvent({
          level: response.status >= 500 ? 'error' : response.ok ? 'warning' : 'warning',
          category: 'NETWORK',
          event: response.ok ? 'renderer.request_slow' : 'renderer.request_failed',
          message: response.ok
            ? `${method} ${path} completed slowly.`
            : `${method} ${path} returned HTTP ${response.status}.`,
          operation: 'api_request',
          phase: path,
          status: response.ok ? 'completed' : 'failed',
          durationMs,
          context: { method, path, statusCode: response.status },
        })
      }
      return response
    } catch (error) {
      logRendererEvent({
        level: 'error',
        category: 'NETWORK',
        event: 'renderer.request_exception',
        message: `${method} ${path} could not be completed.`,
        operation: 'api_request',
        phase: path,
        status: 'failed',
        durationMs: Math.round(performance.now() - started),
        context: {
          method,
          path,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      })
      throw error
    }
  }

  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  const reactWarningPattern = /(?:encountered two children with the same key|each child in a list should have a unique ["']key["'] prop)/i
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    logRendererEvent({
      level: 'warning',
      category: 'RENDERER',
      event: 'renderer.console_warning',
      message: typeof args[0] === 'string' ? args[0] : 'Renderer console warning.',
      context: { argumentTypes: args.map((value) => value instanceof Error ? value.name : typeof value) },
    })
  }
  console.error = (...args: unknown[]) => {
    originalError(...args)
    const message = typeof args[0] === 'string' ? args[0] : 'Renderer console error.'
    const isReactWarning = reactWarningPattern.test(message)
    const candidateKey = args[1]
    const ownerStack = isReactWarning ? captureOwnerStack() : null
    const candidateKeyText = (
      typeof candidateKey === 'string' || typeof candidateKey === 'number'
    ) ? String(candidateKey) : undefined
    const safeReactKey = (
      isReactWarning
      && candidateKeyText !== undefined
      && (candidateKeyText === '' || /^[A-Za-z0-9_.$:@/-]{1,160}$/.test(candidateKeyText))
    ) ? candidateKeyText || '[EMPTY]' : undefined
    logRendererEvent({
      level: isReactWarning ? 'warning' : 'error',
      category: 'RENDERER',
      event: isReactWarning ? 'renderer.react_warning' : 'renderer.console_error',
      message,
      status: isReactWarning ? undefined : 'failed',
      context: {
        argumentTypes: args.map((value) => value instanceof Error ? value.name : typeof value),
        ...(safeReactKey !== undefined ? { reactKey: safeReactKey } : {}),
        ...(ownerStack ? { reactOwnerStack: ownerStack } : {}),
      },
    })
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)
  return () => {
    diagnosticsInstalled = false
    window.fetch = originalFetch
    console.warn = originalWarn
    console.error = originalError
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}
