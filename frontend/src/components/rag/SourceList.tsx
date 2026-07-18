import React, { useMemo } from 'react';
import { LibraryBig, Check } from 'lucide-react';

import type { RAGSource } from './types';

interface SourceListProps {
  sources: RAGSource[];
  onOpenSource?: (source: RAGSource) => void;
  theme?: 'light' | 'dark';
}

function getSourceIdentity(source: RAGSource): string {
  return String(source.resource_id || source.resource_path || source.resource_title || 'source').trim().toLowerCase();
}

// Build a mapping from resource identity to doc number (1-based, by best score order)
function buildDocNumberMap(sources: RAGSource[]): Map<string, number> {
  const docMap = new Map<string, number>();
  const sorted = [...sources].sort((a, b) => getSourceScore(b) - getSourceScore(a));
  let counter = 1;
  for (const source of sorted) {
    const key = getSourceIdentity(source);
    if (!docMap.has(key)) {
      docMap.set(key, counter++);
    }
  }
  return docMap;
}

function getSourceScore(source: RAGSource): number {
  // Try primary score fields first, then fall back to any other score-like field the backend may return
  const raw = source as any;
  const score =
    source.rerank_score ??
    source.hybrid_score ??
    raw.confidence ??
    raw.score ??
    raw.similarity ??
    raw.relevance_score ??
    null;
  if (score == null || !Number.isFinite(score)) return 0;
  return score;
}

function getMatchTier(score: number): 'high' | 'medium' | 'low' {
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 85) return 'high';
  if (pct >= 70) return 'medium';
  return 'low';
}

function formatMatchPercent(source: RAGSource): { label: string; tier: 'high' | 'medium' | 'low' } | null {
  const score = getSourceScore(source);
  if (!score) return null;
  const normalized = score <= 1 ? score * 100 : score;
  const clamped = Math.max(1, Math.min(99, Math.round(normalized)));
  return { label: `${clamped}% Match`, tier: getMatchTier(normalized) };
}

function uniqueSourcesByDocument(sources: RAGSource[]): RAGSource[] {
  const bestByDocument = new Map<string, RAGSource>();

  for (const source of sources) {
    const key = getSourceIdentity(source);
    const current = bestByDocument.get(key);
    if (!current || getSourceScore(source) > getSourceScore(current)) {
      bestByDocument.set(key, source);
    }
  }

  return Array.from(bestByDocument.values()).sort((a, b) => getSourceScore(b) - getSourceScore(a));
}

export default function SourceList({ sources, onOpenSource: _onOpenSource, theme = 'light' }: SourceListProps) {
  const items = useMemo(() => uniqueSourcesByDocument(sources), [sources]);
  const docMap = useMemo(() => buildDocNumberMap(sources), [sources]);
  const isDark = theme === 'dark';

  if (items.length === 0) return null;

  return (
    <section className={`mt-4 border-t pt-3 ${isDark ? 'border-white/10' : 'border-gray-100/80'}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <LibraryBig size={13} className={isDark ? 'text-indigo-300' : 'text-indigo-500'} />
        <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Retrieved References ({items.length} Source{items.length === 1 ? '' : 's'} Used)
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {items.map((source, index) => {
          const match = formatMatchPercent(source);
          const docNum = docMap.get(getSourceIdentity(source)) || index + 1;

          return (
            <div
              key={`${getSourceIdentity(source)}-${index}`}
              className={`group rounded-2xl border p-3 text-left transition-all duration-200 ${
                isDark
                  ? 'border-white/10 bg-white/5 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.07]'
                  : 'border-gray-100/90 bg-white/95 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.2)] hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_18px_40px_-20px_rgba(15,23,42,0.22)]'
              } cursor-default`}
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ${
                  isDark ? 'bg-indigo-400/15 text-indigo-200' : 'bg-indigo-600 text-white'
                }`}>
                  Doc{docNum}
                </span>
                {match && (() => {
                  const tierClasses = {
                    high: isDark
                      ? 'bg-emerald-400/10 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-600',
                    medium: isDark
                      ? 'bg-amber-400/10 text-amber-300'
                      : 'bg-amber-50 text-amber-600',
                    low: isDark
                      ? 'bg-rose-400/10 text-rose-300'
                      : 'bg-rose-50 text-rose-600',
                  }[match.tier];
                  return (
                    <span className={`inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-semibold ${tierClasses}`}>
                      <Check size={10} strokeWidth={3} />
                      {match.label}
                    </span>
                  );
                })()}
              </div>

              <div className={`line-clamp-2 text-[12px] font-semibold leading-[1.15rem] ${isDark ? 'text-white' : 'text-slate-800'}`}>
                {source.resource_title || 'Untitled source'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
