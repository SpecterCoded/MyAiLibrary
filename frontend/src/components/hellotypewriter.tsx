'use client'
import React, { useState, useEffect } from 'react';

interface TypewriterTextProps {
  text?: string;
  speed?: number;
  deleteSpeed?: number;
  pauseDuration?: number;
  startDelay?: number;
  loop?: boolean;
  className?: string;
  showCursor?: boolean;
}

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text = "Building the future, one line at a time...",
  speed = 100,
  deleteSpeed = 50,
  pauseDuration = 2000,
  startDelay = 0,
  loop = true,
  className = "",
  showCursor = true
}) => {
  const [displayText, setDisplayText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (!hasStarted) {
      timeout = setTimeout(() => {
        setHasStarted(true);
      }, startDelay);
      return () => clearTimeout(timeout);
    }

    if (isPaused) {
      timeout = setTimeout(() => {
        setIsPaused(false);
        if (loop) {
          setIsDeleting(true);
        }
      }, pauseDuration);
    } else if (isDeleting) {
      if (displayText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayText(text.substring(0, displayText.length - 1));
        }, deleteSpeed);
      } else {
        setIsDeleting(false);
      }
    } else {
      // Typing
      if (displayText.length < text.length) {
        timeout = setTimeout(() => {
          setDisplayText(text.substring(0, displayText.length + 1));
        }, speed);
      } else if (loop) {
        setIsPaused(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, isPaused, text, speed, deleteSpeed, pauseDuration, loop, hasStarted, startDelay]);

  return (
    <div className={`${className}`}>
      <span>
        {displayText}
        {showCursor && (
          <span className="text-blue-500 animate-pulse">
            |
          </span>
        )}
      </span>
    </div>
  );
};

export default function TypewriterView() {
  return (
      <TypewriterText />
  );
}
