// main.ts
import { app, BrowserWindow, ipcMain, screen, IpcMainEvent } from 'electron';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Shared shape (kept identical to preload.ts / AttachmentViewer.tsx). In a
// real project these constants and types would live in one shared module.
// ---------------------------------------------------------------------------

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

// Only these URL schemes are accepted. Prefer a custom app-controlled scheme
// (e.g. "app-media://") over raw file:// paths so the renderer never learns
// real filesystem locations.
const ALLOWED_URL_PREFIXES = ['app-media://', 'file://', 'https://'];

const VIEWER_WIDTH = 1100;
const VIEWER_HEIGHT = 760;
const VIEWER_MIN_WIDTH = 520;
const VIEWER_MIN_HEIGHT = 360;

let attachmentViewerWindow: BrowserWindow | null = null;
let viewerReady = false;
let pendingPayload: OpenViewerPayload | null = null;

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function isValidAttachment(value: unknown): value is ViewerAttachment {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  const validKind = c.kind === 'image' || c.kind === 'video' || c.kind === 'audio' || c.kind === 'pdf';
  const validUrl = typeof c.url === 'string' && ALLOWED_URL_PREFIXES.some((prefix) => (c.url as string).startsWith(prefix));
  return (
    typeof c.id === 'string' &&
    validKind &&
    typeof c.name === 'string' &&
    validUrl &&
    (c.mimeType === undefined || typeof c.mimeType === 'string') &&
    (c.size === undefined || typeof c.size === 'number') &&
    (c.pageCount === undefined || typeof c.pageCount === 'number')
  );
}

function isValidPayload(value: unknown): value is OpenViewerPayload {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  if (!Array.isArray(c.attachments) || c.attachments.length === 0) return false;
  if (typeof c.activeIndex !== 'number' || c.activeIndex < 0 || c.activeIndex >= c.attachments.length) return false;
  return c.attachments.every(isValidAttachment);
}

// ---------------------------------------------------------------------------
// Renderer / preload resolution
// ---------------------------------------------------------------------------

function getPreloadPath(): string {
  // Adjust to match your build output layout (e.g. dist/preload.js).
  return path.join(__dirname, 'preload.js');
}

function getViewerRendererUrl(): string {
  if (!app.isPackaged && process.env.VIEWER_DEV_SERVER_URL) {
    // Development: served by a bundler dev server (Vite/webpack-dev-server).
    return process.env.VIEWER_DEV_SERVER_URL;
  }
  // Production: bundled static HTML that mounts <AttachmentViewer />.
  return `file://${path.join(__dirname, '../renderer/attachment-viewer.html')}`;
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createAttachmentViewerWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const x = Math.round((screenWidth - VIEWER_WIDTH) / 2);
  const y = Math.round((screenHeight - VIEWER_HEIGHT) / 2);

  const win = new BrowserWindow({
    width: VIEWER_WIDTH,
    height: VIEWER_HEIGHT,
    minWidth: VIEWER_MIN_WIDTH,
    minHeight: VIEWER_MIN_HEIGHT,
    x,
    y,
    frame: false,
    transparent: false,
    backgroundColor: '#111214',
    resizable: true,
    movable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('did-finish-load', () => {
    viewerReady = true;
    if (pendingPayload) {
      win.webContents.send(ATTACHMENT_VIEWER_CHANNELS.payload, pendingPayload);
      pendingPayload = null;
    }
  });

  // No navigation away from the viewer document, and no window.open popups.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  win.on('closed', () => {
    attachmentViewerWindow = null;
    viewerReady = false;
    pendingPayload = null;
  });

  win.loadURL(getViewerRendererUrl());

  return win;
}

// ---------------------------------------------------------------------------
// Public entry point: open or reuse the single viewer window
// ---------------------------------------------------------------------------

export function openAttachmentViewer(payload: OpenViewerPayload): void {
  if (!isValidPayload(payload)) {
    console.warn('Rejected invalid attachment viewer payload.');
    return;
  }

  if (!attachmentViewerWindow || attachmentViewerWindow.isDestroyed()) {
    attachmentViewerWindow = createAttachmentViewerWindow();
    viewerReady = false;
    pendingPayload = payload;
    return;
  }

  if (attachmentViewerWindow.isMinimized()) {
    attachmentViewerWindow.restore();
  }
  attachmentViewerWindow.show();
  attachmentViewerWindow.focus();

  if (viewerReady) {
    attachmentViewerWindow.webContents.send(ATTACHMENT_VIEWER_CHANNELS.payload, payload);
  } else {
    pendingPayload = payload;
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.on(DESKTOP_ATTACHMENTS_CHANNELS.openViewer, (_event: IpcMainEvent, payload: unknown) => {
  openAttachmentViewer(payload as OpenViewerPayload);
});

ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.close, () => {
  attachmentViewerWindow?.close();
});

ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.minimize, () => {
  attachmentViewerWindow?.minimize();
});

ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.toggleMaximize, () => {
  if (!attachmentViewerWindow) return;
  if (attachmentViewerWindow.isMaximized()) {
    attachmentViewerWindow.unmaximize();
  } else {
    attachmentViewerWindow.maximize();
  }
});

ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.isMaximized, () => {
  return attachmentViewerWindow ? attachmentViewerWindow.isMaximized() : false;
});

ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.toggleAlwaysOnTop, () => {
  if (!attachmentViewerWindow) return false;
  const next = !attachmentViewerWindow.isAlwaysOnTop();
  attachmentViewerWindow.setAlwaysOnTop(next);
  return next;
});

ipcMain.handle(ATTACHMENT_VIEWER_CHANNELS.getAlwaysOnTop, () => {
  return attachmentViewerWindow ? attachmentViewerWindow.isAlwaysOnTop() : false;
});

ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.showInFolder, (_event: IpcMainEvent, attachmentId: unknown) => {
  if (typeof attachmentId !== 'string') return;
  // Resolve attachmentId to a local path through the app's own attachment
  // store, then call shell.showItemInFolder(resolvedPath).
  console.log('showInFolder requested for', attachmentId);
});

ipcMain.on(ATTACHMENT_VIEWER_CHANNELS.saveAs, (_event: IpcMainEvent, attachmentId: unknown) => {
  if (typeof attachmentId !== 'string') return;
  // Resolve attachmentId to bytes/path, then show a native save dialog via
  // dialog.showSaveDialog and write the file.
  console.log('saveAs requested for', attachmentId);
});

app.on('before-quit', () => {
  attachmentViewerWindow?.removeAllListeners('closed');
});