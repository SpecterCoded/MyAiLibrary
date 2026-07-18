import { CheckCircle2, XCircle, Check, X, ChevronDown, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import type React from "react";

type QuizOptionButtonProps = {
  option: string;
  index: number;
  selected: boolean;
  submitted: boolean;
  correct: boolean;
  onSelect: () => void;
};

const optionBase =
  "w-full min-h-14 rounded-xl border px-4 py-3.5 text-left text-sm md:text-base font-bold font-sans outline-none transition-colors duration-200";

export function QuizOptionButton({
  option,
  index,
  selected,
  submitted,
  correct,
  onSelect,
}: QuizOptionButtonProps) {
  const wrongSelected = submitted && selected && !correct;
  const stateClass = submitted
    ? correct
      ? "border-emerald-400 dark:border-emerald-500/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 shadow-sm ring-2 ring-emerald-100 dark:ring-emerald-500/20"
      : wrongSelected
        ? "border-rose-400 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 shadow-sm ring-2 ring-rose-100 dark:ring-rose-500/20"
        : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500 opacity-45"
    : selected
      ? "border-slate-800 dark:border-slate-400 bg-slate-50 dark:bg-slate-700 text-slate-950 dark:text-slate-100 shadow-sm ring-2 ring-slate-800/15 dark:ring-slate-400/20"
      : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-slate-700";

  const markerClass = submitted
    ? correct
      ? "border-emerald-500 bg-emerald-500 text-white"
      : wrongSelected
        ? "border-rose-500 bg-rose-500 text-white"
        : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-700 text-slate-400 dark:text-slate-500"
    : selected
      ? "border-slate-800 dark:border-slate-400 bg-slate-900 dark:bg-slate-400 text-white"
      : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400";

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      disabled={submitted}
      className={`${optionBase} ${stateClass} ${submitted ? "cursor-default" : "cursor-pointer"}`}
      whileHover={!submitted ? { y: -1 } : undefined}
      whileTap={!submitted ? { scale: 0.985 } : undefined}
      animate={
        wrongSelected
          ? { x: [0, -7, 7, -4, 4, 0] }
          : correct && submitted
            ? { scale: [1, 1.025, 1] }
            : { x: 0, scale: 1 }
      }
      transition={
        wrongSelected
          ? { duration: 0.38, ease: "easeOut" }
          : { type: "spring", stiffness: 420, damping: 24 }
      }
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold font-mono shadow-sm transition-colors ${markerClass}`}
        >
          {submitted && correct ? (
            <Check size={18} strokeWidth={3} className="shrink-0" />
          ) : wrongSelected ? (
            <X size={18} strokeWidth={3} className="shrink-0" />
          ) : (
            String.fromCharCode(65 + index)
          )}
        </span>
        <span className="min-w-0 flex-1 leading-snug">{option}</span>
      </span>
    </motion.button>
  );
}

export function QuizFeedbackCard({
  correct,
  explanation,
}: {
  correct: boolean;
  explanation: string;
}) {
  const Icon = correct ? Check : X;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 360, damping: 28 }}
      className={`mt-5 rounded-xl border p-4 leading-relaxed ${
        correct
          ? "border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-900/20"
          : "border-rose-100 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-900/20"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${correct ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
          <Icon size={14} strokeWidth={3} />
        </span>
        <span
          className={`text-xs font-extrabold uppercase tracking-wider font-sans ${
            correct ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"
          }`}
        >
          {correct ? "Correct" : "Incorrect"}
        </span>
      </div>
      <p className="text-[13px] font-medium leading-relaxed text-slate-650 dark:text-slate-300">{explanation}</p>
    </motion.div>
  );
}

export function TranscriptMetaBadge({
  children,
  onClick,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const badgeClass = `inline-flex h-5 items-center justify-center rounded-md border border-indigo-100/80 dark:border-indigo-400/30 bg-indigo-50 dark:bg-indigo-500/15 px-1.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 shadow-sm align-middle select-none whitespace-nowrap transition-colors ${
    onClick ? "cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-500/25 hover:text-indigo-900 dark:hover:text-indigo-200" : ""
  } ${className}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={badgeClass}>
        {children}
      </button>
    );
  }

  return (
    <span title={title} className={badgeClass}>
      {children}
    </span>
  );
}

export function TranscriptChapterHeader({
  title,
  timeLabel,
  collapsed,
  onToggle,
  onSeek,
}: {
  title: string;
  timeLabel: string;
  collapsed: boolean;
  onToggle: (event: React.MouseEvent) => void;
  onSeek?: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-2 border-b border-slate-100 pb-2 select-none dark:border-white/5">
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
        title={collapsed ? "Expand chapter" : "Collapse chapter"}
      >
        <ChevronDown size={14} className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-0"}`} />
      </button>
      <button
        type="button"
        onClick={onSeek}
        className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-opacity hover:opacity-80 cursor-pointer"
        title="Jump to chapter"
      >
        <span className="inline-flex h-6 items-center gap-1 rounded-md border border-indigo-100/80 dark:border-indigo-400/30 bg-indigo-50 dark:bg-indigo-500/15 px-2 text-[10px] font-extrabold uppercase text-indigo-700 dark:text-indigo-300 shadow-sm font-sans">
          <BookOpen size={11} />
          Chapter
        </span>
        <span className="min-w-0 truncate text-xs font-bold text-slate-600 dark:text-slate-350 font-sans">
          {title}
        </span>
      </button>
    </div>
  );
}
