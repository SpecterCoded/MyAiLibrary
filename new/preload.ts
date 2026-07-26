// preload.ts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// This single preload is shared by the main app window (exposes
// `desktopAttachments.openViewer`) and the detached viewer window (exposes
// `attachmentViewer`). Each window only calls the half of the API relevant
// to it; both bridges are inert no-ops in the window that doesn't use them.

type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf';

interface ViewerAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  pageCount?: number;
}

interface OpenViewerPayload {
  attachments: ViewerAttachment[];
  activeIndex: number;
}

const ATTACHMENT_VIEWER_CHANNELS = {
  payload: 'attachment-viewer:payload',
  close: 'attachment-viewer:close',
  minimize: 'attachment-viewer:minimize',
  toggleMaximize: 'attachment-viewer:toggle-maximize',
  isMaximized: 'attachment-viewer:is-maximized',
  toggleAlwaysOnTop: 'attachment-viewer:toggle-always-on-top',
  getAlwaysOnTop: 'attachment-viewer:get-always-on-top',
  showInFolder: 'attachment-viewer:show-in-folder',
  saveAs: 'attachment-viewer:save-as',
} as const;

const DESKTOP_ATTACHMENTS_CHANNELS = {
  openViewer: 'desktop-attachments:open-viewer',
} as const;

interface AttachmentViewerBridge {
  onPayload(callback: (payload: OpenViewerPayload) => void): () => void;
  close(): void;
  minimize(): void;
  toggleMaximize(): void;
  isMaximized(): Promise<boolean>;
  toggleAlwaysOnTop(): Promise<boolean>;
  getAlwaysOnTop(): Promise<boolean>;
  showInFolder(attachmentId: string): void;
  saveAs(attachmentId: string): void;
}

interface DesktopAttachmentsBridge {
  openViewer(payload: OpenViewerPayload): void;
}

const attachmentViewerBridge: AttachmentViewerBridge = {
  onPayload(callback) {
    const listener = (_event: IpcRendererEvent, payload: OpenViewerPayload) => {
      // Strip the raw IpcRendererEvent before handing data to the renderer.
      callback(payload);
    };
    ipcRenderer.on(ATTACHMENT_VIEWER_CHANNELS.payload, listener);
    return () => {
      ipcRenderer.removeListener(ATTACHMENT_VIEWER_CHANNELS.payload, listener);
    };
  },
  close() {
    ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.close);
  },
  minimize() {
    ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.minimize);
  },
  toggleMaximize() {
    ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.toggleMaximize);
  },
  isMaximized() {
    return ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.isMaximized);
  },
  toggleAlwaysOnTop() {
    return ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.toggleAlwaysOnTop);
  },
  getAlwaysOnTop() {
    return ipcRenderer.invoke(ATTACHMENT_VIEWER_CHANNELS.getAlwaysOnTop);
  },
  showInFolder(attachmentId) {
    ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.showInFolder, attachmentId);
  },
  saveAs(attachmentId) {
    ipcRenderer.send(ATTACHMENT_VIEWER_CHANNELS.saveAs, attachmentId);
  },
};

const desktopAttachmentsBridge: DesktopAttachmentsBridge = {
  openViewer(payload) {
    ipcRenderer.send(DESKTOP_ATTACHMENTS_CHANNELS.openViewer, payload);
  },
};

contextBridge.exposeInMainWorld('attachmentViewer', attachmentViewerBridge);
contextBridge.exposeInMainWorld('desktopAttachments', desktopAttachmentsBridge);