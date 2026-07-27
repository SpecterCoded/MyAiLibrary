import { useEffect, useRef, useState, type ReactNode } from 'react';

interface TypewriterMessageProps {
  content: string;
  msgId: string;
  isLatest: boolean;
  speed?: number;
  formatTextContent: (text: string) => ReactNode;
}

export default function TypewriterMessage({
  content,
  msgId,
  isLatest,
  speed = 28,
  formatTextContent,
}: TypewriterMessageProps) {
  const completedKey = `streamed-${msgId}`;
  const shouldAnimate = isLatest && !sessionStorage.getItem(completedKey);
  const initialText = shouldAnimate ? '' : content;
  const [displayedText, setDisplayedText] = useState(initialText);
  const contentRef = useRef(content);
  const streamingRef = useRef(isLatest);
  const visibleLengthRef = useRef(initialText.length);
  const animationStartedRef = useRef(shouldAnimate);

  // Keep the animation loop connected to the latest provider chunk without
  // restarting (and visually resetting) the loop for every content update.
  useEffect(() => {
    contentRef.current = content;
    streamingRef.current = isLatest;
  }, [content, isLatest]);

  useEffect(() => {
    if (isLatest && !animationStartedRef.current) {
      animationStartedRef.current = true;
      try {
        sessionStorage.removeItem(completedKey);
      } catch {
        // Storage is optional; continuation animation still works in memory.
      }
    }

    if (!animationStartedRef.current) {
      return;
    }
    let previousTime: number | null = null;
    let accumulatedMs = 0;
    let rafId = 0;

    const findNextWordBoundary = (text: string, from: number, streamOpen: boolean) => {
      let cursor = from;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      while (cursor < text.length && !/\s/.test(text[cursor])) cursor += 1;

      // Do not flash an unfinished provider token. Once the stream closes, the
      // remaining fragment is authoritative and can be revealed normally.
      if (cursor === text.length && streamOpen && !/\s$/.test(text)) return from;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      return cursor;
    };

    const finish = () => {
      const finalText = contentRef.current;
      visibleLengthRef.current = finalText.length;
      setDisplayedText(finalText);
      animationStartedRef.current = false;
      try {
        sessionStorage.setItem(completedKey, 'true');
      } catch {
        // Storage is optional; the exact final synchronization still succeeds.
      }
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

      let nextLength = visibleLengthRef.current;
      while (accumulatedMs >= speed && nextLength < fullText.length) {
        const boundary = findNextWordBoundary(fullText, nextLength, streamingRef.current);
        if (boundary === nextLength) break;
        nextLength = boundary;
        accumulatedMs -= speed;
      }

      if (nextLength !== visibleLengthRef.current) {
        visibleLengthRef.current = nextLength;
        setDisplayedText(fullText.slice(0, nextLength));
      } else if (nextLength >= fullText.length) {
        // Never bank idle time while caught up. Banking it caused later chunks
        // to burst onto screen instead of being typed.
        accumulatedMs = 0;
      }

      if (streamingRef.current || visibleLengthRef.current < fullText.length) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      finish();
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [completedKey, isLatest, speed]);

  return (
    <div className="max-w-none transition-all duration-300">
      {formatTextContent(displayedText)}
    </div>
  );
}
