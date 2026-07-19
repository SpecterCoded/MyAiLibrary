import { ChildProcessByStdio, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { app } from 'electron'

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
  options.onState('starting', 'Starting local AI service…')
  mkdirSync(options.dataDir, { recursive: true })
  const logDir = path.join(options.dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'backend.log')
  const logStream = createWriteStream(logPath, { flags: 'a' })
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
  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })
  child.once('exit', (code, signal) => {
    logStream.write(`\n[desktop] backend exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)
    logStream.end()
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
  onState('stopping', 'Stopping local AI service…')
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
