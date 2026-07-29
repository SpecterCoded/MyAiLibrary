export const TYPEWRITER_INITIAL_BUFFER_MS = 360;
export const TYPEWRITER_INITIAL_BUFFER_UNITS = 6;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function findNextRevealBoundary(
  text: string,
  from: number,
  streamOpen: boolean,
): number {
  let cursor = from;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  while (cursor < text.length && !/\s/.test(text[cursor])) cursor += 1;

  // Provider chunks may end halfway through a word or Markdown marker. Keep
  // that fragment hidden until the next chunk makes the boundary authoritative.
  if (cursor === text.length && streamOpen && !/\s$/.test(text)) return from;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

export function countRevealUnits(
  text: string,
  from: number,
  streamOpen: boolean,
  limit = 40,
): number {
  let cursor = from;
  let count = 0;
  while (cursor < text.length && count < limit) {
    const next = findNextRevealBoundary(text, cursor, streamOpen);
    if (next === cursor) break;
    cursor = next;
    count += 1;
  }
  return count;
}

interface AdaptiveIntervalOptions {
  backlogUnits: number;
  observedMsPerUnit: number;
  streaming: boolean;
  minimumMs: number;
}

export function getAdaptiveRevealInterval({
  backlogUnits,
  observedMsPerUnit,
  streaming,
  minimumMs,
}: AdaptiveIntervalOptions): number {
  const observed = clamp(observedMsPerUnit || 70, 24, 220);

  if (!streaming) {
    if (backlogUnits > 24) return Math.max(minimumMs, observed * 0.42);
    if (backlogUnits > 8) return Math.max(minimumMs, observed * 0.58);
    return Math.max(minimumMs, observed * 0.72);
  }

  // Match the provider while a healthy reserve exists, slow down before the
  // reserve empties, and catch up gently if a large backlog accumulates.
  if (backlogUnits <= 2) {
    return clamp(Math.max(minimumMs, observed * 1.65), 72, 220);
  }
  if (backlogUnits <= 6) {
    return clamp(Math.max(minimumMs, observed * 1.28), 56, 180);
  }
  if (backlogUnits <= 14) {
    return clamp(Math.max(minimumMs, observed * 0.92), 34, 140);
  }
  return clamp(Math.max(minimumMs, observed * 0.62), minimumMs, 96);
}
