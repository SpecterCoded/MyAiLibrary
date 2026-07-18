import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Activity, Clock, CheckCircle2, AlertTriangle, ArrowUpRight, Database, Settings, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RagLibraryVolumeDatum, RagResource } from './types';

interface DashboardViewProps {
  resources: RagResource[];
  volumeData: RagLibraryVolumeDatum[];
  onViewVolume: () => void;
  onViewActivity: () => void;
  isDarkMode?: boolean;
}

export interface DashboardJob {
  id: string;
  name: string;
  status: string;
  time: string;
  type: string;
}

export interface DashboardActivityItem {
  id: string;
  action: string;
  details: string;
  time: string;
  icon: LucideIcon;
  color: string;
}

interface PipelineHealthItem {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'rose';
}

const formatRelativeTime = (iso: string | null) => {
  if (!iso) return 'Unknown';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return 'Unknown';
  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
};

const normalizeStatus = (status: string | null | undefined) => String(status || 'unknown').toLowerCase();

const classifyJobStatus = (resource: RagResource) => {
  const status = normalizeStatus(resource.rag_status || resource.processing_status);
  if (status === 'ready' || status === 'prepared' || status === 'chunked' || status === 'text_extracted') {
    return 'completed';
  }
  if (status.startsWith('failed')) {
    return 'failed';
  }
  return 'processing';
};

const getActivityPresentation = (resource: RagResource): Omit<DashboardActivityItem, 'id' | 'time'> => {
  const status = normalizeStatus(resource.rag_status || resource.processing_status);
  if (status === 'ready') {
    return {
      action: 'Resource ready',
      details: `${resource.title} is retrieval-ready with ${resource.vector_count} vectors.`,
      icon: CheckCircle2,
      color: 'text-emerald-400',
    };
  }
  if (status.startsWith('failed')) {
    const stage = String(resource.diagnostics.failed_stage || status.replace('failed_', '') || 'processing').split('_').join(' ');
    return {
      action: 'Pipeline failed',
      details: `${resource.title} stopped during ${stage}.`,
      icon: AlertTriangle,
      color: 'text-rose-400',
    };
  }
  if (status === 'chunked' || status === 'chaptering' || status === 'subchaptering') {
    return {
      action: 'Chunking progress',
      details: `${resource.chunk_count} chunks prepared for ${resource.title}.`,
      icon: Layers,
      color: 'text-amber-400',
    };
  }
  if (status === 'embedding' || status === 'indexing') {
    return {
      action: 'Vector pipeline active',
      details: `${resource.vector_count} vectors generated so far for ${resource.title}.`,
      icon: Database,
      color: 'text-emerald-400',
    };
  }
  return {
    action: 'Resource updated',
    details: `${resource.title} is in ${status.split('_').join(' ')} state.`,
    icon: Settings,
    color: 'text-ink-muted',
  };
};

const toneForValue = (value: number): 'emerald' | 'amber' | 'rose' => {
  if (value >= 90) return 'emerald';
  if (value >= 35) return 'amber';
  return 'rose';
};

export function buildDashboardData(resources: RagResource[]) {
  const totalResources = resources.length || 1;
  const ingestionRate = Math.round((resources.filter((resource) => resource.has_transcript).length / totalResources) * 100);
  const chunkingRate = Math.round((resources.filter((resource) => resource.chunk_count > 0).length / totalResources) * 100);
  const embeddingRate = Math.round((resources.filter((resource) => resource.vector_count > 0).length / totalResources) * 100);
  const indexingRate = Math.round((resources.filter((resource) => resource.search_index_count > 0).length / totalResources) * 100);

  const pipelineHealth: PipelineHealthItem[] = [
    { label: 'Ingestion', value: ingestionRate, tone: toneForValue(ingestionRate) },
    { label: 'Chunking & Extraction', value: chunkingRate, tone: toneForValue(chunkingRate) },
    { label: 'Vector Embedding', value: embeddingRate, tone: toneForValue(embeddingRate) },
    { label: 'Search Indexing', value: indexingRate, tone: toneForValue(indexingRate) },
  ];

  const recentJobs: DashboardJob[] = [...resources]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 6)
    .map((resource) => ({
      id: resource.id,
      name: resource.title,
      status: classifyJobStatus(resource),
      time: formatRelativeTime(resource.created_at),
      type: resource.type,
    }));

  const recentActivity: DashboardActivityItem[] = [...resources]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 8)
    .map((resource) => {
      const presentation = getActivityPresentation(resource);
      return {
        id: resource.id,
        time: formatRelativeTime(resource.created_at),
        ...presentation,
      };
    });

  return { pipelineHealth, recentJobs, recentActivity };
}

