import { useState, useEffect, useRef, type ReactNode } from 'react';

interface TypewriterMessageProps {
  content: string;
  msgId: string;
  isLatest: boolean;
  speed?: number;
  formatTextContent: (text: string) => ReactNode;
}

export default function TypewriterMessage({ content, msgId, isLatest, speed = 28, formatTextContent }: TypewriterMessageProps) {
  const [displayedText, setDisplayedText] = useState(() => {
    // History messages or already-completed streams → show instantly
    if (!isLatest) return content;
    const completed = sessionStorage.getItem(`streamed-${msgId}`);
    return completed ? content : '';
  });

  // Always up-to-date refs so the animation loop reads the latest values
  // without those values being useEffect dependencies (which would restart the loop)
  const contentRef = useRef(content);
  contentRef.current = content;

  const isLatestRef = useRef(isLatest);
  isLatestRef.current = isLatest;

  useEffect(() => {
    // History message on mount: show immediately, no animation needed
    if (!isLatestRef.current) {
      setDisplayedText(contentRef.current);
      return;
    }

    const completed = sessionStorage.getItem(`streamed-${msgId}`);
    if (completed) {
      setDisplayedText(contentRef.current);
      return;
    }

    // Characters per millisecond — derived from the legacy `speed` prop
    // which was ms-per-word. Assuming ~5 chars/word, convert to chars/ms.
    const charsPerMs = 1 / (speed * 0.2);

    let startTime: number | null = null;
    let rafId: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const targetChars = Math.floor(elapsed * charsPerMs);

      const fullText = contentRef.current;
      const charsToShow = Math.min(targetChars, fullText.length);

      setDisplayedText(fullText.slice(0, charsToShow));

      if (charsToShow < fullText.length) {
        // More characters to show — schedule next frame
        rafId = requestAnimationFrame(animate);
      } else {
        // Animation complete — mark as streamed so future remounts skip animation
        try {
          sessionStorage.setItem(`streamed-${msgId}`, 'true');
        } catch (e) {
          console.error(e);
        }
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
    };
    // isLatest intentionally excluded: we don't want to kill the animation
    // when isTyping flips to false (streaming end). The animation reads
    // the latest values via refs and finishes naturally on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgId, speed]);

  return (
    <div className="max-w-none transition-all duration-300">
      {formatTextContent(displayedText)}
    </div>
  );
}
