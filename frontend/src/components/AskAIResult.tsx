import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

// ---------- Types ----------
interface CitationSource {
  chunk_index: number;
  excerpt: string;
  rerank_score?: number | null;
  hybrid_score?: number | null;
  resource_id?: string | null;
  resource_title?: string | null;
  resource_path?: string | null;
}

interface AskAIResultProps {
  query: string;
  onClose: () => void;
  onLoadingChange?: (loading: boolean) => void;
}

// ---------- Helpers ----------
function getFileIcon(path?: string | null) {
  if (!path) return 'doc';
  const ext = path.split('.').pop()?.toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext ?? '')) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext ?? '')) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext ?? '')) return 'image';
  if (['docx', 'doc'].includes(ext ?? '')) return 'doc';
  return 'doc';
}

const FILE_ICONS: Record<string, React.ReactNode> = {
  video: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  ),
  audio: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  ),
  pdf: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  image: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="8.5" cy="8.5" r="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="21 15 16 10 5 21" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  doc: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
};

// ---------- Typewriter hook ----------
function useTypewriter(text: string, speed: number = 14) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (!text) return;

    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) {
        clearInterval(interval);
        setDone(true);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

// ---------- Main component ----------
export default function AskAIResult({ query, onClose, onLoadingChange }: AskAIResultProps) {
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<CitationSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { displayed: typedAnswer, done: typingDone } = useTypewriter(answer, 14);

  // Deduplicate by resource_id + chunk_index so every unique chunk shows separately
  const uniqueSources = sources.reduce<CitationSource[]>((acc, src) => {
    const key = `${src.resource_id ?? ''}_${src.chunk_index}`;
    if (!acc.find(s => `${s.resource_id ?? ''}_${s.chunk_index}` === key)) {
      acc.push(src);
    }
    return acc;
  }, []);

  const fetchAnswer = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    onLoadingChange?.(true);
    setError(null);
    setAnswer('');
    setSources([]);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/library/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question: query, concise: true }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.detail ?? `Error ${res.status}`);
      }

      const data = await res.json();
      setAnswer(data.answer ?? '');
      setSources(data.sources ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      setError(msg);
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }, [query]);

  useEffect(() => {
    fetchAnswer();
  }, [fetchAnswer]);

  // Copy answer
  const [copied, setCopied] = useState(false);
  function copyAnswer() {
    if (!answer) return;
    navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {/* Floating overlay panel — absolute, sits over playlist cards, matches HTML design */}
      <div
        ref={panelRef}
        id="ask-ai-result-panel"
        className="bg-white/95 backdrop-blur-3xl border border-slate-200/70 rounded-[28px] p-6 shadow-2xl flex flex-col gap-4"
      >
        {/* Header — matches HTML: AI Response label + action buttons + close */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.2 }}
          className="flex items-center justify-between border-b border-slate-100 pb-3 select-none"
        >
          <div className="flex items-center gap-2 font-bold text-blue-600 text-[14px] tracking-tight">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M9.813 15.904L9 21l-.813-5.096L3.096 15 8 14.187 8.904 9l.917 5.187L15 15l-5.187.904zM18 7l-.5 2.5L15 10l2.5.5L18 13l.5-2.5 2.5-.5-2.5-.5L18 7z" />
            </svg>
            <span>AI Response</span>
            {loading && (
              <span className="flex items-center gap-1 ml-2 text-slate-400 font-medium text-[12px]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '240ms' }} />
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Copy */}
            <button
              type="button"
              onClick={copyAnswer}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Copy"
            >
              {copied ? (
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
              )}
            </button>
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </motion.div>

        {/* Subtitle — matches HTML responseSubtitle */}
        <motion.p
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.2 }}
          className="text-[13px] font-semibold text-slate-500 px-0.5"
        >
          {query}
        </motion.p>

        {/* Body */}
        {error ? (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl p-4">
            <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[13px] font-bold text-red-600">Could not get an answer</p>
              <p className="text-[12px] text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

            {/* ---- Answer column (left col-span-2): AI answer text + all chunk excerpt cards ---- */}
            <div
              className="lg:col-span-2 max-h-[350px] overflow-y-auto pr-2 space-y-2.5 min-w-0"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(148,163,184,.25) transparent' }}
            >
              {loading && !typedAnswer ? (
                <div className="space-y-2.5 animate-pulse">
                  {[100, 85, 92, 70].map((w, i) => (
                    <div key={i} className="h-3.5 rounded-full bg-slate-100" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : (
                <>
                  {/* AI answer card */}
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.25 }}
                    className="bg-white border border-slate-200/50 rounded-xl p-3 flex items-start gap-3.5 shadow-sm"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-6.857L5 12l5.714-2.286L13 3z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {typedAnswer}
                        {!typingDone && (
                          <span
                            className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 align-middle"
                            style={{ animation: 'blink 0.8s step-end infinite' }}
                          />
                        )}
                      </p>
                    </div>
                  </motion.div>

                  {/* Chunk excerpt cards — appear after answer finishes typing */}
                  {typingDone && uniqueSources.map((src, i) => {
                    return (
                      <div
                        key={`chunk-${src.resource_id}-${src.chunk_index}`}
                        className="bg-white border border-slate-200/50 rounded-xl p-3 flex items-start gap-3.5 shadow-sm"
                        style={{
                          animation: 'chunkFadeIn 0.4s ease both',
                          animationDelay: `${i * 120}ms`,
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-6.857L5 12l5.714-2.286L13 3z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-slate-600 leading-relaxed whitespace-pre-wrap">
                            {src.excerpt}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* ---- Sources column (right): unique files only, dedup by resource_id ---- */}
            {(() => {
              const uniqueFiles = sources.reduce<CitationSource[]>((acc, src) => {
                if (!acc.find(s => s.resource_id === src.resource_id)) acc.push(src);
                return acc;
              }, []);
              return (
                <div className="space-y-3.5 lg:border-l lg:border-slate-200/60 lg:pl-6 min-w-0 select-none flex flex-col">
                  <h4 className="text-[13px] font-bold text-slate-700">
                    Sources from your library
                    {uniqueFiles.length > 0 && (
                      <span className="ml-1.5 text-slate-400 font-medium">({uniqueFiles.length})</span>
                    )}
                  </h4>

                  <div
                    className="space-y-2 max-h-[280px] overflow-y-auto pr-1 flex-1"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(148,163,184,.25) transparent' }}
                  >
                    {loading && uniqueFiles.length === 0 ? (
                      <>
                        {[1, 2, 3].map(i => (
                          <div key={i} className="animate-pulse bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-2.5 bg-slate-100 rounded-full w-3/4" />
                              <div className="h-2 bg-slate-100 rounded-full w-1/2" />
                            </div>
                          </div>
                        ))}
                      </>
                    ) : uniqueFiles.length === 0 && !loading ? (
                      <div className="text-[12px] text-slate-400 font-medium py-2">
                        No sources found in your library for this query.
                      </div>
                    ) : (
                      uniqueFiles.map((src, i) => {
                        const iconType = getFileIcon(src.resource_path);
                        const title = src.resource_title ?? src.resource_path?.split(/[/\\]/).pop() ?? `Source ${i + 1}`;
                        const subtitle = src.resource_path
                          ? src.resource_path.split(/[/\\]/).pop()
                          : title;
                        return (
                          <motion.button
                            key={`file-${src.resource_id}`}
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 + i * 0.06, duration: 0.2 }}
                            onClick={() => {
                              const token = localStorage.getItem('access_token');
                              const fileUrl = `${window.location.origin}/resources/${src.resource_id}/file`;
                              const isVideo = iconType === 'video';
                              const isAudio = iconType === 'audio';

                              if (isVideo || isAudio) {
                                const paramKey = isAudio ? "audioUrl" : "videoUrl";
                                const playerUrl = `${window.location.origin}/?${paramKey}=${encodeURIComponent(fileUrl)}&resourceId=${src.resource_id}&token=${token}`;
                                window.open(playerUrl, '_blank');
                              } else {
                                window.open(fileUrl, '_blank');
                              }
                            }}
                            className="w-full text-left bg-white border border-slate-200/50 rounded-xl p-3 flex items-center gap-3 shadow-xs hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0 border border-blue-100/10">
                              {FILE_ICONS[iconType]}
                            </div>
                            <div className="truncate flex-1">
                              <h5 className="text-xs font-bold text-slate-800 truncate leading-tight">{title}</h5>
                              <p className="text-[9.5px] text-slate-400 font-medium mt-0.5 truncate">{subtitle}</p>
                            </div>
                          </motion.button>
                        );
                      })
                    )}
                  </div>

                  {uniqueFiles.length > 0 && (
                    <div className="pt-1 mt-auto">
                      <span className="text-[12px] font-bold text-blue-600">
                        {sources.length} chunk{sources.length !== 1 ? 's' : ''} · {uniqueFiles.length} file{uniqueFiles.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes chunkFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
