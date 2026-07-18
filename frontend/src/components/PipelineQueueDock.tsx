import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { logActivity } from '../utils/activityLogger';
import {
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  Loader2,
  Zap,
  Clock,
  FileText,
  Headphones,
  Film,
  Sparkles,
  Brain,
} from "lucide-react";

interface QueueJob {
  job_id: string;
  resource_id: string;
  resource_title: string;
  job_status: string;
  detail_status: string;
  job_type: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  error_message: string | null;
  progress?: number;
  current_stage?: string | null;
  attempt_count?: number;
  retryable?: boolean;
  blocked_by_job_id?: string | null;
  next_retry_at?: string | null;
  retry_schedule_step?: number;
  last_error_code?: string | null;
}

const STATUS_MAP: Record<string, {
  label: string;
  percent: number;
  gradient: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ReactNode;
}> = {
  transcribing: {
    label: "Transcribing",
    percent: 35,
    gradient: "from-amber-400 to-yellow-400",
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-400",
    icon: <Headphones className="w-4 h-4" />,
  },
  chaptering: {
    label: "Chaptering",
    percent: 58,
    gradient: "from-orange-400 to-amber-400",
    badgeBg: "bg-orange-50 dark:bg-orange-500/10",
    badgeText: "text-orange-600 dark:text-orange-400",
    icon: <FileText className="w-4 h-4" />,
  },
  summarizing: {
    label: "Summarizing",
    percent: 45,
    gradient: "from-yellow-400 to-orange-400",
    badgeBg: "bg-yellow-50 dark:bg-yellow-500/10",
    badgeText: "text-yellow-600 dark:text-yellow-400",
    icon: <FileText className="w-4 h-4" />,
  },
  "sub-chaptering": {
    label: "Sub-Chaptering",
    percent: 72,
    gradient: "from-teal-400 to-emerald-400",
    badgeBg: "bg-teal-50 dark:bg-teal-500/10",
    badgeText: "text-teal-600 dark:text-teal-400",
    icon: <Sparkles className="w-4 h-4" />,
  },
  subchaptering: {
    label: "Sub-Chaptering",
    percent: 72,
    gradient: "from-teal-400 to-emerald-400",
    badgeBg: "bg-teal-50 dark:bg-teal-500/10",
    badgeText: "text-teal-600 dark:text-teal-400",
    icon: <Sparkles className="w-4 h-4" />,
  },
  indexing: {
    label: "Indexing",
    percent: 50,
    gradient: "from-cyan-400 to-blue-400",
    badgeBg: "bg-cyan-50 dark:bg-cyan-500/10",
    badgeText: "text-cyan-600 dark:text-cyan-400",
    icon: <Zap className="w-4 h-4" />,
  },
  embedding: {
    label: "Embedding",
    percent: 88,
    gradient: "from-indigo-400 to-cyan-400",
    badgeBg: "bg-indigo-50 dark:bg-indigo-500/10",
    badgeText: "text-indigo-600 dark:text-indigo-400",
    icon: <Sparkles className="w-4 h-4" />,
  },
  ready: {
    label: "Ready",
    percent: 100,
    gradient: "from-emerald-400 to-green-400",
    badgeBg: "bg-emerald-50 dark:bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  completed: {
    label: "Ready",
    percent: 100,
    gradient: "from-emerald-400 to-green-400",
    badgeBg: "bg-emerald-50 dark:bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  retryingConnection: {
    label: "Retrying connection",
    percent: 48,
    gradient: "from-amber-400 to-yellow-400",
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-400",
    icon: <Loader2 className="w-4 h-4" />,
  },
  waitingForConnection: {
    label: "Waiting for connection",
    percent: 50,
    gradient: "from-amber-400 to-orange-400",
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-400",
    icon: <Clock className="w-4 h-4" />,
  },
  failed: {
    label: "Failed",
    percent: 100,
    gradient: "from-red-400 to-rose-400",
    badgeBg: "bg-red-50 dark:bg-red-500/10",
    badgeText: "text-red-600 dark:text-red-400",
    icon: <AlertCircle className="w-4 h-4" />,
  },
  paused: {
    label: "Paused",
    percent: 50,
    gradient: "from-slate-400 to-slate-300",
    badgeBg: "bg-slate-50 dark:bg-slate-500/10",
    badgeText: "text-slate-600 dark:text-slate-400",
    icon: <Pause className="w-4 h-4" />,
  },
  queued: {
    label: "Queued",
    percent: 8,
    gradient: "from-slate-400 to-slate-300",
    badgeBg: "bg-slate-50 dark:bg-slate-500/10",
    badgeText: "text-slate-600 dark:text-slate-400",
    icon: <Clock className="w-4 h-4" />,
  },
  documentIntelligenceQueued: {
    label: "Queued",
    percent: 12,
    gradient: "from-violet-400 to-indigo-400",
    badgeBg: "bg-violet-50 dark:bg-violet-500/10",
    badgeText: "text-violet-600 dark:text-violet-400",
    icon: <Brain className="w-4 h-4" />,
  },
  documentIntelligenceProcessing: {
    label: "Analyzing",
    percent: 82,
    gradient: "from-violet-400 to-indigo-400",
    badgeBg: "bg-violet-50 dark:bg-violet-500/10",
    badgeText: "text-violet-600 dark:text-violet-400",
    icon: <Brain className="w-4 h-4" />,
  },
  documentIntelligenceReady: {
    label: "Ready",
    percent: 100,
    gradient: "from-violet-400 to-indigo-400",
    badgeBg: "bg-violet-50 dark:bg-violet-500/10",
    badgeText: "text-violet-600 dark:text-violet-400",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  transcriptOnlyQueued: {
    label: "Queued",
    percent: 12,
    gradient: "from-amber-400 to-orange-400",
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-400",
    icon: <Headphones className="w-4 h-4" />,
  },
  transcriptOnlyProcessing: {
    label: "Regenerating Transcript",
    percent: 52,
    gradient: "from-amber-400 to-orange-400",
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-600 dark:text-amber-400",
    icon: <Headphones className="w-4 h-4" />,
  },
  transcriptOnlyReady: {
    label: "Transcript Ready",
    percent: 100,
    gradient: "from-emerald-400 to-green-400",
    badgeBg: "bg-emerald-50 dark:bg-emerald-500/10",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
};

function getStatus(status: string, jobType: string, jobStatus: string) {
  if (jobType === "knowledge_generation") {
    const normalizedJobStatus = (jobStatus || "").toLowerCase();
    if (normalizedJobStatus.includes("retrying_connection")) return STATUS_MAP.retryingConnection;
    if (normalizedJobStatus.includes("waiting_for_connection")) return STATUS_MAP.waitingForConnection;
    if (normalizedJobStatus.includes("fail")) return STATUS_MAP.failed;
    if (normalizedJobStatus === "completed") return STATUS_MAP.ready;
    if (normalizedJobStatus === "processing") return STATUS_MAP.documentIntelligenceProcessing;
    return STATUS_MAP.documentIntelligenceQueued;
  }
  if (jobType === "document_intelligence") {
    const normalizedJobStatus = (jobStatus || "").toLowerCase();
    if (normalizedJobStatus.includes("fail")) return STATUS_MAP.failed;
    if (normalizedJobStatus === "completed") return STATUS_MAP.documentIntelligenceReady;
    if (normalizedJobStatus === "processing") return STATUS_MAP.documentIntelligenceProcessing;
    return STATUS_MAP.documentIntelligenceQueued;
  }
  if (jobType === "transcript_only") {
    const normalizedJobStatus = (jobStatus || "").toLowerCase();
    if (normalizedJobStatus.includes("fail")) return STATUS_MAP.failed;
    if (normalizedJobStatus === "completed") return STATUS_MAP.transcriptOnlyReady;
    if (normalizedJobStatus === "processing") return STATUS_MAP.transcriptOnlyProcessing;
    return STATUS_MAP.transcriptOnlyQueued;
  }
  const s = (status || "").toLowerCase();
  if (s.includes("transcrib")) return STATUS_MAP.transcribing;
  if (s.includes("sub-chapter") || s.includes("subchapter")) return STATUS_MAP["sub-chaptering"];
  if (s.includes("chapter")) return STATUS_MAP.chaptering;
  if (s.includes("summariz")) return STATUS_MAP.summarizing;
  if (s === "indexing") return STATUS_MAP.indexing;
  if (s.includes("embed")) return STATUS_MAP.embedding;
  if (s.includes("ready") || s.includes("completed")) return STATUS_MAP.ready;
  if (s.includes("fail")) return STATUS_MAP.failed;
  if (s.includes("pause")) return STATUS_MAP.paused;
  return STATUS_MAP.queued;
}

function getFileIcon(title: string) {
  const ext = title.split(".").pop()?.toLowerCase();
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext ?? "")) return <Film className="w-4 h-4" />;
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(ext ?? "")) return <Headphones className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

