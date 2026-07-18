'use client';

import * as React from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "../../lib/utils";

// Local replacement for shadcn Button to avoid missing dependency
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
>(({ className, variant, ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none border border-slate-700/60 bg-transparent hover:bg-slate-800 text-slate-100 size-9 cursor-pointer",
        className
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

interface VoiceMessageBubbleProps {
  audioSrc: string
  duration?: number
  bubbleColor?: string
  waveColor?: string
  className?: string
}

export default function VoiceMessageBubble({
  audioSrc,
  duration,
  bubbleColor = "#fff",
  waveColor = "#000",
  className,
}: VoiceMessageBubbleProps) {
  const [audio] = React.useState(new Audio(audioSrc))
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [realDuration, setRealDuration] = React.useState<number | null>(null)
  const [barHeights] = React.useState(() =>
    Array.from({ length: 30 }, () => 4 + Math.random() * 12)
  )

  React.useEffect(() => {
    const handleTimeUpdate = () => {
      setProgress((audio.currentTime / audio.duration) * 100)
    }
    const handleLoadedMetadata = () => {
      setRealDuration(audio.duration)
    }

    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.pause()
    }
  }, [audio])

  const togglePlay = () => {
    if (isPlaying) audio.pause()
    else audio.play()
    setIsPlaying(!isPlaying)
  }

  const isDark = bubbleColor !== "#fff" && bubbleColor !== "#ffffff" && bubbleColor !== "white";

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl shadow-sm min-w-[320px] max-w-full",
        className
      )}
      style={{ backgroundColor: bubbleColor }}
    >
      {/* Play/Pause Button */}
      <Button
        variant="outline"
        className={cn(
          "p-2 rounded-full flex items-center justify-center border transition-colors size-9 cursor-pointer",
          isDark 
            ? "border-slate-700/60 bg-transparent hover:bg-slate-800 text-slate-200" 
            : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800"
        )}
        onClick={togglePlay}
      >
        {isPlaying 
          ? <Pause className={cn("w-4 h-4", isDark ? "text-slate-200" : "text-slate-800")} /> 
          : <Play className={cn("w-4 h-4 fill-current", isDark ? "text-slate-200" : "text-slate-800")} />
        }
      </Button>

      {/* Waveform */}
      <div className="flex-1 h-6 relative cursor-pointer" onClick={(e) => {
        const rect = (e.target as HTMLDivElement).getBoundingClientRect()
        const clickX = e.clientX - rect.left
        audio.currentTime = (clickX / rect.width) * audio.duration
      }}>
        <div className="absolute inset-0 flex justify-between items-center px-0.5 pointer-events-none">
          {Array.from({ length: 30 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-sm"
              style={{
                width: 2,
                height: `${barHeights[idx]}px`,
                backgroundColor: waveColor,
              }}
            />
          ))}
        </div>

        {/* Progress Overlay */}
        <div
          className="absolute top-0 left-0 h-full rounded-sm pointer-events-none"
          style={{
            width: `${progress}%`,
            backgroundColor: waveColor,
            opacity: 0.3,
          }}
        />
      </div>

      {/* Duration */}
      <span className={cn("text-sm font-mono select-none", isDark ? "text-slate-300" : "text-slate-700")}>
        {Math.round(realDuration ?? duration ?? 0)}s
      </span>
    </div>
  )
}
