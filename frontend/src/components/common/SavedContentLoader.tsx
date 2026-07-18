import React, { useEffect, useState } from "react";

const SAVED_CONTENT_LOADER_MS = 1800;

interface SavedContentLoaderProps {
  message: string;
  className?: string;
}

export function SavedContentLoader({ message, className = "" }: SavedContentLoaderProps) {
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <div
      className={`flex-1 min-h-[280px] flex flex-col items-center justify-center ${className}`}
      style={{ animation: "savedLoaderFadeIn 0.25s ease-out forwards" }}
    >
      {/* Embedded SVG gradient definition */}
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <linearGradient id="savedPurpleGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="40%" stopColor="#9333ea" />
            <stop offset="100%" stopColor="#7e22ce" />
          </linearGradient>
        </defs>
      </svg>

      <style>{savedKeyframesCSS}</style>

      {/* Ambient glow */}
      <div style={savedStyles.ambientGlow} />

      {/* Glassmorphism panel */}
      <div style={{
        ...savedStyles.glassLoaderPanel,
        background: isDark ? "rgba(30, 31, 34, 0.9)" : "rgba(255, 255, 255, 0.9)",
        border: isDark ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid rgba(209, 213, 219, 0.8)",
        boxShadow: isDark
          ? "0 8px 32px rgba(147, 51, 234, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3)"
          : "0 8px 32px rgba(147, 51, 234, 0.1), 0 2px 8px rgba(0, 0, 0, 0.04)",
      }}>
        <div style={savedStyles.sparkleLogoGroup}>
          {/* Top Left Small Sparkle */}
          <svg style={{ ...savedStyles.sparkleSvg, ...savedStyles.sparkleSub1 }} viewBox="0 0 24 24">
            <path d="M12 0C12 7 7 12 0 12C7 12 12 17 12 24C12 17 17 12 24 12C17 12 12 7 12 0Z" />
          </svg>
          {/* Center Big Sparkle */}
          <svg style={{ ...savedStyles.sparkleSvg, ...savedStyles.sparkleMain }} viewBox="0 0 24 24">
            <path d="M12 0C12 7 7 12 0 12C7 12 12 17 12 24C12 17 17 12 24 12C17 12 12 7 12 0Z" />
          </svg>
          {/* Bottom Right Small Sparkle */}
          <svg style={{ ...savedStyles.sparkleSvg, ...savedStyles.sparkleSub2 }} viewBox="0 0 24 24">
            <path d="M12 0C12 7 7 12 0 12C7 12 12 17 12 24C12 17 17 12 24 12C17 12 12 7 12 0Z" />
          </svg>
        </div>
      </div>

      <p className={`text-base font-bold tracking-tight mt-6 ${isDark ? "text-neutral-300" : "text-neutral-600"}`}>
        {message}
      </p>
    </div>
  );
}

const savedStyles: Record<string, React.CSSProperties> = {
  ambientGlow: {
    position: "absolute",
    width: "300px",
    height: "300px",
    background: "radial-gradient(circle, rgba(147, 51, 234, 0.18) 0%, transparent 70%)",
    filter: "blur(40px)",
    pointerEvents: "none",
  },
  glassLoaderPanel: {
    position: "relative",
    width: "180px",
    height: "150px",
    background: "rgba(255, 255, 255, 0.9)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(209, 213, 219, 0.8)",
    borderRadius: "20px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    boxShadow: "0 8px 32px rgba(147, 51, 234, 0.1), 0 2px 8px rgba(0, 0, 0, 0.04)",
  },
  sparkleLogoGroup: {
    position: "relative",
    width: "80px",
    height: "80px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  sparkleSvg: {
    position: "absolute",
    fill: "url(#savedPurpleGlowGrad)",
    filter: "drop-shadow(0 0 12px rgba(147, 51, 234, 0.7)) drop-shadow(0 0 24px rgba(147, 51, 234, 0.35))",
  },
  sparkleMain: {
    width: "48px",
    height: "48px",
    zIndex: 2,
    animation: "savedPulseMain 1.4s ease-in-out infinite",
  },
  sparkleSub1: {
    width: "20px",
    height: "20px",
    top: "12px",
    left: "12px",
    zIndex: 1,
    animation: "savedPulseSubOne 1.4s ease-in-out infinite",
    animationDelay: "0.2s",
  },
  sparkleSub2: {
    width: "16px",
    height: "16px",
    bottom: "14px",
    right: "14px",
    zIndex: 1,
    animation: "savedPulseSubTwo 1.4s ease-in-out infinite",
    animationDelay: "0.4s",
  },
};

const savedKeyframesCSS = `
  @keyframes savedLoaderFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes savedPulseMain {
    0%, 100% { transform: scale(0.9) rotate(0deg); opacity: 0.8; }
    50% { transform: scale(1.08) rotate(4deg); opacity: 1; }
  }
  @keyframes savedPulseSubOne {
    0%, 100% { transform: scale(0.85) translate(0, 0); opacity: 0.6; }
    50% { transform: scale(1.15) translate(-1px, -1px); opacity: 1; }
  }
  @keyframes savedPulseSubTwo {
    0%, 100% { transform: scale(0.8) translate(0, 0); opacity: 0.5; }
    50% { transform: scale(1.15) translate(1px, 1px); opacity: 1; }
  }
`;

interface SavedContentRevealProps {
  children: React.ReactNode;
  className?: string;
}

export function SavedContentReveal({ children, className = "" }: SavedContentRevealProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0%",
        minHeight: 0,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
        filter: visible ? "blur(0px)" : "blur(4px)",
        transition: "opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), filter 0.35s ease-out",
      }}
    >
      {children}
    </div>
  );
}

export async function holdSavedContentLoader(startedAt: number, minMs = SAVED_CONTENT_LOADER_MS) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) {
    await new Promise(resolve => setTimeout(resolve, minMs - elapsed));
  }
}
