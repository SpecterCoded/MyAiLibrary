import React, { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";

interface MediaRagActionsProps {
  resourceId: string | null;
  token: string | null;
  processingStatus?: string;
  hasTranscript: boolean;
  hasSummary: boolean;
  chaptersCount: number;
  subchaptersCount: number;
  onQueued?: (status: string) => void;
}

export function MediaRagActions({
  resourceId,
  token,
  processingStatus = "ready",
  hasTranscript,
  hasSummary,
  chaptersCount,
  subchaptersCount,
  onQueued,
}: MediaRagActionsProps) {
  const [chaptering, setChaptering] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const canAttemptIndex = useMemo(
    () => Boolean(resourceId && token && hasTranscript && chaptersCount > 0),
    [resourceId, token, hasTranscript, chaptersCount],
  );

  const isBusy = processingStatus !== "ready" || chaptering || indexing;

  const handleRetryChapters = async () => {
    if (!resourceId || !token) return;
    setFeedback(null);
    setChaptering(true);
    try {
      const response = await fetch(`/resources/${resourceId}/regenerate-structure`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.detail || "Failed to regenerate chapters and subchapters.");
      }

      setFeedback({
        tone: "success",
        text: "Chapter and subchapter regeneration started. When it finishes, re-index for advanced RAG.",
      });
      onQueued?.("chaptering");
    } catch (error: any) {
      setFeedback({
        tone: "error",
        text: error.message || "Chapter regeneration failed.",
      });
    } finally {
      setChaptering(false);
    }
  };

  const handleReindex = async () => {
    if (!resourceId || !token) return;
    setFeedback(null);
    setIndexing(true);
    try {
      const response = await fetch(`/resources/${resourceId}/index`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.detail || "Failed to queue re-indexing.");
      }

      setFeedback({
        tone: "success",
        text: "Re-index queued. Advanced RAG will use the regenerated structure after indexing completes.",
      });
      onQueued?.("queued");
    } catch (error: any) {
      setFeedback({
        tone: "error",
        text: error.message || "Re-indexing failed.",
      });
    } finally {
      setIndexing(false);
    }
  };

  const feedbackTone =
    feedback?.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : feedback?.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className="rounded-2xl border border-neutral-150 bg-neutral-50/70 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-500">Advanced RAG sync</div>
          <p className="mt-1 text-sm font-medium text-neutral-700">
            If summary or chapter structure was regenerated in the player, queue a re-index so advanced RAG uses the updated media structure.
          </p>
        </div>
        <Sparkles className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <StatusChip label="Transcript" ready={hasTranscript} />
        <StatusChip label="Summary" ready={hasSummary} />
        <StatusChip label="Chapters" ready={chaptersCount > 0} value={chaptersCount > 0 ? `${chaptersCount}` : undefined} />
        <StatusChip label="Subchapters" ready={subchaptersCount > 0} value={subchaptersCount > 0 ? `${subchaptersCount}` : undefined} />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleRetryChapters}
          disabled={!resourceId || !token || !hasTranscript || isBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {chaptering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Regenerate Chapters
        </button>

        <button
          type="button"
          onClick={handleReindex}
          disabled={!canAttemptIndex || isBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Re-index for RAG
        </button>
      </div>

      {!canAttemptIndex && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Re-indexing is enabled after transcript exists and at least one chapter has been generated successfully.
          </span>
        </div>
      )}

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${feedbackTone}`}>
          {feedback.tone === "success" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, ready, value }: { label: string; ready: boolean; value?: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-white text-neutral-500"}`}>
      <div className="font-bold uppercase tracking-wider text-[10px]">{label}</div>
      <div className="mt-1 text-xs font-semibold">{ready ? (value ? `Ready (${value})` : "Ready") : "Missing"}</div>
    </div>
  );
}
