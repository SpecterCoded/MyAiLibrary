import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

import { fetchResponseTelemetry, hasCompleteResponseTelemetryData, hasResponseTelemetryData } from './responseTelemetry';
import type { RAGResponseDetails } from './types';

interface ResponseDetailsPanelProps {
  query?: string;
  initialDetails?: Partial<RAGResponseDetails>;
}

function formatBoolean(value: boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value ? 'Yes' : 'No';
}

function formatMs(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `${Math.round(value)} ms`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-slate-50/70 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-700">{value}</div>
    </div>
  );
}

export default function ResponseDetailsPanel({ query, initialDetails }: ResponseDetailsPanelProps) {
  const detailsCacheKey = query ? `response-details:${query.trim()}` : null;
  const loadCachedDetails = (): Partial<RAGResponseDetails> => {
    if (!detailsCacheKey) return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(detailsCacheKey) || "{}");
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<Partial<RAGResponseDetails>>({
    ...loadCachedDetails(),
    ...(initialDetails || {}),
  });

  useEffect(() => {
    const cachedDetails = loadCachedDetails();
    const merged = { ...cachedDetails, ...(initialDetails || {}) };
    setDetails(merged);
    setLoaded(hasResponseTelemetryData(merged));
  }, [detailsCacheKey, initialDetails, query]);

  useEffect(() => {
    if (!detailsCacheKey || !hasResponseTelemetryData(details)) return;
    try {
      localStorage.setItem(detailsCacheKey, JSON.stringify(details));
    } catch {
      // Ignore persistence failures for response metadata.
    }
  }, [details, detailsCacheKey]);

  useEffect(() => {
    // If initialDetails already has any usable telemetry (e.g. confidence + hallucination data
    // from the stream's final event), show it immediately without a network fetch.
    if (hasResponseTelemetryData(initialDetails)) {
      setLoaded(true);
      setLoading(false);
      return;
    }
    if (loaded || !query) {
      setLoading(false);
      return;
    }
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;
    const maxAttempts = 5;

    const load = async () => {
      attemptCount += 1;
      setLoading(true);
      try {
        const telemetry = await fetchResponseTelemetry(query, localStorage.getItem('access_token'));
        if (active) {
          const merged = { ...(initialDetails || {}), ...loadCachedDetails(), ...telemetry };
          setDetails((prev) => ({ ...prev, ...telemetry }));

          if (hasCompleteResponseTelemetryData(merged)) {
            setLoaded(true);
            setLoading(false);
            return;
          }

          if (attemptCount >= maxAttempts) {
            if (hasResponseTelemetryData(merged)) {
              setLoaded(true);
            }
            setLoading(false);
            return;
          }

          retryTimer = setTimeout(() => {
            if (active) {
              void load();
            }
          }, 1200);
        }
      } catch {
        if (active) {
          if (attemptCount >= maxAttempts) {
            setLoaded(true);
            setLoading(false);
            return;
          }
          retryTimer = setTimeout(() => {
            if (active) {
              void load();
            }
          }, 1200);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [initialDetails, loaded, query]);

  const rows = useMemo<Array<[string, React.ReactNode]>>(() => ([
    ['Confidence score', details.confidenceLabel || (details.confidence != null ? details.confidence.toFixed(2) : null)],
    ['Retrieval strategy', details.retrievalStrategy || null],
    ['Cache hit', formatBoolean(details.cacheHit)],
    ['Retrieved chunks', details.retrievedChunks ?? null],
    ['Parent expansion used', formatBoolean(details.parentExpansionUsed)],
    ['Hierarchical retrieval used', formatBoolean(details.hierarchicalRetrievalUsed)],
    ['Hallucination check', details.hallucinationCheckPassed == null ? null : (details.hallucinationCheckPassed ? 'Passed' : 'Issues detected')],
    ['Hallucination count', details.hallucinationCount ?? null],
    ['Processing time', formatMs(details.processingTimeMs)],
    ['Modules executed', details.modulesExecuted && details.modulesExecuted.length > 0 ? details.modulesExecuted.join(', ') : null],
    ['Planner reasoning', details.reasoning || null],
  ]), [details]);

  const visibleRows = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!query && visibleRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 cursor-pointer"
      >
        Response Details
        {loading ? <Loader2 size={12} className="animate-spin" /> : open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-3">
          {visibleRows.length === 0 ? (
            <p className="text-xs text-gray-400">Advanced response metadata is unavailable for this answer.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {visibleRows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
