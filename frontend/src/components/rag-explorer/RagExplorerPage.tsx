import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { 
  Database, 
  Search, 
  Layers, 
  Activity, 
  RefreshCw, 
  Download, 
  FileText, 
  FileVideo, 
  FileAudio, 
  FileImage, 
  FileCode2,
  File,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  Settings,
  ArrowLeft,
  Moon,
  Sun,
  Trash2,
  Archive,
  GitCompare,
  X,
  ChevronDown
} from 'lucide-react';
import type { RagLibraryVolumeDatum, RagLibraryVolumeResponse, RagResource, RagLibraryOverviewResponse } from './types';
import './ragExplorer.css';
import { ResourceDetailPanel } from './ResourceDetailPanel';
import { RetrievalPreview } from './RetrievalPreview';
import { DashboardView, buildDashboardData } from './DashboardView';

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}

function FilterDropdown({ value, onChange, options, label }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-transparent border border-border-strong text-sm px-3 py-2 text-ink hover:bg-surface-hover transition-colors min-w-[120px] justify-between"
      >
        <span className="truncate">{selected?.label ?? label}</span>
        <ChevronDown size={14} className={`text-ink-faint transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-panel border border-border-strong shadow-lg z-50 py-1">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => { onChange(option.value); setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                value === option.value
                  ? 'bg-surface-hover text-ink font-medium'
                  : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface RagExplorerPageProps {
  theme?: 'light' | 'dark' | 'system';
  setTheme?: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'system'>>;
}

export default function App({ theme, setTheme }: RagExplorerPageProps) {
  const resolveDark = (t: string) => {
    if (t === 'dark') return true;
    if (t === 'light') return false;
    // 'system' – read the class App.tsx already resolved onto <html>
    return document.documentElement.classList.contains('dark');
  };

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (theme) return resolveDark(theme);
    const saved = localStorage.getItem('ragx-theme');
    if (saved !== null) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [currentView, setCurrentView] = useState<'explorer' | 'dashboard' | 'processing-volume' | 'activity-logs'>('explorer');
  const [resources, setResources] = useState<RagResource[]>([]);
  const [volumeData, setVolumeData] = useState<RagLibraryVolumeDatum[]>([]);
  const [selectedResource, setSelectedResource] = useState<RagResource | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [dockJobs, setDockJobs] = useState<{ id: string; title: string; status: string; detail?: string }[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const normalizeType = (type: string) => {
    const value = String(type || '').toLowerCase();
    return value === 'youtube' ? 'video' : value;
  };

  const normalizeStatus = (status: string | null | undefined) => String(status || 'unknown').toLowerCase();

  const formatStatusLabel = (status: string | null | undefined) => normalizeStatus(status).split('_').join(' ');

  const isFailedStatus = (resource: RagResource) => {
    const status = normalizeStatus(resource.rag_status || resource.processing_status);
    if (status === 'ready' || status === 'prepared') return false;
    return status.startsWith('failed') || !!resource.diagnostics.failed_stage || !resource.diagnostics.healthy;
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedResourceIds(new Set(filteredResources.map(r => r.id)));
    } else {
      setSelectedResourceIds(new Set());
    }
  };

  const handleSelectOne = (e: React.MouseEvent | React.ChangeEvent, id: string) => {
    e.stopPropagation();
    const newSelected = new Set(selectedResourceIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedResourceIds(newSelected);
  };

  useEffect(() => {
    if (theme) {
      setIsDarkMode(resolveDark(theme));
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ragx-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const toggleTheme = () => {
    if (setTheme) {
      setTheme((current) => ((current === 'light') ? 'dark' : 'light'));
      return;
    }
    setIsDarkMode(!isDarkMode);
  };

  const fetchResources = async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (showLoading) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [overviewRes, volumeRes] = await Promise.all([
        fetch('/rag/library/overview?page_size=100&sort_by=created_at&sort_order=desc', { headers }),
        fetch('/rag/library/volume?days=7', { headers }),
      ]);
      if (!overviewRes.ok) throw new Error(`Failed to load library (${overviewRes.status})`);
      if (!volumeRes.ok) throw new Error(`Failed to load volume data (${volumeRes.status})`);
      const overviewData: RagLibraryOverviewResponse = await overviewRes.json();
      const volumeResponse: RagLibraryVolumeResponse = await volumeRes.json();
      setResources(overviewData.resources);
      setVolumeData(volumeResponse.data);
    } catch (e: any) {
      if (showLoading) {
        setLoadError(e.message || 'Unknown error');
      }
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const authHeaders = () => {
    const token = localStorage.getItem('access_token');
    return { Authorization: `Bearer ${token}` };
  };

  const handleDeleteSelected = () => {
    if (selectedResourceIds.size === 0) return;
    setConfirmModal({
      message: `Delete ${selectedResourceIds.size} resource(s)? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsActionLoading(true);
        try {
          const ids = Array.from(selectedResourceIds);
          const results = await Promise.allSettled(
            ids.map((id) => fetch(`/resources/${id}`, { method: 'DELETE', headers: authHeaders() }))
          );
          const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
          if (failures.length > 0) {
            window.alert(`Failed to delete ${failures.length} resource(s).`);
          }
          setSelectedResourceIds(new Set());
          fetchResources({ showLoading: false });
        } finally {
          setIsActionLoading(false);
        }
      },
    });
  };

  const handleReprocessSelected = () => {
    if (selectedResourceIds.size === 0) return;
    setConfirmModal({
      message: `Re-process ${selectedResourceIds.size} resource(s)? This will re-chunk and re-embed them.`,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsActionLoading(true);
        try {
          const ids = Array.from(selectedResourceIds);
          const results = await Promise.allSettled(
            ids.map((id) => fetch(`/resources/${id}/reprocess`, { method: 'POST', headers: authHeaders() }))
          );
          const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
          if (failures.length > 0) {
            window.alert(`Failed to re-process ${failures.length} resource(s).`);
          }
          setSelectedResourceIds(new Set());
          fetchResources({ showLoading: false });
        } finally {
          setIsActionLoading(false);
        }
      },
    });
  };

  const handleEmbedSelected = () => {
    if (selectedResourceIds.size === 0) return;
    setConfirmModal({
      message: `Embed ${selectedResourceIds.size} resource(s)? This will generate vector embeddings for retrieval.`,
      onConfirm: async () => {
        setConfirmModal(null);
        setIsActionLoading(true);
        try {
          const ids = Array.from(selectedResourceIds);
          const results = await Promise.allSettled(
            ids.map((id) => fetch(`/resources/${id}/index`, { method: 'POST', headers: authHeaders() }))
          );
          const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
          if (failures.length > 0) {
            window.alert(`Failed to queue ${failures.length} resource(s) for embedding.`);
          }
          const newJobs = ids
            .filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<Response>).value.ok)
            .map((id) => {
              const res = resources.find((r) => r.id === id);
              return { id, title: res?.title ?? id, status: 'queued' };
            });
          setDockJobs((prev) => [...prev, ...newJobs]);
          setSelectedResourceIds(new Set());
          fetchResources({ showLoading: false });
        } finally {
          setIsActionLoading(false);
        }
      },
    });
  };

  useEffect(() => {
    if (dockJobs.length === 0) return;
    const interval = setInterval(async () => {
      const updated = await Promise.all(
        dockJobs.map(async (job) => {
          if (job.status === 'completed' || job.status === 'failed') return job;
          try {
            const token = localStorage.getItem('access_token');
            const res = await fetch(`/queue/${job.id}`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) return job;
            const data = await res.json();
            return { ...job, status: data.job_status ?? data.status ?? job.status, detail: data.detail_status };
          } catch {
            return job;
          }
        })
      );
      setDockJobs(updated);
    }, 3000);
    return () => clearInterval(interval);
  }, [dockJobs.length]);

  const removeDockJob = (id: string) => setDockJobs((prev) => prev.filter((j) => j.id !== id));

  const handleExportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      stats,
      health_distribution: healthData,
      resources: filteredResources.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        rag_status: r.rag_status,
        chunk_count: r.chunk_count,
        vector_count: r.vector_count,
        health_score: r.diagnostics.health_score,
        healthy: r.diagnostics.healthy,
        created_at: r.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-library-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportDiagnostics = () => {
    const ids = Array.from(selectedResourceIds);
    const selected = resources.filter((r) => ids.includes(r.id));
    if (selected.length === 0) return;
    const payload = {
      generated_at: new Date().toISOString(),
      diagnostics: selected.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        rag_status: r.rag_status,
        health_score: r.diagnostics.health_score,
        healthy: r.diagnostics.healthy,
        issues: r.diagnostics.issues,
        warnings: r.diagnostics.warnings,
        failed_stage: r.diagnostics.failed_stage,
        last_completed_stage: r.diagnostics.last_completed_stage,
        chunk_count: r.chunk_count,
        vector_count: r.vector_count,
        search_index_count: r.search_index_count,
        has_transcript: r.has_transcript,
        has_summary: r.has_summary,
        transcript_chars: r.transcript_chars,
        summary_chars: r.summary_chars,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchResources();
  }, []);

  useEffect(() => {
    const hasActiveJobs = dockJobs.some((job) => job.status !== 'completed' && job.status !== 'failed');
    const interval = setInterval(
      () => fetchResources({ showLoading: false }),
      hasActiveJobs ? 5000 : 20000
    );
    return () => clearInterval(interval);
  }, [dockJobs]);

  const filteredResources = resources.filter((resource) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query || [resource.title, resource.folder_name || '', resource.playlist_name || '']
      .some((value) => value.toLowerCase().includes(query));
    const matchesType = typeFilter === 'all' || normalizeType(resource.type) === typeFilter;
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'ready' && normalizeStatus(resource.rag_status) === 'ready')
      || (statusFilter === 'failed' && isFailedStatus(resource))
      || (statusFilter === 'not_embedded' && !resource.is_embedded);
    return matchesSearch && matchesType && matchesStatus;
  });

  const dashboardData = buildDashboardData(filteredResources);

  useEffect(() => {
    setSelectedResourceIds((current) => {
      const allowedIds = new Set(filteredResources.map((resource) => resource.id));
      const next = new Set(Array.from(current).filter((id) => allowedIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredResources]);

  const stats = {
    total: filteredResources.length,
    ready: filteredResources.filter(r => normalizeStatus(r.rag_status) === 'ready').length,
    failed: filteredResources.filter(r => isFailedStatus(r)).length,
    chunks: filteredResources.reduce((acc, r) => acc + r.chunk_count, 0),
    vectors: filteredResources.reduce((acc, r) => acc + r.vector_count, 0)
  };

  const getHealthBucket = (resource: RagResource) => {
    if (isFailedStatus(resource)) return 'Failed';
    if (resource.diagnostics.health_score > 80) return 'Healthy';
    return 'Degraded';
  };

  const healthData = [
    { name: 'Healthy', value: filteredResources.filter(r => getHealthBucket(r) === 'Healthy').length, color: '#10b981' },
    { name: 'Degraded', value: filteredResources.filter(r => getHealthBucket(r) === 'Degraded').length, color: '#f59e0b' },
    { name: 'Failed', value: filteredResources.filter(r => getHealthBucket(r) === 'Failed').length, color: '#f43f5e' }
  ];

  const getStatusColor = (status: string, healthy: boolean, isEmbedded: boolean) => {
    const normalized = normalizeStatus(status);
    if (normalized === 'ready' && isEmbedded) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    if (normalized === 'ready' && !isEmbedded) return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    if (normalized.startsWith('failed') || !healthy) return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
    if (['processing', 'chunked', 'chaptering', 'subchaptering', 'embedding', 'indexing', 'transcribing', 'summarizing'].includes(normalized)) {
      return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    }
    return 'text-ink-muted bg-surface border-border';
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'pdf': return <FileText size={16} />;
      case 'docx': return <FileCode2 size={16} />;
      case 'audio': return <FileAudio size={16} />;
      case 'video': return <FileVideo size={16} />;
      case 'image': return <FileImage size={16} />;
      default: return <File size={16} />;
    }
  };

  const getHealthStrokeColor = (score: number) => {
    if (score > 80) return '#10b981';
    if (score > 40) return '#f59e0b';
    return '#f43f5e';
  };

  const buildHealthSpark = (score: number) => {
    if (score > 80) return [Math.max(0, score - 22), Math.max(0, score - 14), Math.max(0, score - 8), Math.max(0, score - 4), score];
    if (score > 40) return [Math.max(0, score - 10), Math.max(0, score - 4), Math.min(100, score + 3), Math.max(0, score - 1), score];
    return [score, score, score, score, score];
  };

  const InteractiveSparkline = ({ score, history }: { score: number; history?: { time: string; score: number }[] }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);

    const values = history && history.length >= 2
      ? history.map((point) => point.score)
      : buildHealthSpark(score);
    const width = 64;
    const height = 18;
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const range = Math.max(max - min, 1);

    const coords = values.map((value, index) => ({
      x: (index / Math.max(values.length - 1, 1)) * width,
      y: height - ((value - min) / range) * (height - 2) - 1,
    }));

    const pointsStr = coords.map((c) => `${c.x},${c.y}`).join(' ');

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * width;
      let closest = 0;
      let minDist = Infinity;
      coords.forEach((c, i) => {
        const dist = Math.abs(c.x - mouseX);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      setHoverIdx(closest);
    }, [coords, width]);

    const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

    const strokeColor = getHealthStrokeColor(score);

    return (
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pointsStr}
        />
        {hoverIdx !== null && coords[hoverIdx] && (
          <circle
            cx={coords[hoverIdx].x}
            cy={coords[hoverIdx].y}
            r="3"
            fill={strokeColor}
          />
        )}
      </svg>
    );
  };

  return (
    <div className={`ragx-scope${isDarkMode ? ' dark' : ''} h-full min-h-0 bg-canvas text-ink flex overflow-hidden`}>
      
      {/* Sidebar Navigation */}
      <aside className="w-16 md:w-20 border-r border-border flex flex-col items-center justify-between py-8 bg-panel shrink-0">
        <div className="flex flex-col items-center gap-8 w-full">
          <div className="w-10 h-10 bg-brand text-brand-foreground flex items-center justify-center font-display font-bold text-xl">
            R
          </div>
          <nav className="flex flex-col gap-6 w-full items-center">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className={`p-3 transition-colors relative group ${currentView === 'dashboard' ? 'text-ink' : 'text-ink-faint hover:text-ink'}`}
            >
              <Activity size={24} />
              {currentView === 'dashboard' && <div className="absolute inset-y-0 -left-5 md:-left-7 w-1 bg-brand" />}
              <span className="absolute left-full ml-4 px-2 py-1 bg-brand text-brand-foreground text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">Dashboard</span>
            </button>
            <button 
              onClick={() => setCurrentView('explorer')}
              className={`p-3 transition-colors relative group ${currentView === 'explorer' ? 'text-ink' : 'text-ink-faint hover:text-ink'}`}
            >
              <Database size={20} />
              {currentView === 'explorer' && <div className="absolute inset-y-0 -left-5 md:-left-7 w-1 bg-brand" />}
              <span className="absolute left-full ml-4 px-2 py-1 bg-brand text-brand-foreground text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">Library Explorer</span>
            </button>
            <button onClick={() => setIsPreviewOpen(true)} className="p-3 text-ink-faint hover:text-ink transition-colors relative group">
              <Search size={24} />
              <span className="absolute left-full ml-4 px-2 py-1 bg-brand text-brand-foreground text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">Retrieval Preview</span>
            </button>
          </nav>
        </div>
        <div className="flex flex-col gap-6 w-full items-center">
          <button 
            onClick={toggleTheme} 
            className="p-3 text-ink-faint hover:text-ink transition-colors relative group"
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun size={24} /> : <Moon size={24} />}
            <span className="absolute left-full ml-4 px-2 py-1 bg-brand text-brand-foreground text-xs font-medium opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              {isDarkMode ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <header className="px-8 py-10 border-b border-border flex flex-col md:flex-row md:items-end justify-between gap-6 flex-shrink-0">
          <div>
            <h1 className="text-4xl font-display font-medium tracking-tight mb-2">
              {currentView === 'dashboard' && 'System Dashboard'}
              {currentView === 'explorer' && 'RAG Library Explorer'}
              {currentView === 'processing-volume' && 'Processing Volume Logs'}
              {currentView === 'activity-logs' && 'System Activity Logs'}
            </h1>
            <p className="text-ink-muted font-sans max-w-xl">
              {currentView === 'dashboard' && 'Overview of pipeline health, recent jobs, and processing volume across your entire RAG system.'}
              {currentView === 'explorer' && 'Inspect your retrieval pipeline. Understand what resources have been processed, their chunk health, and what the system is ready to retrieve.'}
              {currentView === 'processing-volume' && 'Detailed historical processing volume data.'}
              {currentView === 'activity-logs' && 'Comprehensive system activity and event logs.'}
            </p>
          </div>
          <div className="flex gap-3">
            {currentView !== 'explorer' && currentView !== 'dashboard' && (
              <button onClick={() => setCurrentView('dashboard')} className="px-4 py-2 border border-border-strong hover:bg-surface transition-colors font-medium text-sm flex items-center gap-2">
                <ArrowLeft size={16} /> Back to Dashboard
              </button>
            )}
            <button
              onClick={handleExportReport}
              className="px-4 py-2 border border-border-strong hover:bg-surface transition-colors font-medium text-sm flex items-center gap-2"
            >
              <Download size={16} /> Export Report
            </button>
            <button onClick={() => setIsPreviewOpen(true)} className="px-4 py-2 bg-brand text-brand-foreground hover:bg-brand/90 transition-colors font-medium text-sm flex items-center gap-2">
              <Play size={16} className="fill-black" /> Run Retrieval Preview
            </button>
          </div>
        </header>

        {currentView === 'dashboard' ? (
          <DashboardView
            resources={filteredResources}
            volumeData={volumeData}
            onViewVolume={() => setCurrentView('processing-volume')}
            onViewActivity={() => setCurrentView('activity-logs')}
            isDarkMode={isDarkMode}
          />
        ) : currentView === 'processing-volume' ? (
          <div className="flex-1 overflow-auto p-8 bg-panel">
            <div className="border border-border bg-canvas p-6 max-w-4xl mx-auto">
              <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider mb-6">Volume Detail (Last 7 Days)</h3>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={volumeData} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
                    <XAxis dataKey="label" stroke={isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(17,17,17,0.35)'} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke={isDarkMode ? 'rgba(255,255,255,0.25)' : 'rgba(17,17,17,0.25)'} fontSize={12} tickLine={false} axisLine={false} />
                    <Line type="monotone" dataKey="chunks" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="vectors" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4, fill: '#06b6d4', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#121212', border: '1px solid var(--ragx-border)' }}
                      itemStyle={{ color: '#fafafa' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : currentView === 'activity-logs' ? (
          <div className="flex-1 overflow-auto p-8 bg-panel">
            <div className="border border-border bg-canvas p-6 max-w-4xl mx-auto">
              <h3 className="text-sm font-mono text-ink-muted uppercase tracking-wider mb-6">System Event Log</h3>
              <div className="space-y-4">
                {dashboardData.recentActivity.map((activity) => {
                  const Icon = activity.icon;
                  const badgeBg = activity.color.includes('rose')
                    ? 'bg-rose-400/10'
                    : activity.color.includes('amber')
                      ? 'bg-amber-400/10'
                      : activity.color.includes('emerald')
                        ? 'bg-emerald-400/10'
                        : 'bg-surface';
                  return (
                  <div key={activity.id} className="flex gap-4 items-start border-b border-border pb-4">
                    <span className="text-xs font-mono text-ink-faint mt-1">{activity.time}</span>
                    <div className="flex-1">
                      <span className={`font-mono text-xs px-2 py-0.5 mr-2 inline-flex items-center gap-1 ${activity.color} ${badgeBg}`}>
                        <Icon size={10} /> INFO
                      </span>
                      <span className="text-ink text-sm">{activity.action}</span>
                      <p className="text-ink-muted text-sm mt-2">{activity.details}</p>
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Dashboard Strip */}
            <div className="flex flex-col xl:flex-row border-b border-border flex-shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-5 flex-1">
            <div className="p-6 md:p-8 border-r border-b xl:border-b-0 border-border relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Database size={64}/></div>
              <div className="text-sm text-ink-muted font-mono mb-2 uppercase tracking-wider">Total Resources</div>
              <div className="text-4xl font-display">{stats.total}</div>
            </div>
            <div className="p-6 md:p-8 border-r border-b xl:border-b-0 border-border relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><CheckCircle2 size={64}/></div>
              <div className="text-sm text-ink-muted font-mono mb-2 uppercase tracking-wider">Retrieval-Ready</div>
              <div className="text-4xl font-display text-emerald-400">{stats.ready}</div>
            </div>
            <div className="p-6 md:p-8 border-r border-b md:border-b-0 border-border relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Layers size={64}/></div>
              <div className="text-sm text-ink-muted font-mono mb-2 uppercase tracking-wider">Total Chunks</div>
              <div className="text-4xl font-display">{stats.chunks}</div>
            </div>
            <div className="p-6 md:p-8 border-r border-b md:border-b-0 border-border relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Layers size={64}/></div>
              <div className="text-sm text-ink-muted font-mono mb-2 uppercase tracking-wider">Total Vectors</div>
              <div className="text-4xl font-display">{stats.vectors}</div>
            </div>
            <div className="p-6 md:p-8 border-r xl:border-r-0 border-border relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><AlertTriangle size={64}/></div>
              <div className="text-sm text-ink-muted font-mono mb-2 uppercase tracking-wider">Failed Pipes</div>
              <div className="text-4xl font-display text-rose-400">{stats.failed}</div>
            </div>
          </div>
          
          <div className="p-6 md:p-8 border-l border-border w-full xl:w-96 flex flex-col justify-center bg-panel">
            <div className="text-sm text-ink-muted font-mono mb-4 uppercase tracking-wider">Health Distribution</div>
            <div className="flex-1 flex items-center gap-6">
              <div className="w-24 h-24 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={healthData}
                      cx="50%"
                      cy="50%"
                      innerRadius={25}
                      outerRadius={40}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {healthData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#121212', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                      itemStyle={{ color: 'var(--color-ink)', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2 flex-1">
                {healthData.map((data, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
                      <span className="text-ink-muted">{data.name}</span>
                    </div>
                    <span className="text-ink">{data.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* List Area */}
        <div className="flex-1 flex flex-col min-h-0 bg-panel">
          {/* Toolbar */}
          <div className="px-8 py-4 border-b border-border flex items-center justify-between gap-4">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
              <input 
                type="text" 
                placeholder="Search resources, folders, or playlists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent border border-border-strong pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-border0 text-ink placeholder:text-ink-faint transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <FilterDropdown
                value={typeFilter}
                onChange={setTypeFilter}
                label="All Types"
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'pdf', label: 'PDF' },
                  { value: 'video', label: 'Video' },
                  { value: 'audio', label: 'Audio' },
                  { value: 'docx', label: 'DOCX' },
                  { value: 'image', label: 'Image' },
                ]}
              />
              <FilterDropdown
                value={statusFilter}
                onChange={setStatusFilter}
                label="All Statuses"
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'not_embedded', label: 'Not Embedded' },
                ]}
              />
            </div>
          </div>

          {/* Table Area */}
          {filteredResources.length > 0 && selectedResourceIds.size > 0 && (
            <div className="px-8 py-3 bg-surface-hover border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-ink">
                {selectedResourceIds.size} resource{selectedResourceIds.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                {selectedResourceIds.size === 2 && (
                  <button 
                    onClick={() => setIsCompareOpen(true)}
                    className="px-3 py-1.5 bg-brand text-brand-foreground border border-brand hover:opacity-90 text-xs font-medium flex items-center gap-2 transition-opacity mr-2"
                  >
                    <GitCompare size={14} /> Compare
                  </button>
                )}
                <button
                  onClick={handleReprocessSelected}
                  disabled={isActionLoading}
                  className="px-3 py-1.5 bg-canvas border border-border hover:bg-surface text-ink text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Re-process Selected
                </button>
                <button
                  onClick={handleEmbedSelected}
                  disabled={isActionLoading}
                  className="px-3 py-1.5 bg-canvas border border-border hover:bg-surface text-ink text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Layers size={14} /> Embed Selected
                </button>
                <button
                  onClick={handleExportDiagnostics}
                  className="px-3 py-1.5 bg-canvas border border-border hover:bg-surface text-ink text-xs font-medium flex items-center gap-2 transition-colors"
                >
                  <Download size={14} /> Export Diagnostics
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={isActionLoading}
                  className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-500 text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} /> Delete Selected
                </button>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-panel">
              <RefreshCw size={28} className="animate-spin text-ink-faint mb-4" />
              <p className="text-sm text-ink-muted">Loading RAG library...</p>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-panel">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-xl w-full border border-rose-500/20 bg-rose-500/5 p-8 md:p-12 text-center"
              >
                <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-6 text-rose-400">
                  <AlertTriangle size={32} />
                </div>
                <h2 className="text-2xl font-display font-medium text-ink mb-3">Failed to Load Library</h2>
                <p className="text-rose-400/80 text-sm leading-relaxed mb-8">{loadError}</p>
                <button
                  onClick={() => fetchResources()}
                  className="px-6 py-3 bg-brand text-brand-foreground font-medium text-sm hover:bg-brand/90 transition-colors flex items-center justify-center gap-2 mx-auto"
                >
                  <RefreshCw size={16} /> Retry
                </button>
              </motion.div>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-panel">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-lg w-full border border-border p-5 text-center bg-canvas shadow-2xl"
              >
                <div className="w-10 h-10 bg-surface border border-border flex items-center justify-center mx-auto mb-3 text-ink-faint">
                  <Database size={20} />
                </div>
                <h2 className="text-lg font-display font-medium text-ink mb-1.5">Library is Empty</h2>
                <p className="text-ink-muted text-xs leading-relaxed mb-4">
                  {resources.length === 0
                    ? 'Your RAG library does not have any resources yet. To get started, you can ingest your first file (PDF, DOCX, Video, or Audio) which will automatically be chunked, embedded, and indexed for retrieval.'
                    : 'No resources match the current search or filters. Adjust the type or status filters to inspect the rest of your library.'}
                </p>
                
                <div className="text-left bg-panel border border-border p-3 mb-4 relative overflow-hidden group">
                  <h4 className="text-xs font-medium text-ink mb-2 flex items-center gap-2 relative z-10"><Settings size={14} className="text-ink-faint"/> How to ingest your first file</h4>
                  <ol className="text-xs text-ink-muted space-y-1 list-decimal list-inside relative z-10 font-sans">
                    <li><span className="text-ink-muted">Upload</span> a document or media file.</li>
                    <li>System <span className="text-ink-muted">extracts raw text</span> or creates a transcript.</li>
                    <li>Content is divided into <span className="text-ink-muted">semantic chunks</span>.</li>
                    <li>Each chunk is <span className="text-ink-muted">embedded</span> into a dense vector.</li>
                    <li>The resource becomes <span className="text-emerald-400">ready for retrieval</span>.</li>
                  </ol>
                </div>

                <button 
                  onClick={() => fetchResources()}
                  className="px-5 py-2 bg-brand text-brand-foreground font-medium text-sm hover:bg-brand/90 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto mx-auto shadow-[0_0_20px_var(--color-border)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
                >
                  <RefreshCw size={16} /> Refresh Library
                </button>
              </motion.div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-canvas sticky top-0 z-10 border-b border-border">
                  <tr>
                    <th className="px-8 py-4 w-12">
                      <input 
                        type="checkbox" 
                        className="accent-brand w-4 h-4"
                        checked={filteredResources.length > 0 && selectedResourceIds.size === filteredResources.length}
                        onChange={handleSelectAll}
                      />
                    </th>
                    <th className="px-8 py-4 text-xs font-mono text-ink-faint font-normal uppercase tracking-wider">Resource</th>
                    <th className="px-8 py-4 text-xs font-mono text-ink-faint font-normal uppercase tracking-wider">Status</th>
                    <th className="px-8 py-4 text-xs font-mono text-ink-faint font-normal uppercase tracking-wider">Health</th>
                    <th className="px-8 py-4 text-xs font-mono text-ink-faint font-normal uppercase tracking-wider">Chunks / Vectors</th>
                    <th className="px-8 py-4 text-xs font-mono text-ink-faint font-normal uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredResources.map((resource) => (
                    <tr 
                      key={resource.id} 
                      className={`transition-colors cursor-pointer group ${selectedResourceIds.has(resource.id) ? 'bg-surface-hover' : 'hover:bg-surface'}`}
                      onClick={() => setSelectedResource(resource)}
                    >
                      <td className="px-8 py-5" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          className="accent-brand w-4 h-4 cursor-pointer"
                          checked={selectedResourceIds.has(resource.id)}
                          onChange={(e) => handleSelectOne(e, resource.id)}
                        />
                      </td>
                      <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="text-ink-muted p-2 border border-border bg-surface">
                          {getTypeIcon(resource.type)}
                        </div>
                        <div>
                          <div className="font-medium text-ink group-hover:text-ink transition-colors">{resource.title}</div>
                          <div className="text-xs text-ink-faint mt-1 flex items-center gap-1">
                            {resource.playlist_name ?? ''} <span className="opacity-50">/</span> {resource.folder_name ?? ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium uppercase tracking-wider border ${getStatusColor(resource.rag_status, resource.diagnostics.healthy, resource.is_embedded)}`}>
                        {normalizeStatus(resource.rag_status) === 'processing' && <RefreshCw size={10} className="animate-spin" />}
                        {isFailedStatus(resource) && <AlertTriangle size={10} />}
                        {normalizeStatus(resource.rag_status) === 'ready' && !resource.is_embedded
                          ? 'Need Embedding'
                          : formatStatusLabel(resource.rag_status)}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-6">
                          <InteractiveSparkline score={resource.diagnostics.health_score} history={resource.diagnostics.health_history} />
                        </div>
                        <span className="text-xs font-mono text-ink-muted">{resource.diagnostics.health_score}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-sans flex items-baseline gap-2">
                        <span className="text-ink">{resource.chunk_count}</span>
                        <span className="text-ink-faint text-xs">/</span>
                        <span className={resource.vector_count < resource.chunk_count && resource.chunk_count > 0 ? 'text-amber-400' : 'text-ink-muted'}>
                          {resource.vector_count}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSelectedResource(resource); }}
                        className="text-xs font-medium border border-border-strong px-3 py-1.5 hover:bg-brand hover:text-brand-foreground transition-colors"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
          </>
        )}
      </main>

      {/* Overlays */}
      <ResourceDetailPanel 
        resource={selectedResource} 
        onClose={() => setSelectedResource(null)} 
        onOpenPreview={() => setIsPreviewOpen(true)}
      />
      
      <RetrievalPreview 
        isOpen={isPreviewOpen} 
        onClose={() => setIsPreviewOpen(false)} 
      />

      <AnimatePresence>
        {isCompareOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCompareOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-panel border border-border shadow-2xl w-full max-w-5xl max-h-full flex flex-col z-10 overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-border bg-panel">
                <h2 className="text-lg font-display font-medium text-ink flex items-center gap-2">
                  <GitCompare size={18} className="text-ink-faint" /> Compare Diagnostics
                </h2>
                <button
                  onClick={() => setIsCompareOpen(false)}
                  className="p-2 text-ink-faint hover:text-ink hover:bg-surface transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-auto bg-canvas p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {Array.from(selectedResourceIds).map((id, index) => {
                    const res = resources.find(r => r.id === id);
                    if (!res) return null;
                    
                    const chunkDensity = res.chunk_count > 0 ? Math.round(res.transcript_chars / res.chunk_count) : 0;
                    
                    return (
                      <div key={id} className="space-y-6 relative">
                        {index === 1 && (
                          <div className="hidden md:block absolute -left-4 top-1/2 -translate-y-1/2 w-px h-3/4 bg-border" />
                        )}
                        <div className="bg-panel border border-border p-5 flex items-start gap-4">
                          <div className="text-ink-muted p-3 border border-border bg-surface shrink-0">
                            {getTypeIcon(res.type)}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-medium text-ink truncate mb-1" title={res.title}>{res.title}</h3>
                            <div className="flex items-center gap-2 text-xs font-mono text-ink-faint">
                              <span className="uppercase">{res.type}</span>
                              <span>•</span>
                              <span>{normalizeStatus(res.rag_status) === 'ready' && !res.is_embedded ? 'Need Embedding' : formatStatusLabel(res.rag_status)}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                          <h4 className="text-xs font-mono text-ink-faint uppercase tracking-wider border-b border-border pb-2">Diagnostic Metrics</h4>
                          
                          <div className="bg-panel border border-border divide-y divide-border">
                            <div className="flex items-center justify-between p-4">
                              <span className="text-sm text-ink-muted">Health Score</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${res.diagnostics.healthy ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {res.diagnostics.health_score}/100
                                </span>
                                {res.diagnostics.healthy ? <CheckCircle2 size={14} className="text-emerald-400"/> : <AlertTriangle size={14} className="text-rose-400"/>}
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between p-4">
                              <span className="text-sm text-ink-muted">Vector Count</span>
                              <span className="text-sm font-medium text-ink font-mono">{res.vector_count.toLocaleString()}</span>
                            </div>
                            
                            <div className="flex items-center justify-between p-4">
                              <span className="text-sm text-ink-muted">Chunk Count</span>
                              <span className="text-sm font-medium text-ink font-mono">{res.chunk_count.toLocaleString()}</span>
                            </div>
                            
                            <div className="flex items-center justify-between p-4">
                              <span className="text-sm text-ink-muted flex items-center gap-2">Chunk Density <span className="text-[10px] text-ink-faint font-mono uppercase">chars/chunk</span></span>
                              <span className="text-sm font-medium text-ink font-mono">{chunkDensity.toLocaleString()}</span>
                            </div>
                            
                            <div className="flex items-center justify-between p-4">
                              <span className="text-sm text-ink-muted">Transcript Length</span>
                              <span className="text-sm font-medium text-ink font-mono">{res.transcript_chars.toLocaleString()} chars</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmModal(null)} />
          <div className="relative bg-panel border border-border shadow-2xl w-full max-w-md p-6 z-10">
            <h3 className="text-lg font-display font-medium text-ink mb-3">Confirm Action</h3>
            <p className="text-sm text-ink-muted mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 border border-border-strong text-ink text-sm font-medium hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-brand text-brand-foreground text-sm font-medium hover:bg-brand/90 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing Dock */}
      {dockJobs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-panel shadow-2xl">
          <div className="px-4 py-3 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <Layers size={14} className="text-ink-faint" />
              Processing Pipeline ({dockJobs.filter((j) => j.status !== 'completed' && j.status !== 'failed').length} active)
            </div>
            <button
              onClick={() => setDockJobs([])}
              className="text-xs text-ink-faint hover:text-ink transition-colors"
            >
              Clear All
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {dockJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-surface transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    job.status === 'completed' ? 'bg-emerald-400'
                    : job.status === 'failed' ? 'bg-rose-400'
                    : 'bg-amber-400 animate-pulse'
                  }`} />
                  <span className="text-sm text-ink truncate">{job.title}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-mono ${
                    job.status === 'completed' ? 'text-emerald-400'
                    : job.status === 'failed' ? 'text-rose-400'
                    : 'text-amber-400'
                  }`}>
                    {job.detail ? job.detail.toUpperCase() : job.status.toUpperCase()}
                  </span>
                  <button
                    onClick={() => removeDockJob(job.id)}
                    className="text-ink-faint hover:text-ink transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
