import { getTimelineCatchUpGraphemes } from '../components/chat/typewriterTiming';
import type { BackgroundAiTask, BackgroundAiTaskStore } from './backgroundAiTasks';

export interface BackgroundAiReleaseSmokeResult {
  passed: boolean;
  failedChecks: string[];
  completedAnswer: string;
  stoppedAnswer: string;
  wallClockCatchUp: number;
}

const waitForTask = async (
  store: BackgroundAiTaskStore,
  taskId: string,
  predicate: (task: BackgroundAiTask) => boolean,
  timeoutMs = 5_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = store.getTask(taskId);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for background task ${taskId}.`);
};

/**
 * Production-renderer release probe. It is exposed only when Electron starts
 * with --myai-release-smoke and uses isolated, in-memory tasks.
 */
export async function runBackgroundAiReleaseSmoke(
  store: BackgroundAiTaskStore,
): Promise<BackgroundAiReleaseSmokeResult> {
  store.clear();
  let visibleNotifications = 0;
  const unsubscribe = store.subscribe(() => {
    visibleNotifications += 1;
  });

  store.start({
    id: 'release-smoke-background',
    ownerKey: 'release-smoke:chat',
    surface: 'main-chat',
    query: 'deterministic packaged stream',
    runner: async ({ appendText, complete }) => {
      appendText('Background ');
      await new Promise((resolve) => window.setTimeout(resolve, 35));
      appendText('generation ');
      await new Promise((resolve) => window.setTimeout(resolve, 35));
      complete({
        answer: 'Background generation completed while its page was unmounted.',
        sources: [{ id: 'release-smoke-source' }],
        details: { finish_reason: 'provider_eof' },
      });
    },
  });

  await waitForTask(
    store,
    'release-smoke-background',
    (task) => task.answer === 'Background ',
  );
  const notificationsBeforeNavigation = visibleNotifications;
  unsubscribe();

  const completed = await waitForTask(
    store,
    'release-smoke-background',
    (task) => task.status === 'completed',
  );
  let lateSubscriberNotifications = 0;
  const unsubscribeLate = store.subscribe(() => {
    lateSubscriberNotifications += 1;
  });
  const lateSnapshot = store.getLatest('release-smoke:chat');
  unsubscribeLate();

  store.start({
    id: 'release-smoke-dismissed',
    ownerKey: 'release-smoke:home',
    surface: 'home',
    query: 'hidden result panel',
    runner: async ({ appendText, complete }) => {
      appendText('Hidden ');
      await new Promise((resolve) => window.setTimeout(resolve, 25));
      complete({ answer: 'Hidden result completed.' });
    },
  });
  store.dismiss('release-smoke-dismissed');
  const dismissed = await waitForTask(
    store,
    'release-smoke-dismissed',
    (task) => task.status === 'completed',
  );

  store.start({
    id: 'release-smoke-stopped',
    ownerKey: 'release-smoke:video',
    surface: 'video',
    query: 'explicit stop',
    runner: ({ signal, appendText }) => {
      appendText('Preserved partial answer');
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  store.cancelOwner('release-smoke:video');
  const stopped = await waitForTask(
    store,
    'release-smoke-stopped',
    (task) => task.status === 'stopped',
  );

  const now = Date.now();
  const wallClockCatchUp = getTimelineCatchUpGraphemes(now - 12_800, now, 60);
  const checks = {
    notifiedBeforeNavigation: notificationsBeforeNavigation > 0,
    survivedWithoutSubscribers: completed.status === 'completed',
    completedAnswerPreserved:
      completed.answer === 'Background generation completed while its page was unmounted.',
    completionMetadataPreserved:
      completed.details?.finish_reason === 'provider_eof' &&
      completed.sources.length === 1,
    lateSubscriberSeesCompletedTask:
      lateSnapshot?.id === completed.id && lateSnapshot.status === 'completed',
    lateSubscriberDidNotReplay: lateSubscriberNotifications === 0,
    dismissedPanelDidNotCancel:
      dismissed.dismissed === true &&
      dismissed.status === 'completed' &&
      dismissed.answer === 'Hidden result completed.',
    explicitStopPreservedPartial:
      stopped.status === 'stopped' &&
      stopped.answer === 'Preserved partial answer',
    wallClockCatchUpUsesHiddenTime: wallClockCatchUp === 720,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  store.clear();

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    completedAnswer: completed.answer,
    stoppedAnswer: stopped.answer,
    wallClockCatchUp,
  };
}
