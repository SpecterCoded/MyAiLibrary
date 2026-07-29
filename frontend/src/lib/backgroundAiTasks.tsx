import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type BackgroundAiSurface = 'main-chat' | 'home' | 'video' | 'audio';
export type BackgroundAiTaskStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'interrupted'
  | 'error';

export interface BackgroundAiTask {
  id: string;
  ownerKey: string;
  surface: BackgroundAiSurface;
  query: string;
  targetMessageId?: string;
  answer: string;
  sources: unknown[];
  details?: Record<string, unknown>;
  error?: string;
  status: BackgroundAiTaskStatus;
  startedAt: number;
  firstContentAt?: number;
  completedAt?: number;
  dismissed?: boolean;
}

export interface BackgroundAiTaskPatch {
  answer?: string;
  sources?: unknown[];
  details?: Record<string, unknown>;
  error?: string;
  status?: BackgroundAiTaskStatus;
  dismissed?: boolean;
  firstContentAt?: number;
  completedAt?: number;
}

export interface BackgroundAiTaskControls {
  signal: AbortSignal;
  getSnapshot: () => BackgroundAiTask;
  appendText: (text: string) => void;
  patch: (patch: BackgroundAiTaskPatch) => void;
  complete: (patch?: BackgroundAiTaskPatch) => void;
  interrupt: (error: string, patch?: BackgroundAiTaskPatch) => void;
}

export interface StartBackgroundAiTask {
  id?: string;
  ownerKey: string;
  surface: BackgroundAiSurface;
  query: string;
  targetMessageId?: string;
  initialAnswer?: string;
  runner: (controls: BackgroundAiTaskControls) => Promise<void>;
}

type Listener = () => void;

