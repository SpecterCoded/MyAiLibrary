import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  advanceByGraphemes,
  easeRevealRate,
  getAdaptiveRevealRate,
  getSafeRevealLimit,
  getTimelineCatchUpGraphemes,
  shouldBuildInitialReserve,
} from './typewriterTiming';

interface TypewriterMessageProps {
  content: string;
  msgId: string;
  animate: boolean;
  streaming: boolean;
  speed?: number;
  timelineStartedAt?: number;
  formatTextContent: (text: string) => ReactNode;
}

const typewriterProgress = new Map<
  string,
  { visibleLength: number; updatedAt: number }
>();

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export default function TypewriterMessage({
  content,
  msgId,
  animate,
  streaming,
  speed = 12,
  timelineStartedAt,
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
  const maximumInitialRate = clamp(1000 / Math.max(1, speed), 8, 90);
  const storedProgress = typewriterProgress.get(msgId);
  const timelineCatchUp = getTimelineCatchUpGraphemes(
    timelineStartedAt,
    Date.now(),
    maximumInitialRate,
  );
  const safeInitialLimit = getSafeRevealLimit(content, streaming);
  const caughtUpLength = advanceByGraphemes(
    content,
    0,
    timelineCatchUp,
    safeInitialLimit,
  );
  const initialVisibleLength = shouldAnimate
    ? Math.min(
        safeInitialLimit,
        Math.max(storedProgress?.visibleLength || 0, caughtUpLength),
      )
    : content.length;
  const initialText = content.slice(0, initialVisibleLength);
  const [displayedText, setDisplayedText] = useState(initialText);
  const [animationActive, setAnimationActive] = useState(shouldAnimate);
  const contentRef = useRef(content);
  const streamingRef = useRef(streaming);
  const visibleLengthRef = useRef(initialVisibleLength);
  const previousAnimateRef = useRef(animate);
  const completedRef = useRef(wasCompleted);
  const pendingSinceRef = useRef<number | null>(
    shouldAnimate && content ? performance.now() : null,
  );
  const lastArrivalAtRef = useRef<number | null>(content ? performance.now() : null);
  const lastContentLengthRef = useRef(content.length);
  const observedCharactersPerSecondRef = useRef(50);
  const currentRevealRateRef = useRef(clamp(1000 / Math.max(1, speed), 8, 90));

  useEffect(() => {
    const now = performance.now();
    const previousLength = lastContentLengthRef.current;
    if (content.length > previousLength) {
      if (pendingSinceRef.current === null && visibleLengthRef.current < content.length) {
        pendingSinceRef.current = now;
      }
      if (lastArrivalAtRef.current !== null) {
        const elapsedSeconds = Math.max(0.001, (now - lastArrivalAtRef.current) / 1000);
        const addedCharacters = content.length - previousLength;
        const sampleRate = clamp(addedCharacters / elapsedSeconds, 6, 180);
        observedCharactersPerSecondRef.current =
          observedCharactersPerSecondRef.current * 0.76 + sampleRate * 0.24;
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
      currentRevealRateRef.current = clamp(1000 / Math.max(1, speed), 8, 90);
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
  }, [animate, animationActive, completedKey, content, speed, streaming]);

  useEffect(() => {
    if (!animationActive) return;

    let previousTime: number | null = null;
    let accumulatedGraphemes = 0;
    let rafId = 0;

    const finish = () => {
      const finalText = contentRef.current;
      visibleLengthRef.current = finalText.length;
      setDisplayedText(finalText);
      completedRef.current = true;
      pendingSinceRef.current = null;
      typewriterProgress.delete(msgId);
      try {
        sessionStorage.setItem(completedKey, 'true');
      } catch {
        // Storage is optional; final synchronization still succeeds.
      }
      setAnimationActive(false);
    };

    const animateFrame = (timestamp: number) => {
      if (previousTime === null) {
        previousTime = timestamp;
        rafId = requestAnimationFrame(animateFrame);
        return;
      }

      const actualElapsed = Math.max(0, timestamp - previousTime);
      const easingElapsed = Math.min(100, actualElapsed);
      previousTime = timestamp;

      const fullText = contentRef.current;
      if (visibleLengthRef.current > fullText.length) {
        visibleLengthRef.current = fullText.length;
        setDisplayedText(fullText);
      }

      const streamOpen = streamingRef.current;
      const safeLimit = getSafeRevealLimit(fullText, streamOpen);
      const backlogCharacters = Math.max(0, safeLimit - visibleLengthRef.current);
      const maximumRate = clamp(1000 / Math.max(1, speed), 8, 90);
      const preferredRate = clamp(
        observedCharactersPerSecondRef.current * 1.15,
        24,
        maximumRate,
      );
      const pendingFor =
        pendingSinceRef.current === null ? 0 : timestamp - pendingSinceRef.current;
      const buildingInitialReserve = shouldBuildInitialReserve({
        pendingForMs: pendingFor,
        backlogCharacters,
        preferredCharactersPerSecond: preferredRate,
        streaming: streamOpen,
        hasVisibleText: visibleLengthRef.current > 0,
      });

      if (!buildingInitialReserve && backlogCharacters > 0) {
        const targetRate = getAdaptiveRevealRate({
          backlogCharacters,
          preferredCharactersPerSecond: preferredRate,
          streaming: streamOpen,
          maximumCharactersPerSecond: maximumRate,
        });
        currentRevealRateRef.current = easeRevealRate(
          currentRevealRateRef.current,
          targetRate,
          easingElapsed,
        );
        accumulatedGraphemes += (actualElapsed * currentRevealRateRef.current) / 1000;

        const graphemesToReveal =
          actualElapsed > 250
            ? Math.floor(accumulatedGraphemes)
            : Math.min(4, Math.floor(accumulatedGraphemes));
        if (graphemesToReveal > 0) {
          const nextLength = advanceByGraphemes(
            fullText,
            visibleLengthRef.current,
            graphemesToReveal,
            safeLimit,
          );
          if (nextLength > visibleLengthRef.current) {
            visibleLengthRef.current = nextLength;
            accumulatedGraphemes -= graphemesToReveal;
            typewriterProgress.set(msgId, {
              visibleLength: nextLength,
              updatedAt: Date.now(),
            });
            setDisplayedText(fullText.slice(0, nextLength));
          }
        }
      } else {
        // Do not build up a burst while waiting for the reserve or provider.
        accumulatedGraphemes = Math.min(accumulatedGraphemes, 0.75);
      }

      if (streamOpen || visibleLengthRef.current < fullText.length) {
        rafId = requestAnimationFrame(animateFrame);
        return;
      }

      finish();
    };

    rafId = requestAnimationFrame(animateFrame);
    return () => {
      cancelAnimationFrame(rafId);
      if (!completedRef.current) {
        typewriterProgress.set(msgId, {
          visibleLength: visibleLengthRef.current,
          updatedAt: Date.now(),
        });
      }
    };
  }, [animationActive, completedKey, msgId, speed]);

  return (
    <div className="max-w-none transition-all duration-300">
      {formatTextContent(displayedText)}
    </div>
  );
}
