import React, { useEffect, useMemo, useState } from "react";
import { Brain, ChevronDown, RefreshCw, Sparkles } from "lucide-react";

type Insight = {
  status: string;
  short_summary?: string | null;
  detailed_summary?: string | null;
  topics?: string[];
  keywords?: string[];
  key_concepts?: string[];
  named_entities?: Record<string, string[]>;
  difficulty_level?: string | null;
  estimated_reading_minutes?: number | null;
  document_language?: string | null;
  document_type?: string | null;
  suggested_questions?: string[];
  related_documents?: Array<{
    resource_id: string;
    title: string;
    type: string;
    similarity_score: number;
    shared_topics?: string[];
    shared_keywords?: string[];
  }>;
  ai_tags?: string[];
  error_message?: string | null;
};

interface Props {
  resourceId: string;
  isVisible: boolean;
  onOpenRelated?: (resourceId: string) => void;
}

function Card({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="px-4 pb-4 text-sm text-slate-600">{children}</div> : null}
    </div>
  );
}

export default function DocumentInsightsPanel({ resourceId, isVisible, onOpenRelated }: Props) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const loadInsight = async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const res = await fetch(`/resources/${resourceId}/document-insights`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setInsight(data?.insight || null);
    } catch (error) {
      console.error("Failed to load document insights", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible) loadInsight();
  }, [resourceId, isVisible]);

  const entityEntries = useMemo(
    () =>
      Object.entries(insight?.named_entities || {}).filter(
        ([, values]) => Array.isArray(values) && values.length > 0,
      ),
    [insight],
  );

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/resources/${resourceId}/document-insights/retry`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Retry failed");
      await loadInsight();
    } catch (error) {
      console.error(error);
    } finally {
      setRetrying(false);
    }
  };

  const askQuestion = async (question: string) => {
    setAsking(question);
    try {
      const res = await fetch("/library/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, concise: true }),
      });
      const data = await res.json();
      setQuestionAnswers((current) => ({ ...current, [question]: data?.answer || "No answer returned." }));
    } catch (error) {
      console.error("Failed to ask suggested question", error);
      setQuestionAnswers((current) => ({ ...current, [question]: "Failed to fetch answer." }));
    } finally {
      setAsking(null);
    }
  };

  const statusLabel =
    insight?.status === "completed"
      ? "Ready"
      : insight?.status === "failed"
        ? "Analysis Failed"
        : insight?.status === "processing"
          ? "Analysis Running"
          : "Analysis Pending";

  return (
    <aside className="w-[360px] max-w-[32vw] min-w-[320px] h-[80vh] rounded-[28px] border border-slate-200/70 bg-white/85 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-slate-200/70 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-800">
          <Brain className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold text-sm">AI Insights</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600">{statusLabel}</span>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Retry analysis"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-slate-500">Loading AI insights…</div>
        ) : !insight ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            Insights will appear here after background analysis completes.
          </div>
        ) : (
          <>
            <Card title="Summary">
              <div className="space-y-3">
                {insight.short_summary ? (
                  <p className="text-slate-700 leading-6">{insight.short_summary}</p>
                ) : null}
                {insight.detailed_summary ? (
                  <p className="text-slate-500 leading-6">{insight.detailed_summary}</p>
                ) : null}
              </div>
            </Card>

            <Card title="Overview" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-400 uppercase tracking-wide">Difficulty</div>
                  <div className="mt-1 text-slate-700">{insight.difficulty_level || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400 uppercase tracking-wide">Read Time</div>
                  <div className="mt-1 text-slate-700">{insight.estimated_reading_minutes ? `${insight.estimated_reading_minutes} min` : "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400 uppercase tracking-wide">Language</div>
                  <div className="mt-1 text-slate-700">{insight.document_language || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400 uppercase tracking-wide">Type</div>
                  <div className="mt-1 text-slate-700">{insight.document_type || "—"}</div>
                </div>
              </div>
            </Card>

            <Card title="Topics & Keywords" defaultOpen={false}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(insight.topics || []).map((topic) => (
                    <span key={topic} className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">{topic}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(insight.keywords || []).map((keyword) => (
                    <span key={keyword} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs">{keyword}</span>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Concepts & Entities" defaultOpen={false}>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(insight.key_concepts || []).map((concept) => (
                    <span key={concept} className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">{concept}</span>
                  ))}
                </div>
                {entityEntries.map(([label, values]) => (
                  <div key={label}>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">{label}</div>
                    <div className="flex flex-wrap gap-2">
                      {values.map((value) => (
                        <span key={`${label}-${value}`} className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs">{value}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Suggested Questions" defaultOpen={false}>
              <div className="space-y-3">
                {(insight.suggested_questions || []).map((question) => (
                  <div key={question} className="rounded-xl border border-slate-200 p-3">
                    <button
                      onClick={() => askQuestion(question)}
                      className="w-full text-left text-sm font-medium text-slate-700 hover:text-indigo-600 transition-colors cursor-pointer"
                    >
                      {question}
                    </button>
                    {asking === question ? (
                      <div className="mt-2 text-xs text-slate-400 flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                        Asking AI…
                      </div>
                    ) : questionAnswers[question] ? (
                      <div className="mt-2 text-xs text-slate-500 leading-5">{questionAnswers[question]}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Related Documents" defaultOpen={false}>
              <div className="space-y-3">
                {(insight.related_documents || []).map((related) => (
                  <button
                    key={related.resource_id}
                    onClick={() => onOpenRelated?.(related.resource_id)}
                    className="w-full text-left rounded-xl border border-slate-200 p-3 hover:border-indigo-200 hover:bg-indigo-50/40 transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-700">{related.title}</div>
                      <div className="text-[11px] text-indigo-600 font-semibold">{Math.round((related.similarity_score || 0) * 100)}%</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[(related.shared_topics || [])[0], ...(related.shared_keywords || []).slice(0, 2)].filter(Boolean).map((item) => (
                        <span key={`${related.resource_id}-${item}`} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px]">{item}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card title="AI Tags" defaultOpen={false}>
              <div className="flex flex-wrap gap-2">
                {(insight.ai_tags || []).map((tag) => (
                  <span key={tag} className="px-2.5 py-1 rounded-full bg-fuchsia-50 text-fuchsia-700 text-xs font-medium">{tag}</span>
                ))}
              </div>
            </Card>

            {insight.error_message ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">{insight.error_message}</div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
