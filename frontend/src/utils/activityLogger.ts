export type LogCategory =
  | 'navigation'
  | 'playlist'
  | 'resource'
  | 'upload'
  | 'download'
  | 'ai_chat'
  | 'ai_features'
  | 'search'
  | 'settings'
  | 'notebook'
  | 'concept'
  | 'queue'
  | 'auth';

export interface LogEntry {
  id: string;
  category: LogCategory;
  action: string;
  detail?: string;
  created_at: string;
  synced: boolean;
}

const ALL_CATEGORIES: LogCategory[] = [
  'navigation', 'playlist', 'resource', 'upload', 'download',
  'ai_chat', 'ai_features', 'search', 'settings', 'notebook',
  'concept', 'queue', 'auth',
];

const CATEGORY_KEY = 'activity_log_categories';
const MAX_BUFFER = 15;  // Match backend 15-entry cap
const FLUSH_THRESHOLD = 3;   // Flush sooner
const FLUSH_INTERVAL_MS = 5_000;

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let listeners: (() => void)[] = [];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getCategories(): Record<LogCategory, boolean> {
  try {
    const raw = localStorage.getItem(CATEGORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults so new categories are always enabled
      const defaults: Record<string, boolean> = {};
      ALL_CATEGORIES.forEach(c => (defaults[c] = true));
      return { ...defaults, ...parsed };
    }
  } catch {}
  const defaults: Record<string, boolean> = {};
  ALL_CATEGORIES.forEach(c => (defaults[c] = true));
  return defaults as Record<LogCategory, boolean>;
}

function setCategories(cats: Record<LogCategory, boolean>): void {
  localStorage.setItem(CATEGORY_KEY, JSON.stringify(cats));
}

function isEnabled(category: LogCategory): boolean {
  return getCategories()[category] !== false;
}

function trimBuffer(): void {
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER);
  }
}

function notifyListeners(): void {
  listeners.forEach(fn => fn());
}

export function logActivity(category: LogCategory, action: string, detail?: string): void {
  if (!isEnabled(category)) return;

  const entry: LogEntry = {
    id: generateId(),
    category,
    action,
    detail,
    created_at: new Date().toISOString(),
    synced: false,
  };

  buffer.push(entry);
  trimBuffer();
  notifyListeners();

  // Auto-flush when buffer has enough entries
  const unsyncedCount = buffer.filter(e => !e.synced).length;
  if (unsyncedCount >= FLUSH_THRESHOLD) {
    flush();
  }
}

export function getBuffer(): LogEntry[] {
  return [...buffer];
}

export function removeFromBuffer(id: string): void {
  buffer = buffer.filter(e => e.id !== id);
  notifyListeners();
}

export function removeByAction(action: string, createdAtPrefix: string): void {
  buffer = buffer.filter(e => !(e.action === action && e.created_at?.substring(0, 16) === createdAtPrefix));
  notifyListeners();
}

export function clearBuffer(): void {
  buffer = [];
  notifyListeners();
}

export function onBufferChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

async function flush(): Promise<void> {
  const unsynced = buffer.filter(e => !e.synced);
  if (unsynced.length === 0) return;

  const token = localStorage.getItem('access_token');
  if (!token) return;

  try {
    const res = await fetch('/activity-logs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entries: unsynced.map(e => ({
          category: e.category,
          action: e.action,
          detail: e.detail,
          created_at: e.created_at,
        })),
      }),
    });

    if (res.ok) {
      const ids = new Set(unsynced.map(e => e.id));
      buffer = buffer.map(e => (ids.has(e.id) ? { ...e, synced: true } : e));
      notifyListeners();
    }
  } catch {
    // Silent failure
  }
}

function onNavigate(e: Event) {
  const detail = (e as CustomEvent).detail;
  logActivity('navigation', detail?.name || detail?.view || 'Navigation');
}

function onRefreshPlaylists() {
  logActivity('playlist', 'Refreshed playlists');
}

function onOpenNotebook() {
  logActivity('notebook', 'Opened notebook view');
}

function onWorkspaceChanged() {
  logActivity('settings', 'Changed workspace');
}

export function init(): void {
  window.addEventListener('app-navigate', onNavigate);
  window.addEventListener('refresh-playlists', onRefreshPlaylists);
  window.addEventListener('open-notebook-view', onOpenNotebook);
  window.addEventListener('workspace-changed', onWorkspaceChanged);

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

export function destroy(): void {
  window.removeEventListener('app-navigate', onNavigate);
  window.removeEventListener('refresh-playlists', onRefreshPlaylists);
  window.removeEventListener('open-notebook-view', onOpenNotebook);
  window.removeEventListener('workspace-changed', onWorkspaceChanged);

  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  flush();
  buffer = [];
  listeners = [];
}

export { flush, getCategories, setCategories, ALL_CATEGORIES };
