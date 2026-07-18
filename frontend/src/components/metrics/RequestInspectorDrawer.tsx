import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

import type { RequestRecord } from './types';
import { formatDuration, formatPercent } from './utils';
import { WorkflowGraph } from './WorkflowGraph';

export function RequestInspectorDrawer({
  request,
  onClose,
}: {
  request: RequestRecord | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, request]);

  return (
    <AnimatePresence>
      {request && (
        <>
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            type="button"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm"
            aria-label="Close request inspector"
          />
          <motion.aside
            initial={{ x: 480, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/10 bg-white/95 shadow-2xl backdrop-blur-2xl dark:bg-slate-950/95"
          >
            <div className="flex items-start justify-between border-b border-black/5 px-6 py-5 dark:border-white/10">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Request inspector</div>
                <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{request.query}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {new Date(request.ts).toLocaleString()} • {request.retrievalStrategy || 'strategy unavailable'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <InspectorStat label="Confidence" value={request.confidenceLabel || (request.confidence != null ? request.confidence.toFixed(2) : 'n/a')} />
                <InspectorStat label="Latency" value={formatDuration(request.latencyMs)} />
                <InspectorStat label="Cache" value={request.cacheHit == null ? 'n/a' : request.cacheHit ? 'Hit' : 'Miss'} />
                <InspectorStat label="Chunks" value={String(request.chunks)} />
                <InspectorStat label="Hallucinations" value={String(request.hallucinations)} />
                <InspectorStat label="Retrieval quality" value={request.avgRerank != null ? formatPercent(request.avgRerank * 100) : 'n/a'} />
              </div>

              <InspectorSection title="Planner & reasoning">
                <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <p><span className="font-semibold text-slate-900 dark:text-white">Strategy:</span> {request.retrievalStrategy || 'Unavailable'}</p>
                  <p><span className="font-semibold text-slate-900 dark:text-white">Complexity:</span> {request.complexity || 'Unavailable'}</p>
                  <p><span className="font-semibold text-slate-900 dark:text-white">Reasoning:</span> {request.plannerReasoning || 'No planner reasoning was logged for this request.'}</p>
                </div>
              </InspectorSection>

              <InspectorSection title="Workflow graph">
                <WorkflowGraph nodes={request.workflowNodes} compact />
              </InspectorSection>

              <InspectorSection title="Expansion & diagnostics">
                <div className="grid gap-3 md:grid-cols-2">
                  <InspectorPill label="Parent expansion" value={request.parentExpansionUsed ? 'Enabled' : 'Skipped'} tone={request.parentExpansionUsed ? 'success' : 'neutral'} />
                  <InspectorPill label="Hierarchical retrieval" value={request.hierarchicalUsed ? 'Enabled' : 'Skipped'} tone={request.hierarchicalUsed ? 'success' : 'neutral'} />
                  <InspectorPill label="Retries" value={String(request.retryCount)} tone={request.retryCount > 0 ? 'warning' : 'neutral'} />
                  <InspectorPill label="Warnings" value={String(request.warningCount)} tone={request.warningCount > 0 ? 'warning' : 'neutral'} />
                </div>
                {request.fallbackReasons.length > 0 && (
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-500 dark:text-slate-400">
                    {request.fallbackReasons.map((reason, index) => (
                      <li key={`${reason}-${index}`}>{reason}</li>
                    ))}
                  </ul>
                )}
              </InspectorSection>

              <InspectorSection title="Modules executed">
                {request.modulesExecuted.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {request.modulesExecuted.map((moduleName) => (
                      <span key={moduleName} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
                        {moduleName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No module-level telemetry was logged for this request.</p>
                )}
              </InspectorSection>

              <InspectorSection title="Raw event timeline">
                <div className="space-y-3">
                  {request.relatedEvents.map((event, index) => (
                    <div key={`${event.ts || index}-${index}`} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-900/70">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {(event.type || 'request').replace(/_/g, ' ')}
                        </div>
                        <div className="text-xs text-slate-400">{event.status || 'logged'}</div>
                      </div>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-500 dark:text-slate-400">
                        {JSON.stringify(event.details || event, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </InspectorSection>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white/70 p-5 dark:border-white/10 dark:bg-slate-900/70">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InspectorStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function InspectorPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'neutral';
}) {
  const toneClass = tone === 'success'
    ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/20 dark:text-amber-300'
      : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-2 text-sm font-semibold">{value}</div>
    </div>
  );
}
