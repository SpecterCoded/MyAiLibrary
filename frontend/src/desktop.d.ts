export {}

declare global {
  interface DesktopBridge {
    selectFile(): Promise<string | null>
    selectFolder(): Promise<string | null>
    revealPath(targetPath: string): Promise<boolean>
    getVersion(): Promise<string>
    onBackendState(listener: (state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed', detail?: string) => void): () => void
  }

  interface Window {
    desktop?: DesktopBridge
  }
}
