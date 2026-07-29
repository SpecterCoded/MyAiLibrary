import { describe, expect, it } from 'vitest';
import {
  advanceByGraphemes,
  easeRevealRate,
  getAdaptiveRevealRate,
  getSafeRevealLimit,
  getTimelineCatchUpGraphemes,
  shouldBuildInitialReserve,
  TYPEWRITER_INITIAL_BUFFER_MAX_MS,
  TYPEWRITER_INITIAL_BUFFER_MIN_MS,
} from '../src/components/chat/typewriterTiming';

describe('adaptive typewriter timing', () => {
  it('holds only an unfinished provider fragment', () => {
    expect(getSafeRevealLimit('partial', true)).toBe(0);
    expect(getSafeRevealLimit('partial word ', true)).toBe('partial word '.length);
    expect(getSafeRevealLimit('partial word', true)).toBe('partial '.length);
    expect(getSafeRevealLimit('partial', false)).toBe('partial'.length);
  });

  it('treats paragraph and Markdown boundaries as normal continuous text', () => {
    const markdown = '**Overview**\n\n- First item\n- unfinished';
    const safeLimit = getSafeRevealLimit(markdown, true);
    expect(markdown.slice(0, safeLimit)).toBe('**Overview**\n\n- First item\n- ');
    expect(getSafeRevealLimit(`${markdown} item `, true)).toBe(`${markdown} item `.length);
  });

  it('reveals Unicode grapheme clusters without splitting them', () => {
    const family = '👨‍👩‍👧‍👦';
    const text = `${family} café`;
    expect(advanceByGraphemes(text, 0, 1)).toBe(family.length);
    expect(text.slice(0, advanceByGraphemes(text, 0, 3))).toBe(`${family} c`);
  });

  it('uses the selected adaptive 0.8–1.2 second warm-up window', () => {
    const common = {
      backlogCharacters: 20,
      preferredCharactersPerSecond: 30,
      streaming: true,
      hasVisibleText: false,
    };

    expect(shouldBuildInitialReserve({
      ...common,
      pendingForMs: TYPEWRITER_INITIAL_BUFFER_MIN_MS - 1,
      backlogCharacters: 200,
    })).toBe(true);
    expect(shouldBuildInitialReserve({
      ...common,
      pendingForMs: 900,
      backlogCharacters: 100,
    })).toBe(false);
    expect(shouldBuildInitialReserve({
      ...common,
      pendingForMs: 900,
    })).toBe(true);
    expect(shouldBuildInitialReserve({
      ...common,
      pendingForMs: TYPEWRITER_INITIAL_BUFFER_MAX_MS,
    })).toBe(false);
  });

  it('slows near an empty reserve and catches up gently with a large backlog', () => {
    const options = {
      preferredCharactersPerSecond: 36,
      streaming: true,
      maximumCharactersPerSecond: 50,
    };
    const lowReserve = getAdaptiveRevealRate({ ...options, backlogCharacters: 10 });
    const healthyReserve = getAdaptiveRevealRate({ ...options, backlogCharacters: 75 });
    const largeBacklog = getAdaptiveRevealRate({ ...options, backlogCharacters: 150 });

    expect(lowReserve).toBeLessThan(healthyReserve);
    expect(healthyReserve).toBeLessThan(largeBacklog);
  });

  it('eases rate changes instead of applying visible speed jumps', () => {
    const eased = easeRevealRate(20, 50, 16);
    expect(eased).toBeGreaterThan(20);
    expect(eased).toBeLessThan(50);
    expect(easeRevealRate(eased, 50, 16)).toBeGreaterThan(eased);
  });

  it('keeps enough reserve to cover a representative two-second provider gap', () => {
    let backlog = 100;
    let currentRate = 36;
    const frameMs = 1000 / 60;

    for (let frame = 0; frame < 120; frame += 1) {
      const targetRate = getAdaptiveRevealRate({
        backlogCharacters: backlog,
        preferredCharactersPerSecond: 36,
        streaming: true,
        maximumCharactersPerSecond: 50,
      });
      currentRate = easeRevealRate(currentRate, targetRate, frameMs);
      backlog -= (currentRate * frameMs) / 1000;
    }

    expect(backlog).toBeGreaterThan(25);
  });

  it('drains completed content smoothly at a bounded rate', () => {
    const completedRate = getAdaptiveRevealRate({
      backlogCharacters: 120,
      preferredCharactersPerSecond: 36,
      streaming: false,
      maximumCharactersPerSecond: 50,
    });

    expect(completedRate).toBeGreaterThan(36);
    expect(completedRate).toBeLessThanOrEqual(50);
  });

  it('supports a fast reveal rate without bypassing reserve protection', () => {
    const healthyRate = getAdaptiveRevealRate({
      backlogCharacters: 180,
      preferredCharactersPerSecond: 65,
      streaming: true,
      maximumCharactersPerSecond: 90,
    });
    const lowReserveRate = getAdaptiveRevealRate({
      backlogCharacters: 20,
      preferredCharactersPerSecond: 65,
      streaming: true,
      maximumCharactersPerSecond: 90,
    });

    expect(healthyRate).toBeGreaterThan(55);
    expect(lowReserveRate).toBeLessThan(healthyRate);
  });

  it('catches up using uncapped wall-clock time after a hidden interval', () => {
    const startedAt = 10_000;
    expect(getTimelineCatchUpGraphemes(startedAt, startedAt + 700, 60)).toBe(0);
    expect(getTimelineCatchUpGraphemes(startedAt, startedAt + 2_800, 60)).toBe(120);
    expect(getTimelineCatchUpGraphemes(startedAt, startedAt + 12_800, 60)).toBe(720);
  });

  it('does not calculate catch-up before a valid timeline begins', () => {
    expect(getTimelineCatchUpGraphemes(undefined, 5_000, 60)).toBe(0);
    expect(getTimelineCatchUpGraphemes(6_000, 5_000, 60)).toBe(0);
  });
});
