import React, { useEffect, useMemo, useState } from "react";
import "./DocumentIntelligencePage.css";

type ResourceDetails = {
  id: string;
  title: string;
  type: string;
  description?: string | null;
  transcript?: string | null;
  summary?: string | null;
  processing_status?: string | null;
  is_embedded?: string | boolean;
  duration_seconds?: number | null;
  created_at?: string | null;
  folder_path?: string | null;
  playlist_name?: string | null;
};

type Chapter = {
  id: string;
  title?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  summary?: string | null;
};

type Subchapter = {
  id: string;
  chapter_id?: string | null;
  title?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  summary?: string | null;
};

type DocumentInsight = {
  status?: string | null;
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
    similarity_score?: number;
    shared_topics?: string[];
    shared_keywords?: string[];
  }>;
  ai_tags?: string[];
  error_message?: string | null;
  analysis_duration_ms?: number | null;
  estimated_cost?: number | null;
  token_usage?: {
    input?: number | null;
    output?: number | null;
  } | null;
  retry_count?: number | null;
  updated_at?: string | null;
};

type DetailsResponse = {
  resource: ResourceDetails;
  chapters: Chapter[];
  subchapters: Subchapter[];
  document_insight?: DocumentInsight | null;
};

interface Props {
  resourceId: string;
  onBack: () => void;
}

const ICONS = {
  doc: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  summary: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  tag: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.82 0l4.59-4.59a2 2 0 0 0 .01-2.58z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  ),
  entity: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
    </svg>
  ),
  ask: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  related: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6 15.4 6.4M8.6 13.4l6.8 4.2" />
    </svg>
  ),
  diag: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10M18 20V4M6 20v-4" />
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
  alert: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  clock: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  retry: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
    </svg>
  )
};

const ENTITY_META = {
  people: { label: "People", ic: ICONS.entity },
  organizations: { label: "Organizations", ic: ICONS.entity },
  locations: { label: "Locations", ic: ICONS.entity },
  technologies: { label: "Technologies", ic: ICONS.entity },
  datasets: { label: "Datasets", ic: ICONS.entity },
  libraries: { label: "Libraries", ic: ICONS.entity },
  models: { label: "Models", ic: ICONS.entity }
};

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  pending: "Pending",
  processing: "Processing",
  failed: "Failed"
};

