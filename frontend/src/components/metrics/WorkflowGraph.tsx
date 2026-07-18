import React from 'react';

import type { WorkflowNodeState } from './types';

const statusMap: Record<WorkflowNodeState['status'], string> = {
  executed: 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
  skipped: 'border-slate-200 bg-slate-100/80 text-slate-500 dark:border-white/10 dark:bg-slate-900 dark:text-slate-500',
  retry: 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  warning: 'border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
  idle: 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-slate-950 dark:text-slate-500',
};

const badgeMap: Record<WorkflowNodeState['status'], string> = {
  executed: 'border-emerald-200 bg-white/80 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
  skipped: 'border-slate-200 bg-white/80 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
  retry: 'border-amber-200 bg-white/80 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
  warning: 'border-rose-200 bg-white/80 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
  idle: 'border-slate-200 bg-white/80 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
};

export function WorkflowGraph({
  nodes,
  compact = false,
}: {
  nodes: WorkflowNodeState[];
  compact?: boolean;
}) {
  return (
    <div className={`grid items-stretch gap-4 ${compact ? 'grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3'}`}>
      {nodes.map((node, index) => (
        <div key={node.id} className="relative min-w-0">
          {index < nodes.length - 1 && !compact && (
            <div className="absolute left-1/2 top-full hidden h-4 w-px -translate-x-1/2 bg-slate-200/80 dark:bg-white/10 xl:block" />
          )}
          <div className={`flex h-full min-h-[112px] min-w-[140px] flex-col overflow-hidden rounded-2xl border px-4 py-4 shadow-sm ${statusMap[node.status]}`}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="whitespace-normal text-[11px] font-bold uppercase tracking-wider opacity-70 [overflow-wrap:normal] [word-break:normal]">{node.id}</div>
                <div className="mt-2 whitespace-normal text-sm font-semibold leading-5 [overflow-wrap:normal] [word-break:normal]">{node.label}</div>
              </div>
              <span className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${badgeMap[node.status]}`}>
                {node.status}
              </span>
            </div>
            {(node.durationMs != null || node.note) && (
              <div className="mt-auto space-y-1 pt-3 text-xs leading-5 opacity-80">
                {node.durationMs != null && <div className="whitespace-normal [overflow-wrap:normal] [word-break:normal]">{Math.round(node.durationMs)} ms</div>}
                {node.note && <div className="whitespace-normal [overflow-wrap:normal] [word-break:normal]">{node.note}</div>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
