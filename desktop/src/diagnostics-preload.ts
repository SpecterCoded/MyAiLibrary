import { contextBridge, ipcRenderer } from 'electron'
import type { BackendState } from './preload'
import type { SystemLogClearFilter, SystemLogEvent, SystemLogSnapshot } from './system-log'

const SYSTEM_LOG_CHANNELS = {
  event: 'system-log:event',
  setFilter: 'system-log:set-filter',
  getSnapshot: 'system-log:get-snapshot',
  getBackendState: 'system-log:get-backend-state',
  getTheme: 'system-log:get-theme',
  themeChanged: 'system-log:theme-changed',
  export: 'system-log:export',
  clear: 'system-log:clear',
  reveal: 'system-log:reveal',
  close: 'system-log:close',
  minimize: 'system-log:minimize',
  toggleMaximize: 'system-log:toggle-maximize',
  isMaximized: 'system-log:is-maximized',
} as const

contextBridge.exposeInMainWorld('systemLogs', {
  getSnapshot: (limit?: number): Promise<SystemLogSnapshot | null> =>
    ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.getSnapshot, limit),
  getBackendState: (): Promise<BackendState> =>
    ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.getBackendState),
  getTheme: (): Promise<'light' | 'dark'> =>
    ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.getTheme),
  onEvent: (listener: (event: SystemLogEvent) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: SystemLogEvent) => listener(value)
    ipcRenderer.on(SYSTEM_LOG_CHANNELS.event, wrapped)
    return () => ipcRenderer.removeListener(SYSTEM_LOG_CHANNELS.event, wrapped)
  },
  onSetFilter: (listener: (level: string) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, level: string) => listener(level)
    ipcRenderer.on(SYSTEM_LOG_CHANNELS.setFilter, wrapped)
    return () => ipcRenderer.removeListener(SYSTEM_LOG_CHANNELS.setFilter, wrapped)
  },
  onBackendState: (listener: (state: BackendState, detail?: string) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: BackendState, detail?: string) => listener(state, detail)
    ipcRenderer.on('desktop:backend-state', wrapped)
    return () => ipcRenderer.removeListener('desktop:backend-state', wrapped)
  },
  onThemeChanged: (listener: (theme: 'light' | 'dark') => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, theme: 'light' | 'dark') => listener(theme)
    ipcRenderer.on(SYSTEM_LOG_CHANNELS.themeChanged, wrapped)
    return () => ipcRenderer.removeListener(SYSTEM_LOG_CHANNELS.themeChanged, wrapped)
  },
  exportLogs: (): Promise<{ success: boolean; path?: string; count?: number }> =>
    ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.export),
  clearLogs: (filter?: SystemLogClearFilter): Promise<{ success: boolean; deleted: number }> =>
    ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.clear, filter),
  revealLogs: (): Promise<boolean> => ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.reveal),
  close: (): void => ipcRenderer.send(SYSTEM_LOG_CHANNELS.close),
  minimize: (): void => ipcRenderer.send(SYSTEM_LOG_CHANNELS.minimize),
  toggleMaximize: (): void => ipcRenderer.send(SYSTEM_LOG_CHANNELS.toggleMaximize),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(SYSTEM_LOG_CHANNELS.isMaximized),
})
