import { describe, expect, it, vi } from 'vitest';
import { BackgroundAiTaskStore } from '../src/lib/backgroundAiTasks';

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('BackgroundAiTaskStore', () => {
  it('keeps running without subscribers and exposes the completed result later', async () => {
    const store = new BackgroundAiTaskStore();

    store.start({
      id: 'home-task',
      ownerKey: 'home',
      surface: 'home',
      query: 'Summarize my library',
      runner: async ({ appendText, complete }) => {
        appendText('A persistent ');
        await Promise.resolve();
        appendText('answer');
        complete({ sources: [{ id: 'source-1' }] });
      },
    });

    await flushPromises();
    expect(store.getTask('home-task')).toMatchObject({
      answer: 'A persistent answer',
      status: 'completed',
      sources: [{ id: 'source-1' }],
    });
  });

  it('supports independent tasks on different surfaces', async () => {
    const store = new BackgroundAiTaskStore();
    const releases: Array<() => void> = [];

    for (const [id, ownerKey, surface] of [
      ['chat-task', 'main-chat:one', 'main-chat'],
      ['video-task', 'video:resource:one', 'video'],
    ] as const) {
      store.start({
        id,
        ownerKey,
        surface,
        query: id,
        runner: ({ signal, appendText }) =>
          new Promise<void>((resolve) => {
            appendText(id);
            releases.push(resolve);
            signal.addEventListener('abort', resolve, { once: true });
          }),
      });
    }

    expect(store.getSnapshot().filter((task) => task.status === 'running')).toHaveLength(2);
    releases.forEach((release) => release());
    await flushPromises();
    expect(store.getSnapshot().every((task) => task.status === 'completed')).toBe(true);
  });

  it('replaces only the running task owned by the same conversation', async () => {
    const store = new BackgroundAiTaskStore();
    let secondRelease: (() => void) | undefined;

    store.start({
      id: 'first',
      ownerKey: 'main-chat:session',
      surface: 'main-chat',
      query: 'first',
      runner: ({ signal }) =>
        new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true })),
    });
    store.start({
      id: 'second',
      ownerKey: 'main-chat:session',
      surface: 'main-chat',
      query: 'second',
      runner: ({ signal }) =>
        new Promise<void>((resolve) => {
          secondRelease = resolve;
          signal.addEventListener('abort', resolve, { once: true });
        }),
    });

    expect(store.getTask('first')?.status).toBe('stopped');
    expect(store.getTask('second')?.status).toBe('running');
    secondRelease?.();
    await flushPromises();
  });

  it('does not cancel generation when a result panel is dismissed', async () => {
    const store = new BackgroundAiTaskStore();
    let release: (() => void) | undefined;

    store.start({
      id: 'dismissed',
      ownerKey: 'home',
      surface: 'home',
      query: 'keep going',
      runner: ({ signal }) =>
        new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener('abort', resolve, { once: true });
        }),
    });
    store.dismiss('dismissed');

    expect(store.getTask('dismissed')).toMatchObject({
      dismissed: true,
      status: 'running',
    });
    release?.();
    await flushPromises();
  });

  it('aborts explicit cancellation and preserves partial text as stopped', async () => {
    const store = new BackgroundAiTaskStore();
    const aborted = vi.fn();

    store.start({
      id: 'stopped',
      ownerKey: 'audio:resource:session',
      surface: 'audio',
      query: 'question',
      runner: ({ signal, appendText }) => {
        appendText('partial');
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted();
            resolve();
          }, { once: true });
        });
      },
    });

    expect(store.cancelOwner('audio:resource:session')).toBe(true);
    await flushPromises();
    expect(aborted).toHaveBeenCalledOnce();
    expect(store.getTask('stopped')).toMatchObject({
      answer: 'partial',
      status: 'stopped',
    });
  });

  it('classifies runner failures as interrupted only when partial text exists', async () => {
    const store = new BackgroundAiTaskStore();

    store.start({
      id: 'partial-error',
      ownerKey: 'main-chat:partial',
      surface: 'main-chat',
      query: 'partial',
      runner: async ({ appendText }) => {
        appendText('preserved text');
        throw new Error('connection lost');
      },
    });
    store.start({
      id: 'empty-error',
      ownerKey: 'main-chat:empty',
      surface: 'main-chat',
      query: 'empty',
      runner: async () => {
        throw new Error('provider unavailable');
      },
    });

    await flushPromises();
    expect(store.getTask('partial-error')).toMatchObject({
      answer: 'preserved text',
      error: 'connection lost',
      status: 'interrupted',
    });
    expect(store.getTask('empty-error')).toMatchObject({
      answer: '',
      error: 'provider unavailable',
      status: 'error',
    });
  });

  it('clears and aborts all task state on logout or shutdown', async () => {
    const store = new BackgroundAiTaskStore();
    const aborted = vi.fn();

    store.start({
      id: 'running',
      ownerKey: 'video:resource:session',
      surface: 'video',
      query: 'question',
      runner: ({ signal }) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted();
            resolve();
          }, { once: true });
        }),
    });

    store.clear();
    await flushPromises();
    expect(aborted).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('purges completed and running snapshots for an explicitly cleared owner', async () => {
    const store = new BackgroundAiTaskStore();
    store.start({
      id: 'completed-owner-task',
      ownerKey: 'video:resource-one',
      surface: 'video',
      query: 'done',
      runner: async ({ complete }) => complete({ answer: 'complete answer' }),
    });
    store.start({
      id: 'other-owner-task',
      ownerKey: 'video:resource-two',
      surface: 'video',
      query: 'keep',
      runner: async ({ complete }) => complete({ answer: 'keep me' }),
    });
    await flushPromises();

    expect(store.clearOwner('video:resource-one')).toBe(true);
    expect(store.getTask('completed-owner-task')).toBeUndefined();
    expect(store.getTask('other-owner-task')?.answer).toBe('keep me');
  });
});
