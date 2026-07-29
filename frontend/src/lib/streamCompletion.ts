interface StreamTerminalStateInput {
  completionStatus?: string | null;
  finishReason?: string | null;
  canContinue?: boolean | null;
  hasAnswer: boolean;
}

interface StreamTerminalState {
  completionStatus: string;
  finishReason: string;
  canContinue: boolean;
}

const INDETERMINATE_FINISH_REASONS = new Set(['', 'unknown', 'none', 'null']);

export function normalizeStreamTerminalState({
  completionStatus,
  finishReason,
  canContinue,
  hasAnswer,
}: StreamTerminalStateInput): StreamTerminalState {
  const normalizedStatus = completionStatus || 'complete';
  const normalizedReason = String(finishReason || '').trim().toLowerCase();
  const continuable = Boolean(canContinue);
  const cleanUnknownEof =
    hasAnswer
    && normalizedStatus === 'interrupted'
    && !continuable
    && INDETERMINATE_FINISH_REASONS.has(normalizedReason);

  return {
    completionStatus: cleanUnknownEof ? 'complete' : normalizedStatus,
    finishReason: cleanUnknownEof ? 'provider_eof' : finishReason || 'stop',
    canContinue: continuable,
  };
}

export function isConfirmedPartialInterruption(
  details?: { completionStatus?: string | null; canContinue?: boolean | null },
): boolean {
  return details?.completionStatus === 'interrupted' && details.canContinue !== false;
}
