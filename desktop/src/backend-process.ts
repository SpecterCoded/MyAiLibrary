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

export interface WindowsProcessInfo {
  processId: number
  parentProcessId: number
  executablePath: string
  commandLine: string
}

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
const backendStopOperations = new WeakMap<BackendChild, Promise<void>>()

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

function normalizedWindowsText(value: string): string {
  return value.replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase('en-US')
}

function commandLinePathArgument(commandLine: string, argumentName: string): string | null {
  const normalized = normalizedWindowsText(commandLine)
  const marker = `${argumentName.toLocaleLowerCase('en-US')} `
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return null
  const valueStart = markerIndex + marker.length
  if (normalized[valueStart] === '"') {
    const valueEnd = normalized.indexOf('"', valueStart + 1)
    return valueEnd < 0 ? null : normalized.slice(valueStart + 1, valueEnd)
  }
  return normalized.slice(valueStart).split(/\s/, 1)[0] ?? null
}

export function isOwnedBackendProcess(
  processInfo: WindowsProcessInfo,
  expectedExecutable: string,
  expectedDataDir: string,
  developmentEntryPath?: string,
): boolean {
  if (!Number.isFinite(processInfo.processId) || processInfo.processId <= 0 || processInfo.processId === process.pid) {
    return false
  }

  const dataDir = normalizedWindowsText(expectedDataDir)
  const commandLine = normalizedWindowsText(processInfo.commandLine)
  if (!commandLine || commandLinePathArgument(processInfo.commandLine, '--data-dir') !== dataDir) return false

  if (developmentEntryPath) {
    return commandLine.includes(normalizedWindowsText(developmentEntryPath))
  }

  const executable = normalizedWindowsText(expectedExecutable)
  const actualExecutable = normalizedWindowsText(processInfo.executablePath)
  return actualExecutable === executable
}

export function rootOwnedProcessIds(processes: WindowsProcessInfo[]): number[] {
  const ownedIds = new Set(processes.map((item) => item.processId))
  return processes
    .filter((item) => !ownedIds.has(item.parentProcessId))
    .map((item) => item.processId)
}

async function listWindowsBackendCandidates(development: boolean): Promise<WindowsProcessInfo[]> {
  if (process.platform !== 'win32') return []
  const processFilter = development
    ? "Name = 'python.exe' OR Name = 'pythonw.exe'"
    : "Name = 'myailibrary-backend.exe'"
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$items = @(Get-CimInstance Win32_Process -Filter "${processFilter}" | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)`,
    '$items | ConvertTo-Json -Compress',
  ].join('; ')
  try {
    const { stdout } = await runWindowsCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ])
    const parsed = JSON.parse(stdout || '[]') as unknown
    const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    return items.flatMap((item): WindowsProcessInfo[] => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      const processId = Number(candidate.ProcessId)
      const parentProcessId = Number(candidate.ParentProcessId)
      if (!Number.isFinite(processId) || !Number.isFinite(parentProcessId)) return []
      return [{
        processId,
        parentProcessId,
        executablePath: typeof candidate.ExecutablePath === 'string' ? candidate.ExecutablePath : '',
        commandLine: typeof candidate.CommandLine === 'string' ? candidate.CommandLine : '',
      }]
    })
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

async function cleanupStaleBackendBeforeStart(
  expectedExecutable: string,
  expectedDataDir: string,
  developmentEntryPath?: string,
): Promise<void> {
  if (process.platform !== 'win32') return

  const allProcesses = await listWindowsBackendCandidates(Boolean(developmentEntryPath))
  const ownedProcesses = allProcesses.filter((item) => isOwnedBackendProcess(
    item,
    expectedExecutable,
    expectedDataDir,
    developmentEntryPath,
  ))
  for (const pid of rootOwnedProcessIds(ownedProcesses)) {
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
  const uiDir = app.isPackaged ? path.join(process.resourcesPath, 'ui') : ''
  const ffmpegDir = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg') : ''
  let executable: string
  let args: string[]
  let cwd: string
  let developmentEntryPath: string | undefined

  if (app.isPackaged) {
    executable = path.join(process.resourcesPath, 'backend', 'myailibrary-backend.exe')
    args = []
    cwd = options.dataDir
  } else {
    const projectRoot = path.resolve(__dirname, '..', '..')
    executable = path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
    developmentEntryPath = path.join(projectRoot, 'backend', 'desktop_entry.py')
    args = [developmentEntryPath]
    cwd = path.join(projectRoot, 'backend')
  }

  if (!existsSync(executable)) {
    throw new Error(`Backend executable was not found: ${executable}`)
  }

  await cleanupStaleBackendBeforeStart(executable, options.dataDir, developmentEntryPath)
  const port = await reservePort(app.isPackaged ? undefined : 8000)
  const origin = `http://127.0.0.1:${port}`

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
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') await stopWindowsProcessTree(child.pid)
      else child.kill('SIGKILL')
    }
    throw error
  }
}

async function waitForBackendExit(processToWaitFor: BackendChild, timeoutMs: number): Promise<boolean> {
  if (processToWaitFor.exitCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      processToWaitFor.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    processToWaitFor.once('exit', onExit)
  })
}

async function stopBackendOnce(runtime: BackendRuntime, onState: BackendStartOptions['onState']): Promise<void> {
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

  const exited = await waitForBackendExit(runtime.process, 4_000)

  if (!exited && runtime.process.exitCode === null) {
    if (process.platform === 'win32' && runtime.process.pid) {
      await stopWindowsProcessTree(runtime.process.pid)
    } else {
      runtime.process.kill('SIGKILL')
    }
    await waitForBackendExit(runtime.process, 2_000)
  }
  onState('stopped', 'Local AI service stopped.')
}

export async function stopBackend(runtime: BackendRuntime | null, onState: BackendStartOptions['onState']): Promise<void> {
  if (!runtime || runtime.process.exitCode !== null) return
  const existingOperation = backendStopOperations.get(runtime.process)
  if (existingOperation) return existingOperation

  const operation = stopBackendOnce(runtime, onState)
    .finally(() => backendStopOperations.delete(runtime.process))
  backendStopOperations.set(runtime.process, operation)
  return operation
}
