import { contextBridge, ipcRenderer } from 'electron'

export type BackendState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
export type BackendStateListener = (state: BackendState, detail?: string) => void

contextBridge.exposeInMainWorld('desktop', {
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-file'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('desktop:select-folder'),
  revealPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke('desktop:reveal-path', targetPath),
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-version'),
  onBackendState: (listener: BackendStateListener): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: BackendState, detail?: string) => listener(state, detail)
    ipcRenderer.on('desktop:backend-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:backend-state', wrapped)
  },
})
