export const TYPEWRITER_INITIAL_BUFFER_MIN_MS = 800;
export const TYPEWRITER_INITIAL_BUFFER_MAX_MS = 1200;
export const TYPEWRITER_TARGET_RESERVE_MS = 2000;

const MIN_REVEAL_RATE = 8;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Keep only the provider's unfinished trailing fragment hidden. Everything
 * before this limit is authoritative and can be animated grapheme-by-grapheme.
 */
export function getSafeRevealLimit(text: string, streamOpen: boolean): number {
  if (!streamOpen || text.length === 0 || /\s$/.test(text)) return text.length;

  for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
    if (/\s/.test(text[cursor])) return cursor + 1;
  }
  return 0;
}

/**
 * Advance without splitting emoji, combining marks, or surrogate pairs.
 */
export function advanceByGraphemes(
  text: string,
  from: number,
  count: number,
  limit = text.length,
): number {
  if (count <= 0 || from >= limit) return Math.min(from, limit);

  const remaining = text.slice(from, limit);
  if (!remaining) return from;

  if (graphemeSegmenter) {
    let consumed = 0;
    let boundary = from;
    for (const segment of graphemeSegmenter.segment(remaining)) {
      boundary = from + segment.index + segment.segment.length;
      consumed += 1;
      if (consumed >= count) return boundary;
    }
    return limit;
  }

  let boundary = from;
  for (const codePoint of Array.from(remaining).slice(0, count)) {
    boundary += codePoint.length;
  }
  return Math.min(boundary, limit);
}

interface InitialReserveOptions {
  pendingForMs: number;
  backlogCharacters: number;
  preferredCharactersPerSecond: number;
  streaming: boolean;
  hasVisibleText: boolean;
}

export function shouldBuildInitialReserve({
  pendingForMs,
  backlogCharacters,
  preferredCharactersPerSecond,
  streaming,
  hasVisibleText,
}: InitialReserveOptions): boolean {
  if (!streaming || hasVisibleText || backlogCharacters <= 0) return false;
  if (pendingForMs < TYPEWRITER_INITIAL_BUFFER_MIN_MS) return true;
  if (pendingForMs >= TYPEWRITER_INITIAL_BUFFER_MAX_MS) return false;

  const reserveTarget = Math.max(
    1,
    (preferredCharactersPerSecond * TYPEWRITER_TARGET_RESERVE_MS) / 1000,
  );
  return backlogCharacters < reserveTarget;
}

interface AdaptiveRateOptions {
  backlogCharacters: number;
  preferredCharactersPerSecond: number;
  streaming: boolean;
  maximumCharactersPerSecond: number;
}

/**
 * Maintain a display-time reserve while the provider is open. The caller
 * eases toward this target so rate changes never become visible jumps.
 */
export function getAdaptiveRevealRate({
  backlogCharacters,
  preferredCharactersPerSecond,
  streaming,
  maximumCharactersPerSecond,
}: AdaptiveRateOptions): number {
  const maximumRate = Math.max(MIN_REVEAL_RATE, maximumCharactersPerSecond);
  const preferredRate = clamp(
    preferredCharactersPerSecond || maximumRate,
    MIN_REVEAL_RATE,
    maximumRate,
  );

  if (!streaming) {
    return clamp(preferredRate * 1.12, MIN_REVEAL_RATE, maximumRate);
  }

  const reserveMs = (Math.max(0, backlogCharacters) / preferredRate) * 1000;
  let multiplier = 1;
  if (reserveMs < 500) multiplier = 0.28;
  else if (reserveMs < 1000) multiplier = 0.48;
  else if (reserveMs < TYPEWRITER_TARGET_RESERVE_MS) multiplier = 0.72;
  else if (reserveMs < 3000) multiplier = 0.92;
  else multiplier = 1.08;

  return clamp(preferredRate * multiplier, MIN_REVEAL_RATE, maximumRate);
}

export function easeRevealRate(
  currentRate: number,
  targetRate: number,
  elapsedMs: number,
): number {
  const blend = 1 - Math.exp(-Math.max(0, elapsedMs) / 320);
  return currentRate + (targetRate - currentRate) * blend;
}

export function getTimelineCatchUpGraphemes(
  timelineStartedAt: number | undefined,
  now: number,
  charactersPerSecond: number,
): number {
  if (!timelineStartedAt || timelineStartedAt > now) return 0;
  const activeElapsedMs = Math.max(
    0,
    now - timelineStartedAt - TYPEWRITER_INITIAL_BUFFER_MIN_MS,
  );
  return Math.floor((activeElapsedMs * Math.max(0, charactersPerSecond)) / 1000);
}
