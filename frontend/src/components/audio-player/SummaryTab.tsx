import React, { useState, useEffect, useRef } from "react";
import { Sparkles, RefreshCw, Check, BookOpen, AlertCircle, Copy } from "lucide-react";
import { FailedStateContainer } from "../common/FailedStateContainer";
import type { TranscriptItem } from "./types";
import { ToastContainer, type ToastMessage } from "../FileExplorer/Toast";
import InlineCitationContent from "../rag/InlineCitationContent";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import { logActivity } from '../../utils/activityLogger';

interface SummaryTabProps {
  transcript: TranscriptItem[];
  resourceId: string | null;
  token: string | null;
  initialSummary: string | null;
  onSummaryUpdated?: (summary: string) => void;
  onPendingReindexChange?: (pending: boolean | string) => void;
  pendingReindex?: boolean | string;
  onSeek?: (time: number) => void;
}

export default function SummaryTab({ transcript, resourceId, token, initialSummary, onSummaryUpdated, onPendingReindexChange, pendingReindex, onSeek }: SummaryTabProps) {
  const [loading, setLoading] = useState<boolean>(true);
  // Initialize based on prop: if parent already has summary, skip network check entirely
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialSummary ? "saved" : null
  );
  const isFetchingRef = useRef(false);
  const [summary, setSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const [wasSavedLoad, setWasSavedLoad] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };
  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const fetchSummary = async (forceRegenerate = false) => {
    if (!resourceId || !token) return;
    // Prevent double-invocation (e.g. React Strict Mode) for the initial auto-fetch
    if (!forceRegenerate && isFetchingRef.current) return;
    isFetchingRef.current = true;

    setLoading(true);
    setLoadingMode(forceRegenerate ? "generate" : null);
    setWasSavedLoad(!forceRegenerate);
    setError(null);
    setNotice(null);
    try {
      if (!forceRegenerate) {
        const savedLoadStartedAt = Date.now();
        // 1. Try to GET the summary from the backend
        const getResponse = await fetch(`/resources/${resourceId}/summary`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (getResponse.ok) {
          const getData = await getResponse.json();
          if (getData.summary) {
            setLoadingMode("saved"); // only show sparkle once we KNOW data is saved
            await holdSavedContentLoader(savedLoadStartedAt);
            setSummary(getData.summary);
            setLoading(false);
            return;
          }
        }

        // 2. If it's not generated, trigger the generation via POST
        setLoadingMode("generate");
        logActivity('ai_features', 'Generating summary');
        const postResponse = await fetch(`/resources/${resourceId}/generate-summary`, {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!postResponse.ok) {
          throw new Error("Failed to produce summary. Server may be starting.");
        }

        const data = await postResponse.json();
        const nextSummary = data.summary || "No summary returned.";
        setSummary(nextSummary);
        onSummaryUpdated?.(nextSummary);
      } else {
        // Force regeneration calling the new endpoint
        addToast("Summary regeneration is processing...", "info");
        const postResponse = await fetch(`/resources/${resourceId}/regenerate-summary`, {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!postResponse.ok) {
          throw new Error("Failed to regenerate summary. Server may be starting.");
        }

        const data = await postResponse.json();
        const nextSummary = data.summary || "No summary returned.";
        setSummary(nextSummary);
        onSummaryUpdated?.(nextSummary);
        onPendingReindexChange?.("outdated:summary");
        addToast("Summary regeneration finished. Re-index is ready.", "success");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred");
      if (forceRegenerate) addToast(err.message || "Failed to regenerate summary.", "error");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      // NOTE: setLoadingMode is intentionally NOT reset to null here.
      // Resetting it caused a flicker: the extra render with loadingMode=null
      // while loading was transitioning would briefly show the wrong loader.
    }
  };

  const handleReindex = async () => {
    if (!resourceId || !token) return;
    setIsReindexing(true);
    addToast("Re-indexing and re-embedding are processing...", "info");
    try {
      const response = await fetch(`/resources/${resourceId}/index`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to queue re-indexing.");
      }

      setIsReindexing(false);
      onPendingReindexChange?.(false);
      addToast("Re-index and re-embed started successfully.", "success");
    } catch (err: any) {
      addToast(err.message || "Failed to queue re-indexing.", "error");
    } finally {
      setIsReindexing(false);
    }
  };

  useEffect(() => {
    if (initialSummary) {
      setSummary(initialSummary);
      setLoadingMode("saved");
      holdSavedContentLoader(Date.now()).then(() => {
        setWasSavedLoad(true);
        setLoading(false);
      });
    } else if (resourceId && token) {
      fetchSummary();
    }
  }, [initialSummary, resourceId, token]);

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="flex-1 flex flex-col space-y-6 min-h-0 animate-fade-in relative">
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
        <FailedStateContainer message={error} onRetry={() => fetchSummary(true)} title="Failed to load Summary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col space-y-6 min-h-0 animate-fade-in">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <BookOpen className="w-5 h-5 text-neutral-600" />
          <h3 className="text-lg font-bold text-neutral-800 font-display">
            Meeting Executive Summary
          </h3>
          {notice && (
            <span className="text-xs font-semibold text-amber-600 flex items-center space-x-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Standup Summary Loaded</span>
            </span>
          )}
        </div>

        {summary && !loading && (
          <div className="flex items-center space-x-3">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-neutral-150 rounded-lg text-neutral-600 hover:text-neutral-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
              title="Copy Summary"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button
              onClick={() => fetchSummary(true)}
              className="p-2 hover:bg-neutral-150 rounded-lg text-neutral-600 hover:text-neutral-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
              title="Regenerate Summary"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>Regenerate</span>
            </button>
            {((pendingReindex === true) || (typeof pendingReindex === "string" && (pendingReindex === "outdated" || pendingReindex.includes("summary")))) && (
              <button
                onClick={handleReindex}
                disabled={isReindexing}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer disabled:opacity-70"
                title="Re-index & Re-embed"
              >
                {isReindexing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Re-index</span>
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        loadingMode === "saved" ? (
          <SavedContentLoader message="Opening your saved summary..." />
        ) : (
        <div className="py-20 flex flex-col items-center justify-center space-y-5">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-3 border-neutral-100"></div>
            <div className="absolute inset-0 rounded-full border-3 border-neutral-800 border-t-transparent animate-spin"></div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-base font-bold text-neutral-800">Analyzing meeting dialogue...</p>
            <p className="text-sm text-neutral-400">Gemini is drafting an executive breakdown</p>
          </div>
        </div>
        )
      ) : error ? (
        <div className="p-6 bg-red-50 rounded-xl border border-red-100 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">Failed to load summary</p>
            <p className="text-xs text-red-650 mt-1">{error}</p>
            <button
              onClick={() => fetchSummary(false)}
              className="mt-3 px-4 py-2 text-sm font-bold text-white bg-red-650 hover:bg-red-700 rounded-lg transition"
            >
              Retry Connection
            </button>
          </div>
        </div>
      ) : summary ? (
        wasSavedLoad ? (
          <SavedContentReveal>
            <div className="bg-neutral-50/50 dark:bg-slate-800/50 rounded-2xl border border-neutral-100/80 dark:border-white/10 p-8 overflow-y-auto no-scrollbar flex-1 min-h-0 leading-relaxed font-normal animate-fade-in duration-500">
              <InlineCitationContent text={summary} onSeek={onSeek} />
            </div>
          </SavedContentReveal>
        ) : (
          <div className="bg-neutral-50/50 dark:bg-slate-800/50 rounded-2xl border border-neutral-100/80 dark:border-white/10 p-8 overflow-y-auto no-scrollbar flex-1 min-h-0 leading-relaxed font-normal animate-fade-in duration-500">
            <InlineCitationContent text={summary} onSeek={onSeek} />
          </div>
        )
      ) : (
        <div className="text-center py-24 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
          <Sparkles className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
          <p className="text-lg font-bold text-neutral-700">Ready to analyze meeting</p>
          <p className="text-sm text-neutral-400 max-w-md mx-auto mt-2">
            Stop or pause the current recording to finalize the transcript, then click generate.
          </p>
          <button
            onClick={() => fetchSummary()}
            className="mt-6 px-6 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
          >
            Generate Summary Now
          </button>
        </div>
      )}
    </div>
  );
}
