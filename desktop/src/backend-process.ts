import { ChildProcessByStdio, execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { app } from 'electron'
import {
  normalizeExternalLogEvent,
  sanitizeLogText,
  type SystemLogEventInput,
} from './system-log'

export type BackendState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
type BackendChild = ChildProcessByStdio<null, Readable, Readable>

export interface BackendRuntime {
  origin: string
  token: string
  process: BackendChild
  logPath: string
}

export interface BackendStartOptions {
  dataDir: string
  token: string
  onState: (state: BackendState, detail?: string) => void
  onLogEvent?: (event: SystemLogEventInput) => void
}

const STRUCTURED_EVENT_PREFIX = 'MYAI_EVENT '
const RAW_LOG_MAX_BYTES = 20 * 1024 * 1024
const RAW_LOG_GENERATIONS = 5
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

function rotateRawBackendLog(logPath: string): void {
  if (!existsSync(logPath)) return
  try {
    if (statSync(logPath).size < RAW_LOG_MAX_BYTES) return
    const oldestPath = `${logPath}.${RAW_LOG_GENERATIONS}`
    if (existsSync(oldestPath)) unlinkSync(oldestPath)
    for (let index = RAW_LOG_GENERATIONS - 1; index >= 1; index -= 1) {
      const source = `${logPath}.${index}`
      const destination = `${logPath}.${index + 1}`
      if (existsSync(source)) renameSync(source, destination)
    }
    renameSync(logPath, `${logPath}.1`)
  } catch {
    // If a file is locked, preserve it and continue app startup.
  }
}

function humanLogLine(event: SystemLogEventInput): string {
  const timestamp = event.timestamp && !Number.isNaN(Date.parse(event.timestamp))
    ? new Date(event.timestamp).toLocaleTimeString('en-GB', { hour12: false })
    : new Date().toLocaleTimeString('en-GB', { hour12: false })
  const level = (event.level ?? 'info').toUpperCase().padEnd(8)
  const phase = event.phase ? ` [${event.phase}]` : ''
  return `${timestamp} ${level} [${sanitizeLogText(event.category)}]${sanitizeLogText(phase)} ${sanitizeLogText(event.message)}`
}

export function normalizeBackendLine(
  line: string,
  stream: 'stdout' | 'stderr',
  inheritedLevel?: 'warning',
): SystemLogEventInput | null {
  const clean = line.replace(ANSI_ESCAPE_PATTERN, '').trim()
  if (!clean) return null
  if (clean.startsWith(STRUCTURED_EVENT_PREFIX)) {
    try {
      return normalizeExternalLogEvent(JSON.parse(clean.slice(STRUCTURED_EVENT_PREFIX.length)))
    } catch {
      // Fall through and retain malformed structured output as a raw diagnostic.
    }
  }

  const lower = clean.toLowerCase()
  const explicitLevel = clean.match(/^(debug|info|warn|warning|error|critical|fatal)\s*:/i)?.[1]?.toLowerCase()
  const containsWarning = /\b(?:deprecation|future|runtime|syntax|user|import|resource)?warning\b/.test(lower)
  const containsFailure = /\b(error|exception|traceback|failed)\b/.test(lower)
  const level = explicitLevel === 'critical' || explicitLevel === 'fatal'
    ? 'critical'
    : explicitLevel === 'error'
      ? 'error'
      : explicitLevel === 'warn' || explicitLevel === 'warning'
        ? 'warning'
        : explicitLevel === 'debug'
          ? 'debug'
          : explicitLevel === 'info'
            ? 'info'
            : containsWarning
              ? 'warning'
              : containsFailure
              ? 'error'
              : inheritedLevel
                ? inheritedLevel
                : stream === 'stderr'
                  ? 'error'
                  : 'info'
  return {
    source: 'backend',
    level,
    category: clean.startsWith('INFO:') ? 'SERVER' : 'BACKEND',
    event: stream === 'stderr' ? 'backend.stderr' : 'backend.stdout',
    message: clean,
  }
}

function attachBackendLogStream(
  stream: Readable,
  streamName: 'stdout' | 'stderr',
  logPath: string,
  onLogEvent?: (event: SystemLogEventInput) => void,
): void {
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  let inheritWarningForNextLine = false
  reader.on('line', (line) => {
    const event = normalizeBackendLine(
      line,
      streamName,
      inheritWarningForNextLine ? 'warning' : undefined,
    )
    if (!event) return
    inheritWarningForNextLine = (
      streamName === 'stderr'
      && event.level === 'warning'
      && /\b(?:deprecation|future|runtime|syntax|user|import|resource)?warning\s*:/i.test(event.message)
    )
    try {
      appendFileSync(
        logPath,
        `${humanLogLine(event)}\n`,
        'utf8',
      )
    } catch {
      // Logging must never terminate the managed backend.
    }
    onLogEvent?.(event)
  })
}

function reservePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

function runWindowsCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

async function findListeningPids(port: number): Promise<number[]> {
  if (process.platform !== 'win32') return []

  try {
    const { stdout } = await runWindowsCommand('netstat.exe', ['-ano', '-p', 'tcp'])
    const pids = new Set<number>()

    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const columns = line.trim().split(/\s+/)
      if (columns.length < 5) continue

      const localAddress = columns[1] ?? ''
      const pid = Number(columns[4])
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue

      if (
        localAddress === `127.0.0.1:${port}` ||
        localAddress === `0.0.0.0:${port}` ||
        localAddress === `[::]:${port}` ||
        localAddress.endsWith(`:${port}`)
      ) {
        pids.add(pid)
      }
    }

    return [...pids]
  } catch {
    return []
  }
}