const makeTaskId = () =>
  `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export class BackgroundAiTaskStore {
  private tasks = new Map<string, BackgroundAiTask>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  private snapshot: BackgroundAiTask[] = [];

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private publish() {
    this.snapshot = Array.from(this.tasks.values()).sort(
      (left, right) => left.startedAt - right.startedAt,
    );
    for (const listener of this.listeners) listener();
  }

  private update(taskId: string, patch: BackgroundAiTaskPatch) {
    const current = this.tasks.get(taskId);
    if (!current) return;
    const answer = patch.answer ?? current.answer;
    this.tasks.set(taskId, {
      ...current,
      ...patch,
      answer,
      firstContentAt:
        patch.firstContentAt ??
        current.firstContentAt ??
        (answer.length > 0 ? Date.now() : undefined),
    });
    this.publish();
  }

  getTask(taskId: string) {
    return this.tasks.get(taskId);
  }

  getLatest(ownerKey: string) {
    return [...this.tasks.values()]
      .filter((task) => task.ownerKey === ownerKey)
      .sort((left, right) => right.startedAt - left.startedAt)[0];
  }

  getBySurface(surface: BackgroundAiSurface) {
    return this.snapshot.filter((task) => task.surface === surface);
  }

  start(input: StartBackgroundAiTask): string {
    const existing = this.getLatest(input.ownerKey);
    if (existing?.status === 'running') this.cancel(existing.id);

    const taskId = input.id || makeTaskId();
    const controller = new AbortController();
    const initialAnswer = input.initialAnswer || '';
    const task: BackgroundAiTask = {
      id: taskId,
      ownerKey: input.ownerKey,
      surface: input.surface,
      query: input.query,
      targetMessageId: input.targetMessageId,
      answer: initialAnswer,
      sources: [],
      status: 'running',
      startedAt: Date.now(),
      firstContentAt: initialAnswer ? Date.now() : undefined,
    };
    this.tasks.set(taskId, task);
    this.controllers.set(taskId, controller);
    this.publish();

    const controls: BackgroundAiTaskControls = {
      signal: controller.signal,
      getSnapshot: () => this.tasks.get(taskId) || task,
      appendText: (text) => {
        if (!text || controller.signal.aborted) return;
        const current = this.tasks.get(taskId);
        if (!current || current.status !== 'running') return;
        this.update(taskId, { answer: current.answer + text });
      },
      patch: (patch) => {
        if (controller.signal.aborted) return;
        this.update(taskId, patch);
      },
      complete: (patch = {}) => {
        if (controller.signal.aborted) return;
        this.update(taskId, {
          ...patch,
          status: 'completed',
          completedAt: Date.now(),
        });
        this.controllers.delete(taskId);
      },
      interrupt: (error, patch = {}) => {
        if (controller.signal.aborted) return;
        const current = this.tasks.get(taskId);
        this.update(taskId, {
          ...patch,
          error,
          status: current?.answer ? 'interrupted' : 'error',
          completedAt: Date.now(),
        });
        this.controllers.delete(taskId);
      },
    };

    void input.runner(controls)
      .then(() => {
        const current = this.tasks.get(taskId);
        if (current?.status === 'running' && !controller.signal.aborted) {
          controls.complete();
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        controls.interrupt(
          error instanceof Error ? error.message : 'The AI request failed.',
        );
      });

    return taskId;
  }

  cancel(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;
    this.controllers.get(taskId)?.abort();
    this.controllers.delete(taskId);
    this.update(taskId, {
      status: 'stopped',
      completedAt: Date.now(),
    });
    return true;
  }

  cancelOwner(ownerKey: string) {
    let cancelled = false;
    for (const task of this.tasks.values()) {
      if (task.ownerKey === ownerKey && task.status === 'running') {
        cancelled = this.cancel(task.id) || cancelled;
      }
    }
    return cancelled;
  }

  clearOwner(ownerKey: string) {
    let changed = false;
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.ownerKey !== ownerKey) continue;
      this.controllers.get(taskId)?.abort();
      this.controllers.delete(taskId);
      this.tasks.delete(taskId);
      changed = true;
    }
    if (changed) this.publish();
    return changed;
  }

  dismiss(taskId: string) {
    this.update(taskId, { dismissed: true });
  }

  acknowledge(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'running') return;
    this.tasks.delete(taskId);
    this.controllers.delete(taskId);
    this.publish();
  }

  clear() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.tasks.clear();
    this.publish();
  }
}

interface BackgroundAiTaskContextValue {
  store: BackgroundAiTaskStore;
  tasks: BackgroundAiTask[];
}

const BackgroundAiTaskContext =
  createContext<BackgroundAiTaskContextValue | null>(null);

export function BackgroundAiTaskProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<BackgroundAiTaskStore | null>(null);
  if (!storeRef.current) storeRef.current = new BackgroundAiTaskStore();
  const store = storeRef.current;
  const tasks = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => () => store.clear(), [store]);
  const value = useMemo(() => ({ store, tasks }), [store, tasks]);
  return (
    <BackgroundAiTaskContext.Provider value={value}>
      {children}
    </BackgroundAiTaskContext.Provider>
  );
}

export function useBackgroundAiTasks() {
  const context = useContext(BackgroundAiTaskContext);
  if (!context) {
    throw new Error('useBackgroundAiTasks must be used inside BackgroundAiTaskProvider.');
  }
  const { store, tasks } = context;
  const getLatest = useCallback(
    (ownerKey: string) =>
      [...tasks]
        .filter((task) => task.ownerKey === ownerKey)
        .sort((left, right) => right.startedAt - left.startedAt)[0],
    [tasks],
  );
  const actions = useMemo(() => ({
    startTask: store.start.bind(store),
    cancelTask: store.cancel.bind(store),
    cancelOwner: store.cancelOwner.bind(store),
    clearOwner: store.clearOwner.bind(store),
    dismissTask: store.dismiss.bind(store),
    acknowledgeTask: store.acknowledge.bind(store),
    clearTasks: store.clear.bind(store),
  }), [store]);
  return {
    store,
    tasks,
    ...actions,
    getLatest,
  };
}
