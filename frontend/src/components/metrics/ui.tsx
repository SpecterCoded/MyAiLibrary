import React from 'react';
import { motion } from 'framer-motion';
import { Expand, Minus, TrendingDown, TrendingUp } from 'lucide-react';

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  onExpand,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onExpand?: () => void;
}) {
  return (
    <section className="w-full min-w-0 rounded-[24px] border border-slate-200/60 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/55">
      <div className="flex items-start justify-between gap-4 border-b border-black/5 px-6 py-5 dark:border-white/10">
        <div>
          <h3 className="font-serif text-lg italic tracking-tight text-slate-900 dark:text-white">{title}</h3>
          {subtitle && <p className="mt-1 text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-white"
              aria-label={`Expand ${title}`}
            >
              <Expand size={14} />
            </button>
          )}
          {collapsible && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
            >
              {collapsed ? 'Show' : 'Hide'}
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="p-6">{children}</div>}
    </section>
  );
}

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  sparkline,
  tone = 'default',
  status,
}: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number | null;
  sparkline?: number[];
  tone?: 'default' | 'success' | 'warning' | 'danger';
  status?: string;
}) {
  const toneMap: Record<string, string> = {
    default: 'from-sky-500/15 via-indigo-500/10 to-transparent',
    success: 'from-emerald-500/15 via-teal-500/10 to-transparent',
    warning: 'from-amber-500/18 via-orange-500/10 to-transparent',
    danger: 'from-rose-500/18 via-pink-500/10 to-transparent',
  };
  const trendUp = (trend ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-[24px] border border-slate-200/60 bg-white px-5 py-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{title}</div>
          <div className="mt-3 font-sans text-4xl font-semibold tracking-tight text-slate-950 [font-variant-numeric:tabular-nums] dark:text-white">{value}</div>
          {subtitle && <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
        </div>
        <div className="flex flex-col items-end gap-2">
          {status && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              {status}
            </span>
          )}
          {trend != null && (
            <span className={`inline-flex items-center gap-1 px-1 py-1 text-[11px] font-bold ${trendUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
              {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} />}
    </motion.div>
  );
}

export function Sparkline({ data, color = '#2b4c3b' }: { data: number[]; color?: string }) {
  const width = 180;
  const height = 48;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-12 w-full overflow-visible">
      <defs>
        <linearGradient id="sparklineFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <polyline
        fill="url(#sparklineFill)"
        stroke="none"
        points={`0,${height} ${points} ${width},${height}`}
      />
    </svg>
  );
}

export function DistributionBars({
  items,
  formatter,
}: {
  items: Array<{ label: string; value: number }>;
  formatter?: (value: number) => string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
            <span className="text-slate-400">{formatter ? formatter(item.value) : item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-400"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({
  items,
}: {
  items: Array<{ label: string; value: number }>;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const colors = ['#6366F1', '#06B6D4', '#22C55E', '#F59E0B', '#F43F5E', '#8B5CF6'];
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0">
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="18" />
        {items.map((item, index) => {
          const percent = item.value / total;
          const dash = percent * 264;
          const strokeDasharray = `${dash} ${264 - dash}`;
          const strokeDashoffset = -offset;
          offset += dash;
          return (
            <circle
              key={item.label}
              cx="60"
              cy="60"
              r="42"
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth="18"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 60 60)"
              strokeLinecap="round"
            />
          );
        })}
        <text x="60" y="56" textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold uppercase tracking-widest">
          Total
        </text>
        <text x="60" y="72" textAnchor="middle" className="fill-slate-900 text-[16px] font-semibold dark:fill-white">
          {total}
        </text>
      </svg>

      <div className="space-y-2 text-sm">
        {items.map((item, index) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
            <span className="font-semibold text-slate-900 dark:text-white">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniAreaChart({ data, color = '#2b4c3b' }: { data: number[]; color?: string }) {
  if (data.length <= 1) return <div className="h-32 rounded-2xl bg-slate-50 dark:bg-slate-900/60" />;

  const width = 360;
  const height = 140;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 12) - 6;
    return [x, y] as const;
  });
  const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full">
      <defs>
        <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#areaGradient)" />
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r="3.5" fill={color} />
      ))}
    </svg>
  );
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-white/10 dark:bg-slate-950/30">
      <Minus className="mb-3 text-slate-300 dark:text-slate-600" />
      <h4 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h4>
      <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}
