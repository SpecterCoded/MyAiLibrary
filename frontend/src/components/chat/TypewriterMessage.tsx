import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  countRevealUnits,
  findNextRevealBoundary,
  getAdaptiveRevealInterval,
  TYPEWRITER_INITIAL_BUFFER_MS,
  TYPEWRITER_INITIAL_BUFFER_UNITS,
} from './typewriterTiming';

interface TypewriterMessageProps {
  content: string;
  msgId: string;
  animate: boolean;
  streaming: boolean;
  speed?: number;
  formatTextContent: (text: string) => ReactNode;
}

export default function TypewriterMessage({
  content,
  msgId,
  animate,
  streaming,
  speed = 28,
  formatTextContent,
}: TypewriterMessageProps) {
  const completedKey = `streamed-${msgId}`;
  const wasCompleted = (() => {
    try {
      return Boolean(sessionStorage.getItem(completedKey));
    } catch {
      return false;
    }
  })();
  const shouldAnimate = animate && !wasCompleted;
  const initialText = shouldAnimate ? '' : content;
  const [displayedText, setDisplayedText] = useState(initialText);
  const [animationActive, setAnimationActive] = useState(shouldAnimate);
  const contentRef = useRef(content);
  const streamingRef = useRef(streaming);
  const visibleLengthRef = useRef(initialText.length);
  const previousAnimateRef = useRef(animate);
  const completedRef = useRef(wasCompleted);
  const pendingSinceRef = useRef<number | null>(shouldAnimate && content ? performance.now() : null);
  const lastArrivalAtRef = useRef<number | null>(content ? performance.now() : null);
  const lastContentLengthRef = useRef(content.length);
  const observedMsPerUnitRef = useRef(70);

  useEffect(() => {
    const now = performance.now();
    const previousLength = lastContentLengthRef.current;
    if (content.length > previousLength) {
      if (pendingSinceRef.current === null && visibleLengthRef.current < content.length) {
        pendingSinceRef.current = now;
      }
      if (lastArrivalAtRef.current !== null) {
        const elapsed = Math.max(1, now - lastArrivalAtRef.current);
        const addedCharacters = content.length - previousLength;
        const sampleMsPerUnit = Math.min(240, Math.max(20, (elapsed * 6) / addedCharacters));
        observedMsPerUnitRef.current =
          observedMsPerUnitRef.current * 0.72 + sampleMsPerUnit * 0.28;
      }
      lastArrivalAtRef.current = now;
    }
    lastContentLengthRef.current = content.length;
    contentRef.current = content;
    streamingRef.current = streaming;

    const animationJustStarted = animate && !previousAnimateRef.current;
    previousAnimateRef.current = animate;
    if (animationJustStarted) {
      completedRef.current = false;
      pendingSinceRef.current = visibleLengthRef.current < content.length ? now : null;
      try {
        sessionStorage.removeItem(completedKey);
      } catch {
        // Storage is optional; animation state still works in memory.
      }
      setAnimationActive(true);
      return;
    }

    if (!animationActive && (!animate || completedRef.current)) {
      visibleLengthRef.current = content.length;
      setDisplayedText(content);
    }
  }, [animate, animationActive, completedKey, content, streaming]);

  useEffect(() => {
    if (!animationActive) return;

    let previousTime: number | null = null;
    let accumulatedMs = 0;
    let rafId = 0;

    const finish = () => {
      const finalText = contentRef.current;
      visibleLengthRef.current = finalText.length;
      setDisplayedText(finalText);
      completedRef.current = true;
      pendingSinceRef.current = null;
      try {
        sessionStorage.setItem(completedKey, 'true');
      } catch {
        // Storage is optional; final synchronization still succeeds.
      }
      setAnimationActive(false);
    };

    const animate = (timestamp: number) => {
      if (previousTime === null) {
        previousTime = timestamp;
        rafId = requestAnimationFrame(animate);
        return;
      }

      const elapsed = Math.max(0, timestamp - previousTime);
      previousTime = timestamp;
      accumulatedMs += elapsed;

      const fullText = contentRef.current;
      if (visibleLengthRef.current > fullText.length) {
        visibleLengthRef.current = fullText.length;
        setDisplayedText(fullText);
      }

      const streamOpen = streamingRef.current;
      let nextLength = visibleLengthRef.current;
      let backlogUnits = countRevealUnits(fullText, nextLength, streamOpen);
      const pendingFor =
        pendingSinceRef.current === null ? 0 : timestamp - pendingSinceRef.current;
      const buildingInitialReserve =
        streamOpen
        && nextLength === 0
        && backlogUnits < TYPEWRITER_INITIAL_BUFFER_UNITS
        && pendingFor < TYPEWRITER_INITIAL_BUFFER_MS;

      while (!buildingInitialReserve && nextLength < fullText.length) {
        const interval = getAdaptiveRevealInterval({
          backlogUnits,
          observedMsPerUnit: observedMsPerUnitRef.current,
          streaming: streamOpen,
          minimumMs: speed,
        });
        if (accumulatedMs < interval) break;
        const boundary = findNextRevealBoundary(fullText, nextLength, streamOpen);
        if (boundary === nextLength) break;
        nextLength = boundary;
        accumulatedMs -= interval;
        backlogUnits = Math.max(0, backlogUnits - 1);
      }

      if (nextLength !== visibleLengthRef.current) {
        visibleLengthRef.current = nextLength;
        setDisplayedText(fullText.slice(0, nextLength));
      } else if (nextLength >= fullText.length) {
        accumulatedMs = 0;
      }

      if (streamOpen || visibleLengthRef.current < fullText.length) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      finish();
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [animationActive, completedKey, speed]);

  return (
    <div className="max-w-none transition-all duration-300">
      {formatTextContent(displayedText)}
    </div>
  );
}
