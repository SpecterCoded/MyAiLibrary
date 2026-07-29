import { describe, expect, it } from 'vitest';
import {
  isConfirmedPartialInterruption,
  normalizeStreamTerminalState,
} from '../src/lib/streamCompletion';

describe('stream completion classification', () => {
  it('repairs a complete answer carrying the provider unknown sentinel', () => {
    expect(normalizeStreamTerminalState({
      completionStatus: 'interrupted',
      finishReason: 'unknown',
      canContinue: false,
      hasAnswer: true,
    })).toEqual({
      completionStatus: 'complete',
      finishReason: 'provider_eof',
      canContinue: false,
    });
  });

  it('preserves a genuine partial interruption', () => {
    expect(normalizeStreamTerminalState({
      completionStatus: 'interrupted',
      finishReason: 'unknown',
      canContinue: true,
      hasAnswer: true,
    }).completionStatus).toBe('interrupted');
    expect(isConfirmedPartialInterruption({
      completionStatus: 'interrupted',
      canContinue: true,
    })).toBe(true);
  });

  it('never describes a non-continuable answer as a partial interruption', () => {
    expect(isConfirmedPartialInterruption({
      completionStatus: 'interrupted',
      canContinue: false,
    })).toBe(false);
  });
});