function getJobTypeLabel(jobType: string) {
  if (jobType === "knowledge_generation") return "Knowledge Extraction";
  if (jobType === "document_intelligence") return "Document Intelligence";
  if (jobType === "reindex") return "Re-indexing";
  if (jobType === "transcript_only") return "Transcript Regeneration";
  return "Processing";
}

function formatDetailStatus(detailStatus: string, jobStatus: string) {
  const raw = (detailStatus || jobStatus || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function dedupeQueueJobs(jobs: QueueJob[]) {
  const isActiveJob = (job: QueueJob) => ["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"].includes(job.job_status);
  const activeResourceIds = new Set(jobs.filter(isActiveJob).map((job) => job.resource_id));
  const seenFinishedResources = new Set<string>();

  return jobs.filter((job) => {
    if (isActiveJob(job)) return true;
    if (activeResourceIds.has(job.resource_id)) return false;
    if (seenFinishedResources.has(job.resource_id)) return false;
    seenFinishedResources.add(job.resource_id);
    return true;
  });
}

export const PipelineQueueDock: React.FC = () => {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [visible, setVisible] = useState(false);

  const [stopped, setStopped] = useState(false);

  const fetchQueue = async () => {
    if (stopped) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch("/queue", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { setStopped(true); return; }
      if (res.ok) {
        const data = await res.json();
        const nextJobs = dedupeQueueJobs(data);
        setJobs(nextJobs);
        if (nextJobs.length > 0) {
          setVisible(true);
        }
      }
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    }
  };

  useEffect(() => {
    if (stopped) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    const refresh = () => fetchQueue();
    window.addEventListener("pipeline-queue-refresh", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pipeline-queue-refresh", refresh);
    };
  }, [stopped]);

  const activeCount = jobs.filter(
    (j) => j.job_status === "queued" || j.job_status === "waiting" || j.job_status === "retrying_connection" || j.job_status === "waiting_for_connection" || j.job_status === "processing"
  ).length;

  const handleClear = async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch("/queue/clear", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        logActivity('queue', 'Cleared completed jobs');
        setVisible(false);
        setTimeout(() => fetchQueue(), 400);
      }
    } catch (err) {
      console.error("Failed to clear queue:", err);
    }
  };

  const handleAction = async (jobId: string, action: "pause" | "resume" | "retry" | "start-over" | "delete") => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const url = action === "delete" ? `/queue/${jobId}` : `/queue/${jobId}/${action}`;
      const method = action === "delete" ? "DELETE" : "POST";
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        logActivity('queue', `${action}d job`);
        fetchQueue();
      }
    } catch (err) {
      console.error(`Failed to ${action}:`, err);
    }
  };

  if (jobs.length === 0 && !visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-8 right-8 z-[1000] w-[440px] rounded-[24px] bg-white/90 dark:bg-[#1a1b1e]/95 backdrop-blur-2xl border border-slate-200/60 dark:border-white/[0.06] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_60px_-12px_rgba(0,0,0,0.5)] overflow-hidden"
        >
          {/* Header */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between p-5 cursor-pointer group"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/30 transition-shadow">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white tracking-tight leading-none">
                  Pipeline Queue
                </h3>
                <p className="text-[12px] text-slate-400 dark:text-slate-500 font-medium mt-1">
                  {activeCount > 0
                    ? `${activeCount} active task${activeCount !== 1 ? "s" : ""}`
                    : "All idle"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {activeCount > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-1 rounded-full">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Active
                </span>
              )}
              <motion.div
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2 }}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400"
              >
                <ChevronDown className="w-4 h-4" />
              </motion.div>
            </div>
          </button>

          {/* Content */}
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5">
                  {/* Divider */}
                  <div className="h-px bg-slate-100 dark:bg-white/[0.06] mb-4" />

                  {/* Jobs */}
                  <div className="max-h-[320px] overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
                    <AnimatePresence mode="popLayout">
                      {jobs.map((job) => {
                        const status = getStatus(job.detail_status || job.job_status, job.job_type, job.job_status);
                        const detailText = formatDetailStatus(job.detail_status, job.job_status);
                        const isConnectionRetrying = job.job_status === "retrying_connection";
                        const isConnectionWaiting = job.job_status === "waiting_for_connection";
                        const isActive = job.job_status === "queued" || job.job_status === "waiting" || isConnectionRetrying || isConnectionWaiting || job.job_status === "processing";
                        const isFailed = job.job_status === "failed";
                        const isPaused = job.job_status === "paused";

                        return (
                          <motion.div
                            key={job.job_id}
                            layout
                            initial={{ opacity: 0, y: 8, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -20, scale: 0.95 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="p-3.5 rounded-[16px] bg-slate-50/80 dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.04] hover:border-slate-200 dark:hover:border-white/[0.08] transition-colors group"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${status.badgeBg} ${status.badgeText}`}>
                                  {isActive && !isConnectionWaiting ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    status.icon
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {getFileIcon(job.resource_title)}
                                    <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                                      {job.resource_title}
                                    </h4>
                                  </div>
                                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                                    {getJobTypeLabel(job.job_type)} • {status.label}
                                  </p>
                                  {detailText && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                                      {detailText}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {isActive && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "pause"); }}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                    title="Pause"
                                  >
                                    <Pause className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isActive && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "delete"); }}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                                    title="Cancel"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {(isFailed || isConnectionRetrying || isConnectionWaiting) && job.retryable && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "retry"); }}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 transition-colors"
                                    title="Retry"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isFailed && job.job_type === "knowledge_generation" && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "start-over"); }}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors"
                                    title="Start Over"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isPaused && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "resume"); }}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-colors"
                                      title="Resume"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAction(job.job_id, "delete"); }}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div className="mt-3 h-[5px] rounded-full bg-slate-200/60 dark:bg-white/[0.06] overflow-hidden">
                              <motion.div
                                className={`h-full rounded-full bg-gradient-to-r ${status.gradient}`}
                                initial={{ width: 0 }}
                                animate={{ width: ((job.progress || status.percent) + "%") }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                              />
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>

                  {/* Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      {activeCount > 0 ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                          {activeCount} job{activeCount !== 1 ? "s" : ""} processing
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          All completed
                        </>
                      )}
                    </span>
                    <button
                      onClick={handleClear}
                      className="text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                    >
                      Clear finished
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