function formatDuration(seconds?: number | null) {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatTimeAgo(value?: string | null) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

interface SectionShellProps {
  icon: React.ReactNode;
  title: string;
  sub?: string | null;
  count?: string | number | null;
  children: React.ReactNode;
}

function SectionShell({ icon, title, sub, count, children }: SectionShellProps) {
  return (
    <section className="di-section">
      <div className="section-head">
        <div>
          <h2 className="section-title">
            <span className="ic">{icon}</span>
            {title}
          </h2>
          {sub ? <div className="section-sub">{sub}</div> : null}
        </div>
        {count != null ? <span className="section-count">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  body: string;
}

function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function SkeletonSummary() {
  return (
    <div className="summary-card">
      <div className="sk-title skeleton" />
      <div className="sk-row skeleton" />
      <div className="sk-row skeleton" />
      <div className="sk-row skeleton" style={{ width: "70%" }} />
    </div>
  );
}

export default function DocumentIntelligencePage({ resourceId, onBack }: Props) {
  const [details, setDetails] = useState<DetailsResponse | null>(null);
  const [insight, setInsight] = useState<DocumentInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [detailedExpanded, setDetailedExpanded] = useState(false);
  const [shortExpanded, setShortExpanded] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const load = async () => {
    setLoading(true);
    try {
      const detailsRes = await fetch(`/resources/${resourceId}/details`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!detailsRes.ok) throw new Error("Failed to load resource details");
      const detailsData: DetailsResponse = await detailsRes.json();
      setDetails(detailsData);

      const insightRes = await fetch(`/resources/${resourceId}/document-insights`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (insightRes.ok) {
        const insightData = await insightRes.json();
        setInsight(insightData?.insight || detailsData.document_insight || null);
      } else {
        setInsight(detailsData.document_insight || null);
      }
    } catch (error) {
      console.error("Failed to load document intelligence page", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [resourceId]);

  const resource = details?.resource;
  const isPdf = resource?.type === "pdf";
  const isMedia = resource?.type === "audio" || resource?.type === "video";
  const chapterCount = details?.chapters?.length || 0;

  const transcriptWords = useMemo(() => {
    const text = resource?.transcript?.trim();
    return text ? text.split(/\s+/).length.toLocaleString() : "0";
  }, [resource?.transcript]);

  const handleRegenerate = async () => {
    setRetrying(true);
    try {
      const response = await fetch(`/resources/${resourceId}/document-insights/retry`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Failed to queue document intelligence retry");
      await load();
    } catch (error) {
      console.error(error);
    } finally {
      setRetrying(false);
    }
  };

  const status: "ready" | "processing" | "pending" | "failed" = useMemo(() => {
    if (!insight) return "pending";
    const rawStatus = insight?.status || resource?.processing_status || "pending";
    const normalized = rawStatus.toLowerCase();
    
    if (normalized === "completed" || normalized === "ready" || normalized === "processed") return "ready";
    if (normalized.includes("fail")) return "failed";
    if (normalized.includes("process") || normalized.includes("run")) return "processing";
    return "pending";
  }, [insight?.status, resource?.processing_status]);

  if (loading) {
    return (
      <div className="di-page-container">
        <div className="page">
          <div className="di-context">
            <span className="doc-name">Loading resource...</span>
          </div>
          <div className="di-shell">
            <div className="di-hero">
              <div className="sk-title skeleton" />
              <div className="sk-row skeleton" style={{ width: "40%" }} />
              <div className="di-metrics">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div className="metric" key={i}>
                    <div className="sk-row skeleton" style={{ width: "60%" }} />
                  </div>
                ))}
              </div>
            </div>
            
            <SectionShell icon={ICONS.summary} title="Summary">
              <SkeletonSummary />
            </SectionShell>

            <SectionShell icon={ICONS.tag} title="Topics & Taxonomy">
              <div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <span className="sk-chip skeleton" key={i} />
                ))}
              </div>
            </SectionShell>
          </div>
        </div>
      </div>
    );
  }

  if (!details || !resource) {
    return (
      <div className="di-page-container">
        <div className="page">
          <div className="di-context">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 hover:text-[var(--accent)] border-none bg-transparent p-0 cursor-pointer text-inherit font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Library</span>
            </button>
          </div>
          <div className="di-shell">
            <div className="di-hero" style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px", color: "var(--rose)" }}>
                {ICONS.alert}
              </div>
              <h2 className="display" style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 8px 0" }}>Could not load this resource</h2>
              <p style={{ fontSize: "14px", color: "var(--ink-muted)", margin: "0 auto", maxWidth: "360px" }}>
                We were unable to fetch the details. Try going back to the library and opening the page again.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showShortSummary = isPdf ? insight?.short_summary : resource?.summary;
  const showDetailedSummary = isPdf ? insight?.detailed_summary : (resource?.description || null);

  const topicsList = insight?.topics || [];
  const keywordsList = insight?.keywords || [];
  const conceptsList = insight?.key_concepts || [];
  const tagsList = insight?.ai_tags || [];

  const chipGroups = [
    { label: "Topics", cls: "topics", items: topicsList, color: "var(--accent)" },
    { label: "Keywords", cls: "keywords", items: keywordsList, color: "var(--ink-faint)" },
    { label: "Key concepts", cls: "concepts", items: conceptsList, color: "var(--amber)" },
    { label: "AI tags", cls: "tags", items: tagsList, color: "var(--ink-faint)" }
  ].filter(g => g.items && g.items.length > 0);

  const ents = insight?.named_entities || {};
  const entityGroups = Object.keys(ENTITY_META).map(k => ({
    key: k,
    ...ENTITY_META[k as keyof typeof ENTITY_META],
    items: ents[k] || []
  })).filter(g => g.items.length > 0);

  const questions = insight?.suggested_questions || [];
  const relatedDocs = insight?.related_documents || [];

  // Metrics for Hero display
  const difficulty = insight?.difficulty_level;
  const readingTime = insight?.estimated_reading_minutes;
  const language = insight?.document_language;
  const docType = insight?.document_type;

  const mediaType = resource.type;
  const mediaCreated = resource.created_at ? formatDate(resource.created_at) : null;
  const mediaDuration = resource.duration_seconds ? formatDuration(resource.duration_seconds) : null;
  const mediaIndexed = resource.is_embedded === true || resource.is_embedded === "true" ? "Embedded" : "Not indexed";

  // Diagnostics cells
  const usage = insight?.token_usage
    ? `${(insight.token_usage.input ?? 0).toLocaleString()} in / ${(insight.token_usage.output ?? 0).toLocaleString()} out`
    : "—";

  const diagCells = isPdf ? [
    { k: "Analysis duration", v: insight?.analysis_duration_ms != null ? `${(insight.analysis_duration_ms / 1000).toFixed(2)}s` : "—" },
    { k: "Token usage", v: usage },
    { k: "Estimated cost", v: insight?.estimated_cost != null ? `$${insight.estimated_cost.toFixed(4)}` : "—" },
    { k: "Retry count", v: insight?.retry_count ?? 0 },
    { k: "Status", v: STATUS_LABEL[status] || status },
    { k: "Error", v: insight?.error_message || "none", err: !!insight?.error_message }
  ] : [
    { k: "Transcript words", v: transcriptWords },
    { k: "Indexed", v: (resource.is_embedded === true || resource.is_embedded === "true") ? "Yes" : "No" },
    { k: "Status", v: STATUS_LABEL[status] || status },
    { k: "Created at", v: resource.created_at ? formatDate(resource.created_at) : "—" }
  ];

  return (
    <div className="di-page-container">
      <div className="page">
        {/* Breadcrumb Context Bar */}
        <div className="di-context">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 hover:text-[var(--accent)] border-none bg-transparent p-0 cursor-pointer text-inherit font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back to Library</span>
          </button>
          <span className="opacity-50">/</span>
          <span>Document Viewer</span>
          <span className="opacity-50">/</span>
          <span className="doc-name">{resource.title}</span>
        </div>

        <div className="di-shell">
          {/* HERO SECTION */}
          <div className="di-hero">
            <div className="di-hero-top">
              <div>
                <div className="di-eyebrow">
                  <span className="dot" />
                  Document Intelligence
                </div>
                <h1 className="di-title display">{resource.title}</h1>
                <p className="di-desc">
                  {isPdf
                    ? "AI-generated insights for this document"
                    : "AI context, summaries, and structure for this media resource"}
                </p>
              </div>
              <div className="di-hero-meta">
                <span className={`status-badge status-${status}`}>
                  <span className="pulse" />
                  {STATUS_LABEL[status]}
                </span>
                <span className="di-updated">
                  Updated {insight?.updated_at ? formatTimeAgo(insight.updated_at) : resource.created_at ? formatTimeAgo(resource.created_at) : "—"}
                </span>
                <button
                  className="btn-regenerate"
                  onClick={handleRegenerate}
                  disabled={retrying || status === "processing" || status === "pending"}
                  title="Re-run AI indexing and analysis"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={retrying ? "animate-spin" : ""}>
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                  </svg>
                  <span>{retrying ? "Queueing..." : "Regenerate insights"}</span>
                </button>
              </div>
            </div>

            {/* Sweep animated scan line */}
            {status === "processing" && (
              <div className="scan-rail">
                <div className="sweep" />
              </div>
            )}

            {/* Hero Quick Metrics */}
            {isPdf ? (
              (difficulty || readingTime || language || docType) ? (
                <div className="di-metrics">
                  <div className="metric">
                    <div className="k">Difficulty</div>
                    <div className={`v ${!difficulty ? 'empty' : ''}`}>{difficulty || "—"}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Reading time</div>
                    <div className={`v ${!readingTime ? 'empty' : ''}`}>{readingTime ? `${readingTime} min` : "—"}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Language</div>
                    <div className={`v ${!language ? 'empty' : ''}`}>{language || "—"}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Document type</div>
                    <div className={`v ${!docType ? 'empty' : ''}`}>{docType || "—"}</div>
                  </div>
                </div>
              ) : null
            ) : (
              <div className="di-metrics">
                <div className="metric">
                  <div className="k">Type</div>
                  <div className={`v ${!mediaType ? 'empty' : ''}`} style={{ textTransform: "capitalize" }}>{mediaType || "—"}</div>
                </div>
                <div className="metric">
                  <div className="k">Created</div>
                  <div className={`v ${!mediaCreated ? 'empty' : ''}`}>{mediaCreated || "—"}</div>
                </div>
                <div className="metric">
                  <div className="k">Duration</div>
                  <div className={`v ${!mediaDuration ? 'empty' : ''}`}>{mediaDuration || "—"}</div>
                </div>
                <div className="metric">
                  <div className="k">AI index</div>
                  <div className="v">{mediaIndexed}</div>
                </div>
              </div>
            )}

            {/* Action Row for failed states */}
            {status === "failed" && (
              <div className="retry-row">
                <div style={{ flex: 1 }}>
                  <p>Analysis failed{insight?.retry_count ? ` after ${insight.retry_count} ${insight.retry_count === 1 ? 'retry' : 'retries'}` : ""}.</p>
                  {insight?.error_message ? <span className="err">{insight.error_message}</span> : null}
                </div>
                <button onClick={handleRegenerate} disabled={retrying} className="btn-retry">
                  {retrying ? (
                    <span className="animate-spin" style={{ display: 'inline-block' }}>{ICONS.retry}</span>
                  ) : ICONS.retry}
                  <span>Retry analysis</span>
                </button>
              </div>
            )}

            {/* Action Row for pending states */}
            {status === "pending" && (
              <div className="retry-row pending">
                <p>Queued for analysis. This document hasn't been picked up by the model yet.</p>
                <button onClick={handleRegenerate} disabled={retrying} className="btn-retry">
                  {retrying ? (
                    <span className="animate-spin" style={{ display: 'inline-block' }}>{ICONS.retry}</span>
                  ) : ICONS.retry}
                  <span>Run now</span>
                </button>
              </div>
            )}
          </div>

          {/* SUMMARY SECTION */}
          <SectionShell icon={ICONS.summary} title={isPdf ? "Summary" : "Summary & Context"}>
            {status !== "ready" && status !== "failed" ? (
              <SkeletonSummary />
            ) : (!showShortSummary && !showDetailedSummary) ? (
              <EmptyState
                icon={ICONS.summary}
                title="No summary yet"
                body="This resource doesn't have AI-generated summary content available."
              />
            ) : (
              <div className="summary-grid">
                 {showShortSummary && (
                   <div className="summary-card">
                     <div className="label">
                       <span>Short summary</span>
                       {showShortSummary.length > 150 && (
                         <button
                           className="toggle-link"
                           onClick={() => setShortExpanded(!shortExpanded)}
                         >
                           {shortExpanded ? "Collapse" : "Expand"}
                         </button>
                       )}
                     </div>
                     <p className={shortExpanded ? "" : "clamp"} style={{ whiteSpace: "pre-wrap" }}>
                       {showShortSummary}
                     </p>
                   </div>
                 )}
                {showDetailedSummary && (
                  <div className="summary-card detailed">
                    <div className="label">
                      <span>{isPdf ? "Detailed summary" : "Description"}</span>
                      <button
                        className="toggle-link"
                        onClick={() => setDetailedExpanded(!detailedExpanded)}
                      >
                        {detailedExpanded ? "Collapse" : "Expand"}
                      </button>
                    </div>
                    <p className={detailedExpanded ? "" : "clamp"} style={{ whiteSpace: "pre-wrap" }}>
                      {showDetailedSummary}
                    </p>
                  </div>
                )}
              </div>
            )}
          </SectionShell>

          {/* TOPICS & TAXONOMY SECTION */}
          <SectionShell icon={ICONS.tag} title="Topics & Taxonomy">
            {status !== "ready" && status !== "failed" ? (
              <div>
                {Array.from({ length: 7 }).map((_, i) => (
                  <span className="sk-chip skeleton" key={i} />
                ))}
              </div>
            ) : chipGroups.length === 0 ? (
              <EmptyState
                icon={ICONS.tag}
                title="No taxonomy extracted"
                body="Topics, keywords, and concepts will appear here once available."
              />
            ) : (
              <div className="chip-rows">
                {chipGroups.map(g => (
                  <div className="chip-row" key={g.label}>
                    <div className="row-label">
                      <span className="swatch" style={{ background: g.color }} />
                      {g.label}
                    </div>
                    <div className="chips">
                      {g.items?.map(item => (
                        <span key={item} className={`chip ${g.cls}`}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionShell>

          {/* NAMED ENTITIES SECTION */}
          <SectionShell icon={ICONS.entity} title="Named Entities">
            {status !== "ready" && status !== "failed" ? (
              <div className="entity-grid">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div className="entity-group" key={i}>
                    <div className="sk-row skeleton" style={{ width: "50%" }} />
                    <div className="sk-row skeleton" />
                    <div className="sk-row skeleton" style={{ width: "70%" }} />
                  </div>
                ))}
              </div>
            ) : entityGroups.length === 0 ? (
              <EmptyState
                icon={ICONS.entity}
                title="No entities found"
                body="People, organizations, and other named entities will be grouped here once extracted."
              />
            ) : (
              <div className="entity-grid">
                {entityGroups.map(g => (
                  <div className="entity-group" key={g.key}>
                    <div className="eg-head">
                      <span className="ic">{g.ic}</span>
                      <span>{g.label}</span>
                      <span className="n">{g.items.length}</span>
                    </div>
                    <div className="entity-list">
                      {g.items.map(item => (
                        <div className="entity-item" key={item}>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionShell>

          {/* CHAPTERS STRUCTURE SECTION (Audio/Video media resources) */}
          {isMedia && (
            <SectionShell icon={ICONS.summary} title="Structure" count={chapterCount > 0 ? `${chapterCount} chapters` : null}>
              {details.chapters && details.chapters.length > 0 ? (
                <div className="related-list">
                  {details.chapters.slice(0, 16).map(chapter => (
                    <div className="related-card" style={{ cursor: "default" }} key={chapter.id}>
                      <div className="ric">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <polygon points="10 8 16 12 10 16 10 8"/>
                        </svg>
                      </div>
                      <div className="related-body">
                        <div className="rt">{chapter.title || "Untitled chapter"}</div>
                        {chapter.summary ? (
                          <p style={{ margin: "4px 0 0 0", fontSize: "12.5px", color: "var(--ink-muted)", lineHeight: "1.5" }}>
                            {chapter.summary}
                          </p>
                        ) : null}
                      </div>
                      <div className="related-score" style={{ width: "auto" }}>
                        <span className="pct mono" style={{ fontSize: "12px", color: "var(--ink-muted)" }}>
                          {chapter.start_time != null
                            ? `${Math.floor(chapter.start_time / 60)}:${String(Math.floor(chapter.start_time % 60)).padStart(2, "0")}`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={ICONS.summary}
                  title="No chapters found"
                  body="This media resource has not been structured into chapters yet."
                />
              )}
            </SectionShell>
          )}


          {/* RELATED DOCUMENTS SECTION */}
          <SectionShell icon={ICONS.related} title="Related Documents">
            {status !== "ready" && status !== "failed" ? (
              <div className="related-list">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="sk-row skeleton" style={{ height: "48px", borderRadius: "12px" }} />
                ))}
              </div>
            ) : relatedDocs.length === 0 ? (
              <EmptyState
                icon={ICONS.related}
                title="No related documents"
                body="Similar documents in this library will appear here once found."
              />
            ) : (
              <div className="related-list">
                {relatedDocs.map(r => {
                  const similarity = typeof r.similarity_score === 'number'
                    ? r.similarity_score
                    : (r as any).similarity;
                  const pct = typeof similarity === 'number' ? Math.round(similarity * 100) : null;
                  const shared = r.shared_topics || r.shared_keywords || (r as any).shared || [];
                  
                  return (
                    <div className="related-card" key={r.resource_id || r.title}>
                      <div className="ric">{ICONS.doc}</div>
                      <div className="related-body">
                        <div className="rt">{r.title}</div>
                        {shared.length > 0 && (
                          <div className="rtags">
                            {shared.map((s: string) => (
                              <span className="rtag" key={s}>
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {pct !== null && (
                        <div className="related-score">
                          <span className="pct mono">{pct}%</span>
                          <div className="score-bar">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionShell>


          {/* DIAGNOSTICS SECTION */}
          <div className="diagnostics">
            <button
              className="diag-toggle"
              aria-expanded={diagnosticsExpanded}
              onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
            >
              <span className="ic">{ICONS.diag}</span>
              <span>Diagnostics &amp; metadata</span>
              <span className="chev">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: diagnosticsExpanded ? "rotate(180deg)" : "rotate(90deg)", transition: "transform 0.2s ease" }}>
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </span>
            </button>
            <div className={`diag-body ${diagnosticsExpanded ? "" : "hidden"}`}>
              {diagCells.map(c => (
                <div className="diag-cell" key={c.k}>
                  <div className="k">{c.k}</div>
                  <div className={`v ${(c as any).err ? 'err' : ''}`}>{c.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
