import { contextBridge, ipcRenderer } from 'electron'
import type { InstalledUpdateInfo, UpdatePreferences, UpdateState } from './update-types'

export type BackendState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
export type BackendStateListener = (state: BackendState, detail?: string) => void

contextBridge.exposeInMainWorld('desktop', {
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-file'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-folder'),
  revealPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('desktop:reveal-path', targetPath),
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-version'),
  getUpdateState: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: (): Promise<UpdateState | null> => ipcRenderer.invoke('desktop:install-update'),
  getUpdatePreferences: (): Promise<UpdatePreferences | null> => ipcRenderer.invoke('desktop:get-update-preferences'),
  getInstalledUpdate: (): Promise<InstalledUpdateInfo | null> => ipcRenderer.invoke('desktop:get-installed-update'),
  setUpdatePreferences: (preferences: Partial<UpdatePreferences>): Promise<UpdatePreferences | null> => ipcRenderer.invoke('desktop:set-update-preferences', preferences),
  openUpdateLogs: (): Promise<boolean> => ipcRenderer.invoke('desktop:open-update-logs'),
  onBackendState: (listener: BackendStateListener): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: BackendState, detail?: string) => listener(state, detail)
    ipcRenderer.on('desktop:backend-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:backend-state', wrapped)
  },
  onUpdateState: (listener: (state: UpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('desktop:update-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:update-state', wrapped)
  },
  onUpdateInstalled: (listener: (info: InstalledUpdateInfo) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, info: InstalledUpdateInfo) => listener(info)
    ipcRenderer.on('desktop:update-installed', wrapped)
    return () => ipcRenderer.removeListener('desktop:update-installed', wrapped)
  },
})
