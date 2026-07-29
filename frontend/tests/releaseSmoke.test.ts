import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundAiTaskStore } from '../src/lib/backgroundAiTasks';
import { runBackgroundAiReleaseSmoke } from '../src/lib/releaseSmoke';

describe('packaged renderer background AI release probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('covers navigation persistence, late return, dismissal, stop, and wall-clock catch-up', async () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
    });
    const result = await runBackgroundAiReleaseSmoke(
      new BackgroundAiTaskStore(),
    );

    expect(result).toMatchObject({
      passed: true,
      failedChecks: [],
      completedAnswer:
        'Background generation completed while its page was unmounted.',
      stoppedAnswer: 'Preserved partial answer',
      wallClockCatchUp: 720,
    });
  });
});