const toneToClass = (tone: PipelineHealthItem['tone']) => {
  if (tone === 'emerald') return { text: 'text-emerald-400', bg: 'bg-emerald-500' };
  if (tone === 'amber') return { text: 'text-amber-400', bg: 'bg-amber-500' };
  return { text: 'text-rose-400', bg: 'bg-rose-500' };
};

export function DashboardView({ resources, volumeData, onViewVolume, onViewActivity, isDarkMode }: DashboardViewProps) {
  const { pipelineHealth, recentJobs, recentActivity } = buildDashboardData(resources);

  return (
    <div className="flex-1 overflow-y-auto bg-panel p-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="border border-border bg-canvas p-6 col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider">Processing Volume (Last 7 Days)</h3>
            <button onClick={onViewVolume} className="text-xs text-ink-faint hover:text-ink flex items-center gap-1 transition-colors">
              View All <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart barCategoryGap={20} barGap={10} data={volumeData} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? 'rgba(255,255,255,0.22)' : 'rgba(17,17,17,0.12)'} vertical={false} />
                <XAxis dataKey="label" stroke={isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(17,17,17,0.35)'} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={isDarkMode ? 'rgba(255,255,255,0.25)' : 'rgba(17,17,17,0.25)'} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#121212', border: '1px solid rgba(255,255,255,0.1)' }}
                  itemStyle={{ color: '#fafafa' }}
                  cursor={{ fill: 'rgba(17,17,17,0.03)' }}
                />
                <Bar dataKey="chunks" fill="#cfcfcf" name="Total Chunks" radius={[2, 2, 0, 0]} />
                <Bar dataKey="vectors" fill="#1cb68a" name="Generated Vectors" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border bg-canvas p-6">
          <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider mb-6">Pipeline Health</h3>
          <div className="space-y-6">
            {pipelineHealth.map((item) => {
              const tone = toneToClass(item.tone);
              return (
                <div key={item.label}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-ink-muted">{item.label}</span>
                    <span className={tone.text}>{item.value.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-hover overflow-hidden">
                    <div className={`h-full ${tone.bg}`} style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-border bg-canvas p-6 col-span-2">
          <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider mb-6">Recent Pipeline Jobs</h3>
          <div className="divide-y divide-white/10 border border-border">
            {recentJobs.map((job) => (
              <div key={job.id} className="p-4 flex items-center justify-between hover:bg-surface transition-colors">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-surface border border-border">
                    <Activity size={16} className="text-ink-muted" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink">{job.name}</div>
                    <div className="text-xs text-ink-faint mt-0.5 flex items-center gap-1">
                      <Clock size={12} /> {job.time}
                    </div>
                  </div>
                </div>
                <div>
                  {job.status === 'completed' && <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 bg-emerald-400/10 px-2 py-1"><CheckCircle2 size={12} /> COMPLETED</span>}
                  {job.status === 'failed' && <span className="flex items-center gap-1 text-xs font-mono text-rose-400 bg-rose-400/10 px-2 py-1"><AlertTriangle size={12} /> FAILED</span>}
                  {job.status === 'processing' && <span className="flex items-center gap-1 text-xs font-mono text-amber-400 bg-amber-400/10 px-2 py-1"><Activity size={12} className="animate-pulse" /> PROCESSING</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border bg-canvas p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider">Recent Activity</h3>
            <button onClick={onViewActivity} className="text-xs text-ink-faint hover:text-ink flex items-center gap-1 transition-colors">
              View Log <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="space-y-6">
            {recentActivity.map((activity, index) => {
              const Icon = activity.icon;
              return (
                <div key={activity.id} className="relative flex gap-4">
                  {index !== recentActivity.length - 1 && (
                    <div className="absolute top-8 left-3 w-px h-full -translate-x-1/2 bg-surface-hover" />
                  )}
                  <div className={`relative z-10 w-6 h-6 rounded-full border border-border bg-panel flex items-center justify-center shrink-0 ${activity.color}`}>
                    <Icon size={10} />
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{activity.action}</p>
                      <span className="text-[10px] text-ink-faint font-mono whitespace-nowrap">{activity.time}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-1 leading-relaxed">{activity.details}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
