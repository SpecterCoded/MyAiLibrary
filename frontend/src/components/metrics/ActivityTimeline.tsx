import React from 'react';
import { AlertTriangle, CheckCircle2, Search, XCircle } from 'lucide-react';

import { formatRelativeTime } from './utils';

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
  label: string;
  ts: string;
  query: string | null;
  raw: any;
}

const severityStyles = {
  info: {
    dot: 'bg-cyan-400',
    badge: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    icon: CheckCircle2,
  },
  warning: {
    dot: 'bg-amber-400',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: AlertTriangle,
  },
  error: {
    dot: 'bg-rose-400',
    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: XCircle,
  },
};

export function ActivityTimeline({
  items,
  search,
  setSearch,
  severityFilter,
  setSeverityFilter,
  onInspectRequest,
}: {
  items: ActivityItem[];
  search: string;
  setSearch: (value: string) => void;
  severityFilter: 'all' | 'info' | 'warning' | 'error';
  setSeverityFilter: (value: 'all' | 'info' | 'warning' | 'error') => void;
  onInspectRequest: (query: string | null) => void;
}) {
  const filters: Array<'all' | 'info' | 'warning' | 'error'> = ['all', 'info', 'warning', 'error'];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search requests, strategies, warnings..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-indigo-300 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
            aria-label="Search live activity"
          />
        </div>

        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-slate-950">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSeverityFilter(filter)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                severityFilter === filter
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {items.map((item) => {
          const style = severityStyles[item.severity];
          const Icon = style.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onInspectRequest(item.query)}
              className="group flex w-full items-start gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-left transition hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-slate-950/60 dark:hover:border-white/20"
            >
              <div className="relative flex flex-col items-center">
                <span className={`mt-1 h-3 w-3 rounded-full ${style.dot}`} />
                <span className="mt-2 h-full min-h-[42px] w-px bg-slate-200 dark:bg-white/10" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${style.badge}`}>
                    <Icon size={12} />
                    {item.label.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs font-medium text-slate-400">{formatRelativeTime(item.ts)}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400">
                  Inspect
                </div>
              </div>
            </button>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-400">
            No activity matched the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
