import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { revealPath } from '../utils/desktop';
import {
  Download,
  Upload,
  CloudUpload,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  X,
  RefreshCw,
  Inbox,
  Plus,
  PlayCircle,
  ExternalLink,
  AlertTriangle,
  Zap,
  FolderOpen,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface Task {
  id: string;
  url: string;
  status: TaskStatus;
  progress: number;
  file_name: string | null;
  error_message: string | null;
  created_at: string;
  playlist_id: string | null;
  folder_id: string | null;
  task_type?: 'youtube' | 'twitter' | 'instagram' | string;
  username?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TwitterLogo = ({ className = "w-5 h-5 text-slate-900 fill-current" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const InstagramLogo = ({ className = "w-5 h-5 text-pink-600" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

function getYoutubeThumbnail(url: string): string | null {
  try {
    const parsed = new URL(url);
    let videoId: string | null = null;
    if (parsed.hostname.includes('youtu.be')) {
      videoId = parsed.pathname.slice(1);
    } else {
      videoId = parsed.searchParams.get('v');
    }
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  } catch { /* ignore */ }
  return null;
}

function getFriendlyName(task: Task): string {
  if (task.file_name) return task.file_name;
  if (task.task_type === 'twitter' || task.task_type === 'instagram') {
    const platform = task.task_type === 'twitter' ? 'Twitter/X' : 'Instagram';
    return `${platform} Profile (@${task.username || 'unknown'})`;
  }
  return task.url;
}

function getPhaseLabel(task: Task): string {
  const isSocial = task.task_type === 'twitter' || task.task_type === 'instagram';
  const isUpload = task.task_type === 's3_upload';
  switch (task.status) {
    case 'queued':     return 'Waiting in queue…';
    case 'processing': return task.progress < 100
      ? (isSocial ? `Downloading profile media (${task.progress}%)…` : isUpload ? `Uploading to cloud (${task.progress}%)…` : 'Downloading…')
      : (isUpload ? 'Finalising upload…' : 'Finalising & scanning…');
    case 'completed':  return isSocial
      ? 'Import complete · All media registered in library'
      : isUpload
        ? 'Upload complete · Team members will be notified'
        : 'Download complete · Processing pipeline started';
    case 'failed':     return isUpload ? 'Upload failed' : 'Download failed';
    default:           return task.status;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge = ({ status, isUpload }: { status: TaskStatus; isUpload?: boolean }) => {
  const configs: Record<TaskStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    queued:     { cls: 'bg-slate-100 text-slate-600 border-slate-200',     icon: <Clock className="w-3 h-3" />,             label: 'Queued' },
    processing: { cls: 'bg-indigo-50 text-indigo-600 border-indigo-200',   icon: <Loader2 className="w-3 h-3 animate-spin" />, label: isUpload ? 'Uploading' : 'Downloading' },
    completed:  { cls: 'bg-emerald-50 text-emerald-600 border-emerald-200',icon: <CheckCircle2 className="w-3 h-3" />,       label: 'Done' },
    failed:     { cls: 'bg-red-50 text-red-600 border-red-200',             icon: <XCircle className="w-3 h-3" />,            label: 'Failed' },
  };
  const { cls, icon, label } = configs[status];
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border rounded-full flex-shrink-0 ${cls}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
};

interface ProgressBarProps {
  progress: number;
  status: TaskStatus;
}

const ProgressBar = ({ progress, status }: ProgressBarProps) => {
  const isIndeterminate = status === 'processing' && progress === 0;

  const barColor =
    status === 'completed' ? 'bg-emerald-500' :
    status === 'failed'    ? 'bg-red-400' :
    'bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500';

  return (
    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
      {isIndeterminate ? (
        <div
          className={`h-full w-1/3 rounded-full ${barColor}`}
          style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }}
        />
      ) : (
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, status === 'completed' ? 100 : progress)}%` }}
          transition={{ ease: 'easeOut', duration: 0.5 }}
        />
      )}
    </div>
  );
};

interface TaskRowProps {
  task: Task;
  onRemove: (id: string) => void;
  onOpenFolder: (id: string) => void;
  isActive: boolean;
}

const TaskRow = ({ task, onRemove, onOpenFolder, isActive }: TaskRowProps) => {
  const thumb = getYoutubeThumbnail(task.url);
  const name = getFriendlyName(task);
  const phase = getPhaseLabel(task);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      className={`group flex items-center gap-4 p-4 bg-white border rounded-2xl shadow-sm transition-shadow duration-200 hover:shadow-md ${
        isActive && task.status === 'processing'
          ? 'border-indigo-200 ring-1 ring-indigo-100'
          : 'border-slate-200/80'
      }`}
    >
      {/* Thumbnail */}
      <div className="w-16 h-11 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 relative">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400">
            {task.task_type === 'instagram' ? (
              <InstagramLogo className="w-5 h-5 text-pink-500" />
            ) : task.task_type === 'twitter' ? (
              <TwitterLogo className="w-5 h-5 text-slate-700 fill-current" />
            ) : task.task_type === 's3_upload' ? (
              <CloudUpload className="w-5 h-5 text-indigo-400" />
            ) : (
              <PlayCircle className="w-5 h-5 text-slate-400" />
            )}
          </div>
        )}
        {task.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          </div>
        )}
        {task.status === 'completed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/80">
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
        )}
        {task.status === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/80">
            <AlertTriangle className="w-4 h-4 text-white" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium truncate ${task.status === 'failed' ? 'text-red-700' : 'text-slate-900'}`}>
            {name}
          </p>
        </div>
        <p className="text-xs text-slate-400 truncate">{phase}</p>

        {/* Progress bar — only for active states */}
        {(task.status === 'processing' || task.status === 'queued') && (
          <ProgressBar progress={task.progress} status={task.status} />
        )}

        {/* Error message */}
        {task.status === 'failed' && task.error_message && (
          <p className="text-xs text-red-500 line-clamp-1">{task.error_message}</p>
        )}
      </div>

      {/* Right: % + badge + actions */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {task.status === 'processing' && task.progress > 0 && (
          <span className="text-sm font-semibold text-indigo-600 w-10 text-right tabular-nums">
            {task.progress}%
          </span>
        )}

        <StatusBadge status={task.status} isUpload={task.task_type === 's3_upload'} />

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {task.status === 'completed' && (
            <button
              onClick={() => onOpenFolder(task.id)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              aria-label="Open folder"
              title="Open Folder"
            >
              <FolderOpen className="w-4.5 h-4.5" />
            </button>
          )}
          {task.status === 'failed' && (
            <button
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              aria-label="Retry (coming soon)"
              title="Retry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onRemove(task.id)}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Remove task"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface DownloadsViewProps {
  onAddMore?: () => void;
}

export default function DownloadsView({ onAddMore }: DownloadsViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/tasks', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data: Task[] = await response.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const removeTask = async (id: string) => {
    // Optimistic removal
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      const token = localStorage.getItem('access_token');
      await fetch(`/tasks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Failed to delete task', err);
      fetchTasks(); // Re-sync
    }
  };

  const openTaskFolder = async (id: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`/tasks/${id}/open-folder`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok && window.desktop) {
        const data = await response.json();
        if (data.path) await revealPath(data.path);
      }
    } catch (err) {
      console.error('Failed to open task folder', err);
    }
  };

  const activeTasks    = tasks.filter(t => t.status === 'queued' || t.status === 'processing');
  const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed');
  const processingTask = tasks.find(t => t.status === 'processing');

  return (
    <>
      {/* Indeterminate bar keyframes */}
      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>

      <div className="w-full max-w-3xl mx-auto space-y-8 font-sans text-slate-900">

        {/* Header */}
        <header className="flex items-end justify-between pb-5 border-b border-slate-200/80">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5">
              <Download className="w-6 h-6 text-indigo-500" />
              Downloads
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {loading
                ? 'Loading queue…'
                : activeTasks.length > 0
                ? `${activeTasks.length} item${activeTasks.length > 1 ? 's' : ''} in queue · processing one at a time`
                : 'All downloads complete.'}
            </p>
          </div>

          {/* Add more button */}
          {onAddMore && (
            <button
              id="add-more-downloads-btn"
              onClick={onAddMore}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm hover:shadow-md hover:shadow-indigo-500/20 transition-all duration-200 active:scale-[0.97]"
            >
              <Plus className="w-4 h-4" />
              Add More
            </button>
          )}
        </header>

        {loading ? (
          // Skeleton
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          // Empty state
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-28 text-center border-2 border-dashed rounded-[28px] border-slate-200/60 bg-slate-50/50"
          >
            <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5">
              <Inbox className="w-7 h-7 text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">Your download queue is empty</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-[240px]">
              Import a YouTube video to get started.
            </p>
            {onAddMore && (
              <button
                onClick={onAddMore}
                className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-all duration-200 active:scale-[0.97] shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Import Video
              </button>
            )}
          </motion.div>
        ) : (
          <div className="space-y-10">

            {/* Active / In Progress */}
            {activeTasks.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase">In Progress</h2>
                  <div className="flex-1 h-px bg-slate-100" />
                  {processingTask && (
                    <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
                      <Zap className="w-3 h-3" />
                      <span>Active</span>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {activeTasks.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onRemove={removeTask}
                        onOpenFolder={openTaskFolder}
                        isActive={task.status === 'processing'}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {/* Completed / Failed */}
            {completedTasks.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase">Completed</h2>
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-xs text-slate-400">{completedTasks.length} item{completedTasks.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {completedTasks.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onRemove={removeTask}
                        onOpenFolder={openTaskFolder}
                        isActive={false}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