async function stopWindowsProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32' || pid <= 0 || pid === process.pid) return

  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timer = setTimeout(resolve, 5_000)
    killer.once('error', () => {
      clearTimeout(timer)
      resolve()
    })
    killer.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function stopPackagedBackendOrphans(): Promise<void> {
  if (process.platform !== 'win32') return

  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/IM', 'myailibrary-backend.exe', '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timer = setTimeout(resolve, 5_000)
    killer.once('error', () => {
      clearTimeout(timer)
      resolve()
    })
    killer.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function cleanupStaleBackendBeforeStart(): Promise<void> {
  if (process.platform !== 'win32') return

  if (app.isPackaged) {
    await stopPackagedBackendOrphans()
    return
  }

  for (const pid of await findListeningPids(8000)) {
    await stopWindowsProcessTree(pid)
  }
}

async function waitForHealth(origin: string, token: string, child: BackendChild): Promise<void> {
  const deadline = Date.now() + 120_000
  let lastError = 'Backend did not answer its health check.'

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}.`)
    }
    try {
      const response = await fetch(`${origin}/desktop/health`, {
        headers: { 'x-myailibrary-desktop-token': token },
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
      lastError = `Health check returned HTTP ${response.status}.`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(lastError)
}

export async function startBackend(options: BackendStartOptions): Promise<BackendRuntime> {
  options.onState('starting', 'Starting local AI service...')
  mkdirSync(options.dataDir, { recursive: true })
  const logDir = path.join(options.dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'backend.log')
  rotateRawBackendLog(logPath)
  if (!existsSync(logPath)) writeFileSync(logPath, '', 'utf8')
  await cleanupStaleBackendBeforeStart()
  const port = await reservePort(app.isPackaged ? undefined : 8000)
  const origin = `http://127.0.0.1:${port}`

  const uiDir = app.isPackaged ? path.join(process.resourcesPath, 'ui') : ''
  const ffmpegDir = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg') : ''
  let executable: string
  let args: string[]
  let cwd: string

  if (app.isPackaged) {
    executable = path.join(process.resourcesPath, 'backend', 'myailibrary-backend.exe')
    args = []
    cwd = options.dataDir
  } else {
    const projectRoot = path.resolve(__dirname, '..', '..')
    executable = path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
    args = [path.join(projectRoot, 'backend', 'desktop_entry.py')]
    cwd = path.join(projectRoot, 'backend')
  }

  if (!existsSync(executable)) {
    throw new Error(`Backend executable was not found: ${executable}`)
  }

  args.push(
    '--port', String(port),
    `--token=${options.token}`,
    '--data-dir', options.dataDir,
  )
  if (uiDir) args.push('--ui-dir', uiDir)
  if (ffmpegDir && existsSync(ffmpegDir)) args.push('--ffmpeg-dir', ffmpegDir)

  const child = spawn(executable, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  attachBackendLogStream(child.stdout, 'stdout', logPath, options.onLogEvent)
  attachBackendLogStream(child.stderr, 'stderr', logPath, options.onLogEvent)
  options.onLogEvent?.({
    source: 'desktop',
    level: 'info',
    category: 'BACKEND',
    event: 'backend.process_spawned',
    message: 'Local AI service process was started.',
    operation: 'application_boot',
    phase: 'backend_spawn',
    status: 'starting',
    context: { packaged: app.isPackaged, port },
  })
  child.once('exit', (code, signal) => {
    const line = `[desktop] backend exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
    try {
      appendFileSync(logPath, `\n${line}\n`, 'utf8')
    } catch {
      // Ignore log-file failures while reporting process exit.
    }
    options.onLogEvent?.({
      source: 'desktop',
      level: code === 0 ? 'info' : 'error',
      category: 'BACKEND',
      event: 'backend.process_exited',
      message: code === 0
        ? 'Local AI service process stopped.'
        : 'Local AI service process exited unexpectedly.',
      operation: 'backend_runtime',
      phase: 'process',
      status: code === 0 ? 'stopped' : 'failed',
      context: { code, signal },
    })
  })

  try {
    await waitForHealth(origin, options.token, child)
    options.onState('ready', 'Local AI service is ready.')
    return { origin, token: options.token, process: child, logPath }
  } catch (error) {
    options.onState('failed', error instanceof Error ? error.message : String(error))
    if (child.exitCode === null) child.kill()
    throw error
  }
}

export async function stopBackend(runtime: BackendRuntime | null, onState: BackendStartOptions['onState']): Promise<void> {
  if (!runtime || runtime.process.exitCode !== null) return
  onState('stopping', 'Stopping local AI service...')
  try {
    await fetch(`${runtime.origin}/desktop/shutdown`, {
      method: 'POST',
      headers: { 'x-myailibrary-desktop-token': runtime.token },
      signal: AbortSignal.timeout(2_000),
    })
  } catch {
    // The fallback below handles an unresponsive backend.
  }

  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 4_000)
    runtime.process.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

  if (!exited && runtime.process.exitCode === null) {
    if (process.platform === 'win32' && runtime.process.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill.exe', ['/PID', String(runtime.process.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        const timer = setTimeout(resolve, 5_000)
        killer.once('error', () => {
          clearTimeout(timer)
          resolve()
        })
        killer.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    } else {
      runtime.process.kill('SIGKILL')
    }
  }
  onState('stopped', 'Local AI service stopped.')
}
