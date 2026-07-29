import { describe, expect, it } from 'vitest';
import {
  countRevealUnits,
  findNextRevealBoundary,
  getAdaptiveRevealInterval,
} from '../src/components/chat/typewriterTiming';

describe('adaptive typewriter timing', () => {
  it('holds an unfinished provider fragment until a safe boundary arrives', () => {
    expect(findNextRevealBoundary('partial', 0, true)).toBe(0);
    expect(findNextRevealBoundary('partial word ', 0, true)).toBe('partial '.length);
    expect(findNextRevealBoundary('partial', 0, false)).toBe('partial'.length);
  });

  it('counts words across paragraphs without treating line breaks as pauses', () => {
    const text = 'First paragraph ends.\n\nSecond paragraph starts here. ';
    expect(countRevealUnits(text, 0, true)).toBe(7);
  });

  it('slows down near an empty reserve and catches up with a large backlog', () => {
    const lowReserve = getAdaptiveRevealInterval({
      backlogUnits: 2,
      observedMsPerUnit: 100,
      streaming: true,
      minimumMs: 28,
    });
    const healthyReserve = getAdaptiveRevealInterval({
      backlogUnits: 10,
      observedMsPerUnit: 100,
      streaming: true,
      minimumMs: 28,
    });
    const largeBacklog = getAdaptiveRevealInterval({
      backlogUnits: 30,
      observedMsPerUnit: 100,
      streaming: true,
      minimumMs: 28,
    });

    expect(lowReserve).toBeGreaterThan(healthyReserve);
    expect(healthyReserve).toBeGreaterThan(largeBacklog);
  });

  it('drains completed content smoothly instead of snapping it all at once', () => {
    const completedInterval = getAdaptiveRevealInterval({
      backlogUnits: 12,
      observedMsPerUnit: 100,
      streaming: false,
      minimumMs: 28,
    });

    expect(completedInterval).toBeGreaterThanOrEqual(28);
    expect(completedInterval).toBeLessThan(100);
  });
});
