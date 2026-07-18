import { X, Search, Database, Fingerprint, Network, AlignLeft, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import React, { useState } from 'react';
import type { RagRetrievalPreviewResponse, RetrievalHit } from './types';

interface RetrievalPreviewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RetrievalPreview({ isOpen, onClose }: RetrievalPreviewProps) {
  const [query, setQuery] = useState('');
  const [hasQueried, setHasQueried] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<RagRetrievalPreviewResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'hybrid' | 'vector' | 'bm25' | 'reranked'>('reranked');
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    setIsLoading(true);
    setLoadError(null);
    const t0 = Date.now();
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/rag/library/retrieve-preview?q=${encodeURIComponent(query.trim())}&top_k=5`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Query failed (${res.status})`);
      const data: RagRetrievalPreviewResponse = await res.json();
      setResults(data);
      setElapsedMs(Date.now() - t0);
      setHasQueried(true);
    } catch (e: any) {
      setLoadError(e.message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    { id: 'reranked', label: 'Reranked Results', icon: AlignLeft },
    { id: 'hybrid', label: 'Hybrid Search', icon: Network },
    { id: 'vector', label: 'Vector (Semantic)', icon: Fingerprint },
    { id: 'bm25', label: 'BM25 (Lexical)', icon: Database },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-xl border border-border"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="p-2 border border-border bg-surface text-ink">
            <Search size={20} />
          </div>
          <div>
            <h2 className="text-xl font-display font-medium text-ink tracking-tight">Retrieval Preview Console</h2>
            <p className="text-sm text-ink-muted font-sans">Test how the system retrieves and ranks chunks for a given query.</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-ink-muted hover:text-ink hover:bg-surface transition-colors">
          <X size={24} />
        </button>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto p-6 overflow-hidden">
        {/* Search Input */}
        <form onSubmit={handleQuery} className="relative mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question or enter a search term..."
            className="w-full bg-panel border border-border text-ink px-6 py-4 text-lg font-sans focus:outline-none focus:border-white/30 placeholder:text-ink-faint"
            autoFocus
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="absolute right-4 top-1/2 -translate-y-1/2 px-4 py-2 bg-brand text-brand-foreground font-medium text-sm hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading ? <><RefreshCw size={14} className="animate-spin" /> Running...</> : 'Run Query'}
          </button>
        </form>

        {loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 border border-rose-500/20 bg-rose-500/5 flex items-center justify-center mb-6 text-rose-400">
              <Search size={32} />
            </div>
            <h3 className="text-xl font-display text-ink mb-2">Query Failed</h3>
            <p className="text-rose-400/80 text-sm max-w-md">{loadError}</p>
          </div>
        ) : !hasQueried ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 border border-border flex items-center justify-center mb-6 text-ink/20">
              <Search size={32} />
            </div>
            <h3 className="text-xl font-display text-ink mb-2">No retrieval preview yet</h3>
            <p className="text-ink-muted max-w-md">Run a query to inspect what the system would fetch across the entire library. This helps build trust that the RAG answer system is grounded in actual source chunks.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Tabs */}
            <div className="flex gap-1 border-b border-border mb-6">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 font-medium text-sm transition-colors relative ${isActive ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'}`}
                  >
                    <Icon size={16} />
                    {tab.label}
                    {isActive && (
                      <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-12">
              <div className="flex items-center justify-between text-xs text-ink-faint mb-4 font-mono uppercase tracking-wider">
                <span>{(results?.[activeTab] ?? []).length} Chunks Retrieved</span>
                {elapsedMs !== null && (
                  <span className="flex items-center gap-1"><RefreshCw size={12}/> {elapsedMs}ms</span>
                )}
              </div>

              {(results?.[activeTab] ?? []).length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border">
                  <p className="text-ink-muted text-sm">No results for this retrieval method.</p>
                </div>
              ) : (
                (results?.[activeTab] ?? []).map((hit: RetrievalHit, idx: number) => {
                  const score = hit.rerank_score ?? hit.hybrid_score ?? hit.bm25_score ?? hit.score ?? hit.chroma_distance ?? null;
                  const scoreLabel = score !== null ? score.toFixed(4) : '—';
                  const scoreColor = score !== null && score > 0.7 ? 'text-emerald-400' : score !== null && score > 0.4 ? 'text-amber-400' : 'text-ink-muted';
                  return (
                    <div key={idx} className="border border-border bg-panel p-5 group hover:border-border-strong transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-mono ${scoreColor} bg-current/10 px-2 py-0.5`}>Score: {scoreLabel}</span>
                            {hit.chunk_index !== undefined && (
                              <span className="text-xs text-ink-faint font-mono">Chunk #{hit.chunk_index}</span>
                            )}
                          </div>
                          {hit.resource_title && (
                            <h4 className="text-ink font-medium">{hit.resource_title}</h4>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-ink-muted font-sans leading-relaxed">{hit.content}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
