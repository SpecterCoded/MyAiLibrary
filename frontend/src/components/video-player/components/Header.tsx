import { ChevronLeft, Folder, Calendar, Clock, List } from "lucide-react";

interface HeaderProps {
  title?: string;
  folderPath?: string;
  createdAt?: string;
  durationSeconds?: number;
  chaptersCount?: number;
  subchaptersCount?: number;
  onBack?: () => void;
  pendingReindex?: boolean | string;
}

const formatDuration = (seconds?: number) => {
  if (!seconds) return "0 min";
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${weekday} — ${monthDay}`;
};

export function Header({
  title = "Product team standup",
  folderPath = "No Folder Selected",
  createdAt,
  durationSeconds,
  chaptersCount = 0,
  subchaptersCount = 0,
  onBack,
  pendingReindex = false
}: HeaderProps) {
  return (
    <div className="flex items-start justify-between px-8 py-6 pb-8 bg-[#eaeaea] dark:bg-[#2b2d31] text-slate-800 dark:text-slate-100 flex-shrink-0 relative z-0">
      <div className="flex items-start gap-4">
        <button 
          onClick={onBack}
          className="p-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-slate-700 dark:text-slate-200 shadow-xs"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h1>
            {pendingReindex && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Needs Re-index
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 font-semibold">
            <div className="flex items-center gap-1.5">
              <Folder size={14} className="text-slate-500 dark:text-slate-400" />
              <span>{folderPath}</span>
            </div>
            {createdAt && (
              <div className="flex items-center gap-1.5">
                <Calendar size={14} className="text-slate-500 dark:text-slate-400" />
                <span>{formatDate(createdAt)}</span>
              </div>
            )}
            {durationSeconds !== undefined && durationSeconds > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock size={14} className="text-slate-500 dark:text-slate-400" />
                <span>{formatDuration(durationSeconds)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <List size={14} className="text-slate-500 dark:text-slate-400" />
              <span>{chaptersCount + subchaptersCount} Chapters</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
