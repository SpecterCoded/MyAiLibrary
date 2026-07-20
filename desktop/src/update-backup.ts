import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'

interface BackupManifestFile {
  path: string
  size: number
  sha256: string
}

interface BackupManifest {
  formatVersion: number
  backupDirectory: string
  files: BackupManifestFile[]
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function runMaintenance(dataDir: string, currentVersion: string, targetVersion: string): Promise<string> {
  let executable: string
  let args: string[]
  let cwd: string

  if (app.isPackaged) {
    executable = path.join(process.resourcesPath, 'backend', 'myailibrary-backend.exe')
    args = []
    cwd = dataDir
  } else {
    const projectRoot = path.resolve(__dirname, '..', '..')
    executable = path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
    args = [path.join(projectRoot, 'backend', 'desktop_entry.py')]
    cwd = path.join(projectRoot, 'backend')
  }

  if (!existsSync(executable)) throw new Error(`Backup helper was not found: ${executable}`)
  args.push(
    '--maintenance-backup',
    '--data-dir', dataDir,
    '--current-version', currentVersion,
    '--target-version', targetVersion,
  )

  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The pre-update backup timed out. The update was not installed.'))
    }, 120_000)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Backup helper exited with code ${code}.`))
        return
      }
      const output = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
      if (!output) {
        reject(new Error('Backup helper did not return a manifest path.'))
        return
      }
      try {
        const parsed = JSON.parse(output) as { manifestPath?: unknown }
        if (typeof parsed.manifestPath !== 'string') throw new Error('Invalid backup response.')
        resolve(parsed.manifestPath)
      } catch (error) {
        reject(error)
      }
    })
  })
}

export async function createAndVerifyUpdateBackup(
  dataDir: string,
  currentVersion: string,
  targetVersion: string,
): Promise<string> {
  const manifestPath = path.resolve(await runMaintenance(dataDir, currentVersion, targetVersion))
  const backupsRoot = path.resolve(dataDir, 'backups', 'pre-update')
  const relativeManifest = path.relative(backupsRoot, manifestPath)
  if (relativeManifest.startsWith('..') || path.isAbsolute(relativeManifest)) {
    throw new Error('Backup helper returned a manifest outside the protected backup directory.')
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('The pre-update backup manifest is invalid.')
  }
  const backupDirectory = path.resolve(manifest.backupDirectory)
  if (path.relative(backupsRoot, backupDirectory).startsWith('..')) {
    throw new Error('The pre-update backup directory is invalid.')
  }

  for (const file of manifest.files) {
    const filePath = path.resolve(backupDirectory, file.path)
    const relativeFile = path.relative(backupDirectory, filePath)
    if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile) || !existsSync(filePath)) {
      throw new Error(`Backup file is missing or unsafe: ${file.path}`)
    }
    const digest = await sha256File(filePath)
    if (digest !== file.sha256) throw new Error(`Backup verification failed for ${file.path}.`)
  }
  return manifestPath
}
